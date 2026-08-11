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
-- `set local role estoque_rpc_executor` dentro de uma transação, como aqui.

-- BEGIN/COMMIT explícitos: o `supabase db push` NÃO envolve a migration em transação, e sem
-- isso o `set local role` falha com "SET LOCAL can only be used in transaction blocks" — foi
-- exatamente assim que a primeira tentativa desta correção não pegou.
begin;

grant estoque_rpc_executor to postgres;   -- pré-requisito do SET ROLE abaixo

-- Executa como o PRÓPRIO dono: só ele é grantor válido dos privilégios da função.
set local role estoque_rpc_executor;

revoke execute on function public.ajustar_estoque(uuid, text, integer, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ajustar_estoque(uuid, text, integer, text, uuid, text)
  to service_role;

reset role;

commit;

-- Devolve o guard de 2026-08-04: `postgres` não deve permanecer membro de
-- `estoque_rpc_executor`, senão quem tiver essa credencial pode `set role` e escrever saldo
-- direto, contornando o trigger. Tolerante de propósito: a membership pode ter sido gravada
-- com `grantor = supabase_admin`, e aí só ele consegue revogá-la — nesse caso o aviso fica no
-- log do deploy em vez de derrubar uma migration cuja parte essencial (a ACL) já commitou.
do $$
begin
  revoke estoque_rpc_executor from postgres;
exception when others then
  raise warning 'membership de postgres em estoque_rpc_executor nao revogada: %', sqlerrm;
end $$;
