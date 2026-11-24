// ADR-0211, Task 6.2: ensaio medido da drenagem de cancelamentos, sem dado de cliente. Fora da suíte.
// Roda `drenarCancelamentos` REAL, as três RPCs reais, `tratarPedidoCancelado` real com `depsDaFila(depsCancelamento)`.
// Só `pedido` e `envio` do ML são fixos (nenhuma chamada ao ML). Exige a migration aplicada.
//
// Pré-requisitos (pela tela, pelo Diego): três orgs, uma por cenário — o teto do lote e a reabertura são por org, então
// separar pedidos ou SKUs na mesma org NÃO isola os cenários (ressalva a do revisor, rodada 5):
//   `ENSAIO ADR-0211 A` (rodada normal), `ENSAIO ADR-0211 B` (rodada lenta), `ENSAIO ADR-0211 C` (reabertura);
//   módulo `kit_variacao` ligado na A; nenhuma com conexão ML, anúncio ou venda.
//
// Uso (raiz do repo, env de PRODUÇÃO; a chave de serviço nunca é impressa):
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//   ENSAIO_ORG_A=<uuid> ENSAIO_ORG_B=<uuid> ENSAIO_ORG_C=<uuid> \
//   deno run --node-modules-dir=none -A --env-file=.env.local scripts/ensaio-drenagem-cancelamentos.ts            # PRÉVIA
//   (mesmo comando) ... scripts/ensaio-drenagem-cancelamentos.ts --executar                                    # executa
// A prévia não escreve nada. `--executar` só depois de o Diego conferir a prévia.
// Teste sem rede do plano dos cenários: `deno test --node-modules-dir=none -A scripts/ensaio-drenagem-cancelamentos.test.ts`.
//
// Nada é apagado do ledger: SKUs, vendas e movimentos ficam nas orgs de ensaio, que não têm cliente.
import process from 'node:process';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { IoFila, PedidoDaFila } from '../supabase/functions/reconciliar-faturamento/cancelamentos.ts';
import type { PedidoML } from '../supabase/functions/_shared/faturamento/venda.ts';

export const NOMES = { A: 'ENSAIO ADR-0211 A', B: 'ENSAIO ADR-0211 B', C: 'ENSAIO ADR-0211 C' } as const;
export type Letra = keyof typeof NOMES;
const CONTA = '2110211'; // vendedor fictício: a drenagem só exige que pedido e conexão concordem
const PEDIDO_BASE = 9_000_000_000_000_000;

export interface Venda { letra: Letra; orderId: string; sku: string; envio: string; kit: boolean }
export interface Plano {
  orgs: Record<Letra, string>;
  skus: Record<Letra, string[]>;
  vendas: Venda[];
  /** Baixa nova, com OUTRA referência (outro SKU), no pedido que deve reabrir. A RPC de baixa recusa repetir a original. */
  reabertura: { orderId: string; skuNovo: string; naoReabre: string };
  lotes: Record<'A' | 'B' | 'C1' | 'C2', string>;
}

/** Plano puro dos cenários. Lança se as orgs não forem distintas ou se a reabertura repetir a referência original. */
export function planoEnsaio(orgs: Record<Letra, string>, carimbo: string): Plano {
  const ids = Object.values(orgs);
  if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('ENSAIO_ORG_A/B/C: uuid inválido');
  if (new Set(ids).size !== 3) throw new Error('ENSAIO_ORG_A/B/C têm de ser três orgs distintas (um cenário por org)');
  const sku = (l: Letra, n: number) => `ENS0211-${l}-${String(n).padStart(2, '0')}`;
  const skus = { A: range(20).map((i) => sku('A', i)), B: range(20).map((i) => sku('B', i)), C: range(3).map((i) => sku('C', i)) };
  let seq = 0;
  const venda = (letra: Letra, s: string, envio: string, kit = false): Venda =>
    ({ letra, orderId: String(PEDIDO_BASE + ++seq), sku: s, envio, kit });
  const vendas = [
    // A: 10 pré-despacho (reposto) e 10 despachados (avisado); 5 dos SKUs são participantes de kit.
    ...skus.A.map((s, i) => venda('A', s, i < 10 ? 'ready_to_ship' : 'shipped', i < 5)),
    ...skus.B.map((s) => venda('B', s, 'ready_to_ship')),
    ...skus.C.slice(0, 2).map((s) => venda('C', s, 'ready_to_ship')),
  ];
  const c = vendas.filter((v) => v.letra === 'C');
  const reabertura = { orderId: c[0].orderId, skuNovo: skus.C[2], naoReabre: c[1].orderId };
  if (reabertura.skuNovo === c[0].sku) throw new Error('reabertura tem de usar outra referência de baixa');
  const lotes = { A: `ensaio-A-${carimbo}`, B: `ensaio-B-${carimbo}`, C1: `ensaio-C1-${carimbo}`, C2: `ensaio-C2-${carimbo}` };
  return { orgs, skus, vendas, reabertura, lotes };
}

