# Sugestão de Categoria pela Ficha de Catálogo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calcular ANTES de publicar a categoria cujo domínio bate com a ficha de catálogo do GTIN e, quando ela diverge da categoria escolhida, oferecê-la como sugestão clicável não-vinculante na Revisão e citá-la no alerta Telegram pós-publicação.

**Architecture:** Estende o padrão do ADR-0057 (coluna persistida + card clicável, nunca aplicado sozinho). `process-familia` ganha uma etapa best-effort que compara o domínio da ficha (`/products/search`) com o domínio da categoria escolhida (`GET /categories/{id}` → `settings.catalog_domain`) e, na divergência, resolve a categoria real pelos itens da ficha (`/products/{id}/items`, reusando `parseItensProduto`). Persiste 3 colunas aditivas em `familias`; o card lê direto da row (sem rede, sem tocar `atributos-familia`); `vincular-catalogo` cita a sugestão no alerta de `ficha_divergente`.

**Tech Stack:** TypeScript, Supabase Edge Functions/Deno, Vitest, React 18, Redis/Upstash, API Mercado Livre.

**Spec:** `docs/superpowers/specs/2026-08-22-sugestao-categoria-catalogo-design.md` (revisada 2026-08-22 — contratos de API confirmados com token real; ler antes de executar).

## Global Constraints

- Migration SÓ via `supabase migration new` + `supabase db push` (ADR-0043). Nunca `apply_migration`/painel.
- A sugestão NUNCA é aplicada automaticamente (ADR-0054 Fase 2) e NUNCA bloqueia publicar — decisão do Diego, não renegociar.
- A etapa nova no `process-familia` é best-effort: qualquer falha → sem sugestão, sem exception propagada, sem mudar `status`.
- `esperado.domainId` NUNCA é preenchido na trava anti-kit pré-publicação (a divergência de domínio é o sinal da sugestão, não motivo de reprova).
- A etapa NÃO roda no fluxo UPDATE (categoria de anúncio publicado não pode mudar — incidente Aquaphor/re-moderação).
- Todo `categoriaId` interpolado em URL passa por `ehCategoriaMlValida` (guard anti-SSRF, achado F4).
- Contratos confirmados com token real (2026-08-22): `GET /categories/{id}` → `settings.catalog_domain`; `GET /products/{fichaId}/items` → `results[].category_id`; `/products/search` → `results[0].domain_id` no mesmo formato (`MLB-...`). Não re-investigar.
- Deploy de Edge Functions é tarefa própria (Task 8), na ordem: migration no banco ANTES do deploy das functions.
- Sem dependências novas. Commits frequentes, um por task.
- Pré-push do frontend: `npx tsc -b --force` (o build incremental local passa com tsbuildinfo stale; o CI não).

---

## File Structure

- `supabase/migrations/<timestamp>_sugestao_categoria_catalogo.sql`: 3 colunas aditivas em `familias`.
- `supabase/functions/_shared/ml/catalogo.ts`: funções puras `montarEsperadoPrePublicacao` e `deveSugerirCategoriaPorFicha` + wrapper de rede `buscarCategoriaFicha`.
- `supabase/functions/_shared/ml/__tests__/catalogo-sugestao-categoria.test.ts`: limites da decisão pura.
- `supabase/functions/_shared/ml/domain-discovery.ts`: `buscarDominioCategoria` (espelho de `buscarNomeCategoria`).
- `supabase/functions/_shared/ml/__tests__/domain-discovery.test.ts`: novos casos do domínio.
- `supabase/functions/process-familia/sugestao-catalogo.ts`: orquestração com deps injetadas (testável sem rede).
- `supabase/functions/process-familia/__tests__/sugestao-catalogo.test.ts`: fluxo Aquaphor + curto-circuitos.
- `supabase/functions/process-familia/index.ts`: fiação (claim select + bloco 5f + UPDATE final).
- `supabase/functions/_shared/notificacoes/telegram.ts`: campo `categoriaSugerida` + linha no alerta.
- `supabase/functions/_shared/notificacoes/__tests__/catalogo-nomatch.test.ts`: mensagem com/sem sugestão.
- `supabase/functions/vincular-catalogo/index.ts`: select + repasse da sugestão no alerta.
- `src/lib/tipos-dominio.ts` + `src/lib/queries.ts`: 3 campos novos em `Familia`/mapeamento.
- `src/components/card-categoria.tsx`: card `SugestaoCatalogo` (sem rede) + dedupe do concorrente.
- `src/components/__tests__/card-categoria-sugestao-catalogo.test.tsx`: render/clique/dedupe.
- `docs/decisions/0131-sugestao-categoria-pela-ficha-catalogo.md` + docs de referência.

---

### Task 1: Migration — 3 colunas aditivas em `familias`

**Files:**
- Create: `supabase/migrations/<timestamp>_sugestao_categoria_catalogo.sql` (timestamp gerado pelo CLI)

**Interfaces:**
- Produces: colunas `familias.catalogo_categoria_sugerida_id text`, `catalogo_categoria_sugerida_nome text`, `catalogo_categoria_sugerida_vendedores integer` — Tasks 4, 5 e 6 escrevem/leem esses nomes exatos.

- [ ] **Step 1: Gerar o arquivo via CLI (ADR-0043 — nunca criar o .sql à mão com timestamp inventado)**

Run: `supabase migration new sugestao_categoria_catalogo`
Expected: cria `supabase/migrations/<timestamp>_sugestao_categoria_catalogo.sql` vazio.

- [ ] **Step 2: Escrever o conteúdo**

```sql
-- Sugestão de categoria pela ficha de catálogo (spec 2026-08-22, estende ADR-0057).
-- Aditivas e nullable: nenhum fluxo existente passa a exigir as colunas.
-- `vendedores` alimenta o rótulo "N vendedores competindo" do card sem chamada de rede.
alter table familias
  add column if not exists catalogo_categoria_sugerida_id text,
  add column if not exists catalogo_categoria_sugerida_nome text,
  add column if not exists catalogo_categoria_sugerida_vendedores integer;
```

- [ ] **Step 3: Verificar que nada quebrou localmente**

