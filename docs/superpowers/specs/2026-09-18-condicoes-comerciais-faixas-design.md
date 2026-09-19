# Design: percentual por faixa regressiva de faturamento, por organização

**Data:** 2026-09-18 · **Decisor:** Diego · **ADR:** [0165](../../decisions/0165-faixas-regressivas-por-organizacao.md)

## Contexto

A página pública (`docs/brand/landing/index.html`) anuncia percentual regressivo por faixa de
faturamento mensal (até 100K / 100–300K / 300–500K / +500K) nas duas modalidades. O sistema real
(`platform_commercial_terms`) só grava um `revenue_bps` fixo por contrato — sem faixa — e não trava
nenhuma regra ligando modalidade a quais campos ela pode cobrar. Levantamento no código (ADR-0155,
ADR-0158) confirma que isso foi decisão deliberada na v1 ("os preços da apresentação são referências
negociáveis"), mas o Diego identificou que a prática divergiu do que devia: a faixa nunca é revista
quando o faturamento cresce, e duas organizações têm campos preenchidos que a modalidade delas não
deveria ter.

Medição em produção (2026-09-18, leitura read-only, sem nenhum mês fechado ainda):

| org | modality | monthly_fee_cents | revenue_bps | sonar_unit_cents |
|---|---|---|---|---|
| Avil | 2 | 0 | 700 | 120 |
| Daludi Shop | 1 | 60000 | 500 | **120** ← viola a regra |
| DSA | 1 | 60000 | 500 | **120** ← viola a regra |

`platform_billing_statements`: 0 linhas fechadas. `platform_sonar_deliveries`: 6 linhas (DSA,
2026-09, todas `units=0`). Efeito monetário do dado incorreto até hoje: zero.

## Decisões fechadas com o Diego (não reabrir)

1. Cortes de faixa fixos e iguais para toda organização: ≤ R$100.000 / ≤ R$300.000 / ≤ R$500.000 /
   acima — em centavos de faturamento líquido do mês: 10.000.000 / 30.000.000 / 50.000.000.
2. Os 4 percentuais **dentro** de cada faixa são editáveis por organização.
3. A faixa aplicada é escolhida automaticamente todo mês, sem confirmação humana — não é uma
   renegociação, é o cálculo normal da cobrança mensal.
4. Modalidade 1 nunca cobra Sonar do cliente (`sonar_unit_cents` deve ser `0`); modalidade 2 nunca
   tem infra separada (`monthly_fee_cents` deve ser `0`). Violação **rejeita** o salvamento com erro
   — nunca normaliza em silêncio (regra financeira inegociável do projeto).
5. Rótulos do formulário passam a usar os nomes reais dos planos.
6. Corrigir agora o Sonar de Daludi Shop/DSA (zerar), na própria migration — efeito medido é zero.
7. Devolução tardia usa a alíquota **congelada** do fechamento original, nunca recalcula a faixa de
   um mês já fechado.
8. Sem trava de monotonia entre as 4 faixas (o intervalo 0–10000 já barra erro grosseiro; não foi
   pedido).

## Armadilha encontrada durante o desenho (não estava no pedido original)

`platform_billing_close` grava a alíquota aplicada em `platform_billing_statements.revenue_bps`, e a
CTE `origin` de `platform_billing_preview` (recálculo de crédito por devolução tardia de meses
anteriores) usa **essa** coluna, não o termo comercial. Se o cálculo por faixa não expuser
explicitamente qual alíquota foi aplicada naquele mês, o crédito de devolução tardia usa o número
errado em silêncio. Por isso o preview passa a expor `applied_bps`/`applied_tier`, e o close grava
`applied_bps` em vez de reler o termo.

## Abordagem escolhida

Substituir a coluna única por 4 colunas fixas, corrigir o dado incorreto na mesma migration, e não
manter nenhum shape legado (`coalesce` permanente foi descartado — ver "Alternativas descartadas").

### Schema (`platform_commercial_terms`)

Uma migration, uma transação:

```sql
alter table public.platform_commercial_terms
  add column revenue_bps_t1 integer,
  add column revenue_bps_t2 integer,
  add column revenue_bps_t3 integer,
  add column revenue_bps_t4 integer;

-- backfill: as 4 faixas nascem iguais ao revenue_bps atual de cada org (comportamento
-- idêntico ao de hoje até a próxima renegociação real).
alter table public.platform_commercial_terms disable trigger platform_commercial_terms_no_mutation;

update public.platform_commercial_terms
  set revenue_bps_t1 = revenue_bps, revenue_bps_t2 = revenue_bps,
      revenue_bps_t3 = revenue_bps, revenue_bps_t4 = revenue_bps;

-- corrige o dado errado medido em produção (decisão 6): nenhuma organização modalidade 1
-- deveria cobrar Sonar do cliente.
update public.platform_commercial_terms set sonar_unit_cents = 0 where modality = 1;

alter table public.platform_commercial_terms enable trigger platform_commercial_terms_no_mutation;

-- trava LOUD: se alguma linha ficou sem backfill, a migration falha aqui em vez de
-- silenciosamente permitir NOT NULL sobre dado nulo.
do $$
begin
  if exists (
    select 1 from public.platform_commercial_terms
    where revenue_bps_t1 is null or revenue_bps_t2 is null
       or revenue_bps_t3 is null or revenue_bps_t4 is null
  ) then
    raise exception 'backfill de faixas incompleto' using errcode = '23514';
  end if;
end $$;

alter table public.platform_commercial_terms
  alter column revenue_bps_t1 set not null,
  alter column revenue_bps_t2 set not null,
  alter column revenue_bps_t3 set not null,
  alter column revenue_bps_t4 set not null,
  add constraint platform_commercial_terms_tiers_range check (
    revenue_bps_t1 between 0 and 10000 and revenue_bps_t2 between 0 and 10000
    and revenue_bps_t3 between 0 and 10000 and revenue_bps_t4 between 0 and 10000
  ),
  add constraint platform_commercial_terms_modality_shape check (
    (modality <> 1 or sonar_unit_cents = 0)
    and (modality <> 2 or monthly_fee_cents = 0)
  ),
  drop column revenue_bps;
```

`add column`/`drop column` são operações de metadado (não passam pelo trigger de imutabilidade); só
os dois `update` de backfill exigem a janela com o trigger desabilitado, dentro da mesma transação da
migration.

### Função auxiliar (faixa aplicável)

```sql
create function public.platform_terms_tier_bps(
  p_base_cents bigint, p_t1 integer, p_t2 integer, p_t3 integer, p_t4 integer
) returns integer
language sql immutable set search_path = '' as $$
  select case
    when p_base_cents <= 10000000 then p_t1
    when p_base_cents <= 30000000 then p_t2
    when p_base_cents <= 50000000 then p_t3
    else p_t4
  end
$$;
```

Cortes inclusivos à esquerda; cliff (não marginal) — a base inteira paga a alíquota da faixa em que
caiu, igual ao que a página pública já comunica (R$100.000,00 → 5%; R$100.000,01 → 4%). Única função
com os cortes fixos — nenhuma reimplementação em TypeScript (`_shared/platform-admin/billing.ts` não
tem caminho de produção, ver "Fora de escopo").

### RPCs

- **`platform_save_terms`**: troca o bloco de validação de `revenue_bps` por 4 blocos idênticos
  (`jsonb_typeof = 'number'`, regex de inteiro não-negativo, 0–10000) para `revenue_bps_t1..t4`.
  Adiciona, antes do insert: `if v_modality = 1 and v_sonar_unit <> 0 then raise exception 'Modalidade 1 não cobra Sonar do cliente: informe 0,00' using errcode = '22023'; end if;` e o espelho para
  modalidade 2 / `monthly_fee_cents`. O `CHECK` de tabela é a rede que pega qualquer caminho que não
  passe pela RPC; a mensagem em pt-BR na RPC é o que o operador lê na tela.
- **`platform_billing_preview`**: troca `v_fee := round(v_base::numeric * v_terms.revenue_bps / 10000)::bigint`
  por `v_applied_bps := public.platform_terms_tier_bps(v_base, v_terms.revenue_bps_t1, v_terms.revenue_bps_t2, v_terms.revenue_bps_t3, v_terms.revenue_bps_t4); v_fee := round(v_base::numeric * v_applied_bps / 10000)::bigint;`.
  O objeto retornado ganha `applied_bps` e `applied_tier` (1–4) no nível raiz (ao lado de `fee_cents`
  etc.), e o label da linha `revenue` usa `v_applied_bps` em vez de um `revenue_bps` que não existe
  mais.
- **`platform_billing_close`**: grava `(v_preview->>'applied_bps')::integer` em
  `platform_billing_statements.revenue_bps` (mantém o nome de coluna da tabela de statements — ela é
  histórica e independente do schema de termos). Isso preserva o comportamento já existente da CTE
  `origin` (crédito de devolução tardia usa a alíquota congelada do fechamento, decisão 7) sem tocar
  na matemática do crédito.

### Front-end

- `_shared/platform-admin/types.ts`: `CommercialTermsInput`/`CommercialTerms` trocam `revenue_bps:
  number` por `revenue_bps_t1..t4: number`. `BillingPreview` ganha `applied_bps: number | null` e
  `applied_tier: 1 | 2 | 3 | 4 | null`.
- `_shared/platform-admin/validation.ts`: bloco de `revenue_bps` vira 4 blocos (mesma regra 0–10000),
  mais a validação de modalidade espelhada em TS (mesma mensagem da RPC) — autoridade continua sendo
  o Postgres, a validação em TS só melhora a mensagem antes do round-trip.
- `commercial-terms-form.tsx`:
  - 4 inputs de percentual (um por faixa) em vez de um.
  - `initialState`: default por modalidade nas 4 faixas (5/4/3,5/3 para modalidade 1, 7/6/5,5/5 para
    modalidade 2), mesmo padrão do `revenueTouched` já existente.
  - Campo "Sonar por consulta" desabilitado e fixo em `0,00` quando `modality === '1'`; campo
    "Infraestrutura mensal" desabilitado e fixo em `0,00` quando `modality === '2'` — sem isso o
    formulário manda o default de sempre (`monthly: 60_000`, `sonar: 120`) e o servidor passa a
    rejeitar todo salvamento.
  - Opções do select: `"Modalidade 1 · Gestão Completa Daludi"` / `"Modalidade 2 · Gestão Completa +
    Inteligência"`.
  - Card-resumo e histórico: mostram a faixa configurada (ex.: "5% a 3%") em vez de um número só.
- `org-billing.tsx:81`, `OrganizacaoDetalhe.tsx:168`, `lib/export/platform-billing.ts:19`: passam a
  ler `preview.applied_bps` (com rótulo indicando a faixa aplicada) em vez de `terms?.revenue_bps`.

## Migração de dados

Feita inteiramente dentro da migration SQL (ver "Schema" acima) — não depende de ação humana
posterior. As 3 organizações existentes (Avil, Daludi Shop, DSA) saem da migration com as 4 faixas
iguais ao `revenue_bps` que tinham antes (comportamento de cobrança idêntico ao atual até a próxima
renegociação real) e, para Daludi Shop/DSA, `sonar_unit_cents = 0` (corrigindo o dado errado medido).

## Testes

- `supabase/tests/platform_commercial.sql` (ou arquivo equivalente já existente para
  `platform_save_terms`): salvar rejeita modalidade 1 com `sonar_unit_cents > 0` e modalidade 2 com
  `monthly_fee_cents > 0`, com a mensagem em pt-BR; salvar grava as 4 faixas corretamente.
- `supabase/tests/platform_billing.sql` (ou equivalente): `platform_terms_tier_bps` nos 8 pontos de
  borda (10.000.000, 10.000.001, 30.000.000, 30.000.001, 50.000.000, 50.000.001, valor abaixo do
  primeiro corte, valor bem acima do último); `platform_billing_preview` retorna `applied_bps`/
  `applied_tier` condizentes com a base do mês; `platform_billing_close` grava `applied_bps` em
  `statements.revenue_bps`; crédito de devolução tardia continua usando a alíquota congelada.
- `commercial-terms-form.test.tsx`, `org-billing.test.tsx`, `OrganizacaoDetalhe.test.tsx`,
  `platform-billing.test.ts` (export): atualizar fixtures de `revenue_bps: 500` para as 4 chaves;
  adicionar caso de campo desabilitado por modalidade.
- Rodar a migration sobre uma cópia com as 3 linhas reais e conferir que `t1..t4` saem iguais ao
  `revenue_bps` antigo e que `sonar_unit_cents` das 2 organizações modalidade 1 vira `0`.

## Riscos

- **Único ponto de risco real**: a janela em que o trigger de imutabilidade fica desabilitado
  durante o backfill. Mitigado por: transação única, asserção `raise exception` se alguma linha
  ficar sem backfill antes de reabilitar o trigger, e precedente já aberto pelo ADR-0164 de alterar
  comportamento dessa mesma tabela por motivo documentado.
- Nenhum mês fechado (`platform_billing_statements` vazia) — mudança de schema não tem histórico
  congelado para preservar; risco de regressão em dado histórico é inexistente hoje.

## Fora de escopo

- Trava de monotonia entre as 4 faixas (decisão 8: não implementar).
- Recalcular faixa de mês já fechado em devolução tardia (decisão 7: não implementar).

## Revisão do Fable (2026-09-18) — aprovado com ressalvas, incorporadas abaixo

Veredito: design fiel ao schema real e correto na lógica de faixa/CHECK/`applied_bps`. Quatro ajustes
obrigatórios antes de implementar:

**1. Duas migrations, não uma — a cadeia de testes `\ir` exige.** `platform_commercial.sql` aplica
`.../20260918000000_adr164_implantacao_sobrevive_renegociacao.sql` por último (schema +
`platform_save_terms`); `platform_billing.sql` aplica depois `.../20260907102428_platform_terms_contract_fix.sql`
(`platform_billing_preview`/`close`). Uma migration só não dá pra encaixar nos dois pontos. Split:

- **Migration 1 — `platform_commercial_terms_tiers`**: schema (`revenue_bps_t1..t4`, backfill,
  `drop column revenue_bps`, os dois `CHECK`s) + `create or replace function platform_save_terms`
  **reemitida a partir do corpo de `20260918000000` (com o bloco de herança do ADR-0164), não do
  `20260907210746`** — reemitir da versão errada perderia a herança da implantação. `\ir`'da em
  `supabase/tests/platform_commercial.sql` logo após a linha do `20260918000000`.
- **Migration 2 — `platform_billing_tiers`**: `platform_terms_tier`/`platform_terms_tier_bps`,
  `create or replace function platform_billing_preview` e `platform_billing_close` com `applied_bps`/
  `applied_tier`. `\ir`'da em `supabase/tests/platform_billing.sql` logo após a linha do
  `20260907102428`.

**Fixture quebrada por isso**: `supabase/tests/platform_sonar.sql:24-31` insere 2 termos direto na
tabela (bypassando a RPC) com `modality=1, sonar_unit_cents=125` e `275` — o novo `CHECK` de forma
rejeita as duas. Ajustar para `modality=2` (já têm `monthly_fee_cents=0`, então já satisfazem o
`CHECK` de modalidade 2) e trocar a coluna `revenue_bps` do insert pelas 4 novas colunas.

**2. `_shared/platform-admin/billing.ts` não pode ficar intocado — sai nesta entrega.** O CI roda
`deno check` fora de `__tests__/`; `billing.ts:26` lê `terms.revenue_bps`, que deixa de existir no
tipo `CommercialTerms`. Reimplementar a faixa em TypeScript recriaria uma segunda fonte dos cortes —
exatamente o que este design evita. Como é código morto confirmado (nenhum importador de produção),
apagar `billing.ts` e `__tests__/billing.test.ts` faz parte desta entrega, não é decisão em aberto.

**3. Backfill do Sonar precisa ser LOUD sobre o dado medido, não só sobre `NULL`.** Trocar
`where modality = 1` (corrige qualquer linha que exista no dia do deploy) por
`where modality = 1 and sonar_unit_cents <> 0` (a violação específica medida), capturar
`get diagnostics v_corrigidas = row_count` logo após o `update`, e `raise exception` se
`v_corrigidas <> 2` — o número medido em produção vira a asserção, não uma suposição. Inserir uma
linha em `platform_audit_events` (`category='admin'`, `action='platform_terms_sonar_corrected'`,
`actor_id=null`, `reason` citando este ADR) para cada organização corrigida — a tabela existe
justamente para isso ser rastreável, não só o comentário da migration.

**4. `begin;`/`commit;` explícitos** envolvendo todo o bloco de backfill (desabilitar trigger →
updates → asserções → reabilitar trigger) na Migration 1 — a mitigação inteira depende da transação
ser atômica; o projeto já teve incidente de `db push` sem transação.

**Não bloqueante, incorporado por ser trivial**: `applied_tier` ganha derivação própria —
`platform_terms_tier(p_base_cents bigint) returns smallint` (só os 3 cortes, cliff), e
`platform_terms_tier_bps` passa a chamá-la internamente — um único lugar com 10.000.000/30.000.000/
50.000.000 em vez de duas cópias do `CASE`.

**Ordem de deploy** (a edge function e a RPC mudam de contrato juntas):
`supabase db push` (as 2 migrations, nessa ordem) → `supabase functions deploy platform-admin materializar-metricas`
(as duas importam `_shared/platform-admin/`) → merge do front. Na janela entre o `db push` e o
deploy das functions, a edge antiga ainda manda `revenue_bps` — a RPC nova rejeita (erro alto e
claro, não silencioso; janela é curta e aceitável).

**Chamada tomada para esta entrega** (não era pedido original, mas é corolário direto da mesma trava
de modalidade): a linha `sonar` do preview/fechamento passa a não aparecer quando
`terms.sonar_unit_cents = 0` — mesmo padrão condicional que `setup`/`credits` já usam — em vez de
mostrar "Consultas Sonar N × R$0,00" pra organizações modalidade 1.
