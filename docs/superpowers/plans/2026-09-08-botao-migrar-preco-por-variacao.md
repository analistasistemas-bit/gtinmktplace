# Plano v2 — Botão "Migrar para preço por variação" no PubliAI (ADR-0161 proposto)

**Data:** 2026-09-08
**Branch:** `worktree-botao-migrar-pxv`
**Revisão independente:** Fable — **REPROVADO** na v1; esta v2 aplica o redesenho. Achados
confirmados no código antes de reescrever estão marcados **[v1 errado]**.
**Origem:** Diego, ao ver o passo a passo de validação do ADR-0160: *"faz o botão no PubliAI então,
não faz sentido estar fazendo isso em dois lugares"*. Revoga a §4 do
[ADR-0160](../../decisions/0160-preco-por-variacao-sob-user-products.md).

---

## 1. O que muda em relação ao ADR-0160

O ADR-0160 §4 decidiu que a migração seria disparada no painel do ML, e não pelo app. A
justificativa (irreversível, decisão comercial) continua válida — o que muda é **onde a decisão é
tomada**: um botão com confirmação explícita é tão deliberado quanto clicar no painel, e evita o
fluxo partido em dois sistemas.

**[v1 errado] O ganho que eu havia anunciado não se sustenta como estava.** A v1 afirmava que o
casamento cor→anúncio-novo via `new_items[].variation_id` seria "determinístico" e eliminaria o
risco da adoção. Dois furos:

1. **A fonte é inverificável hoje.** O contrato de `migration_live_listing` veio de uma leitura da
   doc que agora responde 403; não há cópia no repositório. O ADR-0105 registra que a forma real da
   migração **já divergiu da doc uma vez** (o ML não copiou `seller_custom_field`; `?family_name=`
   foi ignorado). Tratar isso como certeza antes do primeiro run real repete o erro que o ADR-0104
   §2 mandou não repetir.
2. **`ml_variation_id` local tem buracos:** variação excluída da publicação continua viva no ML com
   id preenchido; variação apagada no painel deixa o id stale; e em família dividida os ids apontam
   para **itens diferentes**.

**O ganho real do botão é outro:** o app controla o instante do disparo, então pode **tirar um
snapshot do item antes de migrar** — `variations[]` com `id`, `seller_custom_field` e `COLOR`. Esse
snapshot não depende do que o ML fizer com o item encerrado nem do estado local, e alimenta **os
dois** caminhos de casamento (por `variation_id` e por cor, ADR-0105). É isto que remove o risco,
não o `variation_id` sozinho.

---

## 2. Contratos do ML (doc oficial via scraper; o site devolve 403 a fetch simples)

### 2.1 Elegibilidade
```
GET /items/{ITEM_ID}/user_product_listings/validate
→ { "is_valid": true, "cause": [ { "code": 0000, "message": "...", "reference": "item.xxx" } ] }
```
Pré-condições documentadas: `user_product_id` não-nulo; não ser UP duplicado; item **multivariante**.
**Não documentado:** catálogo real de `cause`; status HTTP.

### 2.2 Disparo
```
POST /sites/MLB/items/user_product_listings     body: { "item_id": "MLB1234" }  → 200
```
Um item por chamada. **Não documentado:** corpo da resposta; id de acompanhamento; **idempotência**;
erros além do 200. ⚠️ **A doc só mostra `/sites/MLM/`** — `/sites/MLB/` é inferência (R-3).

### 2.3 Acompanhamento
```
GET /items/{ITEM_ID}/migration_live_listing
→ 200 { item_id, migration_completed, activation_completed, date_created, last_updated,
        new_items: [ { new_item_id, variation_id, migration_status: "pending"|"created" } ] }
→ 404
```
`activation_completed` preenchido = filhos ativados **e** pai fechado; é o único sinal definitivo.
**Sem estado de falha documentado. Sem webhook de conclusão. Sem cancelamento ou reversão. Sem SLA.**

