# Busca de concorrência (M4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Para cada família, descobrir vendedores e menor preço no Mercado Livre, classificar a concorrência e persistir na família, alimentando a estratégia de preço (ADR-0008).

**Architecture:** Funções puras (TDD/vitest) em `supabase/functions/_shared/concorrencia/`; a busca com efeito (HTTP + cache) em `_shared/ml/concorrencia.ts` usando `getValidAccessToken` (ADR-0012) e cache Redis 6h; integração 1×/família no `process-familia` após a copy; migration aditiva em `familias`. Resiliência: qualquer falha → "nenhuma" (estratégia PRÓPRIO segura).

**Tech Stack:** Supabase Edge Functions (Deno/TS), vitest (funções puras), Upstash Redis (REST), API Mercado Livre (`/sites/MLB/search`), deploy via MCP supabase.

**Spec:** `docs/superpowers/specs/2026-05-31-m4-busca-concorrencia-design.md` · **ADR:** `docs/decisions/0014-busca-de-concorrencia.md`

---

## Convenções do projeto (ler antes de começar)

- **Imports no código-fonte** (`.ts`): Deno exige extensão → `import { x } from './client.ts'`.
- **Imports nos testes** (vitest): sem extensão → `import { x } from '../extrair'`.
- Testes ficam em `__tests__/` ao lado do módulo; vitest já inclui `supabase/functions/**/__tests__/`.
- Rodar 1 teste: `pnpm vitest run <caminho-do-teste>`. Suíte toda: `pnpm test`.
- Deploy de edge function, migration e geração de tipos são feitos via **MCP supabase**
  (`deploy_edge_function`, `apply_migration`, `generate_typescript_types`) — não há CLI local.
- Após código novo: `pnpm lint` deve ficar verde (config ESLint já existe; ignora `supabase/functions`,
  mas os arquivos de teste em `tests/`/`__tests__` rodam no vitest de qualquer forma).

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `_shared/concorrencia/tipos.ts` (criar) | tipos compartilhados (`OrigemConcorrencia`, `ClasseConcorrencia`, `ResultadoConcorrencia`) |
| `_shared/concorrencia/gtin.ts` (criar) | `gtinValido` — função pura |
| `_shared/concorrencia/classificar.ts` (criar) | `classificarConcorrencia` — função pura |
| `_shared/concorrencia/identificador.ts` (criar) | `escolherIdentificador` — função pura |
| `_shared/concorrencia/parse.ts` (criar) | `parseResultadoBusca` — função pura |
| `_shared/concorrencia/__tests__/*.test.ts` (criar) | testes das 4 funções puras |
| `_shared/redis/cache-concorrencia.ts` (criar) | get/set do cache (TTL 6h), segue padrão de `cache-cor.ts` |
| `_shared/ml/concorrencia.ts` (criar) | `buscarConcorrencia` — efeito (HTTP + cache + resiliência) |
| `process-familia/index.ts` (modificar) | chama `buscarConcorrencia` 1×/família e persiste |
| migration `add_concorrencia_familias` (MCP) | 2 enums + 4 colunas em `familias` |

> Nota: `_shared/concorrencia/pool.ts` já existe e é o **pool de paralelismo** (Vision). Não confundir —
> os módulos novos são de "concorrentes no ML". Não tocar em `pool.ts`.

---

### Task 1: Tipos compartilhados

**Files:**
- Create: `supabase/functions/_shared/concorrencia/tipos.ts`

- [ ] **Step 1: Criar o arquivo de tipos**

```ts
export type OrigemConcorrencia = 'gtin' | 'titulo' | 'nenhuma';
export type ClasseConcorrencia = 'sem' | 'moderada' | 'alta';

export interface ResultadoConcorrencia {
  vendedores: number;
  preco_min: number | null;
  origem: OrigemConcorrencia;
  classe: ClasseConcorrencia;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/concorrencia/tipos.ts
git commit -m "feat(m4): tipos compartilhados da busca de concorrencia"
```

---

