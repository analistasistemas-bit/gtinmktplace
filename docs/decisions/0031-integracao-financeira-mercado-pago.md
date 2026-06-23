# ADR-0031 — Integração financeira via Mercado Pago (recebíveis)

**Data:** 2026-06-18
**Status:** Aceito
**Contexto relacionado:** menu Financeiro / spec `2026-06-18-menu-financeiro-recebiveis-design.md`,
ADR-0027 (multi-tenancy), `reference_ml_permissao_pedidos_bloqueada`.

## Contexto

O PubliAI precisa mostrar o "valor líquido a receber" e os lançamentos futuros do operador.
Esses dados são do **Mercado Pago**, não da API de Pedidos do Mercado Livre. Um spike na conta
real (AVILBV) confirmou:

- A API de pagamentos (`api.mercadopago.com/v1/payments/search`) exige um **Access Token de
  produção do Mercado Pago** (`APP_USR-…`), distinto do token OAuth do Mercado Livre.
- Com o token MP, os pagamentos trazem `money_release_date`, `money_release_status` e
  `transaction_details.net_received_amount` — suficientes para "A receber" e o calendário.
- O endpoint de saldo (`/mercadopago_account/balance`) retorna 403 mesmo com o token MP.

## Decisão

1. Consumir a API do Mercado Pago com o **Access Token de produção da conta**, guardado como
   secret de Edge Function `MP_ACCESS_TOKEN` (nunca em código/repo).
2. O menu Financeiro mostra o **realizado do período** (vendas aprovadas em [desde, ate]):
   faturamento bruto, **líquido recebido** (`net_received_amount`), **taxas+frete retidos**
   (bruto − líquido), estornos, nº de vendas e ticket médio líquido.
   **Dois filtros para bater com a tela de Vendas do ML (fonte `/orders`):**
   (a) `collector_id` == id da conta (de `/users/me` via `getContaId`) — exclui compras/terceiros
   (ex.: Notebook/Sauna comprados, que inflavam para ~R$ 29k irreal);
   (b) excluir `description == 'marketplace_shipment'` — cada venda gera um pagamento de frete à
   parte que dobrava a contagem e somava frete ao bruto.
   Com os dois, bruto e contagem batem **exatamente** com `/orders` (validado: 24 pedidos,
   R$ 606,80; líquido R$ 364,46).
3. **NÃO** reproduzir "A receber / Lançamentos futuros". Validado contra a conta real: a projeção
   de liberação do MP **não é reproduzível** pela API pública — somar `net_received_amount` por
   `money_release_date` diverge do app (ex.: app R$ 290,20 vs soma R$ 4.565,72). Nenhum filtro de
   campo (tipo de pagamento, pagamento em grupo) reproduz os valores: o MP aplica retenção/reserva
   e liberação parcial não expostas no pagamento. Sem "Saldo disponível" também (balance 403/404).
4. Manter o módulo de agregação **puro e testável**, separado da camada de rede (espelha o
   padrão de `metricas-vendas`/`lerVendasML`).

## Consequências

- **Positivas:** números **confiáveis e verificáveis** (vendas, líquido, taxas/frete, estornos)
  que o operador não via consolidado. Ao vivo, sem relatório assíncrono. Reaproveita o padrão de
  edge function + lógica pura.
- **Negativas / dívidas:**
  - **Não há "A receber"/calendário** (não reproduzível — ver Decisão 3). Quem quiser a previsão
    de liberação consulta o app do Mercado Pago.
  - **Single-tenant**: `MP_ACCESS_TOKEN` é global (conta AVILBV); qualquer usuário autenticado vê
    esse financeiro. Para multi-tenant (SaaS), trocar por **OAuth do Mercado Pago por org** — fica
    para o épico SaaS, alinhado ao ADR-0027.
  - Sem saldo disponível enquanto o endpoint de balance estiver bloqueado.
  - Token estático: se for resetado no painel do Mercado Pago, atualizar o secret.

## Alternativas consideradas

- **Só com `/orders` do ML** (sem token MP): traz bruto/taxas, mas não o líquido real do MP.
  Rejeitada (o token MP dá o líquido autoritativo).
- **Reproduzir "A receber"/calendário somando pagamentos pendentes:** tentado e **rejeitado** —
  diverge do app do MP e nenhum filtro reproduz (retenção/reserva ocultas).
- **Relatórios assíncronos (Released money / Account balance CSV):** históricos e
  request→poll→download; não entregam o "futuro agendado" nem servem a KPI ao vivo. Reservado
  para eventual conciliação contábil.

## Atualização (2026-06-23) — data de liberação **por recebimento** no detalhe líquido

A Decisão 3 (não reproduzir "A receber"/calendário) **continua valendo** para o **agregado**:
somar `net_received_amount` por `money_release_date` diverge do app (retenção/reserva oculta).

O que **passou a ser exibido** é diferente e não conflita com o spike: a data de liberação **de
cada recebimento individual** (`money_release_date` do próprio pagamento), numa coluna "Liberação"
do detalhe líquido (`DetalheFinanceiro.tsx`), com selo "liberado" (data passada) / "a liberar"
(data futura). Não há **soma** por data — só a exibição do campo que o MP já entrega por pagamento,
que é confiável por-linha. Propagado por `VendaFinanceira.dataLiberacao` (puro, coberto por teste);
a edge `resumo-financeiro` repassa o resumo inteiro, sem mudança própria.

Continua **não** havendo o agregado "A receber"/calendário do app — só a data por linha do realizado.
