// ADR-0211: drenagem da obrigação de cancelamento. Não regrava a venda, não toca a fila comum nem a de kit.
// Conclui só com duas evidências lidas na hora: o ledger de estoque e a resposta do ML ao vivo.
// Testável por vitest: não importa io.ts, queue.ts nem cancelamento-deps.ts. Fiação real em index.ts.
import type { PedidoML } from '../_shared/faturamento/venda.ts';
import {
  candidatoNuncaSaiu, entraNoCreditoKit, envioParaTratamento, type DepsCancelamento, type PedidoCancelado, type ResultadoCancelamento,
} from '../_shared/estoque/cancelamento.ts';
import type { ProvaNuncaSaiu } from '../_shared/estoque/nunca-saiu.ts';

export const LOTE_CANCELAMENTOS = 20;
export const CARENCIA = '5 minutes';
export const PRAZO_CHAMADA_MS = 10_000;    // cada leitura do ML e cada RPC
export const PRAZO_TOTAL_MS = 60_000;      // até aqui (desde o início da execução) ainda começa obrigação nova
export const PRAZO_TRATAMENTO_MS = 30_000; // espera pelo tratamento de uma obrigação
export const PRAZO_FINAL_MS = 100_000;     // daqui em diante só grava (até 10 s) e devolve; a posse da rodada é de 150 s
const PARALELAS = 5;
/** Emenda 8 ao ADR-0121: sem prova, sem leitura ou com sobra, fica pendente até aqui; depois segue para o aviso. */
const TENTATIVAS_SEM_AVISO = 2;

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
  envio(shippingId: number | string): Promise<{ status: string | null; substatus?: string | null } | null>;
  /** `false` = geração trocada ou concluída. As tentativas (emenda 8) vêm da mesma linha; `true` = não lidas, conta 0. */
  aindaPendente(o: Obrigacao): Promise<boolean | { tentativas: number }>;
  /** Emenda 8 ao ADR-0121: histórico do envio. Ausente = como antes dela. */
  lerNuncaSaiu?(shippingId: number | string): Promise<ProvaNuncaSaiu>;
  kitLigado(): Promise<boolean>;
  tratar(p: PedidoDaFila): Promise<ResultadoCancelamento>;
  /** Devolve quantas conclusões a RPC aceitou (geração corrente e ainda pendente). */
  registrar(itens: Registro[]): Promise<number>;
  agora(): number;
}

/** Lista fechada (ADR-0211 decisão 6). Membro novo de ResultadoCancelamento quebra a compilação aqui. */
const DESFECHO_FILA = {
  reposto: 'confere-ledger', avisado: 'conclui', silenciado: 'conclui',
  'sem-baixa': 'fica', pendente: 'fica', repetir: 'fica', adiado: 'fica', ignorado: 'fica', erro: 'fica',
} as const satisfies Record<ResultadoCancelamento, 'conclui' | 'fica' | 'confere-ledger'>;

/** `registrarPendenciaKit` vira função vazia: a retentativa do crédito de kit fica na fila própria. */
export function depsDaFila(base: DepsCancelamento): DepsCancelamento {
  return { ...base, registrarPendenciaKit: async () => {} };
}

/** Status de pedido do ML. `nao-cancelado` só com um destes (≠ cancelled); `pending_cancel` não desfaz nada. */
const STATUS_PEDIDO = new Set(['confirmed', 'payment_required', 'payment_in_process', 'partially_paid', 'paid',
  'partially_refunded', 'invalid', 'cancelled']);
/** Status de envio do ML. Fora desta lista o envio conta como não lido. */
const STATUS_ENVIO = new Set(['to_be_agreed', 'pending', 'handling', 'ready_to_ship', 'shipped', 'delivered',
  'not_delivered', 'not_verified', 'cancelled', 'closed', 'error', 'active', 'inactive', 'stale',
  'stale_ready_to_ship', 'stale_shipped']);

class TempoEsgotado extends Error {}

