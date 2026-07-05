import { getValidAccessTokenConexao } from './token.ts';
import type { ConexaoCanal } from '../canais/conexao.ts';
import { redisGet, redisSet } from '../redis/client.ts';
import { agregarMercado, posicaoNoRanking, type ReputacaoVendedor } from './mercado-agregar.ts';
import type { DadosOfertas } from '../concorrencia/tipos.ts';

const API = 'https://api.mercadolibre.com';
const TIMEOUT_MS = 15000;
const TTL_SELLER = 60 * 60 * 24; // 24h
const TTL_HIGHLIGHTS = 60 * 60 * 6; // 6h

export interface AnaliseMercado {
  preco_max: number | null;
  total_ofertas: number;
  frete_gratis: number;
  full: number;
  lideres: number;
  maior_vendas: number;
  ranking_categoria: number | null;
  produto_desde: string | null;
}

async function mlGet(url: string, token: string): Promise<unknown | null> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) {
    console.warn(`ML GET ${resp.status}: ${url}`);
    return null;
  }
  return resp.json();
}

async function reputacaoVendedor(token: string, sellerId: number): Promise<ReputacaoVendedor> {
  const chave = `cache:seller:${sellerId}`;
  try {
    const cache = await redisGet(chave);
    if (cache) return JSON.parse(cache) as ReputacaoVendedor;
  } catch { /* segue */ }

  const json = (await mlGet(`${API}/users/${sellerId}`, token)) as {
    seller_reputation?: { power_seller_status?: string | null; transactions?: { total?: number } };
  } | null;
  const rep = json?.seller_reputation;
  const resultado: ReputacaoVendedor = {
    lider: rep?.power_seller_status != null,
    vendas: rep?.transactions?.total ?? 0,
  };
  try { await redisSet(chave, JSON.stringify(resultado), TTL_SELLER); } catch { /* segue */ }
  return resultado;
}

async function rankingCategoria(token: string, categoriaMlId: string, productId: string): Promise<number | null> {
  const chave = `cache:highlights:${categoriaMlId}`;
  let json: unknown = null;
  try {
    const cache = await redisGet(chave);
    if (cache) json = JSON.parse(cache);
  } catch { /* segue */ }
  if (json == null) {
    json = await mlGet(`${API}/highlights/MLB/category/${categoriaMlId}`, token);
    if (json != null) {
      try { await redisSet(chave, JSON.stringify(json), TTL_HIGHLIGHTS); } catch { /* segue */ }
    }
  }
  return posicaoNoRanking(json, productId);
}

async function produtoDesde(token: string, productId: string): Promise<string | null> {
  const json = (await mlGet(`${API}/products/${productId}`, token)) as { date_created?: string } | null;
  const dc = json?.date_created;
  return typeof dc === 'string' && dc.length >= 10 ? dc.slice(0, 10) : null;
}

export async function analisarMercado(
  conexao: ConexaoCanal | null,
  productId: string,
  categoriaMlId: string | null,
  ofertas: DadosOfertas,
): Promise<AnaliseMercado> {
  const base: AnaliseMercado = {
    preco_max: ofertas.preco_max,
    total_ofertas: ofertas.total_ofertas,
    frete_gratis: ofertas.frete_gratis,
    full: ofertas.full,
    lideres: 0,
    maior_vendas: 0,
    ranking_categoria: null,
    produto_desde: null,
  };
  try {
    if (!conexao) throw new Error('Organização sem conexão com o Mercado Livre');
    const token = await getValidAccessTokenConexao(conexao);
    const reps = await Promise.all(
      ofertas.seller_ids.map((id) =>
        reputacaoVendedor(token, id).catch(() => ({ lider: false, vendas: 0 })),
      ),
    );
    const agreg = agregarMercado(reps);
    base.lideres = agreg.lideres;
    base.maior_vendas = agreg.maior_vendas;

    if (categoriaMlId) {
      base.ranking_categoria = await rankingCategoria(token, categoriaMlId, productId).catch(() => null);
    }
    base.produto_desde = await produtoDesde(token, productId).catch(() => null);
  } catch (e) {
    console.warn(`analisarMercado falhou: ${(e as Error).message}`);
  }
  return base;
}
