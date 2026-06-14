# E1 — Camada de abstração de canais (CREATE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir um contrato de canal agnóstico (`ChannelConnector`) com um `MercadoLivreConnector` que encapsula a sequência de publicação CREATE do ML, e religar o worker `publish-familia-ml` para publicar **através** do conector — sem mudar comportamento.

**Architecture:** Ports & Adapters (strangler fig). O conector vira a "porta"; o ML é o 1º adapter, delegando às funções `_shared/ml/*` já testadas. O worker passa a construir um `AnuncioCanonico` e chamar `conn.criarAnuncio(...)`, mantendo a orquestração de borda (fetch no banco, upload+cache de fotos, transição de status do lote, opt-in de catálogo). Escopo desta fatia: **somente CREATE**. UPDATE/status/Shopee são fatias seguintes (ADR-0024 §E1b+, ADR-0025).

**Tech Stack:** Deno + TypeScript (Supabase Edge Functions), Vitest (testes de funções puras em `supabase/functions/**/__tests__/`), QStash (fila), Supabase (DB/Storage).

**Decisões de escopo (refinam ADR-0024):**
- O `AnuncioCanonico` desta fatia ainda carrega `categoriaId`/`atributos` no formato do canal (categoria_ml_id + atributos_ml já montados). A canonicalização de categoria/atributos é o E3; a de fotos/listing por canal é o E2. Aqui o ganho é o **seam + ResultadoCanal + registry** no caminho de CREATE.
- `conn.criarAnuncio` retorna `ResultadoCanal<RefAnuncio>` (não lança) — é onde a taxonomia de erro unificada entra. `conn.subirFoto` **lança** (envolve `subirFotoML`), preservando o fluxo de erro atual do worker para upload.
- Comportamento do ML é **congelado**: as mesmas funções (`montarPayloadItem`, `criarItemML`, `garantirDescricaoML`, `subirFotoML`) são chamadas na mesma ordem.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/functions/_shared/canais/contrato.ts` (criar) | Tipos do contrato agnóstico: `CanalId`, `Capabilities`, `ResultadoCanal<T>`, `ErroCanalCodigo`, `RefAnuncio`, `AnuncioCanonico`, `VariacaoCanonica`, `ContextoCanal`, interface `ChannelConnector`. Sem lógica. |
| `supabase/functions/_shared/canais/mapeamento.ts` (criar) | Funções **puras** do adapter ML: `mapearVariacoesExternas` (casa resultado do ML → `sku→variation_id`) e `classificarErroCanal` (erro nativo → `ResultadoCanal.erro`). Testáveis sem rede. |
| `supabase/functions/_shared/canais/mercado-livre.ts` (criar) | `mercadoLivreConnector: ChannelConnector` — `capabilities`, `subirFoto` (envolve `subirFotoML`), `criarAnuncio` (mapeia `AnuncioCanonico`→`montarPayloadItem`→`criarItemML`→`mapearVariacoesExternas`), `garantirDescricao` (envolve `garantirDescricaoML`). |
| `supabase/functions/_shared/canais/registry.ts` (criar) | `getConnector(canal: CanalId): ChannelConnector`. |
| `supabase/functions/_shared/canais/__tests__/mapeamento.test.ts` (criar) | Testes das funções puras. |
| `supabase/functions/_shared/canais/__tests__/registry.test.ts` (criar) | Teste do registry. |
| `supabase/functions/publish-familia-ml/index.ts` (modificar) | Religar para usar `getConnector('mercado_livre')`: construir `AnuncioCanonico`, `conn.subirFoto`, `conn.criarAnuncio`, `conn.garantirDescricao`; tratar `ResultadoCanal`. |

---

## Task 1: Contrato do canal (tipos)

**Files:**
- Create: `supabase/functions/_shared/canais/contrato.ts`

- [ ] **Step 1: Escrever o arquivo de tipos**

```ts
// supabase/functions/_shared/canais/contrato.ts
import type { AtributoItem } from '../ml/publicar.ts';
import type { DimensoesPacote } from '../ml/pacote.ts';

