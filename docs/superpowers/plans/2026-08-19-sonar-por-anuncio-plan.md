# Sonar por anúncio + histórico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a unidade da tabela do Sonar de ficha de catálogo para anúncio real (amostra Apify), medir visitas 30d por anúncio via API oficial e começar a gravar snapshots de histórico por garimpo.

**Architecture:** `pulse-sonar-vendas` vira a query primária e grava `sonar_snapshots` no cache-miss; edge nova `pulse-sonar-visitas` resolve visitas por `item_id` com cache Redis próprio; a edge `pulse-sonar` (fichas) é deletada. O front compõe as duas queries, o veredito v2 calcula sobre a amostra de anúncios e o cruzamento ficha↔anúncio morre.

**Tech Stack:** Supabase Edge Functions (Deno), Postgres + RLS, Upstash Redis, Apify (actor karamelo), React + react-query + shadcn/ui, vitest.

**Spec:** docs/superpowers/specs/2026-08-19-sonar-tabela-por-anuncio-design.md

## Global Constraints

- **LOUD:** sem dado = `null`, nunca 0. Zero MEDIDO ≠ ausência: HTTP 200 com `total_visits = 0` exibe "0"; falha/sem conexão exibe "—" (spec D8).
- **Nunca derivar vendas de visitas** (ADR-0120). **Nunca somar faixas arredondadas de `vendidos`**; delta entre snapshots é PISO, nunca total (spec D13).
- **Cache de vendas SEM bump:** chave `sonar:vendas:v4:MLB:{termo}` intocada. `historico_gravado` e `itens` são aditivos; `historico_gravado` fica FORA do objeto gravado no Redis — cache hit responde `historico_gravado: false` (spec D5/D7).
- **Visitas em chave própria:** `sonar:visitas:v1:{item_id}`, TTL 24h, global sem org_id (spec D6). Falha de chamada NÃO cacheia.
- **Amostra inalterada:** 20 anúncios, `TETO_USD = 0.10` em `supabase/functions/_shared/apify/client.ts` — NÃO tocar (spec D4).
- **RLS de `sonar_snapshots`:** global (sem org_id, dado público como o cache — ADR-0120 §3), `select` para `authenticated`, escrita só service_role (spec, seção Modelo de dados).
- **Migrations SÓ via `supabase migration new` + `supabase db push`** (ADR-0043); validar com `npm run db:check`. O worktree já está linkado (`supabase link` feito).
- **Deploy de edge é etapa obrigatória** quando o diff toca `supabase/functions/**` — via CLI completa, conferindo versão pós-deploy. Merge sem deploy = entrega defasada (incidente 2026-07-24).
- **Todo commit deixa `pnpm lint` e `pnpm test` (3521+ testes) verdes.** Antes de qualquer push: `npx tsc -b --force` (o build incremental local passa com tsbuildinfo stale; o CI reprova).
- **Constantes novas do veredito: `DISPUTA_V2`, `TRACAO_V2`, `VISITAS_V2`.** PROIBIDO reaproveitar/copiar números de `DISPUTA`, `TRACAO`, `VISITAS` antigos — a escala morreu com a fonte (spec D11). Os valores novos são MEDIDOS na Task 7, nunca inventados.
- **Aceite do veredito v2:** os 3 fixtures-gabarito reproduzem **média / média / alta** nessa ordem; "tecido oxford 10 metros = alta" é inegociável (spec D12).
- **Tipos do front espelham os shared sem import cross-runtime** (convenção de `src/lib/sonar.ts:1-4`).
- **Nenhuma escrita no ML.** Nunca editar anúncio publicado, nem em diagnóstico.
- **Sem feature flag** — troca de uma vez (spec D14). Trabalho na branch `worktree-sonar-por-anuncio`, nunca na main.
- Referências de código conferidas em 2026-08-19 neste worktree. Custo real da Task 7: **US$ 0,30 exatos** (medido 19/08/2026: nenhum termo-gabarito em cache).

---

## File Structure

| Ação | Arquivo | Responsabilidade |
|---|---|---|
| Create | `docs/decisions/0127-sonar-tabela-por-anuncio-e-historico.md` | ADR da entrega (supersede parcial do ADR-0125) — Task 1 |
| Create | `supabase/migrations/<ts>_sonar_snapshots.sql` | Tabela de histórico + RLS — Task 2 |
| Modify | `supabase/functions/_shared/pulse/sonar-vendas.ts` | `category_id` no parse, `itens` no painel, `LinhaSnapshot`/`linhasSnapshot` — Task 3 |
| Modify | `supabase/functions/_shared/pulse/__tests__/sonar-vendas.test.ts` | Testes dos itens acima — Task 3 |
| Modify | `supabase/functions/pulse-sonar-vendas/index.ts` | Gravação de snapshot no cache-miss + `historico_gravado` fora do cache — Task 4 |
| Modify | `supabase/functions/_shared/pulse/sonar.ts` | `validarItemIds` (novo); poda do que morre — Tasks 5 e 11 |
| Modify | `supabase/functions/_shared/pulse/__tests__/sonar.test.ts` | Teste de `validarItemIds`; poda — Tasks 5 e 11 |
| Create | `supabase/functions/pulse-sonar-visitas/index.ts` | Edge fina de visitas por item — Task 5 |
| Modify | `supabase/config.toml` | + `[functions.pulse-sonar-visitas]`; − `[functions.pulse-sonar]` — Tasks 5 e 11 |
| Modify | `src/lib/sonar.ts` | Tipos espelhados, `fetchVisitasSonar`, `normalizarSerieVisitas`, `itensDaAmostra`, etapas novas; poda — Tasks 6 e 11 |
| Modify | `src/lib/__tests__/sonar.test.ts` | Testes dos itens acima; poda — Tasks 6 e 11 |
| Create | `scripts/sonar-gabarito-fixtures.mjs` | Script de MEDIÇÃO da recalibração (D12) — Task 7 |
| Create | `src/lib/__tests__/fixtures/sonar-gabarito/*.json` | 3 payloads-gabarito congelados — Task 7 |
| Modify | `src/lib/veredito-sonar.ts` | Veredito v2 (`calcularVereditoAnuncios`) ao lado do antigo; antigo morre na Task 11 — Tasks 8 e 11 |
| Modify | `src/lib/__tests__/veredito-sonar.test.ts` | Testes v2 com fixtures; poda do gabarito antigo — Tasks 8 e 11 |
| Modify | `src/lib/sonar-filtros.ts` | `FiltrosAnuncios`/`aplicarFiltrosAnuncios` ao lado do antigo; antigo morre na Task 11 — Tasks 9 e 11 |
| Modify | `src/lib/__tests__/sonar-filtros.test.ts` | Testes v2; poda — Tasks 9 e 11 |
| Modify | `src/pages/PulseSonar.tsx` | Tabela por anúncio, duas queries, estados D16 — Task 10 |
| Modify | `src/components/pulse/veredito-sonar.tsx` | Prop `VereditoAnuncios`, remove badge `semVendas` — Task 10 |
| Modify | `src/components/pulse/dialog-margem-sonar.tsx` | `AnuncioSimulavel` (categoria vem do anúncio) — Task 10 |
| Delete | `supabase/functions/pulse-sonar/` | Edge de fichas morre inteira — Task 11 |
| Delete | `src/lib/sonar-cruzamento.ts` + `src/lib/__tests__/sonar-cruzamento.test.ts` | Cruzamento D4/ADR-0125 morre — Task 11 |
| Modify | `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md`, `docs/TASKS.md`, obsidian-vault | Documentação — Task 12 |

Sequência: backend (1–5) → medição (7, exige a edge de visitas no ar) → veredito/filtros (8–9) → front (10) → deleções (11) → docs (12) → deploy final (13) → validação (14). A Task 6 (lib do front, só aditiva) entra entre 5 e 7 porque a 7 usa `normalizarSerieVisitas` não — usa apenas as edges; ela entra antes da 7 apenas para manter backend→front na ordem natural. Cada commit deixa a suíte verde: tudo que muda assinatura ganha NOME NOVO e o antigo só morre na Task 11, depois que a página (Task 10) parou de usá-lo.

---

### Task 1: ADR-0127

**Modelo:** sonnet

**Files:**
- Create: `docs/decisions/0127-sonar-tabela-por-anuncio-e-historico.md`
- Modify: `obsidian-vault/04-Decisões/Índice de ADRs.md` (adicionar linha do 0127)

**Interfaces:**
- Consumes: spec inteira (`docs/superpowers/specs/2026-08-19-sonar-tabela-por-anuncio-design.md`).
- Produces: ADR citável pelas tasks seguintes; a Task 7 adiciona a seção "Calibração v2" nele.

Regra do projeto: decisão não-trivial → ADR ANTES da implementação. Sem TDD (documento).

- [ ] **Step 1: Escrever o ADR**

Estrutura (mesmo formato do ADR-0125): Status aceito, Data 2026-08-19, Relacionados (0120, 0122, 0124, 0125 — marcando o 0125/D4 como superado). Conteúdo: condensar da spec (NÃO copiar a spec inteira — ADR é decisão, spec é design):
- Contexto: os 5 números medidos em 19/08 (interseção 0; 21/40 fichas mortas; 138 vs 44.680 visitas = 324×; 14% das vendas em ficha; 5 nichos com 10-60% de fichas ativas).
- Decisões D1–D16 da spec, cada uma em 1-3 frases com a alternativa descartada.
- Seção "Calibração v2" com o texto: "Preenchida pela recalibração medida (ver plano, Task 7)" — a Task 7 substitui essa frase pela tabela de números medidos. Este é o ÚNICO forward-reference permitido no ADR.
- Registro explícito das refutações: `date_created` de terceiro inobtenível (403 em GET e multiget); "N pontos de visitas ≠ idade do anúncio" (D9).
- Consequências: `sonar_snapshots` global com RLS de leitura aberta a autenticados (variação consciente do padrão org-scoped de `pulse_v1`); ADR-0124 §6 (fallback sem Apify) revogado.

- [ ] **Step 2: Atualizar o índice de ADRs no obsidian-vault**

Adicionar a linha do 0127 em `obsidian-vault/04-Decisões/Índice de ADRs.md`, mesmo formato das linhas existentes.

- [ ] **Step 3: Conferir lint da suíte (nada de código mudou)**

Run: `pnpm lint`
Expected: verde (sanidade — nenhum código tocado).

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0127-sonar-tabela-por-anuncio-e-historico.md "obsidian-vault/04-Decisões/Índice de ADRs.md"
git commit -m "docs: ADR-0127 — Sonar por anúncio + histórico de snapshots"
```

---

### Task 2: Migration `sonar_snapshots`

**Modelo:** opus (migration + RLS — nunca rebaixar)

**Files:**
- Create: `supabase/migrations/<timestamp>_sonar_snapshots.sql` (via `supabase migration new sonar_snapshots`)

**Interfaces:**
- Produces: tabela `public.sonar_snapshots` com unique `(termo, item_id, gerado_em)` — a Task 4 faz upsert nela com `onConflict: 'termo,item_id,gerado_em'`.

Sem TDD de vitest (DDL); a verificação é `npm run db:check` + query de sanidade.

- [ ] **Step 1: Criar a migration**

Run: `supabase migration new sonar_snapshots`
Preencher o arquivo gerado com EXATAMENTE este conteúdo (DDL da spec, seção "Modelo de dados"):

```sql
-- Sonar (ADR-0127): histórico de snapshots por anúncio por garimpo fresco.
-- GLOBAL, sem org_id, de propósito: mesmo dado público que já vive em cache Redis com chave
-- global (ADR-0120 §3). Escrita só service_role (edge pulse-sonar-vendas), leitura autenticada.
create table public.sonar_snapshots (
  id uuid primary key default gen_random_uuid(),
  termo text not null,                 -- normalizado (trim/lower/espaço único), igual à chave de cache
  gerado_em timestamptz not null,      -- gerado_em do painel: idempotência natural no retry
  item_id text not null,               -- idPublicacao (MLB…)
  titulo text,
  preco numeric(12,2),                 -- null = não veio (LOUD)
  vendidos integer,                    -- cru pós-parseVendidos; null nunca 0; delta futuro = PISO (D13)
  posicao integer,
  patrocinado boolean,                 -- tipoResultado !== 'ORGANIC'; null = desconhecido
  vendedor text,                       -- nickname (cobertura 13/20 no termo medido em 18/08)
  catalog_product_id text,             -- presente em ~20-30% (medido 18/08)
  criado_em timestamptz not null default now()
);
create unique index sonar_snapshots_termo_item_gerado_uniq
  on public.sonar_snapshots (termo, item_id, gerado_em);
create index sonar_snapshots_item_gerado_idx
  on public.sonar_snapshots (item_id, gerado_em desc);  -- a série do drill-down futuro é por anúncio

alter table public.sonar_snapshots enable row level security;
create policy "sonar_snapshots: select autenticado"
  on public.sonar_snapshots for select to authenticated using (true);
grant select on public.sonar_snapshots to authenticated;
-- escrita: nenhuma policy de insert/update/delete — só service_role (edge), como pulse_v1
```

- [ ] **Step 2: Aplicar e validar**

Run: `supabase db push` (worktree já linkado) e depois `npm run db:check`
Expected: push aplica 1 migration; db:check verde.

- [ ] **Step 3: Sanidade da RLS**

Via SQL read-only da Management API (memória: sem `unaccent`, 502 transitório possível — repetir se der 502):
`select relrowsecurity from pg_class where relname = 'sonar_snapshots';` → `true`.
`select count(*) from pg_policies where tablename = 'sonar_snapshots';` → `1` (só o select).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_sonar_snapshots.sql
git commit -m "feat(sonar): tabela sonar_snapshots — histórico por anúncio por garimpo (ADR-0127)"
```

---

### Task 3: Shared vendas — `category_id`, `itens` no painel e `linhasSnapshot`

**Modelo:** sonnet

