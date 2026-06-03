# Spec — M4 Publicação CREATE no Mercado Livre (com seleção do que publicar)

**Data:** 2026-06-03
**Status:** Aprovado (brainstorming com Diego)
**Marco:** M4 — Integração Mercado Livre, bloco de Publicação CREATE
**ADRs relacionados:** [0003](../../decisions/0003-variacoes-agrupadas-por-pai.md) (1 família = 1 anúncio com N variações), [0005](../../decisions/0005-lifecycle-publish-and-update.md) (CREATE vs UPDATE), [0006](../../decisions/0006-qstash-em-vez-de-postgres-queue.md) (fila + idempotência), [0009](../../decisions/0009-campos-payload-ml-e-categoria-deterministica.md) (campos do payload + categoria), [0012](../../decisions/0012-refresh-token-oauth-ml-com-lock-redis.md) (token), [0013](../../decisions/0013-edge-cases-da-planilha-no-ingest.md) (pré-condição: só famílias com ≥1 variação)

---

## 1. Objetivo e escopo

Transformar uma família **nova** (ainda não publicada) em **1 anúncio no Mercado Livre** com cada cor virando uma variação nativa (ADR-0003), partindo da tela de Revisão onde o operador **escolhe granularmente o que publicar**.

**No escopo (CREATE):**
- Seleção do que publicar na Revisão (famílias + exclusão de cores)
- Validação local de "publicável" (bloquear incompletas com motivo)
- Edge function `publish-familia-ml` (payload, fotos, `POST /items`, persistência)
- Tela de Relatório real (links + erros + tentar de novo)

**Fora do escopo (blocos seguintes):**
- **UPDATE** (atualizar estoque/preço de anúncio existente — ADR-0005)
- Detecção de variação adicionada/removida numa família já publicada (gap §561)
- Painel rico de reprocessamento e métricas (M5)

---

## 2. Decisões do brainstorming

| Decisão | Escolha | Motivo |
|---|---|---|
| Granularidade da seleção | **Família + excluir cores** | Resolve o caso real "publicar a família menos a cor problemática" com pouca complexidade |
| Fluxo de disparo | **Selecionar + Publicar direto** | O ato de confirmar já é a aprovação; sem estado intermediário |
| Família incompleta | **Bloquear + motivo claro** | Validação local determinística evita gastar chamada ao ML para falhar na certeza |
| Foto das cores | **Exigir foto por cor** (sem fallback de capa) | Decisão do Diego; cada variação tem sua própria foto |
| Botão "Rejeitar" | **Removido** | No modelo selecionar+publicar, não publicar = não marcar; "rejeitar" não tem função |

---

## 3. Fluxo ponta a ponta

```
Tela Revisão
  ├─ cada família mostra selo: ✅ publicável | 🔒 incompleta (+motivos) | ✓ publicado (link)
  ├─ operador marca famílias publicáveis (checkbox existente)
  ├─ no expandido, desmarca cores específicas (persistido em excluida_da_publicacao)
  └─ "Publicar selecionadas (N famílias · M cores)"
        │
        ▼  Modal de confirmação (revisão humana obrigatória — regra do projeto)
        ▼
  Por família: status → 'publicando' + enfileira job no QStash
        │
        ▼  Edge publish-familia-ml (idempotente, 1 por família)
        ▼
  Tela de Relatório: progresso ao vivo + links + erros + tentar de novo
```

A publicação é **assíncrona** (QStash), como o resto do pipeline. O `POST /items` do ML é **atômico**: cria o anúncio com todas as variações enviadas ou falha inteiro — logo o tratamento de erro é naturalmente por família (alinhado ao ADR-0003).

---

## 4. UX da seleção (frontend)

### 4.1 Definição de "publicável" (determinística, no front)

Uma família CREATE é **publicável** quando, considerando só as cores *incluídas* (`excluida_da_publicacao=false`):

- `status = 'pronto'` (pipeline IA terminou)
- `operacao = 'CREATE'` (não já publicada)
- categoria definida (`tipo_aviamento != 'outro'` / `categoria_ml_id` presente)
- atributos obrigatórios completos (`atributosFaltantes` vazio)
- ≥ 1 cor incluída
- cada cor incluída tem **cor definida** (não vazia) **e foto própria** (`imagem_path` não nulo)
- preço de publicação > 0

Caso contrário → **incompleta**, acompanhada da lista de motivos. O cálculo é uma função pura `familiaPublicavel(familia): { ok: boolean; motivos: string[] }` (TDD).

### 4.2 Linha da família (`FamiliaRow`)

- **Publicável:** checkbox ativo.
- **Incompleta:** checkbox **desabilitado** + selo 🔒 com motivos (resumo inline + tooltip completo). Recalcula na hora conforme o operador edita/exclui cores.
- **Já publicada** (`status='publicado'`): sem checkbox de CREATE; mostra link do anúncio (entra no fluxo UPDATE futuro).

### 4.3 Exclusão de cores (`FamiliaExpanded`)

- Cada variação ganha um checkbox **"incluir"** (marcado por padrão).
- Desmarcar grava `excluida_da_publicacao=true` na variação **na hora** (mesmo padrão das edições inline que já persistem), para o job assíncrono ler do banco.
- Cores com problema (sem cor / sem foto) aparecem destacadas; excluir uma cor problemática pode **virar a família para publicável** (selo recalcula).
- Trava: não é possível excluir todas as cores (≥1 obrigatória).

### 4.4 Footer e filtros

