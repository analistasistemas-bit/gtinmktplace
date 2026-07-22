# ADR-0088 — Publicação em User Products com N itens técnicos por família (multi-cor)

**Status:** Aceito
**Data:** 2026-07-22 (aceite: 2026-07-22)
**Decisores:** Diego
**Relaciona:** conclui o "redesenho maior" deixado fora de escopo por
[ADR-0084](0084-family-name-categoria-zipper.md) (item plano/`family_name` p/ MLB271227) e
[ADR-0087](0087-family-name-deteccao-reativa.md) (detecção reativa, só 1 variação); reusa `particao`
como faixa de preço de [ADR-0078](0078-preco-por-variacao-split-por-faixa-e-controle-de-preco-no-update.md)
(split por faixa, aditivo ao [ADR-0048](0048-split-produto-n-anuncios-ml.md)); mesma base de
[ADR-0003](0003-variacoes-agrupadas-por-pai.md) (variações agrupadas por PAI). Fallback de venda por
GTIN de [ADR-0045](0045-vendas-catalogo-match-ean.md).

## Contexto

Categorias do Mercado Livre no modelo oficial "User Products" (UP) — `family_name` na raiz do item, sem
array `variations[]` — **rejeitam a publicação quando a família tem mais de 1 cor**. O ADR-0084 provou o
comportamento e resolveu o caso de **1 variação** com um item plano; o ADR-0087 generalizou a **detecção**
para qualquer categoria nova (retry reativo pela assinatura `cause_id` 369+374 dentro de `criarAnuncio`),
mas **também só para 1 variação**. Ambos deixaram explícito, como "redesenho maior fora de escopo", o caso
multi-cor: no modelo UP, publicar N cores exige **N itens ML separados** (um por cor/SKU), todos linkados
pelo mesmo `family_id`/`family_name` — o ML agrega esses N itens numa única página de produto (User
Products Page) com seletor de cor para o cliente final (doc oficial "User Products", confirmada no
ADR-0084 § Contexto).

