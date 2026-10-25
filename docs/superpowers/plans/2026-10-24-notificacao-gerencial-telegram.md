# Notificação gerencial de venda, resumo diário e comandos Telegram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O admin passa a receber pelo Telegram uma mensagem por carrinho com total, lucro e KPIs do dia e do mês, um resumo diário às 8h e respostas a 5 comandos de leitura, sem mudar a notificação operacional por pedido.

**Architecture:**
- **Motor único.** Todo número sai do motor que já alimenta a central (`_shared/platform-admin/metrics-repository.ts` → `calcularResumo`), generalizado de "mês" para qualquer janela. Assim o Telegram bate com a tela por construção.
- **Módulo novo.** Um módulo `_shared/notificacoes/gerencial/` concentra janelas BRT, resultado por pedido/carrinho e textos.
- **Três edges novas.** `notificar-carrinho` (espera o pack por QStash com delay), `resumo-diario` (agendada 8h BRT) e `telegram-bot` (webhook de comandos).
- **Permissão.** A regra "só admin + chat privado" fica em `notificarCategoria` e na edge `usuarios`.

**Tech Stack:** Supabase Edge Functions (Deno), supabase-js, QStash (`@upstash/qstash` via `_shared/queue.ts`), Telegram Bot API, React + Vitest.

**Spec:** `docs/decisions/0190-notificacao-gerencial-de-venda-e-comandos-telegram.md` (+ glossário `docs/reference/glossario.md`, termos Carrinho / Notificação gerencial de venda / Resumo diário / Crescimento do mês).

## Global Constraints

- Categorias novas: `vendas_gerencial` e `resumo_diario`. `vendas` não muda (por pedido, instantânea).
- **Só admin, só chat privado.** Recebe e consulta só o profile `is_active`, da mesma org, com `is_admin = true` e `telegram_chat_id` **positivo** (grupo é negativo).
- **Lucro** = margem de contribuição antes de Ads = líquido após comissão, frete do vendedor, cupom do vendedor e **imposto** − custo.
  - Nunca lucro = líquido.
  - Sem custo em algum item, alíquota não confirmada (`aliquotas_confirmadas_em` nulo) ou frete não lido (`frete_vendedor` nulo com `shipping_id` presente) → lucro vazio com o motivo.
- **Rótulos fixos:** "Margem s/ venda" (`lucro ÷ venda`) e "Markup" (`lucro ÷ custo`). Nunca "margem" sozinha nem `%` sem denominador (ADR-0150).
- **Sem nome do comprador** nas mensagens gerenciais.
- **Fuso** `America/Sao_Paulo` (offset fixo `-03:00`, igual a `BRT_OFFSET` de `metrics-repository.ts`).
- **Crescimento do mês:** do dia 1 do mês anterior até o dia correspondente **inteiro**, com clamp no último dia. Mês anterior zero → `sem base de comparação`.
- **Garantia de entrega:** no máximo **uma** mensagem por carrinho e destinatário (`reservarNotificacao`); a espera tem teto de **10 min** (600 s).
- **Resumo diário:** às **08:00 BRT** (QStash cron `0 11 * * *`), com o dia anterior fechado e rodapé `Dados apurados até HH:MM`.
- **Comandos:** `/hoje`, `/ontem`, `/mes`, `/top`, `/ajuda`. Nenhum de escrita, nenhum `/saldo`.
- **Formato do texto:** texto puro, sem `parse_mode`. Valores monetários `R$ 1.234,56` com espaço normal (trocar o NBSP do `Intl`).
- **Infra:** edges chamadas por QStash ou Telegram usam `verify_jwt = false` em `supabase/config.toml`. Migration só via `supabase migration new` + `supabase db push`, validada com `npm run db:check`.
- **Segredos:** `TELEGRAM_WEBHOOK_KEY` vive só em secret da edge, nunca no repo.

## Desvios deliberados do ADR (para a revisão do plano)

1. **D-8/D-9, "recebimento durável com fila":** a v1 processa o comando **inline** no webhook, com dedupe por `update_id` e log estruturado. A fila entra com a IA (fase 2), quando a resposta passa a ser lenta. Os comandos v1 são leituras de 1–2 consultas.
2. **D-6, "fan-out por org e lotes retomáveis (ADR-0173)":** `resumo-diario` faz fan-out por org via QStash, **sem** a máquina `_shared/rodada`. É 1 passo de leitura por org, sem cursor. A idempotência vem de `notificarCategoria(..., { chave })`. Ampliar `Job`/`fanoutAtivo` seria estrutura sem uso.

## Review Focus

1. **Carrinho com order cancelada ou que nunca fica paga.** Nunca entra no total. No prazo, a mensagem sai `(parcial: X de Y itens)` só com as pagas; nenhuma paga → não envia. Testado na Task 5 (`decidirEnvioCarrinho`).
2. **Duas orders do mesmo pack processadas em paralelo, ou retry do QStash.** Uma única mensagem. Testado na Task 5 (reserva `carrinho_agendado` + `venda_gerencial`).
3. **Virada de dia, mês e ano em BRT** (venda às 23:59 × 00:01 BRT, dia 31 contra mês de 30 dias, 1º de janeiro contra dezembro). Testado na Task 2.
4. **Bot recebendo update de grupo, de não-admin, de chat de outra org ou com secret errado.** Nenhum dado sai. Testado na Task 7.
5. **Frete não lido / alíquota não confirmada / item sem custo.** Lucro vazio com motivo, nunca lucro = líquido. Testado na Task 3.

---

### Task 1: Categorias novas + regra "só admin, chat privado" no backend

