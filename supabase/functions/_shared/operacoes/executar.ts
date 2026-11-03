// ADR-0174 — executor de promoções do motor de operações em massa (o laço comum vive em laco.ts) e conferência
// agendada da saída (200 do DELETE ≠ saiu; DEAL leva de 30 min a horas para sair, SMART ~30 s — spike).
import { ehParticipando } from '../promocoes/projecao.ts';
import type { Semaforo } from '../promocoes/tipos.ts';
import { decidir, piorou } from './decidir.ts';
import { agendarOuConcluir, FalhaPosEscrita, gravarPos, laco, type DepsLaco } from './laco.ts';
import { type ClienteML, SemEscritaPromocoes } from './ml.ts';
import type { Acao, ItemNaCampanha, ItemRow, TipoPromocao } from './tipos.ts';

export type { CamposItem, ItemRow } from './tipos.ts';

export interface OperacaoRow {
  id: string; org_id: string; acao: Acao; promocao_id: string; promocao_tipo: TipoPromocao;
  promocao_status: 'pending' | 'started';   // ml_promocoes.status: futura ou ativa
}
/** Espelho em ml_promocao_itens: pending/started = participando; saiu = DEAL/LIGHTNING volta a candidate, SMART apaga a linha. */
export type Espelho = 'pending' | 'started' | 'saiu';
export interface DepsExecutar extends DepsLaco {
  ml: ClienteML;
  /** Semáforo no preço pedido com a projeção atual da Central; null = item sumiu da Central. */
  semaforoAtual(promocaoId: string, mlItemId: string, preco: number | null): Promise<Semaforo | null>;
  espelharStatusCentral(promocaoId: string, tipo: TipoPromocao, mlItemId: string, espelho: Espelho): Promise<void>;
  /** Preço aplicado na Central (preco_promo; líquido reprojetado nesse preço quando der). Best-effort. */
  espelharPreco(promocaoId: string, mlItemId: string, preco: number): Promise<void>;
  /** Recalcula ml_promocoes.contagem a partir das linhas da Central (mesma regra do sync). Best-effort. */
  recontarCentral(promocaoId: string): Promise<void>;
}

const RECONECTAR = 'Sem permissão de escrita em promoções — reconecte a conta do Mercado Livre em Canais';
const AGUARDANDO = 'Saída pedida ao ML; aguardando confirmação';
const SELLER_CENTER = 'O ML ainda não confirmou a saída. Confira no Seller Center.';
const PIOROU = 'O resultado piorou desde o preview';
const SAIU_DA_CENTRAL = 'O anúncio saiu da Central desde o preview';

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

const HORA_BRASILIA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
/** 'dd/mm hh:mm' em Brasília. Sem fuso (formato do spike: 2026-11-06T00:00:00) já é horário local: não converte. */
function quando(s: string): { dia: string; hora: string } | null {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s);
  if (m) return { dia: `${m[2]}/${m[1]}`, hora: `${m[3]}:${m[4]}` };
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const p = Object.fromEntries(HORA_BRASILIA.formatToParts(t).map((x) => [x.type, x.value]));
  return { dia: `${p.day}/${p.month}`, hora: `${p.hour}:${p.minute}` };
}
/** Janela atribuída pelo ML à Relâmpago: 'Agendada: 06/11 00:00–11:59'; null se faltar/não der para ler. */
export function mensagemJanela(inicio: string | null, fim: string | null): string | null {
  const a = inicio ? quando(inicio) : null;
  const b = fim ? quando(fim) : null;
  return a && b ? `Agendada: ${a.dia} ${a.hora}–${b.hora}` : null;
}
/** Status real na Central depois de aderir: o da campanha; ainda candidate (atraso do ML) → o da promoção. */
const espelhoAderido = (op: OperacaoRow, f: ItemNaCampanha | null): Espelho =>
  f?.status === 'pending' || f?.status === 'started' ? f.status : op.promocao_status;
