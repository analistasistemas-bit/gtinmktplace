# Sugestão de categoria pela ficha de catálogo (pré-publicação)

**Data:** 2026-08-22
**Status:** Aprovado (design); revisão técnica 2026-08-22 — contratos de API confirmados com token
real, `esperado` pré-publicação definido, card do catálogo lê da row (sem `atributos-familia`),
3ª coluna p/ nº de vendedores
**Relacionado:** [ADR-0021](../../decisions/0021-vinculacao-automatica-ao-catalogo-ml.md) (trava `fichaEquivalente`, opt-in),
[ADR-0036](../../decisions/0036-alerta-catalogo-no-match.md) (alerta Telegram `ficha_divergente`),
[ADR-0057](../../decisions/0057-categoria-selecao-livre-e-sugestao-concorrente.md) (padrão de sugestão não-vinculante que este design estende),
[ADR-0054](../../decisions/0054-categoria-titulo-tipo-produto-generico.md) (Fase 2 rejeitada: por que a categoria do concorrente/catálogo nunca pode ser aplicada sozinha),
`_shared/ml/catalogo.ts`, `process-familia/index.ts`, `card-categoria.tsx`, `vincular-catalogo/index.ts`

---

## Problema

A categoria de um anúncio é decidida em `process-familia` (`resolverCategoria`, `_shared/categoria/resolver.ts`)
sem olhar o catálogo do Mercado Livre. O catálogo só entra em cena depois de publicado, no worker
`vincular-catalogo`, que grava `catalog_status='ficha_divergente'` quando a ficha do GTIN vive num
domínio diferente do domínio da categoria escolhida — nesse ponto o anúncio já nasceu na categoria
errada, e trocar a categoria de um item **já ativo** é proibido no projeto (risco de re-moderação;
ver "O que NÃO muda").

## Caso real que motivou (lote 21, 2026-08-22)

Família Eucerin Aquaphor 55ml (GTIN `4005800223136`) foi publicada na categoria "Bebês > Higiene e
Cuidados com o Bebê > Cremes, Pomadas e Óleos" (`MLB277750`, domínio `MLB-BABY_CREAMS_AND_OINTMENTS`).
O GTIN só tem **uma** ficha em todo o catálogo do ML — `MLB19462147`, domínio
`MLB-BODY_SKIN_CARE_PRODUCTS` (7 vendedores competindo, R$77–144). O preditor de categoria
(`domain_discovery`) nem cogitou o domínio corporal para esse produto. Resultado: `ficha_divergente`,
sem competir no catálogo, só descoberto pelo Diego depois de publicado — precisou de uma
republicação manual (pausar → trocar categoria no banco → republicar) para corrigir.

## Decisão

Estender o padrão já em produção do ADR-0057 (sugestão do concorrente: coluna persistida + card
clicável não-vinculante em `CardCategoria`) para uma segunda fonte de sugestão: a categoria cujo
domínio bate com a ficha de catálogo real do GTIN, quando ela diverge da categoria escolhida.
**Nunca aplicada automaticamente** — mesmo racional do ADR-0054 Fase 2 (aplicar categoria de
terceiro sem confirmação humana já produziu categorização errada por colisão de GTIN/ficha).

### Componentes

**1. `process-familia` — nova etapa best-effort, depois de `resolverCategoria` E de `atributosMl`
calculados (o `esperado` da trava anti-kit lê `atributosMl`, ver abaixo), persistindo no mesmo
UPDATE final que já grava `concorrencia_categoria_id` (`index.ts:488-511`):**

- Só roda no fluxo CREATE (o early-return do UPDATE parcial em `index.ts:195` fica antes — de
  propósito: categoria de anúncio publicado não pode mudar, sugerir troca ali seria convite ao
  incidente reverso). Usa o GTIN da variação principal — `variacao_principal_codigo` com fallback à
  1ª variação, mesmo idioma de `publicar-split-ml/index.ts:328` — validado pelo guard `gtinAusente`
  já embutido em `buscarProdutoCatalogoPorGtin`. Sem GTIN válido nela → sem sugestão (1 chamada só;
  cores irmãs da mesma família vivem no mesmo domínio de catálogo).
