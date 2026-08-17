# Pulse Sonar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba "Sonar" no menu Pulse: o operador digita um termo, o sistema garimpa o nicho via API oficial do ML (fichas de catálogo, preços, vendedores, visitas, ranking, termos em alta) e simula margem — decisão de sortimento antes de cadastrar. De quebra, o Radar ganha a coluna "Visitas 30d".

**Architecture:** Edge function nova `pulse-sonar` (chamada pelo frontend, `verify_jwt=true`) orquestra ~40–60 GETs à API do ML com cache Redis global de 24h por termo; parsers puros em `_shared/pulse/sonar.ts` (testáveis sem rede); frontend adiciona Tabs ao `Pulse.tsx` com a tela nova `PulseSonar.tsx` (progresso por etapas durante a busca). Coluna de visitas no Radar = migration + 1 chamada por oferta no `pulse-coletar`.

**Tech Stack:** Deno edge functions, Redis (`_shared/redis/client.ts`), React + shadcn (Tabs, Card, Table), vitest.

**Spec:** `docs/decisions/0120-pulse-sonar-garimpo-por-termo.md` (+ ADR-0119 e erratas — ler antes).

## Global Constraints

- Regra LOUD (ADR-0055 / memória do projeto): nenhum número financeiro ou de venda defaultado em silêncio. Custo hipotético e origem (NACIONAL/IMPORTADO) são **inputs obrigatórios** do simulador; sem eles, não simula.
- Não existe vendas exatas de terceiro: rotular demanda como "visitas" e "transações do vendedor (todas as categorias, vitalício)". Nunca escrever "vendas" a seco em rótulo de terceiro.
- Nada de escrita na API do ML — o Sonar é 100% leitura.
- Edge functions idempotentes; `pulse-sonar` entra no `supabase/config.toml` com `verify_jwt = true`.
- Validação antes de reportar pronto: `pnpm test`, `pnpm lint`, `pnpm build` (CI exige; testes sozinhos não bastam), e para a migration `npm run db:check` + `supabase db push` (worktree novo exige `supabase link` antes — ver reference_sql_e_migration_sem_mcp).
- Deploy de edge alterada é parte da entrega (`supabase functions deploy <fn> --project-ref txvncrgkoynoxwopfkbp`), inclusive redeploy das funções que importam `_shared/pulse/` se ele mudar (`pulse-adicionar`, `pulse-coletar`).

---

### Task 1: Parsers puros do Sonar (`_shared/pulse/sonar.ts`)

**Files:**
- Create: `supabase/functions/_shared/pulse/sonar.ts`
- Test: `supabase/functions/_shared/pulse/__tests__/sonar.test.ts`

**Interfaces:**
- Consumes: nada (funções puras JSON→tipos).
- Produces:
  - `parseFichasBusca(json: unknown): FichaBusca[]` com `FichaBusca = { product_id: string; nome: string; domain_id: string | null }`
  - `parseVisitasJanela(json: unknown): VisitasJanela | null` com `VisitasJanela = { total: number; por_dia: Array<{ data: string; total: number }> }`
  - `extrairPalavrasChave(nomes: string[], limite?: number): Array<{ termo: string; contagem: number }>`
  - `resumoPrecos(precos: number[]): { min: number; mediana: number; max: number } | null`

- [ ] **Step 1: Escrever os testes que falham**

