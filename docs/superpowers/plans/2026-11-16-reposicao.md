# Reposição de estoque e pedido de compra — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela "Reposição" que diz, por SKU, o que e quanto comprar (pela velocidade de venda, prazo e cobertura da org), transforma a sugestão em pedido de compra aprovado por admin, baixa o pedido na entrada de mercadoria e avisa todo dia o que piorou.

**Architecture:** Um módulo TS puro (`supabase/functions/_shared/reposicao/calculo.ts`, sem imports) faz toda a conta; um módulo de IO (`dados.ts`) monta a entrada a partir do banco com poucas queries. A edge `reposicao` (JWT) serve a tela e grava as ações; a edge `reposicao-diaria` (QStash) grava a foto diária e manda o resumo. Recebimento entra na **mesma transação** da entrada de estoque. Front lê só pela edge.

**Tech Stack:** Supabase (Postgres + RLS + Edge Functions Deno), QStash, React + TanStack Query + Tailwind + Radix (`src/components/ui/*`), vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-reposicao-design.md` · ADR: `docs/decisions/0207-reposicao-de-estoque-e-pedido-de-compra.md` · Glossário: `CONTEXT.md` › Reposição de estoque. **Ler os três antes de qualquer task.** Números do ADR (§2–§16) são lei; a conta abaixo os transcreve. Revisão do plano: Grok 4.7 xhigh (16/11), achados aplicados.

## Global Constraints

- Classificação **crítica** (estoque, pedido de compra, migration): revisão independente obrigatória (Opus high ou Codex `gpt-6.1-sol` high) nas Tasks 1, 4 e 7, sem rebaixar modelo.
- Migration só com `supabase migration new` + `supabase db push`; validar com `npm run db:check` (ADR-0043). `git fetch` e conferir timestamp mais novo antes do push (migration paralela).
- RLS por `org_id` em toda tabela nova; escrita só pela edge (service role) ou RPC. Nenhuma policy de INSERT/UPDATE/DELETE para `authenticated`.
- Edges idempotentes; `reposicao-diaria` com `verify_jwt=false` + `verificarAssinatura` (QStash); `reposicao` com `verify_jwt=true` + `_shared/auth-org.ts`.
- Aprovar pedido: só admin (`isAdmin`, ou suporte `scope='full'`), no servidor; o front só espelha (`usePodeExecutarOperacao`).
- Select de formulário sempre `src/components/ui/select.tsx`. Texto de tela só com os rótulos do glossário: Ruptura, Vai faltar, Pedir agora, Em dia, A caminho, Pedido atrasado, Encerrar saldo, Não repor. Nada de "Excesso" na v1.
- Custo do produto = `variacoes.custo` (R$). Nunca `familias.custo_centavos`.
- Datas de janela em BRT (`America/Sao_Paulo`); janela de 60 dias termina **ontem**. Todo teste passa `hoje` explícito (ex.: `'2026-11-16'`); nunca `new Date()` no módulo puro.
- Ledger (ADR-0094): venda `mercado_livre:<order>:<codigo>`; demanda usa `abs(coalesce(quantidade_pedida, quantidade))` (D-8: `quantidade` é só o que baixou); `estorno_venda` (`estorno:mercado_livre:<order>:<codigo>`) é **só cancelamento** (D-7; devolução não gera movimento).
- Não há histórico de pausa do anúncio no banco (medido 16/11): dia disponível conta desde a primeira publicação e pausa conta como disponível; a tela declara esse limite (Task 6).
- Portão de pré-push: `pnpm preflight`.
- Fora da v1 (não implementar): PDF, aba Fornecedores, gráfico de projeção, Excesso, teto em R$, prazo por fornecedor, pedido mínimo, tela de acurácia.

## Review Focus

1. **Organização sem nenhuma venda / família toda zerada há 60 dias** → velocidade 0, nada a pedir, sem divisão por zero, estado "Sem vendas na janela". Teste em Task 3 (`familia sem venda`).
2. **SKU novo, sem venda e sem publicação** → w = 0, recebe só a parcela da curva, sem alterar a soma da família. Teste em Task 2 (`sku recem-criado`).
3. **Dois cliques em "Aprovar" / duas entradas simultâneas no mesmo item** → um pedido aprovado; `recebida` nunca passa de `quantidade`. Teste em Task 4 (`aprovar 2x`) e Task 1 (`concorrencia`).
4. **Pedido com SKU que depois virou Não repor** → pedido continua recebível; sugestão não reaparece. Teste em Task 3 e Task 7.
5. **Entrada maior que o pedido** → item fecha, excedente vai só para o estoque. Teste em Task 1 (`excedente`).

---

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_reposicao.sql` | tabelas, RLS, RPCs de recebimento, módulo, categoria de notificação |
| `supabase/tests/reposicao.sql` | teste SQL (transação desfeita) |
| `supabase/functions/_shared/reposicao/calculo.ts` | conta pura: demanda → velocidade → projeção → quantidade → urgência |
| `supabase/functions/_shared/reposicao/dados.ts` | lê o banco e monta `EntradaCalculo` + DTOs da tela |
| `supabase/functions/_shared/reposicao/__tests__/*.test.ts` | testes vitest do puro e do IO |
| `supabase/functions/reposicao/index.ts` | GET da tela |
| `supabase/functions/reposicao/acoes.ts` | ações POST (separadas da leitura) |
| `supabase/functions/reposicao-diaria/index.ts` | foto diária + resumo |
| `supabase/functions/{entrada-estoque,importar-nota-compra,desfazer-nota-compra}/index.ts` | repassam `pedidoCompraId` à RPC de entrada |
| `src/hooks/useReposicao.ts` | query + mutations |
| `src/pages/Reposicao.tsx` | página (abas Sugestões e Pedidos) |
| `src/components/reposicao/*` | cards, lista, mapa da grade, popover, rascunho, sheet do pedido |

