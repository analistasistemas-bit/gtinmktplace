# Fase 1 — Controle de preço no UPDATE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao operador controle e visibilidade do preço ao publicar UPDATEs — badge + filtro de "preço alterado" e escolha "Atualizar tudo × Somente estoque" (global + override por produto), com "só estoque" que não empurra preço por nenhum caminho.

**Architecture:** Aditivo e sem split. Uma coluna nova (`variacoes.preco_publicado_ml`) registra o preço vivo por SKU. O worker `update-familia-ml` ganha um modo "somente estoque" que curto-circuita todo push de preço no `_shared/ml/atualizar.ts` (linha 106 + ramo de desconto 99-105) e faz cor nova adotar o preço vivo do anúncio (do GET que o conector já faz). Frontend: badge/filtro na Revisão e um toggle no diálogo de publicação, com a escolha viajando no payload do job (idempotência de retry do QStash).

**Tech Stack:** Supabase edge functions (Deno/TS), React + Vite (front), Vitest, QStash (fila serial por usuário), Mercado Livre API.

## Global Constraints

- **Migrations:** só via `supabase migration new` + `supabase db push`; validar com `npm run db:check`. Nunca `apply_migration`/painel (ADR-0043). Nome: `YYYYMMDDHHMMSS_descricao.sql`. **DDL fica no Opus, nunca rebaixar de modelo.**
- **Nada financeiro defaulta em silêncio** (ADR-0055): cor nova sem preço vivo utilizável em "só estoque" → **falha LOUD**, não publica.
- **Idempotência:** a escolha "somente estoque" (global + overrides) viaja no payload do job — o retry do QStash não pode perder a decisão.
- **"Somente estoque" = comportamento original do corpo do ADR-0016:** envia só `available_quantity`; **nenhum** `price`/`original_price` por nenhum ramo.
- **Preço uniforme por família continua valendo na F1** (sem divergência; split é F2).
- Testes: `pnpm test` (vitest; exige `.env.test` na raiz do worktree). Testes de edge function vivem em `__tests__/` ao lado do código.
- Regenerar `src/lib/database.types.ts` após a migration.

---

### Task 1: Migration — coluna `variacoes.preco_publicado_ml`

**Files:**
- Create: `supabase/migrations/<ts>_variacoes_preco_publicado_ml.sql`
- Modify (regen): `src/lib/database.types.ts`

**Interfaces:**
- Produces: coluna `variacoes.preco_publicado_ml numeric NULL` — preço efetivamente confirmado no ML por SKU no último publish/update; base do badge de "preço alterado".

- [ ] **Step 1: Criar a migration**

```bash
supabase migration new variacoes_preco_publicado_ml
```

Conteúdo do arquivo criado:

```sql
alter table public.variacoes
  add column if not exists preco_publicado_ml numeric null;

comment on column public.variacoes.preco_publicado_ml is
  'Preco de venda efetivamente confirmado no ML para este SKU no ultimo publish/update bem-sucedido. Base do badge "preco alterado" (Revisao). NULL = nunca publicado. ADR-0078.';
```

- [ ] **Step 2: Aplicar e validar**

Run: `supabase db push && npm run db:check`
Expected: migration aplicada; `db:check` sem diffs pendentes.

- [ ] **Step 3: Regenerar tipos**

