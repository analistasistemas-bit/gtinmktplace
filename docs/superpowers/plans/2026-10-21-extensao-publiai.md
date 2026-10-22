# Extensão PubliAI (navegador) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extensão Chrome (MV3, painel lateral) que, para contas PubliAI com o módulo ligado, mostra **minha margem** e dados observados/estimativas rotuladas sobre anúncios do Mercado Livre, sem base de mercado própria.

**Architecture:** A extensão lê a página do ML (initialState/DOM) e envia o mínimo para uma Edge Function `extensao` do PubliAI, autenticada com a sessão Supabase do usuário; o servidor checa módulo/organização, usa o token ML da organização **só em leituras**, calcula a margem com as peças financeiras existentes e devolve o resultado pronto. Na página do ML só há selos; a análise abre no side panel.

**Tech Stack:** Chrome MV3 (`sidePanel`, `storage`, `externally_connectable`), TypeScript + React + Vite (build próprio da extensão em `extensao/`), Supabase Edge Functions (Deno), Postgres com RLS, Upstash Redis, vitest.

**Spec:** `docs/decisions/0189-extensao-publiai-navegador.md` (ADR-0189) + glossário `CONTEXT.md` § Extensão do navegador.

## Global Constraints

- Sem base de mercado: nada de anúncio de concorrente é gravado no servidor, exceto o **vínculo de produto** da organização (catálogo ML → variação) e o **registro de erro de leitura** (ID do anúncio + tipo de página + versão). (D-1, D-19)
- Endpoints ML permitidos no servidor: `/sites/MLB/listing_prices`, shipping options do vendedor (via `buscarFreteVendedorComProveniencia`), `/users/{id}`, `/products/{id}`, `/products/{id}/items`, `/trends/MLB/{cat}`, `/highlights/MLB/category/{id}`, e leituras de **itens da própria organização**. Nunca `/items/{id}` de concorrente nem `/sites/MLB/search`. Nunca Sonar/Apify. (D-1, D-2, contexto 3)
- Token ML nunca sai do servidor. (D-17)
- Módulo `extensao` em `organizations.modulos_habilitados`, desligado por padrão, checado no servidor com `exigirModulo`. (D-18)
- Limite técnico: **30 análises por minuto por usuário**; acima disso, HTTP 429 com mensagem "Muitas análises em sequência. Aguarde um minuto." (D-18)
- Ausência nunca vira zero: comissão, frete ou alíquota indisponíveis → o tipo de anúncio correspondente sai como `indisponivel` com o motivo. Alíquota exige `configuracoes.aliquotas_confirmadas_em` preenchido (ADR-0086). (D-7)
- Imposto por origem: `importado` → `aliquota_importado_pct ?? 16`; senão `aliquota_nacional_pct ?? 8` (mesma regra de `process-familia/index.ts:360`). (D-7)
- Custo da margem = `variacoes.custo × unidades_por_pacote` (padrão 1). (D-8)
- Permissões do manifest: `sidePanel`, `storage`; `host_permissions` só `https://*.mercadolivre.com.br/*`; `externally_connectable.matches` só `https://publiai.daludi.com.br/*` e `https://ean2marketplace-frontend.onrender.com/*`. Proibido `<all_urls>`, `webRequest`, `declarativeNetRequest`, iframe de página de concorrente, patch de `fetch`/XHR. (D-14)
- Telemetria: nenhuma biblioteca de terceiros (PostHog, Amplitude, Sentry). (D-19)
- Textos de UI em pt-BR com acentuação; rótulos fixos: "Minha margem", "Estimativa", "Observado", "Abrir no PubliAI", "Custo do SKU {codigo} · {fonte}". (D-6, D-8, D-9)
- Dropdowns no PubliAI web: `src/components/ui/select.tsx`. (CLAUDE.md)
- Migrations só por `supabase migration new` + `supabase db push`; validar com `npm run db:check`. (ADR-0043)
- Validação antes de reportar pronto: `pnpm test -- <escopo>`, `pnpm lint` nos alterados, `pnpm build`, e `pnpm --dir extensao build` quando tocar a extensão.