**Files:**
- Modify: `supabase/functions/_shared/notificacoes/categorias.ts`
- Modify: `supabase/functions/_shared/notificacoes/config.ts` (`queryAssinantes`, `lerDestinatarios`, `notificarCategoria`)
- Modify: `supabase/functions/_shared/notificacoes/destinatario.ts`
- Modify: `supabase/functions/usuarios/index.ts:101-110` (`update_notificacoes`)
- Create: `supabase/migrations/<timestamp>_categorias_gerenciais_telegram.sql` (via `supabase migration new categorias_gerenciais_telegram`)
- Test: `supabase/functions/_shared/notificacoes/__tests__/config.test.ts`

**Interfaces:**
- Produces:
  - `CATEGORIAS_NOTIFICACAO` com `'vendas_gerencial', 'resumo_diario'` no fim.
  - `export const CATEGORIAS_SO_ADMIN: readonly CategoriaNotificacao[] = ['vendas_gerencial', 'resumo_diario']` em `categorias.ts`.
  - `export const chatPrivado = (chatId: string | null | undefined): boolean` (true só para inteiro positivo) em `destinatario.ts`.
  - `sanitizarDestinatario(input, alvo?: { isAdmin: boolean })`, mesmo retorno de hoje.

- [ ] **Step 1: Write the failing tests** em `config.test.ts`:
  - `notificarCategoria('vendas_gerencial')`: a query de assinantes recebe `.eq('is_admin', true)` (inspecionar o fake client) e só envia Telegram para `chat_id` positivo. Com assinantes `[{chat '123'}, {chat '-100555'}]` → `enviarTelegram` chamado 1× com `'123'`, retorno `1`.
  - `notificarCategoria('vendas')` **não** aplica `is_admin` e envia para `-100555` (regressão: grupo continua valendo nas categorias antigas).
  - `sanitizarDestinatario({ telegram_chat_id: '123', telegram_categorias: ['resumo_diario'] }, { isAdmin: false })` → `{ ok: false, erro: 'Notificações gerenciais são só para admin.' }`.
  - `sanitizarDestinatario({ telegram_chat_id: '-100555', telegram_categorias: ['vendas_gerencial'] }, { isAdmin: true })` → `{ ok: false, erro: 'Notificações gerenciais exigem conversa privada com o bot (chat_id positivo).' }`.
  - `sanitizarDestinatario({ telegram_chat_id: '123', telegram_categorias: ['vendas_gerencial','vendas'] }, { isAdmin: true })` → ok com as duas.
  - `chatPrivado('123') === true`, `chatPrivado('-1') === false`, `chatPrivado(null) === false`.
- [ ] **Step 2: Run** `pnpm test -- supabase/functions/_shared/notificacoes/__tests__/config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `queryAssinantes` adiciona `.eq('is_admin', true)` quando `CATEGORIAS_SO_ADMIN.includes(categoria)`. Isso vale para in-app e Telegram, e para `lerAssinantesEstrito`.
  - Nas mesmas categorias, o envio Telegram (`notificarCategoria`, `notificarCategoriaComChave`, `lerDestinatarios`) filtra `chatPrivado`.
  - Em `sanitizarDestinatario`, com `alvo` informado e alguma categoria de `CATEGORIAS_SO_ADMIN`: recusa se `!alvo.isAdmin`, e recusa se `chatId` existe e `!chatPrivado(chatId)`.
  - Em `usuarios`, `update_notificacoes` lê `is_admin` do profile alvo (`.eq('id', body.id).eq('org_id', orgId)`) antes de sanitizar e passa `{ isAdmin }`.
- [ ] **Step 4: Migration.** Recriar o CHECK `profiles_telegram_categorias_validas`, no mesmo formato de `20260825180755_alerta_estoque_zerado.sql:27-30`, com as 11 categorias. Sem backfill (as categorias são opt-in). Run `npm run db:check`. Expected: OK.
- [ ] **Step 5: Run** os testes do Step 2 + `pnpm test -- supabase/functions/_shared/notificacoes`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(notificacoes): categorias vendas_gerencial e resumo_diario só para admin em chat privado (ADR-0190 D-1/D-7)`.

### Task 2: Janelas BRT (hoje, ontem, mês, mesmo intervalo do mês anterior)

**Files:**
- Create: `supabase/functions/_shared/notificacoes/gerencial/janelas.ts`
- Test: `supabase/functions/_shared/notificacoes/gerencial/__tests__/janelas.test.ts`

**Interfaces:**
- Produces:
  - `export interface JanelaIso { desde: string; ate: string }`. Intervalo `[desde, ate)`, ISO com `-03:00`.
  - `export function diaBrt(instante: Date): string`, formato `YYYY-MM-DD`.
  - `export function janelaDia(dia: string): JanelaIso`
  - `export function janelaMesAte(ate: Date): { mes: JanelaIso; anterior: JanelaIso; rotuloMes: string; rotuloAnterior: string }`
    - `mes` = dia 1 às 00:00 BRT do mês de `ate − 1ms` até `ate`.
    - `anterior` = dia 1 do mês anterior até o **fim** do dia correspondente, com clamp.
    - `rotuloMes` = nome do mês com inicial maiúscula (`Outubro`).
    - `rotuloAnterior` = `1–24/set` (en dash, mês abreviado minúsculo sem ponto).
  - `export function horaBrt(instante: Date): string`, formato `HH:MM`.

