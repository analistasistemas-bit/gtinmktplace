# Cor nova publicável no UPDATE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que uma cor nova (SKU filho ausente do anúncio publicado) seja adicionada como variação nova no mesmo anúncio do ML, com seleção opt-in, reusando o enriquecimento de cor/foto/atributos do CREATE — junto com a reposição de estoque das cores existentes.

**Architecture:** O `ingest-lote` insere a cor nova desmarcada (`excluida_da_publicacao=true`) e, se a família UPDATE tiver cor nova, enfileira o `process-familia` em modo parcial (resolve a cor só das novas, sem copy/concorrência/categoria). O worker `update-familia-ml` faz um único `PUT /items/{id}` que atualiza as variações existentes (com `id`, só estoque) e cria as novas incluídas (sem `id`, com COLOR/preço/foto/GTIN), persistindo o `ml_variation_id` retornado. Cor removida continua só sinalizada.

**Tech Stack:** Supabase Edge Functions (Deno/TS), Postgres, QStash, React + Vite + TanStack Query, vitest. Edges deployadas via MCP `supabase-mcp-server`. Sem coluna nova (reusa `excluida_da_publicacao`, `ml_variation_id`, `cor`, `imagem_path`, `ml_picture_id`, `preco_publicacao`, `mudanca_estrutural`).

**Spec:** `docs/superpowers/specs/2026-06-04-m4-update-cor-nova-design.md`

---

## File Structure

**Criar:**
- (nenhum arquivo novo — só estende existentes e testes)

**Modificar:**
- `docs/decisions/0016-publicacao-update-reposicao-estoque.md` — adendo (cor nova publicável).
- `supabase/functions/_shared/ml/publicar.ts` — `export` em `gtinAusente` (reuso).
- `supabase/functions/_shared/ml/atualizar.ts` — `montarVariacaoNova` (pura) + tipo do array misto do PUT.
- `supabase/functions/_shared/ml/__tests__/atualizar.test.ts` — testes de `montarVariacaoNova`.
- `supabase/functions/_shared/ml/atualizar-item.ts` — `atualizarItemML` retorna as variations (para casar ids das novas).
- `supabase/functions/update-familia-ml/index.ts` — separa casadas/novas, sobe foto, PUT misto, persiste `ml_variation_id`.
- `supabase/functions/ingest-lote/index.ts` — cor nova `excluida_da_publicacao=true`; enfileira `process-familia` quando há cor nova; senão `pronto`.
- `supabase/functions/process-familia/index.ts` — ramo UPDATE parcial (resolve cor só das novas).
- `src/lib/publicavel.ts` — UPDATE publicável com cor nova válida (cor+foto).
- `tests/lib/publicavel.test.ts` — casos de cor nova.
- `src/components/familia-expanded.tsx` — marcador "nova" ao lado do checkbox da variação.
- `src/components/diff-estoque.tsx` — texto: cor nova = "marque para publicar"; removida = sinalização.

---

## Task 1: Adendo ao ADR-0016

**Files:**
- Modify: `docs/decisions/0016-publicacao-update-reposicao-estoque.md`

- [ ] **Step 1: Acrescentar a seção de adendo ao final do ADR**

Adicionar ao fim do arquivo:

```markdown

---

## Adendo (2026-06-04) — Cor nova publicável

A decisão original (item 3) tratava cor nova como "apenas sinalizada". Refinamento
a pedido do Diego: a **cor nova passa a ser publicável (opt-in)**.

- A cor nova aparece na Revisão **desmarcada** (`excluida_da_publicacao=true`); o
  operador marca para adicioná-la como **variação nova no anúncio existente**.
- O nome da cor é resolvido só para as cores novas, na ordem do [ADR-0004]
  (descrição/nome primeiro; Vision apenas como fallback). Implementado por um
  `process-familia` em **modo parcial** que não mexe nos campos herdados.
- Foto obrigatória (igual CREATE); preço da cor nova = preço da planilha.
- O worker faz um único `PUT /items/{id}` que **cria** as variações sem `id` e
  **atualiza** as com `id` no mesmo request.
- **Cor removida continua apenas sinalizada** (não deleta) — inalterado.
```

