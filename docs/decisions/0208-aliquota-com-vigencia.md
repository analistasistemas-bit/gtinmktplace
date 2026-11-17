# ADR-0208 — Alíquota de imposto com vigência (mudança vale só daqui pra frente)

Status: PROPOSTO (2026-11-17) — caminho escolhido pelo Diego no brainstorming; plano revisado pelo Codex GPT 6.1 Sol (high), 8 achados aplicados · Relaciona: ADR-0055 (imposto por origem), ADR-0086 (confirmação de alíquota), ADR-0109 (custo congelado na venda), ADR-0112 (alíquota interna por UF), ADR-0159 (cache de mês fechado / `tax_config_stamp`), ADR-0193 (relatório mensal recalcula) · Plano: `docs/superpowers/plans/2026-11-17-aliquota-vigencia.md`

## Contexto
Em 17/11/2026, às 09:40 (horário de Brasília), a Daludi Shop mudou a alíquota nacional de 4% para 6,5%. Todas as vendas passadas passaram a mostrar imposto de 6,5%.

Motivo: `configuracoes` guarda uma única linha de alíquotas por org, sobrescrita a cada save (`src/lib/queries.ts` `upsertAliquotas`). O imposto de nenhuma venda é gravado. Ele é recalculado a cada leitura por `montarAliquotaResolver` (`_shared/platform-admin/sales-costs.ts`) e `impostoDoItem` (`sales-summary.ts`), nos seguintes pontos:
- 9 telas do front, via `useAliquotas`;
- Central (`metrics-repository.ts`);
- relatório mensal;
- Telegram gerencial.

Até mês fechado é recalculado: `tax_config_stamp` invalida o cache de propósito.

O custo do produto já é congelado por venda (ADR-0109). O imposto não é.

## Decisão
**Histórico de alíquotas com vigência.** Cada venda usa a alíquota que valia na data dela.

1. **Tabela `aliquotas_vigencia`**
   - Colunas: `org_id`, `vigente_desde timestamptz`, `nacional_pct`, `importado_pct`, `uf_empresa`, `interna_pct`.
   - Uma linha por mudança. Ninguém edita: só leitura por RLS da org. Não há insert, update nem delete pelo cliente.
2. **Gravação por trigger em `configuracoes`**
   - `AFTER INSERT OR UPDATE`: quando uma das 4 colunas de alíquota muda (`IS DISTINCT FROM`), insere uma linha com `vigente_desde = date_trunc('milliseconds', clock_timestamp())`.
   - Não usa `now()`, que é o início da transação e fica fora de ordem em saves concorrentes.
   - Tabela sem privilégio de escrita para `anon` e `authenticated`.
   - Fica num ponto só, sem tocar no app, e cobre qualquer caminho de escrita.
3. **Leitura no resolver**
   - `AliquotaResolver` passa a receber a data da venda: `(item, uf, data)`.
   - `impostoDoItem` passa a receber `data`. Os chamadores passam `date_closed ?? date_created`, a mesma data que define o mês da venda (`sales-summary.ts`).
   - `montarAliquotaResolver` aceita `vigencias` opcionais junto das alíquotas atuais e escolhe a vigência mais recente com `vigente_desde <= data`.
   - Sem vigências (org nunca confirmou), ou sem data, valem as alíquotas atuais, como hoje.
   - **Falha ao ler as vigências nunca cai na alíquota atual**, porque reaplicaria a nova às vendas antigas:
     - o front lança o erro;
     - as edges marcam `configErrored`, sem materializar o mês e sem lucro no gerencial.
   - Data anterior à primeira vigência: vale a vigência mais antiga.
4. **Onde as vigências entram**
   - `fetchAliquotas` devolve `vigencias`, e as 9 telas não mudam.
   - `loadConfigState` (edges) lê `vigencias` dentro de `rates`.
   - `taxConfigStamp` passa a assinar a lista de vigências. Mudar a alíquota de hoje não altera o resultado de um mês fechado, e o recálculo dá o mesmo número.
5. **Precificação continua com a alíquota atual**: publicar, calculadora, kits, promoções e `process-familia`. Só o imposto de **vendas** usa vigência.
6. **Backfill**
   - Cada org com alíquota confirmada recebe uma vigência `1970-01-01` com os valores atuais.
   - Daludi Shop recebe duas:
     - `1970-01-01`: nacional 4, importado 0, PE / interna 4 (*a confirmar com o Diego*);
     - `2026-11-17T12:40:00Z` (09:40 em Brasília, informado pelo Diego): os valores atuais.
   - Valores fixos na migration, que aborta se a configuração atual da Daludi divergir.
   - Não usar `atualizado_em`: ele muda em qualquer save e vem do relógio do cliente.

## Alternativas descartadas
- **Gravar a alíquota em cada venda**, no `venda_item_custo`, no momento do sync. Exige que o sync resolva origem e UF. Venda sem produto casado continua recalculando ao vivo. Uma alíquota digitada errado fica presa na venda. O usuário escolheu a vigência.
- **Data escolhida pelo usuário** ("vale a partir de"): fica para depois (YAGNI). Hoje vale a partir do momento do save.

## Consequências
- Corrigir uma alíquota digitada errado também vira "daqui pra frente". Para corrigir o passado: SQL de suporte na tabela de vigências.
- Classificação **crítica** (dado financeiro e migration): revisão independente obrigatória (Opus ou Codex) antes do merge.
