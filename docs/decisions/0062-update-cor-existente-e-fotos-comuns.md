# ADR-0062: UPDATE — renomear cor de variação existente + não duplicar fotos comuns

**Status:** Aceito
**Data:** 2026-07-06
**Decisores:** Diego

## Contexto

Incidente lote #24/#25 (tecido Oxford `02989182`, anúncio `MLB4831319319`). Duas falhas no
fluxo de UPDATE (`update-familia-ml` → `_shared/canais/mercado-livre.ts` → `_shared/ml/atualizar*.ts`):

1. **Nome de cor de variação já publicada nunca ia ao ML.** `montarVariacoesUpdate` montava as
   variações existentes (casadas por `ml_variation_id`) só com `available_quantity`/`price`/
   `picture_ids` — **sem** `attribute_combinations`/COLOR. O atributo COLOR só era montado para
   variações **novas** (`montarVariacaoNova`) e no CREATE. Consequência: corrigir a cor no banco
   ("Rosa" → "Rosa Pink", "Outra" → "Salmão") e republicar não alterava o nome no ML — o PUT saía
   sem COLOR e o ML mantinha o valor antigo. Combina com o fato de que UPDATE **herda** a cor da
   família publicada e `process-familia` pula a resolução quando a cor já vem preenchida
   (`if (v.cor) return v`), então reprocessar também não conserta.

2. **Fotos comuns (CAPA2/CAPA3) duplicavam a cada UPDATE.** A cada re-ingest a família recebe uma
   cópia nova das fotos comuns (novo `storage_path`), o publish faz upload fresco e obtém um novo
   *id de upload*. O item no ML lista os *ids re-hospedados* (o ML re-hospeda; diferem dos ids de
   upload — ver `atualizar-item.ts`). O dedupe (`new Set([...atuais, ...comuns, ...])`) comparava
   ids de upload contra ids re-hospedados → nunca casava → capa2/capa3 reinserida a cada publish,
   acumulando na galeria. Pior: acontecia até em **reposição pura de estoque** (sempre que a
   família tinha capa2/capa3), não só quando havia cor nova.

## Decisão

**Bug 1 — COLOR de variação existente:**
- `buscarItemML` passa a capturar a cor atual do ML por variação (`corDaVariacaoML` extrai o
  `value_name` do atributo COLOR das `attribute_combinations`).
- `montarVariacoesUpdate` ganha `corDesejadaPorCodigo`: inclui `attribute_combinations:
  [{ id: 'COLOR', value_name }]` na variação existente **somente quando** a cor desejada é
  não-vazia **e** difere da que está no ML (idempotente; não toca variação cuja cor não mudou).
- O contrato (`AtualizacaoCanonica.existentes`) passa a carregar `cor`; `update-familia-ml`,
  `publicar-split-ml` e `publicar-anuncio` propagam `variacoes.cor`.

**Bug 2 — fotos comuns:**
- Fotos comuns (capa2/capa3) só são (re)enviadas — nas variações e em `item.pictures` — **quando
  há cor nova sendo criada** (`a.novas.length > 0`). Em UPDATE sem cor nova (reposição de estoque /
  correção de nome), as variações existentes já têm suas fotos no anúncio e nada de foto é enviado
  (o ML preserva). Removida a propagação de fotos comuns às variações **existentes**.

## Consequências e limitações

- Renomear cor de variação **com vendas**: o ML pode recusar a troca do atributo COLOR. Nesse caso
  o PUT falha e o erro chega ao operador (a família fica em `erro`). Correção do anúncio já quebrado
  é feita manualmente no painel do ML; o código garante que publicações futuras saiam corretas.
- **Residual não coberto:** adicionar uma cor **nova** a um anúncio que já tem capa2/capa3 ainda
  pode duplicar as fotos comuns na galeria, porque não há mapeamento entre o id de upload cacheado
  e o id re-hospedado no item — a variação nova precisa referenciar capa2/capa3 e o ML exige que
  estejam em `item.pictures`. Resolver isso exige rastrear o id re-hospedado das fotos comuns
  (ex.: reler o item pós-publish e persistir os ids reais) — fica para um ADR futuro se o caso doer.
- Atualizar uma foto **comum** de variações **existentes** deixa de propagar automaticamente (era a
  fonte da duplicação). Troca de foto comum passa a valer só para cores novas; o operador reenvia
  pelo fluxo de foto por variação se precisar mudar as existentes.

## Como reverter

Remover `corDesejadaPorCodigo`/`attribute_combinations` de `montarVariacoesUpdate`, `corDaVariacaoML`
de `atualizar-item.ts`, o campo `cor` de `AtualizacaoCanonica.existentes` (e nos 3 callers), e
restaurar em `mercado-livre.ts` a propagação de fotos comuns às variações existentes + o
`precisaPictures = novas || comuns`.
