// Enriquecimento dos catálogos da busca no SW (Revisão 03/11-b, Task 11.3: lote por página): cache do navegador por
// identidade (chrome.storage.session; metadados 6 h, ofertas 60 s, perfis 24 h, frete 6 h, expirações do servidor) e o planejamento
// da página (deduplicada por catálogo; só os componentes vencidos vão à edge). Funções puras + I/O mínima do cache.
import { epocaAtual } from './abas';
import type { CardBusca } from './leitura/busca';
import type { MetadadosCardBusca } from '../../supabase/functions/_shared/extensao/busca.ts';
import type { ComissaoML, Disponivel } from '../../supabase/functions/_shared/extensao/tipos.ts';
import {
  chaveFrete, ehReputacao, esperaDaNovaTentativa, freteParaTentar,
  type CatalogoVista, type EstadoEnriquecimento, type ExataVista, type FreteVista, type Medalha, type OfertasOk, type Reputacao, type VendedorVista,
} from './compartilhado/enriquecimento';

// Contrato de `enriquecer_catalogos_busca` (_shared/extensao/enriquecimento-busca.ts, relatório da Task 11.2). Copiado e
// não importado: aquele módulo puxa roteamento.ts/redis (Deno) para o tsc da extensão.
export type Componente = 'produto' | 'ofertas';
export interface CatalogoPedido { catalogProductId: string; componentes: Componente[]; itens: { itemId: string; preco: number }[] }
type IndEdge = { estado: 'indisponivel'; motivo: string };
type OfertaExataEdge =
  | { itemId: string; estado: 'ok'; categoriaId: string | null; sellerId: number | null; tipo: 'gold_special' | 'gold_pro' | null;
    perfil: 'carregado' | 'no_navegador' | 'indisponivel' | null; comissaoNaSuaConta: Disponivel<ComissaoML> }
  | { itemId: string; estado: 'nao_encontrada'; motivo: string };
export interface RespostaEnriquecimento {
  consultadoEm: string;
  catalogos: {
    /** indisponivel = nada consultado (cota de páginas, Redis fora), com `motivo`. */
    catalogProductId: string; estado: 'ok' | 'indisponivel'; motivo?: string; retomarEm: null; consultadoEm: string | null;
    produto?: { estado: 'ok'; criadoEm: string | null; marca?: string | null; expiraEm: string } | IndEdge;
    ofertas?: { estado: 'ok'; expiraEm: string; total: number | null; lidas: number; vendedoresIdentificados: number; ofertasSemVendedor: number;
      completa: boolean; exatas: OfertaExataEdge[] } | IndEdge;
  }[];
  vendedores: (
    | { sellerId: number; estado: 'ok'; nome: string | null; medalha: Medalha | null; uf: string | null; cidade?: string | null; reputacao?: Reputacao | null; expiraEm: string }
    | ({ sellerId: number } & IndEdge)
  )[];
  /** Só quando o pedido trouxe `fretes` (edge >= fatia 2.1). expiraEm só no ok. */
  fretes?: { itemId: string; preco: number; frete: { estado: 'ok'; valor: number } | IndEdge; expiraEm: string | null }[];
  custo: { comandosRedis: number; chamadasMl: number };
  /** Maior Retry-After dos 429 da rodada (ISO); null = sem. Só vale para o "Tentar novamente". */
  tentarAposEm?: string | null;
  /** Impressão opaca da conta ML (edge ≥ fatia 2); ausente em edge antiga. */
  conta?: string;
}

// = limites da edge (extensao/roteamento.ts, Revisão 03/11-b): passar deles é 400 na página inteira.
export const MAX_CATALOGOS_LOTE = 50;
export const MAX_ITENS_CATALOGO = 50;
export const MAX_ITENS_LOTE = 50;
export const MAX_PERFIS_PEDIDO = 50;
export const MAX_FRETES_PEDIDO = 50;
const MAX_PERFIS_EM_CACHE = 100;

// ---------------------------------------------------------------- cache
const CHAVE = 'enr:cache'; // prefixo `enr` apagado por limparEstadosDasAbas (saída, identidade, suporte, sessão inválida)
const TETO = 5 * 1024 * 1024; // storage.session tem 10 MiB para tudo (inclui o estado das abas)
const ALVO = 4 * 1024 * 1024;

