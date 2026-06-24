# Melhorias menu Publicados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Levar ao menu Publicados os padrões do Faturamento — seletor de período na tela de Detalhe de vendas, markup e lucro por produto, indicador "Ao vivo", filtro de encalhados clicável e KPI de Lucro em R$.

**Architecture:** Reaproveita a infraestrutura de cálculo existente (`ratearLiquidoPorFrete`, rateio do líquido por item, `CustoResolver`/`PesoResolver`, `calcularMarkup`). Extrai o seletor de período duplicado num componente. Funções puras testadas via Vitest.

**Tech Stack:** React 18 + TS + Vite, TanStack Query, shadcn/ui, Tailwind, Vitest.

## Global Constraints

- Custo do produto vem de `variacoes.custo` (R$), nunca `familias.custo_centavos`.
- Markup por produto = média ponderada `(Σ líquido_item − Σ custo_item) / Σ custo_item` (bate com consolidado).
- "Ao vivo" só no Detalhe de vendas (não na lista). Sem polling de status do ML.
- Faturamento (`aba-vendas.tsx`) fica intacto.
- `pnpm test` verde ao fim de cada task.

---

### Task 1: Componente `SeletorPeriodo` + migração do dashboard

**Files:**
- Create: `src/components/ui/seletor-periodo.tsx`
- Modify: `src/components/dashboard-publicados.tsx` (remove seletor embutido, usa o componente)

**Interfaces:**
- Produces: `<SeletorPeriodo periodo={Periodo} onPeriodo={(p: Periodo) => void} carregando? />`

- [ ] Extrair o bloco de seletor (presets 7/30/90 + "Personalizado" + form de datas) de `dashboard-publicados.tsx:100-158` para `SeletorPeriodo`, controlado por `periodo`/`onPeriodo`. Rascunho local interno (abrir custom não refaz busca; aplica no OK). Reusa `resolverJanela` de `metricas.ts`.
- [ ] Trocar o bloco no `dashboard-publicados.tsx` por `<SeletorPeriodo periodo={periodo} onPeriodo={onPeriodo} carregando={carregando} />`. Remover estado/handlers que migraram (`modoCustom`, `rascunho`, `escolherPreset`, `abrirCustom`, `aplicarCustom`, `rascunhoDe`).
- [ ] `pnpm test` + `pnpm build` verdes (sem regressão de tipos).
- [ ] Commit: `refactor(publicados): extrai SeletorPeriodo reutilizável`

### Task 2: Markup + lucro por produto em `detalhe-vendas.ts` (TDD)

**Files:**
- Modify: `src/lib/detalhe-vendas.ts`
- Test: `src/lib/__tests__/detalhe-vendas.test.ts` (novo)

**Interfaces:**
- Consumes: `ratearLiquidoPorFrete`, `CustoResolver`, `PesoResolver` (resumo-vendas), `calcularMarkup` (markup).
- Produces: `montarDetalheVendas(vendas, custoResolver?, pesoResolver?): DetalheVendas`; `LinhaVenda` ganha `markup: number|null`, `lucro: number|null`; `SecaoVendas` ganha `lucro: number`, `markup: number|null`.

- [ ] **RED:** escrever `detalhe-vendas.test.ts` com fixtures `Venda` (padrão de `faturamento.test.ts`):
  - produto PubliAI com custo → `markup`/`lucro` = `(Σ líquido − Σ custo)/Σ custo` e `Σ líquido − Σ custo`.
  - produto sem custo → `markup`/`lucro` null.
  - seção externa (is_publiai=false) → markup/lucro null.
  - subtotal da seção PubliAI → `lucro` somado e `markup` ponderado.
- [ ] Rodar: `pnpm test detalhe-vendas` → FAIL.
- [ ] **GREEN:** em `montarDetalheVendas`, aceitar resolvers; calcular líquido por pedido via `ratearLiquidoPorFrete` (fallback `v.liquido`), ratear por item pelo valor bruto (igual `agruparPorPedido`), acumular `liquido`/`custo` por grupo. Por linha: `markup`/`lucro` via `calcularMarkup` (null se custo<=0). Por seção: somar lucro e markup ponderado dos itens com custo.
- [ ] Rodar: `pnpm test detalhe-vendas` → PASS.
- [ ] Commit: `feat(publicados): markup e lucro ponderados por produto no detalhe`