- [ ] **Step 2: Commit**

```bash
git add docs/decisions/0016-publicacao-update-reposicao-estoque.md
git commit -m "docs(m4): adendo ADR-0016 (cor nova publicavel no UPDATE)"
```

---

## Task 2: Função pura `montarVariacaoNova`

Monta o objeto de uma variação **nova** (sem `id`) para o PUT, reusando a regra de
GTIN do CREATE. Espelha a montagem de variação de `montarPayloadItem`.

**Files:**
- Modify: `supabase/functions/_shared/ml/publicar.ts` (exportar `gtinAusente`)
- Modify: `supabase/functions/_shared/ml/atualizar.ts`
- Test: `supabase/functions/_shared/ml/__tests__/atualizar.test.ts`

- [ ] **Step 1: Exportar `gtinAusente` em `publicar.ts`**

Em `supabase/functions/_shared/ml/publicar.ts`, trocar a declaração:

```ts
function gtinAusente(gtin: string | null): boolean {
```

por:

```ts
export function gtinAusente(gtin: string | null): boolean {
```

(Nenhuma outra mudança no arquivo.)

- [ ] **Step 2: Escrever os testes de `montarVariacaoNova`**

Acrescentar ao final de `supabase/functions/_shared/ml/__tests__/atualizar.test.ts`:

```ts
import { montarVariacaoNova } from '../atualizar';

const corNova = {
  codigo: '00000777', cor: 'Vermelho', estoque: 9,
  preco_publicacao: 12.5, gtin: '7891234567890', ml_picture_id: 'PICNOVA',
};

describe('montarVariacaoNova', () => {
  it('monta COLOR, estoque, preço, picture_ids e seller_custom_field, sem id', () => {
    const v = montarVariacaoNova(corNova, null, 'MLB270273');
    expect(v).not.toHaveProperty('id');
    expect(v.attribute_combinations).toEqual([{ id: 'COLOR', value_name: 'Vermelho' }]);
    expect(v.available_quantity).toBe(9);
    expect(v.price).toBe(12.5);
    expect(v.picture_ids).toEqual(['PICNOVA']);
    expect(v.seller_custom_field).toBe('00000777');
  });
  it('a capa entra como 1ª foto da variação nova', () => {
    const v = montarVariacaoNova(corNova, 'CAPA1', 'MLB270273');
    expect(v.picture_ids).toEqual(['CAPA1', 'PICNOVA']);
  });
  it('GTIN EAN válido vira atributo GTIN', () => {
    const v = montarVariacaoNova(corNova, null, 'MLB270273');
    expect(v.attributes).toEqual([{ id: 'GTIN', value_name: '7891234567890' }]);
  });
  it('sem GTIN em categoria que aceita → EMPTY_GTIN_REASON', () => {
    const v = montarVariacaoNova({ ...corNova, gtin: null }, null, 'MLB270273');
    expect(v.attributes).toEqual([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]);
  });
  it('GTIN interno 3000* → EMPTY_GTIN_REASON', () => {
    const v = montarVariacaoNova({ ...corNova, gtin: '30009999' }, null, 'MLB270273');
    expect(v.attributes).toEqual([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]);
  });
  it('sem GTIN em categoria sem suporte (botão MLB270272) → sem atributo de GTIN', () => {
    const v = montarVariacaoNova({ ...corNova, gtin: null }, null, 'MLB270272');
    expect(v.attributes).toBeUndefined();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test atualizar`
Expected: FAIL (`montarVariacaoNova` não existe).

- [ ] **Step 4: Implementar `montarVariacaoNova` em `atualizar.ts`**

Acrescentar ao topo de `supabase/functions/_shared/ml/atualizar.ts`:

```ts
import { gtinAusente } from './publicar.ts';
import { EMPTY_GTIN_REASON_SEM_CODIGO, categoriaAceitaEmptyGtinReason } from '../categoria/atributos.ts';

export interface AtributoVar { id: string; value_name?: string; value_id?: string; }
export interface CorNovaInput {
  codigo: string;
  cor: string | null;
  estoque: number;
  preco_publicacao: number | null;
  gtin: string | null;
  ml_picture_id: string | null;
}
export interface VariacaoNovaPut {
  attribute_combinations: AtributoVar[];
  available_quantity: number;
  price: number;
  picture_ids: string[];
  attributes?: AtributoVar[];
  seller_custom_field: string;
}

// Variação nova (sem id) para o PUT — o ML cria. Reusa a regra de GTIN do CREATE
// (publicar.ts): GTIN ausente/3000* → EMPTY_GTIN_REASON nas categorias que aceitam.
export function montarVariacaoNova(
  v: CorNovaInput,
  capaPictureId: string | null,
  categoriaMlId: string | null,
): VariacaoNovaPut {
  const pics = [
    ...(capaPictureId ? [capaPictureId] : []),
    ...(v.ml_picture_id ? [v.ml_picture_id] : []),
  ];
  const variation: VariacaoNovaPut = {
    attribute_combinations: [{ id: 'COLOR', value_name: v.cor ?? '' }],
    available_quantity: v.estoque,
    price: v.preco_publicacao ?? 0,
    picture_ids: [...new Set(pics)],
    seller_custom_field: v.codigo,
  };
  if (gtinAusente(v.gtin)) {
    if (categoriaAceitaEmptyGtinReason(categoriaMlId)) {
      variation.attributes = [{ id: 'EMPTY_GTIN_REASON', value_id: EMPTY_GTIN_REASON_SEM_CODIGO }];
    }
  } else {
    variation.attributes = [{ id: 'GTIN', value_name: v.gtin! }];
  }
  return variation;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test atualizar`
Expected: PASS (6 testes antigos de `montarVariacoesUpdate` + 6 novos de `montarVariacaoNova`).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ml/publicar.ts supabase/functions/_shared/ml/atualizar.ts supabase/functions/_shared/ml/__tests__/atualizar.test.ts
git commit -m "feat(m4): montarVariacaoNova (variacao nova p/ PUT, reusa GTIN do CREATE)"
```

---

## Task 3: `atualizarItemML` retorna as variations

A criação de variação nova precisa do `ml_variation_id` que o ML gera. O `PUT /items`
retorna o item; expomos as variations para o worker casar e persistir.

**Files:**
- Modify: `supabase/functions/_shared/ml/atualizar-item.ts`

- [ ] **Step 1: Ampliar `atualizarItemML`**

Substituir a função `atualizarItemML` por (e ajustar o tipo do array para aceitar
itens existentes e novos):

```ts
import type { MLVariacaoAtual, VariacaoUpdate, VariacaoNovaPut } from './atualizar.ts';

export interface ResultadoUpdate {
  variations: Array<{ id: string | number; seller_custom_field?: string | null }>;
}

// Atualiza variações existentes (com id, só estoque) e cria as novas (sem id).
// Retorna as variations do item (com ids) para casar as novas por seller_custom_field.
export async function atualizarItemML(
  accessToken: string,
  itemId: string,
  variations: Array<VariacaoUpdate | VariacaoNovaPut>,
): Promise<ResultadoUpdate> {
  const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ variations }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw erroML(resp.status, json);
  return { variations: (json as { variations?: ResultadoUpdate['variations'] }).variations ?? [] };
}
```

(O import existente `import type { MLVariacaoAtual, VariacaoUpdate } from './atualizar.ts';`
passa a incluir `VariacaoNovaPut`. `buscarItemML` e `erroML` ficam inalterados.)

- [ ] **Step 2: Sanidade dos tipos**

Run: `pnpm test atualizar`
Expected: PASS (sem regressão; tipos resolvem).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ml/atualizar-item.ts
git commit -m "feat(m4): atualizarItemML retorna variations (p/ persistir id das novas)"
```

