# ADR-0116 — GTIN com dígito verificador errado é ausência de código, não dado a publicar

> **Colisão de numeração.** Existe outro ADR com o número 0116, decidido no mesmo dia
> (12/08/2026): [Visibilidade do que o pipeline de título descarta](0116-visibilidade-dos-descartes-do-titulo.md).
> Distinguir pelo slug — nenhum dos dois é renumerado, porque o número do outro está gravado numa
> migration já aplicada e em código. Este ADR é citado em `src/lib/queries.ts` e em
> `docs/reference/edge-functions.md`.

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
  variação com GTIN inválido deixa de ser pesquisada no catálogo do ML. Sem efeito observável:
  o ML valida o verificador ao criar ficha, então a busca já voltava vazia — os dois caminhos
  (`catalogo.ts:479` e `:571`) tratam `ficha = null` como "sem ficha", exatamente como antes.
  Muda só que a chamada HTTP deixa de ser feita.
- **UPDATE de anúncio já publicado:** nenhum anúncio vivo carrega GTIN de verificador inválido —
  o ML recusa o formato no CREATE (é o erro do lote #46), então esses itens ou nunca publicaram
  ou publicaram sem código. O efeito real é o inverso do temido: UPDATE que falhava com o mesmo
  400 passa a completar, mandando `EMPTY_GTIN_REASON` no lugar do número recusado. Ainda assim,
  vale conferir o primeiro UPDATE após esta mudança — a premissa "o ML valida em todos os
  comprimentos" foi observada em GTIN de 8 dígitos, não testada nos quatro.
- **Categoria sem `EMPTY_GTIN_REASON`:** o atributo é omitido (caminho que já existia para o
  botão, `MLB270272`) — GTIN é `conditional_required`, então o anúncio publica sem ele. No
  caminho User Products a lista hard-coded nem decide: `aceitaEmptyGtin` vem do schema real da
  API (`publish-familia-ml/processar.ts:127-131`).
- **Vendas por EAN (ADR-0045):** não afetado — o match usa `variacoes.gtin` cru, que continua
  guardando o que a planilha trouxe.
- **Não unificado:** `concorrencia/gtin.ts` mantém sua própria `gtinValido` (só comprimento).
  Fluxo distinto (busca de concorrência), fora do escopo desta decisão.

## Alternativas descartadas

- **Corrigir a planilha e re-ingerir:** resolve um lote, reprocessa IA e não impede o próximo.
- **Abortar o lote no ingest quando o GTIN não fecha (modelo ADR-0107):** ORIGEM define
  alíquota — errar custa dinheiro, então falhar alto se justifica. GTIN ausente é situação
  normal e prevista pelo ML; travar o lote seria desproporcional.

## Emenda 2026-10-17 — GTIN inválido não é mais gravado

**Mudança:** `variacoes.gtin` deixa de guardar o valor cru quando ele não fecha GS1. `gtinOuNull`
(`_shared/produto/gtin.ts`, reusa `gtinValido` de `_shared/nfe/regras.ts`) grava `NULL` para
comprimento fora de 8/12/13/14 ou dígito verificador errado; `3000*` continua gravado (mesma
régua de `gtinInvalido` do front). Aplicado em todo ponto de escrita: `cadastrar-produto`
(gravação e comparação do retry, os dois lados normalizados para não dar 409 em retry de
gravação antiga), `adicionar-variacoes-familia` (nova, intenção e clone), `criar-kit-vinculado`
e `ingest-lote` (`mapear-linha`; célula numérica de 11 dígitos volta o zero do UPC-A). O
cadastro avisa "EAN inválido — será descartado" sem bloquear. Edição manual na Revisão fica
fora: é digitação explícita e a tela já avisa.

**Por quê:** NF 1051 — no cadastro pela nota a matriz abria na aba GTIN (estoque oculto, D-4 do
ADR-0181) e as quantidades viraram EAN "1"/"2" em 34 SKUs; o operador teria de apagar um a um
na Revisão. O ML já tratava esses valores como ausentes (`gtinAusente`), então o anúncio sai
igual — só some o lixo da tela.

**Revoga** a linha "Vendas por EAN … `variacoes.gtin` cru, que continua guardando o que a
planilha trouxe". Sem efeito na atribuição: o match do ADR-0045 cruza com o GTIN dos atributos
do item no ML, que o próprio ML exige válido — um valor que não fecha GS1 nunca casaria.

**Limite conhecido:** EAN-8 com zero à esquerda gravado como número no XLSX chega com 7 dígitos
e vira `NULL` (antes ia cru e o ML tratava como ausente — sem piora). Correção exige ler a célula
formatada (`.w`) no ingest.
