# Cobertura máxima de atributos ML sem inventar dado

## Contexto

Comparando o preenchimento automático de atributos do PubliAI com o botão nativo "Sugerir
características" do Mercado Livre, o segundo preenche bem mais campos (Composição, Usos
recomendados, Linha, Comprimento) para o mesmo produto. Investigação com dado real (família
`c1fb33e4-...`, categoria `MLB270273` "Fios e Cadarços", schema real da API ML) achou 4 causas
de código/prompt, não falta de informação — o texto da planilha já tem os dados
("COMPOSIÇÃO: 100% ALGODÃO.", "224 METROS CADA"), mas nosso pipeline não chega a usá-los.

Restrição inegociável (Diego): pode preencher o máximo possível, **nunca pode inventar** um valor
que não esteja no texto do produto.

## Causas e correções

Arquivo principal: `supabase/functions/_shared/ai/atributos-llm-core.ts`.

### 1. Tokenizer do guard anti-invenção falha por pontuação colada

`tokens()` faz `normalizar(s).split(/\s+/)`. "100% ALGODÃO." vira token `"algodao."` (ponto
colado) e nunca bate contra a resposta limpa da IA `"algodão"`. Isso vale tanto pra checagem de
`validarTextoLivre` quanto pra qualquer combinação de valor onde o texto-fonte tem pontuação
grudada na palavra (muito comum em descrição de planilha).

**Correção:** tokenizar por regex de letra/número (`\p{L}+|\p{N}+`, aplicada **depois** de
`normalizar()`, que já tira acento) em vez de `split` por espaço. Contiguidade multi-palavra
(`validarTextoLivre`) passa a ser checada **dentro do mesmo segmento** de pontuação forte
(`. ; : |`) — sem isso, "ALGODÃO. POLIÉSTER" (dois itens de lista) passaria a casar como valor
único "algodão poliéster", o que é uma regressão nova introduzida pelo próprio fix.

### 2. Atributos `multivalued` são banidos do alvo da IA

`TAGS_EXCLUIR` inclui `multivalued` — atributos como `COMPOSITION` e `RECOMMENDED_USES` (que a ML
permite preencher com mais de um valor) nunca viram alvo, mesmo quando o valor está óbvio no
texto.

**Correção (escopo reduzido, fase 1):** tirar `multivalued` do `TAGS_EXCLUIR` usado pelo filtro de
alvos da IA (`atributosAlvo`), mantendo-o em `TAGS_NAO_FALTANTE` (o gate de obrigatórios não pode
travar por um multivalued que o editor manual ainda não mostra — comentário cruzado nos dois
arquivos explicando a divergência proposital, pra não ser "corrigida" de volta por engano depois).
A IA preenche **um único valor** por atributo multivalued (o melhor extraído do texto) — **não**
implementa array multi-valor completo (mudaria o shape de `AtributoML` e o builder do payload de
publicação; adiado, não é hoje o gargalo). Valor validado não pode conter vírgula quando o
atributo é multivalued — a API do ML trata vírgula em `value_name` como separador de múltiplos
valores, então aceitar sem checar publicaria valores não pretendidos. `AtributoAlvo` (interface em
`atributos-llm-core.ts`) ganha um campo `multivalued: boolean` — hoje `tipoAlvo` não distingue isso,
e a checagem de vírgula em `validarRespostaAtributos` precisa saber quais alvos são multivalued.

### 3. Texto-livre opcional sem valores sugeridos é ignorado

ADR-0052 restringe a inferência de texto-livre a atributos **obrigatórios**. Atributos como `LINE`
("Linha": `value_type=string`, sem `values[]`, não obrigatório) nunca são tentados, mesmo com o
valor claro no texto.

**Correção (adendo à ADR-0052):** também tentar quando `valueType === 'string'` (checagem
explícita — não "não é numérico e não tem lista", pra não capturar um `value_type` futuro/desconhecido
da API tratado como string por acidente em `parseAtributosSchema`) e sem `values[]`. Exclui
atributos cujo `id` bate um padrão de regulatório/certificação
(`REGISTRATION|CERTIF|ANVISA|ANATEL|INMETRO|LICENSE`) — evita a IA copiar um número qualquer do
texto pra um campo de compliance só porque "está lá".

### 4. Confusão semântica entre atributos numéricos (`number_unit`)

O guard hoje (`numeroConstaNoTexto`) só verifica se o número aparece em qualquer lugar do
texto — não se a **unidade** bate com o contexto. Isso deixou "224 metros" (do texto) virar
resposta da IA pra `UNIT_WEIGHT: "224 g"` em vez de `LENGTH: "224 m"`: o guard aceitou porque 224
está no texto, sem checar que "224" ali está colado a "metros", não a "g"/"kg".

