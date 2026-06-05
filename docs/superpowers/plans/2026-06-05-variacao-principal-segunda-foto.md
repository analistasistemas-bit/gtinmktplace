# Variação principal + 2ª foto comum — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir escolher a variação principal (só CREATE, via ordem do array) e uma 2ª foto comum a todas as cores (CAPA2_, CREATE+UPDATE) na Revisão/publicação no ML.

**Architecture:** 3 colunas novas em `familias`. A 2ª foto espelha a capa (prefixo `CAPA2_` no lote + upload na Revisão → `capa2_storage_path` → sobe ao ML como `capa2_ml_picture_id` → entra como 2ª `picture` de cada variação e no `item.pictures`, no CREATE e no UPDATE). A variação principal é o código escolhido (`variacao_principal_codigo`); o worker de CREATE ordena as variações com ela primeiro.

**Tech Stack:** Supabase (Postgres + Edge Functions Deno/TS via MCP), React + Vite + TanStack Query, vitest. Test: `pnpm test`. Build: `pnpm build`. Lint: `pnpm lint`.

**Spec:** `docs/superpowers/specs/2026-06-05-variacao-principal-segunda-foto-design.md`

**Convenções de verificação:** `_shared/*.ts` e `src/**` são cobertos por `pnpm test`. Os `index.ts`/`processar.ts` das Edge Functions não têm teste unitário — verificam-se por revisão do diff + `pnpm build` (quando tocam tipos do front) + bug bash. Deploy das edges e `git push` só no fim, com OK do Diego.

---

### Task 1: Migration (3 colunas) + regen de tipos

**Files:**
- DB (MCP `apply_migration`)
- Modify: `src/lib/database.types.ts` (regenerado)

- [ ] **Step 1: Aplicar a migration**

`mcp__supabase-mcp-server__apply_migration`, project_id `txvncrgkoynoxwopfkbp`, name `add_capa2_variacao_principal`:

```sql
alter table familias add column if not exists capa2_storage_path text;
alter table familias add column if not exists capa2_ml_picture_id text;
alter table familias add column if not exists variacao_principal_codigo text;
```

- [ ] **Step 2: Verificar**

`mcp__supabase-mcp-server__execute_sql`:

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='familias'
  and column_name in ('capa2_storage_path','capa2_ml_picture_id','variacao_principal_codigo');
```

Expected: 3 linhas.

- [ ] **Step 3: Regenerar tipos**

`mcp__supabase-mcp-server__generate_typescript_types` e gravar o resultado inteiro em `src/lib/database.types.ts`.

- [ ] **Step 4: Build**

Run: `pnpm build` → `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/database.types.ts
git commit -m "feat(m4): colunas capa2_storage_path/capa2_ml_picture_id/variacao_principal_codigo + regen tipos"
```

---

### Task 2: `classificarArquivo` reconhece `CAPA2_`

**Files:**
- Modify: `supabase/functions/_shared/upload/match.ts`
- Test: `supabase/functions/_shared/upload/__tests__/match.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao `describe('classificarArquivo', ...)`:

```ts
  it('reconhece CAPA2_ com 8 dígitos', () => {
    expect(classificarArquivo('CAPA2_00012345.jpeg')).toEqual({ tipo: 'capa2', codigo: '00012345' });
  });
  it('CAPA2_ não é confundido com CAPA_ nem variação', () => {
    expect(classificarArquivo('CAPA_00012345.jpeg').tipo).toBe('capa');
    expect(classificarArquivo('00012345.jpeg').tipo).toBe('variacao');
  });
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test -- match`
Expected: FAIL — `CAPA2_...` cai em `invalido` hoje.

- [ ] **Step 3: Implementar**

Em `match.ts`, troque o tipo e a função:

```ts
export type Classificacao =
  | { tipo: 'capa'; codigo: string }
  | { tipo: 'capa2'; codigo: string }
  | { tipo: 'variacao'; codigo: string }
  | { tipo: 'invalido' };

const REGEX_CAPA = /^CAPA_(\d{8})\.(jpe?g|png)$/i;
const REGEX_CAPA2 = /^CAPA2_(\d{8})\.(jpe?g|png)$/i;
const REGEX_VARIACAO = /^(\d{8})\.(jpe?g|png)$/i;

export function classificarArquivo(nome: string): Classificacao {
  const mCapa2 = nome.match(REGEX_CAPA2);
  if (mCapa2 && nome.startsWith('CAPA2_')) {
    return { tipo: 'capa2', codigo: mCapa2[1] };
  }
  const mCapa = nome.match(REGEX_CAPA);
  if (mCapa && nome.startsWith('CAPA_')) {
    return { tipo: 'capa', codigo: mCapa[1] };
  }
  const mVar = nome.match(REGEX_VARIACAO);
  if (mVar) {
    return { tipo: 'variacao', codigo: mVar[1] };
  }
  return { tipo: 'invalido' };
}
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `pnpm test -- match` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/upload/match.ts supabase/functions/_shared/upload/__tests__/match.test.ts
git commit -m "feat(m4): classificarArquivo reconhece prefixo CAPA2_"
```

---

### Task 3: `processar.ts` grava a 2ª foto + contadores na edge

**Files:**
- Modify: `supabase/functions/upload-imagens-lote/processar.ts`
- Modify: `supabase/functions/upload-imagens-lote/index.ts`

Sem teste unitário (edge). Verificação por revisão do diff.

