// Enriquecimento dos catálogos da busca no SW (plano, Revisão 03/11, regras 2-3 e 10): cache do navegador por identidade
// (chrome.storage.session; metadados 6 h, ofertas 60 s, perfis 24 h, expirações do servidor) e o planejamento do lote
// (fila deduplicada por catálogo; só os componentes vencidos vão à edge). Funções puras + I/O mínima do cache.
import type { CardBusca } from './leitura/busca';
import type { MetadadosCardBusca } from '../../supabase/functions/_shared/extensao/busca.ts';
import type { ComissaoML, Disponivel } from '../../supabase/functions/_shared/extensao/tipos.ts';
import type { CatalogoVista, EstadoEnriquecimento, ExataVista, Medalha, OfertasOk, VendedorVista } from './compartilhado/enriquecimento';

// Contrato de `enriquecer_catalogos_busca` (_shared/extensao/enriquecimento-busca.ts, relatório da Task 9). Copiado e não
// importado: aquele módulo puxa roteamento.ts/redis (Deno) para o tsc da extensão.
export type Componente = 'produto' | 'ofertas';
export interface CatalogoPedido { catalogProductId: string; componentes: Componente[]; itens: { itemId: string; preco: number }[] }
type AguardandoEdge = { estado: 'aguardando'; retomarEm: string | null };
type IndEdge = { estado: 'indisponivel'; motivo: string };
type OfertaExataEdge =
  | { itemId: string; estado: 'ok'; categoriaId: string | null; sellerId: number | null; tipo: 'gold_special' | 'gold_pro' | null;
    perfil: 'carregado' | 'no_navegador' | 'aguardando' | 'indisponivel' | null; comissaoNaSuaConta: Disponivel<ComissaoML> | AguardandoEdge }
  | { itemId: string; estado: 'nao_encontrada'; motivo: string };
export interface RespostaEnriquecimento {
  consultadoEm: string;
  catalogos: {
    catalogProductId: string; estado: 'ok' | 'aguardando'; retomarEm: string | null; consultadoEm: string | null;
    produto?: { estado: 'ok'; criadoEm: string | null; expiraEm: string } | AguardandoEdge | IndEdge;
    ofertas?: { estado: 'ok'; expiraEm: string; total: number | null; lidas: number; vendedoresIdentificados: number; ofertasSemVendedor: number;
      completa: boolean; exatas: OfertaExataEdge[] } | AguardandoEdge | IndEdge;
  }[];
  vendedores: (
    | { sellerId: number; estado: 'ok'; nome: string | null; medalha: Medalha | null; uf: string | null; expiraEm: string }
    | ({ sellerId: number; motivo?: string } & AguardandoEdge)
    | ({ sellerId: number } & IndEdge)
  )[];
  custo: { comandosRedis: number; chamadasMl: number };
  /** Impressão opaca da conta ML (edge ≥ fatia 2); ausente em edge antiga. */
  conta?: string;
}

// = limites da edge (roteamento.ts) e do plano (5 perfis por pedido, 20 por busca).
export const MAX_CATALOGOS_LOTE = 5;
export const MAX_ITENS_CATALOGO = 20;
export const MAX_ITENS_LOTE = 50;
export const MAX_PERFIS_PEDIDO = 5;
export const MAX_PERFIS_BUSCA = 20;
const MAX_PERFIS_EM_CACHE = 100;
const JANELA_MS = 60_000;

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
  }).catch(() => {});
  fila = r;
  return r;
}

// ---------------------------------------------------------------- planejamento
export interface PedidoLote { catalogos: CatalogoPedido[]; perfis: number[]; perfisEmCache: number[]; /** Saldo de perfis da busca (a edge limita também os automáticos). */ perfisRestantes: number }

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
  /** Há trabalho travado por tempo (janela/retomarEm): a página deve mandar o pulso. */
  esperar: boolean;
}

type Retentavel = { estado: string; retomarEm?: number | null; tentativas?: number } | undefined;
/** undefined → pedir; aguardando → no máximo 1 nova tentativa automática, depois da hora dada. */
function precisa(v: Retentavel, agora: number): 'sim' | 'nao' | 'esperar' {
  if (!v) return 'sim';
  if (v.estado !== 'aguardando' || (v.tentativas ?? 0) >= 2) return 'nao';
  return v.retomarEm != null && agora < v.retomarEm ? 'esperar' : 'sim';
}

/** Itens do card que a leitura de ofertas precisa cobrir (preço legível; a comissão é do preço exato). */
const cobre = (o: OfertasOk, itens: { itemId: string; preco: number }[]) => itens.every((i) => o.exatas[i.itemId]?.preco === i.preco);

