-- ADR-0181 (revisão da Task 1): a filha herda a org do pai por FK composta. Sem isso o org_id
-- denormalizado pode mentir e a RLS de select acredita nele (mesmo risco de
-- 20260906140450_kits_virtuais_schema.sql:133).

alter table public.notas_compra add constraint notas_compra_id_org_key unique (id, org_id);
alter table public.notas_compra_itens add constraint notas_compra_itens_id_org_key unique (id, org_id);

alter table public.notas_compra_itens drop constraint notas_compra_itens_nota_id_fkey;
alter table public.notas_compra_itens add constraint notas_compra_itens_nota_org_fkey
  foreign key (nota_id, org_id) references public.notas_compra (id, org_id) on delete cascade;

alter table public.notas_compra_distribuicao drop constraint notas_compra_distribuicao_item_id_fkey;
alter table public.notas_compra_distribuicao add constraint notas_compra_distribuicao_item_org_fkey
  foreign key (item_id, org_id) references public.notas_compra_itens (id, org_id) on delete cascade;

-- Policies com (select current_org_id()): avaliada uma vez por consulta, não por linha.
drop policy notas_compra_select on public.notas_compra;
create policy notas_compra_select on public.notas_compra for select to authenticated
  using (org_id = (select public.current_org_id()));
drop policy notas_compra_itens_select on public.notas_compra_itens;
create policy notas_compra_itens_select on public.notas_compra_itens for select to authenticated
  using (org_id = (select public.current_org_id()));
drop policy notas_compra_distribuicao_select on public.notas_compra_distribuicao;
create policy notas_compra_distribuicao_select on public.notas_compra_distribuicao for select to authenticated
  using (org_id = (select public.current_org_id()));
drop policy vinculos_fornecedor_select on public.vinculos_fornecedor;
create policy vinculos_fornecedor_select on public.vinculos_fornecedor for select to authenticated
  using (org_id = (select public.current_org_id()));
drop policy notas_compra_xml_select on storage.objects;
create policy notas_compra_xml_select on storage.objects for select to authenticated
  using (bucket_id = 'notas-compra' and (storage.foldername(name))[1] = (select public.current_org_id())::text);
