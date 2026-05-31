import { getValidAccessToken } from './token.ts';
import { escolherIdentificador, type FamiliaParaBusca } from '../concorrencia/identificador.ts';
import { parseResultadoBusca } from '../concorrencia/parse.ts';
import { classificarConcorrencia } from '../concorrencia/classificar.ts';
import { cacheConcorrenciaGet, cacheConcorrenciaSet } from '../redis/cache-concorrencia.ts';
import type { ResultadoConcorrencia } from '../concorrencia/tipos.ts';

const NENHUMA: ResultadoConcorrencia = {
  vendedores: 0, preco_min: null, origem: 'nenhuma', classe: 'sem',
};

const SEARCH_URL = 'https://api.mercadolibre.com/sites/MLB/search';

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buscarConcorrencia(
  userId: string,
  familia: FamiliaParaBusca,
): Promise<ResultadoConcorrencia> {
  try {
    const ident = escolherIdentificador(familia);
    const termo = ident.tipo === 'gtin'
      ? `gtin:${ident.valor}`
      : `titulo:${await sha256Hex(ident.valor.toLowerCase().trim())}`;

    const cached = await cacheConcorrenciaGet(termo).catch(() => null);
    if (cached) {
      return {
        vendedores: cached.vendedores,
        preco_min: cached.preco_min,
        origem: cached.origem,
        classe: cached.classe,
      };
    }

    const token = await getValidAccessToken(userId);
    const url = `${SEARCH_URL}?q=${encodeURIComponent(ident.valor)}&limit=50`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      console.warn(`ML search ${resp.status} para "${ident.valor}"`);
      return NENHUMA;
    }

    const json = await resp.json();
    const { vendedores, preco_min } = parseResultadoBusca(json);
    const classe = classificarConcorrencia(vendedores);
    const resultado: ResultadoConcorrencia = { vendedores, preco_min, origem: ident.tipo, classe };

    await cacheConcorrenciaSet(termo, resultado).catch(() => {});
    return resultado;
  } catch (e) {
    console.warn(`buscarConcorrencia falhou: ${(e as Error).message}`);
    return NENHUMA;
  }
}
