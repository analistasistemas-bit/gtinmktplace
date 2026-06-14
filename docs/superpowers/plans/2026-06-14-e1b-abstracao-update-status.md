# E1b — Abstração UPDATE + status via ChannelConnector — Implementation Plan

> **For agentic workers:** refactor que preserva 100% do comportamento. Religa `update-familia-ml` e `status-publicados` para falarem com o ML **através do `ChannelConnector`** (ADR-0024), espelhando o que o E1 fez no CREATE. Steps usam checkbox para tracking.

**Goal:** Levar o conector para os dois pontos que o E1 adiou de propósito (UPDATE de anúncio + leitura de status), fechando a Fase 0 (camada de abstração) antes do E2.

**Architecture:** O conector ganha três métodos novos — `atualizarAnuncio` (encapsula GET estado → montar variações/novas → PUT → refetch → casar), `sincronizarDescricao` (resolve a descrição ao vivo e dá push) e `lerStatus` (batch GET /items + parse). Os workers param de importar `_shared/ml` diretamente para o I/O de canal e passam a usar `getConnector('mercado_livre')` + `ContextoCanal`. A orquestração de banco (ler variações, subir fotos, persistir `ml_variation_id`/descrição, limpeza de cache no erro) **permanece no worker** — mesma divisão de responsabilidades do E1.

**Tech Stack:** Deno Edge Functions (Supabase) + TypeScript; testes Vitest (`pnpm test`).

**Princípio inegociável:** comportamento idêntico. Nada de adicionar features (ex.: o retry de foto transiente no UPDATE continua **fora** — é follow-up separado). Cada caminho de erro, idempotência e efeito colateral é preservado byte-a-byte na semântica.

---

## File Structure

- **Modificar** `supabase/functions/_shared/canais/contrato.ts` — novos tipos `StatusCanal`, `AtualizacaoCanonica`, `ResultadoAtualizacao`; campo `status?` em `ErroCanal`; três métodos novos na interface `ChannelConnector`.
- **Modificar** `supabase/functions/_shared/canais/mapeamento.ts` — helper puro `mapearVariacoesPorSku` (sem fallback por índice — UPDATE casa só por `seller_custom_field`); `classificarErroCanal` passa a preencher `status`.
- **Modificar** `supabase/functions/_shared/canais/mercado-livre.ts` — implementar `atualizarAnuncio`, `sincronizarDescricao`, `lerStatus` (delegando a `atualizar-item`/`atualizar`/`criar-item`/`status`/`pacote`).
- **Modificar** `supabase/functions/update-familia-ml/index.ts` — religar via `conn.atualizarAnuncio`/`conn.sincronizarDescricao`/`conn.subirFoto`.
- **Modificar** `supabase/functions/status-publicados/index.ts` — religar via `conn.lerStatus`.
- **Modificar/criar** `supabase/functions/_shared/canais/__tests__/mapeamento.test.ts` — testes de `mapearVariacoesPorSku` + `classificarErroCanal.status`.

---

### Task 1: Contrato — tipos e métodos novos

**Files:** Modify `supabase/functions/_shared/canais/contrato.ts`

- [ ] **Step 1:** Adicionar `status?: number` a `ErroCanal` (recupera o HTTP status para o worker decidir retry, sem garimpar `raw`).
- [ ] **Step 2:** Adicionar os tipos canônicos:

```ts
/** Status do anúncio no modelo canônico (generaliza StatusParsed de ml/status). */
export type StatusAnuncioCanal =
  | 'ativo' | 'pausado' | 'encerrado' | 'moderado' | 'inativo' | 'indisponivel';
export interface StatusCanal {
  status: StatusAnuncioCanal;
  motivo: string | null;
  estoque: number | null;
  preco: number | null;
}

/** Atualização de um anúncio já publicado (UPDATE), no modelo canônico. */
export interface AtualizacaoCanonica {
  itemExternoId: string;
  /** Cores já vinculadas (repor estoque): sku → estoque desejado. */
  existentes: Array<{ sku: string; estoque: number }>;
  /** Cores novas a criar como variação. */
  novas: VariacaoCanonica[];
  capaFotoId: string | null;
  capa2FotoId: string | null;
  capa3FotoId: string | null;
  categoriaId: string | null;
  /** BRAND a sincronizar (do fornecedor). null → não envia (preserva). */
  marca: string | null;
  dimensoes: DimensoesPacote | null;
  /** Desconto ativo → price+original_price por código. */
  desconto: { pct: number; precoPorCodigo: Record<string, number | null> } | null;
  /** Preço de publicação da família, propagado a TODAS as variações (adendo ADR-0016). */
  precoFamilia: number | null;
}

/** Resultado do UPDATE: sku → id externo da variação (casar/persistir + detectar não-vinculadas). */
export interface ResultadoAtualizacao {
  variacoesExternas: Record<string, string>;
}
```

