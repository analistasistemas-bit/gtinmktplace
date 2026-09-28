// ADR-0174 — executor do motor de operações em massa: laço sequencial com orçamento de tempo (continua via QStash),
// claim por item antes de escrever no ML e conferência agendada da saída (200 do DELETE ≠ saiu; DEAL leva de 30 min
// a horas para sair, SMART ~30 s — spike).
import { ehParticipando } from '../promocoes/projecao.ts';
import type { Semaforo } from '../promocoes/tipos.ts';
import { decidir, piorou } from './decidir.ts';
import { type ClienteML, SemEscritaPromocoes } from './ml.ts';
import type { Acao, ItemNaCampanha, StatusItem, TipoPromocao } from './tipos.ts';

export interface OperacaoRow {
  id: string; org_id: string; acao: Acao; promocao_id: string; promocao_tipo: TipoPromocao;
  promocao_status: 'pending' | 'started';   // ml_promocoes.status: futura ou ativa
}
export interface ItemRow {
  ml_item_id: string; preco: number | null; status: StatusItem; conferencias: number;
  semaforo: Semaforo | null; confirmado_risco: boolean;
  proxima_conferencia: string | null;   // ISO; null = sem conferência agendada
  saida_pedida_em: string | null;       // ISO do 1º DELETE aceito; relógio das 24 h
}
export interface CamposItem {
  status: StatusItem; mensagem: string | null; offer_id: string | null; conferencias: number;
  proxima_conferencia: string | null; saida_pedida_em: string | null;
}
/** Espelho em ml_promocao_itens: pending/started = participando; saiu = DEAL volta a candidate, SMART apaga a linha. */
export type Espelho = 'pending' | 'started' | 'saiu';
export interface DepsExecutar {
  ml: ClienteML;
  agora(): number;
  /** Claim pendente (ou enviando antigo) → enviando; false = outro worker já pegou. */
  reivindicar(operacaoId: string, mlItemId: string): Promise<boolean>;
  /** `pendente` + `enviando` com atualizado_em > 2 min (worker morreu no meio). */
  itensPendentes(operacaoId: string, limite: number): Promise<ItemRow[]>;
  /** Há algum `enviando` (qualquer idade)? */
  temEnviando(operacaoId: string): Promise<boolean>;
  /** `saida_solicitada` com `proxima_conferencia` não nula. */
  itensAConferir(operacaoId: string): Promise<ItemRow[]>;
  gravarItem(operacaoId: string, mlItemId: string, campos: Partial<CamposItem>): Promise<void>;
  /** Semáforo no preço pedido com a projeção atual da Central; null = item sumiu da Central. */
  semaforoAtual(promocaoId: string, mlItemId: string, preco: number | null): Promise<Semaforo | null>;
  espelharStatusCentral(promocaoId: string, tipo: TipoPromocao, mlItemId: string, espelho: Espelho): Promise<void>;
  continuar(delaySeg?: number): Promise<void>;
  agendarConferencia(delaySeg: number): Promise<void>;
  concluir(): Promise<void>;
}

const RECONECTAR = 'Sem permissão de escrita em promoções — reconecte a conta do Mercado Livre em Canais';
const AGUARDANDO = 'Saída pedida ao ML; aguardando confirmação';
const SELLER_CENTER = 'O ML ainda não confirmou a saída. Confira no Seller Center.';
const PIOROU = 'O resultado piorou desde o preview';
const SAIU_DA_CENTRAL = 'O anúncio saiu da Central desde o preview';
const ESPERA_ENVIANDO_SEG = 150; // > 2 min: o enviando do worker morto já volta em itensPendentes

const MIN = 60;
const ESCADA = [5 * MIN, 10 * MIN, 20 * MIN, 40 * MIN];
const LIMITE_SEG = 24 * 60 * MIN;

/**
 * Segundos até a próxima conferência (5, 10, 20, 40 min, depois 60 min), sem passar de 24 h desde a saída pedida;
 * null = já deu 24 h de relógio, desistir.
 */
export function proximoIntervalo(conferencias: number, decorridoSeg: number): number | null {
  if (decorridoSeg >= LIMITE_SEG) return null;
  return Math.min(ESCADA[conferencias] ?? 60 * MIN, LIMITE_SEG - decorridoSeg);
}