Run: `rtk pnpm test`
Expected: suíte atual verde (a migration ainda não foi aplicada — o push acontece na Task 8, antes do deploy das functions).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_sugestao_categoria_catalogo.sql
git commit -m "feat(db): colunas de sugestão de categoria pela ficha de catálogo em familias"
```

---

### Task 2: Funções puras em `catalogo.ts` — `montarEsperadoPrePublicacao` + `deveSugerirCategoriaPorFicha` + wrapper `buscarCategoriaFicha`

**Files:**
- Modify: `supabase/functions/_shared/ml/catalogo.ts` (após `fichaEquivalente`, ~linha 184; wrapper junto aos demais `buscar*`, ~linha 283)
- Create: `supabase/functions/_shared/ml/__tests__/catalogo-sugestao-categoria.test.ts`

**Interfaces:**
- Consumes: `AtributosFicha`, `EsperadoProduto`, `fichaEquivalente`, `normalizarComprimentoMetros` (mesmo arquivo); `parseItensProduto` de `../concorrencia/parse.ts`.
- Produces:
  - `montarEsperadoPrePublicacao(atributos: Array<{ id: string; value_name?: string }>): EsperadoProduto`
  - `deveSugerirCategoriaPorFicha(ficha: AtributosFicha | null, esperado: EsperadoProduto, dominioCategoriaEscolhida: string | null): boolean`
  - `interface CategoriaFicha { categoriaId: string | null; vendedores: number }` e `buscarCategoriaFicha(token: string, fichaId: string): Promise<CategoriaFicha | null>`

- [ ] **Step 1: Escrever os testes falhando**

```ts
// Sugestão de categoria pela ficha de catálogo (spec 2026-08-22). O que estes testes travam:
//  - a sugestão só nasce com divergência de domínio + ficha aprovada pela trava anti-kit;
//  - `esperado` pré-publicação NUNCA carrega domainId (senão a própria divergência que
//    queremos sinalizar reprovaria a equivalência e suprimiria a sugestão).
import { describe, expect, it } from 'vitest';
import {
  deveSugerirCategoriaPorFicha,
  montarEsperadoPrePublicacao,
  type AtributosFicha,
} from '../catalogo';

// Caso real do lote 21: GTIN 4005800223136 (Eucerin Aquaphor 55ml).
const fichaCorporal: AtributosFicha = {
  id: 'MLB19462147', saleFormat: null, unitsPerPack: null, lengthM: null,
  domainId: 'MLB-BODY_SKIN_CARE_PRODUCTS',
};
const DOMINIO_BEBES = 'MLB-BABY_CREAMS_AND_OINTMENTS';

describe('deveSugerirCategoriaPorFicha', () => {
  it('sugere quando o domínio da ficha diverge do da categoria escolhida (caso Aquaphor)', () => {
    expect(deveSugerirCategoriaPorFicha(fichaCorporal, montarEsperadoPrePublicacao([]), DOMINIO_BEBES)).toBe(true);
  });

  it('não sugere quando os domínios coincidem', () => {
    expect(deveSugerirCategoriaPorFicha(fichaCorporal, montarEsperadoPrePublicacao([]), 'MLB-BODY_SKIN_CARE_PRODUCTS')).toBe(false);
  });

  it('não sugere sem ficha, sem domínio da ficha ou sem domínio da categoria', () => {
    expect(deveSugerirCategoriaPorFicha(null, montarEsperadoPrePublicacao([]), DOMINIO_BEBES)).toBe(false);
    expect(deveSugerirCategoriaPorFicha({ ...fichaCorporal, domainId: null }, montarEsperadoPrePublicacao([]), DOMINIO_BEBES)).toBe(false);
    expect(deveSugerirCategoriaPorFicha(fichaCorporal, montarEsperadoPrePublicacao([]), null)).toBe(false);
  });

  it('ficha de kit reprovada pela trava anti-kit não gera sugestão', () => {
    const fichaKit10 = { ...fichaCorporal, unitsPerPack: 10, saleFormat: 'Kit' };
    expect(deveSugerirCategoriaPorFicha(fichaKit10, montarEsperadoPrePublicacao([]), DOMINIO_BEBES)).toBe(false);
  });

  it('kit legítimo (nosso 2un × ficha 2un) segue elegível para sugestão', () => {
    const fichaKit2 = { ...fichaCorporal, unitsPerPack: 2, saleFormat: 'Kit' };
    const esperado = montarEsperadoPrePublicacao([
      { id: 'UNITS_PER_PACK', value_name: '2' },
      { id: 'SALE_FORMAT', value_name: 'Kit' },
    ]);
    expect(deveSugerirCategoriaPorFicha(fichaKit2, esperado, DOMINIO_BEBES)).toBe(true);
  });

  it('domainId que vaze no esperado é neutralizado (a divergência não reprova a equivalência)', () => {
    // Se o domainId chegasse à fichaEquivalente, este caso viraria false — regressão.
    const esperadoComVazamento = { lengthM: null, domainId: DOMINIO_BEBES };
    expect(deveSugerirCategoriaPorFicha(fichaCorporal, esperadoComVazamento, DOMINIO_BEBES)).toBe(true);
  });
});

