// ADR-0174 — executor do motor de operações em massa: laço sequencial com orçamento de tempo (continua via QStash),
// claim por item antes de escrever no ML e conferência agendada da saída (200 do DELETE ≠ saiu; DEAL leva de 30 min
// a horas para sair, SMART ~30 s — spike).
import { ehParticipando } from '../promocoes/projecao.ts';
import type { Semaforo } from '../promocoes/tipos.ts';
import { decidir, piorou } from './decidir.ts';
import { type ClienteML, SemEscritaPromocoes } from './ml.ts';
import type { Acao, StatusItem, TipoPromocao } from './tipos.ts';

export interface OperacaoRow { id: string; org_id: string; acao: Acao; promocao_id: string; promocao_tipo: TipoPromocao }
export interface ItemRow {
  ml_item_id: string; preco: number | null; status: StatusItem; conferencias: number;
  semaforo: Semaforo | null; confirmado_risco: boolean;
  proxima_conferencia: string | null;   // ISO; null = não há conferência agendada (confirmada ou desistida)
}
export interface CamposItem {
  status: StatusItem; mensagem: string | null; offer_id: string | null; conferencias: number; proxima_conferencia: string | null;
}
export interface DepsExecutar {
  ml: ClienteML;
  agora(): number;
  /** Claim pendente (ou enviando antigo) → enviando; false = outro worker já pegou. */
  reivindicar(operacaoId: string, mlItemId: string): Promise<boolean>;
  /** `pendente` + `enviando` com atualizado_em > 2 min (worker morreu no meio). */
  itensPendentes(operacaoId: string, limite: number): Promise<ItemRow[]>;
  /** `saida_solicitada` com `proxima_conferencia` não nula. */
  itensAConferir(operacaoId: string): Promise<ItemRow[]>;
  gravarItem(operacaoId: string, mlItemId: string, campos: Partial<CamposItem>): Promise<void>;
  /** Semáforo no preço pedido com a projeção atual da Central; null = item sumiu da Central. */
  semaforoAtual(promocaoId: string, mlItemId: string, preco: number | null): Promise<Semaforo | null>;
  espelharStatusCentral(promocaoId: string, mlItemId: string, acao: 'participando' | 'saiu', statusML?: 'pending' | 'started'): Promise<void>;
  continuar(): Promise<void>;
  agendarConferencia(delaySeg: number): Promise<void>;
  concluir(): Promise<void>;
}

const RECONECTAR = 'Sem permissão de escrita em promoções — reconecte a conta do Mercado Livre em Canais';
const AGUARDANDO = 'Saída pedida ao ML; aguardando confirmação';
const SELLER_CENTER = 'O ML ainda não confirmou a saída. Confira no Seller Center.';
const PIOROU = 'O resultado piorou desde o preview';
const SUMIU = 'O anúncio não é mais convidado nesta promoção';

const MIN = 60;
const ESCADA = [5 * MIN, 10 * MIN, 20 * MIN, 40 * MIN];
const LIMITE_SEG = 24 * 60 * MIN;

/** Segundos até a conferência nº `conferencias + 1` (5, 10, 20, 40 min, depois 60 min); null = passaria de 24 h. */
export function proximoIntervalo(conferencias: number): number | null {
  const passo = (c: number) => ESCADA[c] ?? 60 * MIN;
  let decorrido = 0;
  for (let c = 0; c < conferencias; c++) decorrido += passo(c);
  return decorrido + passo(conferencias) > LIMITE_SEG ? null : passo(conferencias);
}

const iso = (ms: number) => new Date(ms).toISOString();
const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Agenda a próxima conferência para quando o primeiro item vencer; sem itens → conclui. */
async function agendarOuConcluir(deps: DepsExecutar, aConferir: ItemRow[]): Promise<void> {
  const vencimentos = aConferir.map((i) => Date.parse(i.proxima_conferencia ?? '')).filter(Number.isFinite);
  if (!vencimentos.length) return deps.concluir();
  await deps.agendarConferencia(Math.max(1, Math.ceil((Math.min(...vencimentos) - deps.agora()) / 1000)));
}