const iso = (ms: number) => new Date(ms).toISOString();
const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
/** Status real na Central depois de aderir: o da campanha; ainda candidate (atraso do ML) → o da promoção. */
const espelhoAderido = (op: OperacaoRow, f: ItemNaCampanha | null): Espelho =>
  f?.status === 'pending' || f?.status === 'started' ? f.status : op.promocao_status;
// Espelho é best-effort: o item já está gravado; o sync da Central corrige depois.
const espelhar = (deps: DepsExecutar, op: OperacaoRow, id: string, e: Espelho) =>
  deps.espelharStatusCentral(op.promocao_id, op.promocao_tipo, id, e).catch(() => {});

/** Escrita no ML já aceita: falha ao gravar relança e o item fica `enviando` para o retry redecidir. */
class FalhaPosEscrita extends Error {
  constructor(readonly causa: unknown) { super(mensagemDe(causa)); }
}
const gravarPos = (p: Promise<void>) => p.catch((e) => { throw new FalhaPosEscrita(e); });

async function processarItem(op: OperacaoRow, it: ItemRow, deps: DepsExecutar): Promise<void> {
  const { ml } = deps;
  const id = it.ml_item_id;
  const fresco = await ml.lerNaCampanha(op.promocao_id, op.promocao_tipo, id);
  // Relações só importam quando o item ainda é convidado (é aí que decidir bloqueia o par UP/catálogo).
  const relacoes = op.acao === 'aderir' && fresco?.status === 'candidate' ? await ml.lerRelacoes(id) : null;
  const d = decidir(op.acao, op.promocao_tipo, op.promocao_id, { ml_item_id: id, preco: it.preco }, fresco, relacoes);

  if (d.tipo === 'fim') {
    if (d.status !== 'ja_estava') return deps.gravarItem(op.id, id, { status: d.status, mensagem: d.mensagem });
    // Retry depois de crash pós-escrita cai aqui: grava o offer_id do SMART e acerta o espelho.
    if (op.acao === 'aderir') {
      await deps.gravarItem(op.id, id, { status: 'ja_estava', mensagem: null, ...(fresco?.offer_id ? { offer_id: fresco.offer_id } : {}) });
      return espelhar(deps, op, id, espelhoAderido(op, fresco));
    }
    await deps.gravarItem(op.id, id, { status: 'ja_estava', mensagem: null });
    return espelhar(deps, op, id, 'saiu');
  }

  if (d.tipo === 'delete') {
    await ml.del(id, d.query);
    const agora = deps.agora();
    return gravarPos(deps.gravarItem(op.id, id, {
      status: 'saida_solicitada', mensagem: AGUARDANDO, conferencias: 0, saida_pedida_em: iso(agora),
      proxima_conferencia: iso(agora + proximoIntervalo(0, 0)! * 1000),
    }));
  }

  // Decisão 5 do ADR: resultado pior que o do preview só entra com risco confirmado.
  if (!it.confirmado_risco) {
    const atual = await deps.semaforoAtual(op.promocao_id, id, it.preco);
    if (atual === null) return deps.gravarItem(op.id, id, { status: 'mudou', mensagem: SAIU_DA_CENTRAL });
    // ponytail: semáforo gravado ausente conta como verde (qualquer piora barra).
    if (piorou(it.semaforo ?? 'verde', atual)) return deps.gravarItem(op.id, id, { status: 'mudou', mensagem: PIOROU });
  }

  const { offer_id } = await ml.post(id, d.body);
  await gravarPos(deps.gravarItem(op.id, id, { status: 'aplicado', mensagem: null, offer_id }));
  const depois = await ml.lerNaCampanha(op.promocao_id, op.promocao_tipo, id).catch(() => null);
  await espelhar(deps, op, id, espelhoAderido(op, depois));
}

/** Sem pendentes: espera `enviando` de outro worker, senão agenda a conferência, senão conclui. */
async function finalizar(op: OperacaoRow, deps: DepsExecutar, processados: number) {
  if (await deps.temEnviando(op.id)) {
    await deps.continuar(ESPERA_ENVIANDO_SEG);
    return { processados, continuou: true };
  }
  await agendarOuConcluir(deps, await deps.itensAConferir(op.id));
  return { processados, continuou: false };
}

