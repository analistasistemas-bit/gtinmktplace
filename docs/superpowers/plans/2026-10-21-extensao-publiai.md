# Extensão PubliAI (navegador) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extensão Chrome (MV3, painel lateral) que, para contas PubliAI com o módulo ligado, mostra **minha margem** e dados observados/estimativas rotuladas sobre anúncios do Mercado Livre, sem base de mercado própria.

**Architecture:** A extensão lê a página do ML (initialState/DOM) e envia o mínimo para uma Edge Function `extensao` do PubliAI, autenticada com o access token Supabase que o app web empurra para a extensão; o servidor checa módulo/organização, usa o token ML da organização **só em leituras**, calcula a margem com as peças financeiras existentes e devolve resultado e parâmetros. Na página do ML só há selos; a análise abre no side panel.

**Tech Stack:** Chrome MV3 (`sidePanel`, `storage`, `alarms`, `externally_connectable`), TypeScript + React + Vite (pacote `extensao/` no workspace pnpm), Supabase Edge Functions (Deno), Postgres com RLS, Upstash Redis, vitest.

**Spec:** `docs/decisions/0189-extensao-publiai-navegador.md` (ADR-0189) + glossário `CONTEXT.md` § Extensão do navegador.

## Global Constraints

- Sem base de mercado: nada de anúncio de concorrente é gravado no servidor, exceto o **vínculo de produto** da organização e o **erro de leitura** deduplicado (ID do anúncio, tipo de página, versão, motivo). (D-1, D-19)
- Endpoints ML permitidos no servidor: `/sites/MLB/listing_prices`, frete do vendedor (via `buscarFreteVendedorComProveniencia`), `/users/{id}`, `/products/{id}`, `/products/{id}/items`, `/trends/MLB/{cat}`, `/highlights/MLB/category/{id}`, e leituras de itens da **própria** organização. Nunca `/items/{id}` de concorrente nem `/sites/MLB/search`. Nunca Sonar/Apify. (D-1, D-2)
- Token ML nunca sai do servidor. A extensão guarda só o **access token** Supabase recebido do app; **nunca** guarda nem usa refresh token. O app envia também uma **identidade** (`usuário:organização:suporte`); estado por aba e painel ficam presos a ela — troca, logout, expiração e `sessao_suporte_expirada` limpam tudo e descartam respostas em voo. (D-4, D-17)
- Módulo `extensao` em `organizations.modulos_habilitados`, desligado por padrão, checado no servidor com `exigirModulo`. (D-18)
- Limite técnico: **30 análises por minuto por usuário**, HTTP 429 `{ erro: 'limite' }` com a mensagem "Muitas análises em sequência. Aguarde um minuto."; a simulação de preço é recalculada no painel e só confirma no servidor 1,5 s após o operador parar de editar. (D-18)
- Contrato de erro da edge: `{ erro: 'sessao_expirada' | 'sessao_suporte_expirada' | 'modulo_desligado' | 'limite' | 'payload_invalido' | 'interno' }`. (D-18)
- Ausência nunca vira zero: comissão, frete ou alíquota indisponíveis → tipo `indisponivel` com motivo. Alíquota exige `configuracoes.aliquotas_confirmadas_em`. Frete só é oficial com fator 1 e dimensões do SKU; sem isso → `ok` com aviso "estimado (pacote padrão)". Enquanto o preço simulado difere do confirmado, o resultado inteiro leva o rótulo "Estimativa". (D-7)
- Arredondamento: cada componente (comissão, imposto, frete) com `round2`; `recebe = preço − Σ componentes`; usar `sale_fee_amount` do ML quando o preço é o consultado. (D-7)
- Imposto por origem: `importado` → `aliquota_importado_pct ?? 16`; `nacional` → `aliquota_nacional_pct ?? 8` (regra de `process-familia/index.ts:360`). Origem vem da família vinculada ou é escolhida pelo operador no custo digitado — **sem padrão**. (D-7, D-8)
- Custo do pacote = `variacoes.custo × fator`, `fator = unidades do anúncio ÷ unidades do SKU`, **nunca presumido**: unidades do anúncio só de `/products/{id}` `UNITS_PER_PACK` (fora de catálogo ou sem o atributo → "quantidade por anúncio não confirmada"); unidades do SKU = `UNITS_PER_PACK` em `familias.atributos_ml` (kit vinculado: igual a `kit_multiplicador`); casado pelo catálogo → fator 1. Lado desconhecido → "composição não confirmada" (a resposta diz qual lado falta e o painel pede "Unidades por anúncio"/"Unidades no SKU", sem padrão); razão não inteira → "composição diferente". (D-8)
- Exceção ao "sem dado ao Pulse": "Adicionar ao radar" é ação manual do usuário que envia só o identificador de catálogo ao `pulse-adicionar`; exige módulo Pulse, escrita e auditoria de suporte. Escritas de vínculo em sessão de suporte são auditadas (`auditarOperacaoSuporte`). (D-2, D-10, D-18)
- Cache de comissão e frete inclui a conta ML da organização; unidades por pacote só cacheiam valor confirmado. (D-18)
- `transactions.total` do vendedor é janela móvel de ~365 dias: exibir o período informado pelo ML ou rótulo neutro; nunca "total histórico". (D-10)
- Manifest: permissões `sidePanel`, `storage`, `alarms` (expiração passiva da sessão, D-4); `host_permissions` só `https://*.mercadolivre.com.br/*`; `externally_connectable.matches` só `https://app.publiai.daludi.com.br/*` (+ `http://localhost:5173/*` no build de desenvolvimento). Proibido `<all_urls>`, `webRequest`, `declarativeNetRequest`, iframe de página de concorrente, patch de `fetch`/XHR. Carregar sempre de `extensao/dist`. (D-14)
- Telemetria: nenhuma biblioteca de terceiros. (D-19)
- Textos em pt-BR com acentuação; rótulos: "Minha margem", "Estimativa", "Observado", "Abrir no PubliAI", "Custo do SKU {codigo} · {fonte}". (D-6, D-8, D-9)
- Dropdowns no PubliAI web: `src/components/ui/select.tsx`. (CLAUDE.md)
- Migrations só por `supabase migration new` + `supabase db push`; teste SQL antes do deploy, `npm run db:check` (alinhamento de histórico) só depois do `db push`. (ADR-0043)
- Validação antes de reportar pronto: `pnpm test -- <escopo>`, `pnpm --dir extensao test` quando tocar a extensão, `pnpm lint` nos alterados, `pnpm build`, `pnpm --dir extensao build`.

