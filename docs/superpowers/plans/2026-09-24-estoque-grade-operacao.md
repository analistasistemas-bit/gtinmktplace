# Estoque para produtos de grade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operar produto de grade (cor × tamanho) publicado pela tela Estoque: mostrar o tamanho onde a variação é identificada e permitir acrescentar cores/tamanhos a um anúncio de grade já publicado no ML.

**Architecture:** Três partes na mesma branch. (A) as RPCs de estoque devolvem `tamanho` e um rótulo único `cor · tamanho` é usado por lista, Entrada, Ajuste e Movimentos. (B) "Adicionar variação" roteia produto de grade para um dialog novo. (C) o dialog estende a matriz Cor × Tamanho com as células publicadas travadas, a edge `adicionar-variacoes-familia` aceita tamanho (códigos gerados pelo sistema), e o UPDATE User Products passa a montar `SIZE`/`SIZE_GRID_ID`/`SIZE_GRID_ROW_ID` por SKU sem herdar os do irmão.

**Tech Stack:** React 19 + TS + TanStack Query + Tailwind v4 + shadcn (front); Supabase Edge Functions (Deno, testadas com vitest); Postgres (migrations via Supabase CLI).

**Spec:** `docs/superpowers/specs/2026-09-24-estoque-grade-operacao-design.md` (+ amendment 2026-09-24c no ADR-0166).

## Global Constraints

- INV-1: produto/org sem tamanho → UI, payload e comportamento byte a byte iguais aos de hoje.
- Migrations só por `supabase migration new` + `supabase db push`; validar com `npm run db:check` (ADR-0043). Nunca editar migration antiga.
- Git neste worktree: usar `/usr/bin/git` (o hook RTK barra `git`), commit com `-F <arquivo absoluto>`; mensagem termina com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Testes: `pnpm test <caminho>` (vitest; exige `.env.test` — copiar de `/Users/diego/Desktop/IA/Anuncios MktPlace/.env.test` se faltar, junto com `.env.local`).
- Portão antes de push: `pnpm preflight:static`; antes do merge: `pnpm preflight`.
- Teto de variações por grade: `LIMITE_VARIACOES_GERADAS = 60` (existentes + novas).
- Nunca herdar do irmão: `COLOR`, `GTIN`, `EMPTY_GTIN_REASON`, `SELLER_SKU`, `SIZE`, `SIZE_GRID_ID`, `SIZE_GRID_ROW_ID`.
- `familias.genero` ∈ `'masculino'|'feminino'|'unissex'`; tamanho ∈ `tamanhosValidosParaTipos(tipos da org)`.
- Revisão humana antes de publicar continua valendo para CREATE; este fluxo (ADR-0129) é UPDATE direto e só pode ser acionado por admin.
- Roteamento de modelo: Tasks 1, 4, 5 → **opus** (migration / publicação no ML); Tasks 2, 3, 6, 7 → **sonnet**; Task 8–9 no loop principal.

## Review Focus

1. Irmão tem `SIZE`/`SIZE_GRID_ROW_ID` na ficha e a família tem `SIZE` em `atributos_ml` → o SKU novo sai com **um** `SIZE` e é o dele (Task 4, teste "um SIZE só").
2. Cor nova de tamanho existente + tamanho novo de cor existente na MESMA submissão → só as células faltantes viram SKU; nenhuma célula publicada vai no payload (Task 7, teste de `celulasNovas`; Task 5, teste de par duplicado).
3. Retry com a mesma `chave` depois de os códigos terem sido reservados → devolve o resultado anterior, não reserva códigos novos nem duplica SKU (Task 5, teste de idempotência reaproveitado + ordem: idempotência antes da reserva).
4. Foto herdada de cor cujo único SKU vivo está sem `imagem_path` (só `ml_picture_id`) → herda o `ml_picture_id`, não recusa (Task 5, teste `resolverFotoHerdada`).
5. Produto sem tamanho numa org COM tipo habilitado → continua abrindo o dialog antigo, pedindo código digitado (Task 7, teste de roteamento).

---

### Task 1: RPCs de estoque devolvem `tamanho` (opus)

**Files:**
- Create: `supabase/migrations/<timestamp>_estoque_rpc_tamanho.sql` (via `supabase migration new estoque_rpc_tamanho`)
- Create: `supabase/tests/estoque_rpc_tamanho.sql`

**Interfaces:**
- Produces: `variacoes_estoque_produto(text)` e `skus_estoque_org()` passam a incluir a chave `tamanho` (text|null) em cada objeto JSON. Nada mais muda (corpo, ordem, grants).

- [ ] **Step 1: Criar a migration**

Run: `supabase migration new estoque_rpc_tamanho`

Conteúdo: copiar **literalmente** as definições B e C de `supabase/migrations/20260903030505_estoque_rpc_exclui_kit.sql` (linhas 188–313: as duas `create or replace function`, `revoke` e `grant`), com exatamente duas alterações:
- em `variacoes_estoque_produto`, dentro do `json_build_object`, logo após `'cor', v.cor,` acrescentar `'tamanho', v.tamanho,`
- em `skus_estoque_org`, logo após `'cor', v.cor,` acrescentar `'tamanho', v.tamanho,`

Cabeçalho do arquivo:
```sql
-- ADR-0166 amendment 2026-09-24c: as telas do Estoque identificam a variação por cor · tamanho.
-- As duas funções retornam `setof json` — acrescentar a chave não muda o tipo de retorno, então
-- `create or replace` basta (sem janela sem função). Corpo idêntico a 20260903030505 + `tamanho`.
```

- [ ] **Step 2: Escrever o teste SQL**

`supabase/tests/estoque_rpc_tamanho.sql` — fixture mínima (org, usuário, lote manual, família com `chave_cadastro`, duas variações com códigos de 8 dígitos, uma com `tamanho='M'` e outra com `tamanho=null`), impersona o usuário e confere as chaves:
```sql
\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('92000000-0000-0000-0000-000000000001', 'Grade test', 'grade-test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('92000000-0000-0000-0000-000000000101', 'grade@test.local',
   '{"org_id":"92000000-0000-0000-0000-000000000001"}'::jsonb);
insert into public.lotes (id, user_id, org_id, status, origem) values
  ('92000000-0000-0000-0000-000000000201', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', 'processando', 'manual');
insert into public.familias (id, lote_id, user_id, org_id, codigo_pai, nome_pai, operacao, origem, chave_cadastro)
values ('92000000-0000-0000-0000-000000000301', '92000000-0000-0000-0000-000000000201',
  '92000000-0000-0000-0000-000000000101', '92000000-0000-0000-0000-000000000001',
  '09200000', 'Camiseta teste', 'CREATE', 'nacional', gen_random_uuid());
insert into public.variacoes (familia_id, user_id, org_id, codigo, nome, cor, tamanho, preco, estoque)
values
  ('92000000-0000-0000-0000-000000000301', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09200001', 'Preto', 'Preto', 'M', 50, 0),
  ('92000000-0000-0000-0000-000000000301', '92000000-0000-0000-0000-000000000101',
   '92000000-0000-0000-0000-000000000001', '09200002', 'Azul', 'Azul', null, 50, 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"92000000-0000-0000-0000-000000000101","role":"authenticated"}';

do $$
declare r json;
begin
  select x into r from public.variacoes_estoque_produto('09200000') x where x->>'codigo' = '09200001';
  if r->>'tamanho' is distinct from 'M' then raise exception 'variacoes_estoque_produto sem tamanho: %', r; end if;
  select x into r from public.variacoes_estoque_produto('09200000') x where x->>'codigo' = '09200002';
  if not (r::jsonb ? 'tamanho') or r->>'tamanho' is not null then raise exception 'tamanho null deveria vir como chave nula: %', r; end if;
  select x into r from public.skus_estoque_org() x where x->>'codigo' = '09200001';
  if r->>'tamanho' is distinct from 'M' then raise exception 'skus_estoque_org sem tamanho: %', r; end if;
end $$;
rollback;
```
Se algum `insert` da fixture falhar por constraint que não é o objeto do teste (coluna NOT NULL nova, check de origem), ajuste **só a fixture** com o valor mínimo válido — nunca a asserção.

- [ ] **Step 3: Rodar o teste — antes da migration deve falhar**