type Entrada<T> = { v: T; exp: number; u: number };
type VendedorOk = Extract<VendedorVista, { estado: 'ok' }>;
/** Formato do cache (fatia 2.1: marca, cidade, reputação e frete). Outra versão = descartado inteiro. */
export const VERSAO_CACHE = 2;
export interface CacheEnr {
  versao?: number;
  /** Isolamento: identidade + conta ML. Todos os mapas (frete incluso) são desta identidade e desta conta. */
  identidade: string;
  /** Impressão da conta ML da última resposta (null = ainda não vista). */
  conta: string | null;
  produtos: Record<string, { criadoEm: string | null; marca?: string | null; exp: number; u: number }>;
  ofertas: Record<string, Entrada<OfertasOk>>;
  vendedores: Record<string, Entrada<VendedorOk>>;
  /** Por chaveFrete (item + preço exato + CEP): valor cotado. */
  fretes: Record<string, Entrada<number>>;
}
const vazio = (identidade: string): CacheEnr => ({ versao: VERSAO_CACHE, identidade, conta: null, produtos: {}, ofertas: {}, vendedores: {}, fretes: {} });
const MAPAS = ['produtos', 'ofertas', 'vendedores', 'fretes'] as const;
/** Mapas vazios (conta não confirmada, conta trocada): nada de outra conta é reutilizado. */
export const semDados = (c: CacheEnr): CacheEnr => ({ ...c, produtos: {}, ofertas: {}, vendedores: {}, fretes: {} });

function semExpirados(c: CacheEnr, agora: number): CacheEnr {
  for (const m of MAPAS) for (const [k, e] of Object.entries(c[m])) if (!(e.exp > agora)) delete c[m][k];
  return c;
}

/** Cache da identidade (vazio se de outra, ausente ou ilegível), sem os expirados. Falha de storage = sem cache. */
export async function lerCache(identidade: string, agora = Date.now()): Promise<CacheEnr> {
  try {
    const c = (await chrome.storage.session.get(CHAVE))[CHAVE] as CacheEnr | undefined;
    if (!c || c.versao !== VERSAO_CACHE || c.identidade !== identidade || MAPAS.some((m) => typeof c[m] !== 'object' || c[m] === null)) return vazio(identidade);
    return semExpirados({ ...c, produtos: { ...c.produtos }, ofertas: { ...c.ofertas }, vendedores: { ...c.vendedores }, fretes: { ...c.fretes } }, agora);
  } catch {
    return vazio(identidade);
  }
}

let fila: Promise<unknown> = Promise.resolve();
/** Ler-modificar-gravar serializado (abas concorrentes no mesmo SW). Descarta expirados; acima de ~5 MiB tira os menos
 *  usados até ~4 MiB. Falha de gravação = segue sem cache.
 *  ponytail: uma chave só (o mapa inteiro é regravado a cada lote); DTO mínimo mantém isso em KBs por busca. */
export function gravarCache(identidade: string, mudar: (c: CacheEnr) => void, agora = Date.now()): Promise<void> {
  const epoca = epocaAtual();
  const r = fila.then(async () => {
    const c = await lerCache(identidade, agora);
    mudar(c);
    let tamanho = JSON.stringify(c).length;
    if (tamanho > TETO) {
      const todas = MAPAS.flatMap((m) => Object.entries(c[m] as Record<string, { u: number }>).map(([k, e]) => ({ m, k, u: e.u, n: JSON.stringify(e).length + k.length })))
        .sort((a, b) => a.u - b.u);
      for (const e of todas) {
        if (tamanho <= ALVO) break;
        delete (c[e.m] as Record<string, unknown>)[e.k];
        tamanho -= e.n;
      }
    }
    await chrome.storage.session.set({ [CHAVE]: c });
    // Logout/pausa durante o set (sair sobe a época antes do 1º await): a limpeza já passou — apaga de novo.
    if (epoca !== epocaAtual()) await chrome.storage.session.remove(CHAVE);
  }).catch(() => {});
  fila = r;
  return r;
}

// ---------------------------------------------------------------- planejamento
export interface PedidoLote {
  catalogos: CatalogoPedido[]; perfis: number[]; perfisEmCache: number[];
  /** Fretes vencidos (item do card ao preço do card); vazio = a chave não vai à edge (pedido igual ao da 0.5.0). */
  fretes?: { itemId: string; preco: number }[];
}