/** Canais suportados. Expandir conforme novos adapters (ADR-0024). */
export type CanalId = 'mercado_livre';

/** Recursos que variam por canal; a orquestração consulta antes de agir. */
export interface Capabilities {
  variacoes: boolean;        // suporta variações sob 1 anúncio
  descricaoSeparada: boolean; // descrição é recurso à parte (ML=true)
  catalogo: boolean;          // opt-in de catálogo/buybox (ML=true)
  desconto: boolean;
  dimensoesPacote: boolean;
}

/** Taxonomia de erro unificada (generaliza humanizarErroML/ehErroRetentavel). */
export type ErroCanalCodigo =
  | 'TITULO' | 'FOTO' | 'PRECO' | 'GTIN' | 'ATRIBUTO' | 'VARIACAO'
  | 'CATEGORIA' | 'DESCRICAO' | 'ESTOQUE' | 'AUTENTICACAO'
  | 'RATE_LIMIT' | 'INDISPONIVEL' | 'NAO_SUPORTADO' | 'DESCONHECIDO';

export interface ErroCanal {
  codigo: ErroCanalCodigo;
  mensagemOperador: string;
  retentavel: boolean;
  raw?: unknown;
}

export interface ResultadoCanal<T> {
  ok: boolean;
  valor?: T;
  erro?: ErroCanal;
}

/** Referência do anúncio criado no canal. */
export interface RefAnuncio {
  itemExternoId: string;
  permalink?: string;
  /** sku interno (codigo) → id da variação no canal. */
  variacoesExternas: Record<string, string>;
}

/** Uma variação no modelo canônico (CREATE). fotoId já é o id no canal. */
export interface VariacaoCanonica {
  sku: string;
  cor: string | null;
  estoque: number;
  preco: number | null;
  gtin: string | null;
  fotoId: string | null;
}

/**
 * Anúncio no modelo canônico (CREATE). Nesta fatia, `categoriaId`/`atributos`
 * ainda vêm no formato do canal (categoria_ml_id + atributos_ml montados); a
 * canonicalização de categoria/atributos é o E3.
 */
export interface AnuncioCanonico {
  titulo: string | null;
  descricao: string | null;
  categoriaId: string | null;
  atributos: AtributoItem[];
  capaFotoId: string | null;
  capa2FotoId: string | null;
  capa3FotoId: string | null;
  listingTypeId?: string;
  desconto: { pct: number } | null;
  dimensoes: DimensoesPacote | null;
  variacoes: VariacaoCanonica[];
}

/** Contexto por chamada (auth lazy). */
export interface ContextoCanal {
  getToken(): Promise<string>;
}

export interface ChannelConnector {
  readonly id: CanalId;
  readonly capabilities: Capabilities;
  /** Sobe uma foto (a partir de URL assinada) e devolve o id da foto no canal. Lança em falha. */
  subirFoto(ctx: ContextoCanal, sourceUrl: string): Promise<string>;
  /** Cria o anúncio. Não lança: erros viram ResultadoCanal.erro. */
  criarAnuncio(ctx: ContextoCanal, anuncio: AnuncioCanonico): Promise<ResultadoCanal<RefAnuncio>>;
  /** Garante a descrição (recurso separado). Best-effort no worker. */
  garantirDescricao(ctx: ContextoCanal, itemExternoId: string, descricao: string): Promise<void>;
}
```

- [ ] **Step 2: Verificar que compila (type-check)**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: PASS (0 erros). O arquivo só declara tipos/interface.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/canais/contrato.ts
git commit -m "feat(canais): contrato ChannelConnector + tipos canônicos (E1, ADR-0024)"
```

---

## Task 2: Funções puras do mapeamento ML (TDD)

**Files:**
- Create: `supabase/functions/_shared/canais/mapeamento.ts`
- Test: `supabase/functions/_shared/canais/__tests__/mapeamento.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

```ts
// supabase/functions/_shared/canais/__tests__/mapeamento.test.ts
import { describe, it, expect } from 'vitest';
import { mapearVariacoesExternas, classificarErroCanal } from '../mapeamento.ts';