**Bug disparador:** família "AGULHA CROCHÊ CABO PLÁSTICO MATTE 15CM" (PAI `03103331`, lote #37), categoria
`MLB419782` (Agulhas de Tricô e Crochê), **9 cores**. Hoje `montarPayloadItem`
(`ml/publicar.ts:125-131`) **falha alto (`throw`)** de propósito nesse caso — nunca publica algo errado em
silêncio — porque o pipeline atual só sabe gravar **um** `ml_item_id` por família (suposição 1:1
família→anúncio) e não tem onde registrar N itens técnicos com o mesmo `family_id`. Resultado prático: a
categoria inteira fica sem poder publicar multi-cor, e essa é a direção do catálogo genérico (E5/Shopee).

Este ADR fecha a lacuna: define **como** o PubliAI representa e publica N itens UP agrupados por
`family_id`, mantendo intacta a partição comercial (`anuncios_externos`, faixa de preço) e **sem
regredir** o caminho de 1 cor já em produção.

### Estado verificado do código (não assumido)

- **Callers reais de `criarAnuncio`** (`grep`, 2026-07-22): três em produção — `publicar-anuncio/processar.ts:148`
  (worker QStash, presente em `config.toml`), `publicar-split-ml/index.ts:51` (via `criarAnuncioParticao`,
  chamada em `:275`) e `publish-familia-ml/index.ts:112`. **`publicar-anuncio` não aparece nem na lista de
  "modify" nem na de deploy do plano de implementação** — ponto crítico para a decisão de não relocar o
  retry (ver Decisão §3).
- **Constraint vigente de `anuncios_externos`**: `anuncios_externos_org_canal_pai_particao_key`, `unique
  (org_id, canal, codigo_pai, particao)` — a versão `user_id` foi **dropada** na migration
  `20260705165755_e7_org_id_not_null.sql` (que substituiu `anuncios_externos_user_canal_pai_particao_key`,
  por sua vez criada em `20260629180206_anuncios_externos_particao.sql`). Ou seja: o upsert **já deve ser
  org-scoped** — não há mais constraint por `user_id` a acertar (ver Decisão §4).
- **Consumidores de `familias.ml_item_id`** (`grep`, 2026-07-22): **três** edge functions **montam o
  escopo por família** — `metricas-vendas/index.ts:34`, `monitorar-moderados/index.ts:27` e
  `status-publicados/index.ts:21`. Destas, `status-publicados` **já une `anuncios_externos.item_externo_id`**
  (partições comerciais, ADR-0048) ao `ml_item_id` legado — só lhe falta somar os itens filhos UP da nova
  tabela; `metricas-vendas` e `monitorar-moderados` ainda partem só do `ml_item_id`.
  `atualizar-status-publicado/index.ts:21` **não** monta escopo de família: é um comando de **item único**
  (pausa/ativa o `ml_item_id` que recebe) — a saga o chama **por filho**, um SKU de cada vez (ver §2). Além
  disso: o espelhamento (`_shared/anuncios/espelhar.ts:69`) e vários consumidores de frontend
  (`src/lib/queries.ts`, `publicados.ts`, `resumo-vendas.ts`, `custos.ts`, `fotos-produto.ts`,
  `cockpit.ts`, `detalhe-vendas.ts`) leem `ml_item_id` como **"o anúncio da família"** (1 valor = 1
  anúncio real). Redefinir esse campo mexe com todos eles (ver Decisão §5).

## Decisão

Adotar a arquitetura de **item técnico separado da partição comercial + saga "tudo ou pausa" (segura para
retry sequencial) + cache de formato por conexão+categoria + reconciliador de backfill**, incorporando as
correções abaixo **como parte da decisão** (não como ressalva de rodapé).

### Estrutura de dados

- **`anuncios_externos` continua sendo a partição comercial** (faixa de preço/anúncio lógico, ADR-0078).
  `particao` **nunca** significa cor. Preços iguais → uma partição; preços diferentes → partições
  distintas (comportamento de hoje, intocado). Ganha uma coluna nova **`estado_desejado`** (`ativando` |
  `pausando`, nulável) — o **alvo** persistido de uma operação em lote de ativação/pausa, gravado **antes**
  de qualquer PUT (ver saga e reconciliador de convergência) e **limpo (setado `null`) atomicamente assim
  que o estado terminal correspondente for confirmado** — só fica preenchido durante a janela em que a
  operação está pendente/em compensação (ver "Regra de limpeza de `estado_desejado`"). **Mantém-se
  deliberadamente com dois valores** (`ativando`/`pausando`): a mudança de composição (adicionar/retirar cor)
  **não** usa `estado_desejado` — usa um marcador **separado** (`mudando_composicao`, abaixo), para não erodir
  a regra afiada "`ativando` que esgota → `erro`, só `pausando` → `pausado`".
- **Nova coluna `skus_esperados`** (`jsonb`/`text[]`) — o **snapshot explícito do conjunto EXATO de SKUs
  atualmente esperados** da partição, **não um inteiro**. Persistido **antes** de a saga começar a criar
  itens e **reescrito** a cada mudança de composição (UPDATE que adiciona/retira cor). Um inteiro só
  detectaria falta de linhas; um snapshot de SKUs também detecta **substituição indevida** de SKU e
  **distingue** um filho histórico (cor retirada) de um filho atual. **Invariante do conjunto esperado:** o
  conjunto dos SKUs dos filhos **não-retirados** (`retirado=false`) de uma partição **deve ser igual a
  `skus_esperados`**; a agregação e o reconciliador de convergência exigem essa **igualdade de conjunto**
  (não uma contagem solta) antes de aceitar `ativo` — o que impede tanto reserva parcial (7 de 9 SKUs por
  crash) quanto SKU trocado/excedente de passar como conclusão legítima.
- **Nova coluna `mudando_composicao`** (booleana, `default false`) — marcador **transitório** de uma mudança
  de composição em andamento. Enquanto `true`, a partição lê como **em transição** (`publicando`) e os
  veredictos **terminais** da agregação (excesso→`erro`, igualdade de conjunto→`ativo`) **ficam suspensos** —
  é gravado **antes** de qualquer chamada remota e limpo só quando a nova composição está confirmada (ver
  "UPDATE" e reconciliador de convergência). É **separado** de `estado_desejado` de propósito, para isolar a
  lógica de composição das regras de duas vias da ativação/pausa.
- Ganha também a constraint **`unique (id, org_id)`** exigida pela FK composta da tabela filha (ver abaixo).
- **Nova tabela `anuncios_externos_itens`** = o item **técnico** UP, um por SKU/cor, filho da partição.
  Colunas + **constraints explícitas**:
  - `anuncio_externo_id` — **NOT NULL**; a integridade referencial é garantida pela **FK composta** descrita
    no bullet de `org_id` (não uma FK simples separada);
  - `org_id` — **NOT NULL** e **igual ao do pai**, garantido por **FK composta real** — **não** por trigger
    nem por `CHECK` (um `CHECK` do Postgres **não pode consultar outra tabela**, então essa opção **nunca foi
    válida** e fica descartada). Concretamente: adicionar `unique (id, org_id)` em `anuncios_externos` (nova
    constraint no pai) e declarar na filha
    `foreign key (anuncio_externo_id, org_id) references anuncios_externos(id, org_id) on delete cascade`.
    Assim a linha filha **herda** a org do pai — não pode existir apontando para uma partição de outra org, e
    **não** declara a org por conta própria;
  - `variacao_id` — **FK** para `variacoes(id)` `on delete set null`, **nulável**: é um ponteiro de
    rastreabilidade **"melhor esforço"** (aponta para a última variação conhecida), **não** a identidade de
    ancoragem — essa já é `(anuncio_externo_id, sku)`. A variação muda a cada re-ingest/novo lote e a
    família/variação antiga pode ser apagada depois, então NOT NULL conflitaria com o re-ingest;
  - `sku` — **NOT NULL** (identidade estável da cor dentro da partição);
  - `retirado` — **boolean NOT NULL default false**: marca uma cor **removida da família** (retirada num
    UPDATE) cujo item permanece **pausado no ML** e cuja linha é **preservada como histórico**. Um filho
    `retirado=true` **sai do conjunto esperado** (`skus_esperados` é reescrito sem ele) e é **excluído da
    agregação** — não conta nem como faltante nem como excedente. O flag é ligado **só depois** de a pausa
    remota ser **confirmada por GET** (nunca marcar como retirado um item ainda ativo no ML). É o par
    necessário do snapshot: o `skus_esperados` diz *quais* SKUs são esperados; o `retirado` distingue
    "removido de propósito" de "excedente errôneo" (ver "Regra de agregação");
  - `status` — **NOT NULL** com **`check status in
    ('pendente','criacao_incerta','criado','pausado','ativo','compensacao_pendente','remocao_pendente','erro')`**.
    `criacao_incerta` marca a janela entre "vou tentar o POST" e "persisti o `item_externo_id`" (correção do
    órfão sem ID, ver saga); `remocao_pendente` marca uma remoção UP que não conseguiu pausar todos os filhos
    (ver Remoção de família UP);
  - `item_externo_id`, `user_product_id`, `family_id`, `permalink` — nuláveis até o item existir no ML.
  - **Ancoragem: `unique (anuncio_externo_id, sku)`** — o SKU é a identidade estável (mesmo padrão que a
    partição já ancora por SKU, ADR-0048); **não** `variacao_id`, que muda a cada re-ingest.
  - Índices únicos parciais: `(org_id, item_externo_id)` onde `item_externo_id is not null`; e
    `(user_product_id)` onde `user_product_id is not null`.

  Legacy (`variations[]`) **não** usa essa tabela; nada é convertido preventivamente.
- **Nova tabela cache `ml_formato_publicacao`** (`connection_id` + `categoria_id` → `formato ∈
  {legacy,user_products}`), PK `(connection_id, categoria_id)`. Extensão **pré-aprovada textualmente** pelo
  ADR-0087 (§ Consequências, "incremento 2": tabela chaveada por seller/conexão+categoria, seed a partir do
  resultado do CREATE, **nunca** usada no UPDATE).

### §1 — Lista de deploy é derivada por `deno info`, nunca hardcoded

O blast radius de qualquer mudança em `_shared/` é **recalculado no momento do deploy via `deno info` por
function** (mesmo padrão do ADR-0060/0084 e do deploy real do ADR-0087). O ADR-0087 **sofreu este exato
incidente**: um deploy com lista fixa sobrescreveu silenciosamente uma feature não relacionada
(`reservarNotificacao` em `sync-venda`/`sync-pergunta`/`sync-devolucao`) e só foi pego por download de
verificação. Este ADR **não fixa lista de functions** — e chama a atenção para os importadores reais que
uma lista fixa esquece: `faturamento/io.ts` é importado por `reconciliar-faturamento`, `ml-webhook`,
`sync-venda`, `backfill-faturamento`, `sync-devolucao`, `sync-pergunta`, `sync-mensagem`; `lote/exclusao.ts`
por `remover-publicado` e `excluir-lote`; e os `index.ts` de escopo (§5) por `metricas-vendas`,
`monitorar-moderados`, `status-publicados`, `atualizar-status-publicado`. O comando de deploy é sempre a
**união recalculada**, com `verify_jwt` preservado por function e conferência de versão (+1) pós-deploy.

**Procedimento reproduzível** (não "recalcular" em prosa): para cada módulo `_shared/` tocado, rodar
`deno info --json` por function candidata e extrair as que o importam, comparando o resultado com a lista a
deployar **antes** de `supabase functions deploy`:

```bash
# blast radius de um módulo _shared/ alterado (ex.: faturamento/io.ts)
for f in supabase/functions/*/index.ts; do
  fn=$(basename "$(dirname "$f")")
  deno info --json "$f" 2>/dev/null \
    | jq -e --arg m "faturamento/io.ts" '.modules[].specifier | select(endswith($m))' >/dev/null \
    && echo "$fn"
done | sort -u
```

Qualquer function no blast radius impresso que **falte** na lista a deployar **bloqueia** o deploy. Repetir
por módulo `_shared/` tocado e deployar a **união**. (`deno info --json` + filtro por `specifier` é o mesmo
mecanismo de verificação usado nos ADR-0060/0084 e no deploy real do ADR-0087.)

### §2 — Adaptar os `index.ts` que montam escopo (correção financeira é PRÉ-REQUISITO de go-live)

No modelo UP, `item_externo_id` **já é granular por SKU** (1 item ML = 1 cor). Portanto:

- `faturamento/io.ts` (`carregarCatalogo` já tem `idsPubliai`/`codPorItem` por item) e `moderacao/diff.ts`
  (função pura sobre listas de ids) **quase não mudam** — basta os itens filhos UP entrarem nos mapas
  existentes (`itemParaSku`/`idsPubliai`), preservando o caminho atual por `(ml_item_id, variation_id)` e
  o fallback por GTIN.
- O **alvo real** são os **três** `index.ts` que montam o escopo da família a partir do `ml_item_id`:
  `metricas-vendas/index.ts:34-35`, `monitorar-moderados/index.ts:27` e `status-publicados/index.ts:21`.
  `status-publicados` **já une `anuncios_externos.item_externo_id`** ao `ml_item_id` (partições, ADR-0048) —
  falta-lhe só somar os itens filhos UP da nova tabela; `metricas-vendas` e `monitorar-moderados` ainda
  partem só do `ml_item_id` e por isso **não enxergam os itens 2..N** (cores além da 1ª). Sem essa correção:
  **vendas dos itens 2..N viram "externas"** (não atribuídas à família), **moderação dos itens 2..N fica
  invisível**, **status mostra só a 1ª cor**. O fallback por GTIN (ADR-0045, `reclassificarPorGtin`) **não
  cobre** esse caso porque aviamentos tipicamente não têm GTIN (`EMPTY_GTIN_REASON`). Os três passam a montar
  o escopo a partir de **todos** os `item_externo_id` dos itens filhos UP da família (união com o
  `ml_item_id` legado, e — em `status-publicados` — com o join de partição que já existe). **Esta correção é
  pré-requisito do go-live de User Products — entra junto, não depois.**
- `atualizar-status-publicado/index.ts:21` **não** entra nessa lista — é um comando de **item único** que a
  saga chama por filho (pausar/ativar cada SKU), não um montador de escopo de família. Como **guarda de
  correção** (não fix de segurança crítico — a autorização de posse do item já é garantida pelo próprio
  Mercado Livre via token OAuth da conexão da org: um token de uma org não age sobre item de outro seller),
  antes do PUT ele passa a **verificar que o `ml_item_id` recebido pertence a um registro local conhecido da
  org** (`familias.ml_item_id` ou `anuncios_externos_itens.item_externo_id` da org) — evita editar por engano
  um item não rastreado pelo PubliAI.

### §3 — Manter o retry de 1 cor do ADR-0087 **intacto**; saga só quando `variacoes.length > 1`

O retry reativo interno de `criarAnuncio` (ADR-0087) **permanece exatamente como está** — zero regressão,
ADR-0087 intocado. O erro `FORMATO_INCOMPATIVEL` / a saga UP só são acionados quando a família tem **mais
de 1 variação** (o caso genuinamente novo que o ADR-0087 já **não** cobria). Motivo: há **três** callers de
`criarAnuncio` (verificado acima), e `publicar-anuncio/processar.ts:148` **não** seria adaptado à saga — se
o retry fosse removido/relocado, esse caminho perderia o retry de 1 cor e o próprio lote #37 original (kit
agulha, 1 variação) voltaria a falhar. O cache `ml_formato_publicacao` serve **apenas** como seed de
`formato` no CREATE. O cache é **um hint de seed, não fonte de verdade**, e o custo depende de hit/miss —
sem contradição:

- **Cache hit** (conexão+categoria **já conhecida** como `user_products`): a tentativa `variations` é
  **pulada de verdade**, sem custo nenhum — **zero** POST desperdiçado. Vai direto ao caminho UP.
- **Cache miss** (1ª vez que a categoria aparece): ainda tenta `variations` **primeiro**, recebe a rejeição
  do ML e **só então** monta o plano UP — é **aqui**, e só aqui, que se paga **1 POST desperdiçado**. Não é
  custo de um valor "obsoleto"; é o custo inevitável de descobrir o formato na primeira vez.

**Sem TTL nem revalidação automática:** é o **mesmo precedente já aprovado do ADR-0087** para o caso de 1 cor
(cache permanente; risco de deriva de categoria — o ML mudar o comportamento de uma categoria depois —
**aceito**, não é lacuna nova deste ADR e não se reabre aqui). Por isso o
cache só grava/atualiza `user_products` quando a **assinatura reativa exata** foi observada — `cause_id`
**369+374**, o **mesmo predicado** que o ADR-0087 usa em `precisaItemPlano` — **nunca** por inferência de um
CREATE plano que teve sucesso por **outro** motivo (ex.: categoria já conhecida do ADR-0084 / lista seed).
Um CREATE plano bem-sucedido sem essa assinatura **não** prova que o formato UP era obrigatório e **não**
semeia nem reforça o cache; uma falha de validação não relacionada à assinatura tampouco o valida — é erro
comum de publicação, não sinal de formato.

### §4 — Upsert na constraint vigente (org-scoped, já correta)

O upsert da partição usa a constraint **realmente vigente**: `onConflict` sobre
`(org_id, canal, codigo_pai, particao)` — casando `anuncios_externos_org_canal_pai_particao_key`. Não há
mais constraint por `user_id` (dropada na migration `20260705165755`); qualquer upsert que ainda mirasse
`user_id` quebraria. A raiz lógica é criada **antes** dos filhos (`status='publicando'`, `titulo=family_name`,
`item_externo_id=null`) e **já com `skus_esperados` gravado** (o snapshot do conjunto de SKUs que essa
partição deve ter — persistido **antes** de a saga criar qualquer item); seu `id` é entregue à saga, e só
recebe `status='publicado'` depois de o **conjunto de SKUs dos filhos `ativo` não-retirados igualar
exatamente `skus_esperados`** (todos os SKUs esperados confirmados e ativos, nenhum a menos, nenhum a mais).

**`family_name` inclui um identificador de partição.** O ML agrupa numa mesma UPP todos os itens que
compartilham `family_name`; portanto o `family_name` do payload plano **deve carregar um identificador da
partição** (ex.: sufixo da faixa de preço). Sem isso, **duas partições comerciais distintas** (preços
diferentes — ver Estrutura de dados) colidiriam na **mesma** UPP, misturando faixas de preço no mesmo
produto. Regra: itens da **mesma** partição compartilham exatamente o mesmo `family_name`; partições
**distintas** têm `family_name` distintos.

### §5 — Semântica nova e explícita de `familias.ml_item_id`

`familias.ml_item_id` passa a significar **o primeiro item técnico da partição 0** (compat com todo
consumidor que lê "o anúncio da família"): permalink, status, moderação e métricas continuam funcionando
para a 1ª cor via esse campo, e o **escopo completo** (todas as cores) vem dos itens filhos (§2). Essa
redefinição é **deliberada e enumerada** (consumidores listados em Contexto), não presumida compatível: os
**três** `index.ts` de escopo passam a usar os filhos; os consumidores de frontend (`queries.ts`,
`publicados.ts`, `resumo-vendas.ts`, etc.) continuam lendo um único valor `ml_item_id` como "o anúncio da
família". Precisando: só a **partição 0** tem representante em `familias.ml_item_id`; as partições
**adicionais** (preços diferentes) vivem em `anuncios_externos.item_externo_id` — e, se UP, têm seus
**próprios** itens filhos na tabela nova. Ou seja, **não** é "1 `ml_item_id` por partição" ao pé da letra:
o `familias.ml_item_id` cobre apenas a partição 0. Nenhum consumidor lê `ml_item_id` esperando N valores; a
compatibilidade é preservada ao apontá-lo para o 1º item da partição 0.

Explicitamente: `familias.ml_item_id` é um **representante best-effort**, **não** o status agregado das N
cores. É garantido consistente **apenas no instante em que `familias.status='publicado'`** — quando a saga
já confirmou **todos** os filhos ativos. Fora desse instante (falha parcial, cor pausada, retry em
andamento) o campo pode apontar para um item cujo estado real diverge das outras cores. O **status agregado
verdadeiro dos N filhos só vem de ler `anuncios_externos_itens`**; quem precisar do estado real do grupo
(não só "um permalink da família") deve consultar a tabela filha, nunca inferi-lo do campo.

