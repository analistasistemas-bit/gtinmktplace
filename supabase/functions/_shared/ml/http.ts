// Pulse (ADR-0119): GET genérico na API do ML com timeout e 1 retry (429/timeout).
// Os mlGet privados de concorrencia.ts/mercado.ts NÃO são tocados (regra cirúrgica do plano) —
// este é o único ponto de leitura do coletor Pulse.
const TIMEOUT_MS = 15000;
export async function mlGet(url: string, token: string, tentativa = 0): Promise<unknown | null> {
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (resp.status === 429 && tentativa === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      return mlGet(url, token, 1);
    }
    if (!resp.ok) {
      console.warn(`ML GET ${resp.status}: ${url}`);
      return null;
    }
    return resp.json();
  } catch (e) {
    if (tentativa === 0) return mlGet(url, token, 1);
    console.warn(`ML GET falhou: ${url}: ${(e as Error).message}`);
    return null;
  }
}
