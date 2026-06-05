# Variação principal + 2ª foto comum — Design

**Data:** 2026-06-05
**Status:** Aprovado (brainstorming) — pronto para plano
**Relacionado:** ADR-0003 (variações agrupadas por PAI) · ADR-0005/0016 (publicação CREATE/UPDATE) · M3.1 (foto-capa por família) · fix item.pictures (2026-06-05)

## Objetivo

Dois controles na Revisão/publicação no Mercado Livre:

1. **Variação principal:** o operador escolhe qual cor é a "variação principal" da família no anúncio. O ML define a principal pela **ordem** das variações (a 1ª do array). Não há campo dedicado na API. ([ML Developers](https://developers.mercadolivre.com.br/pt_br/variacoes), [ML Vendedores](https://vendedores.mercadolivre.com.br/nota/aprenda-a-adicionar-variacoes))
2. **2ª foto comum:** uma segunda foto padrão da família, comum a todas as cores (análoga à capa). Entra como 2ª foto de cada variação e na lista de fotos do item. O ML exige que toda foto de variação esteja também no `item.pictures`.

## Decisões (do brainstorming)

| Tema | Decisão |
|---|---|
| Variação principal — escopo | **Só CREATE.** A principal é definida ao criar o anúncio (ordena o array com ela primeiro). UPDATE não reordena variações (ADR-0016). |
| 2ª foto — fonte | **Espelhar a capa:** prefixo `CAPA2_00CODIGO` no lote **e** botão "Subir 2ª foto" na Revisão. |
| 2ª foto — escopo | **CREATE + UPDATE.** Anúncios novos e os já publicados recebem a 2ª foto. |

**Fora de escopo (YAGNI):** 3ª+ foto comum; reordenar a principal em UPDATE; escolher principal por arrastar.

## Arquitetura

### 1. Banco (migration aditiva `add_capa2_variacao_principal`)

- `familias.capa2_storage_path text` — path da 2ª foto no storage (espelha `capa_storage_path`).
- `familias.capa2_ml_picture_id text` — picture_id da 2ª foto no ML, cacheado (espelha `capa_ml_picture_id`; idempotência no upload).
- `familias.variacao_principal_codigo text` — código (8 dígitos) da variação escolhida como principal; null = ordem padrão.
- Tipos regenerados.

### 2. Entrada da 2ª foto (espelha a capa)

**Via lote (prefixo `CAPA2_`):**
- `_shared/upload/match.ts`: `classificarArquivo` reconhece `CAPA2_(\d{8}).(jpe?g|png)` → `{ tipo: 'capa2', codigo }`. Checar `CAPA2_` **antes** de `CAPA_`/variação (sem colisão de regex, mas explícito).
- `upload-imagens-lote/processar.ts`: ramo `capa2` → grava `familias.capa2_storage_path` (mesma lógica do ramo `capa`, em coluna diferente). Novos retornos `capa2_ok`/`capa2_sem_match`.
- `upload-imagens-lote/index.ts`: contadores `capas2_ok`/`capas2_sem_match` no response.
- `_shared/parser.ts`: `matchCapa2(codigoPai, paths)` (prefixo `CAPA2_`, espelha `matchCapa`).
- `ingest-lote`: no insert das famílias (CREATE e UPDATE), `capa2_storage_path: matchCapa2(...) ?? null`.

**Via Revisão (upload direto):**
- `src/lib/upload-imagens.ts`: `subirCapa2Familia(loteId, codigoPai, arquivo)` (renomeia para `CAPA2_<cod>.<ext>`, valida `capas2_ok === 1`) e `removerCapa2Familia(familiaId, capa2StoragePath)` (zera `capa2_storage_path` + remove do storage). Espelham `subirCapaFamilia`/`removerCapaFamilia`.
- `ResultadoUpload` ganha `capas2_ok`/`capas2_sem_match`.

### 3. Publicação CREATE (`publish-familia-ml` + `montarPayloadItem`)

- `montarPayloadItem(familia, variacoes, capaPic, capa2Pic, listingType)`:
  - Cada variação: `picture_ids = [capaPic, capa2Pic, própria]` (dedup, filtrando nulos).
  - `item.pictures` = união de capaPic + capa2Pic + fotos das variações (dedup).
- `publish-familia-ml`:
  - Sobe a capa2 igual à capa: se `!capa2_ml_picture_id && capa2_storage_path` → `subirFotoML` + persiste `capa2_ml_picture_id` (idempotente em retries).
  - **Ordena as variações com a principal primeiro:** se `variacao_principal_codigo` casar com uma cor incluída, ela vai à frente; o resto segue por `codigo` ascendente. Sem principal → tudo por `codigo`.
  - Passa `capa2PictureId` ao `montarPayloadItem`.

### 4. Publicação UPDATE (`update-familia-ml` + `_shared/ml/atualizar.ts` + `atualizar-item.ts`)

- Sobe a capa2 (idempotente via `capa2_ml_picture_id`), igual ao CREATE.
- **Variações existentes (casadas):** passam a ser reenviadas com `picture_ids = [capa, capa2, própria]` (dedup) — hoje só mandam `available_quantity`. Isto insere a 2ª foto nos anúncios já publicados. `montarVariacoesUpdate` ganha um parâmetro opcional de fotos comuns + a foto própria por código (`ml_picture_id` da variação no banco); quando há fotos a aplicar, emite `picture_ids`, senão mantém o comportamento atual (só estoque).
- **Variações novas:** `montarVariacaoNova` recebe a capa2 e monta `picture_ids = [capa, capa2, própria]`.
- `item.pictures` no PUT = união das fotos atuais do anúncio + capa2 + fotos das variações novas (estende o fix de `item.pictures` já existente).
- Sem `capa2_*` e sem cor nova → comportamento atual (só estoque), nada muda.
- A **variação principal não é reordenada** no UPDATE (decisão: só CREATE).

### 5. Frontend (adapter + UI)

- `tipos-dominio.ts`: `Familia` += `capa2StoragePath: string | null`, `variacaoPrincipalCodigo: string | null`.
- `queries.ts` `familiaFromRow`: lê `capa2_storage_path`, `variacao_principal_codigo`.
- `FamiliaExpanded.tsx`:
  - Bloco da **2ª foto** ao lado da capa (preview + "Subir 2ª foto"/"Remover"), reusando `useImageUrl` e o mesmo padrão de `lidarTrocaCapa`/`lidarRemoverCapa`.
  - **Variação principal** (só quando `familia.operacao === 'CREATE'`): um rádio/seletor por cor incluída; marcar persiste `variacao_principal_codigo`; selo "principal" na cor escolhida.
- Mutation nova `useUpdateVariacaoPrincipal(loteId)` → atualiza `familias.variacao_principal_codigo` + invalida a query.
- A 2ª foto usa as mesmas mutations de upload (via `subirCapa2Familia`).

## Fluxo de dados

```
CAPA2_00CODIGO (lote) ─┐                          ┌─ CREATE: pics variação = [capa, capa2, própria]; principal 1ª
upload na Revisão     ─┴─► familias.capa2_storage_path ─► publish/update sobe capa2 ─► capa2_ml_picture_id ─┤
                                                                                       └─ UPDATE: capa2 nas variações + item.pictures
variacao_principal_codigo ─► publish-familia-ml ordena variações (principal primeiro)  [só CREATE]
```

## Erros & casos de borda

- `CAPA2_` sem família correspondente no lote → conta como `capa2_sem_match` (igual à capa); `subirCapa2Familia` lança "Família não encontrada".
- Sem 2ª foto (`capa2_*` nulos) → fluxo idêntico ao atual (nada é enviado a mais).
- `variacao_principal_codigo` apontando para cor excluída/inexistente → ignorado (cai na ordem por código).
- Máx. fotos por variação: capa + capa2 + própria = 3 (bem abaixo do limite da categoria).
- UPDATE idempotente: reenviar `[capa, capa2, própria]` quando a foto já está lá não duplica (dedup por id).

## Testes (TDD)

- `classificarArquivo`: reconhece `CAPA2_00012345.jpeg` como `capa2`; não confunde com `CAPA_`/variação.
- `matchCapa2`: acha `CAPA2_<pai>` entre os paths; ignora outros.
- `montarPayloadItem`: variações recebem `[capa, capa2, própria]`; `item.pictures` inclui capa2; ordem com a principal primeiro quando informada (e por código quando não).
- `montarVariacoesUpdate`: com fotos comuns informadas, emite `picture_ids = [capa, capa2, própria]`; sem elas, mantém só `available_quantity`.

## Documentação

- **Adendo ao ADR-0003:** a "variação principal" do anúncio é controlada pela ordem do array (1ª = principal); o operador a escolhe na Revisão (`variacao_principal_codigo`), aplicada só no CREATE.
- **Adendo ao ADR-0016:** o UPDATE passa a (re)enviar `picture_ids` das variações existentes quando há 2ª foto comum a aplicar — exceção controlada à preservação de fotos, para propagar a capa2 a anúncios já publicados.
- Atualizar `CLAUDE.md` (convenção de imagens: `CAPA2_` + 2ª foto comum) e histórico ao concluir.
