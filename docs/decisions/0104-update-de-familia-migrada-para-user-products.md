# ADR-0104 — UPDATE de família migrada pelo ML para User Products (adoção por SKU + `somente estoque` nunca muda composição)

**Status:** Aceito
**Data:** 2026-08-04 (aceite: 2026-08-04)
**Decisores:** Diego
**Relaciona:** completa a Fase 2 de
[ADR-0088](0088-publicacao-user-products-multi-item.md) (publicação UP multi-item, saga e reconciliadores);
honra a decisão de [ADR-0087](0087-family-name-deteccao-reativa.md) §6 e do ADR-0088
§"UPDATE permanece 100% `GET`-ao-vivo"; fecha o caso multi-cor deixado de fora por
[ADR-0084](0084-family-name-categoria-zipper.md) no UPDATE; aplica ao caminho UP a mesma classe de
invariante de [ADR-0078](0078-preco-por-variacao-split-por-faixa-e-controle-de-preco-no-update.md) F2 #3
(`somente_estoque` não empurra preço) e de [ADR-0089](0089-atualizacao-rapida-de-estoque.md)
("não pausa nada automaticamente no ML"). Reposição de estoque = [ADR-0016](0016-update-com-reposicao.md).

## Contexto

O Mercado Livre está migrando categorias para o modelo **User Products** de forma **automática e
gradual** — sem aviso, sem ação do vendedor, em anúncios **já publicados**. Uma família publicada
como Legacy (`variations[]` povoado) pode amanhecer como item **plano** (`variations: []` +
`family_name`/`family_id` na raiz), com as demais cores vivendo como **itens irmãos** sob o mesmo
`family_id`. O ADR-0088 já previu isso explicitamente ao decidir que o UPDATE detecta UP por
**`GET` ao vivo** e nunca por formato persistido.

O código, porém, **não implementa essa decisão**. Há duas lacunas verificadas no código real, não
supostas — e a segunda é a mais perigosa, porque não falha: muda o anúncio.

### Lacuna 1 — o roteamento UP do UPDATE lê estado local, não o `GET` ao vivo

`update-familia-ml/processar.ts:93-115` decide "é UP?" consultando o **banco local**: existe raiz
`anuncios_externos` (partição 0) **e** existe ao menos uma linha em `anuncios_externos_itens`?
Uma família migrada **pelo ML** nunca teve essas linhas criadas — ela foi publicada como Legacy.
Logo o roteamento diz "não é UP", cai no caminho Legacy, e o conector
(`_shared/canais/mercado-livre.ts:165-176`) recebe do `GET` um `variations: []` que não esperava:

```ts
if (atual.variations.length === 0 && a.existentes.length > 0) {
  if (a.existentes.length !== 1 || a.novas.length > 0) {
    const err = new Error(
      'Item plano (ADR-0084) com múltiplas cores ou cor nova — UPDATE não implementado para '
      + 'esse caso. Reponha manualmente no painel do Mercado Livre.',
    ) as Error & { status?: number };
    err.status = 400;
    throw err;
  }
```

Ou seja: **o dia em que o ML migrar uma família multi-cor do Diego, toda reposição de estoque
daquela família passa a falhar** com um pedido de reposição manual no painel — para cada família,
em cada lote. O caminho de **1 cor** (item plano do ADR-0084) continua funcionando; só o multi-cor
quebra. Falhar alto aqui é o comportamento certo para o código de hoje (é a alternativa ao no-op
silencioso que o ADR-0084 corrigiu), mas é um beco sem saída operacional.

### Lacuna 2 — em família UP, `somente estoque` **muda a composição do anúncio**

Verificado em `_shared/user-products/atualizar-composicao.ts`: a flag `somenteEstoque` só suprime
**preço** (`:102`) e **atacado** (`atualizar-familia-up.ts:332`). Ela **não** entra no cálculo de
composição. E a composição é derivada da **planilha**:

```ts
const paraRetirar = naoRetirados.filter((f) => !desejadosSet.has(f.sku));
```

Onde `skusDesejados` = as `variacoes` da família (planilha, menos as `excluida_da_publicacao`).
Consequência: **uma cor ausente da planilha vira `paraRetirar` → o item daquela cor é PAUSADO no
Mercado Livre**, mesmo numa reposição pura de estoque. Simetricamente, uma cor nova na planilha
dispara um **POST** (novo item no ML).

