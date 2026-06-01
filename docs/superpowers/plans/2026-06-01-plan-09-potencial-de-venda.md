# Card "Potencial de venda" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acrescentar ao painel de análise um card "Potencial de venda" com proxies de mercado (faixa de preço, frete grátis, FULL, força dos concorrentes, ranking da categoria, idade no catálogo), já que a venda exata por produto não é exposta pela API do ML.

**Architecture:** Estende o parse das ofertas (`/products/{id}/items`) para extrair preço máx/frete/FULL/sellers; nova função de efeito `analisarMercado` agrega reputação dos vendedores (`/users`, cache 24h) + ranking (`/highlights`, cache 6h) + idade (`/products/{id}`); persiste tudo num jsonb `analise_mercado`; novo card no `PainelAnalise`. Funções de agregação são puras e testadas.

**Tech Stack:** Supabase Edge Functions (Deno/TS), API ML, Upstash Redis (REST), React 18 + Tailwind + lucide, Vitest. Deploy via MCP supabase.

**Spec:** `docs/superpowers/specs/2026-06-01-potencial-de-venda-design.md` · **ADR:** `docs/decisions/0015-potencial-de-venda-via-proxies.md`

---

## Convenções (ler antes de começar)

- Imports no código-fonte Deno (`.ts`): com extensão (`'./tipos.ts'`). Nos testes vitest: sem extensão.
- Testes em `__tests__/` ao lado do módulo (backend) ou `tests/components/` (frontend). Frontend usa alias `@/`.
- Rodar 1 teste: `pnpm vitest run <caminho>`. Suíte: `pnpm test`. Build/types: `pnpm build`. Lint: `pnpm lint`.
- Deploy de edge function, migration e tipos via **MCP supabase** (`deploy_edge_function`, `apply_migration`, `generate_typescript_types`). Não há CLI local.
- **Deploy do `process-familia`** é full-replace (todos os arquivos `_shared` dependentes). Técnica usada no projeto: gerar o array `files` via Python lendo do disco (escapa emojis/acentos com `json.dumps`), reescrevendo `../_shared`→`./_shared` só no `index.ts`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `_shared/concorrencia/tipos.ts` (modificar) | + `DadosOfertas`; `ResultadoConcorrencia` ganha `product_id?`/`ofertas?` |
| `_shared/concorrencia/parse.ts` (modificar) | `parseItensProduto` → `DadosOfertas` (preço máx, frete, FULL, sellers) |
| `_shared/ml/concorrencia.ts` (modificar) | expõe `product_id` + `ofertas` no resultado |
| `_shared/ml/mercado-agregar.ts` (criar) | funções puras `agregarMercado`, `posicaoNoRanking` |
| `_shared/ml/mercado.ts` (criar) | `analisarMercado` (efeito: reputação + ranking + idade, cacheado, resiliente) |
| `process-familia/index.ts` (modificar) | chama `analisarMercado` e persiste `analise_mercado` |
| migration `add_analise_mercado_familias` (MCP) | coluna `analise_mercado jsonb` |
| `src/lib/tipos-dominio.ts` (modificar) | `AnaliseMercado` + `Familia.analiseMercado` |
| `src/lib/queries.ts` (modificar) | mapeia `r.analise_mercado` |
| `src/lib/formato.ts` (modificar) | + `fmtMilhar` |
| `src/components/painel-analise.tsx` (modificar) | card "Potencial de venda" |
| `tests/components/painel-analise.test.tsx` (modificar) | testes do card |

---

### Task 1: `DadosOfertas` em tipos + parse estendido (TDD)

**Files:**
- Modify: `supabase/functions/_shared/concorrencia/tipos.ts`
- Modify: `supabase/functions/_shared/concorrencia/parse.ts`
- Modify: `supabase/functions/_shared/concorrencia/__tests__/parse.test.ts`

- [ ] **Step 1: Adicionar `DadosOfertas` e estender `ResultadoConcorrencia` em tipos.ts**

