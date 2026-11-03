// Enriquecimento de catálogo da busca (ADR-0189 emenda 2026-11-02 + adendo 2026-11-03; plano, Revisão 03/11).
// Para catálogos identificados nos cards (inclusive de concorrente): /products/{id}, /products/{id}/items e
// /users/{seller} com a conta da org, mais a comissão "na sua conta" da oferta exata do card.
// - Sem cache Redis de produto/ofertas/perfil (o cache é do navegador; o pedido traz só os componentes vencidos).
// - Redis só para cotas por lote e a comissão na chave existente (`chaveComissao`), lida com UM MGET por lote.
// - Nada inventado: vendedor/categoria/tipo/comissão só da oferta cujo item_id = item do card.
import { chaveComissao, comissaoDaListingPrice, dataDoProduto, MAX_PERFIS_PEDIDO } from '../../extensao/roteamento.ts';
import { leituraCompletaDaFicha } from '../pulse/parse.ts';
import type { ListingPriceML } from '../ml/tarifa.ts';
import { redisMget, redisSet } from '../redis/client.ts';
import type { ComissaoML, Disponivel } from './tipos.ts';
import {
  chaveOrcamentoMl, devolverOrcamentoMl, reservarEnriquecimento, reservarOrcamentoMl, type ContadorRedis, type ReservaOrcamentoMl,
} from './cotas-busca.ts';

const ML = 'https://api.mercadolibre.com';
const ONDA = 5; // chamadas ML simultâneas
const TTL_COMISSAO_S = 6 * 3600; // = TTL_CACHE_S da edge (a mesma chave é lida por analisar_anuncio)
const TIPOS = new Set(['gold_special', 'gold_pro']);
const MEDALHAS = new Set(['silver', 'gold', 'platinum']);
const CATEGORIA = /^MLB\d{1,20}$/;

export type Componente = 'produto' | 'ofertas';
export interface CatalogoPedido { catalogProductId: string; componentes: Componente[]; itens: { itemId: string; preco: number }[] }
export interface PedidoEnriquecimento {
  catalogos: CatalogoPedido[];
  /** Vendedores cujo perfil o navegador quer (ofertas já em cache lá). */
  perfis: number[];
  /** Vendedores com perfil válido no cache do navegador: não são consultados. */
  perfisEmCache: number[];
}

export interface RespostaMl { status: number; corpo: unknown }
export interface DepsEnriquecimento {
  /** Conta ML da conexão da org (chave da comissão). */
  conta: string;
  agora: () => Date;
  /** Uma tentativa, nunca lança (`getMlUmaVez`). */
  getMl: (url: string) => Promise<RespostaMl>;
}

export type Aguardando = { estado: 'aguardando'; retomarEm: string | null };
type Ind = { estado: 'indisponivel'; motivo: string };
export type Medalha = 'silver' | 'gold' | 'platinum' | 'sem';
export interface VendedorBusca { nome: string | null; medalha: Medalha | null; uf: string | null }

export type OfertaExata =
  | {
    itemId: string; estado: 'ok'; categoriaId: string | null; sellerId: number | null; tipo: 'gold_special' | 'gold_pro' | null;
    comissaoNaSuaConta: Disponivel<ComissaoML> | Aguardando;
  }
  | { itemId: string; estado: 'nao_encontrada'; motivo: string };

export interface CatalogoEnriquecido {
  catalogProductId: string;
  /** aguardando = cota de enriquecimento esgotada; nada foi consultado. */
  estado: 'ok' | 'aguardando';
  retomarEm: string | null;
  produto?: { estado: 'ok'; criadoEm: string | null } | Aguardando | Ind;
  ofertas?: { estado: 'ok'; total: number | null; lidas: number; vendedores: number; completa: boolean; exatas: OfertaExata[] } | Aguardando | Ind;
}

export type VendedorEnriquecido =
  | ({ sellerId: number; estado: 'ok' } & VendedorBusca)
  | ({ sellerId: number; motivo?: string } & Aguardando)
  | ({ sellerId: number } & Ind);

export interface RespostaEnriquecimento {
  consultadoEm: string;
  catalogos: CatalogoEnriquecido[];
  vendedores: VendedorEnriquecido[];
  custo: { comandosRedis: number; chamadasMl: number };
}

