# Excluir Lotes + Tela "Publicados" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir excluir lotes de teste (preservando famílias publicadas) e oferecer uma tela "Publicados" com status ao vivo do ML e filtros.

**Architecture:** Funções puras (TDD) isolam a lógica de partição/parsing/filtro; edge functions (Deno) com JWT do operador centralizam as operações que tocam Storage + várias tabelas + ML; frontend React/TanStack Query consome via hooks. Sem migration nova.

**Tech Stack:** Vite+React+TS, shadcn/ui, TanStack Query, Supabase Edge Functions (Deno), ML API, vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-excluir-lotes-e-publicados-design.md`
**Branch:** `feat/excluir-lote-e-publicados`
**Projeto Supabase ref:** `txvncrgkoynoxwopfkbp`

---

## Convenções deste plano

- Testes: `npx vitest run <caminho>`; suite toda: `npx vitest run`.
- Verificação por tarefa: `npx tsc --noEmit` e `npx eslint <arquivos>` quando tocar `src/`.
- **Deploy de edge function front-called (com JWT):** `supabase functions deploy <fn> --project-ref txvncrgkoynoxwopfkbp` **(sem `--no-verify-jwt`)**. Conferir versão/`verify_jwt=true` depois. Pré-req: `PATH` inclui `~/.local/bin`; `SUPABASE_ACCESS_TOKEN` no `.env.local` (`set -a && source .env.local && set +a`).
- Padrão de edge front-called: ver `supabase/functions/regenerar-copy-familia/index.ts` (lê `Authorization`, `userClient(jwt).auth.getUser()` → `user.id`).
- Commits frequentes, mensagem referenciando a Feature/ADR-0019.

---

## File Structure

**Backend (Deno):**
- `supabase/functions/_shared/lote/exclusao.ts` — `particionarExclusao` (puro).
- `supabase/functions/_shared/lote/__tests__/exclusao.test.ts` — testes.
- `supabase/functions/excluir-lote/index.ts` — edge: guarda de status, ownership, Storage, delete, recontagem.
- `supabase/functions/remover-publicado/index.ts` — edge: remove 1 família publicada (guarda `publicando` por `codigo_pai`).
- `supabase/functions/_shared/ml/status.ts` — `parseStatusML` (puro).
- `supabase/functions/_shared/ml/__tests__/status.test.ts` — testes.
- `supabase/functions/status-publicados/index.ts` — edge: batch `GET /items?ids=`, fallback sem credencial.

**Frontend:**
- `src/lib/publicados.ts` — tipo `PublicadoItem`, `publicadoFromRow`, `filtrarPublicados` (puro), `StatusPublicado`.
- `tests/lib/publicados.test.ts` — testes de `filtrarPublicados`.
- `src/lib/queries.ts` — `fetchPublicados` (modificar).
- `src/lib/excluir.ts` — `excluirLote`, `removerPublicado` (chamadas às edges).
- `src/hooks/useExcluirLote.ts`, `src/hooks/usePublicados.ts`, `src/hooks/useStatusPublicados.ts`, `src/hooks/useRemoverPublicado.ts`.
- `src/components/lote-card.tsx` — botão lixeira + `AlertDialog` (modificar).
- `src/pages/Publicados.tsx` — tela nova.
- `src/App.tsx` — rota `/publicados` (modificar).
- `src/components/sidebar.tsx` — item no `NAV_ITEMS` (modificar).

**Docs:**
- `docs/decisions/0019-exclusao-lote-preserva-publicados.md` (novo ADR).
- `CLAUDE.md` (tabela de ADRs + histórico), `docs/TASKS.md`.

---

## Feature 1 — Excluir lote

### Task 1: `particionarExclusao` (função pura, TDD)

**Files:**
- Create: `supabase/functions/_shared/lote/exclusao.ts`
- Test: `supabase/functions/_shared/lote/__tests__/exclusao.test.ts`

- [ ] **Step 1: Escrever o teste falhando**

```ts
import { describe, it, expect } from 'vitest';
import { particionarExclusao, type FamiliaExclusao } from '../exclusao';

