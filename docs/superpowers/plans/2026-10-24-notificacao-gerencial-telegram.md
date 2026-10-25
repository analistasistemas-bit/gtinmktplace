# Notificação gerencial de venda, resumo diário e comandos Telegram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O admin recebe pelo Telegram uma mensagem por carrinho (total, lucro, KPIs do dia e do mês), um resumo às 8h e respostas a 5 comandos de leitura. A notificação operacional por pedido não muda.

**Architecture:**
- **Lucro.** Sai de uma porta Deno do rateio **por item** da tela (`agruparPorPedido` → `cascataDoPedido`), presa a ela por teste de paridade que importa o código do front.
- **KPIs de período.** Faturamento, pedidos e ticket saem de uma RPC no banco, que fica leve por carrinho. O lucro do período (resumo e comandos) sai do motor da central (`metrics-repository.ts`) com o resultado por item.
- **Estado durável.** A espera do carrinho fica em `notificacao_carrinho`, com varredura de recuperação. As mensagens do bot ficam em `telegram_updates`: inbox, depois QStash, depois worker.
- **Permissão.** "Só admin + chat privado" é aplicada em `notificarCategoria`, na edge `usuarios` e no worker do bot.

**Tech Stack:** Supabase Edge Functions (Deno), Postgres/PostgREST, QStash (`_shared/queue.ts`), Telegram Bot API, React + Vitest.

**Spec:** `docs/decisions/0190-notificacao-gerencial-de-venda-e-comandos-telegram.md` (+ `docs/reference/glossario.md`: Carrinho, Notificação gerencial de venda, Resumo diário, Crescimento do mês, Lucro (do pedido), Margem s/ venda, Markup). Revisão do Codex `gpt-6.1-sol` high (2026-10-24, 20 achados) incorporada nesta versão.

## Global Constraints

- **Categorias.** As novas são `vendas_gerencial` e `resumo_diario`. `vendas` não muda.
- **Destinatário.** Recebe e consulta apenas profile `is_active`, da mesma org e com `is_admin = true`.
  - Telegram exige `telegram_chat_id` **positivo** (o de grupo é negativo).
  - In-app vale para todo admin assinante.
- **Lucro (do pedido/carrinho).** Mesma conta da `cascataDoPedido`: `venda − comissão − frete do vendedor − imposto − custo`, antes de Ads.
  - O custo por item é `round2(custoUnit × quantity)`, com custo `> 0`.
  - O lucro fica **vazio** com motivo se faltar custo em algum item faturável, se a alíquota não estiver confirmada ou se o frete não foi lido (`frete_vendedor` nulo com `shipping_id`). Nunca lucro = líquido.
- **Lucro de período** (resumo, `/hoje`, `/mes`, `/top`) é a soma dos itens com lucro calculável, exibida sempre com a linha de cobertura. Sem alíquota confirmada → `Lucro: — (alíquotas de imposto não confirmadas)`.
- **Rótulos.** "Margem s/ venda" (lucro ÷ venda) e "Markup" (lucro ÷ custo), nunca "margem" sozinha.
- **Privacidade.** Sem nome do comprador nas mensagens gerenciais.
- **Fuso.** `America/Sao_Paulo`, offset fixo `-03:00` (`BRT_OFFSET`).
- **Crescimento do mês.** Mês anterior do dia 1 até o fim do dia correspondente (clamp no último dia). Base zero → `sem base de comparação`.
- **Carrinho.** No máximo uma mensagem por carrinho; teto **absoluto** de 600 s desde o primeiro pagamento.
- **Resumo.** 08:00 BRT (QStash cron `0 11 * * *`), dia anterior fechado, rodapé `Dados apurados até HH:MM`.
- **Comandos.** `/hoje`, `/ontem`, `/mes`, `/top`, `/ajuda`; nenhum de escrita, sem `/saldo`.
- **Formato.** Texto puro, sem `parse_mode`. Dinheiro `R$ 1.234,56` com espaço normal.
- **Edges.** As chamadas por QStash/Telegram usam `verify_jwt = false`.
- **Migrations.** Só `supabase migration new` + `db push`; `npm run db:check`.
- **Tabelas novas.** RLS ligada sem policies (só service role): são estado interno, não domínio exibido.
- **Leituras.** Toda leitura de lista usa paginação ordenada (`readPages` de `metrics-repository.ts`) ou agregação SQL. Nenhuma leitura sem `range` acima de 1.000 linhas.
- **CPU.** Medir `CPUTime` (metadata dos logs da edge), não duração. Alvo < 1.000 ms por execução.
- **Segredos.** `TELEGRAM_WEBHOOK_KEY` só em secret de edge.

## Desvio deliberado do ADR

- **D-6 "lotes retomáveis (ADR-0173)":** o `resumo-diario` faz fan-out por org via QStash sem `_shared/rodada`. O trabalho por execução é limitado (1 org, 1 dia, 1 mês lido em páginas). O retry é estável porque `dia` vai na mensagem. A idempotência vem de `notificarCategoria(..., { chave })`. A CPU é medida na Task 10, e se passar de 1.000 ms o caminho é migrar para `rodada`.

## Review Focus

1. **Pack com order cancelada, nunca paga, ou atravessando a virada do mês.** O carrinho é lido por `pack_id`, sem janela. Só faturáveis entram. No prazo sai parcial; se nenhuma estiver paga, não envia. → Tasks 3 e 6.
2. **Retry e concorrência** (2 orders do pack simultâneas, `sync-venda` reexecutado depois de `novaPaga` virar `false`, QStash perdendo a publicação). O estado em tabela + a varredura entregam exatamente o agendamento. → Task 6.
3. **Virada de dia, mês e ano em BRT e meia-noite exata.** → Task 2.
4. **Bot:** grupo, não-admin, chat de outra org, secret errado, mesmo bot em 2 orgs, retry do Telegram. → Task 8.
5. **Lucro com item sem custo, multi-item com custo parcial, frete não lido, alíquota não confirmada, quantidade > 1.** → Task 3.