const registro = (v: unknown) => (typeof v === 'object' && v != null && !Array.isArray(v) ? v as Record<string, unknown> : null);

function ufOuNulo(v: unknown): string | null {
  const e = typeof v === 'string' ? v : registro(v)?.id;
  if (typeof e !== 'string') return null;
  const s = e.trim().toUpperCase().replace(/^BR-/, '');
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/** /users/{id} de terceiro → nome, medalha, UF. Não exige `transactions.total` (normalizarPerfilVendedor exige).
 *  "sem" só com `power_seller_status: null` explícito; ausente ou desconhecido = null. */
export function vendedorDoUsuario(corpo: unknown): VendedorBusca {
  const b = registro(corpo);
  const rep = registro(b?.seller_reputation);
  const st = rep && 'power_seller_status' in rep ? rep.power_seller_status : undefined;
  return {
    nome: typeof b?.nickname === 'string' ? b.nickname : null,
    medalha: st === null ? 'sem' : typeof st === 'string' && MEDALHAS.has(st) ? st as Medalha : null,
    uf: ufOuNulo(registro(b?.address)?.state),
  };
}

type Projecao = { item_id: unknown; seller_id: unknown; category_id: unknown; listing_type_id: unknown };
type OfertasLidas = { total: number | null; lidas: Projecao[]; completa: boolean };

/** Resposta de /products/{id}/items → só os 4 campos usados (o corpo de ~100 KB sai de escopo aqui). */
function projetarOfertas(r: RespostaMl): OfertasLidas | Aguardando | Ind {
  if (r.status === 404 && /no winners found/i.test(String(registro(r.corpo)?.message ?? ''))) return { total: 0, lidas: [], completa: true };
  if (r.status === 429) return { estado: 'aguardando', retomarEm: null };
  const results = registro(r.corpo)?.results;
  if (r.status !== 200 || !Array.isArray(results)) return { estado: 'indisponivel', motivo: 'ofertas indisponíveis' };
  const total = registro(registro(r.corpo)?.paging)?.total;
  return {
    total: typeof total === 'number' && Number.isFinite(total) ? total : null,
    lidas: results.map((o) => { const x = registro(o); return { item_id: x?.item_id, seller_id: x?.seller_id, category_id: x?.category_id, listing_type_id: x?.listing_type_id }; }),
    completa: leituraCompletaDaFicha(r.corpo),
  };
}

const sellerValido = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);
const espera = (retomarEm: string | null): Aguardando => ({ estado: 'aguardando', retomarEm });

/** Despacha `urls` dentro do orçamento global: reserva o limite superior da fase, nunca passa do concedido, em
 *  ondas de 5; minuto UTC virou entre ondas → devolve o não despachado na chave antiga e reserva de novo na nova.
 *  No fim devolve só o não despachado. Não concedidas = aguardando. */
async function despacharFase(urls: string[], deps: DepsEnriquecimento, custo: ContadorRedis & { chamadasMl: number }): Promise<(RespostaMl | Aguardando)[]> {
  const out: (RespostaMl | Aguardando)[] = [];
  if (urls.length === 0) return out;
  let reserva: ReservaOrcamentoMl = await reservarOrcamentoMl(urls.length, deps.agora(), custo);
  let saldo = reserva.concedidas;
  while (out.length < urls.length && saldo > 0) {
    const agora = deps.agora();
    if (chaveOrcamentoMl(agora) !== reserva.chave) {
      await devolverOrcamentoMl(reserva, saldo, agora, custo);
      reserva = await reservarOrcamentoMl(urls.length - out.length, agora, custo);
      saldo = reserva.concedidas;
      if (saldo === 0) break;
    }
    const onda = urls.slice(out.length, out.length + Math.min(ONDA, saldo));
    saldo -= onda.length;
    custo.chamadasMl += onda.length;
    out.push(...await Promise.all(onda.map((u) => deps.getMl(u))));
  }
  if (saldo > 0) await devolverOrcamentoMl(reserva, saldo, deps.agora(), custo);
  while (out.length < urls.length) out.push(espera(reserva.retomarEm));
  return out;
}

