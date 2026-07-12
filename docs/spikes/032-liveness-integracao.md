# Spike 032 — Liveness da integração ML (distinguir "zero genuíno" de "conector morto")

**Status:** spike (design, não implementação)
**Data:** 2026-07-12
**Relacionado:** [ADR-0037](../decisions/0037-modulo-faturamento-webhooks-ml.md) (webhooks + reconciliação faturamento), [ADR-0012](../decisions/0012-refresh-token-oauth-ml-com-lock-redis.md) (refresh token ML), [ADR-0046](../decisions/0046-verify-jwt-false-workers-webhook-faturamento.md)

## 1. Problema

Hoje o operador não tem como distinguir "não chegou nenhuma venda/pergunta/devolução hoje
porque está tudo tranquilo" de "o token ML foi revogado/expirou e a integração para de
processar tudo silenciosamente, sem erro visível em lugar nenhum". Os dois estados produzem
exatamente a mesma tela: zero registros novos.

### Pontos de "swallow" (engolir o erro sem sinalizar)

| Arquivo:linha | O que faz | Efeito |
|---|---|---|
| `supabase/functions/sync-devolucao/index.ts:26-30` | `catch { return ... { semCredencial: true }, status: 200 }` quando `getValidAccessTokenConexao` falha (token revogado/expirado) | QStash vê 200 → não reenfileira, sem retry, sem DLQ |
| `supabase/functions/sync-devolucao/index.ts:32-33` | `buscarClaim` retorna `null` em qualquer resposta não-ok (inclusive 403 de escopo revogado) → `naoEncontrado: true`, status 200 | Claim revogado por auth vira idêntico a "claim não existe" |
| `supabase/functions/_shared/faturamento/devolucoes-io.ts:8-12` | `buscarClaim`: `if (!resp.ok) return null` — não loga nem propaga o status | 401/403/500 todos colapsam em `null`, indistinguíveis |
| `supabase/functions/_shared/faturamento/devolucoes-io.ts:15-24` | `buscarReturn`: mesmo padrão (`if (!resp.ok) return null`, e ainda captura exceção de rede em `catch { return null }`) | idem |
| `supabase/functions/sync-venda/index.ts:34-38` | mesmo `catch { semCredencial: true }, 200` | idem (vendas — a superfície com mais impacto financeiro) |
| `supabase/functions/sync-venda/index.ts:49-50` | `buscarPedido` null → `naoEncontrado: true`, 200 | idem |
| `supabase/functions/sync-pergunta/index.ts:25-30` | mesmo `catch { semCredencial: true }, 200` | idem |
| `supabase/functions/sync-pergunta/index.ts:32-33` | `buscarPergunta` null → `naoEncontrada: true`, 200 | idem |
| `supabase/functions/reconciliar-faturamento/index.ts:39` | `try { token = await getValidAccessTokenConexao(cx); } catch { continue; }` — pula a org inteira | **A rede de segurança também engole o erro silenciosamente**: mesmo a reconciliação horária (que o ADR-0037 descreve como "elimina o calcanhar do webhook") não sinaliza nada quando o motivo é auth — ela só ajuda para webhook perdido, não para conector bloqueado |
| `supabase/migrations/20260622193345_faturamento_vendas.sql:55-63` | `ml_webhook_eventos.erro` existe como coluna | mas nenhum worker (`sync-venda`, `sync-pergunta`, `sync-devolucao`) escreve nela — só `ml-webhook/index.ts:66` escreve `erro`, e só para falha de *publish* no QStash no recebimento, nunca para falha de fetch autenticado no worker |

### Falha concreta (cenário real)

1. Operador revoga o escopo do app no ML, ou o `refresh_token` expira/é invalidado
   (`postToken` em `_shared/ml/token.ts:22-38` lança `ML /oauth/token ${resp.status}: ...` —
   o status **está** na mensagem, mas nenhum caller inspeciona isso, só faz `catch { throw
   new Error('sem conexão ML') }` genérico em cada `index.ts`).
2. Um pedido novo chega → `ml-webhook` faz ACK 200 e enfileira normalmente (o receiver não
   sabe nada sobre token, só resolve identidade e despacha — `ml-webhook/index.ts:36-63`).
