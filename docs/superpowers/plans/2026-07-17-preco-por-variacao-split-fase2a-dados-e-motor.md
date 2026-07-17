# Preço por variação — Fase 2a: dados e motor de split por faixa (backend) — Plano de Implementação

> **Para workers agênticos:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans pra implementar este plano task a task. Steps usam sintaxe de checkbox (`- [ ]`) pra tracking.

**Objetivo:** O backend passa a suportar preços divergentes entre variações de uma família: publicação roteia por faixa de preço para o split (N anúncios), com desconto/atacado resolvidos por grupo e LOUD em toda ambiguidade financeira — sem nenhuma mudança de UI ainda.

**Arquitetura:** Colunas aditivas (`variacoes.exibir_com_desconto/desconto_pct/atacado`, `anuncios_externos.atacado_status/atacado_erro`, NULL = herda o família-level). Helpers puros novos (`_shared/preco/grupos.ts`, `_shared/preco/config-grupo.ts`, `particionarPorPreco` em `_shared/split/particionar.ts`, `decidirSplit` em `publicar-familias/`) testados isoladamente; os workers só fazem o wiring. `publicar-familias` roteia divergência (e produto já particionado) para `publicar-split-ml`; `publish-familia-ml`/`update-familia-ml` ganham guard LOUD de uniformidade; `publicar-split-ml` particiona por preço, aplica desconto e PxQ **por partição** (fecha a lacuna: o split nunca aplicou atacado) e falha LOUD quando honrar os preços exigiria migrar variação publicada.

**Stack:** Supabase Edge Functions (Deno/TS), QStash, vitest (roda os testes de `supabase/functions/**/__tests__`), Supabase CLI para migration.

## Restrições Globais

- **Invariante #1 (ADR-0078):** nunca existe preço divergente publicado sem split. Este plano (2a) entra ANTES da UI (2b) — a UI atual ainda replica preço e bloqueia desconto/atacado em divergência, então 2a sozinho é seguro (e conserta a divergência que o re-ingest já cria hoje e o publish colapsava em silêncio).
- **Invariante #2:** config financeira nunca órfã/aplicada em silêncio. Config viaja NA VARIAÇÃO; grupo divergente herdando config família-level ATIVA sem confirmação explícita → LOUD (Error com `status = 400`, definitivo — o QStash não retenta config errada). ADR-0055.
- **Invariante #3:** `somenteEstoque` não empurra preço por nenhum caminho (já garantido na F1 pelo conector; este plano não pode regredir isso).
- **Invariante #4:** ancoragem manda (ADR-0048): variação publicada nunca migra de anúncio; incompatibilidade de faixa → LOUD, não migra.
- Preços comparados por **centavos inteiros**: `Math.round(Number(preco) * 100)` (spec, glossário).
- Migrations SÓ via `supabase migration new` + `supabase db push` + `npm run db:check` (ADR-0043). Nunca `apply_migration`/painel.
- Edge Functions idempotentes; workers QStash com `verify_jwt=false` (config existente, não mexer).
- Caminho uniforme (todas as cores no mesmo preço, ≤100 cores, 1 partição) permanece **idêntico** ao atual — testes de caracterização obrigatórios.
- Rodar `pnpm test` exige `.env.test` (já existe no repo). Typecheck das functions: `npm run check:functions`; lint: `pnpm lint` + `npm run lint:functions`.
- Trabalho em worktree/branch (nunca na main). Commits pequenos e frequentes.
- Fase 1 (ADR-0078: `preco_publicado_ml`, badge, "somente estoque", `precoAConfirmar`, `resolverSomenteEstoque`) JÁ está na main — não replanejá-la nem quebrá-la.

## Estrutura de arquivos

| Arquivo | Papel |
|---|---|
| `supabase/migrations/<timestamp>_preco_por_variacao_config_grupo.sql` (criar via CLI) | Colunas novas em `variacoes` e `anuncios_externos` |
| `src/lib/database.types.ts` (modificar) | Tipos das colunas novas (edição manual aditiva, padrão do repo) |
| `supabase/functions/_shared/preco/grupos.ts` (criar) | `round2`, `precoCentavos`, `precosDivergentes`, `garantirPrecoUniforme` |
| `supabase/functions/_shared/preco/config-grupo.ts` (criar) | `resolverConfigGrupo` (LOUD), `agregarAtacadoStatus` |
| `supabase/functions/_shared/split/particionar.ts` (modificar) | + `particionarPorPreco` (a função `particionar` atual fica intacta até a Task 6 remover seu único uso; mantida exportada p/ os testes de caracterização do ADR-0048) |
| `supabase/functions/publicar-familias/decidir-split.ts` (criar) | `decidirSplit` puro (contagem OU divergência OU já-particionado) |
| `supabase/functions/publicar-familias/index.ts` (modificar) | Roteamento usa `decidirSplit` |
| `supabase/functions/publish-familia-ml/index.ts` (modificar) | Guard LOUD de uniformidade (CREATE) |
| `supabase/functions/update-familia-ml/index.ts` (modificar) | Guard LOUD de uniformidade (UPDATE, exceto `somenteEstoque`) |
| `supabase/functions/publicar-split-ml/index.ts` (modificar) | Particiona por preço; desconto/PxQ por partição; conflitos LOUD; `atacado_status` por partição + agregado |
| `docs/reference/modelo-de-dados.md`, `docs/reference/edge-functions.md` (modificar) | Documentação |
| Testes: `_shared/preco/__tests__/grupos.test.ts`, `_shared/preco/__tests__/config-grupo.test.ts`, `_shared/split/__tests__/particionar-preco.test.ts`, `publicar-familias/__tests__/decidir-split.test.ts` (criar) | TDD dos helpers puros |

---

### Task 1: Migration — config por variação + atacado por partição

**Arquivos:**
- Criar (via CLI): `supabase/migrations/<timestamp>_preco_por_variacao_config_grupo.sql`
- Modificar: `src/lib/database.types.ts` (tabelas `variacoes` e `anuncios_externos`, blocos Row/Insert/Update)

**Interfaces:**
- Consome: nada (primeira task).
- Produz: colunas `variacoes.exibir_com_desconto boolean null`, `variacoes.desconto_pct numeric null`, `variacoes.atacado jsonb null`, `anuncios_externos.atacado_status text null`, `anuncios_externos.atacado_erro text null`. Semântica: **NULL = herda o família-level** (comportamento uniforme de hoje); `atacado = []` = explicitamente SEM atacado (diferente de NULL). Tasks 3, 6 e a Fase 2b dependem exatamente desses nomes.

> Decisão de plano: o "backfill herda o família-level" do spec é implementado como **NULL-herda-em-leitura** (resolvido por `resolverConfigGrupo`/UI), não como cópia de valores. É não-destrutivo, evita dual-write drift (família uniforme continua editando só `familias.*`) e respeita o invariante #2: quando a variação TEM valor explícito, ele viaja com ela.

- [ ] **Step 1: Criar a migration via CLI (ADR-0043 — nunca SQL direto no painel)**

```bash
cd "$(git rev-parse --show-toplevel)"
supabase migration new preco_por_variacao_config_grupo
```

- [ ] **Step 2: Escrever o conteúdo da migration** (no arquivo recém-criado em `supabase/migrations/`)

```sql
-- ADR-0078 F2: preço por variação + split por faixa de preço.
-- Config de desconto/atacado passa a poder viver NA VARIAÇÃO (por faixa de preço).
-- NULL = herda o família-level (comportamento uniforme de hoje); valor explícito =
-- config da faixa (a UI de grupo grava em TODAS as variações do grupo).
alter table public.variacoes
  add column if not exists exibir_com_desconto boolean null,
  add column if not exists desconto_pct numeric null,
  add column if not exists atacado jsonb null;

comment on column public.variacoes.exibir_com_desconto is
  'Config por faixa de preco (ADR-0078 F2). NULL = herda familias.exibir_com_desconto; explicito = confirmacao da faixa desta variacao.';
comment on column public.variacoes.desconto_pct is
  'Percentual de desconto da faixa (ADR-0078 F2). NULL com exibir explicito = usa o % global de configuracoes.';
comment on column public.variacoes.atacado is
  'Faixas PxQ da faixa de preco (mesmo shape FaixaAtacado[] de familias.atacado). NULL = herda; [] = explicitamente sem atacado.';

-- Atacado por partição (ADR-0078 F2): um produto pode ter N anúncios (ADR-0048) e o
-- escalar familias.atacado_status não representa falha parcial entre eles.
-- familias.atacado_status passa a ser o AGREGADO (algum erro → erro; algum aplicado → aplicado).
alter table public.anuncios_externos
  add column if not exists atacado_status text null,
  add column if not exists atacado_erro text null;

comment on column public.anuncios_externos.atacado_status is
  'Status do PxQ deste anuncio/particao (ADR-0078 F2): aplicado | erro | NULL (sem atacado).';
comment on column public.anuncios_externos.atacado_erro is
  'Mensagem do ultimo erro de PxQ desta particao (NULL quando ok).';
```

