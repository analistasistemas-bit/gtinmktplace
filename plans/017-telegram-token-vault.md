# Plan 017: Tirar `telegram_bot_token` do texto puro → Vault (espelhar o padrão de `ml_credentials`)

> **Executor instructions**: Follow step by step. Run every verification command. If
> anything in "STOP conditions" occurs, stop and report. When done, update the status
> row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 7222675..HEAD -- supabase/migrations/20260622121259_configuracoes_telegram.sql src/lib/queries.ts supabase/functions/_shared/notificacoes/config.ts supabase/functions/monitorar-moderados/index.ts supabase/functions/vincular-catalogo/index.ts`
> Se algum mudou desde `7222675`, compare os excerpts; divergência = STOP.

## Status

- **Priority**: P2 (segurança — defense-in-depth; blast radius limitado por single-tenant)
- **Effort**: L (migration + RPCs Vault + edge function + frontend + 3 leitores de backend + rotação)
- **Risk**: MED (toca caminho de notificação em produção e schema; sequenciamento de deploy importa)
- **Depends on**: coordena com 004 (a edge function nova entra no `config.toml`)
- **Category**: security
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

`telegram_bot_token` é guardado em **texto puro** numa coluna `text` da tabela `configuracoes`. A RLS de
`configuracoes` é **row-level** (`auth.uid() = user_id`), não por coluna — então o dono autenticado pode
fazer `select telegram_bot_token from configuracoes` direto via PostgREST, **furando** a RPC
`telegram_config_status()` que existe justamente para não trafegar o token ao navegador. O frontend ainda
**grava** o token direto na tabela com a chave anon. Isso viola a política do próprio projeto (tokens
sempre via **Vault**, nunca texto puro — vale para `ml_credentials`, `supabase/migrations/20260527141015_ml_credentials_vault.sql:3`)
e amplia o blast radius de qualquer XSS/sessão roubada. Quem tiver o token controla o bot (manda mensagem
em nome dele). Blast radius hoje é limitado (single-tenant; o dono lê o próprio segredo; `anon` já foi
revogado em `20260627001105`), mas o segredo já esteve plaintext, então o fix **inclui rotacionar** o token.

## Current state

**Schema** (`supabase/migrations/20260622121259_configuracoes_telegram.sql`):
- `configuracoes.telegram_bot_token text` (`:5`), `telegram_chat_id text`, `telegram_ativo boolean`.
- RPC `telegram_config_status()` SECURITY DEFINER (`:10-21`) devolve `tem_token = (telegram_bot_token is not null and <> '')`; `grant execute ... to authenticated`.

**Padrão de Vault a espelhar** (`supabase/migrations/20260527141015_ml_credentials_vault.sql`):
- Coluna `*_secret_id uuid` na tabela referenciando `vault.secrets`.
- `upsert_ml_credentials(...)` SECURITY DEFINER: `vault.create_secret(secret, name)` / `vault.update_secret(id, secret)`.
- `get_ml_tokens(p_user_id)` SECURITY DEFINER: lê de `vault.decrypted_secrets where id = ...`.
- Ambos: `revoke execute ... from public, anon, authenticated;` (só service_role chama).

**Quem GRAVA o token** (frontend, `src/lib/queries.ts:356-368`):
```ts
export async function salvarTelegramConfig(input: { chatId: string; ativo: boolean; botToken?: string }): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('sem sessão');
  const tokenLimpo = input.botToken?.trim();
  const { error } = await supabase.from('configuracoes').upsert({
    user_id: user.id,
    telegram_chat_id: input.chatId || null,
    telegram_ativo: input.ativo,
    atualizado_em: new Date().toISOString(),
    ...(tokenLimpo ? { telegram_bot_token: tokenLimpo } : {}),
  });
  if (error) throw error;
}
```

**Quem LÊ o token** (backend, via service role / admin client — todos selecionam a coluna):
- `supabase/functions/_shared/notificacoes/config.ts:6-15` (`lerConfigTelegram` — `.select('telegram_bot_token, ...')`)
- `supabase/functions/monitorar-moderados/index.ts:13-18`
- `supabase/functions/vincular-catalogo/index.ts:71-79`

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Nova migration | `supabase migration new telegram_token_vault` | cria arquivo timestampado |
| Typecheck FE | `pnpm exec tsc -b` | exit 0 |
| Test/Lint | `pnpm test && pnpm lint` | passam / 0 errors |
| Alinhamento DB | `npm run db:check` | "Migrations alinhadas" (após push pelo operador) |

**ADR-0043**: schema só via `supabase migration new` + `supabase db push`. **Nunca** reproduza o valor do
token em lugar nenhum (a migration de dados move o valor por SQL, referenciando a coluna — sem imprimir).

## Scope

**In scope**:
- 1 migration nova (`supabase migration new telegram_token_vault`): coluna `*_secret_id`, RPCs de
  set/get via Vault, migração do valor existente para o Vault, `telegram_config_status()` atualizada.
  **Mantém** a coluna `telegram_bot_token` por enquanto (o DROP é passo final do operador — ver Maintenance).
- 1 edge function nova `supabase/functions/salvar-telegram-token/index.ts` (verify_jwt=true, requireUser →
  chama a RPC de set via service role).
- `src/lib/queries.ts` (`salvarTelegramConfig` deixa de gravar o token na tabela; passa pela edge function).
- 3 leitores de backend (`_shared/notificacoes/config.ts`, `monitorar-moderados/index.ts`,
  `vincular-catalogo/index.ts`) → passam a ler via RPC `get_telegram_bot_token`.

**Out of scope**:
- **NÃO** dropar a coluna `telegram_bot_token` nesta migration (é o passo final, gated pelo operador).
- **NÃO** rodar `supabase db push` nem `functions deploy` (passos do operador).
- Não mudar `telegram_chat_id`/`telegram_ativo` (continuam gravados direto pelo dono, sob RLS).

## Git workflow

- Worktree isolado. Commits, ex.: `fix(security): telegram_bot_token via Vault, não texto puro (#017)`
- NÃO push/PR/deploy sem o operador pedir.

## Steps

### Step 1: Migration — coluna secret_id + RPCs + migração do valor + status

`supabase migration new telegram_token_vault`. No arquivo gerado:

```sql
-- Segurança: telegram_bot_token sai do texto puro e vai para o Vault, espelhando ml_credentials
-- (ver supabase/migrations/20260527141015_ml_credentials_vault.sql e plans/017). A coluna plaintext
-- é mantida por ora; o DROP é uma migration posterior, após o deploy do código novo.

alter table public.configuracoes
  add column if not exists telegram_bot_token_secret_id uuid;

-- Grava/atualiza o token no Vault (service role apenas).
create or replace function public.set_telegram_bot_token(p_user_id uuid, p_token text)
returns void language plpgsql security definer set search_path = public, vault, extensions as $$
declare v_id uuid;
begin
  select telegram_bot_token_secret_id into v_id from public.configuracoes where user_id = p_user_id;
  if p_token is null or p_token = '' then
    return; -- não limpa aqui; limpeza explícita fica fora deste escopo
  end if;
  if v_id is null then
    select vault.create_secret(p_token, 'telegram_bot_' || p_user_id::text) into v_id;
    update public.configuracoes set telegram_bot_token_secret_id = v_id where user_id = p_user_id;
  else
    perform vault.update_secret(v_id, p_token);
  end if;
end; $$;

-- Lê o token decriptado do Vault (service role apenas).
create or replace function public.get_telegram_bot_token(p_user_id uuid)
returns text language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid; v_token text;
begin
  select telegram_bot_token_secret_id into v_id from public.configuracoes where user_id = p_user_id;
  if v_id is null then return null; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_id;
  return v_token;
end; $$;

revoke execute on function public.set_telegram_bot_token(uuid, text) from public, anon, authenticated;
revoke execute on function public.get_telegram_bot_token(uuid) from public, anon, authenticated;

-- Migra o valor já existente (plaintext) para o Vault, sem imprimir o valor.
do $$
declare r record;
begin
  for r in select user_id, telegram_bot_token from public.configuracoes
           where telegram_bot_token is not null and telegram_bot_token <> ''
                 and telegram_bot_token_secret_id is null loop
    perform public.set_telegram_bot_token(r.user_id, r.telegram_bot_token);
  end loop;
end $$;

-- tem_token passa a olhar o secret_id (não a coluna plaintext).
create or replace function public.telegram_config_status()
returns table(chat_id text, ativo boolean, tem_token boolean)
language sql security definer set search_path = public as $$
  select telegram_chat_id, coalesce(telegram_ativo, false),
         (telegram_bot_token_secret_id is not null)
  from public.configuracoes where user_id = auth.uid();
$$;
```

**Verify**: `node -e "const fs=require('fs');const d='supabase/migrations';const f=fs.readdirSync(d).filter(x=>x.includes('telegram_token_vault')).sort().pop();const t=fs.readFileSync(d+'/'+f,'utf8');for(const k of ['set_telegram_bot_token','get_telegram_bot_token','vault.create_secret','telegram_bot_token_secret_id'])if(!t.includes(k))throw new Error('faltou '+k);console.log('migration OK:',f)"` → `migration OK: <arquivo>`.

### Step 2: Edge function `salvar-telegram-token` (escrita autenticada → Vault)

Crie `supabase/functions/salvar-telegram-token/index.ts` seguindo o padrão das funções autenticadas do
projeto (ex.: `definir-categoria-familia` — `requireUser` + admin/service client + CORS). Ela recebe
`{ token: string }`, resolve o usuário pela sessão (`requireUser`), e chama
`admin.rpc('set_telegram_bot_token', { p_user_id: user.id, p_token: token })`. Retorna `{ ok: true }`.
Use os helpers existentes de auth/cors de `_shared` (procure como `definir-categoria-familia` faz).

**Verify**: o arquivo existe e usa `set_telegram_bot_token`; segue o shape das outras funções autenticadas
(verify_jwt=true por default). Se o Plan 004 já entrou, adicione `[functions.salvar-telegram-token]
verify_jwt = true` ao `supabase/config.toml`.

### Step 3: Frontend — token via edge function, não direto na tabela

Em `src/lib/queries.ts`, `salvarTelegramConfig`: continue gravando `telegram_chat_id`/`telegram_ativo`
direto (sob RLS), mas **remova** o `telegram_bot_token` do upsert. Se `botToken` foi informado, chame a
edge function `salvar-telegram-token` (POST com `Authorization: Bearer <session.access_token>`, padrão das
outras invocações de edge no arquivo — ex.: `invocarMonitorarModerados`).

**Verify**: `grep -n "telegram_bot_token" src/lib/queries.ts` → vazio (o frontend não toca mais a coluna).

### Step 4: Backend — ler o token via RPC

Nos 3 leitores, troque `.select('telegram_bot_token, ...')` por: ler `telegram_chat_id`/`telegram_ativo`
da tabela como hoje, e obter o token via `admin.rpc('get_telegram_bot_token', { p_user_id: userId })`.
- `_shared/notificacoes/config.ts` (`lerConfigTelegram`): `token` vem da RPC.
- `monitorar-moderados/index.ts`: idem.
- `vincular-catalogo/index.ts`: idem (a guarda `if (cfg.telegram_ativo && token && chatId)` continua).

**Verify**: `grep -rn "telegram_bot_token" supabase/functions` → só aparece em nomes de secret/RPC, **não**
em `.select('telegram_bot_token')`. `grep -rn "get_telegram_bot_token" supabase/functions` → 3 usos.

### Step 5: Sanidade

**Verify**: `pnpm exec tsc -b && pnpm test && pnpm lint` → 0/passa/0 errors. (Se o Plan 009 entrou, `pnpm lint:functions`.)

## Test plan

- `_shared/notificacoes/__tests__/telegram.test.ts` já existe (teste da montagem da mensagem) — deve
  continuar verde (não muda a lógica de envio, só a origem do token).
- Não há teste de integração para a RPC do Vault (precisa de DB) — a garantia vem do espelhamento exato do
  padrão `ml_credentials` (já em produção) + revisão.
- **Validação do operador** (após deploy): salvar um token pela tela de Configurações, confirmar que
  `select telegram_bot_token_secret_id from configuracoes` é não-nulo e que `select telegram_bot_token` (o
  plaintext) **não é mais escrito** por novas gravações; disparar uma notificação (ex.: monitorar-moderados)
  e confirmar que chega no Telegram (token lido do Vault).

## Done criteria

- [ ] Migration criada via `supabase migration new` com coluna secret_id, `set/get_telegram_bot_token`
      (revogadas de public/anon/authenticated), migração do valor existente, e `telegram_config_status` por secret_id.
- [ ] Edge function `salvar-telegram-token` criada (autenticada → RPC de set).
- [ ] `src/lib/queries.ts` não grava mais `telegram_bot_token` na tabela; usa a edge function.
- [ ] Os 3 leitores de backend usam `get_telegram_bot_token`; nenhum `.select('telegram_bot_token')` resta.
- [ ] `pnpm exec tsc -b` 0; `pnpm test` passa; `pnpm lint` 0 errors.
- [ ] A coluna plaintext `telegram_bot_token` **ainda existe** (DROP é passo do operador).
- [ ] Linha de status atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte se:

- `vault.create_secret`/`vault.decrypted_secrets` não existirem no projeto (Vault não habilitado) — não deveria
  (o `ml_credentials` os usa em produção), mas confirme antes.
- Você for tentado a dropar a coluna `telegram_bot_token` nesta migration — é o passo FINAL do operador,
  após o código novo estar deployado e nada mais ler a coluna.
- O valor do token aparecer em qualquer arquivo/output que você gere — NUNCA; só referências/RPC.

## Maintenance notes

- **Sequência de deploy (operador)**, nesta ordem para não derrubar a notificação:
  1. `supabase db push` (migration deste plano) → cria RPCs + migra o valor pro Vault (coluna plaintext intacta).
  2. `supabase functions deploy salvar-telegram-token` + redeploy de `monitorar-moderados`, `vincular-catalogo`
     e das funções que usam `_shared/notificacoes/config.ts` (ex.: `notificar-liberacao`).
  3. Deploy do frontend.
  4. **Rotacionar o bot token** no BotFather (o segredo já esteve plaintext) e re-salvar pela tela de Configurações.
  5. Só então criar uma **2ª migration** (`supabase migration new drop_telegram_plaintext`) com
     `alter table public.configuracoes drop column telegram_bot_token;` e `db push`.
- Revisor deve checar: nenhuma RPC do Vault está executável por `authenticated`/`anon`; o frontend não grava
  mais a coluna; os 3 leitores usam a RPC; o plano não dropou a coluna prematuramente.