describe('mapearVariacoesExternas', () => {
  it('casa por seller_custom_field', () => {
    const result = [
      { id: 111, seller_custom_field: 'A1' },
      { id: 222, seller_custom_field: 'A2' },
    ];
    const canon = [{ sku: 'A1' }, { sku: 'A2' }];
    expect(mapearVariacoesExternas(result, canon)).toEqual({ A1: '111', A2: '222' });
  });

  it('cai para casar por índice quando o ML não ecoa seller_custom_field e as contagens batem', () => {
    const result = [{ id: 111 }, { id: 222 }];
    const canon = [{ sku: 'A1' }, { sku: 'A2' }];
    expect(mapearVariacoesExternas(result, canon)).toEqual({ A1: '111', A2: '222' });
  });

  it('não casa por índice quando as contagens divergem', () => {
    const result = [{ id: 111 }];
    const canon = [{ sku: 'A1' }, { sku: 'A2' }];
    expect(mapearVariacoesExternas(result, canon)).toEqual({});
  });
});

describe('classificarErroCanal', () => {
  it('marca 5xx como retentável', () => {
    const e = Object.assign(new Error('x'), { status: 503 });
    expect(classificarErroCanal(e).retentavel).toBe(true);
  });

  it('marca o erro de foto transiente (retentavel=true) como retentável', () => {
    const e = Object.assign(new Error('foto'), { retentavel: true, status: 400 });
    expect(classificarErroCanal(e).retentavel).toBe(true);
  });

  it('marca 4xx comum como definitivo', () => {
    const e = Object.assign(new Error('título inválido'), { status: 400 });
    const r = classificarErroCanal(e);
    expect(r.retentavel).toBe(false);
    expect(r.mensagemOperador).toBe('título inválido');
  });
});
```

- [ ] **Step 2: Rodar os testes para ver falhar**

Run: `pnpm test -- mapeamento`
Expected: FAIL ("Cannot find module '../mapeamento.ts'").

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/canais/mapeamento.ts
import type { ErroCanal } from './contrato.ts';

/** Casa as variações retornadas pelo canal com os SKUs canônicos.
 *  Preferência: seller_custom_field; fallback por índice se as contagens baterem. */
export function mapearVariacoesExternas(
  resultVariations: Array<{ id: string | number; seller_custom_field?: string }>,
  canon: Array<{ sku: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const casaPorIndice = resultVariations.length === canon.length;
  for (let i = 0; i < resultVariations.length; i++) {
    const mv = resultVariations[i];
    const sku = mv.seller_custom_field ?? (casaPorIndice ? canon[i]?.sku : undefined);
    if (sku) out[sku] = String(mv.id);
  }
  return out;
}

/** Converte um erro nativo (lançado por criarItemML etc.) no formato unificado.
 *  retentável = pedido explícito de reenvio (foto transiente) OU 5xx/429. */
export function classificarErroCanal(e: unknown): ErroCanal {
  const status = (e as { status?: number }).status;
  const retentavelNativo = (e as { retentavel?: boolean }).retentavel === true;
  const retentavel = retentavelNativo || (typeof status === 'number' && (status >= 500 || status === 429));
  const mensagemOperador = e instanceof Error ? e.message : String(e);
  return { codigo: 'DESCONHECIDO', mensagemOperador, retentavel, raw: e };
}
```

- [ ] **Step 4: Rodar os testes para ver passar**

Run: `pnpm test -- mapeamento`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/canais/mapeamento.ts supabase/functions/_shared/canais/__tests__/mapeamento.test.ts
git commit -m "feat(canais): mapeamento puro (variações externas + classificação de erro) (E1)"
```

---

## Task 3: MercadoLivreConnector

**Files:**
- Create: `supabase/functions/_shared/canais/mercado-livre.ts`

- [ ] **Step 1: Implementar o adapter (delega às funções _shared/ml existentes)**

```ts
// supabase/functions/_shared/canais/mercado-livre.ts
import type { ChannelConnector, ContextoCanal, AnuncioCanonico, ResultadoCanal, RefAnuncio } from './contrato.ts';
import { montarPayloadItem } from '../ml/publicar.ts';
import { criarItemML, garantirDescricaoML } from '../ml/criar-item.ts';
import { subirFotoML } from '../ml/fotos.ts';
import { mapearVariacoesExternas, classificarErroCanal } from './mapeamento.ts';