export function planejarLote(
  cards: Pick<CardBusca, 'itemId' | 'catalogProductId' | 'preco' | 'identidadeConflitante'>[],
  metadados: Record<string, MetadadosCardBusca | undefined>,
  enr: EstadoEnriquecimento, cache: CacheEnr, agora: number,
  /** marcasDoPedido já pedidas nesta rodada: não repetem (sem laço dentro da rodada). */
  jaPedidos: Set<string>,
): Plano {
  const hits: Plano['hits'] = { catalogos: {}, vendedores: {}, usados: [] };
  let esperar = false;
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
  const janelaFechada = enr.retomarEm !== null && agora < enr.retomarEm;
  const valida = <T extends { exp: number }>(e: T | undefined) => (e && e.exp > agora ? e : undefined);
  const vistas = (cat: string): CatalogoVista => ({ ...enr.catalogos[cat], ...hits.catalogos[cat] });

  const catalogos: CatalogoPedido[] = [];
  let itensLote = 0, cheio = false;
  for (const cat of ordem) {
    const itens = itensPorCat.get(cat)!;
    const v = vistas(cat);
    let produto = precisa(v.produto, agora);
    let ofertas = precisa(v.ofertas, agora);
    // Itens ainda sem oferta exata ao preço do card (21º em diante, scroll, preço novo); leitura nova = todos.
    let pendentes = v.ofertas?.estado === 'ok' ? itens.filter((i) => (v.ofertas as OfertasOk).exatas[i.itemId]?.preco !== i.preco) : itens;
    if (v.ofertas?.estado === 'ok' && pendentes.length) ofertas = 'sim';
    const hit: CatalogoVista = {};
    const p = valida(cache.produtos[cat]);
    if (produto === 'sim' && p) { hit.produto = { estado: 'ok', criadoEm: p.criadoEm }; hits.usados.push({ m: 'produtos', k: cat }); produto = 'nao'; }
    const o = valida(cache.ofertas[cat]);
    if (ofertas === 'sim' && o && cobre(o.v, pendentes)) {
      hit.ofertas = { ...o.v, exatas: { ...(v.ofertas?.estado === 'ok' ? v.ofertas.exatas : {}), ...o.v.exatas } };
      hits.usados.push({ m: 'ofertas', k: cat });
      ofertas = 'nao';
      pendentes = [];
    }
    if (hit.produto || hit.ofertas) hits.catalogos[cat] = hit;
    esperar ||= produto === 'esperar' || ofertas === 'esperar';
    // Já pedido nesta rodada (aguardando de novo) ou janela fechada: fica para o pulso.
    const novos = pendentes.filter((i) => !jaPedidos.has(`item:${i.itemId}`)).slice(0, MAX_ITENS_CATALOGO);
    const pedirProduto = produto === 'sim' && !jaPedidos.has(`produto:${cat}`);
    const pedirOfertas = ofertas === 'sim' && (novos.length > 0 || (pendentes.length === 0 && !jaPedidos.has(`ofertas:${cat}`)));
    if ((produto === 'sim' && !pedirProduto) || (ofertas === 'sim' && !pedirOfertas)) esperar = true;
    const componentes = [pedirProduto && 'produto', pedirOfertas && 'ofertas'].filter(Boolean) as Componente[];
    if (componentes.length === 0) continue;
    if (janelaFechada) { esperar = true; continue; }
    const enviar = pedirOfertas ? novos : [];
    if (cheio || catalogos.length === MAX_CATALOGOS_LOTE || itensLote + enviar.length > MAX_ITENS_LOTE) { cheio = true; continue; }
    catalogos.push({ catalogProductId: cat, componentes, itens: enviar });
    itensLote += enviar.length;
  }

  // Perfis dos vendedores das ofertas exatas já lidas (os do lote a edge acrescenta sozinha).
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
      const atual = hits.vendedores[k] ?? enr.vendedores[k];
      const falta = precisa(atual, agora); // limite por pedido volta com 0 tentativas: só faltou a vez
      const c = valida(cache.vendedores[k]);
      if (falta === 'sim' && c) { hits.vendedores[k] = c.v; hits.usados.push({ m: 'vendedores', k }); continue; }
      esperar ||= falta === 'esperar';
      if (falta === 'sim' && jaPedidos.has(`perfil:${k}`)) esperar = true;
      else if (falta === 'sim') faltam.push(e.sellerId);
    }
  }
  const vaga = Math.max(0, Math.min(MAX_PERFIS_PEDIDO, MAX_PERFIS_BUSCA - enr.perfis));
  const perfis = janelaFechada ? [] : faltam.slice(0, vaga);
  if (janelaFechada && faltam.length && enr.perfis < MAX_PERFIS_BUSCA) esperar = true;

  if (catalogos.length === 0 && perfis.length === 0) return { hits, pedido: null, esperar };
  // Com perfil válido aqui, a edge não consulta de novo; o saldo da busca limita também os perfis automáticos.
  const emCache = new Set<number>();
  for (const [k, v] of [...Object.entries(enr.vendedores), ...Object.entries(hits.vendedores)]) if (v.estado === 'ok') emCache.add(Number(k));
  for (const [k, e] of Object.entries(cache.vendedores)) if (valida(e)) emCache.add(Number(k));
  return { hits, pedido: {
    catalogos, perfis, perfisEmCache: [...emCache].filter((s) => Number.isInteger(s) && s > 0).slice(0, MAX_PERFIS_EM_CACHE),
    perfisRestantes: Math.max(0, MAX_PERFIS_BUSCA - enr.perfis),
  }, esperar };
}

