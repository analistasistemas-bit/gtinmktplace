# ADR-0016: Publicação UPDATE — reposição de estoque herdando o anúncio anterior

**Status:** Aceito
**Data:** 2026-06-04
**Decisores:** Diego
**Refina:** ADR-0005 (imutável)

## Contexto

O ADR-0005 definiu que re-importar a planilha deve atualizar anúncios já
publicados ("modo UPDATE"), mas deixou aberto o escopo exato e o tratamento de
mudanças estruturais. Ao implementar, decidimos os detalhes abaixo.

## Decisão

1. **Escopo do UPDATE = só estoque.** Preço de venda, título, descrição, fotos e
   categoria do anúncio são preservados. No `PUT /items/{id}` mandamos apenas
   `available_quantity` por variação (omitir `price` preserva o preço no ML).
2. **Herança sem IA.** O `ingest-lote`, ao detectar família já publicada
   (`codigo_pai` com `ml_item_id`), herda do registro anterior `ml_item_id`,
   `ml_permalink`, título/descrição/categoria/atributos (só para exibição) e,
   casando por `codigo`, `ml_variation_id`/`cor`/`ml_picture_id` por variação;
   grava `estoque_anterior` (snapshot do diff) e marca a família `pronto` sem
   enfileirar `process-familia`. UPDATE não gasta IA nem busca de concorrência.
3. **Mudança estrutural detecta + sinaliza, não aplica.** Cor nova (no lote, sem
   variação no anúncio) não é adicionada; cor removida (no anúncio, ausente no
   lote) não é deletada. Ambas aparecem como selo na Revisão.
4. **PUT inclui todas as variações reais.** O ML deleta qualquer variação omitida
   do `variations[]`. Por isso o worker faz `GET /items/{id}` antes e reenvia
   todas as variações atuais: as casadas com o novo estoque, as não-casadas
   (cor removida) com o estoque atual (preserva).

## Consequências

- UPDATE é barato (sem IA) e seguro para anúncios no ar (nunca mexe em preço,
  nunca deleta variação).
- Mudança estrutural exige ação manual do operador no ML (aceito no MVP).
- O diff da UI usa o snapshot `estoque_anterior` (o que publicamos por último),
  não um GET ao vivo; o worker usa o GET real na hora de aplicar.

## Alternativas consideradas

- Atualizar preço junto: rejeitado a pedido do Diego (preço de venda é gerido no
  ML / definido no CREATE).
- Adicionar/remover variação no ML: fora do MVP (ML restringe remoção com vendas;
  adicionar exige foto/atributos).
- GET ao vivo para o diff da UI: descartado (frontend não tem token; snapshot
  basta para decisão).

---

## Adendo (2026-06-04) — Cor nova publicável

A decisão original (item 3) tratava cor nova como "apenas sinalizada". Refinamento
a pedido do Diego: a **cor nova passa a ser publicável (opt-in)**.

- A cor nova aparece na Revisão **desmarcada** (`excluida_da_publicacao=true`); o
  operador marca para adicioná-la como **variação nova no anúncio existente**.
- O nome da cor é resolvido só para as cores novas, na ordem do [ADR-0004](0004-atribuicao-de-cor.md)
  (descrição/nome primeiro; Vision apenas como fallback). Implementado por um
  `process-familia` em **modo parcial** que não mexe nos campos herdados.
- Foto obrigatória (igual CREATE); preço da cor nova = preço da planilha.
- O worker faz um único `PUT /items/{id}` que **cria** as variações sem `id` e
  **atualiza** as com `id` no mesmo request.
- **Cor removida continua apenas sinalizada** (não deleta) — inalterado.

## Adendo (2026-06-05) — BRAND sincronizado no UPDATE

Exceção pontual à preservação de atributos: o UPDATE passa a reenviar **apenas o atributo
BRAND** no `PUT /items/{id}`, usando o `fornecedor` da família, para corrigir a marca de anúncios
publicados antes da adoção do FORNECEDOR (ADR-0009 adendo). Os demais atributos
(RIBBON_TYPE/MATERIAL/MODEL etc.) continuam **preservados** — não são recalculados nem
reenviados. Se a família não tem fornecedor (vazio), o BRAND **não** é enviado (preserva o
existente, evita sobrescrever com o fallback "Avil"). Preço/título/fotos seguem preservados como
antes. Implementação: `update-familia-ml` calcula a marca e a envia via `atualizarItemML(..., atributos)`.

## Adendo (2026-06-05) — 2ª foto comum no UPDATE