**Files:**
- Modify: `supabase/functions/_shared/pulse/sonar-vendas.ts`
- Test: `supabase/functions/_shared/pulse/__tests__/sonar-vendas.test.ts`

**Interfaces:**
- Consumes: `ItemVendas`, `parseItensApify`, `montarPainelVendas`, `str` (helpers existentes no mesmo arquivo).
- Produces (usados pelas Tasks 4, 6, 8):
  - `ItemVendas` ganha `category_id: string | null` (de `produtoCategoryID`, 20/20 no dataset medido 18/08).
  - `PainelVendasSonar` ganha `itens: ItemVendas[]` (lista completa da amostra, na ordem da busca — a tabela do front nasce dela; `por_anuncio` sozinho perderia item sem `item_id`).
  - `export interface LinhaSnapshot { termo: string; gerado_em: string; item_id: string; titulo: string; preco: number | null; vendidos: number | null; posicao: number | null; patrocinado: boolean | null; vendedor: string | null; catalog_product_id: string | null }`
  - `export function linhasSnapshot(termo: string, geradoEm: string, itens: ItemVendas[]): LinhaSnapshot[]`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `supabase/functions/_shared/pulse/__tests__/sonar-vendas.test.ts` (usar o helper de item já existente no arquivo se houver; senão o `item()` abaixo):

```ts
import { linhasSnapshot, parseItensApify, montarPainelVendas, type ItemVendas } from '../sonar-vendas.ts';

const itemBase = (over: Partial<ItemVendas> = {}): ItemVendas => ({
  titulo: 'Abraçadeira nylon 200un', preco: 12.9, vendidos: 500, link: null, imagem: null,
  vendedor: 'FIXA-FORTE', frete_gratis: true, loja_oficial: false, internacional: false,
  full: true, item_id: 'MLB111', catalog_product_id: null, category_id: 'MLB1499',
  avaliacao_nota: 4.8, avaliacao_qtd: 84, posicao: 1, patrocinado: false, selo: null,
  preco_anterior: null, desconto_pct: null, flex: false, ...over,
});

describe('category_id — produtoCategoryID (20/20 no dataset medido 18/08; destrava o simulador sem preditor)', () => {
  it('parseia produtoCategoryID e trata vazio como null', () => {
    const [comCat] = parseItensApify([{ eTituloProduto: 'X', produtoCategoryID: 'MLB1499' }]);
    const [semCat] = parseItensApify([{ eTituloProduto: 'Y', produtoCategoryID: '' }]);
    expect(comCat.category_id).toBe('MLB1499');
    expect(semCat.category_id).toBeNull();
  });
});

describe('painel expõe `itens` (amostra completa, ordem da busca — a tabela nasce daqui)', () => {
  it('itens preserva a lista e a ordem, inclusive item sem item_id (que fica fora de por_anuncio)', () => {
    const a = itemBase({ item_id: 'MLB1', posicao: 1 });
    const b = itemBase({ item_id: null, posicao: 2, titulo: 'Sem id' });
    const painel = montarPainelVendas('t', [a, b], null);
    expect(painel.itens).toEqual([a, b]);
    expect(Object.keys(painel.por_anuncio)).toEqual(['MLB1']);
  });
});

describe('linhasSnapshot — D7/D13: uma linha por anúncio, null nunca vira 0', () => {
  it('mapeia os 10 campos e preserva null (vendidos null NUNCA vira 0)', () => {
    const linhas = linhasSnapshot('abraçadeira nylon', '2026-08-19T12:00:00.000Z',
      [itemBase({ vendidos: null, preco: null })]);
    expect(linhas).toEqual([{
      termo: 'abraçadeira nylon', gerado_em: '2026-08-19T12:00:00.000Z', item_id: 'MLB111',
      titulo: 'Abraçadeira nylon 200un', preco: null, vendidos: null, posicao: 1,
      patrocinado: false, vendedor: 'FIXA-FORTE', catalog_product_id: null,
    }]);
  });
  it('descarta item sem item_id (sem chave não há série histórica)', () => {
    expect(linhasSnapshot('t', 'g', [itemBase({ item_id: null })])).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test supabase/functions/_shared/pulse/__tests__/sonar-vendas.test.ts`
Expected: FAIL — `linhasSnapshot` não exportada; `category_id`/`itens` inexistentes nos tipos.

- [ ] **Step 3: Implementação mínima**

Em `supabase/functions/_shared/pulse/sonar-vendas.ts`:

1. `ItemVendas` ganha, junto dos campos T1 existentes:
```ts
  /** = produtoCategoryID (20/20 no dataset medido 18/08) — simulador de margem sem preditor. */
  category_id: string | null;
```
2. Em `parseItensApify`, dentro do `out.push({ ... })`, adicionar:
```ts
      category_id: str(o.produtoCategoryID),
```
3. `PainelVendasSonar` ganha:
```ts
  /** Amostra completa na ordem da busca — a tabela do front nasce daqui (item sem item_id
   *  fica fora de por_anuncio, mas continua sendo uma linha da tabela). Aditivo (D5). */
  itens: ItemVendas[];
```
4. Em `montarPainelVendas`, no objeto retornado, adicionar `itens,` (o parâmetro já se chama `itens`).
5. No fim do arquivo:
```ts
// --- Snapshot histórico (ADR-0127/D7): shape exato da tabela sonar_snapshots -------------------
export interface LinhaSnapshot {
  termo: string;
  gerado_em: string;
  item_id: string;
  titulo: string;
  preco: number | null;
  vendidos: number | null;   // cru pós-parseVendidos; delta futuro = PISO (D13), null nunca 0
  posicao: number | null;
  patrocinado: boolean | null;
  vendedor: string | null;
  catalog_product_id: string | null;
}

/** Item sem item_id fica fora: sem chave não há série. LOUD: nulls passam intactos. */
export function linhasSnapshot(termo: string, geradoEm: string, itens: ItemVendas[]): LinhaSnapshot[] {
  const out: LinhaSnapshot[] = [];
  for (const i of itens) {
    if (!i.item_id) continue;
    out.push({
      termo, gerado_em: geradoEm, item_id: i.item_id, titulo: i.titulo, preco: i.preco,
      vendidos: i.vendidos, posicao: i.posicao, patrocinado: i.patrocinado,
      vendedor: i.vendedor, catalog_product_id: i.catalog_product_id,
    });
  }
  return out;
}
```

- [ ] **Step 4: Rodar e confirmar que passa (suíte inteira)**

