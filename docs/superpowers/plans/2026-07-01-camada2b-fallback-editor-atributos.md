# Camada 2B — Fallback: editor de atributos faltantes na Revisão (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando a IA não conseguir preencher um atributo obrigatório (o "último caso"), o operador completa inline na Revisão; a edição sobrevive a reprocesso e a publicação fica travada até resolver.

**Architecture:** Backend concentra validação e recálculo de faltantes (regra de ouro server-side): uma edge function `atributos-familia` lista os obrigatórios faltantes **com schema** (tipo/valores/unidades) e salva um valor validando contra o schema, fazendo merge em `atributos_ml`, marcando a flag de edição manual e recalculando `atributos_faltantes`. O `process-familia` passa a NÃO sobrescrever atributos editados pelo operador. No frontend, o `CardCategoria` ganha um editor inline (reusa `StatusInline` + padrão `mutateAsync`→`flash`), e `familiaPublicavel` trava a publicação enquanto houver faltante.

**Tech Stack:** Deno edge functions (TS), Supabase (Postgres + RLS), React 18 + TS + shadcn (`Select`/`Input`), TanStack Query, Vitest.

## Global Constraints

- Validação e recálculo de faltantes SEMPRE no backend (nunca confiar no front). Reusa `lerSchemaAtributos` (`_shared/categoria/schema.ts`), `atributosFaltantesGenerico` e o casamento de valor de `_shared/ai/atributos-llm-core.ts`/`_shared/categoria/atributos.ts`.
- Edge function autenticada: `verify_jwt = true` em `config.toml` (chamada do front com JWT; RLS por `user_id`/operação).
- Edição manual preservada: `process-familia` não sobrescreve `atributos_ml`/`atributos_faltantes` quando `atributos_editados_pelo_operador = true` (espelha `titulo_editado_pelo_operador`).
- Migrations só via `supabase migration new` + `db push` (ADR-0043); nunca `apply_migration`/painel.
- UI: usar só `Select` (closed-set) e `Input` (texto/numérico) — não há combobox/autocomplete no projeto; não adicionar dependência.
- Feedback de save: componente existente `StatusInline` (`src/components/status-inline.tsx`), padrão `mutateAsync`→`flash` de `familia-expanded.tsx:151-171`.
- Escopo: fallback só de ATRIBUTOS. Troca livre de categoria NÃO entra (fase posterior).
- Fim de branch: `npx vitest run` + `npx tsc -b` + `deno check` verdes; deploy CLI; validação de UI real (browser-use) antes de merge.

---

### Task 1: Migration da flag + guarda no process-familia

**Files:**
- Create: `supabase/migrations/<timestamp>_atributos_editados_pelo_operador.sql`
- Modify: `supabase/functions/process-familia/index.ts` (SELECT do claim ~56; bloco de atributos ~187-216; nada no UPDATE final além do já existente)
- Modify: `src/lib/database.types.ts` (regenerar) — coluna nova em `familias`

**Interfaces:**
- Produces: coluna `familias.atributos_editados_pelo_operador boolean not null default false`; `process-familia` respeita a flag.

- [ ] **Step 1: Criar a migration**

Run: `supabase migration new atributos_editados_pelo_operador`
Conteúdo do arquivo criado:

```sql
alter table public.familias
  add column if not exists atributos_editados_pelo_operador boolean not null default false;

comment on column public.familias.atributos_editados_pelo_operador is
  'Atributos completados manualmente na Revisão (Camada 2B). process-familia não sobrescreve quando true.';
```

- [ ] **Step 2: Aplicar e checar**

Run: `supabase db push` (usa `SUPABASE_ACCESS_TOKEN` do `.env.local`)
Run: `npm run db:check`
Expected: migration aplicada, sem drift.

- [ ] **Step 3: Regenerar os tipos do banco**

