# ADR-0093 — Financeiro do Mercado Pago pela conexão OAuth do Mercado Livre

**Data:** 2026-07-26
**Status:** Aceito
**Substitui:** Decisão 1 do ADR-0031 (token estático `MP_ACCESS_TOKEN`) e fecha a dívida
"single-tenant" registrada nas Consequências daquele ADR.
**Relacionados:** ADR-0027 (multi-tenancy), ADR-0038 (fonte única `ml_vendas`),
ADR-0040 e ADR-0042 (caminho do MP ao vivo virou código morto), ADR-0091 (conexão ML
confirmada pela sessão), ADR-0012 (lock no refresh de token).

## Contexto

O pedido original era "a conexão do Mercado Pago igual à do Mercado Livre: OAuth, cada
empresa com a sua". O ADR-0031 já previa exatamente isso como trabalho futuro
("trocar por OAuth do Mercado Pago por org — fica para o épico SaaS").

O ADR-0031 afirmava, porém, que a API do MP **exige um Access Token de produção do
Mercado Pago, distinto do token OAuth do Mercado Livre**. Essa afirmação nunca teve
spike registrado no repositório, e é ela que decidia o tamanho da feature: se fosse
verdadeira, seria preciso um segundo fluxo OAuth completo (app próprio no painel do MP,
`redirect_uri` próprio, quatro edge functions, valor novo em `canal_externo`).

### Verificação empírica (2026-07-26, conta real AVILBV / 1003820507)

Usando o `access_token` da conexão `mercado_livre` já existente da org Avil:

| Chamada | Resultado |
|---|---|
| `GET api.mercadopago.com/users/me` | **HTTP 200**, `id` = 1003820507 (= `conta_externa_id`) |
| `GET api.mercadopago.com/v1/payments/search` | **HTTP 200**, `paging.total` = 707 (30d, approved) |

Todos os campos de que o pipeline depende vieram completos: `collector_id`,
`description` (o `marketplace_shipment` aparece — 75 no período), `money_release_date`,
`transaction_amount`, `transaction_amount_refunded` e
`transaction_details.net_received_amount`.

A visão é da **conta inteira**, não de um subconjunto de marketplace: 21 pagamentos com
`collector_id` diferente da conta (compras/terceiros) aparecem — exatamente o ruído que
o ADR-0031 manda filtrar. Corroboração cruzada em julho/2026, com os dois filtros do
ADR-0031 aplicados:

| Fonte | Vendas | Bruto |
|---|---|---|
| MP via token da conexão ML | 563 | R$ 28.958,89 |
| `ml_vendas` (`/orders`, `paid`) | 562 | R$ 28.725,49 (`paid_amount`) |

A diferença cabe no ruído esperado (pedido *pack* gera mais de um pagamento; defasagem
de sync). Um token com visão parcial produziria números drasticamente menores.

**Conclusão: a afirmação do ADR-0031 não se sustenta** para os endpoints que o PubliAI
usa. A conexão OAuth do ML já é, ela mesma, uma conexão por organização com token no
Vault e refresh automático — e já dá acesso à conta MP do vendedor.

### Estado que se pretendia consertar

- **Nenhuma** org tinha `configuracoes.mp_access_token_secret_id` preenchido. Ou seja,
  100% do financeiro rodava no fallback global `MP_ACCESS_TOKEN`, liberado só para a
  Avil via `MP_FALLBACK_ORG_ID`. A org DSA nunca teve financeiro.
- Esse ramo de fallback estava a um `if` de servir a conta financeira da Avil para outro
  tenant.
- O único consumidor **vivo** do token MP é `carregarLiquidoMP`, nos workers de
  faturamento, e ele alimenta apenas dois campos de `ml_vendas`: `estorno` e
  `money_release_date`. O `liquido` **não** vem do MP desde o ADR-0042.
- O caminho "MP ao vivo" (edge `resumo-financeiro`, `src/lib/financeiro.ts`,
  `useResumoFinanceiro`) foi declarado morto pelo ADR-0040 e marcado como removido no
  `TASKS.md`, mas continuava no repositório **e deployado** (v14, `ACTIVE`), sem nenhum
  call site no frontend.