Para propagar a 2ª foto comum (`capa2`) aos anúncios já publicados, o UPDATE passa a (re)enviar os `picture_ids` das variações existentes (`[capa, capa2, própria]`) quando há 2ª foto — exceção controlada à preservação de fotos. Idempotente (dedup); sem 2ª foto e sem cor nova, o comportamento segue só-estoque.

## Adendo (2026-06-06) — Descrição reflete a cor nova no UPDATE

A decisão original (item 1) preserva a descrição no UPDATE. Na prática isso deixou um
buraco: ao adicionar uma **cor nova** (publicável via adendo 2026-06-04), a variação é
criada no ML, mas a seção **"🎨 CORES DISPONÍVEIS"** da descrição herdada continuava
listando só as cores antigas (descrição é texto livre gerado pela IA no CREATE).

**Refinamento (a pedido do Diego):** em todo UPDATE de família já publicada, o worker
reescreve **apenas a lista da seção de cores** da descrição com as cores **incluídas**
(casadas + novas) e — só quando a lista realmente muda — reenvia via `garantirDescricaoML`
(`PUT /items/{id}/description`). O caso que dispara o reenvio é a entrada de uma cor nova;
um UPDATE só-estoque não altera a lista e não toca a descrição.

- **Sem IA** — `atualizarSecaoCores(descricao, cores)` é uma função pura determinística
  (`_shared/ml/criar-item.ts`, TDD): localiza o cabeçalho "CORES DISPONÍVEIS", substitui o
  bloco de linhas `- cor` e preserva todo o resto do texto. Mantém o espírito do item 1
  (UPDATE barato, sem gastar IA) e do adendo 2026-06-05 (cor nova).
- **Cirúrgico** — só a lista de cores muda; título, bullets e demais seções ficam intactos.
  Se a descrição não tiver o cabeçalho (texto antigo/custom), retorna o original sem mexer.
- **Falha explícita** — se `garantirDescricaoML` falhar, o worker falha e a família volta
  para `status=erro`; o operador reprocessa pelo fluxo já conhecido. 5xx/429 → QStash
  reentrega; 4xx permanente → `status=erro` com mensagem. O `familias.descricao_ml` no
  banco só é atualizado após o push bem-sucedido.
- **Idempotência no retry** — o bloco executa sempre que `familia.descricao_ml` existe
  (não apenas quando `novas.length > 0`). O guard `novaDescricao !== familia.descricao_ml`
  impede reenvio quando a descrição já foi persistida em run anterior — tornando o retry
  seguro sem estado adicional.
- **Cor removida** continua só sinalizada (não sai da descrição automaticamente) — inalterado.

---

## Adendo (2026-06-07) — push da descrição quando o texto muda, não só as cores

**Buraco descoberto em produção:** o guard original comparava a descrição recalculada
contra o **próprio `familias.descricao_ml`** (`novaDescricao !== familia.descricao_ml`).
Isso só detecta mudança **na seção de cores**. Quando o operador **corrige/regenera** a
descrição de um anúncio já publicado (texto diferente, mesmas cores), o UPDATE **não
enviava nada ao ML** — a correção ficava presa no banco/tela e o anúncio mantinha o texto
antigo. Foi exatamente como uma descrição com preço (gerada por um copywriter revertido por
deploy) persistiu num anúncio mesmo após o copywriter ser corrigido: os UPDATEs de reposição
herdavam a descrição publicada e nunca a substituíam.

**Refinamento:** o gatilho passa a comparar a descrição **desejada** contra a que está
**ao vivo no ML**, não contra o banco:

- `buscarDescricaoML(token, itemId)` faz um `GET /items/{id}/description` (grátis, sem IA)
  e devolve o `plain_text` atual (item sem descrição → `''`).
- `resolverDescricaoUpdate(descricaoDb, cores, liveMl)` (puro, TDD): aplica
  `atualizarSecaoCores`, **sanitiza** (como o ML guarda — sem emojis) e compara com o
  `liveMl` (ambos `trim()`). `precisaPush = desejada !== liveAoVivo`.
- Só com `precisaPush` é que `garantirDescricaoML` reenvia; `familias.descricao_ml` no banco
  só é atualizado quando o texto-fonte (com emojis) realmente mudou.

**Cobre dois casos com o mesmo gatilho:** (a) **cor nova** — a seção de cores muda →
difere do ML → envia (comportamento anterior preservado); (b) **descrição corrigida/
regenerada** — o texto difere do ML → envia (o buraco fechado). **Reposição pura de
estoque** → desejada == ao vivo → **não envia** (sem IA, sem token; o GET é grátis).