---

### Task 1: Categorias novas + "só admin, chat privado"

**Files:**
- Modify: `supabase/functions/_shared/notificacoes/categorias.ts`, `.../destinatario.ts`, `.../config.ts`
- Modify: `supabase/functions/usuarios/index.ts:101-110`
- Create: migration `categorias_gerenciais_telegram`
- Test: `supabase/functions/_shared/notificacoes/__tests__/config.test.ts`

**Interfaces — Produces:**
- `CATEGORIAS_NOTIFICACAO` acrescenta `'vendas_gerencial', 'resumo_diario'`.
- `export const CATEGORIAS_SO_ADMIN = ['vendas_gerencial', 'resumo_diario'] as const satisfies readonly CategoriaNotificacao[]`.
- `export const chatPrivado = (chatId: string | null | undefined): boolean` (só inteiro positivo).
- `sanitizarDestinatario(input, alvo?: { isAdmin: boolean })`, com o mesmo retorno.
- `export async function temAssinanteGerencial(admin: SupabaseClient, orgId: string, categoria: 'vendas_gerencial' | 'resumo_diario'): Promise<boolean>`. É `true` se existe profile ativo, admin e assinante (vale in-app, então não exige chat).

- [ ] **Step 1: Failing tests:**
  - `notificarCategoria('vendas_gerencial')`:
    - a query de assinantes recebe `.eq('is_admin', true)`;
    - com assinantes de chats `'123'`, `'123'` (outro profile) e `'-100555'`, `enviarTelegram` é chamado **1×** com `'123'` e retorna `1`;
    - o insert in-app recebe as 3 linhas.
  - `notificarCategoria('vendas')` não filtra `is_admin`, envia para `-100555`, e os chats duplicados continuam como hoje (regressão).
  - `sanitizarDestinatario`:
    - não-admin + `resumo_diario` → erro `'Notificações gerenciais são só para admin.'`;
    - admin + chat `-100555` + `vendas_gerencial` → erro `'Notificações gerenciais exigem conversa privada com o bot (chat_id positivo).'`;
    - admin + chat vazio + `vendas_gerencial` → ok (recebe só in-app).
  - `chatPrivado('123')` → true; `chatPrivado('-1')` → false; `chatPrivado(null)` → false.
- [ ] **Step 2: Run** `pnpm test -- supabase/functions/_shared/notificacoes/__tests__/config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Em `queryAssinantes`, adicionar `.eq('is_admin', true)` quando a categoria é só-admin. A leitura estrita usa a mesma query.
  - Para categorias só-admin, o Telegram usa `[...new Set(chatIds.filter(chatPrivado))]` em `notificarCategoria`, `notificarCategoriaComChave` e `lerDestinatarios`.
  - Em `usuarios.update_notificacoes`, ler `is_admin` do alvo (`id` + `org_id`) antes de sanitizar.
- [ ] **Step 4: Migration.** Recriar **os dois** CHECKs com as 11 categorias, no formato de `20260825180755_alerta_estoque_zerado.sql`:
  - `profiles_telegram_categorias_validas` (linhas 27-30);
  - `notificacoes_categoria_check` (linhas 21-23).

  Rodar `npm run db:check` e, em seguida, o teste SQL desfeito (`scripts/teste-sql-desfeito.py`, ver `reference_teste_sql_sem_docker`): inserir `notificacoes(categoria='resumo_diario')` e `profiles.telegram_categorias = '{vendas_gerencial}'` dentro da transação, com `raise 'TESTE_OK'`. Expected: TESTE_OK.
- [ ] **Step 5: Run** `pnpm test -- supabase/functions/_shared/notificacoes`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(notificacoes): categorias gerenciais só para admin em chat privado (ADR-0190 D-1/D-7)`.

### Task 2: Janelas BRT

**Files:** Create `supabase/functions/_shared/notificacoes/gerencial/janelas.ts`; Test `.../gerencial/__tests__/janelas.test.ts`

**Interfaces — Produces:**
- `export interface JanelaIso { desde: string; ate: string }`. Intervalo `[desde, ate)`, ISO com `-03:00`, exceto `ate = agora` (ISO Z).
- `export function diaBrt(instante: Date): string` (`YYYY-MM-DD`).
- `export function janelaDia(dia: string): JanelaIso`.
- `export interface JanelasMes { mes: JanelaIso; anterior: JanelaIso; rotuloMes: string; rotuloAnterior: string }`.
- `export function janelasMesCorrente(agora: Date): JanelasMes`. O mês corrente vai do dia 1 00:00 BRT até `agora`. Comandos e carrinho usam esta.
- `export function janelasMesFechado(dia: string): JanelasMes`. Vai do mês de `dia` até o **fim** de `dia`. O resumo usa esta.
- Nas duas, `anterior` = dia 1 do mês anterior até o fim do dia correspondente (clamp). `rotuloMes` é `Outubro`; `rotuloAnterior` é `1–24/set`, com en dash e mês abreviado minúsculo.
- `export function horaBrt(instante: Date): string` (`HH:MM`).

