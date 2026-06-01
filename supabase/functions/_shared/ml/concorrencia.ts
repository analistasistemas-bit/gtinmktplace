import { getValidAccessToken } from './token.ts';
import { escolherIdentificador, type FamiliaParaBusca } from '../concorrencia/identificador.ts';
import { parseProdutoBusca, parseItensProduto } from '../concorrencia/parse.ts';
import { classificarConcorrencia } from '../concorrencia/classificar.ts';
import { cacheConcorrenciaGet, cacheConcorrenciaSet } from '../redis/cache-concorrencia.ts';
import type { ResultadoConcorrencia } from '../concorrencia/tipos.ts';

const NENHUMA: ResultadoConcorrencia = {
  vendedores: 0, preco_min: null, origem: 'nenhuma', classe: 'sem',
};

const API = 'https://api.mercadolibre.com';
const TIMEOUT_MS = 15000;

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

/**
 * Concorrência por família (ADR-0014). O endpoint legado `/sites/MLB/search` foi
 * descontinuado pelo ML (403); usamos o catálogo:
 *   1) `/products/search?q={gtin}` → product_id
 *   2) `/products/{id}/items`      → vendedores distintos + menor preço
 * Sem EAN válido (ramo título) o catálogo textual traz ruído alto → registra
 * `origem='titulo'` mas não quantifica (PRÓPRIO seguro). Erro/timeout → NENHUMA.
 */
export async function buscarConcorrencia(
  userId: string,
  familia: FamiliaParaBusca,
): Promise<ResultadoConcorrencia> {
  try {
    const ident = escolherIdentificador(familia);

    if (ident.tipo === 'titulo') {
      return { vendedores: 0, preco_min: null, origem: 'titulo', classe: 'sem' };
    }

    const termo = `gtin:${ident.valor}`;
    const cached = await cacheConcorrenciaGet(termo).catch(() => null);
    if (cached) {
      return {
        vendedores: cached.vendedores,
        preco_min: cached.preco_min,
        origem: cached.origem,
        classe: cached.classe,
        product_id: cached.product_id ?? null,
        ofertas: cached.ofertas,
      };
    }

    const token = await getValidAccessToken(userId);

    const busca = await mlGet(
      `${API}/products/search?status=active&site_id=MLB&q=${encodeURIComponent(ident.valor)}`,
      token,
    );
    const productId = parseProdutoBusca(busca);
    if (!productId) return { ...NENHUMA, origem: 'gtin' };

    const itensJson = await mlGet(`${API}/products/${productId}/items`, token);
    const ofertas = parseItensProduto(itensJson);
    const classe = classificarConcorrencia(ofertas.vendedores);
    const resultado: ResultadoConcorrencia = {
      vendedores: ofertas.vendedores,
      preco_min: ofertas.preco_min,
      origem: 'gtin',
      classe,
      product_id: productId,
      ofertas,
    };

    await cacheConcorrenciaSet(termo, resultado).catch(() => {});
    return resultado;
  } catch (e) {
    console.warn(`buscarConcorrencia falhou: ${(e as Error).message}`);
    return NENHUMA;
  }
}