## Review Focus

- **Anúncio sem `catalog_product_id`, sem EAN na sessão e sem vínculo manual** — painel abre com "Custo" + escolha de origem e calcula ao preencher os dois. (Tasks 4 e 10)
- **Comissão ou frete indisponível para um dos tipos** — o outro tipo calcula; o indisponível mostra o motivo. (Task 2)
- **Alíquotas não confirmadas** — margem indisponível com "Confirme as alíquotas de imposto em Configurações". (Task 5)
- **Anúncio próprio** — `proprio: true`, atalho, sem cálculo. (Task 5)
- **Access token expirado e app fechado** — estado "Abra o PubliAI", nenhuma requisição em loop. (Task 7)

---

## File Structure

```
supabase/functions/_shared/extensao/
  tipos.ts, margem.ts, vinculo.ts, analisar-anuncio.ts, erros.ts
  __tests__/margem.test.ts, vinculo.test.ts, analisar-anuncio.test.ts, erros.test.ts
supabase/functions/extensao/index.ts            # handler HTTP fino (roteia por `acao`)
supabase/migrations/<ts>_extensao_v1.sql
extensao/                                       # pacote do workspace (build Vite)
  manifest.json, package.json, vite.config.ts, vitest.config.ts, tsconfig.json
  src/sw.ts, src/sessao.ts, src/api.ts
  src/compartilhado/margem.ts                   # alias de build para _shared/extensao/margem.ts
  src/leitura/pdp.ts (+ __tests__, __fixtures__ sintéticas)
  src/conteudo/anuncio.ts, src/conteudo/busca-ean.ts
  src/painel/ (index.html, main.tsx, App.tsx, MinhaMargem.tsx, VinculoProduto.tsx)
src/lib/modulos.ts, src/lib/extensao-ponte.ts
src/components/configuracoes/extensao-navegador.tsx
supabase/functions/usuarios/index.ts            # MODULOS_VALIDOS
pnpm-workspace.yaml, .github/workflows/ci.yml
```

---

## Fatia 1 — Base + anúncio com minha margem e vínculo

### Task 1: Módulo `extensao`

**Files:** Modify `src/lib/modulos.ts`, `supabase/functions/usuarios/index.ts`; Test `src/lib/__tests__/modulos.test.ts`.

**Interfaces:** Produces `ModuloId` com `'extensao'`, rótulo "Extensão do navegador".

- [ ] **Step 1:** Teste falhando: `MODULOS` contém `{ id: 'extensao' }` com rótulo "Extensão do navegador" (usar o nome do campo de rótulo existente).
- [ ] **Step 2:** `pnpm test -- src/lib/__tests__/modulos.test.ts` → FAIL.
- [ ] **Step 3:** Acrescentar `'extensao'` em `ModuloId`, `MODULOS` e `MODULOS_VALIDOS` (sem item de menu).
- [ ] **Step 4:** PASS; `pnpm build` OK.
- [ ] **Step 5:** Commit `feat(extensao): módulo extensao por organização (ADR-0189 D-18)`.

### Task 2: Função pura `calcularMinhaMargem`

**Files:** Create `supabase/functions/_shared/extensao/tipos.ts`, `margem.ts`; Test `__tests__/margem.test.ts`.

**Interfaces:**
- Consumes: `round2` (`_shared/dinheiro.ts:2`).
- Produces (`tipos.ts`):
  ```ts
  type Disponivel<T> = { estado: 'ok'; valor: T; aviso?: string } | { estado: 'indisponivel'; motivo: string };
  interface ComissaoML { percentual: number; fixa: number; saleFeeAmount?: number; precoConsultado?: number }
  interface EntradaMargemTipo { comissao: Disponivel<ComissaoML>; frete: Disponivel<number> }
  interface EntradaMargem { preco: number; aliquotaPct: Disponivel<number>; custoPacote: Disponivel<number> | null; classico: EntradaMargemTipo; premium: EntradaMargemTipo }
  interface MargemTipo { comissao: number; imposto: number; frete: number; custo: number | null; recebe: number; lucro: number | null; margemPct: number | null; avisos: string[] }
  interface MinhaMargem { preco: number; classico: Disponivel<MargemTipo>; premium: Disponivel<MargemTipo> }
  ```
  `calcularMinhaMargem(e: EntradaMargem): MinhaMargem`. Comissão = `saleFeeAmount` quando `precoConsultado === preco`, senão `round2(preco × percentual/100 + fixa)`; imposto = `round2(preco × aliquota/100)`; `recebe = round2(preco − comissão − imposto − frete)`; `lucro = recebe − custo`; `margemPct = round2(lucro/preco × 100)`. `custoPacote: null` → `custo/lucro/margemPct` null; `custoPacote` indisponível → idem + motivo em `avisos`.