- [ ] **Step 1: Adicionar o ramo `capa2` ao `processarArquivo`**

Em `processar.ts`, adicione os retornos `capa2_ok`/`capa2_sem_match` ao tipo:

```ts
export type ResultadoProcessamento =
  | { tipo: 'ok' }
  | { tipo: 'ja_tinha' }
  | { tipo: 'sem_match' }
  | { tipo: 'capa_ok' }
  | { tipo: 'capa_sem_match' }
  | { tipo: 'capa2_ok' }
  | { tipo: 'capa2_sem_match' }
  | { tipo: 'invalido'; erro: string };
```

E, logo após o bloco `if (classificacao.tipo === 'capa') { ... }` (antes do comentário `// classificacao.tipo === 'variacao'`), insira o ramo `capa2` (espelha o da capa, em coluna/pasta diferentes):

```ts
  if (classificacao.tipo === 'capa2') {
    const { data: familias, error } = await admin
      .from('familias')
      .select('id, codigo_pai, capa2_storage_path')
      .eq('lote_id', loteId)
      .eq('user_id', userId);

    if (error) return { tipo: 'invalido', erro: `DB: ${error.message}` };
    const familia = (familias as any[])?.find(
      (f: any) => f.codigo_pai === classificacao.codigo,
    );
    if (!familia) return { tipo: 'capa2_sem_match' };

    const ext = file.name.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg');
    const path = `${userId}/capas2/${classificacao.codigo}.${ext}`;

    const { error: upErr } = await admin.storage
      .from('imagens')
      .upload(path, new Uint8Array(bytes), { contentType: file.type, upsert: true });
    if (upErr) return { tipo: 'invalido', erro: `Storage: ${upErr.message}` };

    await admin.from('familias').update({ capa2_storage_path: path }).eq('id', familia.id);

    return { tipo: 'capa2_ok' };
  }
```

- [ ] **Step 2: Contar capa2 no `index.ts`**

Em `upload-imagens-lote/index.ts`, no objeto `contadores` adicione `capas2_ok: 0, capas2_sem_match: 0,` e no `switch` adicione:

```ts
      case 'capa2_ok':       contadores.capas2_ok++;        break;
      case 'capa2_sem_match': contadores.capas2_sem_match++; break;
```

- [ ] **Step 3: Verificar o diff**

Run: `git diff supabase/functions/upload-imagens-lote/ | grep -E "capa2|capas2"`
Expected: mostra o ramo `capa2` (select/update `capa2_storage_path`, pasta `capas2/`) e os dois contadores.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/upload-imagens-lote/processar.ts supabase/functions/upload-imagens-lote/index.ts
git commit -m "feat(m4): upload-imagens-lote grava 2a foto (CAPA2_) em familias.capa2_storage_path"
```

---

### Task 4: `matchCapa2` no parser + ingest persiste `capa2_storage_path`

**Files:**
- Modify: `supabase/functions/_shared/parser.ts`
- Modify: `supabase/functions/ingest-lote/index.ts`
- Test: `supabase/functions/_shared/__tests__/parser.test.ts` (novo arquivo de teste dedicado a matchCapa2, para não depender do fixture de `agruparPorPai`)

- [ ] **Step 1: Escrever o teste que falha**

Crie `supabase/functions/_shared/__tests__/match-capa2.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchCapa2 } from '../parser';