O caminho **Legacy não tem esse comportamento**. `montarVariacoesUpdate`
(`_shared/ml/atualizar.ts:110`) mapeia sobre **`atuais`** — as variações vivas que vieram do `GET`
do ML — e não sobre a planilha:

```ts
return atuais.map((a) => {
  const codigo = a.seller_custom_field ?? '';
  const novo = estoquePorCodigo.get(codigo);
  const base: VariacaoUpdate = { id: a.id, available_quantity: novo ?? a.available_quantity };
```

Uma cor ausente da planilha cai no `?? a.available_quantity`: é **reenviada intacta**, com o
estoque que já tinha. Legacy **preserva**; UP **pausa**.

Isto não é hipotético para o fluxo do Diego: `casadaNoMl` (`src/lib/publicavel.ts:13-15`) devolve
`true` para `jaCasadaUP`, então famílias UP **são elegíveis** ao atalho 1-clique "Atualizar estoque"
do ADR-0089 — cujo próprio texto promete que zerar estoque **"não pausa nada automaticamente no
ML"**. Hoje, numa família UP, pausa.

Junte as duas lacunas com a migração automática do ML e o resultado é: **assim que a migração
alcançar as famílias multi-cor, o comportamento de "somente estoque" muda sozinho, de "preserva a
cor" para "pausa a cor", sem nenhuma mudança de código, planilha ou ação do operador.**

### Estado verificado do código (lido, não presumido)

- **Fase 2 do ADR-0088 está muito mais implementada do que o próprio ADR registra.** Já existem
  `user-products/atualizar-familia-up.ts`, `atualizar-composicao.ts`, `remover-composicao.ts`,
  `reconciliar-convergencia.ts` e `reconciliar-backfill.ts`, com testes. O que falta é **a ponte**:
  nada leva uma família migrada pelo ML para dentro desse maquinário.
- **A busca por SKU já existe e já é usada em produção**: `ml/buscar-item.ts` implementa
  `buscarItemPorSku` sobre `GET /users/{seller_id}/items/search?sku=<seller_custom_field>` com
  paginação e validação por multiget — consumida pela saga de criação (`publicar-grupo.ts:157`) e
  pela de composição (`atualizar-composicao.ts:191`). Este ADR **reusa**, não cria.
- **`reconciliar-backfill.ts` não serve para este caso** (ver Alternativas): o contrato dele é
  `listarFamiliasSemFilho()` administrativo, **um** filho por família e
  `skus_esperados = [sku]` de **um** elemento. Aqui é inline, no worker, e multi-SKU.
- **Ambos os fluxos de UPDATE passam pelo mesmo worker.** "Atualizar tudo" e "somente estoque"
  entram por `update-familia-ml` com `job.somenteEstoque` — uma correção cobre os dois.

## Decisão

Adotar **detecção por `GET` ao vivo com adoção por SKU tudo-ou-nada, e tornar `somente estoque` um
invariante de composição** no caminho User Products.

### §1 — A detecção de UP no UPDATE passa a ser o `GET` ao vivo (o local vira só atalho)

A presença de linhas em `anuncios_externos_itens` continua roteando para a saga UP **imediatamente**
(atalho barato, sem chamada remota extra — comportamento de hoje, intocado). A novidade é o
**caminho de descoberta** para quem ainda não tem linhas:

O conector, na branch de item plano de `atualizarAnuncio`, ao encontrar
`atual.variations.length === 0` com **mais de uma cor existente ou cor nova**, **deixa de lançar
`throw 400`** e passa a devolver um erro de canal **tipado** — `MIGRADO_PARA_UP` — carregando o que
o `GET` observou (`family_id`, `family_name`, `sku` da raiz, `seller_id`).

Isto é **exatamente o padrão já aceito no CREATE** pelo ADR-0088 §3: o conector não decide sozinho
nem lança; sinaliza incompatibilidade de formato como **retorno normal** e a orquestração aciona a
saga. Aqui é o simétrico no UPDATE.

**O caminho de 1 cor sem cor nova permanece byte-a-byte como está** (item plano do ADR-0084 continua
repondo via `atualizarItemPlanoML`). Zero regressão: só o ramo que **hoje já falha** muda de
comportamento.

