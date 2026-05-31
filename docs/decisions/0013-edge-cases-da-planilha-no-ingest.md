# ADR-0013 — Tratamento de edge cases da planilha no ingest

**Status:** Aceito
**Data:** 2026-05-31
**Decisores:** Diego (decisão de produto/UX)
**Contexto do gap:** revisão crítica do spec §556 ("Edge cases da planilha")

---

## Contexto

O `ingest-lote` transforma a planilha em famílias/variações agrupando por `PAI`
(`agruparPorPai` em `_shared/parser.ts`). Três anomalias de dados podem aparecer:

1. **Filho órfão** — linha com `PAI=X` onde `X` não existe no lote.
2. **CODIGO duplicado** — duas ou mais linhas com o mesmo `CODIGO`.
3. **PAI sem nenhum filho** — linha `PAI=0` (agrupador) que nenhuma outra linha referencia.

Comportamento **antes** desta decisão:
- Órfão: já tratado — vira "família solo" (anúncio próprio com 1 variação). **Mantido.**
- CODIGO duplicado: o `Map` por código sobrescrevia silenciosamente (PAIs/solos) ou
  gerava variações duplicadas (filhos) — perda/inconsistência **sem aviso**.
- PAI sem filho: virava família com `variacoes: []` — anúncio vazio, que violaria a
  regra "PAI nunca é vendido sozinho" e quebraria a publicação no M4.

A decisão é necessária **antes do bloco de publicação do M4**: uma família com 0
variações ou uma variação perdida em silêncio viraria um anúncio errado no Mercado Livre.

Princípio adotado: ser consistente com o tratamento de **imagens órfãs**, que já é
não-bloqueante (conta e sinaliza no resumo do lote, não aborta a importação). Bloquear
um lote de 50+ famílias por causa de uma linha ruim é custoso demais.

## Decisão

**1. CODIGO duplicado → avisar e manter a 1ª ocorrência.**
- Antes de agrupar, deduplicar por `CODIGO`: a primeira linha com cada código prevalece;
  as repetições são descartadas.
- Contabilizar quantos (e quais) códigos vieram duplicados e expor no resumo do lote.
- Não bloqueia a importação.

**2. PAI sem filho → pular a família + avisar.**
- Após agrupar, descartar famílias com `variacoes.length === 0` (PAI `PAI=0` que não
  recebeu nenhum filho). Família-solo de órfão **não** cai aqui (tem 1 variação: ele mesmo).
- Contabilizar quantas famílias foram puladas e expor no resumo do lote.
- Não bloqueia a importação.

**3. Filho órfão → inalterado** (vira família solo; já era o comportamento).

## Sinalização ao operador

Os contadores de anomalias entram no resumo do lote / tela de Progresso, no mesmo
padrão das imagens sem match (`sem_match`): algo como `codigos_duplicados` e
`familias_sem_filho`. O operador vê o que foi descartado e corrige na origem se quiser.

## Consequências

**Boas:**
- Importação resiliente: uma linha ruim não derruba um lote grande.
- Nenhuma perda silenciosa: tudo que é descartado é contado e mostrado.
- Garante que só famílias com ≥1 variação seguem para publicação (pré-condição do M4).

**Ruins / tradeoffs:**
- "Manter a 1ª" é uma heurística: se a planilha de origem colocasse a versão correta por
  último, a escolha seria errada — assumimos que duplicado é anomalia rara de exportação,
  não um padrão intencional.
- Famílias puladas exigem que o operador confira o resumo; não há bloqueio forçando isso.

## Alternativas consideradas

- **Rejeitar o lote inteiro** em qualquer anomalia: mais seguro contra inconsistência,
  mas trava lotes grandes por causa de uma linha — descartado por custo de UX.
- **Manter a última ocorrência** do CODIGO duplicado: só faria sentido se a origem
  garantisse "correto por último", o que não é o caso.
- **Criar a família vazia mesmo assim**: quebraria a publicação no ML; descartado.

---

**Implementação (pendente, no fluxo de ingest/publicação do M4):**
`_shared/parser.ts` — passo de dedup por `CODIGO` antes de `agruparPorPai` + filtro de
famílias com `variacoes` vazio, retornando contadores para o `ingest-lote` persistir no lote.
Cobrir com testes (funções puras, já testáveis no vitest).
