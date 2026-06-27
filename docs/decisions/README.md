# ADRs — Architecture Decision Records

Esta pasta contém o registro de decisões arquiteturais do PubliAI. Cada ADR documenta **uma decisão**, o **contexto** em que foi tomada, **alternativas consideradas**, e **consequências** (positivas e negativas).

## Por que ADRs?

Decisões técnicas têm meia-vida curta na memória das pessoas. Em 6 meses, ninguém vai lembrar por que escolhemos QStash em vez de uma fila no Postgres — mas o ADR vai. Isso evita re-debate eterno e ajuda novos colaboradores (ou seu eu do futuro) a entender o "porquê".

## Formato

Cada ADR segue este formato compacto:

```markdown
# ADR-XXXX: Título curto e direto

**Status:** Aceito | Em proposta | Substituído por ADR-YYYY | Obsoleto
**Data:** YYYY-MM-DD
**Decisores:** quem decidiu

## Contexto
Qual problema/situação? Quais forças estão em jogo?

## Decisão
O que decidimos fazer? Em uma ou duas frases diretas.

## Alternativas consideradas
- Opção A: pros / cons / por que não escolhemos
- Opção B: pros / cons / por que não escolhemos

## Consequências
- Boas: ...
- Ruins / tradeoffs aceitos: ...
- Como reverter, se for o caso
```

## Quando criar um novo ADR?

- Quando você for tomar uma decisão **não-óbvia** que afeta arquitetura, stack, ou processo
- Quando você for **substituir** uma decisão anterior (criar novo ADR e marcar o antigo como "Substituído por")
- Quando alguém da equipe perguntar "por que fizemos isso?" e você não tiver onde apontar

## Numeração

ADRs são numerados sequencialmente (0001, 0002, ...) e **nunca são renumerados**. Mesmo que um ADR seja obsoletado, ele fica aqui — só muda o status.

> **Exceção única (2026-06-27):** houve uma *colisão* de numeração — dois ADRs com `0035` e dois com `0037` (erro de criação, não um ADR settled a renomear). Para restaurar a invariante "1 número → 1 ADR", os de menor impacto de referência foram renumerados: `0035-cor-no-titulo-mono-cor` → **0044** e `0037-vendas-catalogo-match-ean` → **0045**. Isso resolve a ambiguidade e **não** é precedente para renumerar ADRs válidos.

## Lista atual

Veja o [README principal](../README.md#onde-encontrar-o-quê) para a tabela completa dos ADRs vigentes.
