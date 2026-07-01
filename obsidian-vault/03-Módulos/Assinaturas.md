---
tags: [modulo, assinaturas, planejado]
atualizado: 2026-07-01
---

# Assinaturas

> ⚠️ **Não implementado.** Não há tabela de planos/assinaturas, nem tela, nem lógica de
> cobrança recorrente no código hoje. O conceito de "assinatura" aparece só como o aspecto de
> **planos por faixa** dentro do ADR-0028 (billing), que é um stub — ver [[Billing]].

## O que é planejado (nível de intenção, não de decisão)

Planos por faixa + metering de uso, cobrados via Asaas (Pix Automático para recorrência).
Nenhum detalhe de faixas, preços ou métricas de uso foi decidido — o ADR-0028 explicitamente
adia isso para o início do épico `E8`.

## Dependências

- `E7` (multi-tenancy, `org_id`) — precisa existir "empresa" antes de "assinatura de empresa"
- `E8` (Billing/Asaas) — mesma decisão, [[Billing]]

Esta nota existe separada de [[Billing]] só pela estrutura do vault; hoje as duas descrevem o
mesmo estado: planejado, não implementado.
