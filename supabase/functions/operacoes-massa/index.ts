// ADR-0174 — operações em massa (aderir/sair de promoções DEAL/SMART, pausar/reativar e reajustar preço — ADR-0178). Modos:
//  - Usuário (admin ou suporte full): cria a operação a partir da Central e publica { etapa: 'executar' }.
//  - Usuário, reajuste: { etapa: 'preview' } (qualquer membro) grava o rascunho; { etapa: 'confirmar' } (admin/suporte full) publica.
//  - QStash { etapa: 'executar' | 'conferir', operacao_id }: executor com continuação e conferência da saída.
// Escrita no ML só em /seller-promotions (ml.ts); claim por item garante que reentrega não escreve duas vezes.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { qstashClient, verificarAssinatura } from '../_shared/queue.ts';
import { exigirModulo, moduloHabilitadoStrict } from '../_shared/produto/modulo.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { MLApiError } from '../_shared/ml/erro-ml.ts';
import { conferir, executar, type OperacaoRow } from '../_shared/operacoes/executar.ts';
import { executarStatus, type OperacaoStatusRow } from '../_shared/operacoes/executar-status.ts';
import { MAX_ITENS, validarPedido, type ItemPedido, type LinhaCentral } from '../_shared/operacoes/validar.ts';
import { reversaoValida, validarPedidoStatus, type ItemPedidoStatus } from '../_shared/operacoes/validar-status.ts';
import {
  COLS_CENTRAL, criarSemaforoExato, dedup, depsExecutar, depsStatus, encerrarComErro, idsDaOrg, linhaCentral, urlOperacoes,
} from '../_shared/operacoes/deps.ts';
import {
  lerConexaoML, MSG_RECONECTAR, MSG_SEM_CONEXAO, respostaFalhaCriacao, SemConexaoML,
} from '../_shared/operacoes/falhas.ts';
import type { Acao, AcaoStatus } from '../_shared/operacoes/tipos.ts';
import { SemAcessoStatusML } from '../_shared/operacoes/ml-status.ts';
import { SemAcessoPromocoes } from '../_shared/promocoes/ml.ts';
import { executarReajuste, type OperacaoReajusteRow } from '../_shared/operacoes/reajuste/executar.ts';
import { montarPreview } from '../_shared/operacoes/reajuste/preview.ts';
import { etapaReajuste } from '../_shared/operacoes/reajuste/etapa.ts';
import { lerConfirmar, lerPreview, linhasDoRascunho, respostaConfirmar } from '../_shared/operacoes/reajuste/pedido.ts';
import { depsLacoReajuste, depsPreview, depsReajuste, ForaDaOrg } from '../_shared/operacoes/reajuste/deps.ts';