Run (stack local): `supabase start` (se não estiver no ar) → `supabase db reset` **sem** a migration nova aplicada é difícil; alternativa aceita: aplicar tudo com `supabase db reset` e confirmar que o teste PASSA, depois `git stash`-free: comente temporariamente o `'tamanho', v.tamanho,` da migration, `supabase db reset`, confirme FAIL com "sem tamanho", restaure e `supabase db reset` de novo.
Comando do teste: `psql "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres" -f supabase/tests/estoque_rpc_tamanho.sql`
Expected: com a chave → sem saída de erro (`ROLLBACK`); sem a chave → `ERROR: variacoes_estoque_produto sem tamanho`.
Se o stack local não subir: registrar isso no relatório e validar depois do `db push` (Task 9) com a mesma asserção via SQL read-only no projeto remoto.

- [ ] **Step 4: `npm run db:check`** — Expected: sem erro.

- [ ] **Step 5: Commit**
```bash
/usr/bin/git add supabase/migrations/*_estoque_rpc_tamanho.sql supabase/tests/estoque_rpc_tamanho.sql
/usr/bin/git commit -F <msg>   # "feat(estoque): RPCs de estoque devolvem tamanho (ADR-0166 2026-09-24c)"
```

---

### Task 2: Tipos, rótulo único e ordenação (sonnet)

**Files:**
- Create: `src/lib/rotulo-variacao.ts`
- Create: `src/lib/__tests__/rotulo-variacao.test.ts`
- Modify: `src/lib/produtos-saldo.ts` (tipos `VariacaoComSaldo`, `SkuEstoqueOrg`, `LinhaVariacaoRpc`; `mapVariacaoRpc`; `fetchVariacoesProduto`; `fetchSkusEstoqueOrg`)
- Test: `src/lib/__tests__/produtos-saldo*.test.ts` (o que já cobre `fetchVariacoesProduto`/`mapVariacaoRpc` — localizar com `ls src/lib/__tests__ | grep produtos-saldo`)

**Interfaces:**
- Consumes: Task 1 (chave `tamanho` no JSON).
- Produces:
  - `VariacaoComSaldo.tamanho: string | null`, `SkuEstoqueOrg.tamanho: string | null`
  - `rotuloVariacao(v: { cor: string | null; nome: string | null; tamanho?: string | null }): string | null` — `null` quando não há cor nem nome.
  - `ordenarVariacoesGrade<T extends { cor: string | null; nome: string | null; tamanho?: string | null }>(vs: T[]): T[]`

- [ ] **Step 1: Teste do rótulo e da ordenação**
```ts
// src/lib/__tests__/rotulo-variacao.test.ts
import { describe, it, expect } from 'vitest';
import { rotuloVariacao, ordenarVariacoesGrade } from '@/lib/rotulo-variacao';

describe('rotuloVariacao', () => {
  it('sem tamanho = cor ?? nome (INV-1, igual ao de hoje)', () => {
    expect(rotuloVariacao({ cor: 'Preto', nome: 'Preto X' })).toBe('Preto');
    expect(rotuloVariacao({ cor: null, nome: 'Fita' })).toBe('Fita');
    expect(rotuloVariacao({ cor: null, nome: null })).toBeNull();
    expect(rotuloVariacao({ cor: 'Preto', nome: null, tamanho: null })).toBe('Preto');
    expect(rotuloVariacao({ cor: 'Preto', nome: null, tamanho: '  ' })).toBe('Preto');
  });
  it('com tamanho = "cor · tamanho"', () => {
    expect(rotuloVariacao({ cor: 'Preto', nome: 'Preto', tamanho: 'M' })).toBe('Preto · M');
    expect(rotuloVariacao({ cor: null, nome: null, tamanho: '42' })).toBe('42');
  });
});

describe('ordenarVariacoesGrade', () => {
  it('ordena por cor e, dentro da cor, na ordem canônica do tamanho', () => {
    const vs = [
      { codigo: '3', cor: 'Preto', nome: 'Preto', tamanho: 'G' },
      { codigo: '1', cor: 'Azul', nome: 'Azul', tamanho: 'P' },
      { codigo: '2', cor: 'Preto', nome: 'Preto', tamanho: 'P' },
      { codigo: '4', cor: 'Preto', nome: 'Preto', tamanho: 'M' },
    ];
    expect(ordenarVariacoesGrade(vs).map((v) => v.codigo)).toEqual(['1', '2', '4', '3']);
  });
  it('sem tamanho em nenhuma variação devolve a lista na MESMA ordem (INV-1)', () => {
    const vs = [{ cor: 'Z', nome: 'Z' }, { cor: 'A', nome: 'A' }];
    expect(ordenarVariacoesGrade(vs)).toEqual(vs);
  });
  it('numeração de calçado em ordem numérica canônica', () => {
    const vs = [{ cor: 'Preto', nome: null, tamanho: '40' }, { cor: 'Preto', nome: null, tamanho: '38' }];
    expect(ordenarVariacoesGrade(vs).map((v) => v.tamanho)).toEqual(['38', '40']);
  });
});
```

- [ ] **Step 2: Rodar** — `pnpm test src/lib/__tests__/rotulo-variacao.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**
```ts
// src/lib/rotulo-variacao.ts
// ADR-0166 amendment 2026-09-24c: rótulo ÚNICO da variação nas telas do Estoque. Antes cada tela
// fazia `cor ?? nome` por conta própria e nenhuma mostrava o tamanho — numa grade, cinco SKUs
// "Preto" indistinguíveis na hora de dar entrada. Sem tamanho o resultado é idêntico ao antigo.
import { TAMANHOS_ROUPA, NUMERACOES_CALCADO } from '@/lib/tamanhos';
import { compararCor } from '@/lib/cor';

type Identificavel = { cor: string | null; nome: string | null; tamanho?: string | null };

export function rotuloVariacao(v: Identificavel): string | null {
  const base = v.cor ?? v.nome;
  const tamanho = v.tamanho?.trim();
  if (!tamanho) return base;
  return base ? `${base} · ${tamanho}` : tamanho;
}

const ORDEM_TAMANHO: readonly string[] = [...TAMANHOS_ROUPA, ...NUMERACOES_CALCADO];