---

## 3. Decisões

1. **Botão na Publicados**, linha do produto, **admin-only** (`useProfile().isAdmin`, gate do
   ADR-0060), com **diálogo de confirmação** dizendo o que é irreversível (§7).
2. **[v1 errado] Estado na raiz `anuncios_externos` (partição 0), não em `familias`.** Há N linhas em
   `familias` por `codigo_pai` (uma por lote): a Publicados entrega a **mais antiga**
   (`src/lib/publicados.ts:82-101`), enquanto `ingest-lote` e `sincronizar-estoque` usam a **mais
   nova** — estado gravado na família do botão seria invisível para metade do sistema. A raiz é única
   por `(org_id, canal, codigo_pai, particao)` e já carrega os marcadores transitórios do ADR-0088.
   Colunas novas: `migracao_pxv_status` (`solicitada`|`em_andamento`|`erro`), `migracao_pxv_erro`,
   `migracao_pxv_solicitada_em`, `migracao_pxv_tentativa`, `migracao_pxv_snapshot jsonb`,
   `ml_item_id_anterior`.
3. **Snapshot antes do POST.** `GET /items/{id}` e gravação de `variations[]` (`id`,
   `seller_custom_field`, `COLOR.value_name`) em `migracao_pxv_snapshot`, **antes** de qualquer
   escrita no ML.
4. **Casamento em cascata**, nesta ordem — e **nenhum degrau usa busca por título enquanto houver
   `migration_live_listing`**:
   - **(a)** `new_items[].variation_id` → `id` do snapshot → `seller_custom_field` → SKU.
   - **(b)** falhando (a), **multiget dos `new_items[].new_item_id`** e casamento de
     `COLOR.value_name` contra o snapshot. Continua usando **só ids que o ML atribuiu a este item**.
   - **(c)** `?q=<título>` (`descobrirFamiliaUP`) **apenas** se `migration_live_listing` devolver 404
     ou vazio com o original já `closed`, e a mensagem diz que a descoberta foi por título.
   - **(d)** aborta tudo-ou-nada.

   Motivo de rebaixar o `?q=` para último recurso: `descobrir-familia-up.ts:8` localiza por título e
   valida `family_id` único. Se a família verdadeira não vier no `?q=` **mas vier uma família irmã do
   mesmo vendedor com o mesmo título e as mesmas cores** (produto irmão já migrado, republicação
   antiga, variante de gramatura), a validação passa, o casamento por cor fecha 1:1 e a adoção grava
   **os itens de outro produto**. Casar errado é pior que abortar.

   Três travas adicionais, todas antes de qualquer escrita:
   - snapshot com `seller_custom_field` **null** → tenta `variation_id` → `variacoes.ml_variation_id`
     local → `codigo` (ids do mesmo item, sem ambiguidade); falhando, aborta;
   - **COLOR duplicada** no snapshot → aborta (a cor é a única chave do degrau (b); duplicada é
     ambígua — mesma exigência do ADR-0105);
   - `normalizarCodigo` ao casar `seller_custom_field` com `variacoes.codigo` (padrão de
     `reconciliar.ts:25`; sem isso `02186560` vs `2186560` vira "não encontrado").

   As validações remotas do ADR-0104 (`seller_id` da conexão, sem `_pending`, `family_id` único)
   continuam intactas em **todos** os degraus — o mapa decide **quem** confirmar, nunca dispensa a
   confirmação.