Sem backfill (NULL = herda). Sem policy nova de RLS: `variacoes` e `anuncios_externos` já estão sob RLS (confirme lendo `supabase/migrations/20260527125643_familias_variacoes.sql:131-136` e `supabase/migrations/20260705165828_e7_rls_org.sql`) — colunas aditivas herdam as policies da tabela.

- [ ] **Step 3: Aplicar e validar**

```bash
supabase db push
npm run db:check
```
Esperado: push aplica só esta migration; `db:check` verde.

- [ ] **Step 4: Atualizar `src/lib/database.types.ts`** (edição manual aditiva — padrão do repo, F1 fez igual com `preco_publicado_ml`). Na tabela `variacoes`, adicionar em `Row`:

```ts
exibir_com_desconto: boolean | null
desconto_pct: number | null
atacado: Json | null
```
e em `Insert`/`Update` as mesmas chaves com `?` (`exibir_com_desconto?: boolean | null` etc.). Na tabela `anuncios_externos`, em `Row`:

```ts
atacado_status: string | null
atacado_erro: string | null
```
e em `Insert`/`Update` com `?`. Cuidado: `variacoes` já tem `exibir_com_desconto` **em `familias`** — adicione nos blocos da tabela certa (procure `variacoes: {` dentro de `Tables`).

- [ ] **Step 5: Verificar compilação e commitar**

```bash
pnpm tsc -b --noEmit || npx tsc -b --noEmit
git add supabase/migrations src/lib/database.types.ts
git commit -m "feat: colunas de config por variação e atacado por partição (ADR-0078 F2)"
```

---

### Task 2: Helpers de preço — `grupos.ts`

**Arquivos:**
- Criar: `supabase/functions/_shared/preco/grupos.ts`
- Teste: `supabase/functions/_shared/preco/__tests__/grupos.test.ts`

**Interfaces:**
- Consome: nada.
- Produz (Tasks 4–7 e o roteamento dependem destes nomes exatos):
  - `round2(n: number): number`
  - `precoCentavos(preco: number | string | null | undefined): number | null` — centavos inteiros; null/NaN → null
  - `precosDivergentes(variacoes: Array<{ preco_publicacao: number | string | null }>): boolean` — >1 preço distinto entre os NÃO-nulos
  - `garantirPrecoUniforme(variacoes: Array<{ codigo: string; preco_publicacao: number | string | null }>, contexto: string): void` — lança `Error & { status: 400 }` quando divergente

- [ ] **Step 1: Escrever o teste que falha**

```ts
// supabase/functions/_shared/preco/__tests__/grupos.test.ts
import { describe, it, expect } from 'vitest';
import { round2, precoCentavos, precosDivergentes, garantirPrecoUniforme } from '../grupos';

describe('precoCentavos', () => {
  it('converte para centavos inteiros com arredondamento a 2 casas', () => {
    expect(precoCentavos(12.346)).toBe(1235); // round2 primeiro (12.35)
    expect(precoCentavos('10.10')).toBe(1010); // numeric do PG chega como string
    expect(precoCentavos(0.1 + 0.2)).toBe(30); // sem lixo de float
  });
  it('null/undefined/NaN → null', () => {
    expect(precoCentavos(null)).toBeNull();
    expect(precoCentavos(undefined)).toBeNull();
    expect(precoCentavos('abc')).toBeNull();
  });
});

describe('round2', () => {
  it('arredonda a 2 casas', () => {
    expect(round2(12.346)).toBe(12.35);
  });
});

describe('precosDivergentes', () => {
  it('uniforme → false (caracterização: 32/32 famílias hoje)', () => {
    expect(precosDivergentes([
      { preco_publicacao: 10 }, { preco_publicacao: '10.00' }, { preco_publicacao: 10.0 },
    ])).toBe(false);
  });
  it('2 preços → true', () => {
    expect(precosDivergentes([{ preco_publicacao: 10 }, { preco_publicacao: 12 }])).toBe(true);
  });
  it('nulos são ignorados (herdam o preço do anúncio, como hoje)', () => {
    expect(precosDivergentes([{ preco_publicacao: 10 }, { preco_publicacao: null }])).toBe(false);
    expect(precosDivergentes([{ preco_publicacao: null }])).toBe(false);
  });
  it('diferença de menos de 1 centavo NÃO diverge (comparação por centavos)', () => {
    expect(precosDivergentes([{ preco_publicacao: 10.001 }, { preco_publicacao: 10.004 }])).toBe(false);
  });
});

describe('garantirPrecoUniforme', () => {
  it('uniforme → não lança', () => {
    expect(() => garantirPrecoUniforme(
      [{ codigo: 'A', preco_publicacao: 10 }, { codigo: 'B', preco_publicacao: 10 }], 'CREATE',
    )).not.toThrow();
  });
  it('divergente → LOUD com status 400 (definitivo, QStash não retenta)', () => {
    try {
      garantirPrecoUniforme(
        [{ codigo: 'A', preco_publicacao: 10 }, { codigo: 'B', preco_publicacao: 12 }], 'UPDATE',
      );
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect((e as Error).message).toContain('UPDATE');
      expect((e as Error).message).toContain('split');
      expect((e as Error & { status?: number }).status).toBe(400);
    }
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm vitest run supabase/functions/_shared/preco/__tests__/grupos.test.ts`
Esperado: FALHA com "Cannot find module '../grupos'" (ou equivalente).

- [ ] **Step 3: Implementação mínima**

```ts
// supabase/functions/_shared/preco/grupos.ts
// ADR-0078 F2: faixa de preço = variações com o mesmo preço, comparado por CENTAVOS INTEIROS
// (arredondamento a 2 casas antes de agrupar — glossário do spec).

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Preço em centavos inteiros (chave de faixa). null/NaN → null. Aceita string (numeric do PG). */
export function precoCentavos(preco: number | string | null | undefined): number | null {
  if (preco == null) return null;
  const n = Number(preco);
  if (!Number.isFinite(n)) return null;
  return Math.round(round2(n) * 100);
}

/** >1 preço distinto entre os NÃO-nulos. Nulos herdam o preço do anúncio (como hoje) e não divergem. */
export function precosDivergentes(
  variacoes: Array<{ preco_publicacao: number | string | null }>,
): boolean {
  const distintos = new Set(
    variacoes.map((v) => precoCentavos(v.preco_publicacao)).filter((c): c is number => c != null),
  );
  return distintos.size > 1;
}

/** Guard dos workers de anúncio único (publish/update-familia-ml): divergência aqui é bug de
 *  roteamento — publicar colapsando seria preço errado em silêncio. LOUD, nada é enviado. */
export function garantirPrecoUniforme(
  variacoes: Array<{ codigo: string; preco_publicacao: number | string | null }>,
  contexto: string,
): void {
  if (!precosDivergentes(variacoes)) return;
  const e = new Error(
    `${contexto}: preços divergentes entre as variações — este worker publica preço único; ` +
    `a publicação deveria ter roteado para o split por faixa (publicar-split-ml). Nada foi enviado (400)`,
  ) as Error & { status?: number };
  e.status = 400;
  throw e;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Rodar: `pnpm vitest run supabase/functions/_shared/preco/__tests__/grupos.test.ts`
Esperado: PASSA.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/preco/grupos.ts supabase/functions/_shared/preco/__tests__/grupos.test.ts
git commit -m "feat: helpers de faixa de preço por centavos (ADR-0078 F2)"
```

---

### Task 3: `resolverConfigGrupo` + `agregarAtacadoStatus` (config financeira por grupo, LOUD)

**Arquivos:**
- Criar: `supabase/functions/_shared/preco/config-grupo.ts`
- Teste: `supabase/functions/_shared/preco/__tests__/config-grupo.test.ts`