const aguardou = (r: RespostaMl | Aguardando): r is Aguardando => 'estado' in r;

export async function enriquecerCatalogosBusca(
  orgId: string, userId: string, p: PedidoEnriquecimento, deps: DepsEnriquecimento,
): Promise<RespostaEnriquecimento> {
  const custo = { comandosRedis: 0, chamadasMl: 0 };
  const inicio = deps.agora();
  // 1 por catálogo pedido; pedido só de perfis debita 1 (anti-abuso: sem isso seria ilimitado por usuário).
  const cota = await reservarEnriquecimento(orgId, userId, p.catalogos.length || 1, inicio, custo);
  const n = p.catalogos.length === 0 ? 0 : cota.permitidos;
  const liberado = cota.permitidos > 0;
  const processados = p.catalogos.slice(0, n);
  const catalogos: CatalogoEnriquecido[] = p.catalogos.slice(n).map((c) => ({ catalogProductId: c.catalogProductId, estado: 'aguardando', retomarEm: cota.retomarEm }));

  // Fase 1: /products e /products/items dos componentes pedidos.
  const urls1 = processados.flatMap((c) => [
    ...(c.componentes.includes('produto') ? [`${ML}/products/${c.catalogProductId}`] : []),
    ...(c.componentes.includes('ofertas') ? [`${ML}/products/${c.catalogProductId}/items?limit=100`] : []),
  ]);
  const r1 = await despacharFase(urls1, deps, custo);
  let k = 0;
  const lidos = processados.map((c) => {
    const produto = c.componentes.includes('produto') ? r1[k++] : undefined;
    const ofertas = c.componentes.includes('ofertas') ? r1[k++] : undefined;
    return {
      c,
      produto: produto === undefined ? undefined
        : aguardou(produto) ? produto
        : produto.status === 429 ? espera(null)
        : produto.status === 200 ? { estado: 'ok' as const, criadoEm: dataDoProduto(produto.corpo) }
        : { estado: 'indisponivel' as const, motivo: 'catálogo indisponível' },
      ofertas: ofertas === undefined ? undefined : aguardou(ofertas) ? ofertas : projetarOfertas(ofertas),
    };
  });

  // Ofertas exatas (item_id do card) → vendedores a consultar e chaves de comissão (deduplicadas).
  type Exata = { itemId: string; preco: number; categoriaId: string | null; sellerId: number | null; tipo: 'gold_special' | 'gold_pro' | null; chave: string | null };
  const exatasPorCat = lidos.map(({ c, ofertas }) => {
    if (!ofertas || !('lidas' in ofertas)) return null;
    return c.itens.map((i): Exata | { itemId: string; motivo: string } => {
      const o = ofertas.lidas.find((x) => x.item_id === i.itemId);
      if (!o) {
        return {
          itemId: i.itemId,
          motivo: ofertas.total === 0 ? 'catálogo sem ofertas' : ofertas.completa ? 'oferta não está entre as ofertas do catálogo' : 'oferta fora das ofertas lidas',
        };
      }
      const categoriaId = typeof o.category_id === 'string' && CATEGORIA.test(o.category_id) ? o.category_id : null;
      const tipo = typeof o.listing_type_id === 'string' && TIPOS.has(o.listing_type_id) ? o.listing_type_id as Exata['tipo'] : null;
      return { itemId: i.itemId, preco: i.preco, categoriaId, sellerId: sellerValido(o.seller_id), tipo, chave: categoriaId && tipo ? chaveComissao(deps.conta, categoriaId, tipo, i.preco) : null };
    });
  });
  const exatas = exatasPorCat.flatMap((l) => l ?? []).filter((e): e is Exata => 'preco' in e);

  // Comissão: UM MGET das chaves distintas; erro de Redis = todos misses (cache é otimização).
  const chaves = [...new Set(exatas.flatMap((e) => (e.chave ? [e.chave] : [])))];
  const comissoes = new Map<string, Disponivel<ComissaoML> | Aguardando>();
  if (chaves.length) {
    custo.comandosRedis++;
    const hits = await redisMget(chaves).catch(() => chaves.map(() => null));
    hits.forEach((h, i) => {
      try { const v = h ? JSON.parse(h) : null; if (v?.estado === 'ok' && v.valor) comissoes.set(chaves[i], v); } catch { /* miss */ }
    });
  }
  const misses = chaves.filter((c) => !comissoes.has(c)).map((c) => exatas.find((e) => e.chave === c)!);

  // Perfis: explícitos + vendedores das ofertas exatas, menos os em cache no navegador; até 5 por pedido.
  const emCache = new Set(p.perfisEmCache);
  const sellers = liberado
    ? [...new Set([...p.perfis, ...exatas.flatMap((e) => (e.sellerId ? [e.sellerId] : []))])].filter((s) => !emCache.has(s))
    : [];
  const consultar = sellers.slice(0, MAX_PERFIS_PEDIDO);

  // Fase 2: perfis + comissões ausentes (limite superior calculado depois das ofertas).
  const r2 = await despacharFase([
    ...consultar.map((s) => `${ML}/users/${s}`),
    ...misses.map((e) => `${ML}/sites/MLB/listing_prices?price=${e.preco}&category_id=${e.categoriaId}&listing_type_id=${e.tipo}`),
  ], deps, custo);

  const vendedores: VendedorEnriquecido[] = consultar.map((sellerId, i) => {
    const r = r2[i];
    if (aguardou(r)) return { sellerId, ...r };
    if (r.status === 429) return { sellerId, ...espera(null) };
    if (r.status !== 200 || !registro(r.corpo)) return { sellerId, estado: 'indisponivel', motivo: 'perfil indisponível' };
    return { sellerId, estado: 'ok', ...vendedorDoUsuario(r.corpo) };
  });
  for (const sellerId of sellers.slice(MAX_PERFIS_PEDIDO)) vendedores.push({ sellerId, estado: 'aguardando', retomarEm: null, motivo: 'limite de perfis por pedido' });
  if (!liberado) for (const sellerId of p.perfis) vendedores.push({ sellerId, ...espera(cota.retomarEm) });

  const gravar: Promise<unknown>[] = [];
  misses.forEach((e, i) => {
    const r = r2[consultar.length + i];
    let v: Disponivel<ComissaoML> | Aguardando;
    if (aguardou(r)) v = r;
    else if (r.status === 429) v = espera(null); // listing_prices local_rate_limited: sem retry
    else if (r.status !== 200 || !registro(r.corpo)) v = { estado: 'indisponivel', motivo: 'comissão indisponível' };
    else v = comissaoDaListingPrice(r.corpo as ListingPriceML, e.preco);
    comissoes.set(e.chave!, v);
    // Só `ok` é gravado: analisar_anuncio lê a mesma chave e não pode herdar um indisponível.
    if (v.estado === 'ok') { custo.comandosRedis++; gravar.push(redisSet(e.chave!, JSON.stringify(v), TTL_COMISSAO_S).catch(() => undefined)); }
  });
  await Promise.all(gravar);

  const montados = lidos.map(({ c, produto, ofertas }, ci): CatalogoEnriquecido => {
    const out: CatalogoEnriquecido = { catalogProductId: c.catalogProductId, estado: 'ok', retomarEm: null };
    if (produto) out.produto = produto;
    if (ofertas) {
      out.ofertas = 'lidas' in ofertas
        ? {
          estado: 'ok', total: ofertas.total, lidas: ofertas.lidas.length,
          vendedores: new Set(ofertas.lidas.map((o) => sellerValido(o.seller_id)).filter((s) => s !== null)).size,
          completa: ofertas.completa,
          exatas: exatasPorCat[ci]!.map((e): OfertaExata => ('preco' in e
            ? {
              itemId: e.itemId, estado: 'ok', categoriaId: e.categoriaId, sellerId: e.sellerId, tipo: e.tipo,
              comissaoNaSuaConta: e.chave ? comissoes.get(e.chave)!
                : { estado: 'indisponivel', motivo: e.tipo ? 'categoria não confirmada' : 'tipo do anúncio não confirmado' },
            }
            : { itemId: e.itemId, estado: 'nao_encontrada', motivo: e.motivo })),
        }
        : ofertas;
    }
    return out;
  });

  return { consultadoEm: inicio.toISOString(), catalogos: [...montados, ...catalogos], vendedores, custo };
}
