// Cliente Apify (ADR-0122). Token em APIFY_TOKEN (produção: `supabase secrets set`; dev:
// .env.local). Run síncrono: a própria Apify corta em 300s (HTTP 408), então o timeout do run
// fica bem abaixo disso; padrão assíncrono (start + poll) só se este teto se provar curto.
const ACTOR_ML = 'karamelo~mercadolivre-scraper-brasil-portugues'; // ADR-0122 §2
const TIMEOUT_RUN_S = 120;
// Teto de gasto por busca — escolhido pelo Diego em 18/08 pesando custo × cobertura: 20 anúncios
// capturam ~62% das vendas do nicho, contra 41% com 6 (que saíram baratos demais em informação).
// O actor é PAY_PER_EVENT a US$ 0,005 por anúncio e NÃO cobra nada fixo pelo run, então o teto
// vira, na prática, o número de anúncios: 0,10 ≈ 20. Atingir o teto devolve o run como SUCCEEDED
// com os itens que couberam, não como falha (medido: 0,03 → 6 itens, 0,05 → 10, 0,10 → 20).
// `maxItems` não serve aqui: só vale para actors pay-per-result.
//
// Por que não é possível baratear o anúncio em si (medido em 18/08, todas as vias testadas):
// o ML barra scraping próprio — proxy datacenter devolve página vazia e residencial devolve a
// tela "Continuar" (exige JS), confirmando o ADR-0120. Actor mais barato por item (`gio21`,
// US$ 0,00175) não traz vendas; `automation-lab` traz, mas só raspa a página de ofertas do dia.
// Os US$ 0,005 são o preço do desbloqueio (browser real + proxy premium), não gordura — a única
// alavanca é a QUANTIDADE. Reavaliar se a Apify passar a cobrar menos por item em plano pago.
const TETO_USD = 0.10;

export const apifyConfigurado = (): boolean => !!Deno.env.get('APIFY_TOKEN');

/** Busca no ML via actor, na ordem de relevância do ML e limitada pelo teto de gasto (≈20
 *  anúncios). Devolve os itens crus do dataset, ou null em qualquer falha (rede, timeout, run
 *  FAILED) — o chamador degrada. */
export async function buscarAnunciosML(termo: string): Promise<unknown[] | null> {
  const token = Deno.env.get('APIFY_TOKEN')!;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), (TIMEOUT_RUN_S + 15) * 1000);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ML}/run-sync-get-dataset-items?timeout=${TIMEOUT_RUN_S}&format=json&maxTotalChargeUsd=${TETO_USD}`,
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
