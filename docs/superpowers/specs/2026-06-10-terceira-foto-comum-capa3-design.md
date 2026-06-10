# Spec — 3ª foto comum por família (`CAPA3_`)

**Data:** 2026-06-10
**Status:** aprovado (brainstorming)
**Origem:** o ML recomenda 3 fotos por anúncio; hoje o app envia no máximo 2 fotos comuns por família (capa + CAPA2). O recurso "Gerar fotos com IA" do editor web do ML **não é exposto pela API pública** (investigação 2026-06-10: só `POST /pictures`, diagnóstico de imagens e substituição — geração de imagem é UI-only / projeto interno GenAds). Logo, a 3ª foto recomendada é provida como uma **3ª foto comum da família**, sem IA.

## Decisão

Espelhar fielmente a infraestrutura da **2ª foto comum (`CAPA2_`)**, adicionando uma 3ª: `CAPA3_`. Sem geração por IA (evita inventar a aparência do produto real — proibido pelo CLAUDE.md — e o risco de moderação do ML). Sem `CAPA4+` (YAGNI: só a 3ª recomendada).

### Ordem das fotos (decisão do Diego, 2026-06-10)

A CAPA3 entra **logo após a CAPA2**, padrão para toda a família. A 1ª posição da galeria de cada cor continua sendo uma foto principal (a foto-capa da família quando existe; senão a própria foto da cor — caso real do Diego, em que muitas famílias não têm `CAPA_`). Ordem resultante por variação:

```
[ líder, CAPA2, CAPA3, foto-da-cor ]
```

onde `líder = capa-da-família ?? foto-da-cor`. A CAPA2 e a CAPA3 **nunca** lideram (o ML usa a 1ª `picture_id` como capa da galeria da cor).

## Modelo de dados (migration aditiva)

Duas colunas novas em `familias`, espelhando `capa2_*`:

- `capa3_storage_path text` — caminho no Storage da 3ª foto comum
- `capa3_ml_picture_id text` — cache do `picture_id` do ML após o 1º upload (idempotência em retries)

Nenhuma coluna removida. `gen types` regenerado (`database.types.ts`).

## Entrada da imagem (dois caminhos, igual à CAPA2)

1. **Em lote:** prefixo de arquivo `CAPA3_00CODIGO.ext`.
   - `classificarArquivo` (`_shared/upload/match.ts`) ganha o tipo `capa3` + `REGEX_CAPA3`.
   - `matchCapa3(codigoPai, paths)` em `_shared/parser.ts`.
   - `ingest-lote` seta `capa3_storage_path` no insert das famílias (CREATE e UPDATE).
   - `upload-imagens-lote/processar.ts` trata o tipo `capa3` (upload em `${userId}/capas3/`); `index.ts` conta `capas3_ok`/`capas3_sem_match`.

2. **Manual na Revisão:** botão "Subir 3ª foto" no `familia-expanded`.
   - `subirCapa3Familia`/`removerCapa3Familia` (`src/lib/upload-imagens.ts`), reusando `upload-imagens-lote`.
   - `ResultadoUpload` ganha `capas3_ok`/`capas3_sem_match`.

## Publicação CREATE (`publish-familia-ml` + `_shared/ml/publicar.ts`)

- `ordenarFotosVariacao(capa, capa2, capa3, propria)` → `[líder, capa2, capa3, propria]` deduplicado.
- `montarPayloadItem(...)` ganha o parâmetro `capa3PictureId` **logo após** `capa2PictureId`; insere a CAPA3 após a CAPA2 nas `picture_ids` de cada variação e no `item.pictures`.
- O worker resolve/sobe a CAPA3 (signed URL 2h + cache `capa3_ml_picture_id`) igual à CAPA2 e a repassa.

## Publicação UPDATE (`update-familia-ml` + `_shared/ml/atualizar.ts`)

- `montarVariacaoNova(...)` (cor nova) ganha `capa3PictureId` logo após `capa2PictureId`.
- Variações existentes: o worker resolve `capa3Pic` e monta `picsPorCodigo[codigo] = [líder, capa2, capa3, ...resto-atual]` (dedup), propagando a 3ª foto a todas as cores já publicadas. `item.pictures` inclui a CAPA3. `montarVariacoesUpdate` não muda de assinatura (já recebe `picsPorCodigo` genérico).
- Adendo aos ADR-0003 e ADR-0016 (mesma mecânica da CAPA2).

## Limpeza / consistência

- `_shared/lote/exclusao.ts`: `FamiliaExclusao` e `pathsDaFamilia` consideram `capa3_storage_path`.
- `excluir-lote` e `remover-publicado`: selects incluem `capa3_storage_path`.

## Frontend

- `tipos-dominio.ts`: `Familia.capa3StoragePath: string | null`.
- `queries.ts`: adapter `capa3StoragePath: r.capa3_storage_path` (select já é `'*, variacoes(*)'`).
- `familia-expanded.tsx`: 3º bloco de foto (espelho do bloco da CAPA2) com `useImageUrl(familia.capa3StoragePath)`, botão "Subir 3ª foto"/"Trocar 3ª foto" e remover.

## Testes (TDD)

- `matchCapa3` (parser): acha `CAPA3_<pai>`; `undefined` sem match; não confunde com `CAPA_`/`CAPA2_`.
- `classificarArquivo`: classifica `CAPA3_` como `capa3` (sem colidir com capa/capa2/variação).
- `ordenarFotosVariacao` com 4 fotos: `[capa, capa2, capa3, propria]`; sem-capa → `[propria, capa2, capa3]`; dedups.
- `montarPayloadItem` com capa3: ordem por variação e `item.pictures`.
- `montarVariacaoNova` com capa3: `[capa, capa2, capa3, propria]` e sem-capa.

## Fora de escopo (YAGNI)

- Geração de imagem por IA (decisão tomada: inviável via API + risco de moderação).
- `CAPA4+`.
- Layout novo de galeria na Revisão (reusa o componente da CAPA2).

## Pendente após implementação

- Deploy via CLI completa (regra "deploy nunca defasado"): `ingest-lote`, `upload-imagens-lote`, `publish-familia-ml`, `update-familia-ml`, `excluir-lote`, `remover-publicado` (mudança em `_shared` → redeployar todas as afetadas).
- Bug bash com token real (subir `CAPA3_` em lote + botão na Revisão; conferir a 3ª foto na galeria do ML em CREATE e UPDATE).
