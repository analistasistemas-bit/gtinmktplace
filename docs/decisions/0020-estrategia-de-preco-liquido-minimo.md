# ADR-0020: PRECO da planilha como líquido mínimo + semáforo de viabilidade

**Status:** Aceito
**Data:** 2026-06-09
**Decisores:** Diego
**Substitui:** ADR-0008

## Contexto

No ADR-0008 a coluna `PRECO` da planilha era o preço de venda. Diego inverteu a
semântica: `PRECO` passa a ser o **líquido mínimo que ele aceita receber depois da
comissão do ML**. O sistema deve calcular o preço de venda que respeite esse piso e
sinalizar, de forma fácil, se vale a pena publicar cada produto.

## Decisão

Por variação, no CREATE (`process-familia`):

- **Com concorrente** (`vendedores > 0` e `preco_min ≠ null`):
  `preço_venda = arredonda5_próximo(menor_concorrente × 0,95)`, estratégia `competitivo`.
  O preço é puro mercado; não sobe para garantir o piso (o semáforo avisa).
- **Sem concorrente:** `preço_venda = gross_up(PRECO)` — menor múltiplo de R$ 0,05 cujo
  líquido (após comissão Clássico) ≥ `PRECO`. Estratégia `proprio`.

Arredondamento sempre em múltiplos de R$ 0,05 (centavos terminando em 0 ou 5):
competitivo → mais próximo; gross-up → para cima (nunca abaixo do piso).

Gross-up inverte a comissão: `P = (PRECO + tarifa_fixa) / (1 − percentual)`, com a comissão
vinda de `GET /sites/MLB/listing_prices` (tipo `gold_special`). A comissão é buscada uma vez
por família (no menor piso); a imprecisão da faixa de tarifa fixa (~R$ 29) é coberta pelo
semáforo, que recalcula o líquido real no preço final.

## Semáforo "vale a pena publicar?"

`líquido = preço_venda − comissão(preço_venda)` (Clássico), por variação; família = pior caso.

- 🟢 `líquido ≥ PRECO` — recebe o mínimo ou mais.
- 🟡 `CUSTO ≤ líquido < PRECO` — abaixo do mínimo, sem prejuízo de caixa.
- 🔴 `líquido < CUSTO` — prejuízo real.

Frete grátis acima de ~R$ 19 (custo não exposto pela API) entra como **badge separado**
("frete por sua conta"), sem alterar a cor.

## Escopo e guardas

- Só CREATE (UPDATE preserva preço — ADR-0016).
- Respeita `preco_editado_pelo_operador`.
- ~~5% e thresholds fixos (config futura).~~ Percentual configurável desde ADR-0059
  (`configuracoes.desconto_concorrencia_pct`, menu Configurações); thresholds seguem fixos.
- Falha do ML / categoria indefinida → preço cai para o piso + semáforo "indisponível".
- Sem migration: reusa `preco_publicacao`, `variacoes.preco`, `variacoes.custo`,
  `estrategia_preco`/`estrategia_motivo`.

## Como reverter

Restaurar `_shared/preco/calcular.ts` (ADR-0008) e reverter `process-familia` ao uso de
`calcularEstrategiaPreco`. O semáforo é aditivo (front) e pode ser removido isoladamente.
