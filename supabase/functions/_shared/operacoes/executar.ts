// ADR-0174 — executor de promoções do motor de operações em massa (o laço comum vive em laco.ts) e conferência
// agendada da saída (200 do DELETE ≠ saiu; DEAL leva de 30 min a horas para sair, SMART ~30 s — spike).
import { ehParticipando } from '../promocoes/projecao.ts';
import type { Semaforo } from '../promocoes/tipos.ts';
import { decidir, piorou } from './decidir.ts';
import { agendarOuConcluir, FalhaPosEscrita, gravarPos, laco, mensagemDe, type DepsLaco } from './laco.ts';
import { type ClienteML, SemEscritaPromocoes } from './ml.ts';
import { type Acao, type CamposItem, type ItemNaCampanha, type ItemRow, ofertaFixaNova, type TipoPromocao } from './tipos.ts';

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
  /** Preço aplicado na Central (preco_promo; líquido reprojetado nesse preço quando der). Best-effort.
   *  `estados`: status da linha que aceitam o espelho (padrão: participando). */
  espelharPreco(promocaoId: string, mlItemId: string, preco: number, estados?: string[]): Promise<void>;
  /** Recalcula ml_promocoes.contagem a partir das linhas da Central (mesma regra do sync). Best-effort. */
  recontarCentral(promocaoId: string): Promise<void>;
  /** Ofertas fixas: outra operação aderiu a este item há pouco (`candidate` ainda não prova nada). */
  adesaoRecente(promocaoId: string, mlItemId: string): Promise<boolean>;
  /** Ofertas fixas: grava `campos` (etapa, ou o desfecho sem escrita) só se o item segue `enviando` sem etapa; false =
   *  outro worker já escreveu, escreve ou concluiu. */
  adquirirEscrita(operacaoId: string, mlItemId: string, campos: Partial<CamposItem>): Promise<boolean>;
}

const RECONECTAR = 'Sem permissão de escrita em promoções — reconecte a conta do Mercado Livre em Canais';
const AGUARDANDO = 'Saída pedida ao ML; aguardando confirmação';
const SELLER_CENTER = 'O ML ainda não confirmou a saída. Confira no Seller Center.';
const PIOROU = 'O resultado piorou desde o preview';
const SAIU_DA_CENTRAL = 'O anúncio saiu da Central desde o preview';
const ADESAO_SEM_CONFIRMACAO = 'Não foi possível confirmar a adesão no ML. Confira no Seller Center.';
const ADESAO_RECENTE = 'Adesão recente ainda propagando no ML. Aguarde alguns minutos e tente de novo.';
/** Ofertas fixas: releituras da adesão incerta, uma por continuação de 150 s → ~13 min, bem acima do atraso de ~2 min. */
const TENTATIVAS_ADESAO = 5;

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
/** Ofertas fixas ainda em candidate (atraso de ~2 min): o status do item é o do tipo, não o da campanha (spike). */
const ESPELHO_OFERTA: Partial<Record<TipoPromocao, Espelho>> = { SMART_LIGHTNING: 'pending', PRICE_MATCHING: 'started' };
/** Status real na Central depois de aderir: o lido no ML; ainda candidate (atraso do ML) → o do tipo; DEAL → `pending`
 *  (aguardando o ML: na Black Friday 12/11 ficou horas em candidate após o 200); demais → o da promoção. */
const espelhoAderido = (op: OperacaoRow, f: ItemNaCampanha | null): Espelho =>
  f?.status === 'pending' || f?.status === 'started' ? f.status
    : ESPELHO_OFERTA[op.promocao_tipo] ?? (op.promocao_tipo === 'DEAL' ? 'pending' : op.promocao_status);
// Espelho é best-effort: o item já está gravado; o sync da Central corrige depois.
const espelhar = (deps: DepsExecutar, op: OperacaoRow, id: string, e: Espelho) =>
  deps.espelharStatusCentral(op.promocao_id, op.promocao_tipo, id, e).catch(() => {});