- Busca a ficha via `buscarProdutoCatalogoPorGtin` (`_shared/ml/catalogo.ts:276`, já existe, usada
  hoje só pelo `vincular-catalogo`).
- Filtra pela trava anti-kit já existente `fichaEquivalente` (`catalogo.ts:154`) — só considera ficha
  aprovada (kit/metragem divergente continua sem gerar sugestão nenhuma, igual hoje). **`esperado`
  pré-publicação** (não há item ML ainda, então `buscarEsperadoDoItem` não se aplica): montado de
  `atributosMl` já calculado no próprio `process-familia` — `UNITS_PER_PACK`/`SALE_FORMAT` quando
  presentes, `lengthM` via `normalizarComprimentoMetros(LENGTH)`; ausentes → mesmo modo degradado
  que o `vincular-catalogo` usa quando `buscarEsperadoDoItem` falha (assume 1 unidade avulsa).
  **`esperado.domainId` fica deliberadamente vazio**: a divergência de domínio é exatamente o sinal
  que gera a sugestão — preenchê-lo faria `fichaEquivalente` reprovar e suprimir a sugestão sempre.
- Resolve o domínio da categoria que o resolver acabou de escolher. **Novo helper**
  `buscarDominioCategoria(token, categoriaMlId)` em `domain-discovery.ts` (espelho de
  `buscarNomeCategoria`: guard `ehCategoriaMlValida` anti-SSRF, cache Redis `catdom:{id}` TTL 30d).
  **Contrato confirmado com token real (2026-08-22):** `GET /categories/{id}` →
  `settings.catalog_domain` (probes: `MLB277750` → `MLB-BABY_CREAMS_AND_OINTMENTS`; `MLB1262` →
  `MLB-BODY_SKIN_CARE_PRODUCTS`), mesmo formato do `domain_id` que `/products/search` devolve na
  ficha — comparável por igualdade de string direta.
- Se `ficha.domainId` (já vem no retorno de `buscarProdutoCatalogoPorGtin`) for diferente do domínio
  da categoria escolhida: resolve a categoria real correspondente ao domínio da ficha. **Novo
  helper** `buscarCategoriaFicha(token, fichaId)` em `catalogo.ts` — `GET /products/{fichaId}/items`
  reaproveitando `parseItensProduto` (`_shared/concorrencia/parse.ts`), que já extrai `category_id`
  e conta vendedores. **Contrato confirmado com token real (2026-08-22):** `MLB19462147/items` → 7
  resultados, todos `category_id: "MLB1262"`. Ficha sem nenhum item competindo → sem categoria
  resolvível → sem sugestão. Nome da categoria via `buscarNomeCategoria` (`domain-discovery.ts:89`,
  já existe).
- A decisão "gera sugestão ou não" é função pura (`sugerirCategoriaPorFicha`, em `catalogo.ts`);
  as chamadas de rede ficam na orquestração do `process-familia`.
- Persiste em 3 colunas novas de `familias` (nullable, mesmo padrão de `concorrencia_categoria_id`):
  `catalogo_categoria_sugerida_id`, `catalogo_categoria_sugerida_nome`,
  `catalogo_categoria_sugerida_vendedores` (o rótulo do card cita "N vendedores competindo" — o N
  vem de `parseItensProduto(...).vendedores` e precisa estar persistido para o card não fazer rede).
- Qualquer falha (rede, ficha não encontrada, domínio ausente) → não persiste nada, não lança, não
  afeta o resto do processamento. Mesmo tratamento best-effort do bloco de concorrência hoje.

