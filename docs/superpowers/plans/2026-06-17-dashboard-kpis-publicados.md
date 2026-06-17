# Dashboard de KPIs de venda em Publicados — Plano de Implementação

> **For agentic workers:** execução inline nesta sessão. Steps com checkbox para tracking.

**Goal:** Adicionar à tela Publicados um dashboard de KPIs de venda (período 7/30/90d), colunas de unidades/valor vendido por produto e fornecedor exibido pela 1ª palavra — buscando vendas do ML via `/orders`, com a métrica abstraída no contrato de canal (multicanal-ready).

**Architecture:** Novo método `lerMetricasVendas` no `ChannelConnector`; adapter ML varre `/orders/search` e agrega por item; edge function `metricas-vendas` expõe o agregado; o front consome via hook React Query e renderiza dashboard + colunas. Spec: `docs/superpowers/specs/2026-06-17-dashboard-kpis-publicados-design.md`.

**Tech Stack:** Deno (edge functions), Supabase, React 18 + TS + TanStack Query + shadcn/ui, Vitest.

## Global Constraints
- Edge functions chamadas do front validam o Bearer e vão com `verify_jwt=false` no deploy.
- Multicanal: a métrica é canônica (`MetricasVendasCanal`), não acoplada ao ML no front.
- Escopo dos KPIs: só anúncios gerenciados pelo app (filtra por `ml_item_id` conhecido).
- Período default 30 dias; recortes 7/30/90.
- Fornecedor: exibe 1ª palavra; filtro/ordenação pelo nome completo.

---

### Task 1: Contrato de canal + agregação ML (unit-testável)

**Files:**
- Modify: `supabase/functions/_shared/canais/contrato.ts` (tipo `MetricasVendasCanal` + método `lerMetricasVendas`)
- Create: `supabase/functions/_shared/ml/vendas.ts` (`agregarPedidos` puro + `lerVendasML`)
- Create: `supabase/functions/_shared/ml/__tests__/vendas.test.ts`
- Modify: `supabase/functions/_shared/canais/mercado-livre.ts` (implementa `lerMetricasVendas`)

**Interfaces:**
- Produces: `MetricasVendasCanal = { porItem: Record<string,{unidades:number;valor:number}>; totais:{faturamento:number;unidades:number;pedidos:number} }`
- Produces: `agregarPedidos(pedidos, idsEscopo): MetricasVendasCanal` — pura, testável sem rede.

- [ ] Step 1: teste de `agregarPedidos` (soma unidades/valor por item; ignora itens fora do escopo; conta pedidos distintos).
- [ ] Step 2: implementar `agregarPedidos` + `lerVendasML` (paginação `/orders/search`, AbortSignal, parcial em 429).
- [ ] Step 3: adicionar tipo+método ao contrato; implementar no adapter ML.
- [ ] Step 4: `pnpm test` (vendas) verde.
- [ ] Step 5: commit.

### Task 2: Edge function `metricas-vendas`

**Files:**
- Create: `supabase/functions/metricas-vendas/index.ts`

**Interfaces:**
- Consumes: `lerMetricasVendas`, `getConnector('mercado_livre')`, `requireUser`.
- Produces: HTTP `POST {desde,ate}` → `{ totais, porItem }` ou `{ semCredencialML:true, ... }`.

- [ ] Step 1: implementar (espelha `status-publicados`: user → ml_item_ids → conector → agrega).
- [ ] Step 2: `deno check` local (se disponível) / revisão.
- [ ] Step 3: commit.

### Task 3: Front — lib/hook/tipos/fornecedor

**Files:**
- Create: `src/lib/metricas.ts` (`MetricasVendas`, `buscarMetricasVendas(periodoDias)`)
- Create: `src/hooks/useMetricasVendas.ts`
- Modify: `src/lib/publicados.ts` (`primeiroNome`, campos `unidadesVendidas?/valorVendido?`, colunas ordenáveis)
- Create: `src/lib/__tests__/publicados-fornecedor.test.ts` (`primeiroNome`)

- [ ] Step 1: teste `primeiroNome('DETALLIA FITAS TEXTEIS LTDA') === 'DETALLIA'` + nulo/vazio.
- [ ] Step 2: implementar `primeiroNome`; estender `PublicadoItem`, `ColunaOrdenavel`, `chaveOrdenacao`.
- [ ] Step 3: `lib/metricas.ts` + hook.
- [ ] Step 4: `pnpm test` verde.
- [ ] Step 5: commit.

### Task 4: Componente Dashboard

**Files:**
- Create: `src/components/dashboard-publicados.tsx`

**Interfaces:**
- Consumes: `MetricasVendas`, lista de itens com status, período + onPeríodo.
- Renderiza: cards Vendas (faturamento/unidades/pedidos/ticket), Saúde (ativos/total, com problema), Encalhados, Rankings (top 5 fat/unid), seletor 7/30/90.

- [ ] Step 1: implementar componente puro (recebe dados via props; sem fetch interno).
- [ ] Step 2: commit.

### Task 5: Integrar em Publicados.tsx

**Files:**
- Modify: `src/pages/Publicados.tsx` (dashboard no topo, período, merge métricas, 2 colunas, fornecedor 1ª palavra)

- [ ] Step 1: período state; `useMetricasVendas`; merge `porItem` → itens; render `<DashboardPublicados>`; colunas Unid/Valor; `primeiroNome` na célula + tooltip; botão Atualizar refaz status+métricas.
- [ ] Step 2: `pnpm tsc -b` + `pnpm lint` + `pnpm test` verdes.
- [ ] Step 3: commit.

### Task 6: Deploy + validação browser

- [ ] Step 1: deploy edge `metricas-vendas` (`--no-verify-jwt`).
- [ ] Step 2: push main + Render deploy; aguardar live.
- [ ] Step 3: browser-use: abrir app, login, ir em Publicados, validar dashboard, período, colunas, fornecedor 1ª palavra; screenshot.
- [ ] Step 4: relatório final.

## Self-Review
- Cobertura do spec: backend (T1-2), front lib/hook/fornecedor (T3), dashboard (T4), integração+colunas (T5), deploy+validação (T6). ✓
- Sem placeholders de código nos pontos críticos (agregação testada). ✓
- Tipos consistentes: `MetricasVendasCanal`/`MetricasVendas` (`porItem`/`totais`) usados igual em back e front. ✓
