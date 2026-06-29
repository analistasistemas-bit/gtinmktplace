# ADR-0048 — Split de produto em N anúncios ML (limite 100 variações + 99999 estoque)

**Data:** 2026-06-29 · **Status:** aceito · **Spec:** `docs/superpowers/specs/2026-06-29-split-anuncio-100-variacoes-design.md`

## Contexto

O Mercado Livre impõe dois tetos por anúncio (`reference_ml_limites_anuncio`):
1. **Máx. 100 variações** por anúncio.
2. **Estoque total somado ≤ 99.999** por anúncio.

O modelo era **1 produto (`user_id`+`codigo_pai`) = 1 anúncio** (`familias.ml_item_id` escalar).
3 produtos têm catálogo > 100 cores (Fita Cetim N.1 = 137, N.2 = 132, Linha 1500m = 120) e hoje
publicam só parte das cores. Com a inversão opt-out (ADR-0016 adendo 2026-06-29), na próxima
importação eles tentam publicar todas → estouram os dois tetos. O estoque B2B é alto, então um
anúncio cheio de cores (≈100 × ~1.700) passa fácil de 99.999.

## Decisão

Um produto passa a ter **1+ anúncios ("partições")**. O caminho de 1 anúncio (maioria) é
**idêntico** ao atual; o split é aditivo, ativado só quando o produto excede 100 cores.

- **Partição alfabética por nome de cor**, 100 por anúncio, transborda. **Ancoragem:** cor já
  publicada (presente no mapa de SKUs de uma partição) fica fixa nela — nunca migra, então o
  UPDATE não embaralha o que está no ar; a ordem alfabética só posiciona cores **novas**.
- **Cap de estoque por teto automático** (`caparEstoque`): no payload de cada anúncio, só reduz
  quando a soma passa de 99.999, capando as cores de maior estoque (`min(estoque, T)`). No-op para
  todos os anúncios atuais. Vive no **conector ML** (regra do canal), cobrindo criar e atualizar.
- **Título via IA distinto por anúncio** (o ML bloqueia títulos idênticos → `forbidden`). O sistema
  garante os limites; a IA só nomeia.

### Modelo

`anuncios_externos` (antes 1 linha por produto/canal) vira **fonte de verdade da partição**:
`+ particao smallint`, `+ titulo text`, `unique (user_id, canal, codigo_pai, particao)`. Cada linha
= 1 anúncio ML (`item_externo_id` + título + mapa `variacoes_externas` próprio). O mapa por
partição **é a ancoragem** (sku → anúncio), sem nova coluna em `variacoes`. `familias.ml_item_id`
reflete a partição 0 (compat do caminho não-split).

## Consequências

- **Positivas:** todas as cores vendáveis; update de estoque estável (cor não migra); cap resolve
  o teto de 99.999 para qualquer anúncio grande; caminho comum intocado.
- **Custos:** orquestração de publicação passa a iterar por partição; `vincular-catalogo` itera por
  `item_externo_id`; geração de N títulos. Risco residual de o ML tratar anúncios do mesmo produto
  (fotos iguais, títulos distintos) como similares — mitigado por títulos genuinamente diferentes.
- **Fora de escopo:** 3ª partição por estoque puro (cap cobre); cutover total de idempotência para
  `anuncios_externos` (E2.5) — só a partição usa a tabela como verdade.
