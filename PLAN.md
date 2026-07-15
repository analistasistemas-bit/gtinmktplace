# Plan: retry limitado quando catálogo do ML devolve "não elegível" (vincular-catalogo)
_Round 2 — revised by Claude after 2 rounds of Codex critique (ver PLAN-REVIEW-LOG.md)_

Plano detalhado (tasks TDD completas, código exato, testes, commits) em
`superpowers/plans/2026-07-15-fix-catalogo-nao-elegivel-retry.md`. Este arquivo é o resumo p/ review.

## Goal

O worker `vincular-catalogo` (ADR-0021) checa a elegibilidade de catálogo do ML uma única vez,
10min após o publish. Se a resposta não for `READY_FOR_OPTIN` nem `FAMILY_DIFF`, ele grava
`catalog_status='nao_elegivel'` e nunca mais reavalia. Confirmado ao vivo (2026-07-15): um item
(MLB4862137331) que está gravado como `nao_elegivel` há 8 dias está, agora, `READY_FOR_OPTIN` +
`buy_box_eligible:true` de verdade no ML — ou seja, a resposta era transitória, não definitiva.
Sistêmico: nenhuma vinculação nova desde 17/06 (~1035 variações presas em `nao_elegivel`).

Objetivo: dar mais rodadas espaçadas (backoff) antes de tratar `nao_elegivel` como definitivo, e só
alertar o operador (ADR-0036) depois de esgotar essas rodadas.

## Approach

1. `_shared/ml/catalogo.ts`: **uma única função pura** `decidirResultadoRodadaCatalogo(resumo, tentativaAtual)`
   substitui o que antes eram dois branches soltos no worker — decide, nesta ordem fixa e testada:
   - `pendente > 0` → `{ acao: 'aguardar_elegibilidade' }` (comportamento atual preservado: o worker
     devolve 500, QStash retenta rápido/nativo — **isso sempre vence**, mesmo com `nao_elegivel` misto).
   - senão, `nao_elegivel > 0` e ainda há tentativa sobrando → `{ acao: 'reagendar', delaySegundos, proximaTentativa }`.
   - senão → `{ acao: 'finalizar', deveAlertar: deveAlertarCatalogoNoMatch(resumo) }`.
   Backoff **a partir da 2ª rodada** (a 1ª é a existente, 10min): `CATALOGO_BACKOFF_SEGUNDOS = [3600, 21600, 86400, 172800]`
   (1h, 6h, 24h, 48h). `CATALOGO_MAX_TENTATIVAS = 5` (1ª rodada existente + 4 daqui). Total até
   desistir: 10min+1h+6h+24h+48h ≈ **3,3 dias** (recalculado com cuidado — a versão anterior deste
   plano somava errado e chegava a 11 dias, o que atrasaria demais o alerta proativo do ADR-0036).
2. `ResumoCatalogo` ganha campo **`sem_variation_id`** (em memória, NÃO é um valor novo de
   `catalog_status` no banco — a linha continua gravando `'nao_elegivel'`, que já é um valor válido
   do check constraint). Variação sem `ml_variation_id` é estrutural (nunca vai aparecer via espera)
   → não entra na condição de retry, só em `nao_elegivel > 0` (resposta real do ML) entra.
3. `deveAlertarCatalogoNoMatch`: passa a considerar `nao_elegivel > 0` também (hoje só olha
   `ficha_divergente`/`sem_produto`). Continua pura/míope — quem garante que só dispara depois de
   esgotar as rodadas é `decidirResultadoRodadaCatalogo` (chama ela só no branch `finalizar`).
4. `_shared/queue.ts`: `VincularCatalogoJob` ganha campo `tentativa?: number`.
   `enfileirarVinculacaoCatalogo(familiaId, delaySeconds=600, tentativa=1, retries=5)` — as chamadas
   de **reenfileiramento explícito** (reagendar) usam `retries=2` (não 5), reduzindo a superfície de
   fan-out por reentrega duplicada do QStash sobre um backoff que já é de negócio, não de rede.
5. `vincular-catalogo/index.ts`: valida `tentativa` do job (`Number.isInteger(job.tentativa) &&
   job.tentativa >= 1 ? job.tentativa : 1`), chama `decidirResultadoRodadaCatalogo`, executa a ação
   (500 / reenfileira e retorna 200 / segue pro alerta+espelhamento existente).