### Saga `publicar-grupo.ts` ("tudo ou pausa") — segura para **retry sequencial**

"Idempotente" aqui significa **segura para reexecução sequencial após falha** — um retry reaproveita o
trabalho já persistido e não repete efeitos remotos — **não** segura contra **duas execuções concorrentes**
da mesma partição. Concorrência entre workers é risco **pré-existente do pipeline inteiro** (registrado
como fora de escopo no ADR-0087); este ADR **não** introduz mutex/lock e **não** promete um. A reserva de
linha reduz a janela de corrida, não a elimina.

**Persistir o alvo antes de mutar (`estado_desejado`).** Antes de disparar **qualquer** PUT de ativação ou
pausa em lote, a saga grava `anuncios_externos.estado_desejado` (`ativando` para uma publicação/reativação,
`pausando` para uma pausa em lote). O **reconciliador de convergência** (abaixo) só converge para esse alvo
**persistido** — **nunca** o infere a partir do estado parcial observado dos filhos. Se a saga cair no meio
de uma ativação, o reconciliador sabe pelo `estado_desejado` que o destino era `ativo` (e não pausar de
volta o que já subiu), e vice-versa.

**Regra de limpeza de `estado_desejado`.** O campo é **limpo (setado `null`) atomicamente assim que o estado
terminal correspondente é confirmado**: todos os filhos não-retirados `ativo` confirmados (com o **conjunto
de SKUs `==` `skus_esperados`**) encerra "ativando"; todos os filhos não-retirados `pausado` confirmados
encerra "pausando". Só deve
ficar preenchido durante a janela em que a operação está **pendente/em compensação** — **nunca** depois de
concluída, para não confundir uma reconciliação futura com uma intenção antiga. Quem limpa é sempre quem
confirma o desfecho: a saga (quando ela mesma conclui) ou o reconciliador de convergência (quando ele
converge o grupo).

Uma partição UP é publicada com semântica de atomicidade **sem** depender de transação no endpoint remoto:

