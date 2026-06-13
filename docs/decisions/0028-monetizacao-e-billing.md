# ADR-0028: Monetização e billing (Asaas + planos por faixa + metering)

**Status:** Proposto (stub — detalhar no início do épico E8)
**Data:** 2026-06-13
**Decisores:** Diego
**Relaciona:** [evolução SaaS multicanal](../superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md) (E8); depende de ADR-0027 (multi-tenancy)

## Contexto

Para comercializar com qualquer pessoa é preciso cobrar. O público-alvo é PME brasileiro, que prefere
**Pix e boleto**. Stripe tem o melhor billing/metering, mas no BR falha em Pix recorrente e boleto
recorrente. A pesquisa recomenda gateway BR-first.

## Decisão (direção)

- **Gateway: Asaas** (Pix R$1,99 fixo, boleto R$3,49 só quando pago, cartão recorrente, **Pix Automático**
  do BC desde 14/05/2026 — reduz churn involuntário). Reavaliar Stripe só para venda internacional.
- **Planos híbridos** (tiers fixos + metering): Free (1 canal ML, ~10 anúncios, IA limitada) · Starter
  R$49–79 (~50 anúncios) · Pro R$149–199 (1–2 canais, ~250) · Scale R$399+ (multicanal). Eixos de valor:
  **anúncios ativos** + **nº de canais**. Canais **inclusos** (padrão do mercado; ninguém cobra por canal
  conectado).
- **Metering:** medir anúncios **ativos** (status ao vivo no ML, que já consultamos) — não publicações
  brutas (não penalizar UPDATE/reposição); repasse de IA como add-on com **franquia + markup transparente +
  teto** (agregando `custo_centavos`, evitando bill shock).
- **Estado no Supabase:** tabelas `assinaturas` (org, plano, status, ciclo, limites) e `uso_ciclo`
  (anúncios ativos, canais, custo IA), RLS por org. Edge `webhook-asaas` (verify_jwt false, HMAC,
  idempotência por event id); reconciliação por cron. Gating server-side: checar limite **antes** do claim
  atômico de publicação.

## Questões em aberto

- Valores exatos dos planos (validar com mercado).
- Trial vs Free permanente; gatilhos de upgrade.
- Asaas vs Vindi/Iugu para Pix Automático (confirmar maturidade).

## Consequências

- Margem melhor em ticket baixo (Pix/boleto < cartão internacional). Sem Sync Engine (como o do Stripe), a
  sincronização Asaas↔Supabase é responsabilidade nossa (idempotência + reconciliação obrigatórias).
