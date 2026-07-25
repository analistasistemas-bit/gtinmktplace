# ADR-0090: Lockdown da escrita em `profiles` — privilégio não se auto-concede

**Status:** Aceito
**Data:** 2026-07-25
**Decisores:** Diego
**Refina:** ADR-0027 (multi-tenancy), ADR-0086 (config org-scoped)

## Contexto

Uma varredura de segurança multi-agente (relatório `CLAUDE-SECURITY-20260724-125213`,
achado F3, confirmado por 3 verificadores independentes) encontrou uma escalada de
privilégio que atravessa todo o isolamento multi-tenant.

A edge function `usuarios` trata `profiles.is_super_admin` como a única fonte de
autorização para `list_orgs`, `create_org`, `set_canais_org` e `delete_org` — e faz isso
corretamente: ela nunca escreve essa coluna, e todas as suas mutações passam por
`adminClient()` (service_role).

O problema não está na function, está na tabela. `profiles` é exposta pelo PostgREST, e a
policy de UPDATE criada na migration `20260705165828_e7_rls_org.sql:59-62` é:

```sql
create policy "profiles: admin update org" on public.profiles
  for update to authenticated
  using (public.is_admin() and org_id = (select public.current_org_id()))
  with check (public.is_admin() and org_id = (select public.current_org_id()));
```

RLS no Postgres é **row-level, não column-level**: satisfazer o predicado da linha
autoriza escrever *qualquer coluna* daquela linha no mesmo UPDATE. E nenhuma migration do
projeto jamais revogou privilégio de coluna em `profiles` (verificado por
`git grep -nE "revoke|grant " -- supabase/migrations`: só há revokes de `execute` em
funções).

Consequência: qualquer usuário que já tenha `is_admin = true` em qualquer org pode chamar
o PostgREST direto — sem passar pela edge function — e se promover:

```
PATCH {SUPABASE_URL}/rest/v1/profiles?id=eq.<próprio-uuid>
apikey: <anon key pública>      Authorization: Bearer <JWT próprio>
{"is_super_admin": true}
```

O predicado passa trivialmente (`is_admin()` já é true, `org_id` não muda) e
`is_super_admin` sequer é avaliado. Com a flag forjada, o atacante lê todas as orgs, cria
orgs, reescreve os canais habilitados de um concorrente e — via `delete_org` — apaga os
dados de outro tenant e remove todos os usuários dele com `auth.admin.deleteUser`.

Um segundo buraco da mesma raiz: a policy também deixa um admin de org editar a linha do
super-admin (`is_admin`, `is_active`, `allowed_menus`, `telegram_chat_id`), driblando as
guardas "apenas super-admin altera super-admin" que existem dentro de `usuarios/index.ts`.

## Decisão

1. **`revoke update on public.profiles from authenticated, anon`.** Toda escrita em
   `profiles` passa a ser exclusividade do `service_role`, ou seja, da edge function
   `usuarios`, que é onde as regras de autorização de verdade já estão escritas.
2. Descartada a alternativa de um **trigger `BEFORE UPDATE`** protegendo só
   `is_super_admin` e `org_id`. Motivos: (a) exigiria detectar o papel em execução, e uma
   checagem estrita por `service_role` quebraria migrations e seeds, que rodam como
   `postgres` sem claims de JWT; (b) protegeria duas colunas e deixaria aberto o segundo
   buraco (admin editando a linha do super-admin); (c) é mais código para menos cobertura.
3. A policy `"profiles: admin update org"` permanece no schema, agora inócua — sem o
   privilégio de tabela, ela nunca é alcançada. Não é removida para manter o histórico de
   migrations linear e evitar um `drop policy` que dificultaria um eventual rollback.
4. **Nada no frontend precisa mudar.** Verificado: os únicos acessos a `profiles` no
   cliente são leitura (`src/pages/Usuarios.tsx:84` e `src/stores/auth-store.ts:77`, ambos
   `.select(...)`). Toda mutação de perfil já vai pela edge function.

## Consequências

**Positivas**
- A promoção a super-admin deixa de ser alcançável por qualquer credencial de cliente.
- O modelo fica coerente com o resto do projeto: privilégio se concede por RPC/edge com
  service_role, nunca por escrita direta de tabela (mesmo padrão de
  `proximo_numero_lote`, `upsert_marketplace_connection`, `get_ml_tokens`).
- Uma futura tela de auto-serviço de perfil ("editar meu nome") não fica bloqueada por
  acidente silencioso: ela falha alto, e a saída correta é uma RPC `security definer` com
  allow-list de colunas.

**Negativas / limites**
- Qualquer escrita futura em `profiles` obriga a passar por edge function ou RPC. É
  fricção deliberada.
- Esta migration **não** conserta uma promoção que já tenha acontecido. Antes de aplicar,
  conferir se existe super-admin inesperado:
  `select id, email, org_id, is_super_admin from public.profiles where is_super_admin;`
  O esperado hoje é apenas a conta do Diego (semeada em
  `20260705163656_e7_organizations.sql:37`).
- `db push` é decisão humana e não faz parte desta entrega (ADR-0043: DDL só por
  `supabase migration new` + `supabase db push` operado pelo Diego).