- Footer (substitui o "Aprovar/Rejeitar" mock): `N família(s) · M cor(es) selecionada(s)` + **"Publicar selecionadas →"** (abre o modal).
- Sem botão "Rejeitar".
- Novo chip de filtro **"🔒 Incompletas (N)"** ao lado de Todos/CREATE/UPDATE/Avisos.

### 4.5 Modal de confirmação

`Vou publicar N famílias (M anúncios) no Mercado Livre. Confirmar?` — cumpre a regra inegociável de revisão humana antes de qualquer publicação. Ao confirmar: cada família selecionada vai para `status='publicando'`, enfileira o job, e navega para o Relatório.

---

## 5. Backend de publicação

### 5.1 Edge function `publish-familia-ml`

Acionada por QStash (job `{ familia_id, lote_id }`), 1 por família.

**Idempotência (ADR-0006):** se a família já tem `ml_item_id` → retorna sem republicar. O disparo no front faz o claim setando `status='publicando'`.

**Sequência:**
1. `verificarAssinatura` (QStash) — já existe em `_shared/queue.ts`
2. `getValidAccessToken(user_id)` — primeiro consumidor real (refresh proativo + lock Redis, ADR-0012)
3. Lê família + variações **não-excluídas** do banco
4. **Sobe as fotos primeiro:** `POST /pictures?source={signedUrl}` para a capa e a foto de cada cor → coleta `picture_id`s. Signed URL com **TTL ≥ 1h** (resolve gap §569). Persiste `ml_picture_id` por variação (coluna já existe).
5. **Monta o payload `/items`** (ADR-0009): `title`, `category_id`, `attributes` (BRAND/MODEL/RIBBON_TYPE/MATERIAL — já temos), `pictures` no nível do item, e `variations[]` — cada cor com `attribute_combinations` (a cor), `available_quantity` (estoque), `price` (`preco_publicacao`, v16), `picture_ids`, GTIN/`seller_custom_field`.
6. `POST /items` (atômico) → sucesso
7. **Persiste:** `familias.ml_item_id`, `ml_permalink`, `status='publicado'`, `publicado_em`; `variacoes.ml_variation_id`

### 5.2 Tratamento de erros

- **4xx** (dado rejeitado) → `status='erro'` + `erro_mensagem` legível; **não** retenta.
- **5xx / 429** (rate limit) → deixa o QStash retentar (retries configurados).
- **Token** → `getValidAccessToken` renova antes de expirar.

### 5.3 Schema

Já pronto de migrations antigas: `familias.ml_item_id/ml_permalink/sale_terms/shipping_mode`, `variacoes.ml_variation_id/ml_picture_id`.

**Migration nova (aditiva):** `variacoes.excluida_da_publicacao boolean NOT NULL DEFAULT false`.

### 5.4 Pontos a validar contra a API real (no plano / bug bash)

Não dá para cravar sem testar com token de produção — viram tarefas de descoberta no plano, no mesmo padrão da concorrência e das categorias:

- **GTIN:** cores com GTIN interno `3000*` ou nulo não são EAN válido → provavelmente exigem marcar "produto sem código universal". Descobrir o atributo correto.
- **`listing_type_id`** (ex.: `gold_special`), **`condition`** (`new`), **`buying_mode`** (`buy_it_now`) — usar padrões e confirmar.
- **Formato exato de foto por variação** em `variations[].picture_ids`.

---

## 6. Relatório, acompanhamento e erros (frontend)

- **Navegação:** após confirmar, vai para `/relatorio/{loteId}` (hoje mock do M1 → dados reais).
- **Ao vivo:** realtime + polling fallback 2.5s (mesmo padrão do Progresso). Famílias migram `publicando → publicado/erro`.
- **Cards de resumo:** publicadas / publicando / com erro / custo de IA do lote.
- **Por família:**
  - Publicado → link clicável real (`ml_permalink`).
  - Publicando → spinner.
  - Erro → `erro_mensagem` (texto do ML) + **"Editar e tentar de novo"** → volta à família na Revisão; corrigida, reenfileira (`status` → `'publicando'`).
- **Status do lote:** `'publicando'` ao disparar; quando não há mais família em `'publicando'`, volta a `'revisao'` se restam publicáveis não publicadas (publicação em ondas) ou `'concluido'` quando não sobra nada publicável. Relatório sempre acessível.

---

## 7. Estratégia de testes

- **Funções puras (TDD vitest):**
  - `familiaPublicavel(familia)` → `{ ok, motivos }` (cobre cada pré-condição + exclusão de cores recalculando)
  - `montarPayloadItem(familia, variacoes)` → JSON do `/items` (entrada conhecida → payload esperado)
- **Edge function `publish-familia-ml`:** validada por **bug bash com 1 família real** (não roda no vitest por ser Deno runtime + API externa), como OAuth/concorrência/categorias. As 3 descobertas (§5.4) acontecem nesse bug bash.

---

## 8. Unidades de trabalho (visão para o plano)

1. Migration `excluida_da_publicacao` + tipos
2. `familiaPublicavel` (puro, TDD) + adapter expõe os campos necessários
3. UX seleção: selo na `FamiliaRow`, checkbox "incluir" no `FamiliaExpanded` (persistindo), filtro "Incompletas", footer "Publicar selecionadas", modal de confirmação
4. Disparo: seta `status='publicando'` + enfileira (reusa `lib/queue` / hook)
5. `montarPayloadItem` (puro, TDD)
6. Edge `publish-familia-ml` (token, fotos `/pictures`, `POST /items`, persistência, erros)
7. Relatório real (consumir dados, links, tentar de novo)
8. Bug bash com 1 família real (descobre GTIN/listing_type/foto) + ADR de fechamento se surgir decisão nova
