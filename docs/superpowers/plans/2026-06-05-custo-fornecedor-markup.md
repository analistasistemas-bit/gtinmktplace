# CUSTO + FORNECEDOR + Markup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ler as colunas CUSTO e FORNECEDOR da planilha; usar FORNECEDOR como BRAND do anúncio ML (fallback "Avil") e exibir markup/lucro por tipo (Clássico/Premium) no card "Você recebe".

**Architecture:** Duas colunas novas no banco (`variacoes.custo`, `familias.fornecedor`) preenchidas pelo `ingest-lote`. `montarAtributosML` ganha o parâmetro `marca`. O markup é cálculo puro no frontend, plugado no `CardVoceRecebe` que já tem o líquido (`recebe`) por tipo via `useTarifaML`.

**Tech Stack:** Supabase (Postgres + Edge Functions Deno/TS via MCP), React + Vite + TanStack Query, vitest. Test: `pnpm test`. Build: `pnpm build`. Lint: `pnpm lint`.

**Spec:** `docs/superpowers/specs/2026-06-05-custo-fornecedor-markup-design.md`

**Convenções de verificação:** arquivos `_shared/*.ts` e `src/**` são cobertos por `pnpm test` (vitest importa os `.ts` diretamente). Os `index.ts` das Edge Functions NÃO têm teste unitário — verificam-se por revisão do diff + `pnpm build` (quando tocam tipos compartilhados) + bug bash. Deploy das edges e `git push` só no fim, com OK do Diego.

---

### Task 1: Migration (colunas novas) + regen de tipos

**Files:**
- DB (via MCP `apply_migration`)
- Modify: `src/lib/database.types.ts` (regenerado)

- [ ] **Step 1: Aplicar a migration aditiva via MCP**

Use `mcp__supabase-mcp-server__apply_migration` com project_id `txvncrgkoynoxwopfkbp`, name `add_custo_fornecedor`, query:

```sql
alter table variacoes add column if not exists custo numeric;
alter table familias add column if not exists fornecedor text;
```

- [ ] **Step 2: Verificar as colunas**

Use `mcp__supabase-mcp-server__execute_sql`:

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema='public'
  and ((table_name='variacoes' and column_name='custo')
    or (table_name='familias' and column_name='fornecedor'));
```

Expected: 2 linhas (`variacoes.custo numeric`, `familias.fornecedor text`).

- [ ] **Step 3: Regenerar os tipos**

Use `mcp__supabase-mcp-server__generate_typescript_types` (project_id `txvncrgkoynoxwopfkbp`) e grave o resultado em `src/lib/database.types.ts` (sobrescreve o arquivo inteiro).

- [ ] **Step 4: Build para confirmar que os tipos batem**

Run: `pnpm build`
Expected: `✓ built` sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add src/lib/database.types.ts
git commit -m "feat(m4): colunas variacoes.custo e familias.fornecedor + regen tipos"
```

---

### Task 2: Tipos do parser (PlanilhaRow, FamiliaAgrupada, colunas obrigatórias)

**Files:**
- Modify: `supabase/functions/_shared/types.ts`
- Modify: `supabase/functions/_shared/__tests__/parser.test.ts:5-19` (helper `row` precisa dos campos novos para compilar)

- [ ] **Step 1: Adicionar os campos a `PlanilhaRow` e `FamiliaAgrupada` e às colunas obrigatórias**

Em `supabase/functions/_shared/types.ts`, em `PlanilhaRow` adicione `CUSTO` e `FORNECEDOR`:

```ts
export interface PlanilhaRow {
  CODIGO: string;
  PAI: string;
  NOME: string;
  UNIDADE: string;
  GTIN: string | null;
  CUSTO: number;
  PRECO: number;
  ESTOQUE: number;
  DESCRICAO_DETALHADO: string;
  PESO_GRAMAS: number;
  ALTURA_CM: number;
  LARGURA_CM: number;
  COMPRIMENTO_CM: number;
  FORNECEDOR: string;
}
```

Em `FamiliaAgrupada` adicione `fornecedor`:

```ts
export interface FamiliaAgrupada {
  codigo_pai: string;
  nome_pai: string;
  descricao_pai: string;
  unidade: string;
  fornecedor: string;
  variacoes: PlanilhaRow[];
}
```

