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

## Deploy do frontend — service worker (ADR-0153)

Desde o PWA (ADR-0153), o `pnpm build` gera um service worker (`vite-plugin-pwa`, modo
`generateSW`) além do bundle estático de sempre. Isso muda duas coisas em produção: como o
navegador recebe uma versão nova e como validar um deploy.

### Fluxo de atualização — nunca automático

`registerType: 'prompt'` (`pwa.config.ts`): quando há build novo, o service worker baixa em
segundo plano e o app mostra um toast "Nova versão disponível" — só troca quando o usuário clica
em "Atualizar" (`src/components/atualizacao-disponivel.tsx`). Não existe reload sozinho: recarregar
no meio de uma revisão de lote, ou servir `service worker novo + página velha`, quebraria os
chunks de `lazy()`. `main.tsx` também chama `registration.update()` a cada 60 min e sempre que a
aba volta a ficar visível, para quem deixa o app aberto por dias descobrir a versão nova.

### `Cache-Control: no-cache` no `render.yaml`

O navegador já limita sozinho o cache do script do service worker a 24h; sem um header explícito,
um deploy pode demorar até um dia para chegar em quem já tem o app instalado. `render.yaml`
manda `Cache-Control: no-cache` para `/sw.js`, `/index.html`, `/` (o HashRouter sempre pede `/`,
nunca `/index.html`) e `/site.webmanifest`.

### Kill switch

Um deploy com `selfDestroying: true` em `pwa.config.ts` desregistra o service worker de todos os
clientes e limpa os caches (opção nativa do `vite-plugin-pwa`, `VitePWAOptions.selfDestroying`,
default `false`) — usar se o PWA precisar ser desligado de emergência.

### Validação pós-deploy muda

Com service worker, o navegador pode continuar servindo o bundle antigo mesmo com o cache do
navegador desligado via CDP (Playwright) — o precache do Workbox não é o cache HTTP comum, e
desligar um não atravessa o outro (ADR-0153, Contexto). Quem for validar um deploy com Playwright
precisa de um **contexto de navegador novo** (sem service worker já registrado) ou aceitar o
prompt de atualização na página antes de conferir o resultado.

Checklist de runtime real (fora do CI, verificar manualmente após um deploy que toque o PWA):
instalabilidade, navegação offline entre telas já visitadas na sessão, mutação offline que falha
na hora e **não** executa sozinha ao reconectar, cold start offline (mostra "Sem conexão") e o
fluxo de atualização de versão (toast → clique → recarrega na versão nova).

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

---

## Deploy pós-merge — módulo fiscal (ADR-0135)

Checklist pronto para copiar depois que a branch `worktree-fiscal-cadastro-nfe` mergear na main
com CI verde.

### Migrations — já aplicadas em produção, nada a fazer aqui

As 3 migrations do ADR-0135 já rodaram em produção antes deste merge (schema é **aditivo**, sem
`db push` pendente):

- `20260826004934_adr135_cadastro_fiscal.sql` — `organizations.tipo_pessoa` + constraint
  `fiscal_exige_pj`, tabela `empresa_fiscal`, colunas fiscais em `familias`.
- `20260826061358_estoque_resumo_fiscal.sql` — RPC `produtos_estoque_resumo()` ganha os campos
  fiscais.
- `20260826063450_estoque_resumo_nomes_fiscal_fix.sql` — fix round 1 da anterior (restaura
  `nomes`/`v.nome` que tinha sido apagado por `create or replace` a partir da versão errada da
  RPC) + completa os campos que o filtro "fiscal pendente" precisa (`cest`, `fci`,
  `tributacao_icms_regime`).

As edges antigas continuam funcionando normalmente até o deploy abaixo — nenhuma delas lê coluna
que não existisse antes deste ADR.

### Edge Functions a redeployar

Lista **confirmada por grep de imports reais** (não a lista especulativa do brief original) de
`_shared/fiscal/*`, `_shared/canais/fiscal-ml.ts` e dos símbolos novos que este ADR acrescentou a
três módulos `_shared/` já existentes: `enfileirarSincronizacaoFiscal` (`queue.ts`), o campo
`fiscal`/`FiscalEntrada` de `ProdutoEntrada` (`produto/validar.ts`) e as colunas
`NCM`/`CEST`/`ORIGEM_NFE`/`CSOSN` de `PlanilhaRow` (`types.ts`).

> **Por que isso não contradiz "redeploye todas as que importam" acima:** a regra geral vale
> quando não dá para garantir que a mudança no `_shared/` é aditiva. Aqui é — os três módulos só
> ganharam export/campo novo, nenhum export existente mudou de shape ou comportamento — então só
> quem **usa o símbolo novo** precisa do redeploy; o restante dos ~28 importadores de `queue.ts` e
> dos importadores de `types.ts`/`produto/validar.ts` roda o bundle antigo sem diferença funcional.
> Confirmado por grep no `import` de fato (não só menção em comentário — `adicionar-variacoes-familia`
> cita `_shared/produto/validar.ts` só num comentário de estilo, sem importar o módulo):
> `grep -rlE "^import.*enfileirarSincronizacaoFiscal" supabase/functions --include="*.ts"` → 3
> funções; `grep -rlE "^import.*from '\.\./_shared/produto/validar\.ts'" supabase/functions
> --include="*.ts"` → `cadastrar-produto`; `grep -rlE "^import.*from '\.\./_shared/types\.ts'"
> supabase/functions --include="*.ts"` → `ingest-lote`. Junto com quem importa `_shared/fiscal/*`
> direto, dá exatamente as 6 funções afetadas listadas abaixo. `publicar-split-ml`,
> `sincronizar-estoque`, `reconciliar-faturamento`, `reconciliar-convergencia-up`,
> `entrada-estoque` e `adicionar-variacoes-familia` **não** aparecem em nenhum desses greps.

```bash
supabase functions deploy \
  sincronizar-fiscal-ml atualizar-fiscal-familia sugerir-ncm \
  usuarios cadastrar-produto ingest-lote publish-familia-ml update-familia-ml monitorar-moderados
```

- **Novas (3):** `sincronizar-fiscal-ml` (worker QStash, `verify_jwt=false`), `atualizar-fiscal-familia`
  e `sugerir-ncm` (HTTP com JWT, `verify_jwt=true`) — os três já estão em `supabase/config.toml`.
- **Afetadas por `_shared/` (6):** `usuarios` (gate de ativação + `set_tipo_pessoa_org`),
  `cadastrar-produto` (fiscal na entrada manual), `ingest-lote` (colunas NCM/CEST/ORIGEM_NFE/CSOSN
  + `_shared/produto/validar.ts`), `publish-familia-ml`/`update-familia-ml` (gate de publicação +
  enqueue do push fiscal), `monitorar-moderados` (reconciliação do `can_invoice`, 6/6h).

Depois do deploy, **conferir a versão de cada função** (`supabase functions list` ou painel) antes
de considerar concluído — regra do projeto, deploy nunca fica defasado.

**Nenhum schedule QStash novo.** O semáforo `can_invoice` é escrito na hora pelo push e
reconciliado a cada 6h pendurado no cron já existente do `monitorar-moderados`.

### Validação pós-deploy (runtime real)

Numa org de teste (`is_test`): marcar PJ, preencher `empresa_fiscal`, ligar o módulo `fiscal`
(esperar recusa nomeando pendências quando faltar campo), cadastrar produto com fiscal completo, e
confirmar que a publicação sem NCM é recusada nomeando o campo. Comparar 1:1 com a tela antes de
fechar a branch.
