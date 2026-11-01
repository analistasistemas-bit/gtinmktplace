-- Emenda ADR-0067 (01/11): conversa em reclamação (mediations) aberta sai de "aguardando".
-- Dados reais da Daludi Shop em 01/11: 3 conversas sem resposta, 1 delas (pack 2000015675716893,
-- reclamação 5603283790) em reclamação aberta → 2. Rodar com scripts/teste-sql-desfeito.py.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"321f8ec0-9a8a-4ec1-b234-ea3b2205cacc","role":"authenticated"}';
do $$
declare n int; r record;
begin
  n := public.contar_conversas_aguardando();
  if n <> 2 then raise exception 'contar_conversas_aguardando: esperado 2, veio %', n; end if;
  select * into r from public.resumo_mensagens_posvenda();
  if r.sem_responder <> 2 then raise exception 'sem_responder: esperado 2, veio %', r.sem_responder; end if;
  if r.respondidas <> 7 then raise exception 'respondidas mudou: %', r.respondidas; end if;
end $$;
reset role;
rollback;
