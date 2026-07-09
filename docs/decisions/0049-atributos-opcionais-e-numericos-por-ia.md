# ADR-0049 — Enriquecimento de atributos opcionais e numéricos por IA (nota de qualidade do anúncio)

**Data:** 2026-06-29
**Status:** aceito (implementado na branch `worktree-feat-atributos-completos-ml`, aguardando validação)
**Decisores:** Diego
**Relaciona:** estende [ADR-0026](0026-generalizacao-categorizacao-atributos-por-ia.md) (E4 — atributos por IA closed-set) e [ADR-0009](0009-campos-payload-ml-e-categoria-deterministica.md) (atributos determinísticos por tipo)

## Contexto

Anúncios de aviamentos publicavam só os atributos **obrigatórios** (ex.: fita → `BRAND` +
`RIBBON_TYPE`). O ML então marca a qualidade do anúncio como "ruim" ("Corrija as características
para receber menos perguntas e devoluções"), porque campos relevantes como *Formato da fita*,
*Comprimento* e *Largura* ficam vazios.

Causa: aviamentos caem no caminho **determinístico (regex)** do `process-familia`, que chamava
apenas `montarAtributosML()` (obrigatórios hard-coded) e **não consultava o schema da categoria**
nem o preenchimento por IA. O ADR-0026 (E4) previa explicitamente "aviamentos seguem 100%
determinísticos"; este ADR revisa isso: o determinístico continua sendo a **base com prioridade**,
mas passa a ser **enriquecido**.

## Decisão

No `process-familia`, o caminho regex passa a, **após** montar os obrigatórios curados, ler o
schema da categoria (`lerSchemaAtributos`) e preencher os **atributos adicionais** reusando a
infraestrutura do E4 — sem sobrescrever os curados, validando contra o schema oficial e **nunca
inventando**.

Escopo do preenchimento (decidido com Diego, 2026-06-29):

1. **Closed-set (lista de valores), obrigatórios e opcionais** — a IA escolhe um `value_id`
   dentro de `values[]` (ex.: *Formato da fita* = Rolo). Era restrito a obrigatórios; agora cobre
   opcionais também.
2. **Numéricos (`number`/`number_unit`)** — a IA extrai número (+ unidade permitida em
   `allowed_units`) **só se claro no título/descrição** (ex.: *Comprimento* = 2500 cm). Unidade
   ausente ou fora da lista → atributo omitido (não chuta unidade).
3. **Texto livre (`string`, ex.: `MODEL`) fica de fora** — risco alto de invenção; não entra.

Atributos resolvidos fora da IA permanecem excluídos: `GTIN`/`EMPTY_GTIN_REASON` (por variação na
publicação), `COLOR` (atributo de variação, vem de `variacoes.cor`) e `UNITS_PER_PACK` (extrator de
regex dedicado, `preencherUnitsPerPack`).

## Implementação

- `_shared/categoria/schema.ts` — `AtributoSchema` ganha `valueType` e `allowedUnits` (lidos de
  `value_type`/`allowed_units` da API, antes ignorados).
- `_shared/ai/atributos-llm-core.ts` — `atributosAlvo` passa a incluir closed-set opcionais e
  numéricos (e ignora `COLOR`/`UNITS_PER_PACK`); `validarRespostaAtributos` valida números
  (+ unidade); `montarPromptAtributos` descreve o formato numérico esperado.
- `process-familia/index.ts` — ramo `origem === 'regex'` enriquece com `preencherAtributosClosedSet`
  + `preencherUnitsPerPack`. Resiliente: falha de schema/rede → mantém só os obrigatórios curados
  (comportamento anterior).

## Consequências

- Anúncios saem com mais características preenchidas → melhor nota de qualidade e menos
  perguntas/devoluções, sem inventar dado (mantém a regra de ouro do projeto).
- O caminho genérico (não-aviamento) ganha os numéricos "de graça" (mesma função).
- Custo de IA: o ramo regex passa a fazer 1 chamada extra ao LLM quando há atributo a preencher;
  zero chamada quando não há alvo.
- Revisão humana segue como gate final (atributo sugerido por IA é confirmável na Revisão).

## Adendo — 2026-07-09: grounding numérico nunca foi implementado (lote #30)

A decisão 2 dizia "só se claro no título/descrição", mas a validação (`validarNumerico` em
`atributos-llm-core.ts`) checava só **formato** (número + unidade permitida), sem checar se o
número constava no texto — diferente do texto-livre, que já tem essa trava desde o
[ADR-0052](0052-camada2-atributos-ia-first-com-fallback.md). Resultado: a IA podia "chutar" um
número plausível para um atributo numérico opcional sem lastro no produto. Caso real: família do
lote #30 (tecido, peso real 660g na planilha) publicou com o atributo de categoria `WEIGHT` (ficha
técnica do item, distinto de `SELLER_PACKAGE_WEIGHT`/frete) em "120 g" — a IA inventou um peso
plausível de tecido leve porque o título/descrição não mencionava peso nenhum.

Fix: `validarRespostaAtributos` (numero) agora exige que o número extraído conste no
`nome`/`descricao` (mesma invariante do texto-livre, tolerância de ponto flutuante para
vírgula/ponto decimal). Fecha a lacuna para **todo** atributo numérico opcional, não só `WEIGHT`.
Correção do item já publicado (MLB7132904138) fica para o fluxo normal de reprocessamento —
fora de escopo deste ADR.
