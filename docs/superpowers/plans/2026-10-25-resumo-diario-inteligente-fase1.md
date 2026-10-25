# Resumo diário mais inteligente — fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O resumo das 08:00 (e o `/ontem`) ganha a seção "📦 Estoque acabando" e passa a nomear os itens com prejuízo no bloco ⚠️ Atenção.

**Architecture:** Lógica pura em `_shared/notificacoes/gerencial/` (portas com paridade testada contra `src/lib/vendas-sku.ts` e `src/lib/texto.ts`), IO em `resumo-io.ts` (`montarDadosResumo`, que serve resumo e `/ontem`), texto em `mensagens.ts`. A janela de 30 dias reaproveita `lerVendasJanela` + `carregarContexto` + `resultadoPorItem` — volume medido em 25/10: Avil 1.849 vendas/30d, abaixo do teto `LIMITE_VENDAS_POR_EXECUCAO` (5.000). Sem migration, sem RPC nova.

**Tech Stack:** Deno edge functions (Supabase), TypeScript, vitest (testes de `supabase/functions/**/__tests__` rodam no vitest e podem importar `src/lib/*` para paridade, como `resultado.test.ts` já faz).

**Spec:** `docs/superpowers/specs/2026-10-25-resumo-diario-inteligente-design.md`

## Global Constraints

- Paridade com a tela Vendas SKU no que é **exibido**: cobertura = `floor(estoque / (unidades_30d / 30))` (exceção: estoque ≤ 0 → 0, a tela daria negativo); kit vinculado não tem cobertura própria. O lucro 30d (só ranking, não exibido) é o do resumo (`resultadoPorItem`) — exceção documentada no spec, decisão 2.
- Campeão: top **20** por lucro 30d, vendido em **≥ 3 dias distintos (BRT)** na janela; kit sai **antes** do ranking; SKU sem lucro calculado, sem catálogo ou com estoque nulo fica fora.
- Dispara (precedência explícita): `zerado ? vendeuNosUltimos7Dias : cobertura < 7`, com `zerado = estoque ≤ 0` e `vendeuNosUltimos7Dias = ultimaVenda ≥ fimJanela − 7×24h`.
- Mostra no máximo **3** itens por seção + `• e mais N`.
- Janela de 30 dias = do início de `dia − 29` ao fim de `dia` (BRT), por `date_closed` (mesmo critério de `janelaDia`).
- Nomes: `nomeSku` (porta) cortado por `encurtar` (40 car.).
- Seção nova que falhar → resumo sai **sem a seção** (`console.error`), nunca deixa de sair.
- CPU ≤ 500 ms por execução do resumo/`/ontem` após a mudança. Antes do merge: benchmark local do cálculo puro com 5.000 vendas sintéticas ≤ 250 ms de CPU. Depois do deploy: `functions.combined-stats`; acima de 500 ms → redeploy da versão anterior. Encerramento por CPU não é capturável por `try/catch` — por isso a medição prévia.
- Texto puro, layout `blocos`; nunca nome de comprador; markup continua no resumo.
- Nunca escrever no Mercado Livre; nenhuma escrita nova no banco.

## Review Focus

- SKU vendido só sem custo nos 30 dias (lucro nulo) → fora do ranking, não quebra a seção.
- Estoque negativo (saldo furado) → tratado como zerado, nunca cobertura negativa.
- Org sem nenhuma venda em 30 dias (ex.: Hairflay) → seção some, resumo sai normal.
- Falha na leitura de 30 dias, `VolumeAcimaDoLimite` (5.001 vendas) ou falha do catálogo → resumo sai sem a seção, demais blocos intactos.
- Item com prejuízo sem código (sem SKU) → nomeado pelo título, agregado pelo título.

---

### Task 1: Porta de `nomeSku` com paridade

**Files:**
- Create: `supabase/functions/_shared/notificacoes/gerencial/nome-sku.ts`
- Test: `supabase/functions/_shared/notificacoes/gerencial/__tests__/nome-sku.test.ts`

