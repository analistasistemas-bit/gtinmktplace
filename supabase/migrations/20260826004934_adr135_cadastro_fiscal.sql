-- ADR-0135 — Cadastro fiscal e emissão via Faturador do ML.
-- Re-run-safe: db push não é transacional.

-- 1) tipo_pessoa na org. Default 'pf' é o default SEGURO (PF não emite).
alter table public.organizations
  add column if not exists tipo_pessoa text not null default 'pf';
alter table public.organizations drop constraint if exists organizations_tipo_pessoa_check;
alter table public.organizations add constraint organizations_tipo_pessoa_check
  check (tipo_pessoa in ('pf','pj'));
-- PF jamais liga o módulo fiscal — trava no BANCO, não só na UI (ADR-0135 D-2).
alter table public.organizations drop constraint if exists organizations_fiscal_exige_pj;
alter table public.organizations add constraint organizations_fiscal_exige_pj
  check (not ('fiscal' = any(modulos_habilitados)) or tipo_pessoa = 'pj');

-- 2) empresa_fiscal: 1 por org. Tudo nullable — a obrigatoriedade é do gate de
--    ativação do módulo (edge `usuarios`), não do INSERT (spec §2.2).
create table if not exists public.empresa_fiscal (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  cnpj text,
  razao_social text,
  nome_fantasia text,
  inscricao_estadual text,
  regime_tributario text check (regime_tributario is null or regime_tributario in ('simples','normal')),
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  municipio text,
  municipio_ibge text check (municipio_ibge is null or municipio_ibge ~ '^[0-9]{7}$'),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  natureza_operacao text,
  cfop_dentro_uf text,
  cfop_fora_uf_nao_contribuinte text,
  cfop_fora_uf_contribuinte text,
  cst_pis text,
  cst_cofins text,
  origin_type text check (origin_type is null or origin_type in ('manufacturer','reseller','imported')),
  emissao_a_partir_de date,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.empresa_fiscal enable row level security;
-- Template B (CRUD pelo app): leitura por qualquer membro; escrita só admin da org
-- (mesma variante de `configuracoes` em 20260705165828_e7_rls_org.sql:41-46).
drop policy if exists "empresa_fiscal: select org" on public.empresa_fiscal;
create policy "empresa_fiscal: select org" on public.empresa_fiscal
  for select to authenticated using (org_id = (select public.current_org_id()));
drop policy if exists "empresa_fiscal: insert admin org" on public.empresa_fiscal;
create policy "empresa_fiscal: insert admin org" on public.empresa_fiscal
  for insert to authenticated
  with check (org_id = (select public.current_org_id()) and public.is_admin());
drop policy if exists "empresa_fiscal: update admin org" on public.empresa_fiscal;
create policy "empresa_fiscal: update admin org" on public.empresa_fiscal
  for update to authenticated
  using (org_id = (select public.current_org_id()) and public.is_admin())
  with check (org_id = (select public.current_org_id()) and public.is_admin());
grant select, insert, update on public.empresa_fiscal to authenticated;

-- 3) fiscal por família (ADR-0135 D-4). Nullable: quem obriga é o gate de
--    publicação (D-7), nunca um DEFAULT. `origem` (binário do imposto) NÃO é tocada.
alter table public.familias
  add column if not exists ncm text check (ncm is null or ncm ~ '^[0-9]{8}$'),
  add column if not exists cest text check (cest is null or cest ~ '^[0-9]{7}$'),
  add column if not exists origem_nfe smallint check (origem_nfe is null or origem_nfe between 0 and 8),
  add column if not exists fci text,
  add column if not exists ex_tipi text,
  add column if not exists tributacao_icms text,
  add column if not exists tributacao_icms_regime text
    check (tributacao_icms_regime is null or tributacao_icms_regime in ('simples','normal')),
  add column if not exists can_invoice boolean,
  add column if not exists can_invoice_causa text,
  add column if not exists can_invoice_em timestamptz,
  add column if not exists fiscal_sincronizado_em timestamptz;
