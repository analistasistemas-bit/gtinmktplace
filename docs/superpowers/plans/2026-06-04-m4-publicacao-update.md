# Publicação UPDATE (reposição de estoque) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o operador reponha o estoque de anúncios já publicados re-importando a planilha — herdando o anúncio anterior sem IA, mostrando diff de estoque por cor na Revisão e atualizando **só o estoque** via `PUT /items/{id}`.

**Architecture:** O `ingest-lote` detecta famílias já publicadas (`operacao=UPDATE`), herda o anúncio anterior (`ml_item_id`, `ml_variation_id` por cor, metadados para exibição), grava o snapshot `estoque_anterior` e marca `status='pronto'` **sem** rodar `process-familia`. Na publicação, `publicar-familias` roteia por `operacao`: UPDATE vai ao novo worker `update-familia-ml`, que faz `GET /items/{id}` (estado real, para não deletar variação) + `PUT /items/{id}` com só `available_quantity`. Mudança estrutural (cor nova/removida) é detectada e sinalizada, nunca aplicada.

**Tech Stack:** Supabase Edge Functions (Deno/TS), Postgres, QStash, React + Vite + TanStack Query, vitest. Edges deployadas via MCP `supabase-mcp-server` (CLI quebrada). Migrations via MCP `apply_migration`. Tipos via MCP `generate_typescript_types`.

**Spec:** `docs/superpowers/specs/2026-06-04-m4-publicacao-update-design.md`

---

## File Structure

**Criar:**
- `docs/decisions/0016-publicacao-update-reposicao-estoque.md` — ADR refinando o 0005.
- `supabase/functions/_shared/update/casar.ts` — função pura `casarVariacoesUpdate` (casamento lote↔publicação anterior + mudança estrutural).
- `supabase/functions/_shared/update/__tests__/casar.test.ts` — testes.
- `supabase/functions/_shared/ml/atualizar.ts` — função pura `montarVariacoesUpdate` (monta `variations[]` do PUT).
- `supabase/functions/_shared/ml/__tests__/atualizar.test.ts` — testes.
- `supabase/functions/_shared/ml/atualizar-item.ts` — fetch `buscarItemML` (GET) + `atualizarItemML` (PUT). Sem teste unitário (validado no bug bash, como `criar-item.ts`).
- `supabase/functions/update-familia-ml/index.ts` — worker UPDATE.
- `src/components/diff-estoque.tsx` — componente do diff de estoque por cor (UPDATE).

**Modificar:**
- `supabase/functions/_shared/queue.ts` — `enfileirarAtualizacao`.
- `supabase/functions/publicar-familias/index.ts` — claim `CREATE|UPDATE` + roteamento.
- `supabase/functions/ingest-lote/index.ts` — herança UPDATE + status `pronto` sem enfileirar IA.
- `src/lib/tipos-dominio.ts` — `Variacao.mlVariationId`, `Variacao.estoqueAnterior`, `Familia.mudancaEstrutural` + tipo `MudancaEstrutural`.
- `src/lib/queries.ts` — adapter mapeia os campos novos.
- `src/lib/publicavel.ts` — libera UPDATE com regras próprias.
- `src/components/familia-expanded.tsx` — renderiza `DiffEstoque` + selo de mudança estrutural quando `operacao=UPDATE`.
- `src/components/familia-row.tsx` — selo compacto de mudança estrutural.
- `src/pages/Revisao.tsx` — modal Clássico/Premium só para CREATE; rótulo no relatório.
- `tests/lib/publicavel.test.ts` — casos UPDATE.

---

## Task 1: ADR-0016

**Files:**
- Create: `docs/decisions/0016-publicacao-update-reposicao-estoque.md`

- [ ] **Step 1: Escrever o ADR**

```markdown
# ADR-0016: Publicação UPDATE — reposição de estoque herdando o anúncio anterior

**Status:** Aceito
**Data:** 2026-06-04
**Decisores:** Diego
**Refina:** ADR-0005 (imutável)

## Contexto

O ADR-0005 definiu que re-importar a planilha deve atualizar anúncios já
publicados ("modo UPDATE"), mas deixou aberto o escopo exato e o tratamento de
mudanças estruturais. Ao implementar, decidimos os detalhes abaixo.

## Decisão

1. **Escopo do UPDATE = só estoque.** Preço de venda, título, descrição, fotos e
   categoria do anúncio são preservados. No `PUT /items/{id}` mandamos apenas
   `available_quantity` por variação (omitir `price` preserva o preço no ML).
2. **Herança sem IA.** O `ingest-lote`, ao detectar família já publicada
   (`codigo_pai` com `ml_item_id`), herda do registro anterior `ml_item_id`,
   `ml_permalink`, título/descrição/categoria/atributos (só para exibição) e,
   casando por `codigo`, `ml_variation_id`/`cor`/`ml_picture_id` por variação;
   grava `estoque_anterior` (snapshot do diff) e marca a família `pronto` sem
   enfileirar `process-familia`. UPDATE não gasta IA nem busca de concorrência.
3. **Mudança estrutural detecta + sinaliza, não aplica.** Cor nova (no lote, sem
   variação no anúncio) não é adicionada; cor removida (no anúncio, ausente no
   lote) não é deletada. Ambas aparecem como selo na Revisão.
4. **PUT inclui todas as variações reais.** O ML deleta qualquer variação omitida
   do `variations[]`. Por isso o worker faz `GET /items/{id}` antes e reenvia
   todas as variações atuais: as casadas com o novo estoque, as não-casadas
   (cor removida) com o estoque atual (preserva).

## Consequências

- UPDATE é barato (sem IA) e seguro para anúncios no ar (nunca mexe em preço,
  nunca deleta variação).
- Mudança estrutural exige ação manual do operador no ML (aceito no MVP).
- O diff da UI usa o snapshot `estoque_anterior` (o que publicamos por último),
  não um GET ao vivo; o worker usa o GET real na hora de aplicar.

## Alternativas consideradas

- Atualizar preço junto: rejeitado a pedido do Diego (preço de venda é gerido no
  ML / definido no CREATE).
- Adicionar/remover variação no ML: fora do MVP (ML restringe remoção com vendas;
  adicionar exige foto/atributos).
- GET ao vivo para o diff da UI: descartado (frontend não tem token; snapshot
  basta para decisão).
```

