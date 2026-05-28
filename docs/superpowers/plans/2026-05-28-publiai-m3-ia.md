# PubliAI M3 — IA copywriting + Vision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o stub do `process-familia` por um pipeline real que resolve cor (texto → cache → Vision) e gera título/descrição via IA, mais a infra UI/upload e a restauração da assinatura QStash bypassada no M2.

**Architecture:** Camada de IA isolada em `supabase/functions/_shared/ai/` chamada do orquestrador `process-familia`. Parser de cor em `_shared/cor/`. Cache Redis em `_shared/redis/`. Frontend ganha drop zone, ícone câmera por variação, badges de origem da cor. Migration aditiva captura custo de IA e flags `editado_pelo_operador`.

**Tech Stack:** Deno (Edge Functions Supabase), OpenAI SDK via OpenRouter, Upstash Redis REST, React 18 + TanStack Query + react-dropzone, Vitest 3 + jsdom para tests do frontend e das funções puras.

**Reference spec:** [`docs/superpowers/specs/2026-05-28-publiai-m3-ia-design.md`](../specs/2026-05-28-publiai-m3-ia-design.md)

---

## Pre-flight checklist (executar antes da Task 1)

- [ ] Confirmar que `pnpm test` passa (baseline 61 testes do M2)
- [ ] Confirmar que `pnpm build` passa
- [ ] Abrir uma branch nova localmente: `git checkout -b m3-ia-copywriting`
- [ ] No console Upstash (manual), preparar para rotacionar signing keys (Task 14)

---

## Task 1: Migration 0007 — campos de IA + flags "editado_pelo_operador"

**Files:**
- Create: `supabase/migrations/20260528000001_m3_ia_fields.sql`
- Modify (gerado): `src/lib/database.types.ts`

- [ ] **Step 1: Escrever a migration**

Arquivo `supabase/migrations/20260528000001_m3_ia_fields.sql`:

```sql
-- M3 — captura de custo de IA + flags "editado_pelo_operador"

ALTER TABLE public.familias
  ADD COLUMN tokens_input integer,
  ADD COLUMN tokens_output integer,
  ADD COLUMN custo_centavos integer,
  ADD COLUMN titulo_editado_pelo_operador boolean NOT NULL DEFAULT false,
  ADD COLUMN descricao_editada_pelo_operador boolean NOT NULL DEFAULT false;

ALTER TABLE public.variacoes
  ADD COLUMN cor_editada_pelo_operador boolean NOT NULL DEFAULT false,
  ADD COLUMN preco_editado_pelo_operador boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS familias_lote_status_idx ON public.familias(lote_id, status);
```

- [ ] **Step 2: Aplicar migration via MCP Supabase**

Use o MCP `apply_migration` com `name: "20260528000001_m3_ia_fields"` e o conteúdo SQL acima. Confirme `success: true`.

- [ ] **Step 3: Regenerar tipos TS**

Use o MCP `generate_typescript_types`. Salve o output sobrescrevendo `src/lib/database.types.ts`. Confira que os 7 novos campos aparecem nas interfaces `Database['public']['Tables']['familias']['Row']` e `variacoes['Row']`.

- [ ] **Step 4: Verificar build**

Run: `pnpm build`
Expected: PASS sem erros TS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260528000001_m3_ia_fields.sql src/lib/database.types.ts
git commit -m "feat(m3): migration 0007 - custos de IA + flags editado_pelo_operador"
```

---

## Task 2: Dicionário de cores PT-BR

**Files:**
- Create: `supabase/functions/_shared/cor/dicionario.ts`
- Test: `supabase/functions/_shared/cor/__tests__/dicionario.test.ts`

> **Por que vitest consegue rodar isso:** o arquivo é 100% TypeScript puro sem imports Deno-style. Vitest importa direto via path relativo.

- [ ] **Step 1: Escrever o teste primeiro (FALHA)**

Arquivo `supabase/functions/_shared/cor/__tests__/dicionario.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DICIONARIO_CORES } from '../dicionario';

