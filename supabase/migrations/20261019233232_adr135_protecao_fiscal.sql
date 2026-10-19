-- ADR-0135 emenda (auditoria fiscal A6/A7, 19/10/2026): prontidão e dados fiscais só pelo backend.

-- A7: sessão de suporte somente leitura (is_admin() verdadeiro, escopo != 'full') escrevia em
-- empresa_fiscal — as policies não pediam can_write_current_org(), como as de familias pedem.
alter policy "empresa_fiscal: insert admin org" on public.empresa_fiscal
  with check (org_id = (select public.current_org_id()) and public.is_admin()
              and (select public.can_write_current_org()));
alter policy "empresa_fiscal: update admin org" on public.empresa_fiscal
  using (org_id = (select public.current_org_id()) and public.is_admin()
         and (select public.can_write_current_org()))
  with check (org_id = (select public.current_org_id()) and public.is_admin()
              and (select public.can_write_current_org()));

-- A6: a policy de UPDATE de familias deixa o membro gravar qualquer coluna pelo PostgREST —
-- inclusive can_invoice=true (semáforo "OK" fabricado) e NCM/CSOSN sem validação nem push. Essas
-- colunas só mudam por edge (service_role) ou RPC security definer; o front não grava nenhuma
-- delas nem faz INSERT direto em familias (origem tem DEFAULT, então todo INSERT já traz coluna
-- protegida — INSERT fica reservado ao backend).
create or replace function public.familias_proteger_fiscal()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'familias: INSERT direto não permitido — use o fluxo do app (ADR-0135)'
      using errcode = '42501';
  end if;
  if (new.can_invoice, new.can_invoice_causa, new.can_invoice_em, new.fiscal_sincronizado_em,
      new.ncm, new.cest, new.origem_nfe, new.fci, new.ex_tipi, new.tributacao_icms,
      new.tributacao_icms_regime, new.descricao_fiscal, new.unidade, new.origem)
     is distinct from
     (old.can_invoice, old.can_invoice_causa, old.can_invoice_em, old.fiscal_sincronizado_em,
      old.ncm, old.cest, old.origem_nfe, old.fci, old.ex_tipi, old.tributacao_icms,
      old.tributacao_icms_regime, old.descricao_fiscal, old.unidade, old.origem) then
    raise exception 'familias: dados fiscais e prontidão só mudam pelo botão Fiscal (ADR-0135)'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.familias_proteger_fiscal() from public, anon, authenticated;

create trigger familias_proteger_fiscal
  before insert or update on public.familias
  for each row execute function public.familias_proteger_fiscal();