3. `sync-venda` roda, falha ao pegar token, devolve 200 `{ semCredencial: true }`.
4. QStash marca sucesso (200 = don't retry). O evento nunca ganha `processado_em`
   (fica com `recebido_em` preenchido e `processado_em` NULL para sempre — dado útil que
   **já existe** mas ninguém olha).
5. A reconciliação horária roda, também falha o token pra essa org, e faz `continue` —
   pula silenciosamente.
6. Resultado: **perda de dado silenciosa numa superfície pós-compra** (venda, devolução,
   pergunta de cliente) — sem log de erro visível, sem alerta, sem qualquer diferença
   observável em relação a um dia genuinamente parado.

## 2. Design

### 2.1 Distinguir a resposta não-ok do ML

Hoje `buscarClaim`/`buscarReturn`/`buscarPedido`/`buscarPergunta` fazem `if (!resp.ok) return
null` e descartam `resp.status`. Proposta: essas funções passam a retornar (ou lançar) algo que
carregue o status — ex. um `class MLApiError extends Error { status: number }` — em vez de
`null` opaco. Isso já existe implicitamente em `postToken` (`_shared/ml/token.ts:22-24`), só
não é propagado para as camadas que chamam os workers.

Com o status disponível, cada worker (`sync-venda`, `sync-pergunta`, `sync-devolucao`) classifica
em vez de tratar tudo como "sem credencial":

- **401/403 no token OU no fetch do recurso** → **permanente-auth**: não adianta retry
  imediato (o token não vai ficar bom sozinho). Grava o motivo em
  `ml_webhook_eventos.erro` (coluna já existe, nunca usada pelos workers — só precisa do
  `.update({ erro: ... })` que falta) e **retorna 200** mesmo assim para não virar retry-storm
  no QStash — mas emite alerta (ver 2.2) na primeira ocorrência por conexão.
- **429/5xx/timeout de rede** → **transiente**: aqui sim vale deixar o QStash re-tentar —
  os workers hoje **podem** devolver não-200 para esse caso (diferente do receiver
  `ml-webhook`, que precisa sempre ACK 200 <500ms por contrato do ML — ADR-0037 nota 2026-06-22
  "entrega não é garantida... precisa ACK 200"). Os workers `sync-*` são chamados pelo QStash
  como job assíncrono, não pelo ML diretamente, então devolver 500 aqui é seguro e já aciona o
  retry nativo do QStash (3 tentativas, configurado em `ml-webhook/index.ts:62`).
- **404 genuíno do recurso** (claim/pedido/pergunta que realmente não existe) → mantém o
  comportamento atual (`naoEncontrado: true`, 200) — não é falha de liveness.

Essa distinção transiente vs. permanente-auth é o núcleo do design: hoje as duas coisas
colapsam no mesmo `catch` genérico.

### 2.2 Alerta na primeira detecção (não a cada evento)

Infra de notificação já existe e é reaproveitável sem mudança: `_shared/notificacoes/telegram.ts`
+ `_shared/notificacoes/config.ts` (`lerConfigTelegram`, já usado pelos 3 workers para alertar
venda/pergunta/devolução nova). Proposta: quando um worker classifica o erro como
permanente-auth, checa se já alertou essa conexão recentemente (ex. campo novo
`marketplace_connections.auth_alerta_em` ou uma linha de controle simples) — se não, dispara
`enviarTelegram` com uma mensagem tipo "conexão ML da org X parou de sincronizar (401/403) desde
HH:MM". Isso evita reimplementar rate-limiting: usa o mesmo padrão de "só alerta uma vez por
estado novo" que já existe para `nova`/`novaPaga`/`novaNaoRespondida`.

### 2.3 Superfície "última sincronização bem-sucedida"

Não existe hoje nenhuma coluna que registre "quando foi a última vez que este worker rodou com
sucesso para esta conexão" — só o rastro indireto por evento em `ml_webhook_eventos.processado_em`
(que é por evento individual, não por conexão, e não cobre reconciliação nem backfill).

Proposta: um campo por conexão, não por org — porque `marketplace_connections` já é a unidade
de credencial (uma org pode ter mais de uma conta ML conectada, embora hoje o app trate 1:1 na
prática). Candidatos de onde viver:
- **Novo campo em `marketplace_connections`**: `ultima_sincronizacao_ok_em` (timestamptz),
  atualizado por qualquer um dos 3 workers e pela reconciliação quando terminam sem erro de auth.
  Mais simples de consultar (1 linha por conexão, já é a tabela que a UI de "Configurações"
  provavelmente já lê para mostrar status de conexão).
- Alternativa: derivar de `ml_webhook_eventos` (`max(processado_em)` por user/org) — mas isso
  não cobre uma org sem eventos recentes (dia genuinamente parado) nem a reconciliação, que não
  grava em `ml_webhook_eventos`.

Recomendo o campo dedicado em `marketplace_connections` — é a mesma tabela que já guarda
`expires_at` do token, então a tela de operador já teria "token expira em X" + "última sync OK
em Y" lado a lado.

## 3. Perguntas em aberto (para o operador decidir antes de implementar)

1. **Por org ou por conexão?** Hoje `reconciliar-faturamento` itera `marketplace_connections`
   (não mais `ml_credentials.user_id`, migrado no E7). Se uma org só pode ter 1 conexão ML ativa
   na prática atual, "por conexão" e "por org" coincidem — mas o modelo de dados já suporta
   múltiplas. Decidir se o spike de liveness assume 1:1 (mais simples) ou já modela N conexões
   por org.
2. **O que dispara o alerta exatamente?** Primeira falha 401/403? Ou N falhas consecutivas
   (para não alarmar em um blip transitório de rede classificado errado)? E quando o token for
   renovado com sucesso de novo, quem "limpa" o alerta (reset automático no primeiro sucesso, ou
   fecha manual)?
3. **Como evitar spam de alerta?** Se o token fica revogado por dias, cada webhook que chega
   nesse período tentaria reclassificar como permanente-auth — precisa de um "já alertei essa
   conexão, não repete" com que TTL/condição de reset (ex.: só realerta se passou X horas desde
   o último alerta E ainda não sincronizou com sucesso)?