---

## Task 4: Worker `update-familia-ml` cria as cores novas

**Files:**
- Modify: `supabase/functions/update-familia-ml/index.ts`

- [ ] **Step 1: Reescrever o corpo do `try` para tratar casadas + novas**

Trocar os imports do topo:

```ts
import { buscarItemML, atualizarItemML } from '../_shared/ml/atualizar-item.ts';
import { montarVariacoesUpdate, montarVariacaoNova } from '../_shared/ml/atualizar.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { subirFotoML } from '../_shared/ml/fotos.ts';
```

E substituir o bloco interno do `try` (da carga de variações até o `PUT` e persistência) por:

```ts
    if (!familia.ml_item_id) throw new Error('Família UPDATE sem ml_item_id herdado (400)');

    // Cores incluídas: casadas (têm ml_variation_id) repõem estoque; novas (sem
    // ml_variation_id) são criadas como variação. Excluídas ficam de fora.
    const { data: variacoes } = await admin.from('variacoes')
      .select('codigo, cor, estoque, preco_publicacao, gtin, imagem_path, ml_picture_id, ml_variation_id')
      .eq('familia_id', job.familia_id)
      .eq('excluida_da_publicacao', false);
    if (!variacoes || variacoes.length === 0) throw new Error('Nenhuma cor incluída para atualizar (400)');

    const casadas = variacoes.filter((v) => v.ml_variation_id);
    const novas = variacoes.filter((v) => !v.ml_variation_id);
    if (casadas.length === 0 && novas.length === 0) throw new Error('Nada a publicar (400)');

    const token = await getValidAccessToken(familia.user_id);

    const BUCKET = 'imagens';
    const TTL_SIGNED = 60 * 60 * 2;
    async function signed(path: string): Promise<string> {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SIGNED);
      if (error || !data) throw new Error(`Signed URL falhou para ${path}`);
      return data.signedUrl;
    }

    // Sobe a foto das cores novas (idempotente via ml_picture_id).
    const novasComFoto = [];
    for (const v of novas) {
      let picId = v.ml_picture_id as string | null;
      if (!picId && v.imagem_path) {
        picId = await subirFotoML(token, await signed(v.imagem_path));
        await admin.from('variacoes').update({ ml_picture_id: picId }).eq('familia_id', job.familia_id).eq('codigo', v.codigo);
      }
      novasComFoto.push({ ...v, ml_picture_id: picId });
    }

    // GET estado real → reenviar todas as variações (ML deleta as omitidas).
    const atual = await buscarItemML(token, familia.ml_item_id);
    const desejados = casadas.map((v) => ({ codigo: v.codigo, estoque: v.estoque }));
    const existentes = montarVariacoesUpdate(atual.variations, desejados);

    const capaPic = (familia.capa_ml_picture_id as string | null) ?? null;
    const novasPut = novasComFoto.map((v) => montarVariacaoNova(
      { codigo: v.codigo, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco_publicacao, gtin: v.gtin, ml_picture_id: v.ml_picture_id },
      capaPic,
      familia.categoria_ml_id as string | null,
    ));

    const resultado = await atualizarItemML(token, familia.ml_item_id, [...existentes, ...novasPut]);

    // Persiste o ml_variation_id das novas (casa por seller_custom_field).
    for (const mv of resultado.variations) {
      const codigo = mv.seller_custom_field;
      if (codigo && novasComFoto.some((v) => v.codigo === codigo)) {
        await admin.from('variacoes').update({ ml_variation_id: String(mv.id) })
          .eq('familia_id', job.familia_id).eq('codigo', codigo);
      }
    }

    await admin.from('familias').update({
      status: 'publicado',
      publicado_em: new Date().toISOString(),
    }).eq('id', job.familia_id);

    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ ml_item_id: familia.ml_item_id, atualizado: true, novas: novasPut.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
```