- [ ] **Step 2: Registrar o ADR na tabela do CLAUDE.md**

Em `CLAUDE.md`, na seção "Decisões arquiteturais já tomadas (todos os ADRs)", adicionar a linha:

```markdown
| [0016](docs/decisions/0016-publicacao-update-reposicao-estoque.md) | Publicação UPDATE: reposição de estoque herdando o anúncio anterior (refina 0005) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0016-publicacao-update-reposicao-estoque.md CLAUDE.md
git commit -m "docs(m4): ADR-0016 Publicacao UPDATE (reposicao de estoque)"
```

---

## Task 2: Migrations + regen de tipos

**Files:**
- Modify (via MCP): schema das tabelas `variacoes` e `familias`
- Modify: `src/lib/database.types.ts` (gerado)

- [ ] **Step 1: Aplicar a migration `estoque_anterior` em `variacoes`**

Via MCP `mcp__supabase-mcp-server__apply_migration`, name `add_estoque_anterior_variacoes`:

```sql
ALTER TABLE public.variacoes
  ADD COLUMN IF NOT EXISTS estoque_anterior integer;

COMMENT ON COLUMN public.variacoes.estoque_anterior IS
  'Snapshot do estoque publicado por ultimo (UPDATE). Usado no diff da Revisao. Null em CREATE ou cor nova.';
```

- [ ] **Step 2: Aplicar a migration `mudanca_estrutural` em `familias`**

Via MCP `apply_migration`, name `add_mudanca_estrutural_familias`:

```sql
ALTER TABLE public.familias
  ADD COLUMN IF NOT EXISTS mudanca_estrutural jsonb;

COMMENT ON COLUMN public.familias.mudanca_estrutural IS
  'UPDATE: { novas: string[], removidas: {codigo,cor}[] } — cores detectadas mas nao aplicadas no ML.';
```

- [ ] **Step 3: Regenerar os tipos**

Via MCP `mcp__supabase-mcp-server__generate_typescript_types`, salvar a saída sobre `src/lib/database.types.ts`.

Verificar: `variacoes.Row` contém `estoque_anterior: number | null` e `familias.Row` contém `mudanca_estrutural: Json | null`.

- [ ] **Step 4: Build de tipos passa**

Run: `pnpm build`
Expected: sem erros de TypeScript relacionados aos novos campos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/database.types.ts
git commit -m "feat(m4): schema UPDATE (variacoes.estoque_anterior, familias.mudanca_estrutural)"
```

---

## Task 3: Função pura `casarVariacoesUpdate`

Casa as variações do novo lote com as da publicação anterior (por `codigo`) e
extrai a mudança estrutural. Usada pelo `ingest-lote`.

**Files:**
- Create: `supabase/functions/_shared/update/casar.ts`
- Test: `supabase/functions/_shared/update/__tests__/casar.test.ts`

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, it, expect } from 'vitest';
import { casarVariacoesUpdate } from '../casar';

const anteriores = [
  { codigo: '00000101', ml_variation_id: 'V1', cor: 'Azul', ml_picture_id: 'P1', estoque: 5 },
  { codigo: '00000102', ml_variation_id: 'V2', cor: 'Verde', ml_picture_id: 'P2', estoque: 8 },
];

describe('casarVariacoesUpdate', () => {
  it('cor casada herda ml_variation_id, cor, ml_picture_id e snapshot do estoque', () => {
    const r = casarVariacoesUpdate([{ codigo: '00000101' }], anteriores);
    expect(r.herdados['00000101']).toEqual({
      ml_variation_id: 'V1', cor: 'Azul', ml_picture_id: 'P1', estoque_anterior: 5,
    });
  });
  it('cor nova (sem correspondente) herda nulos e vira mudança estrutural', () => {
    const r = casarVariacoesUpdate([{ codigo: '00000999' }], anteriores);
    expect(r.herdados['00000999']).toEqual({
      ml_variation_id: null, cor: null, ml_picture_id: null, estoque_anterior: null,
    });
    expect(r.mudancaEstrutural.novas).toEqual(['00000999']);
  });
  it('cor removida (no anúncio, ausente no lote) entra em removidas', () => {
    const r = casarVariacoesUpdate([{ codigo: '00000101' }], anteriores);
    expect(r.mudancaEstrutural.removidas).toEqual([{ codigo: '00000102', cor: 'Verde' }]);
  });
  it('sem mudança estrutural quando o conjunto de códigos bate', () => {
    const r = casarVariacoesUpdate([{ codigo: '00000101' }, { codigo: '00000102' }], anteriores);
    expect(r.mudancaEstrutural.novas).toEqual([]);
    expect(r.mudancaEstrutural.removidas).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test casar`
Expected: FAIL ("Cannot find module '../casar'").

- [ ] **Step 3: Implementar**