const EXECUCAO = { limiteMs: 90_000, lote: 20, maxItens: 100 };
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
    .select('id, org_id, acao, promocao_id, promocao_tipo, status, origem_id').eq('id', payload.operacao_id).maybeSingle();
  if (error) throw new Error(`operacoes_massa: ${error.message}`);
  if (!linha) return json({ ok: false, erro: 'operação não encontrada' });
  if (linha.status === 'concluida') return json({ ok: true, ignorada: true });

  // Reajuste: sem módulo `promocoes`; executar e conferir rodam o mesmo laço (conferindo vencido entra nos pendentes).
  if (linha.acao === 'reajustar') {
    if (linha.status !== 'executando') return json({ ok: true, ignorada: true }); // rascunho nunca executa
    const op: OperacaoReajusteRow = { id: linha.id, org_id: linha.org_id, origem_id: linha.origem_id ?? null };
    const chave = req.headers.get('upstash-message-id') ?? crypto.randomUUID();
    return json(await etapaReajuste(op, {
      conexao: () => conexaoDaOrg(admin, linha.org_id),
      banco: depsLacoReajuste(admin, op, chave),
      executar: (cx) => executarReajuste(op, depsReajuste(admin, cx, op, chave), EXECUCAO),
    }));
  }

  // Pausar/reativar: sem promoção nem módulo `promocoes`.
  if (linha.acao === 'pausar' || linha.acao === 'reativar') {
    let cx: Awaited<ReturnType<typeof conexaoDaOrg>>;
    try {
      cx = await conexaoDaOrg(admin, linha.org_id);
    } catch (e) {
      // Refresh recusado (invalid_grant) nunca se resolve sozinho: sem isto, toda reentrega dá 500 e os itens
      // ficam `pendente` para sempre, presos no índice anti-duplicidade. Erro transitório segue relançando.
      if (e instanceof MLApiError && e.oauthError === 'invalid_grant') {
        await encerrarComErro(admin, linha, MSG_RECONECTAR);
        return json({ ok: false, erro: MSG_RECONECTAR });
      }
      throw e;
    }
    if (!cx) {
      await encerrarComErro(admin, linha, MSG_SEM_CONEXAO);
      return json({ ok: false, erro: MSG_SEM_CONEXAO });
    }
    const op: OperacaoStatusRow = { id: linha.id, org_id: linha.org_id, acao: linha.acao };
    const chave = req.headers.get('upstash-message-id') ?? crypto.randomUUID();
    // Sem etapa de conferência: o PUT de status é síncrono (qualquer etapa executa).
    return json({ ok: true, ...(await executarStatus(op, depsStatus(admin, cx, op, chave), EXECUCAO)) });
  }

  // Encerrar só com ausência REAL (módulo desligado, promoção encerrada, conta não conectada): erro de leitura
  // lança → 500 → QStash reentrega. Encerrar por engano solta do índice anti-duplicidade item em saída pedida.
  if (!(await moduloHabilitadoStrict(admin, linha.org_id, 'promocoes'))) {
    await encerrarComErro(admin, linha, SEM_MODULO);
    return json({ ok: false, erro: SEM_MODULO });
  }
  const promo = await lerPromocao(admin, linha.org_id, linha.promocao_id!);
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
    id: linha.id, org_id: linha.org_id, acao: linha.acao as Acao, promocao_id: linha.promocao_id!,
    promocao_tipo: linha.promocao_tipo! as OperacaoRow['promocao_tipo'], promocao_status: promo!.status as OperacaoRow['promocao_status'],
  };
  // ponytail: sem o header (não acontece em entrega do QStash) a chave é nova — perde só o dedup da continuação;
  // a escrita no ML continua protegida pelo claim.
  const chave = req.headers.get('upstash-message-id') ?? crypto.randomUUID();
  const deps = depsExecutar(admin, cx, op, chave);
  const r = payload.etapa === 'executar' ? await executar(op, deps, EXECUCAO) : await conferir(op, deps);
  return json({ ok: true, ...r });
}

type PedidoStatus = { acao: AcaoStatus; origem_id: string | null; itens: ItemPedidoStatus[] };
type Pedido =
  | { acao: Acao; promocao_id: string; origem_id: string | null; itens: ItemPedido[] }
  | PedidoStatus;
