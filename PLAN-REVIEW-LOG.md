# Plan Review Log: retry limitado quando catálogo do ML devolve "não elegível"
Started 2026-07-15. MAX_ROUNDS=5.

## Round 1 — Codex (model: gpt-5.6-luna, default do config.toml)

O plano ainda tem problemas materiais:

- `nao_elegivel` também é incrementado quando `ml_variation_id` está ausente, portanto o retry não cobre apenas respostas transitórias do ML.
  Fix: separar `sem_variation_id` de `nao_elegivel` ou restringir o retry a estados explicitamente retornados pelo ML.
- O fluxo não é idempotente sob entregas duplicadas: dois jobs podem ler `catalog_listing_id = null` e executar POST de opt-in simultaneamente, criando duplicidade ou inconsistência.
  Fix: adicionar lock/claim transacional por família/variação ou uma chave idempotente persistida antes do POST.
- O alerta reutilizado para `nao_elegivel` é semanticamente incorreto: a mensagem instrui "Não encontro minha variação", mas `NOT_ELIGIBLE` não prova ausência de ficha; além disso, o filtro de cores exclui `nao_elegivel`, podendo gerar mensagem com lista vazia.
  Fix: criar mensagem/categoria específica para elegibilidade esgotada e incluir corretamente as variações afetadas.
- `tentativa` é apenas tipada em TypeScript, sem validação em runtime; valores 0, negativos, fracionários ou não numéricos podem gerar delay undefined, comportamento inesperado ou reprocessamento inválido.
  Fix: validar e normalizar `tentativa` para inteiro no intervalo 1..CATALOGO_MAX_TENTATIVAS.
- O teste proposto para o worker não testa o worker: chama só funções puras, não detecta import errado/ordem dos branches/duplicação de enqueue/alerta prematuro.
  Fix: teste com mocks de QStash/Supabase.
- A janela fixa de 31h é aceita sem métrica; o único caso observado levou 8 dias — o plano pode só atrasar o alerta.
  Fix: registrar tentativa/último estado e política operacional pra casos esgotados.
- As ~1035 variações já presas permanecem sem correção — incidente conhecido não resolvido pelo deploy.
  Fix: procedimento operacional com lote/dedup/aprovação como parte do rollout.

VERDICT: REVISE

### Claude's response

Aceito (revisando o plano):
1. **`ml_variation_id` ausente ≠ nao_elegivel transitório** — real e concreto. `ResumoCatalogo` ganha
   campo `sem_variation_id` separado; esse caso NÃO entra na condição de retry (é estrutural — a
   variação nunca teve ID no ML, retry não muda isso). `deveAlertarCatalogoNoMatch` passa a
   considerar esse campo também (mesma urgência de alerta que sem_produto/ficha_divergente).
2. **Mensagem do alerta com lista de cores vazia para `nao_elegivel`** — bug real que eu introduziria.
   Fix: incluir `nao_elegivel`/`sem_variation_id` no filtro de cores em `vincular-catalogo/index.ts`,
   e suavizar o texto da mensagem (`montarMensagemCatalogoNoMatch`) pra não presumir "ficha de kit"
   quando o motivo é elegibilidade esgotada.
3. **Validação runtime de `tentativa`** — barato e correto. Normalizar/clampar ao ler do job body.
4. **Janela de 31h pode não bastar (caso real levou 8 dias)** — aceito parcialmente: estendo
   `CATALOGO_BACKOFF_SEGUNDOS` até cobrir ~9 dias (`[600, 3600, 21600, 86400, 259200, 604800]` = 10min,
   1h, 6h, 24h, 3d, 7d), sem virar polling infinito. Se ainda não resolver em 9 dias, o alerta já fixo
   dá ao operador o sinal pra decidir manualmente (não vale a pena tentar automatizar SLA que não
   conhecemos com mais precisão que isso).

