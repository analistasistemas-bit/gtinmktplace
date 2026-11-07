// ADR-0197: worker QStash da saga de transferência de kit. Casca fina: liga as portas de saga.ts no
// Supabase e no ML. Um passo por invocação.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarSaga, verificarAssinatura, type KitTransferenciaJob } from '../_shared/queue.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { humanizarErroML, MLApiError } from '../_shared/ml/erro-ml.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { importarPedidosDoItem, lerOferta, listarPendentes } from '../_shared/kit-variacao/ml-oferta.ts';
import { avancarSaga, PRAZO_PASSO_S, quarentenaDoEnv, type DepsSaga } from '../_shared/kit-variacao/saga.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function deps(orgId: string): DepsSaga {
  const admin = adminClient();
  // Toda chamada ao ML desta invocação morre no prazo do passo, antes de o lease do claim vencer.
  const prazo = AbortSignal.timeout(PRAZO_PASSO_S * 1000);
  const f: typeof fetch = (url, init) =>
    fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, prazo]) : prazo });

  let conexao: Promise<{ token: string; seller: string }> | null = null;
  // Só resolve token quando um passo lê o ML; falha lança e a saga reagenda.
  const ml = () => conexao ??= (async () => {
    const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
    if (!cx?.contaExternaId) throw new Error('org sem conexão com o Mercado Livre');
    return { token: await getValidAccessTokenConexao(cx), seller: cx.contaExternaId };
  })();

  // PUT parcial no item. Erro HTTP carrega `status` (4xx = recusa); rede e prazo lançam sem status (incerto).
  const putItem = async (itemId: string, corpo: Record<string, unknown>) => {
    const resp = await f(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${(await ml()).token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    if (!resp.ok) throw new MLApiError(resp.status, humanizarErroML(resp.status, await resp.json().catch(() => ({}))));
  };

  const exigir = <T>(r: { data: T; error: { message: string } | null }, onde: string): T => {
    if (r.error) throw new Error(`${onde}: ${r.error.message}`);
    return r.data;
  };
  const base = (id: string, token: string) => ({ p_org: orgId, p_transferencia: id, p_token: token });

  return {
    repo: {
      async reivindicar(id, token, prazoS) {
        return exigir(await admin.rpc('kit_reivindicar_execucao',
          { p_org: orgId, p_transferencia: id, p_token: token, p_prazo_s: prazoS }), 'claim') === true;
      },
      async carregar(id) {
        const transferencia = exigir(await admin.from('kit_transferencias')
          .select('id, org_id, tipo, passo, estado, versao_politica, passo_em, alerta')
          .eq('id', id).eq('org_id', orgId).single(), 'ler transferência');
        const alvos = exigir(await admin.from('kit_transferencia_alvos').select('*')
          .eq('transferencia_id', id).eq('org_id', orgId).order('up_id'), 'ler alvos');
        return { transferencia, alvos } as Awaited<ReturnType<DepsSaga['repo']['carregar']>>;
      },
      async salvarTransferencia(id, token, patch) {
        exigir(await admin.rpc('kit_saga_salvar_transferencia', {
          ...base(id, token), p_passo: patch.passo ?? null, p_alerta: patch.alerta ?? null, p_travar: patch.travar ?? false,
        }), 'gravar transferência');
      },
      async salvarAlvo(id, token, upId, patch) {
        exigir(await admin.rpc('kit_saga_salvar_alvo', { ...base(id, token), p_up: upId, p_patch: patch }), 'gravar alvo');
      },
      async finalizar(id, token, estado, alerta) {
        exigir(await admin.rpc('kit_saga_finalizar', { ...base(id, token), p_estado: estado, p_alerta: alerta }), 'finalizar');
      },
      async ledger(id, token, op) {
        return exigir(await admin.rpc('kit_saga_ledger', { ...base(id, token), p_op: op }), `ledger ${op}`) as
          { ok: boolean; motivo?: string };
      },
      async podeReativar(id, token, codigo) {
        return exigir(await admin.rpc('kit_saga_pode_reativar', { ...base(id, token), p_codigo: codigo }), 'política') === true;
      },
      async liberar(id, token) {
        const { error } = await admin.from('kit_transferencias').update({ execucao_token: null, execucao_ate: null })
          .eq('id', id).eq('execucao_token', token);
        // Sem soltar, o prazo do claim vence sozinho.
        if (error) console.warn(`kit-transferencia: liberar claim: ${error.message}`);
      },
      async versaoPolitica(codigos) {
        const linhas = exigir(await admin.from('sku_politica_kit').select('versao')
          .eq('org_id', orgId).in('codigo', codigos), 'ler política') ?? [];
        return linhas.reduce((soma, p) => soma + p.versao, 0);
      },
      async saldoLocal(codigo) {
        // Variação canônica: família mais recente, como kit_sku_travado.
        const linhas = exigir(await admin.from('variacoes').select('estoque, familias!inner(criado_em)')
          .eq('org_id', orgId).eq('codigo', codigo), 'ler saldo') as unknown as
          Array<{ estoque: number; familias: { criado_em: string } }>;
        if (!linhas?.length) throw new Error(`SKU ${codigo} não encontrado`);
        return linhas.reduce((a, b) => (b.familias.criado_em > a.familias.criado_em ? b : a)).estoque;
      },
    },
    ml: {
      lerOferta: async (upId, esperados) => lerOferta((await ml()).token, upId, esperados, f),
      listarPendentes: async () => { const c = await ml(); return listarPendentes(c.token, c.seller, f); },
      importarPedidos: async (itemIds, desde, idsPasso1, antesDeBaixar) => {
        const c = await ml();
        return importarPedidosDoItem(admin, orgId, itemIds,
          { token: c.token, seller: c.seller, desde, idsPasso1, fetch: f, signal: prazo, antesDeBaixar });
      },
      putQuantidade: (itemId, quantidade) => putItem(itemId, { available_quantity: quantidade }),
      putStatus: (itemId, status) => putItem(itemId, { status }),
    },
    enfileirar: (id, delayS) => enfileirarSaga(id, orgId, delayS),
    alertar: async (texto) => { await notificarCategoria(admin, orgId, 'estoque', texto); },
    agora: () => new Date(),
    quarentenaS: quarentenaDoEnv(Deno.env.get('KIT_QUARENTENA_S')),
    novoToken: () => crypto.randomUUID(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });

  let job: KitTransferenciaJob;
  try {
    job = JSON.parse(body);
  } catch {
    return new Response('Body inválido', { status: 400, headers: corsHeaders });
  }
  if (!job?.transferencia_id || !job.org_id) return new Response('Body inválido', { status: 400, headers: corsHeaders });

  try {
    const r = await avancarSaga(deps(job.org_id), job.transferencia_id);
    // Ocupada: outra invocação tem o claim, ou a anterior morreu e o prazo ainda não venceu. O QStash
    // repete; se a outra estava viva, a repetição só executa um passo já idempotente.
    return json(r.acao === 'ocupada' ? 409 : 200, r);
  } catch (e) {
    console.error(`kit-transferencia ${job.transferencia_id}: ${(e as Error).message}`);
    return json(500, { erro: (e as Error).message });
  }
});
