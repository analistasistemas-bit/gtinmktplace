// GET no ML do enriquecimento da busca: UMA tentativa, sem retry oculto (nem em 429), com timeout.
// Diferente do `mlGet` (15 s + retry, 404 → null): aqui o status importa (404 "No winners found" = 0 ofertas;
// 429 = limite do ML, com o Retry-After). O token vem de `getValidAccessTokenConexao` na edge; nada de refresh novo.
import type { RespostaMl } from './enriquecimento-busca.ts';

const TIMEOUT_MS = 3000;

/** Timeout + cancelamento do chamador num sinal só, sem depender de `AbortSignal.any` (o runtime da edge não fixa
 *  versão). `liberar()` desarma o timer e remove o listener — chamar sempre ao terminar. */
export function sinalComPrazo(timeoutMs: number, sinal?: AbortSignal): { signal: AbortSignal; liberar: () => void } {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException('prazo', 'TimeoutError')), Math.max(0, timeoutMs));
  const cancelar = () => ctl.abort(sinal?.reason);
  if (sinal?.aborted) cancelar();
  else sinal?.addEventListener('abort', cancelar, { once: true });
  return { signal: ctl.signal, liberar: () => { clearTimeout(timer); sinal?.removeEventListener('abort', cancelar); } };
}

/** Retry-After em segundos ou data HTTP → instante (ms); ausente/inválido = undefined. */
export function retryAfterMs(v: string | null, agoraMs: number): number | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (/^\d+$/.test(t)) return agoraMs + Number(t) * 1000;
  const d = Date.parse(t);
  return Number.isFinite(d) ? d : undefined;
}

/** status 0 = timeout/rede/cancelado. Corpo não-JSON = null. Nunca lança. `sinal` = cancelamento da página. */
export async function getMlUmaVez(url: string, token: string, timeoutMs = TIMEOUT_MS, sinal?: AbortSignal): Promise<RespostaMl> {
  const { signal, liberar } = sinalComPrazo(timeoutMs, sinal);
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
    let corpo: unknown = null;
    try { corpo = await r.json(); } catch { /* corpo não-JSON */ }
    const tentarApos = r.status === 429 ? retryAfterMs(r.headers.get('retry-after'), Date.now()) : undefined;
    return tentarApos === undefined ? { status: r.status, corpo } : { status: r.status, corpo, tentarApos };
  } catch {
    return { status: 0, corpo: null };
  } finally {
    liberar();
  }
}