E em `COLUNAS_OBRIGATORIAS` acrescente as duas:

```ts
export const COLUNAS_OBRIGATORIAS = [
  'CODIGO', 'PAI', 'NOME', 'UNIDADE', 'GTIN', 'CUSTO', 'PRECO', 'ESTOQUE',
  'DESCRICAO_DETALHADO', 'PESO_GRAMAS', 'ALTURA_CM', 'LARGURA_CM', 'COMPRIMENTO_CM',
  'FORNECEDOR',
] as const;
```

- [ ] **Step 2: Atualizar o helper `row` do teste para incluir os defaults**

Em `supabase/functions/_shared/__tests__/parser.test.ts`, no objeto default do helper `row` (linhas 6-18), adicione `CUSTO` e `FORNECEDOR`:

```ts
function row(p: Partial<PlanilhaRow> & { CODIGO: string; PAI: string }): PlanilhaRow {
  return {
    NOME: 'X',
    UNIDADE: 'UN',
    GTIN: null,
    CUSTO: 1,
    PRECO: 1,
    ESTOQUE: 1,
    DESCRICAO_DETALHADO: 'd',
    PESO_GRAMAS: 1,
    ALTURA_CM: 1,
    LARGURA_CM: 1,
    COMPRIMENTO_CM: 1,
    FORNECEDOR: 'ACME',
    ...p,
  };
}
```

- [ ] **Step 3: Rodar a suíte para confirmar que compila e segue verde**

Run: `pnpm test`
Expected: 231 passed (nenhuma regressão; o helper agora compila com os campos novos).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/types.ts supabase/functions/_shared/__tests__/parser.test.ts
git commit -m "feat(m4): CUSTO e FORNECEDOR em PlanilhaRow/FamiliaAgrupada + colunas obrigatorias"
```

---

### Task 3: Parser popula `fornecedor` da linha PAI

**Files:**
- Modify: `supabase/functions/_shared/parser.ts:70-76`
- Test: `supabase/functions/_shared/__tests__/parser.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicione ao `describe('agruparPorPai', ...)` em `parser.test.ts`:

```ts
  it('popula fornecedor a partir da linha PAI', () => {
    const rows = [
      row({ CODIGO: '100', PAI: '0', NOME: 'LINHA', FORNECEDOR: 'LINHAS SETTA LTDA' }),
      row({ CODIGO: '101', PAI: '100', FORNECEDOR: 'IGNORADO' }),
    ];
    const { grupos } = agruparPorPai(rows);
    expect(grupos[0].fornecedor).toBe('LINHAS SETTA LTDA');
  });
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test -- parser`
Expected: FAIL — `grupos[0].fornecedor` é `undefined` (campo ainda não preenchido).

- [ ] **Step 3: Preencher `fornecedor` no `grupos.push`**

Em `supabase/functions/_shared/parser.ts`, no `grupos.push({...})` (linhas 70-76), adicione `fornecedor`:

```ts
    grupos.push({
      codigo_pai: codigo,
      nome_pai: pai.NOME,
      descricao_pai: pai.DESCRICAO_DETALHADO,
      unidade: pai.UNIDADE,
      fornecedor: pai.FORNECEDOR,
      variacoes,
    });
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `pnpm test -- parser`
Expected: PASS (incl. o novo caso).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/parser.ts supabase/functions/_shared/__tests__/parser.test.ts
git commit -m "feat(m4): agruparPorPai popula fornecedor da linha PAI"
```

---

### Task 4: ingest-lote persiste custo (variação) e fornecedor (família)

**Files:**
- Modify: `supabase/functions/ingest-lote/index.ts` (mapeamento das rows; objeto `base`; objetos `familiasInsert` CREATE e UPDATE)

Sem teste unitário (index de edge). Verificação por revisão do diff + grep.

- [ ] **Step 1: Mapear CUSTO/FORNECEDOR ao montar `rows`**

Em `ingest-lote/index.ts`, no `.map((r) => ({...}))` que cria `rows: PlanilhaRow[]`, adicione as duas linhas (CUSTO depois de GTIN, FORNECEDOR ao final), espelhando o `PlanilhaRow`:

```ts
      GTIN: r.GTIN ? String(r.GTIN) : null,
      CUSTO: Number(r.CUSTO ?? 0),
      PRECO: Number(r.PRECO ?? 0),
```

