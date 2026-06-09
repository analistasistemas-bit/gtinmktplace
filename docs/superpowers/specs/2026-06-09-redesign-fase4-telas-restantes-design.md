# Redesign PubliAI — Fase 4: Telas restantes

> Spec de design. Parte do redesign faseado. **Data:** 2026-06-09 · **Branch:** `worktree-redesign-fase4` · **Pré-requisitos:** Fases 1 (DS), 2 (shell) e 3 (Revisão).

## Objetivo

Aplicar o re-skin premium das Fases 1–3 a **todas as telas que ainda não passaram pelo tratamento de conteúdo**. Hoje essas telas já herdam o app shell (sidebar/topbar) e os tokens globais, mas o conteúdo interno ainda usa cores hardcoded sem dark, headers crus e estados vazios manuais. **Re-skin 100% presentacional: ZERO mudança de lógica, hooks, handlers, estado, ordem de chamadas, queries ou comportamento.** Muda só markup/classes/estrutura visual.

## Escopo (telas e componentes)

**Telas internas (dentro do shell):**
- `src/pages/Dashboard.tsx` — lista de lotes.
- `src/pages/NovoLote.tsx` — upload de planilha + imagens.
- `src/pages/Progresso.tsx` — progresso de processamento.
- `src/pages/Relatorio.tsx` — resultado da publicação.
- `src/pages/Publicados.tsx` — tabela de anúncios ao vivo.
- `src/pages/Configuracoes.tsx` — conexão ML + estratégia + desconto + categorias.
- `src/pages/RevisaoIndex.tsx` — redirect/empty trivial.

**Componentes:**
- `src/components/status-badge.tsx` — badge de status de lote.
- `src/components/lote-card.tsx` — card do lote (já usa `Card`; só herda o `StatusBadge` novo).

**Telas de auth (fora do shell):**
- `src/pages/Login.tsx`, `Cadastro.tsx`, `ResetSenha.tsx` — já usam `Card`/`Input`/`Button`; polish leve de marca/coerência.
- `src/pages/NotFound.tsx` — 404 cru → `EmptyState`/tokens.

## Problemas atuais

1. **Cores hardcoded sem dark** espalhadas: `green-50/700/800`, `blue-50/600/800`, `red-50/600/700`, `amber-50/300/600/700/800/900`, `green-100/800`, `gray-200/700`. Quebram no dark mode e ignoram os tokens semânticos.
2. **Headers crus** `text-2xl font-semibold` (ou `text-xl`) em vez de `PageHeader`.
3. **Estados vazios manuais** (`border-dashed p-8 text-center`) em vez de `EmptyState`.
4. **Tabela manual** em Publicados (`<table>`/`<thead>`/`<tr>` crus) em vez dos primitivos `Table` do DS.
5. **`BadgeStatus` de Publicados** com paleta hardcoded em vez de `StatusPill`.
6. **`<input type="number">` cru** em Configurações em vez do `Input` do DS.
7. **Emojis como ícones de estado** (✅⏳❌⚠) em Relatório/Progresso em vez de ícones lucide monocromáticos.
8. **`StatusBadge`** usa `Badge variant` genérico (sem semântica de cor de estado).

## Design

### Princípio mestre — mapa de tokens (aplica-se a TODAS as telas)

A mesma regra central da Fase 3: substituir cada cor hardcoded pelo `StatusPill`/token semântico equivalente.

| Hoje (hardcoded) | Novo |
|---|---|
| `bg-green-50 text-green-800` (publicada/sucesso) | card/banner com token `success`: `border-success/30 bg-success/10 text-success` |
| `bg-blue-50 text-blue-800` (em publicação/info) | token `info`: `border-info/30 bg-info/10 text-info` |
| `bg-red-50 text-red-800` (erro) | token `destructive`/`danger`: `border-destructive/30 bg-destructive/5 text-destructive` |
| `bg-amber-300/50 text-amber-800/900` (aviso) | token `warning`: `border-warning/30 bg-warning/10 text-warning` |
| `Badge bg-green-100 text-green-800` ("Conectado") | `StatusPill tone="success"` |
| `text-blue-600 underline` (link "ver anúncio ↗") | `text-primary underline` (ou `Button variant="link"`) |
| `text-red-600` (mensagem de erro inline) | `text-destructive` |
| `text-green-700` ("✓ Salvo") | `text-success` |
| `BadgeStatus` Publicados: ativo/pausado/encerrado/moderado/inativo/indisponível | `StatusPill` tones: ativo→`success`, pausado→`neutral`, encerrado→`neutral`, moderado→`warning`, inativo→`danger`, indisponível→`neutral` (dashed mantém-se opcional) |
| emojis de estado ✅⏳❌⚠ | ícones lucide (`CheckCircle2`/`Loader2`/`XCircle`/`AlertTriangle`) com cor por token |

### 4a — status-badge.tsx + Dashboard.tsx + RevisaoIndex.tsx

- **`StatusBadge`**: trocar o `Badge variant` por `StatusPill` com mapeamento de tom por `LoteStatus` (`importando`/`processando`→`info`, `revisao`→`info`, `publicando`→`info`, `concluido`→`success`, `erro`→`danger`). **Os labels (`LABELS`) permanecem idênticos** (os testes asseram texto). Assinatura `{ status }` intacta.
- **Dashboard**: header cru → `PageHeader title="Lotes recentes"` com `actions` = botão "Novo lote". Estado vazio → `EmptyState` (ícone `PackageOpen`, ação "Novo lote"). Loading → texto/`Skeleton` opcional. Erro → token destructive. **`useLotes` e a lista de `LoteCard` intactos.**
- **RevisaoIndex**: o empty inline ganha `EmptyState` (ou mantém, polish mínimo). Lógica de `Navigate`/loading intacta.

