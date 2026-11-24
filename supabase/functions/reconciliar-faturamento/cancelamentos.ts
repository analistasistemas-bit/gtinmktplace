// ADR-0211: drenagem da obrigação de cancelamento. Não regrava a venda, não toca a fila comum nem a de kit.
// Conclui só com duas evidências lidas na hora: o ledger de estoque e a resposta do ML ao vivo.
// Testável por vitest: não importa io.ts, queue.ts nem cancelamento-deps.ts. Fiação real em index.ts.
import type { PedidoML } from '../_shared/faturamento/venda.ts';
import {
  entraNoCreditoKit, type DepsCancelamento, type PedidoCancelado, type ResultadoCancelamento,
} from '../_shared/estoque/cancelamento.ts';

export const LOTE_CANCELAMENTOS = 20;
export const CARENCIA = '5 minutes';
export const PRAZO_CHAMADA_MS = 10_000;    // cada leitura do ML e cada RPC
export const PRAZO_TOTAL_MS = 60_000;      // até aqui (desde o início da execução) ainda começa obrigação nova
export const PRAZO_TRATAMENTO_MS = 30_000; // espera pelo tratamento de uma obrigação
export const PRAZO_FINAL_MS = 100_000;     // daqui em diante só grava (até 10 s) e devolve; a posse da rodada é de 150 s
const PARALELAS = 5;

/** `1` = todas as orgs; lista de ids separada por vírgula = só essas; ausente = desligada. */
export function drenagemLigada(valor: string | undefined, orgId: string): boolean {
  const v = (valor ?? '').trim();
  if (!v) return false;
  if (v === '1') return true;
  return v.split(',').map((s) => s.trim()).includes(orgId);
}

export interface Obrigacao { id: string; orderId: string; geracao: string; versao: string | null }
export interface Ledger { lidoEm: string; baixas: Array<{ codigoRef: string; quantidade: number; estornada: boolean }> }
export interface Registro { id: string; geracao: string; concluir: boolean; desfecho: string; lido_em: string | null }
/** O que a fila sabe do pedido; org, usuário e canal são postos pela fiação. */
export type PedidoDaFila = Omit<PedidoCancelado, 'orgId' | 'userId' | 'canal'>;

export interface IoFila {
  /** Vendedor da conexão. A drenagem não roda sem ele. */
  contaExternaId: string;
  reivindicar(lote: string): Promise<Obrigacao[]>;
  ledger(orderIds: string[]): Promise<Map<string, Ledger>>;
  pedido(orderId: string): Promise<PedidoML>;
  envio(shippingId: number | string): Promise<{ status: string | null } | null>;
  aindaPendente(o: Obrigacao): Promise<boolean>;
  kitLigado(): Promise<boolean>;
  tratar(p: PedidoDaFila): Promise<ResultadoCancelamento>;
  registrar(itens: Registro[]): Promise<void>;
  agora(): number;
}

/** Lista fechada (ADR-0211 decisão 6). Membro novo de ResultadoCancelamento quebra a compilação aqui. */
const DESFECHO_FILA = {
  reposto: 'confere-ledger', avisado: 'conclui', silenciado: 'conclui',
  'sem-baixa': 'fica', pendente: 'fica', repetir: 'fica', ignorado: 'fica', erro: 'fica',
} as const satisfies Record<ResultadoCancelamento, 'conclui' | 'fica' | 'confere-ledger'>;

/** `registrarPendenciaKit` vira função vazia: a retentativa do crédito de kit fica na fila própria. */
export function depsDaFila(base: DepsCancelamento): DepsCancelamento {
  return { ...base, registrarPendenciaKit: async () => {} };
}

class TempoEsgotado extends Error {}

/** Espera `p` por no máximo `ms`. A operação abandonada segue sozinha, sem ninguém esperando. */
function comPrazo<T>(p: Promise<T>, ms: number, oque: string): Promise<T> {
  if (ms <= 0) return Promise.reject(new TempoEsgotado(`${oque}: tempo esgotado`));
  let t: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new TempoEsgotado(`${oque}: tempo esgotado`)), ms); });
  return Promise.race([p, limite]).finally(() => clearTimeout(t));
}