export const mercadoLivreConnector: ChannelConnector = {
  id: 'mercado_livre',
  capabilities: {
    variacoes: true,
    descricaoSeparada: true,
    catalogo: true,
    desconto: true,
    dimensoesPacote: true,
  },

  async subirFoto(ctx: ContextoCanal, sourceUrl: string): Promise<string> {
    const token = await ctx.getToken();
    return subirFotoML(token, sourceUrl);
  },

  async criarAnuncio(ctx: ContextoCanal, a: AnuncioCanonico): Promise<ResultadoCanal<RefAnuncio>> {
    const token = await ctx.getToken();
    const payload = montarPayloadItem(
      { titulo_ml: a.titulo, descricao_ml: a.descricao, categoria_ml_id: a.categoriaId, atributos_ml: a.atributos },
      a.variacoes.map((v) => ({
        codigo: v.sku, cor: v.cor, estoque: v.estoque,
        preco_publicacao: v.preco, gtin: v.gtin, ml_picture_id: v.fotoId,
      })),
      a.capaFotoId, a.capa2FotoId, a.capa3FotoId,
      a.listingTypeId, a.desconto, a.dimensoes,
    );
    try {
      const r = await criarItemML(token, payload);
      return {
        ok: true,
        valor: {
          itemExternoId: r.id,
          permalink: r.permalink,
          variacoesExternas: mapearVariacoesExternas(r.variations, a.variacoes),
        },
      };
    } catch (e) {
      return { ok: false, erro: classificarErroCanal(e) };
    }
  },

  async garantirDescricao(ctx: ContextoCanal, itemExternoId: string, descricao: string): Promise<void> {
    const token = await ctx.getToken();
    await garantirDescricaoML(token, itemExternoId, descricao);
  },
};
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: PASS. (Confirma que o adapter satisfaz a interface `ChannelConnector` e que `montarPayloadItem` aceita os argumentos no formato esperado.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/canais/mercado-livre.ts
git commit -m "feat(canais): MercadoLivreConnector delegando ao _shared/ml (E1)"
```

---

## Task 4: Registry de conectores (TDD)

**Files:**
- Create: `supabase/functions/_shared/canais/registry.ts`
- Test: `supabase/functions/_shared/canais/__tests__/registry.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// supabase/functions/_shared/canais/__tests__/registry.test.ts
import { describe, it, expect } from 'vitest';
import { getConnector } from '../registry.ts';

describe('getConnector', () => {
  it('resolve o conector do Mercado Livre', () => {
    const c = getConnector('mercado_livre');
    expect(c.id).toBe('mercado_livre');
    expect(c.capabilities.variacoes).toBe(true);
    expect(typeof c.criarAnuncio).toBe('function');
  });

  it('lança para canal desconhecido', () => {
    // @ts-expect-error canal inválido em runtime
    expect(() => getConnector('tiktok')).toThrow(/canal não suportado/i);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm test -- registry`
Expected: FAIL ("Cannot find module '../registry.ts'").

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/canais/registry.ts
import type { CanalId, ChannelConnector } from './contrato.ts';
import { mercadoLivreConnector } from './mercado-livre.ts';

const CONECTORES: Record<CanalId, ChannelConnector> = {
  mercado_livre: mercadoLivreConnector,
};

export function getConnector(canal: CanalId): ChannelConnector {
  const c = CONECTORES[canal];
  if (!c) throw new Error(`Canal não suportado: ${canal}`);
  return c;
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `pnpm test -- registry`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/canais/registry.ts supabase/functions/_shared/canais/__tests__/registry.test.ts
git commit -m "feat(canais): registry getConnector (E1)"
```

---

## Task 5: Religar o worker publish-familia-ml pelo conector

> Objetivo: comportamento **idêntico**. Só muda a origem das operações ML (agora via `getConnector`) e o tratamento de erro do `criarAnuncio` passa a ler `ResultadoCanal`. A orquestração (fetch, upload+cache de fotos, validação de atributos, persistência, catálogo, finalização do lote) permanece no worker.

**Files:**
- Modify: `supabase/functions/publish-familia-ml/index.ts`

- [ ] **Step 1: Trocar os imports ML diretos pelo conector**

Remover:
```ts
import { subirFotoML } from '../_shared/ml/fotos.ts';
import { montarPayloadItem, ordenarVariacoesPrincipal } from '../_shared/ml/publicar.ts';
import { criarItemML, garantirDescricaoML } from '../_shared/ml/criar-item.ts';
```
Manter `ordenarVariacoesPrincipal` (é orquestração de ordem, fica no worker) — então o import de `publicar.ts` permanece só para ela:
```ts
import { ordenarVariacoesPrincipal } from '../_shared/ml/publicar.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import type { AnuncioCanonico } from '../_shared/canais/contrato.ts';
```

- [ ] **Step 2: Criar o conector e o contexto no início do handler (após obter `familia`)**

Logo após `const admin = adminClient();` e antes do uso, dentro do escopo onde `familia` existe:
```ts
const conn = getConnector('mercado_livre');
const ctx = { getToken: () => getValidAccessToken(familia.user_id) };
```
(Manter `getValidAccessToken` importado.)

- [ ] **Step 3: No ramo "já publicado", usar o conector para a descrição**

Trocar:
```ts
const tk = await getValidAccessToken(familia.user_id);
await garantirDescricaoML(tk, familia.ml_item_id, familia.descricao_ml);
```
por:
```ts
await conn.garantirDescricao(ctx, familia.ml_item_id, familia.descricao_ml);
```

- [ ] **Step 4: Trocar os uploads de foto por `conn.subirFoto`**

Onde hoje há `await subirFotoML(token, await signed(...))`, usar `await conn.subirFoto(ctx, await signed(...))`. Remover a linha `const token = await getValidAccessToken(familia.user_id);` (o token agora vem via `ctx` dentro do conector). As 4 ocorrências (capa, capa2, capa3, e a foto por variação no loop) passam a `conn.subirFoto(ctx, ...)`.

- [ ] **Step 5: Substituir a montagem de payload + criação pelo `conn.criarAnuncio`**

Trocar o bloco de `montarPayloadItem(...)` + `const resultado = await criarItemML(token, payload);` por construir o `AnuncioCanonico` e chamar o conector:
```ts
const ordenadas = ordenarVariacoesPrincipal(variacoesComFoto, familia.variacao_principal_codigo ?? null);
const rep = ordenadas[0];
const dimensoes = rep ? {
  altura_cm: rep.altura_cm != null ? Number(rep.altura_cm) : null,
  largura_cm: rep.largura_cm != null ? Number(rep.largura_cm) : null,
  comprimento_cm: rep.comprimento_cm != null ? Number(rep.comprimento_cm) : null,
  peso_gramas: rep.peso_gramas != null ? Number(rep.peso_gramas) : null,
} : null;

const anuncio: AnuncioCanonico = {
  titulo: familia.titulo_ml,
  descricao: familia.descricao_ml,
  categoriaId: familia.categoria_ml_id,
  atributos: familia.atributos_ml ?? [],
  capaFotoId: capaPictureId,
  capa2FotoId: capa2PictureId,
  capa3FotoId: capa3PictureId,
  listingTypeId: job.listing_type_id,
  desconto,
  dimensoes,
  variacoes: ordenadas.map((v) => ({
    sku: v.codigo, cor: v.cor, estoque: v.estoque,
    preco: v.preco_publicacao, gtin: v.gtin, fotoId: v.ml_picture_id,
  })),
};

const res = await conn.criarAnuncio(ctx, anuncio);
if (!res.ok) {
  const e = res.erro!;
  if (e.retentavel && Number(req.headers.get('Upstash-Retried') ?? '0') < 3) {
    return new Response(e.mensagemOperador, { status: 500, headers: corsHeaders });
  }
  await admin.from('familias').update({ status: 'erro', erro_mensagem: e.mensagemOperador }).eq('id', job.familia_id);
  await talvezFinalizarLote(admin, job.lote_id);
  return new Response(JSON.stringify({ erro: e.mensagemOperador }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const ref = res.valor!;
```

- [ ] **Step 6: Persistir usando `ref` (id/permalink/variações)**

Trocar `resultado.id`→`ref.itemExternoId`, `resultado.permalink`→`ref.permalink`. Substituir o loop de casamento de `ml_variation_id` por iterar `ref.variacoesExternas`:
```ts
for (const [codigo, variationId] of Object.entries(ref.variacoesExternas)) {
  await admin.from('variacoes').update({ ml_variation_id: variationId })
    .eq('familia_id', job.familia_id).eq('codigo', codigo);
}
```
A descrição best-effort após persistir vira:
```ts
if (familia.descricao_ml) {
  try { await conn.garantirDescricao(ctx, ref.itemExternoId, familia.descricao_ml); }
  catch (e) { console.error(`descrição falhou para ${ref.itemExternoId}:`, e); }
}
```

- [ ] **Step 7: Ajustar o `catch` externo**

O `criarAnuncio` agora trata seu próprio erro (retorna `ResultadoCanal`). O `catch` externo continua cobrindo o que **lança**: `signed()`, `conn.subirFoto`, validação de atributos, e erros de banco. A lógica de `retentavelFoto`/`status>=500` permanece para esses casos (ex.: `subirFoto` lança erro de foto transiente com `.retentavel`). **Não remover** o `catch`.

- [ ] **Step 8: Type-check + suíte completa**

Run: `pnpm exec tsc --noEmit -p tsconfig.json && pnpm test`
Expected: PASS — type-check 0 erros; **todos os ~563 testes verdes** (nenhum teste de comportamento mudou; os novos de `canais/*` somam).

- [ ] **Step 9: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: 0 errors no lint; build limpo.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/publish-familia-ml/index.ts
git commit -m "refactor(publish-ml): publica via getConnector('mercado_livre') (E1, comportamento idêntico)"
```

---

## Verificação final (antes do merge)

- [ ] `pnpm test` — todos verdes (baseline + novos de `canais/*`).
- [ ] `pnpm exec tsc --noEmit` — 0 erros.
- [ ] `pnpm lint` — 0 errors.
- [ ] `pnpm build` — limpo.
- [ ] **Diff review (passe separado):** confirmar que o `publish-familia-ml` chama exatamente as mesmas funções ML na mesma ordem (montar→criar→descrição→casar variações), só que via conector. Nenhuma mudança de comportamento.
- [ ] **Bug bash com token real** (1 família simples) antes de considerar a fatia concluída — publicar 1 anúncio de teste e confirmar id/permalink/variações/descrição idênticos ao fluxo antigo. Deploy do `publish-familia-ml` via CLI **só após** o OK do Diego (regra: app em produção).

---

## Self-Review (checklist do autor)

1. **Cobertura do spec (E1 CREATE):** contrato ✅ (Task 1), adapter ML ✅ (Tasks 2–3), registry ✅ (Task 4), rewire do worker CREATE ✅ (Task 5). UPDATE/status/Shopee **fora de escopo** (fatias seguintes) — explícito.
2. **Placeholders:** nenhum — todo passo tem código/comando reais.
3. **Consistência de tipos:** `AnuncioCanonico`/`VariacaoCanonica`/`RefAnuncio`/`ResultadoCanal` definidos na Task 1 e usados igual nas Tasks 3 e 5; `mapearVariacoesExternas`/`classificarErroCanal` definidos na Task 2 e usados na Task 3; `getConnector` na Task 4 e usado na Task 5.
4. **Risco de produção:** worker UPDATE intocado; CREATE com comportamento congelado (mesmas funções, mesma ordem); validação por testes + diff review + bug bash com token real; deploy só após OK do Diego.