## Review Focus

- **Anúncio sem `catalog_product_id`, sem EAN na sessão e sem vínculo manual** — o painel deve abrir com o campo "custo" e calcular ao digitar, não erro. (Task 4 e Task 9)
- **Comissão ou frete indisponível no ML para um dos tipos** — Clássico calculado e Premium "indisponível: comissão não informada pelo ML", nunca lucro inflado por zero. (Task 2)
- **Organização com alíquotas não confirmadas** — margem indisponível com "Confirme as alíquotas de imposto em Configurações", nunca 8%/16% em silêncio. (Task 5)
- **Anúncio próprio** (seller da página = `conta_externa_id` de conexão da org) — resposta `proprio: true` e atalho, sem cálculo de concorrente. (Task 5)
- **Sessão Supabase expirada/revogada na extensão** — 401 vira estado "Abra o PubliAI e conecte de novo", sem loop de requisições. (Task 7)

---

## File Structure

```
supabase/functions/_shared/extensao/
  margem.ts                 # calcularMinhaMargem (puro)
  vinculo.ts                # resolverVinculo (puro, deps injetadas)
  analisar-anuncio.ts       # analisarAnuncio (orquestração com deps injetadas)
  tipos.ts                  # contratos de entrada/saída compartilhados
  __tests__/margem.test.ts, vinculo.test.ts, analisar-anuncio.test.ts
supabase/functions/extensao/index.ts      # handler HTTP fino (roteia por `acao`)
supabase/migrations/<ts>_extensao_v1.sql  # extensao_vinculos, extensao_uso_diario, extensao_erros_leitura
extensao/                                 # a extensão (build Vite próprio)
  manifest.json
  vite.config.ts, package.json, tsconfig.json
  src/sw.ts                               # service worker: sessão, side panel, mensagens
  src/sessao.ts                           # guarda/renova sessão Supabase (chrome.storage.local)
  src/api.ts                              # cliente da Edge Function `extensao`
  src/leitura/pdp.ts                      # parser puro da página do anúncio
  src/leitura/__tests__/pdp.test.ts + __fixtures__/
  src/conteudo/anuncio.ts                 # content script: lê PDP, injeta selo
  src/painel/                             # side panel React (index.html, App.tsx, blocos)
src/lib/modulos.ts                        # + 'extensao'
src/pages/... (Configurações → Extensão) # conectar/desconectar + link de instalação
supabase/functions/usuarios/index.ts      # MODULOS_VALIDOS + 'extensao'
```

---

## Fatia 1 — Base + anúncio com minha margem e vínculo

### Task 1: Módulo `extensao`

**Files:**
- Modify: `src/lib/modulos.ts` (union `ModuloId` e array `MODULOS`)
- Modify: `supabase/functions/usuarios/index.ts` (`MODULOS_VALIDOS`)
- Test: `src/lib/__tests__/modulos.test.ts` (criar ou estender)

**Interfaces:**
- Produces: `ModuloId` inclui `'extensao'`; rótulo exibido na Central de controle: "Extensão do navegador".

- [ ] **Step 1: Teste falhando** — `it('lista o módulo extensao com rótulo', () => expect(MODULOS.find(m => m.id === 'extensao')?.rotulo).toBe('Extensão do navegador'))` (ajustar o nome do campo de rótulo ao que `MODULOS` já usa).
- [ ] **Step 2:** `pnpm test -- src/lib/__tests__/modulos.test.ts` → FAIL.
- [ ] **Step 3:** Acrescentar `'extensao'` em `ModuloId`, `MODULOS` e `MODULOS_VALIDOS` (o menu do app não ganha item: a extensão não tem tela própria no menu além de Configurações).
- [ ] **Step 4:** Teste → PASS; `pnpm build` → OK.
- [ ] **Step 5:** Commit `feat(extensao): módulo extensao por organização (ADR-0189 D-18)`.

### Task 2: Função pura `calcularMinhaMargem`

**Files:**
- Create: `supabase/functions/_shared/extensao/tipos.ts`, `supabase/functions/_shared/extensao/margem.ts`
- Test: `supabase/functions/_shared/extensao/__tests__/margem.test.ts`