- [ ] **Step 1: Failing tests:**
  - `janelasMesCorrente(new Date('2026-10-24T17:00:00Z'))` → `mes.desde '2026-10-01T00:00:00-03:00'`, `mes.ate '2026-10-24T17:00:00.000Z'`, `anterior { '2026-09-01T00:00:00-03:00', '2026-09-25T00:00:00-03:00' }`, rótulos `'Outubro'` e `'1–24/set'`.
  - **Meia-noite exata:** `janelasMesCorrente(new Date('2026-11-01T03:00:00Z'))` → `mes.desde '2026-11-01T00:00:00-03:00'` e `rotuloAnterior '1–1/out'`.
  - `janelasMesFechado('2026-10-31')` → `mes { '2026-10-01T00:00:00-03:00', '2026-11-01T00:00:00-03:00' }`, `anterior.ate '2026-10-01T00:00:00-03:00'`, `rotuloAnterior '1–30/set'`.
  - `janelasMesFechado('2026-10-23')` → `anterior.ate '2026-09-24T00:00:00-03:00'`.
  - **Virada de ano:** `janelasMesFechado('2027-01-05').anterior.desde === '2026-12-01T00:00:00-03:00'`.
  - `diaBrt(new Date('2026-10-25T02:59:00Z'))` → `'2026-10-24'`; `diaBrt(new Date('2026-10-25T03:01:00Z'))` → `'2026-10-25'`.
  - `janelaDia('2026-10-23')` → `{ '2026-10-23T00:00:00-03:00', '2026-10-24T00:00:00-03:00' }`.
  - **Paridade com a tela:** com `vi.setSystemTime(new Date('2026-10-24T17:00:00Z'))`, `Date.parse(janelasMesCorrente(agora).anterior.ate) === Date.parse(janelaAnterior(resolverJanela(MES_ATUAL), MES_ATUAL).ate) + 1`. Import `'../../../../../../src/lib/metricas'` (seis `../`; o vitest roda com `TZ=America/Sao_Paulo`).
- [ ] **Step 2: Run** `pnpm test -- supabase/functions/_shared/notificacoes/gerencial/__tests__/janelas.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Aritmética em UTC com −3 h fixo e tabela fixa de meses (`jan…dez`, `Janeiro…Dezembro`), sem `Intl`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(notificacoes): janelas BRT do gerencial com paridade da tela (ADR-0190 D-3)`.

### Task 3: Resultado por item, pedido e carrinho (porta da tela)

**Files:**
- Create: `supabase/functions/_shared/notificacoes/gerencial/resultado.ts`
- Create: `supabase/functions/_shared/preco/semaforo.ts` (cópia de `src/lib/semaforo.ts`)
- Modify: `supabase/functions/_shared/platform-admin/metrics-repository.ts`. Exportar o núcleo de `computeMonth` sem mudar comportamento; `titulo` entra no select de itens de `SALES_COLUMNS`.
- Test: `.../gerencial/__tests__/resultado.test.ts`; regressão de `_shared/platform-admin/__tests__/metrics-repository.test.ts` e `metrics-parity.test.ts`, sem alterar asserts.

**Interfaces — Produces:**
- Em `metrics-repository.ts`:
  - `export type Rates`;
  - `export interface ContextoCalculo { maps: MapasCusto | undefined; rates: Rates | null; custosOk: boolean; configOk: boolean }`;
  - `export async function carregarContexto(db: MetricsDb, orgId: string, desde: string): Promise<ContextoCalculo>`. Usa `loadConfigState` + RPC `platform_org_cost_catalog` (`p_since: desde`), como `computeMonth`;
  - `export async function lerVendasJanela(db: MetricsDb, orgId: string, j: JanelaIso): Promise<Venda[]>`. Usa `readPages` + `SALES_COLUMNS` + `normalizeSales` em `date_closed ∈ [desde, ate)`;
  - `export async function lerVendasDoCarrinho(db: MetricsDb, orgId: string, chave: { packId: number | null; orderId: number }): Promise<Venda[]>`. Lê por `pack_id = packId`, ou `order_id = orderId` sem pack, **sem janela de data**.
- Em `resultado.ts`:
  - `export type MotivoSemLucro = 'sem_custo' | 'frete_nao_lido' | 'aliquota_nao_confirmada'`.
  - `export interface ResultadoItem { orderId: number; packChave: string; codigo: string | null; titulo: string | null; quantidade: number; venda: number; liquido: number; imposto: number; custo: number | null; custoEstimado: boolean; faturavel: boolean; freteNaoLido: boolean }`.
  - `export function resultadoPorItem(vendas: Venda[], ctx: ContextoCalculo): ResultadoItem[]`. **Porta fiel** de `agruparPorPedido` (`src/lib/pedidos-faturamento.ts:133`):
    - mesmo `ratearLiquidoPorFrete`, com fallback `rateio.get(v.id)?.liquido ?? v.liquido ?? 0` como o `liquidoMembro` da tela (grupo de 1 membro e grupo sem frete não entram no mapa);
    - mesma fatia de líquido por `valorDoItem` entre os faturáveis, com o resíduo de centavos no maior item;
    - `custoDoItem` = `round2(unit × quantity)`, onde `unit = custo_congelado ?? montarCustoResolver(ctx.maps)(item)` e só vale com `unit > 0`;
    - `impostoDoItem(item, montarAliquotaResolver(ctx.maps, ctx.rates), uf)`.

    Para cada linha divergente da tela, um comentário `// espelha pedidos-faturamento.ts:<linha>`.
  - `export interface ResultadoCarrinho { venda: number; itens: number; lucro: number | null; motivo: MotivoSemLucro | null; margemSobreVenda: number | null; markup: number | null; prejuizos: { titulo: string; valor: number }[]; semCusto: string[] }`.
  - `export function resultadoCarrinho(itens: ResultadoItem[], configOk: boolean): ResultadoCarrinho`. Só considera faturáveis. Prioridade do motivo: `aliquota_nao_confirmada` > `frete_nao_lido` > `sem_custo`. `prejuizos` = itens com `liquido − imposto − custo < 0`.
  - `export interface LucroPeriodo { lucro: number | null; motivo: 'aliquota_nao_confirmada' | null; pctVendaComLucro: number; vendaSemCusto: number; vendaCustoEstimado: number; pedidosFreteNaoLido: number; markup: number | null }`.
  - `export function lucroDoPeriodo(itens: ResultadoItem[], configOk: boolean): LucroPeriodo`. Soma só os itens faturáveis com custo e com frete lido.
  - `export function topPorLucro(itens: ResultadoItem[], n: number): { titulo: string; lucro: number }[]`. Agrupa por `codigo ?? titulo`, só com itens de lucro calculável.
  - `export function contarAtencao(itens: ResultadoItem[], pisoPorCodigo: Map<string, number>): { abaixoMinimo: number; prejuizo: number; semCusto: number }`. Usa `calcularSemaforo((liquido − imposto) / quantidade, piso, custo / quantidade)`.