Run: `supabase gen types typescript --project-id txvncrgkoynoxwopfkbp > src/lib/database.types.ts` (ou via MCP `generate_typescript_types`).
Expected: `variacoes.Row` passa a ter `preco_publicado_ml: number | null`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ src/lib/database.types.ts
git commit -m "feat(preco): coluna variacoes.preco_publicado_ml (ADR-0078 F1)"
```

---

### Task 2: `montarVariacoesUpdate` — modo "somente estoque" suprime todo push de preço

**Files:**
- Modify: `supabase/functions/_shared/ml/atualizar.ts:80-109`
- Test: `supabase/functions/_shared/ml/__tests__/atualizar.test.ts`

**Interfaces:**
- Consumes: assinatura atual `montarVariacoesUpdate(atuais, desejados, picsPorCodigo?, desconto?, precoFamilia?, corDesejadaPorCodigo?)`.
- Produces: novo parâmetro final `somenteEstoque?: boolean`. Quando `true`, nenhuma variação recebe `price` nem `original_price` — nem pelo ramo de desconto (99-105) nem pela linha `precoFamilia` (106).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// em atualizar.test.ts
import { montarVariacoesUpdate } from '../atualizar.ts';

test('somenteEstoque suprime price e original_price mesmo com desconto e precoFamilia', () => {
  const atuais = [{ id: 1, seller_custom_field: 'A1', available_quantity: 5, cor: 'Azul' }];
  const desejados = [{ codigo: 'A1', estoque: 9 }];
  const desconto = { pct: 15, precoPorCodigo: { A1: 20 } };
  const out = montarVariacoesUpdate(atuais, desejados, undefined, desconto, 20, undefined, true /* somenteEstoque */);
  expect(out[0].available_quantity).toBe(9);
  expect(out[0].price).toBeUndefined();
  expect(out[0].original_price).toBeUndefined();
});

test('sem somenteEstoque mantem o comportamento atual (empurra precoFamilia)', () => {
  const atuais = [{ id: 1, seller_custom_field: 'A1', available_quantity: 5, cor: 'Azul' }];
  const out = montarVariacoesUpdate(atuais, [{ codigo: 'A1', estoque: 9 }], undefined, null, 20);
  expect(out[0].price).toBe(20);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- atualizar.test.ts -t somenteEstoque`
Expected: FAIL (parâmetro não existe; `price` vem preenchido).

- [ ] **Step 3: Implementar**

Assinatura (linha 80) — adicionar o parâmetro:

```ts
export function montarVariacoesUpdate(
  atuais: MLVariacaoAtual[],
  desejados: EstoqueDesejado[],
  picsPorCodigo?: Record<string, string[]>,
  desconto?: { pct: number; precoPorCodigo: Record<string, number | null> } | null,
  precoFamilia?: number | null,
  corDesejadaPorCodigo?: Record<string, string | null>,
  somenteEstoque?: boolean,
): VariacaoUpdate[] {
```

Guardar os dois pushes de preço (substituir o bloco 99-106):

```ts
    if (!somenteEstoque && desconto) {
      const preco = desconto.precoPorCodigo[codigo];
      if (preco != null) {
        const de = calcularPrecoDe(preco, desconto.pct);
        if (de !== null) { base.price = preco; base.original_price = de; }
      }
    }
    if (!somenteEstoque && precoFamilia != null && base.price == null) base.price = precoFamilia;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- atualizar.test.ts`