- [ ] **Step 1: Write the failing tests:**
  - `janelaMesAte(new Date('2026-10-24T17:00:00Z'))`:
    - `mes = { desde: '2026-10-01T00:00:00-03:00', ate: '2026-10-24T17:00:00.000Z' }`
    - `anterior = { desde: '2026-09-01T00:00:00-03:00', ate: '2026-09-25T00:00:00-03:00' }`
    - `rotuloMes 'Outubro'`, `rotuloAnterior '1–24/set'`
  - Dia 31 → `janelaMesAte(new Date('2026-10-31T15:00:00Z')).anterior.ate === '2026-10-01T00:00:00-03:00'` e `rotuloAnterior '1–30/set'`.
  - Virada de ano → `janelaMesAte(new Date('2027-01-05T12:00:00Z')).anterior.desde === '2026-12-01T00:00:00-03:00'`.
  - Resumo do dia 1º → `janelaMesAte(new Date('2026-11-01T03:00:00Z'))` (meia-noite BRT de 1/11, resumo de 31/10): `mes.desde === '2026-10-01T00:00:00-03:00'`, `rotuloAnterior '1–30/set'`.
  - `diaBrt(new Date('2026-10-25T02:59:00Z')) === '2026-10-24'` e `diaBrt(new Date('2026-10-25T03:01:00Z')) === '2026-10-25'`.
  - `janelaDia('2026-10-23')` → `{ desde: '2026-10-23T00:00:00-03:00', ate: '2026-10-24T00:00:00-03:00' }`.
  - **Paridade com a tela:** para `agora = new Date('2026-10-24T17:00:00Z')`, `Date.parse(anterior.ate) === Date.parse(janelaAnterior(resolverJanela(MES_ATUAL), MES_ATUAL).ate) + 1`, com import de `../../../../../src/lib/metricas` (o vitest roda com `TZ=America/Sao_Paulo`; padrão de import do front já usado em `_shared/extensao/__tests__/paridade-financeira.test.ts`). Usar `vi.setSystemTime(agora)`.
- [ ] **Step 2: Run** `pnpm test -- supabase/functions/_shared/notificacoes/gerencial/__tests__/janelas.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Aritmética em UTC com offset fixo de −3 h, sem `Intl` para datas (o resultado fica determinístico em runtime UTC). Use `Intl` só para nomes de mês, ou uma tabela fixa `['jan','fev',…]`.
- [ ] **Step 4: Run** de novo. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notificacoes): janelas BRT do resumo gerencial com paridade da tela (ADR-0190 D-3)`.

### Task 3: Motor por janela + resultado por pedido e carrinho

**Files:**
- Modify: `supabase/functions/_shared/platform-admin/metrics-repository.ts` (exportar o núcleo; `computeMonth` passa a usá-lo; `titulo` entra no select de itens)
- Create: `supabase/functions/_shared/preco/semaforo.ts` (cópia de `src/lib/semaforo.ts`)
- Create: `supabase/functions/_shared/notificacoes/gerencial/resultado.ts`
- Test: `supabase/functions/_shared/notificacoes/gerencial/__tests__/resultado.test.ts`
- Test (regressão): `supabase/functions/_shared/platform-admin/__tests__/metrics-repository.test.ts`, `metrics-parity.test.ts`, sem alterar asserts

**Interfaces:**
- Consumes: `JanelaIso` (Task 2).
- Produces, em `metrics-repository.ts`:
  - `export interface ContextoCalculo { maps: MapasCusto | undefined; rates: Rates | null; custosOk: boolean; configOk: boolean }`. Exportar também `type Rates`.
  - `export async function carregarContexto(db: MetricsDb, orgId: string, desde: string): Promise<ContextoCalculo>`. Usa `loadConfigState` + RPC `platform_org_cost_catalog` (`p_since: desde`), como `computeMonth`.
  - `export async function lerVendasJanela(db: MetricsDb, orgId: string, j: JanelaIso): Promise<Venda[]>`. Usa `readPages` + `SALES_COLUMNS` + `normalizeSales`, filtrando `date_closed` em `[desde, ate)`.
  - `export function resumirVendas(vendas: Venda[], ctx: ContextoCalculo, agora: Date): ResumoVendas`. É o `summarize` atual.
- Produces, em `_shared/preco/semaforo.ts`: `calcularSemaforo(liquido: number | null, piso: number, custo: number | null): Semaforo`, idêntica ao front.
- Produces, em `resultado.ts`:
  - `export type MotivoSemLucro = 'sem_custo' | 'frete_nao_lido' | 'aliquota_nao_confirmada'`
  - `export interface ResultadoPedido { orderId: number; packChave: string; codigo: string | null; titulo: string | null; bruto: number; liquidoAposImposto: number | null; custo: number | null; custoEstimado: boolean; freteNaoLido: boolean; faturavel: boolean; quantidade: number }`
  - `export function resultadoPorPedido(vendas: Venda[], ctx: ContextoCalculo): ResultadoPedido[]`
    - `packChave` = `String(pack_id ?? order_id)`
    - `bruto` = `brutoDaVenda`
    - líquido = fatia de `ratearLiquidoPorFrete(vendas, montarPesoResolver(ctx.maps))`, menos Σ `impostoDoItem(item, montarAliquotaResolver(ctx.maps, ctx.rates), uf)`. Fica `null` se `!ctx.configOk`.
    - `custo` = Σ por item de `custo_congelado ?? montarCustoResolver(ctx.maps)(item)`, arredondando cada item a 2 casas antes de somar. Fica `null` se algum item não tiver custo.
    - `custoEstimado` = algum item usou o resolver em vez do congelado.
    - `freteNaoLido` = `frete_vendedor == null && shipping_id != null`
    - `faturavel` = `ehFaturavel`
    - `titulo` = do primeiro item
  - `export interface ResultadoCarrinho { bruto: number; itens: number; lucro: number | null; motivo: MotivoSemLucro | null; margemSobreVenda: number | null; markup: number | null; prejuizos: { titulo: string; valor: number }[]; semCusto: string[] }`
  - `export function resultadoCarrinho(pedidos: ResultadoPedido[]): ResultadoCarrinho`. Só considera `faturavel`. Prioridade do motivo: `aliquota_nao_confirmada` > `frete_nao_lido` > `sem_custo`.
  - `export function topPorLucro(pedidos: ResultadoPedido[], n: number): { titulo: string; lucro: number }[]`. Agrupa por `codigo ?? titulo` e ignora pedidos sem lucro calculável.
  - `export function confiancaDoLucro(pedidos: ResultadoPedido[]): { pctComCusto: number; semCusto: number; estimado: number }`. Percentual e valores em R$ de bruto faturável.
  - `export function contarAtencao(pedidos: ResultadoPedido[], pisoPorCodigo: Map<string, number>): { abaixoMinimo: number; prejuizo: number; semCusto: number }`. Usa `calcularSemaforo(liquidoAposImposto / quantidade, piso, custo / quantidade)`: `'vermelho'` = prejuízo, `'amarelo'` = abaixo do mínimo. Sem piso não conta como abaixo do mínimo.

