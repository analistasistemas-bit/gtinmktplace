# Menu Financeiro — realizado de vendas (Mercado Pago)

**Data:** 2026-06-18
**Status:** Implementado (branch `worktree-financeiro-recebivel`)
**ADR relacionado:** [0031-integracao-financeira-mercado-pago](../../decisions/0031-integracao-financeira-mercado-pago.md)

## Problema

O operador não tinha visão consolidada do dinheiro das vendas do Mercado Livre dentro do PubliAI:
quanto faturou, quanto recebe líquido e quanto o ML retém em taxas/frete. Pedido inicial: um KPI
de "valor líquido a receber" com detalhamento. Virou um **menu Financeiro dedicado**.

## Descobertas do spike (conta real AVILBV)

1. Recebíveis/saldo são do **Mercado Pago**, via **Access Token de produção** (`APP_USR-…`),
   distinto do OAuth do ML. `/v1/payments/search` retorna 200 com bruto, líquido
   (`net_received_amount`), taxas (`fee_details`/`charges_details`), `money_release_date/status`.
2. Saldo (`/balance`) → **403/404**.
3. **A projeção "A receber / Lançamentos futuros" do app do MP NÃO é reproduzível** pela API:
   somar `net_received_amount` por `money_release_date` divergiu do app (R$ 4.565,72 vs R$ 290,20).
   Testados filtros por tipo de pagamento e por "pagamento em grupo" — **nenhum** reproduz os
   valores; o MP aplica retenção/reserva e liberação parcial não expostas no pagamento.

## Decisão de produto

Entregar **só o que é confiável e verificável**: o **realizado do período** (vendas aprovadas em
[desde, ate], por `date_approved`). Abandonar "A receber / lançamentos futuros" (a previsão de
liberação fica no app do Mercado Pago).

KPIs:
- **Líquido das vendas (você recebe)** — destaque, com bruto e % retido.
- **Faturamento bruto** · **Taxas e frete (ML)** (bruto − líquido) · **Estornos** ·
  **Ticket médio líquido** · **Pagamentos recebidos** (e quantos de vendas ML).

## Arquitetura

### Backend
- `_shared/mercadopago/financeiro.ts`
  - `agregarFinanceiro(pagamentos, { desde, ate })` — **pura**, testada (vitest). Soma
    bruto/líquido/estornos por `date_approved` no período, descontos = bruto − líquido, contagem
    de pagamentos e de vendas (com pedido ML).
  - `buscarPagamentosMP(token, lookbackDias=120)` — varre `/v1/payments/search` (datas relativas
    `NOW-Ndays`). Resiliente; espelha `lerVendasML`.
- `resumo-financeiro/index.ts` (Edge) — `requireUser`, lê `MP_ACCESS_TOKEN`, agrega, devolve JSON.
  Sem secret → `semCredencialMP`; erro → `erroFinanceiro` (não mascara como zero).

### Frontend
- `lib/financeiro.ts` + `hooks/useResumoFinanceiro.ts` — espelham `metricas.ts`/`useMetricasVendas`.
- `pages/Financeiro.tsx` — destaque do líquido, KPIs do realizado, seletor de período, nota
  explicando por que não há "a receber".
- `components/sidebar.tsx` — item "Financeiro" (ícone carteira), rota `/financeiro`.
- `pages/Publicados.tsx` — ponte: card "Líquido das vendas" clicável → `/financeiro`.

## Limitações conhecidas (v1)

- **Sem "A receber" / calendário de liberação** (não reproduzível — ver ADR-0031).
- **Single-tenant**: `MP_ACCESS_TOKEN` global (AVILBV). Multi-tenant exigirá OAuth do Mercado
  Pago por org (épico SaaS).
- Lookback de 120 dias; janelas maiores ficam parciais (teto de 2000 pagamentos), por design.

## Validação

- Lógica pura coberta por testes (bruto/líquido/descontos/estornos, recorte por data, contagem).
  Suíte completa: 696 testes ✓.
- Smoke test na conta real (30 dias): bruto R$ 29.377,33, líquido R$ 26.944,15, taxas/frete
  R$ 2.433,18 (8,3%), 46 pagamentos.
- Validação visual com Browser-use: tela renderizando o realizado.
