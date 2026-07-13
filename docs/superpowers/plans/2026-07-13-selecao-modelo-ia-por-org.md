# Seleção de modelo de IA (texto e imagem) por organização — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que cada organização escolha (na tela Configurações, restrito a admin) qual modelo de IA usar para texto (padrão `openai/gpt-4o-mini` + opção `deepseek/deepseek-v4-flash`) e reservar um seletor de modelo de imagem (`google/gemini-2.5-flash-image`, dormente — sem consumidor ainda), tudo via OpenRouter.

**Architecture:** Nova coluna `ai_model_texto`/`ai_model_imagem` na tabela `configuracoes` já existente (RLS admin-only já cobre). Um helper novo (`resolverModeloTexto`) resolve o slug efetivo (config da org → fallback env `MODELO_COPY`) e é chamado nos 5 pontos onde a IA de texto é hoje invocada; cada um passa o slug resolvido para as 4 funções core, que passam a aceitar `modelo` como parâmetro opcional em vez de usar a constante hardcoded. Frontend replica o padrão existente (fetch/upsert por org + hook + seção na tela) já usado por alíquotas/desconto/Telegram.

**Tech Stack:** Supabase (Postgres + Edge Functions Deno), React/TypeScript, TanStack Query, shadcn/ui `Select`, Vitest.

**Referência:** [ADR-0074](../../decisions/0074-selecao-de-modelo-ia-por-organizacao.md)

---

## Antes de começar

Este plano roda no worktree `.worktrees/worktree-selecao-modelo-ia-por-org` (branch `worktree-selecao-modelo-ia-por-org`), já criado, com `.env.local` copiado e baseline verificada: **179 arquivos de teste, 1427 testes passando**.

`supabase db push` (Task 1) aplica uma migration no banco remoto compartilhado — **só rode depois que Diego autorizar** (mesmo padrão de sempre: branch → Diego valida → push só sob OK). Todas as outras tasks são só arquivo local; commitar é seguro a qualquer momento no branch.

---

### Task 1: Migration — colunas de modelo de IA em `configuracoes`

**Files:**
- Create: `supabase/migrations/20260713120000_ai_model_por_org.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- ============================================================================
-- Migration: ai_model_por_org
-- Refs: ADR-0074. Seleção de modelo de IA (texto/imagem) por organização.
-- ============================================================================

alter table public.configuracoes
  add column if not exists ai_model_texto text,
  add column if not exists ai_model_imagem text;

-- Lista curada e fechada (evita custo-fantasma: todo slug aqui precisa existir em
-- _shared/ai/tokens.ts::PRECOS quando for de texto). Estender exige nova migration.
alter table public.configuracoes
  add constraint configuracoes_ai_model_texto_check
    check (ai_model_texto is null or ai_model_texto in ('openai/gpt-4o-mini', 'deepseek/deepseek-v4-flash'));

alter table public.configuracoes
  add constraint configuracoes_ai_model_imagem_check
    check (ai_model_imagem is null or ai_model_imagem in ('google/gemini-2.5-flash-image'));

comment on column public.configuracoes.ai_model_texto is
  'Slug OpenRouter do modelo de texto da org (ADR-0074). NULL = usa fallback do env (MODELO_COPY).';
comment on column public.configuracoes.ai_model_imagem is
  'Slug OpenRouter do modelo de imagem da org (ADR-0074). Dormente: sem consumidor até a geração de imagem ser implementada.';
```

- [ ] **Step 2: Validar localmente**

Run: `cd "/Users/diego/Desktop/IA/Anuncios MktPlace/.worktrees/worktree-selecao-modelo-ia-por-org" && supabase migration list --linked`
Expected: a nova migration aparece como pendente só no lado local (não aplicada ainda).

- [ ] **Step 3: Aplicar (só com autorização de Diego)**

Run: `supabase db push` — **pausar aqui e confirmar com Diego antes de rodar.**
Depois: `npm run db:check` — deve terminar sem reportar divergência.

- [ ] **Step 4: Regenerar tipos TypeScript**

