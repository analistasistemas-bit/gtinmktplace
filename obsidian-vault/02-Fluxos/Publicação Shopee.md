---
tags: [fluxos, publicacao, shopee, planejado]
atualizado: 2026-07-01
---

# Publicação Shopee

> ⚠️ **Não implementado.** Não existe código de integração com Shopee no projeto hoje — só
> pesquisa técnica registrada em `docs/superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md`
> (seção 8.1) e `docs/project-status.md`. Esta nota documenta o que **está planejado**, não o
> que existe.

## Status

Próximo épico de produto: **`E5` — conector Shopee** (fonte: `docs/project-status.md`). Seria o
2º marketplace, novo adapter de [[Integrações|ChannelConnector]].

**O que já está pronto ao redor (2026-07-15), reduzindo o E5 a "só o conector":** orquestração
multicanal (E6, fan-out por família+canal) e a UI multi-marketplace (registry `src/lib/canais.ts`,
tabs de canal, tela `/canais`, rollout por org) já estão em produção — Shopee entra em `em_breve`
no registry até o conector existir. Faltam só: implementar o `ShopeeConnector` (pesquisa abaixo),
registrar no registry de conectores do backend, adicionar `'shopee'` ao enum `canal_externo` e
mudar `status: 'em_breve' → 'ativo'` no registry de UI.

## Escopo previsto (fonte de verdade)

- Auth OAuth + assinatura HMAC
- Mapeamento de item/variações
- Upload de mídia
- Update de estoque/preço
- Leitura de status

## Pesquisa técnica já registrada (não implementada)

- **Auth:** `partner_id`+`partner_key`; autorização via `shop/auth_partner` (link expira em
  5min) → `auth/token/get` → `auth/access_token/get` (refresh). Token **4h** — refresh proativo
  reusaria o lock Redis do ADR-0012. Assinatura `HMAC-SHA256(base_string, partner_key)` em toda
  request; timestamp em segundos.
- **Modelo:** `item` → `models` sob `tier_variation` (até 2 níveis) — mapeia o agrupamento por
  PAI ([[Banco de Dados|ADR-0003]]), mas é diferente de `attribute_combinations` do ML →
  **adaptador novo**, não reaproveita `_shared/ml/*` diretamente.
- **Pipeline de publicação (multi-etapa, ≠ POST único do ML):** `media_space/upload_image` →
  `get_category` → `get_attribute_tree` → `get_brand_list` → `add_item` →
  `init_tier_variation`/`add_model`.
- **Estoque/Preço:** `update_stock` / `update_price`, batch até ~50 models — equivalente ao
  fluxo UPDATE do ML.
- **Pedidos:** `get_order_list` (janela máx 15 dias) + `get_order_detail`; há webhook.
- **GTIN/EAN:** obrigatório no BR a partir de 2025 como atributo de categoria — reforça a
  importância do trabalho já feito em E3/E4 (categoria genérica + atributos por IA).

## Pegadinhas conhecidas (pesquisa, não validadas em produção)

- Sandbox limitado — vários recursos só funcionam em produção
- Rate limit por loja (~10 rps relatado, **não confirmado**) — enfileiraria via QStash
- Custo/SLA/escopos do Open Platform não confirmados

Ver [[Integrações]] para a camada de abstração que receberia este conector.
