# ADR-0107 — ORIGEM é obrigatória e explícita na planilha

- **Status:** aceito
- **Data:** 2026-08-07
- **Refina:** [ADR-0055](0055-imposto-por-origem-nacional-importado.md)
- **Contexto relacionado:** ADR-0013 (anomalias não-bloqueantes), ADR-0020 (preço líquido mínimo)

## Contexto

O ADR-0055 criou a coluna `ORIGEM` na planilha e decidiu, explicitamente, que ela seria
**opcional**: *"ausente/vazio/inválido → nacional"*. Na prática isso é um default silencioso numa
alíquota de imposto — exatamente o que o projeto proíbe em toda regra financeira.

Em 2026-08-07 Diego reportou uma venda do **Tecido Oxford 10m** com imposto de R$ 4,49 sobre
R$ 56,16 — 8% (nacional) num produto importado, que deveria pagar 16% (R$ 8,99). Investigação:

- As famílias do Oxford (lotes 48, 53 e 55) estavam gravadas como `nacional`.
- Lotes 53/55 (06/07) caíram no bug do `ingest-lote` que dropava a coluna ORIGEM no map
  (corrigido em `e7bb78ed`, 14/07). O backfill daquele dia cobriu só os lotes 61, 63 e 64.
- Mas o **Oxford Estampas de Natal** (lote 72, 29/07) é **posterior ao fix** e também estava
  `nacional`: a trava `verificarOrigemInviolavel` aprovou o lote porque a planilha simplesmente
  não trazia a coluna — crua e montada concordavam em `nacional`.

Ou seja: a trava de 14/07 protege contra o pipeline **perder** uma coluna que existe, mas não
contra a coluna **nunca ter existido**. O caminho de cadastro manual (`dialog-cadastro-produto`)
já exigia a origem num radio sem default; só a planilha ficou frouxa.

7 famílias tiveram a origem corrigida à mão no banco em 2026-08-07 (Oxford 10m ×3, Oxford 5m ×2,
Oxford Natal, Helanca Light 10 Metros).

## Decisão

`ORIGEM` passa a ser **obrigatória e explícita**, barrada em dois pontos do `ingest-lote`:

1. **Cabeçalho:** `ORIGEM` entra em `COLUNAS_OBRIGATORIAS` (`_shared/types.ts`). Planilha sem a
   coluna é rejeitada por `validarColunas`, como qualquer outra coluna obrigatória.
2. **Valor:** `exigirOrigemExplicita` (`ingest-lote/verificar-origem.ts`) exige `NACIONAL` ou
   `IMPORTADO` (case-insensitive, com trim) em **toda linha PAI**. Célula vazia ou valor fora do
   par — `IMPORTADA`, `EXTERIOR`, qualquer typo — aborta o lote inteiro, antes de qualquer
   persistência, com a lista completa dos códigos problemáticos numa mensagem só.

A `origem` continua sendo da família, lida da linha PAI; a coluna nas linhas filhas segue
ignorada (ADR-0055). `normalizarOrigem` permanece tolerante para o **preview** de análise
(`_shared/analise/extrair-itens.ts`), que aceita planilha enxuta e não persiste nada.

Isto é uma exceção deliberada ao ADR-0013 (anomalias de planilha são não-bloqueantes e a linha é
só descartada): descartar a linha aqui significaria gravar imposto presumido.

## Consequências

- Planilhas antigas sem a coluna `ORIGEM` **param de subir** até serem corrigidas. É o custo
  aceito: melhor um lote rejeitado com mensagem clara do que 8% cobrado sobre importado.
- A mensagem de erro chega à tela de Lotes (`Falha no ingest: ORIGEM ausente ou inválida em N
  produto(s) PAI: ...`) e o lote fica com `status = 'erro'`.
- Corrigir `familias.origem` **não** recalcula o preço já publicado (ADR-0016): o gross-up foi
  feito com a alíquota antiga. Re-preço de anúncio publicado segue sendo decisão de negócio,
  a mesma pendência aberta no `TASKS.md` de 2026-07-14.
