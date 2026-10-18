# ADR-0186 — Marca própria por organização: o fornecedor nunca vira marca no canal

- **Status:** aceito
- **Data:** 2026-10-18
- **Relaciona:** ADR-0016 (BRAND no UPDATE), ADR-0088 (UP, ficha do irmão), ADR-0135 (molde do worker de
  sincronização), ADR-0157 (delta de atributos no UPDATE UP), D-E7.3 (`marca_padrao` por org)
- **Spec/plano:** `docs/superpowers/specs/2026-10-18-marca-propria-zaven-design.md`,
  `docs/superpowers/plans/2026-10-18-marca-propria-zaven.md`

## Contexto

BRAND/MANUFACTURER são montados como `fornecedor da planilha || marca_padrao da org`
(`_shared/categoria/atributos.ts`). Na Avil o fornecedor **é** a marca real (Búfalo, Círculo…), e a regra
está certa. A Zaven revende roupa comprada em atacadistas e vende com marca própria: o anúncio
`MLBU5549781487` mostrava "Marca: STAR GLAMOUR" — o fornecedor, que o cliente não pode ver.

Medido em 2026-10-18: `marca_padrao` da Zaven já era `Zaven`, mas nunca usado (as 7 famílias têm
fornecedor). Vazamento só em BRAND (título e descrição limpos). Os 7 anúncios são User Products com
grade (109 SKUs, 0 vendas), pausados pelo Diego de propósito, com imagens colocadas direto no ML.

## Decisão

1. **Flag por org:** `organizations.marca_propria boolean not null default false`, ligada só na Zaven
   (sem UI — decisão do Diego).
2. **Uma política, em `_shared/categoria/marca-org.ts`:** `marcaDoProduto` decide a marca na montagem
   (com marca própria → `marca_padrao`; senão a regra antiga) e `forcarMarcaPropria` a **impõe** nos
   caminhos que preservam, copiam ou mesclam atributos (edição do operador, kit vinculado, herança do
   irmão UP, ramo de atributos editados do `process-familia`) — senão o fornecedor volta por cópia.
   Marca própria sem `marca_padrao` é erro explícito, nunca cai no fornecedor nem em `'Avil'`.
3. **Data fix** na migration: BRAND/MANUFACTURER gravados nas famílias da Zaven viram `Zaven` (sem
   `value_id`). O `ingest-lote` copia `atributos_ml` no UPDATE; sem o fix o próximo lote herdaria o
   fornecedor.
4. **Anúncios já publicados:** worker `sincronizar-marca-ml` (QStash), um PUT só de `attributes`
   (BRAND, e MANUFACTURER se o item já o tiver) por SKU; relê e para na 1ª divergência de marca,
   `family_id` ou status. Idempotente (SKU certo é pulado), com `dry_run`. Não usamos o "Atualizar tudo"
   por planilha: o `ingest-lote` perde `tamanho`/`genero` e os 7 têm grade.
5. **Título fora:** `diagnosticarTitulo` usa o fornecedor também para *remover* do título marca que só
   veio dele; zerá-lo tiraria essa proteção.

## Consequências

- Avil e demais orgs: saída idêntica.
- UPDATE legado (ADR-0016) da Zaven passa a sempre mandar BRAND, mesmo sem fornecedor.
- **Limite conhecido:** o delta do UPDATE UP (ADR-0157) segue medido contra a ficha de um irmão; uma
  falha parcial pode deixar SKU com marca antiga sem o app perceber. Reparo: rodar
  `sincronizar-marca-ml` na família.
- **Medido em produção (00000064, 18/10):** trocar BRAND faz o ML reagrupar a família UP **inteira**
  num `family_id` novo, minutos depois do PUT (a releitura imediata ainda mostra o antigo); MLBU,
  fotos e status não mudam. O worker grava o `family_id` vigente no vínculo local
  (`anuncios_externos_itens`) a cada rodada em que lê os SKUs unificados — rodá-lo de novo depois da
  convergência alinha o banco. Sem isso, a próxima cor nova acusaria "família desagrupada".
- **Proibido republicar** os anúncios da Zaven (remover + publicar) como correção — perderia as imagens
  postas direto no ML. Despausar/repausar só pelo app.