Run: `supabase gen types typescript --linked --schema public > src/lib/database.types.ts`
Expected: diff em `database.types.ts` mostrando `ai_model_texto`/`ai_model_imagem` na tabela `configuracoes`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260713120000_ai_model_por_org.sql src/lib/database.types.ts
git commit -m "feat(db): adiciona ai_model_texto/ai_model_imagem em configuracoes (ADR-0074)"
```

---

### Task 2: Backend — preço do DeepSeek em `PRECOS`

**Files:**
- Modify: `supabase/functions/_shared/ai/tokens.ts`
- Test: `supabase/functions/_shared/ai/__tests__/tokens.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `tokens.test.ts` (antes do fechamento do `describe`):

```ts
  it('calcula o custo real do deepseek/deepseek-v4-flash (referência por 1M tokens)', () => {
    // 1M input = $0.09 = 9 centavos
    expect(custoCentavos('deepseek/deepseek-v4-flash', { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBe(9);
    // 1M output = $0.18 = 18 centavos
    expect(custoCentavos('deepseek/deepseek-v4-flash', { prompt_tokens: 0, completion_tokens: 1_000_000 })).toBe(18);
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm test tokens.test.ts`
Expected: FAIL — `expect(received).toBe(9)` recebe `0` (modelo não está em `PRECOS`).

- [ ] **Step 3: Implementar**

Em `tokens.ts`, adicionar ao dict `PRECOS`:

```ts
const PRECOS: Record<string, PrecoModelo> = {
  'openai/gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'openai/gpt-4o': { input: 0.0025, output: 0.01 },
  // DeepSeek V4 Flash (ADR-0074): $0.09/1M in · $0.18/1M out.
  'deepseek/deepseek-v4-flash': { input: 0.00009, output: 0.00018 },
};
```

Nota: `google/gemini-2.5-flash-image` **não** entra aqui ainda — sem consumidor (dormente), entraria como dead code. Entra junto com a implementação da geração de imagem.

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm test tokens.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/tokens.ts supabase/functions/_shared/ai/__tests__/tokens.test.ts
git commit -m "feat(ia): adiciona preco do deepseek/deepseek-v4-flash em PRECOS (ADR-0074)"
```

---

### Task 3: Backend — helper `resolverModeloTexto`

**Files:**
- Modify: `supabase/functions/_shared/ai/modelos.ts`
- Create: `supabase/functions/_shared/ai/__tests__/modelos.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// supabase/functions/_shared/ai/__tests__/modelos.test.ts
import { describe, it, expect } from 'vitest';
import { resolverModeloTexto, MODELO_COPY } from '../modelos.ts';

// Fake client mínimo — só a chain usada por resolverModeloTexto (mesmo padrão de
// notificacoes/__tests__/config.test.ts).
function fakeClient(aiModelTexto: string | null) {
  return {
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { ai_model_texto: aiModelTexto }, error: null }),
      };
      return chain;
    },
  } as any;
}