/** Começa `f` só se ainda há prazo, e espera no máximo `ms`. A operação abandonada segue sozinha. */
function comPrazo<T>(f: () => Promise<T>, ms: number, oque: string): Promise<T> {
  if (ms <= 0) return Promise.reject(new TempoEsgotado(`${oque}: tempo esgotado`));
  let t: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new TempoEsgotado(`${oque}: tempo esgotado`)), ms); });
  return Promise.race([f(), limite]).finally(() => clearTimeout(t));
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
  // Sem tempo na entrada: lança, para a rodada sair `parcial` em vez de parecer que não havia nada.
  if (io.agora() - inicioMs >= prazoTotalMs) throw new Error('drenagem de cancelamentos: sem tempo nesta execução');
  const fimMs = inicioMs + PRAZO_FINAL_MS;
  /** Prazo da espera, nunca além do prazo final. */
  const ate = (ms: number) => Math.min(ms, fimMs - io.agora());

  const obrigacoes = await comPrazo(() => io.reivindicar(lote), ate(PRAZO_CHAMADA_MS), 'reivindicar');
  if (obrigacoes.length === 0) return { concluidos: 0, pendentes: 0 };
  const ledger = await comPrazo(() => io.ledger(obrigacoes.map((o) => o.orderId)), ate(PRAZO_CHAMADA_MS), 'ledger');

  let kit: Promise<boolean> | null = null; // lido no máximo uma vez por lote
  const kitLigado = () => (kit ??= comPrazo(() => io.kitLigado(), ate(PRAZO_CHAMADA_MS), 'kitLigado'));

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
      p = await comPrazo(() => io.pedido(o.orderId), ate(PRAZO_CHAMADA_MS), 'pedido');
    } catch (e) {
      return fica(e instanceof TempoEsgotado ? 'ml: tempo esgotado' : `ml: leitura falhou: ${msg(e)}`);
    }
    if (String(p?.id) !== o.orderId) return fica('ml: outro pedido');
    if (p.seller?.id == null || String(p.seller.id) !== io.contaExternaId) return fica('ml: outro vendedor');

    // 3. Versão: a resposta tem de ser tão nova quanto o cancelled que armou. Versão armada nula (o cancelled
    // veio sem last_updated): cancelled ao vivo segue (tratar é idempotente e conferido no ledger); outro status
    // não conclui, porque não há com o que comparar.
    const r = Date.parse((p as PedidoML & { last_updated?: string | null }).last_updated ?? '');
    const a = o.versao == null ? -Infinity : Date.parse(o.versao);
    if (Number.isNaN(r) || Number.isNaN(a)) return fica('ml: sem versão');
    const status = p.status;
    if (typeof status !== 'string' || !STATUS_PEDIDO.has(status)) return fica('ml: sem status');
    if (status === 'cancelled') {
      if (r < a) return fica('ml: resposta antiga');
    } else {
      if (o.versao == null) return fica('ml: sem versão');
      return r > a ? conclui('nao-cancelado', l.lidoEm) : fica('ml: resposta antiga');
    }

    // 4. Envio: com envio, só segue com o status lido (null nunca equivale a "não despachado").
    const temEnvio = p.shipping?.id != null;
    let shipmentStatus: string | null = null;
    let shipmentSubstatus: string | null = null;
    let envioNaoLido: string | null = null;
    if (temEnvio) {
      let s: { status: string | null; substatus?: string | null } | null = null;
      try {
        s = await comPrazo(() => io.envio(p.shipping!.id!), ate(PRAZO_CHAMADA_MS), 'envio');
      } catch (e) {
        if (e instanceof TempoEsgotado) envioNaoLido = 'ml: tempo esgotado';
      }
      if (typeof s?.status !== 'string' || !STATUS_ENVIO.has(s.status)) {
        // Emenda 8: da 3ª tentativa em diante segue com status nulo, que nunca repõe e avisa. Antes, pendente.
        envioNaoLido ??= 'ml: envio não lido';
        if (!io.lerNuncaSaiu) return fica(envioNaoLido);
      } else {
        shipmentStatus = s.status;
        // Emenda 24/11 ao ADR-0121: o substatus decide se `ready_to_ship` ainda é pré-despacho.
        shipmentSubstatus = envioParaTratamento(s).shipmentSubstatus; // mesma normalização dos outros chamadores
      }
    }
    const base: PedidoDaFila = {
      orderId: o.orderId, statusPedido: 'cancelled', shipmentStatus, shipmentSubstatus, temEnvio, catalogoIncompleto: false,
      itens: abertas.map((b) => ({ codigo: b.codigoRef, quantity: b.quantidade })),
    };
    let prova: Promise<ProvaNuncaSaiu> | undefined; // lida no máximo uma vez
    if (io.lerNuncaSaiu && temEnvio) base.lerNuncaSaiu = () => (prova ??= io.lerNuncaSaiu!(p.shipping!.id!));
    const misto = abertas.length < l.baixas.filter((b) => b.codigoRef != null).length;
    const corte = misto && !entraNoCreditoKit({ ...base, orgId: '', userId: null, canal: '', kitLigado: true });
    if (corte && !base.lerNuncaSaiu) return fica('parcial-sem-pre-despacho');
    const provado = corte && candidatoNuncaSaiu(base)
      && await comPrazo(base.lerNuncaSaiu!, ate(PRAZO_CHAMADA_MS), 'histórico').catch(() => 'indisponivel') === 'sim';

    let kitOn: boolean;
    try { kitOn = await kitLigado(); } catch (e) {
      console.warn(`drenagem de cancelamentos: ${o.orderId} kitLigado: ${msg(e)}`);
      return null;
    }
    // 5. Depois de TODA espera, logo antes de tratar: a geração lida ainda está pendente? Erro ou prazo: sem registro.
    let tentativas = 0;
    try {
      const a = await comPrazo(() => io.aindaPendente(o), ate(PRAZO_CHAMADA_MS), 'aindaPendente');
      if (!a) return null;
      if (a !== true) tentativas = a.tentativas;
    } catch (e) { console.warn(`drenagem de cancelamentos: ${o.orderId} aindaPendente: ${msg(e)}`); return null; }

    const insiste = tentativas < TENTATIVAS_SEM_AVISO;
    if (envioNaoLido && insiste) return fica(envioNaoLido);
    if (corte && !provado && insiste) return fica('parcial-sem-pre-despacho');

    // 6. Tratamento com os itens do ledger. Prazo vencido: nem começa.
    let res: ResultadoCancelamento;
    try {
      res = await comPrazo(() => io.tratar({ ...base, kitLigado: kitOn, aoIndisponivel: () => (insiste ? 'erro' : 'avisar') }), ate(PRAZO_TRATAMENTO_MS), 'tratamento');
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
      l2 = (await comPrazo(() => io.ledger([o.orderId]), ate(PRAZO_CHAMADA_MS), 'ledger')).get(o.orderId);
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
  // Conta o que a RPC aceitou: conclusão com geração trocada no meio do caminho não conta.
  const concluidos = enviados.length > 0 ? await comPrazo(() => io.registrar(enviados), PRAZO_CHAMADA_MS, 'registrar') : 0;
  return { concluidos, pendentes: obrigacoes.length - concluidos };
}