- [ ] **Step 1: Testes falhando** (caso validado no Chrome em 2026-10-21, preço R$ 213,19):
  - Clássico `{percentual:12,fixa:0}`, frete 25,45, alíquota 7, custo 80 → `{ comissao: 25.58, imposto: 14.92, frete: 25.45, recebe: 147.24, custo: 80, lucro: 67.24, margemPct: 31.54 }`.
  - Premium 17% no mesmo cenário → `comissao: 36.24, recebe: 136.58`.
  - `saleFeeAmount: 25.58, precoConsultado: 213.19` é usado; com `preco` 199 o percentual é usado (`comissao: 23.88`).
  - `custoPacote: null` → `recebe` calculado, `lucro`/`margemPct` null.
  - Comissão do Premium indisponível → `premium` indisponível com o motivo; `classico` ok.
  - Alíquota indisponível → ambos indisponíveis com o motivo da alíquota.
  - Frete `ok` com aviso "estimado (pacote padrão)" → aviso aparece em `avisos`.
- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/extensao/__tests__/margem.test.ts` → FAIL.
- [ ] **Step 3:** Implementar (arquivo sem import `jsr:`/`npm:`).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(extensao): calcularMinhaMargem pura (ADR-0189 D-7)`.

### Task 3: Migration `extensao_v1`

**Files:** Create `supabase/migrations/<ts>_extensao_v1.sql` (via `supabase migration new extensao_v1`).

**Interfaces — produz:**
- `extensao_vinculos(id uuid pk default gen_random_uuid(), org_id uuid not null → organizations, chave_tipo text not null check (chave_tipo in ('catalogo','item')), chave text not null, variacao_id uuid not null → variacoes on delete cascade, criado_por uuid → auth.users, criado_em timestamptz default now(), atualizado_em timestamptz)`, `unique (org_id, chave_tipo, chave)`, trigger `moddatetime`.
- `extensao_uso_diario(org_id uuid, user_id uuid, dia date, tipo_pagina text check in ('anuncio','busca','catalogo'), analises int not null default 0, primary key (org_id, user_id, dia, tipo_pagina))` + RPC `extensao_registrar_uso(p_org_id uuid, p_user_id uuid, p_tipo text)` (`insert … on conflict do update set analises = analises + 1`), `security definer`, execute só `service_role`.
- `extensao_erros_leitura(org_id uuid, dia date, tipo_pagina text, versao_extensao text, motivo text, ultimo_ml_item_id text, ocorrencias int not null default 1, atualizado_em timestamptz default now(), primary key (org_id, dia, tipo_pagina, versao_extensao, motivo))` + RPC `extensao_registrar_erro(...)` (incrementa `ocorrencias`, atualiza `ultimo_ml_item_id`), execute só `service_role`.
- RLS ligada nas três; `select` para `authenticated` com `org_id = (select public.current_org_id())`; escrita só via `service_role`. Grants explícitos como `20260816125057_pulse_v1.sql`.

- [ ] **Step 1:** Escrever o SQL.
- [ ] **Step 2:** `python3 scripts/teste-sql-desfeito.py` com o SQL + asserções (**atenção:** o script roda em **produção**, dentro de transação desfeita; o SQL da migration precisa ser revisado antes): insert via service_role ok; select com `current_org_id()` de outra org → 0 linhas; duas chamadas de `extensao_registrar_uso` → `analises = 2`; duas de `extensao_registrar_erro` com mesma chave → `ocorrencias = 2`.
- [ ] **Step 3:** Commit `feat(extensao): tabelas de vínculo, uso e erro de leitura (ADR-0189 D-8/D-19)`. (`supabase db push` só no deploy da fatia, com o Diego; **depois** do push, `npm run db:check` confirma o histórico alinhado — antes disso ele necessariamente difere do remoto. `database.types.ts` não muda — o front não consome essas tabelas.)

### Task 4: Resolver vínculo de produto

**Files:** Create `supabase/functions/_shared/extensao/vinculo.ts`; Test `__tests__/vinculo.test.ts`.