describe('resolverModeloTexto', () => {
  it('devolve o slug configurado pela org quando presente', async () => {
    const client = fakeClient('deepseek/deepseek-v4-flash');
    expect(await resolverModeloTexto(client, 'org-1')).toBe('deepseek/deepseek-v4-flash');
  });

  it('cai no fallback MODELO_COPY quando a org não configurou (null)', async () => {
    const client = fakeClient(null);
    expect(await resolverModeloTexto(client, 'org-1')).toBe(MODELO_COPY);
  });

  it('cai no fallback MODELO_COPY quando a linha não existe (maybeSingle → null)', async () => {
    const client = {
      from: () => {
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
        return chain;
      },
    } as any;
    expect(await resolverModeloTexto(client, 'org-sem-config')).toBe(MODELO_COPY);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm test modelos.test.ts`
Expected: FAIL — `resolverModeloTexto` não existe (`is not a function` / erro de import).

- [ ] **Step 3: Implementar**

Reescrever `supabase/functions/_shared/ai/modelos.ts`:

```ts
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const MODELO_COPY = Deno.env.get('AI_MODEL_COPY') ?? 'openai/gpt-4o-mini';
export const MODELO_VISION = Deno.env.get('AI_MODEL_VISION') ?? 'openai/gpt-4o';

/**
 * Resolve o modelo de texto efetivo da org (ADR-0074): configuracoes.ai_model_texto
 * quando presente, senão o fallback MODELO_COPY (env var, comportamento pré-existente).
 */
export async function resolverModeloTexto(client: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await client
    .from('configuracoes')
    .select('ai_model_texto')
    .eq('org_id', orgId)
    .maybeSingle();
  return data?.ai_model_texto ?? MODELO_COPY;
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm test modelos.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/modelos.ts supabase/functions/_shared/ai/__tests__/modelos.test.ts
git commit -m "feat(ia): adiciona resolverModeloTexto (config por org, fallback env) (ADR-0074)"
```

---

### Task 4: Backend — as 4 funções core aceitam `modelo` opcional

**Files:**
- Modify: `supabase/functions/_shared/ai/copywriter.ts`
- Modify: `supabase/functions/_shared/ai/atributos-llm.ts`
- Modify: `supabase/functions/_shared/ai/categoria-llm.ts`
- Modify: `supabase/functions/_shared/ai/resposta-pergunta.ts`

Nenhum teste novo aqui — os testes existentes de `atributos-llm-core`, `titulo-clamp-metragem` etc. não tocam essas funções de rede diretamente; o comportamento default (sem passar `modelo`) precisa continuar idêntico, então a verificação é a suíte inteira permanecer verde (Step final desta task).

- [ ] **Step 1: `copywriter.ts` — thread `modelo` por `chamarCopy`/`gerarCopy`**

```ts
// chamarCopy: adicionar 2º parâmetro
async function chamarCopy(input: InputCopy, modelo: string): Promise<OutputCopy> {
  const client = openrouterClient();
  const resp = await client.chat.completions.create(
    {
      model: modelo,
      // ... resto igual
    },
    { signal: AbortSignal.timeout(30_000) },
  );
  // ...
  return {
    // ...
    custo_centavos: custoCentavos(modelo, usage),
  };
}

// gerarCopy: aceita modelo opcional, default MODELO_COPY (compat com callers existentes)
export async function gerarCopy(input: InputCopy, modelo: string = MODELO_COPY): Promise<OutputCopy> {
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      return await chamarCopy(input, modelo);
    } catch (e) {
      // ... resto igual
    }
  }
  // ... resto igual
}
```

- [ ] **Step 2: `atributos-llm.ts` — thread `modelo` por `desempatarAtributosLLM`**

```ts
export async function desempatarAtributosLLM(
  input: InputAtributos,
  alvos: AtributoAlvo[],
  modelo: string = MODELO_COPY,
): Promise<Record<string, string>> {
  if (alvos.length === 0) return {};
  try {
    const client = openrouterClient();
    const resp = await client.chat.completions.create({
      model: modelo,
      // ... resto igual
    });
    // ... resto igual
  } catch (e) {
    // ... resto igual
  }
}
```

- [ ] **Step 3: `categoria-llm.ts` — thread `modelo` por `desempatarCategoriaLLM`**

```ts
export async function desempatarCategoriaLLM(
  input: InputCategoria,
  candidatos: CategoriaCandidata[],
  modelo: string = MODELO_COPY,
): Promise<string | null | undefined> {
  if (candidatos.length === 0) return undefined;
  try {
    const client = openrouterClient();
    const resp = await client.chat.completions.create({
      model: modelo,
      // ... resto igual
    });
    // ... resto igual
  } catch (e) {
    // ... resto igual
  }
}
```

- [ ] **Step 4: `resposta-pergunta.ts` — thread `modelo` por `sugerirResposta`**

```ts
export async function sugerirResposta(input: InputSugestao, modelo: string = MODELO_COPY): Promise<string> {
  // ... monta `user` igual
  const client = openrouterClient();
  const resp = await client.chat.completions.create(
    {
      model: modelo,
      // ... resto igual
    },
    { signal: AbortSignal.timeout(30_000) },
  );
  // ... resto igual
}
```

- [ ] **Step 5: Rodar a suíte inteira**

Run: `pnpm test`
Expected: PASS (179 arquivos, 1427 testes — mesma baseline; nenhum teste deveria ter quebrado, já que `modelo` tem default `MODELO_COPY`).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ai/copywriter.ts supabase/functions/_shared/ai/atributos-llm.ts supabase/functions/_shared/ai/categoria-llm.ts supabase/functions/_shared/ai/resposta-pergunta.ts
git commit -m "refactor(ia): as 4 funcoes de IA-texto aceitam modelo opcional (default MODELO_COPY) (ADR-0074)"
```

---

### Task 5: Backend — os 5 pontos de chamada resolvem e passam o modelo

**Files:**
- Modify: `supabase/functions/process-familia/index.ts`
- Modify: `supabase/functions/definir-categoria-familia/index.ts`
- Modify: `supabase/functions/regenerar-copy-familia/index.ts`
- Modify: `supabase/functions/sugerir-resposta-pergunta/index.ts`
- Modify: `supabase/functions/_shared/split/titulo-particao.ts`
- Modify: `supabase/functions/publicar-split-ml/index.ts`

- [ ] **Step 1: `process-familia/index.ts`** — já tem `orgId` (linha ~72) e `admin` (linha ~54)

Adicionar import e resolver 1x, logo após a linha `const conexao = await resolverConexao(admin, orgId, 'mercado_livre');`:

```ts
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';
// ...
const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
const modeloTexto = await resolverModeloTexto(admin, orgId);
```

Passar `modeloTexto` nas 3 chamadas de IA-texto já existentes:

```ts
// 5. Copywriter
const copy = await gerarCopy({ /* ... igual ... */ }, modeloTexto);

// 5c. Categoria — llm é uma referência fixa de 2 args (input, candidatos); envolver em closure
const cat = await resolverCategoria(
  { /* ... igual ... */ },
  {
    preditor: (q) => (token ? buscarCategoriaPreditor(token, q) : Promise.resolve([])),
    llm: (input, candidatos) => desempatarCategoriaLLM(input, candidatos, modeloTexto),
  },
);

// preencherAtributosClosedSet — 4º parâmetro é a mesma assinatura fixa (input, alvos)
atributosMl = await preencherAtributosClosedSet(
  schema, atributosMl,
  { nome: claimed.nome_pai, descricao: claimed.descricao_pai ?? undefined },
  (input, alvos) => desempatarAtributosLLM(input, alvos, modeloTexto),
);

// resolverAtributosGenericos — mesmo padrão de closure no campo llm
const r = await resolverAtributosGenericos(
  categoriaMlId,
  { /* ... igual ... */ },
  {
    lerSchema: (id) => { /* ... igual ... */ },
    llm: (input, alvos) => desempatarAtributosLLM(input, alvos, modeloTexto),
  },
  marcaPadrao,
);
```

- [ ] **Step 2: `definir-categoria-familia/index.ts`** — já tem `orgId` (via `requireUserOrg`) e `adminClient()`

```ts
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';
// ...
// logo após `let orgId: string; try { ({ orgId } = await requireUserOrg(req)); } catch (...) { ... }`
const modeloTexto = await resolverModeloTexto(adminClient(), orgId);
// ...
const r = await resolverAtributosGenericos(
  categoriaMlId,
  { /* ... igual ... */ },
  {
    lerSchema: (id) => { /* ... igual ... */ },
    llm: (input, alvos) => desempatarAtributosLLM(input, alvos, modeloTexto),
  },
  marcaPadrao,
);
```

- [ ] **Step 3: `regenerar-copy-familia/index.ts`** — falta `org_id` no select; usa `sb` (userClient), que já tem permissão de leitura em `configuracoes` (RLS `select org` é `authenticated`, escopado por `current_org_id()`)

```ts
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';
// ...
const { data: familia, error } = await sb
  .from('familias')
  .select('id, org_id, nome_pai, descricao_pai, unidade, variacoes(codigo, cor, preco)')
  .eq('id', body.familia_id)
  .maybeSingle();

if (error || !familia) {
  return new Response(`Família não encontrada: ${error?.message ?? ''}`, { status: 404, headers: corsHeaders });
}

try {
  const modeloTexto = await resolverModeloTexto(sb, familia.org_id as string);
  // ...
  const result = await gerarCopy({ /* ... igual ... */ }, modeloTexto);
  // ... resto igual
```

- [ ] **Step 4: `sugerir-resposta-pergunta/index.ts`** — trocar `requireUser` por `requireUserOrg` + pegar `adminClient()`

```ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';
import { sugerirResposta } from '../_shared/ai/resposta-pergunta.ts';

// ...
let orgId: string;
try { ({ orgId } = await requireUserOrg(req)); }
catch (resp) { if (resp instanceof Response) return resp; throw resp; }

// ... parse do body igual ...

try {
  const modeloTexto = await resolverModeloTexto(adminClient(), orgId);
  const sugestao = await sugerirResposta({ pergunta, itemTitulo: body.item_titulo ?? null, contexto: body.contexto ?? null }, modeloTexto);
  return new Response(JSON.stringify({ ok: true, sugestao }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
} catch (e) {
  // ... resto igual
}
```

- [ ] **Step 5: Threading em `titulo-particao.ts` (o único caso com 2 níveis)**

Em `supabase/functions/_shared/split/titulo-particao.ts`, adicionar campo à interface e passar para `gerarCopy`:

```ts
export interface OpcoesTituloParticao {
  nome: string;
  descricao_detalhado: string;
  unidade?: string | null;
  cores: CorParticaoTitulo[];
  tituloBase: string;
  particao: number;
  modelo?: string; // ADR-0074 — resolvido pelo caller (publicar-split-ml)
}

export async function gerarTituloParticao(opts: OpcoesTituloParticao): Promise<string> {
  try {
    const { gerarCopy } = await import('../ai/copywriter.ts');
    const out = await gerarCopy({
      nome: opts.nome,
      descricao_detalhado: opts.descricao_detalhado,
      unidade: opts.unidade ?? null,
      variacoes: opts.cores.map((c) => ({ codigo: c.codigo, cor: c.cor, preco: c.preco })),
    }, opts.modelo);
    // ... resto igual
```

Em `supabase/functions/publicar-split-ml/index.ts` (já tem `familia.org_id` e `admin`), resolver 1x logo após a linha 84 (`const conexao = await resolverConexao(admin, familia.org_id, 'mercado_livre');`) e passar no call site de `gerarTituloParticao` dentro do loop de partições (linha ~193):

```ts
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';
// ...
const conexao = await resolverConexao(admin, familia.org_id, 'mercado_livre');
const modeloTexto = await resolverModeloTexto(admin, familia.org_id as string);
// ...
// dentro do for (const p of [...grupos.keys()]...), no cálculo de tituloP:
const tituloP = p === 0
  ? familia.titulo_ml
  : (linhaP?.titulo ?? await gerarTituloParticao({
      nome: familia.nome_pai,
      descricao_detalhado: familia.descricao_pai ?? '',
      unidade: (familia.unidade as string | null) ?? null,
      cores: coresP.map((v) => ({ codigo: v.codigo, cor: v.cor, preco: Number(v.preco_publicacao ?? 0) })),
      tituloBase: familia.titulo_ml ?? familia.nome_pai,
      particao: p,
      modelo: modeloTexto,
    }));
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `pnpm test`
Expected: PASS (mesma baseline — nenhum teste de edge function chama essas funções via HTTP real, então nada deveria ter quebrado; conferir especificamente `atributos-llm.test.ts`/`titulo-clamp-metragem.test.ts`/`split/__tests__/titulo-particao.test.ts` se existirem).

- [ ] **Step 7: Lint**

Run: `pnpm lint`
Expected: sem erros novos (checar principalmente imports não usados, já que `MODELO_COPY` deixa de ser importado direto nesses arquivos).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/process-familia/index.ts supabase/functions/definir-categoria-familia/index.ts supabase/functions/regenerar-copy-familia/index.ts supabase/functions/sugerir-resposta-pergunta/index.ts supabase/functions/_shared/split/titulo-particao.ts supabase/functions/publicar-split-ml/index.ts
git commit -m "feat(ia): os 5 pontos de chamada resolvem e usam o modelo de texto por org (ADR-0074)"
```

---

### Task 6: Frontend — fetch/upsert em `queries.ts`

**Files:**
- Modify: `src/lib/queries.ts`

- [ ] **Step 1: Implementar (mesmo padrão de `fetchAliquotas`/`upsertAliquotas`)**

Adicionar próximo às demais funções de `configuracoes` (perto de `fetchReancoraLiderAtiva`):

```ts
export async function fetchModeloTexto(): Promise<string | null> {
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!orgId) return null;
  const { data } = await supabase.from('configuracoes')
    .select('ai_model_texto').eq('org_id', orgId).maybeSingle();
  return data?.ai_model_texto ?? null;
}

export async function upsertModeloTexto(slug: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!user || !orgId) throw new Error('sem sessão');
  const { error } = await supabase.from('configuracoes')
    .upsert({ org_id: orgId, user_id: user.id, ai_model_texto: slug, atualizado_em: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) throw error;
}

export async function fetchModeloImagem(): Promise<string | null> {
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!orgId) return null;
  const { data } = await supabase.from('configuracoes')
    .select('ai_model_imagem').eq('org_id', orgId).maybeSingle();
  return data?.ai_model_imagem ?? null;
}

export async function upsertModeloImagem(slug: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!user || !orgId) throw new Error('sem sessão');
  const { error } = await supabase.from('configuracoes')
    .upsert({ org_id: orgId, user_id: user.id, ai_model_imagem: slug, atualizado_em: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) throw error;
}
```

- [ ] **Step 2: Rodar a suíte inteira**

Run: `pnpm test`
Expected: PASS (nenhum teste cobre `queries.ts` diretamente com rede real; TypeScript compilar é o que importa aqui — `pnpm build` ou `tsc --noEmit` se disponível).

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat(configuracoes): fetch/upsert de ai_model_texto e ai_model_imagem (ADR-0074)"
```

---

### Task 7: Frontend — lista curada para a UI

**Files:**
- Create: `src/lib/ai-modelos.ts`

- [ ] **Step 1: Implementar**

```ts
// Lista curada e fechada de modelos de IA disponíveis via OpenRouter (ADR-0074).
// Todo slug de texto aqui precisa ter preço cadastrado em
// supabase/functions/_shared/ai/tokens.ts::PRECOS — senão o custo vira 0 silenciosamente.
export interface OpcaoModeloIA {
  slug: string;
  label: string;
  precoLabel: string;
}

export const MODELOS_TEXTO: OpcaoModeloIA[] = [
  { slug: 'openai/gpt-4o-mini', label: 'GPT-4o-mini (padrão)', precoLabel: '$0,15 / $0,60 por 1M tokens' },
  { slug: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', precoLabel: '$0,09 / $0,18 por 1M tokens' },
];

// Dormente: nenhuma feature consome geração de imagem ainda (ADR-0074).
export const MODELOS_IMAGEM: OpcaoModeloIA[] = [
  { slug: 'google/gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image (Nano Banana)', precoLabel: '$0,30 / $2,50 por 1M tokens' },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ai-modelos.ts
git commit -m "feat(configuracoes): lista curada de modelos de IA (texto/imagem) pra UI (ADR-0074)"
```

---

### Task 8: Frontend — hooks em `useConfiguracoes.ts`

**Files:**
- Modify: `src/hooks/useConfiguracoes.ts`

- [ ] **Step 1: Implementar (mesmo padrão de `useAliquotas`/`useSalvarAliquotas`)**

```ts
import {
  // ... imports existentes ...
  fetchModeloTexto, upsertModeloTexto,
  fetchModeloImagem, upsertModeloImagem,
} from '@/lib/queries';

export function useModeloTexto() {
  return useQuery({ queryKey: ['configuracoes', 'ai_model_texto'], queryFn: fetchModeloTexto });
}
export function useSalvarModeloTexto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => upsertModeloTexto(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'ai_model_texto'] }),
  });
}