function indiceTamanho(t: string | null | undefined): number {
  const i = t ? ORDEM_TAMANHO.indexOf(t) : -1;
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** Cor (mesma regra de `compararCor`) e, dentro da cor, tamanho na ordem canônica. Sem tamanho
 *  em nenhuma linha, devolve a lista intacta — a ordem por cor já vem de `fetchVariacoesProduto`. */
export function ordenarVariacoesGrade<T extends Identificavel>(vs: T[]): T[] {
  if (!vs.some((v) => v.tamanho?.trim())) return vs;
  return [...vs].sort((a, b) => compararCor(a, b) || indiceTamanho(a.tamanho) - indiceTamanho(b.tamanho));
}
```
Antes de fechar: abrir `src/lib/cor.ts` e confirmar a assinatura de `compararCor` (usada hoje em `.sort(compararCor)` sobre `VariacaoComSaldo`). Se ela exigir campos além de `cor`/`nome`, ajustar o tipo `Identificavel` para os campos que ela lê — não mudar `compararCor`.

- [ ] **Step 4: Tipos e fetch em `produtos-saldo.ts`**
  - `VariacaoComSaldo`: acrescentar `/** ADR-0166: null = variação sem eixo de tamanho. */ tamanho: string | null;`
  - `SkuEstoqueOrg`: acrescentar `tamanho: string | null;`
  - `LinhaVariacaoRpc`: acrescentar `tamanho?: string | null;`
  - `mapVariacaoRpc`: acrescentar `tamanho: l.tamanho ?? null,`
  - `fetchVariacoesProduto`: `return ordenarVariacoesGrade((...).map(mapVariacaoRpc).sort(compararCor));`
  - `fetchSkusEstoqueOrg`: acrescentar `tamanho?: string | null` aos dois tipos inline e `tamanho: s.tamanho ?? null` no map.
  - Corrigir fixtures de testes existentes que constroem `VariacaoComSaldo`/`SkuEstoqueOrg` literais (o `tsc` vai apontar): acrescentar `tamanho: null`.

- [ ] **Step 5: Rodar** — `pnpm test src/lib` e `pnpm exec tsc -b --force` → PASS.

- [ ] **Step 6: Commit** — `feat(estoque): rotulo unico cor · tamanho e ordenacao de grade`

---

### Task 3: Telas do Estoque mostram o tamanho (sonnet)

**Files:**
- Modify: `src/components/estoque/variacao-estoque-linha.tsx:113`
- Modify: `src/components/estoque/variacao-estoque-card.tsx` (onde exibe `cor ?? nome`)
- Modify: `src/components/estoque/dialog-entrada.tsx:30-33`
- Modify: `src/components/estoque/dialog-ajuste.tsx:15-18`
- Modify: `src/components/estoque/filtros-movimentos.tsx:12-15` (+ onde rotula a opção)
- Modify: `src/components/movimentos-estoque.tsx:121`
- Modify: `src/components/estoque/produto-card.tsx:520-524`
- Test: `src/components/estoque/__tests__/` (arquivos existentes de entrada/ajuste/linha/movimentos — `ls src/components/estoque/__tests__ src/components/__tests__ | grep -i "entrada\|ajuste\|movimento\|variacao-estoque"`)

**Interfaces:**
- Consumes: `rotuloVariacao`, `VariacaoComSaldo.tamanho`, `SkuEstoqueOrg.tamanho` (Task 2).
- Produces: `VariacaoFiltro = { codigo: string; cor: string | null; nome?: string | null; tamanho?: string | null }`.

- [ ] **Step 1: Testes que falham** — em cada suíte existente, acrescentar um caso com uma variação `{ cor: 'Preto', nome: 'Preto', tamanho: 'M' }` e esperar o texto `Preto · M`:
  - linha expandida: `screen.getByText('Preto · M')`
  - Entrada e Ajuste: a opção do seletor com `'<codigo> · Preto · M'`
  - Movimentos: linha do movimento do código `09200001` mostra `09200001 · Preto · M` quando `variacoes` traz esse código; e mostra só `09200001` quando não traz.
  Manter os casos antigos intactos (INV-1).

- [ ] **Step 2: Rodar** — FAIL nos casos novos.

- [ ] **Step 3: Implementar**
  - `variacao-estoque-linha.tsx:113`: `{rotuloVariacao(v) ?? '—'}`; idem em `variacao-estoque-card.tsx`.
  - `dialog-entrada.tsx` e `dialog-ajuste.tsx`: a função local vira
    ```ts
    function rotuloComCodigo(v: { codigo: string; cor: string | null; nome: string | null; tamanho?: string | null }): string {
      const complemento = rotuloVariacao(v);
      return complemento ? `${v.codigo} · ${complemento}` : v.codigo;
    }
    ```
    importando `rotuloVariacao` de `@/lib/rotulo-variacao` e trocando os usos de `rotuloVariacao` local por `rotuloComCodigo`. Se o picker filtra por texto digitado, incluir o rótulo novo no texto filtrável.
  - `filtros-movimentos.tsx`: `VariacaoFiltro` ganha `nome?: string | null; tamanho?: string | null`; o rótulo da opção passa a usar `rotuloVariacao({ cor: v.cor, nome: v.nome ?? null, tamanho: v.tamanho })`.
  - `produto-card.tsx:523`: `variacoes={(variacoes ?? []).map((v) => ({ codigo: v.codigo, cor: v.cor, nome: v.nome, tamanho: v.tamanho }))}`
  - `movimentos-estoque.tsx`: 
    ```ts
    const rotuloPorCodigo = useMemo(
      () => new Map(variacoes.map((v) => [v.codigo, rotuloVariacao({ cor: v.cor, nome: v.nome ?? null, tamanho: v.tamanho })])),
      [variacoes],
    );
    ```
    e na linha 121: `<span className="font-mono">{m.codigo}</span>{rotuloPorCodigo.get(m.codigo) && <span className="text-muted-foreground"> · {rotuloPorCodigo.get(m.codigo)}</span>}` — conferir no teste que o layout da linha (grid) não quebra; se a coluna for estreita, usar `truncate`.

- [ ] **Step 4: Rodar** — `pnpm test src/components` → PASS; `pnpm exec tsc -b --force` → PASS.

- [ ] **Step 5: Commit** — `feat(estoque): lista, entrada, ajuste e movimentos mostram o tamanho`

---

### Task 4: UPDATE User Products monta o tamanho por SKU (opus)

**Files:**
- Modify: `supabase/functions/_shared/user-products/atributos-irmao.ts:20`
- Modify: `supabase/functions/_shared/user-products/atualizar-familia-up.ts` (tipos `VariacaoUP`, `AtualizarFamiliaUPArgs`; `criarPlano` ~l.219)
- Modify: `supabase/functions/update-familia-ml/processar.ts:166` (select de variações)
- Modify: `supabase/functions/reconciliar-convergencia-up/processar.ts:54,65` (selects)
- Test: `supabase/functions/_shared/user-products/__tests__/atributos-irmao.test.ts`, `.../atualizar-familia-up-ficha.test.ts`

**Interfaces:**
- Produces:
  - `VariacaoUP.tamanho?: string | null`
  - `AtualizarFamiliaUPArgs.familia.genero?: string | null`
  - `AtualizarFamiliaUPArgs.garantirChartFn?: typeof garantirChart` (injeção em teste; produção usa `garantirChart`)

- [ ] **Step 1: Teste de `atributosDeFicha`**
```ts
it('SIZE, SIZE_GRID_ID e SIZE_GRID_ROW_ID são por SKU — nunca herdados do irmão', () => {
  const ficha = atributosDeFicha([
    { id: 'SIZE', value_name: 'M' }, { id: 'SIZE_GRID_ID', value_name: 'CH1' },
    { id: 'SIZE_GRID_ROW_ID', value_name: 'CH1:2' }, { id: 'GENDER', value_id: '339666' },
  ]);
  expect(ficha.map((a) => a.id)).toEqual(['GENDER']);
});
```

- [ ] **Step 2: Testes de `criarPlano` com tamanho** — em `atualizar-familia-up-ficha.test.ts`, novo `describe`:
```ts
describe('atualizarFamiliaUP — SKU novo de grade (ADR-0166 2026-09-24c)', () => {
  const IRMAO_GRADE = [
    ...ATRIBUTOS_DO_IRMAO,
    { id: 'GENDER', value_id: '339666', value_name: 'Masculino' },
    { id: 'SIZE', value_name: 'M' },
    { id: 'SIZE_GRID_ID', value_name: 'CH1' },
    { id: 'SIZE_GRID_ROW_ID', value_name: 'CH1:2' },
  ];
  const chartFake = vi.fn(async () => ({
    chartId: 'CH1',
    linhaPorTamanho: new Map([['M', { rowId: 'CH1:2', sizeLabel: 'M' }], ['G', { rowId: 'CH1:3', sizeLabel: 'G' }]]),
  }));
  function argsGrade(over: Partial<AtualizarFamiliaUPArgs> = {}) {
    const base = args();
    return args({
      familia: { ...(base.familia as object), genero: 'masculino', categoria_ml_id: 'MLB1', atributos_ml: [{ id: 'SIZE', value_name: 'XX' }] } as never,
      variacoes: [
        { codigo: 'A', cor: 'Azul-petróleo', tamanho: 'M', estoque: 1, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P1' },
        { codigo: 'NOVA', cor: 'Preto', tamanho: 'G', estoque: 40, preco_publicacao: 10, gtin: null, imagem_path: null, ml_picture_id: 'P2' },
      ] as never,
      garantirChartFn: chartFake as never,
      ...over,
    });
  }
  beforeEach(() => {
    chartFake.mockClear();
    globalThis.fetch = (async () => new Response(JSON.stringify({ attributes: IRMAO_GRADE }), { status: 200 })) as typeof fetch;
  });

  it('SKU novo leva o SIZE e a linha do chart DELE, não os do irmão — e um SIZE só', async () => {
    await atualizarFamiliaUP(argsGrade());
    const attrs = atributosEnviados();
    expect(attrs.filter((a) => a.id === 'SIZE')).toEqual([{ id: 'SIZE', value_name: 'G' }]);
    expect(attrs.filter((a) => a.id === 'SIZE_GRID_ROW_ID')).toEqual([{ id: 'SIZE_GRID_ROW_ID', value_name: 'CH1:3' }]);
    expect(attrs.filter((a) => a.id === 'SIZE_GRID_ID')).toEqual([{ id: 'SIZE_GRID_ID', value_name: 'CH1' }]);
  });

  it('chart resolvido uma vez, com gênero e todos os tamanhos da família', async () => {
    await atualizarFamiliaUP(argsGrade());
    expect(chartFake).toHaveBeenCalledTimes(1);
    expect(chartFake.mock.calls[0]!.slice(2)).toEqual(['c', 'MLB1', 'masculino', ['M', 'G']]);
  });

  it('família com tamanho e sem gênero falha alto, sem criar item', async () => {
    await expect(atualizarFamiliaUP(argsGrade({
      familia: { ...(args().familia as object), genero: null, categoria_ml_id: 'MLB1' } as never,
    }))).rejects.toThrow(/genero/i);
    expect(criarItemSpy).not.toHaveBeenCalled();
  });

  it('família SEM tamanho: chart nunca é chamado e o payload segue igual (INV-1)', async () => {
    await atualizarFamiliaUP(args({ garantirChartFn: chartFake as never }));
    expect(chartFake).not.toHaveBeenCalled();
    expect(atributosEnviados().some((a) => a.id.startsWith('SIZE'))).toBe(false);
  });
});
```
Se `atualizarFamiliaUP` capturar a exceção da porta e devolver `{ estado: 'erro' }` em vez de rejeitar, troque a asserção do 3º caso para `expect(r.estado).toBe('erro')` + `expect(r.mensagem).toMatch(/genero/i)` — o requisito é "não cria item e diz o porquê".

- [ ] **Step 3: Rodar** — `pnpm test supabase/functions/_shared/user-products` → FAIL nos novos.

- [ ] **Step 4: Implementar**
  - `atributos-irmao.ts:20`:
    ```ts
    /** Atributos que são por SKU e NUNCA podem ser copiados do irmão — copiá-los publicaria a cor
     *  nova com a cor/código de barras/TAMANHO do SKU antigo (ADR-0166 2026-09-24c: SIZE_GRID_ROW_ID
     *  do irmão faria o SKU novo nascer com o tamanho dele). */
    const POR_SKU = new Set(['COLOR', 'GTIN', 'EMPTY_GTIN_REASON', 'SELLER_SKU', 'SIZE', 'SIZE_GRID_ID', 'SIZE_GRID_ROW_ID']);
    ```
  - `atualizar-familia-up.ts`:
    - import: `import { garantirChart, type ChartResolvido, type Genero } from '../ml/size-chart.ts';`
    - `VariacaoUP`: `/** ADR-0166. null/ausente = sem eixo de tamanho (INV-1). */ tamanho?: string | null;`
    - `familia`: `genero?: string | null;`
    - args: `garantirChartFn?: typeof garantirChart;`
    - antes de `criarPlano`:
      ```ts
      // ADR-0166 2026-09-24c: SKU novo de grade precisa do chart ANTES do payload. Resolvido uma vez
      // por execução (SIZE_GRID_ID é o mesmo para a família inteira). O chart nasce com o superset de
      // tamanhos (ADR-0167 D2), então isto é cache hit; tamanho fora dele cria chart novo (D4).
      const IDS_TAMANHO = new Set(['SIZE', 'SIZE_GRID_ID', 'SIZE_GRID_ROW_ID']);
      let chartPromessa: Promise<ChartResolvido | null> | null = null;
      const resolverChart = (): Promise<ChartResolvido | null> => (chartPromessa ??= (async () => {
        const tamanhos = [...new Set(variacoes.map((v) => v.tamanho?.trim()).filter((t): t is string => !!t))];
        if (tamanhos.length === 0) return null;
        if (!familia.genero) {
          throw new Error(`Família ${familia.id}: SKU com tamanho mas familias.genero ausente — o ML exige GENDER com o guia de tamanhos (ADR-0167 D6).`);
        }
        if (!familia.categoria_ml_id) throw new Error(`Família ${familia.id}: sem categoria_ml_id para resolver o guia de tamanhos.`);
        return (args.garantirChartFn ?? garantirChart)(
          admin, await ctx.getToken(), conexao.id, familia.categoria_ml_id, familia.genero as Genero, tamanhos,
        );
      })());
      ```
    - dentro de `criarPlano`, antes de `montarPayloadItem`:
      ```ts
      const chart = v.tamanho ? await resolverChart() : null;
      const linha = v.tamanho ? chart?.linhaPorTamanho.get(v.tamanho) ?? null : null;
      const atributosMesclados = mesclarAtributos(familia.atributos_ml, await lerFichaDoIrmao());
      // SIZE* vão por SKU em montarPayloadItem; se a família também os tiver em atributos_ml
      // (IA/Revisão), duplicariam — mesma limpeza de publicar-familia-up.ts (IDS_SUBSTITUIDOS).
      const atributos = v.tamanho ? atributosMesclados.filter((a) => !a.id || !IDS_TAMANHO.has(a.id)) : atributosMesclados;
      ```
      e no payload: `{ ...familiaInput, atributos_ml: atributos }` e na variação acrescentar
      `tamanho: v.tamanho ?? null, sizeLabel: linha?.sizeLabel ?? null, sizeGridId: chart?.chartId ?? null, sizeGridRowId: linha?.rowId ?? null,`.
      (Tamanho sem linha → o guard de `montarPayloadItem` já lança "sem guia de tamanhos resolvida".)
  - `update-familia-ml/processar.ts:166`: acrescentar `tamanho` ao select (a `familia` já é `select('*')` e leva `genero`).
  - `reconciliar-convergencia-up/processar.ts`: `familias` select + `, genero`; `variacoes` select + `, tamanho`.

- [ ] **Step 5: Rodar** — `pnpm test supabase/functions/_shared/user-products supabase/functions/update-familia-ml supabase/functions/reconciliar-convergencia-up` → PASS; `pnpm check:functions` → PASS.

- [ ] **Step 6: Commit** — `fix(up): SKU novo de grade monta SIZE/SIZE_GRID_ROW_ID proprios, nunca os do irmao`

---

### Task 5: Edge `adicionar-variacoes-familia` aceita grade (opus)

**Files:**
- Modify: `supabase/functions/adicionar-variacoes-familia/processar.ts`
- Modify: `supabase/functions/adicionar-variacoes-familia/index.ts`
- Modify: `supabase/functions/_shared/produto/codigos.ts` (novo `derivarCodigosSku`)
- Test: `supabase/functions/adicionar-variacoes-familia/__tests__/processar.test.ts`, `supabase/functions/_shared/produto/__tests__/codigos.test.ts` (criar se não existir)

**Interfaces:**
- Consumes: Task 4 (publicação monta o tamanho).
- Produces (contrato do body, usado pela Task 7):
  ```ts
  export interface VariacaoNovaEntrada {
    codigo?: string;            // obrigatório SEM tamanho; PROIBIDO com tamanho (gerado pelo sistema)
    nome: string;               // a cor
    tamanho?: string;           // obrigatório em família de grade
    gtin: string | null;
    preco: number; custo: number | null; estoqueInicial: number;
    pesoGramas: number | null; alturaCm: number | null; larguraCm: number | null; comprimentoCm: number | null;
    imagemPath?: string;        // foto enviada agora
    fotoDeCodigo?: string;      // OU: herda a foto do SKU vivo com este código (mesma cor) — só em grade
  }
  ```
  Resposta: `{ loteId, familiaId, publicacaoOk, falhasEstoque, codigos: string[] }` (`codigos` = SKUs novos, 8 dígitos, na ordem de `variacoes`; também no ramo `jaExistia`, lidos de `familias.mudanca_estrutural.novas`).
  - `derivarCodigosSku(ultimo: number, qtd: number): string[]`
  - `validarGrade(entrada: VariacaoNovaEntrada[], ctx: { vivas: Array<{ codigo: string; cor: string | null; tamanho: string | null }>; tamanhosValidos: readonly string[]; genero: string | null; ehUP: boolean }): ErroValidacao[]`
  - `resolverFotoHerdada(fotoDeCodigo: string, cor: string, vivas: Array<{ codigo: string; cor: string | null; imagem_path: string | null; ml_picture_id: string | null }>): { imagemPath: string | null; mlPictureId: string | null } | null`

- [ ] **Step 1: Testes puros (falham)**
```ts
// processar.test.ts — novos casos
describe('validarEntrada — grade', () => {
  const base = { familia_id: 'f', chave: '00000000-0000-4000-8000-000000000000' };
  const v = { nome: 'Verde', tamanho: 'P', gtin: null, preco: 10, custo: null, estoqueInicial: 1,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null };
  it('aceita variação sem código quando traz tamanho', () => {
    expect(validarEntrada({ ...base, variacoes: [{ ...v, imagemPath: 'u1/x.jpg' }] }, 'u1')).toEqual([]);
  });
  it('aceita fotoDeCodigo no lugar de imagemPath', () => {
    expect(validarEntrada({ ...base, variacoes: [{ ...v, fotoDeCodigo: '00000001' }] }, 'u1')).toEqual([]);
  });
  it('recusa sem foto nenhuma e com as duas', () => {
    expect(validarEntrada({ ...base, variacoes: [{ ...v }] }, 'u1').map((e) => e.campo)).toContain('variacoes[0].imagemPath');
    expect(validarEntrada({ ...base, variacoes: [{ ...v, imagemPath: 'u1/x', fotoDeCodigo: '1' }] }, 'u1').map((e) => e.campo)).toContain('variacoes[0].imagemPath');
  });
  it('sem tamanho continua exigindo código (fluxo antigo intacto)', () => {
    const { tamanho: _t, ...semTam } = v;
    expect(validarEntrada({ ...base, variacoes: [{ ...semTam, imagemPath: 'u1/x' }] }, 'u1').map((e) => e.campo)).toContain('variacoes[0].codigo');
  });
});

describe('validarGrade', () => {
  const vivas = [{ codigo: '00000001', cor: 'Preto', tamanho: 'P' }, { codigo: '00000002', cor: 'Preto', tamanho: 'M' }];
  const ctx = { vivas, tamanhosValidos: ['P', 'M', 'G'], genero: 'masculino', ehUP: true };
  const nova = (cor: string, tamanho?: string, extra: object = {}) => ({ nome: cor, tamanho, gtin: null, preco: 10, custo: null, estoqueInicial: 1,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: 'u/x', ...extra });
  it('aceita cor nova e tamanho novo', () => {
    expect(validarGrade([nova('Verde', 'P'), nova('Preto', 'G')], ctx)).toEqual([]);
  });
  it('recusa par que já existe e par repetido na submissão', () => {
    expect(validarGrade([nova('Preto', 'M')], ctx)).toHaveLength(1);
    expect(validarGrade([nova('Verde', 'P'), nova('Verde', 'P')], ctx)).toHaveLength(1);
  });
  it('recusa tamanho fora da whitelist, sem tamanho e com código', () => {
    expect(validarGrade([nova('Verde', 'XGG')], ctx)[0]!.mensagem).toMatch(/tamanho/i);
    expect(validarGrade([nova('Verde')], ctx)[0]!.mensagem).toMatch(/tamanho/i);
    expect(validarGrade([nova('Verde', 'P', { codigo: '123' })], ctx)[0]!.mensagem).toMatch(/código/i);
  });
  it('recusa família sem gênero e família não-UP', () => {
    expect(validarGrade([nova('Verde', 'P')], { ...ctx, genero: null })[0]!.mensagem).toMatch(/gênero/i);
    expect(validarGrade([nova('Verde', 'P')], { ...ctx, ehUP: false })[0]!.mensagem).toMatch(/não é suportado/i);
  });
  it('família SEM tamanho: recusa variação com tamanho', () => {
    expect(validarGrade([nova('Verde', 'P', { codigo: '9' })], { ...ctx, vivas: [{ codigo: '1', cor: 'Preto', tamanho: null }] })).toHaveLength(1);
  });
  it('fotoDeCodigo tem que apontar para SKU vivo da MESMA cor', () => {
    expect(validarGrade([nova('Preto', 'G', { imagemPath: undefined, fotoDeCodigo: '00000001' })], ctx)).toEqual([]);
    expect(validarGrade([nova('Verde', 'G', { imagemPath: undefined, fotoDeCodigo: '00000001' })], ctx)).toHaveLength(1);
  });
});

describe('resolverFotoHerdada', () => {
  it('copia imagem_path e ml_picture_id do irmão da mesma cor', () => {
    expect(resolverFotoHerdada('1', 'Preto', [{ codigo: '1', cor: 'Preto', imagem_path: 'o/a.jpg', ml_picture_id: 'PIC' }]))
      .toEqual({ imagemPath: 'o/a.jpg', mlPictureId: 'PIC' });
  });
  it('irmão só com ml_picture_id ainda serve', () => {
    expect(resolverFotoHerdada('1', 'Preto', [{ codigo: '1', cor: 'Preto', imagem_path: null, ml_picture_id: 'PIC' }]))
      .toEqual({ imagemPath: null, mlPictureId: 'PIC' });
  });
  it('cor diferente ou irmão sem foto nenhuma → null', () => {
    expect(resolverFotoHerdada('1', 'Verde', [{ codigo: '1', cor: 'Preto', imagem_path: 'x', ml_picture_id: null }])).toBeNull();
    expect(resolverFotoHerdada('1', 'Preto', [{ codigo: '1', cor: 'Preto', imagem_path: null, ml_picture_id: null }])).toBeNull();
  });
});

describe('montarVariacaoNova — grade', () => {
  it('grava tamanho e a foto resolvida; mantém a paridade de chaves com clonarVariacao', () => {
    const linha = montarVariacaoNova(
      { codigo: '00000009', nome: 'Verde', tamanho: 'P', gtin: null, preco: 10, custo: null, estoqueInicial: 1,
        pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: 'o/a.jpg', mlPictureId: 'PIC' },
      { familiaId: 'f', userId: 'u', orgId: 'o', precoPublicacao: 10 },
    );
    expect(linha.tamanho).toBe('P');
    expect(linha.imagem_path).toBe('o/a.jpg');
    expect(linha.ml_picture_id).toBe('PIC');
  });
});
```
```ts
// codigos.test.ts
it('derivarCodigosSku reserva N SKUs sem PAI', () => {
  expect(derivarCodigosSku(105, 3)).toEqual(['00000103', '00000104', '00000105']);
  expect(() => derivarCodigosSku(5, 0)).toThrow();
});
```
O teste existente de paridade de chaves `clonarVariacao` × `montarVariacaoNova` precisa continuar passando sem alteração.

- [ ] **Step 2: Rodar** — `pnpm test supabase/functions/adicionar-variacoes-familia supabase/functions/_shared/produto` → FAIL.

- [ ] **Step 3: Implementar `codigos.ts`**
```ts
/** Faixa de SKUs sem PAI — "Adicionar variação" em grade (ADR-0166 2026-09-24c): a família já tem
 *  PAI, só as variações novas precisam de código. Mesmo formato e mesmo teto de `derivarCodigos`. */
export function derivarCodigosSku(ultimo: number, qtd: number): string[] {
  if (!Number.isInteger(ultimo) || !Number.isInteger(qtd) || qtd < 1) throw new Error('Faixa de códigos inválida.');
  const primeiro = ultimo - qtd + 1;
  if (primeiro < 1) throw new Error('Faixa de códigos inválida.');
  if (ultimo > CODIGO_MAX) throw new Error(`Sequência de códigos da organização esgotada (limite ${CODIGO_MAX}).`);
  return Array.from({ length: qtd }, (_, i) => String(primeiro + i).padStart(8, '0'));
}
```

- [ ] **Step 4: Implementar `processar.ts`**
  - `VariacaoNovaEntrada` como na seção Interfaces; novo tipo `VariacaoNovaResolvida = Omit<VariacaoNovaEntrada, 'codigo' | 'imagemPath' | 'fotoDeCodigo'> & { codigo: string; imagemPath: string | null; mlPictureId: string | null }`.
  - `validarEntrada`: o bloco de código só valida quando `v.codigo !== undefined` **ou** `v.tamanho` ausente (sem tamanho → obrigatório, como hoje); foto: exatamente um de `imagemPath`/`fotoDeCodigo` (mensagem no campo `imagemPath`: "Envie a foto ou herde a de um SKU da mesma cor."); `imagemPath`, quando presente, mantém a checagem de prefixo `${userId}/` e `..`; `fotoDeCodigo` precisa ser string de 1–8 dígitos. `tamanho`, quando presente, precisa ser string não vazia.
  - `validarGrade` (nova, pura). Regras, na ordem, uma mensagem por variação:
    ```ts
    export function validarGrade(entrada: VariacaoNovaEntrada[], ctx: {
      vivas: Array<{ codigo: string; cor: string | null; tamanho: string | null }>;
      tamanhosValidos: readonly string[]; genero: string | null; ehUP: boolean;
    }): ErroValidacao[] {
      const erros: ErroValidacao[] = [];
      const familiaGrade = familiaTemTamanho(ctx.vivas);
      if (familiaGrade && !ctx.ehUP) {
        return [{ campo: 'familia_id', mensagem: 'Este produto usa tamanho mas não está publicado em User Products — adicionar por aqui não é suportado.' }];
      }
      if (familiaGrade && !ctx.genero) {
        return [{ campo: 'familia_id', mensagem: 'Produto de grade sem gênero cadastrado — o Mercado Livre exige gênero junto com a tabela de medidas.' }];
      }
      const norm = (s: string | null | undefined) => (s ?? '').trim();
      const pares = new Set(ctx.vivas.map((v) => chaveGradeEdge(norm(v.cor), norm(v.tamanho))));
      entrada.forEach((v, i) => {
        const p = `variacoes[${i}]`;
        const tam = norm(v.tamanho);
        if (!familiaGrade) {
          if (tam) erros.push({ campo: `${p}.tamanho`, mensagem: 'Este produto não usa tamanho.' });
          if (v.fotoDeCodigo) erros.push({ campo: `${p}.imagemPath`, mensagem: 'Envie a foto da cor nova.' });
          return;
        }
        if (!tam) { erros.push({ campo: `${p}.tamanho`, mensagem: 'Tamanho é obrigatório neste produto.' }); return; }
        if (v.codigo !== undefined) { erros.push({ campo: `${p}.codigo`, mensagem: 'Em produto de grade o código é gerado pelo sistema.' }); return; }
        if (!ctx.tamanhosValidos.includes(tam)) { erros.push({ campo: `${p}.tamanho`, mensagem: `Tamanho "${tam}" não é válido para esta organização.` }); return; }
        const k = chaveGradeEdge(norm(v.nome), tam);
        if (pares.has(k)) { erros.push({ campo: `${p}.tamanho`, mensagem: `${norm(v.nome)} · ${tam} já existe neste produto.` }); return; }
        pares.add(k);
        if (v.fotoDeCodigo) {
          const irma = ctx.vivas.find((x) => x.codigo === normalizarCodigo8(v.fotoDeCodigo!));
          if (!irma || norm(irma.cor) !== norm(v.nome)) {
            erros.push({ campo: `${p}.imagemPath`, mensagem: 'A foto herdada precisa ser de um SKU da mesma cor.' });
          }
        }
      });
      return erros;
    }
    const chaveGradeEdge = (cor: string, tamanho: string) => `${cor}\u0000${tamanho}`;
    ```
  - `resolverFotoHerdada(fotoDeCodigo, cor, vivas)`: acha a viva com `codigo === normalizarCodigo8(fotoDeCodigo)` e `cor` igual (trim); devolve `{ imagemPath: irma.imagem_path, mlPictureId: irma.ml_picture_id }` se algum dos dois não for nulo; senão `null`.
  - `montarVariacaoNova(v: VariacaoNovaResolvida, ctx)`: `imagem_path: v.imagemPath`, `ml_picture_id: v.mlPictureId`, `tamanho: v.tamanho?.trim() || null` (substitui o `tamanho: null` e seu comentário por: "ADR-0166 2026-09-24c: tamanho do SKU novo de grade; null em produto sem eixo (INV-1). Continua presente sempre — paridade de chaves com clonarVariacao.").
  - Atualizar o comentário de `familiaTemTamanho` (a trava agora é só para família não-UP).

- [ ] **Step 5: Implementar `index.ts`** — ordem das etapas depois de carregar `variacoesVivas`:
  1. Remover o bloco `if (familiaTemTamanho(...)) return 400` (l.133–145).
  2. `ehUP`: `const { count: itensUP } = await admin.from('anuncios_externos_itens').select('sku', { count: 'exact', head: true }).eq('org_id', orgId).in('sku', (variacoesVivas ?? []).map((v) => v.codigo as string));` → `ehUP = (itensUP ?? 0) > 0`. (Só consultado quando a família tem tamanho; fora disso passe `ehUP: false` — `validarGrade` não o lê.)
  3. `tamanhosValidos = tamanhosValidosParaTipos(await tiposProdutoDaOrg(admin, orgId))` (imports de `../_shared/produto/tipos-produto-valores.ts` e `../_shared/produto/tipo-produto.ts` — conferir o nome exato das exportações nesses arquivos, são as mesmas usadas por `cadastrar-produto/processar.ts:8,74` e `cadastrar-produto/index.ts:26`).
  4. `const errosGrade = validarGrade(variacoesEntrada, { vivas, tamanhosValidos, genero: anterior.genero ?? null, ehUP }); if (errosGrade.length) return json({ erros: errosGrade }, 400);`
  5. Teto: `if ((variacoesVivas?.length ?? 0) + variacoesEntrada.length > 60) return json({ error: 'Passaria do limite de 60 variações por produto.' }, 400);`
  6. Códigos: se a família é de grade, reservar `variacoesEntrada.length` com `proximo_codigo_produto` + `derivarCodigosSku`, conferir com `codigosJaUsados` e ressincronizar UMA vez com `p_resync: true` — cópia do bloco de `cadastrar-produto/index.ts:175-200` trocando `derivarCodigos(..., qtd)` por `derivarCodigosSku(..., n)` e sem PAI na conferência. Senão, `codigosNovos` continua vindo de `normalizarCodigo8(v.codigo)` + o `codigosJaUsados` que já existe (409 com `conflitos`).
     Resultado: `const codigosNovos: string[]` alinhado por índice com `variacoesEntrada`. **A reserva acontece depois do bloco de idempotência** (`jaExistente`) — que já está antes, não mover.
  7. Fotos: `const fotos = variacoesEntrada.map((v) => v.fotoDeCodigo ? resolverFotoHerdada(v.fotoDeCodigo, v.nome, vivasComFoto) : { imagemPath: v.imagemPath!, mlPictureId: null });` onde `vivasComFoto` vem do `select('*')` que já existe. Qualquer `null` → 400 `{ erros: [{ campo: 'variacoes[i].imagemPath', mensagem: 'O SKU de origem da foto não tem foto — envie uma.' }] }`.
  8. `montarVariacaoNova({ ...v, codigo: codigosNovos[i], imagemPath: fotos[i].imagemPath, mlPictureId: fotos[i].mlPictureId }, ...)`.
  9. Ledger: o laço usa `codigosNovos[i]` em vez de `normalizarCodigo8(v.codigo)!`.
  10. Resposta: acrescentar `codigos: codigosNovos`; no ramo `jaExistia`, ler `mudanca_estrutural` da família (`select('id, lote_id, status, mudanca_estrutural')`) e devolver `codigos: (mudanca_estrutural?.novas ?? [])`.
  11. `mudanca_estrutural = { novas: codigosNovos, removidas: [] }` (já é assim — só garantir que usa o array novo).

- [ ] **Step 6: Rodar** — `pnpm test supabase/functions/adicionar-variacoes-familia supabase/functions/_shared/produto` → PASS; `pnpm lint:functions && pnpm check:functions` → PASS.

- [ ] **Step 7: Commit** — `feat(addvar): adicionar SKUs a grade publicada (UP) com codigo gerado e foto herdada`

---

### Task 6: `GeradorVariacoes` com eixos fixos e `MatrizGrade` com células travadas (sonnet)

**Files:**
- Modify: `src/components/estoque/gerador-variacoes.tsx`
- Modify: `src/components/estoque/matriz-grade.tsx`
- Test: `src/components/estoque/__tests__/gerador-variacoes*.test.tsx`, `src/components/estoque/__tests__/matriz-grade*.test.tsx` (existentes)

**Interfaces:**
- Produces:
  - `GeradorVariacoes` props novas opcionais: `coresFixas?: ReadonlySet<string>`, `tamanhosFixos?: ReadonlySet<string>` — valor fixo aparece marcado e desabilitado (não dá para desmarcar); cor fixa fora de `CORES_POPULARES` aparece como personalizada sem o botão de remover.
  - `MatrizGrade` prop nova opcional: `bloqueadas?: ReadonlyMap<string /* chaveGrade(cor, tamanho) */, { estoque: number }>`.

- [ ] **Step 1: Testes (falham)**
  - Gerador: com `coresFixas={new Set(['Preto'])}` e `cores` contendo 'Preto', o checkbox `Preto` está `checked` e `disabled`; clicar nele não chama `onMudarCores`. Idem tamanho `M`. Sem as props, comportamento atual (testes antigos passam sem mudança).
  - Matriz: `cores=['Preto','Verde']`, `tamanhos=['P','M']`, `linhas` só com Verde·P e Verde·M, `bloqueadas=new Map([[chaveGrade('Preto','P'),{estoque:12}],[chaveGrade('Preto','M'),{estoque:8}]])`:
    - as células Preto·P/Preto·M mostram `12`/`8`, não têm `<input>` e têm `aria-label` contendo "já publicado";
    - não aparecem com o botão "+" de reinclusão;
    - as células Verde têm input normal;
    - o total por coluna/linha/geral considera só as linhas novas (totais vêm de `resolvidas`, que não contém as travadas).

- [ ] **Step 2: Rodar** — FAIL.

- [ ] **Step 3: Implementar**
  - Gerador: `const fixa = coresFixas?.has(cor) ?? false;` → `<Checkbox checked={cores.has(cor)} disabled={desabilitado || fixa || bloqueada} …>`; `title` "Já publicada neste produto." quando `fixa`. Personalizadas: esconder o botão de remover (`X`) quando fixa. Tamanhos: mesma regra com `tamanhosFixos`.
  - Matriz: no render da célula, **antes** do ramo "sem linha / removida":
    ```tsx
    const trava = bloqueadas?.get(chave);
    if (trava) {
      return (
        <td key={chave} className="bg-muted/50 px-2 text-right tabular-nums text-muted-foreground"
            aria-label={`${cor} · ${tamanho}: já publicado, ${trava.estoque} em estoque`}>
          {modo === 'estoqueInicial' ? trava.estoque : '—'}
        </td>
      );
    }
    ```
    Adaptar ao elemento real que a matriz usa por célula (`td`/`div` — seguir o existente), mantendo `data-r`/`data-c` **fora** da célula travada (a navegação por teclado pula ela; conferir que `focarCelula` num alvo inexistente é no-op, como já documentado).

- [ ] **Step 4: Rodar** — `pnpm test src/components/estoque` → PASS (incluindo os testes antigos de `dialog-cadastro-grade`).

- [ ] **Step 5: Commit** — `feat(grade): eixos fixos no gerador e celulas travadas na matriz`

---

### Task 7: `DialogEstenderGrade` + roteamento de "Adicionar variação" (sonnet)

**Files:**
- Create: `src/lib/estender-grade.ts` (miolo puro)
- Create: `src/lib/__tests__/estender-grade.test.ts`
- Create: `src/components/estoque/dialog-estender-grade.tsx`
- Create: `src/components/estoque/__tests__/dialog-estender-grade.test.tsx`
- Create: `src/components/estoque/dialog-adicionar-variacao-roteador.tsx`
- Modify: `src/pages/Estoque.tsx:265-269` (usar o roteador)
- Test: `src/pages/__tests__/Estoque*.test.tsx` (existente)

**Interfaces:**
- Consumes: Task 5 (contrato do body/resposta), Task 6 (props `coresFixas`/`tamanhosFixos`/`bloqueadas`), Task 2 (`VariacaoComSaldo.tamanho`).
- Produces:
  ```ts
  // src/lib/estender-grade.ts
  export interface SkuExistente { codigo: string; cor: string; tamanho: string; estoque: number; temFoto: boolean }
  export function eixosExistentes(skus: SkuExistente[]): { cores: Set<string>; tamanhos: Set<string> };
  export function bloqueadasDe(skus: SkuExistente[]): Map<string, { estoque: number }>;
  /** SKU vivo da mesma cor cuja foto o SKU novo herda; null = cor nova (ou cor sem nenhuma foto). */
  export function fotoHerdavel(cor: string, skus: SkuExistente[]): string | null; // devolve o código
  export function payloadEstender(resolvidas: LinhaResolvida[], skus: SkuExistente[], imagemPorClientId: Map<string, string>): VariacaoGradePayload[];
  ```
  onde `VariacaoGradePayload` é o `VariacaoNovaEntrada` da Task 5 sem `codigo`.

- [ ] **Step 1: Testes do miolo (falham)**
```ts
import { describe, it, expect } from 'vitest';
import { chaveGrade } from '@/lib/cadastro-grade';
import { eixosExistentes, bloqueadasDe, fotoHerdavel, payloadEstender } from '@/lib/estender-grade';

const skus = [
  { codigo: '00000001', cor: 'Preto', tamanho: 'P', estoque: 12, temFoto: true },
  { codigo: '00000002', cor: 'Preto', tamanho: 'M', estoque: 8, temFoto: true },
  { codigo: '00000003', cor: 'Azul', tamanho: 'P', estoque: 0, temFoto: false },
];

it('eixos e bloqueadas vêm dos SKUs vivos', () => {
  expect([...eixosExistentes(skus).cores]).toEqual(['Preto', 'Azul']);
  expect(bloqueadasDe(skus).get(chaveGrade('Preto', 'M'))).toEqual({ estoque: 8 });
});

it('foto herdável: menor código COM foto da mesma cor; cor sem foto ou nova → null', () => {
  expect(fotoHerdavel('Preto', skus)).toBe('00000001');
  expect(fotoHerdavel('Azul', skus)).toBeNull();
  expect(fotoHerdavel('Verde', skus)).toBeNull();
});

it('payload: herda foto quando a linha não tem foto própria e a cor tem foto; senão usa o upload', () => {
  const base = { preco: '10', custo: '', pesoGramas: '', alturaCm: '', larguraCm: '', comprimentoCm: '', gtin: '', estoqueInicial: '3' };
  const r = payloadEstender([
    { clientId: 'a', cor: 'Preto', tamanho: 'G', foto: null, ...base },
    { clientId: 'b', cor: 'Verde', tamanho: 'P', foto: new File(['x'], 'v.jpg'), ...base },
  ] as never, skus, new Map([['b', 'u1/chave/v.jpg']]));
  expect(r[0]).toMatchObject({ nome: 'Preto', tamanho: 'G', fotoDeCodigo: '00000001', estoqueInicial: 3, preco: 10 });
  expect(r[0]).not.toHaveProperty('imagemPath');
  expect(r[1]).toMatchObject({ nome: 'Verde', tamanho: 'P', imagemPath: 'u1/chave/v.jpg' });
  expect(r[1]).not.toHaveProperty('fotoDeCodigo');
  expect(r.every((v) => !('codigo' in v))).toBe(true);
});
```

- [ ] **Step 2: Rodar** — FAIL.

- [ ] **Step 3: Implementar `estender-grade.ts`** — conversão numérica com `parseNumeroPtBr` (mesma de `cadastro-grade.ts`); `custo`/dimensões vazios → `null`; `gtin` vazio → `null`; linha com `foto` (File) usa `imagemPorClientId.get(clientId)`; linha sem foto usa `fotoHerdavel(cor, skus)` (se `null`, a linha não é válida — o gate do dialog impede salvar, ver Step 5).

- [ ] **Step 4: Testes do dialog (falham)** — com `supabase` mockado como nos testes de `dialog-adicionar-variacao`:
  1. abre com a matriz mostrando Preto·P (12) e Preto·M (8) travadas; checkbox Preto fixo;
  2. marcar tamanho `G` cria células Preto·G e Azul·G editáveis; marcar cor Verde cria Verde·P/M/G;
  3. "Salvar" desabilitado enquanto alguma célula nova tem estoque vazio/0, ou é de cor sem foto herdável (Verde, Azul) sem foto enviada;
  4. salvar chama `functions.invoke('adicionar-variacoes-familia', { body: { familia_id, chave, variacoes } })` com o payload da Task 5 (sem `codigo`), e marca `QK.variacoesRecemAdicionadas(codigoPai)` com `data.codigos`;
  5. erro 400 da edge com `erros` mostra a mensagem no toast (usar `corpoDoErroDaEdge` como o dialog atual);
  6. total existentes + novas > 60 bloqueia com mensagem.

- [ ] **Step 5: Implementar `dialog-estender-grade.tsx`** — composição, sem reinventar peças:
  - Dados: `useQuery` da família canônica —
    ```ts
    supabase.from('familias')
      .select('id, genero, variacoes(codigo, cor, tamanho, estoque, imagem_path, ml_picture_id, peso_gramas, altura_cm, largura_cm, comprimento_cm, custo, preco, excluida_da_publicacao)')
      .eq('codigo_pai', produto.codigoPai).order('criado_em', { ascending: false }).limit(1)
    ```
    (mesma consulta de `fetchFamiliaCanonicaPrefill` em `dialog-adicionar-variacao.tsx` acrescida de `genero`, `cor`, `tamanho`, `estoque`, `imagem_path`, `ml_picture_id`). Estoque exibido nas travadas vem de `fetchVariacoesProduto` (QK `variacoesEstoque`, saldo canônico) casado por código; se não carregou, usar o da consulta.
  - `skus: SkuExistente[]` = variações com `tamanho` não nulo; `temFoto = !!(imagem_path || ml_picture_id)`.
  - Estado: `cores`/`tamanhos` (Set) iniciados com `eixosExistentes(skus)`; `removidas`; `linhas: LinhaGrade[]`; `cabecalho: CamposHerdaveis` pré-preenchido pelo SKU de referência (menor código entre os não `excluida_da_publicacao`, mesma regra de `irmaRef` no dialog atual); `fotoPorCor` (só para cores sem foto herdável); `chave` (UUID, regenerada ao fechar).
  - Reconciliação: sempre que `cores`/`tamanhos`/`removidas` mudam, `reconciliarGrade(eixos.cores, eixos.tamanhos, removidas, [...linhas, ...skus.map(s => ({ cor: s.cor, tamanho: s.tamanho }))])` — as travadas entram como "já existentes", então nunca aparecem em `novas`; aplicar `novas` com `novaLinhaGrade` e `remover` filtrando `linhas` (nunca as travadas, que não estão em `linhas`). Mesmo padrão de `mudarCores`/`mudarTamanhos` de `dialog-cadastro-grade.tsx` (usar `ordenarEixos` com `tamanhos: opcoesDeTamanho(tipos).flatMap(g => g.valores)`).
  - UI, em ordem: cabeçalho com nome do produto e gênero (só leitura); campos herdáveis (copiar o `campoHerdavel` de `dialog-cadastro-grade.tsx:423-455`); `<GeradorVariacoes coresFixas tamanhosFixos … />` com `coresBloqueadas`/`tamanhosBloqueados`/`bloquearNovaCor` calculados com `totalDaGrade` somando `skus.length` ao total (limite 60); "Foto por cor" só para cores da grade **sem** `fotoHerdavel` (texto: "Cores novas precisam de foto. Tamanhos novos de cores já publicadas usam a foto da cor."); `<MatrizGrade bloqueadas={bloqueadasDe(skusComSaldoCanonico)} … />` com os mesmos handlers de `dialog-cadastro-grade.tsx` (`patchLinha`, `patchOverride`, `destravar`, `voltarAHerdar`, `removerLinha`, `reincluirLinha`, `aplicarMassa`); banner de "atualização em andamento" (`familiaEmVoo`, igual ao dialog atual).
  - Gate `podeSalvar`: `linhas.length > 0` && `!emVoo` && toda resolvida com `estoqueInicial` inteiro > 0 && `CAMPOS_NUMERICOS` sem erro (`erroCampo`) && toda linha tem foto própria **ou** `fotoPorCor[cor]` **ou** `fotoHerdavel(cor, skus)`.
  - Salvar: `canWrite()`; `effectiveOrgId()`; para cada linha cuja foto efetiva é um `File` (própria ou `fotoPorCor`), `uploadFile('imagens', buildStoragePath(owner, chave, \`${clientId}-${file.name}\`), file)` (mesmo `owner` do dialog atual via `storageOwnerForUpload`); `payloadEstender(...)`; `supabase.functions.invoke('adicionar-variacoes-familia', …)`; invalidações iguais às do dialog atual (`familiasNaoPublicadas`, `produtosEstoqueResumo`, `variacoesEstoque(codigoPai)`) e `setQueryData(QK.variacoesRecemAdicionadas(codigoPai), r.codigos)`; toasts iguais (sucesso, `publicacaoOk=false`, `falhasEstoque`).
  - Título: "Adicionar à grade"; descrição: "{nome}. Os SKUs novos vão direto para o Mercado Livre, sem passar pela Revisão. Os já publicados não mudam."; `DialogContent className="max-h-[90vh] sm:max-w-5xl overflow-y-auto"` (o `sm:` é obrigatório — ver comentário em `dialog-cadastro-grade.tsx`).

- [ ] **Step 6: Roteador** — `dialog-adicionar-variacao-roteador.tsx`:
```tsx
// ADR-0166 2026-09-24c: "Adicionar variação" em produto de grade abre a extensão da matriz; o
// resto abre o dialog de sempre. Org sem tipo de produto habilitado nem consulta nada (INV-1).
export function DialogAdicionarVariacaoRoteador({ produto, onFechar }: {
  produto: ProdutoEstoqueResumo | null; onFechar: () => void;
}) {
  const { data: tipos } = useTiposProdutoHabilitados();
  const podeTerGrade = (tipos?.length ?? 0) > 0;
  const { data: variacoes, isLoading } = useQuery({
    queryKey: QK.variacoesEstoque(produto?.codigoPai ?? ''),
    queryFn: () => fetchVariacoesProduto(produto!.codigoPai),
    enabled: !!produto && podeTerGrade,
  });
  const ehGrade = podeTerGrade && (variacoes ?? []).some((v) => v.tamanho);
  const aberto = produto != null && (!podeTerGrade || !isLoading);
  return ehGrade
    ? <DialogEstenderGrade produto={produto} aberto={aberto} onFechar={onFechar} />
    : <DialogAdicionarVariacao produto={produto} aberto={aberto} onFechar={onFechar} />;
}
```
  Em `Estoque.tsx`, trocar `<DialogAdicionarVariacao produto=… aberto=… onFechar=… />` por `<DialogAdicionarVariacaoRoteador produto={produtoAddVariacao} onFechar={() => setProdutoAddVariacao(null)} />`.
  Testes do roteador: (a) org sem tipos → abre `DialogAdicionarVariacao` e **não** chama a RPC; (b) org com tipos + produto sem tamanho → `DialogAdicionarVariacao`; (c) org com tipos + produto com tamanho → `DialogEstenderGrade`.

- [ ] **Step 7: Rodar** — `pnpm test src/lib src/components/estoque src/pages` → PASS; `pnpm exec tsc -b --force` → PASS.

- [ ] **Step 8: Commit** — `feat(estoque): adicionar a grade publicada pela matriz (DialogEstenderGrade)`

---

### Task 8: Verificação ponta a ponta (loop principal)

- [ ] **Step 1:** `pnpm preflight` (3–4 min) → verde. Falha fora do diff → provar em `origin/main` antes de chamar de pré-existente.
- [ ] **Step 2 — dry-run no ML (sem criar anúncio):** script em `$CLAUDE_JOB_DIR/tmp/validar-sku-grade.ts` que, para uma família de grade publicada da org piloto (buscar por SQL read-only uma família com `variacoes.tamanho` não nulo e linhas em `anuncios_externos_itens`), monta o payload de um SKU hipotético (cor existente × tamanho ainda não usado) com o mesmo caminho de `criarPlano` (`atributosDeFicha` do GET do irmão + `garantirChart` em modo leitura de cache + `montarPayloadItem`) e envia **só** `POST /items/validate`. Expected: 204/200 sem erros de `fashion_grid`. Nunca `POST /items`.
- [ ] **Step 3 — UI em runtime real (Playwright próprio, conta VALIDATION, skill `playwright-cli`):** dados de grade injetados via `route` no PostgREST (a conta de validação não tem os produtos do Diego — ver memória "Validar UI com dados injetados"); screenshots de: linha expandida com `Preto · M`; Entrada com a opção `código · Preto · M`; Movimentos com rótulo; dialog "Adicionar à grade" com células travadas e novas. Não submeter.
- [ ] **Step 4:** revisão do Codex (modelo mais forte, `--effort high`, `< /dev/null`) sobre o diff completo da branch; tratar achados.

### Task 9: Documentação, deploy e merge (loop principal)

- [ ] **Step 1:** atualizar `docs/project-status.md` e `docs/TASKS.md` (item de grade no Estoque), `docs/reference/edge-functions.md` (contrato novo de `adicionar-variacoes-familia`), obsidian-vault `03-Módulos/Estoque.md`; `pnpm docs:links`.
- [ ] **Step 2:** push da branch → CI verde (`frontend`, `backend-lint`).
- [ ] **Step 3:** `supabase db push` → conferir as duas RPCs com a chave `tamanho` por SQL read-only.
- [ ] **Step 4:** `supabase functions deploy adicionar-variacoes-familia update-familia-ml reconciliar-convergencia-up` + toda função que importa `_shared/user-products/atributos-irmao.ts` ou `atualizar-familia-up.ts` (listar com `grep -rl "atributos-irmao\|atualizar-familia-up" supabase/functions --include=index.ts --include=processar.ts`) → conferir versão ativa de cada uma.
- [ ] **Step 5:** merge fast-forward na `main` (`/usr/bin/git push origin <sha>:main`), apagar a branch, remover a worktree (`rm -rf` + `git worktree prune`).
