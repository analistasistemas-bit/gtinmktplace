# Usuários + permissão de menu (operação compartilhada) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um admin cadastre novos usuários por convite de e-mail e escolha quais menus cada um acessa, dentro de uma operação cujos dados são compartilhados entre todos os membros.

**Architecture:** Fase intermediária pré-E7 (ADR-0047). A RLS deixa de isolar por `user_id` e passa a liberar a "membro autenticado" via helper `is_membro_operacao()`. Um espelho `public.profiles` guarda `is_admin`/`is_active`/`allowed_menus`. Cadastro é feito por uma edge function admin-only que usa `service_role` + `inviteUserByEmail`. O frontend filtra o sidebar e bloqueia rotas pela `allowed_menus`; trava de menu é de navegação (UI+rota), não de backend.

**Tech Stack:** Supabase (Postgres RLS, Auth admin API, Edge Function Deno), React 18 + TS + Vite, Zustand, TanStack Query, shadcn/ui, vitest.

**Pré-leitura obrigatória:** [ADR-0047](../../decisions/0047-operacao-compartilhada-rbac-menu.md), [ADR-0027](../../decisions/0027-multi-tenancy-organizations.md), [ADR-0043](../../decisions/0043-fluxo-canonico-de-migrations.md) (migrations só via `supabase migration new` + `db push`), [glossário](../../reference/glossario.md) seção "Acesso e usuários".

**Convenções do projeto:**
- Migrations: `supabase migration new <nome>` → editar → `npm run db:check` → `supabase db push`. **Nunca** `apply_migration`/painel (ADR-0043).
- Edge functions: deploy via CLI completa com `SUPABASE_ACCESS_TOKEN` do `.env.local`; conferir versão pós-deploy (regra "deploy nunca defasado").
- RLS: sempre `(select auth.uid())`, nunca `auth.uid()` solto (evita N+1).
- Worktree já tem `.env.local` copiado.

**Chaves de menu canônicas:** `dashboard`, `lotes`, `revisao`, `publicados`, `faturamento`, `financeiro`, `viabilidade`, `configuracoes`. `usuarios` é menu extra **só de admin**, não atribuível.

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `supabase/migrations/<ts>_profiles_e_helpers.sql` | tabela `profiles`, helpers `is_admin`/`is_membro_operacao`, trigger `handle_new_user`, backfill | criar |
| `supabase/migrations/<ts>_rls_operacao_compartilhada.sql` | swap das policies das 12 tabelas + storage `imagens` | criar |
| `supabase/functions/usuarios/index.ts` | endpoints admin: invite/update_menus/set_active/set_admin | criar |
| `supabase/config.toml` | registrar `[functions.usuarios]` | modificar |
| `src/lib/menus.ts` | fonte única: `MENU_KEYS`, `visibleMenus(profile)`, `menuKeyForPath(path)` | criar |
| `src/lib/menus.test.ts` | testes do helper puro | criar |
| `src/stores/auth-store.ts` | carregar `profile` após sessão | modificar |
| `src/hooks/useProfile.ts` | expor `{ profile, isAdmin, loading }` | criar |
| `src/components/sidebar.tsx` | filtrar `NAV_ITEMS` por `visibleMenus`; item Usuários p/ admin | modificar |
| `src/components/menu-guard.tsx` | bloquear rota fora de `allowed_menus` | criar |
| `src/components/protected-route.tsx` | derrubar sessão de inativo | modificar |
| `src/pages/Usuarios.tsx` | tela admin (lista + convite + editar menus + toggles) | criar |
| `src/pages/SemAcesso.tsx` | tela p/ usuário sem menus | criar |
| `src/pages/DefinirSenha.tsx` | aceite de convite + reset (consome token, define senha) | criar |
| `src/pages/ResetSenha.tsx` | apontar `redirectTo` p/ `/definir-senha` | modificar |
| `src/App.tsx` | rotas `/usuarios`, `/sem-acesso`, `/definir-senha`; envolver com MenuGuard; remover `/cadastro` | modificar |
| `src/pages/Login.tsx` | remover link p/ cadastro público | modificar |
| `docs/reference/edge-functions.md` | documentar função `usuarios` | modificar |
| `docs/reference/modelo-de-dados.md` | documentar `profiles` + RLS compartilhada | modificar |