async function processarItem(op: OperacaoRow, it: ItemRow, deps: DepsExecutar): Promise<void> {
  const { ml } = deps;
  const id = it.ml_item_id;
  const fresco = await ml.lerNaCampanha(op.promocao_id, op.promocao_tipo, id);
  // Relações só importam quando o item ainda é convidado (é aí que decidir bloqueia o par UP/catálogo).
  const relacoes = op.acao === 'aderir' && fresco?.status === 'candidate' ? await ml.lerRelacoes(id) : null;
  const d = decidir(op.acao, op.promocao_tipo, op.promocao_id, { ml_item_id: id, preco: it.preco }, fresco, relacoes);

  if (d.tipo === 'fim') return deps.gravarItem(op.id, id, { status: d.status, mensagem: d.mensagem });

  if (d.tipo === 'delete') {
    await ml.del(id, d.query);
    return deps.gravarItem(op.id, id, {
      status: 'saida_solicitada', mensagem: AGUARDANDO, conferencias: 0,
      proxima_conferencia: iso(deps.agora() + proximoIntervalo(0)! * 1000),
    });
  }

  // Decisão 5 do ADR: resultado pior que o do preview só entra com risco confirmado.
  if (!it.confirmado_risco) {
    const atual = await deps.semaforoAtual(op.promocao_id, id, it.preco);
    if (atual === null) return deps.gravarItem(op.id, id, { status: 'mudou', mensagem: SUMIU });
    // ponytail: semáforo gravado ausente conta como verde (qualquer piora barra).
    if (piorou(it.semaforo ?? 'verde', atual)) return deps.gravarItem(op.id, id, { status: 'mudou', mensagem: PIOROU });
  }

  const { offer_id } = await ml.post(id, d.body);
  await deps.gravarItem(op.id, id, { status: 'aplicado', mensagem: null, offer_id });
  // Espelho na Central é best-effort: o POST já valeu e o item já está gravado; o sync da Central corrige depois.
  const depois = await ml.lerNaCampanha(op.promocao_id, op.promocao_tipo, id).catch(() => null);
  const statusML = depois?.status === 'started' ? 'started' : 'pending';
  await deps.espelharStatusCentral(op.promocao_id, id, 'participando', statusML).catch(() => {});
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
        if (!(e instanceof SemEscritaPromocoes)) {
          await deps.gravarItem(op.id, it.ml_item_id, { status: 'erro', mensagem: mensagemDe(e) });
          continue;
        }
        // Sem permissão: nada mais passa nesta conta — encerra este e todos os restantes.
        await deps.gravarItem(op.id, it.ml_item_id, { status: 'erro', mensagem: RECONECTAR });
        for (let resto = await deps.itensPendentes(op.id, opts.lote); resto.length; resto = await deps.itensPendentes(op.id, opts.lote)) {
          for (const r of resto) await deps.gravarItem(op.id, r.ml_item_id, { status: 'erro', mensagem: RECONECTAR });
        }
        await agendarOuConcluir(deps, await deps.itensAConferir(op.id));
        return { processados, continuou: false };
      }
    }
  }

  await agendarOuConcluir(deps, await deps.itensAConferir(op.id));
  return { processados, continuou: false };
}

export async function conferir(op: OperacaoRow, deps: DepsExecutar): Promise<{ confirmados: number; pendentes: number }> {
  const agora = deps.agora();
  const restantes: ItemRow[] = [];
  let confirmados = 0;

  for (const it of await deps.itensAConferir(op.id)) {
    const id = it.ml_item_id;
    if (Date.parse(it.proxima_conferencia ?? '') > agora) { restantes.push(it); continue; }

    // Erro de leitura conta como "ainda não saiu": tenta de novo no próximo intervalo, dentro das 24 h.
    const fresco = await deps.ml.lerNaCampanha(op.promocao_id, op.promocao_tipo, id).catch(() => undefined);
    if (fresco !== undefined && (fresco === null || !ehParticipando(fresco.status))) {
      await deps.gravarItem(op.id, id, { status: 'aplicado', mensagem: null, proxima_conferencia: null });
      await deps.espelharStatusCentral(op.promocao_id, id, 'saiu').catch(() => {});
      confirmados++;
      continue;
    }

    const conferencias = it.conferencias + 1;
    const intervalo = proximoIntervalo(conferencias);
    if (intervalo === null) {
      await deps.gravarItem(op.id, id, { conferencias, mensagem: SELLER_CENTER, proxima_conferencia: null });
      continue;
    }
    const proxima = iso(agora + intervalo * 1000);
    await deps.gravarItem(op.id, id, { conferencias, proxima_conferencia: proxima });
    restantes.push({ ...it, conferencias, proxima_conferencia: proxima });
  }

  await agendarOuConcluir(deps, restantes);
  return { confirmados, pendentes: restantes.length };
}
