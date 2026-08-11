// E6b (ADR-0094, D-9/D-10/D-15): entrada de mercadoria. Escrita de estoque só passa por aqui
// (service_role), nunca do browser direto — o trigger de bloqueio do Bloco A recusa UPDATE
// direto em variacoes.estoque justamente para o ledger nunca ficar sem o movimento.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let userId: string;
  let orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ({ userId, orgId } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  if (!(await exigirModulo(admin, orgId, 'estoque'))) {
    return json({ error: 'Módulo de estoque não habilitado para esta organização.' }, 403);
  }

  let body: {
    codigo?: string; quantidade?: number; custo?: number | null;
    documento?: string | null; observacao?: string | null; ref?: string;
  };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const codigo = body.codigo?.trim() ?? '';
  const quantidade = Number(body.quantidade ?? 0);
  if (!codigo) return json({ error: 'Informe o SKU.' }, 400);
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    return json({ error: 'Quantidade deve ser um inteiro maior que zero.' }, 400);
  }
  // Custo alimenta markup e preço (ADR-0055): valor inválido FALHA aqui e de novo na RPC.
  const custo = body.custo == null ? null : Number(body.custo);
  if (custo !== null && !(custo > 0)) {
    return json({ error: 'Custo, quando informado, deve ser maior que zero.' }, 400);
  }
  // Idempotência: o cliente gera um uuid por submissão do formulário. Sem isso, duplo clique
  // ou retry de rede soma o saldo 2× e sobrescreve o custo 2× — e isto é caminho financeiro.
  const ref = body.ref?.trim();
  if (!ref) return json({ error: 'Referência de idempotência ausente.' }, 400);
  const refCompleta = `entrada:${ref}`;

  const { data: estoque, error } = await admin.rpc('registrar_entrada', {
    p_org: orgId, p_codigo: codigo, p_qtd: quantidade,
    p_custo: custo, p_doc: body.documento?.trim() || null,
    p_obs: body.observacao?.trim() || null,
    p_criado_por: userId, p_ref: refCompleta,
  });
  if (error) return json({ error: error.message }, 400);
  const duplicada = estoque === null;   // a mesma submissão já foi aplicada — não é erro

  // O enfileiramento roda TAMBÉM no caminho duplicado: se a primeira tentativa aplicou a
  // entrada mas morreu antes de enfileirar, o retry cairia em `duplicada` e o push nunca
  // aconteceria. Push absoluto é idempotente — re-enfileirar é bem mais barato que perder
  // a propagação. canal_origem null = push para TODOS os canais publicados (D-10).
  const { data: mov } = await admin.from('estoque_movimentos')
    .select('codigo_pai, estoque_resultante')
    .eq('org_id', orgId).eq('referencia_externa', refCompleta).maybeSingle();

  let pushOk = true;
  if (mov?.codigo_pai) {
    try {
      await enfileirarSincronizacaoEstoque(
        // reativar: entrada de mercadoria é reposição — anúncio pausado com saldo volta ao ar
        // (ADR-0111). O worker confere o status ao vivo antes de escrever.
        { org_id: orgId, codigo_pai: mov.codigo_pai as string, canal_origem: null, reativar: true }, orgId,
      );
    } catch (e) {
      // A entrada já foi gravada e é a verdade; o push é recuperável pela reconciliação diária.
      pushOk = false;
      console.error('entrada_push_falhou', e);
    }
  }

  await auditarOperacaoSuporte(admin, context, { type: 'variacao', id: codigo }, 'succeeded');

  return json({
    estoque: duplicada ? (mov?.estoque_resultante ?? null) : estoque,
    duplicada, pushOk,
  });
});
