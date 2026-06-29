# Split de produto em N anúncios ML (limite 100 variações + 99999 estoque)

**Data:** 2026-06-29 · **Status:** aprovado (brainstorming) · **ADR:** 0048

## Problema

O Mercado Livre impõe dois tetos por anúncio (ver `reference_ml_limites_anuncio`):
1. **Máx. 100 variações** por anúncio.
2. **Estoque total somado ≤ 99.999** por anúncio.

Hoje o modelo é **1 produto (`user_id`+`codigo_pai`) = 1 anúncio** (`familias.ml_item_id` escalar).
Produtos com >100 cores (3 de 74 publicados, máx. 137 cores; estoque somado até 181k) **não
conseguem publicar todas as cores**, e o UPDATE de estoque estoura os 99.999. Caso âncora:
`02835002` "Linha p/ Costura 1500m", 118 cores, soma 173k.

## Objetivo

Permitir que **1 produto vire N anúncios** ("partições"), todas as cores vendáveis, com **update
de estoque estável** (cor já publicada nunca migra de anúncio). O caminho de 1 anúncio (maioria
dos produtos) permanece **idêntico** — split é aditivo, ativado só quando excede 100 cores.

## Decisões (do brainstorming)

- **Split automático** no sistema quando o produto passa de 100 cores.
- **Partição alfabética por nome de cor**, 100 por anúncio, transborda pro próximo.
- **Ancoragem:** cor já publicada (tem `ml_variation_id` num anúncio) fica fixa naquele anúncio;
  a ordem alfabética só posiciona cores **novas** (preenche partição com espaço, senão abre nova).
- **Título via IA**, distinto por anúncio (o ML bloqueia títulos idênticos → `forbidden`). O
  sistema garante os limites; a IA só nomeia.
- **Cap de estoque por teto automático**: só reduz quando a soma do anúncio passa de 99.999,
  capando só as cores de maior estoque (`min(estoque, T)`); estoque real preservado no banco.

## Modelo de dados

`anuncios_externos` (hoje espelho 1:1 por `codigo_pai`) vira a **fonte de verdade da partição**:

- `+ particao smallint not null default 0` — índice do anúncio dentro do produto (0,1,2…).
- `+ titulo text` — título que a IA gerou para aquele anúncio.
- `unique (user_id, canal, codigo_pai)` → `unique (user_id, canal, codigo_pai, particao)`.

Cada linha = 1 anúncio ML, com seu `item_externo_id`, `titulo` e mapa `variacoes_externas`
(`sku → {variation_id, catalog_*}`) — o mapa já diz **quais cores estão em qual anúncio**
(âncora da estabilidade). `familias.ml_item_id` continua refletindo a **partição 0** (compat do
caminho não-split). Produtos com ≤100 cores: 1 linha (`particao=0`), comportamento atual.

## Componentes

### 1. `particionar` (função pura, `_shared/split/particionar.ts`)
Entrada: `cores: {sku, cor}[]`, `ancoragem: Map<sku, particao>`, `MAX=100`.
Lógica: cada cor ancorada fica na sua partição; as novas, ordenadas por `cor` (alfabético, tie por
`sku`), preenchem a partição de menor índice com `count < MAX`; sem espaço, abre nova partição.
Saída: `Map<sku, particao>`. **Estoque não entra aqui** (o cap garante; partição é só contagem).

### 2. `caparEstoque` (função pura, `_shared/split/capar-estoque.ts`)
Entrada: `itens: {sku, estoque}[]`, `LIMITE=99999`.
Se `sum(estoque) ≤ LIMITE` → devolve estoque real. Senão acha o maior teto `T` (busca binária)
com `sum(min(estoque,T)) ≤ LIMITE` e devolve `min(estoque,T)` por sku. Aplicado no payload
`available_quantity` de **criar e atualizar**, por anúncio.

### 3. Títulos por partição
Partição nova → `gerarCopy` recebe as cores **daquela** partição e produz título distinto;
o orquestrador garante unicidade entre partições do mesmo produto (se colidir, desempata pela
cor dominante). Partição existente → mantém `anuncios_externos.titulo`.

### 4. Orquestração
Antes de publicar, um passo calcula `sku → particao` (ancoragem de `anuncios_externos` +
`particionar`). Para cada partição: **criar** (sem `item_externo_id`) ou **atualizar** (existente)
via conector de canal, na fila serial (ADR-0034). `publish`/`update`/`vincular-catalogo` iteram
por partição. Partição 0 espelha em `familias.ml_item_id`.

## Fluxos

**CREATE (>100 cores):** ingest agrupa → process-familia resolve cores → particiona (alfabético) →
por grupo: título IA distinto + cria anúncio (cap estoque) + grava `anuncios_externos`(particao,
item_externo_id, titulo, variacoes_externas) → vincular-catalogo por anúncio.

**UPDATE (reposição/cor nova):** ingest casa por sku → lê ancoragem → particiona (ancoradas ficam,
novas entram alfabético) → cada partição existente: repõe estoque (cap) + adiciona cores novas
daquela partição; partição transbordada → cria anúncio novo.

**Não-split (≤100 cores):** K=1, partição 0 = `familias.ml_item_id`. Sem mudança de comportamento.

## Testes

- **Unit (Deno TDD):** `particionar` — <100 (1 partição), >100 (2), ancoragem preserva, cor nova
  transborda sem mover ancoradas, conjunto estável idempotente. `caparEstoque` — sob limite (no-op),
  sobre limite (acha teto), todas iguais, uma gigante.
- **Integração:** `deno check`/`lint` das functions, `tsc -b && vite build` do front.
- **E2E controlado:** publicar `02835002` em 2 anúncios reais no ML e conferir as 118 cores
  distribuídas, estoque dentro do teto, títulos distintos.

## Fora de escopo (YAGNI)

- 3ª partição automática por estoque puro (só por contagem hoje; cap cobre estoque).
- Cutover completo de idempotência para `anuncios_externos` (E2.5) — só a partição usa a tabela
  como verdade; o resto segue lendo `familias.ml_item_id`.
- UI dedicada de "produto com N anúncios" na Revisão (a publicação é automática; Publicados lista
  por anúncio via `anuncios_externos`).
