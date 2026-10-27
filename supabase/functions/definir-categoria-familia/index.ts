import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { userClient, adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { aplicarKitNosAtributos, montarAtributosML, tipoParaCategoria } from '../_shared/categoria/atributos.ts';
import { resolverAtributosGenericos } from '../_shared/categoria/resolver-atributos-genericos.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { lerSchemaAtributos, ehCategoriaMlValida } from '../_shared/categoria/schema.ts';
import { desempatarAtributosLLM } from '../_shared/ai/atributos-llm.ts';
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';
import { lerMarcaOrg, marcaParaCriacao } from '../_shared/categoria/marca-org.ts';

// Seletor de categoria livre (ADR-0057, estende o escape hatch do ADR-0009/0022): o operador
// escolhe qualquer categoria real do ML (busca em atributos-familia/buscar-categoria). Categoria
// conhecida (linha/fita/botao/cola) → caminho curado (montarAtributosML, zero mudança de
// comportamento). Categoria genérica → resolverAtributosGenericos (mesmo fluxo do process-familia,
// sem duplicar lógica). Contrato antigo {tipo} removido: app de deploy único, sem consumidor externo.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return new Response('Missing auth', { status: 401, headers: corsHeaders });
  }

  const sb = userClient(auth.slice(7));
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response('Invalid token', { status: 401, headers: corsHeaders });

  let orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
try { ({ orgId } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const modeloTexto = await resolverModeloTexto(adminClient(), orgId);

  let body: { familia_id?: string; categoria_ml_id?: string; categoria_nome?: string };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }

  const categoriaMlId = body.categoria_ml_id?.trim();
  const categoriaNome = body.categoria_nome?.trim();
  if (!body.familia_id || !categoriaMlId || !categoriaNome) {
    return new Response('familia_id, categoria_ml_id e categoria_nome obrigatórios', { status: 400, headers: corsHeaders });
  }
  // O id vai para o caminho de uma chamada autenticada à API do ML (lerSchemaAtributos).
  // Sem esta checagem, '../' colapsava a URL e virava um GET com o token do vendedor em
  // qualquer outro endpoint da api.mercadolibre.com.
  if (!ehCategoriaMlValida(categoriaMlId)) {
    return new Response('categoria_ml_id inválido (formato esperado: MLB seguido de dígitos)', { status: 400, headers: corsHeaders });
  }

  // Operação compartilhada (ADR-0047/0056): a RLS is_membro_operacao já restringe à
  // operação; qualquer membro define a categoria. Sem filtro por user.id.
  const { data: familia, error } = await sb
    .from('familias')
    .select('id, user_id, nome_pai, descricao_pai, fornecedor, marca, kit_multiplicador')
    .eq('id', body.familia_id)
    .maybeSingle();

  if (error || !familia) {
    return new Response(`Família não encontrada: ${error?.message ?? ''}`, { status: 404, headers: corsHeaders });
  }

  const tipo = tipoParaCategoria(categoriaMlId);

  // Marca padrão por org (D-E7.3): fallback do BRAND/MANUFACTURER quando o produto não
  // traz marca própria. Default 'Avil' preservado dentro de montarAtributosML/Base.
  // ADR-0186: org com marca própria usa sempre a marca da org, nunca o fornecedor.
  const marcaOrg = await lerMarcaOrg(adminClient(), orgId);
  const marcaPadrao = marcaOrg.marcaPadrao;
  const marca = marcaParaCriacao(familia as { marca?: string | null; fornecedor?: string | null });

  let token: string | null = null;
  const obterToken = async (): Promise<string | null> => {
    if (token) return token;
    try {
      const conexao = await resolverConexao(adminClient(), orgId, 'mercado_livre');
      if (!conexao) throw new Error('Organização sem conexão com o Mercado Livre');
      token = await getValidAccessTokenConexao(conexao);
    } catch (e) { console.error('token p/ atributos genéricos falhou:', e); }
    return token;
  };

  let atributosMl;
  let atributosFaltantes: string[];
  if (tipo !== 'outro') {
    // Categoria conhecida (linha/fita/botao/cola): caminho curado, sem chamada de rede.
    atributosMl = montarAtributosML(tipo, familia.nome_pai, marca, familia.descricao_pai ?? undefined, marcaPadrao);
    atributosFaltantes = [];
  } else {
    await obterToken();
    const r = await resolverAtributosGenericos(
      categoriaMlId,
      { nome: familia.nome_pai, descricao: familia.descricao_pai ?? undefined, fornecedor: marca },
      {
        lerSchema: (id) => {
          if (!token) return Promise.reject(new Error('sem token p/ ler schema da categoria'));
          return lerSchemaAtributos(token, id);
        },
        llm: (input, alvos) => desempatarAtributosLLM(input, alvos, modeloTexto),
      },
      marcaPadrao,
    );
    atributosMl = r.atributosMl;
    atributosFaltantes = r.faltantes;
  }

  // Kit vinculado (ADR-0151): a contagem real é o kit_multiplicador, não a regex do título. Sem
  // reaplicá-la, a emenda do ADR-0071 trocaria "Kit" sem contagem por "Unidade/1" — publicável,
  // mas vendendo N unidades ao preço de 1 (revisão Codex). Categoria sem "Kit" → 400 da função.
  const n = Number(familia.kit_multiplicador ?? 1);
  if (n > 1) {
    const tok = await obterToken();
    if (!tok) {
      return new Response('Sem conexão com o Mercado Livre para validar o formato Kit desta categoria.', { status: 503, headers: corsHeaders });
    }
    try {
      atributosMl = aplicarKitNosAtributos(await lerSchemaAtributos(tok, categoriaMlId), atributosMl, n);
    } catch (e) {
      return new Response((e as Error).message, { status: (e as { status?: number }).status ?? 500, headers: corsHeaders });
    }
  }

  const { error: upErr } = await sb
    .from('familias')
    .update({
      categoria_ml_id: categoriaMlId,
      categoria_nome: categoriaNome,
      tipo_aviamento: tipo,
      tipo_origem: 'manual',
      atributos_ml: atributosMl,
      atributos_faltantes: atributosFaltantes,
    })
    .eq('id', body.familia_id);

  if (upErr) {
    await auditarOperacaoSuporte(adminClient(), context, { type: 'familia', id: familia.id }, 'failed');
    return new Response(`Erro ao atualizar: ${upErr.message}`, { status: 500, headers: corsHeaders });
  }

  await auditarOperacaoSuporte(adminClient(), context, { type: 'familia', id: familia.id }, 'succeeded');
  return new Response(
    JSON.stringify({ categoria_ml_id: categoriaMlId, categoria_nome: categoriaNome, tipo_aviamento: tipo, atributos_faltantes: atributosFaltantes }),
    { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } },
  );
});
