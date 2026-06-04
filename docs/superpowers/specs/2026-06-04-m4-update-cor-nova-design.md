# Spec — Cor nova publicável no UPDATE

**Data:** 2026-06-04
**Status:** Aprovado (brainstorming)
**Marco:** M4 (Integração ML) — extensão da Publicação UPDATE
**ADRs relacionados:** [ADR-0016](../../decisions/0016-publicacao-update-reposicao-estoque.md) (a aditar), [ADR-0004](../../decisions/0004-atribuicao-de-cor.md) (atribuição de cor), [ADR-0005](../../decisions/0005-lifecycle-publish-and-update.md)

---

## Problema

A base da Publicação UPDATE (reposição de estoque) trata uma **cor nova** — um SKU filho que aparece na planilha re-importada mas não existe no anúncio publicado — como mudança estrutural **apenas sinalizada**, nunca publicada. O operador quer poder **adicionar a cor nova ao anúncio existente**, escolhendo caso a caso (igual ao CREATE), em vez de ter de criá-la manualmente no Mercado Livre.

## Objetivo

Permitir que, numa família já publicada, o operador **inclua cores novas como variações novas no mesmo anúncio** do ML, com seleção opcional (opt-in), reusando o enriquecimento de cor/foto do CREATE. A reposição de estoque das cores existentes (base UPDATE) segue funcionando junto, no mesmo fluxo de publicação.

## Decisões de produto (do brainstorming)

1. **Cor nova é publicável com escolha (opt-in).** Aparece na lista de variações **desmarcada** (`excluida_da_publicacao = true`); o operador marca para incluí-la. Nada novo entra no anúncio no ar sem decisão explícita.
2. **Cor (nome) resolvida pela IA só nas cores novas**, na ordem do ADR-0004: **descrição/nome primeiro** (`extrairCorDoTexto`), **Vision só como fallback** quando o texto não tem a cor (e a variação tem foto). Vale para CREATE e UPDATE.
3. **Foto obrigatória** (igual CREATE): cor nova incluída sem foto fica bloqueada até ter foto (subida no lote ou pela drop-zone da Revisão).
4. **Preço da cor nova = preço da planilha** (PRÓPRIO). É variação nova e precisa de preço próprio; isso **não** altera o preço das cores existentes (a base UPDATE continua sem tocar preço).
5. **Cor removida continua só sinalizada** (não deleta do ML). Inalterado.

## Contexto técnico (estado atual)

- A base UPDATE já existe: `ingest-lote` herda o anúncio anterior, casa variações por `codigo` (`casarVariacoesUpdate`), grava `estoque_anterior` e `mudanca_estrutural`, e marca a família `pronto` **sem IA**; `update-familia-ml` faz `GET /items` + `PUT /items` só com `available_quantity`.
- Hoje a cor nova já é **inserida** como variação da família UPDATE (`ingest-lote`), com `ml_variation_id = null`, `cor = null`, `estoque_anterior = null` — mas sem tratamento de publicação.
- `process-familia` já implementa a cadeia de cor do ADR-0004 (`extrairCorDoTexto` → cache → Vision) e, no fim, **sobrescreve** título/descrição/categoria/concorrência/mercado — o que **não** pode acontecer no UPDATE (esses campos são herdados).
- O worker CREATE (`publish-familia-ml`) já sobe foto (`subirFotoML`) e monta variação com `montarPayloadItem` (COLOR + GTIN/EMPTY_GTIN_REASON + picture_ids). Essa lógica de **atributos de variação** será reusada para a cor nova.
- ML: `PUT /items/{id}` aceita, no array `variations`, itens **com `id`** (atualiza a existente) e **sem `id`** (cria nova) no mesmo request. (A criar variação exige `attribute_combinations` com COLOR, `available_quantity`, `price`, `picture_ids` e os atributos da categoria.) **A confirmar no bug bash** com token real.

## Arquitetura