**Interfaces:**
- Produces: `nomeSku(l: { codigo: string; titulo: string | null; nomeFamilia: string | null }): string` — porta fiel de `src/lib/vendas-sku.ts:15` com `formatarNomeProduto`/`normalizarParaBusca` (+ `SIGLAS`/`CONECTIVOS`) de `src/lib/texto.ts`, copiados (Deno não importa `src/`). Comentário no topo apontando as duas origens.

- [ ] **Step 1: Teste de paridade (falha)** — `it.each` com casos: título só cor + família (`'PRETO'`, `'SHAMPOO HAIR FLY'`), título contendo a família, família palavra parcial (`'Tapete'` × `'PET'`), título nulo com família, título e família nulos (devolve código), siglas e números (`'KIT 2 UN FPS 60'`). Para cada: `expect(nomeSku(x)).toBe(nomeSkuTela(x))`, importando `nomeSku as nomeSkuTela` de `../../../../../../src/lib/vendas-sku`.
- [ ] **Step 2:** `./node_modules/.bin/vitest run supabase/functions/_shared/notificacoes/gerencial/__tests__/nome-sku.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar `nome-sku.ts`.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `feat(resumo): porta de nomeSku com paridade (fase 1)`.

### Task 2: Seleção de "estoque acabando" (pura)

**Files:**
- Create: `supabase/functions/_shared/notificacoes/gerencial/estoque-acabando.ts`
- Test: `supabase/functions/_shared/notificacoes/gerencial/__tests__/estoque-acabando.test.ts`

**Interfaces:**
- Consumes: `ResultadoItem` (`resultado.ts`), `nomeSku` (Task 1).
- Produces:
  ```ts
  export interface CatalogoEstoque { codigo: string; estoque: number | null; ehKit: boolean; nome: string | null; nomeFamilia: string | null }
  export interface ItemEstoque { codigo: string; nome: string; estoque: number; porDia: number; cobertura: number | null; zerado: boolean; lucro30: number }
  export const CAMPEOES = 20, MIN_DIAS_VENDA = 3, COBERTURA_ALERTA = 7, ZERADO_VENDA_RECENTE_DIAS = 7, JANELA_DIAS = 30;
  export function coberturaResumo(estoque: number, unidades30: number): number // floor(estoque / (unidades30 / 30)); estoque ≤ 0 → 0
  export function selecionarEstoqueAcabando(
    itens: ResultadoItem[], dataPorOrder: Map<number, string>, catalogo: Map<string, CatalogoEstoque>, fimJanela: string,
  ): ItemEstoque[]
  ```
  `dataPorOrder`: `order_id → date_closed` (ISO) das vendas da janela. `fimJanela`: ISO exclusivo do fim da janela. Ordem do pipeline: (1) agrega; (2) tira kit, sem catálogo, estoque nulo, sem lucro; (3) tira < 3 dias distintos; (4) top 20 por `lucro30` desc, desempate `codigo` asc; (5) aplica o disparo. Retorna **todos** os disparos já ordenados (zerados por `lucro30` desc; depois cobertura asc, desempate `lucro30` desc, depois `codigo`); quem corta em 3 é a mensagem. Dia BRT de cada venda: `diaBrt(new Date(iso))`.
- Regras: agrega por `codigo` não nulo só itens `faturavel`; `lucro30` = Σ `lucro` não nulo (SKU sem nenhum → fora); unidades = Σ `quantidade` faturável (como `unidadesPorCodigo`); dias distintos e última venda em BRT via `dataPorOrder`. `porDia = unidades / 30`; `cobertura = floor(estoque / porDia)`; `estoque ≤ 0` → `zerado` com `cobertura: 0`.

- [ ] **Step 1: Testes (falham)**:
  - `fórmula de cobertura = coberturaDias da tela` — exportar `coberturaResumo(estoque: number, unidades30: number): number` e comparar com `coberturaDias(estoque, u30, false)` de `src/lib/vendas-sku` para (12, 90), (30, 30), (100, 30), (7, 45); e `coberturaResumo(-2, 30) === 0` (exceção).
  - `seletor usa a fórmula` — SKU elegível (vendas em 3 dias, estoque 12, 90 un.) volta com `cobertura: 4`.
  - `só campeões: top 20 por lucro 30d` — 25 SKUs todos com cobertura 1 dia; só os 20 de maior lucro voltam.
  - `kit sai antes do ranking` — kit com o maior lucro não aparece e não ocupa vaga (o 21º entra).
  - `venda em menos de 3 dias distintos fica fora` — mesmo SKU com 3 vendas no mesmo dia BRT → fora; em 3 dias → dentro.
  - `dispara só abaixo de 7 dias` — cobertura 6 dentro, 7 fora.
  - `zerado com venda nos últimos 7 dias entra; há mais de 7 dias sai` — última venda `fim − 6 d` dentro; `fim − 8 d` fora; fronteira `fim − 7 d` exata dentro.
  - `zerado antigo não entra pela cobertura` — estoque 0, última venda `fim − 10 d` → fora (precedência).
  - `20º lugar empatado desempata por código`.
  - `estoque negativo vira zerado` — `estoque: -2` → `zerado: true, cobertura: 0`.
  - `fora: sem lucro calculado, sem catálogo, estoque nulo` — três SKUs, nenhum volta.
  - `ordem: zerados primeiro (por lucro), depois menor cobertura`.
  - `nome usa nomeSku` — `{ nome: 'PRETO', nomeFamilia: 'SHAMPOO X' }` → `nome` igual a `nomeSku(...)`.
- [ ] **Step 2:** `./node_modules/.bin/vitest run supabase/functions/_shared/notificacoes/gerencial/__tests__/estoque-acabando.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `estoque-acabando.ts` (dia BRT: reaproveitar `diaBrt` de `janelas.ts`).
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `feat(resumo): seleção de estoque acabando (fase 1)`.