---

### Task 1: Migration — modelo de dados, RLS, recebimento atômico, módulo e categoria

**Files:**
- Create: `supabase/migrations/<ts>_reposicao.sql`, `supabase/tests/reposicao.sql`
- Modify: `src/lib/modulos.ts`, `supabase/functions/usuarios/modulos-org.ts:5`, `src/lib/menus.ts` (`MENU_KEYS` + `PREFIX['reposicao']`), `src/lib/notificacoes-categorias.ts:3`, `supabase/functions/_shared/notificacoes/categorias.ts`, `src/lib/database.types.ts`; a RPC de entrada de estoque usada por `processarEntrada` (`supabase/functions/_shared/estoque/` → localizar o nome em `entrada-estoque`) e a de entrada da nota de compra

**Interfaces — Produces (nomes exatos):**
- `reposicao_config(org_id uuid pk, prazo_dias int check 1..180, cobertura_dias int check 1..365, atualizado_por uuid, atualizado_em timestamptz)`
- `familias.multiplo_compra int not null default 1 check (multiplo_compra >= 1)`
- `fornecedores(id uuid pk, org_id, nome text, nome_normalizado text, cnpj text null, criado_em)` unique `(org_id, nome_normalizado)`
- `reposicao_nao_repor(id, org_id, escopo text check in ('sku','cor','familia'), codigo_pai text, codigo text null, cor text null, criado_por, criado_em)` + **índice único** `(org_id, escopo, codigo_pai, coalesce(codigo,''), coalesce(cor,''))`
- `pedidos_compra(id uuid pk, org_id, fornecedor_id fk, status text check in ('rascunho','aprovado','enviado','parcial','recebido','saldo_encerrado'), previsto_para date, criado_por, criado_em, salvo_por, salvo_em, aprovado_por, aprovado_em, enviado_em, alterado_por, alterado_em, ref_aprovacao text unique)`; índice único parcial `(org_id, fornecedor_id) where status='rascunho'`
- `pedidos_compra_itens(pedido_id fk, org_id, codigo, codigo_pai, quantidade int > 0, sugerida int, recebida int default 0, encerrado bool default false, check (recebida between 0 and quantidade))` pk `(pedido_id, codigo)`
- `pedidos_compra_recebimentos(id, org_id, pedido_id, codigo, quantidade int > 0, referencia_externa text not null, criado_em, desfeito_em null)` unique `(org_id, referencia_externa)`
- `reposicao_fotos(org_id, dia date, codigo, codigo_pai, estoque int, velocidade numeric, w numeric, sugestao int, urgencia text)` pk `(org_id, dia, codigo)`
- Função interna `reposicao_receber(p_org, p_pedido, p_codigo, p_quantidade, p_ref) returns jsonb` → `{recebida, saldo, status_pedido}`:
  - idempotente por `p_ref` (insert do recebimento com `on conflict do nothing`; se já existia, devolve o estado atual);
  - **atômica**: `update pedidos_compra_itens set recebida = least(quantidade, recebida + p_quantidade) … returning` (sem ler-e-depois-escrever);
  - recusa (`raise`) se o pedido não é da org, não está em `aprovado|enviado|parcial`, ou não tem item `p_codigo`;
  - recalcula status: todos os itens `recebida = quantidade` ou `encerrado` → `recebido`; algum `recebida > 0` → `parcial`.
- **Entrada e recebimento na mesma transação:** a RPC de entrada de estoque e a de entrada da nota ganham `p_pedido_compra uuid default null`; com valor, chamam `reposicao_receber` com a `referencia_externa` do movimento recém-criado, dentro da mesma transação. Falha no recebimento desfaz a entrada inteira. Sem o parâmetro, comportamento atual intacto.
- Nota de compra: com `p_pedido_compra`, se `fornecedores.cnpj` do pedido não for nulo e diferir do `emitente_cnpj` → `raise 'pedido de outro fornecedor'`; se for nulo, grava o CNPJ.
- `reposicao_desfazer_recebimentos(p_org uuid, p_refs text[]) returns int` → marca `desfeito_em`, subtrai de `recebida` (piso 0), recalcula status: com algum recebido → `parcial`; senão `enviado` se `enviado_em` não nulo, senão `aprovado`. Chamada de dentro da RPC de desfazer nota.
- RPCs: `security definer`, `search_path=''`, `grant execute` só a `service_role`; revoke de `public/anon/authenticated` **antes** de trocar dono (lição de `reference_estoque_push_ml`); RPCs de estoque continuam do role `estoque_rpc_executor`.
- Módulo `'reposicao'` (`ModuloId`, `MODULOS` com `menu: 'reposicao'`, `MODULOS_VALIDOS`). `MenuKey` `'reposicao'`; a migration acrescenta `'reposicao'` a `profiles.allowed_menus` de quem já tem `'estoque'`.
- Categoria `'reposicao'` nas duas listas + as 2 CHECKs (`notificacoes_categoria_check`, `profiles_telegram_categorias_validas`), como no ADR-0134.

