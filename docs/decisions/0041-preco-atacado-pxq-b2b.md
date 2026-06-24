# ADR-0041 — Preço de atacado via PxQ B2B do Mercado Livre

**Status:** Proposto — branch `worktree-atacado-pxq` (aguardando aprovação do plano de implementação)
**Data:** 2026-06-24
**Contexto relacionado:** ADR-0017 (selo de desconto via API de promoções — estacionado), ADR-0005 (lifecycle publish/update), ADR-0018 (dimensões/peso no payload), ADR-0024 (camada de abstração de canais), ADR-0025 (multicanal `anuncios_externos`)

## Problema

O operador (Diego) quer oferecer **preço de atacado**: "a partir de X unidades, Y% de
desconto", com **até 5 faixas**, configurável **por lote** ou **por família**. Ele lembrava de
"já ter feito isso", mas não achava no app.

Investigação: a feature **nunca existiu no app**. O que existia era (a) PxQ configurado
**manualmente** no painel do ML em 2 anúncios (23/06) e (b) scaffolding de banco órfão
(`familias.atacado*`, `configuracoes.atacado_default`) sem lógica nem migration commitada.

O risco central era repetir o destino do **selo de desconto** (ADR-0017), que ficou estacionado
porque dependia de `/seller-promotions` — API que exige permissão especial no DevCenter e
reputação que a conta não tem.

## Decisão

### 1. Usar PxQ nativo, não `/seller-promotions`

O recurso correto é **Preços por Quantidade (PxQ)**, endpoint dedicado da API de preços do item:

```
POST https://api.mercadolibre.com/items/{ITEM_ID}/prices/standard/quantity   (escrever faixas)
GET  https://api.mercadolibre.com/items/{ITEM_ID}/prices   (header show-all-prices: TRUE) (ler)
```

**Contrato confirmado em produção (2026-06-24):** o **POST** em `/prices/standard/quantity` é
o único método (PUT/GET/DELETE nesse path → 405). O body é `{ "prices": [ ...só as faixas
B2B... ] }` — a base do anúncio **não** entra (incluí-la → 400 `marketplace.context.is.mandatory`).
É **full-replace**: o conjunto enviado substitui o anterior; `{ "prices": [] }` limpa as faixas.

- Até **5** faixas (confirmado na doc e no comportamento real da conta).
- **Não** passa por `/seller-promotions` → **não** sofre o bloqueio do ADR-0017.
- Scope OAuth necessário: `write` (já presente).

Rejeitamos a alternativa **Campanhas VOLUME** (`/seller-promotions`, subtipos BNGM/BNSP/SPONTH):
usa o endpoint bloqueado, e cada campanha tem só **uma** condição (precisaria de N campanhas
para N faixas). Não atende "até 5 faixas" de forma simples e está barrado por permissão.

### 2. Gate de viabilidade: conta B2B

PxQ é **B2B-only** (`context_restrictions: [channel_marketplace, user_type_business]`). A
barreira é a **conta do vendedor** ser habilitada como Negócios — não o app. Confirmado para a
conta AVILBV: `tags: ["business"]`, CNPJ `04917296000594`, `cust_type_id: "BU"`. As faixas só
aparecem para compradores B2B; venda no varejo segue pelo preço cheio.

### 3. Percentual na UI, valor absoluto no ML

O operador pensa em "% de desconto"; o ML guarda `amount` absoluto. A conversão é da aplicação:
`amount = precoBase × (1 − pct/100)`. O `precoBase` é o `preco_publicacao` do anúncio
(uniforme entre as cores — 32/32 famílias multi-cor hoje), então o PxQ aplica no **nível do
anúncio** com um preço único.

### 4. Modelo de dados — reusar e formalizar o scaffolding

- `familias.atacado` (jsonb): `[{ "min_unidades": N, "desconto_pct": P }]`, máx 5, crescente.
- `familias.atacado_status` (`pendente`/`aplicado`/`erro`) + `familias.atacado_erro`: rastreio
  da aplicação PxQ no ML, **separado** do `status` de publicação (a publicação não falha se o
  PxQ falhar).
- `configuracoes.atacado_default`: **reservada/não usada** (faixas são definidas a cada
  publicação, decisão do operador).
- Migration commitada com `add column if not exists` para reproduzir o schema (as colunas
  foram criadas fora do controle de migrations).

### 5. Aplicação faseada do PxQ (recurso separado, pós-criação)

PxQ **não** vai no `POST /items` — é uma chamada separada após o item existir. Logo:

- `publish-familia-ml`: aplica PxQ **depois** de criar o item (best-effort, não derruba o
  anúncio; idempotente no ramo "já publicado").
- `update-familia-ml`: **reaplica** (preço pode mudar). Escopo "publicar + sincronizar".

Segue o padrão de recursos separados já usado para **descrição** e **catálogo** (ADR-0021):
falha do recurso acessório não invalida o anúncio criado.

## Consequências

- Atacado deixa de ser tarefa manual no painel do ML e entra no fluxo de publicação do app.
- Não há dependência de permissão de promoções; viável já na conta atual (B2B).
- O preço de varejo é preservado; o desconto é exclusivo do comprador B2B do ML.
- Limitação assumida: faixa por-variação (preços diferentes por cor) fica fora do escopo —
  hoje não há esse caso; usa-se o preço representativo (mínimo) se surgir.
- Risco: o ML pode ter piso de preço por categoria; faixa recusada vira `atacado_status='erro'`
  visível, sem bloquear a publicação.

## Plano de implementação (resumo)

1. Migration `..._familias_atacado.sql` (formaliza colunas + comentários).
2. `_shared/ml/atacado.ts` (`montarFaixasPxQ` puro + `aplicarPxQ`) com testes unitários.
3. Conector ML: `aplicarAtacado` + capability `atacado: true`.
4. `publish-familia-ml`: aplicar PxQ pós-criação + ramo já-publicado.
5. `update-familia-ml`: reaplicar no update.
6. Front: tipo/validação (`src/lib/atacado.ts`, `tipos-dominio.ts`), controle por família
   (`familia-row.tsx`), ação de lote + status (`Revisao.tsx`), mutations
   (`useFamiliaMutations.ts`).

Detalhe completo no spec: `docs/superpowers/specs/2026-06-24-preco-atacado-pxq-design.md`.
