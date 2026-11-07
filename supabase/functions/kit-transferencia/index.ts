// ADR-0197: worker QStash da saga de transferência de kit. Casca fina: liga as portas de saga.ts no
// Supabase e no ML. Um passo por invocação.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarSaga, verificarAssinatura, type KitTransferenciaJob } from '../_shared/queue.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { atualizarItemPlanoML, atualizarStatusML } from '../_shared/ml/atualizar-item.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { importarPedidosDoItem, lerOferta, listarPendentes } from '../_shared/kit-variacao/ml-oferta.ts';
import { avancarSaga, quarentenaDoEnv, type DepsSaga } from '../_shared/kit-variacao/saga.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function deps(orgId: string): DepsSaga {
  const admin = adminClient();
  let conexao: Promise<{ token: string; seller: string }> | null = null;
  // Só resolve token quando um passo lê o ML; falha lança e a saga reagenda.
  const ml = () => conexao ??= (async () => {
    const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
    if (!cx?.contaExternaId) throw new Error('org sem conexão com o Mercado Livre');
    return { token: await getValidAccessTokenConexao(cx), seller: cx.contaExternaId };
  })();

  const exigir = <T>(r: { data: T; error: { message: string } | null }, onde: string): T => {
    if (r.error) throw new Error(`${onde}: ${r.error.message}`);
    return r.data;
  };

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
        const linhas = exigir(await admin.from('kit_transferencias').update(patch)
          .eq('id', id).eq('org_id', orgId).eq('execucao_token', token).select('id'), 'gravar transferência');
        if (linhas?.length !== 1) throw new Error('execução perdeu o claim');
      },
      async salvarAlvo(id, upId, patch) {
        const linhas = exigir(await admin.from('kit_transferencia_alvos').update(patch)
          .eq('transferencia_id', id).eq('org_id', orgId).eq('up_id', upId).select('up_id'), 'gravar alvo');
        if (linhas?.length !== 1) throw new Error(`alvo ${upId} não gravado`);
      },
      async liberar(id, token) {
        const { error } = await admin.from('kit_transferencias').update({ execucao_token: null, execucao_ate: null })
          .eq('id', id).eq('execucao_token', token);
        // Sem soltar, o prazo do claim vence sozinho.
        if (error) console.warn(`kit-transferencia: liberar claim: ${error.message}`);
      },
      async politica(codigos) {
        const linhas = exigir(await admin.from('sku_politica_kit')
          .select('codigo, versao, estado, bloqueio_operador, bloqueio_moderacao, bloqueio_retirada')
          .eq('org_id', orgId).in('codigo', codigos), 'ler política') ?? [];
        return {
          versao: linhas.reduce((soma, p) => soma + p.versao, 0),
          semReativar: linhas.filter((p) => p.estado === 'guardado' || p.bloqueio_operador || p.bloqueio_moderacao
            || p.bloqueio_retirada).map((p) => p.codigo),
        };
      },
      async saldoLocal(codigo) {
        // Variação canônica: família mais recente, como kit_sku_travado.
        const linhas = exigir(await admin.from('variacoes').select('estoque, familias!inner(criado_em)')
          .eq('org_id', orgId).eq('codigo', codigo), 'ler saldo') as unknown as
          Array<{ estoque: number; familias: { criado_em: string } }>;
        if (!linhas?.length) throw new Error(`SKU ${codigo} não encontrado`);
        return linhas.reduce((a, b) => (b.familias.criado_em > a.familias.criado_em ? b : a)).estoque;
      },
      async rpc(nome, id) {
        const args = nome === 'kit_soltar_exclusao' ? { p_org: orgId, p_dono_id: id } : { p_org: orgId, p_transferencia: id };
        const data = exigir(await admin.rpc(nome, args), nome) as { ok: boolean; motivo?: string } | null;
        return data ?? { ok: true };   // kit_soltar_exclusao devolve void
      },
    },
    ml: {
      lerOferta: async (upId, esperados) => lerOferta((await ml()).token, upId, esperados),
      listarPendentes: async () => { const c = await ml(); return listarPendentes(c.token, c.seller); },
      importarPedidos: async (itemIds, desde, idsPasso1) => {
        const c = await ml();
        return importarPedidosDoItem(admin, orgId, itemIds, { token: c.token, seller: c.seller, desde, idsPasso1 });
      },
      putQuantidade: async (itemId, quantidade) =>
        atualizarItemPlanoML((await ml()).token, itemId, { available_quantity: quantidade }),
      putStatus: async (itemId, status) => atualizarStatusML((await ml()).token, itemId, status),
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
