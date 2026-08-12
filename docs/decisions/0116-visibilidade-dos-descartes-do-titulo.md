# ADR-0116 — Visibilidade do que o pipeline de título descarta

**Status:** Aceito
**Data:** 2026-08-12
**Decisores:** Diego
**Relacionado:** ADR-0099 (contrato de dez slots); ADR-0100 (`termos_com_risco` — a metade A desta mesma ideia); ADR-0115 (eixo de variação); spike `titulo-spec-marketplace-gap.md` (04/08, que nomeou isto como "a única pergunta aberta")

## Contexto

Investigando em 2026-08-12 por que "Natal" havia sumido de um título, dois obstáculos apareceram
— nenhum deles no código do título propriamente dito.

**1. Não dava para saber quem escreveu um título.** As famílias de 29/07 e 12/08 apareciam ambas
com `titulo_editado_pelo_operador = true, editado_em = null`. A coluna `editado_em` existe, mas
`updateFamiliaTitulo` e `updateFamiliaDescricao` (`src/lib/queries.ts`) — as duas únicas escritas
de edição manual do sistema — gravavam a flag e nunca a data. A causa raiz teve de ser inferida
por pistas indiretas (a palavra "Exclusivo" que `removerMarketingNaoAncorado` teria removido;
"Mesa Painel" ausente do `nome_pai` e da `descricao_pai`).

**2. Ninguém sabe o que o pipeline descarta.** `validarSlotsAncorados` derruba marca, sinônimo e
marketing não-ancorado; `montarTitulo` corta slots inteiros ao estourar 60 caracteres. Tudo em
silêncio. O spike de 04/08 registrou isso como a única pergunta em aberto, e ela bloqueia as
outras: sem saber o que se perde hoje, discutir prioridade dinâmica de termos ou endurecer um
guard é opinião, porque não há como responder "quantos títulos isto afetaria?".

## Decisão

### 1. `editado_em` é gravado junto com a flag

Três linhas em `src/lib/queries.ts`, nas duas funções de edição manual. A flag diz *que* houve
edição; a data diz *quando* — e é a data que permite cruzar com `criado_em` e separar "a IA gerou
assim" de "o operador reescreveu dois minutos depois".

### 2. `familias.titulo_descartes` (jsonb)

`diagnosticarTitulo` (`_shared/ai/titulo-pos.ts`) roda o mesmo pipeline de `posProcessarTitulo` e
devolve, além do título, a lista do que cada etapa alterou ou removeu:

```json
[{"slot":"marca","etapa":"ancoragem","de":"Inventada","para":""}]
```

`posProcessarTitulo` passa a ser um wrapper de uma linha sobre ele, então os três call sites
existentes não mudam de contrato e não há um segundo pipeline para divergir do primeiro — que é
exatamente o defeito que o ADR-0099 corrigiu ao centralizar o pós-processamento.

Quatro etapas: `normalizacao`, `guards`, `ancoragem`, `corte`. As três primeiras comparam valores
antes e depois; **`corte` compara por presença**, porque `montarTitulo` não reescreve slot — ele
remove o slot inteiro. Para obter essa lista sem adivinhar por substring no texto final,
`montarTitulo` ganhou uma irmã `montarTituloDetalhado` que devolve os slots sobreviventes.

**Reescrita é registrada junto com descarte**, distinguidas por `para`: `""` é descarte total,
qualquer outro valor é reescrita. Registrar as duas é deliberado — a diferença entre "o guard
apagou" e "o guard corrigiu" é justamente o que se quer medir.

`NULL` na coluna significa família anterior ao diagnóstico; `[]` significa processada sem nenhum
descarte. Anulável e sem default para preservar essa distinção.

**É diagnóstico, não controle de fluxo.** Nenhuma decisão do pipeline lê a coluna. Se ela deixasse
de ser preenchida amanhã, nenhum título mudaria.

### 3. Guard de termos promocionais isolados — REJEITADO por censo

A revisão da especificação do operador (Fable, 12/08) apontou que `ADJETIVOS_VAZIOS` casa o
**slot inteiro**: mata `variacao="Premium"`, mas não `produto="Tecido Premium Oxford"`. "Top",
"Super", "Qualidade", "Excelente", "Profissional" dentro de um slot maior teriam só o prompt.

O censo, rodado antes de escrever qualquer código:

| Termo | Em títulos não editados | Ancorado na fonte |
|---|---|---|
| `qualidade` | 6 | 6 |
| `profissional` | 1 | 1 |
| `top`, `super`, `excelente`, `oferta`, `promocao`, `imperdivel`, `original`, `exclusivo` | **0** | — |

Os 7 casos **têm `|` no título** — são do formato anterior ao ADR-0099, nenhum saiu do pipeline de
slots. E todos os 7 estão ancorados na fonte, então o mecanismo proposto (remoção por token
condicional à fonte, como `MARKETING_TERMOS`) não os removeria de qualquer modo.

Contexto de amostra, que é o que impede a conclusão oposta: há **304 famílias pré-slots contra 6
pós-slots** (4 não editadas). Zero ocorrências em 4 famílias não prova ausência. Portanto o censo
**não** conclui "o defeito não existe" — conclui que **não há evidência de defeito e não há
amostra para decidir**, e guard destrutivo nessas condições é risco puro, exatamente o que o
spike de 04/08 estabeleceu.

**Gatilho para reavaliar:** ~50 famílias geradas pelo pipeline de slots. A decisão 2 acima é o que
torna essa reavaliação barata — em vez de um censo por regex sobre o texto final, bastará agregar
`titulo_descartes`.

## Consequências

- Toda família nova passa a registrar o que o pipeline descartou. Famílias antigas ficam `NULL`.
- A pergunta "quantos títulos este guard afetaria?" passa a ter resposta por `SELECT`.
- Edição manual de título ou descrição passa a ser datável.
- Custo: uma coluna jsonb por família, escrita uma vez na geração. Sem índice — o uso é censo
  esporádico, não consulta de caminho quente.
- Nenhum efeito sobre anúncio publicado: `title` não é reenviado no UPDATE, e a coluna é inerte.

## Não decidido aqui

Prioridade dinâmica de termos e ordem por categoria (spike 04/08) seguem diferidas. Este ADR
entrega o instrumento de medição que aquela decisão exigiria, não a decisão.
