# E3 — Categoria genérica + schema dinâmico: plano de implementação

> **Para workers:** TDD por tarefa (RED→GREEN→commit). Testes Deno `_shared` via `pnpm test`/vitest do projeto. Cada passo é uma ação pequena.

**Goal:** resolver categoria-folha do ML para qualquer produto (override→preditor→LLM desempate→manual) + ler o schema de atributos da API e exibir os obrigatórios faltantes, sem regressão nos aviamentos.

**Arquitetura:** funções puras + injeção de deps no resolver; rede (domain_discovery, /categories/{id}/attributes) isolada com cache Redis; integração no `process-familia`; UI no `CardCategoria`.

**Tech:** Deno/TS edge, vitest, React 18, Supabase.

---

### Task 1: Migration (enum + colunas) + tipos

**Files:** Create `supabase/migrations/20260614130000_categoria_generica_e3.sql`; regen `src/lib/database.types.ts`.

- [ ] **Migration:**
```sql
-- E3 (ADR-0026): categoria genérica via preditor + schema dinâmico.
ALTER TYPE tipo_origem ADD VALUE IF NOT EXISTS 'preditor';
ALTER TABLE familias ADD COLUMN IF NOT EXISTS categoria_nome text;
ALTER TABLE familias ADD COLUMN IF NOT EXISTS atributos_faltantes jsonb;
```
- [ ] Aplicar via MCP `apply_migration`. Regenerar tipos via MCP `generate_typescript_types` → `src/lib/database.types.ts`.
- [ ] Commit.

> Nota: `ALTER TYPE ... ADD VALUE` não roda dentro de transação com uso imediato; rodar isolado (migration própria).

---

### Task 2: `domain-discovery.ts` — parser puro + rede

**Files:** Create `supabase/functions/_shared/ml/domain-discovery.ts`, `supabase/functions/_shared/ml/__tests__/domain-discovery.test.ts`.

- [ ] **RED** — teste de `parseDomainDiscovery`:
```ts
import { describe, it, expect } from 'vitest';
import { parseDomainDiscovery } from '../domain-discovery.ts';

const REAL = [ // shape do probe 2026-06-14
  { domain_id: 'MLB-ELECTRIC_DRILLS', domain_name: 'Furadeiras elétricas', category_id: 'MLB189007', category_name: 'De Mão' },
  { domain_id: 'MLB-HAMMER_DRILLS', domain_name: 'Furadeiras', category_id: 'MLB430376', category_name: 'Marteletes' },
];

describe('parseDomainDiscovery', () => {
  it('mapeia itens com category_id e preserva ordem', () => {
    const r = parseDomainDiscovery(REAL);
    expect(r[0]).toEqual({ domainId: 'MLB-ELECTRIC_DRILLS', domainName: 'Furadeiras elétricas', categoriaId: 'MLB189007', categoriaNome: 'De Mão' });
    expect(r).toHaveLength(2);
  });
  it('descarta item sem category_id e lida com não-array', () => {
    expect(parseDomainDiscovery([{ domain_id: 'X' }])).toEqual([]);
    expect(parseDomainDiscovery(null)).toEqual([]);
  });
});
```
- [ ] **GREEN** — implementar:
```ts
import { redisGet, redisSet } from '../redis/client.ts';

export interface CategoriaCandidata {
  domainId: string; domainName: string; categoriaId: string; categoriaNome: string;
}

export function parseDomainDiscovery(body: unknown): CategoriaCandidata[] {
  if (!Array.isArray(body)) return [];
  return body
    .filter((x): x is Record<string, string> => !!x && typeof x.category_id === 'string' && x.category_id.length > 0)
    .map((x) => ({
      domainId: String(x.domain_id ?? ''), domainName: String(x.domain_name ?? ''),
      categoriaId: x.category_id, categoriaNome: String(x.category_name ?? ''),
    }));
}

const TTL_S = 30 * 24 * 60 * 60;
function chaveCache(q: string): string {
  return `dd:${q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)}`;
}

export async function buscarCategoriaPreditor(token: string, query: string): Promise<CategoriaCandidata[]> {
  const q = (query ?? '').trim();
  if (!q) return [];
  const key = chaveCache(q);
  const cached = await redisGet(key).catch(() => null);
  if (cached) return JSON.parse(cached) as CategoriaCandidata[];
  const r = await fetch(
    `https://api.mercadolibre.com/sites/MLB/domain_discovery/search?limit=8&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return [];
  const candidatos = parseDomainDiscovery(await r.json().catch(() => null));
  await redisSet(key, JSON.stringify(candidatos), TTL_S).catch(() => {});
  return candidatos;
}
```
- [ ] Rodar testes (verde). Commit.

---

### Task 3: `schema.ts` — parser de atributos + obrigatórios + rede

**Files:** Create `supabase/functions/_shared/categoria/schema.ts`, `supabase/functions/_shared/categoria/__tests__/schema.test.ts`.

- [ ] **RED:**
```ts
import { describe, it, expect } from 'vitest';
import { parseAtributosSchema, idsObrigatorios, nomesObrigatorios } from '../schema.ts';

