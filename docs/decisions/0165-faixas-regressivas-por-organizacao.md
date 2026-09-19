# ADR-0165 — Percentual de gestão por faixa regressiva de faturamento, por organização

**Status:** Aceito
**Decisor:** Diego, 2026-09-18
**Relacionado:** ADR-0155 (cobrança auditável), ADR-0158 (central de organizações), ADR-0164
(implantação sobrevive à renegociação), [design](../superpowers/specs/2026-09-18-condicoes-comerciais-faixas-design.md)

## Contexto

A página pública (`docs/brand/landing/index.html`) anuncia percentual regressivo por faixa de
faturamento mensal nas duas modalidades (até 100K / 100–300K / 300–500K / +500K). O sistema real
(`platform_commercial_terms`, ADR-0155) grava um único `revenue_bps` fixo por contrato — sem faixa —
e nenhuma regra liga a modalidade aos campos que ela pode cobrar. O ADR-0155 já havia decidido
deliberadamente que os valores da apresentação são "referências negociáveis", mas isso deixou dois
problemas sem dono: a faixa nunca é revista quando o faturamento cresce, e nada impede uma
organização de ter campos que a modalidade dela não deveria cobrar.

Medição em produção em 2026-09-18 (leitura, sem nenhum mês fechado ainda): Daludi Shop e DSA são
modalidade 1 com `sonar_unit_cents = 120` — Sonar cobrado do cliente, que a modalidade 1 não deveria
cobrar. Efeito monetário até hoje: zero (nenhuma entrega Sonar cobrável, nenhum mês fechado).

## Decisão

O percentual sobre faturamento deixa de ser um valor único por contrato e passa a ser 4 valores fixos
por faixa (`revenue_bps_t1..t4`), com os **cortes de faixa fixos para toda organização** (≤100K /
≤300K / ≤500K / acima) e os **4 percentuais dentro deles negociáveis por organização**. A faixa
aplicada em cada fechamento mensal é escolhida automaticamente pelo faturamento líquido do mês, sem
confirmação humana — é o cálculo normal da cobrança, não uma renegociação.

Modalidade passa a restringir campos: modalidade 1 nunca cobra Sonar do cliente
(`sonar_unit_cents = 0`), modalidade 2 nunca tem infraestrutura separada (`monthly_fee_cents = 0`).
Violação é rejeitada com erro — nunca normalizada em silêncio, seguindo a regra do projeto contra
defaults financeiros silenciosos (mesma classe de incidente do `ORIGEM` em 14/07/2026).

A migration corrige, no mesmo movimento, o dado já errado de Daludi Shop e DSA (zera o Sonar), porque
o efeito monetário medido é zero e nunca será mais barato de corrigir.

O detalhamento técnico completo (schema, RPCs, função auxiliar de faixa, propagação ao front,
migração de dado sob o trigger de imutabilidade) está no [design](../superpowers/specs/2026-09-18-condicoes-comerciais-faixas-design.md).

## Alternativas descartadas

**Colunas nullable com `coalesce` permanente para termos legados.** Evita desabilitar o trigger de
imutabilidade, mas mantém dois shapes vivos para sempre e não corrige o dado errado das duas
organizações — o problema que motivou esta revisão continuaria nos dados.

**Migração puramente aditiva + recontratação manual das 3 organizações pela própria UI.** Viável
porque a próxima renegociação de todas cai no mesmo mês do termo atual (nunca é resolvida de novo),
mas depende de um checklist humano fora do CI entre o deploy e a correção, sem necessidade — a
correção cabe inteira dentro da migration.

**Faixas como `jsonb`/`integer[]` em vez de 4 colunas fixas.** As faixas em si são fixas por decisão
(só o percentual varia); um array/jsonb exigiria validação de cardinalidade e tipo tanto em SQL quanto
em TypeScript para ganhar uma flexibilidade que não foi pedida.

## Consequências

- `platform_commercial_terms` perde `revenue_bps`; ganha `revenue_bps_t1..t4` e o `CHECK` de forma
  por modalidade.
- `platform_billing_preview` expõe `applied_bps`/`applied_tier` (a faixa realmente usada naquele
  mês); `platform_billing_close` grava isso em `platform_billing_statements.revenue_bps` em vez de
  reler o termo — necessário porque o crédito de devolução tardia de meses anteriores é recalculado a
  partir dessa coluna do statement, não do termo comercial.
- Devolução tardia continua usando a alíquota **congelada** do fechamento original; a faixa de um mês
  já fechado nunca é recalculada.
- Sem trava de monotonia entre as 4 faixas — o intervalo 0–10000 de cada uma já barra erro grosseiro.
- **O corte de faixa usa a mesma base líquida (`v_base = greatest(gross - refund, 0)`) que já era a
  base do cálculo de percentual antes deste ADR** — não é uma base nova, é a mesma estendida também
  para escolher a faixa. A página pública descreve as faixas como "sobre o faturamento bruto", mas a
  cobrança de fato (percentual e, agora, também a faixa) sempre foi sobre o líquido — isso já era
  verdade em produção antes desta entrega e não muda com ela. Consequência prática: uma organização
  com bruto pouco acima de um corte mas com devolução suficiente cai numa faixa de faturamento líquido
  menor — como a escala é regressiva (faturamento menor → percentual maior), o cliente paga a alíquota
  mais alta dessa faixa, nunca a mais baixa que o bruto sozinho sugeriria na página pública. O desvio
  é sempre a favor da Daludi, nunca do cliente — é risco contratual ("a página dizia X%"), não risco
  de cobrar de menos. Revisado (achado da revisão final de branch); não é regressão desta entrega, é a
  continuação de um comportamento pré-existente que a apresentação pública nunca detalhou.
- `_shared/platform-admin/billing.ts` (`composeBillingPreview`) é código morto identificado durante o
  desenho, sem caminho de produção — **removido nesta entrega** (revisão do Fable: manter o tipo
  `CommercialTerms` compatível com ele exigiria uma segunda cópia da lógica de faixa em TypeScript,
  que o CI de `deno check` reprovaria de qualquer forma assim que `revenue_bps` sair do tipo).
- Implementação em 2 migrations, não 1 (revisão do Fable): a cadeia de testes `\ir` em
  `supabase/tests/platform_commercial.sql`/`platform_billing.sql` aplica o schema/`save_terms` e o
  `preview`/`close` em pontos diferentes da sequência de migrations existentes — ver
  [design](../superpowers/specs/2026-09-18-condicoes-comerciais-faixas-design.md#revisão-do-fable-2026-09-18--aprovado-com-ressalvas-incorporadas-abaixo).

## Como reverter

Restaurar a coluna `revenue_bps` (um dos 4 valores, ou a média, a critério de quem reverter),
remover `revenue_bps_t1..t4` e os `CHECK`s de faixa/modalidade, e devolver `platform_billing_preview`/
`platform_billing_close` ao cálculo de alíquota única anterior a este ADR.
