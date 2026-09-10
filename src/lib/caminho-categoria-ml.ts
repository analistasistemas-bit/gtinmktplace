// Caminho completo de uma categoria do ML (`path_from_root`, folha inclusa) para exibição.
//
// ponytail: leitura direta na API pública do ML, fora do padrão "tudo pela edge" — o endpoint
// `GET /categories/{id}` não exige token, é somente leitura e devolve CORS liberado (conferido
// em 10/09/2026). Passar por edge function custaria um deploy obrigatório (CLAUDE.md) para uma
// decoração de UI. Não "consertar" isso movendo para o backend sem motivo novo.

const cache = new Map<string, Promise<string[]>>();

/**
 * Nomes do `path_from_root`, do topo até a própria categoria. Qualquer falha (rede, 4xx, id
 * inválido) resolve `[]` — quem chama cai no nome simples da categoria, nunca em tela vazia.
 */
export function caminhoCategoriaML(categoriaId: string): Promise<string[]> {
  if (!/^MLB\d+$/.test(categoriaId)) return Promise.resolve([]);
  const emCache = cache.get(categoriaId);
  if (emCache) return emCache;

  const promessa = fetch(`https://api.mercadolibre.com/categories/${categoriaId}`, {
    // `?.` proposital: em navegador sem AbortSignal.timeout (Safari/iOS < 16, ainda vivo em PWA
    // instalada) a chamada lançaria SÍNCRONO, fora do .catch — e uma decoração de UI derrubaria o
    // diálogo inteiro no error boundary. `fetch` aceita `signal: undefined`.
    signal: AbortSignal.timeout?.(10_000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      const path = (json as { path_from_root?: { name?: unknown }[] } | null)?.path_from_root;
      if (!Array.isArray(path)) return [];
      return path.map((n) => String(n?.name ?? '').trim()).filter(Boolean);
    })
    .catch(() => [] as string[]);

  cache.set(categoriaId, promessa);
  // Falha transitória não pode ficar grudada na sessão inteira: só resultado bom fica no cache.
  void promessa.then((c) => { if (c.length === 0) cache.delete(categoriaId); });
  return promessa;
}
