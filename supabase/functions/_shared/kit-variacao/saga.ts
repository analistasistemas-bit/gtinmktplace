// ADR-0197: saga que move peças entre anúncios ML só com eles pausados (spec "Escrita de estoque com
// anúncio pausado"). Um passo por invocação do worker `kit-transferencia`; o que vale entre invocações
// é só o que ficou gravado em `kit_transferencias` e `kit_transferencia_alvos`.
//
// Regras que não podem quebrar:
// - Resultado incerto nunca reenvia PUT. Só a recusa 4xx (gravada) permite repetir, até 5 vezes.
// - Nada aumenta oferta antes de todas as origens confirmadas por leitura (invariante 3).
// - Todo PUT é precedido por releitura: identidade, um local só, pausa vigente, quantidade igual à do cálculo.
// - Toda gravação passa por RPC que exige o token e o prazo da execução e a posse da exclusão; e a
//   execução para sozinha antes do prazo, para não fazer efeito remoto depois que outra pegou o claim.
// - A saga só reativa o que ela pausou, nunca item moderado, e só com a política autorizando na hora.
// - Travada mantém a exclusão: o UP segue ocupado até o operador resolver.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { ResultadoBaixaVenda } from '../estoque/baixa.ts';
import { parseStatusML } from '../ml/status.ts';
import { calcularReserva, idsDoItem, pagosDesde, type PedidoPago, type PedidoPendente } from './conciliacao.ts';
import type { OfertaUP } from './ml-oferta.ts';

export type PassoSaga =
  | 'pausar' | 'aguardar' | 'conciliar' | 'calcular' | 'reduzir' | 'confirmar_reducao'
  | 'aumentar' | 'confirmar_aumento' | 'reativar' | 'fim';

export interface TransferenciaSaga {
  id: string;
  org_id: string;
  tipo: string;
  passo: PassoSaga;
  estado: 'ativa' | 'concluida' | 'travada' | 'abortada';
  versao_politica: number;
  passo_em: string;
  alerta: string | null;
}

export interface AlvoSaga {
  up_id: string;
  codigo: string;
  papel: 'origem' | 'destino';
  /** Peças (ou kits) que saem (< 0) ou chegam (> 0), calculado pela RPC de criação. */
  delta: number;
  /** Itens locais do UP (item e cópia de catálogo): os `esperados` de `lerOferta`. */
  item_ids: string[];
  qtd_passo1: number | null;
  passo1_em: string | null;
  ids_passo1: string[] | null;
  valor_anterior: number | null;
  valor_alvo: number | null;
  pausado_pela_saga: string[];
  intencao_escrita_em: string | null;
  recusa_definitiva_em: string | null;
  escrita_em: string | null;
  confirmada_em: string | null;
  /** Item aberto que recebe o PUT de quantidade; nunca muda numa tentativa incerta. */
  item_escrita: string | null;
  /** Recusas 4xx recebidas. */
  recusas: number;
  /** Itens com obrigação de conferir ou repausar depois de um PUT `active`; finalizar recusa enquanto houver. */
  repausar: string[];
}

export interface ResultadoImportacao {
  pagos: PedidoPago[];
  naoPagos: PedidoPendente[];
  falhas: string[];
  baixas: Array<{ orderId: string; resultado: Pick<ResultadoBaixaVenda, 'vendaAcimaSaldo' | 'desyncMl'> }>;
}

