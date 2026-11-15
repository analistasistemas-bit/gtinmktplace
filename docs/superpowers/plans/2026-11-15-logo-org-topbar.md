# Logo da organização na topbar — plano

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps em `- [ ]`.

**Goal:** mostrar a logo da org (versão clara/escura) na topbar (desktop) e no sheet (mobile), com upload em Configurações → Geral.
**Architecture:** 2 colunas em `organizations` + bucket público `org-logos`; funções puras em `src/lib/org-logo.ts`; hook `useOrgIdentidade`; componente `OrgIdentidade`.
**Tech Stack:** Supabase (migration, storage), React + TanStack Query + Tailwind, vitest + Testing Library.
**Spec:** `docs/superpowers/specs/2026-11-15-logo-org-topbar-design.md`

## Global Constraints
- Logo: `max-h-7 max-w-[140px] object-contain object-left`; `alt` = nome da org.
- Bucket `org-logos` público, 512 KB, `image/png`, `image/jpeg`, `image/webp`. Sem SVG.
- Escrita no bucket: `(storage.foldername(name))[1] = public.current_org_id()::text and public.is_admin()`.
- Edição na UI só com `podeEditarEmpresa`. Org lida via `useOrgEfetivaId`.
- Migrations só via `supabase migration new` + `supabase db push`; `npm run db:check`.

## Review Focus
1. Só uma versão cadastrada → usa ela nos dois temas.
2. URL da logo quebrada (arquivo apagado) → `onError` cai para iniciais + nome.
3. Nome com uma palavra ou vazio → iniciais `"A"` / `"?"`, sem quebrar.
4. Arquivo > 512 KB ou SVG → recusado antes do upload, com mensagem.
5. Membro não-admin → vê a logo, controles de upload desabilitados.

---

### Task 1: Migration + tipos
**Files:** Create `supabase/migrations/<ts>_logo_org.sql`; Modify `src/lib/database.types.ts` (organizations Row/Insert/Update).
- [ ] `supabase migration new logo_org`; SQL: `alter table organizations add column logo_claro_url text, add column logo_escuro_url text`; insert bucket com `file_size_limit 524288`, `allowed_mime_types`; policies `org_logos_insert/update/delete` (Global Constraints). Sem policy de select (bucket público).
- [ ] `npm run db:check` → OK. Teste SQL em transação desfeita (memória: teste SQL sem Docker) após o push, na Task 5.
- [ ] Commit.

### Task 2: Lógica + componente
**Files:** Create `src/lib/org-logo.ts`, `src/hooks/useOrgIdentidade.ts`, `src/components/org-identidade.tsx`; Test `src/lib/__tests__/org-logo.test.ts`, `src/components/__tests__/org-identidade.test.tsx`; Modify `src/lib/queries.ts` (`orgIdentidade: (orgId) => ['org-identidade', orgId]`).
**Produces:**
- `escolherLogo(tema: 'light'|'dark', claro: string|null, escuro: string|null): string|null`
- `iniciais(nome: string|null|undefined): string` — até 2 letras maiúsculas; vazio → `'?'`
- `ehSimbolo(largura: number, altura: number): boolean` — `largura < 1.5 * altura`
- `validarArquivoLogo(f: File): string|null` — mensagem de erro ou null
- `useOrgIdentidade(): UseQueryResult<{ nome: string; logo_claro_url: string|null; logo_escuro_url: string|null } | null>`
- `<OrgIdentidade className? />`
- [ ] Testes: `escolherLogo('dark', 'c', null) === 'c'`; `('dark','c','e') === 'e'`; `('light',null,null) === null`; `iniciais('Avil Moda') === 'AM'`, `iniciais('Avil') === 'A'`, `iniciais('') === '?'`; `ehSimbolo(100,100)` true, `ehSimbolo(300,80)` false; `validarArquivoLogo` recusa svg e 600 KB, aceita png 100 KB.
- [ ] Componente: sem logo → iniciais + nome; com logo → `img alt=nome`; `onError` → fallback; nome aparece quando `onLoad` indica símbolo.
- [ ] `pnpm test -- org-logo org-identidade` → PASS. Commit.

### Task 3: Topbar + sheet
**Files:** Modify `src/components/topbar.tsx` (bloco esquerdo: `<OrgIdentidade className="hidden lg:flex" />`), `src/components/app-shell.tsx` (faixa abaixo do SheetHeader com `<OrgIdentidade />`, `border-b px-4 py-2`).
- [ ] Teste em `src/components/__tests__/app-shell.test.tsx` ou novo `topbar.test.tsx`: nome da org renderizado na topbar.
- [ ] PASS. Commit.

### Task 4: Upload em Configurações → Geral
**Files:** Modify `src/components/configuracoes/secao-geral.tsx`; Create `src/hooks/useSalvarLogoOrg.ts`; Test `src/components/configuracoes/__tests__/secao-geral.test.tsx`.
**Produces:** `useSalvarLogoOrg()` → mutation `{ variante: 'claro'|'escuro'; arquivo: File|null }` (null = remover). Upload em `{orgId}/{variante}-{Date.now()}.{ext}`, `getPublicUrl`, `update organizations set logo_<variante>_url`, remove arquivo anterior (best-effort), invalida `QK.orgIdentidade`.
- [ ] Grupo "Identidade" com 2 `SettingsRow` ("Logo para fundo claro", "Logo para fundo escuro"): preview, botão Enviar (input file `accept="image/png,image/jpeg,image/webp"`), Remover; `disabled={!podeEditarEmpresa}`.
- [ ] Testes: não-admin → botões desabilitados; arquivo SVG → mensagem de erro, sem upload.
- [ ] PASS. Commit.

### Task 5: Validação, deploy, docs
- [ ] `pnpm lint`, `pnpm build`, `pnpm test` (suíte).
- [ ] Revisão independente (crítica): subagente Opus high com diff + spec.
- [ ] `supabase db push`; teste SQL das policies; docs (`docs/TASKS.md`, modelo de dados).
- [ ] Push, CI verde, merge ff, cleanup.
