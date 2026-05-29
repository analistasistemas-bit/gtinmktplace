# ADR-0012: Refresh de token OAuth ML com lock distribuído no Redis

**Status:** Aceito
**Data:** 2026-05-29
**Decisores:** Diego (em sessão de design do bloco OAuth do M4)
**Relacionado:** complementa [ADR-0011 (redirect URI via Edge Function)](0011-redirect-uri-via-edge-function.md); usa a fila/cache de [ADR-0006 (QStash)](0006-qstash-em-vez-de-postgres-queue.md) e o Upstash Redis do [ADR-0001 (stack)](0001-stack-tecnologico.md)

> **Nota de numeração:** o gap §541 do `TASKS.md` (revisão crítica do spec, 2026-05-26) pediu "documentar em novo ADR (ADR-0010)" para este assunto. Quando este ADR foi de fato escrito, o número 0010 já havia sido usado pela decisão do OpenRouter. Este ADR-0012 é o documento que aquele gap pedia.

## Contexto

O bloco OAuth do M4 conecta a conta de vendedor do Mercado Livre (Daludi) ao PubliAI. Depois da conexão inicial, todo bloco seguinte (busca de concorrência, publicação CREATE/UPDATE) precisa de um **access token válido** do ML para chamar a API.

Dois fatos da API do Mercado Livre tornam o gerenciamento de token não-trivial:

1. **Access token de vida curta:** expira em **6 horas** (`expires_in = 21600`). Um lote de publicação pode demorar mais que isso, e lotes diferentes podem rodar em momentos distintos do dia — então o token quase sempre precisa ser renovado antes de uso.