Rejeito (com motivo, mantendo a decisão original):
1. **Lock/claim transacional contra duplicidade de opt-in.** Esse risco de corrida JÁ EXISTE hoje em
   `vincularVariacoesCatalogo` (checa `catalog_listing_id` antes do POST, sem lock) e não é
   introduzido nem agravado por este plano — meu reenfileiramento adicional só aumenta a chance de
   dois `vincular-catalogo` rodarem em paralelo pro mesmo item, mas o opt-in em si já é
   defensivamente idempotente (pula variação com `catalog_listing_id`, só falta o lock atômico entre
   check e POST, que é um problema pré-existente e mais amplo que esta correção). Fica registrado
   como risco conhecido pré-existente, fora do escopo desta correção pontual — não vou expandir o
   escopo pra uma auditoria de idempotência do módulo inteiro.
2. **Teste mockando QStash/Supabase pro worker.** Levantei: NENHUM outro worker `index.ts` do projeto
   tem teste desse tipo hoje (`find supabase/functions -path "*__tests__*" -name "index*.test.ts"` →
   0 resultados). O padrão estabelecido no projeto é testar as funções puras exaustivamente e validar
   a fiação do worker por revisão/produção. Introduzir um harness de mock novo só pra este worker
   seria inventar infraestrutura de teste não usada em nenhum outro lugar do projeto — mantenho o
   teste de regressão da decisão pura, mas reformulo o comentário do teste pra não alegar que cobre
   o worker inteiro.
3. **Runbook completo de remediação das 1035 variações como parte do rollout.** Mantido como Task 6,
   explicitamente fora do escopo de implementação (decisão operacional do Diego — batch/timing contra
   a API real do ML, com opt-ins reais e não triviais de reverter). Vou reforçar a query de
   dimensionamento com dedup, mas a execução continua manual/gated.

---
**Nota:** a Rodada 1 acima rodou no modelo default (`gpt-5.6-luna`) antes do Diego pedir explicitamente
`gpt-5.6-sol` pra revisão. A crítica da Rodada 1 já foi incorporada ao PLAN.md (é válida
independente do modelo) — reiniciando a sessão do Codex com `-m gpt-5.6-sol` a partir daqui, revisando
o PLAN.md já revisado (Round 1).

## Round 2 — Codex (model: gpt-5.6-sol, pedido explícito do Diego)

1. As revisões "aceitas" da Rodada 1 nunca foram aplicadas de fato nos documentos do plano (só logadas aqui) — a implementação seguiria o design obsoleto.
2. `sem_variation_id` como valor de `catalog_status` no banco conflita com o check constraint (só aceita pendente|vinculado|sem_produto|family_diff|nao_elegivel|erro/ficha_divergente) — persistir isso quebraria; não persistir impossibilita o filtro de cores do alerta por status.
3. Reenfileiramento explícito não é idempotente sob entrega duplicada do QStash — pode gerar fan-out de rodadas/opt-ins/alertas duplicados.
4. Job de longa duração não trava na publicação: uma família republicada (UPDATE) no meio da janela multi-dia pode ter DOIS chains de retry rodando em paralelo (o antigo + o novo do republish).
5. Aritmética do backoff errada: `[600,3600,21600,86400,259200,604800]` soma ~11 dias e 7h, não "~9 dias" como eu escrevi.
6. Bug real de ordenação: o branch de reagendar checava `nao_elegivel` ANTES do branch de `pendente>0` — uma família com `pendente>0` E `nao_elegivel>0` misturados teria as variações pendentes atrasadas pro meu backoff longo em vez do retry rápido nativo do QStash.
7. Validação de `tentativa` continua vaga ("normalizar/clampar") sem valor exato.
8. Mensagem do alerta continua ambígua entre 3 causas diferentes (sem_variation_id / nao_elegivel esgotado / ficha_divergente).
9. Teste do worker continua não testando o worker — mas dessa vez com um contra-exemplo concreto: o bug #6 só foi pego lendo o código, nenhum teste proposto pegaria.

VERDICT: REVISE

### Claude's response

Aceito e já REESCREVENDO os documentos do plano (não só logando a intenção desta vez):