Esse ramo cobre **dois** casos, e ambos têm o mesmo destino: a família migrada multi-cor, e o item
plano de 1 cor (ADR-0084) ao qual a planilha **soma uma cor nova**. O segundo não é migração, mas
precisa do mesmo modelo N-itens — e adotar o SKU existente resolve os dois com um caminho só. Efeito
colateral bem-vindo: "cor nova em item plano", que o ADR-0084 deixou explicitamente fora de escopo,
passa a funcionar.

**Nenhum `GET` extra no caminho feliz.** O conector já faz o `GET` do estado real antes do PUT; a
detecção reaproveita esse mesmo `GET`. Uma família Legacy não paga nada por esta mudança.

### §2 — Adoção por SKU: tudo-ou-nada, só leitura remota

`processar.ts`, ao receber `MIGRADO_PARA_UP`, chama um módulo novo
`_shared/user-products/adotar-familia-migrada.ts`, que **descobre a forma real da migração em
runtime** em vez de assumi-la:

1. para cada SKU **já publicado** (as cores `casadas`, com `ml_variation_id`), `buscarItemPorSku`.
   Cores **genuinamente novas** ficam de fora da adoção: elas ainda não existem no ML, e exigi-las
   faria a regra tudo-ou-nada abortar sempre. Elas são criadas depois, pela mini-saga de composição
   — ou ignoradas, se for `somente estoque` (§4);
2. validar cada candidato por **multiget**: mesmo `seller_id` da conexão da org, `variations`
   vazio, `family_id` presente, `user_product_id` presente — as mesmas validações que o
   `reconciliar-backfill.ts` já aplica (`:59-74`), pelas mesmas razões (fail-closed);
3. exigir **`family_id` único** em todo o conjunto;
4. exigir **exatamente um** item por SKU, para **todos** os N SKUs.

**Qualquer desvio aborta a adoção inteira** e falha com **400 (definitivo)** — retentar não muda o
estado do ML e ocuparia a fila serial (`parallelism=1`, ADR-0034) por 10 retries à toa.

A mensagem de erro **reporta as contagens observadas** — "migração para User Products detectada, mas
encontrei apenas 3 de 9 SKUs no Mercado Livre sob o family_id 5179533274814609". Isto é deliberado:
**não sabemos, e não temos como verificar antes de acontecer, qual forma exata o ML dá a uma família
migrada.** A hipótese de desenho é "N itens irmãos, um por SKU, sob um `family_id` comum" — a mesma
forma que a saga de criação do ADR-0088 produz e que foi validada em produção com 9 cores. Se o ML
fizer diferente (colapsar em um item só, migrar parcialmente, agrupar em mais de um `family_id`), a
regra tudo-ou-nada **falha em vez de adivinhar**, e a primeira ocorrência real já traz na mensagem
o dado que diz qual caso foi. **A hipótese é validada em runtime, não em tempo de desenho.**

**Nenhum POST/PUT no ML durante a adoção** — só `GET`. A adoção não altera o anúncio; ela ensina o
banco local a enxergar o que o ML já fez. A reposição de estoque acontece **depois**, pelo caminho
normal da saga UP.

#### Limite conhecido: irmãos fora da planilha ficam **não rastreados**

A adoção captura as cores **da planilha deste lote**, não necessariamente todas as cores que a
família tem no Mercado Livre. Se o ML migrou uma família de 9 cores e a planilha de reposição traz
7, a adoção grava 7 filhos e `skus_esperados` com 7 SKUs. A agregação lê a partição como `ativo`
(7 de 7 — coerente com o que foi gravado), e **os outros 2 itens continuam vivos no ML sem linha
filha local**.

Consequência concreta, pelo ADR-0088 §2: **vendas e moderação desses 2 itens não são atribuídas à
família** — viram "vendas externas" até que um lote futuro inclua aquelas cores e a readoção as
capture (o `on conflict do update` da RPC torna a readoção segura e idempotente).

Isto é uma **regressão em relação ao Legacy**, e vale dizê-lo com todas as letras: lá
`montarVariacoesUpdate` mapeia sobre o `GET` ao vivo, então uma cor fora da planilha continuava
rastreada e intacta. Aqui ela some do modelo local.

