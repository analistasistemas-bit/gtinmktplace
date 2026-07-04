import { redisGet, redisSet } from '../redis/client.ts';

// Preditor nativo de categoria do ML (ADR-0026 / E3). domain_discovery devolve um array
// ORDENADO por relevância; o topo é a melhor categoria-folha. Validado com token real (probe
// 2026-06-14): caneta→MLB44014, furadeira→MLB189007, shampoo→MLB1265, caderno→MLB105305.
export interface CategoriaCandidata {
  domainId: string;
  domainName: string;
  categoriaId: string;
  categoriaNome: string;
}

/** Mapeia a resposta do domain_discovery (preserva a ordem; descarta item sem category_id). */
export function parseDomainDiscovery(body: unknown): CategoriaCandidata[] {
  if (!Array.isArray(body)) return [];
  return body
    .filter(
      (x): x is Record<string, string> =>
        !!x && typeof (x as { category_id?: unknown }).category_id === 'string' &&
        (x as { category_id: string }).category_id.length > 0,
    )
    .map((x) => ({
      domainId: String(x.domain_id ?? ''),
      domainName: String(x.domain_name ?? ''),
      categoriaId: x.category_id,
      categoriaNome: String(x.category_name ?? ''),
    }));
}

const TTL_S = 30 * 24 * 60 * 60; // 30d — categorização muda raro; cache verificável (reprocessar invalida).

function chaveCache(q: string): string {
  const norm = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  return `dd:${norm.slice(0, 120)}`;
}

/** Busca a categoria prevista pelo ML. Resiliente: rede/4xx → []. Cacheado no Redis. */
export async function buscarCategoriaPreditor(token: string, query: string): Promise<CategoriaCandidata[]> {
  const q = (query ?? '').trim();
  if (!q) return [];
  const key = chaveCache(q);
  const cached = await redisGet(key).catch(() => null);
  if (cached) return JSON.parse(cached) as CategoriaCandidata[];

  const r = await fetch(
    `https://api.mercadolibre.com/sites/MLB/domain_discovery/search?limit=8&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return [];
  const candidatos = parseDomainDiscovery(await r.json().catch(() => null));
  await redisSet(key, JSON.stringify(candidatos), TTL_S).catch(() => {});
  return candidatos;
}

const TTL_NOME_S = 30 * 24 * 60 * 60; // mesmo TTL de buscarCategoriaPreditor — nome de categoria muda raro.

/**
 * Nome humano de uma categoria pelo ID (GET /categories/{id}). Usado só para a sugestão do
 * concorrente (ADR-0057) — os resultados de busca já trazem o nome via domain_discovery.
 * Resiliente: rede/4xx → null (sugestão simplesmente não aparece). Cacheado no Redis.
 */
export async function buscarNomeCategoria(token: string, categoriaId: string): Promise<string | null> {
  if (!categoriaId) return null;
  const key = `catnome:${categoriaId}`;
  const cached = await redisGet(key).catch(() => null);
  if (cached) return cached;

  const r = await fetch(`https://api.mercadolibre.com/categories/${categoriaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const json = await r.json().catch(() => null) as { name?: string } | null;
  const nome = json?.name ?? null;
  if (nome) await redisSet(key, nome, TTL_NOME_S).catch(() => {});
  return nome;
}