1. **Aplicado de fato** — PLAN.md e o plano detalhado reescritos com o design abaixo.
2. **`sem_variation_id` não vira valor novo de `catalog_status`.** Fica só como contador em memória
   no `ResumoCatalogo` (não persistido como string nova) — a linha do banco continua gravando
   `catalog_status='nao_elegivel'` pra esse caso (nenhuma migration). O filtro de cores do alerta já
   ia incluir `'nao_elegivel'` no filtro (fix da devida rodada 1) — isso já cobre as duas causas sem
   precisar de um valor novo no banco.
3. **Aceito parcialmente**: reduzo `retries` das chamadas de reenfileiramento explícito de 5 pra 2
   (janela de segurança menor pro QStash nativo, já que o backoff de negócio é o meu). Não construo
   lock/claim transacional — mesmo argumento da rodada 1: é um gap de idempotência PRÉ-EXISTENTE no
   POST de opt-in (não introduzido por este fix), e o pior caso real (opt-in duplicado) já é
   bloqueado pelo check de `catalog_listing_id` antes do POST. Registrado como risco conhecido, fora
   de escopo.
4. **Aceito como risco conhecido, sem fix estrutural.** Não vou adicionar geração/epoch de publicação
   (escopo novo, sistema distribuído). Mitigação: o worker já relê `familia`/`variacoes` do banco a
   cada execução (nunca usa dado stale do payload) — o pior caso de 2 chains paralelos é trabalho
   redundante + possível alerta duplicado, e o ADR-0036 já é explícito que realertar em republish "é
   desejável". Sem dado de fato incorreto sendo gravado.
5. **Corrigido.** Backoff recalculado com cuidado desta vez: `[3600, 21600, 86400, 172800]` (1h, 6h,
   24h, 48h) aplicado A PARTIR da 2ª rodada (a 1ª continua sendo a existente, 10min). Total até
   desistir: 10min + 1h + 6h + 24h + 48h ≈ **3,3 dias** — long o bastante pra dar folga real ao ML
   assentar, curto o bastante pra não atrasar o alerta proativo do ADR-0036 (cujo propósito é avisar
   ANTES do ML pausar) além do razoável. Preferi 3,3 dias a 11 porque não sabemos o prazo real de
   pausa do ML e o objetivo do ADR-0036 é justamente avisar antes disso.
6. **Corrigido via redesenho.** Em vez de duas funções separadas com branches soltos no worker, uma
   única função pura `decidirResultadoRodadaCatalogo(resumo, tentativaAtual)` decide TUDO (aguardar
   pendente / reagendar / finalizar+alertar) numa ordem fixa e testada: `pendente>0` sempre vence
   (comportamento atual preservado), só then avalia `nao_elegivel`. Isso também resolve o ponto 9 —
   agora há uma função pura testável que cobre exatamente a interação que o Codex encontrou o bug.
7. **Corrigido, valor exato:** `const tentativaAtual = Number.isInteger(job.tentativa) && job.tentativa >= 1 ? job.tentativa : 1;` no worker, antes de chamar a função de decisão.
8. **Aceito parcialmente:** `montarMensagemCatalogoNoMatch` ganha parâmetro opcional `motivo` pra
   variar a frase (kit/divergência vs. elegibilidade esgotada) sem criar um sistema de template novo.
9. **Revertido meu "rejeito" da rodada 1** — o Codex tinha razão: o bug #6 comprova que decisão de
   orquestração PRECISA de teste próprio. Resolvido sem inventar mock de QStash/Supabase: a extração
   de `decidirResultadoRodadaCatalogo` como função pura (ponto 6) já é 100% testável sem harness novo
   — mesmo padrão que `decidirAcaoCatalogo`/`decidirErroCriarAnuncio` já usam no projeto.

**Importante:** a implementação que o Codex `gpt-5.6-sol` já rodou (via `codex:rescue`, ANTES desta
revisão) seguiu o design velho — ficou desatualizada por este round. Vai precisar ser refeita depois
que o plano convergir.
