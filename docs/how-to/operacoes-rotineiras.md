# How-to — Operações rotineiras

> **Tipo:** How-to (Diátaxis). Procedimentos operacionais recorrentes. Runbooks mais longos
> ficam em [../runbooks/](../runbooks/). Conceitos em
> [../explanation/arquitetura.md](../explanation/arquitetura.md).

## Reprocessar família travada em "erro"

**Pela UI:** tela de Revisão → família em erro → botão "Reenviar" (uma) ou "Reenviar N com
erro" (todas do lote).

**Por API** (precisa de JWT do usuário):

```bash
curl -X POST https://<project>.supabase.co/functions/v1/reprocessar-familia \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"familia_id":"<id>"}'      # ou {"lote_id":"<id>"} p/ todas as do lote
```

A função reseta `erro → pendente` e re-enfileira (guard idempotente — ADR-0030).

## Destravar família/worker enfileirando no QStash na mão

Quando uma família ficou em estado inconsistente e o reprocessamento normal não cobre:

1. **Reset do estado** via SQL (canal canônico): voltar `status` para `pendente`.
2. **Enfileirar** disparando o `curl` do QStash **do próprio projeto** (com `QSTASH_TOKEN` e a
   URL da função). **Não** use o MCP do QStash para isso — ele faz double-encode do body.
3. Deploy/ações de CLI usam o `SUPABASE_ACCESS_TOKEN` do `.env.local`.

Contexto e armadilhas em `reference_reenfileirar_qstash_manual` (memória do projeto) e ADR-0030.
A automação do botão "Reenviar" é a forma suportada (ADR-0030); o passo manual é exceção.

## Reconectar OAuth do Mercado Livre

Se a publicação falhar com "token expirado" e o refresh automático (lock Redis — ADR-0012) não
resolver:

1. Tela **Configurações** → "Reconectar Mercado Livre" (refaz o fluxo `ml-oauth-start` →
   `ml-oauth-callback`).
2. Confirme que `ml_credentials` foi atualizado (novo `expires_at`).

O refresh de token é automático e protegido por lock; não há ação manual no fluxo normal.

## Monitorar anúncios moderados

Configuração, deploy (`--no-verify-jwt`... veja a ressalva abaixo) e agendamento estão no
runbook dedicado: [../runbooks/monitorar-moderados.md](../runbooks/monitorar-moderados.md).
Resumo: configurar Telegram em Configurações, deployar `monitorar-moderados`, agendar no QStash
(ex.: a cada 6h). A função alerta moderações novas e marca resolvidas (ADR-0035).

> Nota: o runbook menciona `--no-verify-jwt`; o estado atual de `verify_jwt` por função vive no
> `config.toml` (ver [edge-functions.md](../reference/edge-functions.md)). Prefira manter o
> valor no `config.toml` a passar a flag no deploy.

## Faturamento: backfill e reconciliação

- **Backfill retroativo** (um período): tela de Faturamento dispara `backfill-faturamento` com
  o JWT do usuário. Não traz frete (shipment).
- **Reconciliação periódica**: `reconciliar-faturamento` roda por schedule do QStash e cobre
  webhooks perdidos (~72h). Ver [edge-functions.md](../reference/edge-functions.md).

