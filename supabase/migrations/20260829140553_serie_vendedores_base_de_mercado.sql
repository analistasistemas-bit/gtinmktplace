-- ADR-0144 — A série de vendedores é base de mercado, lida por RPC sem org_id.
--
-- transactions_total vem de /users/{id} de TERCEIRO na API do ML: é o mesmo número da página
-- pública do vendedor, não dado da organização que o coletou. O que é privado é o fato de que a
-- org X monitora o vendedor Y — e é isso que esta função protege.
--
-- pulse_vendedores continua org-scoped, com a RLS intacta. Nenhuma policy é tocada aqui.

create or replace function public.mercado_serie_vendedores(p_seller_ids bigint[])
returns table (seller_id bigint, dia date, transactions_total bigint)
language sql
stable
security definer
-- SECURITY DEFINER sem search_path fixo é sequestrável por schema do chamador.
set search_path = public, pg_temp
as $$
  -- D-4: duas orgs coletando o mesmo vendedor no mesmo dia gravam duas linhas. A série precisa de
  -- um ponto por dia, senão estimarVendasMensais compara o primeiro snapshot de uma org com o
  -- último de outra. O total é monotônico dentro do dia, então max() é o mais recente.
  select v.seller_id, v.dia, max(v.transactions_total) as transactions_total
  from public.pulse_vendedores v
  where v.seller_id = any (p_seller_ids)
    and v.transactions_total is not null
  group by v.seller_id, v.dia
  order by v.seller_id, v.dia;
$$;

comment on function public.mercado_serie_vendedores(bigint[]) is
  'ADR-0144: série pública de transactions_total por vendedor, agregada entre organizações e sem '
  'org_id na saída. Responde apenas sobre seller_ids que o chamador já descobriu por conta própria '
  '(ponte do catálogo, ADR-0143) — não permite enumerar a base. Só service_role executa.';

-- D-3: o navegador nunca alcança esta função. A edge chama com adminClient (service_role).
-- Os revokes vêm ANTES do grant: a ordem inversa deixaria a função exposta a authenticated.
revoke all on function public.mercado_serie_vendedores(bigint[]) from public;
revoke all on function public.mercado_serie_vendedores(bigint[]) from anon;
revoke all on function public.mercado_serie_vendedores(bigint[]) from authenticated;
grant execute on function public.mercado_serie_vendedores(bigint[]) to service_role;

-- A ponte do catálogo pede a série de dezenas de vendedores por consulta do Sonar.
create index if not exists pulse_vendedores_seller_dia_idx
  on public.pulse_vendedores (seller_id, dia);