```ts
export interface VarAnterior {
  codigo: string;
  ml_variation_id: string | null;
  cor: string | null;
  ml_picture_id: string | null;
  estoque: number;
}
export interface VarNova { codigo: string; }

export interface Herdado {
  ml_variation_id: string | null;
  cor: string | null;
  ml_picture_id: string | null;
  estoque_anterior: number | null;
}
export interface MudancaEstrutural {
  novas: string[];
  removidas: { codigo: string; cor: string | null }[];
}
export interface ResultadoCasamento {
  herdados: Record<string, Herdado>;
  mudancaEstrutural: MudancaEstrutural;
}

export function casarVariacoesUpdate(
  novas: VarNova[],
  anteriores: VarAnterior[],
): ResultadoCasamento {
  const porCodigo = new Map(anteriores.map((a) => [a.codigo, a]));
  const codigosNovos = new Set(novas.map((n) => n.codigo));

  const herdados: Record<string, Herdado> = {};
  const novasCores: string[] = [];
  for (const n of novas) {
    const ant = porCodigo.get(n.codigo);
    if (ant) {
      herdados[n.codigo] = {
        ml_variation_id: ant.ml_variation_id,
        cor: ant.cor,
        ml_picture_id: ant.ml_picture_id,
        estoque_anterior: ant.estoque,
      };
    } else {
      herdados[n.codigo] = { ml_variation_id: null, cor: null, ml_picture_id: null, estoque_anterior: null };
      novasCores.push(n.codigo);
    }
  }

  const removidas = anteriores
    .filter((a) => !codigosNovos.has(a.codigo))
    .map((a) => ({ codigo: a.codigo, cor: a.cor }));

  return { herdados, mudancaEstrutural: { novas: novasCores, removidas } };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test casar`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/update/
git commit -m "feat(m4): casarVariacoesUpdate (heranca + mudanca estrutural)"
```

---

## Task 4: Função pura `montarVariacoesUpdate`

Monta o `variations[]` do PUT a partir do estado real do anúncio (GET) + estoques
desejados do lote. Garante que toda variação atual é reenviada (não deletar) e
que `price` nunca é incluído (preço preservado).

**Files:**
- Create: `supabase/functions/_shared/ml/atualizar.ts`
- Test: `supabase/functions/_shared/ml/__tests__/atualizar.test.ts`

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, it, expect } from 'vitest';
import { montarVariacoesUpdate } from '../atualizar';

const atuais = [
  { id: 'V1', seller_custom_field: '00000101', available_quantity: 5 },
  { id: 'V2', seller_custom_field: '00000102', available_quantity: 8 },
];

describe('montarVariacoesUpdate', () => {
  it('aplica o estoque novo na variação casada por código', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }]);
    expect(r).toContainEqual({ id: 'V1', available_quantity: 12 });
  });
  it('preserva o estoque atual de variação sem correspondente no lote (cor removida)', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }]);
    expect(r).toContainEqual({ id: 'V2', available_quantity: 8 });
  });
  it('inclui TODAS as variações atuais (nunca deleta por omissão)', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }]);
    expect(r).toHaveLength(2);
  });
  it('nunca inclui price (preço preservado pelo ML)', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }]);
    for (const v of r) expect(v).not.toHaveProperty('price');
  });
  it('cor nova do lote (sem variação atual) não entra no PUT', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000999', estoque: 3 }]);
    const ids = r.map((v) => v.id);
    expect(ids).toEqual(['V1', 'V2']); // só as atuais, nenhuma nova
  });
  it('id numérico do ML é mantido', () => {
    const r = montarVariacoesUpdate([{ id: 123, seller_custom_field: '00000101', available_quantity: 5 }], [{ codigo: '00000101', estoque: 7 }]);
    expect(r[0]).toEqual({ id: 123, available_quantity: 7 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test atualizar`
Expected: FAIL ("Cannot find module '../atualizar'").

- [ ] **Step 3: Implementar**

```ts
export interface MLVariacaoAtual {
  id: string | number;
  seller_custom_field?: string | null;
  available_quantity: number;
}
export interface EstoqueDesejado { codigo: string; estoque: number; }
export interface VariacaoUpdate { id: string | number; available_quantity: number; }

// Reenvia TODAS as variações atuais do anúncio (o ML deleta as omitidas). Só
// available_quantity — sem price, para o ML preservar o preço de venda.
export function montarVariacoesUpdate(
  atuais: MLVariacaoAtual[],
  desejados: EstoqueDesejado[],
): VariacaoUpdate[] {
  const estoquePorCodigo = new Map(desejados.map((d) => [d.codigo, d.estoque]));
  return atuais.map((a) => {
    const codigo = a.seller_custom_field ?? '';
    const novo = estoquePorCodigo.get(codigo);
    return { id: a.id, available_quantity: novo ?? a.available_quantity };
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test atualizar`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ml/atualizar.ts supabase/functions/_shared/ml/__tests__/atualizar.test.ts
git commit -m "feat(m4): montarVariacoesUpdate (PUT so estoque, nunca deleta)"
```

---

## Task 5: Helpers fetch `buscarItemML` + `atualizarItemML`

Espelha o padrão de `criar-item.ts` (erro com `status` anexado). Sem teste
unitário — fetch é validado no bug bash.

**Files:**
- Create: `supabase/functions/_shared/ml/atualizar-item.ts`

- [ ] **Step 1: Implementar**

```ts
import type { MLVariacaoAtual, VariacaoUpdate } from './atualizar.ts';

export interface ItemMLAtual {
  id: string;
  variations: MLVariacaoAtual[];
}

function erroML(status: number, json: unknown): Error {
  const detalhe = (json as { message?: string })?.message ?? JSON.stringify(json);
  const e = new Error(`ML rejeitou (${status}): ${detalhe}`);
  (e as { status?: number }).status = status;
  return e;
}

// Estado real do anúncio: ids + seller_custom_field + estoque de cada variação.
export async function buscarItemML(accessToken: string, itemId: string): Promise<ItemMLAtual> {
  const url = `https://api.mercadolibre.com/items/${itemId}?attributes=id,variations`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await resp.json();
  if (!resp.ok) throw erroML(resp.status, json);
  const variations = (json.variations ?? []).map((v: Record<string, unknown>) => ({
    id: v.id as string | number,
    seller_custom_field: (v.seller_custom_field as string | null) ?? null,
    available_quantity: (v.available_quantity as number) ?? 0,
  }));
  return { id: String(json.id), variations };
}

