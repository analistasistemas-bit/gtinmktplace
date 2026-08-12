# ADR-0116 — GTIN com dígito verificador errado é ausência de código, não dado a publicar

**Status:** Aceito
**Data:** 2026-08-12
**Decisores:** Diego
**Relacionado:** ADR-0021 (vinculação automática ao catálogo ML); ADR-0045 (vendas de catálogo por match EAN); ADR-0107 (ORIGEM obrigatória na linha PAI)

## Contexto

Lote #46, família `92710170` (*Tecido Oxford Liso Estampa Natal 10m*, importado). O CREATE
falhou com:

> Atributo obrigatório com problema (Product Identifier [GTIN] contains values with invalid
> format: [48251671]). Revise os atributos da categoria.

`48251671` tem 8 dígitos — comprimento de EAN-8 válido — mas o dígito verificador GS1 deveria
ser `9`. O mesmo vale interpretando o número como GTIN-12/13/14 com zeros à esquerda: a soma
ponderada dá 61 nas quatro leituras, e o verificador correto seria sempre `9`. Não é zero
perdido na leitura da planilha: é o código do fornecedor ocupando a coluna `GTIN`, padrão
comum em planilha de produto importado.

`gtinAusente` (`supabase/functions/_shared/ml/publicar.ts`) já rejeitava vazio, código interno
`3000*` e comprimento fora de 8/12/13/14 — este último introduzido pelo lote #48
(`gtin="533100017"`, 9 dígitos). Mas aceitava qualquer número de comprimento certo, com o
comentário explícito de que "GTIN malformado o ML rejeita e expõe o erro ao operador".

O problema desse desenho: o operador não tem como agir sobre o erro. O GTIN entrava só pela
planilha e era read-only na Revisão, então "expor o erro" significava re-editar a planilha e
re-ingerir o lote inteiro — reprocessando IA — para apagar uma célula.

## Decisão

**1. Dígito verificador GS1 entra na definição de GTIN ausente.** `gtinAusente` passa a
validar o mod-10 além do comprimento. Número que não fecha o verificador não identifica
produto nenhum — publicar com ele derruba o anúncio inteiro, e é a mesma classe de dado que a
regra de comprimento já tratava como ausência (código de fornecedor na coluna errada).

Consequência: a variação sai como `EMPTY_GTIN_REASON` ("o produto não tem código cadastrado")
nas categorias que aceitam o atributo, e sem GTIN nas que não aceitam — o caminho que já
existia para produto sem código universal.

**2. O GTIN passa a ser editável na Revisão** (`variacao-card.tsx`), com aviso inline quando
o valor não fecha o verificador. Apagar o campo publica como "sem código universal"; corrigir
o número publica o GTIN. Sem re-ingest, sem SQL.

## Consequências

- **Publicação:** GTIN inválido deixa de derrubar o CREATE/UPDATE; o anúncio sai sem código.
- **Catálogo (ADR-0021):** `buscarProdutoCatalogoPorGtin` compartilha `gtinAusente`, então
  variação com GTIN inválido deixa de ser pesquisada no catálogo do ML. Não há perda: o ML
  valida o verificador ao criar ficha, então nenhuma ficha legítima casaria com esse número —
  a chamada era garantidamente vazia.
- **UPDATE de anúncio já publicado:** variação no ar cujo GTIN não fecha o verificador troca o
  atributo `GTIN` por `EMPTY_GTIN_REASON` no próximo UPDATE. É correção de dado falso, mas é
  alteração em anúncio vivo — vale conferir o resultado no primeiro UPDATE após esta mudança.
- **Vendas por EAN (ADR-0045):** não afetado — o match usa `variacoes.gtin` cru, que continua
  guardando o que a planilha trouxe.
- **Não unificado:** `concorrencia/gtin.ts` mantém sua própria `gtinValido` (só comprimento).
  Fluxo distinto (busca de concorrência), fora do escopo desta decisão.

## Alternativas descartadas

- **Corrigir a planilha e re-ingerir:** resolve um lote, reprocessa IA e não impede o próximo.
- **Abortar o lote no ingest quando o GTIN não fecha (modelo ADR-0107):** ORIGEM define
  alíquota — errar custa dinheiro, então falhar alto se justifica. GTIN ausente é situação
  normal e prevista pelo ML; travar o lote seria desproporcional.