/** Hits do cache → vista da aba (muta `enr`). */
export function aplicarHits(enr: EstadoEnriquecimento, hits: Plano['hits']): void {
  for (const [cat, h] of Object.entries(hits.catalogos)) enr.catalogos[cat] = { ...enr.catalogos[cat], ...h };
  for (const [k, v] of Object.entries(hits.vendedores)) enr.vendedores[k] = v;
}

// ---------------------------------------------------------------- resposta
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const aguardar = (r: string | null, antes: Retentavel, conta = true) => ({
  estado: 'aguardando' as const, retomarEm: Number.isFinite(ms(r)) ? ms(r) : null,
  tentativas: (antes?.estado === 'aguardando' ? antes.tentativas ?? 0 : 0) + (conta ? 1 : 0),
});

/** Resposta da edge → vista da aba (muta `enr`). Devolve o que gravar no cache (só componentes `ok`, com o `expiraEm`
 *  do servidor), para rodar na mesma checagem de identidade/época/página da vista. */
export function aplicarResposta(enr: EstadoEnriquecimento, pedido: PedidoLote, r: RespostaEnriquecimento, agora: number): (c: CacheEnr) => void {
  const escritas: ((c: CacheEnr) => void)[] = [];
  for (const c of r.catalogos ?? []) {
    const pc = pedido.catalogos.find((x) => x.catalogProductId === c.catalogProductId);
    if (!pc) continue;
    const cat = c.catalogProductId;
    const antes = enr.catalogos[cat] ?? {};
    if (c.estado === 'aguardando') {
      enr.catalogos[cat] = { ...antes, aguardandoJanela: true };
      const t = Number.isFinite(ms(c.retomarEm)) ? ms(c.retomarEm) : agora + JANELA_MS;
      enr.retomarEm = Math.max(enr.retomarEm ?? 0, t);
      continue;
    }
    const v: CatalogoVista = { ...antes };
    delete v.aguardandoJanela;
    const p = c.produto;
    if (p?.estado === 'ok') {
      v.produto = { estado: 'ok', criadoEm: p.criadoEm };
      const exp = ms(p.expiraEm);
      escritas.push((x) => { x.produtos[cat] = { criadoEm: p.criadoEm, exp, u: agora }; });
    } else if (p?.estado === 'aguardando') v.produto = aguardar(p.retomarEm, antes.produto);
    else if (p) v.produto = { estado: 'indisponivel' };
    const o = c.ofertas;
    if (o?.estado === 'ok') {
      const preco = new Map(pc.itens.map((i) => [i.itemId, i.preco]));
      const exatas: Record<string, ExataVista> = {};
      for (const e of o.exatas) {
        const pr = preco.get(e.itemId);
        if (pr === undefined) continue;
        exatas[e.itemId] = e.estado === 'ok'
          ? { estado: 'ok', preco: pr, sellerId: e.sellerId, tipo: e.tipo, comissao: e.comissaoNaSuaConta.estado === 'ok' ? { estado: 'ok', valor: e.comissaoNaSuaConta.valor } : e.comissaoNaSuaConta.estado === 'aguardando' ? { estado: 'aguardando' } : { estado: 'indisponivel', motivo: e.comissaoNaSuaConta.motivo } }
          : { estado: 'nao_encontrada', preco: pr };
      }
      const ok: OfertasOk = { estado: 'ok', total: o.total, lidas: o.lidas, vendedoresIdentificados: o.vendedoresIdentificados, ofertasSemVendedor: o.ofertasSemVendedor, completa: o.completa, exatas };
      // Na aba, as ofertas exatas de lotes anteriores do mesmo catálogo ficam (item 21+); no cache, só a leitura nova.
      v.ofertas = antes.ofertas?.estado === 'ok' ? { ...ok, exatas: { ...antes.ofertas.exatas, ...exatas } } : ok;
      const exp = ms(o.expiraEm);
      escritas.push((x) => { x.ofertas[cat] = { v: ok, exp, u: agora }; });
    } else if (o?.estado === 'aguardando') v.ofertas = aguardar(o.retomarEm, antes.ofertas);
    else if (o) v.ofertas = { estado: 'indisponivel' };
    enr.catalogos[cat] = v;
  }
  for (const s of r.vendedores ?? []) {
    const k = String(s.sellerId);
    if (s.estado === 'ok') {
      const v: VendedorOk = { estado: 'ok', nome: s.nome, medalha: s.medalha, uf: s.uf };
      enr.vendedores[k] = v;
      enr.perfis++;
      const exp = ms(s.expiraEm);
      escritas.push((x) => { x.vendedores[k] = { v, exp, u: agora }; });
    } else if (s.estado === 'aguardando') {
      enr.vendedores[k] = aguardar(s.retomarEm, enr.vendedores[k], s.motivo !== 'limite de perfis por pedido');
    } else {
      enr.vendedores[k] = { estado: 'indisponivel' };
      if (s.motivo !== 'limite de perfis da busca') enr.perfis++; // fora do saldo: nem foi consultado
    }
  }
  return (c) => { for (const f of escritas) f(c); };
}
