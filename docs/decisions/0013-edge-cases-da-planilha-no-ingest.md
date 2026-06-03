# ADR-0013 — Tratamento de edge cases da planilha no ingest

**Status:** Aceito
**Data:** 2026-05-31
**Decisores:** Diego (decisão de produto/UX)
**Contexto do gap:** revisão crítica do spec §556 ("Edge cases da planilha")

---

## Contexto

O `ingest-lote` transforma a planilha em famílias/variações agrupando por `PAI`
(`agruparPorPai` em `_shared/parser.ts`). Três anomalias de dados podem aparecer:

1. **CODIGO duplicado** — duas ou mais linhas com o mesmo `CODIGO`.
2. **Filho órfão** — linha com `PAI=X` onde `X` não existe no lote.
3. **PAI sem nenhum filho** — linha `PAI=0` (agrupador) que nenhuma outra linha referencia.

### Comportamento atual (antes desta decisão)

Conferido lendo `_shared/parser.ts`:

- **CODIGO duplicado:** PAIs duplicados são sobrescritos em silêncio (`pais.set(codigo, r)` —
  o último vence); filhos duplicados viram **duas variações** (`lista.push(r)`). Em ambos os
  casos **sem aviso**.
- **Filho órfão:** `agruparPorPai` **lança erro** → o lote inteiro é **rejeitado**
  (`throw new Error("Linha órfã: ...")`).
- **PAI sem filho:** `agruparPorPai` **lança erro** → o lote inteiro é **rejeitado**
  (`throw new Error("PAI ... sem variações ...")`).

> Não existe conceito de "família solo" no código — uma versão anterior deste ADR
> descreveu isso por engano; o comportamento real para órfão e PAI-sem-filho sempre foi
> rejeitar o lote.

### Por que decidir agora

Dois problemas com o status quo:

1. **Bloqueio total é caro:** um lote de 50+ famílias é abortado por causa de uma única
   linha órfã ou um único PAI vazio.
2. **CODIGO duplicado é silencioso:** uma variação pode sumir (ou duplicar) sem ninguém saber,
   o que no bloco de publicação do M4 vira anúncio errado no Mercado Livre.

Princípio adotado: ser consistente com o tratamento de **imagens órfãs**, que já é
**não-bloqueante** (conta e sinaliza no resumo do lote, não aborta a importação).

## Decisão

As três anomalias passam a ser **não-bloqueantes**: a linha problemática é descartada,
contabilizada e sinalizada no resumo do lote; a importação prossegue.

**1. CODIGO duplicado → avisar e manter a 1ª ocorrência.**
- Deduplicar por `CODIGO` antes de agrupar: a primeira linha com cada código prevalece;
  as repetições são descartadas.
- Contabilizar quantos (e quais) códigos vieram duplicados.

**2. Filho órfão → pular o filho e avisar.**
- Em vez de lançar erro, descartar a variação cujo `PAI` não existe no lote.
- Contabilizar quantos filhos órfãos foram descartados.

**3. PAI sem filho → pular a família e avisar.**
- Em vez de lançar erro, descartar a família `PAI=0` que não recebeu nenhum filho.
- Contabilizar quantas famílias foram puladas.

Isso garante a pré-condição da publicação do M4: só seguem famílias com ≥1 variação,
e nenhuma variação é perdida em silêncio.

## Sinalização ao operador

Os contadores entram no resumo do lote / tela de Progresso, no mesmo padrão das imagens
sem match (`sem_match`): algo como `codigos_duplicados`, `filhos_orfaos`,
`familias_sem_filho`. O operador vê o que foi descartado e corrige na origem se quiser
(ex.: um órfão costuma indicar que o PAI faltou na exportação → reimportar).

## Consequências

**Boas:**
- Importação resiliente: uma linha ruim não derruba um lote grande.
- Nenhuma perda silenciosa: tudo que é descartado é contado e mostrado.
- Garante que só famílias com ≥1 variação seguem para publicação (pré-condição do M4).

**Ruins / tradeoffs:**
- "Manter a 1ª" é heurística: se a origem colocasse a versão correta por último, a escolha
  seria errada — assume-se que duplicado é anomalia rara de exportação, não um padrão.
- Anomalias puladas dependem de o operador conferir o resumo; não há bloqueio forçando isso.
  Aceito por consistência com o tratamento de imagens órfãs.

## Alternativas consideradas

- **Manter a rejeição do lote inteiro** (status quo para órfão e PAI-sem-filho): mais seguro
  contra inconsistência, mas trava lotes grandes por uma linha — descartado por custo de UX.
- **Manter a última ocorrência** do CODIGO duplicado: só faria sentido se a origem garantisse
  "correto por último", o que não é o caso.
- **Publicar o filho órfão como item solo** (anúncio próprio de 1 item): não faz sentido no
  fluxo de aviamentos agrupados por PAI — descartado.

---

**Implementação ✅ (2026-06-03):**
`_shared/parser.ts` — `agruparPorPai` agora (a) deduplica por `CODIGO` (1ª ocorrência vence)
antes de agrupar; (b) coleta filhos órfãos e PAIs-sem-filho em vez de lançar; (c) retorna
`{ grupos, anomalias }` (`ResultadoAgrupamento` em `types.ts`). 5 testes TDD em
`_shared/__tests__/parser.test.ts` (os 3 testes antigos de comportamento bloqueante foram
migrados para o novo contrato). `ingest-lote` consome o novo retorno, aborta só se `grupos`
ficar vazio após o descarte, e persiste `anomalias` na coluna nova `lotes.anomalias_planilha`
(jsonb, migration `add_anomalias_planilha_lotes`). Frontend: `parseAnomalias`/`totalAnomalias`
(TDD em `tests/lib/anomalias.test.ts`) + `Lote.anomalias` no adapter + faixa âmbar de
descartados no `Progresso.tsx`. **Deploy do `ingest-lote` via MCP pendente** (necessário para
o efeito em produção). 173 testes verdes.