/** Corpo do `enriquecer_catalogos_busca`: `fretes` só quando há (lista vazia sem catálogos/perfis é 400 na edge). */
export function corpoDoPedido(p: PedidoLote): object {
  const { fretes, ...resto } = p;
  return fretes?.length ? { ...resto, fretes } : resto;
}

/** Marcas do que um pedido levou, para `jaPedidos` (nada se repete dentro da rodada). */
export function marcasDoPedido(p: PedidoLote): string[] {
  return [
    ...p.catalogos.flatMap((c) => [...c.componentes.map((x) => `${x}:${c.catalogProductId}`), ...c.itens.map((i) => `item:${i.itemId}`)]),
    ...p.perfis.map((s) => `perfil:${s}`),
    ...(p.fretes ?? []).map((f) => `frete:${chaveFrete(f.itemId, f.preco)}`),
  ];
}
export interface Plano {
  /** Vindo do cache: aplicar na vista da aba (sem edge, sem cota). */
  hits: { catalogos: Record<string, CatalogoVista>; vendedores: Record<string, VendedorVista>; fretes: Record<string, FreteVista>; usados: { m: (typeof MAPAS)[number]; k: string }[] };
  pedido: PedidoLote | null;
}

/** Ainda não pedido (o legado `aguardando` vira ausente em enriquecimentoDe). ok e indisponível são terminais. */
const precisa = (v: { estado: string } | undefined) => !v;

/** Itens do card que a leitura de ofertas precisa cobrir (preço legível; a comissão é do preço exato). */
const cobre = (o: OfertasOk, itens: { itemId: string; preco: number }[]) => itens.every((i) => o.exatas[i.itemId]?.preco === i.preco);

/** A página inteira num pedido (≤ 50 catálogos, ≤ 50 itens, ≤ 50 perfis = limites da edge); o excedente fica para o
 *  pedido seguinte da mesma rodada. Só o que falta na vista e não está válido no cache vai à edge. */
