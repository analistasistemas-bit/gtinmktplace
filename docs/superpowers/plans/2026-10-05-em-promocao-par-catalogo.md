# Plano — aba "Em promoção" + par normal/catálogo em uma linha

Spec: emenda 2026-10-05 do [ADR-0174](../../decisions/0174-operacoes-em-massa-promocoes-v2.md).
Branch: `worktree-promocoes-em-promocao`.

## Task 1 — Migration + tipos

- `supabase migration new promocao_itens_anuncio_normal`:
  `alter table public.ml_promocao_itens add column anuncio_normal_id text;` (nullable, sem default; RLS
  da tabela já cobre a coluna).
- `src/lib/database.types.ts`: `anuncio_normal_id` em Row/Insert/Update de `ml_promocao_itens`.
- Verificar: `npm run db:check`.

## Task 2 — Sync grava o par (backend, `_shared/promocoes/`)

- `ml.ts`: `ATRIBUTOS_ITEM` += `catalog_listing,item_relations`; `normalizarItemML` devolve
  `catalogo: boolean` (`catalog_listing === true`) e `relacionados: string[]` (ids de `item_relations`
  **sem `variation_id`**).
- `tipos.ts`: `ItemML` += `catalogo`, `relacionados`; `LinhaItem` += `anuncio_normal_id: string | null`.
- Novo `pares.ts` (puro):
  - `normalDoCatalogo(c: ItemML, noLote: Map<string, ItemML>, campanha: Map<string, ItemPromocaoML>): ItemML | null`
    → o relacionado N com `campanha.has(N)`, `noLote.get(N)?.catalogo === false` e
    `!ehParticipando(campanha.get(N).status)`; senão null.
  - `escondeNormal(n: ItemML, it: ItemPromocaoML, noLote, campanha): boolean` → `!n.catalogo`,
    `!ehParticipando(it.status)` e algum relacionado R com `campanha.has(R)` e `noLote.get(R)?.catalogo === true`.
  - Simetria garantida: N escondido ⇔ C mesclado (mesmas três condições lidas dos dois lados).
- `sincronizar.ts` / `sincronizarPromocao`: guarda `campanha = Map(id → item)` de `pendentes` + itens
  anteriores ao cursor (usar a lista inteira de `umaOfertaPorAnuncio`, não só os pendentes). Por lote:
  `buscarItensML(lote)`; ids relacionados presentes na campanha e ausentes do mapa → um `buscarItensML`
  extra e merge no mapa. Filtra `escondeNormal`; para C com `normalDoCatalogo` → `projetarItem` normal
  (projeção do C) e depois sobrescreve `titulo/thumbnail/permalink` com os do N e `anuncio_normal_id = N.id`.
  Demais: `anuncio_normal_id = null`. `feitos` e o cursor seguem contando o lote inteiro.
- `deps.ts` `gravarLote`: grava `anuncio_normal_id`.
- `projetarItem` devolve `anuncio_normal_id: null` (usado também por `operacoes-massa`, sem mudança de
  comportamento lá).
- Testes (vitest, `_shared/promocoes/__tests__/`): `normalizarItemML` (catalog/relations, relação com
  variação ignorada); `pares.ts` (mescla; normal participando não esconde; relacionado ausente do
  multiget não esconde; relação fora da campanha não mescla); `sincronizarPromocao` com par em lotes
  diferentes (normal antes do cursor) grava 1 linha com a cara do normal.

## Task 3 — Front: dados

- `src/lib/promocoes.ts`: `ItemPromocao.anuncio_normal_id`; `COLS_ITEM` += coluna;
  `mlbExibido(it) = it.anuncio_normal_id ?? it.ml_item_id`.
  `fetchParticipacoes()` paginado (`buscarTodasPaginas`) de `ml_promocao_itens` com status
  `started|pending` + `promocao_id`; `agruparParticipacoes(itens, promocoes)` puro: só campanhas
  `started|pending`, sem cupom, ordenadas por `fim` asc; grupo = `{ promocao, itens, operavel: DEAL|SMART }`.
- `src/hooks/usePromocoes.ts`: `useParticipacoes()` (queryKey sob `QK_PROMO`, invalidada junto).
- Testes de `agruparParticipacoes` e `mlbExibido`.

## Task 4 — Front: telas

- `PromocaoDetalhe.tsx` (tabela + `ListaMobile`) e `sheet-cores.tsx`: MLB exibido via `mlbExibido`, e
  "via catálogo {ml_item_id}" em texto pequeno quando difere. Seleção/operação seguem por `ml_item_id`.
- Novo `src/components/promocoes/lista-participando.tsx`: um bloco por campanha (nome, tipo, fim,
  contagem, link pro detalhe); linhas com foto, título, MLB exibido, "de → por", desconto, semáforo.
  DEAL/SMART: checkbox + "selecionar todos" do bloco + botão "Sair (N)" → `PreviewOperacao`
  (`acao='sair'`, promoção do bloco). Outros tipos: sem checkbox, link "Gerenciar no Mercado Livre"
  (`URL_PROMOCOES_ML`). Vazio: `EmptyState` "Nenhum anúncio em promoção.". Mobile: cartões.
- `Promocoes.tsx`: aba `participando` ("Em promoção" + contagem) entre Encerradas e Operações.
- Testes (`src/components/promocoes/__tests__/lista-participando.test.tsx`, `Promocoes.test.tsx`):
  agrupamento renderizado; "Sair" abre preview da campanha certa com os itens selecionados; tipo não
  operável sem checkbox; MLB normal exibido quando há `anuncio_normal_id`.

## Task 5 — Entrega

- `pnpm preflight` (portão local), revisão Grok 4.7 xhigh do diff, CI verde, merge ff.
- Deploy: `supabase db push`; `supabase functions deploy sincronizar-promocoes operacoes-massa` + as
  edges que importam `_shared/ads/sincronizar.ts` / `_shared/trafego/sincronizar.ts`; conferir versões.
- Prova: disparar a leitura da Hairfly (`Atualizar agora` = sync por org) e conferir no banco que
  `P-MLB18061082` tem só `MLB7736509406` com `anuncio_normal_id = MLB5322348511` e título do normal.
- Docs: `docs/TASKS.md`, `docs/reference/modelo-de-dados.md` (coluna), `docs/reference/edge-functions.md`.
