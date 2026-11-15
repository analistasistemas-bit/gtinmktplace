-- Logo da organização na topbar (spec 2026-11-15-logo-org-topbar-design.md).
-- Duas versões opcionais: para fundo claro e para fundo escuro. Escrita das colunas pela
-- policy existente "organizations: update admin".
alter table public.organizations
  add column logo_claro_url text,
  add column logo_escuro_url text;

-- Só URL pública do próprio bucket, na pasta da própria org: impede apontar a logo para um
-- servidor externo (rastrear IP de quem abre o app).
alter table public.organizations
  add constraint organizations_logo_claro_url_bucket check (
    logo_claro_url is null
    or logo_claro_url ~ ('^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/org-logos/' || id::text || '/[a-z]+-[0-9]+\.(png|jpg|webp)$')
  ),
  add constraint organizations_logo_escuro_url_bucket check (
    logo_escuro_url is null
    or logo_escuro_url ~ ('^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/org-logos/' || id::text || '/[a-z]+-[0-9]+\.(png|jpg|webp)$')
  );

-- Bucket público: logo não é sensível e a topbar não pode depender de URL assinada que expira.
-- Sem SVG (SVG público pode carregar script). Precedente de bucket via migration: 20260527123422.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-logos', 'org-logos', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Layout: {org_id}/{claro|escuro}-{timestamp}.{ext}. Escrita só pelo admin da própria org e fora
-- de sessão de suporte somente leitura (can_write_current_org, mesmo padrão do bucket imagens).
-- O select existe porque o remove() do Storage precisa enxergar o objeto; a leitura pública
-- da imagem usa a URL pública e não passa por RLS.
create policy org_logos_select on storage.objects for select to authenticated
  using (bucket_id = 'org-logos' and (storage.foldername(name))[1] = (select public.current_org_id())::text);
create policy org_logos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'org-logos' and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public.is_admin()) and (select public.can_write_current_org())
  );
create policy org_logos_update on storage.objects for update to authenticated
  using (
    bucket_id = 'org-logos' and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public.is_admin()) and (select public.can_write_current_org())
  )
  with check (
    bucket_id = 'org-logos' and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public.is_admin()) and (select public.can_write_current_org())
  );
create policy org_logos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'org-logos' and (storage.foldername(name))[1] = (select public.current_org_id())::text
    and (select public.is_admin()) and (select public.can_write_current_org())
  );