export function planejarLote(
  cards: Pick<CardBusca, 'itemId' | 'catalogProductId' | 'preco' | 'identidadeConflitante'>[],
  metadados: Record<string, MetadadosCardBusca | undefined>,
  enr: EstadoEnriquecimento, cache: CacheEnr, agora: number,
  /** marcasDoPedido já pedidas nesta rodada: não repetem (sem laço dentro da rodada). */
  jaPedidos: Set<string>,
): Plano {
  const hits: Plano['hits'] = { catalogos: {}, vendedores: {}, fretes: {}, usados: [] };
  // Fila deduplicada por catálogo: próprios/vinculados primeiro, depois a ordem observada.
  const prioridade = (c: { itemId: string }) => (metadados[c.itemId]?.proprio === true || metadados[c.itemId]?.vinculo ? 0 : 1);
  const itensPorCat = new Map<string, { itemId: string; preco: number }[]>();
  const ordem: string[] = [];
  const priorizados = cards.map((c, i) => ({ c, i })).sort((a, b) => prioridade(a.c) - prioridade(b.c) || a.i - b.i).map((x) => x.c);
  for (const c of priorizados) {
    if (!c.catalogProductId || c.identidadeConflitante) continue;
    if (!itensPorCat.has(c.catalogProductId)) { itensPorCat.set(c.catalogProductId, []); ordem.push(c.catalogProductId); }
    const itens = itensPorCat.get(c.catalogProductId)!;
    if (typeof c.preco === 'number' && c.preco > 0 && !itens.some((i) => i.itemId === c.itemId)) itens.push({ itemId: c.itemId, preco: c.preco });
  }
  const valida = <T extends { exp: number }>(e: T | undefined) => (e && e.exp > agora ? e : undefined);
  const vistas = (cat: string): CatalogoVista => ({ ...enr.catalogos[cat], ...hits.catalogos[cat] });

  const catalogos: CatalogoPedido[] = [];
  let itensLote = 0, cheio = false;
  for (const cat of ordem) {
    const itens = itensPorCat.get(cat)!;
    const v = vistas(cat);
    let produto = precisa(v.produto);
    // Itens ainda sem oferta exata (nem tentativa terminal) ao preço do card: scroll, preço novo, 51º em diante. Leitura
    // nova = todos. Ofertas indisponíveis valem só para os itens/preços já tentados: o delta novo vai.
    const ja = exatasAnteriores(v.ofertas);
    let pendentes = itens.filter((i) => ja[i.itemId]?.preco !== i.preco);
    let ofertas = precisa(v.ofertas) || pendentes.length > 0;
    const hit: CatalogoVista = {};
    const p = valida(cache.produtos[cat]);
    if (produto && p) { hit.produto = { estado: 'ok', criadoEm: p.criadoEm, marca: p.marca ?? null }; hits.usados.push({ m: 'produtos', k: cat }); produto = false; }
    const o = valida(cache.ofertas[cat]);
    if (ofertas && o && cobre(o.v, pendentes)) {
      hit.ofertas = { ...o.v, exatas: { ...ja, ...o.v.exatas } };
      hits.usados.push({ m: 'ofertas', k: cat });
      ofertas = false;
      pendentes = [];
    }
    if (hit.produto || hit.ofertas) hits.catalogos[cat] = hit;
    const novos = pendentes.filter((i) => !jaPedidos.has(`item:${i.itemId}`)).slice(0, MAX_ITENS_CATALOGO);
    const pedirProduto = produto && !jaPedidos.has(`produto:${cat}`);
    const pedirOfertas = ofertas && (novos.length > 0 || (pendentes.length === 0 && !jaPedidos.has(`ofertas:${cat}`)));
    const componentes = [pedirProduto && 'produto', pedirOfertas && 'ofertas'].filter(Boolean) as Componente[];
    if (componentes.length === 0) continue;
    const enviar = pedirOfertas ? novos : [];
    if (cheio || catalogos.length === MAX_CATALOGOS_LOTE || itensLote + enviar.length > MAX_ITENS_LOTE) { cheio = true; continue; }
    catalogos.push({ catalogProductId: cat, componentes, itens: enviar });
    itensLote += enviar.length;
  }

  // Perfis dos vendedores das ofertas exatas já lidas (os do pedido a edge acrescenta sozinha, deduplicados).
  const noLote = new Set(catalogos.filter((c) => c.componentes.includes('ofertas')).map((c) => c.catalogProductId));
  const conhecidos = new Set<number>();
  const faltam: number[] = [];
  for (const cat of ordem) {
    const v = vistas(cat);
    if (v.ofertas?.estado !== 'ok' || noLote.has(cat)) continue;
    for (const e of Object.values(v.ofertas.exatas) as ExataVista[]) {
      if (e.estado !== 'ok' || e.sellerId === null || conhecidos.has(e.sellerId)) continue;
      const k = String(e.sellerId);
      conhecidos.add(e.sellerId);
      if (!precisa(hits.vendedores[k] ?? enr.vendedores[k])) continue;
      const c = valida(cache.vendedores[k]);
      if (c) { hits.vendedores[k] = c.v; hits.usados.push({ m: 'vendedores', k }); continue; }
      if (!jaPedidos.has(`perfil:${k}`)) faltam.push(e.sellerId);
    }
  }
  const perfis = faltam.slice(0, MAX_PERFIS_PEDIDO);

  // Frete: componente próprio de QUALQUER card com preço (catálogo ou não), pelo item do card ao preço do card. Só o que
  // falta na vista e não está válido no cache (6 h); ofertas vencidas (60 s) não recotam frete válido. Vai junto do
  // pedido normal; sozinho só quando nada mais está vencido.
  const fretes: { itemId: string; preco: number }[] = [];
  const vistos = new Set<string>();
  for (const c of priorizados) {
    if (c.identidadeConflitante || typeof c.preco !== 'number' || !(c.preco > 0)) continue;
    const k = chaveFrete(c.itemId, c.preco);
    if (vistos.has(k)) continue;
    vistos.add(k);
    if (enr.fretes?.[k]) continue;
    const f = valida(cache.fretes[k]);
    if (f) { hits.fretes[k] = { estado: 'ok', valor: f.v }; hits.usados.push({ m: 'fretes', k }); continue; }
    if (!jaPedidos.has(`frete:${k}`) && fretes.length < MAX_FRETES_PEDIDO) fretes.push({ itemId: c.itemId, preco: c.preco });
  }

  if (catalogos.length === 0 && perfis.length === 0 && fretes.length === 0) return { hits, pedido: null };
  // Com perfil válido aqui, a edge não consulta de novo.
  const emCache = new Set<number>();
  for (const [k, v] of [...Object.entries(enr.vendedores), ...Object.entries(hits.vendedores)]) if (v.estado === 'ok') emCache.add(Number(k));
  for (const [k, e] of Object.entries(cache.vendedores)) if (valida(e)) emCache.add(Number(k));
  return { hits, pedido: { catalogos, perfis, perfisEmCache: [...emCache].filter((s) => Number.isInteger(s) && s > 0).slice(0, MAX_PERFIS_EM_CACHE), fretes } };
}