- [ ] **Step 1: Write the failing tests** em `resultado.test.ts`. Fixtures montadas como `Venda` (`sales-types.ts`):
  - **Carrinho de 2 pedidos** (`pack_id 2000000001`):
    - Pedido A: venda 100,00, liquido 80,00, frete 10, custo congelado 40, alíquota nacional 8% confirmada. Imposto 8,00 → lucro A = 32,00.
    - Pedido B: venda 89,80, liquido 70,00, custo 50, imposto 7,18 → lucro B = 12,82.
    - Esperado: `resultadoCarrinho → { bruto: 189.8, itens: 2, lucro: 44.82, motivo: null }`, `margemSobreVenda ≈ 44.82/189.8`, `markup ≈ 44.82/90`.
  - **Item sem custo:** B sem custo e sem catálogo → `lucro null`, `motivo 'sem_custo'`, `semCusto ['<titulo B>']`.
  - **Frete não lido:** A com `frete_vendedor null` e `shipping_id 123` → `motivo 'frete_nao_lido'`, `lucro null`.
  - **Alíquota não confirmada:** `ctx.configOk false` → `motivo 'aliquota_nao_confirmada'`.
  - **Prejuízo:** pedido com liquidoAposImposto 30 e custo 34,10 → `prejuizos [{ titulo, valor: -4.1 }]`.
  - **Pedido cancelado** (`status 'cancelled'`) no pack → fora de `bruto` e `itens`.
  - **Paridade com a central:** fixture de 3 vendas todas com custo → `Σ lucro de resultadoPorPedido === resumirVendas(...).lucro` (centavos).
  - `contarAtencao`, com piso 25 para o código de A e liquidoAposImposto/qtd = 20 e custo 15 → `abaixoMinimo 1`.
- [ ] **Step 2: Run** `pnpm test -- supabase/functions/_shared/notificacoes/gerencial supabase/functions/_shared/platform-admin`. Expected: FAIL nos novos e PASS nos antigos.
- [ ] **Step 3: Implement.**
  - Extrair o núcleo de `computeMonth` para `carregarContexto` / `lerVendasJanela` / `resumirVendas`, sem mudar o comportamento.
  - Acrescentar `titulo` à lista de itens de `SALES_COLUMNS` e atualizar o comentário: agora há leitor.
  - Copiar `semaforo.ts`.
  - Escrever `resultado.ts` usando `ratearLiquidoPorFrete`, `impostoDoItem`, `brutoDaVenda`, `ehFaturavel` e `montar*Resolver`. Não reescrever nenhuma conta já existente.
- [ ] **Step 4: Run** de novo. Expected: PASS, inclusive `metrics-parity.test.ts` sem alteração.
- [ ] **Step 5: Commit** `feat(notificacoes): resultado por pedido e carrinho sobre o motor da central (ADR-0190 D-2/D-5)`.

### Task 4: Textos das mensagens

**Files:**
- Create: `supabase/functions/_shared/notificacoes/gerencial/mensagens.ts`
- Test: `supabase/functions/_shared/notificacoes/gerencial/__tests__/mensagens.test.ts`

**Interfaces:**
- Consumes: `ResultadoCarrinho`, `confiancaDoLucro`, `contarAtencao`, `topPorLucro` (Task 3); `janelaMesAte`, `horaBrt` (Task 2); `ResumoVendas` (`sales-summary.ts`).
- Produces:
  - `export const brl = (n: number): string`. Formato `R$ 1.234,56`, com espaço normal.
  - `export interface KpisPeriodo { hoje: ResumoVendas; mes: ResumoVendas; anterior: ResumoVendas; rotuloMes: string; rotuloAnterior: string }`
  - `export function linhaCrescimento(mes: number, anterior: number, rotuloAnterior: string): string`. Exemplos: `+12,3% vs 1–24/set`, `−4,0% vs 1–24/set`, `sem base de comparação`.
  - `export function montarMensagemCarrinho(c: ResultadoCarrinho, k: KpisPeriodo, pedido: { chave: string; url: string }, parcial: { recebidos: number; total: number } | null): string`
  - `export interface DadosResumo { dia: string; ontem: ResumoVendas; pedidosOntem: ResultadoPedido[]; mes: ResumoVendas; anterior: ResumoVendas; rotuloMes: string; rotuloAnterior: string; atencao: { abaixoMinimo: number; prejuizo: number; semCusto: number }; devolucoes: { estornado: number; prazoProximo: number } | null; promocoes: { prejuizo: number; prazo: number } | null; freteSubiu: string[]; apuradoAte: string }`
  - `export function montarResumoDiario(d: DadosResumo): string`
  - `export function montarHoje(k: KpisPeriodo, pedidosHoje: ResultadoPedido[]): string`
  - `export function montarMes(k: KpisPeriodo, pedidosMes: ResultadoPedido[]): string`
  - `export function montarTop(top: { titulo: string; lucro: number }[], rotuloMes: string): string`
  - `export const TEXTO_AJUDA: string`, `export const TEXTO_SEM_ACESSO: string`, `export const TEXTO_SO_PRIVADO: string`