// Atualiza só as variações (estoque). PUT /items/{id} com variations[].
export async function atualizarItemML(
  accessToken: string,
  itemId: string,
  variations: VariacaoUpdate[],
): Promise<void> {
  const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ variations }),
  });
  if (!resp.ok) throw erroML(resp.status, await resp.json().catch(() => ({})));
}
```

- [ ] **Step 2: Type-check do bundle local**

Run: `pnpm test atualizar` (garante que o import `./atualizar.ts` resolve os tipos reusados)
Expected: PASS (tarefa anterior continua verde; nenhum import quebrado).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ml/atualizar-item.ts
git commit -m "feat(m4): helpers buscarItemML/atualizarItemML (GET+PUT)"
```

---

## Task 6: `enfileirarAtualizacao` na fila

**Files:**
- Modify: `supabase/functions/_shared/queue.ts:38-47`

- [ ] **Step 1: Adicionar a função (após `enfileirarPublicacao`)**

```ts
export async function enfileirarAtualizacao(job: ProcessFamiliaJob): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const target = `${url}/functions/v1/update-familia-ml`;
  const { messageId } = await qstashClient().publishJSON({
    url: target,
    body: job,
    retries: 3,
  });
  return messageId;
}
```

`ProcessFamiliaJob` já tem `familia_id` e `lote_id` (e `listing_type_id?` opcional, não usado no UPDATE). Sem mudança de tipo.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/queue.ts
git commit -m "feat(m4): enfileirarAtualizacao (worker update-familia-ml)"
```

---

## Task 7: Worker `update-familia-ml`

**Files:**
- Create: `supabase/functions/update-familia-ml/index.ts`

- [ ] **Step 1: Implementar o worker**

Estrutura espelhada em `publish-familia-ml`. Reusa `talvezFinalizarLote` (copiar a
função — os workers não compartilham módulo de finalização hoje).

```ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { buscarItemML, atualizarItemML } from '../_shared/ml/atualizar-item.ts';
import { montarVariacoesUpdate } from '../_shared/ml/atualizar.ts';

interface Job { familia_id: string; lote_id: string; }

