-- ============================================================================
-- Migration: e7_config_org
-- Refs: ADR-0027 (D-E7.7 MP por org; numeração de lote por org). Fase 6 do E7.
-- ============================================================================

-- ---- MP (Mercado Pago) por organização (D-E7.7) --------------------------
-- Segredo do MP por org no Vault. Enquanto a org não tiver secret configurado,
-- o enriquecimento cai no MP_ACCESS_TOKEN de instância (fallback) — zero regressão
-- para a Avil (único tenant com MP hoje). Seed do secret da Avil = passo manual
-- futuro (criar vault secret com o valor de MP_ACCESS_TOKEN e apontar aqui):
--   select vault.create_secret('<MP_ACCESS_TOKEN>', 'mp_access_avil');
--   update public.configuracoes set mp_access_token_secret_id = '<id>' where org_id = (select id from public.organizations where slug='avil');
alter table public.configuracoes add column if not exists mp_access_token_secret_id uuid;

create or replace function public.get_mp_token(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_secret_id uuid;
begin
  select mp_access_token_secret_id into v_secret_id
    from public.configuracoes where org_id = p_org_id;
  if v_secret_id is null then
    return null;  -- caller cai no fallback de instância
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where id = v_secret_id);
end;
$$;
revoke execute on function public.get_mp_token(uuid) from public, anon, authenticated;

-- ---- Numeração de lote por organização (Task 14) -------------------------
alter table public.lotes add column if not exists numero_org integer;
update public.lotes l set numero_org = sub.rn
from (select id, row_number() over (partition by org_id order by criado_em) rn from public.lotes) sub
where sub.id = l.id and l.numero_org is null;
create unique index if not exists lotes_org_numero_uniq on public.lotes (org_id, numero_org);

-- Próximo número: UPDATE com row-lock na org (concorrência-safe).
create or replace function public.proximo_numero_lote(p_org uuid)
returns integer language sql security definer set search_path = ''
as $$
  update public.organizations set lote_seq = lote_seq + 1, atualizado_em = now()
  where id = p_org returning lote_seq
$$;
revoke execute on function public.proximo_numero_lote(uuid) from public, anon, authenticated;

-- Seed do contador de cada org = maior numero_org atual.
update public.organizations o
  set lote_seq = coalesce((select max(numero_org) from public.lotes where org_id = o.id), 0);