### Task 3: Prejuízo nomeado em `contarAtencao`

**Files:**
- Modify: `supabase/functions/_shared/notificacoes/gerencial/resultado.ts:184-199`
- Test: `supabase/functions/_shared/notificacoes/gerencial/__tests__/resultado.test.ts` (novo `describe`)

**Interfaces:**
- Produces: `contarAtencao(...)` passa a devolver `{ abaixoMinimo: number; prejuizo: number; semCusto: number; prejuizos: PrejuizoSku[] }` com
  `export interface PrejuizoSku { codigo: string | null; titulo: string | null; valor: number; vendas: number }`.
  `prejuizo` (contagem) **não muda**. `prejuizos`: itens com semáforo vermelho agregados por `codigo` (sem código: por `titulo`); `valor` = Σ `lucro` (negativo, `round2`); `vendas` = nº de `orderId` distintos; ordenado por `valor` asc (maior prejuízo primeiro).

- [ ] **Step 1: Testes (falham)**: `agrega por SKU somando só as vendas vermelhas` (SKU com 1 venda vermelha −4,10 e 1 verde +10 → `valor: -4.1, vendas: 1`); `sem código agrega pelo título`; `ordena pelo maior prejuízo`; `contagem prejuizo inalterada` (mesmo fixture: `prejuizo` igual ao valor antes da mudança).
- [ ] **Step 2:** `./node_modules/.bin/vitest run supabase/functions/_shared/notificacoes/gerencial/__tests__/resultado.test.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Mesmo comando → PASS (inclusive os testes de paridade existentes).
- [ ] **Step 5:** Commit `feat(resumo): contarAtencao nomeia os itens com prejuízo (fase 1)`.

### Task 4: IO — janela de 30 dias, catálogo de estoque e `montarDadosResumo`

**Files:**
- Modify: `supabase/functions/_shared/notificacoes/gerencial/janelas.ts` (nova `janela30Dias`)
- Modify: `supabase/functions/_shared/notificacoes/gerencial/resumo-io.ts` (`lerCatalogoEstoque`, `montarDadosResumo`)
- Modify: `supabase/functions/_shared/notificacoes/gerencial/mensagens.ts` (só o tipo `DadosResumo`)
- Test: `__tests__/janelas.test.ts` (existente ou novo), `__tests__/resumo-io.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `janela30Dias(dia: string): JanelaIso` — `desde` = início BRT de `dia − 29`, `ate` = `janelaDia(dia).ate`.
  - `lerCatalogoEstoque(admin: SupabaseClient, orgId: string, codigos: string[]): Promise<Map<string, CatalogoEstoque>>` — `variacoes` (`codigo, nome, estoque`) com `familias!inner(nome_pai, kit_multiplicador, criado_em, id)`, filtro `org_id = orgId` nas duas, `.in('codigo', codigos)` em lotes de 50; canônica = família mais nova (`criado_em desc, id desc`), igual a `vendas_sku_catalogo`; `ehKit = kit_multiplicador != null`. Erro de leitura → lança.
  - Fake de PostgREST (`supabase/functions/_shared/**/__tests__/fake-postgrest.ts` ou o usado em `resumo-io.test.ts`): passar a suportar o embed `familias!inner(...)`, filtro por coluna do embed e `.order()` — sem isso a consulta nova não é testável.
  - `DadosResumo` ganha `estoque: ItemEstoque[] | null` (null = seção indisponível) e `atencao.prejuizos: PrejuizoSku[]` com nomes já resolvidos: `PrejuizoSku` vira `{ nome: string; valor: number; vendas: number }` no `DadosResumo` (nome = `nomeSku` do catálogo, senão `titulo`, senão código).
  - Em `montarDadosResumo`: bloco do estoque em `try/catch` próprio — `lerVendasJanela(db, orgId, janela30Dias(dia))` + `carregarContexto(db, orgId, j30.desde)` + `resultadoPorItem` + `lerCatalogoEstoque(codigos dos itens)` + `selecionarEstoqueAcabando(..., j30.ate)`; em erro: `console.error('resumo_estoque_indisponivel', ...)` e `estoque: null`. A resolução de nome do prejuízo também não pode derrubar o resumo (falha → usa título).