- [ ] **Step 1: Failing tests:**
  - **Fixture mínima calculada à mão** (pedido sem pack, 1 item, quantidade 2):
    - venda 100,00 · sale_fee_total 10 · frete 10 · liquido 80 · custo congelado unit 20 · 8% nacional confirmado;
    - `resultadoCarrinho` → `{ venda: 100, itens: 1, lucro: 32, margemSobreVenda: 0.32, markup: 0.8, motivo: null }`.
  - **Paridade com a tela (núcleo do plano):** para cada fixture abaixo, montar as mesmas `Venda`s no tipo do front e comparar `resultadoCarrinho(resultadoPorItem(...)).lucro` com `cascataDoPedido(agruparPorPedido(vendas, custoResolver, pesoResolver, undefined, aliquotaResolver)[0]).margem`, ao centavo. Importar `src/lib/pedidos-faturamento` e `src/lib/cascata-pedido` com seis `../`.
    - (a) pack de 2 orders com frete compartilhado R$ 10 e comissões 10 / 9,80;
    - (b) order multi-item (2 itens) com custo parcial;
    - (c) pack com 1 order cancelada;
    - (d) item com quantidade 3.
  - Motivos:
    - (b) → `lucro null`, `motivo 'sem_custo'`, `semCusto` com o título do item sem custo;
    - frete nulo com `shipping_id` → `motivo 'frete_nao_lido'`;
    - `configOk false` → `motivo 'aliquota_nao_confirmada'` e `lucroDoPeriodo(...).lucro === null`.
  - **Prejuízo mascarado:** order de 2 itens, um com lucro +10 e outro com −4,10 → `prejuizos [{ valor: -4.1 }]`, embora o pedido some +5,90.
  - `lucroDoPeriodo` com 1 item sem custo de venda 50 e 1 item com custo de venda 150 → `pctVendaComLucro 0.75`, `vendaSemCusto 50`.
  - `lerVendasDoCarrinho` com fake db: a query usa `.eq('pack_id', X)` e **não** aplica filtro de `date_closed`.
- [ ] **Step 2: Run** `pnpm test -- supabase/functions/_shared/notificacoes/gerencial supabase/functions/_shared/platform-admin`. Expected: FAIL nos novos e PASS nos antigos.
- [ ] **Step 3: Implement** reaproveitando `ratearLiquidoPorFrete`, `valorDoItem`, `impostoDoItem`, `brutoDaVenda`, `ehFaturavel`, `montar*Resolver`. Nenhuma conta nova fora da porta.
- [ ] **Step 4: Run.** Expected: PASS, inclusive `metrics-parity.test.ts`.
- [ ] **Step 5: Commit** `feat(notificacoes): resultado por item com paridade da cascata do pedido (ADR-0190 D-2/D-5)`.

### Task 4: RPC de KPIs por janela

**Files:**
- Create: migration `vendas_kpis_janela`
- Create: `supabase/functions/_shared/notificacoes/gerencial/kpis.ts`
- Test: `.../gerencial/__tests__/kpis.test.ts` + teste SQL desfeito

**Interfaces — Produces:**
- `public.vendas_kpis_janela(p_org uuid, p_desde timestamptz, p_ate timestamptz) returns json`. Retorna `{ faturamento numeric, pedidos int, ticket numeric }`. É `security definer`, `set search_path = ''`, com `revoke` de `anon, authenticated` e grant só para `service_role`. Regras **iguais** a `calcularResumo`:
  - vendas com `date_closed ∈ [p_desde, p_ate)`;
  - faturável = `status in ('paid','partially_refunded','refunded')`;
  - faturamento = Σ `total_amount − coalesce(cupom_vendedor, 0)` dos faturáveis;
  - pedidos = número de `coalesce(pack_id, order_id)` distintos, contando o carrinho pelo status da venda representante, exatamente como `calcularResumo` (`sales-summary.ts:154-296`) — o implementador lê essa regra e a reproduz em SQL;
  - ticket = faturamento ÷ pedidos (0 se não houver pedidos).
- `export interface Kpis { faturamento: number; pedidos: number; ticket: number }`.
- `export async function lerKpis(admin: SupabaseClient, orgId: string, j: JanelaIso): Promise<Kpis>`. Lança em erro (nunca zera em silêncio).

- [ ] **Step 1: Failing test** (`kpis.test.ts`, fake client): `lerKpis` chama `rpc('vendas_kpis_janela', { p_org, p_desde, p_ate })` e converte números. Erro → `rejects.toThrow`.
- [ ] **Step 2: Run** e ver FAIL. **Implement** a migration + `kpis.ts`. Rodar `npm run db:check`.
- [ ] **Step 3: Teste SQL desfeito.** Inserir em transação 3 vendas de uma org fictícia: pack de 2 pagas + 1 cancelada. Assert `faturamento`, `pedidos = 1` e `ticket`, depois `raise 'TESTE_OK'`.
- [ ] **Step 4: Paridade com dado real.** É read-only, e o resultado vai no commit/PR. Para DSA e Avil, outubro até agora: `vendas_kpis_janela` × `resumirVendas(lerVendasJanela(...))` (`bruto`, `pedidos`, `ticket`), com divergência 0 ao centavo. Divergência → corrigir a RPC, nunca o motor.
- [ ] **Step 5: Commit** `feat(notificacoes): RPC de KPIs por janela com paridade da central (ADR-0190 D-2)`.

### Task 5: Textos

**Files:** Create `supabase/functions/_shared/notificacoes/gerencial/mensagens.ts`; Test `.../__tests__/mensagens.test.ts`; Modify `telegram.ts` (exportar `urlVendaML(id: number)`)