**Interfaces:**
```ts
type FonteCusto = 'catalogo' | 'ean_da_busca' | 'vinculo_manual' | 'nenhuma';
interface VariacaoCusto { variacaoId: string; codigo: string; custo: number | null; origem: 'nacional' | 'importado'; unidadesSku: number | null; dimensoes: DimensoesPacote | null }
interface DepsVinculo {
  porCatalogo(orgId: string, catalogProductId: string): Promise<VariacaoCusto[]>;   // variacoes.catalog_product_id
  porGtin(orgId: string, gtin: string): Promise<VariacaoCusto[]>;                    // variacoes.gtin normalizado (_shared/produto/gtin.ts)
  porVinculoManual(orgId: string, chave: { tipo: 'catalogo' | 'item'; valor: string }): Promise<VariacaoCusto | null>;
}
resolverVinculo(orgId: string, e: { catalogProductId: string | null; mlItemId: string; eanDaBusca: string | null }, deps: DepsVinculo): Promise<{ fonte: FonteCusto; variacao: VariacaoCusto | null }>
fatorDoPacote(unidadesAnuncio: number | null, unidadesSku: number | null): Disponivel<number>   // em margem.ts (alias @margem)
custoDoPacote(custoSku: number, fator: Disponivel<number>): Disponivel<number>
```
`unidadesSku` = `UNITS_PER_PACK` de `familias.atributos_ml` (kit vinculado: precisa igualar `kit_multiplicador`); `dimensoes` no formato `DimensoesPacote` de `_shared/ml/pacote.ts` (não de `frete.ts`, que só importa o tipo).

- [ ] **Step 1: Testes falhando:** ordem catálogo → EAN → manual (catálogo, depois item) → nenhuma, cada etapa só consultada se a anterior falhar; >1 variação no catálogo ou no GTIN → pula a etapa (ambíguo não escolhe); EAN com dígito inválido ignorado; fator 2 (anúncio 2 ÷ SKU 1) com custo 10 → 20; caixa de 24 × anúncio de 24 → fator 1, 10; kit de 2 × anúncio de 3 → "composição diferente"; lado desconhecido → "composição não confirmada"; custo null → indisponível "custo não cadastrado".
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat(extensao): resolverVinculo e custo do pacote (ADR-0189 D-8)`.

### Task 5: Orquestração `analisarAnuncio`

**Files:** Create `supabase/functions/_shared/extensao/analisar-anuncio.ts`; Test `__tests__/analisar-anuncio.test.ts`.

**Interfaces:**
```ts
interface EntradaAnuncio { mlItemId: string; sellerId: string; catalogProductId: string | null; categoriaId: string; preco: number; eanDaBusca: string | null }
interface DepsAnuncio extends DepsVinculo {
  contaDaOrg(orgId: string): Promise<string | null>;                       // resolverConexao(...).contaExternaId
  aliquotas(orgId: string): Promise<{ confirmada: boolean; nacional: number | null; importado: number | null }>;
  comissao(preco: number, categoriaId: string, tipo: 'gold_special' | 'gold_pro'): Promise<Disponivel<ComissaoML>>;
  frete(preco: number, categoriaId: string, dim: DimensoesPacote | null): Promise<Disponivel<number>>; // sem dimensões confirmadas → ok + aviso "estimado (pacote padrão)"
  unidadesPorPacote(catalogProductId: string | null): Promise<Disponivel<number>>; // só /products/{id} UNITS_PER_PACK; sem catálogo/atributo → indisponível, nunca 1
  dimensoesDoPacote(orgId: string, codigoPai: string, n: number): Promise<DimensoesPacote | null>; // kit vinculado de N (kit_base_codigo_pai)
}
interface RespostaAnuncio {
  proprio: boolean;
  margem: MinhaMargem | null;
  custo: { fonte: FonteCusto; codigo: string | null; origem: 'nacional' | 'importado' | null; unidadesPorPacote: number | null; unidadesSku: number | null; custoSku: number | null; fator: number | null; faltaUnidades: 'anuncio' | 'sku' | 'ambos' | null; custoPacote: Disponivel<number> | null };
  parametros: { aliquotas: { nacional: number | null; importado: number | null; confirmada: boolean }; classico: Disponivel<ComissaoML>; premium: Disponivel<ComissaoML>; frete: Disponivel<number> } // para simular no painel
}
analisarAnuncio(orgId: string, e: EntradaAnuncio, deps: DepsAnuncio): Promise<RespostaAnuncio>
```
- [ ] **Step 1: Testes falhando:** `sellerId === contaDaOrg` → `proprio: true`, `margem: null`, sem chamar comissão/frete; alíquota não confirmada → ambos indisponíveis com "Confirme as alíquotas de imposto em Configurações"; família `importado` usa `importado ?? 16`; sem variação → `custoPacote: null`, `origem: null` e margem sem lucro; frete: fator 1 → dimensões do SKU; fator N → dimensões do kit vinculado de N (`dimensoesDoPacote`); qualquer outro caso (inclusive composição desconhecida, que nem consulta o kit) → `null` e aviso "estimado"; composição conforme Global Constraints (catálogo = fator 1; fora de catálogo → `faltaUnidades: 'anuncio'`; SKU sem `UNITS_PER_PACK` → `'sku'`).
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat(extensao): analisarAnuncio (ADR-0189 D-5/D-7)`.

### Task 6: Edge Function `extensao`

**Files:** Create `supabase/functions/extensao/index.ts`, `supabase/functions/_shared/extensao/erros.ts`; Modify `supabase/config.toml` (`[functions.extensao]`, `verify_jwt = true`); Test `__tests__/erros.test.ts`, `supabase/functions/extensao/__tests__/roteamento.test.ts`.