const abertasDe = (l: Ledger) => l.baixas.filter((b) => b.codigoRef != null && !b.estornada);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Um lote. Lança se `reivindicar`, a primeira leitura do `ledger` ou `registrar` falharem ou estourarem o prazo; quem
 * chama captura. `registrar` estourado é resultado incerto (pode ter gravado): o ciclo seguinte reconfere pelo ledger.
 * `inicioMs` = início da execução (antes de conexão, token e pendências): os prazos de 60 s e 100 s contam dele.
 */
export async function drenarCancelamentos(
  io: IoFila, lote: string, prazoTotalMs = PRAZO_TOTAL_MS, inicioMs = io.agora(),
): Promise<{ concluidos: number; pendentes: number }> {
  if (!io.contaExternaId) return { concluidos: 0, pendentes: 0 };
  if (io.agora() - inicioMs >= prazoTotalMs) return { concluidos: 0, pendentes: 0 };
  const fimMs = inicioMs + PRAZO_FINAL_MS;
  /** Prazo da espera, nunca além do prazo final. */
  const ate = (ms: number) => Math.min(ms, fimMs - io.agora());

  const obrigacoes = await comPrazo(io.reivindicar(lote), ate(PRAZO_CHAMADA_MS), 'reivindicar');
  if (obrigacoes.length === 0) return { concluidos: 0, pendentes: 0 };
  const ledger = await comPrazo(io.ledger(obrigacoes.map((o) => o.orderId)), ate(PRAZO_CHAMADA_MS), 'ledger');

  let kit: Promise<boolean> | null = null; // lido no máximo uma vez por lote
  const kitLigado = () => (kit ??= comPrazo(io.kitLigado(), ate(PRAZO_CHAMADA_MS), 'kitLigado'));

  /** Uma obrigação. `null` = sem registro (fica pendente sem contar tentativa). */
  async function uma(o: Obrigacao): Promise<Registro | null> {
    const fica = (desfecho: string): Registro => ({ id: o.id, geracao: o.geracao, concluir: false, desfecho, lido_em: null });
    const conclui = (desfecho: string, lidoEm: string | undefined): Registro => lidoEm
      ? { id: o.id, geracao: o.geracao, concluir: true, desfecho, lido_em: lidoEm }
      : fica('sem instante do ledger');

    // 1. Ledger. Pedido fora do mapa = ledger não lido, nunca "sem baixa".
    const l = ledger.get(o.orderId);
    if (!l) return fica('ledger: não lido');
    const abertas = abertasDe(l);
    if (abertas.length === 0) return conclui('sem-baixa-aberta', l.lidoEm);

    // 2. ML ao vivo: o pedido é este e o vendedor é o da conexão (comparação direta).
    let p: PedidoML;
    try {
      p = await comPrazo(io.pedido(o.orderId), ate(PRAZO_CHAMADA_MS), 'pedido');
    } catch (e) {
      return fica(e instanceof TempoEsgotado ? 'ml: tempo esgotado' : `ml: leitura falhou: ${msg(e)}`);
    }
    if (String(p?.id) !== o.orderId) return fica('ml: outro pedido');
    if (p.seller?.id == null || String(p.seller.id) !== io.contaExternaId) return fica('ml: outro vendedor');

    // 3. Versão: a resposta tem de ser tão nova quanto o cancelled que armou.
    const r = Date.parse((p as PedidoML & { last_updated?: string | null }).last_updated ?? '');
    const a = Date.parse(o.versao ?? '');
    if (Number.isNaN(r) || Number.isNaN(a)) return fica('ml: sem versão');
    const status = p.status;
    if (status === 'cancelled') {
      if (r < a) return fica('ml: resposta antiga');
    } else if (typeof status !== 'string' || status === '') {
      return fica('ml: sem status');
    } else {
      return r > a ? conclui('nao-cancelado', l.lidoEm) : fica('ml: resposta antiga');
    }

    // 4. Envio: com envio, só segue com o status lido (null nunca equivale a "não despachado").
    const temEnvio = p.shipping?.id != null;
    let shipmentStatus: string | null = null;
    if (temEnvio) {
      let s: { status: string | null } | null;
      try {
        s = await comPrazo(io.envio(p.shipping!.id!), ate(PRAZO_CHAMADA_MS), 'envio');
      } catch (e) {
        return fica(e instanceof TempoEsgotado ? 'ml: tempo esgotado' : 'ml: envio não lido');
      }
      if (s?.status == null || s.status === '') return fica('ml: envio não lido');
      shipmentStatus = String(s.status);
    }
    const base: PedidoDaFila = {
      orderId: o.orderId, statusPedido: 'cancelled', shipmentStatus, temEnvio, catalogoIncompleto: false,
      itens: abertas.map((b) => ({ codigo: b.codigoRef, quantity: b.quantidade })),
    };
    const misto = abertas.length < l.baixas.filter((b) => b.codigoRef != null).length;
    if (misto && !entraNoCreditoKit({ ...base, orgId: '', userId: null, canal: '', kitLigado: true })) {
      return fica('parcial-sem-pre-despacho');
    }

    // 5. A geração lida ainda está pendente? Erro ou prazo: sem registro.
    try {
      if (!await comPrazo(io.aindaPendente(o), ate(PRAZO_CHAMADA_MS), 'aindaPendente')) return null;
    } catch (e) { console.warn(`drenagem de cancelamentos: ${o.orderId} aindaPendente: ${msg(e)}`); return null; }
    let kitOn: boolean;
    try { kitOn = await kitLigado(); } catch (e) {
      console.warn(`drenagem de cancelamentos: ${o.orderId} kitLigado: ${msg(e)}`);
      return null;
    }

    // 6. Tratamento com os itens do ledger.
    let res: ResultadoCancelamento;
    try {
      res = await comPrazo(io.tratar({ ...base, kitLigado: kitOn }), ate(PRAZO_TRATAMENTO_MS), 'tratamento');
    } catch (e) {
      console.warn(`drenagem de cancelamentos: ${o.orderId} tratamento: ${msg(e)}`);
      return fica(e instanceof TempoEsgotado ? 'tratamento: tempo esgotado' : 'erro');
    }

    // 7. Desfecho pela lista fechada; `reposto` só conclui com o ledger relido sem baixa aberta.
    const regra = (DESFECHO_FILA as Record<string, string>)[res] ?? 'fica';
    if (regra === 'conclui') return conclui(res, l.lidoEm);
    if (regra === 'fica') return fica(res);
    let l2: Ledger | undefined;
    try {
      l2 = (await comPrazo(io.ledger([o.orderId]), ate(PRAZO_CHAMADA_MS), 'ledger')).get(o.orderId);
    } catch (e) { console.warn(`drenagem de cancelamentos: ${o.orderId} releitura do ledger: ${msg(e)}`); return null; }
    if (!l2) return null;
    return abertasDe(l2).length === 0 ? conclui('reposto', l2.lidoEm) : fica('reposicao-incompleta');
  }

  // 5 por vez. Antes de começar cada obrigação confere o orçamento; a que não começou fica sem registro.
  const registros: Registro[] = [];
  let proxima = 0;
  const trabalhador = async () => {
    while (proxima < obrigacoes.length && io.agora() - inicioMs < prazoTotalMs) {
      const o = obrigacoes[proxima++];
      try {
        const r = await uma(o);
        if (r) registros.push(r);
      } catch (e) {
        console.error(`drenagem de cancelamentos: obrigação ${o.orderId} falhou: ${msg(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALELAS, obrigacoes.length) }, trabalhador));

  const enviados = [...registros]; // cópia: nada entra depois do envio
  if (enviados.length > 0) await comPrazo(io.registrar(enviados), PRAZO_CHAMADA_MS, 'registrar');
  const concluidos = enviados.filter((r) => r.concluir).length;
  return { concluidos, pendentes: obrigacoes.length - concluidos };
}
