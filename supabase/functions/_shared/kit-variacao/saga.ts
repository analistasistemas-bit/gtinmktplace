// ADR-0200: saga que move peças entre anúncios ML só com eles pausados (spec "Escrita de estoque com
// anúncio pausado"). Um passo por invocação do worker `kit-transferencia`; o que vale entre invocações
// é só o que ficou gravado em `kit_transferencias` e `kit_transferencia_alvos`.
//
// Regras que não podem quebrar:
// - Resultado incerto nunca reenvia PUT. Só a recusa 4xx (gravada) permite repetir, até 5 vezes.
// - Nada aumenta oferta antes de todas as reduções confirmadas por leitura (invariante 3). A fase de cada
//   alvo sai do sinal de `valor_alvo − ML lido`, não de origem/destino: local à frente do ML é aumento.
// - Todo PUT é precedido por releitura: identidade, um local só, pausa vigente, quantidade igual à do cálculo.
// - Toda gravação passa por RPC que exige o token e o prazo da execução e a posse da exclusão; e a
//   execução para sozinha antes do prazo, para não fazer efeito remoto depois que outra pegou o claim.
// - A saga só reativa o que ela pausou, nunca item moderado, e só com a política autorizando na hora.
// - Travada mantém a exclusão: o UP segue ocupado até o operador resolver.
// - Destino sem item (`criar`, SKU de kit novo): o CREATE é o passo `aumentar`, com o saldo no payload, só
//   depois de todas as reduções confirmadas. Busca por SKU antes de todo POST; criação incerta nunca reenvia.
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
  /** Início do problema que pede alerta no passo atual (carência); avançar zera. */
  alerta_desde?: string | null;
  /** Último alerta escalonado enviado: dedup, e a marca do "resolvido" no aviso de fim. */
  alerta_enviado?: string | null;
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
  /** Pagos já incorporados a `qtd_passo1` (baixados no ML e localmente, provado no passo 1): fora da reserva. */
  pagos_passo1?: string[] | null;
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
  /** Pelo sinal de `valor_alvo − valor_anterior`, gravado uma vez no cálculo. `nenhuma` não escreve e confirma com as reduções. */
  fase: 'reducao' | 'aumento' | 'nenhuma' | null;
  /** `estoque_movimentos.ordem` lida sob o lock do saldo no cálculo; vira a marca d'água do SKU na confirmação. */
  marca_ordem: number | null;
  /** Destino sem item (SKU de kit novo): `up_id` é sintético (`criar:<codigo>`) até o CREATE gravar estes dois. */
  criar: boolean;
  up_criado: string | null;
  item_criado: string | null;
}

export type BuscaItemCriado =
  | { tipo: 'nenhum' } | { tipo: 'ambiguo' } | { tipo: 'um'; itemId: string; upId: string };

/** Saldo do SKU com o efeito local pendente desde a marca d'água (`kit_saga_conferir_saldo`). */
export interface SaldoConferido {
  saldo: number;
  /** Nula: o SKU nunca teve valor confirmado pela saga. */
  marca: number | null;
  pendente: number;
  ordem: number;
}

type Fase = 'reducao' | 'aumento';
/** Redução e `nenhuma` andam juntas: as duas precisam de leitura igual ao alvo antes de qualquer aumento. */
const naFase = (a: AlvoSaga, f: Fase) => (f === 'aumento' ? a.fase === 'aumento' : a.fase !== 'aumento');

export interface ResultadoImportacao {
  pagos: PedidoPago[];
  naoPagos: PedidoPendente[];
  falhas: string[];
  baixas: Array<{ orderId: string; resultado: Pick<ResultadoBaixaVenda, 'vendaAcimaSaldo' | 'desyncMl'> }>;
}

export interface PatchTransferencia {
  passo?: PassoSaga;
  alerta?: string;
  travar?: boolean;
  /** Grava só se ainda não houver início (o primeiro vale). */
  alertaDesde?: string;
  limparAlertaDesde?: boolean;
  alertaEnviado?: string;
}