```ts
// supabase/functions/_shared/pulse/__tests__/sonar.test.ts
import { describe, expect, it } from 'vitest';
import { extrairPalavrasChave, parseFichasBusca, parseVisitasJanela, resumoPrecos } from '../sonar.ts';

describe('parseFichasBusca', () => {
  it('extrai id/nome/domain e ignora entradas sem id', () => {
    const json = { results: [
      { id: 'MLB60128399', name: 'Tecido Oxford Liso 10m', domain_id: 'MLB-FABRICS' },
      { name: 'sem id' },
    ] };
    expect(parseFichasBusca(json)).toEqual([
      { product_id: 'MLB60128399', nome: 'Tecido Oxford Liso 10m', domain_id: 'MLB-FABRICS' },
    ]);
  });
  it('devolve [] para corpo inválido', () => {
    expect(parseFichasBusca(null)).toEqual([]);
    expect(parseFichasBusca({})).toEqual([]);
  });
});

describe('parseVisitasJanela', () => {
  it('extrai total e série diária', () => {
    const json = { total_visits: 42, results: [
      { date: '2026-07-30T00:00:00Z', total: 2 },
      { date: '2026-08-08T00:00:00Z', total: 5 },
    ] };
    expect(parseVisitasJanela(json)).toEqual({ total: 42, por_dia: [
      { data: '2026-07-30', total: 2 },
      { data: '2026-08-08', total: 5 },
    ] });
  });
  it('null quando o corpo não tem total_visits numérico', () => {
    expect(parseVisitasJanela({ message: 'forbidden' })).toBeNull();
  });
});

describe('extrairPalavrasChave', () => {
  it('conta termos normalizados sem stopwords e respeita o limite', () => {
    const nomes = ['Tecido Oxford Liso 10m', 'Tecido Oxford Estampado', 'Rolo de Tecido'];
    const r = extrairPalavrasChave(nomes, 2);
    expect(r[0]).toEqual({ termo: 'tecido', contagem: 3 });
    expect(r[1]).toEqual({ termo: 'oxford', contagem: 2 });
    expect(r).toHaveLength(2);
  });
});

describe('resumoPrecos', () => {
  it('min/mediana/max com mediana de lista par = média dos centrais', () => {
    expect(resumoPrecos([10, 30, 20, 40])).toEqual({ min: 10, mediana: 25, max: 40 });
  });
  it('null para lista vazia', () => {
    expect(resumoPrecos([])).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test -- sonar` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `sonar.ts`**

```ts
// supabase/functions/_shared/pulse/sonar.ts
// Parsers puros do Sonar (ADR-0120). Fontes: /products/search, /items/{id}/visits/time_window.
// Nenhuma chamada de rede aqui — a edge function orquestra, isto só interpreta.

export interface FichaBusca { product_id: string; nome: string; domain_id: string | null }
export interface VisitasJanela { total: number; por_dia: Array<{ data: string; total: number }> }

export function parseFichasBusca(json: unknown): FichaBusca[] {
  const results = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: FichaBusca[] = [];
  for (const r of results) {
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.name !== 'string') continue;
    out.push({ product_id: o.id, nome: o.name, domain_id: typeof o.domain_id === 'string' ? o.domain_id : null });
  }
  return out;
}

export function parseVisitasJanela(json: unknown): VisitasJanela | null {
  const d = json as { total_visits?: unknown; results?: unknown[] } | null;
  if (typeof d?.total_visits !== 'number') return null;
  const por_dia = (Array.isArray(d.results) ? d.results : [])
    .map((r) => {
      const o = r as Record<string, unknown>;
      if (typeof o.date !== 'string' || typeof o.total !== 'number') return null;
      return { data: o.date.slice(0, 10), total: o.total };
    })
    .filter((x): x is { data: string; total: number } => x !== null);
  return { total: d.total_visits, por_dia };
}

const STOPWORDS = new Set(['de', 'do', 'da', 'para', 'com', 'em', 'e', 'o', 'a', 'un', 'kit', 'cm', 'mm']);

export function extrairPalavrasChave(nomes: string[], limite = 20): Array<{ termo: string; contagem: number }> {
  const contagem = new Map<string, number>();
  for (const nome of nomes) {
    const vistos = new Set<string>();
    for (const bruto of nome.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      const termo = bruto.trim();
      if (termo.length < 3 || STOPWORDS.has(termo) || vistos.has(termo)) continue;
      vistos.add(termo); // conta por ficha, não por repetição no mesmo nome
      contagem.set(termo, (contagem.get(termo) ?? 0) + 1);
    }
  }
  return [...contagem.entries()]
    .map(([termo, n]) => ({ termo, contagem: n }))
    .sort((a, b) => b.contagem - a.contagem || a.termo.localeCompare(b.termo))
    .slice(0, limite);
}

export function resumoPrecos(precos: number[]): { min: number; mediana: number; max: number } | null {
  if (precos.length === 0) return null;
  const s = [...precos].sort((a, b) => a - b);
  const meio = Math.floor(s.length / 2);
  const mediana = s.length % 2 === 1 ? s[meio] : (s[meio - 1] + s[meio]) / 2;
  return { min: s[0], mediana, max: s[s.length - 1] };
}
```

