# ADR-0199 — Tirar uma família da Revisão (edge `excluir-familia`)

**Status:** Aceito
**Data:** 2026-11-08
**Contexto relacionado:** ADR-0019 (exclusão de lote preserva publicadas), ADR-0088 (User Products / janela `criacao_incerta`), ADR-0097 (movimentos órfãos), ADR-0113 (excluir produto), ADR-0151 (kit vinculado), ADR-0161 (migração PxV)
**Plano:** `docs/superpowers/plans/2026-11-08-tirar-familia-da-revisao.md`

## Contexto

Na tela Revisão o operador só tinha dois extremos: excluir uma variação (dentro da família) ou excluir o lote inteiro (`excluir-lote`). Quando uma planilha traz um produto que não deve ir ao ar — linha duplicada, produto errado, reposição que não interessa —, a única saída era não selecioná-lo e deixar a família parada no lote para sempre, ou apagar o lote todo e subir a planilha de novo.

O risco de apagar uma família isolada é o mesmo do ADR-0019: a linha pode ser o único registro local de um anúncio vivo no Mercado Livre (vínculo de UPDATE, item User Products cuja saga não terminou, variação criada sem `publicado_em` — incidente Xik 2026-08-13 —, item em `criacao_incerta` — incidente do Ninho 2026-09-10). Apagar essa linha deixa o anúncio vendendo sem baixar estoque.

## Decisão

1. **Nova edge `excluir-familia`** (body `{ familia_id }`), uma família por vez, acionada pela linha da Revisão ("Tirar da revisão"). Seleção de publicar e exclusão nunca se misturam. O `excluir-lote` não muda.

2. **Só sai família com `publicado_em IS NULL` e `status` ∈ {`pronto`, `erro`}.** Sem status novo, sem desfazer. O Mercado Livre nunca é chamado.

3. **Permissão = a do `excluir-lote`:** `requireUserOrg(req, { access: 'write' })` + `podeExcluirLote(lote.user_id, userId, support?.scope === 'full')`. Família de outra org ou de lote alheio responde 404. Lote em `processando`/`publicando` → 409.

4. **Regra de decisão (função pura `decidirExclusaoFamilia`)**, sobre a família alvo, as irmãs (outras famílias da org com o mesmo `codigo_pai` ou o mesmo `ml_item_id` não nulo), as linhas de `anuncios_externos` do `codigo_pai` (com os filhos de `anuncios_externos_itens`) e a quantidade de kits que usam o `codigo_pai` como base:
   1. `publicado_em != null` → `publicada`.
   2. `status ∉ {pronto, erro}` → `em_voo`.
   3. Qualquer leitura que falhou → `nao_conferido` (trava fechada).
   4. Raiz em `pendente`/`publicando`, ou filho em `pendente`/`criacao_incerta`/`compensacao_pendente`/`remocao_pendente` → `em_voo` (fan-out em voo, saga UP interrompida, janela de idempotência do ADR-0088).
   5. Evidência remota (`item_externo_id` na raiz ou num filho, ou raiz `publicado`) sem irmã → `vinculada`. Com irmã, a linha sai: a irmã continua representando o produto.
   6. Anti-órfão de variação: um `ml_item_id|ml_variation_id` da família que nenhuma irmã cobre → `vinculada`.
   7. Sem irmã e com kit dependente → `kit`.
   8. Senão → pode sair.

   O guard de migração PxV (`motivoMigracaoPxvEmCurso`, ADR-0161) roda antes e recusa com a mensagem dele.

5. **DELETE condicional** (`status in (pronto, erro)` e `publicado_em is null`): fecha a corrida com o claim do worker. Se a família virou `publicando` entre a leitura e o DELETE, nada é apagado e a resposta é `em_voo`. O trigger de kit do banco (`23514`) vira recusa `kit` com a mensagem do banco.

6. **Depois do delete:** limpa movimentos órfãos (ADR-0097 D-2) e fecha o lote com leitura e escrita conferidas — lote vazio é apagado; senão regrava os contadores e o status de `decidirStatusLote`. Erro aqui lança (500).

7. **Storage best-effort:** apaga só arquivos sob o prefixo do dono, e nenhum que outra família ou variação da org ainda referencie. Se o lote sobreviveu, os arquivos de `lotes.imagens_paths` ficam para o `excluir-lote`. Se qualquer leitura de referência falhar, nada é apagado.

8. **Contrato HTTP:** 200 `{ ok: true, lote_removido }`; todo 4xx é `{ erro }`:
   - 400 `familia_id obrigatório`
   - 404 `Família não encontrada.`
   - 409 `publicada`: `Família já publicada — use a tela Publicados.`
   - 409 `em_voo`: `Há processamento ou publicação em andamento para este produto. Aguarde terminar.`
   - 409 `vinculada`: `Família ligada a anúncio no Mercado Livre e é a única que o representa — não pode sair. Basta não selecioná-la.`
   - 409 `kit`: `Produto tem kit vinculado: remova os kits antes.` (ou a mensagem do trigger)
   - 409 `pxv`: a mensagem do guard de migração
   - 409 `nao_conferido`: `Não deu para conferir o vínculo com o Mercado Livre. Nada foi apagado — tente de novo.`

## Consequências

- A reposição UPDATE sai quando há irmã que represente o produto; a única linha que representa um anúncio vivo fica (o operador só não a seleciona).
- Uma foto compartilhada (capa de kit = foto da base) fica enquanto alguém a usa.
- Para trazer a família de volta, sobe-se a planilha de novo.
- `excluir-lote` intocado; sem migration nem schema novo.