Acrescentar ao final de `tipos.ts`:

```ts
export interface DadosOfertas {
  vendedores: number;
  preco_min: number | null;
  preco_max: number | null;
  total_ofertas: number;
  frete_gratis: number;
  full: number;
  seller_ids: number[];
}
```

E acrescentar dois campos opcionais à interface `ResultadoConcorrencia` existente:

```ts
  product_id?: string | null;
  ofertas?: DadosOfertas;
```

- [ ] **Step 2: Escrever o teste estendido do parse**

Substituir o bloco `describe('parseItensProduto', ...)` em `__tests__/parse.test.ts` por:

```ts
describe('parseItensProduto', () => {
  const json = {
    paging: { total: 4 },
    results: [
      { seller_id: 1, price: 12.62, shipping: { free_shipping: true, logistic_type: 'fulfillment' } },
      { seller_id: 2, price: 17.02, shipping: { free_shipping: false, logistic_type: 'cross_docking' } },
      { seller_id: 1, price: 14.0, shipping: { free_shipping: true, logistic_type: 'drop_off' } },
      { seller_id: 3, price: 0, shipping: { free_shipping: false, logistic_type: 'cross_docking' } },
    ],
  };

  it('payload vazio → tudo zerado', () => {
    expect(parseItensProduto({ results: [] })).toEqual({
      vendedores: 0, preco_min: null, preco_max: null, total_ofertas: 0,
      frete_gratis: 0, full: 0, seller_ids: [],
    });
    expect(parseItensProduto(null)).toEqual({
      vendedores: 0, preco_min: null, preco_max: null, total_ofertas: 0,
      frete_gratis: 0, full: 0, seller_ids: [],
    });
  });

  it('preço min/max ignora <=0; total_ofertas conta todas', () => {
    const r = parseItensProduto(json);
    expect(r.preco_min).toBe(12.62);
    expect(r.preco_max).toBe(17.02);
    expect(r.total_ofertas).toBe(4);
  });

  it('vendedores distintos e seller_ids únicos', () => {
    const r = parseItensProduto(json);
    expect(r.vendedores).toBe(3);
    expect(r.seller_ids.sort()).toEqual([1, 2, 3]);
  });

  it('conta frete grátis e FULL por oferta', () => {
    const r = parseItensProduto(json);
    expect(r.frete_gratis).toBe(2);
    expect(r.full).toBe(1);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `pnpm vitest run supabase/functions/_shared/concorrencia/__tests__/parse.test.ts`
Expected: FAIL (campos novos ausentes)

- [ ] **Step 4: Reescrever `parseItensProduto` em parse.ts**

Substituir a função `parseItensProduto` (mantendo `parseProdutoBusca` intacto) por:

```ts
import type { DadosOfertas } from './tipos.ts';

interface MLItem {
  seller_id?: number | string;
  price?: number;
  shipping?: { free_shipping?: boolean; logistic_type?: string };
}