- [ ] **Step 1: Write the failing tests** com strings exatas (`\n` entre linhas). Fixture de carrinho = a da Task 3; KPIs hoje 2340/14/167,14, mês 41200, anterior 36700:
```
💼 Venda R$ 189,80 — 2 itens
Lucro R$ 44,82 · Margem s/ venda 23,6% · Markup 49,8%
Hoje: R$ 2.340,00 · 14 pedidos · ticket R$ 167,14
Outubro: R$ 41.200,00 · +12,3% vs 1–24/set
Pedido 2000000001
<urlVendaML('2000000001')>
```
  (a última linha é o retorno de `urlVendaML` de `telegram.ts`, montado no teste, não um literal)
  - Com motivo `sem_custo` e `semCusto ['Máscara X']`, a 2ª linha é `Lucro: — (sem custo em 1 item)` e depois vem `⚠️ Máscara X: sem custo cadastrado`.
    - `frete_nao_lido` → `Lucro: — (frete não lido no ML)`
    - `aliquota_nao_confirmada` → `Lucro: — (alíquotas de imposto não confirmadas)`
  - Prejuízo → linha `⚠️ Máscara X: prejuízo de R$ 4,10`.
  - Parcial `{2,3}` → 1ª linha `💼 Venda R$ 189,80 — 2 itens (parcial: 2 de 3 itens)`.
  - **Resumo diário completo.** Linhas na ordem abaixo. Cada linha opcional some quando o valor é zero ou o bloco é `null`, inclusive o 🏆 sem top.
```
📊 Ontem (23/10)
R$ 4.870,00 · 31 pedidos · ticket R$ 157,10
Lucro R$ 1.020,00 · Markup 34,0%
Outubro: R$ 41.200,00 · +12,3% vs 1–23/set
Custo: 96% do faturamento com custo · R$ 180,00 sem custo · R$ 40,00 com custo estimado
🏆 Top lucro: Shampoo X (R$ 210,00), Máscara Y (R$ 150,00), Kit Z (R$ 90,00)
⚠️ 3 abaixo do mínimo · 1 com prejuízo · 2 sem custo
↩️ Devoluções: R$ 120,00 estornados · 2 reclamações com prazo em até 48 h
🏷️ Promoções: 2 com prejuízo · 1 oportunidade com adesão vencendo
🚚 Frete subiu: Produto A, Produto B
Dados apurados até 08:00
```
  - `linhaCrescimento(100, 0, '1–24/set') === 'sem base de comparação'`. Só `Outubro: R$ 41.200,00 · sem base de comparação`.
  - Nenhuma saída contém o nome do comprador (assert `not.toContain` com o `comprador_nome` da fixture).
  - `TEXTO_AJUDA` lista exatamente `/hoje`, `/ontem`, `/mes`, `/top`, `/ajuda`, um por linha, com descrição.
- [ ] **Step 2: Run** `pnpm test -- supabase/functions/_shared/notificacoes/gerencial/__tests__/mensagens.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** só com formatação, sem leitura de banco. Percentuais com 1 casa e vírgula. Reusar `urlVendaML` de `telegram.ts`, exportando-o se ainda não for exportado.
- [ ] **Step 4: Run** de novo. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notificacoes): textos da notificação gerencial, resumo diário e comandos (ADR-0190)`.

### Task 5: Carrinho — agendar no `sync-venda` e enviar na edge `notificar-carrinho`

**Files:**
- Create: `supabase/functions/_shared/notificacoes/gerencial/carrinho.ts` (decisão pura)
- Create: `supabase/functions/_shared/notificacoes/gerencial/carrinho-io.ts` (agendar, `/packs`, montar e enviar)
- Create: `supabase/functions/notificar-carrinho/index.ts`
- Modify: `supabase/functions/sync-venda/index.ts` (logo após o bloco `notificarCategoria(... 'vendas' ...)`, linhas ~123-133)
- Modify: `supabase/config.toml` (`[functions.notificar-carrinho] verify_jwt = false`)
- Test: `supabase/functions/_shared/notificacoes/gerencial/__tests__/carrinho.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `reservarNotificacao(admin, orgId, userId, entidade, chave): Promise<boolean>`; `qstashClient()`, `verificarAssinatura` (`_shared/queue.ts`); `lerDestinatarios` (`config.ts`).
- Produces:
  - `export interface MsgCarrinho { orgId: string; chave: string; packId: number | null; esperadas: number[] | null; primeiroEm: string; tentativa: number }`
  - `export type DecisaoCarrinho = { acao: 'aguardar'; delaySeg: number } | { acao: 'enviar'; parcial: { recebidos: number; total: number } | null } | { acao: 'descartar' }`
  - `export function decidirEnvioCarrinho(m: MsgCarrinho, pagas: number[], agora: Date): DecisaoCarrinho`
  - `export async function buscarOrdersDoPack(token: string, packId: number): Promise<number[] | null>`. Faz `GET https://api.mercadolibre.com/packs/{id}` e lê `orders[].id`. Erro ou formato inesperado → `null`.
  - `export async function agendarCarrinho(admin: SupabaseClient, token: string, orgId: string, pedido: PedidoML, agora: Date): Promise<void>`
  - `export async function enviarCarrinho(admin: SupabaseClient, m: MsgCarrinho, parcial: { recebidos: number; total: number } | null, agora: Date): Promise<number>`

- [ ] **Step 1: Write the failing tests** de `decidirEnvioCarrinho`. `primeiroEm = '2026-10-24T17:00:00Z'`:
  - `esperadas [1,2]`, `pagas [1,2]`, +20 s → `{ acao: 'enviar', parcial: null }`
  - `esperadas [1,2]`, `pagas [1]`, +70 s → `{ acao: 'aguardar', delaySeg: 60 }`
  - `esperadas [1,2,3]`, `pagas [1,2]`, +601 s → `{ acao: 'enviar', parcial: { recebidos: 2, total: 3 } }`
  - `esperadas [1,2]`, `pagas []`, +601 s → `{ acao: 'descartar' }`
  - `esperadas null` (falha do `/packs`): `tentativa 0` → `aguardar 60`; `tentativa 1` com `pagas [1]` → `enviar parcial null`
  - `esperadas [1]` (pedido sem pack), `pagas [1]`, +20 s → `enviar parcial null`
  - `delaySeg` nunca passa do prazo: com `esperadas [1,2]`, `pagas [1]`, +580 s → `aguardar` com `delaySeg 21` (até 601 s)
