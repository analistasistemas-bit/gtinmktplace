---
tags: [adr, template]
atualizado: 2026-07-12
---

# ADR Template

Espelho do formato real usado em `docs/decisions/README.md` (fonte de verdade). Use isto como
base ao registrar uma nova decisão **neste vault**; o ADR oficial e imutável continua sendo
criado em `docs/decisions/NNNN-titulo.md` primeiro (regra do projeto — ver `CLAUDE.md` na
raiz do repositório).

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

## Quando criar um novo ADR

- Decisão **não-óbvia** que afeta arquitetura, stack ou processo
- **Substituição** de uma decisão anterior (novo ADR + marcar o antigo "Substituído por")
- Alguém perguntou "por que fizemos isso?" e não há onde apontar

## Índice completo

Este vault espelha em detalhe só [[ADR-001]] e [[ADR-002]], como exemplo/ponto de partida.
O histórico completo (69 ADRs até `0069`) tem título + link em [[Índice de ADRs]]; o conteúdo
(contexto, alternativas, consequências) vive em `docs/decisions/` — fonte de verdade.
