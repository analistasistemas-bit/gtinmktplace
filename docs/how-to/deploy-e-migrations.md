# How-to — Deploy de Edge Functions e migrations

> **Tipo:** How-to (Diátaxis). Levar mudanças de backend (funções + schema) para produção.
> Regras de ouro: `verify_jwt` correto por função, migrations só pelo canal canônico, deploy
> nunca defasado. Conceitos em [../explanation/arquitetura.md](../explanation/arquitetura.md).

## Pré-requisitos

- Supabase CLI logado; `SUPABASE_ACCESS_TOKEN` disponível (está no `.env.local` do projeto).
- Deno v2 para lint local das funções.

---

## Deploy de Edge Functions

### Uma função

```bash
supabase functions deploy <nome>
```

O `verify_jwt` aplicado vem do `supabase/config.toml`. **Não** passe `--no-verify-jwt` para
sobrescrever na mão — mantenha a verdade no `config.toml` (assim o deploy é reprodutível).

### Várias / todas

```bash
supabase functions deploy            # todas
```

> **Regra: deploy nunca defasado.** Mudou um módulo em `_shared/`? Re-deploye **todas** as
> funções que o importam — o `_shared` é embutido no bundle de cada função no deploy. Deployar
> só o arquivo alterado (ex.: via MCP) deixa as outras com a versão antiga.

### Verificar a versão após o deploy

Confirme que a versão subiu (CLI `supabase functions list` ou o painel) antes de considerar
concluído. Para workers acionados por QStash, confira também que `verify_jwt=false` no
`config.toml` — senão o gateway rejeita a chamada da fila (ver
[edge-functions.md → Inconsistências](../reference/edge-functions.md#inconsistências-conhecidas-de-verify_jwt)).

### Secrets

Defina/atualize secrets de backend (não vão para `.env.local`):

```bash
supabase secrets set NOME=valor
supabase secrets list
```

Lista completa de secrets esperados em `.env.example`.

---

## Migrations (schema) — canal único (ADR-0043)

**Toda** mudança de schema passa por `supabase migration new` + `supabase db push`.
**Nunca** use `apply_migration` (MCP) nem o editor SQL do painel para DDL — isso desalinha o
histórico.

### Fluxo

```bash
# 1. criar o arquivo de migration
supabase migration new <descricao-breve>

# 2. escrever o SQL no arquivo gerado em supabase/migrations/

# 3. aplicar localmente e validar
supabase db push            # Postgres local
pnpm db:check               # falha se local divergir do remoto

# 4. aplicar em produção
supabase db push --linked
```

### Lembretes de schema

- RLS por `org_id` (`current_org_id()`) é obrigatória em tabela de domínio — ADR-0027 trocou o
  isolamento antigo por `user_id`/`is_membro_operacao()` por `org_id` (multi-tenancy).
- Escritas sensíveis via `service_role`/RPC, não para `authenticated`.
- Prefira mudanças **aditivas** (o schema é aditivo desde o MVP — ADR-0007).

### Se o histórico divergir

```bash
cp -r supabase/migrations supabase/migrations.backup   # backup antes
supabase migration fetch --linked                      # reespelha o histórico do remoto
# revise o diff e reconcilie manualmente
```

---

## Chegar na `main` sem bypassar a proteção

A `main` é protegida e exige os checks **`frontend`** e **`backend-lint`** (`enforce_admins`
**ligado** desde 2026-07-29 — vale inclusive para admin). Como o projeto **não usa PR**, a regra
é: **o commit chega na main já com o CI verde**.

```bash
git push -u origin <sua-branch>          # CI roda NA BRANCH (ci.yml dispara em '**')
gh run list --branch <sua-branch> --limit 1   # esperar completed|success
git push origin HEAD:main                # fast-forward do MESMO SHA → passa sem bypass
```

Empurrar direto para a main antes do CI terminar agora é **rejeitado** (`protected branch hook
declined`), não mais "bypassado". Isso é intencional.

> **Histórico do problema.** Até 2026-07-29 o `ci.yml` só rodava em `push: [main]` e
> `pull_request`. Num push direto os checks nunca haviam rodado naquele SHA, então a proteção era
> **impossível de satisfazer** e todo push saía com `Bypassed rule violations: 2 of 2 required
> status checks are expected` — o código entrava na main **antes** de qualquer verificação. Não
> era descuido pontual: era garantido por construção. Corrigido rodando o CI em toda branch.

**Emergência** (CI quebrado e é preciso publicar na main mesmo assim) — desligar, empurrar,
**religar na mesma sessão**:

```bash
gh api -X DELETE repos/analistasistemas-bit/gtinmktplace/branches/main/protection/enforce_admins
git push origin HEAD:main
gh api -X POST   repos/analistasistemas-bit/gtinmktplace/branches/main/protection/enforce_admins
```

## Ordem de uma entrega de backend típica

1. Código da função / SQL da migration no worktree de trabalho.
2. `pnpm lint:functions` + `pnpm db:check` locais.
3. Validação local (Diego) — só faz merge sob comando.
4. Push na branch → **esperar o CI ficar verde** → fast-forward da main (ver seção acima).
5. Após merge: `supabase db push --linked` (se houve migration) → `supabase functions deploy`
   (todas as afetadas) → verificar versão.

> **Ordem importa quando o frontend depende de schema/RPC novo:** `db push` → `functions deploy`
> → só então a main. O Render auto-deploya no push da main, então inverter coloca no ar um
> frontend que chama algo que ainda não existe (incidente evitado no E6b Bloco B: a RPC
> `modulos_habilitados_da_org` é lida dentro do `MenuGuard`, que bloqueia **toda** rota).
