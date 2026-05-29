# Spec — Bloco OAuth do M4 (Conexão com o Mercado Livre)

**Data:** 2026-05-29
**Autor:** Diego + agente (sessão de brainstorming)
**Status:** Aprovado para planejamento
**Marco:** M4 — Integração Mercado Livre (bloco 1 de 6)
**ADRs relacionados:** [ADR-0011 (redirect URI via Edge Function)](../../decisions/0011-redirect-uri-via-edge-function.md), [ADR-0012 (refresh com lock no Redis)](../../decisions/0012-refresh-token-oauth-ml-com-lock-redis.md)

---

## Objetivo

Conectar a conta de vendedor do Mercado Livre (Daludi) ao PubliAI via OAuth 2.0 (Authorization Code) e manter, a partir daí, um **access token sempre válido** para os blocos seguintes do M4 (busca de concorrência, publicação CREATE/UPDATE).

Ao final deste bloco, o operador consegue:
1. Ver em **Configurações** se o ML está conectado (e qual conta/nickname).
2. Clicar em **Conectar Mercado Livre**, autorizar na tela do ML e voltar ao app conectado.
3. **Desconectar** quando quiser.

E o sistema consegue, internamente, obter um access token válido sob demanda sem quebrar a conexão por concorrência.

## Fora de escopo (blocos seguintes do M4)

Busca de concorrência, estratégia de preço condicional, mapeamento de categorias/atributos, publicação CREATE e UPDATE. A detecção de variação adicionada/removida no UPDATE (gap §540, atualização do ADR-0005) será tratada no bloco de publicação, não aqui.

## Premissas

- **Ambiente:** o fluxo OAuth roda **apenas a partir do app publicado** (`https://ean2marketplace-frontend.onrender.com`). O callback sempre redireciona pra lá; **não há** rama condicional para `localhost` (decisão do Diego nesta sessão).
- **App ML:** já registrada (Client ID `5907788004648058`), confidential client, fluxos Authorization Code + Refresh Token. Redirect URI = `https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/ml-oauth-callback` (ADR-0011).
- **Domínio de auth do ML (Brasil):** `https://auth.mercadolibre.com.br/authorization`. Token endpoint: `https://api.mercadolibre.com/oauth/token`.
- **Usuário único hoje:** Diego (`analistasistemas@gmail.com`). O schema é por `user_id` com RLS mesmo assim.

## Fluxo completo (data flow)

```
Configurações → botão "Conectar Mercado Livre"
   │
   ├─> [edge ml-oauth-start]  (autenticada, requireUser)
   │       1. user_id = requireUser(req)
   │       2. state = random
   │       3. Redis.SET oauth:ml:state:{state} = user_id  EX 600  (10 min)
   │       4. devolve { authUrl } = auth.mercadolibre.com.br/authorization
   │                ?response_type=code&client_id=...&redirect_uri=...&state={state}
   │
   ├─> browser: window.location.href = authUrl
   ├─> usuário autoriza na tela do ML
   │
   └─> ML redireciona → [edge ml-oauth-callback]  (pública, verify_jwt:false)
           com ?code=...&state=...
           1. user_id = Redis.GET oauth:ml:state:{state}
                 └─ nulo? → 302 redirect /#/configuracoes?ml_erro=state
           2. Redis.DEL oauth:ml:state:{state}            (uso único)
           3. POST /oauth/token
                 grant_type=authorization_code, client_id, client_secret, code, redirect_uri
                 └─ erro? → 302 /#/configuracoes?ml_erro=token|rede
           4. GET /users/{ml_user_id}  (com access novo) → nickname
           5. Vault: guarda access + refresh → access_secret_id, refresh_secret_id
           6. upsert ml_credentials (user_id, ml_user_id, ml_nickname, scope,
                                     expires_at = agora + expires_in, secret_ids)
           7. 302 redirect → /#/configuracoes?ml_conectado=true
```

Uso posterior (blocos seguintes), fora do escopo de UI deste bloco mas já implementado aqui:

```
qualquer Edge que chame a API do ML:
   accessToken = await getValidAccessToken(user_id)   // _shared/ml/token.ts
```

## Componentes

### Edge Functions

| Função | `verify_jwt` | Responsabilidade |
|---|---|---|
| `ml-oauth-start` | sim (via `requireUser`) | Gera e guarda o `state`; monta e devolve a `authUrl`. |
| `ml-oauth-callback` | **não** (chamada do redirect público do ML) | Valida `state`, troca `code` por tokens, busca nickname, grava no Vault, faz upsert em `ml_credentials`, redireciona ao frontend. |
| `ml-oauth-disconnect` | sim (via `requireUser`) | Apaga a linha de `ml_credentials` do usuário e os segredos correspondentes no Vault. |

### Helpers compartilhados (`_shared/`)

- **`ml/token.ts`** — `getValidAccessToken(user_id) → string`. Refresh proativo com lock, conforme [ADR-0012](../../decisions/0012-refresh-token-oauth-ml-com-lock-redis.md). Lê/grava tokens pelas **RPCs `get_ml_tokens` / `upsert_ml_credentials` já existentes do M2** (encapsulam o Vault). Também `trocarCodePorToken(code)` e `refreshTokenML(refresh)` como funções internas finas sobre `POST /oauth/token`. A decisão de renovar fica na função pura **`precisaRenovar(expiresAtMs, agoraMs, bufferMs)`**.
- **`ml/auth-url.ts`** — `montarAuthUrl(state, clientId, redirectUri) → string` (função pura, testável; recebe os valores por parâmetro para não depender de `Deno.env` em teste).
- **`redis/client.ts`** — adiciona `redisSetNX(chave, valor, ttlSegundos) → boolean` (true se setou).

> **Nota (descoberta no planejamento):** a camada de Vault foi **inteiramente implementada no M2** (migration `20260527000003_ml_credentials_vault.sql`). As funções `SECURITY DEFINER` `upsert_ml_credentials(p_user_id, p_ml_user_id, p_ml_nickname, p_access_token, p_refresh_token, p_scope, p_expires_at)` (faz create dos segredos no Vault ou rotaciona ambos via `vault.update_secret`) e `get_ml_tokens(p_user_id) → {access_token, refresh_token, expires_at}` já existem e estão revogadas de `public/anon/authenticated` (só `service_role`). Portanto **não há migration nova nem `_shared/vault.ts`** neste bloco — as Edge Functions chamam essas RPCs via `adminClient().rpc(...)`.

### Frontend

- **`useMlConnection()`** (hook TanStack Query) — `select` em `ml_credentials` (RLS já restringe ao usuário); devolve `{ conectado, nickname, mlUserId }`.
- **`lib/ml-oauth.ts`** — `iniciarConexaoML()` chama a edge `ml-oauth-start` e faz `window.location.href = authUrl`; `desconectarML()` chama `ml-oauth-disconnect` e invalida a query.
- **Seção ML em Configurações** — substitui o mock "Conectado / vendedor_mock" por estado real: badge verde + nickname + botão Desconectar quando conectado; botão Conectar quando não. Lê `?ml_conectado` / `?ml_erro` da URL e mostra toast (Sonner).

## Storage de token (Supabase Vault) — já existe (M2)

Os tokens **nunca** ficam em texto na tabela; ela guarda só os UUIDs do Vault (`access_token_secret_id`, `refresh_token_secret_id`). Toda a mecânica foi implementada no M2 (migration `20260527000003_ml_credentials_vault.sql`) e é reutilizada aqui sem alteração:

- **`upsert_ml_credentials(p_user_id, p_ml_user_id, p_ml_nickname, p_access_token, p_refresh_token, p_scope, p_expires_at) → void`** — se não existe linha, faz `vault.create_secret` dos dois tokens e insere; se existe, faz `vault.update_secret` **dos dois** (cobre a rotação do refresh) e atualiza os metadados. É a função que o callback e o refresh usam para gravar.
- **`get_ml_tokens(p_user_id) → table(access_token, refresh_token, expires_at)`** — lê os segredos descriptografados via `vault.decrypted_secrets`. Lança exceção se não houver credencial.