---

## Task 1: Migration — `profiles`, helpers, trigger, backfill

**Files:**
- Create: `supabase/migrations/<ts>_profiles_e_helpers.sql` (gerar com `supabase migration new profiles_e_helpers`)

- [ ] **Step 1: Gerar a migration vazia**

Run: `supabase migration new profiles_e_helpers`
Expected: cria arquivo `supabase/migrations/<timestamp>_profiles_e_helpers.sql`.

- [ ] **Step 2: Escrever o SQL**

```sql
-- ============================================================================
-- Migration: profiles_e_helpers
-- Refs: ADR-0047 (operação compartilhada + RBAC de menu).
-- ============================================================================

-- Espelho de usuário da operação.
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  nome          text not null default '',
  is_admin      boolean not null default false,
  is_active     boolean not null default true,
  allowed_menus text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Helper: o chamador é admin? (security definer p/ não recursar nas policies de profiles)
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = '' as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Helper: o chamador é membro autenticado da operação?
-- ÚNICO ponto de troca para o E7: aqui vira is_member_of(org_id).
create or replace function public.is_membro_operacao()
returns boolean language sql security definer stable set search_path = '' as $$
  select (select auth.role()) = 'authenticated';
$$;
revoke execute on function public.is_membro_operacao() from public;
grant execute on function public.is_membro_operacao() to authenticated;

-- Policies de profiles.
create policy "profiles: select self or admin" on public.profiles
  for select using (id = (select auth.uid()) or public.is_admin());
create policy "profiles: admin insert" on public.profiles
  for insert with check (public.is_admin());
create policy "profiles: admin update" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());
create policy "profiles: admin delete" on public.profiles
  for delete using (public.is_admin());

-- Trigger: cria o perfil no signup, semeando nome/menus do convite (raw_user_meta_data).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, nome, allowed_menus)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    coalesce(
      array(select jsonb_array_elements_text(new.raw_user_meta_data->'allowed_menus')),
      '{}'::text[]
    )
  )
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: usuários já existentes (só o Diego hoje) viram admin com todos os menus.
insert into public.profiles (id, email, nome, is_admin, is_active, allowed_menus)
select u.id, u.email, '', true, true,
  array['dashboard','lotes','revisao','publicados','faturamento','financeiro','viabilidade','configuracoes']
from auth.users u
on conflict (id) do nothing;
```

- [ ] **Step 3: Validar e aplicar**

Antes: `select count(*) from auth.users;` — confirmar que só há o Diego (e nenhum usuário de teste que viraria admin no backfill). Se houver, ajustar o backfill p/ filtrar pelo `id` do Diego.

Run: `npm run db:check && supabase db push`
Expected: aplica sem erro. Conferir: `select count(*) from public.profiles where is_admin;` retorna ≥ 1.

- [ ] **Step 4: Verificar advisors de segurança**

Use o MCP Supabase `get_advisors(type=security)`. Esperado: sem novos WARN/ERROR sobre `profiles`/funções. (Funções já têm `search_path=''`.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): profiles + helpers is_admin/is_membro_operacao + trigger e backfill (ADR-0047)"
```

---

## Task 2: Migration — RLS de operação compartilhada

Troca as policies das 12 tabelas de domínio (e do bucket `imagens`) de `user_id = auth.uid()` para `is_membro_operacao()`. `user_id` permanece como `criado_por`.

**Files:**
- Create: `supabase/migrations/<ts>_rls_operacao_compartilhada.sql`

- [ ] **Step 1: Gerar a migration**

Run: `supabase migration new rls_operacao_compartilhada`

- [ ] **Step 2: Escrever o SQL**

```sql
-- ============================================================================
-- Migration: rls_operacao_compartilhada
-- Refs: ADR-0047. Swap user_id -> is_membro_operacao() nas tabelas de domínio.
-- user_id permanece como criado_por (auditoria).
-- ============================================================================

