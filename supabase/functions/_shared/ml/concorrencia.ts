import { getValidAccessTokenConexao } from './token.ts';
import type { ConexaoCanal } from '../canais/conexao.ts';
import { gtinsValidos, type FamiliaParaBusca } from '../concorrencia/identificador.ts';
import { parseProdutoBusca, parseNomeProdutoBusca, parseItensProduto } from '../concorrencia/parse.ts';
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

// Quantos EANs tentar antes de desistir. As cores da família são o MESMO produto de catálogo;
// com `product_identifier` o 1º EAN indexado já casa — os demais são só rede de segurança.
const MAX_GTINS_TENTADOS = 5;

/**
 * Concorrência por família (ADR-0014). O endpoint legado `/sites/MLB/search` foi
 * descontinuado pelo ML (403); usamos o catálogo:
 *   1) `/products/search?product_identifier={gtin}` → product_id (lookup oficial de EAN;
 *      `q={gtin}` era busca textual frágil e falhava com EANs válidos — bug lote #27)
 *   2) `/products/{id}/items` → vendedores distintos + menor preço
 * Tenta até MAX_GTINS_TENTADOS EANs da família (um pode casar quando o 1º não está indexado).
 * Sem EAN válido (ramo título) o catálogo textual traz ruído alto → registra `origem='titulo'`
 * mas não quantifica (PRÓPRIO seguro). Erro/timeout → NENHUMA.
 */
export async function buscarConcorrencia(
  conexao: ConexaoCanal | null,
  familia: FamiliaParaBusca,
): Promise<ResultadoConcorrencia> {
  try {
    const gtins = gtinsValidos(familia);
    if (gtins.length === 0) {
      return { vendedores: 0, preco_min: null, origem: 'titulo', classe: 'sem' };
    }
    const candidatos = gtins.slice(0, MAX_GTINS_TENTADOS);

    // Cache: qualquer EAN já resolvido antes serve (mesmo produto de catálogo).
    for (const gtin of candidatos) {
      const cached = await cacheConcorrenciaGet(`gtin:${gtin}`).catch(() => null);
      if (cached) {
        return {
          vendedores: cached.vendedores,
          preco_min: cached.preco_min,
          origem: cached.origem,
          classe: cached.classe,
          product_id: cached.product_id ?? null,
          product_name: cached.product_name ?? null,
          ofertas: cached.ofertas,
        };
      }
    }

    if (!conexao) throw new Error('Organização sem conexão com o Mercado Livre');
    const token = await getValidAccessTokenConexao(conexao);

    for (const gtin of candidatos) {
      const busca = await mlGet(
        `${API}/products/search?status=active&site_id=MLB&product_identifier=${encodeURIComponent(gtin)}`,
        token,
      );
      const productId = parseProdutoBusca(busca);
      if (!productId) continue; // EAN não indexado — tenta o próximo

      const itensJson = await mlGet(`${API}/products/${productId}/items`, token);
      const ofertas = parseItensProduto(itensJson);
      const classe = classificarConcorrencia(ofertas.vendedores);
      const resultado: ResultadoConcorrencia = {
        vendedores: ofertas.vendedores,
        preco_min: ofertas.preco_min,
        origem: 'gtin',
        classe,
        product_id: productId,
        product_name: parseNomeProdutoBusca(busca),
        ofertas,
      };

      await cacheConcorrenciaSet(`gtin:${gtin}`, resultado).catch(() => {});
      return resultado;
    }

    // Nenhum EAN casou no catálogo.
    return { ...NENHUMA, origem: 'gtin' };
  } catch (e) {
    console.warn(`buscarConcorrencia falhou: ${(e as Error).message}`);
    return NENHUMA;
  }
}