### 4b — NovoLote.tsx + Progresso.tsx

- **NovoLote**: header → `PageHeader title="Novo lote"`. Barra de progresso manual → `Progress` do DS (já usado em Progresso). Banner de erro mantém token destructive. **`useUploadLote`, `handleProcessar`, `Dropzone` e estados intactos.**
- **Progresso**: header → `PageHeader` (título "Processando lote #N" + subtítulo de status/contadores). Banner amber de anomalias → token `warning` (emoji ⚠ → ícone `AlertTriangle`). Lista de famílias com `text-muted-foreground` do DS; status por linha pode virar `StatusPill` leve. **`useLoteRealtime`, polling, efeito de navegação intactos.**

### 4c — Relatorio.tsx

- Header → `PageHeader title="Relatório · Lote #N"`.
- Os 3 cards `green-50/blue-50/red-50` → `KpiCard` (ou cards do DS com token semântico): publicadas→`success`, publicando→`info`, erro→`destructive`. Emojis → ícones lucide.
- Link "ver anúncio ↗" `text-blue-600` → `text-primary` / `Button variant="link"`. Mensagem de erro `text-red-600` → `text-destructive`. Status por linha → `StatusPill`.
- **`useLote`/`useFamilias`/polling/`nav` intactos.**

### 4d — Publicados.tsx (a mais pesada)

- Header → `PageHeader title="Publicados"` com `actions` = botão "Atualizar".
- **`BadgeStatus`** → `StatusPill` por tom (mapa acima); o `STATUS_LABEL` e o `motivo` de "moderado" preservados (motivo com `text-warning`).
- Banner "sem credencial ML" amber → token `warning`. Banner de erro de remoção mantém token destructive.
- **Tabela manual `<table>` → primitivos `Table/TableHeader/TableRow/TableHead/TableBody/TableCell`** do DS. As colunas, células, `LinhaTabela`, dialogs (Descrição, Remover), `Select`s de filtro e `Input` de busca preservam toda a lógica (`merged`, `filtrarPublicados`, `handleRemover`, `removendoId`).
- Estado vazio (`publicados.length === 0`) → `EmptyState`. "Nenhum resultado para os filtros" → célula de empty coerente.
- **`usePublicados`/`useStatusPublicados`/`useRemoverPublicado`/`useMemo`s intactos.**

### 4e — Configuracoes.tsx

- Header → `PageHeader title="Configurações"`.
- Banners `green-50`/`red-50` → tokens `success`/`destructive`. Badge "Conectado" `green-100` → `StatusPill tone="success"`.
- `<input type="number">` cru → `Input` do DS (mantendo `value`/`onChange`/`onBlur`/`min`/`max`/`step` idênticos). "✓ Salvo" `text-green-700` → `text-success`.
- Cards já usam `Card`; manter. `RadioGroup` da estratégia e a lista de categorias com tipografia do DS. **`useMlConnection`/`useDescontoPct`/`useSalvarDescontoPct`/handlers intactos.**

### 4f — Auth (Login/Cadastro/ResetSenha) + NotFound

- Auth: já usam `Card`/`Input`/`Button`. Polish leve: marca "PubliAI" consistente (tipografia DS), `bg-muted/30` → token coerente, espaçamento. **`signIn`/`signUp`/`sendPasswordReset` e estados intactos.**
- NotFound: 404 cru → `EmptyState` (ícone) ou layout com tokens + link "Voltar".

## Restrições (inegociáveis)

- **Zero** alteração de lógica: handlers, hooks, mutations, `useState`, efeitos, ordens de await, cálculos, queries (`useLotes`, `usePublicados`, `filtrarPublicados`, `merged`, etc.) **idênticos**. Só markup/classes.
- Não tocar em: edge functions, queries, schema, `lib/*` de domínio, funções puras exportadas (`filtrarPublicados` segue com mesma assinatura/comportamento e seus testes verdes).
- Dark + light corretos (motivo do mapa de tokens). Contraste AA. Foco visível.
- Labels de texto preservados onde há testes (`StatusBadge`: `LABELS`; `LoteCard`: contadores/links).

## Testes e verificação

- **Não-regressão é o critério-chave.** Testes que tocam o escopo: `tests/components/status-badge.test.tsx`, `tests/components/lote-card.test.tsx`, `tests/lib/publicados.test.ts`, `tests/App.test.tsx`, `tests/components/shell.test.tsx`, `tests/components/ui-components.test.tsx`. Todos seguem verdes; se um quebrar por seletor de cor/texto, ajustar o seletor **sem** afrouxar a asserção de comportamento.
- `pnpm test` verde, `pnpm exec tsc --noEmit`, `pnpm lint` (0 errors) e `pnpm build` limpos.
- Visual: validar dark + light ao vivo em cada tela.

## Critérios de aceite

- [ ] Nenhuma cor hardcoded sem dark remanescente nas telas/componentes do escopo (tudo via token/StatusPill).
- [ ] Todas as telas internas com `PageHeader`; estados vazios com `EmptyState`.
- [ ] `Publicados` usando primitivos `Table` do DS; `BadgeStatus` → `StatusPill`.
- [ ] `StatusBadge` semântico via `StatusPill` (labels intactos).
- [ ] Dark e light corretos em todas as telas do escopo.
- [ ] Zero mudança de comportamento; testes verdes; tsc/lint/build limpos.

## Fora de escopo

- `StyleGuide.tsx` (já é a vitrine do DS). Componentes internos já re-skinados na Fase 3.
- Qualquer mudança de lógica de negócio, queries ou schema.
