// ADR-0174 — operações em massa (aderir/sair de promoções DEAL/SMART do ML). Modos:
//  - Usuário (admin ou suporte full): cria a operação a partir da Central e publica { etapa: 'executar' }.
//  - QStash { etapa: 'executar' | 'conferir', operacao_id }: executor com continuação e conferência da saída.
// Escrita no ML só em /seller-promotions (ml.ts); claim por item garante que reentrega não escreve duas vezes.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { qstashClient, verificarAssinatura } from '../_shared/queue.ts';
import { exigirModulo, moduloHabilitadoStrict } from '../_shared/produto/modulo.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { conferir, executar, type OperacaoRow } from '../_shared/operacoes/executar.ts';
import { validarPedido, type ItemPedido, type LinhaCentral } from '../_shared/operacoes/validar.ts';
import {
  COLS_CENTRAL, criarSemaforoExato, dedup, depsExecutar, encerrarComErro, linhaCentral, urlOperacoes,
} from '../_shared/operacoes/deps.ts';
import { lerConexaoML, MSG_SEM_CONEXAO, respostaFalhaCriacao, SemConexaoML } from '../_shared/operacoes/falhas.ts';
import type { Acao } from '../_shared/operacoes/tipos.ts';

const EXECUCAO = { limiteMs: 90_000, lote: 20 };
const SEM_MODULO = 'A Central de Promoções não está habilitada para esta organização.';
const PROMOCAO_ENCERRADA = 'A promoção não está mais ativa no Mercado Livre';
const NAO_INICIOU = 'Não foi possível iniciar a operação. Tente de novo.';

type Admin = ReturnType<typeof adminClient>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** null = org sem conta ML (ausência real); erro de leitura ou de refresh LANÇA (transitório). */
async function conexaoDaOrg(admin: Admin, orgId: string) {
  const conexao = await lerConexaoML(admin, orgId);
  if (!conexao?.contaExternaId) return null;
  return { orgId, mlUserId: conexao.contaExternaId, token: await getValidAccessTokenConexao(conexao) };
}

const ativa = (s: unknown): s is 'pending' | 'started' => s === 'pending' || s === 'started';

async function lerPromocao(admin: Admin, orgId: string, promocaoId: string) {
  const { data, error } = await admin.from('ml_promocoes').select('tipo, nome, status')
    .eq('org_id', orgId).eq('promocao_id', promocaoId).maybeSingle();
  if (error) throw new Error(`ml_promocoes: ${error.message}`);
  return data as { tipo: string; nome: string | null; status: string } | null;
}

/** QStash: executa ou confere. 200 = etapa tratada (erro por item já gravado); 500 = QStash tenta de novo. */
async function etapaQStash(admin: Admin, req: Request, body: string): Promise<Response> {
  let payload: { etapa?: string; operacao_id?: string } = {};
  try { payload = JSON.parse(body); } catch { /* corpo inválido cai abaixo */ }
  if ((payload.etapa !== 'executar' && payload.etapa !== 'conferir') || !payload.operacao_id) {
    return json({ ok: false, erro: 'mensagem inválida' });
  }
  const { data: linha, error } = await admin.from('operacoes_massa')
    .select('id, org_id, acao, promocao_id, promocao_tipo, status').eq('id', payload.operacao_id).maybeSingle();
  if (error) throw new Error(`operacoes_massa: ${error.message}`);
  if (!linha) return json({ ok: false, erro: 'operação não encontrada' });
  if (linha.status === 'concluida') return json({ ok: true, ignorada: true });

  // Encerrar só com ausência REAL (módulo desligado, promoção encerrada, conta não conectada): erro de leitura
  // lança → 500 → QStash reentrega. Encerrar por engano solta do índice anti-duplicidade item em saída pedida.
  if (!(await moduloHabilitadoStrict(admin, linha.org_id, 'promocoes'))) {
    await encerrarComErro(admin, linha, SEM_MODULO);
    return json({ ok: false, erro: SEM_MODULO });
  }
  const promo = await lerPromocao(admin, linha.org_id, linha.promocao_id);
  if (!ativa(promo?.status)) {
    await encerrarComErro(admin, linha, PROMOCAO_ENCERRADA);
    return json({ ok: false, erro: PROMOCAO_ENCERRADA });
  }
  const cx = await conexaoDaOrg(admin, linha.org_id);
  if (!cx) {
    await encerrarComErro(admin, linha, MSG_SEM_CONEXAO);
    return json({ ok: false, erro: MSG_SEM_CONEXAO });
  }

  const op: OperacaoRow = {
    id: linha.id, org_id: linha.org_id, acao: linha.acao as Acao, promocao_id: linha.promocao_id,
    promocao_tipo: linha.promocao_tipo as OperacaoRow['promocao_tipo'], promocao_status: promo!.status as OperacaoRow['promocao_status'],
  };
  // ponytail: sem o header (não acontece em entrega do QStash) a chave é nova — perde só o dedup da continuação;
  // a escrita no ML continua protegida pelo claim.
  const chave = req.headers.get('upstash-message-id') ?? crypto.randomUUID();
  const deps = depsExecutar(admin, cx, op, chave);
  const r = payload.etapa === 'executar' ? await executar(op, deps, EXECUCAO) : await conferir(op, deps);
  return json({ ok: true, ...r });
}