**Correção:** pra atributos `number_unit`, extrair do texto os pares número+unidade adjacentes
(regex tipo `(\d+(?:[.,]\d+)?)\s*([a-zà-ú"]+)`) e só aceitar a resposta da IA se a unidade dela
bater com uma unidade encontrada **junto** daquele mesmo número no texto — não com qualquer número
solto. É um guard de código, não só uma instrução de prompt (mais confiável que só pedir educadamente
pro modelo não confundir). O prompt (`montarPromptAtributos`) ganha uma linha extra pedindo pra
não reciclar o mesmo número em atributos diferentes, como reforço, não como única defesa.

O `allowedUnits` do schema vem abreviado (`m`, `cm`, `mm`, `"`), mas o texto da planilha costuma
usar a palavra por extenso ("224 **METROS**"). Comparar direto (`normalizar(unidadeDoTexto) ===
normalizar(unidadeDoSchema)`) falharia sempre. Precisa de uma tabela pequena e curada de sinônimo →
id do schema, escopo limitado às unidades já observadas nas categorias do domínio (comprimento:
metro/metros/m, centímetro/centímetros/cm, milímetro/milímetros/mm, polegada/polegadas/"; peso:
grama/gramas/g, quilo/quilos/quilograma/quilogramas/kg) — cresce sob demanda se aparecer uma
unidade nova, não tenta cobrir o sistema métrico inteiro de saída. Unidade do texto que não bate
nenhum sinônimo conhecido → atributo fica de fora (comportamento atual, não trava, não inventa).

## Fora de escopo (registrado, não bloqueia)

- Array multi-valor completo para atributos `multivalued`.
- Teto de quantidade de alvos por categoria com muitos atributos opcionais — medir primeiro com o
  teste golden (abaixo) antes de decidir se é necessário.
- Selo "preenchido por IA" na tela de Revisão (já previsto na ADR-0026 §E4-UI, UI separada).

## Verificação feita: reprocessamento não pula a revisão humana

Checado: `process-familia` (onde a resolução de atributos roda) nunca escreve na ML sozinho — ele
só resolve dados e marca a família `pronto` (`revisao` é status do **lote**, promovido por trigger
de banco quando todas as famílias terminam). A escrita real na ML (`publish-familia-ml`/
`update-familia-ml`) só é enfileirada por `publicar-familias`, chamada explicitamente pelo
frontend (`src/lib/publicar.ts:publicarFamilias`) quando o operador seleciona famílias na Revisão e
clica publicar/atualizar. O caminho `operacao === 'UPDATE'` parcial (`process-familia/index.ts:193`,
adição de variação nova a um anúncio já publicado) nem chega a rodar a resolução de atributos —
retorna antes, só resolve cor. Logo: as correções desta fase valem tanto pra família nova quanto pra
reprocessamento de família ainda não publicada, sem risco de pular a revisão — o gate humano já
existe e cobre os dois casos. Sem restrição de escopo adicional.

## Testes

Em `_shared/ai/__tests__/atributos-llm.test.ts`:

1. Tokenizer: `"ALGODÃO."` casa `"algodão"`; contiguidade não atravessa `.`/`;`/`:` entre dois
   itens de lista.
2. `atributosAlvo`: `multivalued` passa a entrar; `hidden`/`read_only`/`variation_attribute`
   continuam de fora (guard de regressão do unban seletivo).
3. String opcional sem `values[]` entra; um `value_type` desconhecido não entra.
4. Guard número+unidade: texto com "224 metros" rejeita resposta `UNIT_WEIGHT: "224 g"` e aceita
   `LENGTH: "224 m"` (valida a tabela de sinônimo metro→m). Unidade do texto fora da tabela de
   sinônimos (ex.: "224 braças") não valida nenhum atributo — fica de fora, não trava.
5. Denylist regulatório: atributo com id `ANVISA_REGISTRATION` (string, sem values, opcional) não
   vira alvo mesmo com número no texto.
6. Valor multivalued com vírgula é rejeitado.
7. Teste golden com fixture do schema real de `MLB270273`: conta quantos atributos viram alvo e
   quantos preenchem antes/depois da mudança, usando a descrição real da família investigada —
   é a métrica que motivou a mudança e vira guard de regressão. Fixture nova (não existe ainda):
   JSON capturado nesta investigação (`curl .../categories/MLB270273/attributes`) salvo em
   `__tests__/fixtures/schema-mlb270273.json`, junto com nome/descrição reais da família
   `c1fb33e4-...` como input — sem chamada de rede no teste.

A suíte existente (`atributos.test.ts`, `atributos-llm.test.ts`) deve continuar passando sem
mudança de comportamento para categorias de aviamento (regressão zero, conforme ADR-0026).

## Entrega

O adendo à ADR-0052 (já escrito, ver seção "Causas e correções" acima) e este spec são a
documentação da mudança arquitetural — regra do projeto (CLAUDE.md) exige `docs/` em dia no mesmo
commit da entrega. Este código não altera schema de dados, edge functions expostas nem glossário de
domínio, então não há outro arquivo de `docs/reference/`a atualizar além do ADR.