- [ ] **Step 2: Run** `pnpm test -- supabase/functions/_shared/notificacoes/gerencial/__tests__/carrinho.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `decidirEnvioCarrinho`.** O teto é 600 s.
- [ ] **Step 4: Implement `carrinho-io.ts` + edge.**
  - **`agendarCarrinho`:**
    - Sai cedo se `lerDestinatarios(admin, orgId, 'vendas_gerencial').chatIds` vier vazio. Isso evita custo nas orgs que não usam a categoria.
    - Calcula `chave = String(pedido.pack_id ?? pedido.id)`.
    - Chama `reservarNotificacao(admin, orgId, null, 'carrinho_agendado', chave)`; se for `false`, retorna.
    - Monta `esperadas`: `pack_id ? await buscarOrdersDoPack(token, pack_id) : [pedido.id]`.
    - Publica em `${SUPABASE_URL}/functions/v1/notificar-carrinho` com `delay: 20`, `deduplicationId: \`carrinho-${orgId}-${chave}-0\`` e `tentativa: 0`.
    - É best-effort: try/catch com `console.warn` e nunca derruba o `sync-venda`.
  - **Edge `notificar-carrinho`:**
    - `verificarAssinatura`. Lê `ml_vendas.order_id, status` da org por `pack_id = packId` (ou `order_id = chave` sem pack). `pagas` = as `ehFaturavel`.
    - `aguardar` → republica com `tentativa + 1`, `delay: delaySeg` e `deduplicationId` com a tentativa.
    - `enviar` → `enviarCarrinho`.
    - Responde 200, ou 500 só em erro antes da reserva.
  - **`enviarCarrinho`:**
    - Reserva `'venda_gerencial'` + `chave`; se for `false`, retorna 0.
    - Calcula `{ mes, anterior }` com `janelaMesAte(agora)` e `hoje` com `janelaDia(diaBrt(agora))`.
    - Chama `carregarContexto(admin, orgId, anterior.desde)` e faz **duas** leituras: `lerVendasJanela(mes)` e `lerVendasJanela(anterior)`. As vendas de hoje saem filtrando as de `mes` pela janela.
    - As vendas do carrinho saem das de `mes` (`packChave === chave`), com fallback de leitura própria se o carrinho tiver vindo de outro mês.
    - `resultadoCarrinho(resultadoPorPedido(...))` → `montarMensagemCarrinho` → `notificarCategoria(admin, orgId, 'vendas_gerencial', texto)`.
    - Loga `console.log(JSON.stringify({ fn: 'notificar-carrinho', orgId, chave, vendasMes: n, ms }))` para medir CPU.
  - **`sync-venda`:** acrescenta `if (novaPaga && orgId) await agendarCarrinho(admin, token, orgId, pedido, new Date());` **fora** do `if` da reserva `venda_paga`. Essa reserva é da operacional e falha fechada; a gerencial tem a sua.
- [ ] **Step 5: Run** `pnpm test -- supabase/functions/_shared/notificacoes supabase/functions/sync-venda` + `pnpm preflight:static`. Expected: PASS, sem erro de tipo.
- [ ] **Step 6: Commit** `feat(notificacoes): notificação gerencial por carrinho com espera de até 10 min (ADR-0190 D-2/D-4)`.

### Task 6: Resumo diário (edge `resumo-diario`)

**Files:**
- Create: `supabase/functions/_shared/notificacoes/gerencial/resumo-io.ts`
- Create: `supabase/functions/_shared/notificacoes/gerencial/devolucoes.ts` (port das regras de `src/lib/devolucoes.ts`)
- Create: `supabase/functions/resumo-diario/index.ts`
- Modify: `supabase/config.toml` (`[functions.resumo-diario] verify_jwt = false`)
- Test: `supabase/functions/_shared/notificacoes/gerencial/__tests__/devolucoes.test.ts`, `.../__tests__/resumo-io.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4; `exigirModulo(admin, orgId, 'promocoes')` (`_shared/produto/modulo.ts`); `depsAlertas(admin, orgId)` + `selecionarAlertas(promos, prejuizo, agoraMs)` (`_shared/promocoes/alertas.ts`); `notificarCategoria(..., { chave })`.
- Produces:
  - `export function estornadoNoPeriodo(devs: DevolucaoRow[], j: JanelaIso): number`. Mesmo critério de `devolucoesConcluidasNoPeriodo`: `type === 'returns'`, `return_status_money === 'refunded'`, data `fechado_em ?? aberto_em` na janela.
  - `export function abertasComPrazoAte(devs: DevolucaoRow[], limiteIso: string): number`. Critério de `devolucoesAbertas` + alguma `acoes_pendentes[].due_date <= limite`.
  - `export async function montarDadosResumo(admin: SupabaseClient, orgId: string, agora: Date): Promise<DadosResumo>`
  - `export async function orgsDoResumo(admin: SupabaseClient): Promise<string[]>`. `org_id` distintos de profiles ativos, admin, com `resumo_diario` e chat privado, em org com `configuracoes.telegram_ativo`.

- [ ] **Step 1: Write the failing tests:**
  - **Paridade de devoluções:** a mesma fixture em `estornadoNoPeriodo` e em `devolucoesConcluidasNoPeriodo` (importada de `src/lib/devolucoes`) dá o mesmo valor.
  - `abertasComPrazoAte`, com 1 devolução aberta `due_date` em +24 h e outra em +72 h e limite +48 h → `1`.
  - `montarDadosResumo` com fake client:
    - org sem módulo `promocoes` → `promocoes: null`;
    - org sem nenhuma reserva `frete_subiu` ontem → `freteSubiu: []`;
    - `freteSubiu` lista títulos distintos, no máximo 5, a partir de `ml_notificacoes_enviadas` (`entidade 'frete_subiu'`, `enviado_em` na janela de ontem) → `ml_vendas.order_id = chave` → itens.
  - `orgsDoResumo` ignora profile com chat negativo e org com `telegram_ativo false`.
- [ ] **Step 2: Run** `pnpm test -- supabase/functions/_shared/notificacoes/gerencial`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`montarDadosResumo`:**
    - Janelas: `dia = diaBrt(agora − 1 dia)`, `ontem = janelaDia(dia)` e `{ mes, anterior } = janelaMesAte(new Date(ontem.ate))`. Lê as vendas com `carregarContexto` + `lerVendasJanela`.
    - Piso: `variacoes.preco` por `codigo` da org, só para os códigos vendidos ontem.
    - Devoluções: `ml_devolucoes` por `org_id`, nunca por `user_id`.
    - Promoções: `exigirModulo` → `depsAlertas.lerPromocoes/lerParticipandoNoPrejuizo` → `selecionarAlertas` → `{ prejuizo: s.prejuizo.length, prazo: s.prazo.length }`.
    - `apuradoAte = horaBrt(agora)`.
  - **Edge `resumo-diario`:**
    - `verificarAssinatura`.
    - Body sem `orgId` (disparo do schedule) → para cada org de `orgsDoResumo`, publica em si mesma `{ orgId }` com `deduplicationId: \`resumo-diario-${orgId}-${dia}\``.
    - Body com `orgId` → `montarDadosResumo` → `montarResumoDiario` → `notificarCategoria(admin, orgId, 'resumo_diario', texto, { chave: \`resumo_diario:${dia}\` })`.
