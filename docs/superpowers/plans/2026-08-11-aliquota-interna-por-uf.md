# Alíquota interna por UF da empresa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendas entregues na UF da própria empresa usam uma alíquota de imposto configurável (ex.: PE 1%) em vez da alíquota por origem (8% nacional / 16% importado).

**Architecture:** Dois campos novos e nullable em `configuracoes` (`uf_empresa`, `aliquota_interna_pct`), lidos junto com as alíquotas por origem. O `AliquotaResolver` passa a receber a UF do pedido em parâmetro obrigatório e devolve a alíquota interna quando a UF casa. Imposto e markup não são persistidos — mudar o resolver recalcula todo o histórico exibido, sem migração de dados.

**Tech Stack:** React 18 + TypeScript + Vite, TanStack Query, Supabase (Postgres + PostgREST), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-11-aliquota-interna-por-uf-design.md`
**ADR:** `docs/decisions/0112-aliquota-interna-por-uf-da-empresa.md`

## Global Constraints

- Branch de trabalho: `worktree-imposto-uf-interna`. Nunca editar a `main`.
- Migrations só via `supabase migration new` + `supabase db push`, validando com `npm run db:check`. Nunca `apply_migration` nem painel (ADR-0043).
- Parâmetro fiscal nunca defaulta em silêncio: campo ausente/parcial → cai na regra por origem, jamais em um percentual presumido.
- Escopo é apuração pós-venda. **Não tocar** em `supabase/functions/_shared/preco/sugerir.ts`, `src/lib/viabilidade.ts` nem `src/lib/tarifa.ts`.
- TDD: teste falhando antes da implementação, em toda tarefa que tem teste.
- `pnpm lint` e `pnpm test` verdes antes de cada commit.
- UF sempre em maiúsculas, 2 letras, sem prefixo `BR-` — mesmo formato de `ml_vendas.uf`.
- Comentários e mensagens de commit em português, seguindo o estilo do repositório (comentário explica o *porquê*, não o *o quê*).

---

### Task 1: Colunas do parâmetro em `configuracoes`

**Files:**
- Create: `supabase/migrations/<timestamp>_adr112_aliquota_interna_uf.sql` (nome gerado pelo CLI)
- Modify: `src/lib/database.types.ts` (regenerado)

**Interfaces:**
- Consumes: nada.
- Produces: colunas `configuracoes.uf_empresa` (`text null`) e `configuracoes.aliquota_interna_pct` (`numeric null`); tipos regenerados em `database.types.ts` expondo `uf_empresa: string | null` e `aliquota_interna_pct: number | null` em `Row`/`Insert`/`Update`.

- [ ] **Step 1: Criar o arquivo de migration**

```bash
cd .claude/worktrees/imposto-uf-interna
supabase migration new adr112_aliquota_interna_uf
```

Expected: imprime o caminho do arquivo criado em `supabase/migrations/`.

- [ ] **Step 2: Escrever o SQL**

Conteúdo integral do arquivo criado no passo anterior:

```sql
-- ============================================================================
-- ADR-0112 — Alíquota interna por UF da empresa (venda dentro do estado)
-- ============================================================================

-- UF de origem da empresa + alíquota aplicada quando o pedido é entregue nessa UF.
-- Ambas NULLABLE e SEM DEFAULT: null = parâmetro não configurado = regra por origem
-- (ADR-0055) inalterada. Nenhuma org existente muda de comportamento ao aplicar isto.
alter table public.configuracoes
  add column if not exists uf_empresa text,
  add column if not exists aliquota_interna_pct numeric;

-- Trava de meia-configuração: UF sem percentual (ou vice-versa) aplicaria um imposto
-- parcial em silêncio num caminho financeiro. Os dois juntos, ou nenhum.
alter table public.configuracoes
  drop constraint if exists configuracoes_aliquota_interna_coerente;