**Interfaces — Produces:**
- `export const brl = (n: number): string`.
- `export function linhaCrescimento(mes: number, anterior: number, rotuloAnterior: string): string`. Saídas: `+12,3% vs 1–24/set`, `−4,0% vs 1–24/set` ou `sem base de comparação`.
- `export interface KpisPeriodo { hoje: Kpis; mes: Kpis; anterior: Kpis; rotuloMes: string; rotuloAnterior: string }`.
- `export function montarMensagemCarrinho(c: ResultadoCarrinho, k: KpisPeriodo, chaveNumerica: number, estado: { parcial: { recebidos: number; total: number } | null; composicaoIncerta: boolean }): string`.
- `export interface DadosResumo { dia: string; ontem: Kpis; lucroOntem: LucroPeriodo; mes: Kpis; anterior: Kpis; rotuloMes: string; rotuloAnterior: string; top: { titulo: string; lucro: number }[]; atencao: { abaixoMinimo: number; prejuizo: number; semCusto: number }; devolucoes: { estornado: number; prazoProximo: number }; promocoes: { prejuizo: number; prazo: number } | null; freteSubiu: string[]; apuradoAte: string }`.
- `export function montarResumoDiario(d: DadosResumo): string`.
- `export function montarHoje(k: KpisPeriodo, l: LucroPeriodo): string`.
- `export function montarMes(k: KpisPeriodo, l: LucroPeriodo): string`.
- `export function montarTop(top: { titulo: string; lucro: number }[], rotuloMes: string): string`.
- `export const TEXTO_AJUDA`, `TEXTO_SEM_ACESSO`, `TEXTO_SO_PRIVADO`, `TEXTO_ERRO`.

- [ ] **Step 1: Failing tests** com strings exatas. Carrinho com `lucro 54.82`, venda 189,80, 2 itens; KPIs hoje 2340/14/167,14, mês 41200/260/158,46, anterior 36700:
```
💼 Venda R$ 189,80 — 2 itens
Lucro R$ 54,82 · Margem s/ venda 28,9% · Markup <markup da fixture>
Hoje: R$ 2.340,00 · 14 pedidos · ticket R$ 167,14
Outubro: R$ 41.200,00 · 260 pedidos · ticket R$ 158,46 · +12,3% vs 1–24/set
Pedido 2000000001
${urlVendaML(2000000001)}
```
  - Variantes:
    - sem custo → `Lucro: — (sem custo em 1 item)` + `⚠️ Máscara X: sem custo cadastrado`;
    - frete → `Lucro: — (frete não lido no ML)`;
    - alíquota → `Lucro: — (alíquotas de imposto não confirmadas)`;
    - prejuízo → `⚠️ Máscara X: prejuízo de R$ 4,10`;
    - parcial → sufixo ` (parcial: 2 de 3 itens)` na 1ª linha;
    - composição incerta → sufixo ` (composição do carrinho não confirmada)`.
  - **Resumo** (cada linha some quando o valor é zero, vazio ou `null`):
```
📊 Ontem (23/10)
R$ 4.870,00 · 31 pedidos · ticket R$ 157,10
Lucro R$ 1.020,00 · Markup 34,0%
Outubro: R$ 41.200,00 · 260 pedidos · ticket R$ 158,46 · +12,3% vs 1–23/set
Custo: 96% das vendas com lucro calculado · R$ 180,00 sem custo · R$ 40,00 com custo estimado · 2 pedidos sem frete lido
🏆 Top lucro: Shampoo X (R$ 210,00), Máscara Y (R$ 150,00), Kit Z (R$ 90,00)
⚠️ 3 abaixo do mínimo · 1 com prejuízo · 2 sem custo
↩️ Devoluções: R$ 120,00 estornados · 2 reclamações com prazo em até 48 h
🏷️ Promoções: 2 com prejuízo · 1 oportunidade com adesão vencendo
🚚 Frete subiu: Produto A, Produto B
Dados apurados até 08:00
```
  - `lucroOntem.motivo 'aliquota_nao_confirmada'` → 3ª linha `Lucro: — (alíquotas de imposto não confirmadas)`.
  - `linhaCrescimento(100, 0, …)` → `'sem base de comparação'`.
  - Nenhuma saída contém o `comprador_nome` da fixture.
  - `TEXTO_AJUDA` lista `/hoje`, `/ontem`, `/mes`, `/top`, `/ajuda`, um por linha.
- [ ] **Step 2–4: Run** (FAIL) → implementar só formatação → **Run** (PASS).
- [ ] **Step 5: Commit** `feat(notificacoes): textos gerenciais (ADR-0190)`.

### Task 6: Carrinho com estado durável

**Files:**
- Create: migration `notificacao_carrinho`
- Create: `supabase/functions/_shared/notificacoes/gerencial/carrinho.ts` (pura), `.../carrinho-io.ts`
- Create: `supabase/functions/notificar-carrinho/index.ts`
- Modify: `supabase/functions/sync-venda/index.ts` (após o bloco da operacional, ~123-133); `supabase/config.toml`
- Test: `.../__tests__/carrinho.test.ts`, `.../__tests__/carrinho-io.test.ts`

**Interfaces — Produces:**
- Tabela `public.notificacao_carrinho`:
  - colunas: `org_id uuid not null references organizations on delete cascade`, `chave text not null`, `pack_id bigint`, `order_id bigint not null`, `esperadas bigint[]`, `primeiro_em timestamptz not null default now()`, `status text not null default 'aguardando' check (status in ('aguardando','enviado','descartado'))`, `tentativas int not null default 0`, `atualizado_em timestamptz not null default now()`;
  - `primary key (org_id, chave)`;
  - índice `(status, primeiro_em)`;
  - RLS ligada, sem policies.
