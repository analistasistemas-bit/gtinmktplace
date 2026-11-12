-- ADR-0203 item 11: o CHECK de notificacoes.categoria aceita 'imagem_ia' e continua recusando valor inválido.
-- Rodar: python3 scripts/teste-sql-desfeito.py supabase/tests/galeria_aviso_imagens_prontas.sql supabase/migrations/20261111235456_galeria_aviso_imagens_prontas.sql
begin;
do $$
declare p record;
begin
  select id, org_id into p from public.profiles where org_id is not null limit 1;
  if p.id is null then raise exception 'sem profile para o teste'; end if;
  insert into public.notificacoes (user_id, org_id, categoria, texto, chave)
    values (p.id, p.org_id, 'imagem_ia', 'teste ADR-0203', 'galeria_pronta:teste-adr0203');
  begin
    insert into public.notificacoes (user_id, org_id, categoria, texto)
      values (p.id, p.org_id, 'imagem_invalida', 'teste ADR-0203');
    raise exception 'categoria inválida foi aceita';
  exception when check_violation then null;
  end;
end $$;
rollback;