Mantém: a verificação de assinatura, o guard de idempotência (`status !== 'publicando'`),
`talvezFinalizarLote`, e o `catch` (5xx/429 → 500; senão `erro`). Removida a checagem
antiga `.not('ml_variation_id','is',null)` na query (agora carregamos todas as incluídas).

- [ ] **Step 2: Sanidade**

Run: `pnpm test`
Expected: PASS (suite inteira; o worker não tem teste unitário, mas nada deve quebrar).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/update-familia-ml/index.ts
git commit -m "feat(m4): worker UPDATE cria cores novas (foto + PUT misto + persiste ml_variation_id)"
```

---

## Task 5: `ingest-lote` — cor nova desmarcada + process parcial

**Files:**
- Modify: `supabase/functions/ingest-lote/index.ts`

- [ ] **Step 1: Cor nova entra desmarcada no `variacoesInsert`**

No `variacoesInsert` (ramo UPDATE), marcar a cor nova como excluída. A cor nova é a que
**não** tem herança (`h?.ml_variation_id` é null). Ajustar o spread do ramo `cas`:

```ts
          // UPDATE: herda identidade no ML + cor + snapshot do diff; preço de publicação = planilha.
          ...(cas ? {
            ml_variation_id: h?.ml_variation_id ?? null,
            cor: h?.cor ?? null,
            ml_picture_id: h?.ml_picture_id ?? null,
            estoque_anterior: h?.estoque_anterior ?? null,
            preco_publicacao: v.PRECO,
            // Cor nova (sem variação no anúncio) entra DESMARCADA (opt-in).
            excluida_da_publicacao: h?.ml_variation_id == null,
          } : {}),