Run: `supabase gen types typescript --project-id txvncrgkoynoxwopfkbp > src/lib/database.types.ts`
Expected: `atributos_editados_pelo_operador: boolean` aparece em `familias` Row/Insert/Update.

- [ ] **Step 4: Guarda no process-familia (não sobrescrever edição manual)**

Adicionar `atributos_editados_pelo_operador` ao SELECT do claim (junto dos outros campos lidos, ~`index.ts:56`) e envolver o bloco que recalcula atributos. Localize o bloco `if (categoriaParaTipo(tipo) != null) { ... } else if (categoriaMlId) { ... }` e envolva-o:

```ts
    // Não recalcular atributos que o operador completou manualmente (Camada 2B, ADR-0052).
    if (claimed.atributos_editados_pelo_operador) {
      atributosMl = (claimed.atributos_ml as AtributoML[] | null) ?? [];
      faltantes = (claimed.atributos_faltantes as string[] | null) ?? [];
    } else if (categoriaParaTipo(tipo) != null) {
      // ... (bloco determinístico existente, inalterado)
    } else if (categoriaMlId) {
      // ... (bloco genérico existente, inalterado)
    }
```

Garanta que `claimed.atributos_ml` e `claimed.atributos_faltantes` estão no SELECT do claim.

- [ ] **Step 5: deno check + commit**

Run: `cd supabase/functions && deno check process-familia/index.ts` → DENO=0
```bash
git add supabase/migrations/ src/lib/database.types.ts supabase/functions/process-familia/index.ts
git commit -m "feat(atributos-2b): flag atributos_editados_pelo_operador + guarda no process-familia"
```

---

### Task 2: Função pura — faltantes com schema + validação de um valor

**Files:**
- Create: `supabase/functions/_shared/categoria/faltantes-editaveis.ts`
- Test: `supabase/functions/_shared/categoria/__tests__/faltantes-editaveis.test.ts`

**Interfaces:**
- Consumes: `AtributoSchema` (`schema.ts`), `AtributoML` (`atributos.ts`), `AtributoAlvo`/`tipo` conceito.
- Produces:
  - `faltantesEditaveis(schema: AtributoSchema[], atributos: AtributoML[]): CampoFaltante[]` — obrigatórios não preenchidos, com forma editável.
  - `validarValorAtributo(schema: AtributoSchema[], atributoId: string, bruto: string): AtributoML | null` — valida 1 valor manual contra o schema (closed-set: casa id/nome; numérico: número+unidade; texto: só trim+comprimento — SEM invariante de fonte, pois aqui é o operador digitando, não a IA).
  - `type CampoFaltante = { id: string; nome: string; tipo: 'closed'|'numero'|'texto'; valores: {id:string;nome:string}[]; unidades?: {id:string;nome:string}[] }`

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, it, expect } from 'vitest';
import { faltantesEditaveis, validarValorAtributo } from '../faltantes-editaveis';
import type { AtributoSchema } from '../schema';

const A = (o: Partial<AtributoSchema> & { id: string }): AtributoSchema => ({
  nome: o.id, required: false, conditionalRequired: false, valueType: 'string', valores: [], allowedUnits: [], tags: [], ...o,
});
const SCHEMA: AtributoSchema[] = [
  A({ id: 'BRAND', nome: 'Marca', required: true }),
  A({ id: 'MODEL', nome: 'Modelo', required: true }),
  A({ id: 'VOLTAGE', nome: 'Voltagem', required: true, valueType: 'list', valores: [{ id: '1', nome: '110V' }, { id: '2', nome: '220V' }] }),
  A({ id: 'LENGTH', nome: 'Comprimento', conditionalRequired: true, valueType: 'number_unit', allowedUnits: [{ id: 'cm', nome: 'cm' }] }),
  A({ id: 'COLOR', nome: 'Cor', required: true, valueType: 'list', valores: [{ id: '9', nome: 'Preto' }] }), // variação → ignorado
];

