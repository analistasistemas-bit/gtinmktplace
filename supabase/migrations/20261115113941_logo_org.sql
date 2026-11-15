-- Logo da organização na topbar (spec 2026-11-15-logo-org-topbar-design.md).
-- Duas versões opcionais: para fundo claro e para fundo escuro. Escrita das colunas pela
-- policy existente "organizations: update admin".
alter table public.organizations
  add column logo_claro_url text,
  add column logo_escuro_url text;

-- Bucket público: logo não é sensível e a topbar não pode depender de URL assinada que expira.
-- Sem SVG (SVG público pode carregar script). Precedente de bucket via migration: 20260527123422.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-logos', 'org-logos', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Layout: {org_id}/{claro|escuro}-{timestamp}.{ext}. Escrita só pelo admin da própria org.
-- O select existe porque o remove() do Storage precisa enxergar o objeto; a leitura pública
-- da imagem usa a URL pública e não passa por RLS.
create policy org_logos_select on storage.objects for select to authenticated
  using (bucket_id = 'org-logos' and (storage.foldername(name))[1] = public.current_org_id()::text);
create policy org_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'org-logos' and (storage.foldername(name))[1] = public.current_org_id()::text and public.is_admin());
create policy org_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'org-logos' and (storage.foldername(name))[1] = public.current_org_id()::text and public.is_admin())
  with check (bucket_id = 'org-logos' and (storage.foldername(name))[1] = public.current_org_id()::text and public.is_admin());
create policy org_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'org-logos' and (storage.foldername(name))[1] = public.current_org_id()::text and public.is_admin());