/** Hits do cache → vista da aba (muta `enr`). */
export function aplicarHits(enr: EstadoEnriquecimento, hits: Plano['hits']): void {
  for (const [cat, h] of Object.entries(hits.catalogos)) enr.catalogos[cat] = { ...enr.catalogos[cat], ...h };
  for (const [k, v] of Object.entries(hits.vendedores)) enr.vendedores[k] = v;
  if (Object.keys(hits.fretes).length) enr.fretes = { ...enr.fretes, ...hits.fretes };
}

// ---------------------------------------------------------------- resposta
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const MOTIVO_PADRAO = 'catálogo indisponível';
const MOTIVO_LIMITE = 'limite do Mercado Livre'; // = MOTIVO.limiteMl da edge
const MOTIVO_FRETE_PADRAO = 'frete indisponível';
const textoOuNull = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
/** Rodada sem resposta da edge (rede/5xx/corpo fora do formato). */
export const MOTIVO_FALHA_REDE = 'falha de rede';
const motivoDe = (x: unknown, padrao: string) => {
  const m = (x as { motivo?: unknown } | undefined)?.motivo;
  return typeof m === 'string' ? m : padrao;
};

/** Ofertas pedidas e não lidas (terminal). Catálogo já lido (delta do scroll): a leitura anterior fica e só os itens
 *  pedidos ficam indisponíveis; senão o componente inteiro. */
function ofertasIndisponiveis(v: CatalogoVista, itens: { itemId: string; preco: number }[], motivo: string): void {
  if (v.ofertas?.estado === 'ok') {
    const exatas = { ...v.ofertas.exatas };
    for (const i of itens) exatas[i.itemId] = { estado: 'indisponivel', preco: i.preco, motivo };
    v.ofertas = { ...v.ofertas, exatas };
  } else {
    // Lembra itens/preços tentados: item novo do mesmo catálogo ainda vai (delta); estes ficam terminais.
    const antes = v.ofertas?.estado === 'indisponivel' ? v.ofertas.itens : undefined;
    v.ofertas = { estado: 'indisponivel', motivo, itens: { ...antes, ...Object.fromEntries(itens.map((i) => [i.itemId, i.preco])) } };
  }
}

/** Ofertas exatas que a vista já tem do catálogo; das ofertas indisponíveis, os itens tentados (terminal, com o motivo). */
function exatasAnteriores(o: CatalogoVista['ofertas']): Record<string, ExataVista> {
  if (o?.estado === 'ok') return o.exatas;
  if (o?.estado !== 'indisponivel' || !o.itens) return {};
  const motivo = o.motivo ?? MOTIVO_PADRAO;
  return Object.fromEntries(Object.entries(o.itens).map(([id, preco]) => [id, { estado: 'indisponivel' as const, preco, motivo }]));
}

/** Rodada que não respondeu (rede/5xx/corpo fora do formato): o que ela pediu fica indisponível (sem repetição
 *  automática; o delta do scroll continua) e o painel oferece "Tentar novamente". Muta `enr`. */
export function marcarFalha(enr: EstadoEnriquecimento, pedido: PedidoLote, motivo: string): void {
  for (const pc of pedido.catalogos) {
    const v: CatalogoVista = { ...enr.catalogos[pc.catalogProductId] };
    if (pc.componentes.includes('produto')) v.produto = { estado: 'indisponivel', motivo };
    if (pc.componentes.includes('ofertas')) ofertasIndisponiveis(v, pc.itens, motivo);
    enr.catalogos[pc.catalogProductId] = v;
  }
  for (const s of pedido.perfis) enr.vendedores[String(s)] = { estado: 'indisponivel', motivo };
  if (pedido.fretes?.length) {
    enr.fretes = { ...enr.fretes };
    for (const f of pedido.fretes) enr.fretes[chaveFrete(f.itemId, f.preco)] = { estado: 'indisponivel', motivo };
  }
  enr.falhou = true;
}