/** Portas estreitas: o worker liga no Supabase e no ML; o teste, em memória. */
export interface DepsSaga {
  repo: {
    /** Claim atômico com prazo, só em transferência `ativa`. */
    reivindicar(id: string, token: string, prazoS: number): Promise<boolean>;
    carregar(id: string): Promise<{ transferencia: TransferenciaSaga; alvos: AlvoSaga[] }>;
    // As cinco abaixo validam token, prazo, estado `ativa` e exclusão no banco, e lançam se não valer.
    salvarTransferencia(id: string, token: string, patch: PatchTransferencia): Promise<void>;
    salvarAlvo(id: string, token: string, upId: string, patch: Partial<AlvoSaga>): Promise<void>;
    /**
     * Estado final e exclusões numa transação. `pausas`: itens que esta saga pausou e deixou pausados pela política;
     * viram pausa da automação (Task 14), a única que a reposição desfaz.
     */
    finalizar(
      id: string, token: string, estado: 'concluida' | 'abortada', alerta: string | null,
      pausas?: Array<{ codigo: string; itemId: string }>,
    ): Promise<void>;
    ledger(id: string, token: string, op: 'reservar' | 'creditar' | 'cancelar'): Promise<{ ok: boolean; motivo?: string }>;
    /** Política dos alvos travada, versão igual à da criação e SKU sem bloqueio. */
    podeReativar(id: string, token: string, codigo: string): Promise<boolean>;
    liberar(id: string, token: string): Promise<void>;
    /** Soma das versões de `sku_politica_kit` dos códigos, a mesma da criação. */
    versaoPolitica(codigos: string[]): Promise<number>;
    /** Task 14: códigos em Guardado. Pausa que fica em Guardado é o esperado: sem alerta. Ausente = nenhum. */
    guardados?(codigos: string[]): Promise<Set<string>>;
    /** Saldo travado, marca d'água e efeito pendente do SKU; valida token, prazo e exclusão. */
    conferirSaldo(id: string, token: string, codigo: string): Promise<SaldoConferido>;
    /** Vínculo local do item criado (raiz e filho do anúncio, família publicada). Idempotente. `ok:false` (ex.:
     * `family_id` diferente dos irmãos) trava a saga. */
    registrarItem(codigo: string, itemId: string, upId: string): Promise<{ ok: boolean; motivo?: string }>;
  };
  ml: {
    /** Lança erro com `buscaVazia: true` quando a busca por UP não traz item nenhum (indexação logo depois do CREATE). */
    lerOferta(upId: string, esperados: string[]): Promise<OfertaUP>;
    /** Leitura direta dos itens (`GET /items`), sem a busca por UP; lança se algum não for do UP. */
    lerItens(upId: string, ids: string[]): Promise<OfertaUP['itens']>;
    listarPendentes(): Promise<PedidoPendente[]>;
    /** `antesDeBaixar` roda logo antes de cada baixa e lança se o prazo venceu. */
    importarPedidos(itemIds: string[], desde: string, idsPasso1: string[], antesDeBaixar: () => void): Promise<ResultadoImportacao>;
    putQuantidade(itemId: string, quantidade: number): Promise<void>;
    putStatus(itemId: string, status: 'paused' | 'active'): Promise<void>;
    /**
     * Prepara o CREATE do item do SKU de kit (foto, guia de tamanhos, payload com `available_quantity = quantidade`)
     * e devolve o POST, que a saga só chama depois de gravar a intenção. Erro do POST com `status` 4xx é recusa.
     */
    prepararItem(codigo: string, quantidade: number): Promise<() => Promise<{ itemId: string; upId: string }>>;
    /** Item do SKU já criado no ML (SKU + `family_name` do kit). */
    buscarItemCriado(codigo: string): Promise<BuscaItemCriado>;
  };
  enfileirar(id: string, delayS: number): Promise<void>;
  /** `chave`: alerta escalonado, idempotente por (transferência, texto) — o notificador com chave lança em falha. */
  alertar(texto: string, chave?: string): Promise<void>;
  /** Aviso de "estoque zerado" (ADR-0134) dos SKUs cuja redução para 0 a saga acabou de confirmar no ML. */
  avisarZerados?(codigos: string[]): Promise<void>;
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
/**
 * Carência do alerta escalonado: problema que some sozinho (pausa que o ML aplica segundos depois, busca do UP ainda
 * indexando o item novo, pedido que baixa na tentativa seguinte) não vai ao Telegram nem ao app. Uma só para tudo,
 * contada do início do problema (`alerta_desde`, ou a intenção do CREATE na pausa do item criado).
 */
export const CARENCIA_ALERTA_MS = 3 * 60_000;
/** Ainda tentando depois disto, a transferência está bloqueada de fato: o texto deixa de ser de espera. */
export const BLOQUEIO_MS = 15 * 60_000;
/** Criação incerta: quanto tempo a busca por SKU tem para mostrar o item antes de travar (indexação do ML). */
export const JANELA_BUSCA_CRIADO_MS = 15 * 60_000;
/** Folga mínima de prazo para gravar a intenção e postar: sem ela, o corte do prazo vira criação incerta. */
const FOLGA_CRIAR_MS = 60_000;
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
async function salvarTransferencia(ctx: Ctx, patch: PatchTransferencia): Promise<void> {
  vivo(ctx);
  await ctx.deps.repo.salvarTransferencia(ctx.t.id, ctx.token, patch);
}
async function ledger(ctx: Ctx, op: 'reservar' | 'creditar' | 'cancelar') {
  vivo(ctx);
  return await ctx.deps.repo.ledger(ctx.t.id, ctx.token, op);
}
async function finalizar(
  ctx: Ctx, estado: 'concluida' | 'abortada', alerta: string | null, pausas?: Array<{ codigo: string; itemId: string }>,
): Promise<void> {
  vivo(ctx);
  await ctx.deps.repo.finalizar(ctx.t.id, ctx.token, estado, alerta, pausas);
}
async function putStatus(ctx: Ctx, itemId: string, status: 'paused' | 'active'): Promise<void> {
  vivo(ctx);
  await ctx.deps.ml.putStatus(itemId, status);
}
async function conferirSaldo(ctx: Ctx, codigo: string): Promise<SaldoConferido> {
  vivo(ctx);
  return await ctx.deps.repo.conferirSaldo(ctx.t.id, ctx.token, codigo);
}

/**
 * Spec "Divergência entre ledger e ML": local − ML tem de ser exatamente o efeito local pendente (entrada,
 * ajuste, estorno e transferência depois da marca). Sem marca, o pendente é só o desta transferência, então
 * a saga exige local igual ao ML. Nunca ajusta por ledger − ML: o que não se explica trava.
 */
function divergencia(alvo: AlvoSaga, c: SaldoConferido, ml: number): string | null {
  if (c.saldo - ml === c.pendente) return null;
  return `${alvo.codigo}: divergência sem explicação entre ledger e ML (local ${c.saldo}, ML ${ml}, efeito pendente ${c.pendente}`
    + `${c.marca === null ? ', SKU sem marca: exige local igual ao ML' : ''})`;
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

/** UP e itens reais do alvo: no alvo `criar`, os do item criado (vazio antes do CREATE). */
const upDe = (a: AlvoSaga) => (a.criar ? a.up_criado : a.up_id);
const itensDe = (a: AlvoSaga) => (a.criar ? (a.item_criado ? [a.item_criado] : []) : a.item_ids);
function ler(ctx: Ctx, alvo: AlvoSaga): Promise<OfertaUP> {
  const up = upDe(alvo);
  if (!up) throw new Error(`${alvo.codigo}: item do kit ainda não criado`);
  return ctx.deps.ml.lerOferta(up, itensDe(alvo));
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
  if (o.upId !== upDe(alvo)) return `${alvo.codigo}: leitura de outro UP (${o.upId})`;
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
async function alertar(ctx: Ctx, texto: string, chave?: string): Promise<boolean> {
  try {
    await ctx.deps.alertar(texto, chave);
    return true;
  } catch (e) {
    console.error(`kit-transferencia ${ctx.t.id}: alerta não enviado: ${mensagem(e)}: ${texto}`);
    return false;
  }
}

async function mudar(ctx: Ctx, passo: PassoSaga, delayS: number, patch: Omit<PatchTransferencia, 'passo'> = {}): Promise<void> {
  await salvarTransferencia(ctx, { passo, ...patch });
  vivo(ctx);
  await ctx.deps.enfileirar(ctx.t.id, delayS);
}

/** Avançar (inclusive para o mesmo passo, entre um CREATE e outro) encerra o problema: a carência recomeça. */
async function avancar(ctx: Ctx, passo: PassoSaga, delayS = 0): Promise<ResultadoPasso> {
  await mudar(ctx, passo, delayS, { limparAlertaDesde: true });
  return { passo, acao: 'avancou' };
}

async function reagendar(ctx: Ctx, motivo: string, delayS = REAGENDAR_S): Promise<ResultadoPasso> {
  await mudar(ctx, ctx.t.passo, delayS, { alerta: motivo });
  return { passo: ctx.t.passo, acao: 'reagendada', motivo };
}

/**
 * Reagendamento com alerta escalonado. Antes de `CARENCIA_ALERTA_MS` nada sai; até `BLOQUEIO_MS`, texto de espera;
 * depois, "bloqueada". Cada texto sai uma vez (dedup por `alerta_enviado`): espera → bloqueada manda de novo, e o
 * motivo que muda (faixa de tempo da pausa) também. `desdeMs`: início do problema quando o alvo já o tem gravado.
 */
async function reagendarComAlerta(
  ctx: Ctx, motivo: string, delayS: number, espera: string, desdeMs?: number,
): Promise<ResultadoPasso> {
  const agora = ctx.deps.agora().getTime();
  const gravado = Date.parse(ctx.t.alerta_desde ?? '');
  const desde = desdeMs ?? (Number.isNaN(gravado) ? agora : gravado);
  const decorrido = agora - desde;
  const texto = decorrido < CARENCIA_ALERTA_MS ? null
    : decorrido < BLOQUEIO_MS ? `${espera}: ${motivo}.` : `Transferência de kit bloqueada: ${motivo}.`;
  await mudar(ctx, ctx.t.passo, delayS, { alerta: motivo, alertaDesde: new Date(desde).toISOString() });
  // Marca só depois do envio: falha na fila ou no Telegram deixa o alerta pendente para a próxima tentativa, e o
  // "resolvido" nunca fala de alerta que não saiu. Falha ao gravar a marca só repete o alerta; não derruba o passo.
  // Com chave: falha de leitura/gravação lança (sem marca, a próxima tentativa reenvia) e a repetição não duplica.
  if (texto !== null && texto !== ctx.t.alerta_enviado && await alertar(ctx, texto, `kit_alerta:${ctx.t.id}:${hashTexto(texto)}`)) {
    await salvarTransferencia(ctx, { alertaEnviado: texto })
      .catch((e) => console.error(`kit-transferencia ${ctx.t.id}: marca do alerta não gravada: ${mensagem(e)}`));
  }
  return { passo: ctx.t.passo, acao: 'reagendada', motivo };
}

const ESPERA = 'Transferência de kit em espera (tentando de novo)';

/** FNV-1a 32 bits: chave curta e estável por texto de alerta. */
function hashTexto(t: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
}

/** Sem reenvio e sem soltar a exclusão: a peça fica sem oferta até o operador resolver. */
async function travar(ctx: Ctx, motivo: string): Promise<ResultadoPasso> {
  await salvarTransferencia(ctx, { travar: true, alerta: motivo });
  await alertar(ctx, `Transferência de kit travada no passo ${ctx.t.passo}: ${motivo}. O anúncio fica pausado até alguém resolver.`);
  return { passo: ctx.t.passo, acao: 'travada', motivo };
}

/**
 * Política mudou antes da reserva: devolve a peça, se uma invocação anterior chegou a reservar, e não reativa. O que a
 * saga pausou vira pausa da automação (Task 14): a reposição desfaz conforme a política vigente (ex.: desligar no meio).
 */
async function abortarSemReativar(ctx: Ctx, motivo: string): Promise<ResultadoPasso> {
  const r = await ledger(ctx, 'cancelar');
  if (!r.ok) throw new Error(`cancelar: ${r.motivo}`);
  await finalizar(ctx, 'abortada', motivo,
    ctx.alvos.flatMap((a) => a.pausado_pela_saga.map((itemId) => ({ codigo: a.codigo, itemId }))));
  await alertar(ctx, `Transferência de kit abortada: ${motivo}. Nada foi reativado.`);
  return { passo: 'fim', acao: 'abortada', motivo };
}

async function politicaMudou(ctx: Ctx): Promise<boolean> {
  return (await ctx.deps.repo.versaoPolitica(ctx.alvos.map((a) => a.codigo))) !== ctx.t.versao_politica;
}

const MOTIVO_POLITICA = 'a política de um SKU mudou durante a transferência';

async function pausar(ctx: Ctx): Promise<ResultadoPasso> {
  if (await politicaMudou(ctx)) return abortarSemReativar(ctx, MOTIVO_POLITICA);
  const ofertas: Array<OfertaUP | null> = [];
  let pausou = false;
  for (const alvo of ctx.alvos) {
    // Item ainda não existe: nada a pausar nem a conciliar. Nasce na fase de aumento.
    if (alvo.criar) { ofertas.push(null); continue; }
    const oferta = await ler(ctx, alvo);
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
  // Tudo calculado antes de gravar: baixa que falhou não deixa snapshot com coorte vazia para sempre. O passo 1 não
  // avança; a próxima invocação relê a oferta e refaz o passo inteiro.
  const passo1: Array<{ alvo: AlvoSaga; patch: Partial<AlvoSaga> }> = [];
  for (const [i, alvo] of ctx.alvos.entries()) {
    const oferta = ofertas[i];
    const ids = oferta ? idsDoItem(oferta.itens.map((x) => x.id), pendentes) : [];
    const pagos = oferta ? await pagosIncorporados(ctx, alvo, oferta, agora, ids) : [];
    if ('falhas' in pagos) return reagendarComAlerta(ctx, `pedidos sem baixa no passo 1: ${pagos.falhas.join('; ')}`, REAGENDAR_S, ESPERA);
    passo1.push({ alvo, patch: { qtd_passo1: oferta?.quantidade ?? 0, passo1_em: agora, ids_passo1: ids, pagos_passo1: pagos } });
  }
  for (const { alvo, patch } of passo1) await salvarAlvo(ctx, alvo, patch);
  return avancar(ctx, 'aguardar', ctx.deps.quarentenaS);
}

/** Depois da importação o sync-venda vê a referência aplicada e não alerta mais: alerta aqui. */
async function alertarBaixas(ctx: Ctx, imp: ResultadoImportacao): Promise<void> {
  for (const { orderId, resultado } of imp.baixas) {
    for (const v of resultado.vendaAcimaSaldo) {
      await alertar(ctx, `Kit: venda acima do saldo em ${v.codigo} (pedido ${orderId}): pedia ${v.pedido}, havia ${v.anterior}.`);
    }
    for (const v of resultado.desyncMl) {
      await alertar(ctx, `Kit: ML vendeu ${v.codigo} com o PubliAI em zero (pedido ${orderId}).`);
    }
  }
}

/**
 * Pagos que a leitura do passo 1 já contém. Prova: todos os pagos do item baixados localmente (importação sem
 * falha) e o saldo local, já com essas baixas, fechando com a quantidade lida no ML (`divergencia` nula). Então
 * o ML também já tinha descontado cada um, e a conciliação não os reserva de novo: sem isso, um pago dentro da
 * margem de `pagosDesde` e já baixado nunca solta, porque a queda desde o passo 1 é zero. Baixa que falhou
 * devolve as falhas e o passo 1 não avança. Divergência sem falha: nenhum, e o pago segue bloqueando. Id pendente no passo 1 fica de fora (a cobertura por id cuida dele).
 */
async function pagosIncorporados(
  ctx: Ctx, alvo: AlvoSaga, oferta: OfertaUP, passo1: string, ids: string[],
): Promise<string[] | { falhas: string[] }> {
  const imp = await ctx.deps.ml.importarPedidos(
    oferta.itens.map((i) => i.id), new Date(Date.parse(passo1) - JANELA_PEDIDOS_MS).toISOString(), ids, () => vivo(ctx));
  await alertarBaixas(ctx, imp);
  if (imp.falhas.length > 0) return { falhas: imp.falhas };
  if (divergencia(alvo, await conferirSaldo(ctx, alvo.codigo), oferta.quantidade)) return [];
  return imp.pagos.map((o) => String(o.id)).filter((id) => !ids.includes(id));
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
    if (alvo.criar) {
      // Sem item, o ML tem 0: o local também precisa ter (efeito pendente desta transferência à parte).
      const div = divergencia(alvo, await conferirSaldo(ctx, alvo.codigo), 0);
      if (div) return travar(ctx, div);
      continue;
    }
    const oferta = await ler(ctx, alvo);
    const problema = problemaDaOferta(alvo, oferta, true);
    if (problema) return travar(ctx, problema);

    const passo1 = Date.parse(alvo.passo1_em ?? '');
    if (Number.isNaN(passo1) || !alvo.ids_passo1) throw new Error(`${alvo.codigo}: sem passo 1 gravado`);
    const itemIds = oferta.itens.map((i) => i.id);
    // A importação baixa estoque: o prazo é conferido antes de cada baixa, não só na entrada.
    const imp = await ctx.deps.ml.importarPedidos(
      itemIds, new Date(passo1 - JANELA_PEDIDOS_MS).toISOString(), alvo.ids_passo1, () => vivo(ctx));
    await alertarBaixas(ctx, imp);
    if (imp.falhas.length > 0) return reagendarComAlerta(ctx, `pedidos sem baixa: ${imp.falhas.join('; ')}`, REAGENDAR_S, ESPERA);

    const reserva = calcularReserva({
      itemIds,
      pendentes: [...pendentes, ...imp.naoPagos],
      // Só a coorte provada no passo 1 sai; pago sem baixa naquela hora continua reservando.
      pagosRecentes: pagosDesde(
        imp.pagos.filter((o) => !(alvo.pagos_passo1 ?? []).includes(String(o.id))),
        new Date(passo1 - MARGEM_PAGOS_MS).toISOString(),
      ),
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
    // Antes de reservar: divergência sem explicação trava sem mover peça.
    const div = divergencia(alvo, await conferirSaldo(ctx, alvo.codigo), oferta.quantidade);
    if (div) return travar(ctx, div);
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
    await mudar(ctx, 'reativar', 0, { alerta: `reserva recusada: ${r.motivo}`, limparAlertaDesde: true });
    return { passo: 'reativar', acao: 'avancou', motivo: r.motivo };
  }

  // Valor final gravado uma vez: na origem, o saldo local já sem a reserva; no destino, o local mais o que chega.
  // Local à frente do ML é efeito local pendente (entrada, ajuste, estorno): vira aumento, nunca antes das reduções.
  for (const alvo of pendentes) {
    let ml = 0;
    if (!alvo.criar) {
      const oferta = await ler(ctx, alvo);
      const problema = problemaDaOferta(alvo, oferta, true);
      if (problema) return travar(ctx, problema);
      ml = oferta.quantidade;
    }
    // Depois da reserva o pendente inclui o próprio kit_saida, e o saldo também: a conta segue fechando.
    const c = await conferirSaldo(ctx, alvo.codigo);
    const div = divergencia(alvo, c, ml);
    if (div) return travar(ctx, div);
    const valorAlvo = alvo.papel === 'destino' ? c.saldo + alvo.delta : c.saldo;
    if (valorAlvo < 0) return travar(ctx, `${alvo.codigo}: valor final negativo (${valorAlvo})`);
    // Item novo com 0 não existe no ML: o CREATE exige saldo inicial.
    if (alvo.criar && valorAlvo <= 0) return travar(ctx, `${alvo.codigo}: item novo sem saldo a criar (${valorAlvo})`);
    const fase = valorAlvo < ml ? 'reducao' : valorAlvo > ml ? 'aumento' : 'nenhuma';
    await salvarAlvo(ctx, alvo, { valor_anterior: ml, valor_alvo: valorAlvo, fase, marca_ordem: c.ordem });
  }
  return avancar(ctx, 'reduzir');
}

/** `reduzir` e `aumentar`. Intenção gravada antes do PUT; com intenção e sem recusa, nunca reenvia. */
async function escrever(ctx: Ctx, fase: Fase, proximo: PassoSaga): Promise<ResultadoPasso> {
  if (fase === 'aumento') {
    const solta = ctx.alvos.find((a) => naFase(a, 'reducao') && !a.confirmada_em);
    if (solta) return travar(ctx, `${solta.codigo}: redução não confirmada antes do aumento`);
  }
  const recusas: string[] = [];
  for (const alvo of ctx.alvos.filter((a) => naFase(a, fase))) {
    if (alvo.confirmada_em || alvo.valor_alvo === null || alvo.valor_alvo === alvo.valor_anterior) continue;
    if (alvo.criar) {
      const r = await criarDestino(ctx, alvo);
      // Um CREATE por invocação: cada um sobe foto, monta o payload e posta, e o prazo é de 120 s.
      if (r === 'criou' && ctx.alvos.some((a) => a.criar && !a.item_criado)) return avancar(ctx, ctx.t.passo, 0);
      if (r !== 'pronto' && r !== 'criou') return r;
      continue;
    }
    if (alvo.intencao_escrita_em && !alvo.recusa_definitiva_em) continue;

    // A pausa e a quantidade valem para esta escrita, não para a do cálculo.
    const oferta = await ler(ctx, alvo);
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

/**
 * CREATE do item do SKU de kit (exceção da spec: saldo inicial no payload, depois das reduções confirmadas).
 * Busca por SKU antes de todo POST: achou, adota. Criação incerta (intenção sem recusa) nunca posta de novo:
 * espera a busca mostrar o item até `JANELA_BUSCA_CRIADO_MS` e depois trava. Só a recusa 4xx deixa repetir.
 * Criado ou adotado: registra o vínculo local e pausa (item em `pausado_pela_saga` antes do PUT); a
 * confirmação lê a quantidade e a reativação devolve o item, se a política deixar. `escrita_em` só é gravado
 * depois do registro e da pausa: é o marcador para a próxima invocação não refazer o que já fez.
 */
async function criarDestino(ctx: Ctx, alvo: AlvoSaga): Promise<'criou' | 'pronto' | ResultadoPasso> {
  if (alvo.item_criado && alvo.escrita_em) return 'pronto';
  let criou = false;
  if (!alvo.item_criado) {
    const busca = await ctx.deps.ml.buscarItemCriado(alvo.codigo);
    if (busca.tipo === 'ambiguo') return travar(ctx, `${alvo.codigo}: busca por SKU ambígua; nenhum item novo é criado`);
    if (busca.tipo === 'um') {
      await salvarAlvo(ctx, alvo, {
        item_criado: busca.itemId, up_criado: busca.upId,
        pausado_pela_saga: [...new Set([...alvo.pausado_pela_saga, busca.itemId])],
        // Início da obrigação de pausa (backoff e alerta escalonado contam daqui).
        intencao_escrita_em: alvo.intencao_escrita_em ?? iso(ctx),
      });
    } else if (alvo.intencao_escrita_em && !alvo.recusa_definitiva_em) {
      if (ctx.deps.agora().getTime() - Date.parse(alvo.intencao_escrita_em) < JANELA_BUSCA_CRIADO_MS) {
        return reagendar(ctx, `${alvo.codigo}: criação incerta, procurando o item antes de qualquer nova tentativa`);
      }
      return travar(ctx, `${alvo.codigo}: criação incerta e o item não apareceu na busca; nenhum outro é criado`);
    } else {
      // Foto, guia e payload antes da intenção: o que demora não come o prazo entre a intenção e o POST.
      // Falha aqui não foi ao ML: reagenda com alerta (as peças já saíram dos individuais e estão sem oferta).
      let postar: () => Promise<{ itemId: string; upId: string }>;
      try {
        postar = await ctx.deps.ml.prepararItem(alvo.codigo, alvo.valor_alvo!);
      } catch (e) {
        return reagendarComAlerta(ctx, `${alvo.codigo}: não foi possível preparar o item: ${mensagem(e)}`, REAGENDAR_S, ESPERA);
      }
      if (ctx.limite - ctx.deps.agora().getTime() < FOLGA_CRIAR_MS) return avancar(ctx, ctx.t.passo, 0);
      await salvarAlvo(ctx, alvo, { intencao_escrita_em: iso(ctx), recusa_definitiva_em: null });
      let criado: { itemId: string; upId: string };
      try {
        vivo(ctx);
        criado = await postar();
      } catch (e) {
        if (!recusaDefinitiva(e)) {
          return reagendar(ctx, `${alvo.codigo}: criação incerta (${mensagem(e)}); a próxima tentativa só procura o item`);
        }
        const n = alvo.recusas + 1;
        await salvarAlvo(ctx, alvo, { recusa_definitiva_em: iso(ctx), recusas: n });
        if (n >= MAX_RECUSAS) return travar(ctx, `${alvo.codigo}: ML recusou criar o item ${n} vezes: ${mensagem(e)}`);
        return reagendarComAlerta(ctx, `${alvo.codigo}: ML recusou criar o item: ${mensagem(e)}`, REAGENDAR_S, ESPERA);
      }
      await salvarAlvo(ctx, alvo, {
        item_criado: criado.itemId, up_criado: criado.upId,
        pausado_pela_saga: [...new Set([...alvo.pausado_pela_saga, criado.itemId])],
      });
      criou = true;
    }
  }
  // O ML cria ativo. Antes de qualquer passo local que possa falhar, TODOS os itens abertos do UP criado (o item e
  // a cópia de catálogo que o ML anexar) são pausados e confirmados pela leitura (`paused_by_seller`). A obrigação
  // é durável: `item_criado` sem `escrita_em` faz toda retomada repetir isto, e falha ou recusa do registro nunca
  // deixa item vendável. Cada item entra em `pausado_pela_saga` antes do PUT; a reativação segue a política.
  // O principal (já em `pausado_pela_saga`) é pausado antes de qualquer leitura: a descoberta do UP pode lançar logo
  // depois do CREATE (stock, multiget). Toda falha desta obrigação, inclusive de leitura, entra no backoff com
  // alerta escalonado, nunca no reagendamento genérico. Exceção: a busca por UP vazia (o ML leva segundos para
  // indexar o item novo). Aí a pausa do principal se confirma por leitura direta do item (o id veio no POST) e,
  // pausado, a saga espera a busca no mesmo backoff, com a mesma carência de alerta: as cópias de catálogo só
  // aparecem na busca, então nada é registrado antes dela.
  const abertosSoltos = (itens: ItemOferta[]) => itens.filter((i) => !encerrado(i) && !moderado(i) && !pausadoPeloVendedor(i));
  let indexando = false;
  const lerCriado = async () => {
    if (!indexando) {
      try {
        return (await ler(ctx, alvo)).itens;
      } catch (e) {
        if ((e as { buscaVazia?: unknown } | null)?.buscaVazia !== true) throw e;
        indexando = true;
      }
    }
    return ctx.deps.ml.lerItens(alvo.up_criado!, [alvo.item_criado!]);
  };
  // A pausa antecipada do principal é best-effort: recusada (ex.: `closed`) ou falha, a descoberta segue para pausar
  // as cópias. O que decide o registro é a leitura: nenhum item aberto sem `paused_by_seller` (closed não vende).
  // Erro por item: nenhuma falha (PUT recusado, gravação local) impede tentar os demais itens abertos. Os erros se
  // acumulam no alerta; só a leitura decide o registro.
  const erros: string[] = [];
  const tentados = new Set<string>();
  const pausar = async (id: string) => {
    tentados.add(id);
    try {
      await putStatus(ctx, id, 'paused');
    } catch (e) {
      erros.push(`${id}: ${mensagem(e)}`);
    }
  };
  await pausar(alvo.item_criado!);
  let ainda: string[];
  try {
    const soltos = abertosSoltos(await lerCriado()).map((i) => i.id);
    const novos = soltos.filter((id) => !alvo.pausado_pela_saga.includes(id));
    if (novos.length > 0) {
      // Sem a gravação, a pausa vale assim mesmo: item pausado fora de `pausado_pela_saga` só não é reativado.
      try {
        await salvarAlvo(ctx, alvo, { pausado_pela_saga: [...alvo.pausado_pela_saga, ...novos] });
      } catch (e) {
        erros.push(`pausado_pela_saga: ${mensagem(e)}`);
      }
    }
    for (const id of soltos) if (!tentados.has(id)) await pausar(id);
    ainda = soltos.length > 0 ? abertosSoltos(await lerCriado()).map((i) => i.id) : [];
  } catch (e) {
    erros.push(`leitura do UP: ${mensagem(e)}`);
    ainda = [alvo.item_criado!];
  }
  const comErros = erros.length > 0 ? ` (${erros.join('; ')})` : '';
  if (ainda.length > 0) return aguardarPausaCriada(ctx, alvo, `${ainda.join(', ')}${comErros} ainda vendável`);
  if (indexando) {
    return aguardarPausaCriada(ctx, alvo,
      `${alvo.item_criado} pausado, mas busca do UP ainda sem o item: cópias de catálogo não conferidas${comErros}`);
  }
  vivo(ctx);
  const reg = await ctx.deps.repo.registrarItem(alvo.codigo, alvo.item_criado!, alvo.up_criado!);
  if (!reg.ok) return travar(ctx, `${alvo.codigo}: item ${alvo.item_criado} criado (pausado), mas ${reg.motivo}`);
  await salvarAlvo(ctx, alvo, { escrita_em: iso(ctx) });
  return criou ? 'criou' : 'pronto';
}

/** Backoff da pausa do item criado que o ML não aplica, pelo tempo desde a intenção: 5 s, 30 s, 60 s e 5 min (teto). */
export function atrasoPausaCriada(decorridoMs: number): number {
  const min = decorridoMs / 60_000;
  return min < 1 ? CONFIRMAR_APOS_S : min < 5 ? 30 : min < 15 ? REAGENDAR_S : 300;
}

function decorridoPausa(ctx: Ctx, alvo: AlvoSaga): number {
  const inicio = Date.parse(alvo.intencao_escrita_em ?? '');
  return Number.isNaN(inicio) ? 0 : Math.max(0, ctx.deps.agora().getTime() - inicio);
}

/**
 * Pausa do item criado (ou busca do UP) ainda não confirmada: a obrigação continua (nada é registrado), com backoff.
 * Carência e espera/bloqueada de `reagendarComAlerta`, contadas da intenção do CREATE; depois da carência o alerta se
 * repete a cada faixa de tempo (1, 5 e 15 min, depois a cada hora), porque o motivo muda com a faixa.
 */
function aguardarPausaCriada(ctx: Ctx, alvo: AlvoSaga, detalhe: string): Promise<ResultadoPasso> {
  const decorrido = decorridoPausa(ctx, alvo);
  const min = Math.floor(decorrido / 60_000);
  const faixa = min < 1 ? 'agora' : min < 5 ? 'há 1 min' : min < 15 ? 'há 5 min' : min < 60 ? 'há 15 min'
    : `há ${Math.floor(min / 60)} h`;
  return reagendarComAlerta(ctx, `${alvo.codigo}: pausa do item criado não confirmada (${detalhe}, ${faixa})`,
    atrasoPausaCriada(decorrido), 'Aguardando o Mercado Livre confirmar a pausa do anúncio novo do kit (tentando de novo)',
    ctx.deps.agora().getTime() - decorrido);
}

/** Leitura igual ao valor gravado conclui. Outro número, inclusive o anterior, trava (spec, passo 6). */
async function confirmar(ctx: Ctx, fase: Fase, proximo: PassoSaga): Promise<ResultadoPasso> {
  for (const alvo of ctx.alvos.filter((a) => naFase(a, fase) && !a.confirmada_em)) {
    if (alvo.criar && !alvo.item_criado) return travar(ctx, `${alvo.codigo}: confirmação sem item criado`);
    const oferta = await ler(ctx, alvo);
    const problema = problemaDaOferta(alvo, oferta, true);
    if (problema) return travar(ctx, problema);
    if (oferta.quantidade !== alvo.valor_alvo) {
      return travar(ctx, `${alvo.codigo}: ML com ${oferta.quantidade}, esperado ${alvo.valor_alvo}, anterior ${alvo.valor_anterior}`);
    }
    await salvarAlvo(ctx, alvo, { confirmada_em: iso(ctx) });
  }
  if (fase === 'reducao') {
    // Só depois da leitura que confirmou o zero: o push tira esses SKUs do aviso. Nunca derruba o passo; a marca
    // `alertado_em` deduplica a reentrega.
    const zerados = ctx.alvos.filter((a) => naFase(a, 'reducao') && a.confirmada_em && a.valor_alvo === 0).map((a) => a.codigo);
    if (zerados.length > 0) {
      await ctx.deps.avisarZerados?.(zerados)
        .catch((e) => console.error(`kit-transferencia ${ctx.t.id}: aviso de zerado falhou: ${mensagem(e)}`));
    }
  }
  if (fase === 'aumento') {
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
  const seguem: Array<{ codigo: string; itemId: string }> = [];
  let repausou = false;
  const semObrigacao = (alvo: AlvoSaga, id: string) => salvarAlvo(ctx, alvo, { repausar: alvo.repausar.filter((x) => x !== id) });

  for (const alvo of ctx.alvos) {
    if (alvo.pausado_pela_saga.length === 0 && alvo.repausar.length === 0) continue;
    const oferta = await ler(ctx, alvo);
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
          seguem.push({ codigo: alvo.codigo, itemId: item.id });
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
        seguem.push({ codigo: alvo.codigo, itemId: item.id });
        await repausar(ctx, item.id);
        repausou = true;
      }
    }
  }
  // A repausa só vale confirmada pela leitura; até lá, finalizar recusa.
  if (repausou) return reagendar(ctx, 'confirmando a repausa', CONFIRMAR_APOS_S);

  // Task 14: Guardado pausado é o objetivo (Vender só em kit), não anomalia; os demais bloqueios alertam.
  const guardados = seguem.length > 0 && ctx.deps.repo.guardados
    ? await ctx.deps.repo.guardados([...new Set(seguem.map((x) => x.codigo))])
    : new Set<string>();
  const inesperados = seguem.filter((x) => !guardados.has(x.codigo)).map((x) => x.itemId);
  // Concluída não guarda motivo velho de reagendamento (o Gerenciar kit mostraria aviso resolvido); abortada mantém.
  let alerta = estado === 'concluida' ? null : ctx.t.alerta;
  if (inesperados.length > 0) {
    alerta = `política não autoriza reativar: ${inesperados.join(', ')} seguem pausados`;
    await alertar(ctx, `Transferência de kit terminou, mas ${alerta}.`);
  }
  await finalizar(ctx, estado, alerta, seguem);
  return { passo: 'fim', acao: estado === 'concluida' ? 'concluida' : 'abortada' };
}

const PASSOS: Record<PassoSaga, (ctx: Ctx) => Promise<ResultadoPasso>> = {
  pausar,
  aguardar,
  conciliar,
  calcular,
  reduzir: (ctx) => escrever(ctx, 'reducao', 'confirmar_reducao'),
  confirmar_reducao: (ctx) => confirmar(ctx, 'reducao', 'aumentar'),
  aumentar: (ctx) => escrever(ctx, 'aumento', 'confirmar_aumento'),
  confirmar_aumento: (ctx) => confirmar(ctx, 'aumento', 'reativar'),
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