/** Agenda a próxima conferência para quando o primeiro item vencer; sem itens → conclui. */
async function agendarOuConcluir(deps: DepsExecutar, aConferir: ItemRow[]): Promise<void> {
  const vencimentos = aConferir.map((i) => Date.parse(i.proxima_conferencia ?? '')).filter(Number.isFinite);
  if (!vencimentos.length) return deps.concluir();
  await deps.agendarConferencia(Math.max(1, Math.ceil((Math.min(...vencimentos) - deps.agora()) / 1000)));
}

export async function executar(
  op: OperacaoRow, deps: DepsExecutar, opts: { limiteMs: number; lote: number },
): Promise<{ processados: number; continuou: boolean }> {
  const inicio = deps.agora();
  let processados = 0;

  for (;;) {
    const lote = await deps.itensPendentes(op.id, opts.lote);
    if (!lote.length) break;
    for (const it of lote) {
      if (deps.agora() - inicio >= opts.limiteMs) {
        await deps.continuar();
        return { processados, continuou: true };
      }
      if (!(await deps.reivindicar(op.id, it.ml_item_id))) continue;
      processados++;
      try {
        await processarItem(op, it, deps);
      } catch (e) {
        if (e instanceof FalhaPosEscrita) throw e.causa;
        if (!(e instanceof SemEscritaPromocoes)) {
          await deps.gravarItem(op.id, it.ml_item_id, { status: 'erro', mensagem: mensagemDe(e) });
          continue;
        }
        // Sem permissão: nada mais passa nesta conta — encerra este e todos os restantes.
        await deps.gravarItem(op.id, it.ml_item_id, { status: 'erro', mensagem: RECONECTAR });
        for (let resto = await deps.itensPendentes(op.id, opts.lote); resto.length; resto = await deps.itensPendentes(op.id, opts.lote)) {
          for (const r of resto) await deps.gravarItem(op.id, r.ml_item_id, { status: 'erro', mensagem: RECONECTAR });
        }
        return finalizar(op, deps, processados);
      }
    }
  }
  return finalizar(op, deps, processados);
}

export async function conferir(op: OperacaoRow, deps: DepsExecutar): Promise<{ confirmados: number; pendentes: number }> {
  const agora = deps.agora();
  const restantes: ItemRow[] = [];
  let confirmados = 0;

  for (const it of await deps.itensAConferir(op.id)) {
    const id = it.ml_item_id;
    if (Date.parse(it.proxima_conferencia ?? '') > agora) { restantes.push(it); continue; }

    // Erro de leitura conta como "ainda não saiu"; 401/403 avisa a reconexão sem gastar conferência.
    let semPermissao = false;
    const fresco = await deps.ml.lerNaCampanha(op.promocao_id, op.promocao_tipo, id).catch((e) => {
      semPermissao = e instanceof SemEscritaPromocoes;
      return undefined;
    });
    if (fresco !== undefined && (fresco === null || !ehParticipando(fresco.status))) {
      await deps.gravarItem(op.id, id, { status: 'aplicado', mensagem: null, proxima_conferencia: null });
      await espelhar(deps, op, id, 'saiu');
      confirmados++;
      continue;
    }

    // ponytail: saida_pedida_em ausente (linha antiga) conta a partir de agora.
    const desde = Date.parse(it.saida_pedida_em ?? '');
    const decorrido = Number.isFinite(desde) ? (agora - desde) / 1000 : 0;
    const conferencias = semPermissao ? it.conferencias : it.conferencias + 1;
    const intervalo = proximoIntervalo(conferencias, decorrido);
    if (intervalo === null) {
      // Vira erro (não fica saida_solicitada): senão o índice anti-duplicidade trava o anúncio para sempre.
      await deps.gravarItem(op.id, id, { status: 'erro', conferencias, mensagem: SELLER_CENTER, proxima_conferencia: null });
      continue;
    }
    const proxima = iso(agora + intervalo * 1000);
    await deps.gravarItem(op.id, id, {
      conferencias, proxima_conferencia: proxima, mensagem: semPermissao ? RECONECTAR : AGUARDANDO,
    });
    restantes.push({ ...it, conferencias, proxima_conferencia: proxima });
  }

  await agendarOuConcluir(deps, restantes);
  return { confirmados, pendentes: restantes.length };
}