- `export interface EstadoCarrinho { chave: string; packId: number | null; orderId: number; esperadas: number[] | null; primeiroEm: string; tentativas: number }`.
- `export type DecisaoCarrinho = { acao: 'aguardar'; delaySeg: number } | { acao: 'enviar'; parcial: { recebidos: number; total: number } | null; composicaoIncerta: boolean } | { acao: 'descartar' }`.
- `export function decidirEnvioCarrinho(e: EstadoCarrinho, pagas: number[], agora: Date): DecisaoCarrinho`.
- `export async function buscarOrdersDoPack(token: string, packId: number): Promise<number[] | null>`. Faz `GET https://api.mercadolibre.com/packs/{id}` e lê `orders[].id`. Erro ou formato inesperado → `null`. Confirmar o formato com 1 chamada GET real na DSA antes do Step 3.
- `export async function registrarCarrinho(admin, token, orgId, pedido: PedidoML): Promise<void>`.
- `export async function processarCarrinho(admin, orgId, chave, agora): Promise<'aguardando' | 'enviado' | 'descartado' | 'ignorado'>`.
- `export async function varrerCarrinhos(admin, agora): Promise<number>`.

- [ ] **Step 1: Failing tests (pura).** `primeiroEm '2026-10-24T17:00:00Z'`:
  - `esperadas [1,2]`, `pagas [1,2]`, +20 s → `enviar`, `parcial null`, `composicaoIncerta false`.
  - `esperadas [1,2]`, `pagas [1]`, +70 s → `aguardar 60`.
  - +580 s → `aguardar 20` (o prazo é absoluto: 600 s).
  - `esperadas [1,2,3]`, `pagas [1,2]`, +600 s → `enviar`, `parcial { 2, 3 }`.
  - `esperadas [1,2]`, `pagas []`, +600 s → `descartar`.
  - `esperadas null`: +70 s → `aguardar 60`; +600 s com `pagas [1]` → `enviar`, `parcial null`, `composicaoIncerta true`.
  - Pedido sem pack: `esperadas [1]`, `pagas [1]`, +20 s → `enviar`.
- [ ] **Step 2: Failing tests (io, fake client/QStash):**
  - `registrarCarrinho` com `pedido.status 'paid'` e `temAssinanteGerencial` true:
    - faz upsert `ignoreDuplicates` em `notificacao_carrinho` **e** publica QStash com `delay: 20` e `deduplicationId 'carrinho-<org>-<chave>-<tentativas>'`;
    - na 2ª chamada com a linha já `aguardando` e `esperadas null`, tenta `/packs` de novo e faz `update` de `esperadas` só se continuar `null`;
    - falha ao publicar → **não lança** e a linha fica `aguardando`, para a varredura recuperar.
  - `registrarCarrinho` com `status 'cancelled'` ou sem assinante → nenhuma escrita.
  - `processarCarrinho`:
    - linha `enviado` → `'ignorado'`;
    - `enviar` → `update status='enviado' where status='aguardando'` **antes** do `notificarCategoria`. Se o update afeta 0 linhas → `'ignorado'`. É a garantia "no máximo uma".
  - `varrerCarrinhos` seleciona `status='aguardando' and primeiro_em < agora − 60 s`, paginado e ordenado, até 50 por execução.
- [ ] **Step 3: Run** os dois arquivos de teste. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - **`sync-venda`:** chamar `registrarCarrinho` sempre que `pedido.status === 'paid'`, **não** só em `novaPaga`. A idempotência vem da PK e o retry após persistir continua funcionando.
  - **Edge `notificar-carrinho`:** depois de `verificarAssinatura`:
    - body `{ orgId, chave }` → `processarCarrinho`;
    - body `{ varrer: true }` → `varrerCarrinhos`, que chama `processarCarrinho` em cada linha.

    Em `aguardar`, ela republica com `tentativas + 1` e atualiza a linha.
  - **`processarCarrinho`, ao enviar:**
    - `lerVendasDoCarrinho` (sem janela) → `carregarContexto(admin, orgId, data mais antiga do carrinho)` → `resultadoPorItem` → `resultadoCarrinho`;
    - KPIs com `lerKpis` em `janelaDia(diaBrt(agora))`, `janelasMesCorrente(agora).mes` e `.anterior`;
    - `montarMensagemCarrinho` → `notificarCategoria(admin, orgId, 'vendas_gerencial', texto)`;
    - log `{ fn: 'notificar-carrinho', orgId, chave, decisao }`.
