# ADR-0069 — Liveness da integração ML (distinguir "zero genuíno" de "conector morto")

**Data:** 2026-07-12
**Status:** aceito
**Relaciona:** [ADR-0037](0037-modulo-faturamento-webhooks-ml.md), [ADR-0012](0012-refresh-token-oauth-ml-com-lock-redis.md), [ADR-0046](0046-verify-jwt-false-workers-webhook-faturamento.md), [ADR-0068](0068-notificacoes-telegram-por-destinatario-e-categoria.md)

## Contexto

Hoje o operador não tem como distinguir "não chegou nenhuma venda/pergunta/devolução hoje porque
está tudo tranquilo" de "o token ML foi revogado/expirou e a integração parou de processar tudo
silenciosamente, sem erro visível em lugar nenhum". Os dois estados produzem exatamente a mesma
tela: zero registros novos.

Essa classe de incidente já se provou **2 vezes em produção**: (1) um `TypeError` de cache de
schema engolido por `catch(()=>{})` ficou **11 dias** silencioso antes de ser notado
(`obsidian-vault/05-Bugs/Incidentes.md`, entrada 2026-07-10); (2) `verify_jwt` mal configurado
retornou 401 em 100% dos webhooks com o faturamento parado sem alerta (entrada 2026-06-28). Um
token ML morto/revogado produz o mesmo sintoma: silêncio total, sem diferença observável de um
dia genuinamente sem vendas.

O spike `docs/spikes/032-liveness-integracao.md` mapeou os pontos de "swallow" (engolir o erro sem
sinalizar): `sync-venda`, `sync-pergunta`, `sync-devolucao` fazem `catch { semCredencial: true },
200` quando o token falha, e as funções `buscarPedido`/`buscarPergunta`/`buscarClaim`/`buscarReturn`
fazem `if (!resp.ok) return null` sem propagar o status — 401/403/500 colapsam todos em `null`,
indistinguíveis de "recurso não existe". Até a rede de segurança (`reconciliar-faturamento`) engole
o erro (`catch { continue; }`) e pula a org silenciosamente. A coluna `ml_webhook_eventos.erro` já
existe, mas nenhum worker grava nela.

Com multi-tenancy em produção (E7), o operador não consegue vigiar o token de cada org na mão —
uma conexão morta numa org secundária pode passar despercebida indefinidamente.

## Decisão

**1. Classificar o erro em vez de tratar tudo como "sem credencial".** As funções de fetch do ML
que hoje fazem `if (!resp.ok) return null` (`buscarPedido`, `buscarPergunta`, `buscarClaim`,
`buscarReturn`) passam a propagar o `resp.status` (ex.: lançando um erro tipado com o status, em
vez de `null` opaco). Cada worker (`sync-venda`, `sync-pergunta`, `sync-devolucao`) e a
`reconciliar-faturamento` classificam a falha em 3 grupos:
- **permanente-auth** (401/403 no token ou no fetch do recurso): o token não vai se consertar
  sozinho. Grava o motivo em `ml_webhook_eventos.erro` (worker), retorna 200 (não vira
  retry-storm no QStash), e dispara alerta na 1ª ocorrência (ver decisão 3).
- **transiente** (429/5xx/timeout de rede): os workers `sync-*` são chamados pelo QStash como job
  assíncrono (diferente do receiver `ml-webhook`, que precisa ACK 200 <500ms por contrato do ML —
  ADR-0037), então podem devolver não-200 para acionar o retry nativo do QStash. Nunca alerta.
- **404 genuíno** (recurso realmente não existe): mantém o comportamento atual
  (`naoEncontrado: true`, 200) — não é falha de liveness.