**Interfaces:**
- Consome: `FaixaAtacado` de `../canais/contrato.ts` (`{ min_unidades: number; desconto_pct: number }`).
- Produz (Task 6/7 dependem destes nomes exatos):

```ts
export interface ConfigFamiliaNivel {
  exibir_com_desconto: boolean | null;
  desconto_pct: number | string | null;
  atacado: unknown; // jsonb cru de familias.atacado
}
export interface ConfigVariacaoNivel {
  codigo: string;
  exibir_com_desconto: boolean | null;
  desconto_pct: number | string | null;
  atacado: unknown; // jsonb cru de variacoes.atacado (null = herda; [] = sem atacado explícito)
}
export interface ConfigGrupo {
  exibirComDesconto: boolean;
  descontoPct: number | null; // null = usar o % global (mesma resolução pctEfetivo de hoje)
  faixasAtacado: FaixaAtacado[];
}
export function resolverConfigGrupo(
  familia: ConfigFamiliaNivel,
  variacoesDoGrupo: ConfigVariacaoNivel[],
  familiaDivergente: boolean,
): ConfigGrupo; // lança Error & { status: 400 } nos casos LOUD

export function agregarAtacadoStatus(
  porParticao: Array<{ status: 'aplicado' | 'erro' | null; erro: string | null }>,
): { atacado_status: 'aplicado' | 'erro' | null; atacado_erro: string | null };
```