5. **[v1 não tratava] O gatilho recusa** quando: mais de uma partição em `anuncios_externos` para o
   pai (§6, R-1); qualquer família do pai em `publicando`; o item aparece em
   `kits_virtuais_componentes`; a família não é da org do chamador (o molde
   `atualizar-status-publicado` **não** checa isso — copiar o molde copiaria o buraco); **a raiz da
   partição 0 não existe** (`espelharAnuncioExterno` é best-effort, `espelhar.ts:95-116`: família
   antiga pode não ter raiz, e sem ela não há onde guardar o estado — fail-closed, não criar a raiz
   no gatilho); **`raiz.item_externo_id` diverge** do `ml_item_id` da família ou do da família mais
   nova do pai (a que `ingest-lote:141-151` usaria) — divergência é estado local incoerente, e migrar
   em cima dele adota no lugar errado.

   O job do worker carrega `{org_id, codigo_pai}`, nunca `familia_id`: a raiz é única por
   `(org_id, canal, codigo_pai, particao=0)`, enquanto `familia_id` é ambíguo por lote.
6. **Claims atômicos**, não check-then-set: disparo com
   `update … set migracao_pxv_status='solicitada' where … and migracao_pxv_status is null returning`
   (molde: `publicar-familias/index.ts:48-56`); worker com claim por `migracao_pxv_tentativa`
   (molde: `reconciliar_convergencia_claim`).
