import { getValidAccessTokenConexao } from './token.ts';
import type { ConexaoCanal } from '../canais/conexao.ts';
import { gtinsValidos, type FamiliaParaBusca } from '../concorrencia/identificador.ts';
import { parseProdutoBusca, parseNomeProdutoBusca, parseItensProduto } from '../concorrencia/parse.ts';
import { classificarConcorrencia } from '../concorrencia/classificar.ts';
import { agregarConcorrencia, type ProdutoConcorrencia } from '../concorrencia/agregar.ts';
import { cacheConcorrenciaGet, cacheConcorrenciaSet } from '../redis/cache-concorrencia.ts';
import { pool } from '../concorrencia/pool.ts';
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

// Limite de buscas simultâneas no ML ao resolver GTINs não cacheados.
const POOL_CONCORRENCIA = 6;

/**
 * Concorrência por família (ADR-0014). O endpoint legado `/sites/MLB/search` foi
 * descontinuado pelo ML (403); usamos o catálogo:
 *   1) `/products/search?product_identifier={gtin}` → product_id (lookup oficial de EAN;
 *      `q={gtin}` era busca textual frágil e falhava com EANs válidos — bug lote #27)
 *   2) `/products/{id}/items` → vendedores distintos + menor preço
 * Cada cor da família pode ser um produto de catálogo DISTINTO no ML — parar no 1º GTIN que
 * casasse reportava o preço de UMA cor como se fosse o da família (bug lote #28). Agora
 * resolvemos TODOS os GTINs válidos (cache + busca em paralelo) e agregamos com
 * `agregarConcorrencia`, que reporta o menor preço real entre as cores.
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
    // Cap defensivo: evita busca patológica em família gigante (dezenas de cores).
    const candidatos = gtins.slice(0, 60);

    const hits: ProdutoConcorrencia[] = [];
    const misses: string[] = [];

    // Leituras de cache em paralelo: Redis GET não tem rate-limit/ordenação como a API do ML.
    const cacheados = await pool(10, candidatos, async (gtin) => ({
      gtin,
      cached: await cacheConcorrenciaGet(`gtin:${gtin}`).catch(() => null),
    }));
    for (const { gtin, cached } of cacheados) {
      if (!cached) {
        misses.push(gtin);
        continue;
      }
      if (cached.product_id === null) continue; // tombstone: GTIN sem produto de catálogo, não rebusca
      if (cached.product_id && cached.ofertas) {
        hits.push({ product_id: cached.product_id, product_name: cached.product_name ?? null, ofertas: cached.ofertas });
      }
    }

    if (misses.length > 0 && conexao) {
      try {
        const token = await getValidAccessTokenConexao(conexao);

        const resolvidos = await pool(POOL_CONCORRENCIA, misses, async (gtin) => {
          try {
            const busca = await mlGet(
              `${API}/products/search?status=active&site_id=MLB&product_identifier=${encodeURIComponent(gtin)}`,
              token,
            );
            const productId = parseProdutoBusca(busca);
            if (!productId) {
              await cacheConcorrenciaSet(`gtin:${gtin}`, {
                vendedores: 0, preco_min: null, origem: 'gtin', classe: 'sem', product_id: null, product_name: null,
              }).catch(() => {});
              return null;
            }

            const itensJson = await mlGet(`${API}/products/${productId}/items`, token);
            const ofertas = parseItensProduto(itensJson);
            const product_name = parseNomeProdutoBusca(busca);
            await cacheConcorrenciaSet(`gtin:${gtin}`, {
              vendedores: ofertas.vendedores,
              preco_min: ofertas.preco_min,
              origem: 'gtin',
              classe: classificarConcorrencia(ofertas.vendedores),
              product_id: productId,
              product_name,
              ofertas,
            }).catch(() => {});
            return { product_id: productId, product_name, ofertas } as ProdutoConcorrencia;
          } catch (werr) {
            // Erro transitório (ex.: timeout do mlGet): não grava tombstone, re-tenta na próxima execução.
            console.warn(`buscarConcorrencia: worker falhou p/ gtin ${gtin}: ${(werr as Error).message}`);
            return null;
          }
        });

        for (const r of resolvidos) {
          if (r) hits.push(r);
        }
      } catch (netErr) {
        console.warn(
          `buscarConcorrencia: fase de rede falhou (${(netErr as Error).message}), seguindo com ${hits.length} hit(s) em cache`,
        );
      }
    }

    if (hits.length === 0) {
      // Nenhum EAN casou no catálogo.
      return { ...NENHUMA, origem: 'gtin' };
    }
    return agregarConcorrencia(hits);
  } catch (e) {
    console.warn(`buscarConcorrencia falhou: ${(e as Error).message}`);
    return NENHUMA;
  }
}