**2. `card-categoria.tsx` — segundo card de sugestão, renderizado direto da row.** A sugestão do
catálogo **não passa por `atributos-familia`**: id, nome e nº de vendedores já estão persistidos em
`familias`, então o card renderiza direto de `familia.catalogoCategoriaSugerida*` (mapeados em
`familiaFromRow`/`tipos-dominio`), **sem rede e sem o lazy-load-on-focus** — o gate de foco do card
do concorrente existe só para evitar 1 chamada de rede por card, o que aqui não se aplica. Isso
também é o que torna a sugestão visível de fato: com categoria já definida, `BuscaCategoria` só
aparece após "Trocar categoria" + foco, e a divergência ficaria tão escondida quanto hoje. O card
do catálogo aparece no `CardCategoria` sempre que a coluna estiver preenchida e a categoria sugerida
diferir da `categoriaMlId` atual. Rótulo diferencia a origem: "Sugestão (concorrente)" existente
vs. novo "Sugestão (catálogo): N vendedores competindo". Quando as duas sugestões apontam a MESMA
categoria, só o card do catálogo aparece (sinal mais rico; dois cards idênticos é ruído). Clicar
chama o mesmo `escolher()`/`definirCategoriaLivre` já existente (`definir-categoria-familia`,
zero mudança de contrato). `atributos-familia` fica intocada.

**3. `vincular-catalogo` — alerta Telegram enriquecido.** Quando o alerta dispara com
`resumo.ficha_divergente > 0` e a família tiver `catalogo_categoria_sugerida_id` preenchido
(calculado antes, no `process-familia`, então já disponível sem chamada nova — adicionar as colunas
ao select de `index.ts:58`), `montarMensagemCatalogoNoMatch` (`_shared/notificacoes/telegram.ts:46`)
ganha uma linha citando a categoria sugerida. `CatalogoNoMatchAlerta` ganha campo opcional
`categoriaSugerida?: { id: string; nome: string } | null`; call site em
`vincular-catalogo/index.ts:131` passa o valor **só quando `resumo.ficha_divergente > 0`** (nos
motivos de elegibilidade/variation_id a linha seria ruído). Família de UPDATE tem as colunas nulas
(sugestão não roda no UPDATE parcial) → linha simplesmente omitida, comportamento atual.

### O que fica igual

- `resolverCategoria` não muda — a categoria continua decidida do jeito que é hoje; a sugestão é
  só informativa, calculada depois.
- A trava `fichaEquivalente` e o comportamento de opt-in pós-publicação (`vincular-catalogo`) não
  mudam — a sugestão não interfere no fluxo de vinculação automática.
- `definir-categoria-familia` não muda de contrato — a sugestão só alimenta o mesmo fluxo de escolha
  livre que o concorrente já usa.

## Abordagens descartadas

**Decidir a categoria automaticamente pela ficha (sem card).** Alimentar o candidato de catálogo
direto no desempate do `resolverCategoria`. Rejeitado: o ADR-0054 Fase 2 já tentou aplicar a
categoria do concorrente automaticamente e produziu uma categoria absurda por colisão de GTIN
("Brinquedos de Pegadinhas"). "Tem ficha" não é "categoria certa" — o Aquaphor do lote 21 é vendido
majoritariamente para bebês na prática do Diego mesmo a única ficha do GTIN sendo do domínio
corporal; trocar de categoria pra competir no catálogo é decisão comercial (alcance de busca vs.
buy box), não algo que o sistema deve resolver sozinho.

**Só mexer no alerta pós-publicação, sem card pré-publicação.** Mais barato, mas não resolve o
problema de raiz: o operador só saberia depois de já ter publicado errado, tendo que republicar como
aconteceu no lote 21. Descartado — perde o ponto principal do pedido.

**Bloquear publicação até o operador confirmar/dispensar a divergência.** Mais forte que um card
informativo. Descartado nesta rodada (decisão do Diego): mantém o padrão não-vinculante do
ADR-0057, sem fricção nova no fluxo de publicar.

## Dados / migration

Migration aditiva em `familias` (via `supabase migration new`, ADR-0043):

```sql
alter table familias
  add column if not exists catalogo_categoria_sugerida_id text,
  add column if not exists catalogo_categoria_sugerida_nome text,
  add column if not exists catalogo_categoria_sugerida_vendedores integer;
```

Sem alteração em `variacoes`, sem novo enum, sem novo status. Mesmo padrão de baixo risco do
`concorrencia_categoria_id` (ADR-0057, migration `20260704025322`) — nenhuma coluna passa a ser
obrigatória, nenhum fluxo existente lê/escreve menos do que já lê/escreve.