export { haParaTentar } from './compartilhado/enriquecimento';

/** "Tentar novamente" (ação explícita): antes do Retry-After do ML → false, nada muda. Senão apaga todo indisponível
 *  (componentes, ofertas exatas sem comissão ou não lidas, vendedores, fretes) para o planejamento pedir de novo. Muta
 *  `enr`. Retry-After vindo só do frete segura só os fretes (o resto é refeito já). */
export function prepararNovaTentativa(enr: EstadoEnriquecimento, agora: number): boolean {
  if (esperaDaNovaTentativa(enr, agora) !== null) return false;
  const pausaFrete = enr.freteAposEm != null && agora < enr.freteAposEm;
  if (!pausaFrete && enr.fretes) {
    enr.fretes = Object.fromEntries(Object.entries(enr.fretes).filter(([, f]) => !freteParaTentar(f)));
    enr.freteAposEm = null;
  }
  for (const [cat, c] of Object.entries(enr.catalogos)) {
    const v: CatalogoVista = { ...c };
    if (v.produto && v.produto.estado !== 'ok') delete v.produto;
    if (v.ofertas?.estado === 'ok') {
      const exatas = Object.fromEntries(Object.entries(v.ofertas.exatas).filter(([, e]) => e.estado === 'nao_encontrada' || (e.estado === 'ok' && e.comissao.estado === 'ok')));
      v.ofertas = { ...v.ofertas, exatas };
    } else delete v.ofertas;
    enr.catalogos[cat] = v;
  }
  for (const [k, v] of Object.entries(enr.vendedores)) if (v.estado !== 'ok') delete enr.vendedores[k];
  enr.falhou = false;
  enr.tentarAposEm = null;
  enr.indisponivel = null;
  return true;
}

/** Resposta da edge → vista da aba (muta `enr`). Tudo terminal: ok, ou indisponível com o motivo (estado desconhecido de
 *  outra versão da edge também). Devolve o que gravar no cache (só o válido, com o `expiraEm` do servidor), para rodar
 *  na mesma checagem de identidade/época/página da vista. */