-- Tabelas operáveis (leitura/escrita por qualquer membro).
do $$
declare t text;
begin
  foreach t in array array['lotes','familias','variacoes','anuncios_externos'] loop
    execute format('drop policy if exists "%s: select own" on public.%I', t, t);
    execute format('drop policy if exists "%s: insert own" on public.%I', t, t);
    execute format('drop policy if exists "%s: update own" on public.%I', t, t);
    execute format('drop policy if exists "%s: delete own" on public.%I', t, t);
    execute format('create policy "%s: select membro" on public.%I for select using (public.is_membro_operacao())', t, t);
    execute format('create policy "%s: insert membro" on public.%I for insert with check (public.is_membro_operacao())', t, t);
    execute format('create policy "%s: update membro" on public.%I for update using (public.is_membro_operacao()) with check (public.is_membro_operacao())', t, t);
    execute format('create policy "%s: delete membro" on public.%I for delete using (public.is_membro_operacao())', t, t);
  end loop;
end $$;

-- Tabelas só-leitura no app (populadas por service_role/webhooks): apenas SELECT.
do $$
declare t text;
begin
  foreach t in array array['ml_credentials','ml_vendas','ml_vendas_itens','ml_perguntas','ml_devolucoes','ml_moderacao','ml_webhook_eventos'] loop
    execute format('drop policy if exists "%s: select own" on public.%I', t, t);
    execute format('create policy "%s: select membro" on public.%I for select using (public.is_membro_operacao())', t, t);
  end loop;
end $$;

-- configuracoes: leitura compartilhada (operação), escrita só admin.
drop policy if exists "configuracoes_select_own" on public.configuracoes;
drop policy if exists "configuracoes_insert_own" on public.configuracoes;
drop policy if exists "configuracoes_update_own" on public.configuracoes;
create policy "configuracoes: select membro" on public.configuracoes
  for select using (public.is_membro_operacao());
create policy "configuracoes: insert admin" on public.configuracoes
  for insert with check (public.is_admin());
create policy "configuracoes: update admin" on public.configuracoes
  for update using (public.is_admin()) with check (public.is_admin());

-- Storage: bucket de imagens vira leitura por qualquer membro (upload segue na pasta do uid).
drop policy if exists "imagens: select own" on storage.objects;
create policy "imagens: select membro" on storage.objects
  for select using (bucket_id = 'imagens' and (select auth.role()) = 'authenticated');
```

- [ ] **Step 3: Validar e aplicar**

Run: `npm run db:check && supabase db push`

- [ ] **Step 4: Teste de compartilhamento (manual, 2 sessões)**

Crie um 2º usuário de teste (via Task 3 ou painel temporário), logue com ele e confirme que **vê os lotes do Diego**. Alternativa SQL rápida (impersonando outro uid):

```sql
-- substitua <OUTRO_UID> por um auth.users.id que NÃO é dono de lotes
set local role authenticated;
set local request.jwt.claims = '{"sub":"<OUTRO_UID>","role":"authenticated"}';
select count(*) from public.lotes;  -- esperado: > 0 (vê os do Diego)
reset role;
```
Expected: contagem > 0 (antes da migration seria 0).

- [ ] **Step 5: Advisors + commit**

`get_advisors(type=security)` — atenção a "RLS enabled, policy permissive" esperado. Sem ERROR.

```bash
git add supabase/migrations/
git commit -m "feat(db): RLS de operação compartilhada via is_membro_operacao (ADR-0047)"
```

---

## Task 3: Edge function `usuarios` (admin-only)

Convida e administra usuários. Verifica que o chamador é admin antes de qualquer ação.

**Files:**
- Create: `supabase/functions/usuarios/index.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Escrever a função**