/** Portas estreitas: o worker liga no Supabase e no ML; o teste, em memória. */
export interface DepsSaga {
  repo: {
    /** Claim atômico com prazo, só em transferência `ativa`. */
    reivindicar(id: string, token: string, prazoS: number): Promise<boolean>;
    carregar(id: string): Promise<{ transferencia: TransferenciaSaga; alvos: AlvoSaga[] }>;
    // As cinco abaixo validam token, prazo, estado `ativa` e exclusão no banco, e lançam se não valer.
    salvarTransferencia(id: string, token: string, patch: { passo?: PassoSaga; alerta?: string; travar?: boolean }): Promise<void>;
    salvarAlvo(id: string, token: string, upId: string, patch: Partial<AlvoSaga>): Promise<void>;
    /** Estado final e exclusões numa transação. */
    finalizar(id: string, token: string, estado: 'concluida' | 'abortada', alerta: string | null): Promise<void>;
    ledger(id: string, token: string, op: 'reservar' | 'creditar' | 'cancelar'): Promise<{ ok: boolean; motivo?: string }>;
    /** Política dos alvos travada, versão igual à da criação e SKU sem bloqueio. */
    podeReativar(id: string, token: string, codigo: string): Promise<boolean>;
    liberar(id: string, token: string): Promise<void>;
    /** Soma das versões de `sku_politica_kit` dos códigos, a mesma da criação. */
    versaoPolitica(codigos: string[]): Promise<number>;
    /** Saldo da variação canônica do código. */
    saldoLocal(codigo: string): Promise<number>;
  };
  ml: {
    lerOferta(upId: string, esperados: string[]): Promise<OfertaUP>;
    listarPendentes(): Promise<PedidoPendente[]>;
    /** `antesDeBaixar` roda logo antes de cada baixa e lança se o prazo venceu. */
    importarPedidos(itemIds: string[], desde: string, idsPasso1: string[], antesDeBaixar: () => void): Promise<ResultadoImportacao>;
    putQuantidade(itemId: string, quantidade: number): Promise<void>;
    putStatus(itemId: string, status: 'paused' | 'active'): Promise<void>;
  };
  enfileirar(id: string, delayS: number): Promise<void>;
  alertar(texto: string): Promise<void>;
  agora(): Date;
  quarentenaS: number;
  novoToken(): string;
}

export interface ResultadoPasso {
  passo: PassoSaga | null;
  acao: 'ocupada' | 'avancou' | 'reagendada' | 'travada' | 'abortada' | 'concluida';
  motivo?: string;
}

/** Lease do claim no banco. */
export const PRAZO_EXECUCAO_S = 180;
/** Prazo da invocação, menor que o lease: passado dele, nenhum efeito novo. O worker aborta as chamadas ML aqui. */
export const PRAZO_PASSO_S = 120;
/** Retentativa de passo bloqueado (dúvida, recusa 4xx, leitura que falhou). */
export const REAGENDAR_S = 60;
/** Na 5ª recusa 4xx do mesmo alvo a saga trava. */
export const MAX_RECUSAS = 5;
/** Leitura de confirmação logo depois da escrita. */
const CONFIRMAR_APOS_S = 5;
/** Varredura de pedidos criados perto do passo 1; os anteriores vêm por `ids_passo1` (Task 3). */
const JANELA_PEDIDOS_MS = 60 * 60_000;
/** `date_closed` chega até 39 s depois do pagamento (medido 07/11): margem conservadora. */
const MARGEM_PAGOS_MS = 2 * 60_000;

export function quarentenaDoEnv(valor: string | undefined): number {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : 300;
}

interface Ctx {
  deps: DepsSaga;
  t: TransferenciaSaga;
  alvos: AlvoSaga[];
  token: string;
  /** Instante (ms) depois do qual a invocação não faz mais efeito. */
  limite: number;
}

const iso = (ctx: Ctx, deslocMs = 0) => new Date(ctx.deps.agora().getTime() + deslocMs).toISOString();
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Antes de todo efeito (gravação, PUT, ledger, fila). */
function vivo(ctx: Ctx): void {
  if (ctx.deps.agora().getTime() > ctx.limite) throw new Error('prazo da execução vencido: nenhum efeito novo');
}