Run: `pnpm test`
Expected: PASS. Atenção: se algum teste existente de `parseItensApify`/`montarPainelVendas` usar `toEqual` estrito e quebrar pelos campos novos (`category_id`, `itens`), atualizar o expected DESSES testes no mesmo commit — é o campo aditivo esperado, não regressão.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/pulse/sonar-vendas.ts supabase/functions/_shared/pulse/__tests__/sonar-vendas.test.ts
git commit -m "feat(sonar): category_id + itens no painel de vendas e linhasSnapshot (ADR-0127)"
```

---

### Task 4: Edge `pulse-sonar-vendas` — gravar histórico no cache-miss

**Modelo:** sonnet

**Files:**
- Modify: `supabase/functions/pulse-sonar-vendas/index.ts`

**Interfaces:**
- Consumes: `linhasSnapshot`, `parseItensApify`, `montarPainelVendas`, `parseTotalAnuncios` (Task 3); `adminClient` de `../_shared/supabase.ts`; tabela `sonar_snapshots` (Task 2).
- Produces: resposta da edge ganha `historico_gravado: boolean` (fora do cache) e, via painel, `itens` + `category_id`. Chave `sonar:vendas:v4` INALTERADA.

Convenção do projeto: edges não têm teste próprio — a lógica pura foi testada na Task 3; aqui a verificação é lint/typecheck (o deploy real fica na Task 13).

- [ ] **Step 1: Implementar**

Em `supabase/functions/pulse-sonar-vendas/index.ts`:

1. Imports: adicionar
```ts
import { adminClient } from '../_shared/supabase.ts';
import { montarPainelVendas, parseItensApify, parseTotalAnuncios, linhasSnapshot, type ItemVendas } from '../_shared/pulse/sonar-vendas.ts';
```
(substitui a linha de import atual dos mesmos símbolos.)

2. Antes do `Deno.serve`, adicionar:
```ts
// Histórico (ADR-0127/D7): grava SÓ em cache-miss — 1 snapshot por termo por ciclo de TTL, por
// construção. Falha de insert não derruba a resposta (o dado Apify já foi pago), mas nunca é
// silenciosa: log + historico_gravado:false na resposta.
async function gravarSnapshots(termo: string, geradoEm: string, itens: ItemVendas[]): Promise<boolean> {
  const linhas = linhasSnapshot(termo, geradoEm, itens);
  if (linhas.length === 0) return false;
  try {
    const { error } = await adminClient()
      .from('sonar_snapshots')
      .upsert(linhas, { onConflict: 'termo,item_id,gerado_em', ignoreDuplicates: true });
    if (error) {
      console.error(`[sonar-snapshots] insert falhou para "${termo}": ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[sonar-snapshots] insert lançou para "${termo}":`, e instanceof Error ? e.message : e);
    return false;
  }
}
```

3. No handler, trocar o retorno de cache hit (linha `if (cacheado) return json(JSON.parse(cacheado));`) por:
```ts
  // D7: historico_gravado fica FORA do objeto cacheado — em hit vale false (não gravou AGORA).
  if (cacheado) return json({ ...JSON.parse(cacheado), historico_gravado: false });
```

4. Trocar o bloco final (montagem da resposta + set + return) por:
```ts
  const parseados = parseItensApify(itens);
  const resposta = {
    configurado: true as const,
    ...montarPainelVendas(normalizado, parseados, parseTotalAnuncios(itens)),
  };
  const historicoGravado = await gravarSnapshots(resposta.termo, resposta.gerado_em, parseados);
  await redisSet(chave, JSON.stringify(resposta), CACHE_TTL_S).catch(() => {});
  return json({ ...resposta, historico_gravado: historicoGravado });
```

5. Atualizar o comentário da chave (`index.ts:36-40`) acrescentando uma linha: `// ADR-0127: itens/category_id aditivos (sem bump); historico_gravado NUNCA entra no objeto cacheado (D7).`

- [ ] **Step 2: Verificar tipos e suíte**

Run: `pnpm lint && pnpm test`
Expected: verdes (nenhum teste novo — lógica pura já coberta na Task 3).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/pulse-sonar-vendas/index.ts
git commit -m "feat(sonar): pulse-sonar-vendas grava sonar_snapshots no cache-miss (ADR-0127/D7)"
```

---

### Task 5: Edge nova `pulse-sonar-visitas`

**Modelo:** sonnet

**Files:**
- Modify: `supabase/functions/_shared/pulse/sonar.ts` (adicionar `validarItemIds`)
- Test: `supabase/functions/_shared/pulse/__tests__/sonar.test.ts`
- Create: `supabase/functions/pulse-sonar-visitas/index.ts`
- Modify: `supabase/config.toml` (após o bloco `[functions.pulse-sonar-vendas]`, ~linha 130)

**Interfaces:**
- Consumes: `parseVisitasJanela`, `VisitasJanela` (existentes em `_shared/pulse/sonar.ts`); `requireUserOrg`, `resolverConexao`, `getValidAccessTokenConexao`, `mlGet`, `redisGet`/`redisSet`, `adminClient` (padrão da pulse-sonar atual).
- Produces:
  - `export function validarItemIds(v: unknown): string[] | null` em `_shared/pulse/sonar.ts` — null se não for array de 1..20 strings não-vazias; deduplica.
  - Contrato da edge (Task 6 espelha): `POST { item_ids: string[] }` → `{ conectado: false }` (org sem conexão ML, HTTP 200) | `{ conectado: true, por_item: Record<string, VisitasJanela | null> }`. `por_item[id] = null` = falha de chamada (D8: distinto de `total: 0`, que é zero medido).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `supabase/functions/_shared/pulse/__tests__/sonar.test.ts`:

```ts
import { validarItemIds } from '../sonar.ts';

describe('validarItemIds — trust boundary da pulse-sonar-visitas (teto 20 = amostra D4)', () => {
  it('aceita lista válida e deduplica', () => {
    expect(validarItemIds(['MLB1', 'MLB2', 'MLB1'])).toEqual(['MLB1', 'MLB2']);
  });
  it('rejeita vazio, >20, não-array e item não-string/vazio', () => {
    expect(validarItemIds([])).toBeNull();
    expect(validarItemIds(Array.from({ length: 21 }, (_, i) => `MLB${i}`))).toBeNull();
    expect(validarItemIds('MLB1')).toBeNull();
    expect(validarItemIds(['MLB1', 42])).toBeNull();
    expect(validarItemIds(['MLB1', ' '])).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test supabase/functions/_shared/pulse/__tests__/sonar.test.ts`
Expected: FAIL — `validarItemIds` não exportada.

- [ ] **Step 3: Implementação mínima**

Em `supabase/functions/_shared/pulse/sonar.ts` (depois de `parseVisitasJanela`):

```ts
/** Corpo da pulse-sonar-visitas: array de 1..20 item_ids (teto = amostra de 20, D4). Qualquer
 *  coisa fora disso → null (400 no chamador). Dedup preserva a ordem. */
export function validarItemIds(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 20) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || x.trim() === '') return null;
    if (!out.includes(x.trim())) out.push(x.trim());
  }
  return out;
}
```

Criar `supabase/functions/pulse-sonar-visitas/index.ts`:

```ts
// Sonar — visitas 30d por anúncio (ADR-0127/D3): edge fina, par da pulse-sonar-vendas. 1 chamada
// /items/{id}/visits/time_window por item (funciona para terceiros — 20/20 HTTP 200, medido
// 19/08), cache global POR ITEM (dado público, ADR-0120 §3). Só leitura no ML.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mlGet } from '../_shared/ml/http.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { parseVisitasJanela, validarItemIds, type VisitasJanela } from '../_shared/pulse/sonar.ts';

const API = 'https://api.mercadolibre.com';
// 24h, não 7d: a janela de 30 dias anda todo dia — TTL maior serviria visita velha (D6).
const CACHE_TTL_S = 24 * 60 * 60;
const LOTE_CONCORRENCIA = 5; // mesmo teto da pulse-sonar antiga, para não estourar rate limit do ML

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function visitasDoItem(itemId: string, token: string): Promise<VisitasJanela | null> {
  const chave = `sonar:visitas:v1:${itemId}`;
  const cacheado = await redisGet(chave).catch(() => null);
  if (cacheado) return JSON.parse(cacheado);
  const resp = await mlGet(`${API}/items/${itemId}/visits/time_window?last=30&unit=day`, token);
  const visitas = parseVisitasJanela(resp);
  // Falha (null) NÃO cacheia — erro transitório não pode travar o item por 24h.
  // total 0 com HTTP 200 é ZERO MEDIDO e cacheia normal (D8).
  if (visitas != null) await redisSet(chave, JSON.stringify(visitas), CACHE_TTL_S).catch(() => {});
  return visitas;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req, { access: 'read' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: { item_ids?: unknown };
  try { body = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }
  const itemIds = validarItemIds(body.item_ids);
  if (itemIds == null) return json({ erro: 'item_ids obrigatório (1 a 20 strings)' }, 400);

  const admin = adminClient();
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  // Sem conexão ML → indisponível explícito com 200 (mesmo padrão do configurado:false da
  // vendas): a coluna Visitas mostra "—" e o resto da tela vive (D16, único modo degradado).
  if (!conexao) return json({ conectado: false });
  const token = await getValidAccessTokenConexao(conexao);

  const porItem: Record<string, VisitasJanela | null> = {};
  for (let i = 0; i < itemIds.length; i += LOTE_CONCORRENCIA) {
    const lote = itemIds.slice(i, i + LOTE_CONCORRENCIA);
    const settled = await Promise.allSettled(lote.map((id) => visitasDoItem(id, token)));
    settled.forEach((s, j) => { porItem[lote[j]] = s.status === 'fulfilled' ? s.value : null; });
  }
  return json({ conectado: true, por_item: porItem });
});
```

Em `supabase/config.toml`, logo após o bloco `[functions.pulse-sonar-vendas]`:

```toml
# ADR-0127 (Sonar por anúncio): visitas 30d por item — chamada pelo APP com o JWT do usuário.
[functions.pulse-sonar-visitas]
verify_jwt = true
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test supabase/functions/_shared/pulse/__tests__/sonar.test.ts && pnpm lint`
Expected: PASS / verde.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/pulse/sonar.ts supabase/functions/_shared/pulse/__tests__/sonar.test.ts supabase/functions/pulse-sonar-visitas/index.ts supabase/config.toml
git commit -m "feat(sonar): edge pulse-sonar-visitas — visitas 30d por anúncio, cache por item (ADR-0127)"
```

---

### Task 6: Lib do front — tipos espelhados, `fetchVisitasSonar`, `normalizarSerieVisitas`, etapas

**Modelo:** sonnet

**Files:**
- Modify: `src/lib/sonar.ts`
- Test: `src/lib/__tests__/sonar.test.ts`

**Interfaces:**
- Consumes: contrato da edge de visitas (Task 5); campos novos do painel (Task 3).
- Produces (usados pelas Tasks 8, 9, 10):
  - `ItemVendasSonar` ganha `category_id?: string | null` (opcional: cache v4 anterior a esta entrega não tem).
  - `PainelVendasSonar` ganha `itens?: ItemVendasSonar[]` e `historico_gravado?: boolean` (opcionais, mesmo motivo).
  - `export interface VisitasAnuncio { total: number; por_dia: Array<{ data: string; total: number }> }`
  - `export type RespostaVisitasSonar = { conectado: false } | { conectado: true; por_item: Record<string, VisitasAnuncio | null> }`
  - `export async function fetchVisitasSonar(itemIds: string[]): Promise<RespostaVisitasSonar>`
  - `export function itensDaAmostra(vendas: PainelVendasSonar): ItemVendasSonar[]` — `vendas.itens ?? Object.values(vendas.por_anuncio ?? {})` (fallback para cache v4 antigo).
  - `export function normalizarSerieVisitas(porDia: Array<{ data: string; total: number }>, dias?: number, hoje?: Date): Array<{ data: string; total: number }>`
  - `ETAPAS_SONAR` vira 4 etapas (a busca de fichas morreu): `['Buscando anúncios do nicho', 'Analisando vendas e concorrência', 'Medindo visitas', 'Montando painel']`. A máquina `passosProgresso` NÃO muda (deriva tudo de `ETAPAS_SONAR.length`).

- [ ] **Step 1: Escrever os testes que falham**

Em `src/lib/__tests__/sonar.test.ts` — adicionar os describes novos E ajustar os textos/asserts do describe de `passosProgresso` que citam "5 etapas" para 4 (a máquina é a mesma; só o length muda):

```ts
import { itensDaAmostra, normalizarSerieVisitas, ETAPAS_SONAR } from '../sonar';

describe('ETAPAS_SONAR — 4 etapas (a busca de fichas morreu, ADR-0127)', () => {
  it('tem 4 etapas e nenhuma menciona ficha/catálogo', () => {
    expect(ETAPAS_SONAR).toHaveLength(4);
    for (const e of ETAPAS_SONAR) expect(e.toLowerCase()).not.toMatch(/ficha|catálogo/);
  });
});

describe('normalizarSerieVisitas — D9 (medido 19/08: API omite dias sem visita e embaralha)', () => {
  // Fixture com a forma real do defeito: 7 pontos, fora de ordem, numa janela de 30 dias.
  const bagunçado = [
    { data: '2026-08-15', total: 3 }, { data: '2026-07-22', total: 1 },
    { data: '2026-08-19', total: 7 }, { data: '2026-08-01', total: 2 },
    { data: '2026-07-25', total: 4 }, { data: '2026-08-10', total: 5 },
    { data: '2026-08-03', total: 6 },
  ];
  const hoje = new Date('2026-08-19T12:00:00.000Z');

  it('devolve a janela completa (30 pontos), ordenada, com 0 nos dias ausentes', () => {
    const serie = normalizarSerieVisitas(bagunçado, 30, hoje);
    expect(serie).toHaveLength(30);
    expect(serie[0].data).toBe('2026-07-21');
    expect(serie[29]).toEqual({ data: '2026-08-19', total: 7 });
    expect(serie.find((p) => p.data === '2026-08-15')).toEqual({ data: '2026-08-15', total: 3 });
    expect(serie.find((p) => p.data === '2026-08-18')).toEqual({ data: '2026-08-18', total: 0 });
    const datas = serie.map((p) => p.data);
    expect(datas).toEqual([...datas].sort());
  });

  it('série vazia vira 30 zeros (zero medido dentro de janela fechada, não "sem dado")', () => {
    const serie = normalizarSerieVisitas([], 30, hoje);
    expect(serie).toHaveLength(30);
    expect(serie.every((p) => p.total === 0)).toBe(true);
  });
});

describe('itensDaAmostra — lista da tabela com fallback para cache v4 antigo', () => {
  const item = { titulo: 'X', preco: 1, vendidos: null, link: null, imagem: null, vendedor: null,
    frete_gratis: null, loja_oficial: null, internacional: null, full: null, item_id: 'MLB1',
    catalog_product_id: null, avaliacao_nota: null, avaliacao_qtd: null, posicao: 1,
    patrocinado: null, selo: null, preco_anterior: null, desconto_pct: null, flex: null };
  const base = { configurado: true as const, termo: 't', gerado_em: 'g', itens_analisados: 1,
    itens_com_vendas: 0, vendas_totais: 0, valor_mercado: 0, produto_destaque: null,
    palavras_chave_titulos: [], raio_x: { total_anuncios: null, ticket_medio: null,
    lojas_oficiais: 0, full: 0, frete_gratis: 0, internacionais: 0 } };

  it('usa `itens` quando presente; cai para por_anuncio quando não (cache antigo)', () => {
    expect(itensDaAmostra({ ...base, itens: [item], por_anuncio: {} })).toEqual([item]);
    expect(itensDaAmostra({ ...base, por_anuncio: { MLB1: item } })).toEqual([item]);
    expect(itensDaAmostra({ ...base })).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test src/lib/__tests__/sonar.test.ts`
Expected: FAIL — exports novos inexistentes; `ETAPAS_SONAR` ainda com 5 etapas.

- [ ] **Step 3: Implementação mínima**

Em `src/lib/sonar.ts` (só ADIÇÕES + a troca das etapas — `PainelSonar`/`fetchPainelSonar`/`fichasAtivas`/`fichasSemVendedor` ficam até a Task 11, a página ainda os usa):

1. `ItemVendasSonar` ganha `category_id?: string | null;` (comentário: espelho de sonar-vendas.ts; opcional porque cache v4 pré-ADR-0127 não tem).
2. `PainelVendasSonar` ganha `itens?: ItemVendasSonar[];` e `historico_gravado?: boolean;` (mesmos comentários).
3. Novos exports (depois de `fetchVendasSonar`):
```ts
// --- Visitas por anúncio (ADR-0127/D3): espelho de pulse-sonar-visitas -------------------------

export interface VisitasAnuncio { total: number; por_dia: Array<{ data: string; total: number }> }

/** `conectado: false` = org sem conexão ML — indisponível, não erro (D16, único modo degradado).
 *  `por_item[id] = null` = falha de chamada; `total: 0` = ZERO MEDIDO (D8) — nunca confundir. */
export type RespostaVisitasSonar =
  | { conectado: false }
  | { conectado: true; por_item: Record<string, VisitasAnuncio | null> };

export async function fetchVisitasSonar(itemIds: string[]): Promise<RespostaVisitasSonar> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pulse-sonar-visitas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ item_ids: itemIds }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json as RespostaVisitasSonar;
}

/** Lista da tabela: amostra completa quando o painel é novo; cache v4 antigo cai para
 *  por_anuncio (perde só item sem item_id, que também não teria visitas/snapshot). */
export function itensDaAmostra(vendas: PainelVendasSonar): ItemVendasSonar[] {
  return vendas.itens ?? Object.values(vendas.por_anuncio ?? {});
}

/**
 * D9 (medido 19/08): /visits/time_window OMITE dias sem visita e devolve pontos FORA DE ORDEM
 * (7 pontos numa janela de 30 dias). Ordena e preenche com 0 os dias ausentes — senão o
 * sparkline comprime 30 dias em 7 e mente sobre o período. O 0 preenchido é legítimo (janela
 * fechada), diferente de "sem dado" (D8).
 * REFUTADO (não tentar de novo): nº de pontos devolvidos NÃO é proxy de idade do anúncio.
 */
export function normalizarSerieVisitas(
  porDia: Array<{ data: string; total: number }>,
  dias = 30,
  hoje = new Date(),
): Array<{ data: string; total: number }> {
  const mapa = new Map(porDia.map((p) => [p.data, p.total]));
  const serie: Array<{ data: string; total: number }> = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i);
    const data = d.toISOString().slice(0, 10);
    serie.push({ data, total: mapa.get(data) ?? 0 });
  }
  return serie;
}
```
4. Trocar `ETAPAS_SONAR`:
```ts
export const ETAPAS_SONAR = [
  'Buscando anúncios do nicho',
  'Analisando vendas e concorrência',
  'Medindo visitas',
  'Montando painel',
] as const;
```
(`INTERVALO_ETAPA_MS`, `ULTIMA_ETAPA_TEMPORIZADA` e `passosProgresso` não mudam — derivam do length.)

- [ ] **Step 4: Rodar e confirmar que passa (suíte inteira)**

Run: `pnpm test && pnpm lint`
Expected: PASS — inclusive os testes ajustados de `passosProgresso` (4 etapas).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sonar.ts src/lib/__tests__/sonar.test.ts
git commit -m "feat(sonar): lib do front — visitas por anúncio, normalização D9, etapas novas (ADR-0127)"
```

---

### Task 7: Recalibração do veredito — MEDIÇÃO (D12)

**Modelo:** opus (calibração de regra de negócio — nunca rebaixar)

**Files:**
- Create: `scripts/sonar-gabarito-fixtures.mjs`
- Create: `src/lib/__tests__/fixtures/sonar-gabarito/eucerin-protetor-solar.json`, `.../protetor-solar-facial.json`, `.../tecido-oxford-10-metros.json`
- Modify: `docs/decisions/0127-sonar-tabela-por-anuncio-e-historico.md` (seção "Calibração v2")

**Interfaces:**
- Consumes: edge `pulse-sonar-vendas` de PRODUÇÃO (a versão já no ar serve — o shape v4 com `por_anuncio` está em produção desde o ADR-0125); edge `pulse-sonar-visitas` (Task 5, deployada no Step 1).
- Produces: 3 fixtures `{ vendas: PainelVendasSonar, visitas_total: number | null }` + tabela "Calibração v2" no ADR-0127 com os números medidos e os cortes escolhidos. A Task 8 lê os cortes DALI.

**ESTA É UMA TASK DE MEDIÇÃO, NÃO DE ADIVINHAÇÃO.** O executor NÃO PODE inventar os cortes: ele roda os 3 termos, olha os números medidos, e escolhe cortes que reproduzam **média / média / alta** (nessa ordem). Se nenhum corte plausível reproduzir o gabarito para um fator, aplica a contingência de D12 (o fator vira informativo, não pontuado) e REPORTA — nunca força um corte que "passe no teste" distorcendo o resto.

**Custo real: US$ 0,30 exatos** (3 runs × US$ 0,10). Medido em 19/08/2026 no Redis de produção: NENHUM dos 3 termos-gabarito está em cache (as únicas chaves `sonar:vendas:v4:*` são `abracadeira nylon` e `abraçadeira nylon`). Depois do run, cada termo fica cacheado por 7 dias — re-rodar a task no mesmo dia NÃO cobra de novo. Termos exatos do ADR-0124: `EUCERIN protetor solar`, `protetor solar facial`, `tecido oxford 10 metros` (a chave usa o termo normalizado: `sonar:vendas:v4:MLB:eucerin protetor solar` etc.).

**Pré-requisito VERIFICADO em 19/08/2026 (não precisa re-checar):** a conta `VALIDATION_EMAIL` (`analistasistemas@icloud.com`) pertence à org **DSA** (`a1fcd536-bb43-4fae-9f44-1e09d19e6c8e`), que tem **1 conexão ML ativa** em `marketplace_connections`. Logo a edge de visitas responde `conectado: true` para ela e os cortes de visitas PODEM ser derivados. Se ainda assim vier `conectado: false`, pare e reporte — não derive cortes de visitas sem medição.

- [ ] **Step 1: Deployar a edge de visitas (aditiva — o front em produção não a chama)**

Run: `supabase functions deploy pulse-sonar-visitas` e conferir com `supabase functions list` que a versão subiu.
(A `pulse-sonar-vendas` NÃO é deployada aqui — a versão de produção atual basta para os fixtures e evita gravar snapshots com o código ainda em revisão. O deploy dela é a Task 13.)

- [ ] **Step 2: Escrever o script de medição**

Criar `scripts/sonar-gabarito-fixtures.mjs`:

```js
// Recalibração D12 (ADR-0127): roda os 3 termos-gabarito na pulse-sonar-vendas de PRODUÇÃO e
// congela os payloads como fixtures. CUSTO REAL: US$ 0,30 exatos (3 × US$0,10) — medido em
// 19/08/2026: nenhum dos 3 termos em cache. Após o run, cada termo fica cacheado 7 dias —
// re-rodar no mesmo dia NÃO cobra de novo.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const EMAIL = env.VALIDATION_EMAIL;
const SENHA = env.VALIDATION_PASSWORD;
if (!URL_BASE || !ANON || !EMAIL || !SENHA) {
  throw new Error('Faltam VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VALIDATION_EMAIL / VALIDATION_PASSWORD no .env.local');
}

const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: ANON },
  body: JSON.stringify({ email: EMAIL, password: SENHA }),
});
const { access_token } = await login.json();
if (!access_token) throw new Error('Login da conta VALIDATION falhou');