// Idêntico ao publish-familia-ml: reavalia o status do lote quando o worker some da fila.
async function talvezFinalizarLote(admin: ReturnType<typeof adminClient>, loteId: string): Promise<void> {
  const { data: publicando } = await admin.from('familias')
    .select('id').eq('lote_id', loteId).eq('status', 'publicando');
  if (publicando && publicando.length > 0) return;
  const { data: prontas } = await admin.from('familias')
    .select('id').eq('lote_id', loteId).eq('status', 'pronto');
  const novo = prontas && prontas.length > 0 ? 'revisao' : 'concluido';
  await admin.from('lotes').update({ status: novo }).eq('id', loteId);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  let job: Job;
  try { job = JSON.parse(body); }
  catch { return new Response('Body inválido', { status: 400, headers: corsHeaders }); }

  const admin = adminClient();
  const { data: familia } = await admin.from('familias').select('*').eq('id', job.familia_id).single();
  if (!familia) return new Response('familia não encontrada', { status: 404, headers: corsHeaders });

  try {
    if (!familia.ml_item_id) throw new Error('Família UPDATE sem ml_item_id herdado (400)');

    // Estoques desejados: cores incluídas que casaram com o anúncio (têm ml_variation_id).
    const { data: variacoes } = await admin.from('variacoes')
      .select('codigo, estoque, ml_variation_id')
      .eq('familia_id', job.familia_id)
      .eq('excluida_da_publicacao', false)
      .not('ml_variation_id', 'is', null);
    if (!variacoes || variacoes.length === 0) throw new Error('Nenhuma cor casada para atualizar (400)');

    const token = await getValidAccessToken(familia.user_id);

    // GET estado real → garante reenviar todas as variações (ML deleta as omitidas).
    const atual = await buscarItemML(token, familia.ml_item_id);
    const desejados = variacoes.map((v) => ({ codigo: v.codigo, estoque: v.estoque }));
    const variations = montarVariacoesUpdate(atual.variations, desejados);

    await atualizarItemML(token, familia.ml_item_id, variations);

    await admin.from('familias').update({
      status: 'publicado',
      publicado_em: new Date().toISOString(),
    }).eq('id', job.familia_id);

    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ ml_item_id: familia.ml_item_id, atualizado: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    // 5xx/429: transitório — mantém 'publicando' e relança para o QStash retentar.
    if (status && status >= 500) {
      return new Response(msg, { status: 500, headers: corsHeaders });
    }
    await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
```

Nota de idempotência: o `PUT` de estoque é naturalmente idempotente (reenviar o
mesmo `available_quantity` não tem efeito colateral), então uma re-entrega do
QStash é segura sem checagem extra de status.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/update-familia-ml/index.ts
git commit -m "feat(m4): worker update-familia-ml (GET+PUT so estoque)"
```

---

## Task 8: Roteamento por operação em `publicar-familias`

**Files:**
- Modify: `supabase/functions/publicar-familias/index.ts`

- [ ] **Step 1: Trocar o claim e o enfileiramento**

Substituir o bloco do claim (linhas ~21-42) por: dois claims independentes (CREATE
com `ml_item_id IS NULL`; UPDATE com `ml_item_id IS NOT NULL`) e roteamento por
operação. Importar `enfileirarAtualizacao`.

```ts
import { enfileirarPublicacao, enfileirarAtualizacao } from '../_shared/queue.ts';

// ... dentro do handler, após validar familia_ids e listingType:

  const admin = adminClient();

  // Claim CREATE: 'pronto'/'erro', ainda não publicado.
  const { data: novos, error: errC } = await admin
    .from('familias')
    .update({ status: 'publicando', erro_mensagem: null })
    .in('id', familia_ids)
    .eq('user_id', user.id)
    .eq('operacao', 'CREATE')
    .in('status', ['pronto', 'erro'])
    .is('ml_item_id', null)
    .select('id, lote_id');
  if (errC) return new Response(`Erro no claim CREATE: ${errC.message}`, { status: 500, headers: corsHeaders });

  // Claim UPDATE: 'pronto'/'erro', já publicado (tem ml_item_id herdado).
  const { data: updates, error: errU } = await admin
    .from('familias')
    .update({ status: 'publicando', erro_mensagem: null })
    .in('id', familia_ids)
    .eq('user_id', user.id)
    .eq('operacao', 'UPDATE')
    .in('status', ['pronto', 'erro'])
    .not('ml_item_id', 'is', null)
    .select('id, lote_id');
  if (errU) return new Response(`Erro no claim UPDATE: ${errU.message}`, { status: 500, headers: corsHeaders });

  let enfileiradas = 0;
  let loteId: string | null = null;
  for (const f of novos ?? []) {
    const messageId = await enfileirarPublicacao({ familia_id: f.id, lote_id: f.lote_id, listing_type_id: listingType });
    await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
    loteId = f.lote_id;
    enfileiradas++;
  }
  for (const f of updates ?? []) {
    const messageId = await enfileirarAtualizacao({ familia_id: f.id, lote_id: f.lote_id });
    await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
    loteId = f.lote_id;
    enfileiradas++;
  }
  if (loteId) {
    await admin.from('lotes').update({ status: 'publicando' }).eq('id', loteId);
  }

  return new Response(JSON.stringify({ enfileiradas }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/publicar-familias/index.ts
git commit -m "feat(m4): publicar-familias roteia CREATE/UPDATE por operacao"
```

---

## Task 9: Herança UPDATE no `ingest-lote`

**Files:**
- Modify: `supabase/functions/ingest-lote/index.ts:84-134`

- [ ] **Step 1: Carregar a publicação anterior completa (substituir a query `existentes`)**

Trocar o bloco atual (linhas 84-91) por uma query que traz os campos herdáveis +
variações, e montar um Map por `codigo_pai` (a publicação mais recente vence).

```ts
import { casarVariacoesUpdate, type VarAnterior } from '../_shared/update/casar.ts';

// ... dentro do try, no lugar da query `existentes`:

    const codigosPai = grupos.map((g) => g.codigo_pai);
    const { data: anteriores } = await admin
      .from('familias')
      .select('codigo_pai, ml_item_id, ml_permalink, titulo_ml, descricao_ml, categoria_ml_id, atributos_ml, tipo_aviamento, capa_ml_picture_id, publicado_em, variacoes(codigo, ml_variation_id, cor, ml_picture_id, estoque)')
      .eq('user_id', user.id)
      .in('codigo_pai', codigosPai)
      .not('ml_item_id', 'is', null)
      .order('publicado_em', { ascending: false });

    // Publicação mais recente por codigo_pai.
    const anteriorPorPai = new Map<string, NonNullable<typeof anteriores>[number]>();
    for (const a of anteriores ?? []) {
      if (!anteriorPorPai.has(a.codigo_pai)) anteriorPorPai.set(a.codigo_pai, a);
    }
```

- [ ] **Step 2: Pré-calcular o casamento por grupo UPDATE**

Logo após montar `anteriorPorPai`:

```ts
    // Casamento lote↔anúncio anterior por código (para herança + mudança estrutural).
    const casamentoPorPai = new Map<string, ReturnType<typeof casarVariacoesUpdate>>();
    for (const g of grupos) {
      const ant = anteriorPorPai.get(g.codigo_pai);
      if (!ant) continue; // CREATE
      const varsAnteriores: VarAnterior[] = (ant.variacoes ?? []).map((v) => ({
        codigo: v.codigo,
        ml_variation_id: v.ml_variation_id,
        cor: v.cor,
        ml_picture_id: v.ml_picture_id,
        estoque: v.estoque,
      }));
      const novas = g.variacoes.map((v) => ({ codigo: normalizarCodigo(v.CODIGO) }));
      casamentoPorPai.set(g.codigo_pai, casarVariacoesUpdate(novas, varsAnteriores));
    }
```

- [ ] **Step 3: Montar o insert de famílias com herança (substituir `familiasInsert`)**

```ts
    const familiasInsert = grupos.map((g) => {
      const ant = anteriorPorPai.get(g.codigo_pai);
      if (!ant) {
        // CREATE — comportamento atual.
        return {
          lote_id: lote.id, user_id: user.id, codigo_pai: g.codigo_pai,
          nome_pai: g.nome_pai, descricao_pai: g.descricao_pai, unidade: g.unidade,
          operacao: 'CREATE', status: 'pendente',
          capa_storage_path: matchCapa(g.codigo_pai, lote.imagens_paths) ?? null,
        };
      }
      // UPDATE — herda metadados (exibição) + ml_item_id (publicação); pronto sem IA.
      const cas = casamentoPorPai.get(g.codigo_pai)!;
      return {
        lote_id: lote.id, user_id: user.id, codigo_pai: g.codigo_pai,
        nome_pai: g.nome_pai, descricao_pai: g.descricao_pai, unidade: g.unidade,
        operacao: 'UPDATE', status: 'pronto',
        capa_storage_path: matchCapa(g.codigo_pai, lote.imagens_paths) ?? null,
        ml_item_id: ant.ml_item_id,
        ml_permalink: ant.ml_permalink,
        titulo_ml: ant.titulo_ml,
        descricao_ml: ant.descricao_ml,
        categoria_ml_id: ant.categoria_ml_id,
        atributos_ml: ant.atributos_ml,
        tipo_aviamento: ant.tipo_aviamento,
        capa_ml_picture_id: ant.capa_ml_picture_id,
        mudanca_estrutural: cas.mudancaEstrutural,
      };
    });
```

- [ ] **Step 4: Montar o insert de variações com herança (substituir `variacoesInsert`)**

```ts
    const variacoesInsert = grupos.flatMap((g) => {
      const cas = casamentoPorPai.get(g.codigo_pai); // undefined em CREATE
      return g.variacoes.map((v) => {
        const codigo = normalizarCodigo(v.CODIGO);
        const h = cas?.herdados[codigo];
        return {
          familia_id: familiaPorCodigo.get(g.codigo_pai)!,
          user_id: user.id,
          codigo,
          nome: v.NOME,
          gtin: v.GTIN,
          estoque: v.ESTOQUE,
          preco: v.PRECO,
          peso_gramas: v.PESO_GRAMAS,
          altura_cm: v.ALTURA_CM,
          largura_cm: v.LARGURA_CM,
          comprimento_cm: v.COMPRIMENTO_CM,
          imagem_path: matchImagem(v.CODIGO, lote.imagens_paths) ?? null,
          // UPDATE: herda identidade no ML + cor + snapshot do diff; preço de publicação = planilha.
          ...(cas ? {
            ml_variation_id: h?.ml_variation_id ?? null,
            cor: h?.cor ?? null,
            ml_picture_id: h?.ml_picture_id ?? null,
            estoque_anterior: h?.estoque_anterior ?? null,
            preco_publicacao: v.PRECO,
          } : {}),
        };
      });
    });
```

- [ ] **Step 5: Enfileirar IA só para CREATE (substituir o loop de enfileiramento)**

Garantir que o `.select` do insert de famílias retorna `operacao`:

```ts
    const { data: familiasCriadas, error: famErr } = await admin
      .from('familias')
      .insert(familiasInsert)
      .select('id, codigo_pai, operacao');
    if (famErr || !familiasCriadas) throw new Error(`Insert famílias: ${famErr?.message}`);
```

E o loop:

```ts
    for (const f of familiasCriadas) {
      if (f.operacao !== 'CREATE') continue; // UPDATE já nasce 'pronto', sem IA
      const messageId = await enfileirarFamilia({ familia_id: f.id, lote_id: lote.id });
      await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
    }
```

- [ ] **Step 6: Build + testes de regressão do parser**

Run: `pnpm test parser && pnpm test casar`
Expected: PASS (parser inalterado; casar verde).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/ingest-lote/index.ts
git commit -m "feat(m4): ingest herda anuncio anterior no UPDATE (sem IA) + snapshot/mudanca estrutural"
```

---

## Task 10: Tipos do frontend + adapter

**Files:**
- Modify: `src/lib/tipos-dominio.ts`
- Modify: `src/lib/queries.ts:91-107,216-264`

- [ ] **Step 1: Adicionar campos aos tipos**

Em `tipos-dominio.ts`, no `interface Variacao` (após `excluidaDaPublicacao`):

```ts
  mlVariationId: string | null;
  estoqueAnterior: number | null;
```

Adicionar o tipo de mudança estrutural (perto de `AnaliseMercado`):

```ts
export interface MudancaEstrutural {
  novas: string[];
  removidas: { codigo: string; cor: string | null }[];
}

export function parseMudancaEstrutural(json: unknown): MudancaEstrutural | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const novas = Array.isArray(o.novas) ? o.novas.map(String) : [];
  const removidas = Array.isArray(o.removidas)
    ? o.removidas.map((r) => {
        const x = (r ?? {}) as Record<string, unknown>;
        return { codigo: String(x.codigo ?? ''), cor: x.cor != null ? String(x.cor) : null };
      })
    : [];
  if (novas.length === 0 && removidas.length === 0) return null;
  return { novas, removidas };
}
```

No `interface Familia` (após `mlItemId`):

```ts
  mudancaEstrutural: MudancaEstrutural | null;
```

- [ ] **Step 2: Mapear no adapter**

Em `queries.ts`, importar `parseMudancaEstrutural` e o tipo. No `variacaoFromRow` (após `excluidaDaPublicacao`):

```ts
    mlVariationId: r.ml_variation_id,
    estoqueAnterior: r.estoque_anterior,
```

No `familiaFromRow` (após `mlItemId`):

```ts
    mudancaEstrutural: parseMudancaEstrutural(r.mudanca_estrutural),
```

- [ ] **Step 3: Build passa**

Run: `pnpm build`
Expected: sem erros de TS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tipos-dominio.ts src/lib/queries.ts
git commit -m "feat(m4): tipos/adapter UPDATE (mlVariationId, estoqueAnterior, mudancaEstrutural)"
```

---

## Task 11: `familiaPublicavel` libera UPDATE

**Files:**
- Modify: `src/lib/publicavel.ts`
- Test: `tests/lib/publicavel.test.ts`

- [ ] **Step 1: Escrever os testes novos (e ajustar o que assume UPDATE bloqueado)**

No `tests/lib/publicavel.test.ts`, o helper `cor` precisa dos campos novos; e `fam`
de `mlItemId`/`mudancaEstrutural`. Atualizar os defaults:

```ts
function cor(over: Partial<Variacao>): Variacao {
  return {
    codigo: '00000101', cor: 'Azul', corHex: '#00f', corOrigem: 'descricao',
    corEditadaPeloOperador: false, preco: 10, precoPublicacao: 9, estoque: 5,
    gtin: null, fotoPath: 'u/l/101.jpeg', excluidaDaPublicacao: false,
    mlVariationId: null, estoqueAnterior: null,
    ...over,
  };
}
function fam(over: Partial<Familia>): Familia {
  return {
    id: 'f1', loteId: 'l1', codigoPai: '00000100', titulo: 'LINHA', descricao: 'd',
    operacao: 'CREATE', estrategiaPreco: 'PROPRIO', estrategiaMotivo: '',
    concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null,
    analiseMercado: null, tipoAviamento: 'linha', categoriaMlId: 'MLB270273',
    precoMin: 9, precoMax: 9, precoAbaixo20pc: false, capaStoragePath: null,
    variacoes: [cor({})], status: 'pronto', tokensInput: null, tokensOutput: null,
    custoCentavos: null, tituloEditadoPeloOperador: false,
    descricaoEditadaPeloOperador: false, variacoesSemCor: 0,
    mlPermalink: null, mlItemId: null, erroMensagem: null, mudancaEstrutural: null,
    ...over,
  };
}
```

Trocar o teste antigo `'operação UPDATE não é CREATE-publicável'` por estes:

```ts
  it('UPDATE com ml_item_id e ≥1 cor casada é publicável', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: 'MLB123',
      variacoes: [cor({ mlVariationId: 'V1' })],
    }));
    expect(r.ok).toBe(true);
  });
  it('UPDATE sem ml_item_id bloqueia', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: null,
      variacoes: [cor({ mlVariationId: 'V1' })],
    }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/anúncio|item|publicad/i);
  });
  it('UPDATE sem nenhuma cor casada bloqueia (tudo virou cor nova)', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: 'MLB123',
      variacoes: [cor({ mlVariationId: null })],
    }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/cor.*atualiz|nenhuma cor/i);
  });
  it('UPDATE não exige categoria/foto/preço (já vêm do anúncio)', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: 'MLB123', categoriaMlId: null,
      variacoes: [cor({ mlVariationId: 'V1', fotoPath: undefined, precoPublicacao: null })],
    }));
    expect(r.ok).toBe(true);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test publicavel`
Expected: FAIL (UPDATE ainda bloqueado pelas regras de CREATE).

- [ ] **Step 3: Implementar a bifurcação**

Reescrever `familiaPublicavel`:

```ts
export function familiaPublicavel(familia: Familia): ResultadoPublicavel {
  const motivos: string[] = [];

  // 'erro' é re-publicável (retry após falha); só bloqueia status de processamento.
  if (familia.status !== 'pronto' && familia.status !== 'erro') {
    motivos.push('Ainda em processamento (aguarde ficar "pronta")');
  }

  if (familia.operacao === 'UPDATE') {
    if (!familia.mlItemId) motivos.push('Sem anúncio publicado para atualizar');
    const casadas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao && v.mlVariationId);
    if (casadas.length === 0) {
      motivos.push('Nenhuma cor a atualizar (todas são novas — adicione manualmente no ML)');
    }
    return { ok: motivos.length === 0, motivos };
  }

  // CREATE: regras completas (categoria, cor, foto, preço por cor).
  if (!familia.categoriaMlId) motivos.push('Categoria indefinida');
  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  if (incluidas.length === 0) {
    motivos.push('Nenhuma cor incluída (ao menos 1 obrigatória)');
  }
  for (const v of incluidas) {
    if (!v.cor) motivos.push(`Cor ${v.codigo} sem cor definida`);
    if (!v.fotoPath) motivos.push(`Cor ${v.cor || v.codigo} sem foto`);
    if (!v.precoPublicacao || v.precoPublicacao <= 0) motivos.push(`Cor ${v.cor || v.codigo} sem preço de publicação`);
  }

  return { ok: motivos.length === 0, motivos };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test publicavel`
Expected: PASS (todos, incluindo os de CREATE que já existiam).

- [ ] **Step 5: Commit**

```bash
git add src/lib/publicavel.ts tests/lib/publicavel.test.ts
git commit -m "feat(m4): familiaPublicavel libera UPDATE (regras proprias)"
```

---

## Task 12: UI — diff de estoque + selo de mudança estrutural

**Files:**
- Create: `src/components/diff-estoque.tsx`
- Modify: `src/components/familia-expanded.tsx`
- Modify: `src/components/familia-row.tsx`

- [ ] **Step 1: Criar o componente de diff**

```tsx
import type { Familia } from '@/lib/tipos-dominio';

// UPDATE: mostra, por cor casada, o estoque antes→depois (só as que mudaram),
// e sinaliza cores novas/removidas (mudança estrutural, não aplicada).
export function DiffEstoque({ familia }: { familia: Familia }) {
  if (familia.operacao !== 'UPDATE') return null;

  const mudaram = familia.variacoes.filter(
    (v) => v.mlVariationId && !v.excluidaDaPublicacao && v.estoqueAnterior !== v.estoque,
  );
  const me = familia.mudancaEstrutural;

  return (
    <div className="mb-4 rounded border bg-background p-3">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">
        ATUALIZAÇÃO DE ESTOQUE
      </div>
      {mudaram.length === 0 ? (
        <div className="text-xs text-muted-foreground">Nenhuma mudança de estoque nesta família.</div>
      ) : (
        <ul className="space-y-1 text-sm">
          {mudaram.map((v) => (
            <li key={v.codigo} className="flex items-center gap-2">
              <span className="font-medium">{v.cor || v.codigo}</span>
              <span className="text-muted-foreground">
                estoque {v.estoqueAnterior ?? 0} → {v.estoque}
              </span>
            </li>
          ))}
        </ul>
      )}
      {me && (
        <div className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-800">
          <span className="font-semibold">Mudança estrutural (não aplicada no ML):</span>
          {me.novas.length > 0 && <div>Cores novas (não publicadas): {me.novas.join(', ')}</div>}
          {me.removidas.length > 0 && (
            <div>Cores sumidas da planilha (mantidas no anúncio): {me.removidas.map((r) => r.cor || r.codigo).join(', ')}</div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Renderizar no `familia-expanded`**

Importar e inserir o `DiffEstoque` no topo do conteúdo, logo após a abertura do
`<div className="border-b bg-muted/30 p-4 text-sm">` (antes do bloco da capa):

```tsx
import { DiffEstoque } from '@/components/diff-estoque';
// ...
  return (
    <div className="border-b bg-muted/30 p-4 text-sm">
      <DiffEstoque familia={familia} />
      <div className="mb-4 flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-start">
```

- [ ] **Step 3: Selo compacto no `familia-row`**

No `familia-row.tsx`, dentro do bloco de selos (após o selo de "publicado"),
adicionar um selo de mudança estrutural quando houver:

```tsx
          {familia.mudancaEstrutural && (
            <span
              className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
              title={[
                familia.mudancaEstrutural.novas.length ? `${familia.mudancaEstrutural.novas.length} cor(es) nova(s)` : '',
                familia.mudancaEstrutural.removidas.length ? `${familia.mudancaEstrutural.removidas.length} cor(es) removida(s)` : '',
              ].filter(Boolean).join(' · ')}
            >
              ⚠ mudança estrutural
            </span>
          )}
```

- [ ] **Step 4: Build passa**

Run: `pnpm build`
Expected: sem erros de TS.

- [ ] **Step 5: Commit**

```bash
git add src/components/diff-estoque.tsx src/components/familia-expanded.tsx src/components/familia-row.tsx
git commit -m "feat(m4): UI do UPDATE (diff de estoque + selo mudanca estrutural)"
```

---

## Task 13: Modal só-CREATE + rótulo do relatório

**Files:**
- Modify: `src/pages/Revisao.tsx`

Contexto: o modal de confirmação tem o seletor Clássico/Premium (`listing_type_id`),
que só faz sentido em CREATE. Quando a seleção é **só UPDATE**, ocultar o seletor.

- [ ] **Step 1: Ocultar o seletor Clássico/Premium quando não há CREATE selecionado**

No `Revisao.tsx`, derivar se a seleção tem alguma família CREATE e condicionar o
seletor de tipo de anúncio no modal:

```tsx
// junto das demais derivações da seleção:
const selecaoTemCreate = familias.some(
  (f) => selecionadas.has(f.id) && f.operacao === 'CREATE',
);
```

E no JSX do modal, envolver o seletor Clássico/Premium existente com
`{selecaoTemCreate && ( ... )}` (mantendo o restante do modal — resumo + botão —
inalterado). O `listing_type_id` enviado continua o estado atual; o `publicar-familias`
já o ignora para UPDATE.

- [ ] **Step 2: Rótulo "atualizado" no relatório/linha de família publicada (UPDATE)**

Onde a `FamiliaRow` mostra o selo `✓ publicado`, diferenciar UPDATE:

No `familia-row.tsx`, no texto do link/selo publicado, trocar o rótulo conforme a
operação:

```tsx
// dentro do bloco `publicado &&`, no texto do <a>/<span>:
{familia.operacao === 'UPDATE' ? '✓ atualizado ↗' : '✓ publicado ↗'}
// e na variante <span> sem permalink:
{familia.operacao === 'UPDATE' ? '✓ atualizado' : '✓ publicado'}
```

- [ ] **Step 3: Build passa**

Run: `pnpm build`
Expected: sem erros de TS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Revisao.tsx src/components/familia-row.tsx
git commit -m "feat(m4): modal Classico/Premium so-CREATE + rotulo 'atualizado' no UPDATE"
```

---

## Task 14: Deploy das edges + bug bash com token real

**Files:**
- Nenhum arquivo novo. Deploy via MCP + validação manual.

- [ ] **Step 1: Suite completa verde**

Run: `pnpm test && pnpm build && pnpm lint`
Expected: todos os testes passam; build ok; lint sem novos erros (os 3 warnings benignos pré-existentes seguem).

- [ ] **Step 2: Deploy das edges via MCP**

Deploy via `mcp__supabase-mcp-server__deploy_edge_function` (reescrever imports
`../_shared/` → `./_shared/` no index.ts e empacotar os arquivos `_shared`
importados, preservando os imports relativos internos — padrão já usado no projeto):

- `update-familia-ml` (novo) — inclui `_shared/ml/atualizar.ts`, `_shared/ml/atualizar-item.ts`, `_shared/ml/token.ts` (+ deps), `_shared/queue.ts`, `_shared/supabase.ts`, `_shared/cors.ts`.
- `publicar-familias` (alterado) — inclui `_shared/queue.ts` atualizado.
- `ingest-lote` (alterado) — inclui `_shared/update/casar.ts` + `_shared/parser.ts` + `_shared/queue.ts`.

- [ ] **Step 3: Bug bash com token real (AVILBV)**

Reusar os 2 anúncios do bug bash CREATE (linha #6901096672, fita #6900892156).

1. Editar a planilha de um lote já publicado mudando o **estoque** de 1–2 cores; re-importar pela UI.
2. Confirmar que as famílias entram como **UPDATE**, `status='pronto'`, **sem** custo de IA (sem tokens/custo novos).
3. Na Revisão, conferir o **diff de estoque** por cor (antes→depois) e o selo de mudança estrutural (se aplicável).
4. Selecionar e publicar. Verificar no ML: **estoque atualizado**, **preço/título/fotos intactos**, nenhuma variação deletada.
5. Testar mudança estrutural: planilha com 1 cor nova e 1 cor a menos → confirmar que o ML mantém a cor sumida e ignora a nova, e que ambas aparecem sinalizadas.
6. Testar retry: forçar um erro (ex.: anúncio pausado) → família vai a `erro`, "tentar de novo" reenfileira.

- [ ] **Step 4: Final code review**

Dispatch de um code-reviewer (opus) sobre o conjunto do branch antes de finalizar
(authoring/review separados — regra do projeto). Corrigir achados 🔴/🟠.

- [ ] **Step 5: Atualizar docs vivos**

- `docs/TASKS.md`: marcar a Publicação UPDATE ✅.
- `docs/ROADMAP.md`: refletir o avanço do M4.
- `CLAUDE.md`: linha de status + entrada no histórico (data 2026-06-04) resumindo o bloco UPDATE e as versões deployadas das edges.

- [ ] **Step 6: Commit final**

```bash
git add docs/TASKS.md docs/ROADMAP.md CLAUDE.md
git commit -m "docs(m4): Publicacao UPDATE concluida (plano + bug bash)"
```

---

## Notas de execução

- **Confirmar com o Diego antes de cada `git push`** e antes do deploy das edges via MCP (regra do projeto / preferência registrada).
- **TDD:** funções puras (Tasks 3, 4, 11) seguem RED→GREEN→commit. Workers/edges e UI cosmética não têm teste unitário (validados no bug bash), conforme convenção do projeto.
- **Idempotência:** o `PUT` de estoque é naturalmente idempotente; re-entrega do QStash é segura.
- **Não deletar variação:** a regra do ML (omitir = deletar) é coberta por `montarVariacoesUpdate` reenviar todas as variações do `GET` — Task 4 tem teste explícito disso.
```
