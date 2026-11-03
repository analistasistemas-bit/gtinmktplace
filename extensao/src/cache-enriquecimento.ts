// Enriquecimento dos catálogos da busca no SW (Revisão 03/11-b, Task 11.3: lote por página): cache do navegador por
// identidade (chrome.storage.session; metadados 6 h, ofertas 60 s, perfis 24 h, expirações do servidor) e o planejamento
// da página (deduplicada por catálogo; só os componentes vencidos vão à edge). Funções puras + I/O mínima do cache.
import { epocaAtual } from './abas';
import type { CardBusca } from './leitura/busca';
import type { MetadadosCardBusca } from '../../supabase/functions/_shared/extensao/busca.ts';
import type { ComissaoML, Disponivel } from '../../supabase/functions/_shared/extensao/tipos.ts';
import type { CatalogoVista, EstadoEnriquecimento, ExataVista, Medalha, OfertasOk, VendedorVista } from './compartilhado/enriquecimento';

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
    produto?: { estado: 'ok'; criadoEm: string | null; expiraEm: string } | IndEdge;
    ofertas?: { estado: 'ok'; expiraEm: string; total: number | null; lidas: number; vendedoresIdentificados: number; ofertasSemVendedor: number;
      completa: boolean; exatas: OfertaExataEdge[] } | IndEdge;
  }[];
  vendedores: (
    | { sellerId: number; estado: 'ok'; nome: string | null; medalha: Medalha | null; uf: string | null; expiraEm: string }
    | ({ sellerId: number } & IndEdge)
  )[];
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
const MAX_PERFIS_EM_CACHE = 100;

// ---------------------------------------------------------------- cache
const CHAVE = 'enr:cache'; // prefixo `enr` apagado por limparEstadosDasAbas (saída, identidade, suporte, sessão inválida)
const TETO = 5 * 1024 * 1024; // storage.session tem 10 MiB para tudo (inclui o estado das abas)
const ALVO = 4 * 1024 * 1024;

type Entrada<T> = { v: T; exp: number; u: number };
type VendedorOk = Extract<VendedorVista, { estado: 'ok' }>;
export interface CacheEnr {
  identidade: string;
  /** Impressão da conta ML da última resposta (null = ainda não vista). */
  conta: string | null;
  produtos: Record<string, { criadoEm: string | null; exp: number; u: number }>;
  ofertas: Record<string, Entrada<OfertasOk>>;
  vendedores: Record<string, Entrada<VendedorOk>>;
}
const vazio = (identidade: string): CacheEnr => ({ identidade, conta: null, produtos: {}, ofertas: {}, vendedores: {} });
const MAPAS = ['produtos', 'ofertas', 'vendedores'] as const;

function semExpirados(c: CacheEnr, agora: number): CacheEnr {
  for (const m of MAPAS) for (const [k, e] of Object.entries(c[m])) if (!(e.exp > agora)) delete c[m][k];
  return c;
}