**Interfaces:**
- Consumes: `requireUserOrg` (`_shared/auth.ts:36`), `exigirModulo` (`_shared/produto/modulo.ts:8`), `resolverConexao` (`_shared/canais/conexao.ts:22`), `getValidAccessTokenConexao` (`_shared/ml/token.ts:104`), `buscarListingPrice` + `comissaoDeComProveniencia`, `buscarFreteVendedorComProveniencia` (`mlUserId = conexao.contaExternaId`), `auditarOperacaoSuporte` (`_shared/support-audit.ts`), `mlGet`, `redisIncrComTTL`, `redisGet/redisSet`, `analisarAnuncio`.
- Produces — `POST /functions/v1/extensao`, corpo `{ acao, ... }`:
  - `analisar_anuncio` + `EntradaAnuncio` → `RespostaAnuncio` (conta no limite; chama `extensao_registrar_uso`)
  - `buscar_sku` + `{ termo }` → `{ itens: { variacaoId, codigo, nome, custo, origem }[] }` (máx. 10)
  - `salvar_vinculo` + `{ chave: { tipo, valor }, variacaoId }` → `{ ok: true }` (escrita: sessão de suporte só com escopo `full`; audita `denied`/`succeeded`/`failed` com `target_type` `extensao_vinculo:salvar`)
  - `remover_vinculo` + `{ chave }` → `{ ok: true }` (idem, `extensao_vinculo:remover`)
  - `erro_leitura` + `{ tipoPagina, mlItemId, versao, motivo }` → `{ ok: true }` (chama `extensao_registrar_erro`; limite próprio de 20/h por usuário)
  - `normalizarErro(e: unknown): { status: number; corpo: { erro: CodigoErro } }` mapeia a `Response` lançada por `requireUserOrg` (401 → `sessao_expirada`; 403 de sessão de suporte → `sessao_suporte_expirada`) e o 403 do módulo → `modulo_desligado`.
- [ ] **Step 1: Testes falhando:** `validarPedido` (ação desconhecida/campos ausentes → `payload_invalido`); `chaveLimite(userId, agora)` → `ext:rl:{userId}:{AAAAMMDDHHmm}`; `normalizarErro` para os 4 casos.
- [ ] **Step 2–4:** FAIL → implementar handler fino + funções puras → PASS.
- [ ] **Step 5:** Cache Redis TTL 6 h: comissão `ext:lp:{contaMl}:{categoria}:{tipo}:{preco}` (a consulta usa a credencial da conta), frete `ext:fr:{contaMl}:{orgId}:{categoria}:{preco}:{dims|padrao}` (`chaveFrete` em `roteamento.ts`; a chave antiga `ext:fr:{orgId}:…` não é relida e expira em 6 h), unidades `ext:upp:v3:{catalogProductId}` (só valor confirmado; falha de leitura nunca vira 1 nem é cacheada). Testes de separação entre contas e de auditoria (suporte full, read, revogado) na fronteira HTTP em `supabase/functions/extensao/__tests__/index.test.ts`.
- [ ] **Step 6:** `pnpm test -- supabase/functions` + `pnpm build`. Commit `feat(extensao): edge extensao (ADR-0189 D-17/D-18/D-19)`.

### Task 7: Pacote `extensao/` + sessão + spike do side panel

**Files:** Create `extensao/manifest.json`, `package.json` (scripts `build`, `test`), `vite.config.ts` (build Vite da página do painel e do `sw`; alias `@margem` → `../supabase/functions/_shared/extensao/margem.ts`), `scripts/build-conteudo.mjs` (content scripts em **bundles IIFE separados**, um por entrada, pois content scripts MV3 não carregam módulos) e `scripts/checar-dist`, `vitest.config.ts`, `tsconfig.json`, `src/sw.ts`, `src/sessao.ts`, `src/api.ts`; Modify `pnpm-workspace.yaml` (`packages: ['extensao']`), `pnpm-lock.yaml`, `.github/workflows/ci.yml` (job `lint-build`: `pnpm --dir extensao test` e `pnpm --dir extensao build`); Test `extensao/src/__tests__/sessao.test.ts`, `api.test.ts`.

**Interfaces:**
- Mensagem externa (`onMessageExternal`, origem conferida contra a lista do manifest): `{ tipo: 'publiai:sessao', accessToken: string, expiresAt: number, orgNome: string, identidade: string }` — `identidade` **obrigatória** (`usuário:organização:suporte`, sem segredo; org vazia = perfil carregando); sem ela ou malformada a mensagem é recusada — e `{ tipo: 'publiai:desconectar' }`. Identidade diferente da guardada (usuário, org conhecida ou suporte) limpa estado e EAN de todas as abas.
- `obterSessaoValida(): Promise<{ accessToken: string; identidade: string } | null>` — devolve null se faltam < 30 s para `expiresAt`; **não renova**; sessão vencida é apagada junto com as análises das abas e o selo sai da página (`publiai:sessao-mudou`).
- `chamarExtensao<T>(corpo: object): Promise<{ ok: true; dados: T } | { ok: false; erro: CodigoErro | 'sem_sessao' }>`; `sessao_expirada` limpa a sessão e as abas; `sessao_suporte_expirada` limpa as abas; resposta pedida por outra identidade volta `sem_sessao`.
- Mapa EAN por aba no **service worker** (`chrome.storage.session`, só no SW): `registrarEanDaAba(tabId, ean)` / `eanDaAba(tabId)`, alimentado por mensagem do content script (`sender.tab.id`).
- `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
- [ ] **Step 1: Testes falhando:** origem não autorizada ignorada; `desconectar` apaga a sessão; token a 20 s do fim → `null`; `sessao_expirada` limpa; nenhuma chamada ao endpoint de token do Supabase existe no pacote (teste de import).
- [ ] **Step 2–4:** FAIL → implementar (chrome API mockada) → PASS; `pnpm --dir extensao build` (Vite + `build-conteudo.mjs` + checagem do `dist`) gera `extensao/dist` carregável em `chrome://extensions`; criar entradas mínimas do painel e dos content scripts já na Task 7, para o primeiro gate carregar o pacote real; teste do pacote carregado no Chrome fica na validação manual.
- [ ] **Step 5 (spike):** em Chrome real, clique num elemento injetado → mensagem ao SW → `chrome.sidePanel.open({ tabId })`. Registrar no plano se funciona; se não, o selo só destaca e o painel abre pelo ícone da extensão (fallback já configurado).
- [ ] **Step 6:** Commit `feat(extensao): pacote MV3 com sessão recebida do PubliAI (ADR-0189 D-4/D-14)`.