const ehStatus = (p: Pedido): p is PedidoStatus => p.acao === 'pausar' || p.acao === 'reativar';
function lerPedido(x: unknown): Pedido | null {
  const b = x as Record<string, unknown> | null;
  if (!b || (b.origem_id != null && typeof b.origem_id !== 'string') || !Array.isArray(b.itens)) return null;
  const origem_id = (b.origem_id as string | null | undefined) ?? null;
  if (b.acao === 'pausar' || b.acao === 'reativar') {
    if (b.promocao_id != null) return null;
    const itens: ItemPedidoStatus[] = [];
    for (const i of b.itens as Record<string, unknown>[]) {
      if (!i || typeof i.ml_item_id !== 'string' || !i.ml_item_id) return null;
      if (i.titulo != null && typeof i.titulo !== 'string') return null;
      itens.push({ ml_item_id: i.ml_item_id, titulo: (i.titulo as string | null | undefined) ?? null });
    }
    return { acao: b.acao, origem_id, itens };
  }
  if ((b.acao !== 'aderir' && b.acao !== 'sair') || typeof b.promocao_id !== 'string' || !b.promocao_id) return null;
  const itens: ItemPedido[] = [];
  for (const i of b.itens as Record<string, unknown>[]) {
    if (!i || typeof i.ml_item_id !== 'string' || !i.ml_item_id) return null;
    if (i.preco != null && typeof i.preco !== 'number') return null;
    itens.push({ ml_item_id: i.ml_item_id, preco: (i.preco as number | null | undefined) ?? null, confirmado_risco: i.confirmado_risco === true });
  }
  return { acao: b.acao, promocao_id: b.promocao_id, origem_id, itens };
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
  const { orgId } = ctx;
  if (!ctx.isAdmin && ctx.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, ctx, { type: 'org', id: orgId }, 'denied');
    return json({ erro: 'Só administradores executam operações em massa.' }, 403);
  }

  let bruto: unknown = null;
  try { bruto = JSON.parse(body); } catch { /* inválido */ }
  const pedido = lerPedido(bruto);
  if (pedido && ehStatus(pedido)) return criarStatus(admin, ctx, pedido);
  if (!(await exigirModulo(admin, orgId, 'promocoes'))) return json({ erro: SEM_MODULO }, 403);
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

  return gravarEPublicar(admin, ctx, {
    acao: pedido.acao, promocao_id: pedido.promocao_id, promocao_tipo: promo.tipo,
    promocao_nome: promo.nome, origem_id: pedido.origem_id,
  }, v.itens.map((i) => ({
    promocao_id: pedido.promocao_id, ml_item_id: i.ml_item_id, titulo: i.titulo,
    preco: i.preco, semaforo: i.semaforo, confirmado_risco: i.confirmado_risco,
  })));
}

const REVERSAO_INVALIDA = 'A operação de origem não pode ser revertida por este pedido.';

/** Pausar/reativar: só anúncios da org, Reverter revalidado no servidor. Não exige o módulo de promoções. */
async function criarStatus(admin: Admin, ctx: Awaited<ReturnType<typeof requireUserOrg>>, pedido: PedidoStatus): Promise<Response> {
  const { orgId } = ctx;
  const ids = [...new Set(pedido.itens.map((i) => i.ml_item_id))];
  if (pedido.origem_id) {
    const { data: origem, error } = await admin.from('operacoes_massa').select('acao, promocao_id, status')
      .eq('org_id', orgId).eq('id', pedido.origem_id).maybeSingle();
    if (error) throw new Error(`origem: ${error.message}`);
    const aplicados = new Set<string>();
    if (origem) {
      const r = await admin.from('operacoes_massa_itens').select('ml_item_id')
        .eq('org_id', orgId).eq('operacao_id', pedido.origem_id).eq('status', 'aplicado');
      if (r.error) throw new Error(`itens da origem: ${r.error.message}`);
      for (const x of r.data ?? []) aplicados.add(String(x.ml_item_id));
    }
    if (!reversaoValida(origem, aplicados, { acao: pedido.acao, ids })) return json({ erro: REVERSAO_INVALIDA }, 400);
  }

  const { daOrg, kits } = ids.length && ids.length <= MAX_ITENS
    ? await idsDaOrg(admin, orgId, ids)
    : { daOrg: new Set<string>(), kits: new Set<string>() };
  const v = validarPedidoStatus(pedido.itens, daOrg, kits);
  if (!v.ok) return json({ erro: v.erro, ...(v.itens ? { itens: v.itens } : {}) }, 400);

  return gravarEPublicar(admin, ctx, { acao: pedido.acao, origem_id: pedido.origem_id }, v.itens.map((i) => ({
    promocao_id: null, ml_item_id: i.ml_item_id, titulo: i.titulo, semaforo: null, confirmado_risco: false,
  })));
}

