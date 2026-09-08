# ADR-0159: Cache materializado de meses fechados na carteira da central

**Status:** Aceito, 2026-09-08. Complementa o [ADR-0155](0155-central-organizacoes-cobranca-auditavel.md) e o
[ADR-0158](0158-central-carteira-agregada-e-pendencias.md); implementação no
[plano](../superpowers/plans/2026-09-07-perf-central-organizacoes.md), Fase 3.

## Contexto

As Fases 1 e 2 do plano de performance reduziram o custo por organização (região da edge, colunas
enxutas, leitura por mês, catálogo por `distinct on`), mas o gatilho de reavaliação do ADR-0158
(seção "Alternativas rejeitadas": "reavaliar cache se a carteira passar de 3 s com 10 organizações")
**já foi acionado com apenas 2
organizações**: 4,3–6,5 s medidos em produção antes das Fases 1/2, e o piso continua em torno de
0,5–1 s mesmo depois delas, porque a janela de 6 meses de `ml_vendas` e o catálogo de custo são lidos
por inteiro a cada render, tenha o mês vendas ou não. Com 30 organizações (roadmap de crescimento),
o mesmo desenho estoura CPU/memória da edge (~25 s de parede, ~90 MB de JSON por render).

A saída é parar de recalcular meses que não vão mudar: um mês fechado é, na prática, imutável na
maior parte do tempo — mas não o tempo todo. Medido em produção: **486 vendas de meses fechados
foram tocadas em setembro/2026** (devoluções e estornos alteram o bruto retroativamente), então
"mês fechado nunca muda" é falso e qualquer cache precisa de invalidação real, não só uma data de
corte.

## Decisão

1. **`platform_org_month_metrics` é cache reconstituível de `OrgMetrics`, não demonstrativo de
   cobrança.** O que é imutável e auditável continua sendo `platform_billing_statements` /
   `platform_billing_sale_facts` (ADR-0155, append-only, travado por trigger). A tabela nova guarda
   os **componentes** do cálculo (`gross_cents`, `orders`, `ticket_cents`, `cost_covered_orders`,
   `total_orders`) e o `markup` resultante, mas markup é razão
   (líquido − custo − imposto) / custo — recalculável a qualquer momento a partir dos componentes,
   nunca uma verdade congelada. Se a fórmula do agregador mudar, a linha antiga fica **desatualizada
   pela lógica**, não errada pelo dado: a chave de invalidação (item 3) não cobre mudança de fórmula,
   só de dado-fonte — mudança de fórmula exige reprocessar a tabela (fora de escopo desta decisão).

2. **Chave `(org_id, month)` com mês em BRT.** `month` é o primeiro dia do mês-calendário
   (`America/Fortaleza`), idêntico ao `startOf()` que já particiona a leitura por mês
   (`metrics-repository.ts`, Fase 2.2). Só meses **fechados** (`month < mês corrente em BRT`) são
   gravados — nunca o mês em andamento, que muda a cada consulta.

3. **Invalidação por `(source_count, source_max_updated_at, tax_config_stamp)` — sem trigger.**
   `ml_vendas.atualizado_em` já é o watermark de qualquer escrita que muda um KPI exposto: `upsertVenda`
   grava `atualizado_em = now()` junto com os itens, devolução e saque também tocam essa coluna. Uma
   única query por carteira (`platform_org_month_validation`, sem filtro de organização) devolve
   `count(*)` e `max(atualizado_em)` por `(org_id, mês)` desde o início da janela de 6 meses — um
   índice scan (`ml_vendas_org_data_idx`), medido em ~10 ms. Uma linha materializada é válida somente
   se `source_count` e `source_max_updated_at` baterem com essa validação **e** o carimbo de
   configuração tributária (`tax_config_stamp`) bater com a config atual da organização. Ausente ou
   inválida → recalcula ao vivo (mesma função `computeMonth` que materializa) e regrava. **Nunca zero
   silencioso**: falha na materialização cai para o cálculo ao vivo de sempre; se este também falhar,
   `metrics: null`, como já era antes desta fase. Uma linha só é persistida quando o catálogo de
   custo E a configuração tributária foram lidos com sucesso na materialização — uma falha
   transitória de leitura nunca vira `markup: null` congelado para sempre num mês fechado (que nunca
   mais teria motivo para recalcular sozinho).

   Trigger em `ml_vendas`/`ml_vendas_itens`/`variacoes` foi cogitado e rejeitado: o par
   `(count, atualizado_em)` já cobre INSERT/UPDATE/DELETE de vendas sem acoplar a ingestão a mais uma
   escrita síncrona, e o único caso não coberto (item 4) é raro e mensurado.

4. **Deriva de catálogo aceita e medida — só para `custo`, não para o catálogo inteiro.** Alterar
   `variacoes.custo` depois da materialização só afeta itens **sem** custo congelado (ADR-0109) —
   medido em produção: **3 itens em 2 855 vendas dos últimos 6 meses (0,1 %)**. `peso_gramas` (entra
   no rateio de frete de pack → líquido → markup) e `familias.origem` (define a alíquota 8 %/16 %)
   também vêm do catálogo e **não têm congelamento equivalente**: alterá-los depois da materialização
   muda o markup que o cálculo ao vivo daria, sem invalidar a linha (nenhum dos dois entra na chave
   de invalidação do item 3). É a mesma classe de deriva aceita acima, sem medição própria porque
   `peso_gramas`/`origem` mudam com a mesma raridade que `custo`. Não justifica trigger em
   `variacoes`/`familias`; o caso raro tem saída manual — hoje, apagar a linha correspondente de
   `platform_org_month_metrics` por SQL (não existe ação "recalcular mês" no admin).

5. **Mês corrente e mês anterior real são sempre ao vivo, nunca lidos do cache** — mesmo que uma
   linha exista e valide. O mês anterior real é, na prática, o que mais recebe correção tardia (item
   dos 486 tocados em setembro majoritariamente cai ali), e o `.previous` do mês corrente é uma fatia
   parcial (mesmo tempo decorrido do mês corrente), incompatível com o total de mês fechado que a
   tabela guarda. Os dois continuam elegíveis para **gravação** (pré-aquecem para quando deixarem de
   ser "corrente"/"anterior"), só não para leitura.

6. **O gatilho de reavaliação do ADR-0158 foi acionado, não hipoteticamente.** Este ADR registra que
   a condição ("carteira > 3 s com 10 organizações") já valia com 2 organizações antes das Fases 1/2
   (4,3–6,5 s) — a tabela materializada é a resposta a esse gatilho, justificada pela escala (30
   organizações: ~25 s → ~2–3 s), não pelo alvo de latência isolado de 1,5 s.

## Consequências

- Um job diário opcional (`materializar-metricas`, QStash Schedule, `_shared/platform-admin/
  metrics-repository.ts:materializeRecentMonths`) pré-aquece os últimos 6 meses fechados de cada
  organização. Sem ele o sistema continua correto — o read-through materializa sob demanda — ele só
  evita que o primeiro operador a abrir um mês recém-fechado pague o cálculo completo.
- Nenhum número exibido muda: a trava de aceite do plano (diff campo a campo de `wallet` e
  `organization`, mês corrente e um mês fechado, antes/depois) cobre esta fase como as anteriores.
- Reimplementar markup/rateio/custo/imposto em SQL continua proibido (ADR-0158 §5): o agregador
  TypeScript (`computeMonth`/`calcularResumo`) é o único, tanto para o cálculo ao vivo quanto para a
  materialização — é essa função compartilhada que garante paridade entre os dois caminhos por
  construção, sem precisar de um protocolo de paridade à parte.