### 1. `ingest-lote` — cor nova desmarcada + processamento parcial quando houver

No ramo UPDATE (família com `ml_item_id` herdado):

- Cor casada (existe no anúncio): inalterada — herda `ml_variation_id`/`cor`/`ml_picture_id`/`estoque_anterior`.
- **Cor nova** (sem correspondente): inserida com `excluida_da_publicacao = true` (desmarcada). `ml_variation_id`/`cor`/`estoque_anterior` ficam null (como hoje); `preco_publicacao = preço da planilha`.
- **Status da família:**
  - tem ≥1 cor nova → `status = 'pendente'` e **enfileira `process-familia`** (modo parcial, resolve só a cor das novas);
  - sem cor nova → `status = 'pronto'` direto, **sem IA** (base inalterada).

A detecção de "tem cor nova" usa o resultado de `casarVariacoesUpdate` (`mudancaEstrutural.novas.length > 0`).

### 2. `process-familia` — ramo UPDATE (parcial)

Logo após o claim, se a família é `operacao = 'UPDATE'`:

- Resolve a cor **apenas das variações sem cor** (as novas) pela cadeia do ADR-0004 (`extrairCorDoTexto` no nome do filho + nome/descrição do pai herdados → cache → Vision só se houver foto e o texto não resolveu).
- Persiste `cor`/`cor_origem` dessas variações.
- **Não** chama copywriter, concorrência, estratégia de preço, categoria nem mercado (todos herdados).
- Marca `status = 'pronto'`.

As famílias CREATE seguem o fluxo completo atual, intacto.

### 3. `familiaPublicavel` (UPDATE)

Publicável quando, entre as cores **não excluídas**:
- há ≥1 cor **casada** (`ml_variation_id` presente) — reposição de estoque; **ou**
- há ≥1 cor **nova** (`ml_variation_id` null) válida.

Para cada cor **nova incluída**, exige (igual CREATE): **cor definida** e **foto** (`imagem_path`/`ml_picture_id`); preço de publicação > 0 (vem da planilha). Cor casada não exige foto/categoria (já no anúncio). Mantém: exige `ml_item_id` e a família em `pronto`/`erro`.

### 4. Worker `update-familia-ml`

Estende o worker atual. Carrega as variações não-excluídas separando casadas (têm `ml_variation_id`) de novas (não têm). Então:

1. `GET /items/{ml_item_id}` → variações reais.
2. Para as **cores novas incluídas**: sobe a foto (`subirFotoML`, idempotente via `ml_picture_id`) e monta a variação **sem `id`** com `attribute_combinations` (COLOR), `available_quantity` (estoque da planilha), `price` (preço de publicação), `picture_ids` e atributos GTIN/EMPTY_GTIN_REASON (reusando a lógica de `_shared/ml/publicar.ts`).
3. Monta o `variations[]` do PUT: **todas as variações reais do GET** (casadas → novo estoque; removidas → estoque atual preservado) **+** as variações novas (sem `id`).
4. `PUT /items/{id}` com esse array.
5. Persiste `ml_variation_id` das novas (casando por `seller_custom_field`/índice, como o worker CREATE), `status = 'publicado'`, `publicado_em`.
6. Erros/idempotência/retry 5xx-429 como hoje; guard `status = 'publicando'`.

> Preço: o PUT continua **sem `price` nas variações existentes** (preço preservado). `price` só aparece nas variações **novas** (obrigatório para criá-las).

### 5. Frontend

- A cor nova já vem na lista de variações (inserida pelo ingest), agora **desmarcada** e com um marcador visual "nova". O operador marca o checkbox para incluí-la (persiste `excluida_da_publicacao = false`, fluxo já existente).
- `DiffEstoque`/selo de mudança estrutural passam a distinguir **"cores novas a publicar"** (com checkbox, na lista) das **"removidas"** (apenas sinalizadas).
- `familiaPublicavel` atualizado reflete os novos motivos de bloqueio (cor nova incluída sem cor/foto).