- [ ] **Step 1: Escrever `supabase/tests/reposicao.sql`** (padrão `supabase/tests/adr195_confirmacoes_ml.sql`, transação com rollback). Asserts:
  - `mesma ref 2x`: `recebida` soma 1 vez;
  - `excedente`: entrada de 12 num item de 10 → `recebida = 10`, status `recebido`, estoque +12;
  - `parcial`: 4 de 10 → `parcial`;
  - `concorrencia`: dois `reposicao_receber` de 8 com refs diferentes num item de 10 → `recebida = 10` (o CHECK nunca dispara porque o UPDATE usa `least`);
  - `desfazer`: volta `recebida = 0` e status `enviado` (com `enviado_em`) ou `aprovado`;
  - `outro fornecedor`: nota com CNPJ diferente do fornecedor do pedido → erro, e nenhum movimento de estoque gravado;
  - `falha desfaz entrada`: pedido em `rascunho` → erro e estoque inalterado;
  - `authenticated` sem `execute` nas RPCs (`has_function_privilege` = false);
  - segundo rascunho do mesmo fornecedor viola o índice único.
- [ ] **Step 2:** `supabase migration new reposicao` e escrever a migration.
- [ ] **Step 3:** `npm run db:check` → sem erro. Rodar o teste SQL pelo procedimento de `reference_teste_sql_sem_docker` → todos os asserts passam e o rollback limpa.
- [ ] **Step 4:** Editar as listas TS (módulo, menu, categoria) e regenerar `database.types.ts`. `pnpm test -- notificacoes modulos menus` verde.
- [ ] **Step 5:** Revisão independente (Codex `gpt-6.1-sol` high, read-only, só o diff). Corrigir.
- [ ] **Step 6:** Commit `feat(reposicao): modelo de dados, RLS e recebimento atômico (ADR-0207)`.

### Task 2: Cálculo puro — demanda e velocidade

**Files:** Create `supabase/functions/_shared/reposicao/calculo.ts`, `.../__tests__/calculo-demanda.test.ts`

**Interfaces — Produces:**
```ts
export interface SkuEntrada { codigo: string; codigoPai: string; cor: string | null; tamanho: string | null;
  estoqueHoje: number; publicadoEm: string | null; naoRepor: boolean; ehKit: boolean }
export interface MovDia { dia: string /*YYYY-MM-DD BRT*/; codigo: string; vendidas: number /*pedida, pedidos não cancelados*/;
  precos: number[] /*unit_price de cada unidade vendida direta*/; estoqueInicio: number }
export interface KitLink { kitCodigo: string; baseCodigo: string; unidadesPorKit: number }
export interface PedidoAberto { codigo: string; saldo: number; previstoPara: string }
export interface EntradaCalculo { hoje: string; prazo: number; cobertura: number; skus: SkuEntrada[];
  movs: MovDia[]; kits: KitLink[]; pedidosAbertos: PedidoAberto[]; multiploPorFamilia: Record<string, number> }
export interface VelocidadeSku { codigo: string; propria: number; diasDisponiveis: number; unidades: number;
  w: number; usada: number /*sem tendência*/; picoLimitadoEm: string[]; vendasEmOferta: number }
export interface TendenciaFamilia { fator: number; variacaoVendas: number /*recente/base − 1*/ }
export function calcularVelocidades(e: EntradaCalculo): { porSku: Map<string, VelocidadeSku>;
  tendenciaPorFamilia: Map<string, TendenciaFamilia | null> }
```
`usada` **não** inclui a tendência; o fator é aplicado uma única vez, na Task 3.

Ordem obrigatória (ADR §5): unidades/dia → dia atípico (família) → oferta → velocidade própria (direta + kit) → curva → mistura + reescala → tendência.

Regras:
- Janela: 60 dias BRT terminando em `hoje − 1`.
- Dia disponível do SKU: dia ≥ `publicadoEm` (BRT) e (`estoqueInicio > 0` ou `vendidas > 0`). SKU sem `publicadoEm` → 0 dias.
- `vendidas` já chega sem os pedidos cancelados (Task 4 remove o par venda/estorno). Venda com `origem_kit_codigo_pai` já está no SKU da base e conta como venda direta.
- Dia atípico: na família, sobre os dias com venda direta; mediana m; dia com total > 3m e ≥ 4 → teto 3m, corte repartido nos SKUs do dia proporcional às unidades.
- Oferta: unidade com preço ≤ 0,85 × p75 dos preços do SKU na janela; com **menos de 5 vendas** do SKU na janela, p75 dos preços da família. Conta na velocidade; sai da tendência.
- **Velocidade própria** = (unidades diretas ÷ dias disponíveis da base) + Σ por kit (vendas do SKU do kit × `unidadesPorKit` ÷ dias disponíveis **do kit**). Divisor 0 → parcela 0. SKU com `ehKit` nunca entra na saída.
- w = min(1, unidades do SKU ÷ 6) (unidades = diretas + kit). Curva = share_cor × share_tam (shares pela velocidade própria; SKU sem cor/tamanho → share 1 nessa dimensão), normalizada entre elegíveis (não `naoRepor`) para somar 1. usada = w·própria + (1−w)·curva·vFamília; depois reescala para Σ usada = vFamília (= Σ próprias dos elegíveis).
- Tendência (família): só com ≥ 28 dias disponíveis da família (dia com algum SKU disponível). Dias com venda em oferta saem do numerador **e** do denominador nas duas janelas. recente = unidades ÷ dias nos últimos 14 dias disponíveis sem oferta; base = unidades ÷ dias nos 60. Acelerando: recente ≥ 1,3·base e ≥ 5 vendas recentes; Esfriando: recente ≤ 0,7·base e base·14 ≥ 5. fator = (recente + base) ÷ (2·base); senão `null`.