function range(n: number) { return Array.from({ length: n }, (_, i) => i + 1); }

// ─── Execução (só com import.meta.main) ──────────────────────────────────────────────────────────────────────────

const tempos: Record<string, number[]> = {};
function medir<T>(nome: string, p: PromiseLike<T>): Promise<T> {
  const t0 = performance.now();
  return Promise.resolve(p).finally(() => { (tempos[nome] ??= []).push(Math.round(performance.now() - t0)); });
}
const falhar = (m: string): never => { console.error(`ABORTADO: ${m}`); Deno.exit(1); };
async function ler<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>, oque: string): Promise<T> {
  const { data, error } = await q;
  if (error) falhar(`${oque}: ${error.message}`);
  return data as T;
}

async function previa(admin: SupabaseClient, plano: Plano) {
  const cont = async (tabela: string, org: string) => {
    const { count, error } = await admin.from(tabela).select('*', { count: 'exact', head: true }).eq('org_id', org);
    if (error) falhar(`${tabela}: ${error.message}`);
    return count ?? 0;
  };
  for (const l of ['A', 'B', 'C'] as Letra[]) {
    const org = plano.orgs[l];
    const o = await ler<{ id: string; nome: string; modulos_habilitados: string[] | null } | null>(
      admin.from('organizations').select('id, nome, modulos_habilitados').eq('id', org).maybeSingle(), 'organizations');
    if (!o) falhar(`org ${l} (${org}) não existe`);
    const n = {
      ml_vendas: await cont('ml_vendas', org), estoque_movimentos: await cont('estoque_movimentos', org),
      variacoes: await cont('variacoes', org), marketplace_connections: await cont('marketplace_connections', org),
      anuncios_externos: await cont('anuncios_externos', org),
    };
    console.log(`org ${l}: ${o!.nome} (${org})`, n);
    if (o!.nome !== NOMES[l]) falhar(`org ${l}: nome tem de ser exatamente "${NOMES[l]}"`);
    if (l === 'A' && !(o!.modulos_habilitados ?? []).includes('kit_variacao')) falhar('org A: ligar o módulo kit_variacao');
    if (n.marketplace_connections || n.anuncios_externos || n.ml_vendas) falhar(`org ${l}: tem conexão, anúncio ou venda`);
    const alheios = await ler<Array<{ codigo: string }>>(
      admin.from('variacoes').select('codigo').eq('org_id', org).not('codigo', 'like', 'ENS0211-%').limit(1), 'variacoes');
    if (alheios.length) falhar(`org ${l}: tem SKU que não é do ensaio (${alheios[0].codigo})`);
  }
  console.log('\nVai inserir (só nas três orgs acima):');
  for (const l of ['A', 'B', 'C'] as Letra[]) console.log(`  ${l}: 1 lote, 1 família, SKUs ${plano.skus[l].join(', ')} com entrada de 10 cada`);
  console.log('  A: kit rascunho `ENS0211-KIT` com os 5 primeiros SKUs como participantes (sem anúncio)');
  console.log(`  worker_rodadas (reconciliar, rodando) por org; ${plano.vendas.length} vendas em ml_vendas, pedidos ${plano.vendas[0].orderId}..${plano.vendas.at(-1)!.orderId}`);
  console.log(`  baixa real de cada venda; raw → cancelled (o trigger arma); reabertura: baixa de ${plano.reabertura.skuNovo} no pedido ${plano.reabertura.orderId}`);
}

async function retrato(admin: SupabaseClient, orgs: string[]) {
  const fora = `(${orgs.join(',')})`;
  const r: Record<string, unknown> = {};
  for (const [t, col] of [['ml_vendas', 'atualizado_em'], ['estoque_movimentos', 'criado_em']] as const) {
    const { count } = await admin.from(t).select('*', { count: 'exact', head: true }).not('org_id', 'in', fora);
    const { data } = await admin.from(t).select(col).not('org_id', 'in', fora).order(col, { ascending: false }).limit(1);
    r[t] = { linhas: count, maior: (data?.[0] as Record<string, unknown> | undefined)?.[col] ?? null };
  }
  return r;
}

