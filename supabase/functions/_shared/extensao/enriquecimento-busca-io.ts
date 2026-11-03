// GET no ML do enriquecimento da busca: UMA tentativa, sem retry oculto (nem em 429), com timeout.
// Diferente do `mlGet` (15 s + retry, 404 → null): aqui o status importa (404 "No winners found" = 0 ofertas;
// 429 = limite do ML). O token vem de `getValidAccessTokenConexao` na edge; nada de refresh novo.
import type { RespostaMl } from './enriquecimento-busca.ts';

const TIMEOUT_MS = 3000;

/** status 0 = timeout/rede/cancelado. Corpo não-JSON = null. Nunca lança. `sinal` = cancelamento da página. */
export async function getMlUmaVez(url: string, token: string, timeoutMs = TIMEOUT_MS, sinal?: AbortSignal): Promise<RespostaMl> {
  try {
    const tempo = AbortSignal.timeout(timeoutMs);
    // Sem AbortSignal.any no runtime: perde só o cancelamento do cliente, nunca o GET inteiro.
    const signal = sinal && typeof AbortSignal.any === 'function' ? AbortSignal.any([tempo, sinal]) : tempo;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
    let corpo: unknown = null;
    try { corpo = await r.json(); } catch { /* corpo não-JSON */ }
    return { status: r.status, corpo };
  } catch {
    return { status: 0, corpo: null };
  }
}
