# ADR-0075: Piso de R$12,55 (abismo de tarifa fixa) também no ramo competitivo

**Status:** Aceito
**Data:** 2026-07-14
**Decisores:** Diego
**Relacionado:** [ADR-0020 (preço líquido mínimo + semáforo)](0020-estrategia-de-preco-liquido-minimo.md); [ADR-0023 (abismo de tarifa fixa)](0023-preco-acima-do-abismo-de-tarifa-fixa.md); [ADR-0059 (desconto concorrência configurável)](0059-desconto-concorrencia-configuravel.md); [ADR-0063 (piso viável, revertido)](0063-publicacao-kit-preco-categoria-concorrencia.md); [ADR-0065 (re-âncora líder)](0065-reancora-preco-piso-lider.md)

## Contexto

Lote #34 (LINHA ANNE 65 65MT, 21 cores): a variação publicada ficou com preço de publicação
abaixo de R$12,55 no ramo competitivo. O ML cobra, abaixo de R$12,50, uma tarifa fixa adicional
de ~50% do preço além da comissão percentual normal (comissão efetiva ~62%) — o "abismo de
tarifa fixa" documentado no ADR-0023. Esse ADR já introduziu `PRECO_MIN_ACIMA_ABISMO = 12.55`,
mas só aplicado no ramo **próprio** (sem concorrência), via `grossUp`.

No ramo **competitivo** (`conc.vendedores > 0`), o ADR-0020 define preço = mercado puro
(`menor_concorrente × (1 − desconto%)`), deliberadamente sem piso — o semáforo sinaliza
prejuízo (🔴) e o operador decide. Uma tentativa anterior de adicionar um piso ali (ADR-0063,
decisão #2, "nunca abaixo do piso viável") foi **revertida**: o piso era uma margem calculada
por produto (`grossUp(piso, comissão, frete)`), podendo ficar muito acima de todo o mercado
(ex.: R$34,40 vs concorrente R$19,47), com selo "Vale a pena" enganoso.

## Decisão

Aplicar `Math.max(PRECO_MIN_ACIMA_ABISMO, precoFinal)` também no ramo competitivo de
`sugerirPrecoVenda`, sobre o preço final (depois do desconto de concorrência e de uma eventual
re-âncora de líder do ADR-0065 — nunca antes).

**Por que isso não repete o erro do ADR-0063:** o piso revertido era uma margem sintetizada por
produto (custo + comissão + frete), que variava caso a caso e podia divergir muito do mercado. O
piso deste ADR é um **valor fixo e pequeno** (R$12,55), o mesmo já usado e aceito no ramo próprio
desde o ADR-0023, ancorado num limite mecânico real da tarifa do ML — não numa margem de negócio.
Na prática, diverge do mercado real com bem menos frequência (concorrentes estabelecidos também
evitam essa faixa, pela mesma tarifa), mas pode acontecer.

**Trade-off aceito:** em casos raros onde a concorrência real fica abaixo de R$12,55 (ex.:
vendedor sem nota/informal, ou item de baixíssimo valor), o preço sugerido fica acima de todo o
mercado. Diego aceitou esse trade-off explicitamente: publicar abaixo de R$12,55 é sempre pior
(a tarifa fixa come a margem inteira), então o piso vale mesmo assim.

**Transparência (evita o selo enganoso do e6dee14):** quando o piso decide o preço final (preço
calculado < R$12,55), o campo `motivo` (já persistido em `estrategia_motivo` e já exibido na
Revisão) passa a dizer explicitamente que o preço não é mercado puro:

```
concorrência abaixo de R$12.55 — abismo de tarifa fixa do ML (ADR-0023); piso aplicado
```

Não há selo/flag nova na UI — o texto do motivo já cobre a transparência, sem widget adicional
(YAGNI).

## Consequências

**Boas:**
- Fecha a lacuna do ADR-0023: nenhum preço de publicação (próprio ou competitivo) sai abaixo de
  R$12,55, eliminando a tarifa fixa de ~50%.
- `sugerirPrecoVenda` é o único ponto de cálculo (chamado em `process-familia/index.ts`, usado
  tanto no ingest normal quanto no reprocessamento de famílias em erro) — a mudança cobre
  automaticamente todo fluxo que gera `preco_publicacao`, sem wiring adicional.
- Mudança pura, sem I/O extra, sem nova coluna, sem nova chamada ao ML.

**Trade-offs aceitos:**
- Em casos raros, o preço fica acima de toda a concorrência (mesmo trade-off qualitativo do
  ADR-0063, mas com magnitude tipicamente muito menor por ser um piso fixo baixo, não uma margem
  calculada).
- Interage com a re-âncora do ADR-0065: se `precoAncoraLider × (1 − desconto%)` também ficar
  abaixo de R$12,55 (âncora muito barata), o piso deste ADR ainda se aplica por cima — o motivo
  final reflete o piso, não a re-âncora. Isso **refina** a garantia do ADR-0065 de "nunca sobe o
  preço acima do piso-líder": nesse caso raro específico (líder abaixo do abismo), o piso de
  tarifa fixa tem precedência, porque ficar abaixo de R$12,55 é sempre pior que ficar acima do
  preço do líder.

## Como reverter

Em `supabase/functions/_shared/preco/sugerir.ts`, remover o `Math.max(PRECO_MIN_ACIMA_ABISMO, ...)`
do ramo competitivo e a constante/uso de `MOTIVO_PISO_ABISMO`. Reverte para o comportamento do
ADR-0020 (mercado puro, sem piso).
