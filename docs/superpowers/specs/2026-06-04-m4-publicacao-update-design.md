# Spec — Publicação UPDATE (reposição de estoque)

**Data:** 2026-06-04
**Status:** Aprovado (brainstorming)
**Marco:** M4 (Integração ML) — segundo bloco da publicação, após a Publicação CREATE
**ADRs relacionados:** [ADR-0005](../../decisions/0005-lifecycle-publish-and-update.md) (lifecycle publish+update), **ADR-0016** (a criar — refina o 0005)

---

## Problema

A planilha do sistema interno é **recorrente**: o operador re-importa periodicamente para repor estoque. Hoje o PubliAI só sabe **criar** anúncios (CREATE). Quando uma família já publicada volta num novo lote, o sistema marca `operacao=UPDATE` mas **não tem caminho de publicação** — a UI bloqueia UPDATE e não existe worker que atualize o anúncio. O operador teria de ajustar estoque manualmente no Mercado Livre, anúncio por anúncio.

## Objetivo

Permitir que o operador **reponha o estoque** de anúncios já publicados re-importando a planilha:

- Detectar famílias já publicadas e herdar o anúncio anterior **sem rodar IA/concorrência** (custo zero no UPDATE).
- Mostrar na Revisão um **diff por cor** do estoque (antes → depois) antes de confirmar.
- Atualizar **somente o estoque** das variações no anúncio existente, **sem tocar em preço, título, descrição ou fotos**.
- Detectar mudanças estruturais (cor nova / cor removida) e **sinalizar sem aplicá-las**.

## Decisões de produto (do brainstorming)

1. **Escopo = só estoque.** O UPDATE é reposição pura. Preço de venda, título, descrição e fotos do anúncio ficam intactos.
2. **Mudança estrutural detecta + sinaliza, não aplica.** Cores novas não são adicionadas ao anúncio; cores removidas não são deletadas. Ambas aparecem como selo na Revisão para o operador tratar manualmente se quiser.
3. **Revisão humana com diff por cor.** Como o UPDATE mexe em anúncios no ar (podem ter vendas), cada família UPDATE mostra exatamente o que muda no estoque, cor a cor. Só aparecem cores que mudaram.

## Contexto técnico (estado atual do código)

- `ingest-lote` (`supabase/functions/ingest-lote/index.ts:84-103`) já detecta publicação anterior (busca `familias` por `codigo_pai` com `ml_item_id NOT NULL`) e grava `operacao = 'UPDATE' | 'CREATE'`. Mas cria um registro "vazio" e enfileira `process-familia` (IA cara) para **todas** as operações, inclusive UPDATE — contraria o ADR-0005.
- `process-familia` (`supabase/functions/process-familia/index.ts`) roda o pipeline completo (Vision + copy + concorrência + estratégia + categoria + mercado) sem desvio para UPDATE.
- `publicar-familias` (`supabase/functions/publicar-familias/index.ts`) faz claim atômico **só de `operacao='CREATE'`** com `ml_item_id IS NULL`, e enfileira em `publish-familia-ml`.
- `publish-familia-ml` (worker CREATE) faz `POST /items`, sobe fotos, persiste `ml_item_id`/`ml_permalink`/`ml_variation_id`.
- Front: `familiaPublicavel` (`src/lib/publicavel.ts`) bloqueia UPDATE com o motivo "Já publicada"; `Revisao.tsx` já tem badge e filtro CREATE/UPDATE.
- Schema: enum `operacao_ml ('CREATE'|'UPDATE')`, `familias.ml_item_id/ml_permalink`, `variacoes.ml_variation_id` já existem.

### Como o ML atualiza um anúncio (validado na pesquisa)