## Testes

Funções puras novas (vitest, padrão de `catalogo.ts`/`resolver.ts`):

- `sugerirCategoriaPorFicha` (a função pura que decide "gera sugestão ou não" a partir de
  `AtributosFicha` + `esperado` + domínio da categoria escolhida + itens da ficha): ficha nula →
  sem sugestão; domínio igual → sem sugestão; ficha reprovada pela trava anti-kit → sem sugestão;
  domínio da ficha ou da categoria ausente → sem sugestão; ficha sem itens competindo → sem
  sugestão; domínio diferente e ficha aprovada → sugestão com id/vendedores; `esperado` montado de
  `atributosMl` nunca carrega `domainId`.
- `buscarDominioCategoria`: parse de `settings.catalog_domain`; resposta sem o campo → null.
- `montarMensagemCatalogoNoMatch` com e sem `categoriaSugerida` — texto muda só quando presente.
- Best-effort no `process-familia`: falha de rede na etapa de sugestão não muda status nem lança
  (mesmo padrão dos testes do bloco de concorrência).
- Frontend (`CardCategoria`): renderiza o card do catálogo direto da row (sem rede) quando as
  colunas vêm preenchidas e a sugestão difere da categoria atual; os dois cards (concorrente +
  catálogo) convivem quando apontam categorias diferentes; mesma categoria → só o do catálogo;
  clique em cada um chama `definirCategoriaLivre` com o `categoriaId`/`categoriaNome` correto da
  fonte clicada.

## Faseamento

Fase única — o volume de código é pequeno (2 helpers novos + 1 função pura, 3 colunas aditivas, 1
card novo, 1 linha a mais no alerta) e as três partes (process-familia, card, alerta) só fazem
sentido juntas. Deploy: `process-familia` e `vincular-catalogo` (as duas funções que tocam as
colunas; `atributos-familia` não muda).

## Consequências

**Boas:**
- Fecha a classe de problema para qualquer produto com ficha de catálogo em domínio diferente da
  categoria escolhida, não só o Aquaphor — sem esperar o operador notar via Telegram e pedir
  investigação de novo.
- Reaproveita quase toda a infraestrutura do ADR-0057 (trava, contrato de sugestão, componente de
  card, fluxo de aplicar) — pouco código genuinamente novo.
- Alerta pós-publicação fica mais acionável (já vem com a categoria alternativa), reduzindo
  investigação manual no caso residual em que a divergência só é percebida depois.

**Tradeoffs aceitos:**
- +2 a 3 chamadas ao ML por família CREATE com GTIN válido (busca de ficha + domínio da categoria
  [cacheado 30d] + itens da ficha quando diverge) — mesma característica das chamadas já aceitas
  pelo ADR-0057 (cacheável, barata, best-effort).
- Só a variação principal é consultada: família cuja ficha só existe no GTIN de outra cor fica sem
  sugestão (aceito — 1 chamada previsível em vez de N; cores irmãs compartilham domínio).
- A sugestão do catálogo pode coincidir com a do concorrente (`concorrencia_categoria_id` vem do
  MESMO endpoint `/products/{id}/items`, ADR-0057) — o valor novo não é a categoria em si, e sim o
  sinal de divergência com a categoria escolhida + a trava anti-kit + a visibilidade sem foco.
- Categoria "com ficha" continua podendo ser semanticamente pior que a categoria escolhida
  originalmente (ex.: Aquaphor em "Cuidado do Corpo" vs. "Bebês") — por isso a decisão final é
  sempre do operador, nunca automática.

## Como reverter

Reverte com checkout dos arquivos tocados (`process-familia/index.ts`, `_shared/ml/catalogo.ts`,
`_shared/ml/domain-discovery.ts`, `card-categoria.tsx`, `src/lib/queries.ts`,
`src/lib/tipos-dominio.ts`, `vincular-catalogo/index.ts`, `_shared/notificacoes/telegram.ts`) +
drop das 3 colunas (aditivas, sem dado derivado em outro lugar — dropar é seguro).