```

(Para cor casada, `h.ml_variation_id` existe → `excluida_da_publicacao=false`, default. Para
cor nova → `true`.)

- [ ] **Step 2: Enfileirar `process-familia` parcial quando a família UPDATE tem cor nova**

No `familiasInsert`, o ramo UPDATE hoje fixa `status: 'pronto'`. Trocar para `pendente`
quando houver cor nova (precisa resolver a cor):

```ts
      // UPDATE — herda metadados (exibição) + ml_item_id (publicação).
      const cas = casamentoPorPai.get(g.codigo_pai)!;
      const temCorNova = cas.mudancaEstrutural.novas.length > 0;
      return {
        lote_id: lote.id, user_id: user.id, codigo_pai: g.codigo_pai,
        nome_pai: g.nome_pai, descricao_pai: g.descricao_pai, unidade: g.unidade,
        operacao: 'UPDATE',
        // Com cor nova: 'pendente' p/ o process-familia resolver a cor das novas (ADR-0004).
        // Sem cor nova: 'pronto' direto, sem IA.
        status: temCorNova ? 'pendente' : 'pronto',
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
```

E no loop de enfileiramento, hoje só enfileira CREATE. Trocar para enfileirar também as
UPDATE que ficaram `pendente`:

```ts
    for (const f of familiasCriadas) {
      if (f.status !== 'pendente') continue; // só processa quem precisa de IA (CREATE + UPDATE c/ cor nova)
      const messageId = await enfileirarFamilia({ familia_id: f.id, lote_id: lote.id });
      await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
    }
```

Para isso o `.select` do insert precisa retornar `status`:

```ts
    const { data: familiasCriadas, error: famErr } = await admin
      .from('familias')
      .insert(familiasInsert)
      .select('id, codigo_pai, operacao, status');
    if (famErr || !familiasCriadas) throw new Error(`Insert famílias: ${famErr?.message}`);
```

- [ ] **Step 3: Sanidade (regressão do ingest e parser)**

Run: `pnpm test`
Expected: PASS (incluindo `tests/edge/ingest-lote.test.ts`, se exercitar UPDATE; o comportamento CREATE e a herança seguem).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/ingest-lote/index.ts
git commit -m "feat(m4): ingest marca cor nova desmarcada + enfileira process parcial p/ resolver cor"
```

---

## Task 6: `process-familia` — ramo UPDATE parcial

Resolve a cor **só das variações sem cor** (as novas) e marca `pronto`, sem tocar nos
campos herdados (título/descrição/categoria/concorrência/mercado).

**Files:**
- Modify: `supabase/functions/process-familia/index.ts`

- [ ] **Step 1: Trazer `operacao` no claim**

No claim atômico (`.update({ status: 'processando' })... .select(...)`), incluir `operacao`:

```ts
    .select('id, user_id, nome_pai, descricao_pai, lote_id, operacao')
```

- [ ] **Step 2: Ramo UPDATE após persistir as cores**

O fluxo atual resolve cor (passo 3) e persiste (passo 4: `updatesVar`), depois segue para
copy/concorrência/etc. Inserir, **logo após o `await Promise.all(updatesVar);`** (passo 4),
um early-return para UPDATE:

```ts
    // UPDATE parcial: a família herdou título/descrição/categoria/concorrência do anúncio
    // anterior; aqui só precisávamos resolver a cor das cores novas (feito acima). Não roda
    // copy/concorrência/categoria/mercado. Marca pronto e encerra.
    if (claimed.operacao === 'UPDATE') {
      await admin.from('familias').update({ status: 'pronto' }).eq('id', job.familia_id);
      return new Response('OK (update parcial)', { status: 200, headers: corsHeaders });
    }
```

A cadeia de cor já segue o ADR-0004 (passo 3): `extrairCorDoTexto` (nome do filho +
nome/descrição do pai) → cache Redis → Vision só se houver foto e o texto não resolveu.
As cores casadas já vêm com `cor` preenchida (herdada), então o passo 3 as ignora
(`if (v.cor) return v`) e só trabalha as novas.

- [ ] **Step 3: Sanidade**

Run: `pnpm test`
Expected: PASS (sem regressão; CREATE segue o fluxo completo).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/process-familia/index.ts
git commit -m "feat(m4): process-familia ramo UPDATE parcial (resolve cor das novas, ADR-0004)"
```

---

## Task 7: `familiaPublicavel` — UPDATE com cor nova

**Files:**
- Modify: `src/lib/publicavel.ts`
- Test: `tests/lib/publicavel.test.ts`

- [ ] **Step 1: Escrever os testes novos**

Acrescentar a `tests/lib/publicavel.test.ts` (o helper `cor` já tem `mlVariationId`/`estoqueAnterior`):

```ts
  it('UPDATE publica cor nova válida (com cor e foto)', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: 'MLB123',
      variacoes: [cor({ codigo: '00000777', cor: 'Vermelho', mlVariationId: null, fotoPath: 'u/l/777.jpeg' })],
    }));
    expect(r.ok).toBe(true);
  });
  it('UPDATE bloqueia cor nova incluída sem foto', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: 'MLB123',
      variacoes: [cor({ codigo: '00000777', cor: 'Vermelho', mlVariationId: null, fotoPath: undefined })],
    }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/foto/i);
  });
  it('UPDATE bloqueia cor nova incluída sem cor definida', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: 'MLB123',
      variacoes: [cor({ codigo: '00000777', cor: '', mlVariationId: null, fotoPath: 'u/l/777.jpeg' })],
    }));
    expect(r.ok).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/cor/i);
  });
  it('UPDATE publicável misto: 1 cor casada (reposição) + 1 cor nova válida', () => {
    const r = familiaPublicavel(fam({
      operacao: 'UPDATE', mlItemId: 'MLB123',
      variacoes: [
        cor({ codigo: '00000101', mlVariationId: 'V1' }),
        cor({ codigo: '00000777', cor: 'Vermelho', mlVariationId: null, fotoPath: 'u/l/777.jpeg' }),
      ],
    }));
    expect(r.ok).toBe(true);
  });