**Interfaces:**
- Consumes: `liquidoClassico(preco, comissao, frete, aliquotaPct)` (`_shared/preco/liquido.ts`), `round2` (`_shared/dinheiro.ts`).
- Produces (`tipos.ts`):
  ```ts
  type Disponivel<T> = { estado: 'ok'; valor: T } | { estado: 'indisponivel'; motivo: string };
  interface EntradaMargemTipo { comissao: Disponivel<{ percentual: number; fixa: number }>; frete: Disponivel<number>; }
  interface EntradaMargem { preco: number; aliquotaPct: Disponivel<number>; custoUnitario: number | null; unidadesPorPacote: number; classico: EntradaMargemTipo; premium: EntradaMargemTipo; }
  interface MargemTipo { comissao: number; imposto: number; frete: number; custoTotal: number | null; recebe: number; lucro: number | null; margemPct: number | null; }
  interface MinhaMargem { preco: number; classico: Disponivel<MargemTipo>; premium: Disponivel<MargemTipo>; }
  ```
  `calcularMinhaMargem(e: EntradaMargem): MinhaMargem` em `margem.ts`.

- [ ] **Step 1: Testes falhando** (valores do caso real validado no Chrome em 2026-10-21, preço R$ 213,19):
  ```ts
  it('Clássico 12%, frete 25,45, imposto 7%, custo 80 → recebe 147,24, lucro 67,24', ...)
  // comissao {percentual:12,fixa:0}, frete 25.45, aliquota 7, custoUnitario 80, unidades 1
  // expect classico.valor: { comissao: 25.58, imposto: 14.92, frete: 25.45, recebe: 147.24, custoTotal: 80, lucro: 67.24, margemPct: 31.54 }
  it('Premium 17% no mesmo cenário → recebe 136,58', ...)
  it('custoUnitario null → recebe calculado, lucro e margemPct null', ...)
  it('unidadesPorPacote 2 → custoTotal = 2 × custoUnitario', ...)
  it('comissão indisponível no Premium → premium indisponivel com o motivo, clássico ok', ...)
  it('aliquota indisponivel → ambos indisponivel com o motivo da alíquota', ...)
  it('recebe igual a liquidoClassico(preco, comissao, frete, aliquota) arredondado em 2 casas', ...)
  ```
  `margemPct` = `lucro / preco × 100`, arredondado em 2 casas.
- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/extensao/__tests__/margem.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `calcularMinhaMargem` com `liquidoClassico` para `recebe` (aplicado a cada tipo com sua comissão) e `round2` só na saída. Arquivo sem import `jsr:`/`npm:` (testável no vitest).
- [ ] **Step 4:** Testes → PASS.
- [ ] **Step 5:** Commit `feat(extensao): calcularMinhaMargem pura (ADR-0189 D-7)`.

### Task 3: Migration `extensao_v1`

**Files:**
- Create: `supabase/migrations/<timestamp>_extensao_v1.sql` (via `supabase migration new extensao_v1`)
- Modify: `src/lib/database.types.ts` (tabelas novas consumidas pelo front: só `extensao_vinculos`)

**Interfaces:**
- Produces:
  - `extensao_vinculos(id uuid pk, org_id uuid not null → organizations, catalog_product_id text not null, variacao_id uuid not null → variacoes on delete cascade, criado_por uuid → auth.users, criado_em timestamptz default now(), atualizado_em timestamptz)`, `unique (org_id, catalog_product_id)`.
  - `extensao_uso_diario(org_id uuid, user_id uuid, dia date, tipo_pagina text check in ('anuncio','busca','catalogo'), analises int not null default 0, primary key (org_id, user_id, dia, tipo_pagina))`.
  - `extensao_erros_leitura(id bigint generated always as identity pk, org_id uuid not null, user_id uuid, tipo_pagina text, ml_item_id text, versao_extensao text, detalhe text, criado_em timestamptz default now())`.
  - RLS ligada nas três; `select` para `authenticated` com `org_id = (select public.current_org_id())`; escrita só por `service_role` (Edge). Grants explícitos como `20260816125057_pulse_v1.sql`. Trigger `moddatetime` em `extensao_vinculos.atualizado_em`.

