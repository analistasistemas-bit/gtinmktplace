# Paginação client-side — Dashboard, Revisão, Publicados

**Data:** 2026-06-12
**Status:** Aprovado (brainstorming)
**Escopo:** Frontend only. Zero backend/schema/edge.

## Problema

As listas das telas **Dashboard** (lotes), **Revisão** (famílias) e **Publicados**
(anúncios) crescem sem limite e ficam longas demais para navegar. Diego pediu
paginação, sugerindo 5 itens por página.

Todas as três telas já carregam os dados completos no cliente (via hooks
`useLotes`/`useFamilias`/`usePublicados`), então a paginação é **puramente
client-side** — fatiar a renderização da lista já em memória. Nenhuma mudança de
backend, edge function ou schema.

## Decisões do brainstorming

1. **"Selecionar todos" na Revisão** age sobre **todas as famílias filtradas**
   (todas as páginas), não só a página atual. A lógica atual já faz isso
   (`idsSelecionaveis` deriva de `visiveis`, a lista filtrada inteira); paginar
   só a renderização preserva esse comportamento.
2. **Itens por página:** seletor **5 / 10 / 20 / 50**, padrão **5**.

## Arquitetura

Componente + hook + função pura reutilizáveis, no design system existente.

### `src/lib/paginacao.ts` — função pura (TDD)

```ts
export interface ResultadoPaginacao<T> {
  itensPagina: T[];
  paginaAtual: number;   // clampada ao range válido [1, totalPaginas]
  totalPaginas: number;  // mínimo 1, mesmo com lista vazia
  inicio: number;        // índice 1-based do primeiro item exibido (0 se vazio)
  fim: number;           // índice 1-based do último item exibido (0 se vazio)
  total: number;         // itens.length
}

export function paginar<T>(itens: T[], pagina: number, tamanho: number): ResultadoPaginacao<T>;
```

Regras:
- `totalPaginas = max(1, ceil(total / tamanho))`.
- `paginaAtual` é clampada: pedir página 99 numa lista de 2 páginas devolve a 2;
  pedir página 0 ou negativa devolve 1.
- Lista vazia → `itensPagina: []`, `totalPaginas: 1`, `inicio: 0`, `fim: 0`,
  `total: 0`.
- Não muta a entrada.

### `src/hooks/usePaginacao.ts` — estado em memória

```ts
export function usePaginacao<T>(itens: T[], opts?: { tamanhoInicial?: number }): {
  itensPagina: T[];
  paginaAtual: number;
  totalPaginas: number;
  inicio: number;
  fim: number;
  total: number;
  tamanho: number;
  irPara: (pagina: number) => void;
  proxima: () => void;
  anterior: () => void;
  setTamanho: (n: number) => void;
  reset: () => void;          // volta para a página 1
};
```

- Guarda `pagina` e `tamanho` em `useState` (`tamanhoInicial` padrão 5).
- Deriva o recorte chamando `paginar(itens, pagina, tamanho)` a cada render — a
  página efetiva é sempre a clampada (se a lista encolher e a página atual sair
  do range, o recorte já volta para a última página válida sem efeito extra).
- `setTamanho` também volta para a página 1 (trocar tamanho não deve deixar o
  usuário numa página inexistente).
- Sem URL params, sem persistência — YAGNI.

### `src/components/ui/pagination.tsx` — componente visual

Props mínimas, dirigido pelo hook:

```ts
interface PaginationProps {
  paginaAtual: number;
  totalPaginas: number;
  inicio: number;
  fim: number;
  total: number;
  tamanho: number;
  onIrPara: (pagina: number) => void;
  onTamanho: (n: number) => void;
  rotuloItem?: string;          // ex.: "anúncio" / "lote" / "família" (default "item")
  tamanhos?: number[];          // default [5, 10, 20, 50]
}
```

Layout (tokens do DS, `ChevronLeft`/`ChevronRight` lucide):
- Esquerda: texto `"{inicio}–{fim} de {total} {rotuloItem}(s)"`.
- Centro/direita: `‹ Anterior` · números de página com elipse quando muitos
  (janela ao redor da atual: primeira, última, vizinhas, `…`) · `Próximo ›`.
- Extremo direito: `Select` de itens por página (reusa `@/components/ui/select`).
- **Só 1 página:** esconde os botões de navegação e os números; mantém o texto
  de contagem e o seletor de tamanho.
- Lista vazia (`total === 0`): a tela já mostra o próprio `EmptyState`/vazio, então
  o componente **não é renderizado** nesse caso (responsabilidade da tela).

## Comportamento comum

- Trocar **filtro, busca ou tamanho de página → volta para a página 1**
  (`reset()` / `setTamanho` já reseta) para não cair em página vazia.
- Trocar de página → **scroll para o topo da lista** (`scrollIntoView` no
  contêiner da lista, ou `window.scrollTo` onde a página inteira rola).
- Encolhimento de dados (ex.: remover publicado, filtro reduz total) → o
  `paginar` já clampa; nenhuma página vazia presa.

## Aplicação por tela

Nenhuma muda lógica de negócio — só fatia a renderização.

### Dashboard (`src/pages/Dashboard.tsx`)
- `usePaginacao(lotes)`; renderiza `itensPagina` no lugar de `lotes.map`.
- `<Pagination rotuloItem="lote">` abaixo da lista de cards.
- Sem filtro → sem `reset`.

### Publicados (`src/pages/Publicados.tsx`)
- `usePaginacao(itensExibidos)` (após `filtrarPublicados`).
- Renderiza `itensPagina` nas linhas da tabela.
- `reset()` num `useEffect` quando `filtro` muda.
- O `<Pagination rotuloItem="anúncio">` substitui o atual
  `"{itensExibidos.length} de {publicados.length} anúncio(s)"`.

### Revisão (`src/pages/Revisao.tsx`)
- `usePaginacao(visiveis)`; renderiza `itensPagina` no `.map` das `FamiliaRow`.
- **`idsSelecionaveis`, os `counts` das tabs e o "Selecionar todos" continuam
  derivando de `visiveis`/`familias` (lista filtrada inteira)** — inalterados.
- Seleção (`selecionadas`) e expansão (`expandidas`) são `Set` por id →
  persistem ao paginar sem nenhuma mudança.
- `reset()` num `useEffect` quando `filtro` ou `busca` mudam.
- `<Pagination rotuloItem="família">` no fim da área scrollável (acima do footer
  sticky "Publicar selecionadas", que continua mostrando `selecionadas.size`
  global).

## Testes

- **TDD `paginar`** (`tests/lib/paginacao.test.ts`): recorte correto por página,
  `totalPaginas`, clamp (página acima do range, página 0/negativa), lista vazia,
  `inicio`/`fim`, imutabilidade da entrada.
- **`usePaginacao`** (`tests/hooks/usePaginacao.test.ts`): navegação
  (`proxima`/`anterior`/`irPara`), `setTamanho` reseta para página 1, `reset`,
  clamp quando a lista encolhe.
- Os testes existentes de `filtrarFamilias`/`filtrarPublicados` continuam válidos
  (a filtragem não muda).

## Fora de escopo (YAGNI)

- Paginação no backend / `range()` do Supabase.
- Estado de paginação na URL (query params).
- Paginação em outras telas (Relatório, RevisaoIndex, Progresso).
- Virtualização de lista.