- Variações se atualizam via **`PUT /items/{id}`** mandando o array `variations`, cada uma com `{ id, available_quantity, ... }`.
- **Regra crítica:** toda variação **omitida** do `variations[]` é **deletada**. O PUT precisa incluir os `id` de **todas** as variações que existem no anúncio.
- Omitir o campo `price` numa variação **preserva** o preço atual. Para repor só estoque, mandamos `id` + `available_quantity` e nada mais.
- O item precisa estar **ativo** para ser modificado; nem todo campo é editável depois de vendas (irrelevante aqui — só mexemos em estoque).
- Fontes: [Sync and modify listings](https://developers.mercadolivre.com.br/en_us/products-sync-listings), [Variations](https://developers.mercadolivre.com.br/en_us/variations).

## Arquitetura

### 1. `ingest-lote` — herança + desvio do UPDATE

Quando `operacao=UPDATE` para uma família, o ingest passa a:

1. Carregar a **publicação anterior** (registro `familias` com mesmo `user_id` + `codigo_pai` + `ml_item_id NOT NULL`, a mais recente) e suas variações.
2. **Herdar** no novo registro de família: `ml_item_id`, `ml_permalink`, `titulo_ml`, `descricao_ml`, `categoria_ml_id`, `atributos_ml`, `tipo_aviamento`, `capa_ml_picture_id`. (Esses campos são para **exibição** na Revisão e para o link; só `ml_item_id` é usado pela publicação.)
3. **Casar variações por `codigo`** (normalizado). Para cada variação do novo lote:
   - Se existe correspondente na publicação anterior: herda `ml_variation_id`, `cor`, `ml_picture_id`; grava `estoque_anterior` = estoque da publicação anterior (snapshot do diff).
   - Se **não** existe (cor nova): `ml_variation_id = null`, `estoque_anterior = null` (sinaliza cor nova).
4. Detectar **cores removidas** (existiam na publicação anterior, ausentes no novo lote) e gravar em `familias.mudanca_estrutural` = `{ novas: ["<codigo>"], removidas: [{ codigo, cor }] }`.
5. `preco_publicacao` por variação = `preco` da planilha (não usado pelo UPDATE; mantém o campo coerente para a UI).
6. Marcar a família direto como **`status='pronto'`** e **não enfileirar** `process-familia` (sem IA, sem concorrência).

As famílias `operacao=CREATE` seguem o fluxo atual inalterado (enfileiram `process-familia`).

> Trade-off do "antes": o snapshot (`estoque_anterior`) é o que o PubliAI publicou por último, não um `GET` ao vivo do ML. Para a UI do diff isso é instantâneo e suficiente. O **worker** usa o estado real do ML (`GET /items`) na hora de aplicar, como rede de segurança contra deletar variações.

### 2. Worker novo `update-familia-ml`

Edge function `verify_jwt:false` (recebe job assinado do QStash), espelha a estrutura do `publish-familia-ml`:

1. Verifica assinatura QStash; lê `job = { familia_id, lote_id }`.
2. Carrega a família. Se `ml_item_id` for null → erro definitivo ("família UPDATE sem ml_item_id herdado").
3. Carrega as variações **não excluídas** (`excluida_da_publicacao=false`) com `ml_variation_id` e `estoque`.
4. `getValidAccessToken(user_id)` (ADR-0012).
5. `GET /items/{ml_item_id}` → variações reais do anúncio (`id`, `seller_custom_field` = codigo, `available_quantity`).
6. **Monta `variations[]`** (função pura `montarVariacoesUpdate`, TDD), cobrindo **todas** as variações reais do ML:
   - variação do ML cujo `seller_custom_field` casa com uma variação do lote → `{ id, available_quantity: <estoque do lote> }`;
   - variação do ML sem correspondente no lote (cor removida) → `{ id, available_quantity: <estoque atual do ML> }` (preserva, não deleta);
   - cores novas do lote (sem `ml_variation_id`) → **não entram** no array.
7. `PUT /items/{ml_item_id}` com `{ variations }` (helper `atualizarItemML` em `_shared/ml/atualizar-item.ts`).
8. Persiste `status='publicado'`, `publicado_em = now()`. Reavalia o status do lote (reusa `talvezFinalizarLote`).
9. **Erros:** 5xx/429 → relança 500 (QStash retenta, status fica `publicando`); 4xx/local → `status='erro'` + `erro_mensagem`. Idempotência: se a família já está `publicado` no claim, o worker não reprocessa.

Sem upload de fotos, sem `garantirDescricaoML`, sem montar payload de item completo.

### 3. `publicar-familias` — roteamento por operação

- Claim atômico passa a aceitar **`CREATE` e `UPDATE`** (status `pronto`/`erro`):
  - CREATE: mantém o filtro `ml_item_id IS NULL`.
  - UPDATE: exige `ml_item_id IS NOT NULL`.
- Para cada família claimada, enfileira no worker correto conforme `operacao`:
  - CREATE → `enfileirarPublicacao` (→ `publish-familia-ml`), com `listing_type_id`.
  - UPDATE → `enfileirarAtualizacao` (novo, → `update-familia-ml`), **sem** `listing_type_id`.
- Permite seleção mista (CREATE + UPDATE no mesmo "Publicar selecionadas"). `listing_type_id` só afeta CREATE.

### 4. Frontend (Revisão)

- **`familiaPublicavel`** deixa de bloquear UPDATE. Regras do UPDATE:
  - `status` em `pronto`/`erro`;
  - `operacao='UPDATE'` exige `ml_item_id` presente e **≥1 cor casada** (`ml_variation_id` not null) entre as não-excluídas;
  - dispensa as checagens de CREATE que não se aplicam (categoria/foto/preço já vêm do anúncio existente).
- **Diff por cor (UPDATE):** para cada cor casada com mudança, exibir `estoque_anterior → estoque` (só as que mudaram). Componente novo ou ramo no card expandido.
- **Selo "mudança estrutural":** lê `familia.mudanca_estrutural`; lista cores novas (não publicadas) e removidas (não deletadas).
- Modal de confirmação Clássico/Premium **só para CREATE**; UPDATE ignora `listing_type_id`.
- `lib/publicar.ts` (`publicarFamilias`) já envia `familia_ids` — inalterado; o roteamento é server-side.
- `Relatorio.tsx` reaproveita links/erros; rótulo "atualizado" para UPDATE.

## Schema (migrations aditivas)

- `variacoes`: `+ estoque_anterior int null` (snapshot do estoque publicado, para o diff).
- `familias`: `+ mudanca_estrutural jsonb null` (`{ novas: string[], removidas: {codigo,cor}[] }`).
- Reaproveitados sem mudança: `operacao_ml`, `familias.ml_item_id/ml_permalink/capa_ml_picture_id`, `variacoes.ml_variation_id/ml_picture_id`.

## Fluxo de dados

```
Re-importar planilha
  → ingest-lote
      família com codigo_pai já publicado → operacao=UPDATE
      herda ml_item_id + ml_variation_id (casa por codigo) + estoque_anterior
      detecta mudanca_estrutural; status='pronto' (SEM process-familia)
  → Revisão: diff de estoque por cor + selo estrutural; operador seleciona
  → publicar-familias (claim CREATE|UPDATE) → roteia
      UPDATE → enfileirarAtualizacao → update-familia-ml
          getValidAccessToken
          GET /items/{id}  (estado real → não deletar variação)
          montarVariacoesUpdate() → variations[] (só available_quantity)
          PUT /items/{id}
          status='publicado', publicado_em=now()
  → Relatório: anúncio atualizado (link)
```

## Tratamento de erros

| Caso | Comportamento |
|---|---|
| Família UPDATE sem `ml_item_id` herdado | erro definitivo na publicação (`status='erro'`) |
| `GET /items` falha (rede/5xx) | relança 500 → QStash retenta |
| `PUT /items` 4xx (ex.: item inativo, campo travado) | `status='erro'` + `erro_mensagem`; operador vê na Revisão e pode "tentar de novo" |
| Nenhuma cor casada (tudo virou cor nova) | `familiaPublicavel` bloqueia com motivo; nada é enviado |
| Cor removida da planilha | preservada no ML (estoque atual reenviado); sinalizada, nunca deletada |
| Cor nova no lote | não publicada; sinalizada |

## Testes

- **Backend (TDD, vitest):**
  - `montarVariacoesUpdate`: casa por codigo; aplica estoque novo nas casadas; preserva estoque atual das removidas; ignora cores novas; **nunca** inclui `price`; cobre todas as variações do ML (não deleta).
  - Casamento de variações por codigo normalizado.
  - Detecção de mudança estrutural (novas/removidas) no parser/ingest.
  - Cálculo do diff de estoque (só cores que mudaram).
- **Frontend:** teste de `familiaPublicavel` para UPDATE (libera/bloqueia conforme `ml_item_id` e cores casadas); render do diff de estoque e do selo estrutural.
- **Bug bash com token real:** validar `GET`+`PUT /items` em anúncio publicado de verdade (reusar os 2 anúncios do bug bash CREATE); confirmar que preço/título/fotos ficam intactos e o estoque muda. A orquestração da edge (fetch+token) não é testável em unidade (igual às demais).

## Fora de escopo (YAGNI)

- Atualizar **preço**, título, descrição ou fotos de anúncio publicado.
- **Adicionar** cor nova ou **remover** cor sumida no anúncio do ML (estrutural).
- Mudar **categoria** ou **tipo de anúncio** (Clássico/Premium) de item já publicado.
- Sincronização automática por cron / integração direta com o banco interno (ADR-0005 opções B/D, diferidas).
- `GET /items` ao vivo para alimentar o diff da UI (usamos o snapshot `estoque_anterior`).

## ADR a criar

**ADR-0016 — Publicação UPDATE: reposição de estoque herdando o anúncio anterior.** Refina o ADR-0005 (imutável):
- UPDATE herda a publicação anterior no ingest e **pula IA/concorrência**.
- Escopo do UPDATE = **só estoque**; preço/título/descrição/fotos preservados.
- Mudança estrutural (cor nova/removida) é **detectada e sinalizada, nunca aplicada** no MVP.
- O `PUT /items` inclui **todas** as variações reais (via `GET /items`) para não deletar nenhuma.