- [ ] **Step 1: Testes** em `calculo-demanda.test.ts`, todos com `hoje: '2026-11-16'`:
  - `ruptura nao esconde demanda`: 3 vendas em 4 dias disponíveis, 9 dias zerado → `propria = 0.75`.
  - `dia antes da publicacao nao conta`: estoque desde 2026-10-18, publicado 2026-11-03, 13 vendas até 2026-11-15 → `diasDisponiveis = 13`.
  - `kit divide pelos dias do kit`: base com 0 vendas em 20 dias disponíveis; kit vende 4 em 2 dias disponíveis, `unidadesPorKit 2` → `propria(base) = 4` (8 ÷ 2), não 0,4; kit fora da saída.
  - `dia atipico na familia`: dias [1,1,1,12] → dia de 12 vira 3.
  - `campanha longa marcada`: 30 un a 100 e 30 a 80 → as 30 a 80 são oferta (p75 = 100).
  - `oferta sai do denominador da tendencia`: 14 dias recentes, 4 com oferta (20 un), 10 dias com 10 un → recente = 1,0.
  - `fator 1,2 aplicado uma vez`: base 1, recente 1,4 → `fator = 1.2` e `usada` sem o fator.
  - `mistura cria parcela para quem nao vendeu`: grade 2×2, vendas [[3,0],[0,1]], 13 dias → SKU (cor1, tam2) com `usada > 0` **e** Σ usada = 4/13 (±1e-9).
  - `sku recem-criado`: SKU sem publicação → w 0, `usada > 0` pela curva, Σ família inalterada.
  - `tendencia so com 28 dias`: 27 dias → `null`; `esfriando`: base 0,5/dia, recente 0,3 em 28+ dias → fator 0,8; `esfriando exige base de 5`: base 0,3, recente 0 → `null`.
- [ ] **Step 2:** `pnpm test -- calculo-demanda` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar `calcularVelocidades` (arquivo sem imports, para o front poder importar).
- [ ] **Step 4:** `pnpm test -- calculo-demanda` → PASS.
- [ ] **Step 5:** Commit `feat(reposicao): velocidade por dia disponível, curva e tendência`.

### Task 3: Cálculo puro — projeção, quantidade e urgência

**Files:** Modify `supabase/functions/_shared/reposicao/calculo.ts`; Create `.../__tests__/calculo-quantidade.test.ts`

**Interfaces — Consumes:** `calcularVelocidades`. **Produces:**
```ts
export type Urgencia = 'ruptura' | 'vai_faltar' | 'pedir_agora' | 'em_dia';
export interface SugestaoSku extends VelocidadeSku { codigoPai: string; estoqueHoje: number; v: number /*usada × fator*/;
  aCaminho: number; chegaEm: string | null; diasDeEstoque: number | null; pedirAntesMultiplo: number; pedir: number;
  urgencia: Urgencia; poucoHistorico: boolean }
export interface ResultadoReposicao { skus: SugestaoSku[]; familias: { codigoPai: string; pedir: number;
  pedirAntesMultiplo: number; tendencia: TendenciaFamilia | null; urgencia: Urgencia }[];
  pctEstimadoPelaFamilia: number /*0..1, entre SKUs com venda na janela*/ }
export function quantilPoisson(media: number, p: number): number;
export function calcularReposicao(e: EntradaCalculo): ResultadoReposicao;
```
Regras (ADR §9–§14):
- `v = usada × (fator ?? 1)`.
- Projeção por SKU, d = 1..prazo+cobertura, `E_0 = estoqueHoje`: `E_d = max(0, E_{d−1} − v) + chegadas_d`. Pedido aberto chega em `d = max(1, previstoPara − hoje em dias)` (atrasado ou previsto para hoje → d = 1).
- `disp = E_prazo + Σ chegadas em (prazo, prazo+cobertura]`; `falta = max(0, v·cobertura − disp)`.
- Folga da família = `quantilPoisson(Λ, 0.85) − Λ`, Λ = Σ v·cobertura (ADR §11, sem descontar sobras de outros SKUs); repartida entre SKUs com `falta > 0` proporcional a v; nenhum SKU com falta → folga 0.
- Alvo do SKU = falta + parcela da folga; SKU com unidades nos últimos 30 dias, `E_prazo = 0` e não `naoRepor` → alvo ≥ 1. `naoRepor` → alvo 0.
- Família: `antes = ceil(Σ alvos)`; `total = ceil(antes / múltiplo) × múltiplo`; distribuir `total` pelo maior resto dos alvos (cada SKU recebe `floor(alvo)`, o restante vai aos maiores restos, empate pela maior v). Σ `pedir` = total sempre.
- `quantilPoisson`: menor k com P(X ≤ k) ≥ p por soma acumulada; média > 500 → `ceil(m + 1.0364·√m)`; média 0 → 0.
- Urgência (nesta ordem): ruptura = `estoqueHoje = 0 && v > 0`; vai_faltar = algum `E_d = 0` com d < prazo e v > 0; pedir_agora = `pedir > 0`; senão em_dia. Família = pior SKU.
- `diasDeEstoque` = menor d com `E_d = 0`, ou `null` se não zera no horizonte. `poucoHistorico = w < 1`. `pctEstimadoPelaFamilia` = SKUs com venda na janela e w < 1 ÷ SKUs com venda na janela (0 se nenhum).

