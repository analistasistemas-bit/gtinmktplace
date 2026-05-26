# ADR-0005: Lifecycle — publica novo + atualiza existente (não "fire and forget")

**Status:** Aceito
**Data:** 2026-05-26
**Decisores:** Diego

## Contexto

A planilha exportada do sistema interno é **recorrente** — o operador a importa em lotes periódicos. Cada planilha pode conter:

- **Famílias novas** (nunca publicadas no Mercado Livre)
- **Famílias já publicadas** (com estoque/preço atualizados)
- Em casos futuros: famílias publicadas com mudanças estruturais (nova variação adicionada, variação descontinuada)

A proposta original do Leonardo era "one-shot publishing" — sistema publica e esquece. Manutenção de estoque/preço ficaria por conta do operador no painel do ML, ou de um sistema externo.

## Decisão

O sistema **detecta automaticamente** durante a importação se uma família já foi publicada (busca por `codigo_pai` na tabela `familias` com `ml_item_id NOT NULL`):

- **Família nova:** segue o pipeline completo (enriquecimento → IA → concorrência → revisão → publicação como CREATE)
- **Família existente:** sistema entra em modo UPDATE — atualiza apenas **estoque e preço** na publicação existente; pula chamadas de IA e busca de concorrência por padrão; mostra na tela de revisão o que será atualizado (operador pode aprovar/rejeitar)

A decisão (CREATE vs UPDATE) é exibida claramente na UI de revisão para cada família, com cor/badge distinto.

## Alternativas consideradas

- **Opção A: One-shot publishing (proposta original)**
  - Pros: pipeline mais simples, menos casos
  - Cons: operador precisa manter ML em sincronia manualmente; risco de estoque defasado; perde valor recorrente
  - Rejeitada porque a planilha é recorrente por natureza — ignorar isso seria deixar valor na mesa

- **Opção B: Sincronização periódica automática (via cron)**
  - Pros: estoque sempre fresco; sem trabalho manual
  - Cons: precisa de mecanismo de detecção de mudanças no sistema interno (CDC, webhook, polling); fora do escopo do MVP; pode publicar atualizações indesejadas
  - Diferida para v2 — vai ser uma evolução natural

- **Opção C: Re-importar planilha detecta e atualiza (escolhida)**
  - Pros: mantém controle no operador (ele decide quando re-importar); zero infra adicional; lê das mesmas planilhas que ele já exporta hoje
  - Cons: depende do operador lembrar de re-importar; estoque pode ficar defasado entre importações
  - Aceita como melhor equilíbrio para o MVP

- **Opção D: Sincronização contínua via integração direta com banco interno**
  - Pros: melhor experiência, dados sempre frescos
  - Cons: requer expor banco interno à nuvem (segurança); integração mais cara; fora de escopo do MVP
  - Diferida indefinidamente — uma versão futura pode considerar

## Consequências

**Boas:**
- 80% do valor de sincronização sem 80% da complexidade
- Mantém o operador no controle do "quando" — útil em fluxos onde nem toda mudança no sistema interno deve ir pro ML imediatamente
- Pipeline UPDATE é muito mais barato (sem IA, sem busca de concorrência) — lote de 50 produtos pode atualizar em segundos
- Reusa a mesma UI de revisão; nada novo a aprender

**Tradeoffs aceitos:**
- Risco de estoque defasado entre importações — mitigado por operador rotinar a importação (recomendação: ao menos 1x por semana)
- Mudanças estruturais (variação adicionada/removida em uma família já publicada) **não estão cobertas no MVP** — fica como item conhecido em ADRs futuros; o sistema deve detectar e sinalizar, mas pular a publicação automática nesse caso

**Regras de detecção:**

```
Para cada PAI da planilha (codigo_pai onde PAI=0):
  Se existe registro em `familias` com user_id + codigo_pai + ml_item_id NOT NULL:
    → operação = UPDATE (atualiza preço e estoque das variacoes)
    → IA, concorrência e geração de copy são pulados
  Senão:
    → operação = CREATE (pipeline completo)
```

**Como reverter:**
- Decisão é só de comportamento — sempre possível desligar a detecção e tratar tudo como CREATE
- Migrar para Opção D no futuro não invalida a Opção C (podem coexistir)