- [ ] **Step 1: Testes (falham)**: `janela30Dias('2026-10-24')` → `Date.parse(desde) === Date.parse('2026-09-25T03:00:00Z')` e `Date.parse(ate) === Date.parse('2026-10-25T03:00:00Z')` (compara instante, não string); em `resumo-io.test.ts`: `leitura de 30 dias falha → estoque null, resto igual` (mock distingue a leitura de 30 dias da de ontem); `5.001 vendas na janela de 30 dias → estoque null, resto igual`; `falha só do catálogo → estoque null`; `falha no nome do prejuízo → usa título/código`; `org sem vendas → estoque []`; `canônica = família mais nova, desempate por id`; `mesmo código em outra org não vaza`; `estoque null preservado (fica fora)`; `kit marcado por kit_multiplicador`. Atualizar fixtures existentes de `DadosResumo`/`contarAtencao` para os campos novos.
- [ ] **Step 2:** `./node_modules/.bin/vitest run supabase/functions/_shared/notificacoes/gerencial` → FAIL nos novos.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Mesmo comando → PASS; `deno check --config supabase/functions/deno.json supabase/functions/resumo-diario/index.ts supabase/functions/telegram-bot/index.ts` limpo.
- [ ] **Step 5:** Commit `feat(resumo): janela de 30 dias e catálogo de estoque no resumo (fase 1)`.

### Task 5: Texto — seção 📦 e prejuízo nomeado