// Efeitos: todos passam por `vivo` e pelas RPCs que validam token, prazo e exclusão.
async function salvarAlvo(ctx: Ctx, alvo: AlvoSaga, patch: Partial<AlvoSaga>): Promise<void> {
  vivo(ctx);
  await ctx.deps.repo.salvarAlvo(ctx.t.id, ctx.token, alvo.up_id, patch);
  Object.assign(alvo, patch);
}
async function salvarTransferencia(ctx: Ctx, patch: { passo?: PassoSaga; alerta?: string; travar?: boolean }): Promise<void> {
  vivo(ctx);
  await ctx.deps.repo.salvarTransferencia(ctx.t.id, ctx.token, patch);
}
async function ledger(ctx: Ctx, op: 'reservar' | 'creditar' | 'cancelar') {
  vivo(ctx);
  return await ctx.deps.repo.ledger(ctx.t.id, ctx.token, op);
}
async function finalizar(ctx: Ctx, estado: 'concluida' | 'abortada', alerta: string | null): Promise<void> {
  vivo(ctx);
  await ctx.deps.repo.finalizar(ctx.t.id, ctx.token, estado, alerta);
}
async function putStatus(ctx: Ctx, itemId: string, status: 'paused' | 'active'): Promise<void> {
  vivo(ctx);
  await ctx.deps.ml.putStatus(itemId, status);
}
async function podeReativar(ctx: Ctx, codigo: string): Promise<boolean> {
  vivo(ctx);
  return await ctx.deps.repo.podeReativar(ctx.t.id, ctx.token, codigo);
}

/** Só a resposta 4xx prova que o ML não aplicou. 408 é timeout: incerto. */
function recusaDefinitiva(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408;
}

type ItemOferta = OfertaUP['itens'][number];
const encerrado = (i: ItemOferta) => i.status === 'closed';
const pausadoPeloVendedor = (i: ItemOferta) => i.subStatus.includes('paused_by_seller');
function moderado(i: ItemOferta): boolean {
  const s = parseStatusML({ id: i.id, status: i.status, sub_status: i.subStatus }).status;
  return s === 'moderado' || s === 'inativo';
}

/** Motivo para travar, ou null. `exigirPausa` vale depois do passo `pausar`. */
function problemaDaOferta(alvo: AlvoSaga, o: OfertaUP, exigirPausa: boolean): string | null {
  if (o.upId !== alvo.up_id) return `${alvo.codigo}: leitura de outro UP (${o.upId})`;
  if (!o.somenteSellingAddress) return `${alvo.codigo}: UP ${alvo.up_id} com estoque fora do selling_address`;
  const abertos = o.itens.filter((i) => !encerrado(i));
  if (abertos.length === 0) return `${alvo.codigo}: UP ${alvo.up_id} sem item aberto`;
  const mod = abertos.find(moderado);
  if (mod) return `${alvo.codigo}: item ${mod.id} moderado (${mod.status} ${mod.subStatus.join(',')})`;
  const solto = exigirPausa && abertos.find((i) => !pausadoPeloVendedor(i));
  if (solto) return `${alvo.codigo}: item ${solto.id} perdeu a pausa durante a transferência`;
  return null;
}

/** Alerta nunca derruba o passo: o registro durável é a coluna `alerta`, e um erro aqui reagendaria
 * por cima de travada ou abortada, ou perderia o alerta de uma baixa já aplicada. */
async function alertar(ctx: Ctx, texto: string): Promise<void> {
  try {
    await ctx.deps.alertar(texto);
  } catch (e) {
    console.error(`kit-transferencia ${ctx.t.id}: alerta não enviado: ${mensagem(e)}: ${texto}`);
  }
}

async function mudar(ctx: Ctx, passo: PassoSaga, delayS: number, alerta?: string): Promise<void> {
  await salvarTransferencia(ctx, { passo, alerta });
  vivo(ctx);
  await ctx.deps.enfileirar(ctx.t.id, delayS);
}

async function avancar(ctx: Ctx, passo: PassoSaga, delayS = 0): Promise<ResultadoPasso> {
  await mudar(ctx, passo, delayS);
  return { passo, acao: 'avancou' };
}