- [ ] **Step 1:** `supabase migration new extensao_v1` e escrever o SQL acima.
- [ ] **Step 2:** `npm run db:check` → OK.
- [ ] **Step 3:** Teste SQL sem Docker conforme `scripts/teste-sql-desfeito.py` (aplicar em transação desfeita e conferir: insert como service_role ok; select de outra org retorna 0 linhas).
- [ ] **Step 4:** Atualizar `database.types.ts` para `extensao_vinculos`.
- [ ] **Step 5:** Commit `feat(extensao): tabelas de vínculo, uso e erro de leitura (ADR-0189 D-8/D-19)`. (`supabase db push` só no deploy da fatia, com o Diego.)

### Task 4: Resolver vínculo de produto

**Files:**
- Create: `supabase/functions/_shared/extensao/vinculo.ts`
- Test: `supabase/functions/_shared/extensao/__tests__/vinculo.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type FonteCusto = 'catalogo' | 'ean_da_busca' | 'vinculo_manual' | 'nenhuma';
  interface VariacaoCusto { variacaoId: string; codigo: string; custo: number | null; origem: 'nacional' | 'importado'; }
  interface DepsVinculo {
    porCatalogo(orgId: string, catalogProductId: string): Promise<VariacaoCusto | null>; // variacoes.catalog_product_id
    porGtin(orgId: string, gtin: string): Promise<VariacaoCusto | null>;                  // variacoes.gtin (normalizado por _shared/produto/gtin.ts)
    porVinculoManual(orgId: string, catalogProductId: string): Promise<VariacaoCusto | null>; // extensao_vinculos
  }
  resolverVinculo(orgId: string, e: { catalogProductId: string | null; eanDaBusca: string | null }, deps: DepsVinculo): Promise<{ fonte: FonteCusto; variacao: VariacaoCusto | null }>
  ```
- [ ] **Step 1: Testes falhando:** ordem catálogo → EAN → manual → nenhuma (cada um só consultado se o anterior falhar); `catalogProductId` null pula catálogo e manual; EAN inválido (checksum) é ignorado; mais de uma variação para o mesmo GTIN → `fonte:'nenhuma'` (ambíguo nunca escolhe sozinho).
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(extensao): resolverVinculo na ordem da ADR-0189 D-8`.

### Task 5: Orquestração `analisarAnuncio`

**Files:**
- Create: `supabase/functions/_shared/extensao/analisar-anuncio.ts`
- Test: `supabase/functions/_shared/extensao/__tests__/analisar-anuncio.test.ts`

**Interfaces:**
- Consumes: `calcularMinhaMargem` (Task 2), `resolverVinculo` (Task 4).
- Produces:
  ```ts
  interface EntradaAnuncio { mlItemId: string; sellerId: string; catalogProductId: string | null; categoriaId: string; preco: number; eanDaBusca: string | null; precoSimulado?: number; }
  interface DepsAnuncio extends DepsVinculo {
    contasDaOrg(orgId: string): Promise<string[]>;                       // marketplace_connections.conta_externa_id (ML)
    aliquotas(orgId: string): Promise<{ confirmada: boolean; nacional: number | null; importado: number | null }>;
    comissao(preco: number, categoriaId: string, tipo: 'gold_special' | 'gold_pro'): Promise<Disponivel<{ percentual: number; fixa: number }>>;
    frete(preco: number, categoriaId: string): Promise<Disponivel<number>>; // para a conta da org
    unidadesPorPacote(catalogProductId: string | null): Promise<number>;   // /products/{id} UNITS_PER_PACK, padrão 1
  }
  interface RespostaAnuncio { proprio: boolean; margem: MinhaMargem | null; custo: { fonte: FonteCusto; codigo: string | null; custoUnitario: number | null; unidadesPorPacote: number }; }
  analisarAnuncio(orgId: string, e: EntradaAnuncio, deps: DepsAnuncio): Promise<RespostaAnuncio>
  ```
- [ ] **Step 1: Testes falhando:** `sellerId` ∈ `contasDaOrg` → `{ proprio: true, margem: null }` sem chamar comissão/frete; alíquota não confirmada → ambos os tipos `indisponivel` com "Confirme as alíquotas de imposto em Configurações"; origem `importado` usa `importado ?? 16`; `precoSimulado` substitui `preco` em comissão, frete e margem; sem variação → `custoUnitario: null` e margem com `lucro: null`.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat(extensao): analisarAnuncio (ADR-0189 D-5/D-7)`.

