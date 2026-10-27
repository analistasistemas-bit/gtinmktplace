# ADR-0191 — Produto único na planilha: `PAI` vazio sem filhos vira anúncio de 1 SKU

**Status:** Aceito
**Data:** 2026-10-26
**Decisores:** Diego
**Emenda:** ADR-0013 (item 3, "PAI sem filho")

---

## Contexto

A org Hairfly mandou uma planilha só com produtos únicos: cada linha é um produto vendável e a
coluna `PAI` vem **vazia**, sem linhas filhas. Hoje o ingest descarta todas:

- `mapearLinha` convertia a célula vazia em `'0'` (`String(r.PAI ?? '0')`), apagando a diferença
  entre "vazio" e "0";
- `agruparPorPai` trata `PAI` `''`/`'0'` como agrupador e, sem filhos, joga a linha em
  `familias_sem_filho` (ADR-0013). Resultado: lote com 0 famílias.

Medição em produção (26/10/2026, 132 lotes): os únicos casos de "pai sem filho" foram 8 lotes da
Avil. Nas 6 planilhas inspecionadas, **todos** os 178 pais da Avil usam `PAI = 0` explícito, e os
pais sem filho são agrupadores internos "(P)" com estoque 0, que **não** podem virar anúncio.
Nenhum lote em produção teve `PAI` vazio descartado.

## Decisão

1. **`PAI` vazio + nenhum filho = produto único.** Vira família com `codigo_pai = CODIGO` e uma
   única variação: a própria linha (mesmo `CODIGO` como SKU, `GTIN`, preço, custo, estoque,
   medidas).
2. **`PAI = 0` + nenhum filho continua descartado** em `familias_sem_filho` (ADR-0013 intacto
   para esse caso). `0` é o marcador explícito de agrupador.
3. **`PAI` vazio com filhos continua agrupador**, como hoje.
4. `mapearLinha` preserva o vazio (`String(r.PAI ?? '')`). Todo o resto já tratava `''` e `'0'`
   igual, então nada mais muda.

ORIGEM (ADR-0107) e campos fiscais (ADR-0135/0187) já são exigidos em linha com `PAI` vazio, e
portanto cobrem o produto único sem mudança. A revisão humana antes de publicar continua igual.

## Alternativas descartadas

- **Qualquer pai sem filho vira produto único:** criaria anúncio dos agrupadores "(P)" da Avil.
- **Exigir que o cliente monte PAI + 1 filho:** obriga a inventar um código de pai que não existe
  no sistema do cliente.

## Consequências

- Planilha só de produtos únicos importa sem conversão.
- Família de produto único tem `codigo_pai` igual ao `codigo` da variação (sem precedente até
  agora; tabelas separadas, sem conflito de chave). Uma reimportação da mesma linha cai em UPDATE
  pelo `codigo_pai`, como qualquer família.
- Sem coluna nem contador novo.