## Decisão

1. **Não existe "conexão do Mercado Pago".** O financeiro passa a ler a conta MP do
   vendedor usando o token da conexão `mercado_livre` da própria organização
   (`resolverConexao` + `getValidAccessTokenConexao`). O objetivo do pedido — OAuth, uma
   conexão por empresa — é atendido pela conexão que já existe, sem uma segunda.

2. **`carregarLiquidoMP` deixa de resolver token próprio.** Passa a receber o `token` e o
   `contaExternaId` que o worker chamador já tem em escopo. Isso elimina a chamada
   `getContaId` (`/users/me`) por execução e a ida extra ao Vault.

3. **O fallback global morre no mesmo PR.** Somem `escolherTokenMP`, os secrets
   `MP_ACCESS_TOKEN` e `MP_FALLBACK_ORG_ID`, a RPC `get_mp_token` e a coluna
   `configuracoes.mp_access_token_secret_id`.

4. **O caminho morto do MP ao vivo é removido junto**: edge `resumo-financeiro` (código e
   deploy), `src/lib/financeiro.ts`, `src/hooks/useResumoFinanceiro.ts` e o que fica
   órfão com eles (`agregarFinanceiro`, `montarInfoPorPagamento`,
   `ratearFreteCompartilhado`, `semCredencialMP`). Ele consumia o mesmo `resolverTokenMP`
   que esta mudança reescreve; mantê-lo custaria mais que removê-lo.

## Consequências

- **Multi-tenant de verdade, sem tela nova.** Toda org que conectar o Mercado Livre passa
  a ter financeiro próprio automaticamente. A DSA, que hoje não tem, passa a ter assim
  que conectar.
- **Acaba o risco cross-tenant.** Não existe mais token global capaz de servir a conta da
  Avil para outra org.
- **Token deixa de ser estático.** Passa a ter refresh proativo com lock distribuído
  (ADR-0012), em vez de um token de painel que quebra em silêncio se for resetado.
- **Falha ficou mais alta, não mais baixa.** Os workers chamam
  `getValidAccessTokenConexao` e caem em `tratarFalha` (liveness, ADR-0069) **antes** de
  tocar no MP. Uma conexão ML quebrada aborta o worker de forma visível, em vez de
  degradar `estorno`/`money_release_date` em silêncio.
- **Acoplamento aceito:** desconectar o Mercado Livre derruba o financeiro junto. É
  coerente — sem conexão ML não há vendas para faturar.
- **Dívida remanescente:** `carregarLiquidoMP` continua engolindo erro de rede da API do
  MP com `console.warn` e mapa vazio (`estorno`/`money_release_date` ficam `null`).
  Comportamento pré-existente, não introduzido aqui.
- **Dependência não contratual:** o acesso à API do MP vem do escopo concedido ao app do
  ML. Se o Mercado Livre separar os escopos no futuro, a leitura financeira quebra — e
  quebrará de forma visível (HTTP 401/403 no worker), não em silêncio.

## Alternativas consideradas

- **Segunda conexão OAuth para o Mercado Pago** (`canal='mercado_pago'` em
  `marketplace_connections`): app novo no painel do MP, `redirect_uri` próprio, quatro
  edge functions novas, valor novo no enum `canal_externo` e um card em `Canais.tsx` para
  algo que não publica anúncio — sobrecarregando o termo "canal", que no domínio significa
  *marketplace onde se publica*. **Rejeitada:** só se justificaria se a conta MP pudesse
  ser diferente da conta ML do vendedor, o que não é o caso (mesmo `user_id`, confirmado
  por `/users/me`).
- **Híbrido — conexão ML por padrão, conexão MP opcional sobrescrevendo:** manteria duas
  fontes de token vivas, exatamente a bifurcação que produziu o ramo de fallback
  cross-tenant que este ADR remove. **Rejeitada.**
- **Manter `MP_ACCESS_TOKEN` como rede de segurança:** mascararia em silêncio o dia em que
  o token do ML deixasse de servir, e manteria vivo o ramo cross-tenant. **Rejeitada** —
  o rollback é restaurar o secret, não mantê-lo em uso.