const chamar = async (fn, body) => {
  const r = await fetch(`${URL_BASE}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
    body: JSON.stringify(body),
  });
  return r.json();
};

const TERMOS = [
  ['eucerin-protetor-solar', 'EUCERIN protetor solar'],
  ['protetor-solar-facial', 'protetor solar facial'],
  ['tecido-oxford-10-metros', 'tecido oxford 10 metros'],
];
mkdirSync('src/lib/__tests__/fixtures/sonar-gabarito', { recursive: true });

for (const [slug, termo] of TERMOS) {
  const vendas = await chamar('pulse-sonar-vendas', { termo });
  if (!vendas?.configurado || !vendas.por_anuncio) {
    throw new Error(`Vendas falhou para "${termo}": ${JSON.stringify(vendas).slice(0, 200)}`);
  }
  const itemIds = Object.keys(vendas.por_anuncio).slice(0, 20);
  let visitasTotal = null;
  if (itemIds.length > 0) {
    const visitas = await chamar('pulse-sonar-visitas', { item_ids: itemIds });
    if (visitas?.conectado) {
      const medidos = Object.values(visitas.por_item).filter((v) => v != null);
      // LOUD: só soma o que foi medido; nenhum item medido → null, nunca 0.
      visitasTotal = medidos.length > 0 ? medidos.reduce((a, v) => a + v.total, 0) : null;
    } else {
      console.warn(`AVISO: visitas indisponíveis para "${termo}" (conectado:false — org da conta sem conexão ML)`);
    }
  }
  writeFileSync(
    `src/lib/__tests__/fixtures/sonar-gabarito/${slug}.json`,
    JSON.stringify({ vendas, visitas_total: visitasTotal }, null, 2),
  );
  console.log(`${termo}: ${vendas.itens_analisados} itens, com_vendas=${vendas.itens_com_vendas}, visitas_total=${visitasTotal}`);
}
```

- [ ] **Step 3: Rodar a medição (GASTA US$ 0,30 — uma vez)**

Antes: `grep -c VALIDATION .env.local` — se as credenciais VALIDATION_* não existirem no `.env.local`, PARAR e pedir ao Diego (não inventar credencial).
Run: `node scripts/sonar-gabarito-fixtures.mjs`
Expected: 3 arquivos JSON criados, log com itens/vendas/visitas por termo.
Se `conectado:false` nas visitas (a org da conta VALIDATION pode não ter conexão ML): os fixtures ficam com `visitas_total: null` — os cortes `VISITAS_V2` não são deriváveis; aplicar a contingência de D12 para o sub-sinal de visitas (vira detalhe informativo na Task 8) e registrar isso no ADR. NÃO rodar com as credenciais do Diego sem OK explícito dele.

- [ ] **Step 4: Derivar as métricas v2 de cada fixture e escolher os cortes**

Para cada fixture, calcular (à mão ou com `node -e`, os números são poucos) e registrar na tabela:
- `liquidez = itens_com_vendas / itens_analisados` e `vendas_totais` (Demanda — cortes atuais `DEMANDA` mantidos, spec D11);
- `cobertura = nº itens com vendedor != null / itens_analisados` (trava D10);
- `pulverizacao = nicknames distintos / itens com vendedor` (Disputa v2);
- `frete_pct = raio_x.frete_gratis / itens_analisados × 100` e `patrocinado_pct = nº itens patrocinado===true / itens_analisados × 100` (Disputa v2);
- `tracao = Σ(vendidos × preco) dos itens com vendedor nomeado ÷ nicknames distintos` (Tração v2 — numerador e denominador da MESMA subamostra);
- `visitas_total` (sub-sinal da Demanda).

Escolher cortes `DISPUTA_V2 { pulverizacaoBaixa, pulverizacaoAlta, fretePouco, freteMuito, patrocinadoMuito }`, `TRACAO_V2 { boa, media }`, `VISITAS_V2 { minimas }` que reproduzam **EUCERIN=média, protetor solar facial=média, tecido oxford=alta** com a combinação da Task 8 (2 pts bom / 1 médio / 0 ruim; gate de Demanda ruim; alta ≥ máximo−1; baixa ≤ máximo/3). Regras:
- Corte entre os valores medidos dos nichos que os separam — não em cima de um deles (margem para ruído).
- PROIBIDO copiar/escalar números de `DISPUTA`/`TRACAO`/`VISITAS` antigos (escala morta, spec D11).
- Não reproduziu com nenhum corte plausível → contingência D12: o fator vira informativo (não pontuado) e o porquê vai para o ADR.

- [ ] **Step 5: Registrar no ADR-0127 e commitar**

Substituir a frase-placeholder da seção "Calibração v2" do ADR pela tabela: métricas medidas por termo (data da medição), cortes escolhidos e o racional de cada um (1 frase por corte), mais qualquer contingência aplicada.

```bash
git add scripts/sonar-gabarito-fixtures.mjs src/lib/__tests__/fixtures/sonar-gabarito docs/decisions/0127-sonar-tabela-por-anuncio-e-historico.md
git commit -m "feat(sonar): fixtures-gabarito medidos + calibração v2 no ADR-0127 (D12, US\$0,30)"
```

---

### Task 8: Veredito v2 — `calcularVereditoAnuncios`

**Modelo:** opus (regra de negócio calibrada — nunca rebaixar)

**Files:**
- Modify: `src/lib/veredito-sonar.ts` (ADIÇÕES ao lado do código antigo — `calcularVeredito`/`contextoNicho` antigos ficam até a Task 11, a página ainda os usa)
- Test: `src/lib/__tests__/veredito-sonar.test.ts` (adicionar describes novos; os antigos ficam até a Task 11)

**Interfaces:**
- Consumes: fixtures e cortes da Task 7 (tabela "Calibração v2" do ADR-0127); `PainelVendasSonar`, `ItemVendasSonar`, `itensDaAmostra` (Task 6); tipos existentes `NivelFator`, `NivelVeredito`, `Fator`, `AlertaMarca`, `ExplicacaoRegua`, `ExplicacaoFator`, `Explicacao`, `ContextoItem` e helpers `regua`, `montarMotivo`, `TITULOS`, `ACAO`, `PONTOS`, `pct`, `brlMil` (reusados, não duplicados).
- Produces (usados pela Task 10):
  - `export interface VereditoAnuncios { nivel: NivelVeredito; titulo: string; motivo: string; fatores: Fator[]; marca: AlertaMarca | null; explicacao: Explicacao }` (sem `semVendas` — o fallback morreu, D16)
  - `export function calcularVereditoAnuncios(vendas: PainelVendasSonar, visitasTotal: number | null): VereditoAnuncios`
  - `export function contextoNichoAnuncios(vendas: PainelVendasSonar): ContextoItem[]`
  - `export function subamostraNomeada(vendas: PainelVendasSonar): SubamostraNomeada` (exportada para teste)

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `src/lib/__tests__/veredito-sonar.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { calcularVereditoAnuncios, subamostraNomeada } from '../veredito-sonar';
import type { ItemVendasSonar, PainelVendasSonar } from '../sonar';

const fixture = (slug: string): { vendas: PainelVendasSonar; visitas_total: number | null } =>
  JSON.parse(readFileSync(new URL(`./fixtures/sonar-gabarito/${slug}.json`, import.meta.url), 'utf8'));

const itemV2 = (over: Partial<ItemVendasSonar> = {}): ItemVendasSonar => ({
  titulo: 'X', preco: 100, vendidos: 100, link: null, imagem: null, vendedor: 'LOJA-A',
  frete_gratis: false, loja_oficial: false, internacional: false, full: null, item_id: 'MLB1',
  catalog_product_id: null, avaliacao_nota: null, avaliacao_qtd: null, posicao: 1,
  patrocinado: false, selo: null, preco_anterior: null, desconto_pct: null, flex: null, ...over,
});

const painelSintetico = (itens: ItemVendasSonar[]): PainelVendasSonar => {
  const comVendas = itens.filter((i) => i.vendidos != null);
  return {
    configurado: true, termo: 'sintético', gerado_em: 'g', itens,
    itens_analisados: itens.length, itens_com_vendas: comVendas.length,
    vendas_totais: comVendas.reduce((a, i) => a + (i.vendidos ?? 0), 0),
    valor_mercado: comVendas.reduce((a, i) => a + (i.vendidos ?? 0) * (i.preco ?? 0), 0),
    produto_destaque: null, palavras_chave_titulos: [],
    por_anuncio: Object.fromEntries(itens.filter((i) => i.item_id).map((i) => [i.item_id!, i])),
    raio_x: {
      total_anuncios: null, ticket_medio: null,
      lojas_oficiais: itens.filter((i) => i.loja_oficial === true).length,
      full: itens.filter((i) => i.full === true).length,
      frete_gratis: itens.filter((i) => i.frete_gratis === true).length,
      internacionais: itens.filter((i) => i.internacional === true).length,
    },
  };
};

describe('calcularVereditoAnuncios — gabarito D12 (fixtures REAIS medidos na Task 7)', () => {
  it('EUCERIN protetor solar → média', () => {
    const { vendas, visitas_total } = fixture('eucerin-protetor-solar');
    expect(calcularVereditoAnuncios(vendas, visitas_total).nivel).toBe('media');
  });
  it('protetor solar facial → média', () => {
    const { vendas, visitas_total } = fixture('protetor-solar-facial');
    expect(calcularVereditoAnuncios(vendas, visitas_total).nivel).toBe('media');
  });
  it('tecido oxford 10 metros → ALTA (critério de aceitação do ADR-0124 — NUNCA relaxar)', () => {
    const { vendas, visitas_total } = fixture('tecido-oxford-10-metros');
    expect(calcularVereditoAnuncios(vendas, visitas_total).nivel).toBe('alta');
  });
});

describe('trava de cobertura <50% (D10) — nunca medir concorrência sobre meia dúzia de nicknames', () => {
  it('4/20 nomeados → só o fator Demanda pontua; Disputa e Tração fora', () => {
    const nomeados = Array.from({ length: 4 }, (_, i) => itemV2({ item_id: `MLB${i}`, vendedor: `V${i}`, vendidos: 2000 }));
    const anonimos = Array.from({ length: 16 }, (_, i) => itemV2({ item_id: `MLBx${i}`, vendedor: null, vendidos: 2000 }));
    const v = calcularVereditoAnuncios(painelSintetico([...nomeados, ...anonimos]), null);
    expect(v.fatores.map((f) => f.chave)).toEqual(['demanda']);
  });
});

describe('invariância ao tamanho da amostra (D11) — a censura não pode mudar o nível', () => {
  it('nicho totalmente pulverizado (todo anúncio de um vendedor distinto) com 6 e com 20 itens → pulverização 1,0 nas duas e mesmo nível de Disputa', () => {
    const nicho = (n: number) => painelSintetico(Array.from({ length: n }, (_, i) =>
      itemV2({ item_id: `MLB${i}`, vendedor: `VENDEDOR-${i}`, vendidos: 1000 })));
    const v6 = calcularVereditoAnuncios(nicho(6), null);
    const v20 = calcularVereditoAnuncios(nicho(20), null);
    const disputa6 = v6.fatores.find((f) => f.chave === 'disputa');
    const disputa20 = v20.fatores.find((f) => f.chave === 'disputa');
    expect(disputa6?.nivel).toBe(disputa20?.nivel);
  });
});

describe('visitas na Demanda (spec, seção Veredito v2)', () => {
  it('visitasTotal null NÃO rebaixa (LOUD: ausência não pune)', () => {
    const bom = painelSintetico(Array.from({ length: 20 }, (_, i) =>
      itemV2({ item_id: `MLB${i}`, vendedor: i % 3 === 0 ? 'LOJA-A' : `V${i}`, vendidos: 1000 })));
    const comNull = calcularVereditoAnuncios(bom, null);
    const demanda = comNull.fatores.find((f) => f.chave === 'demanda');
    expect(demanda?.nivel).toBe('bom');
  });
});

describe('subamostraNomeada — numerador e denominador do MESMO universo', () => {
  it('faturamento só conta itens com vendedor nomeado', () => {
    const s = subamostraNomeada(painelSintetico([
      itemV2({ item_id: 'MLB1', vendedor: 'A', vendidos: 10, preco: 10 }),
      itemV2({ item_id: 'MLB2', vendedor: null, vendidos: 1000, preco: 100 }),
    ]));
    expect(s).toEqual({ analisados: 2, nomeados: 1, distintos: 1, cobertura: 0.5, faturamento: 100 });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test src/lib/__tests__/veredito-sonar.test.ts`
Expected: FAIL — `calcularVereditoAnuncios`/`subamostraNomeada` não exportadas.

- [ ] **Step 3: Implementação**

Adicionar em `src/lib/veredito-sonar.ts` (ao lado do código antigo, sem tocá-lo; import de `itensDaAmostra` e `ItemVendasSonar` de `./sonar`). Os QUATRO grupos de números marcados `/* ← ADR-0127 §Calibração v2 */` vêm OBRIGATORIAMENTE da tabela medida na Task 7 — se ela não existir ainda, esta task está fora de ordem, PARE:

```ts
// ================= Veredito v2 (ADR-0127/D10-D12): unidade = anúncio =========================
// Sem painel de fichas e SEM fallback sem Apify (D16): a lista de anúncios É a Apify — sem ela
// não há tabela nem veredito. Visitas somadas entram como sub-sinal DENTRO da Demanda.

export interface VereditoAnuncios {
  nivel: NivelVeredito;
  titulo: string;
  motivo: string;
  fatores: Fator[];
  marca: AlertaMarca | null;
  explicacao: Explicacao;
}

const COBERTURA_MINIMA = 0.5; // D10: <50% de itens com vendedor → Disputa e Tração indisponíveis

// Cortes MEDIDOS na recalibração (Task 7 do plano; tabela no ADR-0127 §Calibração v2).
// PROIBIDO copiar números de DISPUTA/TRACAO/VISITAS antigos — a escala morreu com a fonte (D11).
const DISPUTA_V2 = {
  pulverizacaoBaixa: 0, pulverizacaoAlta: 0,   /* ← ADR-0127 §Calibração v2 */
  fretePouco: 0, freteMuito: 0,                /* ← ADR-0127 §Calibração v2 */
  patrocinadoMuito: 0,                          /* ← ADR-0127 §Calibração v2 */
};
const TRACAO_V2 = { boa: 0, media: 0 };         /* ← ADR-0127 §Calibração v2 */
const VISITAS_V2 = { minimas: 0 };              /* ← ADR-0127 §Calibração v2 */

const REBAIXA: Record<NivelFator, NivelFator> = { bom: 'medio', medio: 'ruim', ruim: 'ruim' };

export interface SubamostraNomeada {
  analisados: number;
  nomeados: number;
  distintos: number;
  cobertura: number;
  faturamento: number; // Σ vendidos × preço SÓ dos itens nomeados — mesmo universo do denominador
}

export function subamostraNomeada(vendas: PainelVendasSonar): SubamostraNomeada {
  const itens = itensDaAmostra(vendas);
  const nomes = new Set<string>();
  let nomeados = 0;
  let faturamento = 0;
  for (const i of itens) {
    if (i.vendedor == null) continue;
    nomeados += 1;
    nomes.add(i.vendedor);
    if (i.vendidos != null && i.preco != null) faturamento += i.vendidos * i.preco;
  }
  const analisados = itens.length;
  return {
    analisados, nomeados, distintos: nomes.size,
    cobertura: analisados > 0 ? nomeados / analisados : 0,
    faturamento,
  };
}

function nivelDemandaV2(vendas: PainelVendasSonar, visitasTotal: number | null): {
  nivel: NivelFator; detalhe: string; liquidez: number; vendasTotais: number; rebaixadaPorVisitas: boolean;
} {
  const liquidez = vendas.itens_analisados > 0 ? vendas.itens_com_vendas / vendas.itens_analisados : 0;
  let nivel: NivelFator;
  if (vendas.vendas_totais < DEMANDA.vendasMinimas || liquidez < DEMANDA.liquidezRuim) nivel = 'ruim';
  else if (liquidez >= DEMANDA.liquidezBoa && vendas.vendas_totais >= DEMANDA.vendasBoas) nivel = 'bom';
  else nivel = 'medio';
  // Sub-sinal de visitas (spec §Veredito v2): tráfego medido abaixo do mínimo rebaixa UM nível.
  // null NUNCA rebaixa (LOUD: ausência não pune). Contingência D12: se o gabarito não fechar
  // com o rebaixamento, remover este if (visitas viram só detalhe) e registrar no ADR.
  const rebaixadaPorVisitas = visitasTotal != null && visitasTotal < VISITAS_V2.minimas && nivel !== 'ruim';
  if (rebaixadaPorVisitas) nivel = REBAIXA[nivel];
  let detalhe = `${pct(liquidez * 100)} dos anúncios vendem`;
  if (rebaixadaPorVisitas) detalhe += ` · só ${fmtMilhar(visitasTotal!, 1)} visitas/30d`;
  return { nivel, detalhe, liquidez, vendasTotais: vendas.vendas_totais, rebaixadaPorVisitas };
}

function nivelDisputaV2(vendas: PainelVendasSonar, sub: SubamostraNomeada): {
  nivel: NivelFator; detalhe: string; pulverizacao: number; frete: number; patrocinadoPct: number;
} | null {
  if (sub.cobertura < COBERTURA_MINIMA || sub.nomeados === 0) return null; // trava D10
  const itens = itensDaAmostra(vendas);
  const pulverizacao = sub.distintos / sub.nomeados; // 0–1, invariante ao tamanho da amostra (D11)
  const frete = sub.analisados > 0 ? (vendas.raio_x.frete_gratis / sub.analisados) * 100 : 0;
  const patrocinadoPct = sub.analisados > 0
    ? (itens.filter((i) => i.patrocinado === true).length / sub.analisados) * 100 : 0;
  const detalhe = `${sub.distintos} vendedores em ${sub.nomeados} anúncios · ${pct(frete)} frete grátis`;
  let nivel: NivelFator;
  if (pulverizacao >= DISPUTA_V2.pulverizacaoAlta || frete >= DISPUTA_V2.freteMuito
    || patrocinadoPct >= DISPUTA_V2.patrocinadoMuito) nivel = 'ruim';
  else if (pulverizacao <= DISPUTA_V2.pulverizacaoBaixa && frete <= DISPUTA_V2.fretePouco) nivel = 'bom';
  else nivel = 'medio';
  return { nivel, detalhe, pulverizacao, frete, patrocinadoPct };
}

function nivelTracaoV2(sub: SubamostraNomeada): { nivel: NivelFator; detalhe: string; porVendedor: number } | null {
  if (sub.cobertura < COBERTURA_MINIMA || sub.distintos === 0) return null; // trava D10
  const porVendedor = sub.faturamento / sub.distintos;
  const detalhe = `R$ ${fmtMilhar(Math.round(porVendedor), 1)} por vendedor (subamostra nomeada)`;
  const nivel: NivelFator = porVendedor >= TRACAO_V2.boa ? 'bom'
    : porVendedor >= TRACAO_V2.media ? 'medio' : 'ruim';
  return { nivel, detalhe, porVendedor };
}

function alertaMarcaV2(vendas: PainelVendasSonar): { nivel: NivelFator; detalhe: string; pct: number } | null {
  if (vendas.itens_analisados === 0) return null;
  const p = (vendas.raio_x.lojas_oficiais / vendas.itens_analisados) * 100;
  const detalhe = `${pct(p)} da amostra com loja oficial`;
  if (p > MARCA.dominado) return { nivel: 'ruim', detalhe, pct: p };
  if (p >= MARCA.aberto) return { nivel: 'medio', detalhe, pct: p };
  return { nivel: 'bom', detalhe, pct: p };
}

export function calcularVereditoAnuncios(vendas: PainelVendasSonar, visitasTotal: number | null): VereditoAnuncios {
  const sub = subamostraNomeada(vendas);
  const demanda = nivelDemandaV2(vendas, visitasTotal);
  const disputa = nivelDisputaV2(vendas, sub);
  const tracao = nivelTracaoV2(sub);

  const fatores: Fator[] = [{ chave: 'demanda', label: 'Demanda', nivel: demanda.nivel, detalhe: demanda.detalhe }];
  if (disputa) fatores.push({ chave: 'disputa', label: 'Disputa', nivel: disputa.nivel, detalhe: disputa.detalhe });
  if (tracao) fatores.push({ chave: 'tracao', label: 'Tração', nivel: tracao.nivel, detalhe: tracao.detalhe });

  const soma = fatores.reduce((acc, f) => acc + PONTOS[f.nivel], 0);
  const maximo = fatores.length * 2; // escala proporcional (ADR-0124 §4) absorve a trava D10
  const gateDemanda = demanda.nivel === 'ruim';
  const nivel: NivelVeredito = gateDemanda || soma <= maximo / 3 ? 'baixa'
    : soma >= maximo - 1 ? 'alta' : 'media';

  const marca = alertaMarcaV2(vendas);

  const fatoresExplicacao: ExplicacaoFator[] = [{
    chave: 'demanda', nivel: demanda.nivel,
    frase: fraseDemanda(demanda.nivel, demanda.vendasTotais, demanda.liquidez)
      + (demanda.rebaixadaPorVisitas
        ? ` Rebaixada um nível: só ${fmtMilhar(visitasTotal!, 1)} visitas medidas em 30 dias (mínimo ${fmtMilhar(VISITAS_V2.minimas, 1)}).`
        : ''),
    regua: regua(0, 100, [Math.round(DEMANDA.liquidezRuim * 100), Math.round(DEMANDA.liquidezBoa * 100)], Math.round(demanda.liquidez * 100), false),
    destravar: demanda.nivel === 'bom' ? null : destravarDemanda(demanda.nivel, demanda.vendasTotais, demanda.liquidez),
  }];
  if (disputa) {
    fatoresExplicacao.push({
      chave: 'disputa', nivel: disputa.nivel,
      frase: `De cada 10 anúncios com vendedor identificado, ${Math.round(disputa.pulverizacao * 10)} são de vendedores diferentes; frete grátis em ${pct(disputa.frete)} e anúncio pago em ${pct(disputa.patrocinadoPct)} da amostra.`,
      regua: regua(0, 1, [DISPUTA_V2.pulverizacaoBaixa, DISPUTA_V2.pulverizacaoAlta], disputa.pulverizacao, true),
      destravar: disputa.nivel === 'bom' ? null
        : `com pulverização até ${DISPUTA_V2.pulverizacaoBaixa} e frete grátis até ${DISPUTA_V2.fretePouco}% a disputa entraria na faixa tranquila — hoje: ${disputa.pulverizacao.toFixed(2)} e ${pct(disputa.frete)}`,
    });
  }
  if (tracao) {
    fatoresExplicacao.push({
      chave: 'tracao', nivel: tracao.nivel,
      frase: `Cada vendedor identificado fatura ${brlMil(tracao.porVendedor)} na amostra — numerador e denominador do mesmo universo (só anúncios com vendedor nomeado).`,
      regua: regua(0, TRACAO_V2.boa * 2, [TRACAO_V2.media, TRACAO_V2.boa], Math.round(tracao.porVendedor), false),
      destravar: tracao.nivel === 'bom' ? null
        : `a partir de ${brlMil(tracao.nivel === 'ruim' ? TRACAO_V2.media : TRACAO_V2.boa)} por vendedor a tração subiria de faixa — hoje: ${brlMil(tracao.porVendedor)}`,
    });
  }
  if (!disputa || !tracao) {
    // Trava D10 visível no "Saiba mais": indisponível ≠ ruim.
    fatoresExplicacao.push({
      chave: !disputa ? 'disputa' : 'tracao', nivel: 'medio',
      frase: `Só ${sub.nomeados} de ${sub.analisados} anúncios identificam o vendedor (mínimo: ${Math.round(COBERTURA_MINIMA * 100)}%) — sem base para medir concorrência; o fator saiu da pontuação, não virou nota ruim.`,
      regua: null, destravar: null,
    });
  }
  if (marca) {
    fatoresExplicacao.push({
      chave: 'marca', nivel: marca.nivel,
      frase: fraseMarca(marca.nivel, marca.pct).replace('das fichas ativas', 'da amostra'),
      regua: regua(0, 100, [MARCA.aberto, MARCA.dominado], Math.round(marca.pct), true),
      destravar: marca.nivel === 'bom' ? null : destravarMarca(marca.nivel, marca.pct),
    });
  }

  const acaoBase = ACAO[nivel];
  const acao = gateDemanda
    ? `Demanda insuficiente derruba o veredito para baixa por conta própria, independente dos outros fatores. ${acaoBase}`
    : acaoBase;

  return {
    nivel,
    titulo: TITULOS[nivel],
    motivo: montarMotivo(nivel, fatores, false),
    fatores,
    marca,
    explicacao: { pontuacao: { soma, maximo }, gateDemanda, fatores: fatoresExplicacao, acao },
  };
}

/** Contexto fora do score (mediana de preço, ticket, % Full, % internacionais) — tudo da amostra. */
export function contextoNichoAnuncios(vendas: PainelVendasSonar): ContextoItem[] {
  const itens: ContextoItem[] = [];
  const precos = itensDaAmostra(vendas)
    .map((i) => i.preco)
    .filter((p): p is number => p != null)
    .sort((a, b) => a - b);
  if (precos.length > 0) {
    const meio = Math.floor(precos.length / 2);
    const mediana = precos.length % 2 === 1 ? precos[meio] : (precos[meio - 1] + precos[meio]) / 2;
    itens.push({ rotulo: 'Preço mediano da amostra', valor: fmtBRL(mediana) });
  }
  const rx = vendas.raio_x;
  if (rx.ticket_medio != null) itens.push({ rotulo: 'Ticket médio da amostra', valor: fmtBRL(rx.ticket_medio) });
  if (vendas.itens_analisados > 0) {
    itens.push({ rotulo: '% Full na amostra', valor: pct((rx.full / vendas.itens_analisados) * 100) });
    itens.push({ rotulo: '% internacionais na amostra', valor: pct((rx.internacionais / vendas.itens_analisados) * 100) });
  }
  return itens;
}
```

Substituir os `0` marcados `/* ← ADR-0127 §Calibração v2 */` pelos números medidos na Task 7. Iterar contra o teste do gabarito: se NENHUM corte plausível fizer os 3 asserts passarem para um fator, aplicar a contingência D12 (o fator vira informativo — remover do array `fatores` e mover para `fatoresExplicacao` com a nota, como na trava D10) e registrar no ADR. O assert do tecido oxford NUNCA é relaxado.

- [ ] **Step 4: Rodar e confirmar que passa (suíte inteira)**

Run: `pnpm test && pnpm lint`
Expected: PASS — os 6 describes novos E os testes antigos de `calcularVeredito` (intocados até a Task 11).

- [ ] **Step 5: Commit**

```bash
git add src/lib/veredito-sonar.ts src/lib/__tests__/veredito-sonar.test.ts
git commit -m "feat(sonar): veredito v2 por anúncio — pulverização, tração por subamostra, trava de cobertura (ADR-0127)"
```

---

### Task 9: Filtros v2 — `aplicarFiltrosAnuncios`

**Modelo:** sonnet

**Files:**
- Modify: `src/lib/sonar-filtros.ts` (ADIÇÕES ao lado do código antigo — `FiltrosSonar`/`aplicarFiltros` antigos ficam até a Task 11)
- Test: `src/lib/__tests__/sonar-filtros.test.ts` (describes novos; os antigos ficam até a Task 11)

**Interfaces:**
- Consumes: `ItemVendasSonar`, `VisitasAnuncio` (Task 6).
- Produces (usados pela Task 10):
  - `export interface FiltrosAnuncios { minVendas: number | null; minVisitas: number | null; precoMin: number | null; precoMax: number | null; minNota: number | null; soFull: boolean; soComDesconto: boolean; esconderPatrocinados: boolean; esconderLojaOficial: boolean }` — `maxVendedores` morre (não há contagem de ofertas por anúncio).
  - `export const FILTROS_ANUNCIOS_VAZIOS: FiltrosAnuncios`
  - `export function temFiltroAnunciosAtivo(f: FiltrosAnuncios): boolean`
  - `export function aplicarFiltrosAnuncios(itens: ItemVendasSonar[], visitasPorItem: Map<string, VisitasAnuncio | null>, filtros: FiltrosAnuncios): { visiveis: ItemVendasSonar[]; excluidasSemDado: number }`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `src/lib/__tests__/sonar-filtros.test.ts` (reusar o `itemV2` abaixo):

```ts
import { aplicarFiltrosAnuncios, FILTROS_ANUNCIOS_VAZIOS, temFiltroAnunciosAtivo } from '../sonar-filtros';
import type { ItemVendasSonar, VisitasAnuncio } from '../sonar';

const itemV2 = (over: Partial<ItemVendasSonar> = {}): ItemVendasSonar => ({
  titulo: 'X', preco: 50, vendidos: 100, link: null, imagem: null, vendedor: null,
  frete_gratis: null, loja_oficial: false, internacional: null, full: null, item_id: 'MLB1',
  catalog_product_id: null, avaliacao_nota: 4.5, avaliacao_qtd: null, posicao: 1,
  patrocinado: false, selo: null, preco_anterior: null, desconto_pct: null, flex: null, ...over,
});
const visitas = (total: number): VisitasAnuncio => ({ total, por_dia: [] });

describe('aplicarFiltrosAnuncios — D14 sobre a unidade anúncio (null nunca vira 0)', () => {
  it('minVendas: null no item EXCLUI e conta em excluidasSemDado', () => {
    const r = aplicarFiltrosAnuncios(
      [itemV2({ item_id: 'MLB1', vendidos: 500 }), itemV2({ item_id: 'MLB2', vendidos: null })],
      new Map(), { ...FILTROS_ANUNCIOS_VAZIOS, minVendas: 100 });
    expect(r.visiveis.map((i) => i.item_id)).toEqual(['MLB1']);
    expect(r.excluidasSemDado).toBe(1);
  });

  it('minVisitas: total 0 é ZERO MEDIDO (compara normal, D8); ausente/null no mapa é sem dado', () => {
    const mapa = new Map<string, VisitasAnuncio | null>([['MLB1', visitas(0)], ['MLB2', null]]);
    const r = aplicarFiltrosAnuncios(
      [itemV2({ item_id: 'MLB1' }), itemV2({ item_id: 'MLB2' }), itemV2({ item_id: 'MLB3' })],
      mapa, { ...FILTROS_ANUNCIOS_VAZIOS, minVisitas: 1 });
    expect(r.visiveis).toEqual([]);          // MLB1: 0 < 1 (medido); MLB2/MLB3: sem dado
    expect(r.excluidasSemDado).toBe(2);      // só os sem dado contam
  });

  it('faixa de preço sobre item.preco; toggles não contam em excluidasSemDado', () => {
    const r = aplicarFiltrosAnuncios(
      [itemV2({ item_id: 'MLB1', preco: 10 }), itemV2({ item_id: 'MLB2', preco: 90, patrocinado: true })],
      new Map(), { ...FILTROS_ANUNCIOS_VAZIOS, precoMin: 50, esconderPatrocinados: true });
    expect(r.visiveis).toEqual([]);
    expect(r.excluidasSemDado).toBe(0);
  });

  it('temFiltroAnunciosAtivo: vazio false, qualquer campo true', () => {
    expect(temFiltroAnunciosAtivo(FILTROS_ANUNCIOS_VAZIOS)).toBe(false);
    expect(temFiltroAnunciosAtivo({ ...FILTROS_ANUNCIOS_VAZIOS, soFull: true })).toBe(true);
    expect(temFiltroAnunciosAtivo({ ...FILTROS_ANUNCIOS_VAZIOS, minVisitas: 10 })).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test src/lib/__tests__/sonar-filtros.test.ts`
Expected: FAIL — exports novos inexistentes.

- [ ] **Step 3: Implementação mínima**

Adicionar em `src/lib/sonar-filtros.ts` (imports: `ItemVendasSonar`, `VisitasAnuncio` de `./sonar`):

```ts
// --- v2 (ADR-0127): filtros sobre a unidade ANÚNCIO. maxVendedores morreu com as fichas. -------

export interface FiltrosAnuncios {
  minVendas: number | null;
  minVisitas: number | null;
  precoMin: number | null;
  precoMax: number | null;
  minNota: number | null;
  soFull: boolean;
  soComDesconto: boolean;
  esconderPatrocinados: boolean;
  esconderLojaOficial: boolean;
}

export const FILTROS_ANUNCIOS_VAZIOS: FiltrosAnuncios = {
  minVendas: null, minVisitas: null, precoMin: null, precoMax: null, minNota: null,
  soFull: false, soComDesconto: false, esconderPatrocinados: false, esconderLojaOficial: false,
};

export function temFiltroAnunciosAtivo(f: FiltrosAnuncios): boolean {
  return (
    f.minVendas != null || f.minVisitas != null || f.precoMin != null || f.precoMax != null
    || f.minNota != null || f.soFull || f.soComDesconto || f.esconderPatrocinados || f.esconderLojaOficial
  );
}

/**
 * Mesmas regras D14 do antigo, sobre o anúncio: filtro numérico ativo com campo null EXCLUI e
 * conta em excluidasSemDado. Visitas: total 0 é ZERO MEDIDO e compara normal (D8); item fora do
 * mapa ou com null (falha) é "sem dado". Toggles não contam em excluidasSemDado.
 */
export function aplicarFiltrosAnuncios(
  itens: ItemVendasSonar[],
  visitasPorItem: Map<string, VisitasAnuncio | null>,
  filtros: FiltrosAnuncios,
): { visiveis: ItemVendasSonar[]; excluidasSemDado: number } {
  let excluidasSemDado = 0;

  const visiveis = itens.filter((i) => {
    if (filtros.minVendas != null) {
      if (i.vendidos == null) { excluidasSemDado++; return false; }
      if (i.vendidos < filtros.minVendas) return false;
    }
    if (filtros.minVisitas != null) {
      const v = i.item_id != null ? visitasPorItem.get(i.item_id) ?? null : null;
      if (v == null) { excluidasSemDado++; return false; }
      if (v.total < filtros.minVisitas) return false;
    }
    if (filtros.precoMin != null || filtros.precoMax != null) {
      if (i.preco == null) { excluidasSemDado++; return false; }
      if (filtros.precoMin != null && i.preco < filtros.precoMin) return false;
      if (filtros.precoMax != null && i.preco > filtros.precoMax) return false;
    }
    if (filtros.minNota != null) {
      if (i.avaliacao_nota == null) { excluidasSemDado++; return false; }
      if (i.avaliacao_nota < filtros.minNota) return false;
    }
    if (filtros.soFull && i.full !== true) return false;
    if (filtros.soComDesconto && i.desconto_pct == null) return false;
    if (filtros.esconderPatrocinados && i.patrocinado === true) return false;
    if (filtros.esconderLojaOficial && i.loja_oficial === true) return false;
    return true;
  });

  return { visiveis, excluidasSemDado };
}
```

- [ ] **Step 4: Rodar e confirmar que passa (suíte inteira)**

Run: `pnpm test && pnpm lint`
Expected: PASS — novos e antigos (antigos morrem só na Task 11).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sonar-filtros.ts src/lib/__tests__/sonar-filtros.test.ts
git commit -m "feat(sonar): filtros v2 sobre a unidade anúncio (ADR-0127)"
```

---

### Task 10: Página — tabela por anúncio, duas queries, estados D16

**Modelo:** sonnet

**Files:**
- Modify: `src/pages/PulseSonar.tsx`
- Modify: `src/components/pulse/veredito-sonar.tsx`
- Modify: `src/components/pulse/dialog-margem-sonar.tsx`

**Interfaces:**
- Consumes: `fetchVendasSonar`, `fetchVisitasSonar`, `itensDaAmostra`, `normalizarSerieVisitas`, `passosProgresso`, `VisitasAnuncio`, `ItemVendasSonar` (Task 6); `calcularVereditoAnuncios`, `contextoNichoAnuncios`, `VereditoAnuncios` (Task 8); `aplicarFiltrosAnuncios`, `FILTROS_ANUNCIOS_VAZIOS`, `temFiltroAnunciosAtivo`, `FiltrosAnuncios` (Task 9); `DataTable`/`Column` (`src/components/ui/data-table.tsx`), `Sparkline`, `Badge`, `KpiCard`, `EmptyState` (existentes).
- Produces: `interface AnuncioSimulavel { id: string; nome: string; category_id: string | null; preco_referencia: number | null }` no dialog (prop continua chamada `ficha`).

Convenção do projeto: páginas não têm teste de componente — a lógica está nas libs (Tasks 6/8/9) e a validação runtime é a Task 14. Gate desta task: lint + tsc + suíte verde.

- [ ] **Step 1: Reescrever `PulseSonar.tsx`**

REMOÇÕES (a página inteira muda de unidade):
- Imports de `fetchPainelSonar`, `fichasAtivas`, `fichasSemVendedor`, `PainelSonar`, `RaioXNicho` mantém (RaioXBarra fica), de `sonar-cruzamento` (tudo) e dos símbolos antigos de filtros (`aplicarFiltros`, `FILTROS_VAZIOS`, `temFiltroAtivo`, `FiltrosSonar`) e do veredito antigo (`calcularVeredito`, `contextoNicho`).
- A query `['pulse', 'sonar', termoBuscado]` (painel oficial) morre.
- Estados `semVendedorAberto` e o bloco "Fichas de catálogo sem vendedor ativo"; o grid de KPIs do painel oficial (Visitas/Fichas/Ofertas/Vendedores/Frete); o gráfico "Visitas por dia" agregado (era do painel de fichas; decisão de UX da spec, seção Riscos — o dado por anúncio está no sparkline da linha); `grupoBDisponivel`, `vendasPorFicha`, `colunasFichas` e o `type Ficha`.
- `SonarFiltrosPopover`: remover o campo "Máx. vendedores"; trocar tipos para `FiltrosAnuncios`; os demais controles ficam (sem a condicional `grupoBDisponivel` — a tabela inteira agora é Apify, D16: ou tem tudo, ou não tem tabela).

NÚCLEO NOVO (queries + composição):

```tsx
export default function PulseSonar() {
  const [termo, setTermo] = useState('');
  const [termoBuscado, setTermoBuscado] = useState<string | null>(null);
  const [, forcarRender] = useState(0);
  const iniciadoEmRef = useRef(0);
  const [anuncioSimulando, setAnuncioSimulando] = useState<AnuncioSimulavel | null>(null);
  const [buscasRecentes, setBuscasRecentes] = useState<BuscaRecente[]>(lerBuscasRecentes);
  const [mostrarProgresso, setMostrarProgresso] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosAnuncios>(FILTROS_ANUNCIOS_VAZIOS);

  // Query PRIMÁRIA (ADR-0127/D3): a tabela nasce da Apify. retry desligado — cada tentativa
  // sem cache dispara um run pago (US$ 0,10).
  const { data: vendas, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['pulse', 'sonar-vendas', termoBuscado],
    queryFn: () => fetchVendasSonar(termoBuscado!),
    enabled: !!termoBuscado,
    staleTime: Infinity,
    retry: false,
  });

  const itens = useMemo(
    () => (vendas?.configurado ? itensDaAmostra(vendas) : []),
    [vendas],
  );
  const itemIds = useMemo(
    () => itens.map((i) => i.item_id).filter((x): x is string => x != null),
    [itens],
  );

  // Visitas (D3): dispara quando a lista de anúncios chega. Grátis (API oficial) — retry ok.
  const { data: visitas, isFetching: visitasCarregando } = useQuery({
    queryKey: ['pulse', 'sonar-visitas', termoBuscado],
    queryFn: () => fetchVisitasSonar(itemIds),
    enabled: itemIds.length > 0,
    staleTime: Infinity,
    retry: 1,
  });

  // D8: entrada ausente/null = "—" (falha ou sem conexão); {total: 0} = "0" (zero medido).
  const visitasPorItem = useMemo(() => {
    const map = new Map<string, VisitasAnuncio | null>();
    if (visitas?.conectado) {
      for (const [id, v] of Object.entries(visitas.por_item)) map.set(id, v);
    }
    return map;
  }, [visitas]);

  const visitasTotal = useMemo(() => {
    // LOUD: soma só o medido; nada medido → null, nunca 0.
    const medidos = [...visitasPorItem.values()].filter((v): v is VisitasAnuncio => v != null);
    return medidos.length > 0 ? medidos.reduce((a, v) => a + v.total, 0) : null;
  }, [visitasPorItem]);

  const carregando = isFetching || visitasCarregando;
  const { visiveis, excluidasSemDado } = useMemo(
    () => aplicarFiltrosAnuncios(itens, visitasPorItem, filtros),
    [itens, visitasPorItem, filtros],
  );
  // ... useEffect do stepper, garimpar(), buscar() — INALTERADOS ...
```

COLUNAS (10, spec seção "A tabela"; sem `defaultSort` — a ordem de chegada É a posição):

```tsx
  const colunas = useMemo<Column<ItemVendasSonar>[]>(() => [
    {
      key: 'posicao', header: '#', className: 'tabular-nums',
      cell: (i) => (
        <div>
          {i.posicao != null ? `#${i.posicao}` : <span title="Posição não veio na amostra">—</span>}
          {i.patrocinado === true && <Badge variant="outline" className="ml-1 text-[10px]">Patrocinado</Badge>}
        </div>
      ),
      sortValue: (i) => i.posicao,
    },
    {
      key: 'anuncio', header: 'Anúncio', className: 'max-w-xs',
      cell: (i) => (
        <div className="flex max-w-xs items-center gap-2">
          {i.imagem && <img src={i.imagem} alt="" className="h-9 w-9 shrink-0 rounded bg-white object-contain" />}
          <div className="min-w-0">
            <span className="block truncate" title={i.titulo}>{i.titulo}</span>
            {(i.selo || i.catalog_product_id) && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {i.selo && <Badge variant="secondary" className="text-[10px]">{i.selo}</Badge>}
                {i.catalog_product_id && (
                  <Badge variant="outline" className="text-[10px]" title={`Anúncio vinculado à ficha ${i.catalog_product_id}`}>
                    Catálogo
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      ),
      sortValue: (i) => i.titulo,
    },
    {
      key: 'preco', header: 'Preço', className: 'tabular-nums',
      cell: (i) => {
        if (i.preco == null) return '—';
        return (
          <div>
            <span className="font-medium">{fmtBRL(i.preco)}</span>
            {i.preco_anterior != null && i.desconto_pct != null && (
              <div className="text-xs text-muted-foreground">
                de <span className="line-through">{fmtBRL(i.preco_anterior)}</span> · {i.desconto_pct}% OFF
              </div>
            )}
          </div>
        );
      },
      sortValue: (i) => i.preco,
    },
    {
      key: 'vendidos', header: 'Vendidos (acum.)', className: 'tabular-nums',
      cell: (i) => i.vendidos == null
        ? <span title="O ML não exibe o dado para este anúncio">—</span>
        : <span title="Acumulado da vida do anúncio, faixa piso do ML — não é ritmo">+{fmtMilhar(i.vendidos)}</span>,
      sortValue: (i) => i.vendidos,
    },
    {
      key: 'faturamento', header: 'Faturamento (acum.)', className: 'tabular-nums',
      cell: (i) => i.vendidos == null || i.preco == null
        ? <span title="Sem vendidos ou preço — não derivamos">—</span>
        : <span title="≈ vendidos × preço atual — o preço pode ter variado ao longo da vida">≈ {fmtBRL(i.vendidos * i.preco)}</span>,
      sortValue: (i) => (i.vendidos != null && i.preco != null ? i.vendidos * i.preco : null),
    },
    {
      key: 'avaliacao', header: 'Avaliação', className: 'tabular-nums',
      cell: (i) => i.avaliacao_nota == null ? '—' : (
        <div>
          <span>★ {i.avaliacao_nota.toFixed(1)}</span>
          {i.avaliacao_qtd != null && <div className="text-xs text-muted-foreground">({i.avaliacao_qtd})</div>}
        </div>
      ),
      sortValue: (i) => i.avaliacao_nota,
    },
    {
      key: 'visitas', header: 'Visitas (30d)', className: 'tabular-nums',
      cell: (i) => {
        const v = i.item_id != null ? visitasPorItem.get(i.item_id) ?? null : null;
        // D8: null = falha/sem conexão → "—"; {total: 0} = ZERO MEDIDO → "0".
        if (v == null) return <span title="Não medido (falha ou organização sem conexão ML)">—</span>;
        return (
          <div className="flex items-center gap-2">
            <span>{fmtInt(v.total)}</span>
            <Sparkline dados={normalizarSerieVisitas(v.por_dia)} />
          </div>
        );
      },
      sortValue: (i) => (i.item_id != null ? visitasPorItem.get(i.item_id)?.total ?? null : null),
    },
    {
      key: 'vendedor', header: 'Vendedor', className: 'text-xs',
      cell: (i) => (
        <div className="flex items-center gap-1">
          {i.vendedor ?? <span title="A amostra não identifica o vendedor deste anúncio (cobertura ~65%)">—</span>}
          {i.loja_oficial === true && <Badge variant="secondary">Oficial</Badge>}
        </div>
      ),
      sortValue: (i) => i.vendedor,
    },
    {
      key: 'envio', header: 'Envio', className: 'text-xs',
      cell: (i) => {
        const label = i.full === true ? 'FULL' : i.flex === true ? 'FLEX' : null;
        return (
          <div className="flex items-center gap-1">
            {label ? <Badge variant="outline">{label}</Badge> : '—'}
            {i.frete_gratis === true && <Truck className="h-3.5 w-3.5 text-info" aria-label="Frete grátis" />}
            {i.internacional === true && <Globe className="h-3.5 w-3.5 text-info" aria-label="Internacional" />}
          </div>
        );
      },
    },
    {
      key: 'acao', header: '',
      cell: (i) => {
        // D15: prioridade ao link da Apify; fallback = URL canônica montada do item_id.
        // A validação browser (Task 14) confirma qual dos dois abre — ajustar a ordem lá se preciso.
        const href = i.link ?? (i.item_id != null
          ? `https://produto.mercadolivre.com.br/MLB-${i.item_id.replace(/^MLB/, '')}`
          : null);
        return (
          <div className="flex items-center justify-end gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setAnuncioSimulando({
              id: i.item_id ?? i.titulo,
              nome: i.titulo,
              category_id: i.category_id ?? null,
              preco_referencia: i.preco,
            })}>
              Simular margem
            </Button>
            {href && (
              <Button asChild variant="ghost" size="icon-sm">
                <a href={href} target="_blank" rel="noopener noreferrer"
                  aria-label={`Abrir "${i.titulo}" no Mercado Livre (nova aba)`} title="Abrir no Mercado Livre">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
          </div>
        );
      },
    },
  ], [visitasPorItem]);
```

RENDER (estados D16 — a tabela dos três modos de falha):

```tsx
      {!termoBuscado ? (
        /* buscas recentes / EmptyState — manter, trocando a descrição do EmptyState para:
           "Varre um nicho do Mercado Livre antes de você cadastrar o produto: os anúncios reais
            da busca, vendas acumuladas, visitas e concorrência. Fonte: amostra dos 20 anúncios
            mais relevantes (via Apify) + visitas da API oficial." */
      ) : mostrarProgresso ? (
        <SonarProgresso passos={passosProgresso(elapsedMs, !carregando)} />
      ) : vendas && !vendas.configurado ? (
        // D16 modo 1: sem APIFY_TOKEN → estado vazio explícito, nada de tabela fantasma.
        <EmptyState
          icon={Search}
          title="O Sonar depende da Apify"
          description={'A tabela de anúncios nasce da amostra Apify. Configure o token '
            + '(variável APIFY_TOKEN no backend) para prospectar. Sem ele não há dado — '
            + 'não mostramos tela vazia fingindo nicho morto.'}
        />
      ) : isError ? (
        // D16 modo 2: run falhou/estourou o teto → erro com termo, causa e retry.
        // NUNCA "0 anúncios encontrados" — mentiria dizendo que o nicho está vazio.
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">
            Não foi possível prospectar “{termoBuscado}”.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro desconhecido.'}
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : vendas?.configurado && itens.length === 0 ? (
        // Run OK mas amostra vazia (raro): erro explícito, mesmo racional do modo 2.
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">A amostra veio vazia para “{termoBuscado}”.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Isso é falha de coleta, não nicho sem anúncios. Busque de novo em instantes.
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>Tentar de novo</Button>
        </div>
      ) : vendas?.configurado ? (
        <>
          <VereditoSonar
            veredito={calcularVereditoAnuncios(vendas, visitasTotal)}
            contexto={contextoNichoAnuncios(vendas)}
          />
          <SonarVendas resp={vendas} carregando={false} erro={false} />
          {/* barra de filtros: mesmo bloco atual, com aplicarFiltrosAnuncios/temFiltroAnunciosAtivo
              e o contador "X de Y anúncios · N sem esse dado" */}
          <DataTable
            columns={colunas}
            rows={visiveis}
            rowKey={(i) => i.item_id ?? `pos-${i.posicao ?? 'x'}-${i.titulo}`}
            empty={
              temFiltroAnunciosAtivo(filtros)
                ? <EmptyState icon={Package} title="Nenhum anúncio passa pelos filtros ativos." />
                : <EmptyState icon={Package} title="Nenhum anúncio na amostra." />
            }
          />
          {/* palavras_chave_titulos: já renderizadas dentro de SonarVendas — o bloco
              "Palavras-chave do nicho" (painel de fichas) morre */}
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      )}

      <DialogMargemSonar ficha={anuncioSimulando} onFechar={() => setAnuncioSimulando(null)} />
```

D16 modo 3 (org sem conexão ML) não tem branch próprio: `visitas` responde `conectado: false`, o mapa fica vazio e TODA célula de Visitas mostra "—" — tabela completa, único modo degradado útil.

- [ ] **Step 2: Adaptar `DialogMargemSonar` (categoria vem do anúncio)**

Em `src/components/pulse/dialog-margem-sonar.tsx`:
- Trocar `interface FichaSimulavel` por (e exportá-la — a página importa o tipo):
```ts
export interface AnuncioSimulavel {
  id: string;                      // item_id do anúncio (ou título, se sem id) — só para reset
  nome: string;
  category_id: string | null;      // produtoCategoryID da Apify (20/20 medido) — sem preditor
  preco_referencia: number | null; // preço atual do anúncio, pré-preenche o alvo
}
```
- Prop continua `ficha: AnuncioSimulavel | null` (renomear só o tipo, não a prop — diff mínimo).
- No `useEffect` de reset: `ficha?.preco?.mediana` vira `ficha?.preco_referencia` (as duas ocorrências: no `setPrecoStr` e no array de deps); `ficha?.product_id` no array de deps vira `ficha?.id`.
- Texto do badge de categoria indisponível: "Categoria indisponível para este anúncio — não é possível simular."
- Nada mais muda: `calcularTarifaML`, alíquotas LOUD e `margemSimulada` ficam como estão.

- [ ] **Step 3: Adaptar `VereditoSonar` (componente)**

Em `src/components/pulse/veredito-sonar.tsx`:
- Prop `veredito` passa de `Veredito` para `VereditoAnuncios` (import de `@/lib/veredito-sonar`).
- Remover o bloco `{veredito.semVendas && (...)}` (linhas ~75-80) — o fallback sem Apify morreu (D16); sem Apify não há veredito nenhum.
- Resto intocado (fatores, marca, "Saiba mais" leem as mesmas interfaces `Fator`/`AlertaMarca`/`Explicacao`).

- [ ] **Step 4: Verificar**

Run: `pnpm lint && npx tsc -b --force && pnpm test`
Expected: tudo verde. Atenção ao tsc: nenhum import morto de `sonar-cruzamento`/símbolos antigos pode sobrar na página.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PulseSonar.tsx src/components/pulse/veredito-sonar.tsx src/components/pulse/dialog-margem-sonar.tsx
git commit -m "feat(sonar): tabela por anúncio — duas queries, estados D16, simulador via category_id (ADR-0127)"
```

---

### Task 11: Deleções — a edge de fichas e todo o código órfão morrem

**Modelo:** sonnet

**Files:**
- Delete: `supabase/functions/pulse-sonar/` (diretório inteiro)
- Delete: `src/lib/sonar-cruzamento.ts`, `src/lib/__tests__/sonar-cruzamento.test.ts`
- Modify: `supabase/config.toml` (remover o bloco `[functions.pulse-sonar]`, linhas ~124-126)
- Modify: `supabase/functions/_shared/pulse/sonar.ts` + `__tests__/sonar.test.ts` (poda)
- Modify: `src/lib/sonar.ts` + `src/lib/__tests__/sonar.test.ts` (poda)
- Modify: `src/lib/veredito-sonar.ts` + `src/lib/__tests__/veredito-sonar.test.ts` (poda do v1)
- Modify: `src/lib/sonar-filtros.ts` + `src/lib/__tests__/sonar-filtros.test.ts` (poda do v1)

**Interfaces:**
- Consumes: Task 10 concluída (a página não importa mais NADA do que morre aqui — pré-condição dura).
- Produces: árvore sem código morto; suíte continua verde no MESMO commit (módulo e testes morrem juntos).

Um commit só: apagar módulo + testes + call sites órfãos juntos mantém `pnpm test` verde em todo ponto da história.

- [ ] **Step 1: Confirmar que nada vivo referencia o que vai morrer**

Run (escopo obrigatório, nunca grep -R sem escopo):
```bash
grep -rn "sonar-cruzamento\|fetchPainelSonar\|fichasAtivas\|fichasSemVendedor" src --include='*.ts' --include='*.tsx'
grep -rn "calcularVeredito\b\|contextoNicho\b" src --include='*.ts' --include='*.tsx'
grep -rn "aplicarFiltros\b\|FILTROS_VAZIOS\|temFiltroAtivo\b\|FiltrosSonar\b" src --include='*.ts' --include='*.tsx'
grep -rn "montarPainelSonar\|parseFichasBusca\|resumoPrecos\|ResultadoFicha\|PainelSonar" src supabase/functions --include='*.ts' --include='*.tsx'
```
Expected: só ocorrências dentro dos próprios arquivos que morrem nesta task (definições e seus testes). Qualquer outra ocorrência = a Task 10 deixou ponta solta; corrigir LÁ antes de apagar. ATENÇÃO: `parseVisitasJanela`, `extrairPalavrasChave` (usados por `pulse-coletar/processar.ts` e `sonar-vendas.ts`) e `ufDoVendedor` (Radar) NÃO morrem.

- [ ] **Step 2: Apagar**

```bash
git rm -r supabase/functions/pulse-sonar
git rm src/lib/sonar-cruzamento.ts src/lib/__tests__/sonar-cruzamento.test.ts
```
Podas (remover definição + testes correspondentes, nada além):
- `supabase/config.toml`: bloco `[functions.pulse-sonar]` e seu comentário.
- `supabase/functions/_shared/pulse/sonar.ts`: `FichaBusca`, `parseFichasBusca`, `resumoPrecos`, `ResultadoFicha`, `PainelSonar`, `montarPainelSonar`. Ficam: `VisitasJanela`, `parseVisitasJanela`, `extrairPalavrasChave`, `validarItemIds`.
- `supabase/functions/_shared/pulse/__tests__/sonar.test.ts`: describes de `montarPainelSonar`/`parseFichasBusca`/`resumoPrecos`.
- `src/lib/sonar.ts`: `ResultadoFichaSonar`, `PainelSonar`, `fetchPainelSonar`, `fichasAtivas`, `fichasSemVendedor`.
- `src/lib/__tests__/sonar.test.ts`: describe de `fichasAtivas / fichasSemVendedor`.
- `src/lib/veredito-sonar.ts`: `calcularVeredito`, `contextoNicho`, `nivelDemanda`, `nivelDemandaPorVisitas`, `nivelDisputa`, `nivelTracao`, `alertaMarca`, `fraseDemandaVisitas`, `destravarDemandaVisitas`, `fraseDisputa`, `destravarDisputa`, `fraseTracao`, `destravarTracao`, constantes `DISPUTA`, `TRACAO`, `VISITAS`, e o campo `semVendas` da interface `Veredito` (a interface antiga inteira morre se nada mais a usar). Ficam: tudo que o v2 reusa (`fraseDemanda`, `destravarDemanda`, `fraseMarca`, `destravarMarca`, `montarMotivo`, `regua`, `TITULOS`, `ACAO`, `PONTOS`, `pct`, `brlMil`, `DEMANDA`, `MARCA`, tipos de explicação) e todo o bloco v2.
- `src/lib/__tests__/veredito-sonar.test.ts`: describes do gabarito v1 (os que montam `PainelSonar`).
- `src/lib/sonar-filtros.ts`: `FiltrosSonar`, `FILTROS_VAZIOS`, `temFiltroAtivo`, `aplicarFiltros`, `type Ficha` e o import de `VendasFicha`/`PainelSonar`.
- `src/lib/__tests__/sonar-filtros.test.ts`: describes do `aplicarFiltros` v1.

- [ ] **Step 3: Verificar**

Run: `pnpm lint && npx tsc -b --force && pnpm test`
Expected: tudo verde; nenhum import quebrado.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(sonar): remove edge de fichas, cruzamento e código v1 do veredito/filtros (ADR-0127)"
```

---

### Task 12: Documentação

**Modelo:** sonnet

**Files:**
- Modify: `docs/reference/edge-functions.md` (remover `pulse-sonar`; adicionar `pulse-sonar-visitas`; atualizar `pulse-sonar-vendas` — gravação de snapshot + `historico_gravado`)
- Modify: `docs/reference/modelo-de-dados.md` (tabela `sonar_snapshots`: colunas, unique, RLS global-com-leitura-autenticada, semântica D13 do delta)
- Modify: `docs/TASKS.md` (registrar a entrega)
- Modify: `obsidian-vault/06-Roadmap/Sprint Atual.md` (Sonar por anúncio entregue) e a nota de arquitetura do Pulse/Sonar no vault, se citar a pulse-sonar de fichas

**Interfaces:**
- Consumes: tudo entregue (Tasks 1-11).
- Produces: docs coerentes com o código — regra de conclusão do CLAUDE.md (mesmo ciclo da entrega).

- [ ] **Step 1: Atualizar os quatro alvos**

Conteúdo mínimo por arquivo (não copiar a spec; referenciar o ADR-0127):
- `edge-functions.md`: entrada da `pulse-sonar-visitas` (POST `{item_ids}`, teto 20, cache `sonar:visitas:v1:{item_id}` TTL 24h, `conectado:false` sem conexão ML); na `pulse-sonar-vendas`, o efeito de gravação em `sonar_snapshots` no cache-miss e o campo `historico_gravado` fora do cache; remoção da seção da `pulse-sonar`.
- `modelo-de-dados.md`: `sonar_snapshots` com a nota "global sem org_id (dado público, ADR-0120 §3/ADR-0127); escrita só service_role; `vendidos` é faixa-piso — delta entre snapshots é PISO do período (D13)".
- `TASKS.md`: linha da entrega com data e ADR.
- Obsidian: Sprint Atual + qualquer nota que descreva o Sonar de fichas.

- [ ] **Step 2: Conferir que não sobrou referência à edge morta nos docs**

Run: `grep -rn "pulse-sonar\b" docs obsidian-vault --include='*.md' | grep -v "pulse-sonar-vendas\|pulse-sonar-visitas" | grep -v "docs/decisions\|docs/superpowers"`
Expected: vazio (ADRs e specs/planos são registro histórico — não reescrever).

- [ ] **Step 3: Commit**

```bash
git add docs/reference/edge-functions.md docs/reference/modelo-de-dados.md docs/TASKS.md obsidian-vault
git commit -m "docs: Sonar por anúncio — edge-functions, modelo de dados e vault (ADR-0127)"
```

---

### Task 13: Deploy das edges (rollout, spec seção Rollout)

**Modelo:** sonnet

**Files:** nenhum (operacional). Pré-condições: Task 2 aplicada no banco (já foi, via db push); Tasks 4, 5 e 11 commitadas.

- [ ] **Step 1: Deploy na ordem da spec**

```bash
supabase functions deploy pulse-sonar-vendas
supabase functions deploy pulse-sonar-visitas
supabase functions delete pulse-sonar
supabase functions list
```
Expected: `pulse-sonar-vendas` e `pulse-sonar-visitas` com versão nova (conferir o número contra o anterior — regra "conferir versão pós-deploy"); `pulse-sonar` ausente da lista.

- [ ] **Step 2: Smoke de produção (barato)**

Com o JWT da conta VALIDATION (mesmo login da Task 7):
1. `pulse-sonar-vendas` com termo já cacheado (`abraçadeira nylon` ou um dos 3 gabaritos) → 200 com `historico_gravado: false` (cache hit NUNCA grava — D7) e o shape v4 intacto.
2. `pulse-sonar-visitas` com 2 item_ids do fixture → `conectado` + `por_item` (ou `conectado: false`, se a org VALIDATION não tiver conexão ML — também é resposta válida).
3. Conferir gravação real: o PRÓXIMO cache-miss orgânico gravará; não forçar um run pago só para isso — a validação da Task 14 cobre com dado injetado, e a query `select count(*) from sonar_snapshots;` (Management API, read-only) confirma quando o primeiro garimpo fresco acontecer.

- [ ] **Step 3: Caches**

Nada a fazer: `sonar:v3:*` fica órfão e expira sozinho em ≤24h; `sonar:vendas:v4` segue válido (sem bump, D5); `sonar:visitas:v1` já vem sendo populada desde a Task 7. Registrar no relatório da task que NENHUMA chave foi apagada à mão.

---

### Task 14: Validação em browser + gate final

**Modelo:** sonnet

**Files:** nenhum de produção (screenshots/relatório da validação).

- [ ] **Step 1: Validação runtime (skill playwright-cli, sessão isolada — nunca o Chrome do Diego)**

Invocar a skill `playwright-cli`. Login com a conta VALIDATION. A org dela não tem os dados do Diego: injetar payloads via `route` + `reload` (senão o react-query serve cache — memória de validação). Injetar o fixture `tecido-oxford-10-metros.json` como resposta de `pulse-sonar-vendas` e uma resposta sintética de `pulse-sonar-visitas` cobrindo os três estados de célula. Verificar com SCREENSHOT REAL (snapshot de acessibilidade não pega bug de layout — memória 2026-08):
- Tabela com as 10 colunas, sem scroll horizontal no body da página (só no wrapper da tabela);
- Coluna Visitas nos 3 estados: número, "0" (zero medido) e "—" (null) — D8;
- Sparkline de um item com a série de 7 pontos embaralhados → desenho de 30 dias ordenado — D9;
- Selo "Catálogo" e badge "Patrocinado" nas linhas certas;
- Estados D16: rota com `configurado:false` → empty state da Apify; rota com 502 → erro com retry;
- Veredito do oxford = "Oportunidade alta" na tela (bate com o teste do gabarito);
- Dialog "Simular margem" abre com preço pré-preenchido e categoria do anúncio.

- [ ] **Step 2: Links do anúncio (D15 — só se valida logado)**

No browser da validação, abrir 2-3 `href` reais da coluna Ações (do fixture). Sem sessão ML o esperado é cair em `/gz/account-verification` (anti-bot, não link quebrado). Se cair: registrar no relatório e pedir ao Diego UM clique de teste na sessão logada dele (leitura, nunca escrita). Se o `/up/MLBU…` não abrir nem logado e a URL canônica abrir: inverter a prioridade do `href` na coluna Ações (`PulseSonar.tsx`, coluna `acao`) — fallback já previsto em D15 — em commit próprio.

- [ ] **Step 3: Gate final**

Run: `pnpm lint && pnpm test && npx tsc -b --force`
Expected: tudo verde (3521+ testes, os novos inclusos).

- [ ] **Step 4: Relatório e entrega**

Relatar a Diego: o que foi validado (com screenshots), o resultado dos links D15, custo total gasto (US$ 0,30 da Task 7), e as pendências de decisão dele (re-garimpo agendado semanal a US$ 0,10/termo — follow-up da spec). Push da branch com CI verde. **Merge na main, deleção da branch/worktree e `git pull` na main local seguem o fluxo padrão (finishing-a-development-branch) mediante OK do Diego** — não fazem parte deste plano.

---

## Mapa de cobertura D → Task (para conferência)

| Decisão da spec | Task(s) |
|---|---|
| D1 — unidade = anúncio; catálogo vira selo | 10 (tabela + selo "Catálogo") |
| D2 — API oficial reduzida a visitas | 5 (edge nova), 11 (morte das chamadas de fichas) |
| D3 — vendas primária + visitas fina + pulse-sonar deletada | 4, 5, 10 (composição), 11 (delete), 13 (deploy/delete) |
| D4 — amostra 20 / US$ 0,10 inalterada | Global Constraints (client.ts intocado; conferido no Step 1 da Task 13 — nenhuma edge nova toca TETO_USD) |
| D5 — cache v4 sem bump | 4 (chave intocada), Global Constraints |
| D6 — visitas chave própria TTL 24h | 5 |
| D7 — histórico no cache-miss; historico_gravado fora do cache | 3 (linhasSnapshot), 4 (gravação + hit=false) |
| D8 — zero medido ≠ ausência | 5 (edge), 6 (tipos/comentários), 9 (filtro), 10 (célula), 14 (validação visual) |
| D9 — sparkline ordenado/preenchido + refutação idade | 6 (normalizarSerieVisitas), 10 (uso), 14 (validação visual) |
| D10 — trava de cobertura <50% | 8 |
| D11 — métricas invariantes; cortes antigos inválidos; DISPUTA_V2/TRACAO_V2 | 7 (medição), 8 (implementação), 11 (morte das constantes antigas) |
| D12 — recalibração medida, US$ 0,30, aceite média/média/alta, contingência | 7, 8 |
| D13 — delta de faixas = PISO | 2 (comentário na coluna), 3 (número cru no snapshot), 12 (modelo-de-dados.md) |
| D14 — rollout de uma vez, sem flag | 10 (troca única), 13 (ordem de deploy) |
| D15 — link validado no browser, fallback canônico | 10 (href com fallback), 14 (validação logada) |
| D16 — sem Apify não há tabela; fallback do ADR-0124 §6 removido | 8 (veredito sem fallback), 10 (3 estados de falha), 11 (morte de nivelDemandaPorVisitas) |

Cobertura da tabela "Arquivos" da spec: todas as linhas têm task (ver File Structure). Extras deste plano não listados na spec: `scripts/sonar-gabarito-fixtures.mjs` + fixtures (instrumento da medição D12) e `docs/TASKS.md` (regra de conclusão do CLAUDE.md).
