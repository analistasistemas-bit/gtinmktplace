# ADR-0050 — Frete grátis do vendedor entra no gross-up do preço próprio

**Data:** 2026-07-01
**Status:** aceito (implementado na branch `worktree-fix-semaforo-item-dimensoes`, aguardando validação)
**Refina:** [ADR-0020](0020-estrategia-de-preco-liquido-minimo.md) e [ADR-0023](0023-preco-acima-do-abismo-de-tarifa-fixa.md)

## Contexto

O ADR-0020 definiu `PRECO` da planilha como o **líquido mínimo** que o vendedor
aceita receber, e o gross-up (ramo sem concorrente) como o preço cujo líquido
**após a comissão** cobre esse piso: `P = (piso + fixa) / (1 − pct)`.

Faltava o frete. Quando o preço cai na faixa de frete grátis do ML (~R$ 19–78),
**o vendedor absorve o frete** (`list_cost`, ADR-0042 / `_shared/ml/frete.ts`), que
o gross-up ignorava. Resultado no lote #49 (barbante, piso R$ 17,50): o sistema
sugeria R$ 19,80, cujo líquido real era `19,80 − 2,28 (comissão) − 6,75 (frete) =
R$ 10,77` — **R$ 6,73 abaixo do piso**, não os R$ 17,50 prometidos. O semáforo de
publicação (que já descontava frete) mostrava "Prejuízo" enquanto o preço sugerido
insistia num valor que não cumpria o piso.

## Decisão

O frete que o vendedor absorve entra no gross-up junto com a comissão:

```
P = (piso + fixa + frete) / (1 − pct)
```

- `grossUp(piso, percentual, fixa, frete = 0)` e `sugerirPrecoVenda(piso, conc,
  comissao, frete = 0)` ganham `frete` opcional (default 0 — compatível com callers
  antigos). Só o ramo **sem concorrente** (`proprio`) usa; o competitivo segue o
  mercado (× 0,95).
- Em `process-familia`, o frete é buscado **uma vez por família** via
  `buscarFreteVendedor` (o mesmo de `calcular-tarifa-ml`), com as dimensões da
  variação de menor preço (a "representativa" do painel de análise) e avaliado no
  **preço de 1ª passada** (gross-up só com comissão) — que já cai na faixa de frete
  grátis, dando o `list_cost` representativo.

Para o barbante (piso R$ 17,50, 11,5%, frete R$ 6,75) o preço sugerido passa de
R$ 19,80 → **R$ 27,45**, cujo líquido `27,45 − 3,16 − 6,75 = R$ 17,54 ≥ 17,50`. 🟢

## Escopo e guardas

- Só CREATE / reprocessamento (UPDATE preserva preço — ADR-0016). Respeita
  `preco_editado_pelo_operador`.
- **Resiliente:** sem credencial ML, sem dimensões válidas (`dimensoesValidas`,
  piso 0,2 cm / 1 g) ou falha de rede → `frete = 0`, exatamente o comportamento
  anterior (nunca quebra o processamento).
- Frete é aproximado no nível da família (mesma dimensão/`list_cost` para as cores,
  que compartilham embalagem). Divergência por variação com dimensão diferente é
  capturada pelo semáforo por-item na Revisão (fix da mesma branch: o card de
  variação passou a repassar `dimensoes` ao `SemaforoPreco`).

## Consequências

- Preços próprios de itens que caem na faixa de frete grátis sobem para cumprir o
  piso de verdade. É alta visível ao comprador, mas sem ela o vendedor receberia
  abaixo do mínimo declarado na planilha.
- Preço sugerido e semáforo passam a concordar (ambos descontam comissão + frete).

## Como reverter

Remover o 4º argumento `frete` das chamadas de `sugerirPrecoVenda`/`grossUp` em
`process-familia` (ou passar 0) e retirar a busca de `buscarFreteVendedor`. As
funções voltam ao comportamento do ADR-0023 sem migration.