/** `avisar`: manda alerta só quando o motivo é novo, para bloqueio longo não repetir a cada minuto. */
async function reagendar(ctx: Ctx, motivo: string, delayS = REAGENDAR_S, avisar = false): Promise<ResultadoPasso> {
  await mudar(ctx, ctx.t.passo, delayS, motivo);
  if (avisar && ctx.t.alerta !== motivo) await alertar(ctx, `Transferência de kit bloqueada: ${motivo}.`);
  return { passo: ctx.t.passo, acao: 'reagendada', motivo };
}

/** Sem reenvio e sem soltar a exclusão: a peça fica sem oferta até o operador resolver. */
async function travar(ctx: Ctx, motivo: string): Promise<ResultadoPasso> {
  await salvarTransferencia(ctx, { travar: true, alerta: motivo });
  await alertar(ctx, `Transferência de kit travada no passo ${ctx.t.passo}: ${motivo}. O anúncio fica pausado até alguém resolver.`);
  return { passo: ctx.t.passo, acao: 'travada', motivo };
}

/** Política mudou antes da reserva: devolve a peça, se uma invocação anterior chegou a reservar, e não reativa. */
async function abortarSemReativar(ctx: Ctx, motivo: string): Promise<ResultadoPasso> {
  const r = await ledger(ctx, 'cancelar');
  if (!r.ok) throw new Error(`cancelar: ${r.motivo}`);
  await finalizar(ctx, 'abortada', motivo);
  await alertar(ctx, `Transferência de kit abortada: ${motivo}. Nada foi reativado.`);
  return { passo: 'fim', acao: 'abortada', motivo };
}

async function politicaMudou(ctx: Ctx): Promise<boolean> {
  return (await ctx.deps.repo.versaoPolitica(ctx.alvos.map((a) => a.codigo))) !== ctx.t.versao_politica;
}

const MOTIVO_POLITICA = 'a política de um SKU mudou durante a transferência';

async function pausar(ctx: Ctx): Promise<ResultadoPasso> {
  if (await politicaMudou(ctx)) return abortarSemReativar(ctx, MOTIVO_POLITICA);
  const ofertas: OfertaUP[] = [];
  let pausou = false;
  for (const alvo of ctx.alvos) {
    const oferta = await ctx.deps.ml.lerOferta(alvo.up_id, alvo.item_ids);
    const problema = problemaDaOferta(alvo, oferta, false);
    if (problema) return travar(ctx, problema);
    // Sem `paused_by_seller` conta como ativo: `out_of_stock` sozinho religa quando o saldo sobe.
    const soltos = oferta.itens.filter((i) => !encerrado(i) && !pausadoPeloVendedor(i)).map((i) => i.id);
    if (soltos.length > 0) {
      // Grava antes do PUT: depois dele, o item lido como pausado pareceria pausa manual e nunca voltaria.
      const novos = soltos.filter((id) => !alvo.pausado_pela_saga.includes(id));
      if (novos.length > 0) await salvarAlvo(ctx, alvo, { pausado_pela_saga: [...alvo.pausado_pela_saga, ...novos] });
      for (const id of soltos) await putStatus(ctx, id, 'paused');
      pausou = true;
    }
    ofertas.push(oferta);
  }
  // A pausa só vale confirmada por leitura: a próxima invocação relê.
  if (pausou) return reagendar(ctx, 'confirmando a pausa', CONFIRMAR_APOS_S);

  // Passo 1 da conciliação: sai da leitura que confirmou a pausa. Sem os pendentes não há cobertura.
  const pendentes = await ctx.deps.ml.listarPendentes();
  const agora = iso(ctx);
  for (const [i, alvo] of ctx.alvos.entries()) {
    const oferta = ofertas[i];
    await salvarAlvo(ctx, alvo, {
      qtd_passo1: oferta.quantidade,
      passo1_em: agora,
      ids_passo1: idsDoItem(oferta.itens.map((x) => x.id), pendentes),
    });
  }
  return avancar(ctx, 'aguardar', ctx.deps.quarentenaS);
}

