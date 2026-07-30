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
valores, então aceitar sem checar publicaria valores não pretendidos.

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

## Fora de escopo (registrado, não bloqueia)

- Array multi-valor completo para atributos `multivalued`.
- Teto de quantidade de alvos por categoria com muitos atributos opcionais — medir primeiro com o
  teste golden (abaixo) antes de decidir se é necessário.
- Selo "preenchido por IA" na tela de Revisão (já previsto na ADR-0026 §E4-UI, UI separada).

## Verificação antes de implementar

Checar se o reprocessamento de uma família **já publicada** manda atributos novos direto num
`UPDATE` pro ML sem passar pela Revisão humana. Se sim, decidir nesta fase se as regras novas
tocam só famílias ainda não publicadas, ou se o UPDATE de atributos já é coberto pela revisão
existente.

## Testes

Em `_shared/ai/__tests__/atributos-llm.test.ts`:

1. Tokenizer: `"ALGODÃO."` casa `"algodão"`; contiguidade não atravessa `.`/`;`/`:` entre dois
   itens de lista.
2. `atributosAlvo`: `multivalued` passa a entrar; `hidden`/`read_only`/`variation_attribute`
   continuam de fora (guard de regressão do unban seletivo).
3. String opcional sem `values[]` entra; um `value_type` desconhecido não entra.
4. Guard número+unidade: texto com "224 metros" rejeita resposta `UNIT_WEIGHT: "224 g"` e aceita
   `LENGTH: "224 m"`.
5. Denylist regulatório: atributo com id `ANVISA_REGISTRATION` (string, sem values, opcional) não
   vira alvo mesmo com número no texto.
6. Valor multivalued com vírgula é rejeitado.
7. Teste golden com fixture do schema real de `MLB270273`: conta quantos atributos viram alvo e
   quantos preenchem antes/depois da mudança, usando a descrição real da família investigada —
   é a métrica que motivou a mudança e vira guard de regressão.

A suíte existente (`atributos.test.ts`, `atributos-llm.test.ts`) deve continuar passando sem
mudança de comportamento para categorias de aviamento (regressão zero, conforme ADR-0026).
