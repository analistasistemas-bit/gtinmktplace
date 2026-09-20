---
tags: [modulo, billing, platform-admin, producao]
atualizado: 2026-09-20
---

# Billing e Cobrança da Plataforma

Gestão comercial, apuração de faturamento, metering e emissão de demonstrativos de cobrança dos tenants do PubliAI.
Implementado e em produção desde setembro de 2026 via Central de Organizações (`/admin`), aba **Cobrança**.

Ver [[Índice de ADRs]], [[Usuários]], [[Segurança]], [[Faturamento]].

---

## 1. Arquitetura e Decisões Canônicas

O faturamento e cobrança de clientes da plataforma é estruturado em cinco ADRs fundamentais:

| ADR | Escopo e Decisão |
|---|---|
| [[0155-central-organizacoes-cobranca-auditavel\|ADR-0155]] | Central integrada `/admin`, condições comerciais versionadas (`platform_commercial_terms`), metering Sonar e demonstrativos auditáveis (`platform_billing_statements`). |
| [[0158-central-carteira-agregada-e-pendencias\|ADR-0158]] | Carteira agregada (`wallet`), pendências explícitas de faturamento (bloqueio da prévia sem contrato), catálogo de custos via RPC (`platform_org_cost_catalog`) e alíquota tributária confirmada. |
| [[0159-central-cache-mensal-materializado\|ADR-0159]] | Cache materializado reconstituível (`platform_org_month_metrics`) para meses históricos fechados; mês corrente e anterior apurados ao vivo. |
| [[0164-implantacao-sobrevive-a-renegociacao\|ADR-0164]] | Taxa de implantação inaugural (`setup_fee_cents`) não é descartada se houver renegociação antes ou no mês do vencimento (`setup_due_month`), nem cobrada em duplicidade. |
| [[0165-faixas-regressivas-por-organizacao\|ADR-0165]] | Percentual de gestão escalonado em 4 faixas regressivas de faturamento mensal (`revenue_bps_t1..t4`). Faixa efetiva calculada automaticamente no fechamento (`applied_bps`). Travas de modalidade por `CHECK` no Postgres. |

---

## 2. Modalidades Comerciais

A tabela `platform_commercial_terms` é imutável (append-only com versionamento por organização) e possui trava estrita por constraint `CHECK`:

1. **Modalidade 1 (SaaS Puro):**
   - Mensalidade fixa obrigatória (`monthly_fee_cents > 0`).
   - Sem custo de infraestrutura ou consultas Sonar cobradas à parte (`sonar_unit_cents = 0` obrigatório por `CHECK`).
   - Percentual de comissão regressivo por faixas (`revenue_bps_t1..t4`).
2. **Modalidade 2 (Revenue Share / Co-gestão):**
   - Sem mensalidade fixa (`monthly_fee_cents = 0` obrigatório por `CHECK`).
   - Gestão sobre faturamento líquido em 4 faixas regressivas (`revenue_bps_t1..t4`).
   - Consultas Sonar medidas e cobradas à parte (`sonar_unit_cents > 0`).

### Faixas Regressivas de Faturamento (ADR-0165)
As 4 faixas possuem cortes fixos por competência mensal, calculados sobre a receita líquida:
- **T1:** Até R$ 100.000,00 (`revenue_bps_t1`)
- **T2:** De R$ 100.000,01 até R$ 300.000,00 (`revenue_bps_t2`)
- **T3:** De R$ 300.000,01 até R$ 500.000,00 (`revenue_bps_t3`)
- **T4:** Acima de R$ 500.000,00 (`revenue_bps_t4`)

A função Postgres `platform_terms_tier()` resolve o corte e `platform_terms_tier_bps()` aplica a alíquota da faixa correspondente.

---

## 3. Ciclo de Vida do Contrato e Vigência

- **Primeiro Contrato (`current === null`):** entra em vigor imediatamente no mês de cadastro (`starts_on = currentMonthStart()`), liberando prévia e apuração instantâneas para a competência inaugural.
- **Renegociações:** entram em vigor no 1º dia do mês seguinte (`starts_on = nextMonthStart()`), preservando a estabilidade da competência em curso.
- **Taxa de Implantação (`setup_fee_cents`):** associada a um mês de vencimento específico (`setup_due_month`). Se um contrato renegociado entrar em vigor antes do mês de vencimento, a taxa é transportada; se renegociado após o vencimento, ela deixa de ser herdada, impedindo cobrança perpétua.

---

## 4. Demonstrativos e Fechamento

- **Prévia (`platform_billing_preview`):** consolida faturamento bruto, devoluções, comissão aplicada na faixa (`applied_bps`), infraestrutura, taxa de implantação e metering Sonar (`platform_sonar_deliveries`).
- **Fechamento (`platform_billing_close`):** congela o demonstrativo em `platform_billing_statements` de forma imutável, registrando a alíquota efetivamente aplicada (`applied_bps`).
- **Exportação:** CSV do demonstrativo e conciliação por organização disponíveis na Central.
