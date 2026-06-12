# Análise de viabilidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma área de menu própria (`/viabilidade`) onde o operador pesquisa GTIN(s) — colando ou subindo planilha — e vê, por produto, se já vende no ML, por quanto, e um simulador de viabilidade (líquido após comissão vs seu mínimo) com semáforo 🟢🟡🔴, comparando Clássico vs Premium.

**Architecture:** Consulta efêmera (sem persistência). O backend é uma edge nova `analisar-viabilidade` que reusa `buscarConcorrencia` (catálogo por GTIN) + `listing_prices` (comissão real no menor preço do mercado) e devolve só **dados** (mercado + comissões). Toda a **avaliação de viabilidade** (líquido, semáforo, etiqueta necessária) vive em funções puras no frontend (`src/lib/viabilidade.ts`), para o simulador recalcular ao vivo sem nova chamada. O parser da planilha (linha-a-linha, sem pai/filho) é uma função pura nova no `_shared`.

**Tech Stack:** Deno edge functions (TypeScript), `npm:xlsx`, Supabase Vault/token ML, Upstash Redis (cache), React 18 + TanStack Query + shadcn/ui, Vitest (testes de frontend e de `_shared`).

---

## File Structure

Backend (Deno, `supabase/functions/`):
- `_shared/analise/tipos.ts` — tipos do domínio de análise (`ItemAnalise`, `ItemAnalisado`, `Mercado`, `ComissaoTipo`).
- `_shared/analise/extrair-itens.ts` — parser puro da planilha de análise (enxuta ou completa → `ItemAnalise[]`).
- `_shared/analise/__tests__/extrair-itens.test.ts` — testes do parser.
- `_shared/ml/produto-categoria.ts` — `parseCategoriaProduto` (puro) + `buscarCategoriaProduto` (rede) para o `category_id` do `/products/{id}`.
- `_shared/ml/__tests__/produto-categoria.test.ts` — teste do parse.
- `analisar-viabilidade/index.ts` — edge de orquestração (verify_jwt true).

Frontend (`src/`):
- `lib/viabilidade.ts` — funções puras de avaliação (`liquidoNoMercado`, `etiquetaParaMinimo`) + adapter `analisarViabilidade` (fetch da edge) + leitura de arquivo. Tipos do front.
- `hooks/useAnaliseViabilidade.ts` — mutation do TanStack Query.
- `pages/Viabilidade.tsx` — página com as duas abas + tabela.
- `components/viabilidade-linha.tsx` — linha expansível com o simulador (Clássico vs Premium).
- `App.tsx` — rota `/viabilidade`.
- `components/sidebar.tsx` — item de menu.

Testes (`tests/`):
- `lib/viabilidade.test.ts` — funções puras de avaliação.
- `pages/Viabilidade.test.tsx` — smoke test da página.

---

## Task 1: Tipos + parser puro da planilha de análise

**Files:**
- Create: `supabase/functions/_shared/analise/tipos.ts`
- Create: `supabase/functions/_shared/analise/extrair-itens.ts`
- Test: `supabase/functions/_shared/analise/__tests__/extrair-itens.test.ts`

- [ ] **Step 1: Criar os tipos**

Create `supabase/functions/_shared/analise/tipos.ts`:

```ts
/** Item a analisar (uma linha da planilha ou um GTIN colado). */
export interface ItemAnalise {
  gtin: string;
  nome: string;
  unidade: string | null;
  /** PRECO da planilha = líquido mínimo desejado. null no modo GTIN sem preencher. */
  minimo: number | null;
  custo: number | null;
}

/** Comissão real do ML num preço, por tipo de anúncio (vinda de listing_prices). */
export interface ComissaoTipo {
  /** sale_fee_amount: comissão total (%+fixa) no menor preço do mercado. */
  saleFeeAmount: number;
  /** percentage_fee limpo (constante por categoria/tipo). */
  percentual: number;
  /** fixed_fee no menor preço do mercado. */
  fixa: number;
}

export interface Mercado {
  menor: number | null;
  maior: number | null;
  vendedores: number;
  freteGratis: number;
  full: number;
}

/** Resultado por item devolvido pela edge. Só dados; a avaliação é feita no front. */
export interface ItemAnalisado {
  gtin: string;
  nome: string;
  unidade: string | null;
  minimo: number | null;
  custo: number | null;
  existeNoML: boolean;
  mercado?: Mercado;
  classico?: ComissaoTipo;
  premium?: ComissaoTipo;
  /** true quando a busca/comissão falhou para este item (os demais seguem). */
  erro?: boolean;
}

export interface RespostaAnalise {
  itens: ItemAnalisado[];
  /** linhas da planilha descartadas (sem GTIN/preço/custo válidos). */
  ignorados: number;
}
```

- [ ] **Step 2: Escrever o teste do parser (falhando)**