### Task 2: `gtinValido` (função pura)

**Files:**
- Create: `supabase/functions/_shared/concorrencia/gtin.ts`
- Test: `supabase/functions/_shared/concorrencia/__tests__/gtin.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { gtinValido } from '../gtin';

describe('gtinValido', () => {
  it('rejeita nulo e vazio', () => {
    expect(gtinValido(null)).toBe(false);
    expect(gtinValido('')).toBe(false);
    expect(gtinValido('   ')).toBe(false);
  });

  it('rejeita código interno 3000* (não é EAN real)', () => {
    expect(gtinValido('30001234')).toBe(false);
    expect(gtinValido('3000123456789')).toBe(false);
  });

  it('rejeita não-dígitos e comprimentos inválidos', () => {
    expect(gtinValido('abc')).toBe(false);
    expect(gtinValido('123')).toBe(false);          // curto demais
    expect(gtinValido('123456789012345')).toBe(false); // 15 dígitos
    expect(gtinValido('7891234abc012')).toBe(false);
  });

  it('aceita EAN/GTIN de comprimento válido (8,12,13,14)', () => {
    expect(gtinValido('78912345')).toBe(true);        // 8
    expect(gtinValido('789123456789')).toBe(true);    // 12
    expect(gtinValido('7891234567890')).toBe(true);   // 13
    expect(gtinValido('78912345678901')).toBe(true);  // 14
  });

  it('tolera espaços nas bordas', () => {
    expect(gtinValido(' 7891234567890 ')).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm vitest run supabase/functions/_shared/concorrencia/__tests__/gtin.test.ts`
Expected: FAIL (`gtinValido` não existe / módulo não encontrado)

- [ ] **Step 3: Implementar**

```ts
export function gtinValido(gtin: string | null): boolean {
  if (!gtin) return false;
  const s = gtin.trim();
  if (!/^\d+$/.test(s)) return false;
  if (s.startsWith('3000')) return false; // código interno, não EAN GS1 real
  return [8, 12, 13, 14].includes(s.length);
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm vitest run supabase/functions/_shared/concorrencia/__tests__/gtin.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/concorrencia/gtin.ts supabase/functions/_shared/concorrencia/__tests__/gtin.test.ts
git commit -m "feat(m4): gtinValido (rejeita nulo/3000*/formato invalido)"
```

---

### Task 3: `classificarConcorrencia` (função pura)

**Files:**
- Create: `supabase/functions/_shared/concorrencia/classificar.ts`
- Test: `supabase/functions/_shared/concorrencia/__tests__/classificar.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { classificarConcorrencia } from '../classificar';

describe('classificarConcorrencia', () => {
  it('0 vendedores → sem', () => {
    expect(classificarConcorrencia(0)).toBe('sem');
  });
  it('1 a 5 → moderada', () => {
    expect(classificarConcorrencia(1)).toBe('moderada');
    expect(classificarConcorrencia(5)).toBe('moderada');
  });
  it('6 ou mais → alta', () => {
    expect(classificarConcorrencia(6)).toBe('alta');
    expect(classificarConcorrencia(50)).toBe('alta');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm vitest run supabase/functions/_shared/concorrencia/__tests__/classificar.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

```ts
import type { ClasseConcorrencia } from './tipos.ts';

export function classificarConcorrencia(vendedores: number): ClasseConcorrencia {
  if (vendedores <= 0) return 'sem';
  if (vendedores <= 5) return 'moderada';
  return 'alta';
}
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `pnpm vitest run supabase/functions/_shared/concorrencia/__tests__/classificar.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/concorrencia/classificar.ts supabase/functions/_shared/concorrencia/__tests__/classificar.test.ts
git commit -m "feat(m4): classificarConcorrencia (sem/moderada/alta)"
```

---

### Task 4: `escolherIdentificador` (função pura)