- [ ] **Step 3:** Adicionar à interface `ChannelConnector`:

```ts
  /** Atualiza um anúncio existente (estoque/cores novas/preço/descrição-recurso à parte). Não lança. */
  atualizarAnuncio(ctx: ContextoCanal, a: AtualizacaoCanonica): Promise<ResultadoCanal<ResultadoAtualizacao>>;
  /** Sincroniza a descrição ao vivo (resolve+push). Retorna a descrição a persistir, ou null se nada mudou. */
  sincronizarDescricao(ctx: ContextoCanal, itemExternoId: string, descricaoAtual: string, cores: string[]): Promise<string | null>;
  /** Lê o status de N anúncios em lote. Lança se o token falhar (sem credencial). */
  lerStatus(ctx: ContextoCanal, itemExternoIds: string[]): Promise<Record<string, StatusCanal>>;
```

- [ ] **Step 4:** `pnpm tsc -p tsconfig.json --noEmit` (ou o check do projeto) deve falhar agora em `mercado-livre.ts` (interface não implementada) — esperado; segue a Task 3.

---

### Task 2: Mapeamento — `mapearVariacoesPorSku` + `status` no erro (TDD)

**Files:** Modify `supabase/functions/_shared/canais/mapeamento.ts`, `supabase/functions/_shared/canais/__tests__/mapeamento.test.ts`

- [ ] **Step 1 (RED):** Adicionar testes:

```ts
import { mapearVariacoesPorSku } from '../mapeamento.ts';

describe('mapearVariacoesPorSku', () => {
  it('casa só por seller_custom_field (sem fallback por índice)', () => {
    const vars = [
      { id: 111, seller_custom_field: 'A1' },
      { id: 222, seller_custom_field: 'A2' },
      { id: 333 }, // sem custom field → ignorada (UPDATE não casa por índice)
    ];
    expect(mapearVariacoesPorSku(vars)).toEqual({ A1: '111', A2: '222' });
  });
  it('lista vazia → objeto vazio', () => {
    expect(mapearVariacoesPorSku([])).toEqual({});
  });
});

// no describe('classificarErroCanal'):
it('preenche o status HTTP no erro', () => {
  const e = Object.assign(new Error('x'), { status: 400 });
  expect(classificarErroCanal(e).status).toBe(400);
});
```

- [ ] **Step 2 (RED run):** `pnpm test -- mapeamento` → falha (função/campo inexistentes).
- [ ] **Step 3 (GREEN):** Implementar:

```ts
/** Casa variações por seller_custom_field (UPDATE). Sem fallback por índice:
 *  no UPDATE as contagens (atuais vs novas) divergem, então índice não é confiável. */
export function mapearVariacoesPorSku(
  variations: Array<{ id: string | number; seller_custom_field?: string | null }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of variations) {
    const sku = v.seller_custom_field;
    if (sku) out[sku] = String(v.id);
  }
  return out;
}
```

E em `classificarErroCanal`, acrescentar `status` ao objeto retornado:

```ts
  return { codigo: 'DESCONHECIDO', mensagemOperador, retentavel, status, raw: e };
```

- [ ] **Step 4 (GREEN run):** `pnpm test -- mapeamento` → verde.
- [ ] **Step 5:** Commit.

---

### Task 3: Conector ML — implementar os três métodos

**Files:** Modify `supabase/functions/_shared/canais/mercado-livre.ts`

- [ ] **Step 1:** Imports novos:

```ts
import { buscarItemML, atualizarItemML } from '../ml/atualizar-item.ts';
import { montarVariacoesUpdate, montarVariacaoNova } from '../ml/atualizar.ts';
import { buscarDescricaoML, garantirDescricaoML, resolverDescricaoUpdate } from '../ml/criar-item.ts';
import { montarAtributosPacote } from '../ml/pacote.ts';
import { parseStatusML, type ItemMLStatus } from '../ml/status.ts';
import { mapearVariacoesExternas, mapearVariacoesPorSku, classificarErroCanal } from './mapeamento.ts';
import type {
  ChannelConnector, ContextoCanal, AnuncioCanonico, ResultadoCanal, RefAnuncio,
  AtualizacaoCanonica, ResultadoAtualizacao, StatusCanal,
} from './contrato.ts';
```

- [ ] **Step 2:** `atualizarAnuncio` — porta exata das linhas 116–202 do worker atual (GET → montar → PUT → refetch → casar), sem persistência de banco:

```ts
  async atualizarAnuncio(ctx, a): Promise<ResultadoCanal<ResultadoAtualizacao>> {
    const token = await ctx.getToken();
    try {
      const atual = await buscarItemML(token, a.itemExternoId);
      const desejados = a.existentes.map((e) => ({ codigo: e.sku, estoque: e.estoque }));
      const comuns = [a.capa2FotoId, a.capa3FotoId].filter((x): x is string => !!x);
      const picsPorCodigo: Record<string, string[]> = {};
      if (comuns.length > 0) {
        for (const av of atual.variations) {
          const codigo = av.seller_custom_field ?? '';
          const atuaisPics = av.picture_ids ?? [];
          picsPorCodigo[codigo] = [...new Set(
            [atuaisPics[0], ...comuns, ...atuaisPics.slice(1)].filter((x): x is string => !!x),
          )];
        }
      }
      const existentes = montarVariacoesUpdate(
        atual.variations, desejados,
        comuns.length > 0 ? picsPorCodigo : undefined,
        a.desconto ?? undefined, a.precoFamilia,
      );
      const novasPut = a.novas.map((v) => montarVariacaoNova(
        { codigo: v.sku, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco, gtin: v.gtin, ml_picture_id: v.fotoId },
        a.capaFotoId, a.capa2FotoId, a.capa3FotoId, a.categoriaId,
        a.desconto ? { pct: a.desconto.pct } : null,
      ));
      const atributosItem = [
        ...(a.marca ? [{ id: 'BRAND', value_name: a.marca }] : []),
        ...(a.dimensoes ? montarAtributosPacote(a.dimensoes) : []),
      ];
      const novasPicIds = novasPut.flatMap((v) => v.picture_ids);
      const precisaPictures = novasPut.length > 0 || comuns.length > 0;
      const pictures = precisaPictures
        ? [...new Set([...atual.pictures, ...comuns, ...novasPicIds])]
        : undefined;
      const resultado = await atualizarItemML(token, a.itemExternoId, [...existentes, ...novasPut], atributosItem, pictures);
      let varsParaCasar = resultado.variations;
      if (a.novas.length > 0) {
        const refetch = await buscarItemML(token, a.itemExternoId);
        varsParaCasar = refetch.variations;
      }
      return { ok: true, valor: { variacoesExternas: mapearVariacoesPorSku(varsParaCasar) } };
    } catch (e) {
      return { ok: false, erro: classificarErroCanal(e) };
    }
  },
```

- [ ] **Step 3:** `sincronizarDescricao` — porta das linhas 210–220 (sem o `familia.descricao_ml` guard, que fica no worker):

```ts
  async sincronizarDescricao(ctx, itemExternoId, descricaoAtual, cores): Promise<string | null> {
    const token = await ctx.getToken();
    const live = await buscarDescricaoML(token, itemExternoId);
    const r = resolverDescricaoUpdate(descricaoAtual, cores, live);
    if (!r?.precisaPush) return null;
    await garantirDescricaoML(token, itemExternoId, r.novaDescricao);
    return r.novaDescricao !== descricaoAtual ? r.novaDescricao : null;
  },
```

- [ ] **Step 4:** `lerStatus` — porta do `status-publicados` (chunk 20, paralelo, parse). `chunk` como helper de módulo:

```ts
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
// ...
  async lerStatus(ctx, ids): Promise<Record<string, StatusCanal>> {
    const token = await ctx.getToken();
    const respostas = await Promise.all(chunk(ids, 20).map(async (bloco) => {
      const url = `https://api.mercadolibre.com/items?ids=${bloco.join(',')}&attributes=id,status,sub_status,available_quantity,price`;
      try {
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) { console.warn(`lerStatus ML ${resp.status} (bloco)`); return []; }
        const arr = await resp.json();
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        console.warn('lerStatus ML falhou (bloco):', (e as Error).message);
        return [];
      }
    }));
    const porId = new Map<string, ItemMLStatus | null>();
    for (const entry of respostas.flat()) {
      const body = entry?.body; const id = body?.id;
      if (entry?.code === 200 && id) porId.set(id, body as ItemMLStatus);
      else if (id) porId.set(id, null);
    }
    const out: Record<string, StatusCanal> = {};
    for (const id of ids) out[id] = parseStatusML(porId.get(id) ?? null);
    return out;
  },
```

- [ ] **Step 5:** `pnpm test` (suite `_shared` verde) + `pnpm tsc --noEmit` (conector implementa a interface).
- [ ] **Step 6:** Commit.

---

### Task 4: Religar `update-familia-ml`

**Files:** Modify `supabase/functions/update-familia-ml/index.ts`

- [ ] **Step 1:** Trocar imports de I/O de canal por `getConnector` + tipos do contrato. Manter `getValidAccessToken` (para o `ctx`), `pctEfetivo`, `enfileirarVinculacaoCatalogo`, `verificarAssinatura`, `adminClient`, `corsHeaders`. Remover `buscarItemML/atualizarItemML`, `montarVariacoesUpdate/montarVariacaoNova`, `buscarDescricaoML/garantirDescricaoML/resolverDescricaoUpdate`, `montarAtributosPacote`, `subirFotoML`.
- [ ] **Step 2:** Logo após carregar a `familia`: `const conn = getConnector('mercado_livre'); const ctx = { getToken: () => getValidAccessToken(familia.user_id) };`
- [ ] **Step 3:** Trocar os `subirFotoML(token, url)` por `conn.subirFoto(ctx, url)` (cores novas + capa2 + capa3). Remover a obtenção explícita de `token` (não é mais usada fora do conector; `signed()` usa `admin.storage`, não token).
- [ ] **Step 4:** Substituir o bloco GET→montar→PUT→casar (linhas ~116–202) por:

```ts
    const marca = (familia.fornecedor as string | null)?.trim() || null;
    const repUpd = variacoes.find((v) => v.codigo === familia.variacao_principal_codigo) ?? variacoes[0];
    const dimensoesUpd = repUpd ? {
      altura_cm: repUpd.altura_cm != null ? Number(repUpd.altura_cm) : null,
      largura_cm: repUpd.largura_cm != null ? Number(repUpd.largura_cm) : null,
      comprimento_cm: repUpd.comprimento_cm != null ? Number(repUpd.comprimento_cm) : null,
      peso_gramas: repUpd.peso_gramas != null ? Number(repUpd.peso_gramas) : null,
    } : null;
    const precoFamiliaRaw = variacoes.find((v) => v.preco_publicacao != null)?.preco_publicacao;
    const precoFamilia = precoFamiliaRaw != null ? Number(precoFamiliaRaw) : null;

    const res = await conn.atualizarAnuncio(ctx, {
      itemExternoId: familia.ml_item_id,
      existentes: casadas.map((v) => ({ sku: v.codigo, estoque: v.estoque })),
      novas: novasComFoto.map((v) => ({
        sku: v.codigo, cor: v.cor, estoque: v.estoque,
        preco: v.preco_publicacao, gtin: v.gtin, fotoId: v.ml_picture_id,
      })),
      capaFotoId: (familia.capa_ml_picture_id as string | null) ?? null,
      capa2FotoId: capa2Pic, capa3FotoId: capa3Pic,
      categoriaId: familia.categoria_ml_id as string | null,
      marca, dimensoes: dimensoesUpd,
      desconto, precoFamilia,
    });
    if (!res.ok) {
      const e = res.erro!;
      const err = new Error(e.mensagemOperador);
      (err as { status?: number }).status = e.status; // 5xx/429 → catch retenta; senão erro+limpeza
      throw err;
    }

    // Casa o ml_variation_id das cores novas (idempotente). Detecta as não-vinculadas.
    const persistidas = new Set<string>();
    for (const [codigo, variationId] of Object.entries(res.valor!.variacoesExternas)) {
      if (novasComFoto.some((v) => v.codigo === codigo)) {
        await admin.from('variacoes').update({ ml_variation_id: variationId })
          .eq('familia_id', job.familia_id).eq('codigo', codigo);
        persistidas.add(codigo);
      }
    }
    const novasSemVinculo = novasComFoto.filter((v) => !persistidas.has(v.codigo));
    if (novasSemVinculo.length > 0) {
      throw new Error(`ML não vinculou as cores novas ${novasSemVinculo.map((v) => v.codigo).join(', ')} (sem seller_custom_field). Elas podem ter sido criadas no anúncio — confira no ML antes de republicar para não duplicar (400)`);
    }