4. **A UI de Configurações mostra isso hoje?** Não investigado neste spike — precisa checar se
   já existe uma tela de status de conexão ML onde "última sync OK" e "alerta de auth" caberiam,
   ou se é uma tela nova.
5. **Vale um "erro" estruturado (código) em vez de string livre em `ml_webhook_eventos.erro`?**
   Para permitir filtrar/agregar por tipo de falha depois.

## 4. Estimativa de escopo (grosseira — não construir às cegas)

Uma épico real tocaria:

- `_shared/faturamento/devolucoes-io.ts`, `_shared/faturamento/io.ts` (fetch de pedido),
  `_shared/faturamento/perguntas-io.ts` — trocar `if (!resp.ok) return null` por algo que
  carregue o status (classe de erro ou tupla).
- `sync-devolucao/index.ts`, `sync-venda/index.ts`, `sync-pergunta/index.ts` — reclassificar
  catch genérico em transiente vs. permanente-auth; gravar `ml_webhook_eventos.erro`; retornar
  não-200 no caso transiente.
- `reconciliar-faturamento/index.ts` — mesmo tratamento no lugar do `catch { continue; }`
  silencioso da linha 39.
- Migração nova: `marketplace_connections.ultima_sincronizacao_ok_em` (+ talvez
  `auth_alerta_em`), com o RLS/policy que a tabela já segue.
- `_shared/notificacoes/` — reaproveitar `enviarTelegram`/`lerConfigTelegram` sem mudança de
  contrato, só um novo tipo de mensagem (`montarMensagemConexaoBloqueada` ou similar).
- Frontend: onde a org visualiza a conexão ML (não localizado neste spike — precisa de uma
  investigação própria antes de tocar `src/`).
- Testes: os 3 workers e `reconciliar-faturamento` não têm cobertura de vitest hoje
  (`devolucoes-io.ts:1` — "Não testado por vitest") — um épico real adicionaria testes para a
  nova classificação de erro, não só o código.

Isto é um recorte de spike, não um plano de implementação. Não construir isso "às cegas" —
as perguntas da seção 3 (unidade de agregação, gatilho de alerta, anti-spam) mudam o desenho
de schema e merecem decisão explícita do operador antes de qualquer migration ou código.