- [ ] **Step 1: Testes** em `calculo-quantidade.test.ts`, todos com `hoje: '2026-11-16'`, prazo 15, cobertura 30. Os quatro primeiros são os critérios de aceite do ADR:
  - `aceite 1 — aprovar nao gera nova sugestao`: 1 SKU, v = 1, estoque 0 → `pedir = 36`; com `PedidoAberto {saldo 36, previstoPara '2026-12-01'}` → `pedir = 0`.
  - `aceite 2 — pedir > 0 nunca e em_dia`: tabela fechada de 6 casos (estoque 0/5/40 × v 0,15/1) → para cada um, `pedir > 0 ⇒ urgencia ≠ em_dia`.
  - `aceite 3 — soma fecha com multiplo`: família de 4 SKUs, v [0,07; 0,1; 0,07; 0,03], estoque 0, múltiplo 6 → `Σ pedir = total` e `total % 6 = 0`.
  - `aceite 4` fica na Task 1/7 (fornecedor B não baixa A).
  - `poisson protege`: Λ = 30 e disp 0 → `pedir = 36`, não 30.
  - `poisson de media baixa`: v·cob = 0,15, vendeu nos 30 dias, E_prazo 0 → `pedir = 1` (pelo mínimo 1).
  - `sobra de um tamanho nao cobre outro`: SKU A v 0,5 e estoque 0 (falta 15); SKU B v 0,5 e estoque 50 (sobra); Λ 30 → folga 6 inteira em A: `pedir A = 21`, `pedir B = 0`.
  - `previsto para hoje chega`: pedido `previstoPara '2026-11-16'` saldo 50, v 1, estoque 0 → `E_15 = 36`, `pedir = 0` (com saldo 36 pediria 8: o teste prova que o pedido chega em d = 1).
  - `atrasado chega amanha`: `previstoPara '2026-11-10'`, saldo 40, v 0,5, estoque 2 → `pedir = 0`, urgência `em_dia`.
  - `familia sem venda`: todas v = 0 → pedir 0, em_dia, sem NaN.
  - `nao repor`: SKU marcado → pedir 0 e fora da curva.