**Custo de token:** zero. A IA (OpenRouter) só roda no CREATE ou no botão "Regenerar
descrição"; o UPDATE nunca gera tokens — só lê (GET) e, quando necessário, escreve (PUT) a
descrição. Idempotente: após o push, `sanitizar(desejada) == liveMl` → o próximo UPDATE não
reenvia.

---

## Adendo (2026-06-10) — Reconciliação do casamento contra o anúncio ao vivo

**Problema (bug bash do import só-planilha):** o casamento UPDATE decide "o que já está
publicado" pelo **snapshot local** (`familias`/`variacoes`). Esse snapshot pode **divergir
do anúncio real no ML** — ex.: a variação existe no ML mas nunca foi registrada localmente
(o lote que a publicou foi excluído, ou a cor foi adicionada fora do app). Caso real:
anúncio `MLB6901096672` tinha 3 variações no ML (Branco, Preto, **Azul/SKU 00220809**), mas
o banco só registrara 2 → o `casarVariacoesUpdate` (casa por código) marcava a 00220809 como
**cor nova** (falso positivo) e, se publicada, o worker tentaria **criar SKU duplicado**.

**Decisão:** o ML é a fonte da verdade (mapeia `seller_custom_field`=código → variação).
Após o casamento local, o `ingest-lote` **reconcilia** os códigos marcados como novos contra
as variações reais do anúncio:

- `buscarVariacoesExistentesML(token, itemId)` (`GET /items/{id}?attributes=id,variations`)
  devolve `{ id, seller_custom_field, cor (de attribute_combinations COLOR), available_quantity }`.
- `reconciliarCasamentoComML(casamento, mlVariations)` (puro, TDD): para cada código em
  `mudancaEstrutural.novas` que **já existe no ML** (casado por `seller_custom_field`
  normalizado), reclassifica como **casado** — adota o `ml_variation_id` e a `cor` do ML,
  `estoque_anterior` = `available_quantity`, e sai de `novas`. Só os códigos **realmente
  ausentes** no ML continuam novos.

**Efeitos:** some o falso "cor nova" na Revisão; a cor entra **incluída** (não opt-in) como
reposição normal; o worker não duplica SKU; e o registro é **gravado de volta** no banco
(auto-cura — o próximo lote casa localmente, sem nova chamada ao ML).

**Custo/resiliência:** só consulta o ML nas famílias com suposta cor nova (raro; 1 GET por
família afetada). Falha de ML/token → mantém o casamento local (comportamento anterior).

---

## Adendo (2026-06-12) — Preço de publicação propaga para a família inteira no UPDATE

**Problema (lote #31):** anúncio `MLB6900892156` tinha 1 cor publicada (Azul Marinho, a
R$ 12,00). Ao incluir 64 cores novas a R$ 12,50, o worker reenviava a variação existente
**sem `price`** (preservando o preço antigo) e as novas a R$ 12,50 → o ML exige **preço
único entre variações** e rejeitava com `Found different prices in variations`.

**Decisão (pedido do operador):** no UPDATE, sempre que o preço de publicação da família
mudar (incluir cor nova **ou** reposição de estoque), o novo preço é **propagado para todas
as variações** do anúncio. `montarVariacoesUpdate` ganha o parâmetro `precoFamilia` (preço
compartilhado pelas cores incluídas), aplicado a toda variação existente; idempotente quando
o preço não mudou; o desconto, se ativo, tem precedência. Refina o "UPDATE preserva preço"
do corpo deste ADR: a preservação valia para reposição pura; o preço de publicação agora é a
fonte da verdade e alcança a família já publicada.

## Adendo (2026-06-12) — Limpeza de cache de foto efêmero ao falhar

**Problema (mesmo lote, no retry):** upload de foto no ML que **não é anexado a um item
expira** (TTL). O worker cacheava o `ml_picture_id` das cores novas (e capas) logo após o
upload; quando a publicação falhava (ex.: pelo erro de preço acima), o id ficava órfão e
expirava. No retry, o guard `if (!picId)` reusava o id cacheado → `Picture id ... does not
exist`.

**Decisão:** no `catch` do ramo de erro definitivo, o worker **limpa os caches de foto
efêmeros** — `ml_picture_id` das cores ainda não anexadas (`ml_variation_id` null, sempre) e
as capas 2/3 subidas **naquele** attempt (flag) — para o próximo retry re-subir fresco. Cores
já casadas preservam o id (durável). `publish-familia-ml` (CREATE) tem o mesmo padrão latente
(follow-up).
