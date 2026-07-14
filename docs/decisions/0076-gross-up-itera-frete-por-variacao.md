# ADR-0076 — Gross-up itera o frete por variação até o preço estabilizar

**Data:** 2026-07-14
**Status:** aceito (branch local `worktree-gross-up-frete-iterado`, aguardando validação do Diego)
**Refina:** [ADR-0050](0050-frete-no-gross-up-preco-proprio.md) (frete no gross-up), [ADR-0020](0020-estrategia-de-preco-liquido-minimo.md), [ADR-0055](0055-imposto-por-origem.md)

## Contexto

O ADR-0050 colocou o frete grátis que o vendedor absorve dentro do gross-up
(`P = (piso + fixa + frete)/(1 − pct − imposto)`), mas com duas simplificações:

1. **Frete família-level:** buscado **uma vez** por família, com as dimensões e no
   preço de 1ª passada da variação **de menor preço** (a representativa).
2. **Passada única:** o frete era lido num preço e o preço final não era reavaliado.

O frete grátis do vendedor **não é flat** — ele salta quando o preço cruza faixas do
ML (notadamente ~R$79, onde o frete grátis vira obrigatório com subsídio maior do
vendedor). Com preços diferentes por variação (pisos diferentes), uma cor cara cai
numa faixa de frete mais alta que a representativa.

**Incidente (família FITAS DE VELUDO, cor Laranja):** piso R$78, pacote 388 g. O frete
família era R$6,75 (calculado no preço ~R$28 da cor mais barata) e foi aplicado à
Laranja, cujo preço 105,95 cruza os R$79 — onde o frete real é **R$16,15**. Resultado:
`105,95 − 12,71 (comissão) − 16,15 (frete) = 77,09`, **R$0,91 abaixo** do piso R$78 →
🟡 "Abaixo do mínimo" mesmo **sem concorrência**. O gross-up de passada única
subestimou o frete ao trocar de faixa.

## Decisão

No ramo **próprio** (sem concorrência), o frete do gross-up passa a ser **por variação
e iterado até o preço estabilizar**:

```
preço = grossUp(piso, pct, fixa, frete=0, imposto)   // 1ª passada
repetir até estabilizar (ou maxIter):
  frete = buscarFreteVendedor(preço, dimensões da variação)
  novo  = grossUp(piso, pct, fixa, frete, imposto)
  se novo == preço: parar
  preço = novo
```

Como somar frete só **sobe** o preço e um preço maior → frete **maior ou igual**
(monótono, faixas discretas), a sequência converge em poucas iterações. Nova função
pura `freteEstavelGrossUp` (em `_shared/preco/sugerir.ts`) devolve o **frete no preço
convergido**; o `sugerirPrecoVenda`/`grossUp` existentes produzem o preço final a
partir dele — sem mudar o contrato deles.

Para a Laranja: frete estabiliza em 16,15, `(78 + 16,15)/0,80` = **R$117,70**, cujo
líquido `117,70 − 14,12 − 16,15 = 87,43 ≥ 78` (e ≥ 78 também descontando o imposto que
o gross-up cobre). 🟢. Cores abaixo dos R$79 (frete flat 6,75) **não mudam**.

## Escopo e guardas

- **Só o ramo próprio.** O competitivo segue o mercado (× (1 − desconto%)) e usa o
  frete família só no gatilho 🔴 da re-âncora (ADR-0065) — inalterado.
- **Por variação:** dimensões e piso da própria variação. Memoização natural pelo
  cache Redis 6h de `buscarFreteVendedor`.
- **Resiliente:** qualquer falha de ML (token/rede) → cai no frete família já buscado
  (comportamento do ADR-0050). Nunca quebra o processamento.
- Só CREATE / reprocessamento; respeita `preco_editado_pelo_operador` (ADR-0016).
- `estrategiaFamilia` (estrategia/motivo/reancorado gravados na família) segue com o
  frete família — só `variacoes.preco_publicacao` por variação muda.
- Imposto por origem (ADR-0055): o gross-up cobre o imposto no denominador
  (`nacional 8% / importado 16%`, de `familias.origem`).

## Consequências

- Cores de **piso alto que cruzam faixa de frete** sobem para cumprir o piso de
  verdade após comissão + frete + imposto (ex.: Laranja 105,95 → ~117,70). É alta
  visível ao comprador, mas sem ela o vendedor recebe abaixo do mínimo declarado — o
  mesmo motivo do ADR-0050.
- Preço sugerido e semáforo voltam a concordar no ramo próprio, mesmo entre faixas.
- Mais chamadas de frete (por variação, iteradas) — cacheadas 6h; worker em background.

## Como reverter

Restaurar o frete família-level único em `process-familia` (buscar uma vez no
1º-passe de `precoMinFamilia`, passar a todas as variações) e remover
`freteEstavelGrossUp`. Sem migration.