async function executar(admin: SupabaseClient, plano: Plano) {
  // Import tardio: a prévia não carrega queue.ts nem as deps de produção.
  const { drenarCancelamentos, depsDaFila } = await import('../supabase/functions/reconciliar-faturamento/cancelamentos.ts');
  const { tratarPedidoCancelado } = await import('../supabase/functions/_shared/estoque/cancelamento.ts');
  const { depsCancelamento } = await import('../supabase/functions/_shared/estoque/cancelamento-deps.ts');
  const { registrarBaixaVenda } = await import('../supabase/functions/_shared/estoque/baixa.ts');
  const deps = depsDaFila(depsCancelamento);
  const antes = await retrato(admin, Object.values(plano.orgs));
  const donos: Record<string, string> = {};

  // Fixtures por org: SKUs com saldo próprio, rodada `rodando` (exigida pela RPC) e a A com kit rascunho.
  for (const l of ['A', 'B', 'C'] as Letra[]) {
    const org = plano.orgs[l];
    const p = await ler<{ id: string } | null>(admin.from('profiles').select('id').eq('org_id', org).limit(1).maybeSingle(), 'profiles');
    if (!p) falhar(`org ${l}: sem usuário em profiles`);
    const userId = donos[org] = p!.id;
    const lote = await ler<{ id: string }>(admin.from('lotes').insert({ user_id: userId, org_id: org, status: 'revisao', origem: 'manual' }).select('id').single(), 'lotes');
    const fam = await ler<{ id: string }>(admin.from('familias').insert({
      lote_id: lote.id, user_id: userId, org_id: org, codigo_pai: `ENS0211-${l}`, nome_pai: `Ensaio ADR-0211 ${l}`,
      operacao: 'CREATE', origem: 'nacional', chave_cadastro: crypto.randomUUID(),
    }).select('id').single(), 'familias');
    await ler(admin.from('variacoes').insert(plano.skus[l].map((codigo) => ({ familia_id: fam.id, user_id: userId, org_id: org, codigo, preco: 1 }))).select('id'), 'variacoes');
    for (const codigo of plano.skus[l]) {
      await ler(admin.rpc('registrar_entrada', { p_org: org, p_codigo: codigo, p_qtd: 10, p_custo: null, p_doc: 'Ensaio ADR-0211',
        p_obs: null, p_criado_por: userId, p_ref: `ensaio-adr0211:${codigo}` }), `registrar_entrada ${codigo}`);
    }
  }
  const kit = await ler<{ id: string }>(admin.from('kits_variacao').insert({
    org_id: plano.orgs.A, codigo_pai_base: 'ENS0211-A', codigo_pai_kit: 'ENS0211-KIT', pecas_por_kit: 2, preco: 1,
  }).select('id').single(), 'kits_variacao');
  await ler(admin.from('kit_variacao_skus').insert(plano.skus.A.slice(0, 5).map((codigo) => ({
    org_id: plano.orgs.A, kit_id: kit.id, codigo, tamanho: 'U', cores: ['Ensaio'], rotulo_cor: 'Ensaio',
  }))).select('id'), 'kit_variacao_skus');

  const rodada = (l: Letra, lote: string) => ler(admin.from('worker_rodadas').upsert({
    job: 'reconciliar', org_id: plano.orgs[l], ciclo: lote, estado: 'rodando', params: { ate: lote }, iniciado_em: new Date().toISOString(),
  }, { onConflict: 'job,org_id' }).select('org_id'), 'worker_rodadas');

  // Vendas sintéticas: paid → baixa real → cancelled (o trigger real arma).
  const vu = (s: number) => new Date(Date.now() + s * 1000).toISOString().replace('Z', '-00:00');
  const idVenda: Record<string, string> = {};
  for (const v of plano.vendas) {
    const org = plano.orgs[v.letra];
    const linha = await ler<{ id: string }>(admin.from('ml_vendas').insert({
      user_id: donos[org], org_id: org, order_id: Number(v.orderId), status: 'paid', raw: { id: v.orderId, status: 'paid', last_updated: vu(0) },
    }).select('id').single(), 'ml_vendas');
    idVenda[v.orderId] = linha.id;
    const b = await registrarBaixaVenda(admin, { orgId: org, canal: 'mercado_livre', orderId: v.orderId, itens: [{ codigo: v.sku, quantity: 1 }] },
      v.letra === 'A' ? { kit: { incerto: false } } : {});
    console.log(`baixa ${v.orderId}`, JSON.stringify(b).slice(0, 200));
    await ler(admin.from('ml_vendas').update({ status: 'cancelled', raw: { id: v.orderId, status: 'cancelled', last_updated: vu(1) } }).eq('id', linha.id).select('id'), 'ml_vendas cancel');
  }

  const io = (l: Letra, carencia: string, atrasoMs: number): IoFila => {
    const org = plano.orgs[l];
    const mine = plano.vendas.filter((v) => v.letra === l);
    return {
      contaExternaId: CONTA,
      async reivindicar(lote: string) {
        const rows = await ler<Array<{ id: string; order_id: number; geracao: string; versao: string | null }>>(
          medir('reivindicar', admin.rpc('reivindicar_cancelamentos', { p_org: org, p_lote: lote, p_limite: 20, p_carencia: carencia })), 'reivindicar');
        return rows.map((r) => ({ id: r.id, orderId: String(r.order_id), geracao: r.geracao, versao: r.versao }));
      },
      async ledger(ids: string[]) {
        const rows = await ler<Array<{ order_id: string; lido_em: string; codigo_ref: string | null; quantidade: number; estornada: boolean }>>(
          medir('cancelamento_baixas', admin.rpc('cancelamento_baixas', { p_org: org, p_orders: ids })), 'ledger');
        const m = new Map<string, { lidoEm: string; baixas: Array<{ codigoRef: string; quantidade: number; estornada: boolean }> }>();
        for (const r of rows) {
          const e = m.get(r.order_id) ?? { lidoEm: r.lido_em, baixas: [] };
          if (r.codigo_ref != null) e.baixas.push({ codigoRef: r.codigo_ref, quantidade: Number(r.quantidade), estornada: r.estornada });
          m.set(r.order_id, e);
        }
        return m;
      },
      async pedido(id: string) {
        if (atrasoMs) await new Promise((ok) => setTimeout(ok, atrasoMs));
        return { id, status: 'cancelled', last_updated: vu(60), seller: { id: CONTA }, shipping: { id } } as PedidoML;
      },
      envio: (sid: number | string) => Promise.resolve({ status: mine.find((x) => x.orderId === String(sid))!.envio }),
      async aindaPendente(o: { id: string; geracao: string }) {
        const r = await ler<{ id: string } | null>(admin.from('ml_vendas').select('id').eq('org_id', org).eq('id', o.id)
          .eq('cancelamento_geracao', o.geracao).is('cancelamento_concluido_em', null).maybeSingle(), 'aindaPendente');
        return !!r;
      },
      kitLigado: () => Promise.resolve(l === 'A'),
      tratar: (p: PedidoDaFila) => tratarPedidoCancelado(admin, deps, { ...p, orgId: org, userId: donos[org], canal: 'mercado_livre' }),
      async registrar(itens) {
        await ler(medir('registrar', admin.rpc('registrar_cancelamentos_tratados', { p_org: org, p_itens: itens })), 'registrar');
      },
      agora: () => Date.now(),
    };
  };
  const conferirIds = (l: Letra, ids: string[]) => {
    const esperados = plano.vendas.filter((v) => v.letra === l).map((v) => v.orderId).sort();
    if (JSON.stringify([...ids].sort()) !== JSON.stringify(esperados)) falhar(`org ${l}: reivindicados ≠ criados (${ids.length})`);
  };
  const comConferencia = (l: Letra, base: IoFila): IoFila => ({
    ...base,
    async reivindicar(lote: string) { const r = await base.reivindicar(lote); conferirIds(l, r.map((o) => o.orderId)); return r; },
  });

  // A: rodada normal, medida.
  await rodada('A', plano.lotes.A);
  const cpu0 = process.cpuUsage();
  let t0 = performance.now();
  const rA = await drenarCancelamentos(comConferencia('A', io('A', '0 seconds', 0)), plano.lotes.A);
  const msA = Math.round(performance.now() - t0);
  const cpuA = process.cpuUsage(cpu0);
  // B: rodada lenta (pedido com 15 s de atraso) → tudo pendente por `ml: tempo esgotado`, em menos de 60 s.
  await rodada('B', plano.lotes.B);
  t0 = performance.now();
  const rB = await drenarCancelamentos(comConferencia('B', io('B', '0 seconds', 15_000)), plano.lotes.B);
  const msB = Math.round(performance.now() - t0);
  // C: duas reposições; baixa nova com OUTRA referência num dos pedidos; só ele reabre.
  await rodada('C', plano.lotes.C1);
  const rC = await drenarCancelamentos(comConferencia('C', io('C', '0 seconds', 0)), plano.lotes.C1);
  await registrarBaixaVenda(admin, { orgId: plano.orgs.C, canal: 'mercado_livre', orderId: plano.reabertura.orderId,
    itens: [{ codigo: plano.reabertura.skuNovo, quantity: 1 }] });
  await rodada('C', plano.lotes.C2);
  await ler(admin.rpc('reivindicar_cancelamentos', { p_org: plano.orgs.C, p_lote: plano.lotes.C2, p_limite: 20, p_carencia: '1 hour' }), 'reivindicar C2');

  // As rodadas de ensaio não ficam `rodando` (nenhuma conexão as dispara, mas não fica estado aberto).
  for (const org of Object.values(plano.orgs)) {
    await ler(admin.from('worker_rodadas').update({ estado: 'ok' }).eq('job', 'reconciliar').eq('org_id', org).select('org_id'), 'worker_rodadas fim');
  }

  // Conferências.
  const estado = (l: Letra) => ler<Array<{ order_id: number; cancelamento_lote: string | null; cancelamento_desfecho: string | null; cancelamento_concluido_em: string | null }>>(
    admin.from('ml_vendas').select('order_id, cancelamento_lote, cancelamento_desfecho, cancelamento_concluido_em').eq('org_id', plano.orgs[l]), `estado ${l}`);
  const saldo = (l: Letra) => ler<Array<{ codigo: string; estoque: number }>>(admin.from('variacoes').select('codigo, estoque').eq('org_id', plano.orgs[l]), `saldo ${l}`);
  const [eA, eB, eC, sA] = [await estado('A'), await estado('B'), await estado('C'), await saldo('A')];
  const pend = await ler<unknown[]>(admin.from('worker_pendencias').select('order_id').in('org_id', Object.values(plano.orgs)), 'worker_pendencias');
  const ok = (c: boolean, m: string) => console.log(`${c ? 'OK  ' : 'FALHOU'} ${m}`);
  const desf = (e: typeof eA, d: string) => e.filter((x) => x.cancelamento_desfecho === d && x.cancelamento_concluido_em).length;
  const saldoDe = (codigo: string) => sA.find((s) => s.codigo === codigo)?.estoque;
  const vA = plano.vendas.filter((v) => v.letra === 'A');
  ok(desf(eA, 'reposto') === 10 && vA.slice(0, 10).every((v) => saldoDe(v.sku) === 10), 'A: 10 reposto com saldo de volta a 10');
  ok(desf(eA, 'avisado') === 10 && vA.slice(10).every((v) => saldoDe(v.sku) === 9), 'A: 10 avisado com saldo em 9');
  ok(eA.filter((x) => x.cancelamento_lote === plano.lotes.A).length === 20, 'A: 20 linhas com o lote');
  ok(rB.concluidos === 0 && rB.pendentes === 20 && msB < 60_000 && eB.every((x) => x.cancelamento_desfecho === 'ml: tempo esgotado'),
    `B: 20 pendentes por tempo esgotado em ${msB} ms`);
  const c1 = eC.find((x) => String(x.order_id) === plano.reabertura.orderId);
  const c2 = eC.find((x) => String(x.order_id) === plano.reabertura.naoReabre);
  ok(rC.concluidos === 2 && c1?.cancelamento_desfecho === 'reaberto: baixa depois da conclusão' && !c1.cancelamento_concluido_em
    && c2?.cancelamento_desfecho === 'reposto' && !!c2.cancelamento_concluido_em, 'C: só o pedido com baixa nova reabriu');
  ok(pend.length === 0, 'nenhuma linha das orgs de ensaio em worker_pendencias');
  const cpuMs = Math.round((cpuA.user + cpuA.system) / 1000);
  console.log('\nMedição (rodada A):', { resultado: rA, ms: msA, cpuMs, rpcMs: tempos, aceite: { cpu: cpuMs < 500, total: msA < 30_000,
    reivindicar: Math.max(...(tempos.reivindicar ?? [0])) < 200 } });
  console.log('Outras orgs antes/depois (diferença só por atividade normal):', { antes, depois: await retrato(admin, Object.values(plano.orgs)) });
}

if (import.meta.main) {
  const env = (k: string) => Deno.env.get(k) ?? falhar(`${k} ausente`);
  const plano = planoEnsaio({ A: env('ENSAIO_ORG_A'), B: env('ENSAIO_ORG_B'), C: env('ENSAIO_ORG_C') },
    new Date().toISOString().slice(0, 19));
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  await previa(admin, plano);
  if (!Deno.args.includes('--executar')) {
    console.log('\nPRÉVIA: nada foi escrito. Conferir e rodar de novo com --executar.');
  } else {
    await executar(admin, plano);
  }
}