Ambas são `SECURITY DEFINER` com `EXECUTE` revogado de `public/anon/authenticated` (só `service_role`). As Edge Functions chamam via `adminClient().rpc(...)`. **Não há migration nova neste bloco.**

Para o **disconnect** falta uma função de delete (o schema `vault` não é exposto via PostgREST, então o `adminClient` não consegue apagar segredos com `.from()`). Este bloco adiciona **uma migration mínima** com `public.delete_ml_credentials(p_user_id uuid)` — `SECURITY DEFINER`, apaga os dois `vault.secrets` referenciados e a linha de `ml_credentials`, com `EXECUTE` revogado de todos menos `service_role`. É a única mudança de schema do bloco.

## Refresh com lock — resumo

Detalhe completo no [ADR-0012](../../decisions/0012-refresh-token-oauth-ml-com-lock-redis.md). Em uma frase: `getValidAccessToken` retorna o token do Vault se faltar > 5 min para expirar; senão adquire `SET lock:ml:refresh:{user_id} NX EX 30`, renova (atualizando **os dois** segredos rotacionados), e o caminho que não pega o lock espera com retries curtos até `expires_at` avançar. Isso evita que famílias paralelas de um lote invalidem o refresh token uma da outra.

## Tratamento de erro

| Onde | Falha | Resposta |
|---|---|---|
| callback | `state` ausente/expirado | 302 `?ml_erro=state` (sem trocar token) |
| callback | `/oauth/token` 4xx | 302 `?ml_erro=token` |
| callback | rede / 5xx | 302 `?ml_erro=rede` |
| callback | sucesso | 302 `?ml_conectado=true` |
| frontend | lê `?ml_erro=*` | toast de erro amigável |
| `getValidAccessToken` | estourou retries sem lock | lança erro explícito → QStash retenta a família |

## Testes (TDD onde agrega — regra do projeto)

**Com teste:**
- `montarAuthUrl(state)` — função pura (params corretos, encoding).
- `redisSetNX` — caminho "setou" vs "já existia".
- `getValidAccessToken` — decisão de refresh com `expires_at` e clock injetáveis (dentro/fora do buffer de 5 min); caminho "não pegou lock" relendo até `expires_at` avançar (com Redis e DB mockados).

**Sem teste (manual no bug bash):**
- Fluxo OAuth real ponta-a-ponta contra a app de produção (depende da tela de autorização do ML).
- Funções SQL do Vault (validação manual via execução).

**Sem teste (regra do projeto):**
- UI cosmética da seção de Configurações.

## Migrations e setup

1. **Uma migration mínima:** `public.delete_ml_credentials(p_user_id)` para o disconnect (apaga segredos do Vault + linha). A camada de leitura/escrita (`upsert_ml_credentials` / `get_ml_tokens`) já existe do M2.
2. **Secrets do Supabase:** provisionar `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI` (hoje só no `.env.local`) para as Edge Functions lerem via `Deno.env`. Etapa explícita no plano.
3. **Regenerar tipos TS** após a migration (`delete_ml_credentials` aparece em `Functions`); impacto no frontend é nulo, mas mantém os tipos consistentes.

## Critérios de sucesso

- [ ] Operador conecta o ML pela tela de Configurações e volta ao app com badge "Conectado" + nickname real.
- [ ] `state` inválido/expirado e erros de token mostram toast amigável (não quebram a tela).
- [ ] Token gravado **só** no Vault; tabela tem apenas UUIDs.
- [ ] `getValidAccessToken` devolve token válido e renova proativamente sem corrida (validado no bug bash com lote multi-família).
- [ ] Operador consegue desconectar (linha + segredos removidos).
- [ ] Testes unitários verdes; suíte total continua passando.