function aguardar(ctx: Ctx): Promise<ResultadoPasso> {
  // Reentrega antecipada não fura a quarentena: conta do último passo 1 gravado.
  const inicio = Math.max(...ctx.alvos.map((a) => Date.parse(a.passo1_em ?? '')));
  if (Number.isNaN(inicio)) throw new Error('aguardar sem passo1_em');
  const resta = Math.ceil((inicio + ctx.deps.quarentenaS * 1000 - ctx.deps.agora().getTime()) / 1000);
  if (resta > 0) return reagendar(ctx, 'quarentena', resta);
  return avancar(ctx, 'conciliar');
}

async function conciliar(ctx: Ctx): Promise<ResultadoPasso> {
  const pendentes = await ctx.deps.ml.listarPendentes();
  for (const alvo of ctx.alvos) {
    const oferta = await ctx.deps.ml.lerOferta(alvo.up_id, alvo.item_ids);
    const problema = problemaDaOferta(alvo, oferta, true);
    if (problema) return travar(ctx, problema);

    const passo1 = Date.parse(alvo.passo1_em ?? '');
    if (Number.isNaN(passo1) || !alvo.ids_passo1) throw new Error(`${alvo.codigo}: sem passo 1 gravado`);
    const itemIds = oferta.itens.map((i) => i.id);
    // A importação baixa estoque: o prazo é conferido antes de cada baixa, não só na entrada.
    const imp = await ctx.deps.ml.importarPedidos(
      itemIds, new Date(passo1 - JANELA_PEDIDOS_MS).toISOString(), alvo.ids_passo1, () => vivo(ctx));
    // Depois da importação o sync-venda vê a referência aplicada e não alerta mais: alerta aqui.
    for (const { orderId, resultado } of imp.baixas) {
      for (const v of resultado.vendaAcimaSaldo) {
        await alertar(ctx, `Kit: venda acima do saldo em ${v.codigo} (pedido ${orderId}): pedia ${v.pedido}, havia ${v.anterior}.`);
      }
      for (const v of resultado.desyncMl) {
        await alertar(ctx, `Kit: ML vendeu ${v.codigo} com o PubliAI em zero (pedido ${orderId}).`);
      }
    }
    if (imp.falhas.length > 0) return reagendar(ctx, `pedidos sem baixa: ${imp.falhas.join('; ')}`, REAGENDAR_S, true);

    const reserva = calcularReserva({
      itemIds,
      pendentes: [...pendentes, ...imp.naoPagos],
      pagosRecentes: pagosDesde(imp.pagos, new Date(passo1 - MARGEM_PAGOS_MS).toISOString()),
      idsPasso1: alvo.ids_passo1,
      qtdPasso1: alvo.qtd_passo1,
      qtdAgora: oferta.quantidade,
    });
    if (reserva.duvida) return reagendar(ctx, `${alvo.codigo}: conta de pedidos incerta`);
    // Pedido em aberto ainda pode baixar depois do cálculo e o alvo congelado ofereceria a peça de novo.
    // ponytail: espera o pedido sair da lista em vez de reservá-lo no alvo; um Pix vence em 15 min.
    if (reserva.reservado > 0) {
      return reagendar(ctx, `${alvo.codigo}: ${reserva.reservado} peça(s) comprometida(s) com pedido em aberto`);
    }
    // Com pedidos conciliados, local e ML têm de bater. Diferença sem explicação nunca vira escrita.
    const local = await ctx.deps.repo.saldoLocal(alvo.codigo);
    if (local !== oferta.quantidade) {
      return reagendar(ctx, `${alvo.codigo}: saldo local ${local}, ML ${oferta.quantidade}; diferença sem explicação`, REAGENDAR_S, true);
    }
  }
  return avancar(ctx, 'calcular');
}