### Task 6: Edge Function `extensao`

**Files:**
- Create: `supabase/functions/extensao/index.ts`
- Modify: `supabase/config.toml` (`[functions.extensao]`, `verify_jwt = true`)
- Test: `supabase/functions/extensao/__tests__/roteamento.test.ts` (lógica de roteamento e validação de payload extraída para função pura no mesmo diretório)

**Interfaces:**
- Consumes: `requireUserOrg` (`_shared/auth.ts:36`), `exigirModulo` (`_shared/produto/modulo.ts:8`), `resolverConexao` (`_shared/canais/conexao.ts:22`), `getValidAccessTokenConexao` (`_shared/ml/token.ts:104`), `buscarListingPrice` + `comissaoDeComProveniencia`, `buscarFreteVendedorComProveniencia` (`mlUserId = conexao.contaExternaId`), `mlGet`, `redisIncrComTTL`, `redisGet/redisSet`, `analisarAnuncio`.
- Produces — `POST /functions/v1/extensao`, corpo `{ acao, ... }`:
  - `analisar_anuncio` + `EntradaAnuncio` → `RespostaAnuncio`
  - `buscar_sku` + `{ termo: string }` → `{ itens: { variacaoId, codigo, nome, custo }[] }` (máx. 10; nome/código/GTIN da org)
  - `salvar_vinculo` + `{ catalogProductId, variacaoId }` → `{ ok: true }` (`requireUserOrg` com `access:'write'`)
  - `remover_vinculo` + `{ catalogProductId }` → `{ ok: true }`
  - `erro_leitura` + `{ tipoPagina, mlItemId, versao, detalhe }` → `{ ok: true }`
  - Erros: 401 sem sessão, 403 `{ erro: 'modulo_desligado' }`, 429 `{ erro: 'limite' }`, 400 payload inválido.
- [ ] **Step 1: Testes falhando** para `validarPedido(corpo)` (acao desconhecida → 400; `analisar_anuncio` sem `mlItemId`/`preco` numérico → 400) e `chaveLimite(userId, agora)` (`ext:rl:{userId}:{AAAAMMDDHHmm}`).
- [ ] **Step 2–4:** FAIL → implementar handler fino + funções puras → PASS.
- [ ] **Step 5:** Cache Redis de comissão por `ext:lp:{categoria}:{tipo}:{preco}` e de frete por `ext:fr:{orgId}:{categoria}:{preco}`, TTL 6 h. Uso: `upsert` em `extensao_uso_diario` incrementando `analises` em `analisar_anuncio`.
- [ ] **Step 6:** `pnpm test -- supabase/functions/extensao` + `pnpm build` → OK. Commit `feat(extensao): edge extensao (ADR-0189 D-17/D-18/D-19)`.

### Task 7: Esqueleto da extensão + sessão

**Files:**
- Create: `extensao/manifest.json`, `extensao/package.json`, `extensao/vite.config.ts`, `extensao/tsconfig.json`, `extensao/src/sw.ts`, `extensao/src/sessao.ts`, `extensao/src/api.ts`
- Test: `extensao/src/__tests__/sessao.test.ts`, `extensao/src/__tests__/api.test.ts`
- Modify: `pnpm-workspace.yaml` (incluir `extensao`), `.github/workflows/*` só se o CI precisar rodar `pnpm --dir extensao build`