**Aceito conscientemente, com o alternativo registrado:** adotar por `family_id` (buscar todos os
irmãos do grupo, não só os SKUs da planilha) capturaria a família inteira, mas exigiria um endpoint
de listagem por `family_id` cuja existência e semântica **não estão confirmadas na doc oficial** —
e este ADR já decidiu não construir sobre suposição a respeito da forma da migração. O caminho de
correção quando o dado real aparecer: trocar a fonte dos SKUs da adoção de "planilha" para "grupo",
sem mexer em nada mais do desenho.

**Mitigação disponível hoje:** manter a planilha de reposição com **todas** as cores da família (o
que já é o hábito), e usar o `reconciliar-user-products` (backfill administrativo) para conferir.

### §3 — A adoção grava três coisas, numa transação só

Numa única RPC (mesmo padrão do `upsertRaizEFilho` do backfill):

- **raiz `anuncios_externos`** (partição 0) com `skus_esperados` = **o conjunto dos N SKUs
  adotados**, e `titulo` = o `family_name` observado. Sem isso a agregação do ADR-0088 leria os N
  filhos como "excesso não explicado" (caso 5) e carimbaria `erro` espúrio;
- **N linhas `anuncios_externos_itens`**, ancoradas por `(anuncio_externo_id, sku)`, com
  `item_externo_id`/`family_id`/`user_product_id`/`permalink` observados e `status` derivado do
  status remoto pela mesma regra explícita do backfill (`active`→`ativo`, `paused`→`pausado`,
  qualquer outro → aborta; nunca default silencioso);
- **`variacoes.ml_variation_id = null`** para as variações adotadas. O ADR-0088 define UP como
  `ml_variation_id` nulo; deixar o ID Legacy órfão faria o filtro `casadas` do caminho Legacy e o
  resolvedor de vendas (`_shared/update/reconciliar.ts`) casarem por um `variation_id` que **não
  existe mais** no anúncio migrado — atribuição de venda errada, silenciosa;
- **`familias.ml_item_id` re-apontado**, por regra determinística e explícita: **o filho cujo
  `item_externo_id` for igual ao `ml_item_id` atual**, se ele estiver entre os irmãos adotados;
  **senão** o filho do menor `codigo` (SKU) em ordem crescente. O ADR-0088 §5 define esse campo
  como "o primeiro item técnico da partição 0" e enumera os consumidores de frontend que o leem
  como "o anúncio da família" — deixá-lo apontando para um item que a migração dissolveu quebraria
  todos eles em silêncio.

### §4 — `somente estoque` **nunca** muda composição (invariante)

Em `atualizarComposicao`, com `somenteEstoque = true`:

- **`paraRetirar` é sempre vazio** — nenhuma cor é pausada por estar ausente da planilha;
- **`paraAdicionar` é sempre vazio** — nenhuma cor nova é criada no ML;
- **`skus_esperados` não é reescrito** e `mudando_composicao` **não é ligado**;
- só a **reposição** roda, e apenas sobre os filhos vivos que **também** estão na planilha
  (`desejados.has(f.sku)` — já é o comportamento de `reposicao`, `:100`). Cor viva ausente da
  planilha fica **intacta**, com o estoque que já tinha — **idêntico ao Legacy**.

Isto alinha os dois formatos: **mudança de composição passa a ser exclusiva de "Atualizar tudo"**,
onde é escolha consciente do operador — a mesma linha que o fix do lote #45 traçou para o rename de
cor (ADR-0062), a mesma que o ADR-0078 F2 #3 traçou para preço, e a mesma que o ADR-0089 já
prometia por escrito.