async function calcular(ctx: Ctx): Promise<ResultadoPasso> {
  const pendentes = ctx.alvos.filter((a) => a.valor_alvo === null);
  if (pendentes.length === 0) return avancar(ctx, 'reduzir');

  // Versão conferida antes de pausar e de reservar: depois da reserva a peça termina o caminho.
  if (await politicaMudou(ctx)) return abortarSemReativar(ctx, MOTIVO_POLITICA);
  const r = await ledger(ctx, 'reservar');
  if (!r.ok) {
    await mudar(ctx, 'reativar', 0, `reserva recusada: ${r.motivo}`);
    return { passo: 'reativar', acao: 'avancou', motivo: r.motivo };
  }

  // Valor final gravado uma vez: na origem, o saldo local já sem a reserva; no destino, o local mais o que chega.
  for (const alvo of pendentes) {
    const oferta = await ctx.deps.ml.lerOferta(alvo.up_id, alvo.item_ids);
    const problema = problemaDaOferta(alvo, oferta, true);
    if (problema) return travar(ctx, problema);
    const local = await ctx.deps.repo.saldoLocal(alvo.codigo);
    const valorAlvo = alvo.papel === 'destino' ? local + alvo.delta : local;
    if (valorAlvo < 0) return travar(ctx, `${alvo.codigo}: valor final negativo (${valorAlvo})`);
    await salvarAlvo(ctx, alvo, { valor_anterior: oferta.quantidade, valor_alvo: valorAlvo });
  }
  return avancar(ctx, 'reduzir');
}

/** `reduzir` e `aumentar`. Intenção gravada antes do PUT; com intenção e sem recusa, nunca reenvia. */
async function escrever(ctx: Ctx, papel: AlvoSaga['papel'], proximo: PassoSaga): Promise<ResultadoPasso> {
  if (papel === 'destino') {
    const solta = ctx.alvos.find((a) => a.papel === 'origem' && !a.confirmada_em);
    if (solta) return travar(ctx, `${solta.codigo}: origem não confirmada antes do aumento`);
  }
  const recusas: string[] = [];
  for (const alvo of ctx.alvos.filter((a) => a.papel === papel)) {
    if (alvo.confirmada_em || alvo.valor_alvo === null || alvo.valor_alvo === alvo.valor_anterior) continue;
    if (alvo.intencao_escrita_em && !alvo.recusa_definitiva_em) continue;

    // A pausa e a quantidade valem para esta escrita, não para a do cálculo.
    const oferta = await ctx.deps.ml.lerOferta(alvo.up_id, alvo.item_ids);
    const problema = problemaDaOferta(alvo, oferta, true);
    if (problema) return travar(ctx, problema);
    if (oferta.quantidade !== alvo.valor_anterior) {
      return travar(ctx, `${alvo.codigo}: ML foi de ${alvo.valor_anterior} para ${oferta.quantidade} antes da escrita`);
    }
    // Só chega aqui sem tentativa incerta: trocar o item é seguro. Item local primeiro, na ordem gravada.
    const abertos = oferta.itens.filter((i) => !encerrado(i)).map((i) => i.id);
    const item = abertos.includes(alvo.item_escrita ?? '') ? alvo.item_escrita!
      : alvo.item_ids.find((id) => abertos.includes(id)) ?? abertos[0];

    // Um update só: com dois, uma queda entre eles deixaria a recusa velha valendo e reenviaria. É também
    // a última checagem de token, prazo e exclusão antes do efeito remoto.
    await salvarAlvo(ctx, alvo, { intencao_escrita_em: iso(ctx), recusa_definitiva_em: null, item_escrita: item });
    try {
      vivo(ctx);
      await ctx.deps.ml.putQuantidade(item, alvo.valor_alvo);
    } catch (e) {
      if (!recusaDefinitiva(e)) continue;   // incerto: a confirmação decide pela leitura
      const n = alvo.recusas + 1;
      await salvarAlvo(ctx, alvo, { recusa_definitiva_em: iso(ctx), recusas: n });
      if (n >= MAX_RECUSAS) return travar(ctx, `${alvo.codigo}: ML recusou a quantidade ${n} vezes: ${mensagem(e)}`);
      recusas.push(`${alvo.codigo}: ${mensagem(e)}`);
      continue;
    }
    await salvarAlvo(ctx, alvo, { escrita_em: iso(ctx) });
  }
  if (recusas.length > 0) return reagendar(ctx, `ML recusou a quantidade: ${recusas.join('; ')}`);
  return avancar(ctx, proximo, CONFIRMAR_APOS_S);
}