// Espelho é best-effort: o item já está gravado; o sync da Central corrige depois.
const espelhar = (deps: DepsExecutar, op: OperacaoRow, id: string, e: Espelho) =>
  deps.espelharStatusCentral(op.promocao_id, op.promocao_tipo, id, e).catch(() => {});

const centavos = (n: number) => Math.round(n * 100);
const espelharPrecoSeguro = (deps: DepsExecutar, op: OperacaoRow, id: string, preco: number) =>
  deps.espelharPreco(op.promocao_id, id, preco).catch(() => {});

/**
 * Alterar o deal_price (emenda 2026-11-03, achados Codex P1): etapa durável + preço lido no ML ANTES do PUT (o
 * Reverter volta a ele; retry não sobrescreve); PUT com resultado incerto é conferido relendo o ML.
 */
async function alterarPreco(op: OperacaoRow, it: ItemRow, deps: DepsExecutar, fresco: ItemNaCampanha | null): Promise<void> {
  const id = it.ml_item_id;
  const d = decidir('alterar_preco', op.promocao_tipo, op.promocao_id,
    { ml_item_id: id, preco: it.preco, esperado: it.preco_esperado ?? null }, fresco, null);
  if (d.tipo === 'fim') {
    if (d.status !== 'ja_estava') return deps.gravarItem(op.id, id, { status: d.status, mensagem: d.mensagem });
    // Preço vivo = pedido (confirmado na leitura do ML). Com etapa gravada é a escrita desta operação recuperada
    // depois de um crash → aplicado (revertível); sem etapa, já estava assim antes.
    const recuperada = it.etapa === 'escrita_pedida';
    await gravarPos(deps.gravarItem(op.id, id, recuperada
      ? { status: 'aplicado', mensagem: null, etapa: 'ml_confirmado' }
      : { status: 'ja_estava', mensagem: null }));
    return espelharPrecoSeguro(deps, op, id, it.preco!);
  }
  if (d.tipo !== 'put') throw new Error(`decisão inesperada para alterar preço: ${d.tipo}`);
  // Achado Codex P2: sem o preço vivo não há como reverter depois — não escreve.
  if (it.preco_anterior == null && fresco?.preco == null) {
    return deps.gravarItem(op.id, id, { status: 'erro', mensagem: 'O ML não informou o preço atual da oferta' });
  }

  if (!it.confirmado_risco) {
    const atual = await deps.semaforoAtual(op.promocao_id, id, it.preco);
    if (atual === null) return deps.gravarItem(op.id, id, { status: 'mudou', mensagem: SAIU_DA_CENTRAL });
    if (piorou(it.semaforo ?? 'verde', atual)) return deps.gravarItem(op.id, id, { status: 'mudou', mensagem: PIOROU });
  }

  await deps.gravarItem(op.id, id, it.preco_anterior == null
    ? { etapa: 'escrita_pedida', preco_anterior: fresco?.preco ?? null }
    : { etapa: 'escrita_pedida' });
  try {
    await deps.ml.put(id, d.body);
  } catch (e) {
    if (e instanceof SemEscritaPromocoes) throw e;
    // Recusa definitiva do ML (4xx que não é 429): o preço não mudou → erro com a mensagem do ML.
    const status = Number(/^ML (\d{3})/.exec(e instanceof Error ? e.message : '')?.[1]);
    if (status >= 400 && status < 500 && status !== 429) throw e;
    // Resultado incerto (timeout/5xx depois de o ML aplicar?): releitura com o preço novo = aplicado; senão
    // (achado Codex P1: o ML leva até ~15 s para refletir) o item fica `enviando` com a etapa e o retry reconfere —
    // o PUT é idempotente.
    const depois = await deps.ml.lerNaCampanha(op.promocao_id, op.promocao_tipo, id).catch(() => undefined);
    if (depois?.preco == null || centavos(depois.preco) !== centavos(it.preco!)) throw new FalhaPosEscrita(e);
  }
  await gravarPos(deps.gravarItem(op.id, id, { status: 'aplicado', mensagem: null, etapa: 'ml_confirmado' }));
  await espelharPrecoSeguro(deps, op, id, it.preco!);
}