> Antes de confiar nesses fluxos, confira a nota de inconsistências de `verify_jwt` em
> [edge-functions.md](../reference/edge-functions.md#inconsistências-conhecidas-de-verify_jwt) —
> `sync-venda`/`reconciliar-faturamento` podem não estar executando se o gateway rejeitar a
> chamada do QStash.

## Verificar/reconciliar histórico de migrations

```bash
pnpm db:check
```

Se divergir, ver [deploy-e-migrations.md](deploy-e-migrations.md#se-o-histórico-divergir).

## Convidar usuário e definir acesso por menu (ADR-0047)

Operação multiusuário/compartilhada: um **admin** cria os logins e escolhe quais menus cada um
vê. Tela: **Usuários** na sidebar (só admin) → **Convidar usuário**.

- **Convidar:** informe e-mail + nome e marque os menus. Ligue o switch **Administrador** para
  acesso total (auto-marca e trava todos os menus e promove `is_admin`).
- **Editar/desativar/promover:** na tabela de Usuários (switches Admin/Ativo e "Editar menus").
  Usuário **desativado** é deslogado; usuário **sem nenhum menu** cai em `/sem-acesso`.
- O convidado recebe o e-mail "Seu acesso ao PubliAI", clica em **Definir senha e entrar**
  (`/#/definir-senha?token_hash=…&type=invite`), define a senha e entra.

**Reenviar convite a um usuário que já existe** (reinvitar o mesmo e-mail dá "já registrado"):
exclua e recrie. Excluir (cascata remove o `profiles`):

```sql
delete from auth.users where email = 'pessoa@empresa.com';
```

Depois é só clicar **Convidar usuário** de novo na tela.

## Adicionar uma empresa-cliente (multi-tenant, E7 — ADR-0027)

Cada empresa é uma **organização** (`org_id`) com dados 100% isolados por RLS
(`org_id = current_org_id()`). O `.env.local` é da **plataforma** — nunca se cria `.env` por
empresa. Só **super-admin** (`is_super_admin`, hoje só o Diego) cria empresas (D-E7.8).

**1. Criar a empresa** — link **"Admin da plataforma"** no topo (só super-admin) → tela
**`/admin`** → **"Nova empresa"**. Informe nome, slug (único, minúsculo), marca padrão,
**e-mail + nome do primeiro admin dela**. Isso cria a `organizations`, convida o admin e marca
o `profiles` dele com o `org_id` novo (`is_admin=true`).

**2. O admin da empresa entra** — recebe o convite ("Definir senha e entrar"), loga e já cai
isolado na org dele (só vê os próprios dados).

**3. Ele conecta a conta do marketplace** — **Configurações → "Conectar Mercado Livre"** →
autoriza com a **conta ML da empresa dele**. O `ml-oauth-callback` grava a conexão em
`marketplace_connections` no `org_id` dele, com token no Vault (é a conexão **da org**, não do
usuário — qualquer membro dela publica). O `ML_CLIENT_ID` é o mesmo app do PubliAI para todas
(OAuth = 1 app, N contas autorizando).

> **Quem conecta o ML é sempre um usuário daquela empresa.** Como o modelo é **1 usuário = 1 org**
> (D-E7.1), o super-admin não opera dentro de outra empresa nem conecta o ML por ela. Multi-org
> por usuário foi adiado (E8).
>
> **Pré-requisito externo:** o app do PubliAI no ML DevCenter precisa estar em produção/aprovado
> para aceitar contas de terceiros (em modo de teste só contas de teste autorizam).

**Remover uma empresa** — na tela `/admin`, botão **"Excluir"** na linha da empresa →
confirmação digitando o **slug**. A ação `delete_org` (edge `usuarios`, super-admin) apaga todos
os dados da org (`lotes` cascateia famílias/variações; `ml_vendas` cascateia itens; demais
tabelas `org_id` explicitamente), os **membros** (`auth.users`) e a organização. **Travas:**
super-admin não exclui a **própria** empresa (protege a Avil); a linha da própria org mostra
"sua empresa" em vez do botão.

> ⚠️ Isto remove só os **registros locais**. Anúncios já publicados **não** são despublicados do
> marketplace, e o secret da conexão fica órfão no Vault (inofensivo).

Validado ponta a ponta em 2026-07-06 (criação via `/admin`, isolamento confirmado — admin da
empresa nova viu 0 lotes/famílias da Avil — trava da própria empresa, e exclusão completa pela UI).

## E-mail transacional (SMTP via Resend)

O e-mail de convite/reset **não** usa o serviço interno do Supabase (`@mail.app.supabase.io`,
só entrega para a equipe do projeto). Está configurado **SMTP próprio via Resend**:

- **Provedor:** Resend (free 3k/mês). Domínio de envio verificado: `daludi.com.br`.
  Remetente: `publiai@daludi.com.br`. Secrets no `.env.local`: `RESEND_API_KEY`,
  `RESEND_SENDER_EMAIL`.
- **Onde mora:** a API key fica na **config de SMTP do Supabase Auth** (Management API:
  `smtp_host=smtp.resend.com`, `smtp_port=465`, `smtp_user=resend`, `smtp_pass=<API key>`).
  O frontend/edge **não** leem `.env.local` para isso — o Supabase é quem envia.
- **Templates** (Convite/Reset) e `site_url` (= URL de produção) também estão na config do Auth;
  o link aponta para `{{ .SiteURL }}/#/definir-senha?token_hash={{ .TokenHash }}&type=…`.
- **Validar entrega:** API do Resend — `GET https://api.resend.com/emails?limit=5`
  (`Authorization: Bearer $RESEND_API_KEY`) mostra `last_event: delivered` e o HTML/link.
- **Limite de envio:** o Supabase Auth tem rate limit **próprio** por hora
  (`rate_limit_email_sent`), independente do Resend. O default do serviço interno é **2/hora** —
  ele **não** sobe sozinho ao configurar SMTP. Está em **50/hora**. Se um convite falhar com
  **"email rate limit exceeded"**, é esse teto; ajuste via Management API:
  `PATCH /v1/projects/{ref}/config/auth` com `{"rate_limit_email_sent": <n>}`.

### Diagnóstico de convite que falha

A tela mostra a mensagem real da função. Causas comuns:

- **"Esse e-mail já tem cadastro…"** (409) → o e-mail já existe; remova e convide de novo.
- **"email rate limit exceeded"** (400) → estourou o `rate_limit_email_sent` da hora (ver acima).
- Para ver o status real no servidor: `get_logs` (service `edge-function`) mostra o código HTTP
  de `/usuarios`; `get_logs` (service `auth`) mostra os eventos `mail.send`/`user_invited`.