/** Cache da identidade (vazio se de outra, ausente ou ilegível), sem os expirados. Falha de storage = sem cache. */
export async function lerCache(identidade: string, agora = Date.now()): Promise<CacheEnr> {
  try {
    const c = (await chrome.storage.session.get(CHAVE))[CHAVE] as CacheEnr | undefined;
    if (!c || c.identidade !== identidade || MAPAS.some((m) => typeof c[m] !== 'object' || c[m] === null)) return vazio(identidade);
    return semExpirados({ ...c, produtos: { ...c.produtos }, ofertas: { ...c.ofertas }, vendedores: { ...c.vendedores } }, agora);
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
export interface PedidoLote { catalogos: CatalogoPedido[]; perfis: number[]; perfisEmCache: number[] }

/** Marcas do que um pedido levou, para `jaPedidos` (nada se repete dentro da rodada). */
export function marcasDoPedido(p: PedidoLote): string[] {
  return [
    ...p.catalogos.flatMap((c) => [...c.componentes.map((x) => `${x}:${c.catalogProductId}`), ...c.itens.map((i) => `item:${i.itemId}`)]),
    ...p.perfis.map((s) => `perfil:${s}`),
  ];
}
export interface Plano {
  /** Vindo do cache: aplicar na vista da aba (sem edge, sem cota). */
  hits: { catalogos: Record<string, CatalogoVista>; vendedores: Record<string, VendedorVista>; usados: { m: (typeof MAPAS)[number]; k: string }[] };
  pedido: PedidoLote | null;
}

/** Ainda não pedido (ou `aguardando` gravado antes da 11.3). ok e indisponível são terminais: sem retomada automática. */
const precisa = (v: { estado: string } | undefined) => !v || v.estado === 'aguardando';

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
  const hits: Plano['hits'] = { catalogos: {}, vendedores: {}, usados: [] };
  // Fila deduplicada por catálogo: próprios/vinculados primeiro, depois a ordem observada.
  const prioridade = (c: { itemId: string }) => (metadados[c.itemId]?.proprio === true || metadados[c.itemId]?.vinculo ? 0 : 1);
  const itensPorCat = new Map<string, { itemId: string; preco: number }[]>();
  const ordem: string[] = [];
  for (const c of cards.map((c, i) => ({ c, i })).sort((a, b) => prioridade(a.c) - prioridade(b.c) || a.i - b.i).map((x) => x.c)) {
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
    // Itens ainda sem oferta exata ao preço do card (scroll, preço novo, 51º em diante); leitura nova = todos.
    let pendentes = v.ofertas?.estado === 'ok' ? itens.filter((i) => (v.ofertas as OfertasOk).exatas[i.itemId]?.preco !== i.preco) : itens;
    let ofertas = precisa(v.ofertas) || (v.ofertas?.estado === 'ok' && pendentes.length > 0);
    const hit: CatalogoVista = {};
    const p = valida(cache.produtos[cat]);
    if (produto && p) { hit.produto = { estado: 'ok', criadoEm: p.criadoEm }; hits.usados.push({ m: 'produtos', k: cat }); produto = false; }
    const o = valida(cache.ofertas[cat]);
    if (ofertas && o && cobre(o.v, pendentes)) {
      hit.ofertas = { ...o.v, exatas: { ...(v.ofertas?.estado === 'ok' ? v.ofertas.exatas : {}), ...o.v.exatas } };
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

  if (catalogos.length === 0 && perfis.length === 0) return { hits, pedido: null };
  // Com perfil válido aqui, a edge não consulta de novo.
  const emCache = new Set<number>();
  for (const [k, v] of [...Object.entries(enr.vendedores), ...Object.entries(hits.vendedores)]) if (v.estado === 'ok') emCache.add(Number(k));
  for (const [k, e] of Object.entries(cache.vendedores)) if (valida(e)) emCache.add(Number(k));
  return { hits, pedido: { catalogos, perfis, perfisEmCache: [...emCache].filter((s) => Number.isInteger(s) && s > 0).slice(0, MAX_PERFIS_EM_CACHE) } };
}

/** Hits do cache → vista da aba (muta `enr`). */
export function aplicarHits(enr: EstadoEnriquecimento, hits: Plano['hits']): void {
  for (const [cat, h] of Object.entries(hits.catalogos)) enr.catalogos[cat] = { ...enr.catalogos[cat], ...h };
  for (const [k, v] of Object.entries(hits.vendedores)) enr.vendedores[k] = v;
}

// ---------------------------------------------------------------- resposta
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const MOTIVO_PADRAO = 'catálogo indisponível';
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
  } else v.ofertas = { estado: 'indisponivel', motivo };
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
  enr.falhou = true;
}

/** "Tentar novamente" (ação explícita): antes do Retry-After do ML → false, nada muda. Senão apaga todo indisponível
 *  (componentes, ofertas exatas sem comissão ou não lidas, vendedores) para o planejamento pedir de novo. Muta `enr`. */
export function prepararNovaTentativa(enr: EstadoEnriquecimento, agora: number): boolean {
  if (enr.tentarAposEm != null && agora < enr.tentarAposEm) return false;
  for (const [cat, c] of Object.entries(enr.catalogos)) {
    const v: CatalogoVista = { ...c };
    delete v.aguardandoJanela;
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
  enr.retomarEm = null;
  return true;
}

/** Resposta da edge → vista da aba (muta `enr`). Tudo terminal: ok, ou indisponível com o motivo (estado desconhecido de
 *  outra versão da edge também). Devolve o que gravar no cache (só o válido, com o `expiraEm` do servidor), para rodar
 *  na mesma checagem de identidade/época/página da vista. */
export function aplicarResposta(enr: EstadoEnriquecimento, pedido: PedidoLote, r: RespostaEnriquecimento, agora: number): (c: CacheEnr) => void {
  const escritas: ((c: CacheEnr) => void)[] = [];
  for (const c of r.catalogos ?? []) {
    const pc = pedido.catalogos.find((x) => x.catalogProductId === c.catalogProductId);
    if (!pc) continue;
    const cat = c.catalogProductId;
    const v: CatalogoVista = { ...enr.catalogos[cat] };
    delete v.aguardandoJanela;
    // Catálogo inteiro recusado (cota de páginas, Redis fora) ou estado desconhecido: nada consultado.
    const recusado = c.estado !== 'ok' ? motivoDe(c, MOTIVO_PADRAO) : null;
    const p = recusado ? undefined : c.produto;
    if (p?.estado === 'ok') {
      v.produto = { estado: 'ok', criadoEm: p.criadoEm };
      const exp = ms(p.expiraEm);
      escritas.push((x) => { x.produtos[cat] = { criadoEm: p.criadoEm, exp, u: agora }; });
    } else if (p || pc.componentes.includes('produto')) v.produto = { estado: 'indisponivel', motivo: recusado ?? motivoDe(p, MOTIVO_PADRAO) };
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
      }
      const ok: OfertasOk = { estado: 'ok', total: o.total, lidas: o.lidas, vendedoresIdentificados: o.vendedoresIdentificados, ofertasSemVendedor: o.ofertasSemVendedor, completa: o.completa, exatas };
      // Na aba, as ofertas exatas de pedidos anteriores do mesmo catálogo ficam (scroll). No cache, só a leitura nova e
      // sem oferta exata cuja comissão não veio: em outra busca ela não vale como dado válido.
      v.ofertas = v.ofertas?.estado === 'ok' ? { ...ok, exatas: { ...v.ofertas.exatas, ...exatas } } : ok;
      const validas = Object.fromEntries(Object.entries(exatas).filter(([, e]) => e.estado !== 'ok' || e.comissao.estado === 'ok'));
      const exp = ms(o.expiraEm);
      escritas.push((x) => { x.ofertas[cat] = { v: { ...ok, exatas: validas }, exp, u: agora }; });
    } else if (o || pc.componentes.includes('ofertas')) ofertasIndisponiveis(v, pc.itens, recusado ?? motivoDe(o, MOTIVO_PADRAO));
    enr.catalogos[cat] = v;
  }
  for (const s of r.vendedores ?? []) {
    const k = String(s.sellerId);
    if (s.estado === 'ok') {
      const v: VendedorOk = { estado: 'ok', nome: s.nome, medalha: s.medalha, uf: s.uf };
      enr.vendedores[k] = v;
      const exp = ms(s.expiraEm);
      escritas.push((x) => { x.vendedores[k] = { v, exp, u: agora }; });
    } else enr.vendedores[k] = { estado: 'indisponivel', motivo: motivoDe(s, 'perfil indisponível') };
  }
  const t = ms(r.tentarAposEm);
  if (Number.isFinite(t)) enr.tentarAposEm = Math.max(enr.tentarAposEm ?? 0, t);
  return (c) => { for (const f of escritas) f(c); };
}