O guard entra **dentro** de `atualizarComposicao`, não no chamador: qualquer caller futuro fica
coberto pela mesma regra (mesma decisão de posicionamento do fix do lote #45).

### §5 — Onde a reconciliação vive (desvio nomeado do enunciado)

O pedido falava em "reconciliação automática via `reconciliar-backfill`". A decisão é **um módulo
irmão**, `adotar-familia-migrada.ts`, e **não** uma generalização do backfill. Motivo: os contratos
são incompatíveis — o backfill é **administrativo** (`listarFamiliasSemFilho()` varre a org),
adota **um** filho por família e grava `skus_esperados` de **um** elemento; aqui a adoção é
**inline no worker**, para **uma** família por vez, com **N** SKUs. Generalizar borraria o contrato
limpo do backfill ("só GET, idempotente, 1 filho") para servir a um caso que ele não tem como
enxergar. Os dois **compartilham** a validação fail-closed e a porta de upsert atômico.

### §6 — Fora de escopo, explicitamente

- **Migração que atinge o CREATE**: já resolvida pelo ADR-0088 §3 (cache de formato + retry
  reativo + saga). Intocado.
- **Vinculação de catálogo (ADR-0021) por item UP**: continua pendente da Fase 2, não entra aqui.
- **Reconciliador de convergência automatizado** (cron): segue como está — o "Reenviar" manual
  continua sendo o caminho de retomada.
- **Legacy**: nenhuma mudança observável.

## Alternativas consideradas

- **Manter o `throw 400` e repor manualmente no painel** (status quo): rejeitada — é exatamente o
  beco sem saída que motivou este ADR. Com a migração avançando, converte reposição de estoque em
  trabalho manual por família.
- **Fazer o `GET` de detecção em `processar.ts` antes de rotear**: rejeitada — pagaria uma chamada
  extra à API do ML em **toda** atualização Legacy, para descobrir algo que o `GET` que o conector
  já faz revela de graça. O sinal tipado do conector custa zero no caminho feliz.
- **Generalizar `reconciliar-backfill.ts` para N SKUs**: rejeitada — ver §5.
- **Adoção parcial** (adotar os SKUs encontrados e seguir): rejeitada — deixaria a família com
  `skus_esperados` menor que a realidade, a agregação daria `ativo` sobre um conjunto incompleto e
  a família seria marcada `publicado` com cores fora do controle do PubliAI. É a classe de
  falso-sucesso que o ADR-0088 combate com a igualdade de conjunto.
- **Assumir a forma da migração e implementar só o caso "N irmãos"** sem a checagem tudo-ou-nada:
  rejeitada — não temos como verificar a forma real antes de o ML migrar uma família do Diego.
  Assumir e errar publicaria estoque no item errado.
- **`somenteEstoque` continuar mudando composição** (status quo do caminho UP): rejeitada — pausa
  anúncio sem o operador pedir, contradiz o texto do ADR-0089 e diverge do Legacy sem nenhuma razão
  de domínio.
- **Bloquear UPDATE de família migrada até uma rodada administrativa de backfill**: rejeitada —
  transfere para o operador a tarefa de perceber que o ML migrou algo, que é justamente o que ele
  não tem como saber.

## Consequências

- **Boas:** quando o ML migrar uma família multi-cor, o UPDATE **continua funcionando** — a
  primeira atualização adota os itens e as seguintes usam o caminho UP normal, sem nenhuma ação do
  operador. `somente estoque` passa a significar a mesma coisa nos dois formatos, e para de poder
  pausar anúncio sozinho. A ponte fecha a Fase 2 do ADR-0088 no que o UPDATE precisava.
- **Riscos / tradeoffs aceitos:**
  - **A forma da migração é hipótese validada em runtime.** Se o ML fizer diferente do esperado, a
    primeira família migrada falha com 400 e contagens observadas — falha ruidosa, não corrupção.
    Aceito conscientemente: é preferível a adivinhar.
  - **Uma família migrada gasta N chamadas de busca por SKU** na primeira atualização (uma vez só;
    depois as linhas filhas existem e o atalho local roteia direto). Custo limitado e não recorrente.
  - **`somente estoque` deixa de propagar retirada de cor.** É a intenção — mas significa que
    retirar uma cor passa a exigir "Atualizar tudo". Explícito, não acidental.
  - **Re-apontar `familias.ml_item_id`** tem o blast radius que o ADR-0088 §5 já enumerou; a regra
    determinística e a transação única contêm o risco, não o eliminam.
  - **Irmãos fora da planilha ficam não rastreados** (ver §2, "Limite conhecido") — vendas deles não
    são atribuídas à família até um lote futuro incluir a cor. É o único ponto em que o UP fica
    atrás do Legacy neste ADR.
- **Como reverter:** o sinal `MIGRADO_PARA_UP` volta a ser `throw 400` (uma linha) e o invariante
  de `somenteEstoque` sai do `atualizarComposicao`. Nenhuma migration destrutiva; as linhas adotadas
  permanecem válidas e continuam roteando pelo atalho local.

## Implementação prevista

- **`_shared/canais/contrato.ts`**: `ErroCanalCodigo` += `MIGRADO_PARA_UP`, com payload observado
  (`familyId`, `familyName`, `sku`, `sellerId`).
- **`_shared/canais/mercado-livre.ts`**: a branch de item plano devolve o erro tipado em vez de
  `throw 400` no caso multi-cor/cor-nova. Caminho de 1 cor intocado.
- **`_shared/user-products/adotar-familia-migrada.ts`** (novo): função pura sobre portas
  (`buscarPorSku`, `confirmar`, `adotar`), com a regra tudo-ou-nada e a mensagem com contagens.
- **`_shared/user-products/portas-supabase.ts`**: porta de adoção atômica (RPC) — raiz +
  N filhos + `ml_variation_id=null` + `ml_item_id` re-apontado, numa transação.
- **Migration**: RPC de adoção (`security definer`, org-scoped, mesma RLS de `anuncios_externos`).
- **`_shared/user-products/atualizar-composicao.ts`**: invariante §4 (`somenteEstoque` ⇒
  `paraRetirar`/`paraAdicionar` vazios, sem reescrever `skus_esperados`, sem ligar
  `mudando_composicao`).
- **`update-familia-ml/processar.ts`**: captura `MIGRADO_PARA_UP` → adoção → roteia para
  `atualizarFamiliaUP` no mesmo attempt.
- **Deploy (ADR-0088 §1)**: blast radius recalculado por `deno info`, união dos importadores de
  todos os módulos `_shared/` tocados, `verify_jwt` preservado, versão +1 conferida pós-deploy.
  **Sem lista fixa.**

## Validação (critérios de aceite)

- **Adoção feliz**: família Legacy de 9 cores marcada como migrada (GET devolve `variations: []` +
  `family_name`), 9 SKUs resolvem para 9 itens sob 1 `family_id` → 1 raiz com
  `skus_esperados` de 9 elementos, 9 filhos, `ml_variation_id` nulado nas 9 variações,
  `ml_item_id` re-apontado pela regra determinística, **zero POST/PUT no ML durante a adoção**.
- **Adoção incompleta**: 3 de 9 SKUs encontrados → **nada é gravado**, erro 400 com as contagens
  observadas na mensagem.
- **`family_id` divergente** entre irmãos → aborta, nada gravado.
- **Item de outro seller** devolvido pela busca → ignorado; se isso deixar o conjunto incompleto,
  aborta (fail-closed, mesma regra do backfill).
- **Status remoto desconhecido** (`closed`/`under_review`) num irmão → aborta, sem default silencioso.
- **1 cor migrada**: continua pelo caminho de item plano do ADR-0084 — **sem** adoção, **sem**
  regressão (RED-GREEN: o teste falha se a branch de 1 cor for tocada).
- **`somente estoque` + cor ausente da planilha** (o invariante §4): a cor **permanece ativa** no
  ML com o estoque que tinha; **nenhum** PUT de pausa é emitido; `skus_esperados` **não** é
  reescrito; `mudando_composicao` **não** é ligado. Validar em RED-GREEN — o teste **deve falhar**
  contra o código de hoje.
- **`somente estoque` + cor nova na planilha**: **nenhum** POST; a cor é ignorada.
- **"Atualizar tudo" + cor ausente/nova**: comportamento de composição **preservado** (retira/adiciona
  normalmente) — trava a regressão inversa.
- **Paridade Legacy↔UP**: mesmo lote, mesma planilha com uma cor a menos, em `somente estoque` →
  o resultado observável no ML é o mesmo nos dois formatos.
- **Segunda atualização** da família já adotada: roteia pelo atalho local (linhas filhas existem),
  **sem** nenhuma busca por SKU.
- **Readoção com mais cores** (limite conhecido do §2): família adotada com 7 SKUs; um lote posterior
  traz os 9 → a readoção captura os 2 faltantes e reescreve `skus_esperados` para 9, sem duplicar
  linha (`on conflict do update`).
- **CI completo local antes do push**: `pnpm lint`, `deno lint`, `deno check`, `pnpm test`,
  `pnpm build`.