```typescript
import { requireUser } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

const MENU_KEYS = ['dashboard','lotes','revisao','publicados','faturamento','financeiro','viabilidade','configuracoes'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await requireUser(req);
    const db = adminClient();

    // Só admin opera aqui.
    const { data: me } = await db.from('profiles').select('is_admin').eq('id', caller.id).single();
    if (!me?.is_admin) return json({ error: 'forbidden' }, 403);

    const body = await req.json();
    const action = body.action as string;
    const sanitizeMenus = (m: unknown) =>
      Array.isArray(m) ? m.filter((x) => MENU_KEYS.includes(x)) : [];

    switch (action) {
      case 'invite': {
        const email = String(body.email ?? '').trim().toLowerCase();
        if (!email) return json({ error: 'email obrigatório' }, 400);
        const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
          data: { nome: String(body.nome ?? ''), allowed_menus: sanitizeMenus(body.allowed_menus) },
          redirectTo: `${Deno.env.get('APP_URL')}/#/definir-senha`, // página da Task 9
        });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, id: data.user?.id });
      }
      case 'update_menus': {
        const { error } = await db.from('profiles')
          .update({ allowed_menus: sanitizeMenus(body.allowed_menus), nome: body.nome ?? undefined, updated_at: new Date().toISOString() })
          .eq('id', body.id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      case 'set_active': {
        if (body.id === caller.id && !body.is_active) return json({ error: 'não pode se desativar' }, 400);
        const { error } = await db.from('profiles')
          .update({ is_active: !!body.is_active, updated_at: new Date().toISOString() })
          .eq('id', body.id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      case 'set_admin': {
        if (body.id === caller.id && !body.is_admin) return json({ error: 'não pode se rebaixar' }, 400);
        const { error } = await db.from('profiles')
          .update({ is_admin: !!body.is_admin, updated_at: new Date().toISOString() })
          .eq('id', body.id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      default:
        return json({ error: 'ação inválida' }, 400);
    }
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: String(e) }, 500);
  }
});
```

> Confira a forma exata de `corsHeaders` em `supabase/functions/_shared/cors.ts` e de `adminClient`/`requireUser` (já lidos) antes de copiar. O link do convite é consumido pela página da Task 9 (`/definir-senha`).

- [ ] **Step 2: Registrar no config.toml**

Adicionar (verify_jwt = true; o chamador é um admin logado):

```toml
[functions.usuarios]
verify_jwt = true
```

- [ ] **Step 3: Deploy via CLI e conferir versão**

```bash
export $(grep SUPABASE_ACCESS_TOKEN .env.local)
supabase functions deploy usuarios
```
Conferir no painel/MCP que a função subiu (`list_edge_functions`).

- [ ] **Step 4: Smoke test**

Logado como Diego (admin), chamar `usuarios` com `{ action: 'invite', email: 'teste+1@seudominio.com', nome: 'Teste', allowed_menus: ['dashboard','lotes'] }`. Esperado: `200 { ok: true }` e e-mail de convite recebido; após aceitar, `profiles` tem a linha com `allowed_menus = {dashboard,lotes}`.

- [ ] **Step 5: Docs + commit**

Atualizar `docs/reference/edge-functions.md` (nova função `usuarios`, verify_jwt=true, admin-only).

```bash
git add supabase/functions/usuarios/ supabase/config.toml docs/reference/edge-functions.md
git commit -m "feat(edge): função usuarios (invite/update/set_active/set_admin) admin-only (ADR-0047)"
```

---

## Task 4: Helper de menus + testes (núcleo testável)

**Files:**
- Create: `src/lib/menus.ts`, `src/lib/menus.test.ts`

- [ ] **Step 1: Escrever o teste primeiro** (@superpowers:test-driven-development)

```typescript
import { describe, it, expect } from 'vitest';
import { visibleMenus, menuKeyForPath, MENU_KEYS } from './menus';