### Task 3: `DetalheVendas.tsx` — seletor na tela + colunas + "Ao vivo"

**Files:**
- Modify: `src/pages/DetalheVendas.tsx`

**Interfaces:**
- Consumes: `SeletorPeriodo` (Task 1), `montarDetalheVendas` nova assinatura (Task 2), `useCustos`, `periodoToParams`.

- [ ] Período controlado via `useSearchParams` (lê e escreve). `onPeriodo` → `setSearchParams(periodoToParams(p))`.
- [ ] Renderizar `<SeletorPeriodo>` no topo (acima do resumo). Remover o texto fixo redundante se fizer sentido (manter subtitle).
- [ ] Passar `useCustos()` resolvers a `montarDetalheVendas`.
- [ ] Adicionar colunas **Markup** e **Lucro** na `SecaoTabela` (após "Valor"/"% total"): `SortKey` ganha `'markup'`/`'lucro'`; render `fmtMarkup`(verde/vermelho)/`fmtBRL` ou "—"; footer mostra `secao.lucro`/`secao.markup`.
- [ ] Trocar botão "Atualizar" pelo bloco do Faturamento (`aba-vendas.tsx:397-415`): span "Ao vivo" (bolinha `bg-success`, `animate-ping` se `isFetching` senão pulso 2.5s) + botão refresh. Manter "Voltar".
- [ ] `pnpm test` + `pnpm build` verdes.
- [ ] Commit: `feat(publicados): seletor de período, markup/lucro e Ao vivo no detalhe de vendas`

### Task 4: Lista Publicados — filtro encalhados + KPI Lucro R$

**Files:**
- Modify: `src/lib/publicados.ts` (filtro), `src/lib/publicados-url.ts` (URL), `src/components/dashboard-publicados.tsx` (card clicável + KPI), `src/pages/Publicados.tsx` (toggle)
- Test: `src/lib/__tests__/publicados-fornecedor.test.ts` ou novo bloco (filtro encalhados)

**Interfaces:**
- Produces: `FiltroPublicados.somenteEncalhados?: boolean`; URL param `encalhados=1`.

- [ ] **RED:** teste de `filtrarPublicados` com `somenteEncalhados: true` → mantém só `status==='ativo' && (unidadesVendidas??0)===0`; remove ativo-com-venda e não-ativos. Rodar → FAIL.
- [ ] **GREEN:** `FiltroPublicados.somenteEncalhados?: boolean`; em `filtrarPublicados`, critério extra `(!f.somenteEncalhados || (i.status==='ativo' && (i.unidadesVendidas??0)===0))`. Rodar → PASS.
- [ ] `publicados-url.ts`: `estadoParaParams` seta `encalhados=1` quando true; `paramsParaEstado` lê `p.get('encalhados')==='1'`.
- [ ] `dashboard-publicados.tsx`: novo KPI "Lucro no período" (fmtBRL, verde/vermelho) ao lado do Markup — receber `lucro?: number|null` via props; card "Encalhados" vira `<button>` que chama `onToggleEncalhados`, com estado visual ativo. Adicionar props `somenteEncalhados?: boolean`, `onToggleEncalhados?: () => void`.
- [ ] `Publicados.tsx`: passar `lucro` (de `resumo.lucro`) e wiring do toggle (atualiza estado/URL `somenteEncalhados`); aplicar via `filtrarPublicados`.
- [ ] `pnpm test` + `pnpm build` verdes.
- [ ] Commit: `feat(publicados): filtro de encalhados clicável e KPI de lucro em R$`

---

## Self-Review

- **Cobertura do spec:** A1→T1/T3, A2→T2/T3, A3→T3, B1→T4, B2→T4. ✓
- **Placeholders:** nenhum — cada task tem arquivos e lógica exatos.
- **Consistência de tipos:** `montarDetalheVendas(vendas, custoResolver?, pesoResolver?)`, `LinhaVenda.markup/lucro`, `SecaoVendas.lucro/markup`, `FiltroPublicados.somenteEncalhados`, `SeletorPeriodo` props — coerentes entre tasks.
