# ADR-0047 — Operação compartilhada + controle de acesso por menu (fase pré-E7)

**Data:** 2026-06-28
**Status:** proposto
**Decisores:** Diego
**Relaciona:** antecede e será substituído em parte por ADR-0027 (multi-tenancy por `org_id`, épico E7); refina ADR-0007 (modelo de dados); toca ADR-0012 (credenciais ML)

## Contexto

O app é single-operador: toda tabela de domínio isola por `user_id = auth.uid()` e o
`/cadastro` é público. Diego precisa agora dar acesso a **sócios/funcionários** dentro da
**mesma operação** e controlar **quais menus** cada um vê.

Isso esbarra em duas realidades do código atual:

1. **RLS por `user_id`** — um novo usuário logaria e veria **zero** dados, porque tudo pertence
   ao `user_id` do Diego. "Vários usuários na mesma operação" exige dados compartilhados.
2. **`/cadastro` público** — com dados compartilhados, auto-cadastro vira porta escancarada:
   qualquer um que se cadastrar passa a ver lotes, faturamento e financeiro.

O isolamento real **entre empresas** (multi-tenant SaaS) é o épico E7 (ADR-0027), explicitamente
adiado por YAGNI até haver um cliente externo concreto — que ainda não existe. Construir a
migração big-bang do E7 agora (backfill de `org_id`, swap de todas as RLS, blindagem das edge
functions) seria assumir o maior risco do projeto sem necessidade.

## Decisão

Implementar uma **fase intermediária** de operação compartilhada + RBAC de menu, sem `org_id`:

- **Operação compartilhada.** As policies de SELECT (e, nas tabelas operáveis, INSERT/UPDATE/
  DELETE) das 12 tabelas de domínio passam de `auth.uid() = user_id` para **"membro autenticado"**.
  Coluna `user_id` permanece como `criado_por` (auditoria). Um único ponto de troca: helper
  `public.is_membro_operacao()` (hoje retorna `auth.role() = 'authenticated'`; no E7 vira
  `is_member_of(org_id)`).
- **Perfis.** Tabela `public.profiles` (1:1 com `auth.users`): `is_admin`, `is_active`,
  `allowed_menus text[]`, `email`, `nome`. Trigger `handle_new_user` cria o perfil no signup,
  semeando `allowed_menus`/`nome` a partir do `raw_user_meta_data` do convite. Backfill marca os
  usuários existentes (só Diego) como `is_admin = true` com todos os menus.
- **Provisionamento por admin.** Edge function `usuarios` (verify_jwt = true) valida que o
  chamador é admin (`requireUser` + `is_admin`) e usa `service_role` para
  `inviteUserByEmail(email, { data: { nome, allowed_menus } })`. Também edita menus, ativa/
  desativa e promove admin. `/cadastro` público é **removido**.
- **Trava de menu em dois níveis (UI + rota).** O sidebar filtra por `allowed_menus`; um guard
  de rota redireciona quem digitar a URL de um menu sem permissão. **Não** há checagem no
  backend — é controle de navegação para um time interno de confiança, não fronteira de
  segurança de dados.
- **Bloqueio de inativo.** `is_active = false` derruba a sessão no app (checagem no
  `ProtectedRoute`).

## Alternativas consideradas

- **Fazer o E7 completo agora** — rejeitado: risco alto (blindar functions que rodam com
  `service_role` e bypassam RLS) sem cliente externo que justifique. ADR-0027 já pediu adiar.
- **Manter RLS por `user_id`, cada um na sua caixinha** — rejeitado: não é "mesma operação";
  o time não veria os mesmos lotes/faturamento.
- **Papéis (roles) + mapa papel→menu** — adiado: com ~10 usuários, checklist de menu por
  usuário (`allowed_menus`) é mais simples e foi o pedido. Roles entram se a repetição doer.

## Consequências

- **Positivas:** entrega o pedido (cadastrar usuário + escolher menus) sem a migração arriscada
  do E7; deixa um único ponto (`is_membro_operacao()`) para apertar a RLS quando o E7 chegar.
- **Segurança (consciente):** a RLS deixa de isolar por usuário — **qualquer autenticado vê
  tudo da operação**. Por isso o `/cadastro` público é removido; ninguém entra sem um admin
  convidar. A trava de menu é de navegação, não de dados: um usuário técnico com sessão válida
  ainda pode chamar a API de um menu que não vê. Aceitável para time interno; **não** liberar a
  operação para terceiros sem antes fazer o E7.
- **Credenciais ML (atenção):** `ml_credentials` é chaveada por `user_id` e o Vault guarda o
  token do **dono** que conectou o ML. As edge functions de publicação/sync resolvem a conexão
  pelo `user_id` do chamador → um **membro** que dispare publicação/sync não acha conexão e
  falha. Até o E7 (`marketplace_connections` por org), **só o dono publica**; na prática, manter
  os menus que disparam ML (Revisão/publicar) restritos ao admin-dono, ou tratar a resolução da
  conexão da operação como follow-up. Registrado como ponto em aberto.
- **`configuracoes`:** vira leitura compartilhada (operação) com escrita só de admin.
- **Reversão / E7:** ao implementar o E7, redefinir `is_membro_operacao()` para `is_member_of
  (org_id)`, popular `org_id`, e blindar as functions. As policies em si mudam pouco (chamam o
  helper).

## Pontos em aberto

- Resolver a conexão ML da operação (não do chamador) para destravar publicação por membros —
  ou manter publicação só no admin até o E7.
- `lotes.numero` segue global (sem mudança nesta fase).
