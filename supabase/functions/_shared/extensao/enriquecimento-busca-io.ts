// GET no ML do enriquecimento da busca (Task 9): UMA tentativa, sem retry oculto (nem em 429), com timeout.
// Diferente do `mlGet` (15 s + retry, 404 → null): aqui o status importa (404 "No winners found" = 0 ofertas;
// 429 = aguardando). O token vem de `getValidAccessTokenConexao` na edge; nada de refresh novo.
import type { RespostaMl } from './enriquecimento-busca.ts';

const TIMEOUT_MS = 5000;

/** status 0 = timeout/rede. Corpo não-JSON = null. Nunca lança. */
export async function getMlUmaVez(url: string, token: string, timeoutMs = TIMEOUT_MS): Promise<RespostaMl> {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
    let corpo: unknown = null;
    try { corpo = await r.json(); } catch { /* corpo não-JSON */ }
    return { status: r.status, corpo };
  } catch {
    return { status: 0, corpo: null };
  }
}
