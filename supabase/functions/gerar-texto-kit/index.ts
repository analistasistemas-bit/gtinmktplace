// ADR-0200 (decisão 11): título e descrição do kit com variação, chamados pela prévia da tela antes de
// criar o kit. Etapa própria: não passa por process-familia (que reescreveria o kit). Grava só o consumo
// de IA (kit_variacao_previas) e devolve o texto; quem grava o texto é criar-kit-variacao, com o que o
// operador viu e aprovou.
//
// Padrão de copy do anúncio novo: parte da descrição publicada da base canônica (o modelo reescreve só a
// abertura e a frase final; o resto é edição determinística, ver copywriter-kit-prompt.ts). Base sem
// descrição no padrão: a copy é gerada antes pelo prompt do anúncio novo, com as variações do kit.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { openrouterClient } from '../_shared/ai/client.ts';
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';
import { custoCentavos } from '../_shared/ai/tokens.ts';
import { coagirSlots, SCHEMA_COPY } from '../_shared/ai/copywriter.ts';
import {
  montarUserPrompt, posProcessarDescricao, systemPara, tamanhosDaGradeCopy, validarTipoProdutoBusca,
} from '../_shared/ai/copywriter-prompt.ts';
import { diagnosticarTitulo } from '../_shared/ai/titulo-pos.ts';
import {
  type DadosTextoKit, MAX_CORES, montarTextoKit, montarUserPromptKit, SYSTEM_KIT_VARIACAO, temTemplate,
} from '../_shared/ai/copywriter-kit-prompt.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

