# ADR-0204 — Kit vinculado leva as fotos 2 a 7 do anúncio da base

Status: ACEITO (2026-11-12) · Relaciona: ADR-0151 (kit vinculado), ADR-0200 (adendo 12/11, galeria das peças), ADR-0203 (§14, bug MLB7585283770)

## Contexto
O kit vinculado nasce só com a capa (`STRIP_FAMILIA_KIT` descarta `capa2/capa3`). O anúncio da base tem até 7+ fotos. O Diego quer as fotos 2 a 7 da base no kit.
O ADR-0200 (adendo 12/11, decisão 6) diz que a publicação comum "não leva galeria" e que `montar-canonico`, `publicar.ts` e `publicar-familia-up` ficam intactos. Essa decisão valia só para o kit com variação (worker `kit-transferencia`). O kit vinculado publica pela publicação comum (Legacy/`criarAnuncio` ou UP), que hoje não lê galeria.

## Decisão
1. **Fonte:** `item.pictures` do anúncio publicado da base, lido do ML (`/items/bulk`), índices 1 a 6 (fotos 2 a 7); a foto 1 nunca entra. Corte extra `MAX_FOTOS_BASE_KIT = 6`, além do limite da categoria do kit (`lerLimiteFotos(categoria do kit) - 1` vagas; limite `null` → sem galeria, nunca presume).
2. **Reuso de `picture_id`** (sem baixar nem subir imagem), salvos em `variacoes.galeria_ml_fotos` (`[{id,item}]`, coluna que já existe) da variação do kit. O servidor recalcula a proposta no `criar-kit-vinculado`; o cliente só remove (grava `proposta ∩ pedido`).
3. **Só `publish-familia-ml` lê a coluna, só para kit vinculado (família com `kit_base_codigo_pai` + `kit_multiplicador`) e só quando não vazia.** `montar-canonico.ts` NÃO muda: a coluna é a mesma do kit com variação e preencher no canônico vazaria para `kit-transferencia` e para a publicação comum desse kit. Sem galeria, o payload é byte-idêntico ao atual (teste de regressão obrigatório). Com galeria: `montarPayloadItem` acrescenta os ids ao fim de `pictures` e, no ramo `variations`, aos `picture_ids` da variação (via parâmetro extra opcional; `ordenarFotosVariacao` mantém as 4 posições atuais para os demais chamadores). Antes do POST, `revalidarGaleria` (com `{id,item}` via `fotosDaColuna`) descarta o que sumiu/foi moderado e só os ids aprovados seguem.
4. **Recusa de foto:** se o ML recusar com erro de foto e a galeria foi usada (`erroDeFoto`), zera `galeria_ml_fotos`, **não** chama `limparCacheFotosFamilia` e recria só com a capa (mesmo contrato do ADR-0200 item 7). Legacy: segundo POST no mesmo processo sem galeria (4xx = nada criado). UP: `retry` só com `tentativas < 10`; senão `status:'erro'` sem limpar cache (a família nunca fica presa em `publicando`). O erro de foto definitivo chega como 400 com `raw.mlCauses`, não como `codigo 'FOTO'` (que é só `item.pictures.unavailable`). Sem galeria usada, o caminho atual não muda.
5. **Variação do kit continua sem imagem própria** (`imagem_path`/`ml_picture_id` nulos; ADR-0203 §14). A capa do kit entra em `usadas` e nunca se repete na galeria. A dedup é por `id`; o risco de mesmo `hash` com id diferente fica documentado.
6. **Só com a base publicada** (`ml_item_id` ou vínculo UP). Base em Revisão: sem galeria, sem erro.
7. **UI:** prévia numerada no preview do kit, reusando `GaleriaPecas`/`kit-galeria.ts`, com "Só a foto do kit" e remover/restaurar por foto; "Criar e publicar" espera a leitura.
8. **Gate da leitura:** edge nova `fotos-base-kit` (só leitura), admin + módulo `estoque` (o do kit vinculado) + categoria validada.

## Não-decisões / riscos
- **O CREATE real com galeria nunca foi medido** (só `PUT` 9/9 e `/items/validate`). O 1º kit real com galeria é validado pelo Diego antes de dar como no ar; o rebaixamento (item 4) é a rede.
- `_shared/` muda (`ml/publicar.ts`, `canais/contrato.ts`, `canais/mercado-livre.ts`, `user-products/publicar-familia-up.ts`; `montar-canonico` não): redeploy de todas as edges que os importam e conferir a versão.
- UPDATE nunca reenvia galeria (o PUT com `pictures` reescreve o anúncio).
- Resultado incerto do POST (timeout) segue o retry atual da publicação comum; a galeria nova não agrava o risco de duplicar.
- `unavailable` esgotado na rota UP zera a galeria sem limpar o cache; se a culpada for a capa, o operador precisa de dois Reenviar até recuperar (aceito).
