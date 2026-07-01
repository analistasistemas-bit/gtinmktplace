---
tags: [fluxos, publicacao, amazon, planejado]
atualizado: 2026-07-01
---

# Amazon

> ⚠️ **Não implementado, sem código.** Diferente do que uma leitura superficial sugere, **existe
> pesquisa técnica real** registrada em
> `docs/superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md` — mas nenhum épico
> numerado (`E5`/`E6`/…) foi atribuído a ela ainda, e não há prioridade imediata.

## Posição na fila de canais

Ordem recomendada após o Mercado Livre (fonte: spec de evolução SaaS multicanal):

**Shopee (2º, épico `E5`) → Magalu (3º) → Amazon (4º) → Americanas/Via (5º, ou via hub)**

Racional registrado: Shopee é tecnicamente a mais próxima do ML já integrado; Magalu é esforço
médio com integração direta; **Amazon é sólida, mas o listing é mais pesado** (JSON Schema
dinâmico por categoria) — por isso vem depois.

## Pesquisa técnica já registrada (não implementada)

- **API:** SP-API (Selling Partner API), `A2Q3Y263D00KWC`
- **Auth:** só **LWA** (Login with Amazon) — SigV4 foi descontinuado em outubro/2023; token de
  1h; dados pessoais (PII) via **Restricted Data Token**
- **Variações:** `variation_theme` dentro do JSON Schema do product type (schema dinâmico por
  categoria, não payload fixo como o ML)
- **GTIN:** catalog match exige GTIN real — um `3000*` interno (código interno, não EAN de
  verdade) tende a criar um ASIN novo em vez de casar com produto existente
- **Sandbox:** existe, mas Listings/Orders só respondem **mock** — não valida o fluxo real
- **Pedidos:** `getOrders` é lento (relatado ~1 req/min) — a pesquisa recomenda preferir a
  Notifications API
- **Requisitos de conta:** conta Profissional (R$19/mês) + conta de Developer; **app privado**
  para uso interno evita processo de aprovação de terceiros

## Esforço estimado

Classificado como **Alto** na tabela comparativa da spec (mesmo nível de Americanas/Via, acima
de Shopee e Magalu — ambos "Médio").

Ver [[Publicação Shopee]] (próximo canal real, épico `E5`), [[Integrações]] (camada que
receberia o adapter).
