---
tags: [modulo, billing, planejado]
atualizado: 2026-07-01
---

# Billing

> ⚠️ **Não implementado.** Nenhuma tabela, edge function ou tela de billing existe no código
> hoje. `docs/decisions/0028-monetizacao-e-billing.md` tem status **"Proposto (stub — detalhar
> no início do épico E8)"** — é um registro de intenção, não uma decisão implementável ainda.

## Onde entra no roadmap

Épico **`E8` — Billing (Asaas) + LGPD**, dentro da fase "3 — Virar SaaS"
(`E7` Multi-tenancy → `E8` Billing → `E9` Operação SaaS). Fonte: `docs/ROADMAP.md`.

## Direção planejada (ADR-0028, ainda não decidida em detalhe)

- **Gateway proposto:** Asaas (Pix R$1,99 fixo, boleto R$3,49 só quando pago, cartão recorrente,
  Pix Automático)
- **Modelo:** planos por faixa + metering (uso)
- Alternativas a confirmar: Asaas vs Vindi/Iugu para Pix Automático
- Sincronização Asaas↔Supabase seria responsabilidade própria (idempotência + reconciliação
  obrigatórias — mesmo princípio de idempotência do resto do backend, ver [[Backend]])

## Dependência

Faz sentido só depois do `E7` (multi-tenancy real com `org_id`) — hoje o projeto está em
operação compartilhada, sem isolamento por empresa. Ver [[Segurança]].