export function useModeloImagem() {
  return useQuery({ queryKey: ['configuracoes', 'ai_model_imagem'], queryFn: fetchModeloImagem });
}
export function useSalvarModeloImagem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => upsertModeloImagem(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configuracoes', 'ai_model_imagem'] }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useConfiguracoes.ts
git commit -m "feat(configuracoes): hooks useModeloTexto/useModeloImagem (ADR-0074)"
```

---

### Task 9: Frontend — seção "Modelo de IA" em `Configuracoes.tsx`

**Files:**
- Modify: `src/pages/Configuracoes.tsx`

- [ ] **Step 1: Implementar**

Adicionar imports:

```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModeloTexto, useSalvarModeloTexto, useModeloImagem, useSalvarModeloImagem } from '@/hooks/useConfiguracoes';
import { MODELOS_TEXTO, MODELOS_IMAGEM } from '@/lib/ai-modelos';
import { useProfile } from '@/hooks/useProfile';
```

Dentro do componente, junto às demais chamadas de hook:

```ts
const { isAdmin } = useProfile();
const { data: modeloTexto } = useModeloTexto();
const salvarModeloTexto = useSalvarModeloTexto();
const { data: modeloImagem } = useModeloImagem();
const salvarModeloImagem = useSalvarModeloImagem();
```

Novo `<Card>` (posição sugerida: logo após o Card "Mercado Livre"):

```tsx
<Card className="p-4">
  <h2 className="mb-2 text-sm font-semibold">Modelo de IA</h2>
  <p className="mb-3 text-xs text-muted-foreground">
    Modelo usado para gerar título, descrição, categoria e atributos dos anúncios (via OpenRouter).
  </p>

  <div className="mb-3 flex items-center gap-2">
    <span className="w-16 text-sm">Texto</span>
    <Select
      value={modeloTexto ?? MODELOS_TEXTO[0].slug}
      onValueChange={(v) => salvarModeloTexto.mutate(v)}
      disabled={!isAdmin}
    >
      <SelectTrigger className="h-8 w-[300px] text-sm" title={!isAdmin ? 'Somente administradores podem trocar o modelo' : undefined}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MODELOS_TEXTO.map((m) => (
          <SelectItem key={m.slug} value={m.slug}>{m.label} — {m.precoLabel}</SelectItem>
        ))}
      </SelectContent>
    </Select>
    {salvarModeloTexto.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
    {salvarModeloTexto.isSuccess && !salvarModeloTexto.isPending && (
      <span className="text-xs text-success">✓ Salvo</span>
    )}
  </div>

  <div className="flex items-center gap-2">
    <span className="w-16 text-sm">Imagem</span>
    <Select
      value={modeloImagem ?? undefined}
      onValueChange={(v) => salvarModeloImagem.mutate(v)}
      disabled={!isAdmin}
    >
      <SelectTrigger className="h-8 w-[300px] text-sm" title={!isAdmin ? 'Somente administradores podem trocar o modelo' : undefined}>
        <SelectValue placeholder="Selecione um modelo" />
      </SelectTrigger>
      <SelectContent>
        {MODELOS_IMAGEM.map((m) => (
          <SelectItem key={m.slug} value={m.slug}>{m.label} — {m.precoLabel}</SelectItem>
        ))}
      </SelectContent>
    </Select>
    {salvarModeloImagem.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
    {salvarModeloImagem.isSuccess && !salvarModeloImagem.isPending && (
      <span className="text-xs text-success">✓ Salvo</span>
    )}
  </div>
  <p className="mt-2 text-xs text-muted-foreground">
    Modelo de imagem ainda não é usado por nenhuma feature — fica reservado para quando a geração de imagem for implementada.
  </p>
</Card>
```

- [ ] **Step 2: Rodar dev server e verificar visualmente**

Run: `pnpm dev` (na porta do worktree)
Verificar no navegador: `/configuracoes` mostra o card "Modelo de IA", os 2 selects funcionam, "✓ Salvo" aparece após trocar, e — se o usuário logado não for admin — os selects aparecem desabilitados com tooltip.

- [ ] **Step 3: Lint + suíte inteira**

Run: `pnpm lint && pnpm test`
Expected: sem erros novos; 179 arquivos / 1427+ testes passando.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Configuracoes.tsx
git commit -m "feat(configuracoes): seletor de modelo de IA (texto/imagem) por org, admin-only (ADR-0074)"
```

---

### Task 10: Documentação

**Files:**
- Modify: `docs/reference/edge-functions.md`
- Modify: `docs/reference/modelo-de-dados.md`
- Modify: `docs/TASKS.md`

- [ ] **Step 1: `docs/reference/modelo-de-dados.md`** — documentar as 2 colunas novas em `configuracoes` (ai_model_texto, ai_model_imagem: propósito, nullable, fallback, ADR-0074).

- [ ] **Step 2: `docs/reference/edge-functions.md`** — documentar o novo helper `resolverModeloTexto` e que os 5 edge functions de IA-texto agora resolvem o modelo por org antes de chamar a IA.

- [ ] **Step 3: `docs/TASKS.md`** — registrar a entrega (ADR-0074, migration, 5 edge functions, tela Configurações).

- [ ] **Step 4: Commit**

```bash
git add docs/reference/edge-functions.md docs/reference/modelo-de-dados.md docs/TASKS.md
git commit -m "docs: registra selecao de modelo de IA por org (ADR-0074)"
```

---

## Nota de execução

Task 1 (Step 3, `supabase db push`) é a única ação com efeito no banco remoto compartilhado — pausar e confirmar com Diego antes de rodar. Todas as demais tasks produzem só commits locais no branch; seguras de executar em sequência.

Depois da Task 10: `pnpm lint && pnpm test` uma última vez limpo, então seguir o fluxo normal do projeto (Diego valida localmente → só então push/deploy/merge, nunca automático).
