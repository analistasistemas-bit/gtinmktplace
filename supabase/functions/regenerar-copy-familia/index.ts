import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { userClient } from '../_shared/supabase.ts';
import { gerarCopy } from '../_shared/ai/copywriter.ts';
import { garantirMetragemTitulo, garantirCorTitulo, garantirTipoProdutoTitulo } from '../_shared/ai/titulo.ts';

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

  let body: { familia_id?: string };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!body.familia_id) {
    return new Response('familia_id obrigatório', { status: 400, headers: corsHeaders });
  }

  // Operação compartilhada (ADR-0047/0056): qualquer membro regenera a copy de qualquer
  // família; a RLS is_membro_operacao já restringe à operação. Sem filtro por user.id.
  const { data: familia, error } = await sb
    .from('familias')
    .select('id, nome_pai, descricao_pai, unidade, variacoes(codigo, cor, preco)')
    .eq('id', body.familia_id)
    .maybeSingle();

  if (error || !familia) {
    return new Response(`Família não encontrada: ${error?.message ?? ''}`, { status: 404, headers: corsHeaders });
  }

  try {
    const variacoes = (familia.variacoes ?? []).map((v: Record<string, unknown>) => ({
      codigo: String(v.codigo ?? ''),
      cor: typeof v.cor === 'string' ? v.cor : null,
      preco: Number(v.preco ?? 0),
    }));

    const result = await gerarCopy({
      nome: familia.nome_pai,
      descricao_detalhado: familia.descricao_pai ?? '',
      unidade: (familia.unidade as string | null) ?? null,
      variacoes,
    });

    // Cor única → crava a cor no título (anti-duplicado do ML, ADR-0044).
    const coresUnicas = [...new Set(variacoes.map((v) => v.cor).filter((c): c is string => !!c))];
    const tituloFinal = garantirCorTitulo(
      garantirMetragemTitulo(garantirTipoProdutoTitulo(result.titulo, result.tipo_produto_busca), familia.nome_pai),
      coresUnicas.length === 1 ? coresUnicas[0] : null,
      coresUnicas.length,
    );

    const { error: upErr } = await sb
      .from('familias')
      .update({
        titulo_ml: tituloFinal,
        descricao_ml: result.descricao,
        tokens_input: result.tokens_input,
        tokens_output: result.tokens_output,
        custo_centavos: result.custo_centavos,
        titulo_editado_pelo_operador: false,
        descricao_editada_pelo_operador: false,
      })
      .eq('id', body.familia_id);

    if (upErr) {
      return new Response(`Erro ao atualizar: ${upErr.message}`, { status: 500, headers: corsHeaders });
    }

    return new Response(
      JSON.stringify({
        titulo: tituloFinal,
        descricao: result.descricao,
        custo_centavos: result.custo_centavos,
      }),
      { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  } catch (e) {
    return new Response(`Erro IA: ${(e as Error).message}`, { status: 500, headers: corsHeaders });
  }
});