Expected: PASS (novos testes + os existentes de `montarVariacoesUpdate` continuam verdes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/atualizar.ts supabase/functions/_shared/ml/__tests__/atualizar.test.ts
git commit -m "feat(update): montarVariacoesUpdate ganha modo somenteEstoque (ADR-0078 F1)"
```

---

### Task 3: `buscarItemML` — extrair `price` por variação

**Files:**
- Modify: `supabase/functions/_shared/ml/atualizar-item.ts:29-42`, `supabase/functions/_shared/ml/atualizar.ts:55-62` (tipo `MLVariacaoAtual`)
- Test: `supabase/functions/_shared/ml/__tests__/atualizar-item.test.ts` (criar se não existir)

**Interfaces:**
- Produces: `MLVariacaoAtual.price?: number | null` — preço vivo por variação, extraído do GET `/items`. Consumido pela Task 5 (cor nova adota preço vivo).

- [ ] **Step 1: Teste que falha**

```ts
// atualizar-item.test.ts — testa só o mapping (mock do fetch)
test('buscarItemML extrai price por variacao', async () => {
  const fakeFetch = () => Promise.resolve(new Response(JSON.stringify({
    id: 'MLB1', variations: [{ id: 9, seller_custom_field: 'A1', available_quantity: 3, price: 42.5, picture_ids: [] }], pictures: [],
  }), { status: 200 }));
  const globalFetch = globalThis.fetch; globalThis.fetch = fakeFetch as typeof fetch;
  try {
    const item = await buscarItemML('tok', 'MLB1');
    expect(item.variations[0].price).toBe(42.5);
  } finally { globalThis.fetch = globalFetch; }
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `pnpm test -- atualizar-item.test.ts` — Expected: FAIL (`price` undefined; atributo não pedido).

- [ ] **Step 3: Implementar**

Em `atualizar-item.ts:30` incluir `price` nos attributes da URL:

```ts
  const url = `${API}/items/${itemId}?attributes=id,variations,pictures,price`;
```

No mapping (34-42) adicionar `price`:

```ts
    price: v.price ?? null,
```

Em `atualizar.ts` (interface `MLVariacaoAtual`, ~55-62) adicionar:

```ts
  /** Preco de venda vivo da variacao no ML (para cor nova adotar em "somente estoque"). */
  price?: number | null;
```

- [ ] **Step 4: Rodar e ver passar** — Run: `pnpm test -- atualizar-item.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/atualizar-item.ts supabase/functions/_shared/ml/atualizar.ts supabase/functions/_shared/ml/__tests__/atualizar-item.test.ts
git commit -m "feat(update): buscarItemML extrai price por variacao (ADR-0078 F1)"
```

---

### Task 4: `montarVariacaoNova` — cor nova adota preço vivo (ou LOUD) no modo somente estoque

**Files:**
- Modify: `supabase/functions/_shared/ml/atualizar.ts:26-53`
- Test: `supabase/functions/_shared/ml/__tests__/atualizar.test.ts`

**Interfaces:**
- Consumes: `montarVariacaoNova(v, capa, capa2, capa3, categoria, desconto?)`.
- Produces: novo parâmetro `precoVivoAnuncio?: number | null`. Em "somente estoque", o `price` da cor nova = `precoVivoAnuncio` (não o `preco_publicacao`). Se `precoVivoAnuncio` for `null`/inválido → **lança** `Error('Cor nova em "somente estoque" sem preço vivo do anúncio — publique com preço ou repreça (LOUD)')`.

- [ ] **Step 1: Teste que falha**

```ts
test('cor nova em somenteEstoque adota o preco vivo do anuncio', () => {
  const v = { codigo: 'N1', cor: 'Rosa', estoque: 4, preco_publicacao: 30, gtin: null, ml_picture_id: 'P' };
  const out = montarVariacaoNova(v, 'CAPA', null, null, 'MLB123', null, 25 /* precoVivo */);
  expect(out.price).toBe(25); // preco vivo, nao o 30 recalculado
});

test('cor nova em somenteEstoque sem preco vivo lanca LOUD', () => {
  const v = { codigo: 'N1', cor: 'Rosa', estoque: 4, preco_publicacao: 30, gtin: null, ml_picture_id: 'P' };
  expect(() => montarVariacaoNova(v, 'CAPA', null, null, 'MLB123', null, null)).toThrow(/preço vivo/);
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `pnpm test -- atualizar.test.ts -t 'cor nova'` — Expected: FAIL.

- [ ] **Step 3: Implementar**

Assinatura (26) — adicionar `precoVivoAnuncio`:

```ts
export function montarVariacaoNova(
  v: CorNovaInput,
  capaPictureId: string | null,
  capa2PictureId: string | null,
  capa3PictureId: string | null,
  categoriaMlId: string | null,
  desconto?: { pct: number } | null,
  precoVivoAnuncio?: number | null, // quando definido (modo somente estoque), a cor nova entra neste preco
): VariacaoNovaPut {
```

Onde hoje seta `price: v.preco_publicacao ?? 0` (linha 37), trocar por:

```ts
  const emSomenteEstoque = precoVivoAnuncio !== undefined;
  const price = emSomenteEstoque
    ? (precoVivoAnuncio != null && precoVivoAnuncio > 0
        ? precoVivoAnuncio
        : (() => { throw new Error('Cor nova em "somente estoque" sem preço vivo do anúncio — publique com preço ou repreça (LOUD)'); })())
    : (v.preco_publicacao ?? 0);
```

E usar `price` no objeto retornado. (Sem `precoVivoAnuncio` → comportamento atual intacto.)

- [ ] **Step 4: Rodar e ver passar** — Run: `pnpm test -- atualizar.test.ts` — Expected: PASS (inclui os testes existentes de `montarVariacaoNova`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/atualizar.ts supabase/functions/_shared/ml/__tests__/atualizar.test.ts
git commit -m "feat(update): cor nova adota preco vivo em somenteEstoque, senao LOUD (ADR-0078 F1)"
```

---

### Task 5: Conector `atualizarAnuncio` — propaga `somenteEstoque` + preço vivo

**Files:**
- Modify: `supabase/functions/_shared/canais/contrato.ts:107-125` (tipo `AtualizacaoCanonica`), `supabase/functions/_shared/canais/mercado-livre.ts:87-131`
- Test: `supabase/functions/_shared/canais/__tests__/mercado-livre.test.ts` (ou o teste de integração existente do conector)

**Interfaces:**
- Consumes: `MLVariacaoAtual.price` (Task 3); `montarVariacoesUpdate(..., somenteEstoque)` (Task 2); `montarVariacaoNova(..., precoVivoAnuncio)` (Task 4).
- Produces: `AtualizacaoCanonica.somenteEstoque?: boolean`. No conector: quando `true`, passa `somenteEstoque` a `montarVariacoesUpdate`, e para cada cor nova passa como `precoVivoAnuncio` o preço vivo do anúncio — derivado das variações do GET (preço uniforme na F1: usar o `price` da 1ª variação viva; se nenhuma tiver `price`, `null` → o `montarVariacaoNova` lança LOUD).

- [ ] **Step 1: Teste que falha**

```ts
test('atualizarAnuncio em somenteEstoque nao empurra preco e da preco vivo a cor nova', async () => {
  // GET retorna 1 variacao viva a R$ 25; entra 1 cor nova; somenteEstoque=true
  // (usar o harness/mocks do conector já existente no arquivo de teste)
  const res = await atualizarAnuncio(ctxFake, {
    itemExternoId: 'MLB1',
    existentes: [{ sku: 'A1', estoque: 9, cor: 'Azul' }],
    novas: [{ sku: 'N1', cor: 'Rosa', estoque: 4, preco: 30, gtin: null, fotoId: 'P' }],
    somenteEstoque: true,
  } as AtualizacaoCanonica);
  // asserção sobre o PUT capturado: existentes sem price; nova com price=25
  expect(putBody.variations.find(v => v.seller_custom_field==='N1').price).toBe(25);
  expect(putBody.variations.find(v => v.seller_custom_field==='A1').price).toBeUndefined();
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `pnpm test -- mercado-livre.test.ts -t somenteEstoque` — Expected: FAIL.

- [ ] **Step 3: Implementar**

Em `contrato.ts` (`AtualizacaoCanonica`, 107-125) adicionar:

```ts
  /** Modo reposicao pura: nao empurra preco por nenhum ramo; cor nova entra no preco vivo. ADR-0078 F1. */
  somenteEstoque?: boolean;
```

Em `mercado-livre.ts:87-131`, após o GET (`buscarItemML`, ~91), derivar o preço vivo e propagar:

```ts
  const precoVivo = atuais.find((v) => v.price != null)?.price ?? null;
  const variacoesPut = montarVariacoesUpdate(
    atuais, existentes, picsPorCodigo, a.somenteEstoque ? null : a.desconto, a.somenteEstoque ? null : a.precoFamilia, corDesejadaPorCodigo, a.somenteEstoque,
  );
  const novasPut = a.novas.map((n) => montarVariacaoNova(
    n, capa, capa2, capa3, a.categoriaId, a.somenteEstoque ? null : a.desconto,
    a.somenteEstoque ? precoVivo : undefined,
  ));
```

(Nomes `atuais`/`existentes`/`picsPorCodigo`/`corDesejadaPorCodigo` conforme o corpo atual da função — ajustar aos identificadores reais lidos no arquivo.)

- [ ] **Step 4: Rodar e ver passar** — Run: `pnpm test -- mercado-livre.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/canais/contrato.ts supabase/functions/_shared/canais/mercado-livre.ts supabase/functions/_shared/canais/__tests__/
git commit -m "feat(canal): atualizarAnuncio propaga somenteEstoque + preco vivo p/ cor nova (ADR-0078 F1)"
```

---

### Task 6: Payload do job — `somenteEstoque` (global + override) em `publicar-familias` → fila → worker

**Files:**
- Modify: `supabase/functions/_shared/queue.ts:21-25` (interface `ProcessFamiliaJob`) e `:70` (`enfileirarAtualizacao`); `supabase/functions/publicar-familias/index.ts:51-98`; `supabase/functions/update-familia-ml/index.ts:13` (interface `Job`), `:84-93,135-168`
- Test: `supabase/functions/publicar-familias/__tests__/*.test.ts` (resolução da escolha por-família) ou um teste puro do resolvedor.

**Interfaces:**
- Consumes: `AtualizacaoCanonica.somenteEstoque` (Task 5).
- Produces: request body de `publicar-familias` ganha `somente_estoque_global?: boolean` e `somente_estoque_overrides?: string[]` (familia_ids que invertem o global). Resolvedor puro `resolverSomenteEstoque(familiaId, global, overrides): boolean`. O job de update carrega `somenteEstoque: boolean` no payload (idempotência de retry).

- [ ] **Step 1: Teste que falha (resolvedor puro)**

```ts
// helper novo, ex.: publicar-familias/somente-estoque.ts + teste
import { resolverSomenteEstoque } from '../somente-estoque.ts';
test('override inverte o global por familia', () => {
  expect(resolverSomenteEstoque('F1', true, ['F1'])).toBe(false); // global só-estoque, F1 override = atualizar tudo
  expect(resolverSomenteEstoque('F2', true, ['F1'])).toBe(true);
  expect(resolverSomenteEstoque('F3', false, ['F3'])).toBe(true); // global tudo, F3 override = só estoque
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `pnpm test -- somente-estoque.test.ts` — Expected: FAIL (função não existe).

- [ ] **Step 3: Implementar**

Criar `supabase/functions/publicar-familias/somente-estoque.ts`:

```ts
export function resolverSomenteEstoque(familiaId: string, global: boolean, overrides: string[] = []): boolean {
  return overrides.includes(familiaId) ? !global : global;
}
```

Em `queue.ts` estender `ProcessFamiliaJob` (21-25) com `somenteEstoque?: boolean` e propagar em `enfileirarAtualizacao` (70). Em `publicar-familias/index.ts`, ler `somente_estoque_global`/`somente_estoque_overrides` do body e, no loop de enqueue de update (91-98), setar `somenteEstoque: resolverSomenteEstoque(f.id, global, overrides)` no payload. Em `update-familia-ml/index.ts`, estender `Job` (13) com `somenteEstoque?: boolean`; ao montar `desconto` (84-93) e `precoFamilia` (135-136), quando `job.somenteEstoque` passar `somenteEstoque: true` no objeto de `conn.atualizarAnuncio` (153-168) e **não** montar desconto (curto-circuito já coberto no conector, mas evita trabalho).

- [ ] **Step 4: Rodar e ver passar** — Run: `pnpm test -- somente-estoque.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/queue.ts supabase/functions/publicar-familias/ supabase/functions/update-familia-ml/index.ts
git commit -m "feat(publicar): escolha somenteEstoque (global+override) no payload do job (ADR-0078 F1)"
```

---

### Task 7: Gravar `preco_publicado_ml` no sucesso do update/publish

**Files:**
- Modify: `supabase/functions/update-familia-ml/index.ts:180-212` (após casar variações e antes/junto do update de status); `supabase/functions/publish-familia-ml/index.ts` (bloco de sucesso do CREATE)
- Test: helper puro `precoAConfirmar(...)` + teste; verificação manual do worker no fluxo controlado.

**Interfaces:**
- Consumes: o resultado do PUT/POST (`variacoesExternas`: sku→id) e o preço efetivamente enviado por SKU.
- Produces: escrita `variacoes.preco_publicado_ml` por SKV no sucesso. Em "só estoque", o preço confirmado das existentes = o preço vivo (inalterado); da cor nova = o preço vivo adotado. Em "atualizar tudo", = `precoFamilia`/preço enviado.

- [ ] **Step 1: Teste que falha (helper puro)**

```ts
// helper novo update-familia-ml/preco-confirmado.ts
import { precoAConfirmar } from '../preco-confirmado.ts';
test('em somenteEstoque o preco confirmado das existentes e o vivo; tudo empurra o novo', () => {
  expect(precoAConfirmar({ somenteEstoque: true, precoVivo: 25, precoEnviado: 30 })).toBe(25);
  expect(precoAConfirmar({ somenteEstoque: false, precoVivo: 25, precoEnviado: 30 })).toBe(30);
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `pnpm test -- preco-confirmado.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar**

Criar o helper:

```ts
export function precoAConfirmar(p: { somenteEstoque: boolean; precoVivo: number | null; precoEnviado: number | null }): number | null {
  return p.somenteEstoque ? p.precoVivo : (p.precoEnviado ?? p.precoVivo);
}
```

No worker, após o PUT bem-sucedido (perto de 209-212), para cada SKU casado gravar:

```ts
await admin.from('variacoes')
  .update({ preco_publicado_ml: precoAConfirmar({ somenteEstoque: !!job.somenteEstoque, precoVivo, precoEnviado: precoFamilia }) })
  .eq('familia_id', job.familia_id).eq('codigo', codigo);
```

(`precoVivo` obtido do resultado do conector — expor no `ResultadoAtualizacao` o preço vivo por SKU, ou reusar o GET. Ajustar ao retorno real.) Mesmo padrão no CREATE (`publish-familia-ml`), gravando o preço publicado por variação no sucesso.

- [ ] **Step 4: Rodar e ver passar** — Run: `pnpm test -- preco-confirmado.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/update-familia-ml/ supabase/functions/publish-familia-ml/
git commit -m "feat(preco): grava preco_publicado_ml no sucesso do publish/update (ADR-0078 F1)"
```

---

### Task 8: Front — tipo + mapping de `preco_publicado_ml`

**Files:**
- Modify: `src/lib/tipos-dominio.ts:94-115` (`Variacao`); `src/lib/queries.ts:145-160` (`variacaoFromRow`)
- Test: `src/lib/__tests__/queries.test.ts` (se existir) ou teste do helper de badge (Task 9).

**Interfaces:**
- Produces: `Variacao.precoPublicadoMl: number | null`, mapeado de `r.preco_publicado_ml`.

- [ ] **Step 1..4:** adicionar `precoPublicadoMl: number | null;` ao `Variacao` e, em `variacaoFromRow`, `precoPublicadoMl: r.preco_publicado_ml`. (Coberto pelo teste do helper na Task 9.) Rodar `pnpm test` — verde.
- [ ] **Step 5: Commit**

```bash
git add src/lib/tipos-dominio.ts src/lib/queries.ts
git commit -m "feat(front): mapeia preco_publicado_ml (ADR-0078 F1)"
```

---

### Task 9: Front — helper `temAlteracaoPreco` + badge "preço alterado"

**Files:**
- Create: `src/lib/preco-alterado.ts`
- Modify: `src/components/familia-row.tsx:252-303` (adicionar o `StatusPill` "preço alterado")
- Test: `src/lib/__tests__/preco-alterado.test.ts`

**Interfaces:**
- Consumes: `Variacao.precoPublicadoMl`, `Variacao.precoPublicacao`.
- Produces: `temAlteracaoPreco(familia): boolean` — true se alguma variação (incluída) tem `precoPublicadoMl` não-nulo e `round2(precoEfetivo) != round2(precoPublicadoMl)`. Na F1 `precoEfetivo` = preço colapsado da família (1º `precoPublicacao` não-nulo).

- [ ] **Step 1: Teste que falha**

```ts
import { temAlteracaoPreco } from '../preco-alterado.ts';
const fam = (vs) => ({ variacoes: vs });
test('detecta alteracao pelo preco efetivo colapsado', () => {
  expect(temAlteracaoPreco(fam([{ precoPublicacao: 22, precoPublicadoMl: 20, incluida: true }]))).toBe(true);
  expect(temAlteracaoPreco(fam([{ precoPublicacao: 20, precoPublicadoMl: 20, incluida: true }]))).toBe(false);
  expect(temAlteracaoPreco(fam([{ precoPublicacao: 22, precoPublicadoMl: null, incluida: true }]))).toBe(false); // nunca publicado
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `pnpm test -- preco-alterado.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
const round2 = (n: number) => Math.round(n * 100) / 100;
export function temAlteracaoPreco(familia: { variacoes: Array<{ precoPublicacao: number | null; precoPublicadoMl: number | null; incluida?: boolean }> }): boolean {
  const incluidas = familia.variacoes.filter((v) => v.incluida !== false);
  const efetivo = incluidas.find((v) => v.precoPublicacao != null)?.precoPublicacao ?? null; // colapsado (F1)
  if (efetivo == null) return false;
  return incluidas.some((v) => v.precoPublicadoMl != null && round2(efetivo) !== round2(v.precoPublicadoMl));
}
```

No `familia-row.tsx`, perto do selo de status (285-303), quando `temAlteracaoPreco(familia)` renderizar um `StatusPill` (ex.: âmbar) "preço alterado".

- [ ] **Step 4: Rodar e ver passar** — Run: `pnpm test -- preco-alterado.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/preco-alterado.ts src/lib/__tests__/preco-alterado.test.ts src/components/familia-row.tsx
git commit -m "feat(revisao): badge 'preco alterado' por produto (ADR-0078 F1)"
```

---

### Task 10: Front — filtro "só com alteração de preço"

**Files:**
- Modify: `src/pages/Revisao.tsx:40` (`FiltroOp`), `:44-53` (`filtrarFamilias`), `:245-251` (`counts`), `:355-369` (tab bar)
- Test: `src/pages/__tests__/Revisao.test.tsx` (ou teste do predicado, se extraído)

**Interfaces:**
- Consumes: `temAlteracaoPreco` (Task 9).
- Produces: novo valor de `FiltroOp` = `'preco_alterado'` com predicado `temAlteracaoPreco(f)`.

- [ ] **Step 1: Teste que falha** — asserção de que, com `filtro='preco_alterado'`, `filtrarFamilias` retorna só famílias com alteração. (Extrair `filtrarFamilias` para função testável se ainda inline.)
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** — adicionar `'preco_alterado'` à união `FiltroOp`; no `filtrarFamilias`, `case 'preco_alterado': return famsUpdate.filter(temAlteracaoPreco)`; `counts.preco_alterado`; `<TabsTrigger value="preco_alterado">Preço alterado <Badge>{counts.preco_alterado}</Badge></TabsTrigger>` (mostrar só quando a seleção tem UPDATE).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/pages/Revisao.tsx src/pages/__tests__/
git commit -m "feat(revisao): filtro 'preco alterado' (ADR-0078 F1)"
```

---

### Task 11: Front — diálogo de publicação com escolha "Atualizar tudo × Somente estoque" + override

**Files:**
- Modify: `src/pages/Revisao.tsx:261-290` (`confirmarPublicacao`), `:543-640` (Dialog); `src/lib/publicar.ts:22-40` (`publicarFamilias`)
- Test: `src/lib/__tests__/publicar.test.ts` (body montado)

**Interfaces:**
- Consumes: `resolverSomenteEstoque` (semântica; a resolução final é no backend — Task 6).
- Produces: `publicarFamilias(familiaIds, listingTypeId?, canais?, opcoes?: { somenteEstoqueGlobal?: boolean; somenteEstoqueOverrides?: string[] })` → inclui `somente_estoque_global` e `somente_estoque_overrides` no body POST.

- [ ] **Step 1: Teste que falha**

```ts
test('publicarFamilias inclui a escolha de somente estoque no body', async () => {
  const spy = mockFetchCapturandoBody();
  await publicarFamilias(['F1'], 'gold_special', ['mercado_livre'], { somenteEstoqueGlobal: true, somenteEstoqueOverrides: ['F1'] });
  expect(spy.body.somente_estoque_global).toBe(true);
  expect(spy.body.somente_estoque_overrides).toEqual(['F1']);
});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** — estender a assinatura e o body de `publicarFamilias`; no Dialog (só quando `selecaoTemUpdate`), um toggle "Atualizar tudo / Somente estoque" (copiar o padrão do listing-type picker 557-581) e, na lista de selecionadas com badge "preço alterado", um override por produto (checkbox) que preenche `somenteEstoqueOverrides`. `confirmarPublicacao` passa as opções.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**

```bash
git add src/lib/publicar.ts src/pages/Revisao.tsx src/lib/__tests__/publicar.test.ts
git commit -m "feat(revisao): dialogo Atualizar tudo x Somente estoque + override (ADR-0078 F1)"
```

---

### Task 12: Verde total + docs + validação

**Files:**
- Modify: `docs/reference/modelo-de-dados.md` (coluna nova), `docs/reference/edge-functions.md` (modo somenteEstoque no update), `docs/TASKS.md`

- [ ] **Step 1:** `pnpm lint && pnpm test` — tudo verde.
- [ ] **Step 2:** Atualizar `docs/reference/modelo-de-dados.md` (coluna `variacoes.preco_publicado_ml`) e `docs/reference/edge-functions.md` (payload `somente_estoque_*`, modo do worker). Registrar a fatia em `docs/TASKS.md`.
- [ ] **Step 3: Validação (fim de branch):** deploy das edges alteradas via CLI (`update-familia-ml`, `publish-familia-ml`, `publicar-familias`, e todas que importam `_shared/ml`/`_shared/canais` — conferir versão pós-deploy); front no Render; **browser (leitura, Chrome do Diego):** subir uma planilha de update com alteração de preço, ver o badge/filtro, publicar em "Somente estoque" e confirmar no anúncio ao vivo que o preço **não** mudou e o estoque mudou; publicar outra em "Atualizar tudo" e confirmar o preço novo. Comparar Revisão 1:1.
- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: modelo-de-dados + edge-functions + TASKS (ADR-0078 F1)"
```

---

## Self-Review (preenchido)

**Cobertura do spec (F1):** coluna `preco_publicado_ml` (T1, T7) ✓; badge (T9) ✓; filtro (T10) ✓; diálogo global+override (T11, T6) ✓; "só estoque" suprime precoFamilia + desconto (T2) ✓; cor nova adota preço vivo/LOUD (T3,T4,T5) ✓; escolha no payload/idempotência (T6) ✓; sem split/divergência (nenhuma task introduz) ✓. **Fora da F1 (vai pra F2):** preço por variação, agrupamento, split, config por grupo, LOUD de cruzar faixa — corretamente ausentes.

**Placeholders:** nenhum "TODO/depois". Steps de UI (T9-T11) referenciam linhas exatas e trazem o código do núcleo testável; o markup de Dialog/StatusPill segue padrões existentes citados.

**Consistência de tipos:** `somenteEstoque: boolean` atravessa contrato→conector→worker→job; `precoVivoAnuncio`/`precoVivo` derivado de `MLVariacaoAtual.price`; `temAlteracaoPreco`/`precoAConfirmar`/`resolverSomenteEstoque` com assinaturas fixas reusadas nos consumidores.

**Nota de execução:** T1 (migration/DDL) fica no Opus; T2-T7 (lógica de edge/preço, financeiro-sensível) no Opus; T8-T11 (front) podem ir a Sonnet; nunca rebaixar migration/publicação/preço.