7. **Pós-adoção obrigatório**, tudo dentro do worker: **vínculo de catálogo**
   (`enfileirarVinculacaoCatalogo`), **reset de `atacado_status`**, limpeza do estado (menos o
   snapshot, §9) e notificação em `integracao`.

   **Push de estoque com trava anti-oversell.** Empurrar o saldo local absoluto logo após a adoção é
   perigoso: se houve venda **no clone** antes de o app reconhecê-lo, o webhook chega com um
   `item.id` que ainda não está em `idsPubliai`, o `codigo` só sairia do `seller_custom_field` do
   pedido — e o ADR-0105 observou que o ML **não copiou** o SKU nos itens novos. Sem SKU não há baixa
   local, o saldo local fica **alto demais**, e o push **restauraria unidades já vendidas** (o
   oversell que `reconciliar-estoque/index.ts:1-9` descreve).

   Regra: por SKU, comparar o saldo local com o `available_quantity` **vivo** do clone (o worker já
   faz GET em cada um para confirmar) e **empurrar só se `saldo_local ≤ vivo`**. Se
   `saldo_local > vivo`, **não empurra** aquele SKU e notifica ("possível venda no anúncio novo ainda
   não registrada — confira o pedido"). Venda no **original** durante a migração é baixada
   normalmente (aquele id está em `idsPubliai`), então `local ≤ vivo` é o caso legítimo.
8. **Guard local no `update-familia-ml`**: com a raiz em `solicitada`/`em_andamento`, o UPDATE falha
   **definitivo** com mensagem própria, antes do GET — em vez de queimar 10 retries de 30s na fila
   serial da org contra o guard `MIGRACAO_EM_ANDAMENTO` (retentável) entregue no ADR-0160.

   **O mesmo guard vale para as outras ações da linha**, que não passam pelo `MIGRACAO_EM_ANDAMENTO`:
   `atualizar-status-publicado` (Pausar/Reativar), `remover-publicado` e `excluir-produto`. Um PUT de
   status no original durante a migração é indocumentado, e o encerramento pelo ML pode colidir com
   um `paused` nosso. Na UI, os botões correspondentes ficam desabilitados durante a migração.

---

## 4. Invariantes

| # | Invariante |
|---|---|
| J1 | Disparo só com `is_valid: true`; `false` → 400 repassando as causas, nada enviado |
| J2 | Admin-only (ou suporte `full`), auditado, **e com a família pertencendo à org do chamador** |
| J3 | Um disparo por pai, garantido por **claim atômico** — clique duplo/dois admins não disparam duas migrações |
| J4 | Snapshot e estado gravados **antes** do POST; falha na chamada deixa `solicitada`, nunca "nada aconteceu" |
| J5 | Adoção só com `activation_completed`; `migration_completed` sozinho não basta |
| J6 | Casamento em cascata sem busca por título enquanto houver `migration_live_listing`; falhando todos, aborta tudo-ou-nada nomeando os SKUs. **Teste obrigatório do caso que hoje casaria errado:** família irmã do mesmo vendedor, mesmo título e mesmas cores — tem que casar certo (pelos `new_item_id`) ou abortar, nunca adotar os itens do irmão |
| J7 | Orçamento finito **em horas**; esgotado → `erro` + notificação. Nunca loop, nunca silêncio |
| J8 | Família em migração não publica: guard local definitivo no UPDATE, e gatilho recusa família `publicando` |
| J9 | Concluída a adoção: catálogo reenfileirado, `atacado_status` resetado, estado limpo (**menos o snapshot**), e push de estoque **só nos SKUs em que `saldo_local ≤ vivo`** — divergência notifica, nunca escreve |
| J13 | Pausar/Reativar, Remover e Excluir recusam enquanto a raiz estiver em `solicitada`/`em_andamento` — na edge function, não só na UI |
| J14 | `idsPubliai` inclui `ml_item_id_anterior`, e `codPorVar` recebe `"{anterior}:{variation_id}" → sku` do snapshot: pedido antigo reprocessado continua sendo do PubliAI e resolve o produto por `variation_id`, sem depender do SKU vir no pedido |
| J10 | Família **dividida** (mais de uma partição) nunca migra pelo botão — a RPC de adoção zeraria `ml_variation_id` da partição viva |
| J11 | Produto que é componente de **kit virtual** nunca migra pelo botão |
| J12 | `emMigracao` devolvido pela adoção é **retry**, não `erro` — a tag `_pending` e `activation_completed` podem não cair juntos |

---

## 5. Fases

**F0 — Migration.** Colunas da §3.2 na raiz `anuncios_externos`, com CHECK. Fluxo canônico
(ADR-0043) + `npm run db:check`.

**F1 — Cliente ML** (`_shared/ml/migracao-pxv.ts`): `validarElegibilidadeUPtin`, `dispararUPtin`,
`lerStatusUPtin`, puros sobre `fetchLike`. 404 do status = "ainda não", não erro.

**F2 — Edge function `migrar-preco-por-variacao`** (`verify_jwt = true`): gate admin + ownership +
auditoria; recusas da §3.5; `validate`; **snapshot**; claim atômico; POST; enfileira o worker.

**F3 — Worker `acompanhar-migracao-pxv`** (`verify_jwt = false`): assinatura QStash; claim por
tentativa; lê status; em andamento e com orçamento → re-enfileira com backoff — **longo (horas) antes
de `migration_completed`, curto (30 s–2 min) depois dele**, para encurtar a janela em que o clone já
existe e o app ainda não o reconhece; `activation_completed` → casamento em cascata →
`familyNameObservado` via GET num clone → adoção → pós-adoção (§3.7); `emMigracao` devolvido pela
adoção é **retry**, não `erro` (J12); orçamento esgotado → `erro` + notificação.

**F3b — Enxerto no faturamento** (`_shared/faturamento/io.ts:82-86`, único construtor de
`idsPubliai`, consumido por `sync-venda`, `reconciliar-faturamento`, `backfill-faturamento` e
`sync-devolucao`): soma `anuncios_externos.ml_item_id_anterior` da org ao conjunto, e popula
`codPorVar` com `"{anterior}:{variation_id}" → sku` a partir do snapshot. `metrics-repository.ts` e o
platform-admin leem linhas de `vendas` já persistidas (`is_publiai` gravado no upsert) — **nada a
fazer lá**.

**F4 — Frontend:** hook (molde `usePausarReativarPublicado`), botão + `AlertDialog` em
`Publicados.tsx`; escondido quando dividido, kit virtual, não-admin ou já migrado; desabilitado
durante a migração, com rótulo "migração em andamento".

**F5 — Documentação:** ADR-0161 (revoga a §4 do 0160; registra as hipóteses e perdas da §7);
`edge-functions.md`; `modelo-de-dados.md`; `TASKS.md`; `Sprint Atual.md`; índice de ADRs; e o
**roteiro de validação do ADR-0160**, que passa a ser "clique no botão".

---

## 6. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R-1 | **Família dividida** — a RPC de adoção (`20260806010922…sql:94-103`) zera `ml_variation_id` de toda a família, inclusive das cores que vivem no anúncio da partição viva; o UPDATE seguinte as trataria como novas e **duplicaria variações num anúncio real** | J10: gatilho recusa e UI esconde. Beco já registrado no ADR-0160 |
| R-2 | **Contrato de `migration_live_listing` não verificado** | Snapshot + cascata (J6): o casamento não depende só dele |
| R-3 | **`/sites/MLB/` é inferência** | Mensagem de erro do primeiro uso precisa dizer que o endpoint pode exigir outro site |
| R-4 | **Idempotência do POST não documentada** | J3 (claim atômico) + J4 + nunca repetir POST automaticamente |
| R-5 | **Sem estado de falha na API** | J7: orçamento em horas → `erro` + notificação |
| R-6 | **Estoque durante a janela** — o original segue ativo e vendável; os clones nascem com o saldo anterior, e o push falha enquanto migra | J9: push de estoque absoluto logo após a adoção |
| R-7 | **Adoção falha com o original já encerrado** | Cascata; se ainda assim falhar, a família cai em `erro` e o caminho automático do **ADR-0105** (descoberta por título) segue disponível no próximo UPDATE |
| R-8 | **Sem sandbox** | Anúncio de teste de baixo risco; nunca o Oxford |

---

## 7. Consequências que o operador precisa aceitar (vão no diálogo e no ADR)

1. **Irreversível.** O anúncio atual é encerrado; não há como desfazer.
2. **Os pedidos já feitos ficam no anúncio encerrado.** Além disso, um re-sync futuro daqueles
   pedidos deixaria de reconhecê-los como "do PubliAI", porque `idsPubliai` sai de
   `familias.ml_item_id`, que é re-apontado. **Mitigação:** guardar `ml_item_id_anterior` na raiz e
   somá-lo ao conjunto de ids do faturamento.
3. **O selo "% OFF" some após migrar.** O UPDATE em User Products não envia `original_price` (dívida
   8 do ADR-0160). O preço de venda continua correto; o selo, não.
3b. **A métrica de vendas da Publicados recomeça do zero** para o produto migrado. `metricas-vendas`
   monta o escopo por `ml_item_id`, e a tela passa a mostrar o clone; o ML herda `sold_quantity`, o
   app não. O histórico antigo continua no banco, ligado ao anúncio encerrado.
4. **Famílias divididas em vários anúncios não podem usar o botão** (R-1).
5. **Produto usado em kit virtual não pode usar o botão** — o componente é chaveado por
   `user_product_id`, e o efeito da migração sobre o bundle é indocumentado.

---

## 8. Fora de escopo

Migração em lote; cancelamento (o ML não oferece); categoria de notificação nova (reusa
`integracao`); as dívidas 1–9 do ADR-0160.

---

## 9. Critérios de aceite

**Código:** `pnpm lint` + `pnpm test` verdes; `preflight:static` verde; J1–J12 com teste nomeado;
migration pelo fluxo canônico com `db:check` limpo; ADR + docs no mesmo commit; **segunda revisão do
Fable** antes do merge.

**Validação real (Diego):** produto de teste com 2 cores, poucas vendas, **não dividido e fora de kit
virtual** → clicar em "Migrar para preço por variação" → confirmar → acompanhar o sino → ao concluir,
conferir no ML os 2 anúncios novos e o original encerrado, e no app que o produto segue gerenciável →
preços diferentes + "Atualizar tudo" → cada anúncio com o seu preço. **Nada no painel do ML.**