const base = { is_admin: false, is_active: true, allowed_menus: [] as string[] };

describe('menus', () => {
  it('admin vê todos os menus + usuarios', () => {
    expect(visibleMenus({ ...base, is_admin: true })).toEqual([...MENU_KEYS, 'usuarios']);
  });
  it('não-admin vê só os menus permitidos, sem usuarios', () => {
    expect(visibleMenus({ ...base, allowed_menus: ['dashboard', 'lotes'] })).toEqual(['dashboard', 'lotes']);
  });
  it('mapeia subrotas pra chave de menu', () => {
    expect(menuKeyForPath('/')).toBe('dashboard');
    expect(menuKeyForPath('/revisao/123')).toBe('revisao');
    expect(menuKeyForPath('/financeiro/detalhe')).toBe('financeiro');
    expect(menuKeyForPath('/usuarios')).toBe('usuarios');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/lib/menus.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar `src/lib/menus.ts`**

```typescript
export const MENU_KEYS = ['dashboard','lotes','revisao','publicados','faturamento','financeiro','viabilidade','configuracoes'] as const;
export type MenuKey = (typeof MENU_KEYS)[number] | 'usuarios';

export interface MenuProfile { is_admin: boolean; is_active: boolean; allowed_menus: string[]; }

export function visibleMenus(p: MenuProfile): MenuKey[] {
  if (p.is_admin) return [...MENU_KEYS, 'usuarios'];
  return MENU_KEYS.filter((k) => p.allowed_menus.includes(k));
}

// Primeiro segmento da rota → chave de menu. '/' = dashboard.
const PREFIX: Record<string, MenuKey> = {
  '': 'dashboard', lotes: 'lotes', 'novo-lote': 'lotes', progresso: 'lotes',
  revisao: 'revisao', relatorio: 'revisao',
  publicados: 'publicados', faturamento: 'faturamento', financeiro: 'financeiro',
  viabilidade: 'viabilidade', configuracoes: 'configuracoes', usuarios: 'usuarios',
};

export function menuKeyForPath(pathname: string): MenuKey | null {
  const seg = pathname.replace(/^\//, '').split('/')[0];
  return PREFIX[seg] ?? null;
}

// Chave de menu → rota de destino (p/ redirecionar ao primeiro menu permitido).
export function pathForMenu(key: MenuKey): string {
  return key === 'dashboard' ? '/' : `/${key}`;
}
```

E adicionar ao teste (Step 1): `expect(pathForMenu('dashboard')).toBe('/'); expect(pathForMenu('financeiro')).toBe('/financeiro');`

- [ ] **Step 4: Rodar e ver passar** — `pnpm test src/lib/menus.test.ts` → PASS. (Conferir exit code 0; ver `reference_ci_setup_gotchas` sobre `.env.test`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/menus.ts src/lib/menus.test.ts
git commit -m "feat(menus): helper visibleMenus/menuKeyForPath + testes"
```

---

## Task 5: Carregar profile no auth-store + `useProfile`

**Files:**
- Modify: `src/stores/auth-store.ts`
- Create: `src/hooks/useProfile.ts`

- [ ] **Step 1: Estender o store** — adicionar `profile` + flag de carregamento **separada** da sessão (evita race: `loading` da sessão vira `false` antes do profile chegar).

```typescript
// dentro de AuthState:
profile: { id: string; is_admin: boolean; is_active: boolean; allowed_menus: string[]; nome: string } | null;
profileLoading: boolean; // true até a 1ª resolução do profile
loadProfile: () => Promise<void>;
```
- `hydrate`: após setar a sessão, se houver `user`, `set({ profileLoading: true })` e chamar `loadProfile`; se não houver user, `set({ profile: null, profileLoading: false })`.
- `onAuthStateChange`: idem — recarregar profile no SIGNED_IN, limpar no SIGNED_OUT.
- `loadProfile`: `supabase.from('profiles').select('id,is_admin,is_active,allowed_menus,nome').eq('id', user.id).single()` → `set({ profile: data ?? null, profileLoading: false })`.

- [ ] **Step 2: Criar `useProfile`**

```typescript
import { useAuthStore } from '@/stores/auth-store';
export function useProfile() {
  const profile = useAuthStore((s) => s.profile);
  const profileLoading = useAuthStore((s) => s.profileLoading);
  return { profile, isAdmin: !!profile?.is_admin, profileLoading };
}
```

- [ ] **Step 3: Verificar** — `pnpm build` compila; logar e conferir no React DevTools/console que `profile` carrega.

- [ ] **Step 4: Commit** — `feat(auth): carregar profile (is_admin/allowed_menus) no store`.

---

## Task 6: Sidebar filtra por menu + item Usuários

**Files:**
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 1:** Adicionar `key` a cada item de `NAV_ITEMS` (igual às chaves canônicas) e um item extra `{ to: '/usuarios', label: 'Usuários', icon: Users, key: 'usuarios' }`.
- [ ] **Step 2:** Em `SidebarNav`, obter `profile` (`useProfile`), calcular `const allowed = new Set(visibleMenus(profile ?? {is_admin:false,is_active:true,allowed_menus:[]}))` e renderizar só os itens cujo `key ∈ allowed`.
- [ ] **Step 3: Verificar** — logado como admin: vê os 8 + Usuários. Simular não-admin (perfil com `allowed_menus` parcial): vê só os permitidos.
- [ ] **Step 4: Commit** — `feat(nav): sidebar filtra itens por allowed_menus + item Usuários (admin)`.

---

## Task 7: Guard de rota + bloqueio de inativo + tela sem-acesso

**Files:**
- Create: `src/components/menu-guard.tsx`, `src/pages/SemAcesso.tsx`
- Modify: `src/components/protected-route.tsx`, `src/App.tsx`

- [ ] **Step 1:** `MenuGuard` (Outlet wrapper): lê `{ profile, profileLoading }` + `useLocation`.
  - Se `profileLoading` → spinner (não decidir gate sem profile resolvido — evita redirect indevido em hard-reload).
  - `const menus = visibleMenus(profile ?? { is_admin:false, is_active:true, allowed_menus:[] })`.
  - `key = menuKeyForPath(pathname)`; se `key === null` (ex.: `/style-guide`, página dev) → libera (Outlet).
  - Se `key && !menus.includes(key)`: se `menus.length` → `Navigate` pra `pathForMenu(menus[0])` (1º na ordem canônica de `MENU_KEYS`); senão `Navigate` pra `/sem-acesso`.
  - Admin sempre passa (`visibleMenus` já devolve tudo).
- [ ] **Step 2:** `ProtectedRoute`: enquanto `profileLoading` → manter o "Carregando…". Se `profile && profile.is_active === false` → `supabase.auth.signOut()` e `Navigate` pra `/login` com mensagem "conta desativada".
- [ ] **Step 3:** `SemAcesso.tsx`: tela simples "Você ainda não tem acesso a nenhum menu. Fale com o administrador." + botão sair.
- [ ] **Step 4:** `App.tsx`: dentro do `AppShell`, envolver as rotas de menu com `<MenuGuard>`; adicionar `<Route path="/usuarios" element={<Usuarios />} />` e `<Route path="/sem-acesso" element={<SemAcesso />} />` (sem-acesso fora do MenuGuard).
- [ ] **Step 5: Verificar** — logado sem o menu `financeiro`, digitar `/financeiro` redireciona; usuário sem menus cai em `/sem-acesso`; usuário inativo é deslogado.
- [ ] **Step 6: Commit** — `feat(nav): MenuGuard de rota + bloqueio de inativo + tela sem-acesso`.

---

## Task 8: Tela `/usuarios` (admin)

**Files:**
- Create: `src/pages/Usuarios.tsx`

- [ ] **Step 1:** Lista — `useQuery` em `supabase.from('profiles').select('id,email,nome,is_admin,is_active,allowed_menus').order('created_at')` (admin enxerga todos via RLS). Tabela shadcn com colunas: nome/email, menus (badges), admin, ativo, ações.
- [ ] **Step 2:** Dialog "Convidar" — campos e-mail, nome, checklist dos 8 `MENU_KEYS`; submit → `supabase.functions.invoke('usuarios', { body: { action:'invite', ... } })`; on success invalida a query e toast.
- [ ] **Step 3:** Editar menus — dialog reaproveitando o checklist → `action:'update_menus'`. Toggles "ativo"/"admin" → `set_active`/`set_admin`. Feedback inline ("Salvando…/✓ Salvo") conforme `feedback_inline_visual_feedback`.
- [ ] **Step 4:** Guardas de UX — desabilitar toggle de admin/desativar no próprio usuário logado.
- [ ] **Step 5: Verificar** — convidar → linha aparece; editar menus → `allowed_menus` muda; desativar → usuário não loga mais.
- [ ] **Step 6: Commit** — `feat(usuarios): tela admin de gestão de usuários e menus`.

---

## Task 9: Página de aceite de convite / definir senha (BLOQUEANTE — também conserta o reset)

**Por que existe:** `inviteUserByEmail` manda um link com token, mas `src/lib/supabase.ts` tem `detectSessionInUrl: false` e **não há nenhuma página que consuma o token e defina senha** (o `/reset-senha` atual só *pede* o e-mail). Sem esta task, o convidado clica no e-mail e não consegue logar — e a Task 10 ainda remove o `/cadastro`. Esta página serve **convite** (`type=invite`) e **recuperação** (`type=recovery`).

**Files:**
- Create: `src/pages/DefinirSenha.tsx`
- Modify: `src/App.tsx` (rota pública `/definir-senha`), `src/pages/ResetSenha.tsx` (apontar `redirectTo`)
- Config: templates de e-mail do Supabase Auth (Invite + Recovery)

- [ ] **Step 1:** Criar `DefinirSenha.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export default function DefinirSenha() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [senha, setSenha] = useState('');

  useEffect(() => {
    const token_hash = params.get('token_hash');
    const type = (params.get('type') ?? 'invite') as 'invite' | 'recovery';
    if (!token_hash) { setErro('Link inválido ou expirado.'); return; }
    supabase.auth.verifyOtp({ token_hash, type }).then(({ error }) => {
      if (error) setErro('Link inválido ou expirado.'); else setReady(true);
    });
  }, [params]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) { setErro(error.message); return; }
    navigate('/', { replace: true });
  }
  // ...render: erro -> mensagem + link p/ /login; !ready -> "Validando…"; ready -> form de senha
}
```

- [ ] **Step 2:** `App.tsx` — adicionar rota **pública** `<Route path="/definir-senha" element={<DefinirSenha />} />` (fora do ProtectedRoute), lazy.

- [ ] **Step 3:** `ResetSenha.tsx` — garantir que `resetPasswordForEmail(email, { redirectTo })` aponte para a URL de `/#/definir-senha` (HashRouter), reusando esta mesma página.

- [ ] **Step 4: Config dos templates de e-mail (Supabase Auth)** — ajustar **Invite user** e **Reset password** para o link:
  `{{ .SiteURL }}/#/definir-senha?token_hash={{ .TokenHash }}&type=invite` (e `type=recovery` no template de reset). Via CLI (`supabase/config.toml` → `[auth.email.template.*]`) preferencialmente, ou painel. **Pode exigir ação do Diego** se não estiver no IaC. Conferir `Site URL`/`Redirect URLs` incluindo a origem do app.

- [ ] **Step 5: Verificar** — convidar um e-mail de teste → abrir o link → cair em `/definir-senha` → definir senha → entrar logado e ver só os menus marcados. Repetir o fluxo de "Esqueci a senha".

- [ ] **Step 6: Commit** — `feat(auth): página definir-senha (aceite de convite + reset)`.

---

## Task 10: Remover `/cadastro` público

**Files:**
- Modify: `src/App.tsx`, `src/pages/Login.tsx`

- [ ] **Step 1:** Remover do `App.tsx` a rota `/cadastro` e o `lazy(() => import('@/pages/Cadastro'))`. (Manter `src/pages/Cadastro.tsx` no repo ou apagá-lo se virar órfão — confirmar nenhum outro import; se órfão, remover junto.)
- [ ] **Step 2:** Em `Login.tsx`, remover o link/CTA "Criar conta".
- [ ] **Step 3: Verificar** — acessar `#/cadastro` cai em NotFound; Login não oferece auto-cadastro; `pnpm build` sem import quebrado.
- [ ] **Step 4: Commit** — `feat(auth): remover /cadastro público (operação compartilhada, ADR-0047)`.

---

## Task 11: Portão de qualidade + docs + validação real

- [ ] **Step 1: Docs** — atualizar `docs/reference/modelo-de-dados.md` (tabela `profiles`, helpers, RLS compartilhada) e `docs/project-status.md` (fase pré-E7 entregue). Conferir o mapa código→doc do CLAUDE.md.
- [ ] **Step 2: Tipos** — regenerar tipos do Supabase (`generate_typescript_types`) p/ incluir `profiles`.
- [ ] **Step 3: Portão ultraqa** (@oh-my-claudecode:ultraqa equivalente): `pnpm lint && pnpm test && pnpm build` até verde. Conferir exit codes (ver `reference_ci_setup_gotchas`).
- [ ] **Step 4: Validação real (browser-use)** — subir o app (`pnpm dev`), logar como Diego, abrir `/usuarios`, convidar um usuário de teste, aceitar o convite noutra sessão, confirmar: (a) vê só os menus marcados, (b) vê os lotes da operação, (c) rota proibida redireciona. Comparar a tela 1:1 (`feedback_validar_ui_contra_tela`, `/oh-my-claudecode:visual-verdict`).
- [ ] **Step 5: PARAR para validação do Diego.** Não fazer merge/push/deploy sem comando dele (`feedback_workflow_entrega_solo`). Entregar a URL clicável do dev.

---

## Riscos / pontos de atenção

- **Credenciais ML por `user_id` (ADR-0047):** um **membro** que disparar publicação/sync não acha a conexão ML (Vault é do dono). Até o E7, manter os menus que disparam ML (Revisão/publicar) na prática restritos ao admin-dono, ou tratar "resolver conexão da operação" como follow-up. **Não** é resolvido por este plano.
- **Trava de menu é navegação, não segurança de dados.** Com RLS aberta a autenticado, um usuário técnico com sessão pode chamar a API de um menu que não vê. Aceitável p/ time interno; não abrir a operação a terceiros sem o E7.
- **Convite depende de SMTP/Auth e-mail** e da página de aceite (Task 9, `/definir-senha`). Se o e-mail não chegar, conferir template de convite no Supabase Auth; se o link não logar, conferir o `token_hash` no template (Task 9 Step 4).
- **`is_active` é checado no app**, não no gateway — um token já emitido vale até expirar. Para corte imediato, usar `auth.admin` para banir (follow-up se necessário).
- **Último admin:** não há proteção contra rebaixar/desativar o outro admin e ficar sem nenhum (só há guarda contra auto-rebaixar/auto-desativar). Para time pequeno, aceitável; adicionar checagem "≥1 admin ativo" se virar problema.
- **Templates de e-mail (Task 9 Step 4)** podem exigir ação manual do Diego no painel Auth se não estiverem versionados no `config.toml`.