Regras (invariante #2, spec "Modelo de dados"):
1. Efetivo por variação = explícito na variação, senão herda `familias.*`.
2. Configs efetivas divergentes DENTRO do grupo → LOUD (não deveria acontecer pela UI).
3. `familiaDivergente = true` e alguma variação do grupo SEM config explícita enquanto o família-level tem desconto ativo ou atacado com faixas → LOUD (config família-level de base única não se aplica a faixa em silêncio — ADR-0055). Família-level inativo (nada ligado) + sem explícito = efetivo "desligado", sem LOUD (nada financeiro está sendo aplicado).
4. `familiaDivergente = false` → comportamento de hoje (família-level), desde que nada explícito conflite.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// supabase/functions/_shared/preco/__tests__/config-grupo.test.ts
import { describe, it, expect } from 'vitest';
import { resolverConfigGrupo, agregarAtacadoStatus } from '../config-grupo';

const fam = (over = {}) => ({ exibir_com_desconto: false, desconto_pct: null, atacado: null, ...over });
const v = (codigo: string, over = {}) =>
  ({ codigo, exibir_com_desconto: null, desconto_pct: null, atacado: null, ...over });
const faixas = [{ min_unidades: 5, desconto_pct: 5 }];

describe('resolverConfigGrupo', () => {
  it('uniforme: herda o família-level intacto (caracterização — comportamento de hoje)', () => {
    const cfg = resolverConfigGrupo(
      fam({ exibir_com_desconto: true, desconto_pct: '20', atacado: faixas }),
      [v('A'), v('B')],
      false,
    );
    expect(cfg).toEqual({ exibirComDesconto: true, descontoPct: 20, faixasAtacado: faixas });
  });

  it('uniforme sem nada ativo: tudo desligado', () => {
    expect(resolverConfigGrupo(fam(), [v('A')], false))
      .toEqual({ exibirComDesconto: false, descontoPct: null, faixasAtacado: [] });
  });

  it('divergente com config explícita e idêntica no grupo: usa a do grupo', () => {
    const cfg = resolverConfigGrupo(
      fam({ exibir_com_desconto: true, desconto_pct: 15 }),
      [
        v('A', { exibir_com_desconto: true, desconto_pct: 10, atacado: faixas }),
        v('B', { exibir_com_desconto: true, desconto_pct: 10, atacado: faixas }),
      ],
      true,
    );
    expect(cfg).toEqual({ exibirComDesconto: true, descontoPct: 10, faixasAtacado: faixas });
  });

  it('divergente + desconto família ativo + variação sem confirmação explícita → LOUD 400', () => {
    try {
      resolverConfigGrupo(
        fam({ exibir_com_desconto: true, desconto_pct: 15 }),
        [v('A', { exibir_com_desconto: true, desconto_pct: 15 }), v('B')],
        true,
      );
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect((e as Error & { status?: number }).status).toBe(400);
      expect((e as Error).message).toContain('faixa');
    }
  });

  it('divergente + atacado família ativo + variação sem atacado explícito → LOUD 400', () => {
    expect(() => resolverConfigGrupo(fam({ atacado: faixas }), [v('A')], true))
      .toThrowError(/faixa/i);
  });

  it('divergente + família sem nada ativo + sem explícito → desligado, SEM LOUD (nada financeiro em jogo)', () => {
    expect(resolverConfigGrupo(fam(), [v('A'), v('B')], true))
      .toEqual({ exibirComDesconto: false, descontoPct: null, faixasAtacado: [] });
  });

  it('atacado explícito [] = explicitamente sem atacado → não é pendência', () => {
    const cfg = resolverConfigGrupo(
      fam({ atacado: faixas }),
      [v('A', { exibir_com_desconto: false, atacado: [] })],
      true,
    );
    expect(cfg.faixasAtacado).toEqual([]);
  });

  it('config divergente DENTRO do grupo → LOUD 400 (repreçar não pode misturar configs)', () => {
    expect(() => resolverConfigGrupo(
      fam(),
      [
        v('A', { exibir_com_desconto: true, desconto_pct: 10, atacado: [] }),
        v('B', { exibir_com_desconto: false, desconto_pct: null, atacado: [] }),
      ],
      true,
    )).toThrowError(/divergente/i);
  });
});

describe('agregarAtacadoStatus', () => {
  it('algum erro → erro com a mensagem', () => {
    expect(agregarAtacadoStatus([
      { status: 'aplicado', erro: null }, { status: 'erro', erro: 'PxQ (400): x' },
    ])).toEqual({ atacado_status: 'erro', atacado_erro: 'PxQ (400): x' });
  });
  it('só aplicado → aplicado', () => {
    expect(agregarAtacadoStatus([{ status: 'aplicado', erro: null }, { status: null, erro: null }]))
      .toEqual({ atacado_status: 'aplicado', atacado_erro: null });
  });
  it('nenhum atacado → null', () => {
    expect(agregarAtacadoStatus([{ status: null, erro: null }]))
      .toEqual({ atacado_status: null, atacado_erro: null });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm vitest run supabase/functions/_shared/preco/__tests__/config-grupo.test.ts`
Esperado: FALHA com "Cannot find module '../config-grupo'".

- [ ] **Step 3: Implementação mínima**

```ts
// supabase/functions/_shared/preco/config-grupo.ts
// ADR-0078 F2: config de desconto/atacado POR FAIXA de preço. A config viaja na variação
// (colunas variacoes.exibir_com_desconto/desconto_pct/atacado); NULL = herda o família-level.
// Divergência de preço + herança de config ATIVA sem confirmação explícita = LOUD (ADR-0055:
// nada financeiro defaulta em silêncio).
import type { FaixaAtacado } from '../canais/contrato.ts';

export interface ConfigFamiliaNivel {
  exibir_com_desconto: boolean | null;
  desconto_pct: number | string | null;
  atacado: unknown;
}
export interface ConfigVariacaoNivel {
  codigo: string;
  exibir_com_desconto: boolean | null;
  desconto_pct: number | string | null;
  atacado: unknown;
}
export interface ConfigGrupo {
  exibirComDesconto: boolean;
  descontoPct: number | null;
  faixasAtacado: FaixaAtacado[];
}

function comoFaixas(x: unknown): FaixaAtacado[] | null {
  return Array.isArray(x) ? (x as FaixaAtacado[]) : null; // null = "não configurado" (≠ [])
}
const chaveFaixas = (f: FaixaAtacado[]) =>
  JSON.stringify([...f].sort((a, b) => a.min_unidades - b.min_unidades));

function loud(msg: string): never {
  const e = new Error(msg) as Error & { status?: number };
  e.status = 400; // definitivo: retry do QStash não conserta config errada
  throw e;
}

export function resolverConfigGrupo(
  familia: ConfigFamiliaNivel,
  variacoesDoGrupo: ConfigVariacaoNivel[],
  familiaDivergente: boolean,
): ConfigGrupo {
  const famExibir = familia.exibir_com_desconto ?? false;
  const famPct = familia.desconto_pct != null ? Number(familia.desconto_pct) : null;
  const famFaixas = comoFaixas(familia.atacado) ?? [];

  const efetivos = variacoesDoGrupo.map((v) => {
    const explicitoDesconto = v.exibir_com_desconto != null;
    const explicitoAtacado = comoFaixas(v.atacado) != null;
    return {
      codigo: v.codigo,
      explicitoDesconto,
      explicitoAtacado,
      exibir: v.exibir_com_desconto ?? famExibir,
      pct: explicitoDesconto ? (v.desconto_pct != null ? Number(v.desconto_pct) : null) : famPct,
      faixas: comoFaixas(v.atacado) ?? famFaixas,
    };
  });

  const chaves = new Set(efetivos.map((e) => `${e.exibir}:${e.pct}:${chaveFaixas(e.faixas)}`));
  if (chaves.size > 1) {
    loud(
      `Config de desconto/atacado divergente dentro da mesma faixa de preço ` +
      `(${efetivos.map((e) => e.codigo).join(', ')}) — reconfigure a faixa na Revisão (400)`,
    );
  }

  if (familiaDivergente) {
    const herdaDescontoAtivo = famExibir && efetivos.some((e) => !e.explicitoDesconto);
    const herdaAtacadoAtivo = famFaixas.length > 0 && efetivos.some((e) => !e.explicitoAtacado);
    if (herdaDescontoAtivo || herdaAtacadoAtivo) {
      loud(
        'Família com preços divergentes: confirme desconto/atacado POR FAIXA na Revisão antes de ' +
        'publicar — a config família-level não se aplica a faixas em silêncio (ADR-0055) (400)',
      );
    }
  }

  const cfg = efetivos[0];
  return {
    exibirComDesconto: cfg?.exibir ?? false,
    descontoPct: cfg?.pct ?? null,
    faixasAtacado: cfg?.faixas ?? [],
  };
}

/** familias.atacado_status vira o agregado das partições (algum erro > algum aplicado > nada). */
export function agregarAtacadoStatus(
  porParticao: Array<{ status: 'aplicado' | 'erro' | null; erro: string | null }>,
): { atacado_status: 'aplicado' | 'erro' | null; atacado_erro: string | null } {
  const erro = porParticao.find((p) => p.status === 'erro');
  if (erro) return { atacado_status: 'erro', atacado_erro: erro.erro };
  if (porParticao.some((p) => p.status === 'aplicado')) {
    return { atacado_status: 'aplicado', atacado_erro: null };
  }
  return { atacado_status: null, atacado_erro: null };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Rodar: `pnpm vitest run supabase/functions/_shared/preco/__tests__/config-grupo.test.ts`
Esperado: PASSA.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/preco/config-grupo.ts supabase/functions/_shared/preco/__tests__/config-grupo.test.ts
git commit -m "feat: config de desconto/atacado por faixa com LOUD (ADR-0078 F2)"
```

---

### Task 4: `particionarPorPreco` (partição = preço primeiro, ADR-0048 dentro do grupo)

**Arquivos:**
- Modificar: `supabase/functions/_shared/split/particionar.ts` (adicionar função; `particionar` e `MAX_VARIACOES_ML` existentes ficam intactos)
- Teste: `supabase/functions/_shared/split/__tests__/particionar-preco.test.ts` (criar)

**Interfaces:**
- Consome: `MAX_VARIACOES_ML` (já exportado no mesmo arquivo).
- Produz (Task 7 depende destes nomes exatos):

```ts
export interface CorComPreco { sku: string; cor: string | null; precoCentavos: number | null; }
export interface ParticionarPorPrecoInput {
  cores: CorComPreco[];                       // cores incluídas na publicação
  ancoragem: Map<string, number>;             // sku → partição (montarAncoragem, ADR-0048)
  faixaVivaPorParticao: Map<number, number>;  // partição → preço vivo em centavos (só-estoque)
  somenteEstoque: boolean;
  max?: number;                               // default MAX_VARIACOES_ML
}
export interface ParticionarPorPrecoResultado {
  mapa: Map<string, number>;                  // sku → partição
  precoPorParticao: Map<number, number | null>; // preço (centavos) que a partição vai publicar; null = não empurrar
  conflitos: string[];                        // mensagens LOUD; vazio = ok
}
export function particionarPorPreco(input: ParticionarPorPrecoInput): ParticionarPorPrecoResultado;
```

Regras:
- Ancorada NUNCA migra (invariante #4).
- `!somenteEstoque`: preço-alvo da partição = o preço único das suas ancoradas não-nulas; >1 preço distinto entre ancoradas da mesma partição → **conflito** (cruzou faixa / anúncio ficaria divergente); nenhuma ancorada com preço → alvo = faixa viva, senão `null` (= preservar preço vivo, semântica do `precoFamilia null` de hoje).
- `somenteEstoque`: nenhum conflito por preço de ancorada (nada será empurrado); alvo = faixa viva ou `null`.
- Cor nova: ordem alfabética por cor (tie por sku — regra atual do ADR-0048); vai para a **menor** partição cujo preço-alvo casa com o dela e tem espaço (< max) — desempate determinístico do spec; sem casamento/espaço → abre partição nova com o preço dela (é assim que um grupo >100 subdivide e que uma faixa nova vira anúncio novo).
- Cor nova sem preço → conflito (`familiaPublicavel` já bloqueia antes; aqui é o cinto de segurança LOUD).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// supabase/functions/_shared/split/__tests__/particionar-preco.test.ts
import { describe, it, expect } from 'vitest';
import { particionarPorPreco } from '../particionar';

const c = (sku: string, cor: string, precoCentavos: number | null) => ({ sku, cor, precoCentavos });
const base = { ancoragem: new Map<string, number>(), faixaVivaPorParticao: new Map<number, number>(), somenteEstoque: false };

describe('particionarPorPreco', () => {
  it('uniforme ≤100 sem ancoragem → 1 partição (caminho comum idêntico ao atual)', () => {
    const r = particionarPorPreco({ ...base, cores: [c('A', 'Azul', 1000), c('B', 'Rosa', 1000)] });
    expect(r.conflitos).toEqual([]);
    expect([...new Set(r.mapa.values())]).toEqual([0]);
    expect(r.precoPorParticao.get(0)).toBe(1000);
  });

  it('2 preços → 2 partições, cada uma com o preço do grupo', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1000), c('B', 'Rosa', 1200), c('C', 'Cinza', 1000)],
    });
    expect(r.conflitos).toEqual([]);
    expect(r.mapa.get('A')).toBe(r.mapa.get('C'));
    expect(r.mapa.get('A')).not.toBe(r.mapa.get('B'));
    expect(r.precoPorParticao.get(r.mapa.get('A')!)).toBe(1000);
    expect(r.precoPorParticao.get(r.mapa.get('B')!)).toBe(1200);
  });

  it('grupo de preço com >100 cores subdivide pela regra alfabética (max reduzido p/ teste)', () => {
    const cores = Array.from({ length: 5 }, (_, i) => c(`s${i}`, String(i).padStart(2, '0'), 1000));
    const r = particionarPorPreco({ ...base, cores, max: 2 });
    expect(r.conflitos).toEqual([]);
    const particoes = [...new Set(r.mapa.values())].sort();
    expect(particoes).toEqual([0, 1, 2]);
    for (const p of particoes) expect(r.precoPorParticao.get(p)).toBe(1000);
    // alfabética: s0,s1 → 0; s2,s3 → 1; s4 → 2
    expect(r.mapa.get('s0')).toBe(0);
    expect(r.mapa.get('s4')).toBe(2);
  });

  it('UPDATE "tudo" sem cruzar faixa: partição inteira reprecifica junto, sem LOUD', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1200), c('B', 'Rosa', 1200)],
      ancoragem: new Map([['A', 0], ['B', 0]]), // no ar a R$10, todas vão a R$12 juntas
    });
    expect(r.conflitos).toEqual([]);
    expect(r.precoPorParticao.get(0)).toBe(1200);
  });

  it('UPDATE "tudo" cruzando faixa (ancoradas da mesma partição com preços distintos) → conflito, ninguém migra', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1000), c('B', 'Rosa', 1200)],
      ancoragem: new Map([['A', 0], ['B', 0]]),
    });
    expect(r.conflitos.length).toBe(1);
    expect(r.conflitos[0]).toMatch(/divergentes|dividir/i);
    expect(r.mapa.get('A')).toBe(0);
    expect(r.mapa.get('B')).toBe(0); // ancorada NÃO migra (invariante #4)
  });

  it('somenteEstoque: ancoradas com preços recalculados divergentes NÃO conflitam (nada é empurrado)', () => {
    const r = particionarPorPreco({
      ...base,
      somenteEstoque: true,
      cores: [c('A', 'Azul', 1000), c('B', 'Rosa', 1200)],
      ancoragem: new Map([['A', 0], ['B', 0]]),
      faixaVivaPorParticao: new Map([[0, 1000]]),
    });
    expect(r.conflitos).toEqual([]);
    expect(r.precoPorParticao.get(0)).toBe(1000); // faixa viva, não o recalculado
  });

  it('desempate determinístico: cor nova cujo preço casa 2 partições vai para a de MENOR particao', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1000), c('B', 'Rosa', 1000), c('N', 'Verde', 1000)],
      ancoragem: new Map([['A', 0], ['B', 1]]), // duas partições no ar, ambas a R$10
    });
    expect(r.conflitos).toEqual([]);
    expect(r.mapa.get('N')).toBe(0);
  });

  it('cor nova em faixa inexistente abre partição nova', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1000), c('N', 'Verde', 1500)],
      ancoragem: new Map([['A', 0]]),
    });
    expect(r.conflitos).toEqual([]);
    expect(r.mapa.get('N')).toBe(1);
    expect(r.precoPorParticao.get(1)).toBe(1500);
  });

  it('cor nova sem preço → conflito LOUD', () => {
    const r = particionarPorPreco({ ...base, cores: [c('N', 'Verde', null)] });
    expect(r.conflitos.length).toBe(1);
    expect(r.conflitos[0]).toContain('N');
  });

  it('ancoradas sem preço não conflitam sozinhas: herdam o preço único das irmãs (como hoje)', () => {
    const r = particionarPorPreco({
      ...base,
      cores: [c('A', 'Azul', 1000), c('B', 'Rosa', null)],
      ancoragem: new Map([['A', 0], ['B', 0]]),
    });
    expect(r.conflitos).toEqual([]);
    expect(r.precoPorParticao.get(0)).toBe(1000);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm vitest run supabase/functions/_shared/split/__tests__/particionar-preco.test.ts`
Esperado: FALHA — `particionarPorPreco` não existe.

- [ ] **Step 3: Implementação mínima** (adicionar ao final de `supabase/functions/_shared/split/particionar.ts`)

```ts
// ─── ADR-0078 F2: partição por PREÇO primeiro ────────────────────────────────────────────
// Chave de particionamento passa a ser a faixa de preço; dentro do grupo vale a regra
// alfabética/100 atual. Ancorada nunca migra (invariante #4); cruzar faixa = conflito LOUD.

export interface CorComPreco { sku: string; cor: string | null; precoCentavos: number | null; }
export interface ParticionarPorPrecoInput {
  cores: CorComPreco[];
  ancoragem: Map<string, number>;
  faixaVivaPorParticao: Map<number, number>;
  somenteEstoque: boolean;
  max?: number;
}
export interface ParticionarPorPrecoResultado {
  mapa: Map<string, number>;
  precoPorParticao: Map<number, number | null>;
  conflitos: string[];
}

export function particionarPorPreco(input: ParticionarPorPrecoInput): ParticionarPorPrecoResultado {
  const max = input.max ?? MAX_VARIACOES_ML;
  const mapa = new Map<string, number>();
  const count = new Map<number, number>();
  const precoPorParticao = new Map<number, number | null>();
  const conflitos: string[] = [];
  let maxParticao = -1;

  // 1. Ancoradas ficam onde estão (ADR-0048).
  const ancoradasPorParticao = new Map<number, CorComPreco[]>();
  for (const cor of input.cores) {
    const p = input.ancoragem.get(cor.sku);
    if (p == null) continue;
    mapa.set(cor.sku, p);
    count.set(p, (count.get(p) ?? 0) + 1);
    if (p > maxParticao) maxParticao = p;
    (ancoradasPorParticao.get(p) ?? ancoradasPorParticao.set(p, []).get(p)!).push(cor);
  }

  // 2. Preço-alvo por partição existente.
  for (const [p, ancoradas] of ancoradasPorParticao) {
    if (input.somenteEstoque) {
      // Nada será empurrado: a faixa é o preço VIVO (preco_publicado_ml / GET) — nunca o recalculado.
      precoPorParticao.set(p, input.faixaVivaPorParticao.get(p) ?? null);
      continue;
    }
    const naoNulos = new Set(
      ancoradas.map((c) => c.precoCentavos).filter((x): x is number => x != null),
    );
    if (naoNulos.size > 1) {
      conflitos.push(
        `Partição ${p}: preços divergentes entre cores já publicadas ` +
        `(${[...naoNulos].map((x) => (x / 100).toFixed(2)).join(' × ')}) — honrar exige dividir/migrar ` +
        `variação publicada (perde histórico); decida na Revisão`,
      );
      precoPorParticao.set(p, null);
      continue;
    }
    // 1 preço → a partição inteira reprecifica junto; 0 → preserva o vivo (semântica de hoje).
    precoPorParticao.set(p, naoNulos.size === 1 ? [...naoNulos][0] : (input.faixaVivaPorParticao.get(p) ?? null));
  }

  // 3. Cores novas: alfabética por cor (tie por sku) — regra atual do ADR-0048.
  const novas = input.cores
    .filter((c) => !input.ancoragem.has(c.sku))
    .sort((a, b) => (a.cor ?? '').localeCompare(b.cor ?? '', 'pt') || a.sku.localeCompare(b.sku));

  for (const cor of novas) {
    if (cor.precoCentavos == null) {
      conflitos.push(`Cor nova ${cor.sku} sem preço de publicação`);
      continue;
    }
    // Menor partição cuja faixa casa e tem espaço (desempate determinístico do spec).
    let alvo = -1;
    for (let p = 0; p <= maxParticao; p++) {
      if (precoPorParticao.get(p) === cor.precoCentavos && (count.get(p) ?? 0) < max) {
        alvo = p;
        break;
      }
    }
    if (alvo === -1) {
      alvo = maxParticao + 1;
      maxParticao = alvo;
      precoPorParticao.set(alvo, cor.precoCentavos);
    }
    mapa.set(cor.sku, alvo);
    count.set(alvo, (count.get(alvo) ?? 0) + 1);
  }

  return { mapa, precoPorParticao, conflitos };
}
```

- [ ] **Step 4: Rodar os testes (novo + caracterização do antigo) e confirmar que passam**

Rodar: `pnpm vitest run supabase/functions/_shared/split/__tests__/`
Esperado: PASSA (incluindo `particionar.test.ts` intacto).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/split/particionar.ts supabase/functions/_shared/split/__tests__/particionar-preco.test.ts
git commit -m "feat: particionamento por faixa de preço com ancoragem e conflitos LOUD (ADR-0078 F2)"
```

---

### Task 5: `decidirSplit` + roteamento em `publicar-familias`

**Arquivos:**
- Criar: `supabase/functions/publicar-familias/decidir-split.ts`
- Modificar: `supabase/functions/publicar-familias/index.ts` (bloco `coresPorFamilia`/`ehSplit`, linhas ~78-105, e os `.select('id, lote_id, user_id')` dos claims)
- Teste: `supabase/functions/publicar-familias/__tests__/decidir-split.test.ts` (criar)

**Interfaces:**
- Consome: `MAX_VARIACOES_ML` de `../_shared/split/particionar.ts`; `precoCentavos` de `../_shared/preco/grupos.ts` (no index).
- Produz: `decidirSplit(p: { qtdCores: number; precosCentavos: Array<number | null>; qtdParticoes: number }): boolean`.

Regra: split quando `qtdCores > 100` (ADR-0048, hoje) **OU** `qtdParticoes > 1` (produto já dividido: `update-familia-ml` só conhece a partição 0 — sem esta condição, uma família que voltou a ficar uniforme deixaria as partições ≥1 órfãs) **OU** >1 preço distinto entre não-nulos (ADR-0078 F2). Vale para CREATE e UPDATE; a escolha `somenteEstoque` NÃO muda o roteamento (o split trata só-estoque corretamente e o caminho é único/idempotente).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// supabase/functions/publicar-familias/__tests__/decidir-split.test.ts
import { describe, it, expect } from 'vitest';
import { decidirSplit } from '../decidir-split';

describe('decidirSplit', () => {
  it('uniforme, ≤100 cores, 1 partição → caminho normal (caracterização)', () => {
    expect(decidirSplit({ qtdCores: 3, precosCentavos: [1000, 1000, null], qtdParticoes: 1 })).toBe(false);
    expect(decidirSplit({ qtdCores: 3, precosCentavos: [1000, 1000, 1000], qtdParticoes: 0 })).toBe(false);
  });
  it('>100 cores → split (ADR-0048, comportamento atual)', () => {
    expect(decidirSplit({ qtdCores: 101, precosCentavos: Array(101).fill(1000), qtdParticoes: 0 })).toBe(true);
  });
  it('preços divergentes → split, mesmo com poucas cores (ADR-0078 F2)', () => {
    expect(decidirSplit({ qtdCores: 2, precosCentavos: [1000, 1200], qtdParticoes: 0 })).toBe(true);
  });
  it('produto já particionado (N anúncios no ar) → split sempre, mesmo uniforme', () => {
    expect(decidirSplit({ qtdCores: 5, precosCentavos: [1000, 1000, 1000, 1000, 1000], qtdParticoes: 2 })).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm vitest run supabase/functions/publicar-familias/__tests__/decidir-split.test.ts`
Esperado: FALHA — módulo não existe.

- [ ] **Step 3: Implementação mínima**

```ts
// supabase/functions/publicar-familias/decidir-split.ts
// Roteamento publish/update × split (ADR-0048 + ADR-0078 F2). Puro e idempotente.
import { MAX_VARIACOES_ML } from '../_shared/split/particionar.ts';

export function decidirSplit(p: {
  qtdCores: number;
  precosCentavos: Array<number | null>;
  qtdParticoes: number;
}): boolean {
  if (p.qtdCores > MAX_VARIACOES_ML) return true; // ADR-0048 (comportamento atual)
  if (p.qtdParticoes > 1) return true; // já dividido: só o split worker conhece as N partições
  const distintos = new Set(p.precosCentavos.filter((c): c is number => c != null));
  return distintos.size > 1; // ADR-0078 F2: divergência de preço
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Rodar: `pnpm vitest run supabase/functions/publicar-familias/__tests__/decidir-split.test.ts`
Esperado: PASSA.

- [ ] **Step 5: Wiring no `publicar-familias/index.ts`**

5a. Adicionar `codigo_pai` aos dois claims (CREATE e UPDATE): trocar os dois `.select('id, lote_id, user_id')` por `.select('id, lote_id, user_id, codigo_pai')`.

5b. Adicionar imports no topo:

```ts
import { decidirSplit } from './decidir-split.ts';
import { precoCentavos } from '../_shared/preco/grupos.ts';
```
(e REMOVER o import agora sem uso `import { MAX_VARIACOES_ML } from '../_shared/split/particionar.ts';`).

5c. Substituir o bloco atual (do comentário `// Split (ADR-0048)...` até a linha `const ehSplit = ...`) por:

```ts
    // Split (ADR-0048 + ADR-0078 F2): >100 cores, OU preços divergentes entre as cores
    // incluídas, OU produto que já tem N partições no ar → worker de split. O resto segue o
    // caminho normal (publish/update), intocado.
    const todas = [...(novos ?? []), ...(updates ?? [])];
    const idsParaEnfileirar = todas.map((f) => f.id);
    const precosPorFamilia = new Map<string, Array<number | null>>();
    if (idsParaEnfileirar.length > 0) {
      const { data: vrs } = await admin.from('variacoes')
        .select('familia_id, preco_publicacao')
        .in('familia_id', idsParaEnfileirar).eq('excluida_da_publicacao', false);
      for (const v of vrs ?? []) {
        (precosPorFamilia.get(v.familia_id) ?? precosPorFamilia.set(v.familia_id, []).get(v.familia_id)!)
          .push(precoCentavos(v.preco_publicacao));
      }
    }
    const paiPorFamilia = new Map(todas.map((f) => [f.id as string, f.codigo_pai as string]));
    const particoesPorPai = new Map<string, number>();
    if (todas.length > 0) {
      const { data: parts } = await admin.from('anuncios_externos')
        .select('codigo_pai, particao')
        .eq('org_id', orgId).eq('canal', 'mercado_livre')
        .in('codigo_pai', [...new Set(paiPorFamilia.values())]);
      for (const p of parts ?? []) {
        particoesPorPai.set(p.codigo_pai, (particoesPorPai.get(p.codigo_pai) ?? 0) + 1);
      }
    }
    const ehSplit = (familiaId: string) => {
      const precos = precosPorFamilia.get(familiaId) ?? [];
      return decidirSplit({
        qtdCores: precos.length,
        precosCentavos: precos,
        qtdParticoes: particoesPorPai.get(paiPorFamilia.get(familiaId) ?? '') ?? 0,
      });
    };
```

Os dois loops `for (const f of novos ?? [])` / `for (const f of updates ?? [])` seguem usando `ehSplit(f.id)` sem mudança.

- [ ] **Step 6: Typecheck + lint das functions**

```bash
npm run check:functions
npm run lint:functions
```
Esperado: verdes.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/publicar-familias
git commit -m "feat: roteia divergência de preço e produto particionado para o split (ADR-0078 F2)"
```

---

### Task 6: Guards LOUD de uniformidade nos workers de anúncio único

**Arquivos:**
- Modificar: `supabase/functions/publish-familia-ml/index.ts` (logo após o carregamento de `variacoes`, antes de `montarAnuncioCanonico` — hoje ~linha 95-105)
- Modificar: `supabase/functions/update-familia-ml/index.ts` (logo após o carregamento de `variacoes`, ~linha 75-84)

**Interfaces:**
- Consome: `garantirPrecoUniforme` de `../_shared/preco/grupos.ts` (Task 2). A lógica já está 100% testada na Task 2 — esta task é só wiring; a verificação é o typecheck.

Racional (invariante #1): estes workers publicam preço único (`precoFamilia` = 1º não-nulo). Se uma família divergente chegar aqui (bug de roteamento, job antigo na fila), o CREATE quebraria no ML (`Found different prices in variations`) mas o UPDATE empurraria o 1º preço EM SILÊNCIO para todas as cores — preço errado publicado. O guard converte isso em erro 400 visível. Em `somenteEstoque` o guard NÃO roda (nenhum preço é empurrado — invariante #3, nada a proteger).

- [ ] **Step 1: publish-familia-ml** — adicionar o import e o guard.

Import no topo:

```ts
import { garantirPrecoUniforme } from '../_shared/preco/grupos.ts';
```

Logo após o bloco que valida `if (!variacoes || variacoes.length === 0) throw ...`:

```ts
    // ADR-0078 F2 (invariante #1): este worker publica preço único. Divergência aqui = bug de
    // roteamento (deveria ter ido ao split) → LOUD, nada é enviado ao ML.
    garantirPrecoUniforme(variacoes, 'CREATE');
```

- [ ] **Step 2: update-familia-ml** — adicionar o import (mesma linha de import) e, logo após o `if (!variacoes || variacoes.length === 0) ...`:

```ts
    // ADR-0078 F2 (invariante #1): em "atualizar tudo" o precoFamilia propagaria o 1º preço a
    // TODAS as cores em silêncio se houvesse divergência — LOUD em vez disso. Em "somente
    // estoque" nenhum preço é empurrado (invariante #3), então divergência recalculada é inócua.
    if (!job.somenteEstoque) garantirPrecoUniforme(variacoes, 'UPDATE');
```

- [ ] **Step 3: Verificar**

```bash
npm run check:functions
npm run lint:functions
pnpm vitest run supabase/functions/_shared/preco/__tests__/grupos.test.ts
```
Esperado: tudo verde.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/publish-familia-ml/index.ts supabase/functions/update-familia-ml/index.ts
git commit -m "feat: guard LOUD de preço uniforme nos workers de anúncio único (ADR-0078 F2)"
```

---

### Task 7: `publicar-split-ml` — split por faixa, desconto/PxQ por partição, conflitos LOUD

**Arquivos:**
- Modificar: `supabase/functions/publicar-split-ml/index.ts`

**Interfaces:**
- Consome: `particionarPorPreco` (Task 4), `precosDivergentes`/`precoCentavos` (Task 2), `resolverConfigGrupo`/`agregarAtacadoStatus`/`ConfigGrupo` (Task 3), `precoAConfirmar` (F1, já importado), `pctEfetivo` (já importado), `conn.aplicarAtacado(ctx, itemId, precoBase, faixas)` e `conn.lerStatus(ctx, ids)` do conector (já existem em `_shared/canais/mercado-livre.ts`).
- Produz: worker que publica N anúncios por faixa; escreve `anuncios_externos.atacado_status/atacado_erro` por partição e o agregado em `familias`. Toda a lógica decisória vive nos helpers já testados (Tasks 2-4); aqui é orquestração — verificação por typecheck + lint + suíte completa.

Mudanças, na ordem do arquivo:

- [ ] **Step 1: Imports** — adicionar:

```ts
import { particionarPorPreco } from '../_shared/split/particionar.ts';
import { precosDivergentes, precoCentavos } from '../_shared/preco/grupos.ts';
import { resolverConfigGrupo, agregarAtacadoStatus } from '../_shared/preco/config-grupo.ts';
```
e remover o import de `particionar` (deixa de ser usado; a função fica no módulo para o caminho de testes/caracterização do ADR-0048).

- [ ] **Step 2: % global de desconto sempre disponível** — substituir o bloco atual `let descontoPct: number | null = null; if (familia.exibir_com_desconto) { ... }` (~linhas 114-121) por:

```ts
    // ADR-0078 F2: o % global vale para QUALQUER grupo com desconto (a família pode estar
    // desligada e um grupo ligado). Busca única, barata.
    const { data: cfgGlobal } = await admin.from('configuracoes')
      .select('desconto_pct').eq('user_id', familia.user_id).maybeSingle();
    const descontoPctGlobal = cfgGlobal?.desconto_pct != null ? Number(cfgGlobal.desconto_pct) : 15;
```

- [ ] **Step 3: Particionamento por preço** — substituir o bloco de ancoragem/particionamento (do `const { data: linhas }` até `const mapaParticao = particionar(...)`) por:

```ts
    // Ancoragem (partições já no ar) + particionamento por PREÇO (ADR-0078 F2).
    const { data: linhas } = await admin.from('anuncios_externos')
      .select('particao, item_externo_id, permalink, titulo, variacoes_externas, atacado_status')
      .eq('org_id', familia.org_id).eq('canal', 'mercado_livre').eq('codigo_pai', familia.codigo_pai);
    const ancoragem = montarAncoragem(linhas ?? []);
    const divergente = precosDivergentes(variacoesComFoto);

    // Faixa VIVA por partição: preco_publicado_ml das ancoradas; faltando, GET ao vivo
    // (lerStatus) — nunca inferência local ambígua (spec ADR-0078, "Particionamento").
    const faixaVivaPorParticao = new Map<number, number>();
    for (const l of linhas ?? []) {
      const skus = new Set(Object.keys((l.variacoes_externas as Record<string, unknown>) ?? {}));
      const viva = variacoesComFoto.find((v) => skus.has(v.codigo) && v.preco_publicado_ml != null);
      const cent = viva ? precoCentavos(viva.preco_publicado_ml) : null;
      if (cent != null) faixaVivaPorParticao.set(l.particao, cent);
    }
    if (job.somenteEstoque) {
      const semFaixa = (linhas ?? []).filter((l) => l.item_externo_id && !faixaVivaPorParticao.has(l.particao));
      if (semFaixa.length > 0) {
        const status = await conn.lerStatus(ctx, semFaixa.map((l) => l.item_externo_id as string));
        for (const l of semFaixa) {
          const preco = status[l.item_externo_id as string]?.preco;
          const cent = precoCentavos(preco ?? null);
          if (cent != null) faixaVivaPorParticao.set(l.particao, cent);
        }
      }
    }

    const particionamento = particionarPorPreco({
      cores: variacoesComFoto.map((v) => ({
        sku: v.codigo, cor: v.cor, precoCentavos: precoCentavos(v.preco_publicacao),
      })),
      ancoragem,
      faixaVivaPorParticao,
      somenteEstoque: !!job.somenteEstoque,
    });
    // Invariante #4: cruzar faixa / anúncio ficaria divergente → LOUD, nada é enviado. O
    // operador decide na Revisão (repreçar uniforme, "somente estoque", ou remover+republicar).
    if (particionamento.conflitos.length > 0) {
      const err = new Error(
        `Preços exigem dividir/migrar anúncio publicado — decida na Revisão (nada foi enviado): ` +
        `${particionamento.conflitos.join('; ')} (400)`,
      ) as Error & { status?: number };
      err.status = 400;
      throw err;
    }
    const mapaParticao = particionamento.mapa;
```

- [ ] **Step 4: Remover `precoFamilia`** — apagar as duas linhas `const precoFamiliaRaw = ...; const precoFamilia = ...` (~176-177). No lugar (antes do loop de partições):

```ts
    // Status de atacado por partição (agregado vai a familias no fim). Em "somente estoque"
    // o PxQ vivo é preservado (F1) — nada é registrado nem sobrescrito.
    const atacadoPorParticao: Array<{ status: 'aplicado' | 'erro' | null; erro: string | null }> = [];
```

- [ ] **Step 5: Dentro do loop `for (const p of [...grupos.keys()]...)`, logo após `const linhaP = ...`:**

```ts
      const precoGrupoCent = particionamento.precoPorParticao.get(p) ?? null;
      // Preço único do anúncio desta partição. null (só em UPDATE sem preço novo) = preserva o vivo.
      const precoGrupo = precoGrupoCent != null ? precoGrupoCent / 100 : null;
      // Config financeira POR GRUPO (invariante #2: LOUD se herdaria config ativa em divergência).
      const cfgGrupo = resolverConfigGrupo(familia, coresP, divergente);
      const pctGrupo = cfgGrupo.exibirComDesconto
        ? pctEfetivo(cfgGrupo.descontoPct, descontoPctGlobal)
        : null;
```

- [ ] **Step 6: Ramo CREATE da partição** — no objeto `AnuncioCanonico`, trocar `desconto: descontoPct != null ? { pct: descontoPct } : null` por `desconto: pctGrupo != null ? { pct: pctGrupo } : null`, e no map das variações trocar `preco: v.preco_publicacao` por `preco: v.preco_publicacao ?? precoGrupo` (cor sem preço herda o preço do grupo — mesma semântica do colapso atual, agora por grupo). Após o bloco existente que grava `preco_publicado_ml` por SKU e a descrição, ANTES do `if (p === 0)`, adicionar a aplicação do atacado da partição (lacuna que a F2 fecha — o split nunca aplicou PxQ):

```ts
        // Atacado (PxQ) POR PARTIÇÃO (ADR-0078 F2 — o split nunca aplicava). Base = preço do
        // grupo. Best-effort: falha não derruba o anúncio já criado; vira atacado_status='erro'.
        if (cfgGrupo.faixasAtacado.length > 0 && precoGrupo != null) {
          try {
            await conn.aplicarAtacado(ctx, itemIdP!, precoGrupo, cfgGrupo.faixasAtacado);
            atacadoPorParticao.push({ status: 'aplicado', erro: null });
            await admin.from('anuncios_externos')
              .update({ atacado_status: 'aplicado', atacado_erro: null })
              .eq('org_id', familia.org_id).eq('canal', 'mercado_livre')
              .eq('codigo_pai', familia.codigo_pai).eq('particao', p);
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            console.error(`atacado (split CREATE) falhou na partição ${p}:`, m);
            atacadoPorParticao.push({ status: 'erro', erro: m });
            await admin.from('anuncios_externos')
              .update({ atacado_status: 'erro', atacado_erro: m })
              .eq('org_id', familia.org_id).eq('canal', 'mercado_livre')
              .eq('codigo_pai', familia.codigo_pai).eq('particao', p);
          }
        } else {
          atacadoPorParticao.push({ status: null, erro: null });
        }
```

- [ ] **Step 7: Ramo UPDATE da partição** — trocar o `desconto` local (que usava `descontoPct`) e o `precoFamilia`:

```ts
        const desconto = pctGrupo != null ? {
          pct: pctGrupo,
          precoPorCodigo: Object.fromEntries(coresP.map((v) =>
            [v.codigo, v.preco_publicacao != null ? Number(v.preco_publicacao) : null])),
        } : null;
```
e na chamada `conn.atualizarAnuncio(...)`, trocar `precoFamilia,` por `precoFamilia: precoGrupo,` (o campo do contrato mantém o nome; o valor agora é o preço do grupo) e em `novas:` trocar `preco: v.preco_publicacao` por `preco: v.preco_publicacao ?? precoGrupo`. No bloco F1 `precoAConfirmar`, trocar `precoEnviado: precoFamilia` por `precoEnviado: precoGrupo`. Após esse bloco, adicionar o atacado do UPDATE da partição (espelha o `update-familia-ml`, agora por partição):

```ts
        // Atacado (PxQ) por partição no UPDATE: com faixas → reaplica na base do grupo; sem
        // faixas mas já 'aplicado' nesta partição → limpa. Em "somente estoque" NÃO mexe (F1).
        if (!job.somenteEstoque) {
          const jaAplicado = linhaP?.atacado_status === 'aplicado';
          if (cfgGrupo.faixasAtacado.length > 0 || jaAplicado) {
            if (precoGrupo == null) {
              const m = 'Atacado sem preço-base: partição sem preço novo nem preço vivo conhecido';
              atacadoPorParticao.push({ status: 'erro', erro: m });
              await admin.from('anuncios_externos')
                .update({ atacado_status: 'erro', atacado_erro: m })
                .eq('org_id', familia.org_id).eq('canal', 'mercado_livre')
                .eq('codigo_pai', familia.codigo_pai).eq('particao', p);
            } else {
              try {
                await conn.aplicarAtacado(ctx, itemExternoId, precoGrupo, cfgGrupo.faixasAtacado);
                const st = cfgGrupo.faixasAtacado.length > 0 ? 'aplicado' as const : null;
                atacadoPorParticao.push({ status: st, erro: null });
                await admin.from('anuncios_externos')
                  .update({ atacado_status: st, atacado_erro: null })
                  .eq('org_id', familia.org_id).eq('canal', 'mercado_livre')
                  .eq('codigo_pai', familia.codigo_pai).eq('particao', p);
              } catch (e) {
                const m = e instanceof Error ? e.message : String(e);
                console.error(`atacado (split UPDATE) falhou na partição ${p}:`, m);
                atacadoPorParticao.push({ status: 'erro', erro: m });
                await admin.from('anuncios_externos')
                  .update({ atacado_status: 'erro', atacado_erro: m })
                  .eq('org_id', familia.org_id).eq('canal', 'mercado_livre')
                  .eq('codigo_pai', familia.codigo_pai).eq('particao', p);
              }
            }
          } else {
            atacadoPorParticao.push({ status: null, erro: null });
          }
        }
```

**Atenção (caso de teste "falha parcial do split"):** manter as gravações de `preco_publicado_ml` e do espelho DENTRO do loop, por partição, exatamente como estão (F1) — se a partição 1 falhar, a 0 já persistiu e o badge não mente.

- [ ] **Step 8: Agregado em `familias` após o loop** — logo antes do `await admin.from('familias').update({ status: 'publicado', ... })`:

```ts
    // Agregado do atacado (familias.atacado_status representa o pior caso entre as partições).
    if (!job.somenteEstoque && atacadoPorParticao.length > 0) {
      const agregado = agregarAtacadoStatus(atacadoPorParticao);
      await admin.from('familias').update(agregado).eq('id', job.familia_id);
    }
```

- [ ] **Step 9: Verificar** — o `resolverConfigGrupo` lança dentro do `try` principal com `status = 400` → cai no catch existente como erro definitivo (marca `familias.erro_mensagem` — LOUD visível na Revisão). Confirmar tipos e rodar tudo:

```bash
npm run check:functions
npm run lint:functions
pnpm test
```
Esperado: tudo verde.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/publicar-split-ml/index.ts
git commit -m "feat: split por faixa de preço com desconto e PxQ por partição (ADR-0078 F2)"
```

- [ ] **Step 11: Deploy de validação (fim da fatia backend)** — mudanças em `_shared/` exigem redeploy de TODAS as funções afetadas (regra do projeto):

```bash
supabase functions deploy publicar-familias publish-familia-ml update-familia-ml publicar-split-ml
```
Conferir a versão pós-deploy no output. (Só executar quando Diego aprovar subir — o padrão do projeto é validar local/branch antes; deixar este step por último e explícito no handoff.)

---

### Task 8: Documentação da fatia backend

**Arquivos:**
- Modificar: `docs/reference/modelo-de-dados.md` (seções `variacoes` e `anuncios_externos`)
- Modificar: `docs/reference/edge-functions.md` (blocos `publicar-familias`, `publish-familia-ml`, `update-familia-ml`, `publicar-split-ml`)

**Interfaces:** Consome os nomes/semânticas das Tasks 1-7. Produz docs em dia (regra de conclusão do CLAUDE.md).

- [ ] **Step 1: `modelo-de-dados.md`** — na seção `variacoes`, adicionar (junto às colunas existentes, seguindo o estilo da página):

```markdown
- **Config por faixa (ADR-0078 F2):** `exibir_com_desconto` (bool, null), `desconto_pct` (numeric, null),
  `atacado` (jsonb `FaixaAtacado[]`, null). NULL = herda o família-level (uniforme, comportamento clássico);
  explícito = config da faixa de preço da variação ([] = explicitamente sem atacado). Grupo de preço
  divergente herdando config família-level ATIVA sem confirmação → publish falha LOUD (ADR-0055).
```

Na seção `anuncios_externos`:

```markdown
- **Atacado por partição (ADR-0078 F2):** `atacado_status` (`aplicado`/`erro`/null), `atacado_erro`.
  `familias.atacado_status` passa a ser o agregado (algum erro → erro; algum aplicado → aplicado).
```

- [ ] **Step 2: `edge-functions.md`** — atualizar:
  - `publicar-familias`: roteamento para split agora é `>100 cores OU preços divergentes OU produto já particionado` (`decidir-split.ts`, ADR-0078 F2).
  - `publish-familia-ml` / `update-familia-ml`: guard LOUD `garantirPrecoUniforme` (divergência aqui = erro 400, nada enviado; update pula o guard em "somente estoque").
  - `publicar-split-ml`: particiona por preço (`particionarPorPreco`: preço primeiro, alfabético/100 dentro do grupo, ancoragem absoluta, conflito = LOUD 400), desconto e PxQ por partição via `resolverConfigGrupo` (config por variação, herança NULL, LOUD em ambiguidade), `atacado_status` por partição + agregado em `familias`.

- [ ] **Step 3: Validação final da fatia + commit**

```bash
pnpm lint && pnpm test && npm run check:functions
git add docs/reference/modelo-de-dados.md docs/reference/edge-functions.md
git commit -m "docs: modelo de dados e edge functions da F2a (ADR-0078)"
```

---

## Autorrevisão (feita na escrita do plano)

- **Cobertura do spec (fatia backend):** agrupamento por centavos (T2), config viaja na variação + LOUD sem config explícita (T3), 2 preços → 2 anúncios com PxQ na base do grupo (T4+T7), >100 dentro do grupo subdivide (T4), desempate menor partição (T4), UPDATE sem cruzar faixa ok / cruzando faixa LOUD sem migrar (T4+T7), faixa viva por `preco_publicado_ml` com fallback GET (T7), `ehSplit` com divergência em CREATE e UPDATE (T5), lacuna do atacado no split fechada por partição + `atacado_status` migrado (T1+T7), falha parcial do split preserva `preco_publicado_ml` por partição (T7 Step 7 nota — estrutura F1 mantida), guards de uniformidade (T6), "só estoque" não empurra preço (preservado — conector F1 intocado; T4 e T6 o respeitam). Casos de teste do spec cobertos por UI (prompt/pinagem/badge/diálogo) ficam na Fase 2b.
- **Buracos documentados como decisão de plano:** (1) herança NULL-em-leitura em vez de backfill por cópia (T1); (2) partição UPDATE sem preço novo e sem faixa viva → `precoFamilia null` = preserva o preço vivo (semântica atual, não é default financeiro novo); (3) `process-familia` não é alterado — ele JÁ calcula `preco_publicacao` por variação (index.ts:393-401); o "colapso" que a F2 remove vive no publish/update/UI.
- **Consistência de tipos:** nomes cruzados conferidos — `precoCentavos`/`precosDivergentes`/`garantirPrecoUniforme` (T2→T5/T6/T7), `resolverConfigGrupo`/`agregarAtacadoStatus` (T3→T7), `particionarPorPreco`/`CorComPreco`/`ParticionarPorPrecoResultado` (T4→T7), `decidirSplit` (T5), colunas da T1 usadas em T3/T7 (`exibir_com_desconto`, `desconto_pct`, `atacado`, `atacado_status`, `atacado_erro`).