- [ ] **Step 4: Rodar e ver passar** — `pnpm test -- sonar` → PASS. `pnpm lint`.
- [ ] **Step 5: Commit** — `git add supabase/functions/_shared/pulse/sonar.ts supabase/functions/_shared/pulse/__tests__/sonar.test.ts && git commit -m "feat(sonar): parsers puros do garimpo por termo (ADR-0120)"`

---

### Task 2: Verificação empírica de `category_id` da ficha

**Files:** nenhum (verificação com token real; anexar resultado no PR/commit message da Task 3).

A tarifa (`calcular-tarifa-ml` exige `categoria_ml_id`), o `/highlights` e o `/trends` precisam da categoria da ficha. `/products/search` devolve `domain_id`, não categoria.

- [ ] **Step 1:** Obter token: `select access_token from get_connection_tokens('085fd9d3-a3dd-439c-a482-5ad24459a30a'::uuid)` via Management API (receita em `reference_sql_e_migration_sem_mcp`; token expira em ~6h, reobter se 401).
- [ ] **Step 2:** `curl -s "https://api.mercadolibre.com/products/{id_da_busca}" -H "Authorization: Bearer $TOK"` para 3 fichas de `/products/search?q=tecido+oxford+10+metros` e registrar se `category_id` vem no corpo.
- [ ] **Step 3:** Decisão condicional, a registrar como nota no plano antes da Task 3:
  - `category_id` presente → a edge busca `/products/{id}` (1 chamada extra por ficha) e o painel ganha tarifa + highlights + trends.
  - Ausente → v1 sai **sem** highlights/trends/tarifa por ficha; o simulador de margem pede também a categoria (o operador escolhe via a busca de categoria já existente no fluxo de Revisão). Não inventar mapeamento domain→categoria.

---

### Task 3: Edge function `pulse-sonar`

**Files:**
- Create: `supabase/functions/pulse-sonar/index.ts`
- Modify: `supabase/config.toml` (bloco novo)
- Test: coberto pelos parsers da Task 1 + teste de contrato do agregado em `supabase/functions/_shared/pulse/__tests__/sonar.test.ts` (função `montarPainelSonar` adicionada em `sonar.ts`)

**Interfaces:**
- Consumes: `parseFichasBusca`, `parseVisitasJanela`, `extrairPalavrasChave`, `resumoPrecos` (Task 1); `parseOfertasProduto` e `ofertasNaoLidas` de `_shared/pulse/parse.ts`; `ufDoVendedor` de `_shared/pulse/vendedor.ts`; `requireUserOrg` (`_shared/auth.ts`), `resolverConexao` (`_shared/canais/conexao.ts`), `getValidAccessTokenConexao` (`_shared/ml/token.ts`), `redisGet`/`redisSet` (`_shared/redis/client.ts`).
- Produces: `POST /functions/v1/pulse-sonar` body `{ termo: string }` → `200 PainelSonar`:

```ts
// adicionado a _shared/pulse/sonar.ts na mesma task
export interface PainelSonar {
  termo: string;
  gerado_em: string;           // ISO; vem do cache quando cacheado
  total_catalogo: number;      // paging.total da busca
  fichas: Array<{
    product_id: string;
    nome: string;
    category_id: string | null; // null se Task 2 concluir "ausente"
    ofertas: number;            // results da ficha (+ ofertas_nao_lidas se paging.total > lidas)
    preco: { min: number; mediana: number; max: number } | null;
    frete_gratis_pct: number;   // 0..100, sobre as ofertas lidas
    visitas_30d: number | null; // null = endpoint falhou p/ este item (não é zero)
    visitas_por_dia: Array<{ data: string; total: number }>;
    vendedores: Array<{ seller_id: number; uf: string | null; transacoes_total: number | null; loja_oficial: boolean }>;
  }>;
  agregado: {
    visitas_30d_total: number;
    visitas_por_dia: Array<{ data: string; total: number }>; // soma das fichas
    ofertas_total: number;
    vendedores_distintos: number;
    frete_gratis_pct: number;
  };
  palavras_chave: Array<{ termo: string; contagem: number }>;
}
```

- [ ] **Step 1: Teste do agregador puro `montarPainelSonar`** (soma séries por data, % frete grátis, vendedores distintos — 1 teste com 2 fichas sintéticas cobrindo `visitas_30d: null` não somado como zero e datas desalinhadas entre fichas).
- [ ] **Step 2: Rodar e ver falhar**, implementar `montarPainelSonar` em `sonar.ts`, ver passar.
- [ ] **Step 3: Implementar a edge** — esqueleto (espelha `pulse-adicionar`: auth → conexão → token → trabalho → json):