**Files:**
- Create: `supabase/functions/_shared/concorrencia/identificador.ts`
- Test: `supabase/functions/_shared/concorrencia/__tests__/identificador.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { escolherIdentificador } from '../identificador';

describe('escolherIdentificador', () => {
  it('usa o GTIN da 1ª variação com GTIN válido', () => {
    const fam = {
      nome_pai: 'Linha de Costura X',
      variacoes: [{ gtin: null }, { gtin: '30001111' }, { gtin: '7891234567890' }],
    };
    expect(escolherIdentificador(fam)).toEqual({ tipo: 'gtin', valor: '7891234567890' });
  });

  it('cai para o título do PAI quando nenhuma variação tem GTIN válido', () => {
    const fam = {
      nome_pai: 'Linha de Costura X',
      variacoes: [{ gtin: null }, { gtin: '30009999' }, { gtin: '' }],
    };
    expect(escolherIdentificador(fam)).toEqual({ tipo: 'titulo', valor: 'Linha de Costura X' });
  });

  it('cai para o título quando não há variações', () => {
    const fam = { nome_pai: 'Fita Cetim', variacoes: [] };
    expect(escolherIdentificador(fam)).toEqual({ tipo: 'titulo', valor: 'Fita Cetim' });
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm vitest run supabase/functions/_shared/concorrencia/__tests__/identificador.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

```ts
import { gtinValido } from './gtin.ts';

export interface FamiliaParaBusca {
  nome_pai: string;
  variacoes: { gtin: string | null }[];
}

export function escolherIdentificador(
  familia: FamiliaParaBusca,
): { tipo: 'gtin' | 'titulo'; valor: string } {
  const comGtin = familia.variacoes.find((v) => gtinValido(v.gtin));
  if (comGtin?.gtin) return { tipo: 'gtin', valor: comGtin.gtin.trim() };
  return { tipo: 'titulo', valor: familia.nome_pai };
}
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `pnpm vitest run supabase/functions/_shared/concorrencia/__tests__/identificador.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/concorrencia/identificador.ts supabase/functions/_shared/concorrencia/__tests__/identificador.test.ts
git commit -m "feat(m4): escolherIdentificador (GTIN valido -> titulo)"
```

---

### Task 5: `parseResultadoBusca` (função pura)

**Files:**
- Create: `supabase/functions/_shared/concorrencia/parse.ts`
- Test: `supabase/functions/_shared/concorrencia/__tests__/parse.test.ts`

Contexto: o endpoint `/sites/MLB/search` retorna `{ results: [{ price, seller: { id } }, ...] }`.
Contamos **vendedores distintos** (sellers únicos) e o **menor preço**. Payload vazio/inesperado → zero.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { parseResultadoBusca } from '../parse';