**Interfaces:**
- Produces:
  - Mensagem externa aceita do PubliAI (`chrome.runtime.onMessageExternal`, origem validada contra `externally_connectable`): `{ tipo: 'publiai:conectar', accessToken, refreshToken, expiresAt, orgNome }` e `{ tipo: 'publiai:desconectar' }`.
  - `obterSessaoValida(): Promise<{ accessToken: string } | null>` (renova com `refreshToken` via `@supabase/supabase-js` `auth.refreshSession` quando faltar < 5 min; falha de renovação → limpa e devolve null).
  - `chamarExtensao<T>(corpo: object): Promise<{ ok: true; dados: T } | { ok: false; status: number; erro: string }>`; 401 → limpa sessão.
  - `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
- [ ] **Step 1: Testes falhando:** mensagem de origem não autorizada é ignorada; `desconectar` apaga `chrome.storage.local`; renovação falha → `null`; 401 limpa sessão; 403 `modulo_desligado` repassado.
- [ ] **Step 2–4:** FAIL → implementar (chrome API mockada no vitest) → PASS; `pnpm --dir extensao build` gera `extensao/dist` carregável.
- [ ] **Step 5:** Commit `feat(extensao): esqueleto MV3 com sessão conectada pelo PubliAI (ADR-0189 D-4/D-14)`.

### Task 8: Parser da página do anúncio

**Files:**
- Create: `extensao/src/leitura/pdp.ts`, `extensao/src/leitura/__fixtures__/pdp-MLB4641624520.json`, `extensao/src/leitura/__fixtures__/pdp-catalogo-MLB44224164.json`
- Test: `extensao/src/leitura/__tests__/pdp.test.ts`

**Interfaces:**
- Produces: `lerAnuncio(doc: Document): { ok: true; dados: Omit<EntradaAnuncio, 'eanDaBusca' | 'precoSimulado'> & { vendidosTexto: string | null; titulo: string } } | { ok: false; motivo: string }` — lê `__NORDIC_RENDERING_CTX__` (`_n.ctx.r` → `appProps.pageProps.initialState`); fallback `__PRELOADED_STATE__`.
- [ ] **Step 1:** Capturar as fixtures das duas páginas reais (mesmos anúncios validados em 2026-10-21) reduzindo o `initialState` aos campos usados; documentar a data da captura no topo do teste.
- [ ] **Step 2: Testes falhando:** MLB4641624520 → `{ mlItemId: 'MLB4641624520', sellerId: '209471703', catalogProductId: 'MLB27944195', categoriaId: 'MLB122102', preco: 213.19, vendidosTexto: '+1000 vendidos' }`; catálogo MLB44224164 → `catalogProductId: 'MLB44224164'`; HTML sem estado → `{ ok:false, motivo:'estado_nao_encontrado' }`.
- [ ] **Step 3–4:** implementar → PASS.
- [ ] **Step 5:** Commit `feat(extensao): parser da página do anúncio`.

### Task 9: Content script do anúncio + selo + EAN da busca

**Files:**
- Create: `extensao/src/conteudo/anuncio.ts`, `extensao/src/conteudo/busca-ean.ts`
- Modify: `extensao/manifest.json` (`content_scripts` para `https://produto.mercadolivre.com.br/*`, `https://www.mercadolivre.com.br/*/p/*`, `https://www.mercadolivre.com.br/up/*`, `https://lista.mercadolivre.com.br/*`)
- Test: `extensao/src/conteudo/__tests__/busca-ean.test.ts`

**Interfaces:**
- Produces:
  - `eanDaUrlDeBusca(url: string): string | null` — 8, 12, 13 ou 14 dígitos com dígito verificador válido no primeiro segmento do path de `lista.mercadolivre.com.br`; guardado em `chrome.storage.session` por aba ao navegar da busca para o anúncio.
  - Selo "Minha margem R$ X (Clássico)" junto ao preço; clique pede ao SW para abrir o side panel da aba. Falha de leitura → `erro_leitura` + nenhum selo.