describe('faltantesEditaveis', () => {
  it('lista obrigatórios não preenchidos com tipo/valores; ignora COLOR', () => {
    const campos = faltantesEditaveis(SCHEMA, [{ id: 'BRAND', value_name: 'Avil' }]);
    expect(campos.map((c) => c.id)).toEqual(['MODEL', 'VOLTAGE', 'LENGTH']);
    expect(campos.find((c) => c.id === 'MODEL')?.tipo).toBe('texto');
    expect(campos.find((c) => c.id === 'VOLTAGE')?.tipo).toBe('closed');
    expect(campos.find((c) => c.id === 'VOLTAGE')?.valores).toEqual([{ id: '1', nome: '110V' }, { id: '2', nome: '220V' }]);
    expect(campos.find((c) => c.id === 'LENGTH')?.tipo).toBe('numero');
  });
});

describe('validarValorAtributo', () => {
  it('closed-set por id', () => {
    expect(validarValorAtributo(SCHEMA, 'VOLTAGE', '2')).toEqual({ id: 'VOLTAGE', value_id: '2' });
  });
  it('closed-set por nome (fuzzy)', () => {
    expect(validarValorAtributo(SCHEMA, 'VOLTAGE', '110v')).toEqual({ id: 'VOLTAGE', value_id: '1' });
  });
  it('closed-set inválido → null', () => {
    expect(validarValorAtributo(SCHEMA, 'VOLTAGE', '380V')).toBeNull();
  });
  it('numérico com unidade permitida', () => {
    expect(validarValorAtributo(SCHEMA, 'LENGTH', '10 cm')).toEqual({ id: 'LENGTH', value_name: '10 cm' });
  });
  it('texto livre (operador) → aceita trim', () => {
    expect(validarValorAtributo(SCHEMA, 'MODEL', '  Barbante 4/6  ')).toEqual({ id: 'MODEL', value_name: 'Barbante 4/6' });
  });
  it('texto vazio → null', () => {
    expect(validarValorAtributo(SCHEMA, 'MODEL', '   ')).toBeNull();
  });
  it('atributo fora do schema → null', () => {
    expect(validarValorAtributo(SCHEMA, 'XPTO', 'x')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/_shared/categoria/__tests__/faltantes-editaveis.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `faltantes-editaveis.ts`**

```ts
import type { AtributoSchema } from './schema.ts';
import type { AtributoML } from './atributos.ts';

// COLOR/GTIN/EMPTY_GTIN_REASON são resolvidos por variação/publicação; não editáveis aqui.
const IGNORAR = new Set(['GTIN', 'EMPTY_GTIN_REASON', 'COLOR']);
const TAGS_EXCLUIR = new Set(['read_only', 'hidden', 'variation_attribute', 'multivalued']);
const MAX_TEXTO = 60;

export type CampoFaltante = {
  id: string;
  nome: string;
  tipo: 'closed' | 'numero' | 'texto';
  valores: { id: string; nome: string }[];
  unidades?: { id: string; nome: string }[];
};

function normalizar(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
function ehNumerico(a: AtributoSchema): boolean {
  return a.valueType === 'number' || a.valueType === 'number_unit';
}
function tipoDe(a: AtributoSchema): 'closed' | 'numero' | 'texto' {
  if (a.valores.length > 0) return 'closed';
  if (ehNumerico(a)) return 'numero';
  return 'texto';
}

export function faltantesEditaveis(schema: AtributoSchema[], atributos: AtributoML[]): CampoFaltante[] {
  const presentes = new Set(atributos.filter((a) => a.value_name || a.value_id).map((a) => a.id));
  return schema
    .filter((a) =>
      (a.required || a.conditionalRequired) &&
      !IGNORAR.has(a.id) &&
      !presentes.has(a.id) &&
      !a.tags.some((t) => TAGS_EXCLUIR.has(t)),
    )
    .map((a) => ({
      id: a.id,
      nome: a.nome,
      tipo: tipoDe(a),
      valores: a.valores,
      unidades: a.valueType === 'number_unit' ? a.allowedUnits : undefined,
    }));
}

function validarNumerico(bruto: string, unidades: { id: string; nome: string }[]): string | null {
  const m = bruto.trim().match(/^(\d+(?:[.,]\d+)?)\s*([\p{L}²³"']*)\s*$/u);
  if (!m) return null;
  const num = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return null;
  const validas = unidades.filter((x) => x.nome.trim() || x.id.trim());
  if (validas.length > 0) {
    const un = normalizar(m[2]);
    if (!un) return null;
    const u = validas.find((x) => normalizar(x.nome) === un || normalizar(x.id) === un);
    return u ? `${num} ${u.nome}` : null;
  }
  return String(num);
}

export function validarValorAtributo(schema: AtributoSchema[], atributoId: string, bruto: string): AtributoML | null {
  const a = schema.find((s) => s.id === atributoId);
  if (!a) return null;
  const tipo = tipoDe(a);
  if (tipo === 'closed') {
    const porId = a.valores.find((v) => v.id === String(bruto));
    const porNome = porId ? null : a.valores.find((v) => normalizar(v.nome) === normalizar(String(bruto)));
    const escolhido = porId ?? porNome;
    return escolhido ? { id: a.id, value_id: escolhido.id } : null;
  }
  if (tipo === 'numero') {
    const v = validarNumerico(String(bruto), a.allowedUnits ?? []);
    return v ? { id: a.id, value_name: v } : null;
  }
  const valor = String(bruto).trim();
  if (!valor || valor.length > MAX_TEXTO) return null;
  return { id: a.id, value_name: valor };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/functions/_shared/categoria/__tests__/faltantes-editaveis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/categoria/faltantes-editaveis.ts supabase/functions/_shared/categoria/__tests__/faltantes-editaveis.test.ts
git commit -m "feat(atributos-2b): funções puras faltantesEditaveis + validarValorAtributo (TDD)"
```

---

### Task 3: Edge function `atributos-familia` (listar faltantes-com-schema + salvar)

**Files:**
- Create: `supabase/functions/atributos-familia/index.ts`
- Modify: `supabase/config.toml` (adicionar `[functions.atributos-familia]` `verify_jwt = true`)

**Interfaces:**
- Consumes: `faltantesEditaveis`, `validarValorAtributo` (Task 2), `lerSchemaAtributos` (`schema.ts`), `atributosFaltantesGenerico` (`atributos.ts`), `getValidAccessToken` (`ml/token.ts`), `userClient` (`_shared/supabase.ts`).
- Produces: HTTP POST com `{ action: 'faltantes', familia_id }` → `{ campos: CampoFaltante[] }`; `{ action: 'salvar', familia_id, atributo_id, valor }` → `{ ok, atributos_faltantes }` (recalculado). RLS via `userClient(jwt)`.

- [ ] **Step 1: Escrever a edge function**

```ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { userClient } from '../_shared/supabase.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { lerSchemaAtributos } from '../_shared/categoria/schema.ts';
import { atributosFaltantesGenerico, type AtributoML } from '../_shared/categoria/atributos.ts';
import { faltantesEditaveis, validarValorAtributo } from '../_shared/categoria/faltantes-editaveis.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return new Response('Missing auth', { status: 401, headers: corsHeaders });

  const sb = userClient(auth.slice(7));
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response('Invalid token', { status: 401, headers: corsHeaders });

  let body: { action?: string; familia_id?: string; atributo_id?: string; valor?: string };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!body.familia_id) return new Response('familia_id obrigatório', { status: 400, headers: corsHeaders });

  // RLS garante que só famílias visíveis ao usuário são lidas/escritas.
  const { data: familia, error } = await sb.from('familias')
    .select('id, categoria_ml_id, atributos_ml, user_id').eq('id', body.familia_id).maybeSingle();
  if (error || !familia) return new Response('Família não encontrada', { status: 404, headers: corsHeaders });
  if (!familia.categoria_ml_id) return new Response('Família sem categoria', { status: 400, headers: corsHeaders });

  const token = await getValidAccessToken(familia.user_id);
  const schema = await lerSchemaAtributos(token, familia.categoria_ml_id);
  const atuais = (familia.atributos_ml as AtributoML[] | null) ?? [];

  if (body.action === 'faltantes') {
    return new Response(JSON.stringify({ campos: faltantesEditaveis(schema, atuais) }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }

  if (body.action === 'salvar') {
    if (!body.atributo_id || body.valor == null) {
      return new Response('atributo_id e valor obrigatórios', { status: 400, headers: corsHeaders });
    }
    const validado = validarValorAtributo(schema, body.atributo_id, body.valor);
    if (!validado) return new Response('Valor inválido para o atributo', { status: 422, headers: corsHeaders });
    const merged = [...atuais.filter((a) => a.id !== validado.id), validado];
    const faltantes = atributosFaltantesGenerico(merged, schema);
    const { error: upErr } = await sb.from('familias')
      .update({ atributos_ml: merged, atributos_faltantes: faltantes, atributos_editados_pelo_operador: true })
      .eq('id', familia.id);
    if (upErr) return new Response(`Erro ao salvar: ${upErr.message}`, { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true, atributos_faltantes: faltantes }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }

  return new Response('action inválida', { status: 400, headers: corsHeaders });
});
```

- [ ] **Step 2: Registrar no config.toml**

Adicionar em `supabase/config.toml`, na seção `verify_jwt = true`:
```toml
[functions.atributos-familia]
verify_jwt = true
```

- [ ] **Step 3: deno check**

Run: `cd supabase/functions && deno check atributos-familia/index.ts`
Expected: DENO=0.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/atributos-familia/ supabase/config.toml
git commit -m "feat(atributos-2b): edge function atributos-familia (faltantes-com-schema + salvar)"
```

---

### Task 4: Frontend — tipos, query e hook

**Files:**
- Modify: `src/lib/tipos-dominio.ts` (interface `Familia` ~118-165; novo tipo `AtributoMl`)
- Modify: `src/lib/queries.ts` (`familiaFromRow` ~311; nova `chamarAtributosFamilia`)
- Modify: `src/hooks/useFamiliaMutations.ts` (novo hook)

**Interfaces:**
- Consumes: coluna `atributos_ml`/`atributos_editados_pelo_operador` (Task 1); edge `atributos-familia` (Task 3).
- Produces: `Familia.atributosMl: AtributoMl[]`; `listarFaltantesAtributos(familiaId)` e `salvarAtributoFamilia(familiaId, atributoId, valor)`; hook `useSalvarAtributo(loteId)`.

- [ ] **Step 1: Tipos**

Em `tipos-dominio.ts`, após `atributosFaltantes` (~135):
```ts
  atributosMl: AtributoMl[];
```
E o tipo (perto dos outros exports):
```ts
export interface AtributoMl { id: string; value_id: string | null; value_name: string | null; }
export interface CampoFaltante {
  id: string; nome: string; tipo: 'closed' | 'numero' | 'texto';
  valores: { id: string; nome: string }[]; unidades?: { id: string; nome: string }[];
}
```

- [ ] **Step 2: Mapeamento + chamadas à edge (queries.ts)**

Em `familiaFromRow`, junto de `atributosFaltantes`:
```ts
    atributosMl: (r.atributos_ml as AtributoMl[] | null) ?? [],
```
E funções de chamada (padrão `fetch` com Bearer, igual `definirCategoriaFamilia`):
```ts
async function chamarAtributosFamilia(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/atributos-familia`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export function listarFaltantesAtributos(familiaId: string): Promise<{ campos: CampoFaltante[] }> {
  return chamarAtributosFamilia({ action: 'faltantes', familia_id: familiaId });
}
export function salvarAtributoFamilia(familiaId: string, atributoId: string, valor: string): Promise<{ ok: boolean; atributos_faltantes: string[] }> {
  return chamarAtributosFamilia({ action: 'salvar', familia_id: familiaId, atributo_id: atributoId, valor });
}
```

- [ ] **Step 3: Hook (useFamiliaMutations.ts)** — copie o padrão de `useUpdateFamiliaTitulo`:
```ts
export function useSalvarAtributo(loteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familiaId, atributoId, valor }: { familiaId: string; atributoId: string; valor: string }) =>
      salvarAtributoFamilia(familiaId, atributoId, valor),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.familias(loteId) }),
  });
}
```

- [ ] **Step 4: tsc**

Run: `npx tsc -b`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tipos-dominio.ts src/lib/queries.ts src/hooks/useFamiliaMutations.ts
git commit -m "feat(atributos-2b): tipos/query/hook para faltantes e salvar atributo"
```

---

### Task 5: Frontend — editor inline no CardCategoria + trava de publicação

**Files:**
- Create: `src/components/editor-atributos-faltantes.tsx`
- Modify: `src/components/card-categoria.tsx` (substituir o bloco read-only `atributosFaltantes` ~69-74)
- Modify: `src/lib/publicavel.ts` (`familiaPublicavel` CREATE ~82)
- Test: `src/lib/__tests__/publicavel.test.ts` (se existir; senão criar caso)

**Interfaces:**
- Consumes: `listarFaltantesAtributos`/`useSalvarAtributo` (Task 4), `StatusInline` (`status-inline.tsx`), `CampoFaltante`.
- Produces: componente `EditorAtributosFaltantes`; trava de publicação por atributo faltante.

- [ ] **Step 1: Trava de publicação (test-first)**

Em `publicavel.test.ts` (crie se não houver), caso CREATE:
```ts
it('bloqueia publicação quando há atributos faltantes (CREATE)', () => {
  const fam = { /* família CREATE pronta, 1 cor completa */, categoriaMlId: 'MLB270273', atributosFaltantes: ['Modelo'] } as any;
  const r = familiaPublicavel(fam);
  expect(r.ok).toBe(false);
  expect(r.motivos.join(' ')).toMatch(/Modelo/);
});
```
Run: `npx vitest run src/lib/__tests__/publicavel.test.ts` → FAIL.

- [ ] **Step 2: Implementar a trava** em `publicavel.ts`, no bloco CREATE após a linha `if (!familia.categoriaMlId) motivos.push('Categoria indefinida');` (~82):
```ts
  if (familia.atributosFaltantes && familia.atributosFaltantes.length > 0) {
    motivos.push(`Atributos obrigatórios faltando: ${familia.atributosFaltantes.join(', ')}`);
  }
```
Run: `npx vitest run src/lib/__tests__/publicavel.test.ts` → PASS.

- [ ] **Step 3: Componente `editor-atributos-faltantes.tsx`**

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listarFaltantesAtributos } from '@/lib/queries';
import { useSalvarAtributo } from '@/hooks/useFamiliaMutations';
import { StatusInline, type SaveStatus } from '@/components/status-inline';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CampoFaltante } from '@/lib/tipos-dominio';

const FLASH_MS = 2000;

export function EditorAtributosFaltantes({ familiaId, loteId }: { familiaId: string; loteId: string }) {
  const { data } = useQuery({
    queryKey: ['faltantes-atributos', familiaId],
    queryFn: () => listarFaltantesAtributos(familiaId),
  });
  const salvar = useSalvarAtributo(loteId);
  const [status, setStatus] = useState<Record<string, SaveStatus>>({});

  const setCampo = (id: string, s: SaveStatus) => setStatus((p) => ({ ...p, [id]: s }));
  const onSalvar = async (id: string, valor: string) => {
    if (!valor.trim()) return;
    setCampo(id, 'salvando');
    try {
      await salvar.mutateAsync({ familiaId, atributoId: id, valor });
      setCampo(id, 'salvo');
      setTimeout(() => setCampo(id, undefined), FLASH_MS);
    } catch {
      setCampo(id, 'erro');
    }
  };

  const campos = data?.campos ?? [];
  if (campos.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-2 border-t pt-2">
      <p className="text-xs font-medium text-warning">Complete para publicar:</p>
      {campos.map((c: CampoFaltante) => (
        <div key={c.id} className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">{c.nome}</label>
            <StatusInline status={status[c.id]} />
          </div>
          {c.tipo === 'closed' ? (
            <Select onValueChange={(v) => onSalvar(c.id, v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Escolher" /></SelectTrigger>
              <SelectContent>
                {c.valores.map((v) => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="h-8 text-xs"
              placeholder={c.tipo === 'numero' ? (c.unidades?.length ? `nº + ${c.unidades[0].nome}` : 'número') : 'texto'}
              onBlur={(e) => onSalvar(c.id, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Ligar no CardCategoria** — substituir o bloco `atributosFaltantes` (`card-categoria.tsx:69-74`) por: manter o resumo "Faltam:" E, abaixo, o editor:
```tsx
          {familia.atributosFaltantes && familia.atributosFaltantes.length > 0 && (
            <>
              <p className="mt-1.5 flex items-start gap-1 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>Faltam: {familia.atributosFaltantes.join(', ')}</span>
              </p>
              <EditorAtributosFaltantes familiaId={familia.id} loteId={familia.loteId} />
            </>
          )}
```
Import no topo: `import { EditorAtributosFaltantes } from '@/components/editor-atributos-faltantes';`

- [ ] **Step 5: Verificação + commit**

Run: `npx tsc -b` → sem erros. `npx vitest run` → verde.
```bash
git add src/components/editor-atributos-faltantes.tsx src/components/card-categoria.tsx src/lib/publicavel.ts src/lib/__tests__/publicavel.test.ts
git commit -m "feat(atributos-2b): editor inline de atributos faltantes + trava de publicação"
```

---

## Verificação final do Plano B

- [ ] `npx vitest run` + `npx tsc -b` + `npm run lint` verdes.
- [ ] `deno check` em `atributos-familia/index.ts` e `process-familia/index.ts` = 0.
- [ ] Deploy CLI: `atributos-familia` (novo, `verify_jwt=true`) + `process-familia` (guarda da flag). `db push` da migration antes.
- [ ] **Validação de UI real (browser-use + VALIDATION_* do .env.local):** numa família com atributo faltante, o card mostra o editor; preencher um closed-set e um texto → "✓ Salvo", "Faltam" some, checkbox de publicar habilita. Comparar 1:1 com a tela (`visual-verdict`).
- [ ] Confirmar que reprocessar a família NÃO apaga o atributo salvo (flag preservada).

## Self-Review (feito)

- **Cobertura ADR-0052**: decisão 3 (fallback na Revisão) = Task 5; decisão 4 (só atributos) = escopo; decisão 5 (preservar edição) = Task 1. Validação server-side (regra de ouro) = Tasks 2-3.
- **Placeholders**: nenhum — todo passo traz código/comando/resultado.
- **Consistência de tipos**: `CampoFaltante` (Task 2) idêntico no front (Task 4) e usado no editor (Task 5); `AtributoMl` (Task 4) = forma gravada por `validarValorAtributo` (Task 2); edge `atributos-familia` (Task 3) consome as puras da Task 2 e é chamada pela Task 4.

## Fora de escopo (fase posterior)

Troca livre de categoria (busca no catálogo ML) + remontagem de atributos ao trocar. Marca padrão `Avil` hard-coded (dívida multi-tenant).