const REAL = [
  { id: 'BRAND', name: 'Marca', tags: { required: true, catalog_required: true }, values: [] },
  { id: 'VOLTAGE', name: 'Voltagem', tags: { conditional_required: true, allow_variations: true }, values: [{ id: '1', name: '110V' }, { id: '2', name: '220V' }] },
  { id: 'COLOR', name: 'Cor', tags: {}, values: [{ id: '9', name: 'Preto' }] },
];

describe('schema de atributos', () => {
  it('parseia flags e values', () => {
    const s = parseAtributosSchema(REAL);
    expect(s[0]).toEqual({ id: 'BRAND', nome: 'Marca', required: true, conditionalRequired: false, valores: [] });
    expect(s[1].conditionalRequired).toBe(true);
    expect(s[1].valores).toHaveLength(2);
  });
  it('idsObrigatorios inclui required + conditional_required', () => {
    expect(idsObrigatorios(parseAtributosSchema(REAL)).sort()).toEqual(['BRAND', 'VOLTAGE']);
  });
  it('nomesObrigatorios devolve os nomes', () => {
    expect(nomesObrigatorios(parseAtributosSchema(REAL))).toEqual(['Marca', 'Voltagem']);
  });
  it('não-array → []', () => { expect(parseAtributosSchema(null)).toEqual([]); });
});
```
- [ ] **GREEN:**
```ts
import { redisGet, redisSet } from '../redis/client.ts';

export interface AtributoSchema {
  id: string; nome: string; required: boolean; conditionalRequired: boolean;
  valores: { id: string; nome: string }[];
}

export function parseAtributosSchema(body: unknown): AtributoSchema[] {
  if (!Array.isArray(body)) return [];
  return body.filter((a): a is Record<string, unknown> => !!a && typeof (a as { id?: unknown }).id === 'string').map((a) => {
    const tags = (a.tags ?? {}) as Record<string, boolean>;
    const values = Array.isArray(a.values) ? a.values : [];
    return {
      id: a.id as string, nome: String(a.name ?? a.id),
      required: tags.required === true, conditionalRequired: tags.conditional_required === true,
      valores: values.filter((v): v is Record<string, string> => !!v && typeof v.id === 'string').map((v) => ({ id: v.id, nome: String(v.name ?? v.id) })),
    };
  });
}

export function idsObrigatorios(schema: AtributoSchema[]): string[] {
  return schema.filter((a) => a.required || a.conditionalRequired).map((a) => a.id);
}
export function nomesObrigatorios(schema: AtributoSchema[]): string[] {
  return schema.filter((a) => a.required || a.conditionalRequired).map((a) => a.nome);
}