- [ ] **Step 2:** `pnpm test -- calculo-quantidade` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm test -- calculo` → PASS (Tasks 2 e 3).
- [ ] **Step 5:** Commit `feat(reposicao): projeção diária, folga na família e urgência`.

### Task 4: IO + edge `reposicao` (tela e ações)

**Files:** Create `supabase/functions/_shared/reposicao/dados.ts`, `.../__tests__/dados.test.ts`, `supabase/functions/reposicao/index.ts`, `supabase/functions/reposicao/acoes.ts`, `.../__tests__/acoes.test.ts`; Modify `supabase/config.toml` (`[functions.reposicao] verify_jwt = true`), `docs/reference/edge-functions.md`

**Interfaces — Consumes:** `calcularReposicao`, tabelas da Task 1. **Produces:**
- `montarEntrada(admin: SupabaseClient, orgId: string, hoje: string): Promise<EntradaCalculo | { semConfig: true }>`
- `SkuTela = { codigo, codigoPai, cor, corHex, tamanho, custo, preco, naoReporId: string | null }`; `FamiliaTela = { codigoPai, nome, fornecedor: {id: string | null, nome}, multiplo }`
- `PedidoDTO = { id, fornecedor: {id, nome, cnpj}, status, previstoPara, atrasado: boolean, salvoPor, salvoEm, aprovadoPor, enviadoEm, alteradoPor, alteradoEm, itens: {codigo, codigoPai, quantidade, sugerida, recebida, encerrado, codigoFornecedor: string | null}[] }` (`atrasado = status in (enviado, parcial) && previstoPara < hoje`; `codigoFornecedor` de `vinculos_fornecedor.cprod`)
- `GET /reposicao` → `{ config: {prazo, cobertura} | null, resultado: ResultadoReposicao, skus: SkuTela[], familias: FamiliaTela[], naoRepor: {id, escopo, codigoPai, codigo, cor}[], rascunhos: PedidoDTO[], pedidos: PedidoDTO[] }`
- `POST /reposicao` (`acoes.ts`) com `{ action, ref, ... }`: `salvar_config {prazo, cobertura}` · `salvar_rascunho {fornecedorNome, previstoPara?, itens:[{codigo, codigoPai, quantidade, sugerida}]}` (cria fornecedor por `nome_normalizado` se não existir; notifica no app, categoria `reposicao`, só admins, chave `rascunho:<pedidoId>:<dia>`) · `aprovar {pedidoId}` (**admin**; idempotente por `ref` em `ref_aprovacao`) · `marcar_enviado {pedidoId}` · `editar_pedido {pedidoId, previstoPara, itens:[{codigo, quantidade}]}` (409 se já houve recebimento) · `encerrar_saldo {pedidoId, codigos?: string[]}` / `reabrir_saldo {pedidoId, codigos?: string[]}` · `nao_repor {escopo, codigoPai, codigo?, cor?}` / `remover_nao_repor {id}`. Todas exigem módulo `reposicao` (403); só `aprovar` exige admin.

Fontes de `montarEntrada` (conferidas em produção, 16/11), em **no máximo 6 queries** (sem N+1):
1. `reposicao_config` (sem linha → `{semConfig:true}`).
2. `variacoes` + `familias` da org: `estoqueHoje = variacoes.estoque`, cor, tamanho, custo, `multiplo_compra`, `kit_base_codigo_pai`; `ehKit` = família com `kit_base_codigo_pai` ou `codigo_pai_kit` em `kits_variacao` (query 6).
3. `estoque_movimentos` da janela + o último movimento anterior à janela por código (uma query com `distinct on`): `estoqueInicio` de cada dia sai do `estoque_resultante` anterior, em memória. Vendas: `abs(coalesce(quantidade_pedida, quantidade))`; pares venda/`estorno_venda` com o mesmo `<order>:<codigo>` saem os dois. Pares `kit_saida`/`kit_entrada` por `transferencia_id` → `KitLink` (`unidadesPorKit = |saida| ÷ entrada`).
4. `ml_vendas_itens` (`order_id`, `codigo`, `unit_price`) das orders da janela → `precos`; sem casar → sem preço, nunca oferta.
5. `anuncios_externos` (`canal='mercado_livre'`): menor `publicado_em` por `codigo_pai`.
6. `kit_variacao_componentes` + `kit_variacao_skus` + `kits_variacao` → `KitLink`; base de kit vinculado com 1 SKU e sem transferência → esse SKU com `kit_multiplicador`. Kit sem base resolvida: fora da conta e `console.warn` com o código.
- `pedidosAbertos` de `pedidos_compra` em `aprovado|enviado|parcial` × itens não `encerrado`: `saldo = quantidade − recebida` (> 0). Rascunho não conta.
- `naoRepor` por SKU: escopo `sku` = o código; `cor` = SKUs da família com essa cor; `familia` = todos.
- Estoque montado em kit não soma na base (só `variacoes.estoque` do SKU da base).

- [ ] **Step 1: Testes** `dados.test.ts` com cliente falso (padrão `_shared/notificacoes/gerencial/__tests__`): ref parseada; par venda/estorno some; venda com `quantidade_pedida 5` e `quantidade −2` conta 5; par de transferência vira `KitLink` 2:1; rascunho e item encerrado fora de `pedidosAbertos`; Não repor de cor marca só os SKUs daquela cor; sem `reposicao_config` → `{semConfig:true}`; cliente falso registra **≤ 6** queries.
- [ ] **Step 2: Testes** `acoes.test.ts` (deps injetadas, padrão `entrada-estoque`): `aprovar 2x` mesma ref → 1 aprovação; membro não admin → 403; `editar_pedido` após recebimento → 409; sem módulo → 403; `salvar_rascunho` notifica só admins.
- [ ] **Step 3:** FAIL → implementar → PASS (`pnpm test -- reposicao`).
- [ ] **Step 4:** `deno check supabase/functions/reposicao/index.ts` e `pnpm lint:functions`. Medir em produção, depois do deploy da Task 9, o tempo do GET da DSA (maior histórico); se passar de 1,5 s de CPU, abrir issue antes de ligar a fase 2.
- [ ] **Step 5:** Revisão independente (Codex `gpt-6.1-sol` high: diff + `calculo.ts` + ADR). Corrigir.
- [ ] **Step 6:** Commit `feat(reposicao): edge da tela e ações do pedido`.

### Task 5: Edge `reposicao-diaria` (foto diária + resumo)

**Files:** Create `supabase/functions/reposicao-diaria/index.ts`, `supabase/functions/_shared/reposicao/resumo.ts`, `.../__tests__/resumo.test.ts`, `docs/runbooks/reposicao-diaria.md`; Modify `supabase/config.toml`, `docs/reference/edge-functions.md`

**Interfaces — Consumes:** `montarEntrada`, `calcularReposicao`, `PedidoDTO`. **Produces:** `montarResumo(hoje: SugestaoSku[], anterior: Map<string, Urgencia>, atrasados: PedidoDTO[], rascunhosEsperando: number): string | null` (null = sem novidade); `gravarFoto(admin, orgId, dia, r: ResultadoReposicao): Promise<void>`.

Molde: `supabase/functions/resumo-diario/index.ts` (sem body → 1 job por org com módulo `reposicao`; `{orgId, dia}` → processa). Por org: `anterior` = urgências da **foto mais recente com `dia < hoje`** (não necessariamente ontem); upsert `reposicao_fotos` do dia (idempotente pela pk); resumo lista SKUs cuja urgência hoje ∈ {ruptura, vai_faltar, pedir_agora} e na foto anterior era melhor ou ausente; mais pedidos atrasados e rascunhos esperando; envia na categoria `reposicao` com chave `reposicao:<org>:<dia>`; link `/#/reposicao?urgencia=<pior>`. Schedule QStash `30 11 * * *` (08:30 BRT, depois do `resumo-diario`).