6. Alerta (`montarMensagemCatalogoNoMatch`) ganha parâmetro opcional `motivo` pra diferenciar a frase
   entre "ficha de kit/divergente" e "elegibilidade esgotada" sem criar um sistema de template novo.
   Filtro de cores do worker passa a incluir `catalog_status === 'nao_elegivel'` também (hoje só
   `ficha_divergente`/`sem_produto` — sem isso, o alerta pra um caso só-`nao_elegivel` sairia com
   lista de cores vazia).
7. Sem migration de banco — `tentativa` viaja no payload do job; `sem_variation_id` é só contador
   em memória, nunca persistido como string nova.

## Key decisions & tradeoffs

- **Uma função de decisão só, não duas.** A 1ª versão deste plano tinha `decidirProximaTentativaCatalogo`
  separado do branch de `pendente` no worker — Codex achou um bug real de ordenação nisso (família
  com `pendente>0` E `nao_elegivel>0` misturados atrasava as pendentes pro backoff longo). Fundir tudo
  numa função pura com ordem fixa elimina a classe inteira desse bug e fica 100% testável sem mock de
  QStash/Supabase — mesmo padrão de `decidirAcaoCatalogo`/`decidirErroCriarAnuncio` já usado no projeto.
- **`sem_variation_id` só em memória.** Persistir um valor novo no banco exigiria migration (o check
  constraint não aceita); como o filtro de cores do alerta já vai incluir `nao_elegivel`, não precisa
  de um status novo pra isso funcionar.
- **Backoff ~3,3 dias, não ~9-11.** Não sabemos o SLA real de settle do ML, mas o propósito do
  ADR-0036 é avisar o operador ANTES do ML pausar — um backoff de 11 dias arriscaria o alerta chegar
  tarde demais. 3,3 dias é uma janela ampla (480x o comportamento atual de 10min) sem exagerar.
- **`retries=2` (não 5) nos reenfileiramentos explícitos.** Mitiga (não elimina) o risco de fan-out
  por reentrega duplicada do QStash sobre um backoff que já é de negócio.
- **`sem_produto`/`ficha_divergente`/`family_diff` continuam sem retry.** São decisões de CONTEÚDO
  (ficha errada, família diferente) — esperar não muda o dado, só `nao_elegivel` é "ainda não sei".
- **Task 6 (reenfileirar as ~1035 variações já presas) fica fora da implementação** — decisão
  operacional do Diego, não parte do código.

## Risks / open questions (com o que ficou ACEITO como risco conhecido, sem fix estrutural)

- **Idempotência do opt-in sob entrega duplicada do QStash é um gap PRÉ-EXISTENTE**, não introduzido
  por este fix — `vincularVariacoesCatalogo` já checa `catalog_listing_id` antes do POST (bloqueia o
  pior caso: opt-in real duplicado), mas não tem lock atômico entre check e POST. Não construí
  claim/lock transacional pra isso — seria expandir o escopo pra uma auditoria de idempotência do
  módulo inteiro. Mitigado parcialmente (não eliminado) pelo `retries=2` no reenfileiramento.
- **Família republicada (UPDATE) durante a janela de ~3,3 dias pode gerar 2 chains de retry em
  paralelo** (o antigo + o novo do republish). Sem fix estrutural (exigiria geração/epoch de
  publicação — escopo de sistema distribuído). Mitigação: o worker sempre relê `familia`/`variacoes`
  frescos do banco (nunca usa dado stale do payload); pior caso é trabalho redundante + possível
  alerta duplicado, e o ADR-0036 já aceita realertar em republish como "desejável".
- Não sabemos o SLA real de settle do ML — 3,3 dias pode não ser suficiente em todos os casos
  (aceitável: vira `nao_elegivel` definitivo + alerta, igual ao comportamento hoje, só que mais tarde).
- Loop infinito? Não — `tentativaAtual < CATALOGO_MAX_TENTATIVAS` é estritamente decrescente até
  false; não há caminho de código que incremente sem checar o teto.

## Out of scope

- Task 6 (remediação das ~1035 variações já presas em produção).
- Qualquer migration de banco.
- Mudar `decidirAcaoCatalogo` (o classificador puro em si está correto — o bug é na
  orquestração/retry ao redor dele).
- Lock/claim transacional pro opt-in (gap pré-existente, mais amplo que esta correção).
- Geração/epoch de publicação pra invalidar chains de retry de republicações antigas.