export function aplicarResposta(enr: EstadoEnriquecimento, pedido: PedidoLote, r: RespostaEnriquecimento, agora: number): (c: CacheEnr) => void {
  const escritas: ((c: CacheEnr) => void)[] = [];
  let limiteFora = false; // algum componente fora do frete parou no 429 do ML
  for (const c of r.catalogos ?? []) {
    const pc = pedido.catalogos.find((x) => x.catalogProductId === c.catalogProductId);
    if (!pc) continue;
    const cat = c.catalogProductId;
    const v: CatalogoVista = { ...enr.catalogos[cat] };
    // Catálogo inteiro recusado (cota de páginas, Redis fora) ou estado desconhecido: nada consultado.
    const recusado = c.estado !== 'ok' ? motivoDe(c, MOTIVO_PADRAO) : null;
    const p = recusado ? undefined : c.produto;
    if (p?.estado === 'ok') {
      const marca = textoOuNull(p.marca);
      v.produto = { estado: 'ok', criadoEm: p.criadoEm, marca };
      const exp = ms(p.expiraEm);
      escritas.push((x) => { x.produtos[cat] = { criadoEm: p.criadoEm, marca, exp, u: agora }; });
    } else if (p || pc.componentes.includes('produto')) {
      const motivo = recusado ?? motivoDe(p, MOTIVO_PADRAO);
      limiteFora ||= motivo === MOTIVO_LIMITE;
      v.produto = { estado: 'indisponivel', motivo };
    }
    const o = recusado ? undefined : c.ofertas;
    if (o?.estado === 'ok') {
      const preco = new Map(pc.itens.map((i) => [i.itemId, i.preco]));
      const exatas: Record<string, ExataVista> = {};
      for (const e of o.exatas) {
        const pr = preco.get(e.itemId);
        if (pr === undefined) continue;
        const cm = e.estado === 'ok' ? e.comissaoNaSuaConta : null;
        exatas[e.itemId] = e.estado === 'ok'
          ? { estado: 'ok', preco: pr, sellerId: e.sellerId, tipo: e.tipo, comissao: cm?.estado === 'ok' ? { estado: 'ok', valor: cm.valor } : { estado: 'indisponivel', motivo: motivoDe(cm, 'comissão indisponível') } }
          : { estado: 'nao_encontrada', preco: pr };
        limiteFora ||= !!cm && cm.estado !== 'ok' && motivoDe(cm, '') === MOTIVO_LIMITE;
      }
      const ok: OfertasOk = { estado: 'ok', total: o.total, lidas: o.lidas, vendedoresIdentificados: o.vendedoresIdentificados, ofertasSemVendedor: o.ofertasSemVendedor, completa: o.completa, exatas };
      // Na aba, as ofertas exatas de pedidos anteriores do mesmo catálogo ficam (scroll). No cache, só a leitura nova e
      // sem oferta exata cuja comissão não veio: em outra busca ela não vale como dado válido.
      v.ofertas = { ...ok, exatas: { ...exatasAnteriores(v.ofertas), ...exatas } };
      const validas = Object.fromEntries(Object.entries(exatas).filter(([, e]) => e.estado !== 'ok' || e.comissao.estado === 'ok'));
      const exp = ms(o.expiraEm);
      escritas.push((x) => { x.ofertas[cat] = { v: { ...ok, exatas: validas }, exp, u: agora }; });
    } else if (o || pc.componentes.includes('ofertas')) {
      const motivo = recusado ?? motivoDe(o, MOTIVO_PADRAO);
      limiteFora ||= motivo === MOTIVO_LIMITE;
      ofertasIndisponiveis(v, pc.itens, motivo);
    }
    enr.catalogos[cat] = v;
  }
  for (const s of r.vendedores ?? []) {
    const k = String(s.sellerId);
    if (s.estado === 'ok') {
      const v: VendedorOk = { estado: 'ok', nome: s.nome, medalha: s.medalha, uf: s.uf, cidade: textoOuNull(s.cidade), reputacao: ehReputacao(s.reputacao) ? s.reputacao : null };
      enr.vendedores[k] = v;
      const exp = ms(s.expiraEm);
      escritas.push((x) => { x.vendedores[k] = { v, exp, u: agora }; });
    } else {
      const motivo = motivoDe(s, 'perfil indisponível');
      limiteFora ||= motivo === MOTIVO_LIMITE;
      enr.vendedores[k] = { estado: 'indisponivel', motivo };
    }
  }
  // Fretes: só as entradas pedidas (item + preço); pedido sem resposta (edge antiga, catálogo recusado sem eco) = terminal.
  let limiteFrete = false;
  if (pedido.fretes?.length) {
    const recebidos = new Map((Array.isArray(r.fretes) ? r.fretes : []).map((f) => [chaveFrete(String(f?.itemId), Number(f?.preco)), f]));
    enr.fretes = { ...enr.fretes };
    for (const pf of pedido.fretes) {
      const k = chaveFrete(pf.itemId, pf.preco);
      const rf = recebidos.get(k);
      const f = rf?.frete;
      if (f?.estado === 'ok' && typeof f.valor === 'number' && Number.isFinite(f.valor) && f.valor >= 0) {
        const valor = f.valor, exp = ms(rf!.expiraEm);
        enr.fretes[k] = { estado: 'ok', valor };
        if (Number.isFinite(exp)) escritas.push((x) => { x.fretes[k] = { v: valor, exp, u: agora }; });
      } else {
        const motivo = motivoDe(f, MOTIVO_FRETE_PADRAO);
        limiteFrete ||= motivo === MOTIVO_LIMITE;
        enr.fretes[k] = { estado: 'indisponivel', motivo };
      }
    }
  }
  // Retry-After de 429 só do frete (a edge junta todos num campo): segura só os fretes, o resto pode ser refeito.
  const t = ms(r.tentarAposEm);
  if (Number.isFinite(t)) {
    if (limiteFrete && !limiteFora) enr.freteAposEm = Math.max(enr.freteAposEm ?? 0, t);
    else enr.tentarAposEm = Math.max(enr.tentarAposEm ?? 0, t);
  }
  return (c) => { for (const f of escritas) f(c); };
}