- [ ] **Step 1: Testes** `resumo.test.ts`: piora em_dia→pedir_agora entra; pedir_agora→pedir_agora não entra; ruptura→pedir_agora (melhorou) não entra; **dia sem foto** (anterior de 2 dias atrás) não reenvia o que já foi avisado; nada novo e sem atrasado → `null`; texto agrupa por produto e cor ("Calça Sarja · Marrom Escuro: 42, 44"); `gravarFoto` 2× no mesmo dia → 1 linha por SKU (cliente falso).
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** Commit `feat(reposicao): foto diária e resumo de reposição`.

### Task 6: Tela — Sugestões

**Files:** Create `src/pages/Reposicao.tsx`, `src/hooks/useReposicao.ts`, `src/components/reposicao/{config-inicial,cards-urgencia,lista-familias,mapa-grade,popover-celula,por-que,aviso-loja}.tsx`, testes em `src/components/reposicao/__tests__/`; Modify `src/App.tsx` (rota `/reposicao`), `src/components/sidebar.tsx:22` (item após Estoque, ícone `ShoppingCart`)

**Interfaces — Consumes:** `GET/POST /reposicao` (Task 4); tipos de `calculo.ts` e `dados.ts` importados de `../../supabase/functions/_shared/reposicao/...` (como `faixa-kpis.tsx:13`). `chaveGrade` de `src/lib/cadastro-grade.ts` para ordenar cor/tamanho. **Produces:** `useReposicao()` → `{ data, salvarConfig, salvarRascunho, aprovar, marcarEnviado, editarPedido, encerrarSaldo, reabrirSaldo, naoRepor, removerNaoRepor }`; `urgenciaDoProduto(data, codigoPai): Urgencia | null` (usado pelo selo do Estoque na Task 8).

Layout, estados e copy: spec §2–§7, sem desvio. Venda perdida por dia = `v × preco` dos SKUs em ruptura. "Por quê" usa `tendencia.variacaoVendas` (variação das vendas) e `fator − 1` (ajuste no pedido). O popover declara o limite: "Pausas do anúncio ainda não entram na conta."

- [ ] **Step 1: Testes** (Testing Library): sem config → só o painel de 2 campos com a frase do exemplo; `pctEstimadoPelaFamilia > 0.5` → faixa "N% dos produtos ainda estimados pela família" e sem venda perdida; card clicado filtra a lista; célula mostra `"2 · pedir 4"` e `aria-label` com cor, tamanho, estoque, pedir e urgência por texto; célula de curva mostra "Estimado pelas outras cores e tamanhos deste produto."; "Por quê" com fator 1,2 e variação 0,4 mostra "pedido +20% (vendas subiram 40%…)"; popover mostra o limite das pausas; produto sem variação não renderiza mapa; menu "Reposição" some sem o módulo; `?produto=<codigo_pai>` abre expandido; Não repor marca a célula riscada e "Remover" chama `removerNaoRepor(id)`.
- [ ] **Step 2:** FAIL → implementar → PASS (`pnpm test -- reposicao`).
- [ ] **Step 3:** Commit `feat(reposicao): tela de sugestões com mapa da grade`.

### Task 7: Recebimento pela entrada manual e pela nota de compra

**Files:** Modify `supabase/functions/entrada-estoque/index.ts`, `supabase/functions/importar-nota-compra/index.ts`, `supabase/functions/desfazer-nota-compra/index.ts`, o diálogo de entrada em `src/components/estoque/` e o de nota de compra; Create testes junto dos existentes dessas edges

**Interfaces — Consumes:** parâmetro `p_pedido_compra` das RPCs de entrada (Task 1), `reabrir_saldo`/`encerrar_saldo` (Task 4). **Produces:**
- `entrada-estoque` e `importar-nota-compra` aceitam `pedidoCompraId?: string` e o repassam à RPC (recebimento na mesma transação; erro da RPC → 400 com a mensagem em pt-BR, nada gravado). Sem `pedidoCompraId` → contrato e resposta atuais intactos.
- `desfazer-nota-compra`: nenhuma mudança na edge se a RPC de desfazer já chamar `reposicao_desfazer_recebimentos` (Task 1); só o teste.
- Front: campo "De qual pedido?" (`Select`, opções = pedidos `aprovado|enviado|parcial` que têm o SKU, mais "Nenhum"); pré-seleção na nota = pedido aberto do fornecedor com CNPJ igual ao emitente; na manual, "Nenhum". Após entrada que deixa saldo: diálogo "Chegaram X de Y do pedido <fornecedor>. O restante ainda vem?" → Não lista os itens e chama `encerrar_saldo`; o pedido mostra "Reabrir saldo".