alter table public.configuracoes
  add constraint configuracoes_aliquota_interna_coerente
  check ((uf_empresa is null) = (aliquota_interna_pct is null));

-- Formato canônico da UF: 2 letras maiúsculas, sem o prefixo "BR-" — o mesmo que
-- extrairGeo grava em ml_vendas.uf, senão a comparação nunca casa.
alter table public.configuracoes
  drop constraint if exists configuracoes_uf_empresa_formato;
alter table public.configuracoes
  add constraint configuracoes_uf_empresa_formato
  check (uf_empresa is null or uf_empresa ~ '^[A-Z]{2}$');

-- Percentual entre 0 e 100, como as demais alíquotas.
alter table public.configuracoes
  drop constraint if exists configuracoes_aliquota_interna_faixa;
alter table public.configuracoes
  add constraint configuracoes_aliquota_interna_faixa
  check (aliquota_interna_pct is null or (aliquota_interna_pct >= 0 and aliquota_interna_pct <= 100));
```

- [ ] **Step 3: Aplicar e validar**

```bash
supabase db push
npm run db:check
```

Expected: `db push` aplica a migration nova; `db:check` termina sem divergência.

- [ ] **Step 4: Regenerar os tipos**

```bash
supabase gen types typescript --linked > src/lib/database.types.ts
git diff --stat src/lib/database.types.ts
```

Expected: o diff contém apenas as linhas de `uf_empresa` e `aliquota_interna_pct` na tabela `configuracoes`. Se vier ruído não relacionado, descartar o arquivo (`git checkout src/lib/database.types.ts`) e adicionar as duas colunas à mão em `Row`, `Insert` e `Update`:

```ts
          aliquota_interna_pct: number | null
          uf_empresa: string | null
```

- [ ] **Step 5: Verificar que nada quebrou**

```bash
pnpm lint && pnpm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations src/lib/database.types.ts
git commit -m "feat(imposto): colunas uf_empresa e aliquota_interna_pct (ADR-0112)"
```

---

### Task 2: Leitura e escrita do parâmetro

**Files:**
- Modify: `src/lib/queries.ts:555-579` (`fetchAliquotas`, `upsertAliquotas`)
- Modify: `src/hooks/useConfiguracoes.ts:38-44` (`useSalvarAliquotas`)
- Create: `src/lib/__tests__/aliquotas-config.test.ts`

**Interfaces:**
- Consumes: colunas da Task 1.
- Produces:
  - `fetchAliquotas(): Promise<{ nacional: number; importado: number; confirmada: boolean; ufEmpresa: string | null; internaPct: number | null }>`
  - `upsertAliquotas(a: { nacional: number; importado: number; ufEmpresa?: string | null; internaPct?: number | null }): Promise<void>`
  - `normalizarAliquotaInterna(uf: string | null | undefined, pct: number | null | undefined): { ufEmpresa: string | null; internaPct: number | null }` — exportada de `src/lib/queries.ts`, lança `Error('alíquota interna exige UF e percentual juntos')` quando só um dos dois vem preenchido.

- [ ] **Step 1: Escrever os testes falhando**

Criar `src/lib/__tests__/aliquotas-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizarAliquotaInterna } from '../queries';