Create `supabase/functions/_shared/analise/__tests__/extrair-itens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extrairItensAnalise } from '../extrair-itens';

describe('extrairItensAnalise', () => {
  it('planilha enxuta (sem PAI): cada linha com GTIN/preço/custo vira item', () => {
    const rows = [
      { NOME: 'LINHA 150 15000MT', UNIDADE: 'UN', GTIN: '3000025438427', PRECO: 39.9, CUSTO: 21.16 },
      { NOME: 'LINHA 150 15000MT (P)', UNIDADE: 'UN', GTIN: '3000025438267', PRECO: 21.16, CUSTO: 39.9 },
    ];
    const { itens, ignorados } = extrairItensAnalise(rows);
    expect(ignorados).toBe(0);
    expect(itens).toEqual([
      { gtin: '3000025438427', nome: 'LINHA 150 15000MT', unidade: 'UN', minimo: 39.9, custo: 21.16 },
      { gtin: '3000025438267', nome: 'LINHA 150 15000MT (P)', unidade: 'UN', minimo: 21.16, custo: 39.9 },
    ]);
  });

  it('aceita decimal com vírgula (pt-BR) vindo como string', () => {
    const rows = [{ NOME: 'X', UNIDADE: 'UN', GTIN: '789', PRECO: '39,900000', CUSTO: '21,161200' }];
    const { itens } = extrairItensAnalise(rows);
    expect(itens[0].minimo).toBeCloseTo(39.9, 2);
    expect(itens[0].custo).toBeCloseTo(21.1612, 4);
  });

  it('planilha completa: pula linhas de agrupador (PAI = 0) e usa só as 5 colunas', () => {
    const rows = [
      { CODIGO: '10', PAI: '0', NOME: 'PAI AGRUP', UNIDADE: 'UN', GTIN: '111', PRECO: 5, CUSTO: 2, ESTOQUE: 0 },
      { CODIGO: '11', PAI: '10', NOME: 'FILHO AZUL', UNIDADE: 'UN', GTIN: '222', PRECO: 5, CUSTO: 2, ESTOQUE: 3 },
    ];
    const { itens } = extrairItensAnalise(rows);
    expect(itens.map((i) => i.gtin)).toEqual(['222']);
  });

  it('descarta e conta linhas sem GTIN ou sem preço/custo válidos', () => {
    const rows = [
      { NOME: 'OK', UNIDADE: 'UN', GTIN: '789', PRECO: 5, CUSTO: 2 },
      { NOME: 'SEM GTIN', UNIDADE: 'UN', GTIN: null, PRECO: 5, CUSTO: 2 },
      { NOME: 'SEM PRECO', UNIDADE: 'UN', GTIN: '790', PRECO: null, CUSTO: 2 },
    ];
    const { itens, ignorados } = extrairItensAnalise(rows);
    expect(itens.map((i) => i.gtin)).toEqual(['789']);
    expect(ignorados).toBe(2);
  });

  it('lança erro claro quando falta uma das 5 colunas obrigatórias', () => {
    const rows = [{ NOME: 'X', GTIN: '789', PRECO: 5, CUSTO: 2 }]; // falta UNIDADE
    expect(() => extrairItensAnalise(rows)).toThrow(/UNIDADE/);
  });
});
```

- [ ] **Step 3: Rodar o teste (deve falhar)**

Run: `pnpm test -- extrair-itens`
Expected: FAIL — "extrairItensAnalise is not defined" / módulo não encontrado.

- [ ] **Step 4: Implementar o parser**

Create `supabase/functions/_shared/analise/extrair-itens.ts`:

```ts
import type { ItemAnalise } from './tipos.ts';

const COLUNAS = ['NOME', 'UNIDADE', 'GTIN', 'PRECO', 'CUSTO'] as const;

/** Aceita número JS ou string pt-BR ("39,90"); retorna null se não for número > 0. */
function parseNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.trim().replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function gtinLimpo(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * Extrai itens a analisar de linhas de planilha (enxuta ou completa do lote).
 * Linha-a-linha, sem agrupar por pai. Se houver coluna PAI, pula agrupadores (PAI = 0).
 * Linhas sem GTIN/PRECO/CUSTO válidos são descartadas e contadas em `ignorados`.
 */
export function extrairItensAnalise(
  rows: Array<Record<string, unknown>>,
): { itens: ItemAnalise[]; ignorados: number } {
  if (rows.length > 0) {
    const cols = new Set(Object.keys(rows[0]));
    const faltando = COLUNAS.filter((c) => !cols.has(c));
    if (faltando.length > 0) {
      throw new Error(`Planilha sem a(s) coluna(s) obrigatória(s): ${faltando.join(', ')}`);
    }
  }

  const itens: ItemAnalise[] = [];
  let ignorados = 0;

  for (const r of rows) {
    if ('PAI' in r && String(r.PAI ?? '').trim() === '0') continue; // agrupador
    const gtin = gtinLimpo(r.GTIN);
    const minimo = parseNumero(r.PRECO);
    const custo = parseNumero(r.CUSTO);
    if (!gtin || minimo == null || custo == null) {
      ignorados++;
      continue;
    }
    itens.push({
      gtin,
      nome: String(r.NOME ?? '').trim(),
      unidade: r.UNIDADE != null ? String(r.UNIDADE).trim() : null,
      minimo,
      custo,
    });
  }

  return { itens, ignorados };
}
```