2. **Refresh token rotativo de uso único:** cada chamada a `POST /oauth/token` com `grant_type=refresh_token` devolve **um novo `refresh_token`** e **invalida o anterior** ([doc oficial ML](https://developers.mercadolibre.com.br/pt_br/autenticacao-e-autorizacao)). Isso é uma medida de segurança padrão (refresh token rotation), mas cria uma condição de corrida séria no nosso caso.

### A condição de corrida

Como a publicação roda em Edge Functions disparadas por QStash, **várias famílias de um lote são processadas em paralelo** (cada `process-familia`/`publish-familia-ml` é uma invocação separada). Se duas dessas invocações perceberem o token expirado "ao mesmo tempo" e ambas chamarem o refresh:

```
t0  Function A lê refresh_token = R1
t0  Function B lê refresh_token = R1
t1  A: POST /oauth/token (R1) → recebe access A2 + refresh R2; ML invalida R1
t2  B: POST /oauth/token (R1) → 400, R1 já foi invalidado por A
t3  B falha; pior: se B tivesse rodado antes de A persistir R2, gravaria lixo
```

O resultado é uma família que falha por erro de autenticação **mesmo com a conexão íntegra**, ou — no pior caso — a conexão inteira quebrando e exigindo reconexão manual via OAuth.

## Decisão

A renovação de token fica **encapsulada em uma única função** `getValidAccessToken(user_id)` (`_shared/ml/token.ts`), que é o **único** ponto do código autorizado a chamar o refresh. Nenhuma Edge Function chama `/oauth/token` diretamente para refresh — todas passam por essa função.

A função implementa **refresh proativo com lock distribuído**:

```
getValidAccessToken(user_id):
  1. lê a linha de ml_credentials (expires_at, refresh_token_secret_id, access_token_secret_id)
  2. se expires_at > agora + BUFFER (5 min):
        → lê access_token do Vault e retorna (caminho quente, sem refresh)
  3. senão (expirado ou perto de expirar):
     a. tenta adquirir lock:  SET lock:ml:refresh:{user_id} <id> NX EX 30
     b. SE pegou o lock:
          - lê refresh_token do Vault
          - POST /oauth/token (grant_type=refresh_token)
          - atualiza NO VAULT os DOIS segredos (access novo + refresh novo rotacionado)
          - atualiza expires_at = agora + expires_in
          - libera o lock (DEL)
          - retorna o access novo
     c. SE não pegou (outro processo está renovando):
          - faz alguns retries curtos (ex.: até 10× com sleep ~300ms)
            relendo ml_credentials até expires_at avançar
          - quando avançar, lê o access novo do Vault e retorna
          - se estourar o limite de retries → erro explícito (deixa o QStash retentar a família)
```

### Parâmetros

| Parâmetro | Valor | Razão |
|---|---|---|
| `BUFFER` (antecedência do refresh) | 5 min | Cobre a latência de uma chamada de publicação longa sem renovar à toa |
| TTL do lock (`EX`) | 30 s | Maior que o tempo de uma chamada `/oauth/token` (~1-2s) + escrita no Vault; expira sozinho se o processo morrer no meio (evita deadlock) |
| Retries do caminho "não pegou lock" | ~10× / ~300ms | ~3s de espera total, suficiente para o detentor do lock terminar; se não, falha e QStash retenta |

O lock usa `SET ... NX EX` (operação atômica do Redis) — o mesmo cliente Upstash Redis já usado para cache de cor. Adiciona-se um helper `redisSetNX(chave, valor, ttlSegundos)` em `_shared/redis/client.ts`.

### Proteção CSRF do início do fluxo (state)

A mesma infraestrutura de Redis cobre o `state` do OAuth (proteção CSRF), decidido junto neste bloco:

- `ml-oauth-start` (Edge autenticada) gera um `state` aleatório e grava `oauth:ml:state:{state}` → `user_id` no Redis com **TTL de 10 min**.
- `ml-oauth-callback` (Edge pública) lê o `user_id` por esse `state`, **apaga a chave imediatamente** (uso único) e prossegue. `state` ausente/expirado → redirect com erro, sem troca de token.

Guardar o `state` no Redis (em vez de assinar um JWT) dá expiração e uso-único "de graça", e o callback não tem sessão de usuário (`verify_jwt: false`) — então precisa mesmo de um lookup server-side para descobrir de qual `user_id` é o `code`.

## Alternativas consideradas

### A. Sem lock — refresh "best effort" em cada função
- **Pros:** zero código de coordenação
- **Cons:** quebra exatamente no cenário de paralelismo que o M4 cria (lote com N famílias). Inaceitável: invalida a conexão.
- **Rejeitada**

### B. Lock via advisory lock do Postgres (`pg_advisory_lock`)
- **Pros:** não depende do Redis; transacional
- **Cons:** advisory locks ficam presos à conexão; com PgBouncer/pooling do Supabase em modo transaction o comportamento é traiçoeiro; mais difícil de raciocinar do que `SET NX EX` com TTL automático
- **Rejeitada** — Redis já está no stack e o `SET NX EX` é mais simples e seguro contra deadlock

### C. Refresh centralizado num cron/scheduler (renova antes de expirar, sempre)
- **Pros:** as funções de publicação nunca renovam — só leem o token
- **Cons:** complexidade extra (mais um agendamento), e ainda assim precisaria de lock se o cron coincidir com uma publicação que detecte expiração; não elimina o problema, só o move
- **Rejeitada para o MVP** — pode ser reconsiderada se o refresh proativo se mostrar insuficiente

## Consequências

**Boas:**
- Uma única porta de entrada para o token (`getValidAccessToken`) — fácil de auditar e testar
- Refresh proativo (buffer de 5 min) evita falha no meio de uma publicação longa
- Lock com TTL automático não trava o sistema se um processo morrer
- Reaproveita Redis e Vault já no stack; nenhum serviço novo

**Tradeoffs aceitos:**
- O caminho "não pegou lock" introduz uma espera de até ~3s numa fração das chamadas concorrentes — aceitável para uma ferramenta interna de processamento em lote
- Depende do Redis estar disponível no momento do refresh; se o Upstash cair, a publicação falha e o QStash retenta (degradação aceitável)

## Como testar

- **Unit:** a decisão de renovar (buffer de 5 min) com `expires_at` e clock injetáveis; `redisSetNX` retornando o caminho certo quando a chave já existe vs. não existe.
- **Manual (bug bash do M4):** disparar um lote com várias famílias contra a app real e confirmar que não há falha de auth por corrida; forçar um token quase-expirado e observar um único refresh.

## Como reverter

A função `getValidAccessToken` é o único ponto de mudança. Para voltar a um modelo sem lock (não recomendado), bastaria remover a etapa de lock e chamar o refresh direto — mas isso reintroduz a corrida descrita acima.