- [ ] **Step 4: Run** os testes + `pnpm preflight:static`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notificacoes): resumo diário às 8h com confiança do lucro, devoluções, promoções e frete (ADR-0190 D-6)`.

### Task 7: Comandos do bot (edge `telegram-bot` + registro do webhook)

**Files:**
- Create: `supabase/functions/_shared/notificacoes/gerencial/bot.ts` (pura: secret, comando, autorização)
- Create: `supabase/functions/telegram-bot/index.ts`
- Modify: `supabase/functions/usuarios/index.ts` (nova action `registrar_webhook_telegram`)
- Modify: `supabase/config.toml` (`[functions.telegram-bot] verify_jwt = false`)
- Modify: `src/components/config-telegram.tsx` (botão "Ativar comandos no bot")
- Test: `supabase/functions/_shared/notificacoes/gerencial/__tests__/bot.test.ts`, `src/components/__tests__/config-telegram.test.tsx`

**Interfaces:**
- Consumes: Tasks 2–4; `enviarTelegram(token, chatId, texto)`; `reservarNotificacao`; `lerConfigTelegram`.
- Produces:
  - `export async function secretDaOrg(chave: string, orgId: string): Promise<string>`. Hex de HMAC-SHA256 via `crypto.subtle`.
  - `export async function secretValido(chave: string, orgId: string, recebido: string | null): Promise<boolean>`. Comparação em tempo constante.
  - `export type Comando = 'hoje' | 'ontem' | 'mes' | 'top' | 'ajuda' | null`
  - `export function interpretarComando(texto: string | undefined): Comando`. Aceita `/hoje` e `/hoje@NomeDoBot`, sem diferenciar maiúsculas; o resto vira `null`, que responde `TEXTO_AJUDA`.
  - `export type Acesso = 'ok' | 'grupo' | 'sem_acesso'`
  - `export function avaliarAcesso(chat: { id: number; type: string }, profile: { is_admin: boolean; is_active: boolean } | null): Acesso`
  - `export async function responderComando(admin: SupabaseClient, orgId: string, c: Exclude<Comando, null> | null, agora: Date): Promise<string>`. `/ontem` reusa `montarDadosResumo` + `montarResumoDiario`.

- [ ] **Step 1: Write the failing tests** em `bot.test.ts`:
  - `secretValido(k, 'org-a', await secretDaOrg(k, 'org-a')) === true`
  - Com o secret da `org-a` na URL `org-b` → `false`. `null` → `false`.
  - `interpretarComando('/hoje') === 'hoje'`, `('/TOP@PubliAIBot') === 'top'`, `('oi') === null`, `(undefined) === null`
  - `avaliarAcesso({ id: -100, type: 'group' }, adminAtivo) === 'grupo'`
  - `avaliarAcesso({ id: 5, type: 'private' }, null) === 'sem_acesso'`
  - `avaliarAcesso({ id: 5, type: 'private' }, { is_admin: false, is_active: true }) === 'sem_acesso'`
  - `avaliarAcesso({ id: 5, type: 'private' }, { is_admin: true, is_active: true }) === 'ok'`
  - Em `config-telegram.test.tsx`: com token salvo e `podeEditar`, o botão "Ativar comandos no bot" chama `supabase.functions.invoke('usuarios', { body: { action: 'registrar_webhook_telegram' } })`. Com `podeEditar false`, o botão não aparece.
- [ ] **Step 2: Run** `pnpm test -- supabase/functions/_shared/notificacoes/gerencial/__tests__/bot.test.ts src/components/__tests__/config-telegram.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Edge `telegram-bot`:**
    - Lê `org` da query string e o header `X-Telegram-Bot-Api-Secret-Token`; secret inválido → 401 sem corpo.
    - `update.message` ausente → 200.
    - `reservarNotificacao(admin, orgId, null, 'telegram_update', String(update.update_id))`; se for `false`, responde 200.
    - Profile por `org_id = orgId` e `telegram_chat_id = String(chat.id)`.
    - Aplica `avaliarAcesso`: `'grupo'` → `TEXTO_SO_PRIVADO`, `'sem_acesso'` → `TEXTO_SEM_ACESSO`, `'ok'` → `responderComando`.
    - Envia a resposta com `enviarTelegram(cfg.token, String(chat.id), texto)`.
    - Responde **sempre 200** depois do secret válido, porque o Telegram reenvia qualquer não-200.
    - Log `{ fn, orgId, comando, acesso, ms }`.
  - **Action `registrar_webhook_telegram` (admin da org do caller):**
    - Lê `lerConfigTelegram`; sem token → 400 `Configure o token do bot antes.`
    - `POST https://api.telegram.org/bot<token>/setWebhook` com `{ url: \`${SUPABASE_URL}/functions/v1/telegram-bot?org=${orgId}\`, secret_token: await secretDaOrg(Deno.env.get('TELEGRAM_WEBHOOK_KEY')!, orgId), allowed_updates: ['message'], drop_pending_updates: true }`.
    - Depois `setMyCommands` com os 5 comandos e as descrições de `TEXTO_AJUDA`.
    - Retorna `{ ok: true }`, ou `{ error: <description do Telegram> }` com 400.
  - **Front:** botão `Button` existente, com toast de sucesso `Comandos ativados. Mande /ajuda para o bot.`