1. reservar a linha filha por **`(anuncio_externo_id, sku)`** (identidade estável — nunca `variacao_id`);
2. **janela de idempotência antes de cada POST de criação** (resolve o **órfão sem ID** — um POST que teve
   sucesso no ML mas crashou **antes** de persistir o `item_externo_id` local; caso **distinto** do
   `compensacao_pendente`, que já tem ID). Antes do POST, **marcar a linha `criacao_incerta`** (não depois —
   se o processo cair no meio, a linha fica em `criacao_incerta` e sinaliza "pode haver órfão no ML"). Se a
   linha ainda não tem `item_externo_id`, **buscar no ML pelo `seller_custom_field` = SKU** (o campo que o ML
   devolve como SKU do item, lido por `criar-item.ts` em `ResultadoItem.variations[].seller_custom_field`).
   Endpoint real (confirmado na doc oficial, developers.mercadolivre.com.br):
   **`GET /users/{seller_id}/items/search?sku=<seller_custom_field>`** — **`sku` é o único filtro
   server-side garantido** por esse endpoint privado (a doc oficial confirma só ele; `category_id` combinado
   no **mesmo** endpoint **não** está demonstrado e **não** deve ser assumido como filtro server-side). O
   restante — `category_id`, `family_name` **exato** da partição, `seller` (conexão da org) e **janela de
   recência** (por `date_created`) — é **validado via GET/multiget dos IDs retornados**, **não** presumido
   filtrado pelo endpoint. **Paginação real:** usar `paging.total`/`offset` com **limite 100** por página,
   seguido de **multiget dos IDs retornados** para aplicar as validações acima. Se o resultado for **ambíguo
   ou truncado** (mais itens do que o limite cobre, ou >1 match após validação), **bloquear a adoção
   automática**: marcar `erro` e exigir **intervenção manual / reconciliador** — **nunca** assumir que o
   primeiro lote de resultados é completo nem adotar o primeiro. Achando (após multiget + validação)
   **exatamente um** match inequívoco, **adotar** o item existente (persistir seu id) em vez de criar um
   duplicado (decisão da rodada 2, inalterada).
   Uma linha que **fique** em `criacao_incerta` (o processo caiu antes de resolver) é reprocessada pela
   **própria saga na sua próxima execução** — retry natural do worker via QStash **ou** o botão **"Reenviar"**
   que já existe na UI hoje (`familia-row.tsx`, visível no bug report do lote #37) — que **refaz esta busca
   por SKU antes de tentar criar de novo**. **Não** é o reconciliador de convergência (que só opera sobre
   filhos que **já têm** `item_externo_id`) que resolve este caso;
3. **pular o POST** se já existir `item_externo_id` (retry reaproveita IDs persistidos, nunca repete POST
   de SKU já criado);
4. persistir cada POST **antes** de qualquer outra chamada (o `item_externo_id` gravado tira a linha de
   `criacao_incerta`);
5. criar cada item já **pausado** (staging) antes de criar o próximo SKU;
6. confirmar todos por GET e persistir `user_product_id`/`family_id` retornados;
7. **exigir um único `family_id` em todo o conjunto** — se divergir, **pausar todos** e falhar
   (`familia_up_desagrupada`); nunca ativar um grupo desagrupado;
8. **ativar todos** só depois da confirmação completa — gravando `estado_desejado='ativando'` na raiz
   **antes** do primeiro PUT de ativação. A ativação de N itens **não é atômica**: se ativar
   3 de 4 e o 4º falhar, a saga marca o grupo como **`compensacao_pendente`** (estado intermediário
   explícito) e retorna — **não** deixa a família como `publicado`. O **reconciliador de convergência**
   (abaixo, mutável) converge grupos em `compensacao_pendente` **sempre para o `estado_desejado` persistido**:
   com `estado_desejado='ativando'` ele **reativa os que faltam** e, se **esgotar as tentativas sem conseguir
   ativar todos**, o resultado é **`erro`** (intervenção manual) — **nunca** "pausar tudo" automaticamente.
   Só com `estado_desejado='pausando'` a convergência leva o grupo a **todo pausado**. Ao confirmar todos
   ativos, a saga **limpa `estado_desejado`** (fim de "ativando");
9. em qualquer falha, **pausar** todos os IDs conhecidos **como ação de compensação segura** (evitar item
   ativo órfão) — **compensação nunca deleta/encerra** (preserva histórico, alinhado ao ADR-0019/0060) — e
   agregar o erro sem ocultar a causa original. Pausar aqui é sempre a **ação** de compensação, **nunca** o
   estado terminal do grupo: o estado terminal segue a classificação já definida — crash transiente de
   criação fica em **`criacao_incerta`** (retry pela própria saga, passo 2); ativação parcial vira
   **`compensacao_pendente`** (passo 8); estado remoto inesperado ou ativação que esgota tentativas vira
   **`erro`**. Uma ativação que não converge termina em **`erro`**, **nunca** em `pausado`.

**Estados remotos inesperados (regra de segurança):** se um GET de confirmação encontrar um estado que a
saga não previu — item deletado no ML, `404`, `family_id` diferente do esperado, item de outro seller — a
linha é marcada **`erro`** e a saga **para**. **Nunca** há retry automático indefinido sobre estado remoto
inesperado; a convergência exige **intervenção manual / reconciliador**, nunca reprocesso cego.

A família só recebe `status='publicado'` após **todas** as partições concluídas com **todos** os itens
**não-retirados** ativos (nenhuma em `compensacao_pendente` ou `erro`; filhos `retirado=true` são histórico e
não bloqueiam).

**Regra de agregação de estado (redução dos N filhos → estado da partição/família).** É uma **função
total**: cobre **todos** os combos possíveis de estado dos N filhos (nenhum combo fica sem resultado). A
redução opera **só sobre os filhos não-retirados** (`retirado=false`) — os filhos `retirado=true` são
**histórico** (cor pausada de propósito no ML) e ficam **fora** da agregação, sem contar como faltantes nem
como excedentes. Seja `A` = filhos não-retirados da partição e `E` = `skus_esperados`. O estado é derivado
**nesta ordem de precedência**:

0. **`mudando_composicao = true`** (mudança de composição em andamento) → partição `publicando` (**em
   transição**): enquanto o marcador transitório está ligado, os veredictos **terminais** abaixo
   (excesso→`erro` do caso 5, igualdade de conjunto→`ativo` do caso 8) **ficam suspensos**, porque a saga já
   reescreveu `skus_esperados` mas ainda não confirmou remotamente todas as criações/pausas — sem esse gate,
   a janela em que o conjunto de `A` ainda diverge de `E` produziria um `erro`/`ativo` espúrio;
1. senão, **`A` vazio** (raiz recém-criada, saga ainda não reservou nenhuma linha) com `E` não-vazio →
   partição `publicando` — **nunca `ativo` por vacuidade**: `every([]) === true`, mas a raiz é criada antes
   de os filhos existirem e nesse intervalo o grupo **não** está completo;
2. senão, **qualquer filho de `A` em `erro`** → partição `erro`;
3. senão, **qualquer filho de `A` em `compensacao_pendente`** → partição `compensacao_pendente`;
4. senão, **qualquer filho de `A` em `pendente`, `criado`, `criacao_incerta` ou `remocao_pendente`**
   (não-terminal, ainda subindo/em transição) → partição `publicando`;
5. senão, **excesso não explicado por retirada** — algum filho de `A` cujo SKU **∉ `E`** (um filho atual,
   não-retirado, com SKU fora do conjunto esperado — substituição/duplicata indevida, **não** uma cor
   retirada de propósito) → partição **`erro`**;
6. senão, **conjunto de SKUs de `A` `⊊` `E`** (os filhos que existem já são terminais, mas o worker ainda
   não reservou/criou todos os SKUs esperados — ex.: 7 de 9 por crash) → partição `publicando`;
7. senão (conjunto de SKUs de `A` `==` `E`, todos os filhos de `A` em estado **terminal** `ativo`/`pausado`),
   **mistura de `ativo` + `pausado`** → partição `parcial`;
8. senão, **todos os filhos de `A` `ativo` E conjunto de SKUs de `A` `==` `E`** → partição `ativo`;
9. senão, **todos os filhos de `A` `pausado`** → partição `pausado`.

(`criacao_incerta` e `remocao_pendente` entram no caso 4 como não-terminais em transição — nunca contam como
`ativo`, então nunca liberam `publicado`. A checagem `erro`/`compensacao_pendente` (casos 2–3) tem
precedência **sobre** a de conjunto: um filho em `erro` no meio de uma reserva incompleta continua sendo
`erro`, não `publicando`. O gate do caso 0 tem precedência sobre **tudo**: durante a mudança de composição a
divergência transitória de conjunto é esperada e nunca vira `erro`/`ativo`. **Corolário obrigatório:** como o
caso 0 mascara `erro`, o marcador `mudando_composicao` **precisa** ser limpo em **todo** desfecho terminal —
inclusive quando a composição **esgota e vira `erro`** — senão o gate deixaria a família presa em `publicando`
para sempre, escondendo o `erro`. Ver "Assimetria importante entre os dois marcadores transitórios" no
reconciliador de convergência.)

É esta redução que orienta o `familias.status`: **só o resultado `ativo`** (caso 8) libera
`familias.status='publicado'`, e **só** quando o **conjunto de SKUs dos filhos `ativo` não-retirados iguala
exatamente `skus_esperados`**. A família só pode virar `publicado` **quando a redução de todas as suas
partições dá `ativo`** — nunca com um filho em `erro`, `compensacao_pendente`, `publicando`, com conjunto
incompleto/excedente, ou parcialmente pausado (`parcial`).

### UPDATE permanece 100% `GET`-ao-vivo (não usa o cache)

O UPDATE **não** consulta `ml_formato_publicacao` nem nenhum formato persistido — detecta item UP pelo
`GET /items/{id}` ao vivo (`variations.length === 0 && family_name != null`), a fonte de verdade correta.
O ADR-0087 §6 **já rejeitou** persistir formato para uso no UPDATE (o ML pode migrar um item para UP depois
do CREATE; um flag desatualizado reintroduziria o **no-op silencioso** que o ADR-0084 corrigiu). Para UP:
estoque/preço por SKU vão em cada item filho (`{available_quantity, ...(somenteEstoque?{}:{price})}`).

**Mudança de composição (adicionar/retirar cor) é uma mini-saga transacional, simétrica ao resto do
desenho.** Adicionar ou retirar uma cor **muda o conjunto esperado** (`skus_esperados`) de uma família já
publicada — não basta disparar o CREATE/pausa e assumir sucesso; a ordem importa e um crash no meio precisa
ser retomável. A sequência é sempre:

1. **antes de qualquer chamada remota**, persistir na raiz, atomicamente, o **novo snapshot** `skus_esperados`
   (com a cor nova adicionada, ou a cor retirada removida do conjunto) **e** ligar o marcador transitório
   **`mudando_composicao = true`**. Enquanto esse marcador está ligado, a agregação lê a partição como
   `publicando` (caso 0) — a divergência transitória entre os filhos atuais e o novo `skus_esperados` é
   esperada e **não** vira `erro` nem `ativo`;
2. executar a mutação remota: **cor nova** — se o SKU **já existe** como linha `retirado=true` (uma cor
   retirada antes e agora readicionada), **reativar** o item existente (`atualizarStatus(..., 'ativo')`) e
   **limpar o flag** (`retirado=false`) — **não** um novo CREATE, que violaria `unique (anuncio_externo_id,
   sku)` e criaria um item duplicado no ML; se o SKU é **genuinamente novo** (nunca existiu), CREATE plano com
   o `family_name` da partição, exigindo o mesmo `family_id` (criar pausado → confirmar → ativar, como na
   saga). **Cor retirada** = `atualizarStatus(..., 'pausado')` do item daquela cor;
3. **confirmar por GET** (a cor nova ficou ativa com o `family_id` certo; a cor retirada ficou de fato
   pausada) — nunca "disparei o PUT/POST, logo está feito";
4. **só então** concluir a composição: para a cor retirada, ligar **`retirado = true`** na sua linha filha
   (só **depois** da pausa confirmada — nunca marcar retirado um item ainda ativo no ML); e **limpar
   `mudando_composicao` (`false`)**. A partir daí a agregação volta a valer normalmente: o conjunto dos SKUs
   não-retirados deve igualar o novo `skus_esperados`.

Um crash **entre (1) e (4)** deixa `mudando_composicao = true` **persistido e visível** — o **reconciliador de
convergência** (abaixo) retoma a operação em direção ao `skus_esperados` já gravado (criar/ativar os SKUs
esperados que faltam; pausar e marcar `retirado` os que saíram do conjunto), sem precisar reinferir a
intenção. A cor retirada **mantém a linha filha** como histórico (`retirado=true`), fora da agregação — por
isso retirar 1 cor de uma família de N deixa N-1 filhos não-retirados ativos, cujo conjunto **iguala** o novo
`skus_esperados` → a partição volta a `ativo`/`publicado` (caso 8), **nunca** fica presa em `parcial`.

### Reconciliador **de backfill** (idempotente, só leitura remota — GET)

`reconciliar-user-products/index.ts`: endpoint **administrativo** que, por `org_id`, importa **itens planos
pré-existentes** para o modelo novo — busca famílias com `ml_item_id` sem filho, faz **GET** do item, ignora
Legacy (`variations.length > 0`) ou item sem `family_name`, e faz upsert da raiz lógica (partição 0) + linha
filha. **Inicializa a expectativa junto:** grava **atomicamente** `skus_esperados = {SKU}` (conjunto de **1
elemento** — o SKU do item plano importado) na raiz, no **mesmo** upsert da raiz + linha filha. Sem isso a
agregação ficaria indefinida (a raiz teria filho mas `skus_esperados` vazio, e o único filho cairia no caso
5 — "excesso não explicado" — virando `erro` espúrio). **Só leitura remota: nenhum POST/PUT** — não altera
nada no ML. Segunda execução → `inseridos=0`.

### Reconciliador **de convergência** (mutável — PUT/`atualizarStatus`)

Componente **distinto** do de backfill (não confundir — este **muta** o remoto). Retoma as intenções
transitórias que a saga/UPDATE deixaram persistidas na raiz e **nunca** infere o alvo do estado parcial
observado. **Não** resolve o órfão sem ID (`criacao_incerta`): esse é da **própria saga** na sua próxima
execução (ver saga, passo 2), não deste reconciliador (que **só** trata filhos com `item_externo_id` já
existente). Trata dois tipos de intenção persistida:

- **`estado_desejado='ativando'`** (grupo em `compensacao_pendente`, filhos já com `item_externo_id`) →
  reativar os que faltam até **todos** os filhos não-retirados `ativo` **e** o conjunto de SKUs desses filhos
  igualar `skus_esperados`; se **esgotar as tentativas** sem convergir, o resultado é **`erro`** (intervenção
  manual) — **nunca** pausar o grupo de volta;
- **`estado_desejado='pausando'`** → pausar os que ainda estão ativos até **todos** pausados;
- **`mudando_composicao=true`** (mudança de composição interrompida por crash) → convergir para o
  `skus_esperados` **já gravado**: criar/ativar os SKUs esperados que ainda faltam (via a mesma busca por
  `seller_custom_field` da saga, para não duplicar um item já criado) e pausar+marcar `retirado=true` (após
  confirmar por GET) os filhos cujo SKU **saiu** do conjunto esperado; ao confirmar (conjunto dos não-retirados
  `==` `skus_esperados`, todos ativos), **limpa `mudando_composicao`**; se **esgotar as tentativas**, marca o
  grupo **`erro`** **e limpa `mudando_composicao` no mesmo passo** (obrigatório — ver assimetria abaixo).

Só o alvo `pausando` leva o grupo a "todo pausado"; um `ativando` que não converge **jamais** vira pausado —
vira `erro`. Ao confirmar o estado terminal correspondente, o reconciliador **limpa a intenção transitória**
(`estado_desejado` setado `null`; `mudando_composicao` setado `false`) atomicamente, para não confundir uma
reconciliação futura com uma intenção antiga.

**Assimetria importante entre os dois marcadores transitórios.** `estado_desejado` **não** é um gate da
agregação — uma intenção obsoleta não presa não mascara estado nenhum, só confundiria uma reconciliação
futura. Já `mudando_composicao` **é** o gate do caso 0 (lê `publicando`, com precedência sobre `erro`);
portanto um `mudando_composicao=true` obsoleto **ativamente esconde** um `erro`. Por isso o desfecho
**esgotou→`erro`** de uma mudança de composição **precisa limpar `mudando_composicao`** ao carimbar o `erro`
— senão o gate do caso 0 continuaria lendo `publicando` e o `erro` (caso 2) nunca apareceria, deixando a
família presa em `publicando` para sempre. `mudando_composicao` é limpo em **todos** os desfechos terminais
(convergiu **ou** `erro`), não só no "correspondente".

Tem gatilho e política de retry com backoff próprios. É este — não o de backfill — o "reconciliador" citado
no passo 8 da saga e na mini-saga de composição.

### Remoção de família UP — pausar **todos** os filhos no ML, depois deletar local em cascata (comportamento **novo**)

**Estado verificado (lido o arquivo real):** `remover-publicado` (via `lote/exclusao.ts`) **não** chama o
conector/ML hoje — só executa `delete` local em `familias`/`anuncios_externos` + storage, **zero** chamada
remota. A afirmação anterior da ADR ("mesma semântica de hoje, estendida") estava **errada**. Portanto o que
segue é **comportamento novo**, **escopado só a famílias UP**: o Legacy continua com o delete direto de hoje
(sem nenhuma chamada ao ML) — **fora de escopo deste ADR, intocado**.

Para família UP, remover vira uma **mini-saga simétrica à criação** — não basta disparar o PUT de pausa e
assumir sucesso:

1. para cada filho, **pausar no ML** (`atualizarStatus(..., 'pausado')` por SKU) **e confirmar por GET** que
   o item ficou de fato pausado — nunca "disparei o PUT, logo está pausado";
2. **só depois de TODOS confirmados pausados**, rodar o delete local — que apaga a raiz `anuncios_externos`
   e, por `on delete cascade`, as linhas filhas de `anuncios_externos_itens` normalmente (igual ao delete em
   cascata do Legacy hoje);
3. **se algum filho falhar** ao pausar/confirmar, persistir `remocao_pendente` e **preservar TODAS as linhas**
   (raiz e filhas) — **nunca** deletar parcialmente, para não deixar um item ainda ativo no ML sem vínculo
   local — até retry/reconciliação. Pausar 3 de 4 e deletar mesmo assim deixaria um órfão ativo: proibido.

**Nunca** deletar item no ML: o histórico/"tombstone" fica **do lado do Mercado Livre** — o item permanece
pausado lá, nunca deletado — **não** como linha preservada no banco. Não há soft-delete nem exceção à FK
cascade; o delete local só roda quando **todos** confirmados pausados, e o `on delete cascade` da tabela
filha permanece como está.

## Alternativas consideradas

- **Repetir a lista estática do ADR-0084 (`CATEGORIAS_QUE_EXIGEM_FAMILY_NAME`) para cada categoria nova
  multi-cor:** rejeitada — é o status quo que o ADR-0087 já aposentou para o CREATE; não escala com
  catálogo genérico e reintroduz o ciclo "incidente → ADR → deploy" por categoria.
- **Persistir o formato só na família (`familias.formato_publicacao_ml`), sem chave conexão+categoria:**
  rejeitada — já descartada no ADR-0087. O formato é comportamento **da conta+categoria**, não da família;
  guardá-lo na família ficaria desatualizado se o ML migrar o item, e usá-lo no UPDATE reintroduziria o
  no-op silencioso. O cache aqui é conexão+categoria e **só orienta CREATE**.
- **Remover o retry de 1 cor do ADR-0087 e emitir sempre `FORMATO_INCOMPATIVEL` na 1ª falha (Task 3 do
  plano original):** rejeitada — regressão desnecessária. Empurraria toda decisão de retry ao chamador, mas
  `publicar-anuncio/processar.ts:148` (3º caller, não adaptado à saga) perderia o retry e o caso de 1
  variável voltaria a falhar. Mantém-se o retry; a saga só entra com `variacoes.length > 1`.
- **Lista de deploy fixa no plano/ADR (Task 9 do plano original):** rejeitada — o ADR-0087 sofreu overwrite
  silencioso por isso. Deploy sempre por blast radius recalculado (`deno info`), ver §1.
- **Mover variação entre itens no UPDATE em vez de pausar cor retirada:** rejeitada pela mesma razão do
  ADR-0078 (mover = deletar+recriar, perde histórico/vendas/perguntas). Compensação e retirada **pausam**.

## Consequências

- **Boas:** famílias multi-cor em categorias UP publicam como um único produto lógico (1 UPP, N cores),
  fechando a lacuna deixada por 0084/0087. Partição comercial (faixa de preço) e retry de 1 cor **intocados**.
  Vendas/moderação/status/faturamento passam a atribuir corretamente **todas** as cores (§2). Backfill
  idempotente traz os itens planos já existentes para o novo modelo sem tocar o remoto.
- **Riscos / tradeoffs aceitos:**
  - **Atomicidade emulada:** o ML não oferece transação sobre N POSTs; a saga usa "criar pausado → confirmar
    → ativar; em falha, **pausar-tudo como ação de compensação segura**" para garantir "tudo ou nada visível".
    Falha parcial nunca deixa a família local como `publicado`; a compensação **pausa** os itens conhecidos
    (ação segura — nunca órfãos ativos), mas pausar é a **ação**, nunca o **estado terminal**: o terminal
    segue a classificação (crash de criação → `criacao_incerta`/retry; ativação parcial →
    `compensacao_pendente`; ativação que não converge ou estado remoto inesperado → **`erro`**, nunca
    `pausado`). Ativação parcial não-atômica é convergida pelo reconciliador **sempre para o `estado_desejado`**
    (um `ativando` que esgota tentativas → **`erro`**, **nunca** pausa automática de volta).
  - **`family_id` divergente** entre itens (o ML pode agrupar diferente do esperado) trava a ativação —
    preferível a publicar um grupo quebrado.
  - **Redefinição de `familias.ml_item_id`** (§5): mudança semântica com blast radius amplo — mitigada por
    apontar para o 1º item da partição 0 (compat com leitores single-value) e enumerar consumidores.
  - **Correção financeira (§2) é pré-requisito:** se os `index.ts` de escopo não forem adaptados no mesmo
    go-live, as cores 2..N geram vendas não atribuídas — por isso entram juntas, não depois.
  - **Concorrência/idempotência do pipeline inteiro** (publicação simultânea da mesma família) segue sendo
    risco pré-existente (ADR-0087 §"fora de escopo"); a saga reduz janela por reservar linha filha, mas não
    introduz lock global novo.
- **Como reverter:** manter as tabelas (não destrutivas), rotear apenas `variacoes.length === 1` e Legacy
  pelo caminho de hoje, e desligar a saga UP multi-cor — volta ao comportamento pré-ADR (multi-cor UP
  falha alto em `montarPayloadItem`, como hoje). O retry de 1 cor do ADR-0087 nunca depende deste ADR.

## Implementação prevista (para quando for codificada)

Segue o esqueleto do plano `docs/superpowers/plans/2026-07-22-publicacao-legacy-user-products.md`, com as
correções acima aplicadas:

- **Migration** `anuncios_externos_itens` + `ml_formato_publicacao` (RLS org-scoped copiada de
  `anuncios_externos`; escrita `service_role`; cache legível quando a conexão for de `current_org_id()`).
  Inclui, em `anuncios_externos`: nova constraint `unique (id, org_id)` (base da FK composta da filha), nova
  coluna `estado_desejado` (`ativando`|`pausando`, nulável, limpa ao confirmar o estado terminal), nova coluna
  **`skus_esperados`** (`jsonb`/`text[]` — snapshot do conjunto de SKUs esperados, **não inteiro** —, gravado
  antes de a saga criar itens e reescrito a cada mudança de composição; agregação e reconciliador exigem
  **igualdade de conjunto** entre os SKUs dos filhos `ativo` **não-retirados** e `skus_esperados` para aceitar
  `ativo`) e nova coluna **`mudando_composicao`** (booleana `default false` — marcador transitório de mudança
  de composição, que faz a partição ler `publicando` enquanto ligada). A filha `anuncios_externos_itens`
  ganha a coluna **`retirado`** (booleana `NOT NULL default false` — cor removida, item pausado no ML e linha
  preservada como histórico, excluída da agregação), usa **FK composta**
  `(anuncio_externo_id, org_id) references anuncios_externos(id, org_id) on delete cascade` (não trigger/CHECK)
  e o `check status in (...)` inclui `criacao_incerta` e `remocao_pendente`.
- **`ml/formato-publicacao.ts`**: `FormatoPublicacaoML`, `lerFormatoPublicacao`/`confirmarFormatoPublicacao`
  (cache conexão+categoria, só CREATE). `AnuncioCanonico.formato?`, `ErroCanalCodigo` += `FORMATO_INCOMPATIVEL`.
- **`canais/mercado-livre.ts` (`criarAnuncio`)**: retry de 1 cor **como está**; para `variacoes.length > 1`
  em formato UP, emitir `FORMATO_INCOMPATIVEL` (não lançar) e deixar a orquestração acionar a saga. Mapear
  resposta UP (`user_product_id`, `family_id` normalizado com `String()`, `status`).
- **`user-products/publicar-grupo.ts`**: a saga (portas: `listar/reservar/buscarPorSku/salvarCriado/
  salvarStatus/criarPlano/confirmar/mudarStatus`), ancorando a linha filha por `(anuncio_externo_id, sku)`,
  com o algoritmo de passos acima (grava `skus_esperados` na raiz **antes** de criar itens; marca
  `criacao_incerta` **antes** do POST; grava `estado_desejado` antes de qualquer ativação/pausa em lote e o
  **limpa ao confirmar o estado terminal**; busca órfão via
  `GET /users/{seller_id}/items/search?sku=<seller_custom_field>` — `sku` é o **único filtro server-side**;
  `category_id`/`family_name`/seller/janela validados via multiget dos IDs retornados, com paginação
  `paging.total`/`offset` limite 100; resultado ambíguo/truncado bloqueia adoção → `erro` manual) e a matriz
  de testes (9 SKUs OK; falha no SKU 8 pausa os 7 já criados como ação de compensação; reserva parcial 7 de 9
  **não** vira `ativo` — conjunto de SKUs de `A` `⊊` `skus_esperados` fica `publicando`; retry cria só 2;
  **item órfão encontrado por
  `seller_custom_field` é adotado, não duplicado**; linha em `criacao_incerta` é reprocessada pela própria
  saga, não pelo reconciliador; `family_id` divergente pausa todos; **ativação parcial → `compensacao_pendente`**;
  **`ativando` que esgota tentativas → `erro`, nunca pausar tudo**; **filho não-retirado com SKU ∉
  `skus_esperados` (excesso não explicado) → `erro`**; **retirar 1 cor de família publicada de N: reescreve
  `skus_esperados`, pausa+`retirado=true` a cor, os N-1 não-retirados voltam a `ativo`/`publicado` — nunca
  preso em `parcial`**; **crash no meio da mudança de composição deixa `mudando_composicao=true`, retomado
  pelo reconciliador**; estado remoto inesperado → `erro` sem retry cego).
- **`publicar-split-ml` / `publish-familia-ml`**: upsert da raiz por `(org_id, canal, codigo_pai, particao)`
  (§4) com `status='publicando'`; roteamento por formato (cache → tentativa Legacy → em `FORMATO_INCOMPATIVEL`,
  confirmar formato e chamar a saga); persistir sucesso (`ml_item_id` = 1º item da partição 0, §5;
  `variacoes.ml_variation_id=null` em UP).
- **`ml/atualizar-item.ts` / `update-familia-ml`**: UPDATE por item filho, 100% `GET`-ao-vivo (não usa
  cache). Inclusão/retirada de cor pela **mini-saga de composição** (ver "UPDATE"): reescreve `skus_esperados`
  + liga `mudando_composicao` **antes** da chamada remota; cria/pausa; confirma por GET; só então liga
  `retirado=true` na cor retirada e limpa `mudando_composicao` — crash no meio é retomado pelo reconciliador
  de convergência.
- **Consumidores de escopo (§2)**: os **três** `index.ts` (`metricas-vendas`, `monitorar-moderados`,
  `status-publicados` — este último já unindo `item_externo_id`) passam a montar o escopo por todos os
  `item_externo_id` filhos; `faturamento/io.ts` e `moderacao/diff.ts` só incluem os filhos nos mapas
  existentes; `atualizar-status-publicado` ganha a guarda de correção (§2) verificando que o `ml_item_id`
  pertence a um registro local da org antes do PUT.
- **`reconciliar-user-products/index.ts`**: backfill idempotente, só GET; grava atomicamente
  `skus_esperados = {SKU}` (conjunto de 1 elemento) junto da raiz + linha filha que cria.
- **Reconciliador de convergência** (componente próprio e **distinto** do backfill — este **muta** o remoto
  via PUT/`atualizarStatus`): precisa de **entrypoint** dedicado, **autenticação/agendamento** (ex.: cron
  periódico ou trigger administrativo) e **política de retry com backoff**. Retoma as intenções transitórias
  **persistidas** na raiz (nunca inferidas): grupos em `compensacao_pendente` pelo `estado_desejado`, e
  mudanças de composição interrompidas pelo marcador `mudando_composicao`. Critérios de aceite para os
  desfechos: (a) **convergiu para `ativo`** (alvo `ativando`; todos os filhos não-retirados ativos **e**
  conjunto de SKUs `==` `skus_esperados`; família liberada a `publicado`; intenção transitória limpa);
  (b) **convergiu para `pausado`** (alvo era **`pausando`**; todos os filhos pausados; `estado_desejado`
  limpo); (c) **convergiu a composição** (`mudando_composicao`: SKUs esperados que faltavam criados/ativados
  — reusando a busca por `seller_custom_field` para não duplicar — e SKUs que saíram do conjunto
  pausados+`retirado=true`; conjunto dos não-retirados `==` `skus_esperados`; `mudando_composicao` limpo);
  (d) **esgotou as tentativas** → marca o grupo `erro` e sinaliza intervenção manual (mesma regra de estado
  remoto inesperado da saga) — **é aqui que cai um `ativando` que não conseguiu ativar todos: `erro`, nunca
  "pausar tudo"**. **Não** trata `criacao_incerta` (órfão sem ID) — isso é da saga.
- **Deploy (§1)**: blast radius recalculado por `deno info`, união de todos os importadores dos módulos
  `_shared/` tocados, `verify_jwt` preservado, versão +1 conferida pós-deploy. **Sem lista fixa.**

## Validação (critérios de aceite — nada implementado ainda)

A ADR está **aceita como decisão de design**, mas **nada foi implementado ainda** — a validação abaixo é
**critério de aceite futuro** (derivado do Final Review Checklist do plano), não resultado real:

- **1 cor**: publica em Legacy e em UP, **sem** regressão do retry do ADR-0087 (mesmo POST/retry de hoje).
- **PAI `03103331`, `MLB419782`, 9 cores** (caso disparador): 1 linha lógica (partição 0), **9 linhas
  filhas**, 9 item IDs, **um único `family_id`**, 9 opções de cor na mesma UPP, preço uniforme em todas;
  família e lote marcados `publicado` **somente após os 9 itens ativos** (conjunto de SKUs dos filhos ativos
  não-retirados `==` `skus_esperados`);
  **retry não duplica quando a busca por `seller_custom_field` confirma o item**; ausência momentânea
  (consistência eventual do ML logo após o crash) mantém a linha em `criacao_incerta` e é resolvida por
  **retry com backoff da própria saga** (na próxima execução via QStash/"Reenviar", refazendo a busca por
  SKU antes de recriar) — ao **esgotar as tentativas**, vira **`erro`/intervenção manual**, **nunca** o
  **reconciliador de convergência** (que só trata filhos com `item_externo_id` já existente). **Não há
  garantia absoluta de zero POST extra em toda condição de corrida.**
- **N cores, dois preços**: duas partições comerciais distintas (ex. `[7, 2]`), cada uma com seu
  `family_name`; nenhuma mistura de faixa numa mesma UPP.
- **Falha parcial**: nunca deixa a família local como `publicado`; a compensação **pausa** todos os itens
  conhecidos como **ação segura** (nunca órfão ativo), mas uma ativação (`estado_desejado='ativando'`) que
  **esgota as tentativas** termina em **`erro`**, **nunca** em `pausado` automático; `family_id` divergente
  bloqueia ativação.
- **Remoção UP**: pausa cada filho e **confirma por GET** antes de qualquer delete; com todos confirmados
  pausados, delete local em cascata; se um filho falhar ao pausar, grava `remocao_pendente` e **preserva
  todas as linhas** (nada deletado localmente, nenhum item ativo órfão no ML).
- **UPDATE reversível** (UP): bump de estoque de uma cor → UPDATE → confirmar por GET → reverter → confirmar;
  resolvedor de venda atribui a cor certa por `item_externo_id` (fixture de pedido, sem fabricar venda real).
- **Retirar cor de família publicada** (prova da correção-chave): família UP de 9 cores `publicado` → retirar
  1 cor via UPDATE → `skus_esperados` reescrito para 8 SKUs, a cor retirada pausada no ML + `retirado=true`
  (só após confirmar a pausa por GET) → a família **permanece `publicado`** com os 8 filhos não-retirados
  ativos (conjunto `==` `skus_esperados`), **nunca** presa em `parcial`; o filho retirado fica como histórico,
  fora da agregação. **Adicionar cor**: `skus_esperados` reescrito para 10, CREATE plano com o mesmo
  `family_id`, família volta a `publicado` só com os 10 ativos.
- **Mudança de composição interrompida** (crash-safety): crash entre reescrever `skus_esperados` e confirmar
  a mutação deixa `mudando_composicao=true` persistido → a partição lê `publicando` (não `erro`/`ativo`
  espúrio) → o **reconciliador de convergência** retoma em direção ao `skus_esperados` gravado e limpa o
  marcador ao confirmar.
- **Excesso não explicado** (regra de segurança): um filho não-retirado com SKU **∉ `skus_esperados`** (fora
  de uma janela de composição) → partição `erro`, nunca `ativo` — distinto de um filho `retirado=true`, que é
  histórico esperado e ignorado.
- **Escopo financeiro (§2)**: venda/moderação/status de uma cor 2..N (não a 1ª) é atribuída à família, não
  vira "externa" nem fica invisível.
- **Backfill**: 1ª execução insere itens planos existentes (lote #36; PAI `02638290` do lote #37) **com
  `skus_esperados = {SKU}` gravado junto** (agregação da raiz backfillada dá `ativo`, não `erro` por conjunto
  esperado vazio); 2ª execução `inseridos=0`; nenhum item Legacy alterado; nenhum POST/PUT remoto.
- **Legacy**: nenhuma mudança observável.
- **Deploy**: todas as functions do blast radius recalculado confirmadas com versão +1; nenhuma feature
  não relacionada sobrescrita (lição do ADR-0087).