```

- [ ] **Step 5:** Substituir o bloco de descrição (linhas ~210–220) por:

```ts
    if (familia.descricao_ml) {
      const cores = [...new Set(variacoes.map((v) => v.cor).filter((c): c is string => !!c))];
      const nova = await conn.sincronizarDescricao(ctx, familia.ml_item_id, familia.descricao_ml as string, cores);
      if (nova) {
        await admin.from('familias').update({ descricao_ml: nova }).eq('id', job.familia_id);
      }
    }
```

- [ ] **Step 6:** Manter intactos: split `casadas`/`novas`, upload de fotos + persistência de `ml_picture_id`/`capa2_ml_picture_id`/`capa3_ml_picture_id` + flags `capa2SubidaAgora`/`capa3SubidaAgora`, o bloco `desconto`, a transição `status='publicado'`, `enfileirarVinculacaoCatalogo`, `talvezFinalizarLote`, e **todo o `catch`** (5xx/429→500; senão erro + limpeza dos caches de foto efêmeros).
- [ ] **Step 7:** `pnpm test` verde + `pnpm tsc --noEmit` limpo + `pnpm lint` 0 errors.
- [ ] **Step 8:** Commit.

---

### Task 5: Religar `status-publicados`

**Files:** Modify `supabase/functions/status-publicados/index.ts`

- [ ] **Step 1:** Remover `parseStatusML`/`ItemMLStatus`/`chunk` e o fetch manual. Imports: manter `requireUser`, `getValidAccessToken`, `adminClient`; adicionar `getConnector` + `type { StatusCanal }`.
- [ ] **Step 2:** Substituir o corpo pós-`ids` por:

```ts
  const conn = getConnector('mercado_livre');
  const ctx = { getToken: () => getValidAccessToken(user.id) };
  let statusPorId: Record<string, StatusCanal>;
  try {
    statusPorId = await conn.lerStatus(ctx, ids);
  } catch {
    return new Response(JSON.stringify({ semCredencialML: true, itens: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const itens = ids.map((id) => ({ ml_item_id: id, ...statusPorId[id] }));
  return new Response(JSON.stringify({ itens }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
```

- [ ] **Step 3:** Manter o early-return `ids.length === 0`. `pnpm test` + `pnpm tsc --noEmit` + `pnpm lint` verdes.
- [ ] **Step 4:** Commit.

---

### Task 6: Review separado + verificação

- [ ] **Step 1:** Dispatch `code-reviewer` (passe separado — nunca auto-aprovar) focado em "comportamento idêntico ao anterior": cada caminho de erro/idempotência/efeito colateral do `update-familia-ml` e `status-publicados` preservado.
- [ ] **Step 2:** Corrigir achados; re-review se necessário.
- [ ] **Step 3:** `pnpm test` (suite inteira verde) + `pnpm tsc --noEmit` + `pnpm lint` (0 errors) + `pnpm build`.
- [ ] **Step 4:** Deploy via CLcompleta dos workers afetados: `update-familia-ml`, `status-publicados` (verify_jwt preservado: `update` = false, `status-publicados` = true). Conferir bundle.
- [ ] **Step 5:** Bug bash real no browser (com OK implícito do goal): (a) **reposição de estoque** numa família publicada; (b) **cor nova** num anúncio existente (cria variação + casa id + atualiza seção de cores). Conferir tela "Publicados" (lerStatus) refletindo status ao vivo.
- [ ] **Step 6:** Limpeza do que for de teste; merge → `main` + push; deploy final; atualizar `TASKS.md` (E1b ✅) + histórico do `CLAUDE.md`.