describe('montarEsperadoPrePublicacao', () => {
  it('extrai UNITS_PER_PACK/SALE_FORMAT/LENGTH dos atributos já calculados', () => {
    expect(montarEsperadoPrePublicacao([
      { id: 'UNITS_PER_PACK', value_name: '2' },
      { id: 'SALE_FORMAT', value_name: 'Kit' },
      { id: 'LENGTH', value_name: '10 m' },
    ])).toEqual({ lengthM: 10, unitsPerPack: 2, saleFormat: 'Kit', domainId: null });
  });

  it('sem atributos → 1 unidade avulsa (mesmo modo degradado do vincular-catalogo)', () => {
    expect(montarEsperadoPrePublicacao([])).toEqual({ lengthM: null, unitsPerPack: null, saleFormat: null, domainId: null });
  });

  it('UNITS_PER_PACK não numérico não vira NaN', () => {
    expect(montarEsperadoPrePublicacao([{ id: 'UNITS_PER_PACK', value_name: 'dois' }]).unitsPerPack).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha por export ausente**

Run: `rtk pnpm exec vitest run supabase/functions/_shared/ml/__tests__/catalogo-sugestao-categoria.test.ts`
Expected: FAIL — `montarEsperadoPrePublicacao`/`deveSugerirCategoriaPorFicha` não exportadas.

- [ ] **Step 3: Implementar em `catalogo.ts`**

Logo após `fichaEquivalente` (~linha 184):

```ts
/**
 * `EsperadoProduto` PRÉ-publicação (spec 2026-08-22): não há item ML ainda, então a base de
 * comparação da trava anti-kit vem dos atributos que o próprio process-familia acabou de montar.
 * `domainId` fica deliberadamente null — a divergência de domínio é o SINAL da sugestão de
 * categoria, não motivo de reprova de equivalência.
 */
export function montarEsperadoPrePublicacao(
  atributos: Array<{ id: string; value_name?: string }>,
): EsperadoProduto {
  const val = (id: string) => atributos.find((a) => a.id === id)?.value_name ?? null;
  const unitsRaw = val('UNITS_PER_PACK');
  const units = unitsRaw != null ? Number(unitsRaw) : null;
  return {
    lengthM: normalizarComprimentoMetros(val('LENGTH')),
    unitsPerPack: units != null && Number.isFinite(units) ? units : null,
    saleFormat: val('SALE_FORMAT'),
    domainId: null,
  };
}

/**
 * Gate puro da sugestão de categoria pela ficha (spec 2026-08-22, estende ADR-0057): só sugere
 * quando os DOIS domínios são conhecidos e diferentes E a ficha passa na trava anti-kit.
 * Nunca aplicada sozinha (ADR-0054 Fase 2) — quem decide é o operador, no card.
 */
export function deveSugerirCategoriaPorFicha(
  ficha: AtributosFicha | null,
  esperado: EsperadoProduto,
  dominioCategoriaEscolhida: string | null,
): boolean {
  if (!ficha?.domainId || !dominioCategoriaEscolhida) return false;
  if (ficha.domainId === dominioCategoriaEscolhida) return false;
  // Defesa em profundidade: neutraliza domainId mesmo se o chamador vazar.
  return fichaEquivalente(ficha, { ...esperado, domainId: null }).ok;
}
```

Junto aos demais wrappers de rede (~linha 283), com import no topo do arquivo (`import { parseItensProduto } from '../concorrencia/parse.ts';` — `parse.ts` só importa `tipos.ts`, sem ciclo):

```ts
export interface CategoriaFicha { categoriaId: string | null; vendedores: number; }

/**
 * Categoria real onde os itens de uma ficha competem (`GET /products/{id}/items`). Contrato
 * confirmado com token real (2026-08-22): `results[].category_id` (MLB19462147 → 7 itens, todos
 * MLB1262). Reusa `parseItensProduto` (concorrência/ADR-0014) — mesmo endpoint, mesmo parse.
 * Ficha sem itens → categoriaId null (sem sugestão). Rede/4xx → null.
 */
export async function buscarCategoriaFicha(token: string, fichaId: string): Promise<CategoriaFicha | null> {
  const json = await mlGet(`${API}/products/${encodeURIComponent(fichaId)}/items`, token);
  if (!json) return null;
  const ofertas = parseItensProduto(json);
  return { categoriaId: ofertas.category_id, vendedores: ofertas.vendedores };
}
```

- [ ] **Step 4: Rodar e confirmar verde (novo arquivo + suíte de catálogo existente)**

Run: `rtk pnpm exec vitest run supabase/functions/_shared/ml/__tests__/`
Expected: PASS em todos (incluindo `catalogo.test.ts` intocado).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/catalogo.ts supabase/functions/_shared/ml/__tests__/catalogo-sugestao-categoria.test.ts
git commit -m "feat(catalogo): gate puro da sugestão de categoria pela ficha + esperado pré-publicação"
```

---

### Task 3: `buscarDominioCategoria` em `domain-discovery.ts`

**Files:**
- Modify: `supabase/functions/_shared/ml/domain-discovery.ts` (após `buscarNomeCategoria`, linha 110)
- Modify: `supabase/functions/_shared/ml/__tests__/domain-discovery.test.ts`

**Interfaces:**
- Consumes: `redisGet`/`redisSet`, `ehCategoriaMlValida` (já importados no arquivo).
- Produces: `buscarDominioCategoria(token: string, categoriaId: string, fetchFn?: typeof fetch): Promise<string | null>` — Task 4 consome.

- [ ] **Step 1: Escrever os testes falhando (append no describe file existente)**

```ts
// Domínio de catálogo de uma categoria (spec 2026-08-22). Contrato confirmado com token real:
// GET /categories/MLB277750 → settings.catalog_domain = "MLB-BABY_CREAMS_AND_OINTMENTS".
describe('buscarDominioCategoria', () => {
  it('rejeita categoriaId fora do formato MLB\\d+ sem chamar a API (guard de SSRF)', async () => {
    let chamadas = 0;
    const fakeFetch = (async () => { chamadas += 1; return new Response(null, { status: 200 }); }) as typeof fetch;
    await expect(buscarDominioCategoria('token', '../../x', fakeFetch)).resolves.toBeNull();
    expect(chamadas).toBe(0);
  });

  it('lê settings.catalog_domain da resposta real', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ id: 'MLB277750', settings: { catalog_domain: 'MLB-BABY_CREAMS_AND_OINTMENTS' } }), { status: 200 })
    ) as typeof fetch;
    await expect(buscarDominioCategoria('token', 'MLB277750', fakeFetch)).resolves.toBe('MLB-BABY_CREAMS_AND_OINTMENTS');
  });

  it('resposta sem o campo → null (sem sugestão, sem lançar)', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ id: 'MLB1', settings: {} }), { status: 200 })) as typeof fetch;
    await expect(buscarDominioCategoria('token', 'MLB1', fakeFetch)).resolves.toBeNull();
  });

  it('HTTP não-ok → null', async () => {
    const fakeFetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
    await expect(buscarDominioCategoria('token', 'MLB2', fakeFetch)).resolves.toBeNull();
  });
});
```

Adicionar `buscarDominioCategoria` ao import do topo do teste.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `rtk pnpm exec vitest run supabase/functions/_shared/ml/__tests__/domain-discovery.test.ts`
Expected: FAIL — export ausente.

- [ ] **Step 3: Implementar (espelho exato de `buscarNomeCategoria`)**

```ts
const TTL_DOMINIO_S = 30 * 24 * 60 * 60; // mesmo TTL do nome — domínio de categoria muda raro.

/**
 * Domínio de catálogo de uma categoria (`GET /categories/{id}` → `settings.catalog_domain`).
 * Contrato confirmado com token real (2026-08-22): MLB277750 → MLB-BABY_CREAMS_AND_OINTMENTS,
 * MLB1262 → MLB-BODY_SKIN_CARE_PRODUCTS — mesmo formato do `domain_id` das fichas, comparável
 * por igualdade de string. Resiliente: rede/4xx/campo ausente → null. Cacheado no Redis.
 */