describe('normalizarAliquotaInterna (ADR-0112)', () => {
  it('aceita UF e percentual juntos, normalizando a UF para maiúsculas', () => {
    expect(normalizarAliquotaInterna(' pe ', 1)).toEqual({ ufEmpresa: 'PE', internaPct: 1 });
  });

  it('aceita os dois vazios (parâmetro desligado)', () => {
    expect(normalizarAliquotaInterna(null, null)).toEqual({ ufEmpresa: null, internaPct: null });
    expect(normalizarAliquotaInterna('', null)).toEqual({ ufEmpresa: null, internaPct: null });
  });

  it('recusa UF sem percentual', () => {
    expect(() => normalizarAliquotaInterna('PE', null)).toThrow(/UF e percentual/);
  });

  it('recusa percentual sem UF', () => {
    expect(() => normalizarAliquotaInterna(null, 1)).toThrow(/UF e percentual/);
  });

  it('recusa UF fora do formato de 2 letras', () => {
    expect(() => normalizarAliquotaInterna('PERNAMBUCO', 1)).toThrow(/UF/);
  });

  it('recusa percentual fora da faixa 0–100', () => {
    expect(() => normalizarAliquotaInterna('PE', 101)).toThrow(/percentual/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/lib/__tests__/aliquotas-config.test.ts`
Expected: FAIL — `normalizarAliquotaInterna` não é exportada de `../queries`.

- [ ] **Step 3: Implementar `normalizarAliquotaInterna` em `src/lib/queries.ts`**

Inserir imediatamente antes de `fetchAliquotas` (linha 555):

```ts
/** Normaliza o par (UF da empresa, alíquota interna) do ADR-0112. Os dois preenchidos ou os dois
 *  vazios — meia-configuração aplicaria imposto parcial em silêncio num caminho financeiro. */
export function normalizarAliquotaInterna(
  uf: string | null | undefined, pct: number | null | undefined,
): { ufEmpresa: string | null; internaPct: number | null } {
  const u = (uf ?? '').trim().toUpperCase();
  const temUf = u !== '';
  const temPct = pct != null && Number.isFinite(pct);
  if (!temUf && !temPct) return { ufEmpresa: null, internaPct: null };
  if (temUf !== temPct) throw new Error('alíquota interna exige UF e percentual juntos');
  if (!/^[A-Z]{2}$/.test(u)) throw new Error('UF da empresa deve ter 2 letras (ex.: PE)');
  if (pct! < 0 || pct! > 100) throw new Error('percentual da alíquota interna deve ficar entre 0 e 100');
  return { ufEmpresa: u, internaPct: pct! };
}
```

- [ ] **Step 4: Rodar os testes**

Run: `pnpm test src/lib/__tests__/aliquotas-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Estender `fetchAliquotas`**

Substituir o corpo de `fetchAliquotas` (`src/lib/queries.ts:555-567`) por:

```ts
export async function fetchAliquotas(): Promise<{
  nacional: number; importado: number; confirmada: boolean;
  ufEmpresa: string | null; internaPct: number | null;
}> {
  const orgId = effectiveOrgId();
  if (!orgId) return { nacional: 8, importado: 16, confirmada: false, ufEmpresa: null, internaPct: null };
  const { data } = await supabase.from('configuracoes')
    .select('aliquota_nacional_pct, aliquota_importado_pct, aliquotas_confirmadas_em, uf_empresa, aliquota_interna_pct')
    .eq('org_id', orgId).maybeSingle();
  // ADR-0112: a alíquota interna só existe com os DOIS campos preenchidos — meio parâmetro é
  // tratado como parâmetro ausente (cai na regra por origem), nunca como percentual presumido.
  const ufEmpresa = data?.uf_empresa ?? null;
  const internaPct = data?.aliquota_interna_pct != null ? Number(data.aliquota_interna_pct) : null;
  const internaOk = ufEmpresa != null && internaPct != null;
  return {
    nacional: data?.aliquota_nacional_pct != null ? Number(data.aliquota_nacional_pct) : 8,
    importado: data?.aliquota_importado_pct != null ? Number(data.aliquota_importado_pct) : 16,
    // ADR-0086: só é "confirmada" com a flag setada (salvar em Configurações). Sem ela, o
    // process-familia bloqueia a publicação (LOUD) em vez de usar 8/16 em silêncio.
    confirmada: data?.aliquotas_confirmadas_em != null,
    ufEmpresa: internaOk ? ufEmpresa : null,
    internaPct: internaOk ? internaPct : null,
  };
}
```

- [ ] **Step 6: Estender `upsertAliquotas`**

Substituir `upsertAliquotas` (`src/lib/queries.ts:569-579`) por:

```ts
export async function upsertAliquotas(a: {
  nacional: number; importado: number;
  ufEmpresa?: string | null; internaPct?: number | null;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const orgId = effectiveOrgId();
  if (!user || !orgId) throw new Error('sem sessão');
  // Lança antes de gravar se vier meia-configuração (ADR-0112).
  const interna = normalizarAliquotaInterna(a.ufEmpresa, a.internaPct);
  const agora = new Date().toISOString();
  // Salvar as alíquotas = confirmá-las (ADR-0086): destrava o LOUD do process-familia, que exige
  // confirmação explícita antes de publicar (não precificar com o default 8/16 em silêncio).
  const { error } = await supabase.from('configuracoes')
    .upsert({
      org_id: orgId, user_id: user.id,
      aliquota_nacional_pct: a.nacional, aliquota_importado_pct: a.importado,
      uf_empresa: interna.ufEmpresa, aliquota_interna_pct: interna.internaPct,
      aliquotas_confirmadas_em: agora, atualizado_em: agora,
    }, { onConflict: 'org_id' });
  if (error) throw error;
}
```

- [ ] **Step 7: Ajustar o tipo da mutation**

Em `src/hooks/useConfiguracoes.ts:41`, trocar a assinatura de `mutationFn`:

```ts
    mutationFn: (a: { nacional: number; importado: number; ufEmpresa?: string | null; internaPct?: number | null }) => upsertAliquotas(a),
```

- [ ] **Step 8: Verificar a suíte inteira**

Run: `pnpm lint && pnpm test`
Expected: PASS. Se algum teste construir o retorno de `fetchAliquotas` à mão, acrescentar `ufEmpresa: null, internaPct: null` ao objeto.

- [ ] **Step 9: Commit**

```bash
git add src/lib/queries.ts src/hooks/useConfiguracoes.ts src/lib/__tests__/aliquotas-config.test.ts
git commit -m "feat(imposto): le e grava a aliquota interna por UF (ADR-0112)"
```

---

### Task 3: Resolver de alíquota ciente da UF do pedido

**Files:**
- Modify: `src/lib/resumo-vendas.ts:26` (tipo `AliquotaResolver`), `:108-118` (`impostoDoItem`, `impostoDaVenda`), `:183`
- Modify: `src/lib/custos.ts:133-147` (`montarAliquotaResolver`)
- Modify: `src/lib/pedidos-faturamento.ts:127-145`
- Modify: `src/lib/detalhe-vendas.ts:179`
- Test: `src/lib/__tests__/pedidos-aliquota.test.ts` (existente), `src/lib/__tests__/aliquota-interna-uf.test.ts` (novo)

**Interfaces:**
- Consumes: `fetchAliquotas` da Task 2 (campos `ufEmpresa`, `internaPct`).
- Produces:
  - `export type AliquotaResolver = (item: VendaItem, uf: string | null) => number | null;`
  - `export function impostoDoItem(it: VendaItem, resolver: AliquotaResolver | undefined, uf: string | null): number`
  - `export function montarAliquotaResolver(m: MapasCusto | undefined, aliquotas: { nacional: number; importado: number; ufEmpresa?: string | null; internaPct?: number | null } | null): AliquotaResolver`

- [ ] **Step 1: Escrever o teste falhando do resolver**

Criar `src/lib/__tests__/aliquota-interna-uf.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { montarAliquotaResolver, montarMapasCusto } from '../custos';
import type { VendaItem } from '../faturamento';

const item = (over: Partial<VendaItem>): VendaItem => ({
  id: 'i', ml_item_id: 'MLB1', variation_id: null, titulo: 't', codigo: null, cor: null,
  ean: null, quantity: 1, unit_price: 100, sale_fee: 0, is_publiai: true, ...over,
});

// Catálogo: MLB1 é nacional, MLB2 é importado.
const mapas = montarMapasCusto([
  { custo: 10, peso_gramas: 100, ml_variation_id: null, gtin: null, codigo: null,
    atualizado_em: '2026-08-01T00:00:00Z', familias: { ml_item_id: 'MLB1', origem: 'nacional' } },
  { custo: 10, peso_gramas: 100, ml_variation_id: null, gtin: null, codigo: null,
    atualizado_em: '2026-08-01T00:00:00Z', familias: { ml_item_id: 'MLB2', origem: 'importado' } },
]);

const comInterna = { nacional: 8, importado: 16, ufEmpresa: 'PE', internaPct: 1 };
const semInterna = { nacional: 8, importado: 16, ufEmpresa: null, internaPct: null };

describe('montarAliquotaResolver — alíquota interna por UF (ADR-0112)', () => {
  it('usa a alíquota interna quando o pedido é entregue na UF da empresa', () => {
    expect(montarAliquotaResolver(mapas, comInterna)(item({}), 'PE')).toBe(1);
  });

  it('sobrepõe também a origem importado', () => {
    expect(montarAliquotaResolver(mapas, comInterna)(item({ ml_item_id: 'MLB2' }), 'PE')).toBe(1);
  });

  it('compara a UF sem diferenciar maiúsculas de minúsculas', () => {
    expect(montarAliquotaResolver(mapas, comInterna)(item({}), 'pe')).toBe(1);
  });

  it('mantém a alíquota por origem em pedido de outra UF', () => {
    const r = montarAliquotaResolver(mapas, comInterna);
    expect(r(item({}), 'SP')).toBe(8);
    expect(r(item({ ml_item_id: 'MLB2' }), 'SP')).toBe(16);
  });

  it('mantém a alíquota por origem quando o pedido não tem UF', () => {
    expect(montarAliquotaResolver(mapas, comInterna)(item({}), null)).toBe(8);
  });

  it('mantém a alíquota por origem quando o parâmetro não está configurado', () => {
    expect(montarAliquotaResolver(mapas, semInterna)(item({}), 'PE')).toBe(8);
  });

  it('não inventa alíquota para item sem origem no catálogo', () => {
    expect(montarAliquotaResolver(mapas, comInterna)(item({ ml_item_id: 'MLB9' }), 'SP')).toBeNull();
  });

  it('não aplica imposto quando a configuração ainda não carregou', () => {
    expect(montarAliquotaResolver(mapas, null)(item({}), 'PE')).toBeNull();
  });
});
```

**Nota sobre o último caso:** a alíquota interna é decidida antes da origem, então um item sem família casada entregue em PE devolve `1` (o parâmetro não depende da origem). O `null` só aparece quando não há alíquota interna aplicável **e** a origem não foi resolvida — por isso o teste usa `'SP'` ali.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/lib/__tests__/aliquota-interna-uf.test.ts`
Expected: FAIL — o resolver ignora o segundo argumento e devolve 8 no primeiro teste.

- [ ] **Step 3: Mudar o tipo e o resolver**

Em `src/lib/resumo-vendas.ts:25-26`:

```ts
/** Resolve a alíquota de imposto (%) de um item vendido, ou null se não mapeada. Recebe a UF de
 *  entrega do pedido (ADR-0112) — parâmetro obrigatório de propósito: opcional, um call site
 *  esquecido devolveria a alíquota por origem, um número plausível e errado num caminho financeiro. */
export type AliquotaResolver = (item: VendaItem, uf: string | null) => number | null;
```

Em `src/lib/custos.ts`, substituir `montarAliquotaResolver` (linhas 133-147):

```ts
/** Resolver de alíquota de imposto (%) p/ o markup. Ordem: alíquota interna por UF (ADR-0112) →
 *  origem da família (ADR-0055). null = origem não mapeada (item sem família casada), OU alíquota
 *  ainda não resolvida (config não carregou) → sem imposto em vez de um número possivelmente errado
 *  (imposto nunca defaulta em silêncio). */
export function montarAliquotaResolver(
  m: MapasCusto | undefined,
  aliquotas: { nacional: number; importado: number; ufEmpresa?: string | null; internaPct?: number | null } | null,
): AliquotaResolver {
  return (item, uf) => {
    if (!aliquotas) return null;
    // Venda dentro do estado da empresa: a alíquota interna sobrepõe nacional E importado.
    const ufEmpresa = aliquotas.ufEmpresa ?? null;
    const internaPct = aliquotas.internaPct ?? null;
    if (ufEmpresa != null && internaPct != null && uf != null
        && uf.trim().toUpperCase() === ufEmpresa.trim().toUpperCase()) {
      return internaPct;
    }
    const origem = resolverProduto(m, item)?.origem;
    if (origem === 'importado') return aliquotas.importado;
    if (origem === 'nacional') return aliquotas.nacional;
    return null;
  };
}
```

- [ ] **Step 4: Rodar o teste novo**

Run: `pnpm test src/lib/__tests__/aliquota-interna-uf.test.ts`
Expected: PASS.

- [ ] **Step 5: Propagar a UF em `resumo-vendas.ts`**

Substituir `impostoDoItem` e `impostoDaVenda` (linhas 107-118):

```ts
/** Imposto (R$) de um item (ADR-0055/0112): valor de venda (unit × qtd) × alíquota/100, onde a
 *  alíquota depende da origem e da UF de entrega do pedido. 0 sem alíquota. */
export function impostoDoItem(it: VendaItem, resolver: AliquotaResolver | undefined, uf: string | null): number {
  const pct = resolver?.(it, uf) ?? null;
  return pct != null && pct > 0 ? round2((it.unit_price * it.quantity * pct) / 100) : 0;
}

/** Imposto total (R$) de uma venda: soma do imposto dos itens. */
function impostoDaVenda(v: Venda, resolver?: AliquotaResolver): number {
  let total = 0;
  for (const it of v.itens) total += impostoDoItem(it, resolver, v.uf);
  return round2(total);
}
```

- [ ] **Step 6: Propagar a UF em `pedidos-faturamento.ts`**

Na linha 127, incluir a UF da venda no achatamento dos itens:

```ts
    const itensFlat = membros.flatMap((v) => {
      const faturavel = ehFaturavel(v.status);
      // A UF vem da venda, não do pedido: um pack pode agrupar order_ids, e o imposto é resolvido
      // por venda (ADR-0112).
      return v.itens.map((it) => ({ it, faturavel, uf: v.uf }));
    });
```

Na linha 141, desestruturar e repassar:

```ts
    const itens: ItemPedido[] = itensFlat.map(({ it, faturavel, uf }) => {
      const custo = custoDoItem(it, custoResolver);
      if (faturavel && custo != null) { custoTotal += custo; temCusto = true; }
      const imposto = faturavel ? impostoDoItem(it, aliquotaResolver, uf) : 0;
      const aliquotaPct = imposto > 0 ? aliquotaResolver?.(it, uf) ?? null : null;
```

O restante do `map` fica inalterado.

- [ ] **Step 7: Propagar a UF em `detalhe-vendas.ts`**

Na linha 179 (dentro do `for (const it of v.itens)`, com `v` em escopo):

```ts
      g.imposto += impostoDoItem(it, aliquotaResolver, v.uf);
```

- [ ] **Step 8: Atualizar o teste existente do resolver**

Em `src/lib/__tests__/pedidos-aliquota.test.ts`, o resolver de teste (linha 22) passa a receber a UF, e entra um caso da alíquota interna. Substituir a linha 22 por:

```ts
// Nacional 8% / importado 16% (ADR-0055), com 1% dentro de PE (ADR-0112). Y é importado.
const aliquotas: AliquotaResolver = (it, uf) =>
  (uf?.toUpperCase() === 'PE' ? 1 : it.ml_item_id === 'Y' ? 16 : 8);
```

E acrescentar, antes do fechamento do `describe`:

```ts
  it('usa a alíquota interna no pedido entregue na UF da empresa', () => {
    // 44,55 × 1% = 0,4455 → 0,45 (em vez de 3,56 pela origem nacional).
    const [p] = agruparPorPedido(
      [venda({ uf: 'PE', itens: [item({})] })], undefined, undefined, undefined, aliquotas,
    );
    expect(p.itens[0].imposto).toBe(0.45);
    expect(p.itens[0].aliquotaPct).toBe(1);
  });
```

- [ ] **Step 9: Rodar a suíte inteira e corrigir os call sites restantes**

Run: `pnpm test`
Expected: os testes que chamam `impostoDoItem` ou constroem um `AliquotaResolver` com um argumento falham a compilação. Corrigir cada um passando a UF (`null` onde o caso não é sobre UF). Nenhum hook, página ou componente precisa mudar — todos passam o objeto inteiro de `useAliquotas()` para `montarAliquotaResolver`.

- [ ] **Step 10: Verificar lint e suíte**

Run: `pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib
git commit -m "feat(imposto): aliquota interna sobrepoe a origem na UF da empresa (ADR-0112)"
```

---

### Task 4: Campos em Configurações + documentação

**Files:**
- Modify: `src/pages/Configuracoes.tsx` (imports/estado no topo; card "Imposto por origem", linhas 275-350)
- Modify: `docs/reference/modelo-de-dados.md`, `docs/TASKS.md`, `obsidian-vault/04-Decisões/Índice de ADRs.md`

**Interfaces:**
- Consumes: `useAliquotas()` (campos `ufEmpresa`, `internaPct`) e `useSalvarAliquotas()` da Task 2.
- Produces: nada consumido por outras tarefas.

- [ ] **Step 1: Estado dos campos novos**

Em `src/pages/Configuracoes.tsx`, logo após a linha 56 (`const [importadoInput, setImportadoInput] = useState('16');`):

```ts
  const [ufEmpresaInput, setUfEmpresaInput] = useState('');
  const [internaInput, setInternaInput] = useState('');
  const [erroInterna, setErroInterna] = useState<string | null>(null);
```

E no `useEffect` das linhas 58-63, sincronizar os dois campos novos:

```ts
  useEffect(() => {
    if (aliquotas != null) {
      setNacionalInput(String(aliquotas.nacional));
      setImportadoInput(String(aliquotas.importado));
      setUfEmpresaInput(aliquotas.ufEmpresa ?? '');
      setInternaInput(aliquotas.internaPct != null ? String(aliquotas.internaPct) : '');
    }
  }, [aliquotas]);
```

- [ ] **Step 2: Handler de gravação com a trava de meia-configuração**

Logo após `pctValido` (linha 72):

```ts
  // ADR-0112: UF e percentual andam juntos. Meia-configuração não salva e mostra o motivo —
  // gravar só um dos dois aplicaria imposto parcial em silêncio.
  const salvarInterna = (uf: string, pctRaw: string) => {
    const u = uf.trim().toUpperCase();
    const p = pctRaw.trim() === '' ? null : pctValido(pctRaw);
    if (u === '' && p === null) { setErroInterna(null); }
    else if (u === '' || p === null) {
      setErroInterna('Preencha a UF e o percentual — ou deixe os dois em branco.');
      return;
    } else if (!/^[A-Z]{2}$/.test(u)) {
      setErroInterna('UF inválida (use a sigla de 2 letras, ex.: PE).');
      return;
    } else setErroInterna(null);
    salvarAliquotas.mutate({
      nacional: pctValido(nacionalInput) ?? aliquotas?.nacional ?? 8,
      importado: pctValido(importadoInput) ?? aliquotas?.importado ?? 16,
      ufEmpresa: u === '' ? null : u,
      internaPct: u === '' ? null : p,
    });
  };
```

- [ ] **Step 3: Preservar o parâmetro ao salvar as alíquotas por origem**

As três chamadas existentes a `salvarAliquotas.mutate({ nacional, importado })` (linhas ~292, ~320, ~340) sobrescreveriam o parâmetro com `undefined` → `null`, apagando a configuração ao editar 8%/16%. Acrescentar os dois campos em cada uma:

```ts
                    ufEmpresa: aliquotas?.ufEmpresa ?? null,
                    internaPct: aliquotas?.internaPct ?? null,
```

(No botão "Confirmar alíquotas" e nos dois `onBlur` de Nacional/Importado.)

- [ ] **Step 4: Bloco de UI no card do imposto**

Dentro do `<Card>` "Imposto por origem", logo depois do `</div>` que fecha a linha de campos (linha ~349) e antes de `</Card>`:

```tsx
          <div className="mt-4 border-t pt-3">
            <h3 className="text-sm font-medium">Venda dentro do estado</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Pedidos entregues nesta UF usam esta alíquota, no lugar de nacional/importado.
              Em branco, vale sempre a alíquota por origem.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm">UF da empresa</span>
                <Input
                  className="h-8 w-20 text-sm uppercase"
                  maxLength={2}
                  placeholder="PE"
                  value={ufEmpresaInput}
                  disabled={!isAdmin}
                  onChange={(e) => setUfEmpresaInput(e.target.value.toUpperCase())}
                  onBlur={() => salvarInterna(ufEmpresaInput, internaInput)}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">Alíquota</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  className="h-8 w-20 text-sm"
                  value={internaInput}
                  disabled={!isAdmin}
                  onChange={(e) => setInternaInput(e.target.value)}
                  onBlur={() => salvarInterna(ufEmpresaInput, internaInput)}
                />
                <span className="text-sm">%</span>
              </div>
              {salvarAliquotas.isSuccess && !salvarAliquotas.isPending && !erroInterna && (
                <span className="text-xs text-success">✓ Salvo</span>
              )}
            </div>
            {erroInterna && <p className="mt-2 text-xs text-destructive">{erroInterna}</p>}
          </div>
```

- [ ] **Step 5: Verificar build, lint e testes**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: PASS nos três.

- [ ] **Step 6: Conferir na aplicação rodando**

```bash
pnpm dev
```

Verificar em `/configuracoes`, logado como admin:
1. UF `PE` + alíquota `1` → salva, "✓ Salvo", persiste após recarregar.
2. Apagar só o percentual e sair do campo → mensagem de erro, não salva.
3. Apagar os dois → salva como desligado, telas voltam a 8%/16%.
4. Editar a alíquota Nacional depois de configurar PE → o parâmetro de PE continua lá.
5. Em Faturamento, um pedido com entrega em PE mostra alíquota 1% e markup maior.

- [ ] **Step 7: Atualizar a documentação**

- `docs/reference/modelo-de-dados.md`: na tabela `configuracoes`, acrescentar `uf_empresa` (UF de origem da empresa, ADR-0112) e `aliquota_interna_pct` (alíquota das vendas entregues nessa UF).
- `obsidian-vault/04-Decisões/Índice de ADRs.md`: entrada para o ADR-0112, no mesmo formato das vizinhas.
- `docs/TASKS.md`: registrar a entrega, no formato das entradas existentes.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Configuracoes.tsx docs obsidian-vault
git commit -m "feat(config): campos de UF da empresa e aliquota interna (ADR-0112)"
```

---

## Verificação final

- [ ] `pnpm lint && pnpm test && pnpm build` verdes
- [ ] `npm run db:check` sem divergência
- [ ] Roteiro do Step 6 da Task 4 executado na aplicação rodando
- [ ] `git log --oneline` mostra os 4 commits + o commit do ADR/spec
