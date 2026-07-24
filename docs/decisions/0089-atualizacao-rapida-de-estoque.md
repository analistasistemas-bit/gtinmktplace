# ADR-0089: Atualização rápida de estoque — publicação 1-clique para UPDATE sem pendência

**Status:** Aceito
**Data:** 2026-07-24
**Decisores:** Diego
**Refina:** ADR-0005 (revisão humana obrigatória), ADR-0016 (UPDATE = reposição de estoque), ADR-0078 (somente_estoque)

## Contexto

Reposição de estoque (famílias UPDATE já publicadas, planilha sem imagens) hoje exige
que o operador entre em Revisão e selecione manualmente as famílias antes de publicar —
mesmo quando elas não têm nenhuma pendência (todas as cores já casadas com o ML,
nenhuma cor nova aguardando foto). Para lotes grandes e puramente de reposição, essa
seleção é fricção sem valor: o critério de "pronta" já é 100% determinístico
(`familiaPublicavel`/`idsPublicaveis`).

## Decisão

1. Ao final do processamento do lote (`Progresso.tsx`), se existirem famílias
   `operacao === 'UPDATE'` que já passam em `familiaPublicavel().ok`, o sistema mostra
   um resumo "N famílias prontas para atualizar estoque" com **um único botão de
   confirmação** — não elimina a aprovação do operador (ADR-0005), só agrupa a aprovação
   em vez de exigir seleção família a família.
2. Restrito a `UPDATE`. Famílias `CREATE`, mesmo que tecnicamente completas, nunca
   entram nesse atalho — sempre seguem o fluxo manual de Revisão.
3. Preço é sempre ignorado nessa via: força `somente_estoque=true` (ADR-0078)
   independente do que vier na planilha, mesmo que o operador tenha alterado PRECO.
4. Critério de elegibilidade parte da regra existente (`familiaPublicavel`): cor nova
   com estoque > 0 sem foto bloqueia a família inteira (cai na Revisão manual); cor
   nova com estoque ≤ 0 nasce dormente e não bloqueia (ADR-0016, adendo 2026-06-16). Só
   isso não basta — `familiaPublicavel` aprova uma cor nova *completa* (foto + preço +
   estoque) mesmo que ela nunca tenha ido ao ML, e publicá-la criaria uma variação nova
   de verdade. Por isso a elegibilidade soma um segundo guard: nenhuma variação
   incluída pode ser nova (usa `casadaNoMl`, exportada de `publicavel.ts`) — só cores
   já casadas no ML (ou dormentes/excluídas) entram no atalho, completas ou não.
5. `/relatorio/{loteId}` ganha duas seções: variações que zeraram nesta rodada
   (`estoque_anterior` > 0 → estoque 0) e famílias em que todas as variações zeraram
   (informativo — não pausa nada automaticamente no ML).

## Consequências

- Reposição de estoque em lote passa a ser rápida sem afrouxar o gate que existe desde
  os incidentes de 2026-06-10 (falso-positivo de cor nova quase duplicou SKU) e
  2026-06-12 (preço divergente quebrou o PUT no ML) — o filtro reusa exatamente a mesma
  checagem que já bloqueia esses casos hoje.
- Nenhuma mudança na planilha, no `ingest-lote`, no schema ou nos critérios de "pronta"
  — é só uma UI que automatiza uma seleção que já era 100% previsível.
- Pausar automaticamente um anúncio com estoque total zerado foi considerado e
  descartado (ver Alternativas) — fica como relatório informativo, ação manual do
  operador via ADR-0060.

## Alternativas consideradas

- **Pausar automaticamente no ML quando toda a família zerar:** rejeitado — pausar hoje
  é ação restrita a admin (ADR-0060) e o objetivo real do operador era velocidade na
  reposição, não mudar visibilidade de anúncios; zerar o estoque já torna a variação
  `out_of_stock` (não vendável) sem precisar de pause.
- **Permitir CREATE completo no mesmo atalho:** rejeitado — publicar produto
  genuinamente novo sem olhar a Revisão reabre exatamente o risco que o ADR-0005 existe
  para evitar.
- **Publicar zero-clique (sem nenhuma confirmação):** rejeitado — mantém o espírito do
  ADR-0005 (aprovação explícita do operador), só remove a fricção de seleção manual.
