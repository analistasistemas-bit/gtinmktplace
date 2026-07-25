-- Migration: lockdown_escrita_profiles
-- ADR-0090. Fecha a escalada de privilégio do achado F3 (CLAUDE-SECURITY-20260724-125213).
--
-- RLS no Postgres é ROW-level, não COLUMN-level: a policy "profiles: admin update org"
-- (20260705165828_e7_rls_org.sql:59) valida apenas is_admin() e org_id, então satisfazer o
-- predicado autoriza escrever QUALQUER coluna daquela linha — inclusive is_super_admin.
-- Como nenhum grant de coluna jamais foi revogado em public.profiles, um admin de org podia
-- chamar o PostgREST direto (PATCH /rest/v1/profiles?id=eq.<self> {"is_super_admin":true}),
-- driblar a edge function `usuarios` e virar super-admin da plataforma — de onde se lê, cria
-- e DELETA qualquer tenant (delete_org chama auth.admin.deleteUser em todos os membros).
--
-- Correção: nenhuma escrita em profiles vinda de cliente. Toda mutação de perfil já passa
-- pela edge function `usuarios`, que usa service_role (não afetado por grants de authenticated)
-- e é onde as regras reais de autorização vivem. O frontend só faz SELECT em profiles
-- (src/pages/Usuarios.tsx:84, src/stores/auth-store.ts:77) — nada quebra.
--
-- As policies de escrita seguem existindo e viram inócuas: sem privilégio de tabela elas nunca
-- são alcançadas. Mantidas de propósito, para não complicar um eventual rollback.

revoke update on public.profiles from authenticated, anon;

-- INSERT/DELETE fecham a MESMA escalada por outro verbo: as policies "profiles: admin insert org"
-- e "profiles: admin delete org" também não restringem is_super_admin, então um admin de org
-- poderia apagar a própria linha e reinseri-la com is_super_admin = true. Nenhum caminho de
-- cliente usa esses verbos — perfil nasce pelo trigger handle_new_user (security definer) e
-- morre pelo delete_org/remove da edge `usuarios`, ambos service_role.
revoke insert, delete on public.profiles from authenticated, anon;