interface Pedido { acao: Acao; promocao_id: string; origem_id: string | null; itens: ItemPedido[] }
function lerPedido(x: unknown): Pedido | null {
  const b = x as Record<string, unknown> | null;
  if (!b || (b.acao !== 'aderir' && b.acao !== 'sair') || typeof b.promocao_id !== 'string' || !b.promocao_id) return null;
  if (b.origem_id != null && typeof b.origem_id !== 'string') return null;
  if (!Array.isArray(b.itens)) return null;
  const itens: ItemPedido[] = [];
  for (const i of b.itens as Record<string, unknown>[]) {
    if (!i || typeof i.ml_item_id !== 'string' || !i.ml_item_id) return null;
    if (i.preco != null && typeof i.preco !== 'number') return null;
    itens.push({ ml_item_id: i.ml_item_id, preco: (i.preco as number | null | undefined) ?? null, confirmado_risco: i.confirmado_risco === true });
  }
  return { acao: b.acao, promocao_id: b.promocao_id, origem_id: (b.origem_id as string | null | undefined) ?? null, itens };
}

/** Usuário: valida o pedido contra a Central, grava a operação e publica a 1ª etapa. */
async function criar(admin: Admin, req: Request, body: string): Promise<Response> {
  let ctx: Awaited<ReturnType<typeof requireUserOrg>>;
  try {
    ctx = await requireUserOrg(req, { access: 'write' });
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  const { orgId, userId } = ctx;
  if (!ctx.isAdmin && ctx.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, ctx, { type: 'org', id: orgId }, 'denied');
    return json({ erro: 'Só administradores executam operações em massa.' }, 403);
  }
  if (!(await exigirModulo(admin, orgId, 'promocoes'))) return json({ erro: SEM_MODULO }, 403);

  let bruto: unknown = null;
  try { bruto = JSON.parse(body); } catch { /* inválido */ }
  const pedido = lerPedido(bruto);
  if (!pedido) return json({ erro: 'Pedido inválido.' }, 400);

  const promo = await lerPromocao(admin, orgId, pedido.promocao_id);
  if (!promo) return json({ erro: 'Promoção não encontrada.' }, 404);
  if (!ativa(promo.status)) return json({ erro: 'Esta promoção já terminou.' }, 400);

  if (pedido.origem_id) {
    const { data: origem, error } = await admin.from('operacoes_massa').select('acao, promocao_id')
      .eq('org_id', orgId).eq('id', pedido.origem_id).maybeSingle();
    if (error) throw new Error(`origem: ${error.message}`);
    if (!origem || origem.acao === pedido.acao || origem.promocao_id !== pedido.promocao_id) {
      return json({ erro: 'A operação de origem não pode ser revertida por este pedido.' }, 400);
    }
  }

  const central = new Map<string, LinhaCentral>();
  const ids = [...new Set(pedido.itens.map((i) => i.ml_item_id))];
  if (ids.length && ids.length <= 500) {
    const { data, error } = await admin.from('ml_promocao_itens').select(COLS_CENTRAL)
      .eq('org_id', orgId).eq('promocao_id', pedido.promocao_id).in('ml_item_id', ids);
    if (error) throw new Error(`ml_promocao_itens: ${error.message}`);
    for (const r of data ?? []) central.set(String(r.ml_item_id), linhaCentral(r));
  }

  // Conexão só é aberta se algum preço editado pedir a tarifa exata.
  let exato: ReturnType<typeof criarSemaforoExato> | null = null;
  let v: Awaited<ReturnType<typeof validarPedido>>;
  try {
    v = await validarPedido(pedido.acao, promo.tipo, pedido.itens, central, async (l, preco) => {
      if (!exato) {
        const cx = await conexaoDaOrg(admin, orgId);
        if (!cx) throw new SemConexaoML();
        exato = criarSemaforoExato(admin, cx);
      }
      return exato(l, preco);
    });
  } catch (e) {
    // Conta ausente → 400; ML recusou o token → 403; o resto é transitório (500 no catch geral).
    const r = respostaFalhaCriacao(e);
    if (!r) throw e;
    return json({ erro: r.erro }, r.status);
  }
  if (!v.ok) return json({ erro: v.erro, ...(v.itens ? { itens: v.itens } : {}) }, 400);

  const { data: op, error: eOp } = await admin.from('operacoes_massa').insert({
    org_id: orgId, acao: pedido.acao, promocao_id: pedido.promocao_id, promocao_tipo: promo.tipo,
    promocao_nome: promo.nome, origem_id: pedido.origem_id, criado_por: userId,
  }).select('id').single();
  if (eOp || !op) throw new Error(`criar operação: ${eOp?.message}`);
  const alvo = { id: op.id as string, org_id: orgId };

  const { error: eItens } = await admin.from('operacoes_massa_itens').insert(v.itens.map((i) => ({
    operacao_id: alvo.id, org_id: orgId, promocao_id: pedido.promocao_id, ml_item_id: i.ml_item_id, titulo: i.titulo,
    preco: i.preco, semaforo: i.semaforo, confirmado_risco: i.confirmado_risco,
  })));
  if (eItens) {
    await admin.from('operacoes_massa').delete().eq('org_id', orgId).eq('id', alvo.id);
    if (eItens.code === '23505') return json({ erro: 'Algum destes anúncios já está numa operação em andamento.' }, 409);
    throw new Error(`itens da operação: ${eItens.message}`);
  }

  try {
    await qstashClient().publishJSON({
      url: urlOperacoes(), body: { etapa: 'executar', operacao_id: alvo.id }, retries: 3,
      deduplicationId: dedup(`executar_${alvo.id}_0`),
    });
  } catch (e) {
    console.error('[operacoes-massa] publicar', { operacao_id: alvo.id, erro: e instanceof Error ? e.message : String(e) });
    await encerrarComErro(admin, alvo, NAO_INICIOU);
    await auditarOperacaoSuporte(admin, ctx, { type: 'operacao_massa', id: alvo.id }, 'failed');
    return json({ erro: NAO_INICIOU }, 500);
  }
  await auditarOperacaoSuporte(admin, ctx, { type: 'operacao_massa', id: alvo.id }, 'succeeded');
  return json({ operacao_id: alvo.id }, 201);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  const admin = adminClient();
  try {
    if (req.headers.get('upstash-signature')) {
      if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
      return await etapaQStash(admin, req, body);
    }
    return await criar(admin, req, body);
  } catch (e) {
    console.error('[operacoes-massa]', e instanceof Error ? e.message : String(e));
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
