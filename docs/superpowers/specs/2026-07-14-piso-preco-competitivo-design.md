# Design: piso de R$12,55 no ramo competitivo do preço sugerido

**Data:** 2026-07-14
**Motivação:** lote #34 (LINHA ANNE 65 65MT), estratégia COMPETITIVO — a IA ficou livre pra
sugerir preço de publicação abaixo de R$12,55, faixa em que o Mercado Livre cobra uma tarifa
fixa adicional (~50% do preço, ADR-0023) além da comissão percentual normal. Diego pediu que o
piso de R$12,55 já usado no ramo próprio passe a valer também no ramo competitivo.

## Contexto atual

`supabase/functions/_shared/preco/sugerir.ts::sugerirPrecoVenda` tem dois ramos:

- **Próprio** (sem concorrência): já aplica `Math.max(PRECO_MIN_ACIMA_ABISMO, ...)` via `grossUp`
  e no fallback sem comissão (ADR-0023).
- **Competitivo** (com concorrência): `preco = menor_concorrente × (1 − desconto%)`, sem piso
  algum — pode publicar abaixo de R$12,55 ou até abaixo do custo (ADR-0020, deliberado: "mercado
  puro").

Uma tentativa anterior de forçar um piso no ramo competitivo (ADR-0063, decisão #2) foi
**revertida** por sintetizar um preço de "margem viável" que podia ficar muito acima de todo o
mercado (ex.: R$34,40 vs concorrente R$19,47), com selo "Vale a pena" enganoso. O ADR-0065
resolveu o problema de prejuízo de forma mais conservadora (re-âncora só em preço real de
concorrente MercadoLíder, nunca sintetizado, gated por toggle).

## Decisão

O piso de R$12,55 é qualitativamente diferente do "piso viável" revertido: é um valor fixo,
pequeno, ancorado num limite mecânico real da tarifa do ML (não uma margem calculada por
produto). Ainda assim pode, em casos raros, ficar acima de toda a concorrência — Diego confirmou
que aceita esse trade-off (a alternativa, vender abaixo de R$12,55, é sempre pior pela tarifa
fixa).

Aplicar `Math.max(PRECO_MIN_ACIMA_ABISMO, precoFinal)` ao resultado final do ramo competitivo
(depois do desconto de concorrência e depois de uma eventual re-âncora de líder — nunca antes).
Quando o piso for o que decide o preço final, trocar o `motivo` para deixar explícito ao operador
que o preço não é mercado puro, evitando repetir o erro do ADR-0063 (nenhum selo enganoso — o
texto do motivo já aparece na Revisão, sem widget novo). Novo motivo, como constante nomeada
(mesmo padrão de `MOTIVO_GROSSUP`/`MOTIVO_FALLBACK`):

```ts
const MOTIVO_PISO_ABISMO = `concorrência abaixo de R$${PRECO_MIN_ACIMA_ABISMO.toFixed(2)} — abismo de tarifa fixa do ML (ADR-0023); piso aplicado`;
```

Como `sugerirPrecoVenda` é o único ponto de cálculo de preço (chamado em
`process-familia/index.ts`, usado tanto no ingest normal quanto no reprocessamento de famílias em
erro), a mudança cobre automaticamente todo fluxo que gera `preco_publicacao` — não há um cálculo
de preço separado para "UPDATE de anúncio já publicado" a mexer.

## Escopo

- `supabase/functions/_shared/preco/sugerir.ts`: aplicar o piso no ramo competitivo.
- `supabase/functions/_shared/preco/__tests__/sugerir.test.ts` (ou onde estiverem os testes
  existentes): caso novo cobrindo concorrência que resultaria em preço < R$12,55.
- ADR novo (`docs/decisions/0075-*.md`) documentando a decisão, referenciando
  0020/0023/0059/0063/0065.
- Sem mudança de schema, sem mudança de UI (o campo `motivo`/`estrategia_motivo` já é persistido e
  exibido).

## Fora de escopo

- Não mexe no ramo próprio (já correto).
- Não mexe na lógica de re-âncora do ADR-0065.
- Não introduz limite de "não floorar se ficar X% acima do mercado" — Diego optou pelo piso
  incondicional.
