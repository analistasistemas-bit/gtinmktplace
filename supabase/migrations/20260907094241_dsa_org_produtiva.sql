-- A DSA (slug 'diego-souza') foi marcada como org de teste em 20260725224000_support_access.sql,
-- quando servia só de sandbox do acesso de suporte. Hoje é uma organização cliente como qualquer
-- outra: opera vendas reais e precisa aparecer na carteira e nos totais comerciais da central
-- (ADR-0155), que por padrão filtra `is_test`. A coluna continua existindo para sandboxes futuros.
update public.organizations set is_test = false where slug = 'diego-souza' and is_test;

-- Trava LOUD: a flag decide se a org é faturada. Se sobrar `is_test`, o push falha em vez de
-- deixar a DSA fora da cobrança em silêncio. Ambiente sem a org (local/CI) passa sem exigir seed.
do $$
begin
  if exists (select 1 from public.organizations where slug = 'diego-souza' and is_test) then
    raise exception 'DSA (diego-souza) continua marcada como organizacao de teste';
  end if;
end $$;