e antes de fechar o objeto:

```ts
      COMPRIMENTO_CM: Number(r.COMPRIMENTO_CM ?? 0),
      FORNECEDOR: String(r.FORNECEDOR ?? ''),
    }));
```

- [ ] **Step 2: Persistir `custo` na variação (objeto `base`, vale p/ CREATE e UPDATE)**

No objeto `base` (dentro do loop que monta `variacoesCreate`/`variacoesUpdate`), adicione `custo`:

```ts
        const base = {
          familia_id: familiaId,
          user_id: user.id,
          codigo,
          nome: v.NOME,
          gtin: v.GTIN,
          custo: v.CUSTO,
          estoque: v.ESTOQUE,
          preco: v.PRECO,
          peso_gramas: v.PESO_GRAMAS,
          altura_cm: v.ALTURA_CM,
          largura_cm: v.LARGURA_CM,
          comprimento_cm: v.COMPRIMENTO_CM,
          imagem_path: matchImagem(v.CODIGO, lote.imagens_paths) ?? null,
        };
```

- [ ] **Step 3: Persistir `fornecedor` na família (ramos CREATE e UPDATE)**

No `familiasInsert`, no objeto do ramo CREATE (o `if (!ant) { return {...} }`), adicione `fornecedor: g.fornecedor,`:

```ts
        return {
          lote_id: lote.id, user_id: user.id, codigo_pai: g.codigo_pai,
          nome_pai: g.nome_pai, descricao_pai: g.descricao_pai, unidade: g.unidade,
          fornecedor: g.fornecedor,
          operacao: 'CREATE', status: 'pendente',
          capa_storage_path: matchCapa(g.codigo_pai, lote.imagens_paths) ?? null,
        };
```

E no objeto do ramo UPDATE (o `return {...}` com `operacao: 'UPDATE'`), adicione `fornecedor: g.fornecedor,` junto aos demais campos da família:

```ts
        nome_pai: g.nome_pai, descricao_pai: g.descricao_pai, unidade: g.unidade,
        fornecedor: g.fornecedor,
        operacao: 'UPDATE',
```

- [ ] **Step 4: Verificar o diff**

Run: `git diff supabase/functions/ingest-lote/index.ts | grep -E "custo|FORNECEDOR|fornecedor|CUSTO"`
Expected: mostra `CUSTO: Number(...)`, `FORNECEDOR: String(...)`, `custo: v.CUSTO,` e dois `fornecedor: g.fornecedor,`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ingest-lote/index.ts
git commit -m "feat(m4): ingest-lote persiste variacoes.custo e familias.fornecedor (CREATE+UPDATE)"
```

---

### Task 5: `montarAtributosML` usa o fornecedor como BRAND (fallback "Avil")

**Files:**
- Modify: `supabase/functions/_shared/categoria/atributos.ts:9-10,67-90`
- Test: `supabase/functions/_shared/categoria/__tests__/atributos.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao `describe('montarAtributosML', ...)`:

```ts
  it('usa o fornecedor como BRAND quando informado', () => {
    const a = montarAtributosML('linha', 'LINHA X', 'LINHAS SETTA LTDA');
    expect(a).toContainEqual({ id: 'BRAND', value_name: 'LINHAS SETTA LTDA' });
  });

  it('fallback "Avil" quando a marca é vazia ou só espaços', () => {
    expect(montarAtributosML('fita', 'FITA CETIM', '   ')).toContainEqual({ id: 'BRAND', value_name: 'Avil' });
    expect(montarAtributosML('botao', 'BOTAO', '')).toContainEqual({ id: 'BRAND', value_name: 'Avil' });
  });
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test -- atributos`
Expected: FAIL — o teste do fornecedor recebe `value_name: 'Avil'` (marca ainda fixa); o 3º argumento é ignorado.

- [ ] **Step 3: Adicionar o parâmetro `marca` e usá-lo**

Em `atributos.ts`, troque a assinatura e o uso da constante. A constante `MARCA` (linha 10) vira o fallback. Edite a função:

```ts
/** Monta os atributos obrigatórios da categoria a partir do nome (ADR-0009). */
export function montarAtributosML(tipo: TipoAviamento, nome: string, marca?: string): AtributoML[] {
  const texto = normalizar(nome ?? '');
  const brand = marca?.trim() || MARCA;
  switch (tipo) {
    case 'linha':
      return [
        { id: 'BRAND', value_name: brand },
        { id: 'MODEL', value_name: nome },
      ];
    case 'fita': {
      const match = RIBBON_TYPE.find((r) => texto.includes(r.termo));
      return [
        { id: 'BRAND', value_name: brand },
        { id: 'RIBBON_TYPE', value_id: match?.id ?? RIBBON_TYPE_DEFAULT },
      ];
    }
    case 'botao':
      return [
        { id: 'BRAND', value_name: brand },
        { id: 'MATERIAL', value_id: texto.includes('madeira') ? MATERIAL_MADEIRA : MATERIAL_ACRILICO },
      ];
    default:
      return [];
  }
}
```

(O comentário da linha 9 “Marca fixa da empresa” pode ser ajustado para “Marca padrão (fallback do fornecedor)”.)

- [ ] **Step 4: Rodar e confirmar verde (inclui os testes antigos com 2 args via fallback)**

Run: `pnpm test -- atributos`
Expected: PASS — os testes existentes (chamadas com 2 args) seguem com `value_name: 'Avil'` pelo fallback; os novos passam.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/categoria/atributos.ts supabase/functions/_shared/categoria/__tests__/atributos.test.ts
git commit -m "feat(m4): montarAtributosML aceita marca (fornecedor) com fallback Avil"
```

---

### Task 6: process-familia passa o fornecedor para o BRAND

**Files:**
- Modify: `supabase/functions/process-familia/index.ts:47,168`

Sem teste unitário (index de edge). Verificação por grep do diff.

- [ ] **Step 1: Incluir `fornecedor` no `select` do claim**

Linha 47, troque:

```ts
    .select('id, user_id, nome_pai, descricao_pai, lote_id, operacao')
```

por:

```ts
    .select('id, user_id, nome_pai, descricao_pai, lote_id, operacao, fornecedor')
```

- [ ] **Step 2: Passar o fornecedor ao montar os atributos**

Linha 168, troque:

```ts
    const atributosMl = montarAtributosML(tipo, claimed.nome_pai);
```

por:

```ts
    const atributosMl = montarAtributosML(tipo, claimed.nome_pai, (claimed.fornecedor as string | null) ?? undefined);
```

- [ ] **Step 3: Verificar o diff**

Run: `git diff supabase/functions/process-familia/index.ts | grep -E "fornecedor"`
Expected: mostra `..., operacao, fornecedor` no select e `claimed.fornecedor` na chamada.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/process-familia/index.ts
git commit -m "feat(m4): process-familia usa fornecedor como BRAND na publicacao CREATE"
```

---

### Task 7: Função pura `calcularMarkup`

**Files:**
- Create: `src/lib/markup.ts`
- Test: `tests/lib/markup.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/lib/markup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calcularMarkup } from '@/lib/markup';

describe('calcularMarkup', () => {
  it('lucro e markup positivos', () => {
    const r = calcularMarkup(4.3, 1.88);
    expect(r.lucro).toBeCloseTo(2.42, 2);
    expect(r.markup).toBeCloseTo(2.42 / 1.88, 4);
  });

  it('líquido abaixo do custo → lucro e markup negativos (prejuízo)', () => {
    const r = calcularMarkup(1.13, 1.88);
    expect(r.lucro).toBeCloseTo(-0.75, 2);
    expect(r.markup).toBeLessThan(0);
  });

  it('custo zero → markup 0 (evita divisão por zero)', () => {
    const r = calcularMarkup(5, 0);
    expect(r.lucro).toBe(5);
    expect(r.markup).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test -- markup`
Expected: FAIL — `@/lib/markup` não existe.

- [ ] **Step 3: Implementar**

Crie `src/lib/markup.ts`:

```ts
export interface Markup {
  lucro: number;
  markup: number;
}

/** Markup sobre o custo, a partir do líquido (após comissão ML). custo<=0 → markup 0. */
export function calcularMarkup(liquido: number, custo: number): Markup {
  const lucro = liquido - custo;
  return { lucro, markup: custo > 0 ? lucro / custo : 0 };
}
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `pnpm test -- markup`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/markup.ts tests/lib/markup.test.ts
git commit -m "feat(m4): funcao pura calcularMarkup (markup sobre custo)"
```