async function processarItem(op: OperacaoRow, it: ItemRow, deps: DepsExecutar): Promise<void> {
  const { ml } = deps;
  const id = it.ml_item_id;
  // Achado Codex P1: na retomada de uma escrita (etapa gravada), falha de leitura não pode virar `erro` — o PUT pode
  // ter sido aplicado; o item fica `enviando` e o retry relê.
  const retomada = op.acao === 'alterar_preco' && it.etapa === 'escrita_pedida';
  const fresco = await ml.lerNaCampanha(op.promocao_id, op.promocao_tipo, id)
    .catch((e) => { throw retomada && !(e instanceof SemEscritaPromocoes) ? new FalhaPosEscrita(e) : e; });
  if (op.acao === 'alterar_preco') return alterarPreco(op, it, deps, fresco);
  // Relações só importam quando o item ainda é convidado (é aí que decidir bloqueia o par UP/catálogo).
  const convidado = op.acao === 'aderir' && fresco?.status === 'candidate';
  const relacoes = convidado ? await ml.lerRelacoes(id) : null;
  // Relâmpago: máximo, sugerido e stock.min só na visão por item; falha aqui lança → erro sem escrita.
  const oferta = convidado && op.promocao_tipo === 'LIGHTNING' ? await ml.lerOfertaNoItem(op.promocao_id, id) : null;
  const d = decidir(op.acao, op.promocao_tipo, op.promocao_id, { ml_item_id: id, preco: it.preco }, fresco, relacoes, oferta);

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
  if (op.promocao_tipo === 'LIGHTNING') {
    // Best-effort: o item já está aplicado; a janela é informativa.
    const o = await ml.lerOfertaNoItem(op.promocao_id, id).catch(() => null);
    const mensagem = o && mensagemJanela(o.inicio, o.fim);
    if (mensagem) await deps.gravarItem(op.id, id, { mensagem }).catch(() => {});
  }
  const depois = await ml.lerNaCampanha(op.promocao_id, op.promocao_tipo, id).catch(() => null);
  await espelhar(deps, op, id, espelhoAderido(op, depois));
  // Sem isto a Central mostrava o sugerido (e o líquido dele) até o sync do dia seguinte. Só DEAL/Relâmpago:
  // no SMART o POST manda só o offer_id e o preço é o do ML (achado Codex P1). O retry `ja_estava` (acima) não
  // espelha preço de propósito: a leitura do ML não traz o preço da oferta, e o item pode já participar com outro.
  if (it.preco != null && op.promocao_tipo !== 'SMART') await deps.espelharPreco(op.promocao_id, id, it.preco).catch(() => {});
}

export function executar(
  op: OperacaoRow, deps: DepsExecutar, opts: { limiteMs: number; lote: number; maxItens?: number },
): Promise<{ processados: number; continuou: boolean }> {
  // Sem permissão de escrita em promoções: nada mais passa nesta conta — encerra este e todos os restantes.
  return laco(op.id, deps, opts, (it) => processarItem(op, it, deps),
    { eh: (e) => e instanceof SemEscritaPromocoes, mensagem: RECONECTAR })
    .then(async (r) => {
      // Contagem do card da campanha ("Participando") acompanha o espelho — senão fica até o próximo sync.
      if (r.processados > 0) await deps.recontarCentral(op.promocao_id).catch(() => {});
      return r;
    });
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
    // Relâmpago: só a volta a candidate prova a saída; sumir da campanha (null) não confirma.
    const saiu = fresco !== undefined && (op.promocao_tipo === 'LIGHTNING'
      ? fresco?.status === 'candidate'
      : fresco === null || !ehParticipando(fresco.status));
    if (saiu) {
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
  if (confirmados > 0) await deps.recontarCentral(op.promocao_id).catch(() => {});
  return { confirmados, pendentes: restantes.length };
}