- [ ] **Step 4: Run** os testes + `pnpm preflight:static`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notificacoes): comandos /hoje /ontem /mes /top /ajuda no bot só para admin (ADR-0190 D-8)`.

### Task 8: Tela Usuários — categorias gerenciais só para admin

**Files:**
- Modify: `src/lib/notificacoes-categorias.ts`
- Modify: `src/pages/Usuarios.tsx` (`NotificacoesDialog`, ~linha 271; "marcar todas", linha 293)
- Test: `src/pages/__tests__/Usuarios.test.tsx`

**Interfaces:**
- Consumes: as categorias da Task 1 (espelho manual).
- Produces:
  - `CATEGORIAS_NOTIFICACAO` com as mesmas 11 categorias do Deno.
  - `CATEGORIA_LABEL.vendas_gerencial = 'Vendas (gerencial)'`, `CATEGORIA_DESCRICAO.vendas_gerencial = 'Total do carrinho, lucro e margem a cada venda. Só admin.'`
  - `CATEGORIA_LABEL.resumo_diario = 'Resumo diário'`, `CATEGORIA_DESCRICAO.resumo_diario = 'Resultado do dia anterior às 8h. Só admin.'`
  - `export const CATEGORIAS_SO_ADMIN`

- [ ] **Step 1: Write the failing tests:**
  - Abrindo "Notificações" de um usuário **não admin**, os checkboxes `Vendas (gerencial)` e `Resumo diário` ficam desabilitados, com o texto `Só para admin.`
  - Para admin com `chat_id` `-100555`, os mesmos ficam desabilitados com `Exige conversa privada com o bot.`
  - "Marcar todas" para não-admin não inclui as categorias gerenciais.
  - Teste de paridade: `CATEGORIAS_NOTIFICACAO` do front é igual ao de `supabase/functions/_shared/notificacoes/categorias.ts` (import relativo).
- [ ] **Step 2: Run** `pnpm test -- src/pages/__tests__/Usuarios.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** no dialog com os componentes já usados ali; sem `<select>` nativo.
- [ ] **Step 4: Run** de novo + `pnpm lint` nos arquivos alterados. Expected: PASS.
- [ ] **Step 5: Commit** `feat(usuarios): categorias gerenciais só para admin em chat privado (ADR-0190 D-7)`.

### Task 9: Docs, deploy e validação real

**Files:**
- Modify: `docs/decisions/0190-…md` (status → Aceito, com o SHA do merge, e os desvios 1–2 registrados como emenda)
- Modify: `docs/reference/glossario.md` (§ Categoria de notificação: 11 categorias, citando ADR-0190)
- Modify: `docs/reference/edge-functions.md` (3 edges novas + `usuarios`/`sync-venda`), `docs/TASKS.md`, e o que a skill `docs-update-checklist` indicar em `obsidian-vault/`

- [ ] **Step 1:** `pnpm preflight:static` (portão de pré-push do projeto). Expected: PASS.
- [ ] **Step 2: Secret e migration.**
  - `supabase secrets set TELEGRAM_WEBHOOK_KEY=<32+ bytes aleatórios>`. Depois `supabase secrets list` e confirmar o digest **não vazio** (o `secrets set` pode gravar vazio, ver `reference_ops`).
  - `supabase db push`, confirmando a migration aplicada.
- [ ] **Step 3: Deploy.**
  - Listar as edges que importam `_shared/notificacoes/config.ts`, `_shared/platform-admin/metrics-repository.ts` ou `_shared/notificacoes/gerencial/`, direta ou indiretamente.
  - `supabase functions deploy <todas> notificar-carrinho resumo-diario telegram-bot usuarios sync-venda`.
  - Conferir a versão implantada pelo hash (`reference_deploy_manifesto_edges`).
- [ ] **Step 4: Schedule.** Criar no QStash `0 11 * * *` → `${SUPABASE_URL}/functions/v1/resumo-diario` com body vazio. Confirmar na listagem de schedules.
- [ ] **Step 5: Validação na DSA (org de teste).**
  - Admin com chat privado assina `vendas_gerencial` + `resumo_diario`.
  - Clica "Ativar comandos no bot", manda `/ajuda`, `/hoje`, `/mes` e confere os números contra Faturamento › Vendas (mês atual).
  - Dispara `resumo-diario` manualmente com `{ orgId }` assinado e confere o resumo.
  - Na próxima venda real, confere a mensagem do carrinho e o log `ms`/`vendasMes`. Se `ms > 1500`, registrar em `docs/TASKS.md` e abrir o follow-up de cache antes de liberar para a Avil.
- [ ] **Step 6: Hairfly.** Confirmar no banco (consulta read-only) se o diretor tem profile **admin** com `chat_id` privado. Se não tiver, avisar o Diego; não promover ninguém por conta própria.
- [ ] **Step 7: Commit** dos docs `docs(notificacoes): ADR-0190 aceito, glossário e referência das edges`.