/** Grava cabeçalho + itens (23505 → 409), publica a 1ª etapa e audita. Comum a promoção e status. */
async function gravarEPublicar(
  admin: Admin, ctx: Awaited<ReturnType<typeof requireUserOrg>>,
  cabecalho: Record<string, unknown>, itens: Record<string, unknown>[],
): Promise<Response> {
  const { orgId, userId } = ctx;
  const { data: op, error: eOp } = await admin.from('operacoes_massa').insert({
    org_id: orgId, ...cabecalho, criado_por: userId,
  }).select('id').single();
  if (eOp || !op) throw new Error(`criar operação: ${eOp?.message}`);
  const alvo = { id: op.id as string, org_id: orgId };

  const { error: eItens } = await admin.from('operacoes_massa_itens').insert(itens.map((i) => ({
    operacao_id: alvo.id, org_id: orgId, ...i,
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

type Ctx = Awaited<ReturnType<typeof requireUserOrg>>;
const podeExecutar = (ctx: Ctx) => ctx.isAdmin || ctx.support?.scope === 'full';
const SO_ADMIN = 'Só administradores executam operações em massa.';
const RASCUNHO_MS = 30 * 60_000;
const semAcesso = (e: unknown) => e instanceof SemAcessoStatusML || e instanceof SemAcessoPromocoes ||
  (e instanceof MLApiError && e.oauthError === 'invalid_grant');

async function autenticar(req: Request): Promise<Ctx | Response> {
  try {
    return await requireUserOrg(req, { access: 'write' });
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
}

/** Usuário: reajuste (preview/confirmar) ou criação de promoção/status (inalterada). */
function usuario(admin: Admin, req: Request, body: string): Promise<Response> {
  let bruto: Record<string, unknown> | null = null;
  try { bruto = JSON.parse(body); } catch { /* criar responde */ }
  if (bruto?.etapa === 'preview') return previewReajuste(admin, req, bruto);
  if (bruto?.etapa === 'confirmar') return confirmarReajuste(admin, req, bruto);
  return criar(admin, req, body);
}

/** Preview do reajuste (qualquer membro; Reverter só admin/suporte full). executaveis = 0 → nada gravado (C4). */
async function previewReajuste(admin: Admin, req: Request, bruto: unknown): Promise<Response> {
  const ctx = await autenticar(req);
  if (ctx instanceof Response) return ctx;
  const { orgId, userId } = ctx;
  const pedido = lerPreview(bruto);
  if (!pedido) return json({ erro: 'Pedido inválido.' }, 400);
  if (pedido.origem_id) {
    if (!podeExecutar(ctx)) {
      await auditarOperacaoSuporte(admin, ctx, { type: 'org', id: orgId }, 'denied');
      return json({ erro: SO_ADMIN }, 403);
    }
    const { data: origem, error } = await admin.from('operacoes_massa').select('acao')
      .eq('org_id', orgId).eq('id', pedido.origem_id).maybeSingle();
    if (error) throw new Error(`origem: ${error.message}`);
    if (origem?.acao !== 'reajustar') return json({ erro: REVERSAO_INVALIDA }, 400);
  }

  const velhos = await admin.from('operacoes_massa').delete().eq('org_id', orgId).eq('acao', 'reajustar')
    .eq('status', 'rascunho').lt('expira_em', new Date().toISOString());
  if (velhos.error) throw new Error(`rascunhos expirados: ${velhos.error.message}`);

  let r: Awaited<ReturnType<typeof montarPreview>>;
  try {
    const cx = await conexaoDaOrg(admin, orgId);
    if (!cx) return json({ erro: MSG_SEM_CONEXAO }, 400);
    r = await montarPreview(pedido, depsPreview(admin, cx, { reverter: !!pedido.origem_id }));
  } catch (e) {
    if (e instanceof ForaDaOrg) {
      const motivo = 'Anúncio não encontrado nesta organização';
      return json({ erro: `${motivo}.`, itens: e.ids.map((id) => ({ ml_item_id: id, motivo })) }, 400);
    }
    if (semAcesso(e)) return json({ erro: MSG_RECONECTAR }, 403);
    throw e;
  }
  if (!r.ok) return json({ erro: r.erro }, 400);
  if (r.executaveis === 0) return json({ operacao_id: null, itens: r.itens });

  const expira_em = new Date(Date.now() + RASCUNHO_MS).toISOString();
  const { data: op, error: eOp } = await admin.from('operacoes_massa').insert({
    org_id: orgId, acao: 'reajustar', status: 'rascunho', expira_em, origem_id: pedido.origem_id ?? null, criado_por: userId,
  }).select('id').single();
  if (eOp || !op) throw new Error(`criar rascunho: ${eOp?.message}`);
  const { error: eItens } = await admin.from('operacoes_massa_itens').insert(linhasDoRascunho(r.itens).map((i) => ({
    operacao_id: op.id, org_id: orgId, ...i,
  })));
  if (eItens) {
    await admin.from('operacoes_massa').delete().eq('org_id', orgId).eq('id', op.id);
    throw new Error(`itens do rascunho: ${eItens.message}`);
  }
  return json({ operacao_id: op.id, itens: r.itens, expira_em }, 201);
}

/** Confirma o rascunho (RPC transacional) e publica a execução. Repetir é seguro: 'ja_confirmada' republica (dedup). */
async function confirmarReajuste(admin: Admin, req: Request, bruto: unknown): Promise<Response> {
  const ctx = await autenticar(req);
  if (ctx instanceof Response) return ctx;
  const { orgId } = ctx;
  if (!podeExecutar(ctx)) {
    await auditarOperacaoSuporte(admin, ctx, { type: 'org', id: orgId }, 'denied');
    return json({ erro: SO_ADMIN }, 403);
  }
  const pedido = lerConfirmar(bruto);
  if (!pedido) return json({ erro: 'Pedido inválido.' }, 400);

  const { data, error } = await admin.rpc('reajuste_confirmar', {
    p_org: orgId, p_operacao: pedido.operacao_id, p_confirmacoes: pedido.confirmacoes,
  });
  if (error && !(error.code === 'P0001' && /^(ocupado|sem_produto):/.test(error.message))) {
    throw new Error(`reajuste_confirmar: ${error.message}`);
  }
  const r = respostaConfirmar(error ? error.message : String(data));
  if (!r.publicar) return json(r.corpo, r.status);

  const alvo = { type: 'operacao_massa', id: pedido.operacao_id } as const;
  try {
    await qstashClient().publishJSON({
      url: urlOperacoes(), body: { etapa: 'executar', operacao_id: pedido.operacao_id }, retries: 3,
      deduplicationId: dedup(`executar_${pedido.operacao_id}_0`),
    });
  } catch (e) {
    // Sem encerrarComErro: a operação já está `executando`; o retry recebe 'ja_confirmada' e republica.
    console.error('[operacoes-massa] publicar reajuste', { operacao_id: pedido.operacao_id, erro: e instanceof Error ? e.message : String(e) });
    await auditarOperacaoSuporte(admin, ctx, alvo, 'failed');
    return json({ erro: 'Não foi possível iniciar a execução. Tente confirmar de novo.' }, 500);
  }
  await auditarOperacaoSuporte(admin, ctx, alvo, 'succeeded');
  return json({ operacao_id: pedido.operacao_id });
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
    return await usuario(admin, req, body);
  } catch (e) {
    console.error('[operacoes-massa]', e instanceof Error ? e.message : String(e));
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
