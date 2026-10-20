-- Emenda ADR-0067 — mensagens pós-venda escopadas por org. Rodar:
--   python3 scripts/teste-sql-desfeito.py supabase/tests/mensagens_escopo_org.sql \
--     supabase/migrations/<ts>_mensagens_escopo_org.sql
-- Sem a migration tem que falhar (Samuel, membro da Avil sem a conexão ML, vê 0 conversas).
\set ON_ERROR_STOP on
begin;
create temp table t_msg (quem text, linhas int, aguardando int, fora_da_org int);
grant all on t_msg to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '5b415a5a-daa6-45c8-9597-5360259668a5';   -- Diego (dono da conexão, Avil)
insert into t_msg select 'diego', count(*), public.contar_conversas_aguardando(),
  count(*) filter (where org_id <> 'a72ea303-5559-4a35-9aff-daa12cd1de12') from public.ml_mensagens;

set local request.jwt.claim.sub = '32737973-0797-4cdf-93e0-9adb753e6d4f';   -- Samuel (membro, Avil)
insert into t_msg select 'samuel', count(*), public.contar_conversas_aguardando(),
  count(*) filter (where org_id <> 'a72ea303-5559-4a35-9aff-daa12cd1de12') from public.ml_mensagens;
reset role;

do $$
declare d t_msg; s t_msg; total int;
begin
  select * into d from t_msg where quem = 'diego';
  select * into s from t_msg where quem = 'samuel';
  select count(*) into total from public.ml_mensagens where org_id = 'a72ea303-5559-4a35-9aff-daa12cd1de12';
  if total = 0 then raise exception 'Avil sem mensagens — teste não prova nada'; end if;
  if d.linhas <> total or s.linhas <> total then
    raise exception 'linhas visíveis: diego=% samuel=% (esperado % para os dois)', d.linhas, s.linhas, total;
  end if;
  if d.fora_da_org <> 0 or s.fora_da_org <> 0 then raise exception 'vazou mensagem de outra org'; end if;
  if s.aguardando <> d.aguardando then
    raise exception 'badge: diego=% samuel=%', d.aguardando, s.aguardando;
  end if;
end $$;
rollback;