- [ ] **Step 1: Testes**: `aceite 4 — fornecedor B nao baixa A` (nota com CNPJ de B e `pedidoCompraId` de A → 400 e estoque intacto; pré-seleção escolhe o pedido de B); `sem pedidoCompraId` → resposta idêntica à de hoje (snapshot do contrato); `desfazer nota` → recebida volta; pedido de SKU depois marcado Não repor continua recebível; diálogo de saldo: "Não" chama `encerrar_saldo` com os códigos listados.
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** Revisão independente (Opus high, contexto limpo: diff + ADR §16). Corrigir.
- [ ] **Step 4:** Commit `feat(reposicao): recebimento do pedido pela entrada e pela nota`.

### Task 8: Tela — rascunho, pedido e aba Pedidos; portas de entrada

**Files:** Create `src/components/reposicao/{barra-rascunho,sheet-pedido,aba-pedidos,texto-whatsapp}.tsx` + testes; Modify `src/pages/Estoque.tsx` (botão "Reposição" no `PageHeader`), `src/components/estoque/produto-card.tsx` (selo de urgência via `urgenciaDoProduto`, só com módulo `reposicao`; leva a `/#/reposicao?produto=`)

**Interfaces — Consumes:** `useReposicao`, `urgenciaDoProduto` (Task 6). **Produces:** `textoWhatsApp(pedido: PedidoDTO, skus: SkuTela[], familias: FamiliaTela[]): string` puro.

- [ ] **Step 1: Testes**: "Adicionar ao pedido" cria/atualiza o rascunho do fornecedor; quantidade editada mostra a sugerida ao lado; não admin vê "Aprovar pedido" desabilitado com a dica "Só administrador aprova o pedido"; "Copiar para WhatsApp" chama `marcar_enviado`; `textoWhatsApp` agrupa "Calça Sarja Marrom Escuro: 38×2 40×1 42×6" e inclui `codigoFornecedor` quando houver; aba Pedidos mostra os 6 estados, "Atrasado" e o atraso em dias; editar pedido com recebimento mostra a recusa; selo no card do Estoque leva à rota com `?produto=` e não aparece sem o módulo.
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** Commit `feat(reposicao): rascunho, aprovação, WhatsApp e pedidos`.

### Task 9: Entrega — docs, validação real, deploy

**Files:** `docs/TASKS.md`, `docs/project-status.md`, `docs/reference/modelo-de-dados.md`, `docs/reference/edge-functions.md`, ADR-0207 (status), Graphify

- [ ] **Step 1:** `pnpm preflight` → verde.
- [ ] **Step 2:** Revisão da branch inteira (Opus high, contexto limpo). Corrigir.
- [ ] **Step 3:** CI verde → merge fast-forward na `main` (só com OK do Diego).
- [ ] **Step 4:** Deploy, nesta ordem:
  1. `supabase functions deploy usuarios` → conferir a versão.
  2. `supabase db push` (as 3 migrations: `20261116231928_reposicao`, `20261117004919_reposicao_acoes`, `20261117020908_reposicao_entrada_lote`).
  3. `npm run db:check`.
  4. As demais edges afetadas (lista medida com `deno info --json` em cada `index.ts`: importam `_shared/notificacoes/categorias.ts` e/ou `_shared/reposicao/*` mudados nesta branch, ou foram editadas nela) → conferir versões:
     `supabase functions deploy acompanhar-migracao-pxv adicionar-variacoes-familia ads-campanhas atualizar-status-publicado confirmar-publicacao-ml criar-kit-variacao criar-kit-vinculado criar-kit-virtual entrada-estoque fechar-mes-plataforma galeria-aplicar galeria-aprovar galeria-despachante galeria-gerar galeria-worker gerar-capa-kit-unidades gerar-capa-kit-virtual gerar-foto-kit importar-nota-compra ingest-lote kit-reposicao kit-transferencia monitorar-moderados notificar-carrinho notificar-liberacao operacoes-massa platform-admin process-familia publicar-familias publicar-split-ml publish-familia-ml pulse-coletar reconciliar-convergencia-up reconciliar-estoque reconciliar-faturamento remover-publicado reposicao-diaria reposicao resumo-diario sincronizar-estoque sincronizar-promocoes subir-foto-kit-virtual sync-devolucao sync-mensagem sync-pergunta sync-venda telegram-bot update-familia-ml vincular-catalogo`
     (49 edges; 45 só por `categorias.ts`. `desfazer-nota-compra` fica de fora: só o teste mudou e o grafo dela não inclui nenhum arquivo alterado — a mudança dela é na RPC, que vem pela migration.)
  5. Criar schedule QStash `30 11 * * *` e registrar o `scheduleId` em `edge-functions.md`.
- [ ] **Step 5:** Ligar o módulo na Zaven (Central) e validar com o Diego, sessão Playwright própria (skill `playwright-cli`), print real: no dia, consultar no banco os SKUs da Calça Sarja com estoque 0 e venda na janela e conferir que todos aparecem em Ruptura; conferir 1 SKU à mão contra o ledger (dias disponíveis, velocidade, pedir). Nenhum pedido real é aprovado sem o Diego.
- [ ] **Step 6:** Docs (`docs-update-checklist`), ADR-0207 → ACEITO, Graphify update no checkout principal, memória `project_reposicao.md`. Commit `docs(reposicao): entrega`.
