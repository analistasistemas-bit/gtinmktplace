-- ============================================================================
-- Migration: rls_initplan_fix
-- Refs: Plano 03 Task 2 code quality review.
-- Fix: wrap auth.uid() with (select auth.uid()) so RLS evaluates as initplan
--      instead of per-row. Same template for all future migrations.
-- ============================================================================

drop policy if exists "lotes: select own" on public.lotes;
drop policy if exists "lotes: insert own" on public.lotes;
drop policy if exists "lotes: update own" on public.lotes;
drop policy if exists "lotes: delete own" on public.lotes;

create policy "lotes: select own" on public.lotes for select using ((select auth.uid()) = user_id);
create policy "lotes: insert own" on public.lotes for insert with check ((select auth.uid()) = user_id);
create policy "lotes: update own" on public.lotes for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "lotes: delete own" on public.lotes for delete using ((select auth.uid()) = user_id);

drop policy if exists "imagens: select own" on storage.objects;
drop policy if exists "imagens: insert own" on storage.objects;
drop policy if exists "imagens: update own" on storage.objects;
drop policy if exists "imagens: delete own" on storage.objects;

create policy "imagens: select own"
  on storage.objects for select
  using (bucket_id = 'imagens' and (select auth.uid())::text = (storage.foldername(name))[1]);

create policy "imagens: insert own"
  on storage.objects for insert
  with check (bucket_id = 'imagens' and (select auth.uid())::text = (storage.foldername(name))[1]);

create policy "imagens: update own"
  on storage.objects for update
  using (bucket_id = 'imagens' and (select auth.uid())::text = (storage.foldername(name))[1]);

create policy "imagens: delete own"
  on storage.objects for delete
  using (bucket_id = 'imagens' and (select auth.uid())::text = (storage.foldername(name))[1]);
