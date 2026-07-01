---
tags: [arquitetura, apis]
atualizado: 2026-07-01
---

# APIs externas

APIs consumidas pelo backend (`supabase/functions/_shared/`). Ver [[Integrações]] para a
camada de abstração multicanal, [[Backend]] para onde cada módulo vive.

## Mercado Livre (`_shared/ml/*`)

| Uso | Endpoint/mecanismo |
|---|---|
| OAuth | Authorization Code flow — `ml-oauth-start`/`ml-oauth-callback`/`ml-oauth-disconnect` |
| Criar/atualizar item | `POST /items`, `GET`+`PUT /items/{id}` |
| Preço por quantidade (atacado B2B) | `POST /items/{id}/prices/standard/quantity` (full-replace, até 5 faixas) |
| Categoria/atributos | `GET /categories/{id}/attributes` |
| Frete do vendedor | `GET /users/{id}/shipping_options/free` |
| Status do anúncio | `GET /items/{id}` |
| Concorrência | `GET /sites/MLB/search` — **bloqueado (403)** para esta conta, ver [[Segurança]] |
| Webhooks | `orders_v2`, `questions`, `claims`, `shipments` |
| Pós-venda | `/post-purchase/v1/claims/search`, `/questions/search` |
| Pedidos | `/orders/search`, `/orders/{id}` |
| Catálogo | vínculo por GTIN (ver [[Produtos]]) |

## Mercado Pago (`_shared/mercadopago/*`)

- Pagamentos/liberação — usado por `resumo-financeiro`. Secret único `MP_ACCESS_TOKEN`
  (single-tenant hoje).
- `/mercadopago_account/balance` — **bloqueado (403)**; caixa é calculado por venda liberada
  (`ml_vendas.money_release_date`), não por saldo direto.

## OpenRouter (`_shared/ai/*`)

Gateway compatível com OpenAI SDK. Usos: copywriter (título/descrição), Vision (cor por foto),
categoria/atributos por LLM (closed-set). Ver [[IA]].

## Telegram Bot API (`_shared/notificacoes/telegram.ts`)

Alertas operacionais: vendas, perguntas, devoluções, liberações, moderados, catálogo sem match.

## Padrão de bloqueios ML/MP

Vários endpoints acima estão ou já estiveram bloqueados por permissão de app / reputação da
conta, não por bug de código — padrão documentado em
`docs/reference/ml-permissao-reputacao-padrao.md`. Ver [[Segurança]].