export async function buscarDominioCategoria(
  token: string,
  categoriaId: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  // Mesmo guard de SSRF de buscarNomeCategoria (achado F4): id vira URL com token do vendedor.
  if (!ehCategoriaMlValida(categoriaId)) return null;
  const key = `catdom:${categoriaId}`;
  const cached = await redisGet(key).catch(() => null);
  if (cached) return cached;

  const r = await fetchFn(`https://api.mercadolibre.com/categories/${categoriaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const json = await r.json().catch(() => null) as { settings?: { catalog_domain?: string } } | null;
  const dominio = json?.settings?.catalog_domain ?? null;
  if (dominio) await redisSet(key, dominio, TTL_DOMINIO_S).catch(() => {});
  return dominio;
}
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `rtk pnpm exec vitest run supabase/functions/_shared/ml/__tests__/domain-discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/domain-discovery.ts supabase/functions/_shared/ml/__tests__/domain-discovery.test.ts
git commit -m "feat(categoria): buscarDominioCategoria via settings.catalog_domain (cacheado)"
```

---

### Task 4: Orquestração `calcularSugestaoCatalogo` + fiação no `process-familia`

**Files:**
- Create: `supabase/functions/process-familia/sugestao-catalogo.ts`
- Create: `supabase/functions/process-familia/__tests__/sugestao-catalogo.test.ts`
- Modify: `supabase/functions/process-familia/index.ts` (claim select linha 66; bloco novo antes do UPDATE final; payload do UPDATE linhas 488-511)

**Interfaces:**
- Consumes: `deveSugerirCategoriaPorFicha`, `montarEsperadoPrePublicacao` (Task 2), `buscarCategoriaFicha` (Task 2), `buscarDominioCategoria` (Task 3), `buscarProdutoCatalogoPorGtin` e `buscarNomeCategoria` (já existentes).
- Produces: `calcularSugestaoCatalogo(deps, args): Promise<SugestaoCatalogoPersistir | null>` com `SugestaoCatalogoPersistir = { id: string; nome: string | null; vendedores: number | null }`; colunas persistidas que as Tasks 5 e 6 leem.

- [ ] **Step 1: Escrever os testes falhando**

```ts
// Orquestração da sugestão de categoria pela ficha (spec 2026-08-22). O que estes testes travam:
//  - o caso Aquaphor (lote 21) produz a sugestão completa;
//  - domínio igual curto-circuita SEM buscar itens (economia de chamada);
//  - best-effort de verdade: qualquer dep lançando → null, nunca exception.
import { describe, expect, it, vi } from 'vitest';
import { calcularSugestaoCatalogo, type DepsSugestaoCatalogo } from '../sugestao-catalogo';

const ficha = {
  id: 'MLB19462147', saleFormat: null, unitsPerPack: null, lengthM: null,
  domainId: 'MLB-BODY_SKIN_CARE_PRODUCTS',
};
const args = { gtin: '4005800223136', categoriaMlId: 'MLB277750', atributosMl: [] };

function deps(overrides: Partial<DepsSugestaoCatalogo> = {}): DepsSugestaoCatalogo {
  return {
    buscarFicha: async () => ficha,
    buscarDominio: async () => 'MLB-BABY_CREAMS_AND_OINTMENTS',
    buscarItensFicha: async () => ({ categoriaId: 'MLB1262', vendedores: 7 }),
    buscarNome: async () => 'Cuidado do Corpo',
    ...overrides,
  };
}

describe('calcularSugestaoCatalogo', () => {
  it('caso Aquaphor: divergência de domínio gera a sugestão completa', async () => {
    await expect(calcularSugestaoCatalogo(deps(), args))
      .resolves.toEqual({ id: 'MLB1262', nome: 'Cuidado do Corpo', vendedores: 7 });
  });

  it('domínio igual → null, sem buscar os itens da ficha', async () => {
    const buscarItensFicha = vi.fn();
    const r = await calcularSugestaoCatalogo(
      deps({ buscarDominio: async () => 'MLB-BODY_SKIN_CARE_PRODUCTS', buscarItensFicha }), args);
    expect(r).toBeNull();
    expect(buscarItensFicha).not.toHaveBeenCalled();
  });

  it('sem ficha para o GTIN → null', async () => {
    await expect(calcularSugestaoCatalogo(deps({ buscarFicha: async () => null }), args)).resolves.toBeNull();
  });

  it('ficha sem itens competindo → null', async () => {
    await expect(calcularSugestaoCatalogo(deps({ buscarItensFicha: async () => ({ categoriaId: null, vendedores: 0 }) }), args)).resolves.toBeNull();
  });

  it('categoria dos itens igual à escolhida → null (defensivo)', async () => {
    await expect(calcularSugestaoCatalogo(deps({ buscarItensFicha: async () => ({ categoriaId: 'MLB277750', vendedores: 3 }) }), args)).resolves.toBeNull();
  });

  it('nome indisponível não derruba a sugestão — persiste nome null (o card só renderiza com nome; o alerta idem)', async () => {
    await expect(calcularSugestaoCatalogo(deps({ buscarNome: async () => null }), args))
      .resolves.toEqual({ id: 'MLB1262', nome: null, vendedores: 7 });
  });

  it('qualquer dep lançando → null, sem exception propagada', async () => {
    await expect(calcularSugestaoCatalogo(deps({ buscarFicha: async () => { throw new Error('boom'); } }), args)).resolves.toBeNull();
    await expect(calcularSugestaoCatalogo(deps({ buscarDominio: async () => { throw new Error('boom'); } }), args)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha por módulo ausente**

Run: `rtk pnpm exec vitest run supabase/functions/process-familia/__tests__/sugestao-catalogo.test.ts`
Expected: FAIL — `sugestao-catalogo.ts` não existe.

- [ ] **Step 3: Implementar `sugestao-catalogo.ts`**

```ts
import {
  deveSugerirCategoriaPorFicha,
  montarEsperadoPrePublicacao,
  type AtributosFicha,
  type CategoriaFicha,
} from '../_shared/ml/catalogo.ts';

/** O que o process-familia persiste em familias.catalogo_categoria_sugerida_*. */
export interface SugestaoCatalogoPersistir {
  id: string;
  nome: string | null;
  vendedores: number | null;
}

/** Deps injetadas (mesmo padrão de resolver.ts): testável sem rede. */
export interface DepsSugestaoCatalogo {
  buscarFicha(gtin: string | null): Promise<AtributosFicha | null>;
  buscarDominio(categoriaId: string): Promise<string | null>;
  buscarItensFicha(fichaId: string): Promise<CategoriaFicha | null>;
  buscarNome(categoriaId: string): Promise<string | null>;
}

/**
 * Sugestão de categoria pela ficha de catálogo (spec 2026-08-22, estende ADR-0057).
 * Best-effort: qualquer falha → null (sem sugestão), NUNCA lança — roda dentro do
 * processamento da família e não pode derrubá-lo. Nunca aplicada sozinha (ADR-0054 Fase 2).
 */
export async function calcularSugestaoCatalogo(
  deps: DepsSugestaoCatalogo,
  args: { gtin: string | null; categoriaMlId: string; atributosMl: Array<{ id: string; value_name?: string }> },
): Promise<SugestaoCatalogoPersistir | null> {
  try {
    const ficha = await deps.buscarFicha(args.gtin);
    if (!ficha) return null;
    const dominioEscolhido = await deps.buscarDominio(args.categoriaMlId);
    if (!deveSugerirCategoriaPorFicha(ficha, montarEsperadoPrePublicacao(args.atributosMl), dominioEscolhido)) {
      return null;
    }
    const itens = await deps.buscarItensFicha(ficha.id);
    if (!itens?.categoriaId || itens.categoriaId === args.categoriaMlId) return null;
    return {
      id: itens.categoriaId,
      nome: await deps.buscarNome(itens.categoriaId).catch(() => null),
      vendedores: itens.vendedores,
    };
  } catch (e) {
    console.warn(`sugestão de categoria por ficha falhou (segue sem): ${(e as Error).message}`);
    return null;
  }
}
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `rtk pnpm exec vitest run supabase/functions/process-familia/__tests__/sugestao-catalogo.test.ts`
Expected: PASS.

- [ ] **Step 5: Fiar no `index.ts`**

(a) Claim select (linha 66) — adicionar `variacao_principal_codigo`:

```ts
.select('id, user_id, org_id, nome_pai, descricao_pai, lote_id, operacao, fornecedor, origem, unidade, categoria_ml_id, atributos_ml, atributos_faltantes, atributos_editados_pelo_operador, variacao_principal_codigo')
```

(b) Imports novos no topo:

```ts
import { buscarProdutoCatalogoPorGtin, buscarCategoriaFicha } from '../_shared/ml/catalogo.ts';
import { buscarCategoriaPreditor, buscarDominioCategoria, buscarNomeCategoria } from '../_shared/ml/domain-discovery.ts';
import { calcularSugestaoCatalogo, type SugestaoCatalogoPersistir } from './sugestao-catalogo.ts';
```

(a linha existente de `buscarCategoriaPreditor` é substituída pela versão com os 3 imports.)

(c) Bloco novo, imediatamente ANTES do comentário `// 6. Persistir título + descrição...` (após `atributosMl`/`faltantes` prontos — o `esperado` da trava anti-kit lê `atributosMl`):

```ts
    // 5f. Sugestão de categoria pela ficha de catálogo (spec 2026-08-22, estende ADR-0057).
    // Best-effort, nunca aplicada sozinha (ADR-0054 Fase 2). Só no CREATE — o UPDATE parcial
    // retorna cedo lá em cima, de propósito: categoria de anúncio publicado não muda.
    // 1 chamada só: a variação principal responde pela família (cores irmãs, mesmo domínio).
    let sugestaoCatalogo: SugestaoCatalogoPersistir | null = null;
    if (token && categoriaMlId) {
      const tokenSug = token;
      const principal = resolvidas.find((v) => v.codigo === claimed.variacao_principal_codigo) ?? resolvidas[0];
      sugestaoCatalogo = await calcularSugestaoCatalogo({
        buscarFicha: (g) => buscarProdutoCatalogoPorGtin(tokenSug, g),
        buscarDominio: (c) => buscarDominioCategoria(tokenSug, c),
        buscarItensFicha: (f) => buscarCategoriaFicha(tokenSug, f),
        buscarNome: (c) => buscarNomeCategoria(tokenSug, c),
      }, { gtin: principal?.gtin ?? null, categoriaMlId, atributosMl });
    }
```

(d) Payload do UPDATE final (junto a `concorrencia_categoria_id`):

```ts
      catalogo_categoria_sugerida_id: sugestaoCatalogo?.id ?? null,
      catalogo_categoria_sugerida_nome: sugestaoCatalogo?.nome ?? null,
      catalogo_categoria_sugerida_vendedores: sugestaoCatalogo?.vendedores ?? null,
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `rtk pnpm test`
Expected: PASS (o index não tem teste próprio; a lógica vive nas funções testadas).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/process-familia/sugestao-catalogo.ts supabase/functions/process-familia/__tests__/sugestao-catalogo.test.ts supabase/functions/process-familia/index.ts
git commit -m "feat(process-familia): calcula e persiste sugestão de categoria pela ficha de catálogo"
```

---

### Task 5: Alerta Telegram enriquecido (`telegram.ts` + `vincular-catalogo`)

**Files:**
- Modify: `supabase/functions/_shared/notificacoes/telegram.ts` (interface linha 35, mensagem linha 46)
- Modify: `supabase/functions/_shared/notificacoes/__tests__/catalogo-nomatch.test.ts`
- Modify: `supabase/functions/vincular-catalogo/index.ts` (select linha 58; call site linha 131)

**Interfaces:**
- Consumes: colunas `catalogo_categoria_sugerida_id/nome` (Task 4).
- Produces: `CatalogoNoMatchAlerta.categoriaSugerida?: { id: string; nome: string } | null`.

- [ ] **Step 1: Escrever os testes falhando (append no describe existente)**

```ts
  it('cita a categoria sugerida quando presente, com a ressalva de não trocar o anúncio publicado', () => {
    const msg = montarMensagemCatalogoNoMatch({
      ml_item_id: 'MLB1', titulo: 'Eucerin Aquaphor 55ml', cores: ['Único'],
      categoriaSugerida: { id: 'MLB1262', nome: 'Cuidado do Corpo' },
    });
    expect(msg).toContain('Cuidado do Corpo');
    expect(msg).toContain('MLB1262');
    expect(msg).toContain('Não troque a categoria');
  });

  it('sem categoriaSugerida o texto fica idêntico ao atual', () => {
    const msg = montarMensagemCatalogoNoMatch({ ml_item_id: 'MLB1', titulo: 'X', cores: ['Preto'] });
    expect(msg).not.toContain('Sugestão:');
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `rtk pnpm exec vitest run supabase/functions/_shared/notificacoes/__tests__/catalogo-nomatch.test.ts`
Expected: FAIL no caso novo (campo/linha inexistentes).

- [ ] **Step 3: Implementar em `telegram.ts`**

Interface:

```ts
export interface CatalogoNoMatchAlerta {
  ml_item_id: string;
  titulo: string | null;
  cores: string[];
  motivo?: 'elegibilidade_esgotada' | 'sem_variation_id' | 'elegibilidade_nao_resolvida';
  /** Categoria compatível com a ficha do GTIN, calculada ANTES de publicar (spec 2026-08-22). */
  categoriaSugerida?: { id: string; nome: string } | null;
}
```

No `return` de `montarMensagemCatalogoNoMatch`, inserir a linha condicional entre o passo manual e a URL:

```ts
  return [
    `⚠️ Catálogo: ${plural} ${cores} do anúncio "${nome}" ${causa} e não vai competir.`,
    `Se ficar assim, o Mercado Livre pode pausar/inativar o anúncio.`,
    `Para evitar: abra o link → Publicar no catálogo → na cor sem ficha clique "Não encontro minha variação" → Confirmar.`,
    // Regra do projeto: NUNCA trocar categoria de anúncio publicado (re-moderação, incidente
    // Aquaphor) — a sugestão é para a PRÓXIMA publicação, e a mensagem diz isso.
    ...(item.categoriaSugerida
      ? [`Sugestão: a ficha de catálogo deste produto vive na categoria "${item.categoriaSugerida.nome}" (${item.categoriaSugerida.id}). Não troque a categoria do anúncio já publicado — considere-a numa próxima publicação.`]
      : []),
    url,
  ].join('\n');
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `rtk pnpm exec vitest run supabase/functions/_shared/notificacoes/__tests__/catalogo-nomatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Fiar o `vincular-catalogo`**

(a) Select da família (linha 58) — acrescentar as 2 colunas:

```ts
    .select('user_id, org_id, codigo_pai, nome_pai, ml_item_id, ml_permalink, publicado_em, catalogo_categoria_sugerida_id, catalogo_categoria_sugerida_nome')
```

(b) Call site do alerta (linha 131) — passar a sugestão SÓ quando há `ficha_divergente` (nos outros motivos a linha seria ruído):

```ts
          montarMensagemCatalogoNoMatch({
            ml_item_id: familia.ml_item_id,
            titulo: familia.nome_pai ?? null,
            cores,
            motivo: decidirMotivoAlertaCatalogo(resumo),
            categoriaSugerida:
              resumo.ficha_divergente > 0 && familia.catalogo_categoria_sugerida_id && familia.catalogo_categoria_sugerida_nome
                ? { id: familia.catalogo_categoria_sugerida_id, nome: familia.catalogo_categoria_sugerida_nome }
                : null,
          }));
```

(Família de UPDATE tem as colunas nulas — a sugestão não roda no UPDATE parcial — e a linha é omitida; comportamento atual preservado.)

- [ ] **Step 6: Rodar a suíte inteira**

Run: `rtk pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/notificacoes/telegram.ts supabase/functions/_shared/notificacoes/__tests__/catalogo-nomatch.test.ts supabase/functions/vincular-catalogo/index.ts
git commit -m "feat(alerta): cita a categoria sugerida pela ficha no alerta de catalogo no-match"
```

---

### Task 6: Frontend — tipos, mapeamento e card `SugestaoCatalogo`

**Files:**
- Modify: `src/lib/tipos-dominio.ts` (junto a `concorrenciaCategoriaId`, linha 174)
- Modify: `src/lib/queries.ts` (`familiaFromRow`, extensão do tipo do parâmetro ~linha 477 e mapeamento ~linha 520)
- Modify: `src/components/card-categoria.tsx`
- Modify (fixtures que tipam `Familia` por literal): `src/components/__tests__/familia-expanded-cor-resync.test.tsx`, `src/components/__tests__/familia-expanded-resync-pos-ia.test.tsx`, `src/pages/__tests__/Revisao.test.tsx`
- Create: `src/components/__tests__/card-categoria-sugestao-catalogo.test.tsx`

**Interfaces:**
- Consumes: colunas persistidas pela Task 4; `useDefinirCategoriaLivre` (existente).
- Produces: campos `Familia.catalogoCategoriaSugeridaId: string | null`, `catalogoCategoriaSugeridaNome: string | null`, `catalogoCategoriaSugeridaVendedores: number | null`.

- [ ] **Step 1: Escrever o teste de componente falhando**

```tsx
// Card "Sugestão (catálogo)" (spec 2026-08-22). O que estes testes travam:
//  - o card renderiza DIRETO da row (sem foco, sem rede — diferente do card do concorrente);
//  - clicar aplica via definirCategoriaLivre com id/nome persistidos;
//  - sugestão igual à categoria atual não renderiza; concorrente idêntico não duplica card.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardCategoria } from '../card-categoria';
import { buscarCategoriaML } from '@/lib/queries';
import type { Familia } from '@/lib/tipos-dominio';

const mutate = vi.fn();
vi.mock('@/hooks/useFamiliaMutations', () => ({
  useDefinirCategoriaLivre: () => ({ mutate, isPending: false, variables: undefined }),
}));
vi.mock('@/lib/queries', () => ({
  buscarCategoriaML: vi.fn(async () => ({ candidatos: [], sugestaoConcorrente: null })),
}));

const base = {
  id: 'f1', loteId: 'l1',
  categoriaMlId: 'MLB277750', categoriaNome: 'Cremes, Pomadas e Óleos',
  tipoOrigem: 'preditor', tipoAviamento: null, atributosFaltantes: null,
  concorrenciaCategoriaId: null,
  catalogoCategoriaSugeridaId: 'MLB1262',
  catalogoCategoriaSugeridaNome: 'Cuidado do Corpo',
  catalogoCategoriaSugeridaVendedores: 7,
} as unknown as Familia;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('CardCategoria — sugestão de catálogo', () => {
  it('renderiza o card direto da row, sem foco nem rede', () => {
    render(<CardCategoria familia={base} />);
    expect(screen.getByRole('button', { name: /Sugestão \(catálogo\)/ })).toBeInTheDocument();
    expect(screen.getByText(/7 vendedores competindo/)).toBeInTheDocument();
    expect(buscarCategoriaML).not.toHaveBeenCalled();
  });

  it('clicar aplica via definirCategoriaLivre com id/nome da sugestão', async () => {
    render(<CardCategoria familia={base} />);
    await userEvent.click(screen.getByRole('button', { name: /Sugestão \(catálogo\)/ }));
    expect(mutate).toHaveBeenCalledWith(
      { familiaId: 'f1', categoriaMlId: 'MLB1262', categoriaNome: 'Cuidado do Corpo' },
      expect.anything(),
    );
  });

  it('não renderiza quando a sugestão é a própria categoria atual', () => {
    render(<CardCategoria familia={{ ...base, categoriaMlId: 'MLB1262' } as Familia} />);
    expect(screen.queryByRole('button', { name: /Sugestão \(catálogo\)/ })).not.toBeInTheDocument();
  });

  it('concorrente idêntico ao catálogo não carrega card duplicado', async () => {
    render(<CardCategoria familia={{ ...base, concorrenciaCategoriaId: 'MLB1262' } as Familia} />);
    await userEvent.click(screen.getByText('Trocar categoria'));
    await userEvent.click(screen.getByPlaceholderText(/Buscar categoria/));
    expect(buscarCategoriaML).not.toHaveBeenCalled(); // dedupe: nem chega a buscar o concorrente
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `rtk pnpm exec vitest run src/components/__tests__/card-categoria-sugestao-catalogo.test.tsx`
Expected: FAIL — card inexistente (e os campos ainda não existem no tipo).

- [ ] **Step 3: Tipos + mapeamento**

`src/lib/tipos-dominio.ts` (logo abaixo de `concorrenciaCategoriaId`):

```ts
  /** Sugestão de categoria pela ficha de catálogo (spec 2026-08-22, estende ADR-0057). */
  catalogoCategoriaSugeridaId: string | null;
  catalogoCategoriaSugeridaNome: string | null;
  catalogoCategoriaSugeridaVendedores: number | null;
```

`src/lib/queries.ts` — no tipo do parâmetro de `familiaFromRow` (mesmo padrão ponytail de `preco_reancorado_lider`, aguardando regen de `database.types.ts`):

```ts
    // ponytail: colunas aditivas (spec 2026-08-22) — database.types.ts ainda não regenerado.
    catalogo_categoria_sugerida_id?: string | null;
    catalogo_categoria_sugerida_nome?: string | null;
    catalogo_categoria_sugerida_vendedores?: number | null;
```

e no objeto retornado (junto a `concorrenciaCategoriaId`):

```ts
    catalogoCategoriaSugeridaId: r.catalogo_categoria_sugerida_id ?? null,
    catalogoCategoriaSugeridaNome: r.catalogo_categoria_sugerida_nome ?? null,
    catalogoCategoriaSugeridaVendedores: r.catalogo_categoria_sugerida_vendedores ?? null,
```

(As queries de família usam `select('*')` — as colunas chegam sem mudança de select.)

- [ ] **Step 4: Atualizar as 3 fixtures de `Familia`**

Nos literais tipados como `Familia` em `familia-expanded-cor-resync.test.tsx` (linha ~68), `familia-expanded-resync-pos-ia.test.tsx` (linha ~73) e `Revisao.test.tsx` (linha ~51), acrescentar:

```ts
    catalogoCategoriaSugeridaId: null, catalogoCategoriaSugeridaNome: null, catalogoCategoriaSugeridaVendedores: null,
```

- [ ] **Step 5: Implementar o card em `card-categoria.tsx`**

Novo componente (antes de `CardCategoria`):

```tsx
// Sugestão pela ficha de catálogo (spec 2026-08-22): diferente do card do concorrente, os dados
// já estão persistidos na row (id/nome/vendedores) — renderiza sem foco e sem rede. É isso que
// torna a divergência visível ANTES de publicar (motivação do lote 21). Nunca aplicada sozinha.
function SugestaoCatalogo({ familia }: { familia: Familia }) {
  const definir = useDefinirCategoriaLivre(familia.loteId);
  const id = familia.catalogoCategoriaSugeridaId;
  const nome = familia.catalogoCategoriaSugeridaNome;
  if (!id || !nome || id === familia.categoriaMlId) return null;
  const n = familia.catalogoCategoriaSugeridaVendedores;
  return (
    <button
      type="button"
      onClick={() =>
        definir.mutate(
          { familiaId: familia.id, categoriaMlId: id, categoriaNome: nome },
          { onError: (e) => toast.error('Erro ao definir categoria', { description: (e as Error).message }) },
        )}
      disabled={definir.isPending}
      className="mt-1.5 w-full rounded-md border border-warning/40 bg-warning/5 p-1.5 text-left text-xs hover:bg-warning/10 disabled:cursor-wait disabled:opacity-60"
    >
      {definir.isPending ? (
        <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Aplicando…</span>
      ) : (
        <>
          <span className="font-medium">Sugestão (catálogo):</span> {nome}
          {n != null && n > 0 && (
            <span className="text-muted-foreground"> — {n} {n === 1 ? 'vendedor competindo' : 'vendedores competindo'}</span>
          )}
        </>
      )}
    </button>
  );
}
```

Renderizar nos DOIS ramos de `CardCategoria`:
- ramo `categoriaIndefinida`: entre o `<p>` de aviso e `<BuscaCategoria …/>`;
- ramo com categoria definida: logo após o `<p className="text-xs text-muted-foreground">{familia.categoriaMlId}</p>`.

Em ambos: `<SugestaoCatalogo familia={familia} />`.

Dedupe no `carregarSugestao` de `BuscaCategoria` (linha 30):

```ts
  const carregarSugestao = () => {
    if (sugestaoCarregada || !familia.concorrenciaCategoriaId) return;
    // Dedupe (spec 2026-08-22): mesma categoria já exibida pelo card do catálogo → não duplica.
    if (familia.concorrenciaCategoriaId === familia.catalogoCategoriaSugeridaId) return;
    setSugestaoCarregada(true);
    buscarCategoriaML(familia.id, '').then((r) => setSugestao(r.sugestaoConcorrente)).catch(() => {});
  };
```

- [ ] **Step 6: Rodar o teste novo e a suíte**

Run: `rtk pnpm exec vitest run src/components/__tests__/card-categoria-sugestao-catalogo.test.tsx` e depois `rtk pnpm test`
Expected: PASS em ambos.

- [ ] **Step 7: Type-check completo (regra do CI)**

Run: `rtk npx tsc -b --force`
Expected: sem erros (as 3 fixtures atualizadas cobrem o campo obrigatório novo).

- [ ] **Step 8: Commit**

```bash
git add src/lib/tipos-dominio.ts src/lib/queries.ts src/components/card-categoria.tsx src/components/__tests__/card-categoria-sugestao-catalogo.test.tsx src/components/__tests__/familia-expanded-cor-resync.test.tsx src/components/__tests__/familia-expanded-resync-pos-ia.test.tsx src/pages/__tests__/Revisao.test.tsx
git commit -m "feat(revisao): card de sugestão de categoria pela ficha de catálogo"
```

---

### Task 7: ADR + documentação + verificação final

**Files:**
- Create: `docs/decisions/0131-sugestao-categoria-pela-ficha-catalogo.md`
- Modify: `obsidian-vault/04-Decisões/Índice de ADRs.md` (linha da tabela, após a 0130)
- Modify: `docs/reference/modelo-de-dados.md` (seção de `familias`: 3 colunas novas)
- Modify: `docs/reference/edge-functions.md` (bullets de `process-familia` ~linha 194 e do `vincular-catalogo`: etapa de sugestão / linha nova do alerta)
- Modify: `docs/TASKS.md` (entrada de conclusão)

**Interfaces:**
- Consumes: tudo das Tasks 1-6 (o ADR resume a decisão já aprovada na spec).

- [ ] **Step 1: Escrever o ADR-0131**

Conteúdo (formato dos ADRs vizinhos — Status/Data/Decisores/Relaciona, Contexto, Decisão, Consequências, Como reverter). Basear no conteúdo da spec `docs/superpowers/specs/2026-08-22-sugestao-categoria-catalogo-design.md` (seções Problema, Decisão, Abordagens descartadas, Consequências — condensar, não copiar na íntegra; apontar para a spec). Pontos obrigatórios:
- Estende ADR-0057 (2ª fonte de sugestão não-vinculante); nunca automática (ADR-0054 Fase 2).
- Caso motivador: lote 21 / Aquaphor (`ficha_divergente` só descoberto pós-publicação; troca de categoria publicada é proibida — re-moderação).
- Contratos validados com token real em 2026-08-22 (`settings.catalog_domain`; `results[].category_id`).
- 3 colunas aditivas; UPDATE parcial não calcula sugestão de propósito.
- Relaciona: ADR-0021, ADR-0036, ADR-0054, ADR-0057.

- [ ] **Step 2: Atualizar o índice de ADRs no obsidian-vault**

Acrescentar após a linha da 0130:

```markdown
| 0131 | [Sugestão de categoria pela ficha de catálogo](../../decisions/0131-sugestao-categoria-pela-ficha-catalogo.md) |
```

(Manter o formato exato da tabela existente — conferir as colunas reais do arquivo antes de editar.)

- [ ] **Step 3: Atualizar referências**

- `modelo-de-dados.md`: na tabela/lista de colunas de `familias`, documentar `catalogo_categoria_sugerida_id/nome/vendedores` (nullable; escritas por `process-familia`; lidas pelo front e pelo `vincular-catalogo`).
- `edge-functions.md`: no bullet do `process-familia`, acrescentar a etapa 5f (sugestão pela ficha, best-effort); no do `vincular-catalogo`, a linha nova do alerta.
- `docs/TASKS.md`: registrar a entrega (padrão das entradas recentes).

- [ ] **Step 4: Verificação final completa**

Run: `rtk pnpm lint && rtk pnpm test && rtk npx tsc -b --force`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add docs/decisions/0131-sugestao-categoria-pela-ficha-catalogo.md "obsidian-vault/04-Decisões/Índice de ADRs.md" docs/reference/modelo-de-dados.md docs/reference/edge-functions.md docs/TASKS.md
git commit -m "docs: ADR-0131 sugestão de categoria pela ficha de catálogo + referências"
```

---

### Task 8: Deploy (migration ANTES das functions) — executar só após merge aprovado pelo Diego

**Files:** nenhum novo — operação de infra.

**Interfaces:**
- Consumes: migration da Task 1; functions das Tasks 4-5.

Ordem obrigatória (regra do projeto: coluna no banco ANTES do código que a escreve; invertido, toda família processada no intervalo morre no UPDATE):

- [ ] **Step 1: Linkar o projeto (worktree nunca vem linkado)**

```bash
export SUPABASE_ACCESS_TOKEN="$(grep -m1 '^SUPABASE_ACCESS_TOKEN=.\+' <checkout-principal>/.env.local | cut -d= -f2-)"
supabase link --project-ref txvncrgkoynoxwopfkbp --yes < /dev/null
```

(Extrair o token do `.env.local` do checkout PRINCIPAL, com padrão que exige valor — worktree costuma ter placeholder vazio.)

- [ ] **Step 2: Aplicar a migration**

```bash
supabase db push --linked --dry-run --yes < /dev/null   # conferir que SÓ a migration nova sobe
supabase db push --linked --yes < /dev/null
npm run db:check                                        # "Migrations alinhadas"
```

- [ ] **Step 3: Conferir as colunas no banco**

Via Management API (`POST /v1/projects/txvncrgkoynoxwopfkbp/database/query`):

```sql
select column_name from information_schema.columns
where table_name = 'familias' and column_name like 'catalogo_categoria_sugerida%';
```

Expected: 3 linhas.

- [ ] **Step 4: Deploy das Edge Functions afetadas**

```bash
supabase functions deploy process-familia --project-ref txvncrgkoynoxwopfkbp < /dev/null
supabase functions deploy vincular-catalogo --project-ref txvncrgkoynoxwopfkbp < /dev/null
```

(`_shared/ml/catalogo.ts`, `domain-discovery.ts` e `notificacoes/telegram.ts` mudaram — conferir se OUTRAS functions os importam e precisariam de redeploy: `telegram.ts` é importado também por workers de vendas/perguntas, mas a mudança é aditiva em uma função que só o `vincular-catalogo` chama com o campo novo; ainda assim, listar os importadores com `grep -rln "notificacoes/telegram" supabase/functions --include=index.ts` e redeployar os que usarem `montarMensagemCatalogoNoMatch`.)

- [ ] **Step 5: Conferir versão pós-deploy**

```bash
supabase functions list --project-ref txvncrgkoynoxwopfkbp < /dev/null
```

Expected: `process-familia` e `vincular-catalogo` com versão nova (timestamp de agora).

- [ ] **Step 6: Validação de runtime (primeiro lote real)**

No primeiro lote CREATE com GTIN de ficha divergente processado após o deploy, conferir por SQL (Management API) que `catalogo_categoria_sugerida_*` foi preenchido, e na Revisão que o card "Sugestão (catálogo)" aparece sem foco. (Regra do projeto: mock não basta — validar contra runtime real antes de declarar pronto.)

---

## Self-Review (executado na escrita do plano)

- **Spec coverage:** etapa no process-familia (Task 4), helpers/travas (Tasks 2-3), migration 3 colunas (Task 1), card sem rede + dedupe (Task 6), alerta Telegram condicionado a `ficha_divergente` (Task 5), deploy das 2 functions na ordem certa (Task 8), ADR/docs (Task 7). UPDATE parcial sem sugestão: garantido por posição do bloco (após o early-return) — coberto pelo comentário e pela spec; não há caminho de código a testar além do existente.
- **Placeholder scan:** sem TBD/TODO; todo step de código tem o código.
- **Type consistency:** `SugestaoCatalogoPersistir`/`DepsSugestaoCatalogo`/`CategoriaFicha` definidos na task que os produz e consumidos com os mesmos nomes; colunas `catalogo_categoria_sugerida_{id,nome,vendedores}` idênticas em migration, process-familia, vincular-catalogo e frontend.
