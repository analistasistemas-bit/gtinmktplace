-- Corrige os privilégios de `ajustar_estoque`, que a migration 20260811201026 não conseguiu
-- aplicar. O `db push` avisou e seguiu:
--   WARNING (01006): no privileges could be revoked for "ajustar_estoque"
--   WARNING (01007): no privileges were granted for "ajustar_estoque"
--
-- CAUSA: naquela migration o `revoke`/`grant` vinha DEPOIS do `alter function … owner to
-- estoque_rpc_executor`. Sem ser dono, o executor não é grantor válido para privilégios cujo
-- grantor é o dono, e os dois comandos viraram no-op — com aviso, não com erro.
--
-- EFEITO: a função ficou com o default do Postgres (EXECUTE para PUBLIC) mais `anon` e
-- `authenticated`. Como ela é `security definer`, roda como o dono e recebe `p_org` por
-- PARÂMETRO, qualquer usuário autenticado poderia chamá-la via PostgREST e zerar o estoque de
-- QUALQUER organização. As irmãs (`baixar_estoque`, `estornar_estoque`, `registrar_entrada`)
-- têm só `estoque_rpc_executor` e `service_role`; esta migration devolve a paridade.
--
-- LIÇÃO para a próxima RPC de estoque: os grants vêm ANTES da troca de dono, ou rodam com
-- `set role estoque_rpc_executor`, como aqui.
--
-- HISTÓRICO DESTE ARQUIVO: aplicado em produção em 2026-08-11 e registrado com
-- `supabase migration repair --status applied 20260811203500`. A primeira versão usava
-- `begin;`/`commit;` explícitos com `set local role`; o `begin` fechava a transação do próprio
-- CLI no meio do arquivo, e o `INSERT` do CLI em `supabase_migrations.schema_migrations` morria
-- com "permission denied". Esta versão usa `SET ROLE` de sessão — válido dentro e fora de
-- transação —, então roda pelo caminho normal do `db push`. Todos os comandos são idempotentes,
-- então o arquivo é seguro para replay; contra a produção atual ele não será reexecutado
-- (já consta como aplicado), e essa reexecução não pôde ser verificada aqui.

grant estoque_rpc_executor to postgres;   -- pré-requisito do SET ROLE abaixo

-- Executa como o PRÓPRIO dono: só ele é grantor válido dos privilégios da função.
-- SET ROLE (sem LOCAL) de propósito: o `supabase db push` não envolve a migration em
-- transação, e `SET LOCAL` fora de transação é ignorado com aviso.
set role estoque_rpc_executor;

revoke execute on function public.ajustar_estoque(uuid, text, integer, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ajustar_estoque(uuid, text, integer, text, uuid, text)
  to service_role;

reset role;

-- Devolveria o guard de 2026-08-04 (`postgres` não deve permanecer membro de
-- `estoque_rpc_executor`), mas a membership acima costuma ser gravada com
-- `grantor = supabase_admin`, e aí só ele consegue revogá-la — `no possible grantors`.
-- Tolerante de propósito: o aviso fica no log do deploy em vez de derrubar a migration cuja
-- parte essencial (a ACL) já rodou. Pendência registrada em docs/TASKS.md.
do $$
begin
  revoke estoque_rpc_executor from postgres;
exception when others then
  raise warning 'membership de postgres em estoque_rpc_executor nao revogada: %', sqlerrm;
end $$;