const centavos = (n: number) => Math.round(n * 100);
const espelharPrecoSeguro = (deps: DepsExecutar, op: OperacaoRow, id: string, preco: number) =>
  deps.espelharPreco(op.promocao_id, id, preco).catch(() => {});

/** Recusa definitiva do ML (4xx que não é 429): nada foi escrito. */
const recusaDefinitiva = (e: unknown) => {
  const status = Number(/^ML (\d{3})/.exec(e instanceof Error ? e.message : '')?.[1]);
  return status >= 400 && status < 500 && status !== 429;
};
/** Escrita de oferta fixa com etapa gravada: recusa clara vira erro. O resto é incerto: sem lançar, o item fica `enviando`,
 *  `finalizar` continua e a retomada confere (500 aqui mataria a mensagem com 4 timeouts seguidos). */
const escritaIncerta = (id: string, e: unknown) => {
  if (e instanceof SemEscritaPromocoes || recusaDefinitiva(e)) return false;
  console.warn('[operacoes] escrita incerta', { ml_item_id: id, erro: mensagemDe(e) });
  return true;
};

/** Saída confirmada: o novo convite pode ter outro preço e o sync é 1×/dia. O preço vem ANTES do status: espelharPreco
 *  só grava em linha participando, e o espelho `saiu` a devolve a candidate. */
async function espelharSaida(deps: DepsExecutar, op: OperacaoRow, id: string, f: ItemNaCampanha | null | undefined) {
  if (ofertaFixaNova(op.promocao_tipo) && f?.preco != null) await espelharPrecoSeguro(deps, op, id, f.preco);
  await espelhar(deps, op, id, 'saiu');
}

/** Saída aceita (ou incerta) → escada de conferência. */
function aguardarSaida(deps: DepsExecutar, op: OperacaoRow, id: string): Promise<void> {
  const agora = deps.agora();
  return gravarPos(deps.gravarItem(op.id, id, {
    status: 'saida_solicitada', mensagem: AGUARDANDO, conferencias: 0, saida_pedida_em: iso(agora),
    proxima_conferencia: iso(agora + proximoIntervalo(0, 0)! * 1000),
  }));
}

/**
 * Oferta fixa com etapa gravada: o POST/DELETE pode ter sido aceito, então nunca escreve de novo. `candidate` logo
 * depois do POST é o atraso do ML; depois do DELETE é a saída (o item participava quando a etapa foi gravada).
 */
async function retomarOfertaFixa(op: OperacaoRow, it: ItemRow, deps: DepsExecutar): Promise<void> {
  const id = it.ml_item_id;
  // Leitura falha = sem prova, como item fora da campanha: aderir gasta tentativa, sair vai para a escada de 24 h.
  const fresco = await deps.ml.lerNaCampanha(op.promocao_id, op.promocao_tipo, id)
    .catch((e) => { if (e instanceof SemEscritaPromocoes) throw e; return null; });
  if (op.acao === 'sair') {
    if (fresco?.status !== 'candidate') return aguardarSaida(deps, op, id);
    await gravarPos(deps.gravarItem(op.id, id, { status: 'aplicado', mensagem: null, etapa: 'ml_confirmado' }));
    return espelharSaida(deps, op, id, fresco);
  }
  if (fresco !== null && ehParticipando(fresco.status)) {
    await gravarPos(deps.gravarItem(op.id, id, {
      status: 'aplicado', mensagem: null, etapa: 'ml_confirmado', ...(fresco.offer_id ? { offer_id: fresco.offer_id } : {}),
    }));
    await espelhar(deps, op, id, espelhoAderido(op, fresco));
    if (it.preco != null) await espelharPrecoSeguro(deps, op, id, it.preco);
    return;
  }
  // ponytail: o laço não conta tentativas; `conferencias` (sem uso em aderir) conta, como no reajuste.
  const conferencias = it.conferencias + 1;
  // Esgotou: a etapa fica gravada; é ela que faz adesaoRecente segurar uma nova operação (a adesão segue incerta).
  if (conferencias >= TENTATIVAS_ADESAO) {
    return deps.gravarItem(op.id, id, { status: 'erro', mensagem: ADESAO_SEM_CONFIRMACAO, conferencias });
  }
  // Sem lançar: esperar não é falha (500 gastaria os retries do QStash). O item fica `enviando` e `finalizar` continua.
  await gravarPos(deps.gravarItem(op.id, id, { conferencias }));
}

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
    // Recusa definitiva do ML: o preço não mudou → erro com a mensagem do ML.
    if (recusaDefinitiva(e)) throw e;
    // Resultado incerto (timeout/5xx depois de o ML aplicar?): releitura com o preço novo = aplicado; senão
    // (achado Codex P1: o ML leva até ~15 s para refletir) o item fica `enviando` com a etapa e o retry reconfere —
    // o PUT é idempotente.
    const depois = await deps.ml.lerNaCampanha(op.promocao_id, op.promocao_tipo, id).catch(() => undefined);
    if (depois?.preco == null || centavos(depois.preco) !== centavos(it.preco!)) throw new FalhaPosEscrita(e);
  }
  await gravarPos(deps.gravarItem(op.id, id, { status: 'aplicado', mensagem: null, etapa: 'ml_confirmado' }));
  await espelharPrecoSeguro(deps, op, id, it.preco!);
}

