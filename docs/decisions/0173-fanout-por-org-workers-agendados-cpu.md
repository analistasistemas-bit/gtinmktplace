# ADR-0173 — Fan-out por organização, em lotes retomáveis, para os workers agendados multi-org

**Status:** Proposto
**Data:** 2026-09-27
**Relacionado:** [ADR-0006](0006-qstash-em-vez-de-postgres-queue.md) (QStash),
[ADR-0037](0037-modulo-faturamento-webhooks-ml.md) (backfill/reconciliação de faturamento),
[ADR-0119](0119-pulse-inteligencia-de-mercado-dirigida.md) (Pulse),
[ADR-0172](0172-vendas-sku-analise-por-variacao.md) (molde de fan-out + posse + CAS do cursor em produção)

## Contexto

Em 2026-09-27 três edge functions agendadas estavam falhando por `CPU Time exceeded` (HTTP 546): o
Supabase encerra a requisição ao somar **2 s de CPU**, e os 546 aparecem entre 84 e 131 s de relógio —
antes do teto de 150 s. Medido em `function_logs`/`function_edge_logs` (24–27/09):

- `pulse-coletar` (tier completo, `0 9 * * *`): 3 tentativas com `CPUTime` todo dia. A Avil sozinha
  leva ~70 s e a queda vem na org seguinte; Daludi + Avil somaram 1.976 ms num dia em que coube.
- `backfill-faturamento` (`30 6 * * *`, `{"dias":7}`): 4 tentativas com `CPUTime` todo dia; último run
  completo por volta de 10/09. É o único backstop das mensagens pós-venda (`ml-webhook/index.ts:61`).
- `reconciliar-faturamento` (`0 * * * *`): 12 de 74 execuções com 546 em 72 h.

Causa comum: **todas as organizações são processadas numa única requisição**. Cada org a mais soma CPU
na mesma conta. As guardas existentes (`LIMITE_MS`, `ORCAMENTO_MS`, teto de 30 s das visitas) medem
relógio, não CPU, e por isso não evitam a queda. Reduzi-las não resolve.

## Decisão

1. **Fan-out por org.** A mensagem do schedule (sem `org_id`) vira **disparador**: publica uma mensagem
   por conexão ML para a própria função e responde 200. Os schedules existentes, seus bodies e o número
   de schedules **não mudam**; muda só o que a função faz com eles.
2. **Rodada com posse e cursor.** Cada (job, org) tem uma linha em `worker_rodadas` com posse (TTL),
   cursor e acumulado. É o mesmo contrato do tráfego (ADR-0172): reservar posse → lote → CAS do cursor
   → continuação por QStash → concluir. Uma cadeia viva impede uma segunda cadeia para a mesma
   (job, org), e um ciclo já concluído com `ok` não abre rodada nova (a janela de dedup do QStash não é a única trava).
3. **Trabalho limitado por contagem, não por relógio.** Cada mensagem processa no máximo um lote de
   tamanho fixo (produtos, pedidos, packs), com tamanho medido e ajustável por constante. O relógio
   (90 s) fica como proteção secundária.
4. **Etapas caras separadas.** Onde um passo lê um volume que não depende do lote (mapa de 120 dias do
   Mercado Pago, histórico de perguntas/claims), ele vira uma etapa própria da cadeia, em mensagem
   separada. Nos lotes de vendas, o líquido do MP vem pelos pagamentos do próprio pedido
   (`carregarLiquidoMPDoPedido`, já usado por `sync-venda`), não pela varredura de 120 dias.
5. **Payload preserva o modo.** A mensagem por org carrega job, tier/dias/janela e ciclo. Nunca reusa o
   caminho manual (`scopedOrgId`), que impõe 50 produtos e desliga o baseline no Pulse.
6. **Deduplicação por (função, job, org, ciclo).** Ciclo = dia BRT para os jobs diários e hora UTC para
   o reconciliar e o tier quente. As continuações acrescentam rodada, cursor e tentativa.
7. **Específico por função:**
   - **Pulse:** o schedule só coleta orgs com o módulo `pulse` habilitado (Avil e Daludi Shop saem até o
     módulo ser ligado; com os lotes, a Avil passa a caber quando for). Tentativa de coleta registrada
     por produto (`coleta_tentativa_em`, `coleta_falhas_seguidas`), com backoff para cpid que falha
     seguidamente, **sem declarar a ficha morta** (`mlGet` devolve `null` para qualquer erro). A
     notificação sai uma vez por rodada, depois de concluída.
   - **Backfill:** o caminho agendado deixa de reler perguntas e claims (o reconciliar relê o mesmo
     histórico de hora em hora, com filtro). Vendas e mensagens viram etapas com cursor. Falha
     transitória ao ler mensagens deixa de virar `[]` calado no caminho do backfill.
   - **Reconciliar:** etapas `perguntas_claims` → `vendas` → `liberacoes`, por org.
8. **Caminho manual intocado.** Os botões "Atualizar agora" (Pulse) e "Sincronizar" (faturamento)
   continuam como hoje, numa requisição só da própria org.

## Consequências

- Uma org lenta ou com falha não derruba as outras; o retry repete só aquele lote daquela org.
- Mensagens QStash: ~+350 por dia (estimativa com as orgs de hoje, a maior parte do reconciliar horário), sem schedule novo. No plano Pay as
  You Go (ativado em 2026-09-27) isso custa centavos por mês. A solução não depende do plano.
- Mais uma tabela de estado (`worker_rodadas`) e duas colunas em `pulse_produtos`.
- `worker_rodadas` passa a dizer, por job e org, quando foi o último `ok` e qual o último erro — base
  para um alarme futuro (fora deste ADR).
- Risco residual aceito no Pulse: queda entre o upsert das ofertas e a gravação dos alertas de um lote
  perde os alertas daquele lote (o diff seguinte já parte do estado novo). Com lotes pequenos a janela
  é curta; é o mesmo risco que já existia com a execução inteira.

## Alternativas descartadas

- **Só reduzir `LIMITE_MS`/`ORCAMENTO_MS`:** medem relógio; o limite que estoura é de CPU.
- **Só fan-out, sem lotes:** a Avil sozinha já roda perto de 2 s de CPU no Pulse; qualquer crescimento
  volta a estourar.
- **Outro runtime (worker fora do Supabase):** resolve CPU, mas cria infraestrutura nova para operar,
  sem necessidade enquanto os lotes couberem.
- **Schedule por org:** exigiria criar e apagar schedules a cada org nova.
