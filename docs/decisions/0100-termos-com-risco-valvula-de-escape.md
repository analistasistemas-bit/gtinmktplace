# ADR-0100 — `termos_com_risco`: válvula de escape para termo não comprovado

**Status:** Aceito
**Data:** 2026-08-04
**Decisores:** Diego
**Relaciona:** estende [ADR-0099](0099-titulo-padrao-mercado-livre.md) (contrato de dez slots);
mesma causa raiz do [ADR-0098](0098-copy-ancorada-na-fonte-e-persuasiva.md) (Causa C — exemplo
few-shot vence regra declarada); [ADR-0030](0030-reprocessamento-de-familia-em-erro.md)
(`gerarCopy` é a única etapa de IA sem fallback resiliente); [ADR-0074](0074-selecao-de-modelo-ia-por-organizacao.md)
(modelo por organização)

## Contexto

Um documento externo de especificação de títulos para marketplaces foi avaliado contra o pipeline
atual (análise completa em `docs/spikes/titulo-spec-marketplace-gap.md`). O sistema já implementava
~85% dele, e o censo do catálogo (305 famílias, `scripts/censo-titulo/`) **rejeitou por
inexistência** quase todo o resto: `2x10ml` existe em 1 família, `SORT`/`PAD`/`PC` isolados em
zero, e a gramatura já chega canônica da fonte.

Sobrou um único mecanismo com valor: **`termos_com_risco`**.

O problema que ele resolve é conhecido e está no ADR-0099. Quando o modelo "sabe" um termo comum da
categoria mas não comprovado na fonte — `HB` para um lápis `Nº 2`, `Escolar` para material escolar —
ele não tem onde colocá-lo. O contrato de dez slots é fechado (`additionalProperties: false`), então
o termo ou é omitido ou é **contrabandeado para dentro de um slot legítimo** (`modelo: "HB Nº 2"`,
`produto: "Lápis Escolar"`). `validarSlotsAncorados` derruba boa parte, mas derruba **em silêncio** e
só o que consegue reconhecer.

## Decisão

### 1. Um 11º campo, irmão de `titulo_slots` — nunca dentro dele

`termos_com_risco: string[]` entra no `SCHEMA_COPY` no **nível raiz**, ao lado de `descricao` e
`tipo_produto_busca`. **Não** entra em `titulo_slots`.

Essa posição é a garantia, não uma promessa: `PROPRIEDADES_SLOTS` é derivado de `ORDEM_LEITURA`, e
`posProcessarTitulo` só recebe `TituloSlots`. Um campo fora dessa estrutura é **estruturalmente
incapaz** de chegar ao título — não existe caminho de código que o renderize. Se ele morasse dentro
de `titulo_slots`, seria mais um slot renderizável, e a Causa C voltaria pela porta do schema, que é
exatamente o que o `additionalProperties: false` do ADR-0099 existe para impedir.

### 2. A instrução no prompt é o mecanismo — o schema sozinho não faz nada

T8 em `copywriter-prompt.ts`, com **exemplo trabalhado**, não só regra declarada. O achado central do
ADR-0098 é que exemplo few-shot vence regra declarada; um campo no schema sem exemplo de uso é uma
regra declarada.

### 3. Coerção defensiva e **limitada**

`coagirTermosComRisco` descarta não-string, faz `trim`, remove vazios, deduplica e **corta em 10
termos**. Diferente de `coagirSlots` — que itera uma lista fixa de chaves e é limitado por construção
—, um array é ilimitado: um modelo que interprete T8 mal pode devolver 40 termos, e isso iria para
log a cada família.

### 4. Sem persistência nesta entrega

O campo **não** é gravado no banco. A metade "censo" (persistir o que foi descartado para medir
frequência) exige migration e fica para quando houver demanda medida. Consequência assumida e
declarada: o efeito de T8 — menos contrabando dentro de `produto`/`modelo` — **não é mensurável**
com o que está sendo entregue. O `console.warn` serve a diagnóstico pontual, não a censo: log de
edge function tem retenção curta e não é consultável em massa. O censo de 143 títulos que originou o
ADR-0099 só foi possível porque `titulo_ml` persiste.

### 5. Termo que aparece nos dois lugares não é cruzado

Se o modelo devolver `HB` em `termos_com_risco` **e** dentro de um slot, nenhuma verificação cruzada
é feita: `validarSlotsAncorados` já derruba o que não tem respaldo na fonte. Registrado aqui para que
a checagem não seja adicionada depois como se fosse uma lacuna.

## Consequências

**Muda:**

- O contrato de saída do `gerarCopy` ganha um campo. `OutputCopy.termos_com_risco` existe sempre
  (`[]` quando não há nada), então nenhum dos três call sites precisa mudar.
- Quando o modelo declara termos, sai um `console.warn` com a família e a lista.

**Não muda:**

- Nenhum título. O campo não é renderizável por construção (Decisão 1), e os dez slots seguem
  idênticos.
- Nenhum anúncio publicado — título só é enviado no CREATE, e `atualizarItemML` nunca manda `title`.