```

Os testes UPDATE já existentes (cor casada publicável; sem ml_item_id bloqueia) continuam
válidos. Ajustar o teste `'UPDATE sem nenhuma cor casada bloqueia (tudo virou cor nova)'`:
com a nova regra, cor nova **válida** torna publicável. Trocar o caso para cor nova
**inválida** (sem foto) garantir o bloqueio — já coberto pelo teste de "sem foto" acima;
**remover** o teste antigo `'UPDATE sem nenhuma cor casada bloqueia'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test publicavel`
Expected: FAIL (cor nova ainda não é considerada publicável).

- [ ] **Step 3: Implementar a regra de cor nova no ramo UPDATE**

Substituir o ramo UPDATE de `familiaPublicavel`:

```ts
  if (familia.operacao === 'UPDATE') {
    if (!familia.mlItemId) motivos.push('Sem anúncio publicado para atualizar');
    const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
    const casadas = incluidas.filter((v) => v.mlVariationId);
    const novas = incluidas.filter((v) => !v.mlVariationId);
    if (casadas.length === 0 && novas.length === 0) {
      motivos.push('Nenhuma cor selecionada para atualizar');
    }
    // Cor nova vira variação no anúncio → exige cor + foto + preço (igual CREATE).
    for (const v of novas) {
      if (!v.cor) motivos.push(`Cor nova ${v.codigo} sem cor definida`);
      if (!v.fotoPath) motivos.push(`Cor nova ${v.cor || v.codigo} sem foto`);
      if (!v.precoPublicacao || v.precoPublicacao <= 0) motivos.push(`Cor nova ${v.cor || v.codigo} sem preço`);
    }
    return { ok: motivos.length === 0, motivos };
  }
```

(O bloco CREATE abaixo permanece inalterado.)

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test publicavel`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/publicavel.ts tests/lib/publicavel.test.ts
git commit -m "feat(m4): familiaPublicavel aceita cor nova valida no UPDATE (cor+foto)"
```

---

## Task 8: Frontend — marcador "nova" + textos do diff

**Files:**
- Modify: `src/components/familia-expanded.tsx`
- Modify: `src/components/diff-estoque.tsx`

- [ ] **Step 1: Marcador "nova" ao lado do checkbox da variação (UPDATE)**

Em `src/components/familia-expanded.tsx`, no map das variações (onde está o `<Checkbox ... />`
e o `<VariacaoCard />`), adicionar um selo quando a família é UPDATE e a variação é nova
(`!v.mlVariationId`). Inserir logo após o `<Checkbox>`:

```tsx
                {familia.operacao === 'UPDATE' && !v.mlVariationId && (
                  <span className="mt-2 shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                    nova
                  </span>
                )}
```

(A cor nova já vem desmarcada porque `excluida_da_publicacao=true` foi gravado no ingest;
o checkbox existente reflete isso e persiste a inclusão ao marcar.)

- [ ] **Step 2: Diferenciar novas (publicáveis) de removidas no `diff-estoque.tsx`**

Em `src/components/diff-estoque.tsx`, no bloco de mudança estrutural, trocar o texto das
"novas" para refletir que agora são publicáveis (marque na lista), mantendo "removidas"
como sinalização:

```tsx
      {me && (
        <div className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-800">
          <span className="font-semibold">Mudança estrutural:</span>
          {me.novas.length > 0 && (
            <div>Cores novas (marque "incluir" na lista para publicá-las): {me.novas.join(', ')}</div>
          )}
          {me.removidas.length > 0 && (
            <div>Cores sumidas da planilha (mantidas no anúncio, não removidas): {me.removidas.map((r) => r.cor || r.codigo).join(', ')}</div>
          )}
        </div>
      )}
```

- [ ] **Step 3: Build + testes**

Run: `pnpm build && pnpm test`
Expected: PASS / build sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/familia-expanded.tsx src/components/diff-estoque.tsx
git commit -m "feat(m4): UI marca cor nova publicavel no UPDATE (selo 'nova' + texto do diff)"
```