---

### Task 8: Frontend — `Variacao.custo` no tipo e no adapter

**Files:**
- Modify: `src/lib/tipos-dominio.ts:89-105`
- Modify: `src/lib/queries.ts:91-109` (`variacaoFromRow`)
- Test: `tests/lib/variacao-adapter.test.ts`

Nota: a query de famílias usa `.select('*, variacoes(*)')`, então a coluna `custo` já vem do banco; só falta o adapter lê-la.

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/lib/variacao-adapter.test.ts`, adicione um caso (ou ajuste o existente) verificando o mapeamento de `custo`. Acrescente:

```ts
import { variacaoFromRow } from '@/lib/queries';

it('mapeia custo do banco (string numérica → number)', () => {
  const base: any = {
    id: 'v1', codigo: '001', cor: 'Azul', cor_hex: null, cor_origem: 'descricao',
    cor_editada_pelo_operador: false, preco: '2.95', preco_publicacao: '12.00',
    estoque: 10, gtin: null, imagem_path: null, preco_editado_pelo_operador: false,
    excluida_da_publicacao: false, ml_variation_id: null, estoque_anterior: null,
    custo: '1.88',
  };
  expect(variacaoFromRow(base).custo).toBeCloseTo(1.88, 2);
});
```

(Se o arquivo já tiver um helper de row, reutilize-o e só acrescente `custo: '1.88'` + a asserção.)

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm test -- variacao-adapter`
Expected: FAIL — `variacaoFromRow(base).custo` é `undefined`.

- [ ] **Step 3: Adicionar `custo` ao tipo e ao adapter**

Em `src/lib/tipos-dominio.ts`, em `interface Variacao` (após `estoqueAnterior`):

```ts
  mlVariationId: string | null;
  estoqueAnterior: number | null;
  custo: number | null;
}
```

Em `src/lib/queries.ts`, em `variacaoFromRow` (após `estoqueAnterior`):

```ts
    mlVariationId: r.ml_variation_id,
    estoqueAnterior: r.estoque_anterior,
    custo: r.custo != null ? Number(r.custo) : null,
  };
}
```

- [ ] **Step 4: Rodar e confirmar verde + build**

Run: `pnpm test -- variacao-adapter && pnpm build`
Expected: PASS e `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tipos-dominio.ts src/lib/queries.ts tests/lib/variacao-adapter.test.ts
git commit -m "feat(m4): Variacao.custo no tipo e no adapter"
```

---

### Task 9: `CardVoceRecebe` mostra lucro + markup por tipo

**Files:**
- Modify: `src/components/card-voce-recebe.tsx`

Componente visual (sem teste unitário); verificação por `pnpm build` + bug bash.

- [ ] **Step 1: Aceitar `custo` e renderizar lucro/markup em cada coluna**

Reescreva `src/components/card-voce-recebe.tsx` para receber `custo` e usar `calcularMarkup` dentro de `Coluna`:

```tsx
import { Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import { useTarifaML } from '@/hooks/useTarifaML';
import { calcularMarkup } from '@/lib/markup';
import type { TarifaTipo } from '@/lib/tarifa';

function Coluna({
  titulo,
  t,
  melhor,
  custo,
}: {
  titulo: string;
  t: TarifaTipo;
  melhor: boolean;
  custo: number | null;
}) {
  const temCusto = custo != null && custo > 0;
  const { lucro, markup } = temCusto ? calcularMarkup(t.recebe, custo) : { lucro: 0, markup: 0 };
  const prejuizo = temCusto && lucro < 0;
  return (
    <div className={cn('rounded-md border p-2', melhor && 'border-blue-200 bg-blue-50')}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
        {melhor && <span className="text-[10px] font-semibold text-blue-700">melhor</span>}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">{fmtBRL(t.recebe)}</div>
      <div className="text-[11px] text-muted-foreground">
        comissão −{fmtBRL(t.comissao)} ({t.percentual}%)
      </div>
      {temCusto && (
        <div className={cn('mt-0.5 text-[11px]', prejuizo ? 'text-destructive' : 'text-muted-foreground')}>
          {prejuizo ? 'prejuízo ' : 'lucro '}
          <span className="font-semibold">{fmtBRL(lucro)}</span>
          {' · markup '}
          <span className="font-semibold">{Math.round(markup * 100)}%</span>
        </div>
      )}
    </div>
  );
}

export function CardVoceRecebe({
  preco,
  categoriaMlId,
  custo,
}: {
  preco: number;
  categoriaMlId: string | null;
  custo?: number | null;
}) {
  const { data, isLoading, isError } = useTarifaML(preco, categoriaMlId);

  return (
    <div className="rounded-md border p-2">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Wallet className="h-3.5 w-3.5" /> Você recebe por venda
      </div>

      {!categoriaMlId ? (
        <p className="text-xs text-muted-foreground">defina a categoria para calcular</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground">calculando…</p>
      ) : isError || !data ? (
        <p className="text-xs text-muted-foreground">tarifa indisponível</p>
      ) : (
        <>
          <p className="mb-1 text-xs text-muted-foreground">
            preço de publicação <span className="font-medium text-foreground">{fmtBRL(preco)}</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Coluna titulo="Clássico" t={data.classico} melhor={data.classico.recebe >= data.premium.recebe} custo={custo ?? null} />
            <Coluna titulo="Premium" t={data.premium} melhor={data.premium.recebe > data.classico.recebe} custo={custo ?? null} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            ℹ️ Acima de R$19, o Mercado Livre dá frete grátis ao comprador por sua conta (varia por região).
          </p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/components/card-voce-recebe.tsx
git commit -m "feat(m4): CardVoceRecebe mostra lucro e markup por tipo (prejuizo em vermelho)"
```

---

### Task 10: `PainelAnalise` calcula o custo representativo e passa ao card

**Files:**
- Modify: `src/components/painel-analise.tsx:23-28,145`

Componente visual; verificação por `pnpm build` + bug bash.

- [ ] **Step 1: Calcular `custoRepresentativo` (variação que define o preço exibido)**

Em `painel-analise.tsx`, logo após o cálculo de `precoPublicacao` (linhas 26-28), adicione:

```ts
  const precoPublicacao = baseVariacoes.length > 0
    ? Math.min(...baseVariacoes.map((v) => v.precoPublicacao ?? v.preco))
    : 0;

  // Custo da variação cujo preço de publicação é o menor (a mesma que define precoPublicacao);
  // empate → a primeira. Alimenta o markup do card "Você recebe".
  const variacaoRepresentativa = baseVariacoes.length > 0
    ? baseVariacoes.reduce((min, v) =>
        (v.precoPublicacao ?? v.preco) < (min.precoPublicacao ?? min.preco) ? v : min,
      baseVariacoes[0])
    : null;
  const custoRepresentativo = variacaoRepresentativa?.custo ?? null;
```

- [ ] **Step 2: Passar `custo` ao `CardVoceRecebe`**

Linha do `CardVoceRecebe` (≈145), troque:

```tsx
        <CardVoceRecebe preco={precoPublicacao} categoriaMlId={familia.categoriaMlId} />
```

por:

```tsx
        <CardVoceRecebe preco={precoPublicacao} categoriaMlId={familia.categoriaMlId} custo={custoRepresentativo} />
```

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/components/painel-analise.tsx
git commit -m "feat(m4): PainelAnalise calcula custo representativo p/ o markup"
```

---

### Task 11: Documentação — adendo ADR-0009 + CLAUDE.md

**Files:**
- Modify: `docs/decisions/0009-campos-payload-ml-e-categoria-deterministica.md`
- Modify: `CLAUDE.md` (seção “Schema esperado da planilha” + histórico)

- [ ] **Step 1: Adendo ao ADR-0009**

Acrescente ao final de `docs/decisions/0009-campos-payload-ml-e-categoria-deterministica.md`:

```markdown

## Adendo (2026-06-05) — BRAND a partir do FORNECEDOR + colunas CUSTO/FORNECEDOR

A planilha passou a exportar `CUSTO` e `FORNECEDOR`. Em consequência:

- **BRAND** deixa de ser fixo `"Avil"`: passa a usar o `FORNECEDOR` da linha PAI (`montarAtributosML(tipo, nome, marca)`), com fallback `"Avil"` quando vazio. Vale apenas em publicações CREATE; UPDATE preserva os atributos do anúncio (ADR-0016).
- Colunas novas (migration aditiva): `variacoes.custo` (custo do produto, distinto de `custo_centavos` = custo de IA) e `familias.fornecedor`.
- `CUSTO` alimenta o markup exibido no card "Você recebe" (cálculo no frontend; sem campo persistido de markup).
```

- [ ] **Step 2: Atualizar a seção “Schema esperado da planilha” do CLAUDE.md**

Em `CLAUDE.md`, na seção “Schema esperado da planilha”, troque a linha das colunas obrigatórias por:

```markdown
Colunas obrigatórias: `CODIGO`, `PAI`, `NOME`, `UNIDADE`, `GTIN`, `CUSTO`, `PRECO`, `ESTOQUE`, `DESCRICAO_DETALHADO`, `PESO_GRAMAS`, `ALTURA_CM`, `LARGURA_CM`, `COMPRIMENTO_CM`, `FORNECEDOR`.
```

E adicione às “Regras” da mesma seção:

```markdown
- `CUSTO` é o custo do produto (por variação); usado para markup. `FORNECEDOR` (por família, da linha PAI) vira a marca/BRAND do anúncio (fallback "Avil").
```

- [ ] **Step 3: Acrescentar uma linha ao histórico do CLAUDE.md**

Na tabela “Histórico deste CLAUDE.md”, adicione uma linha com data `2026-06-05` resumindo a entrega (CUSTO+FORNECEDOR+markup, BRAND via fornecedor, migration aditiva, card de markup).

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0009-campos-payload-ml-e-categoria-deterministica.md CLAUDE.md
git commit -m "docs(m4): adendo ADR-0009 (BRAND via fornecedor) + schema planilha CUSTO/FORNECEDOR"
```

---

### Task 12: Verificação final + deploy + push (com OK do Diego)

**Files:** nenhum (verificação/deploy)

- [ ] **Step 1: Suíte completa + build + lint**

Run: `pnpm test && pnpm build && pnpm lint`
Expected: todos os testes verdes (≈237+), `✓ built`, lint com 0 errors (3 warnings benignos pré-existentes).

- [ ] **Step 2: Pedir OK ao Diego para deploy + push**

Não prosseguir sem confirmação explícita.

- [ ] **Step 3: Deploy das edges via MCP (após OK)**

Redeploy de `ingest-lote` (mudou: rows/base/familiasInsert) e `process-familia` (mudou: claim select + montarAtributosML) e a `_shared/categoria/atributos.ts` (afeta as duas). Padrão já usado nesta sessão: `get_edge_function` → trocar os arquivos alterados (index + `_shared/categoria/atributos.ts` no caso do process-familia; index + `_shared/types.ts` + `_shared/parser.ts` no caso do ingest) → `deploy_edge_function` com `verify_jwt:false`, preservando os demais arquivos do bundle. Confirmar que a versão subiu em cada função.

- [ ] **Step 4: Push (após OK)**

```bash
git push origin main
```

- [ ] **Step 5: Orientar o bug bash**

Diego sobe um lote real com as colunas novas: conferir BRAND = fornecedor no anúncio publicado (CREATE) e o markup/lucro no card "Você recebe" (Clássico/Premium), incluindo o caso de prejuízo (líquido < custo).

---

## Self-Review

**Spec coverage:**
- §1 Planilha & parser → Tasks 2, 3 ✓
- §2 Banco → Task 1 ✓
- §3 Persistência ingest → Task 4 ✓
- §4 BRAND via fornecedor → Tasks 5, 6 ✓
- §5 Markup no card → Tasks 7, 8, 9, 10 ✓
- §Documentação → Task 11 ✓
- Deploy/push com OK → Task 12 ✓

**Type consistency:** `montarAtributosML(tipo, nome, marca?)` (Tasks 5, 6); `Variacao.custo: number | null` (Tasks 8, 10); `CardVoceRecebe({preco, categoriaMlId, custo?})` (Tasks 9, 10); `calcularMarkup(liquido, custo) → {lucro, markup}` (Tasks 7, 9); `FamiliaAgrupada.fornecedor` (Tasks 2, 3, 4). Consistentes.

**Placeholders:** nenhum — todos os steps têm código/comandos concretos.