- [ ] **Step 5: Run** testes + `pnpm preflight:static`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(notificacoes): notificação gerencial por carrinho com estado durável e teto de 10 min (ADR-0190 D-2/D-4)`.

### Task 7: Resumo diário

**Files:**
- Create: `supabase/functions/_shared/notificacoes/gerencial/devolucoes.ts`, `.../resumo-io.ts`
- Create: `supabase/functions/resumo-diario/index.ts`
- Modify: `supabase/config.toml`
- Test: `.../__tests__/devolucoes.test.ts`, `.../__tests__/resumo-io.test.ts`

**Interfaces — Produces:**
- `export interface DevolucaoComEstorno { type: string; status: string; return_status_money: string | null; aberto_em: string | null; fechado_em: string | null; acoes_pendentes: { action: string; due_date: string | null; mandatory: boolean }[] | null; valor_estornado: number }`.
- `export function estornadoNoPeriodo(devs: DevolucaoComEstorno[], j: JanelaIso): number`. Mesmo critério e valor de `devolucoesConcluidasNoPeriodo` (`src/lib/devolucoes.ts:103`), com limite exclusivo.
- `export function abertasComPrazoAte(devs: DevolucaoComEstorno[], limiteIso: string): number`. Critério de `devolucoesAbertas` + algum `due_date <= limite`.
- `export async function lerDevolucoes(admin, orgId): Promise<DevolucaoComEstorno[]>`. Lê `ml_devolucoes` por `org_id`, paginado. `valor_estornado` vem de `ml_vendas.estorno` por `order_id` e `org_id`, como `src/lib/devolucoes.ts:43-55`. Erro lança.
- `export async function montarDadosResumo(admin, orgId, dia: string, agora: Date): Promise<DadosResumo>`.
- `export async function orgsDoResumo(admin): Promise<string[]>`. Orgs com `configuracoes.telegram_ativo` e `temAssinanteGerencial(…, 'resumo_diario')`. Paginado.

- [ ] **Step 1: Failing tests:**
  - **Paridade de devoluções:**
    - fixture com estorno **exatamente** em `ontem.desde` (entra) e em `ontem.ate` (não entra);
    - mesma fixture em `devolucoesConcluidasNoPeriodo(devs, desde, ateInclusivo)` com `ateInclusivo = ate − 1 ms`, que dá o mesmo valor;
    - import do front com seis `../`.
  - `abertasComPrazoAte` com `due_date` +24 h e +72 h, limite +48 h → `1`.
  - `lerDevolucoes` com fake de 1.200 devoluções → 2 páginas lidas e `valor_estornado` vindo de `ml_vendas`.
  - `montarDadosResumo` (fake):
    - sem módulo `promocoes` → `promocoes: null`;
    - `freteSubiu` sai de `ml_notificacoes_enviadas` (`entidade 'frete_subiu'`, `enviado_em ∈ janelaDia(dia)`) → `ml_vendas.order_id = chave::bigint` → títulos distintos, no máximo 5;
    - `lucroOntem` com `configOk false` → `motivo 'aliquota_nao_confirmada'`.
  - **Edge (pura de roteamento):** body sem `orgId` → publica `{ orgId, dia }` com `dia = diaBrt(agora − 1 dia)` calculado **no disparo**. Um body `{ orgId, dia: '2026-10-23' }` processado em 25/10 ainda resume 23/10 com `chave 'resumo_diario:2026-10-23'`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`montarDadosResumo`:**
    - `ontem = janelaDia(dia)`, `{ mes, anterior, rótulos } = janelasMesFechado(dia)`;
    - KPIs com `lerKpis` (ontem, mes, anterior);
    - itens de ontem: `carregarContexto` + `lerVendasJanela(ontem)` → `resultadoPorItem`, que alimenta `lucroDoPeriodo`, `topPorLucro(…, 3)` e `contarAtencao`;
    - piso: `variacoes.preco` dos códigos vendidos ontem, por `org_id`, em lotes de 200 códigos;
    - promoções: `exigirModulo(admin, orgId, 'promocoes')`, depois `depsAlertas`, depois `selecionarAlertas`;
    - `apuradoAte = horaBrt(agora)`.
  - **Edge:**
    - disparo → `orgsDoResumo`, depois publica com `deduplicationId 'resumo-diario-<org>-<dia>'`;
    - org → `montarDadosResumo` → `montarResumoDiario` → `notificarCategoria(admin, orgId, 'resumo_diario', texto, { chave: 'resumo_diario:<dia>' })`.
- [ ] **Step 4: Run** + `pnpm preflight:static`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notificacoes): resumo diário às 8h (ADR-0190 D-6)`.

### Task 8: Bot com inbox durável

**Files:**
- Create: migration `telegram_bot_inbox`
- Create: `supabase/functions/_shared/notificacoes/gerencial/bot.ts` (pura), `.../consultas.ts`
- Create: `supabase/functions/telegram-bot/index.ts` (webhook + worker)
- Modify: `supabase/functions/usuarios/index.ts` (action `registrar_webhook_telegram`), `supabase/config.toml`, `src/components/config-telegram.tsx`
- Test: `.../__tests__/bot.test.ts`, `.../__tests__/consultas.test.ts`, `src/components/__tests__/config-telegram.test.tsx`

**Interfaces — Produces:**
- **Migration:**
  - `alter table configuracoes add column telegram_bot_id bigint` + `unique (telegram_bot_id)` (um bot só pode pertencer a uma org);
  - tabela `public.telegram_updates`, com `bot_id bigint not null`, `update_id bigint not null`, `org_id uuid not null references organizations on delete cascade`, `payload jsonb not null`, `status text not null default 'recebido' check (status in ('recebido','respondido','falhou'))`, `recebido_em timestamptz not null default now()`, `processado_em timestamptz`, `erro text`;
  - `primary key (bot_id, update_id)`;
  - RLS ligada, sem policies.
- **`bot.ts`:**
  - `secretDaOrg(chave: string, orgId: string): Promise<string>` (hex de HMAC-SHA256);
  - `secretValido(chave, orgId, recebido: string | null): Promise<boolean>` (tempo constante);
  - `type Comando = 'hoje' | 'ontem' | 'mes' | 'top' | 'ajuda' | null`;
  - `interpretarComando(texto?: string): Comando`, que aceita `/cmd@Bot` sem diferenciar maiúsculas;
  - `type Acesso = 'ok' | 'grupo' | 'sem_acesso'`;
  - `avaliarAcesso(chat: { id: number; type: string }, profiles: { is_admin: boolean; is_active: boolean }[]): Acesso`. Retorna `'grupo'` se `type !== 'private'`; `'ok'` se algum profile é ativo e admin; caso contrário `'sem_acesso'`.
- **`consultas.ts`** (estruturadas, D-9):
  - `consultarHoje(admin, orgId, agora): Promise<{ k: KpisPeriodo; l: LucroPeriodo }>`;
  - `consultarMes(admin, orgId, agora)`, com o mesmo formato;
  - `consultarTop(admin, orgId, agora, n = 5): Promise<{ top: …; rotuloMes: string }>`;
  - `consultarOntem(admin, orgId, agora): Promise<DadosResumo>` (= `montarDadosResumo`).

  Os comandos formatam com `mensagens.ts`; a IA da fase 2 usa os objetos.