## Schema

**Nenhuma coluna nova.** Reusa `variacoes.excluida_da_publicacao`, `variacoes.ml_variation_id` (null = nova), `variacoes.cor`, `variacoes.imagem_path`, `variacoes.ml_picture_id`, `variacoes.preco_publicacao`, `familias.mudanca_estrutural`.

## Fluxo de dados

```
Re-importar planilha (família já publicada, com cor nova)
  → ingest-lote
      cores casadas: herda ml_variation_id/cor/estoque_anterior
      cores novas: excluida_da_publicacao=true, cor=null, preco_publicacao=planilha
      tem cor nova? → status 'pendente' + enfileira process-familia (parcial)
                      senão → status 'pronto' (sem IA)
  → process-familia (ramo UPDATE): resolve cor SÓ das novas (ADR-0004) → 'pronto'
  → Revisão: operador marca a(s) cor(es) nova(s) que quer publicar
      familiaPublicavel exige cor+foto nas novas incluídas
  → publicar-familias (claim UPDATE) → update-familia-ml
      GET /items → estado real
      sobe foto das novas incluídas
      PUT /items: existentes (estoque, sem price) + novas (sem id, com price/foto/COLOR/GTIN)
      persiste ml_variation_id das novas; status 'publicado'
  → anúncio agora tem a cor nova como variação
```

## Tratamento de erros

| Caso | Comportamento |
|---|---|
| Cor nova incluída sem cor resolvida | `familiaPublicavel` bloqueia (operador define a cor inline) |
| Cor nova incluída sem foto | `familiaPublicavel` bloqueia até subir a foto |
| `process-familia` parcial falha ao resolver cor | família vai a `erro`; operador reprocessa (lote novo) ou define cor manual |
| `PUT` rejeita a variação nova (atributo/foto) | `status='erro'` + `erro_mensagem`; "tentar de novo" reenfileira |
| Cor nova com foto não subida ao ML | worker sobe antes do PUT (idempotente via `ml_picture_id`) |
| Família UPDATE só com cor nova (sem reposição) | publicável normalmente; PUT cria a(s) variação(ões) e reenvia as existentes inalteradas |

## Testes

- **Backend (TDD, vitest):**
  - `montarVariacoesUpdate` (ou função irmã) estendida: além de atualizar/preservar existentes, **acrescenta** variações novas (sem `id`, com COLOR/price/picture_ids/atributos), mantendo a regra de não-deletar.
  - Montagem dos atributos da variação nova (COLOR + GTIN/EMPTY_GTIN_REASON) reusando `_shared/ml/publicar.ts`.
  - `familiaPublicavel` (UPDATE): publicável com cor nova válida; bloqueia cor nova sem cor/sem foto; segue publicável só com reposição.
- **Frontend:** render do marcador "nova" + checkbox desmarcado; selo separando novas/removidas.
- **Bug bash com token real:** re-importar uma família publicada adicionando 1 cor nova (com foto) → confirmar que o `PUT` cria a variação no anúncio (preço/título/fotos das demais intactos; nenhuma variação deletada). Validar que o ML aceita criar+atualizar no mesmo PUT.

## Fora de escopo (mantido)

- **Deletar/remover** variação no ML (cor removida só sinaliza).
- Alterar **preço/título/descrição/categoria** das cores/anúncio existentes.
- Mudar tipo de anúncio (Clássico/Premium) de item já publicado.

## ADR

**Adendo ao ADR-0016:** a cor nova passa de "apenas sinalizada" para **publicável opt-in** — adicionada como variação nova ao anúncio existente (resolve cor pelo ADR-0004 só nas novas, foto obrigatória, preço da planilha, desmarcada por padrão). A cor removida permanece apenas sinalizada (não deleta). O `PUT /items/{id}` cria variações sem `id` e atualiza as com `id` no mesmo request.
