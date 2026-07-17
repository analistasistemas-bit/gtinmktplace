---
tags: [modulo, dashboard]
atualizado: 2026-07-01
---

# Dashboard

Rota `/` (`src/pages/Dashboard.tsx`). Ver [[Frontend]], [[Fluxo Completo]].

## O que mostra

- **KPIs** (`src/lib/dashboard-kpis.ts` → `calcularKpisDashboard`): publicados, ativos, com
  problema (`moderado`/`inativo`/`pausado`), erros, a revisar. O card "Líquido no faturamento"
  só mostra o hint de lucro (`lucro R$ X`) quando `configuracoes.mostrar_lucro_dashboard`
  estiver ligado (padrão: oculto) — toggle em [[Configurações]].
- **Lotes em andamento** (`dashboard-lotes-andamento.tsx`) — jornada do lote visível e
  retomável ("continuar de onde parei").
- **Painel "Precisa da sua atenção"** (`dashboard-pendencias.tsx` +
  `src/lib/pendencias.ts` → `montarPendencias`) — condicional, só aparece quando há algo
  pendente.
- **Cockpit financeiro** (`components/dashboard/grafico-cockpit.tsx`, `src/lib/cockpit.ts`) —
  gráficos de evolução, geografia, produtos top.
- **Publicados** (`dashboard-publicados.tsx`) — resumo do que está ativo no marketplace.

## KPIs navegáveis

Clicar num KPI faz drill-down para a lista filtrada correspondente em [[Marketplace|Publicados]]
(ex.: "Ativos" → Publicados filtrado por status). Parte da Tarefa 2/Onda 3 (navegação e
orientação).

## Componentes (`src/components/`)

`dashboard-lotes-andamento.tsx`, `dashboard-pendencias.tsx`, `dashboard-publicados.tsx`,
`dashboard/grafico-cockpit.tsx`, `jornada-lote.tsx`, `lote-card.tsx`.
