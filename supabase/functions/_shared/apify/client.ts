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

// Fallback multi-conta (2026-08-22): a conta Apify deixou de ser única — até 4 tokens, tentados
// em ordem fixa de prioridade. Antes de cada tentativa, checa o saldo mensal restante da conta
// (GET /v2/users/me/limits); abaixo de SALDO_MINIMO_USD (folga sobre o teto de $0.10/busca) pula
// pro próximo token sem gastar a chamada. Se a checagem de saldo falhar (rede), não bloqueia — a
// tentativa real decide. Se a busca em si falhar por cota estourada (402) OU token rejeitado
// (401/403 — revogado, expirado, secret errado), também tenta o próximo token, com um warning
// no segundo caso (não deve virar rotina silenciosa); qualquer outro erro (actor FAILED, timeout,
// 5xx) desiste, pois trocar de conta não resolve.
const TOKEN_ENV_VARS = ['APIFY_TOKEN', 'APIFY_TOKEN_2', 'APIFY_TOKEN_3', 'APIFY_TOKEN_4'];
const SALDO_MINIMO_USD = 0.15;

const tokensConfigurados = (): string[] =>
  TOKEN_ENV_VARS.map((nome) => Deno.env.get(nome)).filter((v): v is string => !!v);

export const apifyConfigurado = (): boolean => tokensConfigurados().length > 0;

async function saldoSuficiente(token: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.apify.com/v2/users/me/limits', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return true;
    const json = await res.json();
    const limite = json?.data?.limits?.maxMonthlyUsageUsd;
    const uso = json?.data?.current?.monthlyUsageUsd;
    if (typeof limite !== 'number' || typeof uso !== 'number') return true;
    return limite - uso >= SALDO_MINIMO_USD;
  } catch {
    return true;
  }
}

type Tentativa = { ok: true; itens: unknown[] } | { ok: false; trocarToken: boolean };

async function tentarBusca(token: string, termo: string): Promise<Tentativa> {
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
      const tokenRejeitado = res.status === 401 || res.status === 403;
      if (tokenRejeitado) {
        console.warn(
          `[apify] token rejeitado (${res.status}) — revogado, expirado ou secret incorreto; tentando o próximo`,
        );
      }
      return { ok: false, trocarToken: res.status === 402 || tokenRejeitado };
    }
    const json = await res.json();
    return Array.isArray(json) ? { ok: true, itens: json } : { ok: false, trocarToken: false };
  } catch (e) {
    console.error(`[apify] falha para "${termo}":`, e instanceof Error ? e.message : e);
    return { ok: false, trocarToken: false };
  } finally {
    clearTimeout(t);
  }
}

/** Busca no ML via actor, na ordem de relevância do ML e limitada pelo teto de gasto (≈20
 *  anúncios). Tenta os tokens configurados em ordem de prioridade, pulando os com saldo no final
 *  ou com erro de cota/token rejeitado. Devolve os itens crus do dataset, ou null em qualquer
 *  falha — o chamador degrada. */
export async function buscarAnunciosML(termo: string): Promise<unknown[] | null> {
  for (const token of tokensConfigurados()) {
    if (!(await saldoSuficiente(token))) continue;
    const tentativa = await tentarBusca(token, termo);
    if (tentativa.ok) return tentativa.itens;
    if (!tentativa.trocarToken) return null;
  }
  return null;
}