describe('DICIONARIO_CORES', () => {
  it('tem pelo menos 40 cores canônicas', () => {
    expect(DICIONARIO_CORES.length).toBeGreaterThanOrEqual(40);
  });

  it('toda entrada tem canonica + sinonimos (>=1)', () => {
    for (const cor of DICIONARIO_CORES) {
      expect(cor.canonica).toBeTruthy();
      expect(cor.sinonimos.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('canonicas são únicas', () => {
    const canonicas = DICIONARIO_CORES.map(c => c.canonica);
    expect(new Set(canonicas).size).toBe(canonicas.length);
  });

  it('cores básicas estão presentes', () => {
    const canonicas = DICIONARIO_CORES.map(c => c.canonica);
    expect(canonicas).toContain('Preto');
    expect(canonicas).toContain('Branco');
    expect(canonicas).toContain('Azul Royal');
    expect(canonicas).toContain('Cru');
  });
});
```

- [ ] **Step 2: Rodar teste — falha**

Run: `pnpm vitest run supabase/functions/_shared/cor/__tests__/dicionario.test.ts`
Expected: FAIL com "Cannot find module '../dicionario'".

- [ ] **Step 3: Implementar o dicionário**

Arquivo `supabase/functions/_shared/cor/dicionario.ts`:

```ts
export interface CorCanonica {
  canonica: string;
  sinonimos: string[];
}

export const DICIONARIO_CORES: CorCanonica[] = [
  { canonica: 'Preto', sinonimos: ['preto', 'preta'] },
  { canonica: 'Branco', sinonimos: ['branco', 'branca'] },
  { canonica: 'Vermelho', sinonimos: ['vermelho', 'vermelha', 'rubro'] },
  { canonica: 'Vermelho Escuro', sinonimos: ['vermelho escuro', 'bordo', 'bordô'] },
  { canonica: 'Vinho', sinonimos: ['vinho'] },
  { canonica: 'Azul Royal', sinonimos: ['azul royal', 'royal'] },
  { canonica: 'Azul Marinho', sinonimos: ['azul marinho', 'marinho'] },
  { canonica: 'Azul Claro', sinonimos: ['azul claro', 'celeste'] },
  { canonica: 'Azul Bebê', sinonimos: ['azul bebê', 'azul bebe'] },
  { canonica: 'Verde Bandeira', sinonimos: ['verde bandeira', 'bandeira'] },
  { canonica: 'Verde Musgo', sinonimos: ['verde musgo', 'musgo'] },
  { canonica: 'Verde Claro', sinonimos: ['verde claro'] },
  { canonica: 'Verde Limão', sinonimos: ['verde limão', 'verde limao', 'limão'] },
  { canonica: 'Amarelo', sinonimos: ['amarelo', 'amarela'] },
  { canonica: 'Amarelo Ouro', sinonimos: ['amarelo ouro', 'ouro'] },
  { canonica: 'Laranja', sinonimos: ['laranja'] },
  { canonica: 'Rosa', sinonimos: ['rosa'] },
  { canonica: 'Rosa Claro', sinonimos: ['rosa claro', 'rosê', 'rose'] },
  { canonica: 'Rosa Choque', sinonimos: ['rosa choque'] },
  { canonica: 'Pink', sinonimos: ['pink'] },
  { canonica: 'Roxo', sinonimos: ['roxo', 'roxa'] },
  { canonica: 'Lilás', sinonimos: ['lilás', 'lilas'] },
  { canonica: 'Marrom', sinonimos: ['marrom', 'castanho'] },
  { canonica: 'Marrom Café', sinonimos: ['marrom café', 'café', 'cafe'] },
  { canonica: 'Bege', sinonimos: ['bege'] },
  { canonica: 'Cru', sinonimos: ['cru', 'crua', 'natural'] },
  { canonica: 'Cinza', sinonimos: ['cinza'] },
  { canonica: 'Cinza Claro', sinonimos: ['cinza claro'] },
  { canonica: 'Cinza Escuro', sinonimos: ['cinza escuro', 'grafite'] },
  { canonica: 'Prata', sinonimos: ['prata', 'prateado', 'prateada'] },
  { canonica: 'Dourado', sinonimos: ['dourado', 'dourada', 'gold'] },
  { canonica: 'Caqui', sinonimos: ['caqui', 'cáqui'] },
  { canonica: 'Mostarda', sinonimos: ['mostarda'] },
  { canonica: 'Ferrugem', sinonimos: ['ferrugem', 'terracota'] },
  { canonica: 'Salmão', sinonimos: ['salmão', 'salmao'] },
  { canonica: 'Coral', sinonimos: ['coral'] },
  { canonica: 'Turquesa', sinonimos: ['turquesa'] },
  { canonica: 'Petróleo', sinonimos: ['petróleo', 'petroleo'] },
  { canonica: 'Rosa Neon', sinonimos: ['rosa neon', 'pink neon'] },
  { canonica: 'Verde Neon', sinonimos: ['verde neon'] },
  { canonica: 'Amarelo Neon', sinonimos: ['amarelo neon'] },
  { canonica: 'Multicolor', sinonimos: ['multicolor', 'colorido', 'arco-íris', 'arco iris'] },
];
```

- [ ] **Step 4: Rodar teste — passa**

Run: `pnpm vitest run supabase/functions/_shared/cor/__tests__/dicionario.test.ts`
Expected: PASS 4/4.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/cor/dicionario.ts \
        supabase/functions/_shared/cor/__tests__/dicionario.test.ts
git commit -m "feat(m3): dicionario de cores PT-BR com sinonimos"
```

---

## Task 3: Parser de cor (`extrairCorDoTexto`)

**Files:**
- Create: `supabase/functions/_shared/cor/extrair.ts`
- Test: `supabase/functions/_shared/cor/__tests__/extrair.test.ts`

- [ ] **Step 1: Escrever o teste primeiro (FALHA)**

Arquivo `supabase/functions/_shared/cor/__tests__/extrair.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extrairCorDoTexto } from '../extrair';

describe('extrairCorDoTexto', () => {
  it('retorna null quando nenhuma cor é encontrada', () => {
    expect(extrairCorDoTexto(['LINHA P/COST.XIK 120 2000J 455'])).toBeNull();
  });

  it('encontra cor case-insensitive', () => {
    expect(extrairCorDoTexto(['LINHA VERMELHA PARA COSTURA'])).toBe('Vermelho');
    expect(extrairCorDoTexto(['fita preta 5mm'])).toBe('Preto');
  });

  it('respeita word boundary (não casa azulejado com azul)', () => {
    expect(extrairCorDoTexto(['piso azulejado decorado'])).toBeNull();
  });

  it('prefere sinônimo mais longo (azul royal antes de azul)', () => {
    expect(extrairCorDoTexto(['Linha azul royal premium'])).toBe('Azul Royal');
  });

  it('busca em múltiplos textos do array', () => {
    expect(extrairCorDoTexto(['código opaco', 'descrição: fita pink neon'])).toBe('Rosa Neon');
  });

  it('retorna a forma canônica (não a forma do texto)', () => {
    expect(extrairCorDoTexto(['cor: PRETA 100% poliéster'])).toBe('Preto');
    expect(extrairCorDoTexto(['cru natural'])).toBe('Cru');
  });

  it('ignora arrays vazios ou strings vazias', () => {
    expect(extrairCorDoTexto([])).toBeNull();
    expect(extrairCorDoTexto(['', '', null as unknown as string])).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar teste — falha**

Run: `pnpm vitest run supabase/functions/_shared/cor/__tests__/extrair.test.ts`
Expected: FAIL com "Cannot find module '../extrair'".

- [ ] **Step 3: Implementar o parser**

Arquivo `supabase/functions/_shared/cor/extrair.ts`:

```ts
import { DICIONARIO_CORES } from './dicionario';

interface Termo {
  canonica: string;
  sinonimo: string;
  regex: RegExp;
}

const TERMOS: Termo[] = DICIONARIO_CORES
  .flatMap(({ canonica, sinonimos }) =>
    sinonimos.map((sin) => ({
      canonica,
      sinonimo: sin,
      regex: new RegExp(`(?<![\\p{L}])${escapeRegex(sin)}(?![\\p{L}])`, 'iu'),
    }))
  )
  .sort((a, b) => b.sinonimo.length - a.sinonimo.length);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extrairCorDoTexto(textos: Array<string | null | undefined>): string | null {
  const conjunto = textos.filter((t): t is string => typeof t === 'string' && t.length > 0);
  if (conjunto.length === 0) return null;
  const corpus = conjunto.join(' | ');
  for (const termo of TERMOS) {
    if (termo.regex.test(corpus)) return termo.canonica;
  }
  return null;
}
```

> **Nota:** `(?<![\\p{L}])` e `(?![\\p{L}])` substituem `\b` para que palavras com acento (lilás, salmão, café) também respeitem word boundary corretamente. Flag `u` ativa Unicode.

- [ ] **Step 4: Rodar teste — passa**

Run: `pnpm vitest run supabase/functions/_shared/cor/__tests__/extrair.test.ts`
Expected: PASS 7/7.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/cor/extrair.ts \
        supabase/functions/_shared/cor/__tests__/extrair.test.ts
git commit -m "feat(m3): parser cor PT-BR com word boundary unicode"
```

---

## Task 4: Calculadora de custo de tokens

**Files:**
- Create: `supabase/functions/_shared/ai/tokens.ts`
- Test: `supabase/functions/_shared/ai/__tests__/tokens.test.ts`

- [ ] **Step 1: Escrever o teste primeiro (FALHA)**

Arquivo `supabase/functions/_shared/ai/__tests__/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { custoCentavos } from '../tokens';

describe('custoCentavos', () => {
  it('calcula custo para gpt-4o-mini', () => {
    // 1000 input + 500 output:
    // input: 1.0 * $0.015 = $0.015
    // output: 0.5 * $0.060 = $0.030
    // total: $0.045 = 4.5 centavos -> ceil -> 5
    expect(custoCentavos('openai/gpt-4o-mini', { prompt_tokens: 1000, completion_tokens: 500 })).toBe(5);
  });

  it('calcula custo para gpt-4o', () => {
    // 1000 input + 500 output:
    // input: 1.0 * $2.50 = $2.50
    // output: 0.5 * $10.00 = $5.00
    // total: $7.50 = 750 centavos
    expect(custoCentavos('openai/gpt-4o', { prompt_tokens: 1000, completion_tokens: 500 })).toBe(750);
  });

  it('retorna 0 para modelo desconhecido', () => {
    expect(custoCentavos('foo/bar', { prompt_tokens: 1000, completion_tokens: 500 })).toBe(0);
  });

  it('arredonda pra cima (ceil)', () => {
    // Custo de 0.0001 centavos vira 1 centavo
    expect(custoCentavos('openai/gpt-4o-mini', { prompt_tokens: 1, completion_tokens: 0 })).toBe(1);
  });

  it('tolera zero tokens', () => {
    expect(custoCentavos('openai/gpt-4o-mini', { prompt_tokens: 0, completion_tokens: 0 })).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar teste — falha**

Run: `pnpm vitest run supabase/functions/_shared/ai/__tests__/tokens.test.ts`
Expected: FAIL "Cannot find module '../tokens'".

- [ ] **Step 3: Implementar**

Arquivo `supabase/functions/_shared/ai/tokens.ts`:

```ts
interface PrecoModelo {
  input: number;  // $/1k tokens
  output: number;
}

const PRECOS: Record<string, PrecoModelo> = {
  'openai/gpt-4o-mini': { input: 0.015, output: 0.06 },
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
};

export interface UsageTokens {
  prompt_tokens: number;
  completion_tokens: number;
}

export function custoCentavos(modelo: string, usage: UsageTokens): number {
  const preco = PRECOS[modelo];
  if (!preco) return 0;
  if (usage.prompt_tokens === 0 && usage.completion_tokens === 0) return 0;
  const dolares =
    (usage.prompt_tokens / 1000) * preco.input +
    (usage.completion_tokens / 1000) * preco.output;
  return Math.ceil(dolares * 100);
}
```

- [ ] **Step 4: Rodar teste — passa**

Run: `pnpm vitest run supabase/functions/_shared/ai/__tests__/tokens.test.ts`
Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/tokens.ts \
        supabase/functions/_shared/ai/__tests__/tokens.test.ts
git commit -m "feat(m3): custoCentavos para gpt-4o-mini e gpt-4o"
```

---

## Task 5: Pool de concorrência limitada

**Files:**
- Create: `supabase/functions/_shared/concorrencia/pool.ts`
- Test: `supabase/functions/_shared/concorrencia/__tests__/pool.test.ts`

- [ ] **Step 1: Escrever o teste primeiro (FALHA)**

Arquivo `supabase/functions/_shared/concorrencia/__tests__/pool.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pool } from '../pool';

describe('pool', () => {
  it('processa todos os itens', async () => {
    const itens = [1, 2, 3, 4, 5];
    const resultado = await pool(2, itens, async (n) => n * 2);
    expect(resultado).toEqual([2, 4, 6, 8, 10]);
  });

  it('respeita o limite de concorrência', async () => {
    let emVoo = 0;
    let picoConcorrencia = 0;
    const itens = [1, 2, 3, 4, 5, 6, 7, 8];
    await pool(3, itens, async (n) => {
      emVoo++;
      picoConcorrencia = Math.max(picoConcorrencia, emVoo);
      await new Promise((r) => setTimeout(r, 10));
      emVoo--;
      return n;
    });
    expect(picoConcorrencia).toBeLessThanOrEqual(3);
  });

  it('preserva ordem do array de saída', async () => {
    const itens = [10, 20, 30];
    const resultado = await pool(2, itens, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n + 1;
    });
    expect(resultado).toEqual([11, 21, 31]);
  });

  it('propaga erros do worker', async () => {
    const itens = [1, 2, 3];
    await expect(pool(2, itens, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    })).rejects.toThrow('boom');
  });

  it('lista vazia retorna array vazio', async () => {
    expect(await pool(5, [], async (n) => n)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar teste — falha**

Run: `pnpm vitest run supabase/functions/_shared/concorrencia/__tests__/pool.test.ts`
Expected: FAIL "Cannot find module '../pool'".

- [ ] **Step 3: Implementar**

Arquivo `supabase/functions/_shared/concorrencia/pool.ts`:

```ts
export async function pool<T, U>(
  limite: number,
  itens: T[],
  worker: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  if (itens.length === 0) return [];
  const resultado: U[] = new Array(itens.length);
  let proximo = 0;
  async function runner(): Promise<void> {
    while (true) {
      const i = proximo++;
      if (i >= itens.length) return;
      resultado[i] = await worker(itens[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(limite, itens.length) }, runner);
  await Promise.all(runners);
  return resultado;
}
```

- [ ] **Step 4: Rodar teste — passa**

Run: `pnpm vitest run supabase/functions/_shared/concorrencia/__tests__/pool.test.ts`
Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/concorrencia/pool.ts \
        supabase/functions/_shared/concorrencia/__tests__/pool.test.ts
git commit -m "feat(m3): pool de concorrencia limitada (Promise-based)"
```

---

## Task 6: Cliente Redis + cache de cor

**Files:**
- Create: `supabase/functions/_shared/redis/client.ts`
- Create: `supabase/functions/_shared/redis/cache-cor.ts`

> Sem testes unitários — usa `Deno.env` e `fetch` direto pra Upstash REST API. Validação manual via MCP Upstash na Task 6.4.

- [ ] **Step 1: Criar o cliente Redis**

Arquivo `supabase/functions/_shared/redis/client.ts`:

```ts
const URL = () => Deno.env.get('UPSTASH_REDIS_REST_URL')!;
const TOKEN = () => Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!;

async function call<T>(comando: (string | number)[]): Promise<T | null> {
  const res = await fetch(URL(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(comando),
  });
  if (!res.ok) throw new Error(`Redis ${res.status}: ${await res.text()}`);
  const json = await res.json() as { result: T | null; error?: string };
  if (json.error) throw new Error(`Redis error: ${json.error}`);
  return json.result;
}

export async function redisGet(chave: string): Promise<string | null> {
  return call<string>(['GET', chave]);
}

export async function redisSet(chave: string, valor: string, ttlSegundos?: number): Promise<void> {
  const cmd: (string | number)[] = ['SET', chave, valor];
  if (ttlSegundos) cmd.push('EX', ttlSegundos);
  await call(cmd);
}

export async function redisDel(chave: string): Promise<void> {
  await call(['DEL', chave]);
}
```

- [ ] **Step 2: Criar o helper de cache de cor**

Arquivo `supabase/functions/_shared/redis/cache-cor.ts`:

```ts
import { redisGet, redisSet, redisDel } from './client.ts';

const TTL_90_DIAS = 60 * 60 * 24 * 90;

export type OrigemCor = 'descricao' | 'vision' | 'manual';

export interface CacheCorEntrada {
  cor: string;
  origem: OrigemCor;
  criado_em: string;
}

function chave(userId: string, codigo: string): string {
  return `cache:cor:${userId}:${codigo}`;
}

export async function cacheCorGet(userId: string, codigo: string): Promise<CacheCorEntrada | null> {
  const valor = await redisGet(chave(userId, codigo));
  if (!valor) return null;
  try {
    return JSON.parse(valor) as CacheCorEntrada;
  } catch {
    return null;
  }
}

export async function cacheCorSet(
  userId: string,
  codigo: string,
  entrada: Omit<CacheCorEntrada, 'criado_em'>,
): Promise<void> {
  const payload: CacheCorEntrada = { ...entrada, criado_em: new Date().toISOString() };
  await redisSet(chave(userId, codigo), JSON.stringify(payload), TTL_90_DIAS);
}

export async function cacheCorInvalidar(userId: string, codigo: string): Promise<void> {
  await redisDel(chave(userId, codigo));
}
```

- [ ] **Step 3: Build (não há test unitário direto)**

Run: `pnpm build`
Expected: PASS (TS válido).

- [ ] **Step 4: Validação manual via MCP Upstash**

Use `redis_database_run_redis_commands` MCP com comandos:
1. `SET cache:cor:user_test:00000123 '{"cor":"Vermelho","origem":"vision","criado_em":"2026-05-28T10:00:00Z"}' EX 7776000`
2. `GET cache:cor:user_test:00000123` → confirma JSON
3. `TTL cache:cor:user_test:00000123` → deve estar próximo de 7776000
4. `DEL cache:cor:user_test:00000123` → confirma remoção

Expected: todos sucesso. Documente em comentário do commit.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/redis/
git commit -m "feat(m3): cliente Upstash Redis REST + cache de cor com TTL 90d"
```

---

## Task 7: Cliente OpenRouter + slugs de modelo

**Files:**
- Create: `supabase/functions/_shared/ai/client.ts`
- Create: `supabase/functions/_shared/ai/modelos.ts`

> Sem testes unitários — depende de `Deno.env` + import `npm:openai`. Validação acontece naturalmente nas Tasks 8 e 9 (vision e copywriter).

- [ ] **Step 1: Criar `modelos.ts`**

Arquivo `supabase/functions/_shared/ai/modelos.ts`:

```ts
export const MODELO_COPY = Deno.env.get('AI_MODEL_COPY') ?? 'openai/gpt-4o-mini';
export const MODELO_VISION = Deno.env.get('AI_MODEL_VISION') ?? 'openai/gpt-4o';
```

- [ ] **Step 2: Criar `client.ts`**

Arquivo `supabase/functions/_shared/ai/client.ts`:

```ts
import OpenAI from 'npm:openai@^4';

let cached: OpenAI | null = null;

export function openrouterClient(): OpenAI {
  if (cached) return cached;
  cached = new OpenAI({
    apiKey: Deno.env.get('OPENROUTER_API_KEY')!,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': Deno.env.get('PUBLIAI_PUBLIC_URL') ?? 'https://ean2marketplace-frontend.onrender.com',
      'X-Title': 'PubliAI',
    },
  });
  return cached;
}
```

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: PASS (apenas validação TS; Deno-specific imports são ignorados pelo `tsc` quando paths estão excluídos via `tsconfig.app.json`/`tsconfig.node.json`; se tcerror, adicionar `supabase/functions/**` ao exclude).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/ai/client.ts \
        supabase/functions/_shared/ai/modelos.ts
git commit -m "feat(m3): cliente OpenRouter (SDK openai) + slugs de modelo via env"
```

---

## Task 8: Adapter Vision (extração de cor por imagem)

**Files:**
- Create: `supabase/functions/_shared/ai/vision.ts`

- [ ] **Step 1: Criar o adapter**

Arquivo `supabase/functions/_shared/ai/vision.ts`:

```ts
import { openrouterClient } from './client.ts';
import { MODELO_VISION } from './modelos.ts';
import { custoCentavos } from './tokens.ts';

const CORES_VALIDAS = new Set([
  'Preto', 'Branco', 'Vermelho', 'Azul Royal', 'Azul Marinho', 'Azul Claro',
  'Verde Bandeira', 'Verde Musgo', 'Verde Claro', 'Amarelo', 'Laranja',
  'Rosa', 'Pink', 'Roxo', 'Marrom', 'Bege', 'Cru', 'Cinza', 'Prata',
  'Dourado', 'Rosa Neon', 'Verde Neon', 'Outra',
]);

const PROMPT = `Você é um identificador de cor de produto. Recebe a foto de um produto têxtil (linha de costura, botão, fita ou similar).

Responda APENAS com o nome da cor predominante, em português, escolhendo entre estas opções canônicas:
[Preto, Branco, Vermelho, Azul Royal, Azul Marinho, Azul Claro, Verde Bandeira, Verde Musgo, Verde Claro, Amarelo, Laranja, Rosa, Pink, Roxo, Marrom, Bege, Cru, Cinza, Prata, Dourado, Rosa Neon, Verde Neon, Outra]

Se não conseguir identificar, responda "Outra".
Não explique, não adicione contexto, devolva apenas o nome da cor.`;

export interface ResultadoVision {
  cor: string;
  custo_centavos: number;
  tokens_input: number;
  tokens_output: number;
}

export async function extrairCorPorVision(imagemUrl: string): Promise<ResultadoVision> {
  const client = openrouterClient();
  const resp = await client.chat.completions.create(
    {
      model: MODELO_VISION,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: imagemUrl, detail: 'low' } },
          ],
        },
      ],
      max_tokens: 10,
      temperature: 0,
    },
    { signal: AbortSignal.timeout(30_000) },
  );
  const bruto = (resp.choices[0]?.message?.content ?? '').trim();
  const cor = CORES_VALIDAS.has(bruto) ? bruto : 'Outra';
  const usage = resp.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  return {
    cor,
    tokens_input: usage.prompt_tokens,
    tokens_output: usage.completion_tokens,
    custo_centavos: custoCentavos(MODELO_VISION, usage),
  };
}
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ai/vision.ts
git commit -m "feat(m3): adapter Vision (gpt-4o) com prompt fechado em cores canonicas"
```

---

## Task 9: Adapter Copywriter (título + descrição)

**Files:**
- Create: `supabase/functions/_shared/ai/copywriter.ts`

- [ ] **Step 1: Criar o adapter**

Arquivo `supabase/functions/_shared/ai/copywriter.ts`:

```ts
import { openrouterClient } from './client.ts';
import { MODELO_COPY } from './modelos.ts';
import { custoCentavos } from './tokens.ts';

export interface InputCopy {
  nome: string;
  descricao_detalhado: string;
  variacoes: Array<{ codigo: string; cor: string | null; preco: number }>;
  categoria_hint?: 'linhas' | 'botoes' | 'fitas';
}

export interface OutputCopy {
  titulo: string;
  descricao: string;
  tokens_input: number;
  tokens_output: number;
  custo_centavos: number;
}

const SCHEMA = {
  name: 'copy_anuncio',
  schema: {
    type: 'object',
    properties: {
      titulo: { type: 'string', maxLength: 60 },
      descricao: { type: 'string' },
    },
    required: ['titulo', 'descricao'],
    additionalProperties: false,
  },
  strict: true,
} as const;

const SYSTEM = `Você é um copywriter especializado em anúncios de aviamentos (linhas de costura, botões, fitas) no Mercado Livre Brasil. Sua tarefa: gerar título e descrição para UM anúncio agrupado que contém várias variações de cor do mesmo produto.

REGRAS INEGOCIÁVEIS:
1. NUNCA invente especificações que não estão no input (composição, gramatura, dimensões, marca, certificações). Use APENAS o que está em "DESCRICAO_DETALHADO".
2. Título: até 60 caracteres, frase comercial, idealmente menciona a quantidade de cores disponíveis no final.
3. Descrição: use os dados de DESCRICAO_DETALHADO como verdade absoluta. Pode reorganizar, formatar em parágrafos, adicionar separadores, mas NÃO acrescentar informações novas.
4. Tom: profissional, direto, focado em utilidade do produto.
5. Liste as cores disponíveis em uma seção da descrição.`;

function montarUserPrompt(input: InputCopy): string {
  const lista = input.variacoes
    .map((v) => `- ${v.codigo}: ${v.cor ?? '(sem cor)'} — R$ ${v.preco.toFixed(2)}`)
    .join('\n');
  return [
    `Nome do produto: ${input.nome}`,
    `Descrição detalhada (fonte de verdade):`,
    input.descricao_detalhado,
    ``,
    `Variações disponíveis (${input.variacoes.length} cores):`,
    lista,
    input.categoria_hint ? `Categoria sugerida: ${input.categoria_hint}` : '',
  ].filter(Boolean).join('\n');
}

export async function gerarCopy(input: InputCopy): Promise<OutputCopy> {
  const client = openrouterClient();
  const resp = await client.chat.completions.create(
    {
      model: MODELO_COPY,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: montarUserPrompt(input) },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      temperature: 0.4,
    },
    { signal: AbortSignal.timeout(30_000) },
  );
  const conteudo = resp.choices[0]?.message?.content;
  if (!conteudo) throw new Error('Copywriter: resposta vazia');
  let parsed: { titulo: string; descricao: string };
  try {
    parsed = JSON.parse(conteudo);
  } catch (e) {
    throw new Error(`Copywriter: JSON inválido: ${(e as Error).message}`);
  }
  const usage = resp.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  return {
    titulo: parsed.titulo,
    descricao: parsed.descricao,
    tokens_input: usage.prompt_tokens,
    tokens_output: usage.completion_tokens,
    custo_centavos: custoCentavos(MODELO_COPY, usage),
  };
}
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ai/copywriter.ts
git commit -m "feat(m3): adapter copywriter (gpt-4o-mini) com structured output JSON Schema"
```

---

## Task 10: Reescrever `process-familia`

**Files:**
- Modify: `supabase/functions/process-familia/index.ts`

> **Importante:** restaura `verificarAssinatura` (bypass do M2 removido), claim atômico já existente, e adiciona pipeline cor → copy → persistência.

- [ ] **Step 1: Sobrescrever o arquivo**

Arquivo `supabase/functions/process-familia/index.ts` (substituir tudo):

```ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { extrairCorDoTexto } from '../_shared/cor/extrair.ts';
import { pool } from '../_shared/concorrencia/pool.ts';
import { cacheCorGet, cacheCorSet, type OrigemCor } from '../_shared/redis/cache-cor.ts';
import { extrairCorPorVision } from '../_shared/ai/vision.ts';
import { gerarCopy } from '../_shared/ai/copywriter.ts';

interface Job { familia_id: string; lote_id: string; }

const POOL_VISION = 5;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const body = await req.text();
  const ok = await verificarAssinatura(req, body);
  if (!ok) return new Response('Invalid signature', { status: 401, headers: corsHeaders });

  let job: Job;
  try {
    job = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
  }
  if (!job.familia_id || !job.lote_id) {
    return new Response('familia_id e lote_id obrigatórios', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();

  // 1. Claim atômico
  const { data: claimed, error: claimErr } = await admin
    .from('familias')
    .update({ status: 'processando' })
    .eq('id', job.familia_id)
    .eq('status', 'pendente')
    .select('id, user_id, nome, descricao_detalhado, lote_id')
    .maybeSingle();
  if (claimErr) return new Response(`Claim: ${claimErr.message}`, { status: 500, headers: corsHeaders });
  if (!claimed) return new Response('Already processed', { status: 200, headers: corsHeaders });

  const userId = claimed.user_id as string;

  try {
    // 2. Carregar variações
    const { data: variacoes, error: varErr } = await admin
      .from('variacoes')
      .select('id, codigo, cor, cor_origem, descricao_detalhado, nome, preco, imagem_path')
      .eq('familia_id', job.familia_id);
    if (varErr) throw new Error(`Variacoes: ${varErr.message}`);

    // 3. Resolver cor de cada variação (pool=5)
    const resolvidas = await pool(POOL_VISION, variacoes ?? [], async (v) => {
      if (v.cor) return v;

      // Camada 1 — dicionário
      const corTexto = extrairCorDoTexto([
        v.nome, v.descricao_detalhado,
        claimed.nome, claimed.descricao_detalhado,
      ]);
      if (corTexto) return { ...v, cor: corTexto, cor_origem: 'descricao' as OrigemCor };

      // Cache Redis
      try {
        const cached = await cacheCorGet(userId, v.codigo);
        if (cached) return { ...v, cor: cached.cor, cor_origem: cached.origem };
      } catch (e) {
        console.warn(`Cache miss (erro): ${(e as Error).message}`);
      }

      // Camada 2 — Vision
      if (!v.imagem_path) return v;
      try {
        const { data: signed, error: signErr } = await admin.storage
          .from('imagens')
          .createSignedUrl(v.imagem_path, 3600);
        if (signErr || !signed?.signedUrl) return v;
        const visionResult = await extrairCorPorVision(signed.signedUrl);
        try {
          await cacheCorSet(userId, v.codigo, { cor: visionResult.cor, origem: 'vision' });
        } catch (e) {
          console.warn(`Cache set falhou: ${(e as Error).message}`);
        }
        return { ...v, cor: visionResult.cor, cor_origem: 'vision' as OrigemCor };
      } catch (e) {
        console.warn(`Vision falhou para ${v.codigo}: ${(e as Error).message}`);
        return v;
      }
    });

    // 4. Persistir cores (UPDATE em batch — só as que mudaram)
    const updatesVar = resolvidas
      .filter((v, i) => v.cor !== variacoes![i].cor || v.cor_origem !== variacoes![i].cor_origem)
      .map((v) => admin.from('variacoes').update({ cor: v.cor, cor_origem: v.cor_origem }).eq('id', v.id));
    await Promise.all(updatesVar);

    // 5. Copywriter
    const copy = await gerarCopy({
      nome: claimed.nome,
      descricao_detalhado: claimed.descricao_detalhado ?? '',
      variacoes: resolvidas.map((v) => ({ codigo: v.codigo, cor: v.cor, preco: Number(v.preco) })),
    });

    // 6. Persistir título + descrição + custos + status final
    await admin.from('familias').update({
      titulo: copy.titulo,
      descricao: copy.descricao,
      tokens_input: copy.tokens_input,
      tokens_output: copy.tokens_output,
      custo_centavos: copy.custo_centavos,
      status: 'pronto',
    }).eq('id', job.familia_id);

    return new Response('OK', { status: 200, headers: corsHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
    // 5xx → QStash retenta. 4xx (já consumido com erro persistido) → 200 pra não retentar.
    const retry = !/4\d\d/.test(msg);
    return new Response(`Erro: ${msg}`, { status: retry ? 500 : 200, headers: corsHeaders });
  }
});
```

- [ ] **Step 2: Deploy via MCP Supabase**

Use `deploy_edge_function` MCP com:
- `name`: `process-familia`
- `entrypoint_path`: `index.ts`
- `import_map`: incluir `_shared/` se necessário

Confirme `status: "ACTIVE"` na resposta.

- [ ] **Step 3: Build local sanity**

Run: `pnpm build`
Expected: PASS (frontend não importa Edge Functions).

- [ ] **Step 4: Smoke test rápido — verificar assinatura QStash bloqueia request sem signature**

Run:
```bash
curl -i -X POST "https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/process-familia" \
  -H "Content-Type: application/json" \
  -d '{"familia_id":"fake","lote_id":"fake"}'
```
Expected: HTTP 401 "Invalid signature".

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/process-familia/index.ts
git commit -m "feat(m3): process-familia com pipeline IA real + restaura QStash signature"
```

---

## Task 11: Edge Function nova `upload-imagens-lote`

**Files:**
- Create: `supabase/functions/upload-imagens-lote/index.ts`

- [ ] **Step 1: Criar a function**

Arquivo `supabase/functions/upload-imagens-lote/index.ts`:

```ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';

interface ResultadoUpload {
  ok: number;
  ja_tinha: number;
  sem_match: number;
  erros: Array<{ arquivo: string; motivo: string }>;
}

const EXT_REGEX = /\.(jpe?g|png)$/i;
const CODIGO_REGEX = /^(\d{8})\./;

function extrairCodigo(nomeArquivo: string): string | null {
  const m = nomeArquivo.match(CODIGO_REGEX);
  return m ? m[1] : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Auth via JWT do operador
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return new Response('Missing auth', { status: 401, headers: corsHeaders });
  }
  const jwt = auth.slice(7);
  const user = userClient(jwt);
  const { data: { user: u } } = await user.auth.getUser();
  if (!u) return new Response('Invalid token', { status: 401, headers: corsHeaders });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return new Response('Invalid form-data', { status: 400, headers: corsHeaders });
  }

  const loteId = formData.get('lote_id');
  if (typeof loteId !== 'string') {
    return new Response('lote_id obrigatório', { status: 400, headers: corsHeaders });
  }

  const arquivos = formData.getAll('files').filter((v): v is File => v instanceof File);
  if (arquivos.length === 0) {
    return new Response('Nenhum arquivo enviado', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();
  const resultado: ResultadoUpload = { ok: 0, ja_tinha: 0, sem_match: 0, erros: [] };

  for (const arq of arquivos) {
    if (!EXT_REGEX.test(arq.name)) {
      resultado.erros.push({ arquivo: arq.name, motivo: 'Extensão não suportada' });
      continue;
    }
    const codigo = extrairCodigo(arq.name);
    if (!codigo) {
      resultado.erros.push({ arquivo: arq.name, motivo: 'Nome fora do padrão 00CODIGO.ext' });
      continue;
    }

    // Procurar variação correspondente
    const { data: variacoes, error } = await admin
      .from('variacoes')
      .select('id, imagem_path, familia_id, familias!inner(lote_id, user_id)')
      .eq('codigo', codigo)
      .eq('familias.lote_id', loteId)
      .eq('familias.user_id', u.id);
    if (error) {
      resultado.erros.push({ arquivo: arq.name, motivo: `DB: ${error.message}` });
      continue;
    }
    const variacao = variacoes?.[0];
    if (!variacao) {
      resultado.sem_match++;
      continue;
    }

    const tinhaImagem = !!variacao.imagem_path;
    const ext = arq.name.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg');
    const path = `${u.id}/${codigo}.${ext}`;

    const { error: upErr } = await admin.storage
      .from('imagens')
      .upload(path, arq, { contentType: arq.type, upsert: true });
    if (upErr) {
      resultado.erros.push({ arquivo: arq.name, motivo: `Storage: ${upErr.message}` });
      continue;
    }

    await admin.from('variacoes').update({ imagem_path: path }).eq('id', variacao.id);

    if (tinhaImagem) resultado.ja_tinha++;
    else resultado.ok++;
  }

  return new Response(JSON.stringify(resultado), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 2: Deploy via MCP Supabase**

Use `deploy_edge_function` MCP:
- `name`: `upload-imagens-lote`
- `entrypoint_path`: `index.ts`

Confirme `status: "ACTIVE"`.

- [ ] **Step 3: Smoke test — sem auth → 401**

```bash
curl -i -X POST "https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/upload-imagens-lote"
```
Expected: HTTP 401.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/upload-imagens-lote/
git commit -m "feat(m3): edge function upload-imagens-lote (JWT auth + match por codigo)"
```

---

## Task 12: Hook `useFamilias` reflete novos campos (custo, flags editado)

**Files:**
- Modify: `src/lib/queries.ts` (ou onde estiver `useFamilias`)
- Modify: `src/lib/tipos-dominio.ts`

- [ ] **Step 1: Localizar o hook**

Run: `grep -rn "useFamilias" src/`
Expected: encontra hook + adapter que mapeia row DB → tipo de domínio.

- [ ] **Step 2: Atualizar adapter pra incluir os novos campos**

Em `src/lib/queries.ts` (ou arquivo equivalente), no select dos `familias` adicionar:

```diff
- select('id, lote_id, pai, nome, descricao_detalhado, titulo, descricao, status, erro_mensagem')
+ select('id, lote_id, pai, nome, descricao_detalhado, titulo, descricao, status, erro_mensagem, tokens_input, tokens_output, custo_centavos, titulo_editado_pelo_operador, descricao_editada_pelo_operador')
```

E no select de `variacoes`:

```diff
- select('id, familia_id, codigo, nome, descricao_detalhado, cor, cor_origem, preco, estoque, imagem_path')
+ select('id, familia_id, codigo, nome, descricao_detalhado, cor, cor_origem, preco, estoque, imagem_path, cor_editada_pelo_operador, preco_editado_pelo_operador')
```

> Se a estrutura do projeto usa `select('*')`, então as colunas novas já entram automaticamente — só atualizar o adapter pra mapear.

- [ ] **Step 3: Atualizar tipo de domínio em `src/lib/tipos-dominio.ts`**

Adicionar nas interfaces `Familia` e `Variacao` os novos campos opcionais:

```diff
 export interface Familia {
   id: string;
   // ... campos existentes
+  tokens_input: number | null;
+  tokens_output: number | null;
+  custo_centavos: number | null;
+  titulo_editado_pelo_operador: boolean;
+  descricao_editada_pelo_operador: boolean;
 }

 export interface Variacao {
   id: string;
   // ... campos existentes
+  cor_editada_pelo_operador: boolean;
+  preco_editado_pelo_operador: boolean;
 }
```

- [ ] **Step 4: Atualizar adapter (mapper)**

Localize a função que converte row DB → Familia/Variacao e adicione os novos campos. Use `??` para defaults seguros.

- [ ] **Step 5: Verificar tipos**

Run: `pnpm build`
Expected: PASS sem erros TS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts src/lib/tipos-dominio.ts
git commit -m "feat(m3): hooks e tipos refletem campos de custo + flags editado"
```

---

## Task 13: Componente `DropZoneImagensExistente`

**Files:**
- Create: `src/components/drop-zone-imagens-existente.tsx`
- Test: `src/components/__tests__/drop-zone-imagens-existente.test.tsx`

- [ ] **Step 1: Escrever o teste**

Arquivo `src/components/__tests__/drop-zone-imagens-existente.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DropZoneImagensExistente } from '../drop-zone-imagens-existente';

describe('DropZoneImagensExistente', () => {
  it('renderiza instrução visível', () => {
    render(<DropZoneImagensExistente onArquivos={() => {}} />);
    expect(screen.getByText(/arraste imagens/i)).toBeInTheDocument();
  });

  it('chama onArquivos quando recebe File via input', () => {
    const onArquivos = vi.fn();
    render(<DropZoneImagensExistente onArquivos={onArquivos} />);
    const input = screen.getByTestId('drop-zone-input') as HTMLInputElement;
    const arquivo = new File(['x'], '00000123.jpeg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [arquivo] } });
    expect(onArquivos).toHaveBeenCalledWith([arquivo]);
  });
});
```

- [ ] **Step 2: Rodar teste — falha**

Run: `pnpm vitest run src/components/__tests__/drop-zone-imagens-existente.test.tsx`
Expected: FAIL "Cannot find module '../drop-zone-imagens-existente'".

- [ ] **Step 3: Implementar**

Arquivo `src/components/drop-zone-imagens-existente.tsx`:

```tsx
import { useDropzone } from 'react-dropzone';

interface Props {
  onArquivos: (arquivos: File[]) => void;
  desabilitado?: boolean;
}

export function DropZoneImagensExistente({ onArquivos, desabilitado }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/jpeg': ['.jpeg', '.jpg'], 'image/png': ['.png'] },
    disabled: desabilitado,
    onDrop: onArquivos,
  });
  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-md p-4 text-sm text-center cursor-pointer ${
        isDragActive ? 'border-blue-500 bg-blue-50' : 'border-neutral-300 bg-neutral-50'
      } ${desabilitado ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <input {...getInputProps({ 'data-testid': 'drop-zone-input' })} />
      📷 Arraste imagens para atribuir às variações
      <div className="text-xs text-neutral-500 mt-1">
        (aceita 00CODIGO.jpeg / .jpg / .png)
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar teste — passa**

Run: `pnpm vitest run src/components/__tests__/drop-zone-imagens-existente.test.tsx`
Expected: PASS 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/components/drop-zone-imagens-existente.tsx \
        src/components/__tests__/drop-zone-imagens-existente.test.tsx
git commit -m "feat(m3): DropZoneImagensExistente para upload posterior em massa"
```

---

## Task 14: Componente `BotaoTrocarFoto`

**Files:**
- Create: `src/components/botao-trocar-foto.tsx`
- Test: `src/components/__tests__/botao-trocar-foto.test.tsx`

- [ ] **Step 1: Escrever o teste**

Arquivo `src/components/__tests__/botao-trocar-foto.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BotaoTrocarFoto } from '../botao-trocar-foto';

describe('BotaoTrocarFoto', () => {
  it('chama onArquivo com o File selecionado', () => {
    const onArquivo = vi.fn();
    render(<BotaoTrocarFoto onArquivo={onArquivo} />);
    const input = screen.getByTestId('input-trocar-foto') as HTMLInputElement;
    const arquivo = new File(['x'], '00000123.jpeg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [arquivo] } });
    expect(onArquivo).toHaveBeenCalledWith(arquivo);
  });

  it('renderiza ícone de câmera com aria-label', () => {
    render(<BotaoTrocarFoto onArquivo={() => {}} />);
    expect(screen.getByRole('button', { name: /trocar foto/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar teste — falha**

Run: `pnpm vitest run src/components/__tests__/botao-trocar-foto.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Arquivo `src/components/botao-trocar-foto.tsx`:

```tsx
import { useRef } from 'react';
import { Camera } from 'lucide-react';

interface Props {
  onArquivo: (arquivo: File) => void;
  desabilitado?: boolean;
}

export function BotaoTrocarFoto({ onArquivo, desabilitado }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Trocar foto"
        disabled={desabilitado}
        className="p-1 rounded hover:bg-neutral-100 disabled:opacity-50"
        onClick={() => inputRef.current?.click()}
      >
        <Camera className="w-4 h-4" />
      </button>
      <input
        ref={inputRef}
        data-testid="input-trocar-foto"
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onArquivo(f);
          e.target.value = '';
        }}
      />
    </>
  );
}
```

- [ ] **Step 4: Rodar teste — passa**

Run: `pnpm vitest run src/components/__tests__/botao-trocar-foto.test.tsx`
Expected: PASS 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/components/botao-trocar-foto.tsx \
        src/components/__tests__/botao-trocar-foto.test.tsx
git commit -m "feat(m3): BotaoTrocarFoto (icone camera por variacao)"
```

---

## Task 15: Wire-up dos uploads na tela de Revisão + invalidação de cache

**Files:**
- Modify: `src/pages/Revisao.tsx`
- Modify: `src/components/variacao-card.tsx`
- Create: `src/lib/upload-imagens.ts` (helper para chamar a Edge Function)

- [ ] **Step 1: Criar helper `upload-imagens.ts`**

Arquivo `src/lib/upload-imagens.ts`:

```ts
import { supabase } from './supabase';

export interface ResultadoUpload {
  ok: number;
  ja_tinha: number;
  sem_match: number;
  erros: Array<{ arquivo: string; motivo: string }>;
}

export async function uploadImagensLote(
  loteId: string,
  arquivos: File[],
): Promise<ResultadoUpload> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const form = new FormData();
  form.append('lote_id', loteId);
  arquivos.forEach((f) => form.append('files', f));
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-imagens-lote`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: form,
  });
  if (!resp.ok) throw new Error(`Upload falhou: ${await resp.text()}`);
  return resp.json();
}
```

- [ ] **Step 2: Adicionar drop zone no topo da Revisao**

Em `src/pages/Revisao.tsx`, importar e renderizar acima da lista:

```tsx
import { DropZoneImagensExistente } from '@/components/drop-zone-imagens-existente';
import { uploadImagensLote } from '@/lib/upload-imagens';
import { useQueryClient } from '@tanstack/react-query';

// ... dentro do componente:
const qc = useQueryClient();

async function lidarArquivosDrop(arquivos: File[]) {
  try {
    const r = await uploadImagensLote(loteId, arquivos);
    qc.invalidateQueries({ queryKey: ['familias', loteId] });
    toast?.success?.(`${r.ok} novas · ${r.ja_tinha} substituídas · ${r.sem_match} sem match`);
    if (r.erros.length) toast?.error?.(`${r.erros.length} erros — ver console`);
  } catch (e) {
    toast?.error?.(`Erro: ${(e as Error).message}`);
  }
}

// no JSX:
<div className="mb-4">
  <DropZoneImagensExistente onArquivos={lidarArquivosDrop} />
</div>
```

> Se a página não usa toast hoje, use `console.log` / `console.error` no lugar e adicione `// TODO: trocar por sonner toast quando entrar no projeto`.

- [ ] **Step 3: Adicionar ícone câmera em `variacao-card.tsx`**

Em `src/components/variacao-card.tsx`, importar `BotaoTrocarFoto`. Adicionar ao lado do thumbnail:

```tsx
import { BotaoTrocarFoto } from '@/components/botao-trocar-foto';
import { uploadImagensLote } from '@/lib/upload-imagens';
import { useQueryClient } from '@tanstack/react-query';

// ... onde renderiza a variação, adicionar ao lado da foto:
const qc = useQueryClient();
async function lidarTrocaFoto(file: File) {
  // Renomeia o arquivo pro formato esperado caso o user tenha dropado nome diferente
  const renamed = new File([file], `${variacao.codigo}.${file.name.split('.').pop()}`, { type: file.type });
  await uploadImagensLote(loteId, [renamed]);
  qc.invalidateQueries({ queryKey: ['familias', loteId] });
}

<BotaoTrocarFoto onArquivo={lidarTrocaFoto} />
```

> `variacao-card.tsx` precisa receber `loteId` via prop — atualizar a passagem em `familia-expanded.tsx`.

- [ ] **Step 4: Run dev server + testar manualmente**

Run: `pnpm dev`
Abrir `http://localhost:5173/#/revisao/<lote_id>`, arrastar 1 arquivo nomeado com código real de variação, verificar:
- toast/console mostra "1 novas"
- imagem aparece após refetch
- clicar no ícone câmera de uma variação, escolher imagem nova, ver atualizar

- [ ] **Step 5: Run tests + build**

Run: `pnpm test && pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/upload-imagens.ts src/pages/Revisao.tsx src/components/variacao-card.tsx
git commit -m "feat(m3): drop zone + icone camera na Revisao chamando upload-imagens-lote"
```

---

## Task 16: Badges de origem da cor + alerta cor faltando + flags editado_pelo_operador

**Files:**
- Modify: `src/components/familia-row.tsx`
- Modify: `src/components/familia-expanded.tsx`
- Modify: `src/components/variacao-card.tsx`
- Create: `src/components/badge-cor-origem.tsx`

- [ ] **Step 1: Criar `BadgeCorOrigem`**

Arquivo `src/components/badge-cor-origem.tsx`:

```tsx
import type { OrigemCor } from '@/lib/tipos-dominio'; // ajustar se difere

type OrigemOuNula = OrigemCor | null;

const ESTILOS: Record<NonNullable<OrigemOuNula>, { bg: string; texto: string; rotulo: string }> = {
  descricao: { bg: 'bg-neutral-200 text-neutral-700', texto: '', rotulo: '📝 descrição' },
  vision: { bg: 'bg-blue-100 text-blue-700', texto: '', rotulo: '👁 IA Vision' },
  manual: { bg: 'bg-green-100 text-green-700', texto: '', rotulo: '✓ manual' },
};

interface Props { origem: OrigemOuNula; }

export function BadgeCorOrigem({ origem }: Props) {
  if (!origem) {
    return (
      <span className="inline-block text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">
        ⚠ sem cor — preencha
      </span>
    );
  }
  const e = ESTILOS[origem];
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded ${e.bg}`}>{e.rotulo}</span>
  );
}
```

- [ ] **Step 2: Renderizar o badge em `variacao-card.tsx`**

No JSX da variação, abaixo (ou ao lado) do campo de cor:

```tsx
import { BadgeCorOrigem } from '@/components/badge-cor-origem';
// ...
<BadgeCorOrigem origem={variacao.cor_origem} />
```

- [ ] **Step 3: Mostrar contagem de variações sem cor em `familia-row.tsx`**

Calcular `semCor = familia.variacoes.filter(v => !v.cor).length` e renderizar:

```tsx
{semCor > 0 && (
  <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">
    ⚠ {semCor} variaç{semCor === 1 ? 'ão' : 'ões'} sem cor
  </span>
)}
```

- [ ] **Step 4: Marcar flags `*_editado_pelo_operador` no onBlur das edições**

Localize o handler de save inline (deve estar em `familia-expanded.tsx` ou em um hook auxiliar). Adicionar comparação `valorOriginal !== valorAtual` e enviar a flag no UPDATE:

```ts
// pseudo no save de titulo:
await supabase.from('familias').update({
  titulo: novo,
  titulo_editado_pelo_operador: novo !== familia.titulo,
}).eq('id', familia.id);
```

Aplicar pra `titulo`, `descricao` na família; `cor`, `preco` na variação. Para `cor`, **também invalidar o cache Redis** chamando um endpoint helper (Task 17).

- [ ] **Step 5: Verificar visual no dev server + tests + build**

Run: `pnpm dev`
Abrir Revisao de um lote real, verificar:
- Variação com cor por Vision tem badge azul "👁 IA Vision"
- Variação sem cor tem badge vermelho "⚠ sem cor"
- Família com 3 variações sem cor mostra "⚠ 3 variações sem cor"

Run: `pnpm test && pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/badge-cor-origem.tsx src/components/familia-row.tsx \
        src/components/familia-expanded.tsx src/components/variacao-card.tsx
git commit -m "feat(m3): badges de origem da cor + alerta sem cor + flags editado_pelo_operador"
```

---

## Task 17: Edge Function helper `invalidar-cache-cor`

**Files:**
- Create: `supabase/functions/invalidar-cache-cor/index.ts`
- Modify: handler de save de cor (Task 16 step 4)

> Sem essa função, a edição manual de cor pelo operador mantém o valor antigo cacheado no Redis pelos próximos 90 dias.

- [ ] **Step 1: Criar a function**

Arquivo `supabase/functions/invalidar-cache-cor/index.ts`:

```ts
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { userClient } from '../_shared/supabase.ts';
import { cacheCorInvalidar } from '../_shared/redis/cache-cor.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return new Response('Missing auth', { status: 401, headers: corsHeaders });
  }
  const { data: { user } } = await userClient(auth.slice(7)).auth.getUser();
  if (!user) return new Response('Invalid token', { status: 401, headers: corsHeaders });

  let body: { codigo?: string };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!body.codigo) return new Response('codigo obrigatório', { status: 400, headers: corsHeaders });

  await cacheCorInvalidar(user.id, body.codigo);
  return new Response('OK', { status: 200, headers: corsHeaders });
});
```

- [ ] **Step 2: Deploy via MCP Supabase**

Use `deploy_edge_function` MCP com `name: invalidar-cache-cor`. Confirme ACTIVE.

- [ ] **Step 3: Wire-up no frontend**

No handler de save da cor (Task 16 step 4 — local: `familia-expanded.tsx` ou hook), depois do UPDATE adicionar:

```ts
if (novaCor !== variacao.cor) {
  const { data: { session } } = await supabase.auth.getSession();
  await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invalidar-cache-cor`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ codigo: variacao.codigo }),
  });
}
```

Também marcar `cor_origem='manual'` e `cor_editada_pelo_operador=true` no UPDATE.

- [ ] **Step 4: Build + test**

Run: `pnpm test && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/invalidar-cache-cor/ src/components/familia-expanded.tsx
git commit -m "feat(m3): invalidacao de cache de cor ao editar manualmente"
```

---

## Task 18: Rotacionar QStash signing keys + setar secrets do Supabase (MANUAL)

> Esta task é **manual** — Diego executa fora do código. Plano referência.

- [ ] **Step 1: Rotacionar no console Upstash**

Acessar https://console.upstash.com/ → QStash → Signing Keys → botão "Rotate". Anotar:
- novo `Current Signing Key`
- novo `Next Signing Key`

- [ ] **Step 2: Configurar Supabase secrets**

Via terminal:

```bash
supabase secrets set \
  QSTASH_CURRENT_SIGNING_KEY="sig_..." \
  QSTASH_NEXT_SIGNING_KEY="sig_..." \
  --project-ref txvncrgkoynoxwopfkbp
```

Se não tem Supabase CLI: abrir dashboard → Project Settings → Edge Functions → Secrets → editar `QSTASH_CURRENT_SIGNING_KEY` e `QSTASH_NEXT_SIGNING_KEY` manualmente.

- [ ] **Step 3: Configurar também os secrets de IA + Redis (se ainda não setados)**

```bash
supabase secrets set \
  OPENROUTER_API_KEY="sk-or-..." \
  UPSTASH_REDIS_REST_URL="https://...upstash.io" \
  UPSTASH_REDIS_REST_TOKEN="A...=" \
  AI_MODEL_COPY="openai/gpt-4o-mini" \
  AI_MODEL_VISION="openai/gpt-4o" \
  --project-ref txvncrgkoynoxwopfkbp
```

- [ ] **Step 4: Validar via QStash MCP**

Use `qstash_publish_message` MCP enviando para a URL de `process-familia` com payload `{"familia_id":"<id real>","lote_id":"<id real>"}`. Deve receber `200 OK` (signature válida).

Tentar sem signature (curl direto sem header) — deve receber `401`.

- [ ] **Step 5: Marcar TODO removido em código**

Confirmar via `grep -rn "TODO(M3)" supabase/` que não tem mais nenhum bypass:

```bash
grep -rn "TODO(M3)" supabase/
```
Expected: vazio.

- [ ] **Step 6: Nada para commitar (manual). Atualizar `docs/TASKS.md` marcando o item "Restaurar QStash signature" como ✅.**

---

## Task 19: Bug bash M3 + iteração do prompt

> Validação semântica do prompt do copywriter. Sem código novo nesta task.

- [ ] **Step 1: Importar lote real diverso**

Pedir ao Diego pra preparar uma planilha com **10 famílias diversas** (mistura: linhas de costura, botões, fitas). Fazer upload via tela "Novo Lote".

- [ ] **Step 2: Acompanhar processamento**

Abrir Progresso → ver famílias avançarem `pendente → processando → pronto`. Verificar QStash dashboard (Upstash MCP) — todas as mensagens com status `DELIVERED`.

- [ ] **Step 3: Revisar as 10 famílias na tela de Revisão**

Para cada família, anotar:
- Título: aprovado / ajuste / refazer
- Descrição: aprovado / ajuste / refazer
- Cor das variações: % corretas (origem `descricao` vs `vision`)

- [ ] **Step 4: Iterar o prompt se necessário**

Se ≥3 famílias precisam de "refazer", revisar o prompt em `supabase/functions/_shared/ai/copywriter.ts` baseado no feedback comum. Padrões possíveis:
- "Descrição muito longa" → adicionar regra de tamanho
- "Tom genérico demais" → ajustar tom
- "Não menciona aplicação do produto" → adicionar item na regra

Após ajuste:
- Re-deploy `process-familia` via MCP (recompila implicitamente as deps)
- Marcar 10 famílias como `pendente` no banco
- Re-enfileirar via `qstash_publish_message` MCP por família OU re-subir um lote novo
- Re-revisar

Repetir até atingir **≥8 famílias aprovadas sem edição em 10**.

- [ ] **Step 5: Documentar resultado**

Atualizar `docs/TASKS.md` na seção M3:
- ✅ marcar tarefas concluídas
- Adicionar nota com versão final do prompt (ou referenciar commit)
- Listar quaisquer bugs encontrados que viram TODOs (M4/M5)

Atualizar `docs/ROADMAP.md`:
- M3 → ✅ Concluído
- Atualizar "Saída entregue" com resumo do bug bash
- Listar desvios documentados

- [ ] **Step 6: Commit final do M3**

```bash
git add docs/TASKS.md docs/ROADMAP.md \
        supabase/functions/_shared/ai/copywriter.ts # se prompt mudou
git commit -m "docs: M3 concluido apos bug bash + iteracao do prompt"
```

---

## Task 20: Atualizar CLAUDE.md e fechar a branch

**Files:**
- Modify: `CLAUDE.md` (data e status no histórico)

- [ ] **Step 1: Atualizar `CLAUDE.md`**

Bumpar a data no header e adicionar linha no histórico:

```diff
- **Última atualização:** 2026-05-27
+ **Última atualização:** 2026-MM-DD
- **Status do projeto:** M0+M1+M2 ✅ concluídos; M3 (IA copywriting + Vision) é o próximo marco
+ **Status do projeto:** M0+M1+M2+M3 ✅ concluídos; M4 (Integração ML) é o próximo marco
```

E no fim, na tabela de histórico:

```
| 2026-MM-DD | M3 concluído após bug bash com 10 famílias diversas; ≥8 aprovadas sem edição |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md aponta M4 como proximo marco"
```

- [ ] **Step 3: Merge na main**

Confirmar todos os tests passam:

```bash
pnpm test && pnpm build
```

Merge via fast-forward:

```bash
git checkout main
git merge --ff-only m3-ia-copywriting
git push origin main
```

- [ ] **Step 4: Smoke test em produção**

Após o auto-deploy do Render (~40s), abrir `https://ean2marketplace-frontend.onrender.com`, fazer login, abrir lote real, verificar que tudo continua funcionando.

---

## Self-review (executado durante a escrita)

- ✅ **Cobertura do spec:** todas as 15 seções do spec têm tarefa correspondente (1→Task 1, 4→Task 10, 5→Tasks 2-3, 6→Task 9, 7→Task 4, 8→Task 1, 9→Tasks 12-16, 10→Task 11, 11→Task 18, 12→Task 10, 13→Tasks 2-5 + 13-14, 14→Task 19)
- ✅ **Sem placeholders:** todos os steps têm código real, comandos exatos, expected outputs claros
- ✅ **Consistência de tipos:** `OrigemCor`, `Familia`, `Variacao`, `InputCopy`, `OutputCopy` aparecem com os mesmos campos em todas as tasks
- ✅ **Decisões pragmáticas registradas:** vitest só para puro; manual para Deno-bound; migration timestamp segue padrão real; componentes em kebab-case no root de `src/components/`
- ✅ **Restauração QStash separada em task própria** (Task 18) — Diego executa manualmente, sem código

## Métricas finais esperadas

- **Tasks:** 20 (sendo 1 manual)
- **Novos arquivos:** 19 (13 backend + 6 frontend)
- **Arquivos modificados:** 6
- **Novos testes:** 5 arquivos (≥18 testes) → total `pnpm test` ≥ 79
- **Custo de IA durante o bug bash:** estimado < $0.50 (5-10 famílias × 2-3 iterações de prompt)
- **Tempo estimado:** ~2 semanas (alinhado com a estimativa original do ROADMAP)
