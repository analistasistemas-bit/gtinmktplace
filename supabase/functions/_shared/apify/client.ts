// Cliente Apify (ADR-0122). Token em APIFY_TOKEN (produção: `supabase secrets set`; dev:
// .env.local). Run síncrono: a própria Apify corta em 300s (HTTP 408), então o timeout do run
// fica bem abaixo disso; padrão assíncrono (start + poll) só se este teto se provar curto.
const ACTOR_ML = 'karamelo~mercadolivre-scraper-brasil-portugues'; // ADR-0122 §2
const TIMEOUT_RUN_S = 120;

export const apifyConfigurado = (): boolean => !!Deno.env.get('APIFY_TOKEN');

/** Busca no ML via actor (1 página ≈ 50 anúncios, ordem de relevância). Devolve os itens crus
 *  do dataset, ou null em qualquer falha (rede, timeout, run FAILED) — o chamador degrada. */
export async function buscarAnunciosML(termo: string): Promise<unknown[] | null> {
  const token = Deno.env.get('APIFY_TOKEN')!;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), (TIMEOUT_RUN_S + 15) * 1000);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ML}/run-sync-get-dataset-items?timeout=${TIMEOUT_RUN_S}&format=json`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: termo, maxPages: 1 }),
        signal: ctrl.signal,
      },
    );
    if (!res.ok) {
      console.error(`[apify] ${res.status} para "${termo}": ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const json = await res.json();
    return Array.isArray(json) ? json : null;
  } catch (e) {
    console.error(`[apify] falha para "${termo}":`, e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(t);
  }
}