### Task 8: Parser da página do anúncio

**Files:** Create `extensao/src/leitura/pdp.ts`, `extensao/src/leitura/__fixtures__/pdp-sintetico.json`, `pdp-catalogo-sintetico.json`; Test `extensao/src/leitura/__tests__/pdp.test.ts`.

**Interfaces:** `lerAnuncio(doc: Document): { ok: true; dados: EntradaAnuncio-sem-eanDaBusca & { vendidosTexto: string | null; titulo: string } } | { ok: false; motivo: 'estado_nao_encontrado' | 'campo_ausente:<nome>' }` — lê `__NORDIC_RENDERING_CTX__` (`_n.ctx.r` → `appProps.pageProps.initialState`); fallback `__PRELOADED_STATE__`.

- [ ] **Step 1:** Fixtures **sintéticas** (repo público): mesma estrutura dos anúncios observados em 2026-10-21, com IDs e valores fictícios (`MLB1000000001`, seller `100001`, catálogo `MLB2000000001`, categoria `MLB122102`, preço 199.9, "+1000 vendidos").
- [ ] **Step 2: Testes falhando:** extrai esses valores; catálogo sintético → `catalogProductId: 'MLB2000000001'`; HTML sem estado → `estado_nao_encontrado`; sem preço → `campo_ausente:preco`.
- [ ] **Step 3–4:** implementar → PASS. Conferência manual (não commitada) contra as páginas reais MLB4641624520 e MLB44224164.
- [ ] **Step 5:** Commit `feat(extensao): parser da página do anúncio`.

### Task 9: Content scripts do anúncio e da busca por EAN

**Files:** Create `extensao/src/conteudo/anuncio.ts`, `busca-ean.ts`; Modify `extensao/manifest.json` (`content_scripts` para `https://produto.mercadolivre.com.br/*`, `https://www.mercadolivre.com.br/*/p/*`, `https://www.mercadolivre.com.br/up/*`, `https://lista.mercadolivre.com.br/*`); Test `extensao/src/conteudo/__tests__/busca-ean.test.ts`, `selo.test.ts`.

**Interfaces:**
- `eanDaUrlDeBusca(url: string): string | null` — 8, 12, 13 ou 14 dígitos com dígito verificador válido no primeiro segmento do path de `lista.mercadolivre.com.br`; enviado ao SW (`registrarEanDaAba`).
- `textoDoSelo(r: RespostaAnuncio): string` — "Minha margem R$ {lucro} ({margemPct}%)" com lucro; "Recebe R$ {recebe} · informe o custo" sem custo; "Anúncio seu · abrir no PubliAI" se próprio; nada se indisponível.
- Falha do parser → `erro_leitura` (uma vez por página) e nenhum selo.
- [ ] **Step 1: Testes falhando:** `'https://lista.mercadolivre.com.br/7899941205918'` → `'7899941205918'`; termo textual → null; checksum inválido → null; os três textos do selo.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat(extensao): content scripts do anúncio e EAN da busca`.

### Task 10: Side panel — minha margem e vínculo

**Files:** Create `extensao/src/painel/index.html`, `main.tsx`, `App.tsx`, `MinhaMargem.tsx`, `VinculoProduto.tsx`; Test `extensao/src/painel/__tests__/MinhaMargem.test.tsx`, `App.test.tsx`.

**Interfaces:** consome `chamarExtensao`, `RespostaAnuncio` e `calcularMinhaMargem` via alias `@margem`. Estados: `sem_sessao` ("Abra o PubliAI e conecte a extensão"), `modulo_desligado` ("A extensão não está habilitada para sua empresa"), `sessao_suporte_expirada`, `proprio` ("Abrir no PubliAI"), `analise`, `limite`.
- Preço editável: recálculo local imediato com `parametros` (comissão por percentual + fixa; frete e alíquotas recebidos); confirmação no servidor 1,5 s após parar de editar.
- Custo: linha "Custo do SKU {codigo} · {fonte}" com a conta do pacote; sem vínculo, campos "Custo" e "Origem" (Nacional/Importado, sem padrão) — só calcula com os dois preenchidos; botão "Este produto é meu SKU…" → `buscar_sku` → `salvar_vinculo`.
- [ ] **Step 1: Testes falhando:** tipo indisponível mostra o motivo; custo digitado sem origem não calcula e pede a origem; com origem importado usa a alíquota importado; fonte `catalogo` exibe "Custo do SKU 00123 · casado pelo catálogo"; editar o preço não chama o servidor antes de 1,5 s.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat(extensao): side panel com minha margem e vínculo (ADR-0189 D-6/D-7/D-8/D-16)`.

