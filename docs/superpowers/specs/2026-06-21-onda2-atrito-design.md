# Tarefa 2 / Onda 2 — Tirar atrito operacional (2 fatias)

> Continuação da Onda 1. Reduz fricção do dia-a-dia. Light+dark, TDD na lógica, sem backend.

## Fatia 1 — Preservar estado + chips na Publicados

**Goal:** ao filtrar/ordenar/paginar na Publicados, abrir um detalhe e voltar (back), o estado é restaurado. Filtros ativos viram chips removíveis com "Limpar tudo".

### `src/lib/publicados-url.ts` (função pura, testável)
```ts
export const TAMANHO_PADRAO = 10;
export interface EstadoPublicados { filtro: FiltroPublicados; ord: OrdenacaoPublicados | null; pagina: number; tamanho: number }
export function estadoParaParams(e: EstadoPublicados): URLSearchParams;
export function paramsParaEstado(p: URLSearchParams): EstadoPublicados;
```
Params: `q` (busca), `fornecedor`, `status`, `tipo`, `ord`+`dir`, `pg` (>1), `ts` (≠10). Valores inválidos (status/tipo/coluna fora do domínio) caem para null/sem-ordenação. Round-trip estável.

### `src/components/filtros-ativos.tsx`
`<FiltrosAtivos filtro onRemover onLimpar />` — um chip por filtro ativo (busca/fornecedor/status/tipo) com "×" para remover; botão "Limpar tudo". Some quando não há filtro ativo. Rótulos legíveis para status/tipo.

### Integração `Publicados.tsx`
Fonte de verdade vira a **URL** (`useSearchParams`): `filtro`/`ord`/`pagina`/`tamanho` derivados de `paramsParaEstado`; setters escrevem via `setSearchParams(..., { replace: true })` (não polui histórico por tecla). Remove `useState` de filtro/ord, `usePaginacao` e o `useEffect` de reset (página volta a 1 ao mudar filtro/ordenação, embutido nos setters). Paginação via `paginar(itensExibidos, pagina, tamanho)`. Chips abaixo da barra de filtros.

**Fora do núcleo:** restauração de scroll (frágil com HashRouter).

## Fatia 2 — Quick wins

- **Paginação default 10:** `usePaginacao` default `5 → 10` (Dashboard/Revisão). Publicados já usa `TAMANHO_PADRAO = 10`.
- **Estados vazios acionáveis:** `EmptyState` da Publicados (sem anúncios) ganha CTA "Novo lote"; auditar Dashboard (já tem) e Viabilidade.

## Escopo de arquivos
- **Criar:** `lib/publicados-url.ts` + teste · `components/filtros-ativos.tsx`.
- **Modificar:** `Publicados.tsx` (URL + chips + paginar + CTA vazio), `hooks/usePaginacao.ts` (default 10).

## Testes
- **Unit (Vitest):** `estadoParaParams`/`paramsParaEstado` — round-trip, defaults, valores inválidos, página/tamanho.
- **Visual (navegador, light+dark):** filtro aplicado → ir a detalhe → voltar restaura; chips + remover + limpar tudo; paginação mostra 10; Publicados vazio com CTA.

## Não-objetivos
Scroll restoration · aviso global do worker (adiado) · migrar Dashboard/Revisão para URL (só paginação 10) · Onda 3 (breadcrumbs, busca global, período sincronizado, drill-down KPIs, a11y).