- [ ] **Step 5: Rodar o teste (deve passar)**

Run: `pnpm test -- extrair-itens`
Expected: PASS (5 testes).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/analise/
git commit -m "feat(viabilidade): parser puro da planilha de análise (linha-a-linha)"
```

---

## Task 2: Categoria do produto de catálogo

O `listing_prices` precisa do `category_id`. `buscarConcorrencia` devolve o `product_id`, mas não a categoria. Este helper busca `GET /products/{id}` e extrai `category_id`.

**Files:**
- Create: `supabase/functions/_shared/ml/produto-categoria.ts`
- Test: `supabase/functions/_shared/ml/__tests__/produto-categoria.test.ts`

- [ ] **Step 1: Escrever o teste do parse (falhando)**

Create `supabase/functions/_shared/ml/__tests__/produto-categoria.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCategoriaProduto } from '../produto-categoria';

describe('parseCategoriaProduto', () => {
  it('extrai category_id do produto de catálogo', () => {
    expect(parseCategoriaProduto({ id: 'MLB123', category_id: 'MLB255054' })).toBe('MLB255054');
  });
  it('null quando ausente ou vazio', () => {
    expect(parseCategoriaProduto({ id: 'MLB123' })).toBeNull();
    expect(parseCategoriaProduto({ category_id: '' })).toBeNull();
    expect(parseCategoriaProduto(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `pnpm test -- produto-categoria`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

Create `supabase/functions/_shared/ml/produto-categoria.ts`:

```ts
const API = 'https://api.mercadolibre.com';
const TIMEOUT_MS = 15000;

/** Extrai `category_id` da resposta de `/products/{id}`. null se ausente/vazio. */
export function parseCategoriaProduto(json: unknown): string | null {
  const cat = (json as { category_id?: string } | null)?.category_id;
  return typeof cat === 'string' && cat.length > 0 ? cat : null;
}

/** GET /products/{id} → category_id. null em erro HTTP/timeout (resiliente). */
export async function buscarCategoriaProduto(
  token: string,
  productId: string,
): Promise<string | null> {
  try {
    const resp = await fetch(`${API}/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    return parseCategoriaProduto(await resp.json());
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `pnpm test -- produto-categoria`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/produto-categoria.ts supabase/functions/_shared/ml/__tests__/produto-categoria.test.ts
git commit -m "feat(viabilidade): helper de category_id do produto de catálogo"
```

---

## Task 3: Edge `analisar-viabilidade`

Orquestra: resolve itens (parseia xlsx OU usa JSON) → por item busca catálogo → categoria → `listing_prices` Clássico+Premium no menor preço → devolve dados. Resiliente por item. Sem persistência. Sem teste unitário (integração; as partes puras já têm testes).

**Files:**
- Create: `supabase/functions/analisar-viabilidade/index.ts`

- [ ] **Step 1: Implementar a edge**

Create `supabase/functions/analisar-viabilidade/index.ts`:

```ts
import * as XLSX from 'npm:xlsx@^0.18';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { buscarConcorrencia } from '../_shared/ml/concorrencia.ts';
import { buscarCategoriaProduto } from '../_shared/ml/produto-categoria.ts';
import { buscarListingPrice, comissaoDe } from '../_shared/ml/listing-prices.ts';
import { extrairItensAnalise } from '../_shared/analise/extrair-itens.ts';
import type { ItemAnalise, ItemAnalisado, ComissaoTipo } from '../_shared/analise/tipos.ts';

const LOTE = 5; // concorrência limitada p/ não estourar a API do ML

function comissaoTipo(lp: { sale_fee_amount: number }, ...rest: Parameters<typeof comissaoDe>): ComissaoTipo {
  const { percentual, fixa } = comissaoDe(rest[0]);
  return { saleFeeAmount: lp.sale_fee_amount ?? 0, percentual, fixa };
}

async function analisarItem(userId: string, item: ItemAnalise): Promise<ItemAnalisado> {
  const base: ItemAnalisado = {
    gtin: item.gtin, nome: item.nome, unidade: item.unidade,
    minimo: item.minimo, custo: item.custo, existeNoML: false,
  };
  try {
    const conc = await buscarConcorrencia(userId, {
      nome_pai: item.nome, variacoes: [{ gtin: item.gtin }],
    });
    const menor = conc.ofertas?.preco_min ?? conc.preco_min;
    if (!conc.product_id || conc.vendedores === 0 || menor == null) return base;

    const token = await getValidAccessToken(userId);
    const categoria = await buscarCategoriaProduto(token, conc.product_id);
    if (!categoria) return base;

    const [classicoML, premiumML] = await Promise.all([
      buscarListingPrice(token, menor, categoria, 'gold_special'),
      buscarListingPrice(token, menor, categoria, 'gold_pro'),
    ]);

    return {
      ...base,
      existeNoML: true,
      mercado: {
        menor,
        maior: conc.ofertas?.preco_max ?? null,
        vendedores: conc.vendedores,
        freteGratis: conc.ofertas?.frete_gratis ?? 0,
        full: conc.ofertas?.full ?? 0,
      },
      classico: { saleFeeAmount: classicoML.sale_fee_amount ?? 0, ...comissaoDe(classicoML) },
      premium: { saleFeeAmount: premiumML.sale_fee_amount ?? 0, ...comissaoDe(premiumML) },
    };
  } catch (e) {
    console.warn(`analisarItem ${item.gtin} falhou: ${(e as Error).message}`);
    return { ...base, erro: true };
  }
}

async function emLotes(userId: string, itens: ItemAnalise[]): Promise<ItemAnalisado[]> {
  const out: ItemAnalisado[] = [];
  for (let i = 0; i < itens.length; i += LOTE) {
    const fatia = itens.slice(i, i + LOTE);
    out.push(...(await Promise.all(fatia.map((it) => analisarItem(userId, it)))));
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let user;
  try { user = await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const body = await req.json().catch(() => ({}));

  let itens: ItemAnalise[];
  let ignorados = 0;
  try {
    if (body.modo === 'planilha' && typeof body.arquivoBase64 === 'string') {
      const buffer = Uint8Array.from(atob(body.arquivoBase64), (c) => c.charCodeAt(0));
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      const r = extrairItensAnalise(rows);
      itens = r.itens;
      ignorados = r.ignorados;
    } else if (body.modo === 'gtins' && Array.isArray(body.itens)) {
      itens = body.itens
        .filter((x: { gtin?: unknown }) => typeof x?.gtin === 'string' && x.gtin.trim().length > 0)
        .map((x: { gtin: string; minimo?: number; custo?: number; nome?: string }) => ({
          gtin: x.gtin.trim(),
          nome: x.nome ?? x.gtin.trim(),
          unidade: null,
          minimo: typeof x.minimo === 'number' ? x.minimo : null,
          custo: typeof x.custo === 'number' ? x.custo : null,
        }));
    } else {
      return json({ erro: 'modo inválido (use "planilha" com arquivoBase64 ou "gtins" com itens)' }, 400);
    }
  } catch (e) {
    return json({ erro: (e as Error).message }, 400);
  }

  if (itens.length === 0) return json({ itens: [], ignorados });

  console.log(`analisar-viabilidade: ${itens.length} itens, ${ignorados} ignorados`);
  const analisados = await emLotes(user.id, itens);
  return json({ itens: analisados, ignorados });
});
```

> Nota: remova o helper `comissaoTipo` não usado se o linter reclamar — o objeto final usa `comissaoDe(...)` espalhado diretamente.

- [ ] **Step 2: Verificar tipos do Deno (sem deploy)**

Run: `pnpm test -- extrair-itens produto-categoria`
Expected: PASS — confirma que os imports puros usados pela edge resolvem. (O deploy da edge é feito no bug bash, via CLI, conforme a regra "deploy nunca defasado".)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/analisar-viabilidade/
git commit -m "feat(viabilidade): edge analisar-viabilidade (catálogo + comissão por item)"
```

---

## Task 4: Funções puras de avaliação + adapter (frontend)

A avaliação (líquido, etiqueta, semáforo) vive no front para o simulador recalcular ao vivo. Reusa `calcularSemaforo` de `src/lib/semaforo.ts`.

**Files:**
- Create: `src/lib/viabilidade.ts`
- Test: `tests/lib/viabilidade.test.ts`

- [ ] **Step 1: Escrever o teste das funções puras (falhando)**

Create `tests/lib/viabilidade.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { liquidoNoMercado, etiquetaParaMinimo, semaforoTipo } from '@/lib/viabilidade';

describe('liquidoNoMercado', () => {
  it('menor preço menos a comissão total, arredondado a 2 casas', () => {
    expect(liquidoNoMercado(25, 3.5)).toBeCloseTo(21.5, 2);
  });
  it('null quando não há menor preço', () => {
    expect(liquidoNoMercado(null, 3.5)).toBeNull();
  });
});

describe('etiquetaParaMinimo (gross-up acima do abismo)', () => {
  it('mínimo R$ 20, 14% → 20/0,86 = 23,26 → arredonda cima 23,30', () => {
    expect(etiquetaParaMinimo(20, 14)).toBeCloseTo(23.3, 2);
  });
  it('mínimo baixo (R$ 4, 14%) → empurra para R$ 12,55 (acima do abismo)', () => {
    expect(etiquetaParaMinimo(4, 14)).toBeCloseTo(12.55, 2);
  });
  it('null quando não há mínimo', () => {
    expect(etiquetaParaMinimo(null, 14)).toBeNull();
  });
});

describe('semaforoTipo (igualar o mercado)', () => {
  const mercadoAlto = { menor: 25, saleFeeAmount: 3.5 };   // líquido 21,5
  const mercadoBaixo = { menor: 6, saleFeeAmount: 3.84 };  // líquido 2,16
  it('líquido no mercado ≥ mínimo → verde', () => {
    expect(semaforoTipo(mercadoAlto.menor, mercadoAlto.saleFeeAmount, 4, 1.5)).toBe('verde');
  });
  it('líquido entre custo e mínimo → amarelo', () => {
    expect(semaforoTipo(mercadoBaixo.menor, mercadoBaixo.saleFeeAmount, 4, 1.5)).toBe('amarelo');
  });
  it('líquido < custo → vermelho', () => {
    expect(semaforoTipo(mercadoBaixo.menor, mercadoBaixo.saleFeeAmount, 4, 3)).toBe('vermelho');
  });
  it('sem mínimo informado → indisponível', () => {
    expect(semaforoTipo(25, 3.5, null, 1.5)).toBe('indisponivel');
  });
});
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `pnpm test -- viabilidade`
Expected: FAIL — módulo `@/lib/viabilidade` não encontrado.

- [ ] **Step 3: Implementar as funções puras + adapter**

Create `src/lib/viabilidade.ts`:

```ts
import { supabase } from './supabase';
import { calcularSemaforo, type Semaforo } from './semaforo';

// Espelha _shared/analise/tipos.ts (Deno não é importável no browser).
export interface ComissaoTipo { saleFeeAmount: number; percentual: number; fixa: number }
export interface Mercado {
  menor: number | null; maior: number | null;
  vendedores: number; freteGratis: number; full: number;
}
export interface ItemAnalisado {
  gtin: string; nome: string; unidade: string | null;
  minimo: number | null; custo: number | null;
  existeNoML: boolean; mercado?: Mercado;
  classico?: ComissaoTipo; premium?: ComissaoTipo; erro?: boolean;
}
export interface RespostaAnalise { itens: ItemAnalisado[]; ignorados: number }

const PRECO_MIN_ACIMA_ABISMO = 12.55; // ADR-0023

function round2(n: number): number { return Math.round(n * 100) / 100; }
function arredondar5Cima(n: number): number { return Math.ceil(n * 20) / 20; }

/** Líquido se você igualar o menor preço do mercado: menor − comissão total. */
export function liquidoNoMercado(menor: number | null, saleFeeAmount: number): number | null {
  if (menor == null) return null;
  return round2(menor - saleFeeAmount);
}

/**
 * Preço de etiqueta necessário para receber `minimo` líquido (gross-up, ADR-0023).
 * Acima do abismo a tarifa fixa zera, então usa só o percentual; nunca abaixo de R$ 12,55.
 */
export function etiquetaParaMinimo(minimo: number | null, percentual: number): number | null {
  if (minimo == null) return null;
  return Math.max(PRECO_MIN_ACIMA_ABISMO, arredondar5Cima(minimo / (1 - percentual / 100)));
}

/** Semáforo de viabilidade ao igualar o menor preço do mercado. */
export function semaforoTipo(
  menor: number | null,
  saleFeeAmount: number,
  minimo: number | null,
  custo: number | null,
): Semaforo {
  if (minimo == null) return 'indisponivel';
  return calcularSemaforo(liquidoNoMercado(menor, saleFeeAmount), minimo, custo);
}

async function lerArquivoBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function postAnalise(body: unknown): Promise<RespostaAnalise> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analisar-viabilidade`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.erro) throw new Error(data?.erro ?? 'Falha ao analisar');
  return data as RespostaAnalise;
}

/** Analisa uma planilha (.xlsx). */
export async function analisarPlanilha(file: File): Promise<RespostaAnalise> {
  return postAnalise({ modo: 'planilha', arquivoBase64: await lerArquivoBase64(file) });
}

/** Analisa GTINs colados (um por linha). */
export async function analisarGtins(gtins: string[]): Promise<RespostaAnalise> {
  const itens = gtins.map((g) => g.trim()).filter(Boolean).map((gtin) => ({ gtin }));
  return postAnalise({ modo: 'gtins', itens });
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `pnpm test -- viabilidade`
Expected: PASS (todos os describes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/viabilidade.ts tests/lib/viabilidade.test.ts
git commit -m "feat(viabilidade): funções puras de avaliação + adapter da edge"
```

---

## Task 5: Hook `useAnaliseViabilidade`

**Files:**
- Create: `src/hooks/useAnaliseViabilidade.ts`

- [ ] **Step 1: Implementar o hook**

Create `src/hooks/useAnaliseViabilidade.ts`:

```ts
import { useMutation } from '@tanstack/react-query';
import { analisarPlanilha, analisarGtins, type RespostaAnalise } from '@/lib/viabilidade';

type Entrada = { tipo: 'planilha'; file: File } | { tipo: 'gtins'; gtins: string[] };

/** Dispara a análise (planilha ou GTINs colados). Mutation: sem cache, on-demand. */
export function useAnaliseViabilidade() {
  return useMutation<RespostaAnalise, Error, Entrada>({
    mutationFn: (e) => (e.tipo === 'planilha' ? analisarPlanilha(e.file) : analisarGtins(e.gtins)),
  });
}
```

- [ ] **Step 2: Verificar tipos**

Run: `pnpm build`
Expected: build sem erros de tipo.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAnaliseViabilidade.ts
git commit -m "feat(viabilidade): hook useAnaliseViabilidade"
```

---

## Task 6: Componente da linha (simulador) + página

**Files:**
- Create: `src/components/viabilidade-linha.tsx`
- Create: `src/pages/Viabilidade.tsx`

- [ ] **Step 1: Implementar a linha com simulador**

Create `src/components/viabilidade-linha.tsx`:

```tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { Input } from '@/components/ui/input';
import { fmtBRL } from '@/lib/formato';
import {
  liquidoNoMercado, etiquetaParaMinimo, semaforoTipo,
  type ItemAnalisado, type ComissaoTipo,
} from '@/lib/viabilidade';
import type { Semaforo } from '@/lib/semaforo';

const TOM: Record<Semaforo, StatusTone> = {
  verde: 'success', amarelo: 'warning', vermelho: 'danger', indisponivel: 'neutral',
};
const ROTULO: Record<Semaforo, string> = {
  verde: 'Viável', amarelo: 'Apertado', vermelho: 'Inviável', indisponivel: '—',
};

function BlocoTipo({ titulo, c, menor, minimo, custo }: {
  titulo: string; c: ComissaoTipo; menor: number | null;
  minimo: number | null; custo: number | null;
}) {
  const liquido = liquidoNoMercado(menor, c.saleFeeAmount);
  const etiqueta = etiquetaParaMinimo(minimo, c.percentual);
  const sem = semaforoTipo(menor, c.saleFeeAmount, minimo, custo);
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{titulo}</span>
        <StatusPill tone={TOM[sem]}>{ROTULO[sem]}</StatusPill>
      </div>
      <dl className="mt-2 space-y-1 text-sm text-muted-foreground">
        <div className="flex justify-between"><dt>Comissão</dt><dd>{c.percentual}% + {fmtBRL(c.fixa)}</dd></div>
        <div className="flex justify-between"><dt>Líquido se igualar o mercado</dt><dd>{liquido != null ? fmtBRL(liquido) : '—'}</dd></div>
        <div className="flex justify-between"><dt>Pra receber seu mínimo, anuncie a</dt><dd>{etiqueta != null ? fmtBRL(etiqueta) : '—'}</dd></div>
      </dl>
    </div>
  );
}

export function ViabilidadeLinha({ item, editavel }: { item: ItemAnalisado; editavel: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [minimo, setMinimo] = useState<number | null>(item.minimo);
  const [custo, setCusto] = useState<number | null>(item.custo);

  if (!item.existeNoML) {
    return (
      <tr className="border-t border-border text-muted-foreground">
        <td className="px-3 py-2">{item.nome || item.gtin}</td>
        <td colSpan={5} className="px-3 py-2">{item.erro ? 'ML indisponível' : 'não vende no ML'}</td>
      </tr>
    );
  }

  const c = item.classico!;
  const semaforo = semaforoTipo(item.mercado!.menor, c.saleFeeAmount, minimo, custo);
  const liquido = liquidoNoMercado(item.mercado!.menor, c.saleFeeAmount);

  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-accent/40" onClick={() => setAberto((v) => !v)}>
        <td className="px-3 py-2">
          <span className="inline-flex items-center gap-1">
            {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {item.nome || item.gtin}
          </span>
        </td>
        <td className="px-3 py-2">{fmtBRL(item.mercado!.menor ?? 0)}</td>
        <td className="px-3 py-2">{item.mercado!.vendedores}</td>
        <td className="px-3 py-2">{minimo != null ? fmtBRL(minimo) : '—'}</td>
        <td className="px-3 py-2">{liquido != null ? fmtBRL(liquido) : '—'}</td>
        <td className="px-3 py-2"><StatusPill tone={TOM[semaforo]}>{ROTULO[semaforo]}</StatusPill></td>
      </tr>
      {aberto && (
        <tr className="border-t border-border bg-muted/30">
          <td colSpan={6} className="px-3 py-3">
            <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">Seu mínimo
                <Input type="number" step="0.01" disabled={!editavel} className="w-28"
                  value={minimo ?? ''} onChange={(e) => setMinimo(e.target.value === '' ? null : Number(e.target.value))} />
              </label>
              <label className="flex items-center gap-2">Custo
                <Input type="number" step="0.01" disabled={!editavel} className="w-28"
                  value={custo ?? ''} onChange={(e) => setCusto(e.target.value === '' ? null : Number(e.target.value))} />
              </label>
              <span className="text-muted-foreground">
                Mercado: {fmtBRL(item.mercado!.menor ?? 0)}–{fmtBRL(item.mercado!.maior ?? item.mercado!.menor ?? 0)} ·
                {' '}{item.mercado!.freteGratis} c/ frete grátis · {item.mercado!.full} FULL
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <BlocoTipo titulo="Clássico" c={item.classico!} menor={item.mercado!.menor} minimo={minimo} custo={custo} />
              <BlocoTipo titulo="Premium" c={item.premium!} menor={item.mercado!.menor} minimo={minimo} custo={custo} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
```

> Caminhos confirmados no código: `StatusPill` em `src/components/ui/status-pill.tsx` (prop `tone`: `success|warning|danger|info|neutral`), `Input` em `src/components/ui/input.tsx`, `fmtBRL` em `src/lib/formato.ts`. `StatusPill` aceita `children` como conteúdo (ver `painel-analise.tsx`).

- [ ] **Step 2: Implementar a página**

Create `src/pages/Viabilidade.tsx`:

```tsx
import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ViabilidadeLinha } from '@/components/viabilidade-linha';
import { useAnaliseViabilidade } from '@/hooks/useAnaliseViabilidade';

const COLS = ['Produto', 'Menor ML', 'Vendedores', 'Seu mínimo', 'Líquido se igualar', 'Viabilidade'];

function Tabela({ itens, editavel }: { itens: import('@/lib/viabilidade').ItemAnalisado[]; editavel: boolean }) {
  if (itens.length === 0) return null;
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-muted-foreground">
          {COLS.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {itens.map((it) => <ViabilidadeLinha key={it.gtin} item={it} editavel={editavel} />)}
      </tbody>
    </table>
  );
}

export default function Viabilidade() {
  const analise = useAnaliseViabilidade();
  const [gtins, setGtins] = useState('');

  const onDrop = (files: File[]) => { if (files[0]) analise.mutate({ tipo: 'planilha', file: files[0] }); };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, multiple: false,
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
  });

  const itens = analise.data?.itens ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Análise de viabilidade"
        subtitle="Veja, antes de subir um lote, se os produtos já vendem no ML e se o preço é viável." />

      <Tabs defaultValue="planilha">
        <TabsList>
          <TabsTrigger value="planilha">Subir planilha</TabsTrigger>
          <TabsTrigger value="gtins">Colar GTINs</TabsTrigger>
        </TabsList>

        <TabsContent value="planilha">
          <div {...getRootProps()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-8 text-sm text-muted-foreground ${isDragActive ? 'border-primary bg-accent/40' : 'border-border'}`}>
            <input {...getInputProps()} />
            <Upload className="mb-2 h-6 w-6" />
            Arraste o .xlsx (planilha completa do lote ou só NOME, UNIDADE, GTIN, PRECO, CUSTO)
          </div>
        </TabsContent>

        <TabsContent value="gtins">
          <div className="space-y-2">
            <textarea value={gtins} onChange={(e) => setGtins(e.target.value)} rows={5}
              placeholder="Um GTIN por linha" className="w-full rounded-md border border-border bg-background p-2 text-sm" />
            <button onClick={() => analise.mutate({ tipo: 'gtins', gtins: gtins.split('\n') })}
              disabled={analise.isPending || gtins.trim() === ''}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
              <Search className="h-4 w-4" /> Pesquisar
            </button>
          </div>
        </TabsContent>
      </Tabs>

      {analise.isPending && (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      )}
      {analise.isError && <p className="text-sm text-destructive">{analise.error.message}</p>}
      {analise.isSuccess && itens.length === 0 && (
        <EmptyState title="Nada para mostrar" description="Nenhum produto válido foi encontrado na entrada." />
      )}
      {itens.length > 0 && (
        <div className="rounded-lg border border-border">
          {analise.data!.ignorados > 0 && (
            <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
              {analise.data!.ignorados} linha(s) ignorada(s) (sem GTIN/preço/custo).
            </p>
          )}
          <Tabela itens={itens} editavel={analise.variables?.tipo === 'gtins'} />
        </div>
      )}
    </div>
  );
}
```

> Caminhos confirmados: `PageHeader` (prop `title`/`subtitle`) em `@/components/ui/page-header`, `EmptyState` (prop `icon`/`title`/`description`) em `@/components/ui/empty-state`, `Tabs*` em `@/components/ui/tabs`, `Skeleton` em `@/components/ui/skeleton`. No modo planilha os campos do simulador vêm preenchidos e ficam só-leitura (`editavel={false}`); no modo GTIN ficam editáveis para o operador informar mínimo/custo.

- [ ] **Step 3: Verificar build**

Run: `pnpm build`
Expected: build sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/viabilidade-linha.tsx src/pages/Viabilidade.tsx
git commit -m "feat(viabilidade): página com abas, tabela e simulador Clássico/Premium"
```

---

## Task 7: Rota + item de menu

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 1: Adicionar a rota**

Em `src/App.tsx`, importar a página e adicionar a rota dentro do bloco do `AppShell`:

```tsx
import Viabilidade from '@/pages/Viabilidade';
```

```tsx
          <Route path="/viabilidade" element={<Viabilidade />} />
```

(colocar logo após a linha `<Route path="/publicados" element={<Publicados />} />`)

- [ ] **Step 2: Adicionar o item de menu**

Em `src/components/sidebar.tsx`, incluir `Scale` no import de `lucide-react` e um item em `NAV_ITEMS` (após "Publicados"):

```tsx
import { LayoutDashboard, Upload, ListChecks, Settings, Package, Sparkles, Scale } from 'lucide-react';
```

```tsx
  { to: '/viabilidade', label: 'Viabilidade', icon: Scale, end: false },
```

- [ ] **Step 3: Verificar build**

Run: `pnpm build`
Expected: build sem erros; a rota `/viabilidade` resolve.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/sidebar.tsx
git commit -m "feat(viabilidade): rota /viabilidade e item de menu"
```

---

## Task 8: Smoke test da página + verificação final

**Files:**
- Create: `tests/pages/Viabilidade.test.tsx`

- [ ] **Step 1: Escrever o smoke test (falhando)**

Create `tests/pages/Viabilidade.test.tsx`. Siga o padrão dos testes de página existentes (provedor do TanStack Query + render). Verifique o título e a presença das duas abas:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Viabilidade from '@/pages/Viabilidade';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Viabilidade /></QueryClientProvider>);
}

describe('Página Viabilidade', () => {
  it('mostra o título e as duas abas de entrada', () => {
    renderPage();
    expect(screen.getByText('Análise de viabilidade')).toBeInTheDocument();
    expect(screen.getByText('Subir planilha')).toBeInTheDocument();
    expect(screen.getByText('Colar GTINs')).toBeInTheDocument();
  });
});
```

> Se algum teste de página existente usar um `renderWithProviders` compartilhado (grep em `tests/`), use-o em vez de montar o `QueryClientProvider` à mão.

- [ ] **Step 2: Rodar o teste**

Run: `pnpm test -- Viabilidade`
Expected: PASS. Se falhar por provider/router faltando, ajuste o wrapper conforme o padrão dos outros testes de página.

- [ ] **Step 3: Verificação final (suíte + lint + build)**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: toda a suíte verde, lint 0 errors, build limpo.

- [ ] **Step 4: Commit**

```bash
git add tests/pages/Viabilidade.test.tsx
git commit -m "test(viabilidade): smoke test da página"
```

---

## Pós-plano (fora das tasks de código)

- **Deploy via CLI** (regra "deploy nunca defasado"): `analisar-viabilidade` é função nova — deploy com `verify_jwt` padrão (true). Como ela importa `_shared/ml/*`, não há outras funções a redeployar (só código novo). Verificar a versão pós-deploy.
- **Bug bash com token real:** confirmar que `GET /products/{id}` traz `category_id` utilizável; validar que a comissão por tipo bate (comparar com o card "Você recebe"); rodar uma planilha real e checar os semáforos (especialmente um item barato → 🔴).
- **Push do frontend** para o Render (item de menu novo) — via `RENDER_DEPLOY_HOOK_FRONTEND`.

## Self-review (preenchido)

- **Cobertura do spec:** entrada planilha/GTIN (Tasks 1,3,4,6) · não-achado no ML (Task 6 linha cinza) · categoria automática (Task 2) · comissão real à prova do abismo (Tasks 3,4) · semáforo lucro+competitividade (Task 4) · tabela + simulador + Clássico/Premium (Task 6) · sem persistência (edge stateless, Task 3) · menu próprio (Task 7). ✓
- **Sem persistência / sem tocar ML além de leitura:** confirmado — a edge só lê catálogo/listing_prices. ✓
- **Consistência de tipos:** `ComissaoTipo.{saleFeeAmount,percentual,fixa}`, `Mercado.{menor,maior,vendedores,freteGratis,full}`, `ItemAnalisado` e as funções `liquidoNoMercado/etiquetaParaMinimo/semaforoTipo` têm a mesma assinatura entre backend (espelho) e front. ✓
- **Decisão adiada:** o helper `comissaoTipo` na Task 3 ficou redundante (o objeto usa `...comissaoDe(...)`); a nota orienta removê-lo se o lint reclamar. ✓