### Task 11: PubliAI web — conectar a extensão

**Files:** Create `src/lib/extensao-ponte.ts`, `src/components/configuracoes/extensao-navegador.tsx`; Modify Configurações (seção visível só com módulo `extensao`) e o ponto onde o app assina `supabase.auth.onAuthStateChange`; Test `src/lib/__tests__/extensao-ponte.test.ts`, `src/components/configuracoes/__tests__/extensao-navegador.test.tsx`.

**Interfaces:** `enviarSessaoParaExtensao(session: Session | null): Promise<'ok' | 'nao_instalada' | 'desconectada'>` — com sessão envia `publiai:sessao` (access token + `expires_at` + nome da org + **`identidade` = `identidadeExtensao(session)`**: `${user.id}:${effectiveOrgId() ?? ''}:${suporte.requestId ?? ''}`); sem sessão envia `publiai:desconectar`. O `auth-store` assina **`useAuthStore` e `useSupportStore`** e reenvia sempre que o token **ou** a identidade mudam (login, renovação, logout, perfil carregado, **início/fim de suporte**), além do botão "Conectar extensão". `VITE_EXTENSAO_ID`, `VITE_EXTENSAO_URL`.
- [ ] **Step 1: Testes falhando:** sem `chrome.runtime` → `'nao_instalada'`; token novo reenvia; mesmo token e mesma identidade não; `SIGNED_OUT` desconecta; perfil carregado e início/fim de suporte reenviam com a nova identidade; seção oculta sem módulo; **nenhum refresh token é enviado** (assert no payload).
- [ ] **Step 2–4:** FAIL → implementar → PASS; `pnpm build`.
- [ ] **Step 5:** Commit `feat(extensao): PubliAI empurra a sessão para a extensão (ADR-0189 D-4)`.

### Task 11A: Endurecimento da fatia 1 (testes de fronteira e paridade financeira)

**Files:** Test `supabase/functions/extensao/__tests__/index.test.ts`, `supabase/functions/_shared/extensao/__tests__/paridade-financeira.test.ts`.

- [ ] **Step 1:** Testes do handler HTTP com dependências controladas: módulo desligado, sessão expirada, 429 efetivo no 31º pedido do minuto, resposta sem nenhum campo de token ML, auditoria de suporte nas escritas.
- [ ] **Step 2:** Fixture financeira comum (preço, categoria, origem, kit, arredondamento) comparando `calcularMinhaMargem` com as **funções reais exportadas** (sem reimplementar): Viabilidade = `analisarItemViabilidade` + `impostoNoPreco`/`liquidoNoMercado` + `calcularMarkup`; Pulse = `margemEstimada`. Diferença ≤ R$ 0,05 em todos os casos. Sem `sale_fee_amount` a Viabilidade desconta comissão 0 (bug conhecido, correção separada): `it.fails` com referência, e a extensão conferida no valor correto. Comissão e/ou frete ausentes → extensão "indisponível" (nunca número) e Pulse null.
- [ ] **Step 3:** Commit `test(extensao): fronteira HTTP e paridade financeira (ADR-0189)`.

---

### Task 12: Publicação da fatia 1 e documentação

**Files:** Create `docs/how-to/usar-a-extensao.md`, `extensao/PRIVACIDADE.md`, `scripts/empacotar-extensao.sh`; Modify `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md`, `docs/TASKS.md`, `docs/project-status.md`.

- [ ] **Step 1:** `scripts/empacotar-extensao.sh` zipa `extensao/dist` em `extensao/publiai-extensao-<versao>.zip` (zip no `.gitignore`).
- [ ] **Step 2:** Política de privacidade (lê, envia, registra — D-19) e texto da loja.
- [ ] **Step 3:** Docs de referência e how-to; TASKS.
- [ ] **Step 4:** Commit `docs(extensao): how-to, privacidade e referências da fatia 1`.
- [ ] **Step 5:** Revisão do diff da fatia pelo **Grok 4.7 xhigh**; corrigir achados; validação (`pnpm test`, `pnpm lint`, `pnpm build`, `pnpm --dir extensao test/build`) e CI verde.
- [ ] **Step 6:** Merge; **depois** deploy com o Diego: `supabase db push` (+ `npm run db:check`), `supabase functions deploy extensao`, versão ativa conferida; **app web com a ponte nova (`identidade` obrigatória) publicado e conferido no bundle em produção** — gate: a extensão recusa `publiai:sessao` sem identidade, então nenhum pacote da extensão é distribuído antes disso; smoke test (conta de teste, anúncio real, módulo desligado → `modulo_desligado`; **início e fim de sessão de suporte** → painel e selo limpos e nova identidade recebida; logout → selo some).
- [ ] **Step 7:** Só então ativação: módulo ligado na DSA e submissão à Web Store como **não listada** (ação do Diego).

