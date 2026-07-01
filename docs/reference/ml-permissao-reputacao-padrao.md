# Padrão: bloqueios por permissão/reputação da conta ML/MP

> **Tipo:** Reference (Diátaxis). Antes de desenhar uma feature que depende de um endpoint novo
> do Mercado Livre ou Mercado Pago, consulte esta tabela — é bem provável que o bloqueio já
> tenha acontecido antes com outro endpoint, pela mesma causa raiz.

## O padrão

A conta AVILBV (Mercado Livre) e o token único (Mercado Pago) usados pelo PubliAI têm
**permissão de app limitada no DevCenter** e **reputação/histórico de vendas insuficiente**.
Vários ADRs descobriram, cada um por conta própria, que um endpoint retornava 401/403 não por
bug de código, mas por esses dois motivos externos — e tiveram que redesenhar a feature em volta
disso. O ADR-0041 foi o primeiro a citar esse histórico explicitamente como justificativa de
design, em vez de descobrir o bloqueio de novo.

| ADR | Endpoint bloqueado | Resposta | Causa | Como foi contornado |
|---|---|---|---|---|
| [0014](../decisions/0014-busca-de-concorrencia.md) — Busca de concorrência | `/sites/MLB/search` | 403 forbidden mesmo com token | Permissão de app | Trocou de abordagem de busca |
| [0015](../decisions/0015-potencial-de-venda-via-proxies.md) — Potencial de venda via proxies | `/items/{id}` de terceiros, `/reviews/item/{id}` | 403 (`access_denied`, `PolicyAgent`) | Permissão de app | Usa `/users/{seller_id}` (reputação do vendedor) como **proxy** — esse endpoint funciona |
| [0017](../decisions/0017-selo-de-desconto-via-api-de-promocoes.md) — Selo de desconto ("% OFF") | `/seller-promotions` (`PRICE_DISCOUNT`) | 403 `PolicyAgent` / "Invalid caller.id" | Permissão de app **e** reputação verde/vendas concluídas ausentes | **Estacionado.** Nenhuma reescrita de código contorna — depende da conta |
| [0031](../decisions/0031-integracao-financeira-mercado-pago.md) — Integração financeira MP | `/mercadopago_account/balance` | 403 | Permissão/token | Caixa calculado por venda liberada (`ml_vendas.money_release_date`), não pelo saldo direto |
| [0035](../decisions/0035-monitoramento-anuncios-moderados.md) — Monitoramento de moderados | `/moderations/infractions/search` | 401 | Permissão de app ("mesma classe do `/orders`") | Diff de status via webhook, sem depender do texto da infração |
| [0041](../decisions/0041-preco-atacado-pxq-b2b.md) — Preço de atacado PxQ | `/seller-promotions` (evitado deliberadamente) | — | Cita o ADR-0017 como precedente a não repetir | Escolheu **PxQ nativo** (`/prices/standard/quantity`), que não passa por `/seller-promotions` |

### O único caso resolvido

O [ADR-0037](../decisions/0037-modulo-faturamento-webhooks-ml.md) (módulo Faturamento)
documenta que `/orders` **passou a funcionar** — a permissão foi habilitada depois pelo
Mercado Livre. É o único item da lista onde o bloqueio não é definitivo; `/moderations`
continua bloqueado.

## Como usar isto

Antes de propor um ADR que depende de um endpoint novo do ML ou MP:

1. Verifique se o endpoint está nesta tabela ou é da mesma família (`/seller-promotions`,
   `/moderations/*`, saldo/balance da conta).
2. Se sim, assuma que vai bloquear até confirmar o contrário em produção — desenhe a feature
   com um proxy/reconciliação em vez de depender do endpoint direto (como 0015, 0031, 0035
   fizeram).
3. Se a feature não tem alternativa viável sem o endpoint, considere estacionar (como 0017) em
   vez de forçar uma implementação que a conta atual não sustenta.
4. Atualize esta tabela quando um bloqueio for descoberto ou resolvido (como 0037/`orders`).