---

## Task 9: Deploy + bug bash + docs

**Files:**
- Nenhum arquivo novo. Deploy via MCP + validação manual + docs vivos.

- [ ] **Step 1: Suite completa verde**

Run: `pnpm test && pnpm build && pnpm lint`
Expected: testes passam; build ok; lint sem novos erros (3 warnings benignos pré-existentes).

- [ ] **Step 2: Deploy das edges via MCP** (confirmar com o Diego antes)

Via `mcp__supabase-mcp-server__deploy_edge_function` (imports `../_shared/`→`./_shared/` no
index; empacotar os `_shared` importados; `verify_jwt:false`):

- `update-familia-ml` — inclui `_shared/ml/atualizar.ts` (com `montarVariacaoNova`), `_shared/ml/atualizar-item.ts`, `_shared/ml/publicar.ts`, `_shared/categoria/atributos.ts` (+ `detectar.ts`), `_shared/ml/fotos.ts`, `_shared/ml/token.ts` (+ deps), `_shared/queue.ts`, `_shared/supabase.ts`, `_shared/cors.ts`.
- `ingest-lote` — inclui `_shared/update/casar.ts`, `_shared/parser.ts`, `_shared/queue.ts`, etc.
- `process-familia` — versão com o ramo UPDATE parcial (inclui as deps de IA/cor já existentes).

- [ ] **Step 3: Bug bash com token real (AVILBV)**

1. Re-importar uma família publicada (ex.: LINHA `00449253`) **adicionando 1 cor nova** (novo `CODIGO` com `PAI=449253`) **com foto** (`00CODIGO.jpeg` no lote).
2. Confirmar: a família entra UPDATE, fica `pendente` e o `process-familia` resolve a cor da nova (descrição → Vision); volta a `pronto`.
3. Na Revisão: a cor nova aparece com selo **"nova"** e checkbox **desmarcado**; marque para incluir.
4. Publicar. Verificar no ML: a **variação nova foi criada** no anúncio (com cor/foto/preço), e as variações existentes seguem com preço/título/fotos intactos; nenhuma deletada.
5. Validar o caso misto (cor nova + reposição de estoque numa cor existente) num único PUT.
6. Confirmar que **cor removida** continua só sinalizada (não some do ML).

- [ ] **Step 4: Final code review**

Dispatch de um code-reviewer (opus) sobre o conjunto do bloco (cor nova) — authoring/review
separados. Corrigir achados 🔴/🟠.

- [ ] **Step 5: Atualizar docs vivos**

- `docs/TASKS.md`: Publicação UPDATE — cor nova ✅.
- `CLAUDE.md`: linha de status + entrada no histórico (2026-06-04) resumindo a extensão e as versões das edges.

- [ ] **Step 6: Commit final**

```bash
git add docs/TASKS.md CLAUDE.md
git commit -m "docs(m4): cor nova publicavel no UPDATE concluida (plano + bug bash)"
```

---

## Notas de execução

- **Confirmar com o Diego antes de cada `git push`** e antes do deploy das edges via MCP.
- **TDD:** funções puras (Tasks 2, 7) seguem RED→GREEN→commit. Workers/edges e UI cosmética validados no bug bash.
- **Não deletar variação:** o PUT continua reenviando todas as variações reais do GET (Task 4 reusa `montarVariacoesUpdate`); as novas são acrescentadas (sem `id`).
- **Preço:** existentes sem `price` (preservado); cor nova com `price` da planilha (obrigatório para criar).
- **Cadeia de cor (ADR-0004):** descrição/nome primeiro, Vision só como fallback — reaproveitada no ramo parcial; sem custo extra quando a cor está no texto.
- **A confirmar no bug bash:** o `PUT /items/{id}` cria variações sem `id` e atualiza as com `id` no mesmo request, e retorna `variations` com os ids gerados.