**Files:**
- Modify: `supabase/functions/_shared/notificacoes/gerencial/mensagens.ts` (`montarResumoDiario`)
- Test: `supabase/functions/_shared/notificacoes/gerencial/__tests__/mensagens.test.ts`

**Interfaces:**
- Consumes: `DadosResumo` da Task 4.
- Texto exato:
  - Seção (entre o bloco do mês e 🏆 Top lucro), máx. 3 + `• e mais N`:
    `📦 Estoque acabando` / `• {nome} — {estoque} un. · {porDia}/dia · {cobertura} dias` / `• {nome} — zerado (vendia {porDia}/dia)`. `porDia` com 1 casa decimal em pt-BR e sem `,0` (`3/dia`, `0,5/dia`); `1 dia` no singular. `estoque: null` ou lista vazia → seção some.
  - ⚠️ Atenção: no lugar de `• N com prejuízo`, até 3 linhas `• Prejuízo: {nome} — {brl(valor)} ({vendas} venda|vendas)` + `• e mais N com prejuízo` quando houver mais; `abaixo do mínimo` e `sem custo` seguem contados.

- [ ] **Step 1: Testes (falham)**: resumo completo com 4 itens de estoque (1 zerado) → `toBe` exato do bloco com 3 linhas + `• e mais 1`; `estoque: null` → nenhuma linha com `📦`; prejuízo com 4 SKUs → 3 nomeados + `• e mais 1 com prejuízo`; singular `(1 venda)` e `1 dia`; ordem dos blocos (mês → 📦 → 🏆 → ⚠️).
- [ ] **Step 2:** `./node_modules/.bin/vitest run supabase/functions/_shared/notificacoes/gerencial/__tests__/mensagens.test.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Mesmo comando → PASS; suíte `./node_modules/.bin/vitest run supabase/functions` verde.
- [ ] **Step 5:** Commit `feat(resumo): seção estoque acabando e prejuízo nomeado no texto (fase 1)`.

### Task 6: Medição, docs e entrega

**Files:**
- Modify: `docs/decisions/0190-*.md` (emenda: fase 1), `docs/reference/edge-functions.md` (resumo), `docs/TASKS.md`, `obsidian-vault/09-Logs/Changelog.md`

- [ ] **Step 1: Benchmark de CPU (antes do merge)** — script `scripts/bench-resumo-estoque.ts` (vitest `bench` ou `process.cpuUsage`) com 5.000 vendas sintéticas (2–3 itens, 300 SKUs, 30 dias): `resultadoPorItem` + `selecionarEstoqueAcabando` + `montarResumoDiario` ≤ **250 ms** de CPU. Se passar disso, parar e revisar a estratégia (RPC SQL) antes de seguir.
- [ ] **Step 1b:** portão único `pnpm preflight` (ou, se o `pnpm` recusar por `node_modules` linkado, as mesmas etapas pelos binários: `node scripts/checar-links-docs.mjs`, `deno lint`, `deno check` de todas as funções, `eslint`, `tsc -b --force`, `vite build`, `vitest run`).
- [ ] **Step 2:** Docs (emenda curta no ADR-0190 apontando o spec; TASKS; Changelog).
- [ ] **Step 3:** Revisão do diff pelo Codex gpt-6.1-sol high (read-only) → corrigir achados → CI verde → merge fast-forward.
- [ ] **Step 4:** Deploy das edges que importam `resumo-io.ts`/`mensagens.ts` (calcular por `deno info`; no mínimo `resumo-diario`, `telegram-bot`, `notificar-carrinho`, `sync-venda`) e conferir versão `ACTIVE`.
- [ ] **Step 5:** Validação real: `/ontem` na DSA e na Hairfly (texto com as seções); `functions.combined-stats` do `resumo-diario`/`telegram-bot` com CPU ≤ 500 ms — acima disso, redeploy da versão anterior; resumo das 08:00 do dia seguinte conferido.