**2. Estado de liveness por CONEXÃO, não por org.** Campo novo
`marketplace_connections.ultima_sincronizacao_ok_em` (timestamptz), atualizado por qualquer um
dos 3 workers e pela reconciliação quando terminam sem erro de auth. `marketplace_connections` já
é a unidade de credencial (ADR-0027) e já guarda `expires_at` do token — a tela de operador tem
"token expira em X" + "última sync OK em Y" na mesma linha. O modelo já suporta N conexões por org
(multicanal-ready), mesmo que hoje a prática seja 1:1.

**3. Alerta na 1ª falha permanente-auth, com reset automático.** Assim que uma conexão transiciona
de saudável→morta (1ª classificação permanente-auth), dispara alerta — não espera N falhas
consecutivas, já que o token não se conserta sozinho e esperar só atrasa a detecção. Um campo de
controle (ex. `marketplace_connections.auth_alerta_em`) marca que já alertou essa conexão; **não
alerta de novo** enquanto ela continuar morta (evita spam a cada webhook/reconciliação durante os
dias em que o token seguir revogado). Qualquer sincronização bem-sucedida depois **reseta** o
estado automaticamente (permite alertar de novo se a conexão cair outra vez) — sem fechamento
manual, sem tela nova.

**4. Nova categoria de notificação `integracao`.** Reaproveita `notificarCategoria` (ADR-0068) —
migration de CHECK igual à do plan 035 (`profiles_telegram_categorias_validas`), acrescentando
`integracao` ao array de categorias válidas (Deno + front). Não reusa `financeiro`: "token ML
morto" e "liberação de saldo MP" são sinais de natureza diferente; misturar faria quem assina
financeiro receber ruído de infra sem pedir.

## Consequências

- Cada worker (`sync-venda`, `sync-pergunta`, `sync-devolucao`) e `reconciliar-faturamento` ganham
  1 escrita a mais por execução no caminho de sucesso (`ultima_sincronizacao_ok_em`) — custo
  desprezível frente ao ganho de observabilidade.
- `ml_webhook_eventos.erro` passa a ser preenchido de verdade pelos workers (hoje só o receiver
  `ml-webhook` escreve, e só para falha de publish no QStash) — útil para diagnóstico retroativo
  sem depender do alerta em tempo real.
- Uma categoria `integracao` sem nenhum assinante não alerta ninguém (mesma regra do ADR-0068) —
  o operador precisa assinar explicitamente na tela Usuários após o deploy, mesmo padrão do plan 035
  para a categoria `mensagens`.
- Erro estruturado (código, não string livre) em `ml_webhook_eventos.erro` fica como melhoria
  futura, não bloqueia esta fase — string livre já resolve o alerta e o diagnóstico manual; filtro/
  agregação por tipo de falha é um refinamento, não o núcleo do problema.
- UI de "Configurações"/status de conexão para exibir `ultima_sincronizacao_ok_em` e o estado de
  alerta não foi localizada/desenhada neste ADR — fica como follow-up de investigação de frontend
  antes de tocar `src/` (o backend/alerta Telegram já entrega valor sem UI nova).
- Escopo desta fase (plans/039): classificação de erro + gravação de estado + alerta via
  `notificarCategoria`. Fases futuras (não neste ADR): liveness de QStash/Redis, UI dedicada de
  status de conexão, erro estruturado por código.

## Alternativas rejeitadas

- **Health-check por polling dedicado** (job que testa o token periodicamente, independente de
  tráfego real): mais infraestrutura nova para o mesmo sinal que já passa por toda sincronização —
  os workers já fazem o fetch autenticado; só falta classificar e gravar o resultado. Rejeitado por
  redundância.
- **N falhas consecutivas antes de alertar**: reduziria falso positivo de um erro classificado
  errado, mas atrasa a detecção real e exige um contador adicional para manter. Rejeitado — o
  benefício (evitar 1 alerta raro por engano) não paga o custo (dias de silêncio numa falha real).
- **Fechamento manual do alerta**: mais controle explícito do operador, mas exige ação extra e uma
  tela nova só para isso. Rejeitado em favor do reset automático no primeiro sync bem-sucedido.