```ts
// supabase/functions/pulse-sonar/index.ts
// Sonar (ADR-0120): garimpo on-demand por termo. Só leitura; cache global 24h.
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { parseOfertasProduto, ofertasNaoLidas } from '../_shared/pulse/parse.ts';
import { ufDoVendedor } from '../_shared/pulse/vendedor.ts';
import { montarPainelSonar, parseFichasBusca, parseVisitasJanela } from '../_shared/pulse/sonar.ts';

const FICHAS_POR_BUSCA = 20;      // ponytail: teto fixo; paginação "carregar mais" quando provar demanda
const CACHE_TTL_S = 24 * 60 * 60; // dado público; chave global sem org_id (ADR-0120 §3)
const normalizarTermo = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');

Deno.serve(async (req) => {
  // CORS/OPTIONS igual às demais funções chamadas pelo frontend
  try { await requireUserOrg(req, { access: 'read' }); } catch (e) { /* 401 padrão */ }
  const { termo } = await req.json().catch(() => ({}));
  if (typeof termo !== 'string' || normalizarTermo(termo).length < 3) {
    return json({ erro: 'termo obrigatório (mínimo 3 caracteres)' }, 400);
  }
  const chave = `sonar:v1:MLB:${normalizarTermo(termo)}`;
  const cacheado = await redisGet(chave);
  if (cacheado) return json(JSON.parse(cacheado));

  const admin = adminClient();
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao) return json({ erro: 'Conecte o Mercado Livre antes de usar o Sonar.' }, 400);
  const token = await getValidAccessTokenConexao(conexao);

  // 1) fichas do termo
  const busca = await mlGet(`/products/search?status=active&site_id=MLB&q=${encodeURIComponent(termo)}&limit=${FICHAS_POR_BUSCA}`, token);
  const fichas = parseFichasBusca(busca);
  // 2) por ficha, em paralelo com teto de concorrência 5 (não estourar rate limit):
  //    /products/{id}/items (ofertas) → parseOfertasProduto(json)  [excluirSellerId: NÃO excluir — no
  //    garimpo a nossa oferta também é mercado]
  //    /items/{item_id_da_oferta_mais_barata}/visits/time_window?last=30&unit=day → parseVisitasJanela
  //    /users/{seller_id} (distintos, com cache local por seller na request) → ufDoVendedor + transactions.total
  //    [se Task 2 = presente] /products/{id} → category_id
  // Falha em UMA ficha não derruba a busca: ficha entra com visitas_30d: null e segue.
  const painel = montarPainelSonar(termo, busca, resultadosPorFicha);
  await redisSet(chave, JSON.stringify(painel), CACHE_TTL_S);
  return json(painel);
});
```

  O executor preenche `mlGet` (fetch com `Authorization: Bearer` + tratamento de status ≠200 → null) e o loop com `Promise.allSettled` em lotes de 5. **Visitas: 1 chamada por item** (multiget testado em 17/08: `maximum amount of items to query is 1`). Medir a visita do **item mais barato** de cada ficha (proxy do ganhador da ficha), não de todas as ofertas — mantém ~40–60 chamadas por garimpo.
- [ ] **Step 4:** `supabase/config.toml`: adicionar `[functions.pulse-sonar]` com `verify_jwt = true`.
- [ ] **Step 5:** `pnpm test`, `pnpm lint`, `pnpm build`.
- [ ] **Step 6: Deploy + prova real** — `supabase functions deploy pulse-sonar --project-ref txvncrgkoynoxwopfkbp`; conferir versão e `verify_jwt` pós-deploy; `curl` autenticado com `{"termo":"tecido oxford 10 metros"}` e conferir o shape do `PainelSonar` (e o hit de cache na 2ª chamada, latência <1s).
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(sonar): edge pulse-sonar com cache 24h (ADR-0120)"`

---

### Task 4: Frontend — aba Sonar no Pulse