interface VariacaoBase {
  codigo: string; cor: string | null; tamanho: string | null; preco: number | null; nome: string | null;
  excluida_da_publicacao?: boolean | null;
}
type Resposta = {
  choices: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ({ orgId } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();

  // Mesmo gate de criar-kit-variacao: o texto só serve a quem pode criar o kit (ADR-0060).
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, context, { type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }
  if (!(await exigirModulo(admin, orgId, 'kit_variacao'))) {
    return json({ error: 'Módulo de kit com variação não habilitado para esta organização.' }, 403);
  }

  let body: { familia_base_id?: unknown; pecas_por_kit?: unknown; cores?: unknown; tamanhos?: unknown };
  try {
    const bruto: unknown = await req.json();
    if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return json({ error: 'Corpo inválido.' }, 400);
    body = bruto as typeof body;
  } catch { return json({ error: 'JSON inválido' }, 400); }
  const pecas = body.pecas_por_kit;
  if (typeof body.familia_base_id !== 'string' || !body.familia_base_id) {
    return json({ error: 'familia_base_id é obrigatório.' }, 400);
  }
  if (typeof pecas !== 'number' || !Number.isInteger(pecas) || pecas < 2 || pecas > 6) {
    return json({ error: 'pecas_por_kit deve ser um inteiro de 2 a 6.' }, 400);
  }
  const listaDeTextos = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((c) => typeof c === 'string'));
  if (!listaDeTextos(body.cores)) return json({ error: 'cores deve ser uma lista de textos.' }, 400);
  if (!listaDeTextos(body.tamanhos)) return json({ error: 'tamanhos deve ser uma lista de textos.' }, 400);

  const target = { type: 'familia', id: body.familia_base_id };
  // Base canônica: a família mais recente do mesmo PAI na org (criado_em desc, id desc), a mesma âncora de
  // criar-kit-variacao. Erro de leitura nunca vira 404.
  const { data: pedida, error: errPedida } = await admin.from('familias').select('codigo_pai')
    .eq('id', body.familia_base_id).eq('org_id', orgId).maybeSingle();
  if (errPedida) return json({ error: 'Falha ao carregar a família base. Tente novamente.' }, 500);
  if (!pedida) return json({ error: 'Família base não encontrada.' }, 404);
  const { data: canonicas, error } = await admin.from('familias')
    .select('nome_pai, titulo_ml, descricao_pai, descricao_ml, genero, unidade, fornecedor, variacoes(codigo, cor, tamanho, preco, nome, excluida_da_publicacao)')
    .eq('org_id', orgId).eq('codigo_pai', pedida.codigo_pai as string)
    .order('criado_em', { ascending: false }).order('id', { ascending: false }).limit(1);
  const base = canonicas?.[0];
  if (error) return json({ error: 'Falha ao carregar a família base. Tente novamente.' }, 500);
  if (!base) return json({ error: 'Família base não encontrada.' }, 404);

  // Cores e tamanhos: só os da própria base (nunca texto livre do cliente dentro do prompt).
  const vivas = ((base.variacoes ?? []) as VariacaoBase[]).filter((v) => !v.excluida_da_publicacao);
  const coresBase = [...new Set(vivas.map((v) => String(v.cor ?? '').trim()).filter(Boolean))];
  const pedidas = (body.cores as string[] | undefined)?.map((c) => c.trim()) ?? [];
  if (pedidas.some((c) => !coresBase.includes(c))) return json({ error: 'Cor fora da base.' }, 400);
  const cores = (pedidas.length > 0 ? pedidas : coresBase).slice(0, MAX_CORES);
  const tamanhosBase = new Set(vivas.map((v) => String(v.tamanho ?? '').trim()).filter(Boolean));
  const tamPedidos = (body.tamanhos as string[] | undefined)?.map((t) => t.trim()) ?? [];
  if (tamPedidos.some((t) => !tamanhosBase.has(t))) return json({ error: 'Tamanho fora da base.' }, 400);
  // Variações do kit: cor marcada × tamanho pedido (sem tamanhos no pedido, todos os da base).
  const doKit = vivas.filter((v) => cores.includes(String(v.cor ?? '').trim())
    && (tamPedidos.length === 0 || tamPedidos.includes(String(v.tamanho ?? '').trim())));
  const variacoesKit = doKit.map((v) => ({
    codigo: v.codigo, cor: v.cor, preco: Number(v.preco ?? 0), nome: v.nome, tamanho: v.tamanho,
  }));
  // Ordem canônica (P, M, G…, depois numérica); null quando a base não é grade.
  const tamanhosKit = tamanhosDaGradeCopy(variacoesKit) ?? [];

  const nomePai = String(base.nome_pai ?? '');
  const descricaoPai = String(base.descricao_pai ?? '');
  let modelo = '';
  let tokensIn = 0, tokensOut = 0, custo = 0;
  const ia = async (
    system: string, user: string,
    formato: { type: 'json_object' } | { type: 'json_schema'; json_schema: typeof SCHEMA_COPY }, ms: number,
  ) => {
    const r: Resposta = await openrouterClient().chat.completions.create(
      { model: modelo, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: formato, temperature: 0.4 },
      { signal: AbortSignal.timeout(ms) },
    );
    // Consumo somado ANTES de interpretar a resposta: JSON inválido também custou tokens.
    const u = r.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
    tokensIn += u.prompt_tokens; tokensOut += u.completion_tokens; custo += custoCentavos(modelo, u);
    return r.choices[0]?.message?.content ?? '';
  };
  // Tokens e custo vêm do backend, nunca do cliente. Sem o registro não há texto (fail-closed).
  const registrar = async () => {
    const { data, error: e } = await admin.from('kit_variacao_previas').insert({
      org_id: orgId, familia_base_id: body.familia_base_id, pecas, modelo,
      tokens_input: tokensIn, tokens_output: tokensOut, custo_centavos: custo,
    }).select('id').single();
    if (e || !data) console.error('gerar-texto-kit: registro de consumo falhou:', e);
    return (data?.id as string | undefined) ?? null;
  };
  const falhou = async (e: unknown) => {
    console.error('gerar-texto-kit: IA falhou:', e);
    if (tokensIn + tokensOut > 0) await registrar();
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: 'Não foi possível gerar o texto do kit. Tente novamente.' }, 502);
  };

  let dados: DadosTextoKit;
  let aberturaBruta: string;
  try {
    modelo = await resolverModeloTexto(admin, orgId);
    let descricaoBase = String(base.descricao_ml ?? '');
    let tituloBase = String(base.titulo_ml ?? '') || nomePai;
    if (!temTemplate(descricaoBase)) {
      // Base sem descrição no padrão: copy do anúncio novo com as variações do kit (mesmo prompt e guards
      // de process-familia), depois as edições de kit como em qualquer base.
      const input = {
        nome: nomePai, descricao_detalhado: descricaoPai, unidade: (base.unidade as string | null) ?? null,
        variacoes: variacoesKit, genero: (base.genero as string | null) ?? null,
      };
      const copy = JSON.parse(await ia(systemPara(input), montarUserPrompt(input), { type: 'json_schema', json_schema: SCHEMA_COPY }, 45_000)) as {
        titulo_slots?: Record<string, unknown>; descricao?: unknown; tipo_produto_busca?: unknown;
      };
      if (typeof copy.descricao !== 'string' || !copy.descricao.trim()) throw new Error('copy sem descrição');
      descricaoBase = posProcessarDescricao(copy.descricao, nomePai, descricaoPai, variacoesKit, input.genero);
      if (!base.titulo_ml) {
        try {
          tituloBase = diagnosticarTitulo(coagirSlots(copy.titulo_slots), {
            nomePai, descricaoPai, cores,
            tipoProdutoBusca: validarTipoProdutoBusca(String(copy.tipo_produto_busca ?? ''), nomePai, descricaoPai),
            fornecedor: (base.fornecedor as string | null) ?? null, grade: tamanhosKit.length > 0, genero: input.genero,
          }).titulo;
        } catch { tituloBase = nomePai; } // título inviável: o nome da base, cortado em posProcessarTituloKit
      }
    }
    dados = { descricaoBase, tituloBase, nomeBase: nomePai, pecas, coresBase, coresKit: cores, tamanhosKit };
    aberturaBruta = await ia(SYSTEM_KIT_VARIACAO, montarUserPromptKit(dados), { type: 'json_object' }, 30_000);
  } catch (e) {
    return await falhou(e);
  }

  const previaId = await registrar();
  if (!previaId) {
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: 'Falha ao registrar o consumo de IA. Tente novamente.' }, 500);
  }

  let abertura: Record<string, unknown>;
  try {
    abertura = JSON.parse(aberturaBruta);
    if (!abertura || typeof abertura !== 'object') throw new Error('resposta sem objeto');
  } catch (e) {
    console.error('gerar-texto-kit: resposta da IA inválida:', e);
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: 'Não foi possível gerar o texto do kit. Tente novamente.' }, 502);
  }
  const { titulo, descricao } = montarTextoKit(dados, abertura);
  await auditarOperacaoSuporte(admin, context, target, 'succeeded');
  return json({ previa_id: previaId, titulo, descricao, custo_centavos: custo });
});