const TTL_S = 30 * 24 * 60 * 60;
export async function lerSchemaAtributos(token: string, categoriaId: string): Promise<AtributoSchema[]> {
  const key = `attrs:${categoriaId}`;
  const cached = await redisGet(key).catch(() => null);
  if (cached) return JSON.parse(cached) as AtributoSchema[];
  const r = await fetch(`https://api.mercadolibre.com/categories/${categoriaId}/attributes`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  const schema = parseAtributosSchema(await r.json().catch(() => null));
  await redisSet(key, JSON.stringify(schema), TTL_S).catch(() => {});
  return schema;
}
```
- [ ] Testes verdes. Commit.

---

### Task 4: `atributos.ts` — montarAtributosBase + atributosFaltantesGenerico

**Files:** Modify `supabase/functions/_shared/categoria/atributos.ts`; add tests to `__tests__/atributos.test.ts`.

- [ ] **RED:**
```ts
import { montarAtributosBase, atributosFaltantesGenerico } from '../atributos.ts';
import type { AtributoSchema } from '../schema.ts';

const SCHEMA: AtributoSchema[] = [
  { id: 'BRAND', nome: 'Marca', required: true, conditionalRequired: false, valores: [] },
  { id: 'MODEL', nome: 'Modelo', required: true, conditionalRequired: false, valores: [] },
  { id: 'VOLTAGE', nome: 'Voltagem', required: false, conditionalRequired: true, valores: [{ id: '1', nome: '110V' }] },
];

it('montarAtributosBase preenche BRAND/MODEL e deixa closed-set vazio', () => {
  const a = montarAtributosBase('MLB189007', SCHEMA, 'Furadeira X 650W', 'Bosch');
  expect(a.find((x) => x.id === 'BRAND')?.value_name).toBe('Bosch');
  expect(a.find((x) => x.id === 'MODEL')?.value_name).toBe('Furadeira X 650W');
  expect(a.find((x) => x.id === 'VOLTAGE')).toBeUndefined();
});
it('atributosFaltantesGenerico lista required não preenchidos', () => {
  const a = montarAtributosBase('MLB189007', SCHEMA, 'Furadeira X', 'Bosch');
  expect(atributosFaltantesGenerico(a, SCHEMA)).toEqual(['Voltagem']); // BRAND+MODEL preenchidos; VOLTAGE falta
});
```
- [ ] **GREEN** — implementar usando os helpers de marca/EMPTY_GTIN_REASON já existentes no arquivo. `montarAtributosBase` preenche BRAND (marca||'Avil') e MODEL (nome) quando presentes no schema; EMPTY_GTIN_REASON quando `categoriaAceitaEmptyGtinReason(categoriaId)`. `atributosFaltantesGenerico(tem, schema)` = `schema.filter(required||conditional).filter(id ∉ tem).map(nome)`.
- [ ] Testes verdes (incl. regressão dos testes por-tipo existentes). Commit.

---

### Task 5: `resolver.ts` — orquestrador puro

**Files:** Create `supabase/functions/_shared/categoria/resolver.ts`, `__tests__/resolver.test.ts`.

- [ ] **RED** — cobrir os 6 casos da seção "Testes" do spec (override; preditor 1 domain; ambíguo+llm→ia; llm fora da lista→topo; preditor []→manual; ambíguo sem llm→topo).
- [ ] **GREEN:**
```ts
import { detectarTipoAviamento } from './detectar.ts';
import { categoriaParaTipo, rotuloParaTipo } from './atributos.ts'; // rotuloParaTipo: novo helper que devolve o rótulo humano
import type { CategoriaCandidata } from '../ml/domain-discovery.ts';

export type OrigemCategoria = 'regex' | 'preditor' | 'ia' | 'manual';
export interface InputCategoria { nome: string; descricao?: string; }
export interface ResultadoCategoria { categoriaId: string | null; categoriaNome: string | null; tipo: ReturnType<typeof detectarTipoAviamento>['tipo']; origem: OrigemCategoria; }
export interface DepsResolver {
  preditor: (nome: string) => Promise<CategoriaCandidata[]>;
  llm?: (input: InputCategoria, candidatos: CategoriaCandidata[]) => Promise<string | null>;
}

export async function resolverCategoria(input: InputCategoria, deps: DepsResolver): Promise<ResultadoCategoria> {
  const { tipo } = detectarTipoAviamento(input.nome);
  const catOverride = categoriaParaTipo(tipo);
  if (catOverride) return { categoriaId: catOverride, categoriaNome: rotuloParaTipo(tipo), tipo, origem: 'regex' };

  const candidatos = await deps.preditor(input.nome).catch(() => []);
  if (candidatos.length === 0) return { categoriaId: null, categoriaNome: null, tipo: 'outro', origem: 'manual' };

  const topo = candidatos[0];
  const domains = new Set(candidatos.map((c) => c.domainId));
  if (deps.llm && domains.size >= 2) {
    const escolhidoId = await deps.llm(input, candidatos).catch(() => null);
    const escolhido = candidatos.find((c) => c.categoriaId === escolhidoId);
    if (escolhido && escolhido.categoriaId !== topo.categoriaId)
      return { categoriaId: escolhido.categoriaId, categoriaNome: escolhido.categoriaNome, tipo: 'outro', origem: 'ia' };
  }
  return { categoriaId: topo.categoriaId, categoriaNome: topo.categoriaNome, tipo: 'outro', origem: 'preditor' };
}
```
- [ ] Adicionar `rotuloParaTipo(tipo)` em `atributos.ts` (reusa `CATEGORIA_POR_TIPO`/rótulos; alinhar com `CATEGORIAS_MANUAIS` do front). Testes verdes. Commit.

---

### Task 6: `categoria-llm.ts` — desempate closed-set

**Files:** Create `supabase/functions/_shared/ai/categoria-llm.ts`, `__tests__/categoria-llm.test.ts`.

- [ ] **RED** — com client mockado: devolve um `category_id` da lista → retorna ele; devolve fora da lista → null; erro → null. (Testar o parser/guard, não a rede real.)
- [ ] **GREEN** — usa `openrouterClient()` + `MODELO_COPY` (mesmo padrão de `copywriter.ts`), structured output `{ category_id: string }`; valida que o id ∈ candidatos antes de retornar; senão null. Prompt: "Escolha a categoria que melhor descreve o produto. Responda APENAS com um category_id da lista." Injeta nome+descrição+candidatos (id+nome).
- [ ] Testes verdes. Commit.

---

### Task 7: integração no `process-familia`

**Files:** Modify `supabase/functions/process-familia/index.ts`.

- [ ] Trocar imports (linhas 14-15): remover `detectarTipoAviamento`/`categoriaParaTipo` diretos; importar `resolverCategoria`, `lerSchemaAtributos`, `buscarCategoriaPreditor`, `montarAtributosBase`, `atributosFaltantesGenerico`, `desempatarCategoriaLLM`, manter `montarAtributosML`.
- [ ] Içar `getValidAccessToken(userId)` para antes do bloco 5c (try/catch → `token|null`); reaproveitar no gross-up (remover o fetch de token de dentro do gross-up).
- [ ] Substituir o bloco 5c pelo descrito no spec (resolverCategoria + schema + faltantes), resiliente.
- [ ] Persistência: `tipo_origem: cat.origem`, `categoria_nome: cat.categoriaNome`, `atributos_faltantes: faltantes`, `tipo_aviamento: cat.tipo`, `categoria_ml_id`, `atributos_ml`.
- [ ] `pnpm test` + tsc do diretório. Commit.

---

### Task 8: frontend `CardCategoria` + tipos + adapter

**Files:** Modify `src/lib/tipos-dominio.ts`, `src/lib/queries.ts`, `src/components/card-categoria.tsx`; test `tests/components/card-categoria.test.tsx` (ou estender existente).

- [ ] `Familia` ganha `categoriaNome: string | null` e `atributosFaltantes: string[] | null`; adapter em `queries.ts` mapeia `categoria_nome`/`atributos_faltantes`.
- [ ] `CardCategoria`: nome = `familia.categoriaNome ?? nomeCategoriaAmigavel(tipo)`; selo `StatusPill` "sugerida por IA — confira" quando `tipoOrigem ∈ {preditor, ia}`; lista "Faltam: …" quando `atributosFaltantes?.length`.
- [ ] **RED/GREEN** — teste: família com `tipoOrigem='preditor'` + `categoriaNome='De Mão'` + `atributosFaltantes=['Voltagem']` renderiza nome, selo e "Voltagem"; família override (regex) não mostra selo.
- [ ] `pnpm test` + `pnpm build` + `pnpm lint`. Commit.

---

### Fechamento
- [ ] Suite cheia verde (`pnpm test`), `tsc`/`pnpm lint`/`pnpm build` limpos.
- [ ] Code review opus (passe separado).
- [ ] Deploy via CLI das functions afetadas por `_shared` (process-familia + as que importam categoria/atributos: publish-familia-ml, update-familia-ml, definir-categoria-familia, regenerar-copy-familia — conferir grafo de imports).
- [ ] Bug bash browser-use (seção do spec).
- [ ] Merge na main + push; atualizar CLAUDE.md/TASKS/memória.