/** Leitura igual ao valor gravado conclui. Outro número, inclusive o anterior, trava (spec, passo 6). */
async function confirmar(ctx: Ctx, papel: AlvoSaga['papel'], proximo: PassoSaga): Promise<ResultadoPasso> {
  for (const alvo of ctx.alvos.filter((a) => a.papel === papel && !a.confirmada_em)) {
    const oferta = await ctx.deps.ml.lerOferta(alvo.up_id, alvo.item_ids);
    const problema = problemaDaOferta(alvo, oferta, true);
    if (problema) return travar(ctx, problema);
    if (oferta.quantidade !== alvo.valor_alvo) {
      return travar(ctx, `${alvo.codigo}: ML com ${oferta.quantidade}, esperado ${alvo.valor_alvo}, anterior ${alvo.valor_anterior}`);
    }
    await salvarAlvo(ctx, alvo, { confirmada_em: iso(ctx) });
  }
  if (papel === 'destino') {
    const r = await ledger(ctx, 'creditar');
    if (!r.ok) return travar(ctx, `crédito recusado: ${r.motivo}`);
  }
  return avancar(ctx, proximo);
}

/** Repausa; a falha vira alerta específico e reagenda, com a obrigação já gravada. */
async function repausar(ctx: Ctx, itemId: string): Promise<void> {
  try {
    await putStatus(ctx, itemId, 'paused');
  } catch (e) {
    await alertar(ctx, `Transferência de kit: repausa de ${itemId} falhou (${mensagem(e)}). O item pode estar ativo contra a política; nova tentativa em ${REAGENDAR_S} s.`);
    throw e;
  }
}

async function reativar(ctx: Ctx): Promise<ResultadoPasso> {
  // Chega aqui concluída (todos confirmados) ou abortada antes da reserva.
  const estado = ctx.alvos.every((a) => a.confirmada_em) ? 'concluida' : 'abortada';
  const seguem: string[] = [];
  let repausou = false;
  const semObrigacao = (alvo: AlvoSaga, id: string) => salvarAlvo(ctx, alvo, { repausar: alvo.repausar.filter((x) => x !== id) });

  for (const alvo of ctx.alvos) {
    if (alvo.pausado_pela_saga.length === 0 && alvo.repausar.length === 0) continue;
    const oferta = await ctx.deps.ml.lerOferta(alvo.up_id, alvo.item_ids);
    for (const item of oferta.itens) {
      const pendente = alvo.repausar.includes(item.id);
      if (!alvo.pausado_pela_saga.includes(item.id) && !pendente) continue;
      // Moderação nunca é desfeita, e item encerrado ou moderado não vende: nada a repausar.
      if (encerrado(item) || moderado(item)) {
        if (pendente) await semObrigacao(alvo, item.id);
        continue;
      }
      if (pausadoPeloVendedor(item)) {
        if (pendente) await semObrigacao(alvo, item.id);   // repausa confirmada pela leitura
        if (!(await podeReativar(ctx, alvo.codigo))) {
          seguem.push(item.id);
          continue;
        }
        // Obrigação gravada antes do PUT: resposta incerta ou queda daqui em diante é retomada.
        await salvarAlvo(ctx, alvo, { repausar: [...alvo.repausar, item.id] });
        await putStatus(ctx, item.id, 'active');
      } else if (!pendente) {
        continue;   // ativo e sem obrigação: não foi a saga que deixou assim agora
      }
      // Política relida depois do PUT (ou na retomada de um PUT incerto): mudou, a pausa volta.
      if (await podeReativar(ctx, alvo.codigo)) {
        await semObrigacao(alvo, item.id);
      } else {
        seguem.push(item.id);
        await repausar(ctx, item.id);
        repausou = true;
      }
    }
  }
  // A repausa só vale confirmada pela leitura; até lá, finalizar recusa.
  if (repausou) return reagendar(ctx, 'confirmando a repausa', CONFIRMAR_APOS_S);

  let alerta = ctx.t.alerta;
  if (seguem.length > 0) {
    alerta = `política não autoriza reativar: ${seguem.join(', ')} seguem pausados`;
    await alertar(ctx, `Transferência de kit terminou, mas ${alerta}.`);
  }
  await finalizar(ctx, estado, alerta);
  return { passo: 'fim', acao: estado === 'concluida' ? 'concluida' : 'abortada' };
}