**Files:**
- Modify: `src/pages/Pulse.tsx` (envolver o conteúdo atual em `<Tabs defaultValue="radar">` com `TabsTrigger` "Radar" e "Sonar")
- Create: `src/pages/PulseSonar.tsx` (tela), `src/lib/sonar.ts` (tipos `PainelSonar` espelhados + fetch + helpers de exibição)
- Test: `src/lib/__tests__/sonar.test.ts`

**Interfaces:**
- Consumes: `POST /functions/v1/pulse-sonar` `{ termo }` → `PainelSonar` (Task 3). `calcular-tarifa-ml` (`{ preco, categoria_ml_id }` → tarifa clássico/premium + frete) para o simulador. Alíquota por origem: mesmo resolver da Viabilidade (`montarAliquotaResolver`/`useAliquotas` — ver `reference_markup_padrao_e_testes_mortos`).
- Produces: rota já existente `#/pulse` com aba `?tab=sonar`.

Comportamentos obrigatórios (do grilling de 17/08):

1. **Texto explicativo na entrada da aba** (estado vazio, antes da 1ª busca): o que o Sonar faz
   ("varre um nicho do Mercado Livre antes de você cadastrar o produto") e os limites do dado
   ("só produtos com ficha de catálogo; demanda medida por visitas — o ML não expõe vendas de
   terceiros"). Texto fixo no componente, não tooltip.
2. **Progresso por etapas durante a busca** (pedido do Diego em 17/08 — a busca leva segundos e a
   tela não pode parecer travada): stepper animado com 4 etapas — "Buscando fichas do catálogo",
   "Analisando concorrentes", "Medindo visitas", "Montando painel". A edge responde numa chamada
   única, então o avanço é **temporizado no cliente** (ex.: avança a cada 2,5s até a 3ª etapa e
   trava nela) e a 4ª etapa só completa quando a resposta chega; resposta cacheada (<1s) pula
   direto ao resultado. Componente `SonarProgresso` com os passos e um spinner no passo ativo —
   sem barra de % falsa (não prometemos números que não medimos).
3. **Painel:** KPIs (visitas 30d totais, nº de fichas/`total_catalogo`, ofertas totais, vendedores
   distintos, % frete grátis) + gráfico de visitas por dia (mesmo componente de gráfico usado no
   app; se não houver, `recharts` AreaChart simples) + tabela de fichas (nome, ofertas, faixa de
   preço, visitas 30d, vendedores/UF) + nuvem de `palavras_chave` (badges com contagem).
4. **Simulador de margem** (Dialog por ficha): inputs obrigatórios custo hipotético (R$) e origem
   (`NACIONAL`/`IMPORTADO`, sem default — LOUD); preço alvo pré-preenchido com a mediana da ficha,
   editável; chama `calcular-tarifa-ml` com `categoria_ml_id` da ficha (se null → o Dialog exibe
   "categoria indisponível para esta ficha" e não simula); mostra "você receberia X (líquido −
   imposto − custo = margem Y%)" nos regimes clássico e premium.

- [ ] **Step 1: Testes de `src/lib/sonar.ts`** — helpers puros: `margemSimulada({ precoAlvo, custo, aliquotaPct, tarifa })` (reusa a aritmética de `pulse-margem.ts` — ler antes; se a função de lá servir, importar em vez de duplicar) e `passosProgresso(estado)` (máquina dos 4 passos). Rodar → FAIL.
- [ ] **Step 2: Implementar `src/lib/sonar.ts`** até os testes passarem.
- [ ] **Step 3: Implementar `PulseSonar.tsx` + Tabs em `Pulse.tsx`.** Reusar os componentes de card/tabela do Radar (mesmo arquivo `Pulse.tsx` mostra o padrão). React-query com `staleTime: Infinity` por termo (o cache real é o Redis).
- [ ] **Step 4:** `pnpm test`, `pnpm lint`, `pnpm build`, `npx tsc -b --force` (pré-push obrigatório — build incremental mente, ver feedback_build_local_nao_reproduz_ci).
- [ ] **Step 5: Validação visual** — dev server local (copiar `.env.local` para a worktree antes, senão tela branca) + playwright-cli: buscar "tecido oxford 10 metros", screenshot do progresso e do painel; comparar 1:1 com o que a edge devolveu no curl da Task 3.
- [ ] **Step 6: Commit** — `git commit -m "feat(sonar): aba Sonar no Pulse com progresso por etapas e simulador de margem"`

---