async function processarItem(op: OperacaoRow, it: ItemRow, deps: DepsExecutar, posse = { escrita: false }): Promise<void> {
  const { ml } = deps;
  const id = it.ml_item_id;
  // Achado Codex P1: na retomada de uma escrita (etapa gravada), falha de leitura não pode virar `erro` — o PUT pode
  // ter sido aplicado; o item fica `enviando` e o retry relê.
  const fixa = ofertaFixaNova(op.promocao_tipo);
  if (fixa && op.acao !== 'alterar_preco' && it.etapa === 'escrita_pedida') return retomarOfertaFixa(op, it, deps);
  const retomada = op.acao === 'alterar_preco' && it.etapa === 'escrita_pedida';
  // Desfecho antes da escrita: nas ofertas fixas só vale com a posse; worker atrasado não troca o resultado de quem escreveu.
  const encerrar = (campos: Partial<CamposItem>): Promise<boolean> => (fixa
    ? deps.adquirirEscrita(op.id, id, campos)
    : deps.gravarItem(op.id, id, campos).then(() => true));
  const adquirir = async (campos: Partial<CamposItem>) => (posse.escrita = await deps.adquirirEscrita(op.id, id, campos));
  const fresco = await ml.lerNaCampanha(op.promocao_id, op.promocao_tipo, id)
    .catch((e) => { throw retomada && !(e instanceof SemEscritaPromocoes) ? new FalhaPosEscrita(e) : e; });
  if (op.acao === 'alterar_preco') return alterarPreco(op, it, deps, fresco);
  // Relâmpago com um horário participando e outro convidado (emenda 2026-11-08 (2)): adere pelo convite. Na retomada,
  // CANDIDATE gravado diferente do aberto é outro horário que o operador não viu → segue o participando (Já estava).
  const extra = op.acao === 'aderir' && op.promocao_tipo === 'LIGHTNING' ? fresco?.convite : undefined;
  const alvo = extra && !(it.offer_id?.startsWith('CANDIDATE-') && it.offer_id !== extra.offer_id) ? extra : fresco;
  // Relações só importam quando o item ainda é convidado (é aí que decidir bloqueia o par UP/catálogo).
  const convidado = op.acao === 'aderir' && alvo?.status === 'candidate';
  const relacoes = convidado ? await ml.lerRelacoes(id) : null;
  // Relâmpago: máximo, sugerido e stock.min só na visão por item; falha aqui lança → erro sem escrita.
  const oferta = convidado && op.promocao_tipo === 'LIGHTNING' ? await ml.lerOfertaNoItem(op.promocao_id, id) : null;
  const d = decidir(op.acao, op.promocao_tipo, op.promocao_id, { ml_item_id: id, preco: it.preco }, alvo, relacoes, oferta);

  if (d.tipo === 'fim') {
    if (d.status !== 'ja_estava') {
      if (!(await encerrar({ status: d.status, mensagem: d.mensagem }))) return;
      // Oferta fixa com preço novo no ML: a Central (fonte do preview) recebe o preço vivo, senão toda nova
      // tentativa sai com o preço velho e cai em `mudou` de novo até o sync do dia seguinte.
      if (op.acao === 'aderir' && fixa && d.status === 'mudou' && fresco?.status === 'candidate' && fresco.preco != null) {
        await deps.espelharPreco(op.promocao_id, id, fresco.preco, ['candidate']).catch(() => {});
      }
      return;
    }
    // Retry depois de crash pós-escrita cai aqui: grava o offer_id do SMART e acerta o espelho.
    if (op.acao === 'aderir') {
      if (!(await encerrar({ status: 'ja_estava', mensagem: null, ...(fresco?.offer_id ? { offer_id: fresco.offer_id } : {}) }))) return;
      return espelhar(deps, op, id, espelhoAderido(op, fresco));
    }
    await deps.gravarItem(op.id, id, { status: 'ja_estava', mensagem: null });
    return espelhar(deps, op, id, 'saiu');
  }

  if (d.tipo === 'delete') {
    // Não adquiriu: outro worker escreve ou já escreveu; se ele morrer, o claim vencido traz o item de volta como retomada.
    if (fixa && !(await adquirir({ etapa: 'escrita_pedida', offer_id: fresco?.offer_id ?? null }))) return;
    try {
      await ml.del(id, d.query);
    } catch (e) {
      if (fixa && escritaIncerta(id, e)) return;
      throw e;
    }
    return aguardarSaida(deps, op, id);
  }

  // Decisão 5 do ADR: resultado pior que o do preview só entra com risco confirmado.
  if (!it.confirmado_risco) {
    const atual = await deps.semaforoAtual(op.promocao_id, id, it.preco);
    if (atual === null) { await encerrar({ status: 'mudou', mensagem: SAIU_DA_CENTRAL }); return; }
    // ponytail: semáforo gravado ausente conta como verde (qualquer piora barra).
    if (piorou(it.semaforo ?? 'verde', atual)) { await encerrar({ status: 'mudou', mensagem: PIOROU }); return; }
  }

  if (fixa) {
    if (await deps.adesaoRecente(op.promocao_id, id)) { await encerrar({ status: 'mudou', mensagem: ADESAO_RECENTE }); return; }
    if (!(await adquirir({ etapa: 'escrita_pedida' }))) return;
  }
  // Relâmpago: o convite usado fica gravado antes do POST; a retomada só posta de novo pelo mesmo convite.
  if (op.promocao_tipo === 'LIGHTNING' && alvo?.offer_id?.startsWith('CANDIDATE-')) {
    await deps.gravarItem(op.id, id, { offer_id: alvo.offer_id });
  }
  let resposta: Awaited<ReturnType<ClienteML['post']>>;
  try {
    resposta = await ml.post(id, d.body);
  } catch (e) {
    if (mensagemDe(e).includes('OFFER_SIBLING_CREATION_IN_PROCESS')) return inscritoPeloPrincipal(op, id, deps);
    if (fixa) {
      if (escritaIncerta(id, e)) return;
      // Recusa clara: nada foi escrito; sem isto adesaoRecente seguraria a nova tentativa como se a adesão propagasse.
      await deps.gravarItem(op.id, id, { etapa: null }).catch(() => {});
    }
    throw e;
  }
  const { offer_id, inicio, fim } = resposta;
  await gravarPos(deps.gravarItem(op.id, id, {
    status: 'aplicado', offer_id, mensagem: op.promocao_tipo === 'SMART_LIGHTNING' ? mensagemJanela(inicio, fim) : null,
    ...(fixa ? { etapa: 'ml_confirmado' as const } : {}),
  }));
  if (op.promocao_tipo === 'LIGHTNING') {
    // Best-effort: o item já está aplicado; a janela é informativa.
    const o = await ml.lerOfertaNoItem(op.promocao_id, id, offer_id).catch(() => null);
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

/** 400 OFFER_SIBLING_CREATION_IN_PROCESS (AVIL 09/11): o ML já cria esta oferta propagando a de um anúncio irmão
 *  (pai legado → cópias de catálogo). Não é erro: relê uma vez; ainda convidado → `bloqueado`, fora do "Tentar novamente". */
async function inscritoPeloPrincipal(op: OperacaoRow, id: string, deps: DepsExecutar): Promise<void> {
  // Falha na releitura sobe (achado Grok): vira `erro` retentável, e SemEscritaPromocoes para a conta como nas outras leituras.
  const f = await deps.ml.lerNaCampanha(op.promocao_id, op.promocao_tipo, id);
  // Relâmpago participando com convite de outro horário ainda aberto: o horário pedido não entrou (achado Codex).
  if (f && ehParticipando(f.status) && !f.convite) {
    // Oferta fixa: etapa limpa na mesma escrita — a retomada não confunde a propagação com adesão nossa (achado Codex).
    // Em `bloqueado` a etapa fica: é ela que segura outra adesão em adesaoRecente enquanto o ML propaga (achado Grok).
    await gravarPos(deps.gravarItem(op.id, id, {
      status: 'ja_estava', mensagem: 'Inscrito pelo ML junto com o anúncio principal',
      ...(ofertaFixaNova(op.promocao_tipo) ? { etapa: null } : {}),
    }));
    return espelhar(deps, op, id, espelhoAderido(op, f));
  }
  await gravarPos(deps.gravarItem(op.id, id, {
    status: 'bloqueado', mensagem: 'O ML está inscrevendo este anúncio pelo anúncio principal — atualize a Central em alguns minutos',
  }));
}

/** Oferta fixa: exceção antes de adquirir a escrita também só encerra com a posse (o laço gravaria `erro` por cima). */
async function processarOfertaFixa(op: OperacaoRow, it: ItemRow, deps: DepsExecutar): Promise<void> {
  const posse = { escrita: it.etapa != null };
  try {
    await processarItem(op, it, deps, posse);
  } catch (e) {
    if (posse.escrita) throw e;
    const fatal = e instanceof SemEscritaPromocoes;
    await gravarPos(deps.adquirirEscrita(op.id, it.ml_item_id, { status: 'erro', mensagem: fatal ? RECONECTAR : mensagemDe(e) }).then(() => {}));
    if (fatal) throw Object.assign(e, { jaGravado: true });
  }
}

export function executar(
  op: OperacaoRow, deps: DepsExecutar, opts: { limiteMs: number; lote: number; maxItens?: number },
): Promise<{ processados: number; continuou: boolean }> {
  // Sem permissão de escrita em promoções: nada mais passa nesta conta — encerra este e todos os restantes.
  const processar = ofertaFixaNova(op.promocao_tipo) ? processarOfertaFixa : processarItem;
  return laco(op.id, deps, opts, (it) => processar(op, it, deps),
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
    // Relâmpago e ofertas fixas: só a volta a candidate prova a saída; sumir da campanha (null) não confirma.
    const saiu = fresco !== undefined && (op.promocao_tipo === 'LIGHTNING' || ofertaFixaNova(op.promocao_tipo)
      ? fresco?.status === 'candidate'
      : fresco === null || !ehParticipando(fresco.status));
    if (saiu) {
      await deps.gravarItem(op.id, id, { status: 'aplicado', mensagem: null, proxima_conferencia: null });
      await espelharSaida(deps, op, id, fresco);
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