**Risco principal — o único modo de falha em runtime:** `SCHEMA_COPY` usa `strict: true`, e o modelo
é escolhido por organização (ADR-0074). Se algum provider rejeitar `{type: 'array', items: {type:
'string'}}` num schema strict, a chamada falha — e `gerarCopy` não tem fallback resiliente
(ADR-0030), então a família cai em erro. Mitigação: a coerção tolera qualquer formato de resposta, e
o campo foi validado contra a API real antes do merge (ver seção seguinte). Se um provider novo
recusar, o sintoma é imediato e a reversão é de uma linha.

## Validação contra a API real — inclusive o resultado negativo

Duas perguntas, ambas respondidas contra o OpenRouter com `openai/gpt-4.1-mini` (padrão do PubliAI):

**1. O schema `strict` aceita array? SIM.** HTTP 200 nas quatro chamadas. O risco principal desta
entrega está descartado empiricamente, não por suposição.

**2. O T8 muda o comportamento do modelo? NÃO DEMONSTRADO.** A/B com o mesmo input, um braço com o
SYSTEM sem T8 + schema antigo, outro com T8 + schema novo:

| Caso | Sem T8 | Com T8 |
|---|---|---|
| Lápis `N.2` (termo inferível: "HB", "Escolar") | `modelo="N.2"`, sem HB | `modelo="Nº 2"`, sem HB, `termos=[]` |
| Cartucho HP 667, fonte sem impressora (pressão para inventar compatibilidade) | `compatibilidade=""` | `compatibilidade=""`, `termos=[]` |

**Em nenhum dos dois casos houve contrabando para derrubar.** O prompt atual (T1–T7, com a regra de
ancoragem) já basta para este modelo não inventar. A válvula não foi exercitada porque não houve
pressão que a exigisse.

**Por que a mudança fica, mesmo assim** — e a decisão é explicitamente do operador:

- O modelo é escolhido **por organização** (ADR-0074). O A/B cobriu um modelo; uma org com modelo
  mais fraco é exatamente onde o contrabando apareceria, e é onde a válvula pagaria.
- O custo é baixo e medido: o bloco T8 adiciona **909 caracteres** ao SYSTEM (14.673 contra 13.764),
  algo em torno de 230 tokens por chamada de copy, mais um campo inerte quando vazio.
- Dois casos não são evidência de ausência de efeito. O defeito que originou o ADR-0099 só apareceu
  num censo de 143 títulos — dois testes não teriam encontrado 35% de cauda vazia tampouco.

**O que NÃO se pode afirmar:** que esta mudança melhora os títulos hoje, com o modelo padrão. Não
melhora nenhum dos casos medidos. É uma trava preventiva com custo baixo, não uma correção de
defeito observado. Se a preferência for YAGNI estrito, a reversão é de uma linha e nada depende do
campo.

## Adendo (2026-08-04) — a Decisão 4 é revista: medir sem persistir

A Decisão 4 adiou a metade "censo" para "quando houver demanda medida", assumindo que medir exigia
persistir. **Isso estava errado, e o próprio censo do catálogo mostrou por quê:** houve **7 CREATEs
em dois dias**. Uma coluna nova no banco só acumula dado em anúncio novo — levaria meses para juntar
amostra com esse ritmo, enquanto a pergunta pode ser respondida **hoje**, sobre as 305 famílias já
existentes, rodando o pipeline offline sobre elas.

Persistência não é o caminho mais barato para a medição; é o **mais lento**. Fica descartada como
pré-requisito. Se o resultado justificar acompanhamento contínuo, aí sim vira migration — com
demanda de fato medida, que era o espírito da Decisão 4.

O que a medição offline faz: para cada família, gera os slots com o prompt de produção e compara
`aplicarGuardsTitulo` (antes) com `validarSlotsAncorados` (depois). O diff **é** o descarte — sem
mudar a assinatura de nenhuma função e sem tocar em call site, porque `posProcessarTitulo` já tem
os dois lados em mãos. Nenhuma escrita no banco.

### Critério de interpretação — registrado ANTES de ver os números

Para que o enquadramento não seja escolhido depois do resultado:

- **Se `validarSlotsAncorados` derrubar termo em fração relevante das famílias:** o contrabando
  existe, o T8 tem alvo real, e a persistência passa a se justificar para acompanhar a frequência.
- **Se o descarte for próximo de zero:** o resultado é o mesmo do A/B — não há contrabando a pegar
  com este modelo. A conclusão honesta é que **o ADR-0100 está sem exercício**, e a reversão
  (seção "Como reverter") volta a ser opção viva, não uma nota de rodapé.
- **Se a IA preencher `termos_com_risco` com frequência sensível** enquanto os guards derrubam
  pouco: o T8 está funcionando como válvula — capturando na origem o que antes seria contrabandeado
  — e essa é a evidência de efeito que o A/B de dois casos não conseguiu produzir.

Zero é um resultado, não uma falha da medição.

## Como reverter

Remover `termos_com_risco` de `properties` e `required` em `SCHEMA_COPY`, remover T8 do prompt e
apagar `coagirTermosComRisco` e seu uso. Nada mais depende do campo — nenhum título muda em nenhuma
das duas direções.