- [ ] **Step 1: Failing tests:**
  - `bot.ts`:
    - o secret da `org-a` é válido para `org-a`, inválido para `org-b` e para `null`;
    - `interpretarComando('/TOP@PubliAIBot') === 'top'`, `('oi') === null`;
    - `avaliarAcesso`: grupo → `'grupo'`; `[]` → `'sem_acesso'`; `[{ admin false }]` → `'sem_acesso'`; `[{ admin false }, { admin true, active true }]` → `'ok'`.
  - **Webhook** (handler com deps injetadas):
    - secret inválido → 401 sem gravar;
    - válido → `insert` em `telegram_updates`, que publica QStash `{ bot_id, update_id }`, e só então 200;
    - insert duplicado (PK) → 200 sem publicar;
    - **falha de insert ou de publish → 500**, para o Telegram reenviar;
    - o `bot_id` vem de `configuracoes.telegram_bot_id` da org (e não de dado do update), e o `org_id` gravado é o da URL validada pelo secret.
  - **Worker:**
    - lê a linha `recebido`;
    - revalida o acesso pelos profiles com `org_id` + `telegram_chat_id = chat.id`;
    - responde com `enviarTelegram` e marca `respondido`;
    - exceção → `status 'falhou'`, `erro` gravado, resposta `TEXTO_ERRO` best-effort e 200 (sem loop de retry do QStash por erro de dado).
  - `registrar_webhook_telegram`:
    - faz `getMe` → grava `telegram_bot_id`. Se o bot já estiver em outra org → 409 `Este bot já está ligado a outra organização.`;
    - `setWebhook` com `{ url: <SUPABASE_URL>/functions/v1/telegram-bot?org=<orgId>, secret_token, allowed_updates: ['message'], drop_pending_updates: false }`;
    - depois `setMyCommands` com os 5 comandos.
  - `config-telegram.test.tsx`: com token salvo e `podeEditar`, o botão "Ativar comandos no bot" chama `supabase.functions.invoke('usuarios', { body: { action: 'registrar_webhook_telegram' } })`. Com `podeEditar false`, o botão não aparece.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Uma edge só, roteando por assinatura: QStash → worker; header do Telegram → webhook.
  - `TELEGRAM_WEBHOOK_KEY` vem de `Deno.env`; ausente → 500 com log.
  - Front: `Button` existente + toast `Comandos ativados. Mande /ajuda para o bot.`
- [ ] **Step 4: Run** + `pnpm preflight:static`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notificacoes): comandos do bot com inbox durável, só admin em chat privado (ADR-0190 D-8/D-9)`.

### Task 9: Tela Usuários

**Files:** Modify `src/lib/notificacoes-categorias.ts`, `src/pages/Usuarios.tsx` (`NotificacoesDialog` ~271, "marcar todas" ~293); Test `src/pages/__tests__/Usuarios.test.tsx`

**Interfaces — Produces:**
- `CATEGORIAS_NOTIFICACAO` com as mesmas 11 do Deno e `CATEGORIAS_SO_ADMIN`.
- `vendas_gerencial`: label `'Vendas (gerencial)'`, descrição `'Total do carrinho, lucro e margem a cada venda. Só admin.'`.
- `resumo_diario`: label `'Resumo diário'`, descrição `'Resultado do dia anterior às 8h. Só admin.'`.

- [ ] **Step 1: Failing tests:**
  - não-admin → `Vendas (gerencial)` e `Resumo diário` desabilitados, com `Só para admin.`;
  - admin com chat `-100555` → desabilitados, com `Exige conversa privada com o bot.`;
  - "marcar todas" para não-admin não inclui as gerenciais;
  - paridade: a lista do front é igual à de `supabase/functions/_shared/notificacoes/categorias.ts`.
- [ ] **Step 2–4:** Run (FAIL) → implementar com os componentes já usados no dialog → Run (PASS) + `pnpm lint`.
- [ ] **Step 5: Commit** `feat(usuarios): categorias gerenciais só para admin (ADR-0190 D-7)`.

### Task 10: Docs, deploy e validação real

**Files:**
- Modify: `docs/decisions/0190-…md` (status Aceito + SHA; emenda: D-4 com `notificacao_carrinho` e varredura, D-8/D-9 com `telegram_updates` e `telegram_bot_id`, desvio do D-6);
- Modify: `docs/reference/glossario.md` (§ Categoria de notificação: 11);
- Modify: `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md` (2 tabelas, 1 coluna, 1 RPC), `docs/TASKS.md` e o que `docs-update-checklist` indicar.

- [ ] **Step 1:** `pnpm preflight:static`. Expected: PASS.
- [ ] **Step 2: Secret e migrations.**
  - `supabase secrets set TELEGRAM_WEBHOOK_KEY=<32+ bytes>`. Depois `supabase secrets list`, com digest **não vazio**.
  - `supabase db push`, com as 4 migrations aplicadas.
- [ ] **Step 3: Deploy.**
  - Listar as edges que importam (direta ou indiretamente) `_shared/notificacoes/config.ts`, `_shared/platform-admin/metrics-repository.ts`, `_shared/notificacoes/categorias.ts` ou `_shared/notificacoes/gerencial/`.
  - `supabase functions deploy` de todas + `notificar-carrinho resumo-diario telegram-bot usuarios sync-venda`.
  - Conferir as versões por hash (`reference_deploy_manifesto_edges`).
- [ ] **Step 4: Schedules no QStash.**
  - `0 11 * * *` → `resumo-diario` (body vazio);
  - `*/5 * * * *` → `notificar-carrinho` com `{ "varrer": true }`.

  Confirmar os dois na listagem.
- [ ] **Step 5: Validação na DSA.**
  - Um admin com chat privado assina as 2 categorias e ativa os comandos.
  - Testar `/ajuda`, `/hoje` e `/mes`, e conferir com Faturamento › Vendas.
  - Disparar o resumo manualmente com `{ orgId, dia }` assinado.
  - Na próxima venda real, conferir a mensagem do carrinho contra o Lucro do pedido na tela.
  - Medir `CPUTime` de `notificar-carrinho`, `resumo-diario` e do worker do bot nos logs. Se passar de 1.000 ms, parar, registrar em `docs/TASKS.md` e voltar ao Diego antes de liberar para a Avil.
- [ ] **Step 6: Hairfly.** Consulta read-only: o diretor tem profile **admin** com chat privado? Se não tiver, avisar o Diego. Não promover ninguém.
- [ ] **Step 7: Commit** `docs(notificacoes): ADR-0190 aceito, glossário, modelo de dados e edges`.