describe('matchCapa2', () => {
  const paths = [
    'u/lote/CAPA_00445975.jpeg',
    'u/lote/CAPA2_00445975.jpeg',
    'u/lote/00175269.jpeg',
  ];
  it('acha a 2a foto (CAPA2_<pai>) entre os paths', () => {
    expect(matchCapa2('00445975', paths)).toBe('u/lote/CAPA2_00445975.jpeg');
  });
  it('retorna undefined quando não há CAPA2_ do pai', () => {
    expect(matchCapa2('00999999', paths)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test -- match-capa2`
Expected: FAIL — `matchCapa2` não existe.

- [ ] **Step 3: Implementar `matchCapa2`**

Em `supabase/functions/_shared/parser.ts`, logo após `matchCapa` (linha ~104), adicione:

```ts
/** Acha a 2a foto comum (CAPA2_00CODIGO.ext) do PAI entre os paths já no storage. */
export function matchCapa2(codigoPai: string | number, paths: string[]): string | undefined {
  const alvo = `CAPA2_${normalizarCodigo(codigoPai)}`;
  return paths.find((p) => {
    if (!EXT_VALIDAS.test(p)) return false;
    const filename = p.split('/').pop() ?? '';
    const base = filename.replace(EXT_VALIDAS, '');
    return base.toUpperCase() === alvo;
  });
}
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `pnpm test -- match-capa2` → PASS.

- [ ] **Step 5: Persistir no ingest (CREATE e UPDATE)**

Em `supabase/functions/ingest-lote/index.ts`:
- No import do parser, adicione `matchCapa2`:

```ts
import { validarColunas, agruparPorPai, matchImagem, matchCapa, matchCapa2, normalizarCodigo } from '../_shared/parser.ts';
```

- No objeto da família **CREATE** (ramo `if (!ant)`), após `capa_storage_path: matchCapa(...) ?? null,` adicione:

```ts
          capa2_storage_path: matchCapa2(g.codigo_pai, lote.imagens_paths) ?? null,
```

- No objeto da família **UPDATE**, após `capa_storage_path: matchCapa(g.codigo_pai, lote.imagens_paths) ?? null,` adicione a mesma linha:

```ts
        capa2_storage_path: matchCapa2(g.codigo_pai, lote.imagens_paths) ?? null,
```

- [ ] **Step 6: Verificar diff + suíte**

Run: `git diff supabase/functions/ingest-lote/index.ts | grep capa2_storage_path` (2 ocorrências) e `pnpm test` (sem regressão).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/parser.ts supabase/functions/_shared/__tests__/match-capa2.test.ts supabase/functions/ingest-lote/index.ts
git commit -m "feat(m4): matchCapa2 no parser + ingest persiste capa2_storage_path"
```

---

### Task 5: Frontend — `subirCapa2Familia`/`removerCapa2Familia` + contadores

**Files:**
- Modify: `src/lib/upload-imagens.ts`

Sem teste unitário (rede). Verificação por `pnpm build`.

- [ ] **Step 1: Contadores capa2 no `ResultadoUpload`**

Em `src/lib/upload-imagens.ts`, na interface `ResultadoUpload`, adicione após `capas_sem_match: number;`:

```ts
  capas2_ok: number;
  capas2_sem_match: number;
```

- [ ] **Step 2: Funções de 2ª foto (espelham a capa)**

No fim de `src/lib/upload-imagens.ts`, adicione:

```ts
export async function subirCapa2Familia(
  loteId: string,
  codigoPai: string,
  arquivo: File,
): Promise<void> {
  const codigoPadronizado = codigoPai.padStart(8, '0');
  const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpeg';
  const nomeRenomeado = `CAPA2_${codigoPadronizado}.${ext}`;
  const renomeado = new File([arquivo], nomeRenomeado, { type: arquivo.type });
  const r = await uploadImagensLote(loteId, [renomeado]);
  if (r.capas2_ok !== 1) {
    throw new Error(
      r.capas2_sem_match > 0
        ? `Família ${codigoPai} não encontrada no lote.`
        : (r.erros[0]?.motivo ?? r.erros[0] as unknown as string) || 'Falha ao subir 2ª foto.',
    );
  }
}

export async function removerCapa2Familia(familiaId: string, capa2StoragePath: string): Promise<void> {
  const { error: upErr } = await supabase
    .from('familias')
    .update({ capa2_storage_path: null })
    .eq('id', familiaId);
  if (upErr) throw new Error(upErr.message);
  const { error: rmErr } = await supabase.storage.from('imagens').remove([capa2StoragePath]);
  if (rmErr) console.warn('Falha ao remover 2ª foto do storage:', rmErr.message);
}
```

- [ ] **Step 3: Build**

Run: `pnpm build` → `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/upload-imagens.ts
git commit -m "feat(m4): subirCapa2Familia/removerCapa2Familia + contadores capa2 no upload"
```

---

### Task 6: Helper puro `ordenarVariacoesPrincipal`

**Files:**
- Modify: `supabase/functions/_shared/ml/publicar.ts`
- Test: `supabase/functions/_shared/ml/__tests__/publicar.test.ts` (se não existir, criar)

- [ ] **Step 1: Escrever o teste que falha**

Em `supabase/functions/_shared/ml/__tests__/publicar.test.ts`, adicione (criando o arquivo com o import se necessário):

```ts
import { describe, it, expect } from 'vitest';
import { ordenarVariacoesPrincipal } from '../publicar';

describe('ordenarVariacoesPrincipal', () => {
  const vs = [
    { codigo: '00000003' }, { codigo: '00000001' }, { codigo: '00000002' },
  ];
  it('põe a principal primeiro, resto por código', () => {
    expect(ordenarVariacoesPrincipal(vs, '00000002').map((v) => v.codigo))
      .toEqual(['00000002', '00000001', '00000003']);
  });
  it('sem principal (null) → tudo por código', () => {
    expect(ordenarVariacoesPrincipal(vs, null).map((v) => v.codigo))
      .toEqual(['00000001', '00000002', '00000003']);
  });
  it('principal inexistente → tudo por código', () => {
    expect(ordenarVariacoesPrincipal(vs, '00009999').map((v) => v.codigo))
      .toEqual(['00000001', '00000002', '00000003']);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test -- publicar`
Expected: FAIL — `ordenarVariacoesPrincipal` não existe.

- [ ] **Step 3: Implementar**

Em `supabase/functions/_shared/ml/publicar.ts`, adicione (no topo, após os imports):

```ts
/** Ordena as variações com a principal primeiro; o resto por código ascendente.
 *  Genérica em T (só exige `codigo`) p/ servir CREATE (VariacaoInput) e testes. */
export function ordenarVariacoesPrincipal<T extends { codigo: string }>(
  variacoes: T[],
  principalCodigo: string | null,
): T[] {
  const resto = [...variacoes].sort((a, b) => a.codigo.localeCompare(b.codigo));
  if (!principalCodigo) return resto;
  const idx = resto.findIndex((v) => v.codigo === principalCodigo);
  if (idx < 0) return resto;
  const [principal] = resto.splice(idx, 1);
  return [principal, ...resto];
}
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `pnpm test -- publicar` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/publicar.ts supabase/functions/_shared/ml/__tests__/publicar.test.ts
git commit -m "feat(m4): ordenarVariacoesPrincipal (principal primeiro, resto por codigo)"
```

---

### Task 7: `montarPayloadItem` inclui a 2ª foto

**Files:**
- Modify: `supabase/functions/_shared/ml/publicar.ts`
- Test: `supabase/functions/_shared/ml/__tests__/publicar.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicione ao `publicar.test.ts`:

```ts
import { montarPayloadItem } from '../publicar';

describe('montarPayloadItem com 2a foto', () => {
  const familia = { titulo_ml: 'T', descricao_ml: 'D', categoria_ml_id: 'MLB255054', atributos_ml: [] };
  const variacoes = [
    { codigo: '00000001', cor: 'Branco', estoque: 5, preco_publicacao: 10, gtin: '7891234567895', ml_picture_id: 'P1' },
  ];
  it('cada variação tem [capa, capa2, própria] e item.pictures inclui a capa2', () => {
    const p = montarPayloadItem(familia, variacoes, 'CAPA', 'CAPA2');
    expect(p.variations[0].picture_ids).toEqual(['CAPA', 'CAPA2', 'P1']);
    expect(p.pictures.map((x) => x.id)).toEqual(expect.arrayContaining(['CAPA', 'CAPA2', 'P1']));
  });
  it('sem capa2 (null) mantém [capa, própria]', () => {
    const p = montarPayloadItem(familia, variacoes, 'CAPA', null);
    expect(p.variations[0].picture_ids).toEqual(['CAPA', 'P1']);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test -- publicar`
Expected: FAIL — assinatura atual não tem `capa2Pic`.

- [ ] **Step 3: Implementar — novo parâmetro `capa2PictureId`**

Em `montarPayloadItem`, troque a assinatura e a montagem das fotos:

```ts
export function montarPayloadItem(
  familia: FamiliaInput,
  variacoes: VariacaoInput[],
  capaPictureId: string | null,
  capa2PictureId: string | null,
  listingTypeId: string = LISTING_TYPE_PADRAO,
): PayloadItem {
  const comuns = [capaPictureId, capa2PictureId].filter((x): x is string => !!x);
  const picIds = [
    ...comuns,
    ...variacoes.map((v) => v.ml_picture_id).filter((x): x is string => !!x),
  ];
  const pictures: PictureRef[] = [...new Set(picIds)].map((id) => ({ id }));

  const aceitaEmptyGtin = categoriaAceitaEmptyGtinReason(familia.categoria_ml_id);
  const variations: VariacaoItem[] = variacoes.map((v) => {
    const picsVariacao = [
      ...comuns,
      ...(v.ml_picture_id ? [v.ml_picture_id] : []),
    ];
    const variation: VariacaoItem = {
      attribute_combinations: [{ id: 'COLOR', value_name: v.cor ?? '' }],
      available_quantity: v.estoque,
      price: v.preco_publicacao ?? 0,
      picture_ids: [...new Set(picsVariacao)],
      seller_custom_field: v.codigo,
    };
    if (gtinAusente(v.gtin)) {
      if (aceitaEmptyGtin) {
        variation.attributes = [{ id: 'EMPTY_GTIN_REASON', value_id: EMPTY_GTIN_REASON_SEM_CODIGO }];
      }
    } else {
      variation.attributes = [{ id: 'GTIN', value_name: v.gtin! }];
    }
    return variation;
  });

  return {
    title: familia.titulo_ml ?? '',
    category_id: familia.categoria_ml_id ?? '',
    currency_id: CURRENCY,
    buying_mode: BUYING_MODE,
    listing_type_id: listingTypeId,
    condition: CONDITION,
    pictures,
    attributes: familia.atributos_ml ?? [],
    variations,
  };
}
```

- [ ] **Step 4: Rodar e confirmar verde (e checar se há teste antigo de montarPayloadItem chamando com 4 args)**

Run: `pnpm test -- publicar`
Se algum teste pré-existente chamava `montarPayloadItem(familia, variacoes, capa, listingType)` (4 args), atualize-o para `montarPayloadItem(familia, variacoes, capa, null, listingType)`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/publicar.ts supabase/functions/_shared/ml/__tests__/publicar.test.ts
git commit -m "feat(m4): montarPayloadItem inclui a 2a foto comum nas variacoes e no item"
```

---

### Task 8: `publish-familia-ml` — sobe a 2ª foto e ordena pela principal (CREATE)

**Files:**
- Modify: `supabase/functions/publish-familia-ml/index.ts`

Sem teste unitário (edge). Verificação por grep + bug bash.

- [ ] **Step 1: Importar o helper de ordenação**

No import de `publicar.ts`, troque:

```ts
import { montarPayloadItem } from '../_shared/ml/publicar.ts';
```

por:

```ts
import { montarPayloadItem, ordenarVariacoesPrincipal } from '../_shared/ml/publicar.ts';
```

- [ ] **Step 2: Subir a 2ª foto (idempotente) após a capa**

Logo após o bloco que sobe a capa (`if (!capaPictureId && familia.capa_storage_path) { ... }`), adicione:

```ts
    let capa2PictureId: string | null = familia.capa2_ml_picture_id ?? null;
    if (!capa2PictureId && familia.capa2_storage_path) {
      capa2PictureId = await subirFotoML(token, await signed(familia.capa2_storage_path));
      await admin.from('familias').update({ capa2_ml_picture_id: capa2PictureId }).eq('id', job.familia_id);
    }
```

- [ ] **Step 3: Ordenar pela principal e passar a 2ª foto ao payload**

Troque o bloco que monta o payload por (ordena `variacoesComFoto` pela principal e passa `capa2PictureId`):

```ts
    const ordenadas = ordenarVariacoesPrincipal(variacoesComFoto, familia.variacao_principal_codigo ?? null);
    const payload = montarPayloadItem(
      { titulo_ml: familia.titulo_ml, descricao_ml: familia.descricao_ml, categoria_ml_id: familia.categoria_ml_id, atributos_ml: familia.atributos_ml ?? [] },
      ordenadas.map((v) => ({ codigo: v.codigo, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco_publicacao, gtin: v.gtin, ml_picture_id: v.ml_picture_id })),
      capaPictureId,
      capa2PictureId,
      job.listing_type_id,
    );
```

(`variacoesComFoto` tem `codigo`, então `ordenarVariacoesPrincipal` aceita direto.)

- [ ] **Step 4: Verificar diff**

Run: `git diff supabase/functions/publish-familia-ml/index.ts | grep -E "capa2|ordenadas|ordenarVariacoesPrincipal"`
Expected: mostra o upload da capa2, a ordenação e o `capa2PictureId` no payload.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/publish-familia-ml/index.ts
git commit -m "feat(m4): publish-familia-ml sobe a 2a foto e ordena variacoes pela principal"
```

---

### Task 9: `atualizar.ts` — 2ª foto nas variações (existentes e novas) do UPDATE

**Files:**
- Modify: `supabase/functions/_shared/ml/atualizar.ts`
- Test: `supabase/functions/_shared/ml/__tests__/atualizar.test.ts` (criar se não existir)

- [ ] **Step 1: Escrever os testes que falham**

Em `supabase/functions/_shared/ml/__tests__/atualizar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { montarVariacoesUpdate, montarVariacaoNova } from '../atualizar';

describe('montarVariacoesUpdate', () => {
  const atuais = [
    { id: 1, seller_custom_field: '00000001', available_quantity: 10 },
    { id: 2, seller_custom_field: '00000002', available_quantity: 20 },
  ];
  const desejados = [{ codigo: '00000001', estoque: 5 }, { codigo: '00000002', estoque: 8 }];

  it('sem fotos comuns: só atualiza estoque (sem picture_ids)', () => {
    const r = montarVariacoesUpdate(atuais, desejados);
    expect(r[0]).toEqual({ id: 1, available_quantity: 5 });
    expect((r[0] as Record<string, unknown>).picture_ids).toBeUndefined();
  });

  it('com fotos por código: emite picture_ids [capa, capa2, própria] (dedup)', () => {
    const picsPorCodigo = { '00000001': ['CAPA', 'CAPA2', 'P1'], '00000002': ['CAPA', 'CAPA2'] };
    const r = montarVariacoesUpdate(atuais, desejados, picsPorCodigo);
    expect(r[0]).toEqual({ id: 1, available_quantity: 5, picture_ids: ['CAPA', 'CAPA2', 'P1'] });
    expect(r[1]).toEqual({ id: 2, available_quantity: 8, picture_ids: ['CAPA', 'CAPA2'] });
  });
});

describe('montarVariacaoNova com 2a foto', () => {
  it('inclui [capa, capa2, própria] em picture_ids', () => {
    const v = { codigo: '00000009', cor: 'Azul', estoque: 3, preco_publicacao: 12, gtin: null, ml_picture_id: 'PN' };
    const r = montarVariacaoNova(v, 'CAPA', 'CAPA2', 'MLB255054');
    expect(r.picture_ids).toEqual(['CAPA', 'CAPA2', 'PN']);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test -- atualizar`
Expected: FAIL — `montarVariacoesUpdate` ainda não aceita fotos; `montarVariacaoNova` ainda tem 3 args.

- [ ] **Step 3: Implementar — `picture_ids` opcional no update + capa2 na nova**

Em `supabase/functions/_shared/ml/atualizar.ts`:

`VariacaoUpdate` ganha picture_ids opcional:

```ts
export interface VariacaoUpdate { id: string | number; available_quantity: number; picture_ids?: string[]; }
```

`montarVariacoesUpdate` ganha o 3º parâmetro:

```ts
export function montarVariacoesUpdate(
  atuais: MLVariacaoAtual[],
  desejados: EstoqueDesejado[],
  picsPorCodigo?: Record<string, string[]>,
): VariacaoUpdate[] {
  const estoquePorCodigo = new Map(desejados.map((d) => [d.codigo, d.estoque]));
  return atuais.map((a) => {
    const codigo = a.seller_custom_field ?? '';
    const novo = estoquePorCodigo.get(codigo);
    const base: VariacaoUpdate = { id: a.id, available_quantity: novo ?? a.available_quantity };
    const pics = picsPorCodigo?.[codigo];
    if (pics && pics.length > 0) base.picture_ids = [...new Set(pics)];
    return base;
  });
}
```

`montarVariacaoNova` ganha `capa2PictureId` (2º param, após `capaPictureId`):

```ts
export function montarVariacaoNova(
  v: CorNovaInput,
  capaPictureId: string | null,
  capa2PictureId: string | null,
  categoriaMlId: string | null,
): VariacaoNovaPut {
  const pics = [
    ...(capaPictureId ? [capaPictureId] : []),
    ...(capa2PictureId ? [capa2PictureId] : []),
    ...(v.ml_picture_id ? [v.ml_picture_id] : []),
  ];
  const variation: VariacaoNovaPut = {
    attribute_combinations: [{ id: 'COLOR', value_name: v.cor ?? '' }],
    available_quantity: v.estoque,
    price: v.preco_publicacao ?? 0,
    picture_ids: [...new Set(pics)],
    seller_custom_field: v.codigo,
  };
  if (gtinAusente(v.gtin)) {
    if (categoriaAceitaEmptyGtinReason(categoriaMlId)) {
      variation.attributes = [{ id: 'EMPTY_GTIN_REASON', value_id: EMPTY_GTIN_REASON_SEM_CODIGO }];
    }
  } else {
    variation.attributes = [{ id: 'GTIN', value_name: v.gtin! }];
  }
  return variation;
}
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `pnpm test -- atualizar` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/atualizar.ts supabase/functions/_shared/ml/__tests__/atualizar.test.ts
git commit -m "feat(m4): montarVariacoesUpdate aceita picture_ids + montarVariacaoNova recebe capa2"
```

---

### Task 10: `update-familia-ml` — propaga a 2ª foto (existentes + novas + item.pictures)

**Files:**
- Modify: `supabase/functions/update-familia-ml/index.ts`

Sem teste unitário (edge). Verificação por grep + bug bash.

- [ ] **Step 1: Subir a 2ª foto (idempotente)**

No worker, logo após o bloco que sobe as fotos das cores novas (`for (const v of novas) { ... }` que define `novasComFoto`), adicione o upload da capa2:

```ts
    let capa2Pic = (familia.capa2_ml_picture_id as string | null) ?? null;
    if (!capa2Pic && familia.capa2_storage_path) {
      capa2Pic = await subirFotoML(token, await signed(familia.capa2_storage_path as string));
      await admin.from('familias').update({ capa2_ml_picture_id: capa2Pic }).eq('id', job.familia_id);
    }
```

- [ ] **Step 2: Existentes com `picture_ids` quando há 2ª foto**

Troque o bloco que monta `existentes` por (quando há capa2, reenvia `[capa, capa2, própria]` por código):

```ts
    const atual = await buscarItemML(token, familia.ml_item_id);
    const desejados = casadas.map((v) => ({ codigo: v.codigo, estoque: v.estoque }));
    const capaPic = (familia.capa_ml_picture_id as string | null) ?? null;
    // Com 2a foto comum, propaga [capa, capa2, própria] às cores existentes; senão só estoque.
    const picsPorCodigo: Record<string, string[]> = {};
    if (capa2Pic) {
      for (const v of casadas) {
        picsPorCodigo[v.codigo] = [capaPic, capa2Pic, v.ml_picture_id as string | null]
          .filter((x): x is string => !!x);
      }
    }
    const existentes = montarVariacoesUpdate(atual.variations, desejados, capa2Pic ? picsPorCodigo : undefined);
```

(Remova a linha antiga `const capaPic = ...` que ficava mais abaixo, já que agora está aqui em cima — garanta uma única declaração de `capaPic`.)

- [ ] **Step 3: Novas variações recebem a capa2**

Troque a montagem de `novasPut` para passar `capa2Pic` como 2º argumento:

```ts
    const novasPut = novasComFoto.map((v) => montarVariacaoNova(
      { codigo: v.codigo, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco_publicacao, gtin: v.gtin, ml_picture_id: v.ml_picture_id },
      capaPic,
      capa2Pic,
      familia.categoria_ml_id as string | null,
    ));
```

- [ ] **Step 4: `item.pictures` inclui a capa2**

Troque o cálculo de `pictures` (do fix anterior) por (inclui capa2 quando há capa2 ou cor nova):

```ts
    const novasPicIds = novasPut.flatMap((v) => v.picture_ids);
    const precisaPictures = novasPut.length > 0 || !!capa2Pic;
    const pictures = precisaPictures
      ? [...new Set([...atual.pictures, ...(capa2Pic ? [capa2Pic] : []), ...novasPicIds])]
      : undefined;
    const resultado = await atualizarItemML(token, familia.ml_item_id, [...existentes, ...novasPut], atributosItem, pictures);
```

- [ ] **Step 5: Verificar diff**

Run: `git diff supabase/functions/update-familia-ml/index.ts | grep -E "capa2Pic|picsPorCodigo|precisaPictures"`
Expected: mostra o upload da capa2, `picsPorCodigo`, e o cálculo de `pictures` com capa2.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/update-familia-ml/index.ts
git commit -m "feat(m4): update-familia-ml propaga a 2a foto (existentes, novas e item.pictures)"
```

---

### Task 11: Frontend — adapter (`capa2StoragePath`, `variacaoPrincipalCodigo`) + `updateVariacaoPrincipal`

**Files:**
- Modify: `src/lib/tipos-dominio.ts`
- Modify: `src/lib/queries.ts`

- [ ] **Step 1: Campos no tipo `Familia`**

Em `src/lib/tipos-dominio.ts`, na interface `Familia`, após `capaStoragePath: string | null;` adicione:

```ts
  capa2StoragePath: string | null;
  variacaoPrincipalCodigo: string | null;
```

- [ ] **Step 2: Ler no adapter + função de update**

Em `src/lib/queries.ts`, em `familiaFromRow`, após `capaStoragePath: r.capa_storage_path,` adicione:

```ts
    capa2StoragePath: r.capa2_storage_path,
    variacaoPrincipalCodigo: r.variacao_principal_codigo,
```

E adicione a função de update (perto das outras mutations de família, ex.: após `updateFamiliaDescricao`):

```ts
export async function updateVariacaoPrincipal(familiaId: string, codigo: string): Promise<void> {
  const { error } = await supabase
    .from('familias')
    .update({ variacao_principal_codigo: codigo })
    .eq('id', familiaId);
  if (error) throw error;
}
```

(Se `supabase` ainda não estiver importado em `queries.ts`, ele já está — as demais updates o usam.)

- [ ] **Step 3: Build**

Run: `pnpm build` → `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tipos-dominio.ts src/lib/queries.ts
git commit -m "feat(m4): adapter le capa2StoragePath/variacaoPrincipalCodigo + updateVariacaoPrincipal"
```

---

### Task 12: Frontend — UI da 2ª foto + seletor de variação principal

**Files:**
- Modify: `src/hooks/useFamiliaMutations.ts`
- Modify: `src/components/familia-expanded.tsx`

Componente visual; verificação por `pnpm build`.

- [ ] **Step 1: Mutation `useUpdateVariacaoPrincipal`**

Em `src/hooks/useFamiliaMutations.ts`, adicione `updateVariacaoPrincipal` ao import de `@/lib/queries` e a mutation:

```ts
export function useUpdateVariacaoPrincipal(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familiaId, codigo }: { familiaId: string; codigo: string }) =>
      updateVariacaoPrincipal(familiaId, codigo),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}
```

- [ ] **Step 2: Bloco da 2ª foto (espelha a capa) no `FamiliaExpanded`**

Em `src/components/familia-expanded.tsx`:
- Importe `subirCapa2Familia, removerCapa2Familia` de `@/lib/upload-imagens` (junto do import de `subirCapaFamilia, removerCapaFamilia`).
- Adicione, perto de `const { data: capaUrl } = useImageUrl(...)`:

```ts
  const { data: capa2Url } = useImageUrl(familia.capa2StoragePath);
  const inputCapa2Ref = useRef<HTMLInputElement>(null);
  const [trocandoCapa2, setTrocandoCapa2] = useState(false);
  const updatePrincipal = useUpdateVariacaoPrincipal(familia.loteId);
```

- Adicione os handlers (espelham `lidarTrocaCapa`/`lidarRemoverCapa`):

```ts
  async function lidarTrocaCapa2(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setTrocandoCapa2(true);
    try {
      await subirCapa2Familia(familia.loteId, familia.codigoPai, file);
      qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
    } catch (err) {
      alert(`Erro ao subir 2ª foto: ${(err as Error).message}`);
    } finally {
      setTrocandoCapa2(false);
      if (inputCapa2Ref.current) inputCapa2Ref.current.value = '';
    }
  }

  async function lidarRemoverCapa2() {
    if (!familia.capa2StoragePath) return;
    if (!confirm('Remover a 2ª foto desta família?')) return;
    try {
      await removerCapa2Familia(familia.id, familia.capa2StoragePath);
      qc.invalidateQueries({ queryKey: QK.familias(familia.loteId) });
    } catch (err) {
      alert(`Erro ao remover 2ª foto: ${(err as Error).message}`);
    }
  }
```

- No JSX, ao lado do bloco da foto-capa (dentro do mesmo container flex), adicione um bloco análogo para a 2ª foto:

```tsx
        <div className="flex items-start gap-4">
        <FotoCapaFamilia capaUrl={capa2Url ?? null} tamanho="large" />
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">2ª foto (todas as cores)</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => inputCapa2Ref.current?.click()} disabled={trocandoCapa2}>
              <Camera className="mr-2 h-4 w-4" />
              {familia.capa2StoragePath ? 'Trocar 2ª foto' : 'Subir 2ª foto'}
            </Button>
            {familia.capa2StoragePath && (
              <Button variant="ghost" size="sm" onClick={lidarRemoverCapa2}>
                <Trash2 className="mr-2 h-4 w-4" /> Remover
              </Button>
            )}
          </div>
          <input ref={inputCapa2Ref} type="file" accept="image/jpeg,image/png,image/jpg" className="hidden" onChange={lidarTrocaCapa2} />
        </div>
        </div>
```

- [ ] **Step 3: Seletor de variação principal (só CREATE)**

No `map` das variações (onde já há o checkbox e o selo "nova"), após o selo "nova" adicione o seletor de principal — visível só em CREATE:

```tsx
                {familia.operacao === 'CREATE' && !v.excluidaDaPublicacao && (
                  <label className="mt-2 flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                    <input
                      type="radio"
                      name={`principal-${familia.id}`}
                      checked={familia.variacaoPrincipalCodigo === v.codigo}
                      onChange={() => updatePrincipal.mutate({ familiaId: familia.id, codigo: v.codigo })}
                    />
                    {familia.variacaoPrincipalCodigo === v.codigo ? (
                      <span className="rounded bg-blue-100 px-1 font-medium text-blue-700">principal</span>
                    ) : 'principal'}
                  </label>
                )}
```

- [ ] **Step 4: Build**

Run: `pnpm build` → `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFamiliaMutations.ts src/components/familia-expanded.tsx
git commit -m "feat(m4): UI da 2a foto comum + seletor de variacao principal (CREATE) na Revisao"
```

---

### Task 13: Documentação — adendos ADR-0003 e ADR-0016 + CLAUDE.md

**Files:**
- Modify: `docs/decisions/0003-variacoes-agrupadas-por-pai.md`
- Modify: `docs/decisions/0016-publicacao-update-reposicao-estoque.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Adendo ao ADR-0003**

Acrescente ao final de `docs/decisions/0003-variacoes-agrupadas-por-pai.md`:

```markdown

## Adendo (2026-06-05) — Variação principal por ordem

O ML define a "variação principal" do anúncio pela ordem do array de variações (a 1ª = principal). O operador escolhe na Revisão qual cor é a principal (`familias.variacao_principal_codigo`); o worker de CREATE ordena as variações com ela primeiro (resto por código). Aplica-se só ao CREATE — o UPDATE não reordena variações (ADR-0016).
```

- [ ] **Step 2: Adendo ao ADR-0016**

Acrescente ao final de `docs/decisions/0016-publicacao-update-reposicao-estoque.md`:

```markdown

## Adendo (2026-06-05) — 2ª foto comum no UPDATE

Para propagar a 2ª foto comum (`capa2`) aos anúncios já publicados, o UPDATE passa a (re)enviar os `picture_ids` das variações existentes (`[capa, capa2, própria]`) quando há 2ª foto — exceção controlada à preservação de fotos. Idempotente (dedup); sem 2ª foto e sem cor nova, o comportamento segue só-estoque.
```

- [ ] **Step 3: CLAUDE.md — convenção de imagens + histórico**

Em `CLAUDE.md`, na seção "Arquivos e imagens", após a linha da capa adicione:

```markdown
- 2ª foto comum da família: arquivo `CAPA2_00CODIGO.ext` (ou upload na Revisão) → entra como 2ª foto de todas as variações (CREATE e UPDATE)
- Variação principal: escolhida na Revisão (só CREATE); é a 1ª variação enviada ao ML
```

E adicione uma linha à tabela "Histórico deste CLAUDE.md" com data `2026-06-05` resumindo a entrega (variação principal por ordem + 2ª foto comum CAPA2_).

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0003-variacoes-agrupadas-por-pai.md docs/decisions/0016-publicacao-update-reposicao-estoque.md CLAUDE.md
git commit -m "docs(m4): adendos ADR-0003 (variacao principal) e ADR-0016 (2a foto no UPDATE) + CLAUDE.md"
```

---

### Task 14: Verificação final + deploy + push (com OK do Diego)

**Files:** nenhum

- [ ] **Step 1: Suíte + build + lint**

Run: `pnpm test && pnpm build && pnpm lint`
Expected: tudo verde (≈250 testes), `✓ built`, lint 0 errors (3 warnings benignos pré-existentes).

- [ ] **Step 2: Pedir OK ao Diego para deploy + push**

Não prosseguir sem confirmação.

- [ ] **Step 3: Deploy das edges via MCP (após OK)**

Redeploy de: `upload-imagens-lote` (match.ts + processar.ts + index.ts), `ingest-lote` (index + parser.ts), `publish-familia-ml` (index + publicar.ts), `update-familia-ml` (index + atualizar.ts). Padrão da sessão: `get_edge_function` → `index.ts` = repo com `../_shared/`→`./_shared/`; substituir os `_shared` alterados (match.ts, parser.ts, publicar.ts, atualizar.ts) pelo conteúdo do repo; demais files inalterados; `deploy_edge_function` com `verify_jwt:false`. Confirmar a versão de cada função.

- [ ] **Step 4: Push (após OK)**

```bash
git push origin main
```

- [ ] **Step 5: Bug bash (Diego)**

Subir lote com `CAPA2_` (ou subir a 2ª foto na Revisão), escolher a variação principal numa família CREATE, publicar e conferir no ML: 2ª foto presente em todas as cores (CREATE e UPDATE), e a variação principal correta no anúncio novo.

---

## Self-Review

**Spec coverage:**
- §1 Banco → Task 1 ✓
- §2 Entrada 2ª foto (match/processar/parser/ingest/upload Revisão) → Tasks 2, 3, 4, 5 ✓
- §3 CREATE (montarPayloadItem + publish + ordem principal) → Tasks 6, 7, 8 ✓
- §4 UPDATE (atualizar.ts + worker) → Tasks 9, 10 ✓
- §5 Frontend (adapter + UI + mutation) → Tasks 11, 12 ✓
- §Docs → Task 13 ✓
- Deploy/push com OK → Task 14 ✓

**Type consistency:** `montarPayloadItem(familia, variacoes, capaPic, capa2Pic, listingType)` (Tasks 7, 8); `montarVariacaoNova(v, capaPic, capa2Pic, categoriaMlId)` (Tasks 9, 10); `montarVariacoesUpdate(atuais, desejados, picsPorCodigo?)` (Tasks 9, 10); `ordenarVariacoesPrincipal(variacoes, principalCodigo)` (Tasks 6, 8); `Familia.capa2StoragePath`/`variacaoPrincipalCodigo` (Tasks 11, 12); `subirCapa2Familia`/`removerCapa2Familia` (Tasks 5, 12); `useUpdateVariacaoPrincipal({familiaId, codigo})` (Task 12); `classificarArquivo → 'capa2'` (Tasks 2, 3); `matchCapa2` (Task 4). Consistentes.

**Placeholders:** nenhum — todos os steps têm código/comandos concretos.