export function parseItensProduto(json: unknown): DadosOfertas {
  const vazio: DadosOfertas = {
    vendedores: 0, preco_min: null, preco_max: null, total_ofertas: 0,
    frete_gratis: 0, full: 0, seller_ids: [],
  };
  const results = (json as { results?: MLItem[] } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) return vazio;

  const precos = results
    .map((r) => r.price)
    .filter((p): p is number => typeof p === 'number' && p > 0);
  const sellers = [
    ...new Set(
      results
        .map((r) => (r.seller_id != null ? Number(r.seller_id) : null))
        .filter((id): id is number => id != null && !Number.isNaN(id)),
    ),
  ];
  const frete_gratis = results.filter((r) => r.shipping?.free_shipping === true).length;
  const full = results.filter((r) => r.shipping?.logistic_type === 'fulfillment').length;

  return {
    vendedores: sellers.length > 0 ? sellers.length : results.length,
    preco_min: precos.length ? precos.reduce((a, b) => Math.min(a, b)) : null,
    preco_max: precos.length ? precos.reduce((a, b) => Math.max(a, b)) : null,
    total_ofertas: results.length,
    frete_gratis,
    full,
    seller_ids: sellers,
  };
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm vitest run supabase/functions/_shared/concorrencia/__tests__/parse.test.ts`
Expected: PASS (parseProdutoBusca + parseItensProduto)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/concorrencia/tipos.ts supabase/functions/_shared/concorrencia/parse.ts supabase/functions/_shared/concorrencia/__tests__/parse.test.ts
git commit -m "feat(m4): parseItensProduto retorna DadosOfertas (faixa preco/frete/FULL/sellers)"
```

---

### Task 2: `buscarConcorrencia` expõe `product_id` + `ofertas`

**Files:**
- Modify: `supabase/functions/_shared/ml/concorrencia.ts`

- [ ] **Step 1: Ajustar o ramo GTIN para guardar `productId` e `ofertas`**

Em `buscarConcorrencia`, o trecho que hoje é:

```ts
    const productId = parseProdutoBusca(busca);
    if (!productId) return { ...NENHUMA, origem: 'gtin' };

    const itensJson = await mlGet(`${API}/products/${productId}/items`, token);
    const { vendedores, preco_min } = parseItensProduto(itensJson);
    const classe = classificarConcorrencia(vendedores);
    const resultado: ResultadoConcorrencia = { vendedores, preco_min, origem: 'gtin', classe };

    await cacheConcorrenciaSet(termo, resultado).catch(() => {});
    return resultado;
```

passa a ser:

```ts
    const productId = parseProdutoBusca(busca);
    if (!productId) return { ...NENHUMA, origem: 'gtin' };

    const itensJson = await mlGet(`${API}/products/${productId}/items`, token);
    const ofertas = parseItensProduto(itensJson);
    const classe = classificarConcorrencia(ofertas.vendedores);
    const resultado: ResultadoConcorrencia = {
      vendedores: ofertas.vendedores,
      preco_min: ofertas.preco_min,
      origem: 'gtin',
      classe,
      product_id: productId,
      ofertas,
    };

    await cacheConcorrenciaSet(termo, resultado).catch(() => {});
    return resultado;
```

> Nota: `cacheConcorrenciaSet`/`Get` continuam guardando o objeto inteiro; ao reler do cache,
> `product_id`/`ofertas` voltam junto (o `CacheConcorrenciaEntrada` é JSON livre via JSON.parse).
> Garantir no Step 2 que o getter do cache repassa esses campos.

- [ ] **Step 2: Repassar os campos novos no caminho de cache hit**

No início de `buscarConcorrencia`, o `if (cached)` hoje retorna só
`{vendedores, preco_min, origem, classe}`. Trocar por repassar tudo o que veio no cache:

```ts
    const cached = await cacheConcorrenciaGet(termo).catch(() => null);
    if (cached) {
      return {
        vendedores: cached.vendedores,
        preco_min: cached.preco_min,
        origem: cached.origem,
        classe: cached.classe,
        product_id: (cached as { product_id?: string | null }).product_id ?? null,
        ofertas: (cached as { ofertas?: import('../concorrencia/tipos.ts').DadosOfertas }).ofertas,
      };
    }
```

- [ ] **Step 3: Verificar que a suíte segue verde**

Run: `pnpm test`
Expected: PASS (sem testes novos; nada quebrou)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/ml/concorrencia.ts
git commit -m "feat(m4): buscarConcorrencia expoe product_id e ofertas"
```

---

### Task 3: Funções puras de agregação (TDD)

**Files:**
- Create: `supabase/functions/_shared/ml/mercado-agregar.ts`
- Test: `supabase/functions/_shared/ml/__tests__/mercado-agregar.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { agregarMercado, posicaoNoRanking } from '../mercado-agregar';

describe('agregarMercado', () => {
  it('conta líderes e pega a maior reputação de vendas', () => {
    const r = agregarMercado([
      { lider: true, vendas: 52665 },
      { lider: false, vendas: 3644 },
      { lider: true, vendas: 25853 },
    ]);
    expect(r).toEqual({ lideres: 2, maior_vendas: 52665 });
  });
  it('lista vazia → zeros', () => {
    expect(agregarMercado([])).toEqual({ lideres: 0, maior_vendas: 0 });
  });
});

describe('posicaoNoRanking', () => {
  const json = { content: [
    { id: 'MLBU1', position: 1, type: 'USER_PRODUCT' },
    { id: 'MLB38054475', position: 2, type: 'PRODUCT' },
    { id: 'MLB34175726', position: 7, type: 'PRODUCT' },
  ]};
  it('acha a posição do produto', () => {
    expect(posicaoNoRanking(json, 'MLB34175726')).toBe(7);
  });
  it('produto fora do ranking → null', () => {
    expect(posicaoNoRanking(json, 'MLB999')).toBe(null);
  });
  it('payload inválido → null', () => {
    expect(posicaoNoRanking(null, 'MLB1')).toBe(null);
    expect(posicaoNoRanking({}, 'MLB1')).toBe(null);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run supabase/functions/_shared/ml/__tests__/mercado-agregar.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar**

```ts
export interface ReputacaoVendedor {
  lider: boolean;
  vendas: number;
}

export function agregarMercado(reps: ReputacaoVendedor[]): { lideres: number; maior_vendas: number } {
  return {
    lideres: reps.filter((r) => r.lider).length,
    maior_vendas: reps.reduce((max, r) => Math.max(max, r.vendas), 0),
  };
}

export function posicaoNoRanking(json: unknown, productId: string): number | null {
  const content = (json as { content?: Array<{ id?: string; position?: number }> } | null)?.content;
  if (!Array.isArray(content)) return null;
  const achado = content.find((c) => c.id === productId);
  return typeof achado?.position === 'number' ? achado.position : null;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run supabase/functions/_shared/ml/__tests__/mercado-agregar.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/mercado-agregar.ts supabase/functions/_shared/ml/__tests__/mercado-agregar.test.ts
git commit -m "feat(m4): agregarMercado + posicaoNoRanking (funcoes puras)"
```

---

### Task 4: `analisarMercado` (efeito: reputação + ranking + idade)

**Files:**
- Create: `supabase/functions/_shared/ml/mercado.ts`

Sem teste unitário (faz I/O — validado no bug bash). Resiliência é a regra: qualquer falha em
uma fonte → o campo fica zero/null e o resto segue; nunca lança.

- [ ] **Step 1: Implementar o módulo**

```ts
import { getValidAccessToken } from './token.ts';
import { redisGet, redisSet } from '../redis/client.ts';
import { agregarMercado, posicaoNoRanking, type ReputacaoVendedor } from './mercado-agregar.ts';
import type { DadosOfertas } from '../concorrencia/tipos.ts';

const API = 'https://api.mercadolibre.com';
const TIMEOUT_MS = 15000;
const TTL_SELLER = 60 * 60 * 24; // 24h
const TTL_HIGHLIGHTS = 60 * 60 * 6; // 6h

export interface AnaliseMercado {
  preco_max: number | null;
  total_ofertas: number;
  frete_gratis: number;
  full: number;
  lideres: number;
  maior_vendas: number;
  ranking_categoria: number | null;
  produto_desde: string | null;
}

async function mlGet(url: string, token: string): Promise<unknown | null> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) {
    console.warn(`ML GET ${resp.status}: ${url}`);
    return null;
  }
  return resp.json();
}

async function reputacaoVendedor(token: string, sellerId: number): Promise<ReputacaoVendedor> {
  const chave = `cache:seller:${sellerId}`;
  try {
    const cache = await redisGet(chave);
    if (cache) return JSON.parse(cache) as ReputacaoVendedor;
  } catch { /* segue */ }

  const json = (await mlGet(`${API}/users/${sellerId}`, token)) as {
    seller_reputation?: { power_seller_status?: string | null; transactions?: { total?: number } };
  } | null;
  const rep = json?.seller_reputation;
  const resultado: ReputacaoVendedor = {
    lider: rep?.power_seller_status != null,
    vendas: rep?.transactions?.total ?? 0,
  };
  try { await redisSet(chave, JSON.stringify(resultado), TTL_SELLER); } catch { /* segue */ }
  return resultado;
}

async function rankingCategoria(token: string, categoriaMlId: string, productId: string): Promise<number | null> {
  const chave = `cache:highlights:${categoriaMlId}`;
  let json: unknown = null;
  try {
    const cache = await redisGet(chave);
    if (cache) json = JSON.parse(cache);
  } catch { /* segue */ }
  if (json == null) {
    json = await mlGet(`${API}/highlights/MLB/category/${categoriaMlId}`, token);
    if (json != null) {
      try { await redisSet(chave, JSON.stringify(json), TTL_HIGHLIGHTS); } catch { /* segue */ }
    }
  }
  return posicaoNoRanking(json, productId);
}

async function produtoDesde(token: string, productId: string): Promise<string | null> {
  const json = (await mlGet(`${API}/products/${productId}`, token)) as { date_created?: string } | null;
  const dc = json?.date_created;
  return typeof dc === 'string' && dc.length >= 10 ? dc.slice(0, 10) : null;
}

export async function analisarMercado(
  userId: string,
  productId: string,
  categoriaMlId: string | null,
  ofertas: DadosOfertas,
): Promise<AnaliseMercado> {
  const base: AnaliseMercado = {
    preco_max: ofertas.preco_max,
    total_ofertas: ofertas.total_ofertas,
    frete_gratis: ofertas.frete_gratis,
    full: ofertas.full,
    lideres: 0,
    maior_vendas: 0,
    ranking_categoria: null,
    produto_desde: null,
  };
  try {
    const token = await getValidAccessToken(userId);
    const reps = await Promise.all(
      ofertas.seller_ids.map((id) =>
        reputacaoVendedor(token, id).catch(() => ({ lider: false, vendas: 0 })),
      ),
    );
    const agreg = agregarMercado(reps);
    base.lideres = agreg.lideres;
    base.maior_vendas = agreg.maior_vendas;

    if (categoriaMlId) {
      base.ranking_categoria = await rankingCategoria(token, categoriaMlId, productId).catch(() => null);
    }
    base.produto_desde = await produtoDesde(token, productId).catch(() => null);
  } catch (e) {
    console.warn(`analisarMercado falhou: ${(e as Error).message}`);
  }
  return base;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/ml/mercado.ts
git commit -m "feat(m4): analisarMercado (reputacao + ranking + idade, cacheado/resiliente)"
```

---

### Task 5: Migration `analise_mercado` + tipos (MCP)

**Files:**
- Migration via MCP `apply_migration` (nome `add_analise_mercado_familias`)
- Modify: `src/lib/database.types.ts`

- [ ] **Step 1: Aplicar a migration (MCP `apply_migration`)**

```sql
alter table familias add column analise_mercado jsonb;
```

- [ ] **Step 2: Regenerar tipos (MCP `generate_typescript_types`) e atualizar `src/lib/database.types.ts`**

Substituir o conteúdo de `src/lib/database.types.ts` pelo output do MCP. Conferir que
`familias.Row` agora tem `analise_mercado: Json | null`.

- [ ] **Step 3: Verificar build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/database.types.ts
git commit -m "feat(m4): migration analise_mercado jsonb em familias + tipos"
```

---

### Task 6: Integração no `process-familia` + deploy

**Files:**
- Modify: `supabase/functions/process-familia/index.ts`

- [ ] **Step 1: Importar `analisarMercado`**

Junto aos imports de `_shared/ml`:

```ts
import { analisarMercado } from '../_shared/ml/mercado.ts';
```

- [ ] **Step 2: Calcular a análise após a categoria (passo 5d)**

Logo após o bloco "5d. Categoria + atributos" (depois de `const atributosMl = ...`), inserir:

```ts
    // 5e. Potencial de venda (ADR-0015) — só quando há produto de catálogo (origem gtin).
    const analiseMercado =
      concorrencia.origem === 'gtin' && concorrencia.product_id && concorrencia.ofertas
        ? await analisarMercado(userId, concorrencia.product_id, categoriaMlId, concorrencia.ofertas)
        : null;
```

- [ ] **Step 3: Persistir no update final**

No update "6." da família, acrescentar o campo:

```ts
      analise_mercado: analiseMercado,
```

- [ ] **Step 4: Rodar a suíte (nada quebrou)**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Deploy via MCP**

Gerar o bundle completo e deployar `process-familia` (incluindo `_shared/ml/mercado.ts`,
`_shared/ml/mercado-agregar.ts`, `_shared/concorrencia/{tipos,parse}.ts` atualizados):

```bash
cd supabase/functions && python3 -c '
import json
files = [
  "_shared/cors.ts","_shared/supabase.ts","_shared/queue.ts",
  "_shared/cor/extrair.ts","_shared/cor/dicionario.ts",
  "_shared/concorrencia/pool.ts","_shared/concorrencia/tipos.ts","_shared/concorrencia/gtin.ts",
  "_shared/concorrencia/identificador.ts","_shared/concorrencia/classificar.ts","_shared/concorrencia/parse.ts",
  "_shared/redis/cache-cor.ts","_shared/redis/client.ts","_shared/redis/cache-concorrencia.ts",
  "_shared/ai/vision.ts","_shared/ai/client.ts","_shared/ai/modelos.ts","_shared/ai/tokens.ts","_shared/ai/copywriter.ts",
  "_shared/ml/concorrencia.ts","_shared/ml/token.ts","_shared/ml/refresh-decisao.ts","_shared/ml/mercado.ts","_shared/ml/mercado-agregar.ts",
  "_shared/preco/calcular.ts",
  "_shared/categoria/detectar.ts","_shared/categoria/atributos.ts",
]
arr = [{"name":"index.ts","content":open("process-familia/index.ts").read().replace("../_shared","./_shared")}]
for f in files: arr.append({"name":f,"content":open(f).read()})
open("/tmp/deploy_pf.json","w").write(json.dumps(arr)); print("arquivos:", len(arr))'
```

Depois `Read /tmp/deploy_pf.json` e usar o conteúdo no MCP `deploy_edge_function`
(`name: process-familia`, `entrypoint_path: index.ts`, `verify_jwt: false`). Confirmar versão ACTIVE.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/process-familia/index.ts
git commit -m "feat(m4): integra analisarMercado no process-familia (deploy)"
```

---

### Task 7: Frontend — tipos, adapter e `fmtMilhar`

**Files:**
- Modify: `src/lib/tipos-dominio.ts`
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/formato.ts`

- [ ] **Step 1: Adicionar `AnaliseMercado` + campo na `Familia` (tipos-dominio.ts)**

```ts
export interface AnaliseMercado {
  preco_max: number | null;
  total_ofertas: number;
  frete_gratis: number;
  full: number;
  lideres: number;
  maior_vendas: number;
  ranking_categoria: number | null;
  produto_desde: string | null;
}
```

E na interface `Familia`, junto aos campos de concorrência:

```ts
  analiseMercado: AnaliseMercado | null;
```

- [ ] **Step 2: Mapear no adapter (queries.ts)**

Importar o tipo:

```ts
  AnaliseMercado,
```
(na lista de imports de `./tipos-dominio`)

E em `familiaFromRow`, junto aos campos de concorrência:

```ts
    analiseMercado: (r.analise_mercado as AnaliseMercado | null) ?? null,
```

- [ ] **Step 3: Adicionar `fmtMilhar` em formato.ts**

```ts
export function fmtMilhar(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (n >= 1_000) return `${Math.round(n / 1000)} mil`;
  return String(n);
}
```

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: PASS (mocks/testes que constroem `Familia` podem acusar campo faltando — se acusar,
adicionar `analiseMercado: null` ao factory `familiaBase` do teste do painel na Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tipos-dominio.ts src/lib/queries.ts src/lib/formato.ts
git commit -m "feat(ui): tipo AnaliseMercado + adapter + fmtMilhar"
```

---

### Task 8: Card "Potencial de venda" no PainelAnalise (TDD)

**Files:**
- Modify: `src/components/painel-analise.tsx`
- Modify: `tests/components/painel-analise.test.tsx`

- [ ] **Step 1: Atualizar o factory de teste e adicionar casos**

No `familiaBase` em `tests/components/painel-analise.test.tsx`, acrescentar ao objeto retornado:

```ts
    analiseMercado: {
      preco_max: 17.02, total_ofertas: 8, frete_gratis: 0, full: 0,
      lideres: 4, maior_vendas: 52665, ranking_categoria: null, produto_desde: '2024-03-05',
    },
```

E adicionar, dentro do `describe('PainelAnalise', ...)`:

```ts
  it('mostra potencial de venda com força e faixa de preço', () => {
    render(<PainelAnalise familia={familiaBase()} />);
    expect(screen.getByText(/potencial de venda/i)).toBeInTheDocument();
    expect(screen.getByText(/4\/6 mercadol[íi]der/i)).toBeInTheDocument();
    expect(screen.getByText(/52 mil/i)).toBeInTheDocument();
    expect(screen.getByText(/17,02/)).toBeInTheDocument();
    expect(screen.getByText(/fora do top/i)).toBeInTheDocument();
  });

  it('mostra posição no ranking quando existe', () => {
    render(<PainelAnalise familia={familiaBase({ analiseMercado: { ...familiaBase().analiseMercado!, ranking_categoria: 3 } })} />);
    expect(screen.getByText(/#3/)).toBeInTheDocument();
  });

  it('sem analiseMercado → card de potencial não aparece', () => {
    render(<PainelAnalise familia={familiaBase({ analiseMercado: null })} />);
    expect(screen.queryByText(/potencial de venda/i)).not.toBeInTheDocument();
  });
```

> Nota: `concorrenciaVendedores` no `familiaBase` é 6 → "4/6 MercadoLíder" (líderes/vendedores).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run tests/components/painel-analise.test.tsx`
Expected: FAIL (card ausente)

- [ ] **Step 3: Adicionar o card no painel-analise.tsx**

Importar ícones e `fmtMilhar` (atualizar os imports existentes):

```ts
import { Coins, Tag, Store, AlertTriangle, TrendingUp } from 'lucide-react';
import { fmtBRL, fmtMilhar } from '@/lib/formato';
```

E inserir, logo após o card de Concorrência (antes do fechamento do `</div>` raiz), o card:

```tsx
      {familia.analiseMercado && (
        <div className="rounded-md border p-2">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" /> Potencial de venda
          </div>
          <div className="flex flex-col gap-1 text-xs">
            {familia.concorrenciaPrecoMin != null && familia.analiseMercado.preco_max != null && (
              <span>
                💲 Preço concorrentes:{' '}
                <span className="font-medium text-foreground">
                  {fmtBRL(familia.concorrenciaPrecoMin)} – {fmtBRL(familia.analiseMercado.preco_max)}
                </span>
              </span>
            )}
            <span>
              📈 {familia.analiseMercado.lideres}/{familia.concorrenciaVendedores} MercadoLíder
              {familia.analiseMercado.maior_vendas > 0 && (
                <> · maior <span className="font-medium text-foreground">{fmtMilhar(familia.analiseMercado.maior_vendas)} vendas</span></>
              )}
            </span>
            <span>
              🚚 Frete grátis: {familia.analiseMercado.frete_gratis}/{familia.analiseMercado.total_ofertas}
              {' · '}⚡ FULL: {familia.analiseMercado.full}/{familia.analiseMercado.total_ofertas}
            </span>
            <span>
              🏆 {familia.analiseMercado.ranking_categoria != null
                ? `#${familia.analiseMercado.ranking_categoria} mais vendido na categoria`
                : 'fora do top de mais vendidos da categoria'}
            </span>
            {familia.analiseMercado.produto_desde && (
              <span className="text-muted-foreground">📅 no catálogo desde {familia.analiseMercado.produto_desde}</span>
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run tests/components/painel-analise.test.tsx`
Expected: PASS

- [ ] **Step 5: Build + lint + suíte completa**

Run: `pnpm build && pnpm lint && pnpm test`
Expected: build OK; lint 0 errors; todos os testes passam.

- [ ] **Step 6: Commit**

```bash
git add src/components/painel-analise.tsx tests/components/painel-analise.test.tsx
git commit -m "feat(ui): card Potencial de venda no painel de analise"
```

---

### Task 9: Bug bash (lote real) + docs

**Files:** `docs/TASKS.md`, `docs/ROADMAP.md`, `CLAUDE.md`

- [ ] **Step 1: Lote real pela UI**

Subir um lote (a planilha de fitas/linhas com EAN). Após processar, conferir via MCP `execute_sql`:

```sql
select codigo_pai, analise_mercado from familias
where lote_id = '<id-do-lote>' and analise_mercado is not null;
```

Esperado: jsonb preenchido (preco_max, total_ofertas, frete_gratis, full, lideres, maior_vendas,
ranking_categoria, produto_desde) coerente com o ML.

- [ ] **Step 2: Conferir o card na tela**

Recarregar a revisão do lote (push + deploy Render se necessário) e validar o card "Potencial de
venda" expandindo uma família com EAN.

- [ ] **Step 3: Atualizar docs**

`TASKS.md` (ajustes de UX da revisão): marcar o card de potencial de venda como concluído,
referenciando spec + ADR-0015 + plano-09. `ROADMAP.md`/`CLAUDE.md` (histórico): linha do dia.

- [ ] **Step 4: Commit**

```bash
git add docs/TASKS.md docs/ROADMAP.md CLAUDE.md
git commit -m "docs: card Potencial de venda concluido (ADR-0015, plano-09)"
```

---

## Self-Review

- **Cobertura do spec:** faixa de preço/frete/FULL/sellers no parse — Task 1 ✓; product_id+ofertas
  expostos — Task 2 ✓; agregarMercado/posicaoNoRanking puros — Task 3 ✓; analisarMercado (reputação
  cache 24h + ranking cache 6h + idade, resiliente) — Task 4 ✓; coluna jsonb — Task 5 ✓; integração
  só quando origem=gtin com produto — Task 6 ✓; tipos/adapter/fmtMilhar — Task 7 ✓; card com os 6
  indicadores + ausência quando null + ranking #N/fora — Task 8 ✓; bug bash — Task 9 ✓.
- **Placeholders:** nenhum — todo código está nos steps.
- **Consistência de tipos:** `DadosOfertas` (tipos.ts) usado em parse/concorrencia/mercado;
  `AnaliseMercado` idêntico em backend (`mercado.ts`) e frontend (`tipos-dominio.ts`);
  `ReputacaoVendedor` em mercado-agregar/mercado; denominadores corretos (líderes/`vendedores`,
  frete·FULL/`total_ofertas`); `fmtMilhar`/`fmtBRL` de `@/lib/formato`.
- **Risco conhecido:** Task 2 Step 2 lê `product_id`/`ofertas` do cache via cast — o
  `cacheConcorrenciaSet` serializa o objeto inteiro, então em cache hit os campos voltam; se o
  cache antigo (sem esses campos) for lido, viram `null`/`undefined` e o card simplesmente não
  aparece até o reprocessamento — degradação aceitável.