### Task 5: Coluna "Visitas 30d" no Radar

**Files:**
- Create: migration via `supabase migration new pulse_ofertas_visitas_30d` (**nunca** DDL manual — ADR-0043)
- Modify: `supabase/functions/pulse-coletar/index.ts` (coleta), `src/lib/pulse.ts` (query/tipo), `src/pages/Pulse.tsx` (coluna), `src/lib/database.types.ts` (regenerar)
- Test: `supabase/functions/_shared/pulse/__tests__/sonar.test.ts` já cobre `parseVisitasJanela`; teste novo só se a coleta ganhar lógica própria além de "chama e grava"

**Interfaces:**
- Consumes: `parseVisitasJanela` (Task 1).
- Produces: coluna `pulse_ofertas_atual.visitas_30d integer null` (null = nunca medido/falhou; **não** é zero) exibida na tabela de concorrentes do Radar.

- [ ] **Step 1: Migration** — **`pulse_ofertas_atual` é uma VIEW sobre `pulse_ofertas`** (ver `20260817162536_pulse_oferta_permalink.sql`, que é o modelo exato desta mudança): `alter table public.pulse_ofertas add column visitas_30d integer;` + `create or replace view public.pulse_ofertas_atual with (security_invoker = true) as select distinct on (produto_id, item_id) id, org_id, produto_id, item_id, seller_id, preco, tier, frete_gratis, loja_oficial, ativo, dia, permalink, visitas_30d from public.pulse_ofertas order by produto_id, item_id, dia desc;` — a coluna nova vai **no fim** da lista (`create or replace view` só aceita acrescentar no final) e o `security_invoker = true` é obrigatório (sem ele a view fura a RLS — o comentário da migration modelo explica). `npm run db:check` → `supabase link --project-ref txvncrgkoynoxwopfkbp --yes < /dev/null` → `supabase db push --linked --dry-run --yes < /dev/null` → push real.
- [ ] **Step 2: Coleta** — no `pulse-coletar` (71 linhas — ler inteiro antes), após gravar a oferta: `GET /items/{item_id}/visits/time_window?last=30&unit=day` → `parseVisitasJanela(json)?.total ?? null` → update da linha. Só no **baseline diário**, não no tier quente de 6/6h (visitas 30d não muda a cada 6h; economiza ~4× chamadas).
- [ ] **Step 3: Frontend** — coluna "Visitas 30d" na tabela de concorrentes (render `—` para null com tooltip "ainda não medido"), ordenável como as vizinhas.
- [ ] **Step 4:** `pnpm test && pnpm lint && pnpm build`; regenerar `database.types.ts`; deploy `supabase functions deploy pulse-coletar --project-ref txvncrgkoynoxwopfkbp` + conferir versão.
- [ ] **Step 5: Commit** — `git commit -m "feat(pulse): coluna Visitas 30d nos concorrentes do Radar"`

---

### Task 6: Documentação e fechamento

**Files:**
- Modify: `docs/reference/edge-functions.md` (pulse-sonar + mudança do pulse-coletar), `docs/reference/modelo-de-dados.md` (coluna nova), `docs/TASKS.md`, `obsidian-vault/06-Roadmap/Sprint Atual.md`
- Já entregues no branch de planejamento (conferir, não recriar): ADR-0120, errata no ADR-0119, glossário, índice de ADRs no vault.

- [ ] **Step 1:** Atualizar os quatro arquivos acima (o padrão de cada um está no próprio arquivo).
- [ ] **Step 2:** `pnpm lint && pnpm test && pnpm build` final; conferir `supabase functions list` (verify_jwt do `pulse-sonar` = true, `pulse-coletar` inalterado).
- [ ] **Step 3: Commit + push da branch; CI verde antes de qualquer merge.**

## Self-review (feito em 2026-08-17)

- Cobertura do spec: §1–§7 do ADR-0120 → Tasks 3–5 (§7 = Task 5; §5 UX = Task 4 itens 1–2). Errata/glossário → entregues no branch de planejamento.
- Tipos: `PainelSonar` definido uma vez (Task 3) e espelhado no front (Task 4); `FichaBusca`/`VisitasJanela` só na Task 1.
- Riscos deixados explícitos: `category_id` (Task 2, com os dois desfechos), rate limit (lotes de 5, teto 20 fichas), visitas null ≠ zero (agregador testado).