describe('parseResultadoBusca', () => {
  it('payload vazio → 0 vendedores, preço null', () => {
    expect(parseResultadoBusca({ results: [] })).toEqual({ vendedores: 0, preco_min: null });
    expect(parseResultadoBusca({})).toEqual({ vendedores: 0, preco_min: null });
    expect(parseResultadoBusca(null)).toEqual({ vendedores: 0, preco_min: null });
  });

  it('conta vendedores distintos e pega o menor preço', () => {
    const json = {
      results: [
        { price: 9.9, seller: { id: 1 } },
        { price: 7.5, seller: { id: 2 } },
        { price: 8.0, seller: { id: 1 } }, // mesmo seller 1
      ],
    };
    expect(parseResultadoBusca(json)).toEqual({ vendedores: 2, preco_min: 7.5 });
  });

  it('ignora preços inválidos (<=0 ou ausentes)', () => {
    const json = {
      results: [
        { price: 0, seller: { id: 1 } },
        { price: 5.25, seller: { id: 2 } },
        { seller: { id: 3 } },
      ],
    };
    expect(parseResultadoBusca(json)).toEqual({ vendedores: 3, preco_min: 5.25 });
  });

  it('sem seller.id usa o nº de resultados como fallback de contagem', () => {
    const json = { results: [{ price: 3 }, { price: 4 }] };
    expect(parseResultadoBusca(json)).toEqual({ vendedores: 2, preco_min: 3 });
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm vitest run supabase/functions/_shared/concorrencia/__tests__/parse.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

```ts
interface MLSearchResult {
  price?: number;
  seller?: { id?: number | string };
}

export function parseResultadoBusca(json: unknown): { vendedores: number; preco_min: number | null } {
  const results = (json as { results?: MLSearchResult[] } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) {
    return { vendedores: 0, preco_min: null };
  }
  const precos = results
    .map((r) => r.price)
    .filter((p): p is number => typeof p === 'number' && p > 0);
  const sellers = new Set(
    results.map((r) => r.seller?.id).filter((id) => id !== undefined && id !== null),
  );
  return {
    vendedores: sellers.size > 0 ? sellers.size : results.length,
    preco_min: precos.length ? Math.min(...precos) : null,
  };
}
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `pnpm vitest run supabase/functions/_shared/concorrencia/__tests__/parse.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/concorrencia/parse.ts supabase/functions/_shared/concorrencia/__tests__/parse.test.ts
git commit -m "feat(m4): parseResultadoBusca (vendedores distintos + menor preco)"
```

---

### Task 6: Cache Redis da concorrência

**Files:**
- Create: `supabase/functions/_shared/redis/cache-concorrencia.ts`

Segue o padrão de `cache-cor.ts` (mesmo arquivo de referência), com TTL de 6h.

- [ ] **Step 1: Criar o módulo de cache**

```ts
import { redisGet, redisSet } from './client.ts';
import type { ClasseConcorrencia, OrigemConcorrencia } from '../concorrencia/tipos.ts';

const TTL_6_HORAS = 60 * 60 * 6;

export interface CacheConcorrenciaEntrada {
  vendedores: number;
  preco_min: number | null;
  origem: OrigemConcorrencia;
  classe: ClasseConcorrencia;
  criado_em: string;
}

function chave(termo: string): string {
  return `cache:concorrencia:${termo}`;
}

export async function cacheConcorrenciaGet(termo: string): Promise<CacheConcorrenciaEntrada | null> {
  const valor = await redisGet(chave(termo));
  if (!valor) return null;
  try {
    return JSON.parse(valor) as CacheConcorrenciaEntrada;
  } catch {
    return null;
  }
}

export async function cacheConcorrenciaSet(
  termo: string,
  entrada: Omit<CacheConcorrenciaEntrada, 'criado_em'>,
): Promise<void> {
  const payload: CacheConcorrenciaEntrada = { ...entrada, criado_em: new Date().toISOString() };
  await redisSet(chave(termo), JSON.stringify(payload), TTL_6_HORAS);
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/redis/cache-concorrencia.ts
git commit -m "feat(m4): cache Redis da concorrencia (TTL 6h)"
```

---

### Task 7: `buscarConcorrencia` (efeito: HTTP + cache + resiliência)

**Files:**
- Create: `supabase/functions/_shared/ml/concorrencia.ts`

Sem teste unitário (faz I/O HTTP) — validado no bug bash (Task 10). A resiliência é a regra-chave:
**qualquer** erro/timeout/resposta ruim → retorna `NENHUMA` (nunca lança).

- [ ] **Step 1: Implementar a função**

```ts
import { getValidAccessToken } from './token.ts';
import { escolherIdentificador, type FamiliaParaBusca } from '../concorrencia/identificador.ts';
import { parseResultadoBusca } from '../concorrencia/parse.ts';
import { classificarConcorrencia } from '../concorrencia/classificar.ts';
import { cacheConcorrenciaGet, cacheConcorrenciaSet } from '../redis/cache-concorrencia.ts';
import type { ResultadoConcorrencia } from '../concorrencia/tipos.ts';

const NENHUMA: ResultadoConcorrencia = {
  vendedores: 0, preco_min: null, origem: 'nenhuma', classe: 'sem',
};

const SEARCH_URL = 'https://api.mercadolibre.com/sites/MLB/search';

export async function buscarConcorrencia(
  userId: string,
  familia: FamiliaParaBusca,
): Promise<ResultadoConcorrencia> {
  try {
    const ident = escolherIdentificador(familia);
    const termo = `${ident.tipo}:${ident.valor}`;

    const cached = await cacheConcorrenciaGet(termo).catch(() => null);
    if (cached) {
      return {
        vendedores: cached.vendedores,
        preco_min: cached.preco_min,
        origem: ident.tipo,
        classe: cached.classe,
      };
    }

    const token = await getValidAccessToken(userId);
    const url = `${SEARCH_URL}?q=${encodeURIComponent(ident.valor)}&limit=50`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      console.warn(`ML search ${resp.status} para "${ident.valor}"`);
      return NENHUMA;
    }

    const json = await resp.json();
    const { vendedores, preco_min } = parseResultadoBusca(json);
    const classe = classificarConcorrencia(vendedores);
    const resultado: ResultadoConcorrencia = { vendedores, preco_min, origem: ident.tipo, classe };

    await cacheConcorrenciaSet(termo, resultado).catch(() => {});
    return resultado;
  } catch (e) {
    console.warn(`buscarConcorrencia falhou: ${(e as Error).message}`);
    return NENHUMA;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/ml/concorrencia.ts
git commit -m "feat(m4): buscarConcorrencia (search ML + cache + resiliencia)"
```

---

### Task 8: Migration — colunas de concorrência em `familias`

**Files:**
- Migration (via MCP supabase `apply_migration`, nome: `add_concorrencia_familias`)

- [ ] **Step 1: Aplicar a migration (MCP `apply_migration`)**

```sql
create type origem_concorrencia as enum ('gtin', 'titulo', 'nenhuma');
create type classe_concorrencia as enum ('sem', 'moderada', 'alta');

alter table familias
  add column concorrencia_vendedores integer not null default 0,
  add column concorrencia_preco_min numeric,
  add column concorrencia_origem origem_concorrencia not null default 'nenhuma',
  add column concorrencia_classe classe_concorrencia not null default 'sem';
```

- [ ] **Step 2: Regenerar tipos TypeScript (MCP `generate_typescript_types`)**

Substituir o conteúdo de `src/lib/database.types.ts` (ou caminho equivalente já usado no projeto)
pelo output do MCP. Verificar que `familias.Row` agora tem os 4 campos novos.

- [ ] **Step 3: Verificar build de tipos**

Run: `pnpm build`
Expected: PASS (tsc sem erros)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations src/lib/database.types.ts
git commit -m "feat(m4): migration colunas de concorrencia em familias + tipos"
```

> Nota: se o projeto não versiona o SQL da migration localmente (deploy via MCP), commitar ao
> menos os tipos regenerados e registrar o nome da migration na mensagem.

---

### Task 9: Integração no `process-familia`

**Files:**
- Modify: `supabase/functions/process-familia/index.ts`

- [ ] **Step 1: Adicionar o import (topo do arquivo)**

```ts
import { buscarConcorrencia } from '../_shared/ml/concorrencia.ts';
```

- [ ] **Step 2: Incluir `gtin` no select das variações**

Localizar (passo "2. Carregar variações"):

```ts
      .select('id, codigo, cor, cor_origem, nome, preco, imagem_path')
```

Trocar por:

```ts
      .select('id, codigo, gtin, cor, cor_origem, nome, preco, imagem_path')
```

- [ ] **Step 3: Buscar concorrência após a copy (1×/família)**

Logo após o bloco "5. Copywriter (1 chamada por família)" (depois de `const copy = await gerarCopy(...)`)
e **antes** do update final, inserir:

```ts
    // 5b. Busca de concorrência (1x por família) — ADR-0014. Resiliente: erro → "nenhuma".
    const concorrencia = await buscarConcorrencia(userId, {
      nome_pai: claimed.nome_pai,
      variacoes: resolvidas.map((v) => ({ gtin: v.gtin })),
    });
```

- [ ] **Step 4: Persistir os campos no update final da família**

Localizar o update "6. Persistir título + descrição + custos + status final" e acrescentar os 4 campos:

```ts
    await admin.from('familias').update({
      titulo_ml: copy.titulo,
      descricao_ml: copy.descricao,
      tokens_input: copy.tokens_input,
      tokens_output: copy.tokens_output,
      custo_centavos: copy.custo_centavos,
      concorrencia_vendedores: concorrencia.vendedores,
      concorrencia_preco_min: concorrencia.preco_min,
      concorrencia_origem: concorrencia.origem,
      concorrencia_classe: concorrencia.classe,
      status: 'pronto',
    }).eq('id', job.familia_id);
```

- [ ] **Step 5: Rodar a suíte completa (garantir que nada quebrou)**

Run: `pnpm test`
Expected: PASS (106 baseline + novos testes das Tasks 2–5)

- [ ] **Step 6: Deploy via MCP supabase (`deploy_edge_function`, função `process-familia`)**

Deployar incluindo os novos arquivos `_shared/`. Confirmar versão ACTIVE.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/process-familia/index.ts
git commit -m "feat(m4): integra busca de concorrencia no process-familia"
```

---

### Task 10: Bug bash (manual, token real)

**Files:** nenhum (validação)

- [ ] **Step 1: Lote de teste com 2 famílias**

Subir um lote com: (a) uma família cujas variações têm **EAN real** (espera `origem='gtin'`,
possíveis vendedores) e (b) uma família só com código `3000*`/sem GTIN (espera `origem='titulo'`,
baixa confiança).

- [ ] **Step 2: Conferir persistência**

Via MCP `execute_sql`:

```sql
select codigo_pai, concorrencia_origem, concorrencia_classe,
       concorrencia_vendedores, concorrencia_preco_min
from familias
where lote_id = '<id-do-lote-de-teste>';
```

Esperado: linha (a) com `origem='gtin'`; linha (b) com `origem='titulo'`. Valores coerentes com o ML.

- [ ] **Step 3: Validar resiliência**

Confirmar (nos logs via MCP `get_logs`) que, se a busca falhar/expirar, a família ainda fica
`pronto` com `origem='nenhuma'` (não trava o processamento).

- [ ] **Step 4: Ajustar `parseResultadoBusca` se o payload real divergir**

Se os campos do JSON real (`results`/`seller.id`/`price`) divergirem, ajustar **apenas**
`parse.ts` + seus testes. Redeployar `process-familia`.

- [ ] **Step 5: Atualizar docs**

Marcar os itens "Busca de concorrência" no `TASKS.md` como ✅ e registrar no `ROADMAP.md` /
histórico do `CLAUDE.md`. Commit.

---

## Self-Review

- **Cobertura do spec:** funções puras (Tasks 2–5) ✓; cache 6h (Task 6) ✓; busca com efeito +
  resiliência + getValidAccessToken (Task 7) ✓; migration + tipos (Task 8) ✓; integração 1×/família
  no process-familia (Task 9) ✓; testes (Tasks 2–5, 9) ✓; bug bash (Task 10) ✓.
- **Consistência de tipos:** `ResultadoConcorrencia`/`OrigemConcorrencia`/`ClasseConcorrencia`
  definidos na Task 1 e usados igual em 3/6/7/9; `FamiliaParaBusca` definido na Task 4 e usado em 7/9;
  `escolherIdentificador`/`parseResultadoBusca`/`classificarConcorrencia`/`gtinValido` com as mesmas
  assinaturas em todo o plano.
- **Sem placeholders:** todo step de código mostra o código real.
- **Divergência consciente do ADR-0014:** o ADR menciona "catálogo por GTIN"; o plano usa
  `/sites/MLB/search?q={gtin|titulo}` para ambos (mais simples e testável). Se a busca textual por
  GTIN trouxer ruído no bug bash, migrar o ramo GTIN para `/products/search?product_identifier=` —
  mudança isolada em `buscarConcorrencia` + `parse.ts`.