> Ordem obrigatória em toda fatia: revisão → correções → validação/CI → deploy (edge + **app web com a ponte compatível**) → smoke test (inclui início/fim de suporte) → ativação/distribuição da extensão.

---

## Fatia 2 — Quanto vende + qualidade + vendedor + radar + mídia (tarefas)

- **Task 13 — Validação da estimativa:** `scripts/validar-estimativa-vendas.ts` compara, para anúncios próprios ativos, a estimativa (faixa pública + avaliações + idade + tipo; constantes do relatório Avant: ×15 avaliações, +15% < 6 meses, −25% > 12 meses, +15% Premium, consolidado 0,6/0,4) com vendas reais (`ml_vendas_itens.ml_item_id/quantity`). Saída: erro mediano e por faixa. **Critérios de validade (definir antes de medir):** unidade da estimativa (vendas acumuladas desde a criação × vendas reais no mesmo recorte), alinhamento de período, cobertura mínima de anúncios, estados de pedido elegíveis (cancelados excluídos), tratamento de vendas zero, e **amostra de validação separada** da usada para ajustar constantes. **Gate:** ≤ 30% nessa amostra → exibir; senão a estimativa permanece desligada, só observado (errata na ADR).
- **Task 14 — `estimarVendas` pura** em `extensao/src/compartilhado/estimativa.ts` com as constantes da Task 13 + testes.
- **Task 15 — Bloco "Quanto vende":** Observado (faixa, criado em, ≥ X/mês = piso ÷ meses) + Estimativa (rótulo + método), conforme gate.
- **Task 16 — Vendedor:** `acao: 'vendedor'` → `/users/{id}` (nickname, `level_id`, `power_seller_status`, `transactions.total` com o `period` informado pelo ML — janela móvel de ~365 dias, nunca "total histórico"; sem `period`, rótulo neutro —, cidade/UF), cache 24 h.
- **Task 17 — Qualidade do anúncio:** regras locais puras (sem Clips, < 5 fotos, descrição < 500 ou ausente, "Sem garantia" exato, estoque < 50, foto com qualquer dimensão < 1200 e dimensão desconhecida não conta) + destaque das miniaturas; semáforo de idade (≤ 180 verde, 181–365 amarelo, > 365 vermelho).
- **Task 18 — Radar do Pulse:** `acao: 'radar'` lê `pulse_produtos`/ofertas/alertas da org por `catalog_product_id` (só com módulo `pulse`); "Adicionar ao radar" é ação manual (exceção explícita da ADR D-10): envia só o `catalog_product_id` ao `pulse-adicionar` existente, com módulo Pulse, escrita e auditoria de suporte.
- **Task 19 — Baixar mídia:** zip local de fotos/vídeos do estado da página.

## Fatia 3 — Busca (tarefas)

- **Task 20 — Parser de busca:** polycards do `initialState` (`item_id`, preço, `metadata.tracks.sold_quantity`, avaliações, Full/frete grátis, tipo, oficial, `metadata.product_id`, categoria **quando presente no card**). Sem categoria no card, enriquecer só pelo catálogo; sem categoria comprovada → margem indisponível (nunca a categoria genérica da busca).
- **Task 21 — Margem em lote:** `acao: 'analisar_busca'` com até 50 itens, agrupando por (categoria, preço, tipo) para o cache; chamadas ao ML em **lotes de 5** com backoff em 429 (precedente `analisar-viabilidade/index.ts:26`) e limite de concorrência agregado entre requisições; **debita 1 do limite de 30/min por item único analisado** (não por busca). Testar bloqueio efetivo e comportamento em 429.
- **Task 22 — Selos nos cards + resumo lateral** (vendidos da página, menor/maior preço, medalhas, Full, catálogo × fora, oficiais, patrocinados, com oferta), filtros clicáveis e ordenação por vendidos, preço e minha margem.

## Fatia 4 — Catálogo (tarefas)

- **Task 23 — `acao: 'catalogo'`:** `/products/{id}` + `/products/{id}/items` + `/users` em lotes de 5 com cache; vencedor só do campo informado pelo ML.
- **Task 24 — Painel do catálogo:** minha margem ao preço do vencedor, vendas do catálogo (faixa), posição e preço para ganhar quando a org participa, lista de vendedores ordenável, gráficos por UF e medalha.
- **Task 25 — Encerramento da v1:** consultas de uso e erros para a Central; atualizar `docs/Roadmap/ROADMAP-MELHORIAS-PUBLIAI.md` no checkout principal (fora do git) removendo "Extensão de navegador" do Não fazer.

---

## Revisões

- ADR-0189 e este plano: Kimi K3 Max em 2026-10-21 (REVISE, 21 achados — incorporados; ver ADR § Processo de revisão). **Codex `gpt-6.1-sol` high** em 2026-10-22 (REVISE, 17 achados; Diego: corrigir tudo antes do merge) — código corrigido (identidade da sessão, auditoria de suporte, composição do pacote, frete, rótulo Estimativa, cache por conta) e este plano alinhado ao implementado; ver ADR § Processo de revisão.
- Ao fim de cada fatia: diff revisado pelo **Grok 4.7 xhigh** (`cursor-agent -p --mode ask --model grok-4.7-xhigh … < /dev/null`) antes do merge.