const fam = (id: string, mlItemId: string | null, vars: (string | null)[], capa: string | null = null, capa2: string | null = null): FamiliaExclusao => ({
  id, ml_item_id: mlItemId,
  capa_storage_path: capa, capa2_storage_path: capa2,
  variacoes: vars.map((p) => ({ imagem_path: p })),
});

describe('particionarExclusao', () => {
  it('separa publicadas (preservadas) das não publicadas (paraExcluir)', () => {
    const r = particionarExclusao({
      familias: [fam('a', null, ['u/1.jpg']), fam('b', 'MLB1', ['u/2.jpg'])],
      planilhaPath: 'u/l/plan.xlsx', imagensPaths: ['u/1.jpg', 'u/2.jpg', 'u/l/plan.xlsx'],
    });
    expect(r.paraExcluir.map((f) => f.id)).toEqual(['a']);
    expect(r.preservadas.map((f) => f.id)).toEqual(['b']);
    expect(r.loteVazio).toBe(false);
  });

  it('pathsRemover NÃO inclui arquivos referenciados por publicadas sobreviventes', () => {
    const r = particionarExclusao({
      familias: [fam('a', null, ['u/1.jpg']), fam('b', 'MLB1', ['u/2.jpg'], 'u/capa-b.jpg')],
      planilhaPath: 'u/l/plan.xlsx', imagensPaths: ['u/1.jpg', 'u/2.jpg', 'u/capa-b.jpg'],
    });
    expect(r.pathsRemover).toContain('u/1.jpg');
    expect(r.pathsRemover).toContain('u/l/plan.xlsx');
    expect(r.pathsRemover).not.toContain('u/2.jpg');     // da publicada
    expect(r.pathsRemover).not.toContain('u/capa-b.jpg'); // capa da publicada
  });

  it('0 publicadas → loteVazio true e remove tudo (planilha + imagens)', () => {
    const r = particionarExclusao({
      familias: [fam('a', null, ['u/1.jpg'])],
      planilhaPath: 'u/l/plan.xlsx', imagensPaths: ['u/1.jpg'],
    });
    expect(r.loteVazio).toBe(true);
    expect(r.pathsRemover).toEqual(expect.arrayContaining(['u/1.jpg', 'u/l/plan.xlsx']));
  });

  it('dedup de paths e ignora nulos', () => {
    const r = particionarExclusao({
      familias: [fam('a', null, ['u/1.jpg', null, 'u/1.jpg'])],
      planilhaPath: null, imagensPaths: ['u/1.jpg'],
    });
    expect(r.pathsRemover.filter((p) => p === 'u/1.jpg')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run supabase/functions/_shared/lote/__tests__/exclusao.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar o mínimo**

```ts
export interface VariacaoExclusao { imagem_path: string | null; }
export interface FamiliaExclusao {
  id: string;
  ml_item_id: string | null;
  capa_storage_path: string | null;
  capa2_storage_path: string | null;
  variacoes: VariacaoExclusao[];
}
export interface EntradaExclusao {
  familias: FamiliaExclusao[];
  planilhaPath: string | null;
  imagensPaths: string[] | null;
}
export interface ResultadoExclusao {
  paraExcluir: FamiliaExclusao[];
  preservadas: FamiliaExclusao[];
  pathsRemover: string[];
  pathsPreservar: string[];
  loteVazio: boolean;
}

function pathsDaFamilia(f: FamiliaExclusao): string[] {
  return [
    f.capa_storage_path, f.capa2_storage_path,
    ...f.variacoes.map((v) => v.imagem_path),
  ].filter((p): p is string => !!p);
}

export function particionarExclusao(e: EntradaExclusao): ResultadoExclusao {
  const preservadas = e.familias.filter((f) => f.ml_item_id != null);
  const paraExcluir = e.familias.filter((f) => f.ml_item_id == null);
  const pathsPreservar = [...new Set(preservadas.flatMap(pathsDaFamilia))];
  const preservarSet = new Set(pathsPreservar);
  const candidatos = [
    ...paraExcluir.flatMap(pathsDaFamilia),
    ...(e.planilhaPath ? [e.planilhaPath] : []),
    ...(e.imagensPaths ?? []),
  ];
  const pathsRemover = [...new Set(candidatos)].filter((p) => !preservarSet.has(p));
  return { paraExcluir, preservadas, pathsRemover, pathsPreservar, loteVazio: preservadas.length === 0 };
}
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS (4 testes).

- [ ] **Step 5: Commit** — `git add supabase/functions/_shared/lote && git commit -m "feat(f1): particionarExclusao puro (TDD) — preserva publicadas no delete"`

---

### Task 2: Edge `excluir-lote`

**Files:**
- Create: `supabase/functions/excluir-lote/index.ts`

- [ ] **Step 1: Implementar** (reusa `_shared/cors.ts`, `_shared/supabase.ts`, `particionarExclusao`):

```ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';
import { particionarExclusao, type FamiliaExclusao } from '../_shared/lote/exclusao.ts';

const BLOQUEADOS = ['processando', 'publicando'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return new Response('Missing auth', { status: 401, headers: corsHeaders });
  const { data: { user } } = await userClient(auth.slice(7)).auth.getUser();
  if (!user) return new Response('Invalid token', { status: 401, headers: corsHeaders });

  const { lote_id } = await req.json().catch(() => ({}));
  if (!lote_id) return new Response('lote_id obrigatório', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const { data: lote } = await admin.from('lotes')
    .select('id, user_id, status, planilha_path, imagens_paths').eq('id', lote_id).maybeSingle();
  if (!lote || lote.user_id !== user.id) return new Response('Lote não encontrado', { status: 404, headers: corsHeaders });
  if (BLOQUEADOS.includes(lote.status)) {
    return new Response(JSON.stringify({ erro: 'Aguarde o processamento/publicação terminar antes de excluir.' }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { data: familias } = await admin.from('familias')
    .select('id, ml_item_id, capa_storage_path, capa2_storage_path, variacoes(imagem_path)')
    .eq('lote_id', lote_id);

  const part = particionarExclusao({
    familias: (familias ?? []) as FamiliaExclusao[],
    planilhaPath: lote.planilha_path, imagensPaths: lote.imagens_paths,
  });

  // Storage: resiliente (falha não aborta)
  if (part.pathsRemover.length > 0) {
    const { error } = await admin.storage.from('imagens').remove(part.pathsRemover);
    if (error) console.warn('excluir-lote storage remove falhou (segue):', error.message);
  }

  // Delete das não publicadas (cascade nas variações)
  const ids = part.paraExcluir.map((f) => f.id);
  if (ids.length > 0) await admin.from('familias').delete().in('id', ids);

  let loteRemovido = false;
  if (part.loteVazio) {
    await admin.from('lotes').delete().eq('id', lote_id);
    loteRemovido = true;
  } else {
    // Trigger update_lote_counters NÃO cobre DELETE → reconta manualmente
    const { data: rest } = await admin.from('familias')
      .select('status, ml_item_id').eq('lote_id', lote_id);
    const total = rest?.length ?? 0;
    // Recontar pela MESMA base do trigger update_lote_counters: status='publicado'
    // (não ml_item_id != null — podem divergir; o trigger usa status).
    const publicadas = rest?.filter((f) => f.status === 'publicado').length ?? 0;
    const erros = rest?.filter((f) => f.status === 'erro').length ?? 0;
    await admin.from('lotes').update({
      total_familias: total, total_publicadas: publicadas, total_erros: erros, status: 'concluido',
    }).eq('id', lote_id);
  }

  return new Response(JSON.stringify({
    familias_removidas: ids.length, imagens_removidas: part.pathsRemover.length,
    familias_preservadas: part.preservadas.length, lote_removido: loteRemovido,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
```

- [ ] **Step 2: Deploy** — `supabase functions deploy excluir-lote --project-ref txvncrgkoynoxwopfkbp` (sem `--no-verify-jwt`). Conferir `verify_jwt=true`.

- [ ] **Step 3: Commit** — `git add supabase/functions/excluir-lote && git commit -m "feat(f1): edge excluir-lote (guarda de status + storage + recontagem)"`

---

### Task 3: Frontend — chamada e hook de exclusão

**Files:**
- Create: `src/lib/excluir.ts`, `src/hooks/useExcluirLote.ts`

- [ ] **Step 1:** `src/lib/excluir.ts` — função que chama a edge com o JWT da sessão (padrão de `updateVariacaoCor` em `queries.ts`):

```ts
import { supabase } from './supabase';

async function chamarEdge<T>(fn: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json as T;
}

export interface ResultadoExcluirLote {
  familias_removidas: number; imagens_removidas: number;
  familias_preservadas: number; lote_removido: boolean;
}
export const excluirLote = (loteId: string) =>
  chamarEdge<ResultadoExcluirLote>('excluir-lote', { lote_id: loteId });

export const removerPublicado = (familiaId: string) =>
  chamarEdge<{ ok: true }>('remover-publicado', { familia_id: familiaId });
```

- [ ] **Step 2:** `src/hooks/useExcluirLote.ts` (TanStack mutation, invalida `QK.lotes`):

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { excluirLote } from '@/lib/excluir';
import { QK } from '@/lib/queries';

export function useExcluirLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (loteId: string) => excluirLote(loteId),
    onSuccess: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) qc.invalidateQueries({ queryKey: QK.lotes(user.id) }); // DRY: reusa a chave canônica
    },
  });
}
```

- [ ] **Step 3:** `npx tsc --noEmit` → 0 erros.

- [ ] **Step 4: Commit** — `git add src/lib/excluir.ts src/hooks/useExcluirLote.ts && git commit -m "feat(f1): lib+hook de exclusão de lote"`

---

### Task 4: `LoteCard` — botão lixeira + confirmação

**Files:**
- Modify: `src/components/lote-card.tsx`
- (usar `AlertDialog` de `src/components/ui/alert-dialog.tsx`; se não existir, `npx shadcn@latest add alert-dialog`)

- [ ] **Step 1:** Adicionar botão `Trash2` no canto do card (o card é um `<Link>` → o botão usa `onClick` com `e.preventDefault(); e.stopPropagation()` pra não navegar). Botão **desabilitado** quando `lote.status` é `processando` ou `publicando` (tooltip "Aguarde terminar"). Ao clicar, abre `AlertDialog` de confirmação com texto do spec ("Serão removidas X famílias não publicadas… Y publicadas serão preservadas… ML não é tocado."). Ao confirmar → `useExcluirLote().mutate(lote.id)`; ao sucesso, toast/inline com o resultado.

- [ ] **Step 2:** `npx tsc --noEmit` + `npx eslint src/components/lote-card.tsx` → limpos.

- [ ] **Step 3: Commit** — `git add src/components/lote-card.tsx src/components/ui && git commit -m "feat(f1): botão excluir no LoteCard com confirmação"`

---

## Feature 2 — Tela "Publicados"

### Task 5: `parseStatusML` (função pura, TDD)

**Files:**
- Create: `supabase/functions/_shared/ml/status.ts`
- Test: `supabase/functions/_shared/ml/__tests__/status.test.ts`

- [ ] **Step 1: Teste falhando**

```ts
import { describe, it, expect } from 'vitest';
import { parseStatusML } from '../status';

describe('parseStatusML', () => {
  it('active → ativo', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'active', available_quantity: 10, price: 12.9 });
    expect(r).toMatchObject({ status: 'ativo', estoque: 10, preco: 12.9, motivo: null });
  });
  it('under_review com sub_status vira moderado + motivo', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'under_review', sub_status: ['waiting_for_patch'], available_quantity: 0, price: 5 });
    expect(r.status).toBe('moderado');
    expect(r.motivo).toContain('waiting_for_patch');
  });
  it('paused → pausado; closed → encerrado; inactive → inativo', () => {
    expect(parseStatusML({ id: 'x', status: 'paused' }).status).toBe('pausado');
    expect(parseStatusML({ id: 'x', status: 'closed' }).status).toBe('encerrado');
    expect(parseStatusML({ id: 'x', status: 'inactive' }).status).toBe('inativo');
  });
  it('null/erro → indisponivel', () => {
    expect(parseStatusML(null).status).toBe('indisponivel');
  });
});
```

- [ ] **Step 2:** rodar → FAIL.

- [ ] **Step 3: Implementar**

```ts
export type StatusPublicado = 'ativo' | 'pausado' | 'encerrado' | 'moderado' | 'inativo' | 'indisponivel';
export interface ItemMLStatus {
  id: string; status?: string; sub_status?: string[];
  available_quantity?: number; price?: number;
}
export interface StatusParsed {
  status: StatusPublicado; motivo: string | null;
  estoque: number | null; preco: number | null;
}
const MAP: Record<string, StatusPublicado> = {
  active: 'ativo', paused: 'pausado', closed: 'encerrado',
  inactive: 'inativo', under_review: 'moderado',
};
export function parseStatusML(item: ItemMLStatus | null): StatusParsed {
  if (!item || !item.status) return { status: 'indisponivel', motivo: null, estoque: null, preco: null };
  const sub = item.sub_status ?? [];
  const moderado = item.status === 'under_review' || sub.includes('waiting_for_patch');
  const status = moderado ? 'moderado' : (MAP[item.status] ?? 'indisponivel');
  return {
    status,
    motivo: moderado && sub.length ? sub.join(', ') : null,
    estoque: item.available_quantity ?? null,
    preco: item.price ?? null,
  };
}
```

- [ ] **Step 4:** rodar → PASS. **Step 5: Commit** — `git commit -m "feat(f2): parseStatusML puro (TDD)"`

---

### Task 6: Edge `status-publicados`

**Files:**
- Create: `supabase/functions/status-publicados/index.ts`

- [ ] **Step 1: Implementar** — valida JWT (getUser); lê `ml_item_id` das famílias do usuário; `getValidAccessToken(user.id)` num try/catch → se falhar, retorna `{ semCredencialML: true, itens: [] }`; batch `GET /items?ids=…&attributes=id,status,sub_status,available_quantity,price` em blocos de 20; mapeia com `parseStatusML`; item ausente na resposta → `indisponivel`. Retorna `{ itens: Array<{ ml_item_id, ...StatusParsed }> }`. Resiliente a erro do ML (retorna itens `indisponivel`).
  - **⚠️ Envelope do multiget:** `GET /items?ids=a,b` retorna `[{ code: 200, body: {…item…} }, …]` (envelopado por id), **não** um array plano de itens. Desempacotar `entry.body` (e tratar `entry.code !== 200` → `indisponivel`) antes de passar ao `parseStatusML`.

- [ ] **Step 2: Deploy** — `supabase functions deploy status-publicados --project-ref txvncrgkoynoxwopfkbp` (com JWT). Conferir `verify_jwt=true`.

- [ ] **Step 3: Commit** — `git commit -m "feat(f2): edge status-publicados (batch /items + fallback sem credencial)"`

---

### Task 7: `PublicadoItem` + `filtrarPublicados` (TDD)

**Files:**
- Create: `src/lib/publicados.ts`, `tests/lib/publicados.test.ts`

- [ ] **Step 1: Teste falhando** para `filtrarPublicados`: cada filtro **isolado** (fornecedor, status, tipo, busca case-insensitive/parcial) **e** ao menos um caso **combinado** (ex.: fornecedor + status juntos) + filtro vazio retorna tudo. Não basta testar filtros isolados.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar** `src/lib/publicados.ts`:

```ts
import type { StatusPublicado } from './tipos-status'; // ou inline o union aqui
import type { TipoAviamento } from './tipos-dominio';

export interface PublicadoItem {
  familiaId: string; codigoPai: string;
  titulo: string; fornecedor: string | null;
  tipo: TipoAviamento | null; precoPublicacao: number;
  mlItemId: string; mlPermalink: string | null; publicadoEm: string | null;
  // preenchidos pelo status ao vivo (merge no hook):
  status?: StatusPublicado; estoque?: number | null; precoAtual?: number | null; motivo?: string | null;
}
export interface FiltroPublicados {
  fornecedor?: string | null; status?: StatusPublicado | null;
  tipo?: TipoAviamento | null; busca?: string;
}
export function filtrarPublicados(itens: PublicadoItem[], f: FiltroPublicados): PublicadoItem[] {
  const q = (f.busca ?? '').trim().toLowerCase();
  return itens.filter((i) =>
    (!f.fornecedor || i.fornecedor === f.fornecedor) &&
    (!f.status || i.status === f.status) &&
    (!f.tipo || i.tipo === f.tipo) &&
    (!q || i.titulo.toLowerCase().includes(q))
  );
}
```
(O union `StatusPublicado` do front pode ser declarado em `src/lib/publicados.ts` e reusado; manter idêntico ao da edge.)

- [ ] **Step 4:** rodar → PASS. **Step 5: Commit** — `git commit -m "feat(f2): PublicadoItem + filtrarPublicados (TDD)"`

---

### Task 8: `fetchPublicados` + hooks

**Files:**
- Modify: `src/lib/queries.ts` (+`fetchPublicados` e `publicadoFromRow`)
- Create: `src/hooks/usePublicados.ts`, `src/hooks/useStatusPublicados.ts`, `src/hooks/useRemoverPublicado.ts`

- [ ] **Step 1:** `fetchPublicados()` — `from('familias').select('id, codigo_pai, titulo_ml, nome_pai, fornecedor, tipo_aviamento, ml_item_id, ml_permalink, publicado_em, variacoes(preco_publicacao, excluida_da_publicacao)').not('ml_item_id','is',null)` → `publicadoFromRow` (preço = menor `preco_publicacao` das variações incluídas).
- [ ] **Step 2:** `usePublicados` (query). `useStatusPublicados` (query separada chamando a edge, `staleTime: 5*60_000`, com `refetch` manual; expõe `semCredencialML`). `useRemoverPublicado` (mutation → `removerPublicado`, invalida `publicados`).
- [ ] **Step 3:** `npx tsc --noEmit` → 0.
- [ ] **Step 4: Commit** — `git commit -m "feat(f2): fetchPublicados + hooks (publicados/status/remover)"`

---

### Task 9: Página `Publicados` + rota + menu

> **⚠️ Ordem:** o botão "Remover do sistema" desta tela depende da edge `remover-publicado` (Task 10). **Implementar a Task 10 ANTES** desta, ou implementar a tabela/filtros aqui e só adicionar o botão Remover depois da Task 10. Não deixar a feature "Remover" quebrada entre commits.

**Files:**
- Create: `src/pages/Publicados.tsx`
- Modify: `src/App.tsx` (rota `/publicados` dentro do `AppShell`), `src/components/sidebar.tsx` (`NAV_ITEMS` += `{ to: '/publicados', label: 'Publicados', icon: Package, end: false }`)

- [ ] **Step 1:** Tela: tabela com as colunas do spec; merge `usePublicados` + `useStatusPublicados` por `mlItemId`; badge de status (cores do spec); banner "Conecte sua conta ML…" quando `semCredencialML`; filtros (fornecedor dropdown a partir dos distintos, status, tipo, busca) via `filtrarPublicados`; botão "Atualizar" (refetch do status); linha de ação "Abrir no ML" (permalink) + "Remover do sistema" (AlertDialog com `codigo_pai` + aviso cross-lote). `publicado_em` null → "—".
- [ ] **Step 2:** rota + item de menu. `npx tsc --noEmit` + `npx eslint src/pages/Publicados.tsx src/components/sidebar.tsx src/App.tsx` → limpos. `pnpm build` → ok.
- [ ] **Step 3: Commit** — `git commit -m "feat(f2): tela Publicados (status ao vivo, filtros, remover)"`

---

### Task 10: Edge `remover-publicado`

**Files:**
- Create: `supabase/functions/remover-publicado/index.ts`

- [ ] **Step 1:** valida JWT/ownership da família; **bloqueia** se houver família com o mesmo `codigo_pai` (do usuário) em `status='publicando'` em qualquer lote (409 com mensagem); remove imagens da família do Storage (resiliente); deleta a família (cascade); reconta contadores do lote de origem (igual Task 2, ou deleta o lote se ficou vazio). Retorna `{ ok: true, lote_removido }`.
- [ ] **Step 2: Deploy** — `supabase functions deploy remover-publicado --project-ref txvncrgkoynoxwopfkbp`. Conferir `verify_jwt=true`.
- [ ] **Step 3: Commit** — `git commit -m "feat(f2): edge remover-publicado (guarda de publicando por codigo_pai)"`

---

## Fechamento

### Task 11: ADR + docs

- [ ] **Step 1:** Criar `docs/decisions/0019-exclusao-lote-preserva-publicados.md` (decisão: exclusão preserva publicadas; ML intocado; contadores recontados na edge porque o trigger não cobre DELETE; tela Publicados como inventário com status ao vivo).
- [ ] **Step 2:** `CLAUDE.md` — linha na tabela de ADRs (0019) + entrada no histórico. `docs/TASKS.md` — marcar as duas features.
- [ ] **Step 3: Commit** — `git commit -m "docs(m4): ADR-0019 + CLAUDE.md/TASKS (excluir lote + Publicados)"`

### Task 12: Verificação final + bug bash

- [ ] **Step 1:** `npx vitest run` (toda a suite verde), `npx tsc --noEmit` (0), `pnpm lint` (0 errors), `pnpm build` (ok).
- [ ] **Step 2: Bug bash com token real** (checklist manual): excluir um lote 100% de teste (some do Dashboard + Storage limpo); excluir um lote misto (publicadas preservadas, contador correto, status `concluido`); tentar excluir lote em `processando` (bloqueado); abrir Publicados (status ao vivo batendo com o ML; um anúncio pausado/moderado aparece certo); filtrar por fornecedor; "Remover do sistema" de um registro morto (com aviso cross-lote) e confirmar que o anúncio segue no ML.
- [ ] **Step 3:** NÃO mergear/push sem OK do Diego (ele roda o review do Codex no branch antes). Resumir resultado do bug bash.

---

## Notas de risco

- **`verify_jwt`**: as 3 edges são front-called → deploy **sem** `--no-verify-jwt`. Se o preflight OPTIONS quebrar com `verify_jwt=true`, seguir o padrão de `regenerar-copy-familia` (deploy `--no-verify-jwt` + validação manual de JWT, que já fazemos com `getUser`).
- **Storage path real**: confirmar no bug bash o prefixo exato dos arquivos do lote (`{user_id}/{lote_id}/…` vs `{user_id}/{codigo}.jpeg`) antes de confiar na limpeza por prefixo; a remoção por lista explícita (`pathsRemover`) é a fonte primária e independe do prefixo.
- **Admin client**: as edges usam service role; a validação de ownership (`user_id`/status) é feita explicitamente antes de qualquer escrita.
- **Lote `importando` com famílias parciais**: `importando` é excluível por decisão do spec (limpar upload falho), mas em tese o `process-familia` ainda pode estar inserindo famílias nesse instante (janela curta). Risco baixo e aceito; se aparecer ruído no bug bash, bloquear também `importando` quando houver família em `processando`/`pendente`.
- **Recontagem vs trigger**: a edge reconta `total_publicadas` por `status='publicado'` (mesma base do trigger `update_lote_counters`), não por `ml_item_id != null`, pra não divergir do que o trigger gravaria nos demais fluxos.
- **Multiget do ML**: resposta envelopada `{ code, body }[]` — desempacotar `body` e tratar `code != 200` como `indisponivel` (ver Task 6).