const PASSOS: Record<PassoSaga, (ctx: Ctx) => Promise<ResultadoPasso>> = {
  pausar,
  aguardar,
  conciliar,
  calcular,
  reduzir: (ctx) => escrever(ctx, 'origem', 'confirmar_reducao'),
  confirmar_reducao: (ctx) => confirmar(ctx, 'origem', 'aumentar'),
  aumentar: (ctx) => escrever(ctx, 'destino', 'confirmar_aumento'),
  confirmar_aumento: (ctx) => confirmar(ctx, 'destino', 'reativar'),
  reativar,
  fim: () => Promise.resolve({ passo: 'fim', acao: 'concluida' }),
};

/**
 * Executa o passo atual e agenda o próximo. Reentrega simultânea perde o claim e sai sem agir.
 * Erro no meio do passo (leitura que falhou, queda depois do PUT) reagenda o mesmo passo: a retomada
 * decide pelo que ficou gravado, nunca reenvia escrita incerta. Prazo vencido lança sem novo efeito.
 */
export async function avancarSaga(deps: DepsSaga, transferenciaId: string): Promise<ResultadoPasso> {
  const token = deps.novoToken();
  const limite = deps.agora().getTime() + PRAZO_PASSO_S * 1000;
  if (!(await deps.repo.reivindicar(transferenciaId, token, PRAZO_EXECUCAO_S))) return { passo: null, acao: 'ocupada' };
  try {
    const { transferencia, alvos } = await deps.repo.carregar(transferenciaId);
    const ctx: Ctx = { deps, t: transferencia, alvos, token, limite };
    try {
      return await PASSOS[transferencia.passo](ctx);
    } catch (e) {
      return await reagendar(ctx, mensagem(e));
    }
  } finally {
    await deps.repo.liberar(transferenciaId, token);
  }
}

export interface NovaTransferencia {
  orgId: string;
  /** Nulo só em `entrada` e `sair_sobra`. */
  kitId: string | null;
  tipo: 'montar' | 'desmontar' | 'repor' | 'cancelamento' | 'sair_sobra' | 'entrada';
  /** Contrato de `kit_transferencias.itens` (migration kit_variacao_rpc). */
  itens: Array<{ codigo: string; quantidade: number }>;
  /** Um por UP que recebe escrita, com os itens locais: o principal primeiro, depois a cópia de catálogo. */
  alvos: Array<{ codigo: string; upId: string; itemIds: string[] }>;
}

/**
 * Cria transferência, alvos e exclusão numa transação, com a org travada (`kit_criar_transferencia`).
 * `{motivo:'up_ocupado'}`: outro dono tem a exclusão de algum SKU; quem chama reagenda.
 */
export async function criarTransferencia(
  admin: SupabaseClient, input: NovaTransferencia,
): Promise<{ id: string } | { motivo: string }> {
  const { data, error } = await admin.rpc('kit_criar_transferencia', {
    p_org: input.orgId,
    p_kit: input.kitId,
    p_tipo: input.tipo,
    p_itens: input.itens,
    p_alvos: input.alvos.map((a) => ({ codigo: a.codigo, up_id: a.upId, item_ids: a.itemIds })),
  });
  if (error) throw new Error(`kit_criar_transferencia: ${error.message}`);
  const r = data as { ok: boolean; id?: string; motivo?: string };
  return r.ok && r.id ? { id: r.id } : { motivo: r.motivo ?? 'desconhecido' };
}