- [ ] **Step 1: Testes falhando** para `eanDaUrlDeBusca` (`'https://lista.mercadolivre.com.br/7899941205918'` → `'7899941205918'`; termo textual → null; 13 dígitos com checksum inválido → null).
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat(extensao): content script do anúncio com selo e EAN da busca`.

### Task 10: Side panel — bloco Minha margem e vínculo

**Files:**
- Create: `extensao/src/painel/index.html`, `extensao/src/painel/main.tsx`, `extensao/src/painel/App.tsx`, `extensao/src/painel/MinhaMargem.tsx`, `extensao/src/painel/VinculoProduto.tsx`
- Test: `extensao/src/painel/__tests__/MinhaMargem.test.tsx`, `extensao/src/painel/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `chamarExtensao` (Task 7), `RespostaAnuncio` (Task 5), dados do content script via `chrome.runtime` (Task 9).
- Produces — estados da tela: `sem_sessao` ("Abra o PubliAI e conecte a extensão"), `modulo_desligado` ("A extensão não está habilitada para sua empresa"), `proprio` (atalho "Abrir no PubliAI"), `analise` (Clássico e Premium lado a lado com comissão, imposto, frete, custo, recebe, lucro e %; preço editável com debounce de 400 ms; linha "Custo do SKU {codigo} · {fonte}" ou campo "Custo" quando `fonte:'nenhuma'`; botão "Este produto é meu SKU…" → busca e salva vínculo), `limite` (mensagem do 429).
- [ ] **Step 1: Testes falhando:** renderiza "indisponível: {motivo}" no tipo indisponível; custo digitado recalcula no cliente com `calcularMinhaMargem` reaproveitado (copiar `margem.ts` para `extensao/src/compartilhado/` via build alias, sem duplicar código); fonte `catalogo` exibe "Custo do SKU 00123 · casado pelo catálogo".
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat(extensao): side panel com minha margem e vínculo de produto (ADR-0189 D-6/D-7/D-8/D-16)`.

### Task 11: PubliAI web — conectar a extensão

**Files:**
- Create: `src/components/configuracoes/extensao-navegador.tsx`, `src/lib/extensao-ponte.ts`
- Modify: página de Configurações (aba/seção nova, visível só com módulo `extensao`), fluxo de logout (`publiai:desconectar`)
- Test: `src/lib/__tests__/extensao-ponte.test.ts`, `src/components/configuracoes/__tests__/extensao-navegador.test.tsx`

**Interfaces:**
- Produces: `conectarExtensao(extensionId: string, sessao: Session): Promise<'ok' | 'nao_instalada'>` e `desconectarExtensao(extensionId)`; `EXTENSAO_ID` em `VITE_EXTENSAO_ID`. Tela: link "Instalar extensão" (URL da Web Store em `VITE_EXTENSAO_URL`), botão "Conectar extensão", estado conectado/não instalada.
- [ ] **Step 1: Testes falhando:** sem `chrome.runtime` → `'nao_instalada'`; logout chama `desconectarExtensao`; seção oculta sem o módulo.
- [ ] **Step 2–4:** FAIL → implementar → PASS; `pnpm build`.
- [ ] **Step 5:** Commit `feat(extensao): conectar extensão a partir do PubliAI (ADR-0189 D-4)`.

### Task 12: Publicação da fatia 1 e documentação

**Files:**
- Create: `docs/how-to/usar-a-extensao.md`, `extensao/PRIVACIDADE.md`, `scripts/empacotar-extensao.sh`
- Modify: `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md`, `docs/TASKS.md`, `docs/project-status.md`

- [ ] **Step 1:** `scripts/empacotar-extensao.sh` gera `extensao/publiai-extensao-<versao>.zip` a partir de `extensao/dist`.
- [ ] **Step 2:** Política de privacidade (o que lê, o que envia, o que registra — D-19) e texto da loja.
- [ ] **Step 3:** Docs de referência e how-to; TASKS atualizado.
- [ ] **Step 4:** Deploy com o Diego: `supabase db push`, `supabase functions deploy extensao`, versão ativa conferida; ligar o módulo na DSA; submeter à Web Store como **não listada** (ação do Diego na conta de desenvolvedor).
- [ ] **Step 5:** Commit `docs(extensao): how-to, privacidade e referências da fatia 1`.

---

## Fatia 2 — Quanto vende + qualidade + vendedor + radar + mídia (tarefas)

- **Task 13 — Validação da estimativa:** script `scripts/validar-estimativa-vendas.ts` que, para anúncios próprios ativos, compara a estimativa (faixa pública + avaliações + idade + tipo, constantes do relatório Avant: ×15 avaliações; +15% < 6 meses; −25% > 12 meses; +15% Premium; consolidado 0,6/0,4) com as vendas reais (Vendas SKU). Saída: erro mediano e por faixa. **Gate:** ≤ 30% → exibir; acima → ajustar constantes ou exibir só observado (decisão registrada na ADR como errata).
- **Task 14 — `estimarVendas` pura** em `extensao/src/compartilhado/estimativa.ts` (constantes vindas da Task 13) + testes com os casos reais (piso 1000, 905 dias, Clássico → valores esperados medidos na Task 13).
- **Task 15 — Bloco "Quanto vende"** no painel: linha Observado (faixa, criado em, ≥ X/mês = piso ÷ meses) e linha Estimativa (rótulo + método em tooltip), conforme gate.
- **Task 16 — Vendedor:** `acao: 'vendedor'` na edge → `/users/{id}` (nickname, `level_id`, `power_seller_status`, `transactions.total`, cidade/UF), cache 24 h; bloco no painel.
- **Task 17 — Qualidade do anúncio:** regras locais puras (sem Clips, < 5 fotos, descrição < 500 ou ausente, "Sem garantia", estoque < 50, fotos com qualquer dimensão < 1200) + destaque das miniaturas; semáforo de idade (≤ 180 verde, 181–365 amarelo, > 365 vermelho).
- **Task 18 — Radar do Pulse:** `acao: 'radar'` → leitura de `pulse_produtos`/ofertas/alertas da org por `catalog_product_id` (só com módulo `pulse`); botão "Adicionar ao radar" chama a lógica de `pulse-adicionar`. Nenhuma escrita além do que `pulse-adicionar` já faz.
- **Task 19 — Baixar mídia:** zip local das fotos/vídeos lidos do estado da página (sem servidor).

## Fatia 3 — Busca (tarefas)

- **Task 20 — Parser de busca:** lê os polycards do `initialState` (`item_id`, preço, `metadata.tracks.sold_quantity`, avaliações, Full/frete grátis, tipo, oficial, `metadata.product_id`).
- **Task 21 — Margem em lote:** `acao: 'analisar_busca'` com até 50 itens; agrupa por categoria/preço para reaproveitar cache de comissão/frete; custo resolvido uma vez por `catalog_product_id`/EAN da busca.
- **Task 22 — Selos nos cards + resumo lateral** (vendidos da página, menor/maior preço, medalhas, Full, catálogo × fora, oficiais, patrocinados, com oferta) com filtros clicáveis e ordenação por vendidos, preço e minha margem.

## Fatia 4 — Catálogo (tarefas)

- **Task 23 — `acao: 'catalogo'`:** `/products/{id}` + `/products/{id}/items` + `/users` em lote (cache), sem inferir vencedor; vencedor só do campo que o ML informa.
- **Task 24 — Painel do catálogo:** minha margem ao preço do vencedor, vendas do catálogo (faixa), posição e preço para ganhar quando a org participa (mesma leitura do Pulse), lista de vendedores ordenável, gráficos por UF e medalha.
- **Task 25 — Encerramento da v1:** critérios de sucesso instrumentados (consulta de `extensao_uso_diario` e `extensao_erros_leitura` para a Central), atualização de `docs/Roadmap/ROADMAP-MELHORIAS-PUBLIAI.md` (remover "Extensão de navegador" do Não fazer).

---

## Revisões

- Este plano e a ADR-0189: **Codex `gpt-6.1-sol` high, read-only**, antes da aprovação.
- Ao fim de cada fatia: diff da branch revisado pelo **Grok 4.7 xhigh** (`cursor-agent -p --mode ask --model grok-4.7-xhigh … < /dev/null`) antes do merge.
