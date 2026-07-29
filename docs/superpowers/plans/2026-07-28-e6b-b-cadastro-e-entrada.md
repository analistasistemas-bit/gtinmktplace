# E6b Bloco B — Cadastro manual de produto + Entrada de mercadoria — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma organização sem ERP consegue cadastrar produto direto na UI (família multi-variação, com fotos), dar entrada de mercadoria e publicar pelo fluxo de Revisão que já existe — sem nunca tocar numa planilha.

**Architecture:** "Sessão de cadastro = um lote" (D-1). O cadastro grava um `lote` normal com `origem='manual'` e cai na **mesma tela de Revisão de sempre**, então `process-familia`, `publish-familia-ml`, `update-familia-ml`, split, user products e realtime funcionam sem uma linha de mudança. O módulo é opt-in por org via `organizations.modulos_habilitados`, com gate no menu **e** na edge.

**Tech Stack:** React + TypeScript + TanStack Query, Supabase (Postgres, Edge Functions Deno, Storage), vitest.

**Spec:** `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md` (decisões D-1, D-1.1, D-2, D-3, D-4, D-9, D-13, D-14).

**Depende do Bloco A:** `docs/superpowers/plans/2026-07-28-e6b-a-estoque.md`. Este plano consome a RPC `registrar_entrada` e a tabela `estoque_movimentos` criadas lá. **Não comece este plano antes da Task 3 do Bloco A estar aplicada.**

## Global Constraints

- **ADR-0043:** schema só via `supabase migration new` + `supabase db push` + `npm run db:check`.
- **Escrita de estoque só por `service_role`** (D-15): a tela nunca chama `registrar_entrada` direto; sempre via edge.
- **Gate do módulo em dois níveis** (D-13): esconder o menu é navegação (ADR-0047), **não** é fronteira de segurança. As edges `cadastrar-produto` e `entrada-estoque` recusam org sem o módulo, com 403.
- **Nada do caminho de planilha pode mudar.** Org que usa planilha tem que continuar funcionando byte-a-byte. Isso é critério de saída, não intenção.
- **Custo é caminho financeiro** (ADR-0055): valor inválido falha LOUD, nunca vira default silencioso.
- **Baseline em todo checkpoint:** `pnpm test` + `npx tsc --noEmit` + `pnpm lint` + `pnpm build` + `deno check` nas funções tocadas.
- **TDD obrigatório** em toda função pura.
- **PONTOS DE DEPLOY só com OK explícito do Diego.**
- **Nomes fixos deste plano:** coluna `lotes.origem`; coluna `organizations.modulos_habilitados`; módulo `'estoque'`; action `set_modulos_org`; edges `cadastrar-produto` e `entrada-estoque`; registry `src/lib/modulos.ts`; hook `useModulosHabilitados`; chave de menu `'estoque'`; funções puras `validarProdutoNovo` e `montarLinhasProduto`.

## File Structure

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_e6b_origem_lote_e_modulos.sql` | `lotes.origem` + `organizations.modulos_habilitados` + RPC de leitura |
| `src/lib/modulos.ts` | Registry dos módulos (id, nome, descrição) — espelha `src/lib/canais.ts` |
| `src/hooks/useModulosHabilitados.ts` | Hook que lê os módulos da org |
| `supabase/functions/_shared/produto/validar.ts` | `validarProdutoNovo` (pura) + `montarLinhasProduto` (pura) |
| `supabase/functions/_shared/produto/__tests__/validar.test.ts` | Testes das duas funções puras |
| `supabase/functions/_shared/produto/modulo.ts` | `exigirModulo(admin, orgId, modulo)` — gate compartilhado pelas duas edges |
| `supabase/functions/cadastrar-produto/index.ts` | Cria/reusa lote manual, insere família + variações, enfileira IA |
| `supabase/functions/entrada-estoque/index.ts` | Chama `registrar_entrada` + enfileira push |
| `src/pages/Estoque.tsx` | Lista de produtos com saldo, entrada, histórico |
| `src/components/estoque/dialog-cadastro-produto.tsx` | Formulário PAI + tabela de variações + fotos |
| `src/components/estoque/dialog-entrada.tsx` | Entrada de mercadoria |

**Modificar:**

| Arquivo | Mudança |
|---|---|
| `src/lib/menus.ts` | `+'estoque'` em `MENU_KEYS` e em `PREFIX` |
| `supabase/functions/usuarios/index.ts` | `+'estoque'` no espelho `MENU_KEYS`; `+action set_modulos_org` |
| `src/App.tsx` | Rota `/estoque` |
| `src/pages/Organizacoes.tsx` | Checkbox de módulos por org |
| `src/lib/queries.ts` | `fetchProdutosComSaldo`, `cadastrarProduto`, `registrarEntrada` |
| `supabase/config.toml` | 2 entradas `verify_jwt = true` (edges chamadas pelo app com JWT do usuário) |

---

### Task 0: Corrigir `talvezFinalizarLote` — lote com família pendente não pode virar `concluido`

**Files:**
- Create: `supabase/functions/_shared/lote/finalizar.ts`
- Test: `supabase/functions/_shared/lote/__tests__/finalizar.test.ts`
- Modify: `supabase/functions/publish-familia-ml/processar.ts:44-51`
- Modify: `supabase/functions/update-familia-ml/processar.ts:41-48`
- Modify: `supabase/functions/publicar-split-ml/index.ts:35-42`

**São TRÊS cópias, não duas** (verificado):

```
publish-familia-ml/processar.ts:44   export async function talvezFinalizarLote(...)
update-familia-ml/processar.ts:41    export async function talvezFinalizarLote(...)
publicar-split-ml/index.ts:35        async function talvezFinalizarLote(...)   ← privada, caminho de split
```

Corrigir só a primeira deixaria duas com a semântica antiga — inclusive a do split, que é caminho de planilha. Por isso a task **extrai uma função compartilhada** e migra os três call sites.

**Por que esta task existe (achado da revisão adversarial):** `talvezFinalizarLote`
(`publish-familia-ml/processar.ts:44-52`) olha só famílias em `publicando` e `pronto` — **ignora
`pendente` e `processando`**. Cenário real com D-1.1: o operador cadastra o produto A e publica;
enquanto isso cadastra o produto B (família `pendente`, IA rodando). O worker de A termina → não
há `publicando`, não há `pronto` → o lote vira `concluido`. Quando B fica `pronto`, o trigger de
transição (`20260609132501_lote_transicao_revisao.sql:40-46`) só promove lote em `'processando'`
→ **o lote fica `concluido` com família publicável dentro**, some da query de reuso e o próximo
cadastro abre um lote novo.

**Isto é um defeito pré-existente, não criado pelo E6b:** um lote de planilha com IA ainda rodando
em algumas famílias, enquanto o operador publica as prontas, cai exatamente no mesmo buraco. Por
isso a correção é na função compartilhada — um guard, não um `if` no caminho novo.

**Interfaces:**
- Consumes: nada.
- Produces: `talvezFinalizarLote` com semântica corrigida, consumida pela Task 5.

- [ ] **Step 1: Ler o código atual e caracterizar**

```bash
rtk proxy sed -n '40,55p' supabase/functions/publish-familia-ml/processar.ts
rtk proxy sed -n '35,50p' supabase/migrations/20260609132501_lote_transicao_revisao.sql
rtk proxy grep -rn "talvezFinalizarLote\|finalizarLote" supabase/functions/ --include=*.ts | rtk proxy grep -v __tests__
```

Anote **todos** os call sites. A mudança tem que valer para os dois workers de publicação.

- [ ] **Step 2: Escrever o teste RED**

Extraia a decisão para uma função pura no mesmo arquivo e teste-a:

```ts
import { describe, it, expect } from 'vitest';
import { decidirStatusLote } from '../processar';

describe('decidirStatusLote', () => {
  it('há família publicando → não mexe', () => {
    expect(decidirStatusLote({ publicando: 1, pronto: 0, emPreparo: 0 })).toBeNull();
  });
  it('há família pronta → revisao', () => {
    expect(decidirStatusLote({ publicando: 0, pronto: 2, emPreparo: 0 })).toBe('revisao');
  });
  it('nada pronto mas há família pendente/processando → processando, NÃO concluido', () => {
    expect(decidirStatusLote({ publicando: 0, pronto: 0, emPreparo: 1 })).toBe('processando');
  });
  it('pronto E pendente ao mesmo tempo → revisao (há o que revisar agora)', () => {
    expect(decidirStatusLote({ publicando: 0, pronto: 1, emPreparo: 1 })).toBe('revisao');
  });
  it('nada em curso → concluido', () => {
    expect(decidirStatusLote({ publicando: 0, pronto: 0, emPreparo: 0 })).toBe('concluido');
  });
});
```

- [ ] **Step 3: Rodar e verificar que FALHA**

```bash
pnpm test supabase/functions/publish-familia-ml/__tests__/finalizar-lote.test.ts
```

Expected: **FAIL** — `decidirStatusLote` não existe.

- [ ] **Step 4: Implementar no módulo compartilhado**

Crie `supabase/functions/_shared/lote/finalizar.ts` (o diretório já existe — `recontar.ts` mora nele):

```ts
/** Contagem de famílias do lote por situação relevante. */
export interface ContagemLote { publicando: number; pronto: number; emPreparo: number }

/**
 * Status que o lote deve assumir, ou null para "não mexer".
 * `emPreparo` = famílias em 'pendente' ou 'processando' (IA ainda rodando).
 * Sem contá-las, um lote que ainda tem trabalho a fazer era marcado 'concluido'
 * e o trigger de transição (que só promove de 'processando') nunca o resgatava.
 */
export function decidirStatusLote(c: ContagemLote): 'revisao' | 'processando' | 'concluido' | null {
  if (c.publicando > 0) return null;
  if (c.pronto > 0) return 'revisao';
  if (c.emPreparo > 0) return 'processando';
  return 'concluido';
}

export async function talvezFinalizarLote(admin: SupabaseClient, loteId: string): Promise<void> {
  const { data: familias } = await admin.from('familias')
    .select('status').eq('lote_id', loteId);
  const c: ContagemLote = { publicando: 0, pronto: 0, emPreparo: 0 };
  for (const f of familias ?? []) {
    if (f.status === 'publicando') c.publicando++;
    else if (f.status === 'pronto') c.pronto++;
    else if (f.status === 'pendente' || f.status === 'processando') c.emPreparo++;
  }
  const novo = decidirStatusLote(c);
  if (novo === null) return;
  await admin.from('lotes').update({ status: novo }).eq('id', loteId);
}
```

Nota: a versão antiga fazia **duas** queries (uma por status); esta faz uma só e conta em memória. Comportamento equivalente nos casos que já existiam, mais o caso novo.

- [ ] **Step 5: Rodar e verificar que PASSA**

```bash
pnpm test supabase/functions/_shared/lote/__tests__/finalizar.test.ts
```

Expected: **PASS**, 5 testes.

- [ ] **Step 6: Migrar os TRÊS call sites**

Em cada um dos três arquivos, apague a cópia local de `talvezFinalizarLote` e importe a compartilhada:

```ts
import { talvezFinalizarLote } from '../_shared/lote/finalizar.ts';
```

- `publish-familia-ml/processar.ts` — a função é **exportada**; verifique quem a importa antes de remover o export (`rtk proxy grep -rn "from './processar'" supabase/functions/publish-familia-ml/`), e re-exporte se algum teste depender dela.
- `update-familia-ml/processar.ts` — mesma checagem.
- `publicar-split-ml/index.ts` — a cópia é **privada**, dois call sites (linhas ~468 e ~486). Só trocar o import.

```bash
# Depois da migração, não pode sobrar nenhuma definição local:
rtk proxy grep -rn "function talvezFinalizarLote" supabase/functions/ --include=*.ts
# Expected: só supabase/functions/_shared/lote/finalizar.ts
```

- [ ] **Step 7: Rodar a suite inteira**

```bash
pnpm test 2>&1 | tail -5
```

Expected: **nenhum teste existente quebrado**. Se algum teste de publicação afirmava que o lote vira `concluido` com família pendente, ele estava caracterizando o bug — corrija o teste e registre isso no commit.

- [ ] **Step 8: Baseline + commit**

```bash
pnpm test && npx tsc --noEmit && pnpm lint
deno check supabase/functions/publish-familia-ml/processar.ts supabase/functions/update-familia-ml/processar.ts supabase/functions/publicar-split-ml/index.ts
git add supabase/functions/_shared/lote/ supabase/functions/publish-familia-ml/ supabase/functions/update-familia-ml/ supabase/functions/publicar-split-ml/
git commit -m "fix(lote): nao concluir lote com familia pendente + unificar as 3 copias de talvezFinalizarLote"
```

**Deploy:** esta task toca três workers de publicação. Eles entram no blast radius do deploy da Task 9 — recalcule com `deno info` e redeploy os três.

---

### Task 1: Migration — `lotes.origem` + `organizations.modulos_habilitados`

**Files:**
- Create: `supabase/migrations/<timestamp>_e6b_origem_lote_e_modulos.sql`

**Interfaces:**
- Produces, consumido pelas Tasks 2, 3, 5, 6:
  - coluna `public.lotes.origem text not null default 'planilha'`
  - coluna `public.organizations.modulos_habilitados text[] not null default '{}'`
  - `public.modulos_habilitados_da_org() returns text[]`

- [ ] **Step 1: Criar a migration**

```bash
supabase migration new e6b_origem_lote_e_modulos
```

- [ ] **Step 2: Escrever o DDL**

```sql
-- E6b (ADR-0054, D-2): distinguir lote de planilha de lote de cadastro manual.
-- O default 'planilha' backfilla TODO lote histórico como planilha — correto e
-- intencional: até esta migration, planilha era a única origem possível.
alter table public.lotes
  add column origem text not null default 'planilha'
  check (origem in ('planilha', 'manual'));

-- Índice do lote manual ABERTO da org (D-1.1): o cadastro reusa em vez de criar um por produto.
create index lotes_org_manual_aberto_idx
  on public.lotes (org_id, criado_em desc)
  where origem = 'manual' and status in ('importando', 'processando', 'revisao');

-- E6b (ADR-0054, D-13): módulos pagos habilitados por org pelo super-admin.
-- Default '{}' = nenhum módulo; habilitar é sempre ato explícito.
alter table public.organizations
  add column modulos_habilitados text[] not null default '{}';

-- Leitura pelo app: espelha canais_habilitados_da_org().
create or replace function public.modulos_habilitados_da_org()
returns text[] language sql security definer stable set search_path = ''
as $$
  select coalesce(o.modulos_habilitados, '{}')
  from public.organizations o
  where o.id = (select public.current_org_id());
$$;

revoke execute on function public.modulos_habilitados_da_org() from public, anon;
grant execute on function public.modulos_habilitados_da_org() to authenticated;
```

- [ ] **Step 3: Aplicar e validar**

```bash
supabase db push
npm run db:check
```

Expected: OK. Confirme com uma query que **todo** lote existente ficou com `origem = 'planilha'`:

```sql
select origem, count(*) from public.lotes group by origem;
-- Expected: só a linha 'planilha', com o total de lotes que existia antes.
```

- [ ] **Step 4: Confirmar que a RPC respeita o tenant**

Logado como usuário da org A, `select public.modulos_habilitados_da_org();` deve devolver os módulos da org A. Não existe caminho para ler os de outra org — a função não aceita parâmetro de propósito.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(e6b): lotes.origem + organizations.modulos_habilitados"
```

---

### Task 2: Registry de módulos + gate no frontend

**Files:**
- Create: `src/lib/modulos.ts`
- Create: `src/hooks/useModulosHabilitados.ts`
- Modify: `src/lib/menus.ts`
- Modify: `supabase/functions/usuarios/index.ts` (só o espelho `MENU_KEYS`)
- Test: `src/lib/__tests__/modulos.test.ts`

**Interfaces:**
- Consumes: `modulos_habilitados_da_org()` (Task 1).
- Produces, consumido pelas Tasks 3 e 6:

```ts
export type ModuloId = 'estoque';
export interface Modulo { id: ModuloId; nome: string; descricao: string; menu: MenuKey }
export const MODULOS: Modulo[]
export function menusDeModulosDesabilitados(habilitados: string[]): MenuKey[]
export function useModulosHabilitados(): { data: string[] | undefined; isLoading: boolean }
```

- [ ] **Step 1: Escrever o teste RED**

Crie `src/lib/__tests__/modulos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MODULOS, menusDeModulosDesabilitados } from '../modulos';

describe('MODULOS', () => {
  it('todo módulo aponta para uma chave de menu', () => {
    for (const m of MODULOS) {
      expect(typeof m.menu).toBe('string');
      expect(m.menu.length).toBeGreaterThan(0);
    }
  });
  it('ids são únicos', () => {
    expect(new Set(MODULOS.map((m) => m.id)).size).toBe(MODULOS.length);
  });
});

describe('menusDeModulosDesabilitados', () => {
  it('org sem nenhum módulo esconde o menu de todos eles', () => {
    expect(menusDeModulosDesabilitados([])).toEqual(MODULOS.map((m) => m.menu));
  });
  it('org com o módulo estoque não esconde o menu estoque', () => {
    expect(menusDeModulosDesabilitados(['estoque'])).not.toContain('estoque');
  });
  it('módulo desconhecido no banco é ignorado sem quebrar', () => {
    expect(() => menusDeModulosDesabilitados(['modulo_que_nao_existe'])).not.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e verificar que FALHA**

```bash
pnpm test src/lib/__tests__/modulos.test.ts
```

Expected: **FAIL** — módulo `../modulos` não existe.

- [ ] **Step 3: Implementar `src/lib/modulos.ts`**

```ts
// E6b (ADR-0054, D-13): módulos pagos opcionais, habilitados por org pelo super-admin.
// Espelha o padrão de src/lib/canais.ts. Manter em sincronia com o MODULOS_VALIDOS
// da edge `usuarios` (não há geração automática — é uma lista curta e estável).
import type { MenuKey } from './menus';

export type ModuloId = 'estoque';

export interface Modulo {
  id: ModuloId;
  nome: string;
  descricao: string;
  /** Menu que só aparece com o módulo habilitado. */
  menu: MenuKey;
}

export const MODULOS: Modulo[] = [
  {
    id: 'estoque',
    nome: 'Estoque',
    descricao: 'Cadastrar produto sem planilha, dar entrada de mercadoria e controlar saldo.',
    menu: 'estoque',
  },
];

/** Menus que devem sumir da navegação porque o módulo dono deles não está habilitado. */
export function menusDeModulosDesabilitados(habilitados: string[]): MenuKey[] {
  const ativos = new Set(habilitados);
  return MODULOS.filter((m) => !ativos.has(m.id)).map((m) => m.menu);
}
```

- [ ] **Step 4: Adicionar a chave de menu**

Em `src/lib/menus.ts`:

```ts
export const MENU_KEYS = ['dashboard', 'lotes', 'revisao', 'publicados', 'estoque', 'faturamento', 'financeiro', 'viabilidade', 'canais', 'configuracoes'] as const;
```

e em `PREFIX`:

```ts
  estoque: 'estoque',
```

Em `supabase/functions/usuarios/index.ts`, atualize o espelho `MENU_KEYS` da linha 6 com o **mesmo** array. Se os dois divergirem, `allowed_menus` é sanitizado e a permissão do menu novo é silenciosamente descartada.

- [ ] **Step 5: Rodar e verificar que PASSA**

```bash
pnpm test src/lib/__tests__/modulos.test.ts
```

Expected: **PASS**, 5 testes.

- [ ] **Step 6: Implementar o hook**

Crie `src/hooks/useModulosHabilitados.ts`, copiando a estrutura de `src/hooks/useCanaisHabilitados.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useModulosHabilitados() {
  return useQuery({
    queryKey: ['modulos-habilitados'],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.rpc('modulos_habilitados_da_org');
      if (error) throw error;
      return (data ?? []) as string[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
```

Use exatamente o mesmo import de `supabase` e o mesmo estilo de `queryKey` que `useCanaisHabilitados.ts` usa — copie de lá, não invente.

- [ ] **Step 7: Aplicar o gate na sidebar**

Localize onde `visibleMenus` é consumido:

```bash
rtk proxy grep -rn "visibleMenus" src/ | rtk proxy head -5
```

Nesse componente, filtre o resultado removendo `menusDeModulosDesabilitados(modulos ?? [])`. Enquanto `isLoading`, esconda os menus de módulo (falha fechada, não aberta) — mostrar e sumir é pior que aparecer um instante depois.

- [ ] **Step 8: Baseline + commit**

```bash
pnpm test && npx tsc --noEmit && pnpm lint && pnpm build
git add src/ supabase/functions/usuarios/index.ts
git commit -m "feat(e6b): registry de modulos + menu estoque gated por org"
```

---

### Task 3: Action `set_modulos_org` + checkbox no `/admin`

**Files:**
- Modify: `supabase/functions/usuarios/index.ts`
- Modify: `src/pages/Organizacoes.tsx`

**Interfaces:**
- Consumes: `MODULOS` (Task 2), coluna `modulos_habilitados` (Task 1).
- Produces: endpoint `{ action: 'set_modulos_org', org_id, modulos: string[] }`.

- [ ] **Step 1: Implementar a action**

Em `supabase/functions/usuarios/index.ts`, logo **depois** do `case 'set_canais_org'`, adicione:

```ts
    case 'set_modulos_org': {
      if (!me.is_super_admin) return json({ error: 'forbidden' }, 403);
      const alvo = String(body.org_id ?? '');
      if (!alvo) return json({ error: 'org_id obrigatório' }, 400);
      // Mesmos ids do registry do frontend (src/lib/modulos.ts) — manter em sincronia.
      const MODULOS_VALIDOS = ['estoque'];
      const modulos = Array.isArray(body.modulos)
        ? (body.modulos as string[]).filter((m) => MODULOS_VALIDOS.includes(m))
        : [];
      const { error } = await db.from('organizations')
        .update({ modulos_habilitados: [...new Set(modulos)], atualizado_em: new Date().toISOString() })
        .eq('id', alvo);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
```

**Diferença proposital em relação a `set_canais_org`:** aqui **não** existe módulo obrigatório. Lista vazia é estado válido (org sem nenhum módulo) e é o default.

- [ ] **Step 2: Confirmar que a trava de super-admin é a mesma**

```bash
rtk proxy grep -n "is_super_admin" supabase/functions/usuarios/index.ts | rtk proxy head -10
```

Confirme que `set_modulos_org` usa exatamente a mesma checagem das demais actions de plataforma. Se elas também exigem `!me.org_id`, adicione a mesma condição.

- [ ] **Step 3: Adicionar o checkbox na tela de Organizações**

Em `src/pages/Organizacoes.tsx`, ao lado do bloco que hoje monta o `Set` de `canais_habilitados` (por volta da linha 390), adicione um bloco equivalente para módulos:

- itera `MODULOS` (de `src/lib/modulos.ts`), mostrando `nome` e `descricao`;
- estado inicial a partir de `org.modulos_habilitados`;
- salvar chama a edge `usuarios` com `{ action: 'set_modulos_org', org_id, modulos }`;
- invalida a query da listagem de orgs no sucesso.

Reuse os mesmos componentes de checkbox e o mesmo padrão de mutation que o bloco de canais já usa — não crie um componente novo.

- [ ] **Step 4: Testar manualmente**

Suba o dev server logado como super-admin. Habilite o módulo `estoque` numa org de teste, entre como usuário dessa org e confirme que o menu Estoque aparece. Desabilite e confirme que some.

- [ ] **Step 5: Baseline + commit**

```bash
pnpm test && npx tsc --noEmit && pnpm lint && pnpm build
deno check supabase/functions/usuarios/index.ts
git add src/pages/Organizacoes.tsx supabase/functions/usuarios/index.ts
git commit -m "feat(e6b): super-admin habilita modulos por org (set_modulos_org)"
```

---

### Task 4: Validação e montagem do produto (funções puras, TDD)

**Files:**
- Create: `supabase/functions/_shared/produto/validar.ts`
- Test: `supabase/functions/_shared/produto/__tests__/validar.test.ts`

**Interfaces:**
- Produces, consumido pela Task 5:

```ts
export interface VariacaoEntrada {
  codigo: string; nome?: string | null; gtin?: string | null;
  preco: number; custo?: number | null; estoqueInicial?: number | null;
  pesoGramas?: number | null; alturaCm?: number | null;
  larguraCm?: number | null; comprimentoCm?: number | null;
}
export interface ProdutoEntrada {
  codigoPai: string; nomePai: string; descricaoPai?: string | null;
  unidade?: string | null; fornecedor?: string | null;
  origem: 'nacional' | 'importado';
  variacoes: VariacaoEntrada[];
}
export interface ErroValidacao { campo: string; mensagem: string }
export function validarProdutoNovo(p: ProdutoEntrada): ErroValidacao[]
export function montarLinhasProduto(
  p: ProdutoEntrada, ctx: { loteId: string; userId: string; orgId: string },
): { familia: Record<string, unknown>; variacoes: Array<Record<string, unknown>> }
```

- [ ] **Step 1: Escrever o teste RED**

Crie `supabase/functions/_shared/produto/__tests__/validar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validarProdutoNovo, montarLinhasProduto } from '../validar';
import type { ProdutoEntrada } from '../validar';

const valido: ProdutoEntrada = {
  codigoPai: '09912345',
  nomePai: 'Camiseta básica',
  descricaoPai: 'Camiseta de algodão',
  unidade: 'UN',
  fornecedor: 'Fornecedor X',
  origem: 'nacional',
  variacoes: [
    { codigo: '09912345AZ', nome: 'Azul', gtin: '7891234567895', preco: 49.9, custo: 20, estoqueInicial: 10 },
    { codigo: '09912345RS', nome: 'Rosa', gtin: '7891234567901', preco: 49.9, custo: 20, estoqueInicial: 5 },
  ],
};

describe('validarProdutoNovo', () => {
  it('produto completo não tem erro', () => {
    expect(validarProdutoNovo(valido)).toEqual([]);
  });

  it('exige codigoPai', () => {
    const e = validarProdutoNovo({ ...valido, codigoPai: '  ' });
    expect(e.map((x) => x.campo)).toContain('codigoPai');
  });

  it('exige nomePai', () => {
    expect(validarProdutoNovo({ ...valido, nomePai: '' }).map((x) => x.campo)).toContain('nomePai');
  });

  it('exige ao menos uma variação', () => {
    expect(validarProdutoNovo({ ...valido, variacoes: [] }).map((x) => x.campo)).toContain('variacoes');
  });

  it('exige codigo em cada variação', () => {
    const e = validarProdutoNovo({ ...valido, variacoes: [{ codigo: '', preco: 10 }] });
    expect(e.map((x) => x.campo)).toContain('variacoes[0].codigo');
  });

  it('rejeita codigo de variação duplicado', () => {
    const e = validarProdutoNovo({
      ...valido,
      variacoes: [{ codigo: 'A1', preco: 10 }, { codigo: 'A1', preco: 10 }],
    });
    expect(e.map((x) => x.campo)).toContain('variacoes[1].codigo');
  });

  it('exige preço positivo', () => {
    expect(validarProdutoNovo({ ...valido, variacoes: [{ codigo: 'A1', preco: 0 }] })
      .map((x) => x.campo)).toContain('variacoes[0].preco');
    expect(validarProdutoNovo({ ...valido, variacoes: [{ codigo: 'A1', preco: -1 }] })
      .map((x) => x.campo)).toContain('variacoes[0].preco');
  });

  it('custo informado tem que ser positivo — zero é erro, ausente não é', () => {
    expect(validarProdutoNovo({ ...valido, variacoes: [{ codigo: 'A1', preco: 10, custo: 0 }] })
      .map((x) => x.campo)).toContain('variacoes[0].custo');
    expect(validarProdutoNovo({ ...valido, variacoes: [{ codigo: 'A1', preco: 10, custo: null }] }))
      .toEqual([]);
  });

  it('estoque inicial negativo é erro', () => {
    expect(validarProdutoNovo({ ...valido, variacoes: [{ codigo: 'A1', preco: 10, estoqueInicial: -1 }] })
      .map((x) => x.campo)).toContain('variacoes[0].estoqueInicial');
  });
});

describe('montarLinhasProduto', () => {
  const ctx = { loteId: 'lote-1', userId: 'user-1', orgId: 'org-1' };

  it('família nasce como CREATE e pendente', () => {
    const { familia } = montarLinhasProduto(valido, ctx);
    expect(familia.operacao).toBe('CREATE');
    expect(familia.status).toBe('pendente');
    expect(familia.lote_id).toBe('lote-1');
    expect(familia.org_id).toBe('org-1');
    expect(familia.codigo_pai).toBe('09912345');
  });

  it('estoque das variações nasce ZERO — quem soma é registrar_entrada', () => {
    const { variacoes } = montarLinhasProduto(valido, ctx);
    expect(variacoes.every((v) => v.estoque === 0)).toBe(true);
  });

  it('uma linha por variação, com org_id e user_id propagados', () => {
    const { variacoes } = montarLinhasProduto(valido, ctx);
    expect(variacoes).toHaveLength(2);
    expect(variacoes.every((v) => v.org_id === 'org-1' && v.user_id === 'user-1')).toBe(true);
  });

  it('trima os textos', () => {
    const { familia } = montarLinhasProduto({ ...valido, codigoPai: '  09912345  ' }, ctx);
    expect(familia.codigo_pai).toBe('09912345');
  });
});
```

- [ ] **Step 2: Rodar e verificar que FALHA**

```bash
pnpm test supabase/functions/_shared/produto/__tests__/validar.test.ts
```

Expected: **FAIL** — módulo `../validar` não existe.

- [ ] **Step 3: Implementar `validar.ts`**

```ts
// E6b (ADR-0054, D-3/D-4/D-9): validação e montagem do produto cadastrado à mão.
// Grava exatamente as mesmas linhas que o ingest-lote grava a partir da planilha —
// o downstream (IA, Revisão, publicação) não sabe de onde o produto veio.

export interface VariacaoEntrada {
  codigo: string;
  nome?: string | null;
  gtin?: string | null;
  preco: number;
  custo?: number | null;
  estoqueInicial?: number | null;
  pesoGramas?: number | null;
  alturaCm?: number | null;
  larguraCm?: number | null;
  comprimentoCm?: number | null;
}

export interface ProdutoEntrada {
  codigoPai: string;
  nomePai: string;
  descricaoPai?: string | null;
  unidade?: string | null;
  fornecedor?: string | null;
  origem: 'nacional' | 'importado';
  variacoes: VariacaoEntrada[];
}

export interface ErroValidacao { campo: string; mensagem: string }

export function validarProdutoNovo(p: ProdutoEntrada): ErroValidacao[] {
  const erros: ErroValidacao[] = [];
  if (!p.codigoPai?.trim()) erros.push({ campo: 'codigoPai', mensagem: 'Código do produto é obrigatório.' });
  if (!p.nomePai?.trim()) erros.push({ campo: 'nomePai', mensagem: 'Nome do produto é obrigatório.' });
  if (!p.variacoes || p.variacoes.length === 0) {
    erros.push({ campo: 'variacoes', mensagem: 'Cadastre ao menos uma variação.' });
    return erros;
  }

  const vistos = new Set<string>();
  p.variacoes.forEach((v, i) => {
    const codigo = v.codigo?.trim() ?? '';
    if (!codigo) {
      erros.push({ campo: `variacoes[${i}].codigo`, mensagem: 'Código da variação é obrigatório.' });
    } else if (vistos.has(codigo)) {
      erros.push({ campo: `variacoes[${i}].codigo`, mensagem: `Código ${codigo} repetido neste produto.` });
    } else {
      vistos.add(codigo);
    }

    if (v.preco == null || v.preco <= 0) {
      erros.push({ campo: `variacoes[${i}].preco`, mensagem: 'Preço deve ser maior que zero.' });
    }
    // Custo alimenta markup e preço (ADR-0055): valor inválido FALHA, nunca vira default.
    if (v.custo != null && v.custo <= 0) {
      erros.push({ campo: `variacoes[${i}].custo`, mensagem: 'Custo, quando informado, deve ser maior que zero.' });
    }
    if (v.estoqueInicial != null && v.estoqueInicial < 0) {
      erros.push({ campo: `variacoes[${i}].estoqueInicial`, mensagem: 'Estoque inicial não pode ser negativo.' });
    }
  });

  return erros;
}

export function montarLinhasProduto(
  p: ProdutoEntrada,
  ctx: { loteId: string; userId: string; orgId: string },
): { familia: Record<string, unknown>; variacoes: Array<Record<string, unknown>> } {
  const familia = {
    lote_id: ctx.loteId,
    user_id: ctx.userId,
    org_id: ctx.orgId,
    codigo_pai: p.codigoPai.trim(),
    nome_pai: p.nomePai.trim(),
    descricao_pai: p.descricaoPai?.trim() || null,
    unidade: p.unidade?.trim() || null,
    fornecedor: p.fornecedor?.trim() || null,
    origem: p.origem,
    operacao: 'CREATE',
    status: 'pendente',
  };

  const variacoes = p.variacoes.map((v) => ({
    user_id: ctx.userId,
    org_id: ctx.orgId,
    codigo: v.codigo.trim(),
    nome: v.nome?.trim() || null,
    gtin: v.gtin?.trim() || null,
    preco: v.preco,
    custo: v.custo ?? null,
    // Estoque nasce ZERO: o saldo entra por registrar_entrada, caminho único (D-15).
    estoque: 0,
    peso_gramas: v.pesoGramas ?? null,
    altura_cm: v.alturaCm ?? null,
    largura_cm: v.larguraCm ?? null,
    comprimento_cm: v.comprimentoCm ?? null,
  }));

  return { familia, variacoes };
}
```

- [ ] **Step 4: Rodar e verificar que PASSA**

```bash
pnpm test supabase/functions/_shared/produto/__tests__/validar.test.ts
```

Expected: **PASS**, 13 testes.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/produto/
git commit -m "feat(e6b): validacao e montagem do produto cadastrado a mao (TDD)"
```

---

### Task 5: Edge `cadastrar-produto`

**Files:**
- Create: `supabase/functions/_shared/produto/modulo.ts`
- Create: `supabase/functions/cadastrar-produto/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `validarProdutoNovo`, `montarLinhasProduto` (Task 4); RPCs `proximo_numero_lote` e `registrar_entrada`; `enfileirarFamilia` (`_shared/queue.ts`).
- Produces: `POST /cadastrar-produto` com body `ProdutoEntrada`, resposta `{ loteId, familiaId }`.
- Produces, consumido pela Task 6: `exigirModulo(admin, orgId, modulo): Promise<boolean>`

- [ ] **Step 1: Implementar o gate de módulo**

Crie `supabase/functions/_shared/produto/modulo.ts`:

```ts
// E6b (ADR-0054, D-13): esconder o menu é navegação (ADR-0047), NÃO é fronteira de
// segurança. Sem esta checagem, qualquer token autenticado chamaria as edges do módulo.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export async function exigirModulo(
  admin: SupabaseClient, orgId: string, modulo: string,
): Promise<boolean> {
  const { data } = await admin.from('organizations')
    .select('modulos_habilitados').eq('id', orgId).maybeSingle();
  const habilitados = (data?.modulos_habilitados ?? []) as string[];
  return habilitados.includes(modulo);
}
```

- [ ] **Step 2: Adicionar as entradas no `config.toml`**

Estas edges são chamadas pelo **app** com o JWT do usuário, não pelo QStash — então `verify_jwt` fica ligado (o default). Adicione explicitamente para deixar a intenção registrada:

```toml
[functions.cadastrar-produto]
verify_jwt = true

[functions.entrada-estoque]
verify_jwt = true
```

- [ ] **Step 3: Implementar a edge**

Crie `supabase/functions/cadastrar-produto/index.ts`. Copie o cabeçalho de autenticação (resolução de `userId`/`orgId` a partir do JWT) de uma edge existente que também é chamada pelo app — leia `supabase/functions/usuarios/index.ts` e siga o mesmo padrão.

```ts
// E6b (ADR-0054, D-1/D-1.1): cadastro manual de produto. Grava um LOTE normal
// (origem='manual') e cai na mesma Revisão de sempre — process-familia,
// publish-familia-ml, split e user products não mudam uma linha.
import { adminClient } from '../_shared/supabase.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { validarProdutoNovo, montarLinhasProduto } from '../_shared/produto/validar.ts';
import type { ProdutoEntrada } from '../_shared/produto/validar.ts';
import { enfileirarFamilia } from '../_shared/queue.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // --- autenticação: userId + orgId a partir do JWT (copie o padrão da edge `usuarios`) ---
  const { userId, orgId } = await autenticar(req);          // implementar conforme a edge usuarios
  if (!userId || !orgId) return json({ error: 'não autenticado' }, 401);

  const admin = adminClient();
  if (!(await exigirModulo(admin, orgId, 'estoque'))) {
    return json({ error: 'Módulo de estoque não habilitado para esta organização.' }, 403);
  }

  const produto = await req.json() as ProdutoEntrada;

  const erros = validarProdutoNovo(produto);
  if (erros.length > 0) return json({ erros }, 400);

  // D-4: guard LOUD de duplicata. A unique do banco é (lote_id, codigo_pai), então
  // dois lotes diferentes aceitariam o mesmo produto e criariam duas linhas canônicas
  // concorrentes. Erro explícito, nunca merge silencioso.
  const codigoPai = produto.codigoPai.trim();
  const { data: jaExiste } = await admin.from('familias')
    .select('id, lote_id, status').eq('org_id', orgId).eq('codigo_pai', codigoPai)
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();
  if (jaExiste) {
    return json({
      error: `O produto ${codigoPai} já existe nesta organização. `
        + 'Para repor saldo, use Entrada de estoque.',
      // O cliente precisa disso para oferecer "abrir o produto" em vez de deixar o
      // operador preso: se o cadastro anterior falhou no meio (estoque inicial ou
      // enfileiramento), a família existe mas está incompleta.
      familiaId: jaExiste.id, loteId: jaExiste.lote_id,
    }, 409);
  }

  // Guard de SKU (achado da revisão adversarial): a unique do banco é (familia_id, codigo)
  // — NÃO existe unique por org. As RPCs de estoque resolvem a variação por (org_id, codigo)
  // pegando a família mais recente, então um SKU repetido entre produtos diferentes faria
  // uma venda baixar o estoque do produto ERRADO. Aqui é o único lugar onde dá para impedir.
  const codigosNovos = produto.variacoes.map((v) => v.codigo.trim());
  const { data: skusEmUso } = await admin.from('variacoes')
    .select('codigo, familias!inner(codigo_pai)')
    .eq('org_id', orgId).in('codigo', codigosNovos);
  const conflitos = [...new Set(
    (skusEmUso ?? [])
      .filter((v) => (v.familias as { codigo_pai: string }).codigo_pai !== codigoPai)
      .map((v) => v.codigo as string),
  )];
  if (conflitos.length > 0) {
    return json({
      error: `Estes SKUs já pertencem a outro produto desta organização: ${conflitos.join(', ')}. `
        + 'Um SKU só pode existir em um produto — renomeie ou use o produto existente.',
      conflitos,
    }, 409);
  }

  // D-1.1: reusa o lote manual ABERTO da org; cria um novo se não houver.
  const { data: aberto } = await admin.from('lotes')
    .select('id').eq('org_id', orgId).eq('origem', 'manual')
    .in('status', ['importando', 'processando', 'revisao'])
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();

  let loteId: string;
  let precisaMarcarProcessando = false;
  if (aberto) {
    loteId = aberto.id as string;
    // NÃO marcar 'processando' agora. Entre o UPDATE e o INSERT da família existe uma
    // janela em que um worker de publicação pode rodar talvezFinalizarLote, não enxergar
    // a família (que ainda não existe) e gravar 'concluido' — e aí a família nasceria
    // dentro de um lote já fechado. A marcação vai DEPOIS do insert.
    precisaMarcarProcessando = true;
  } else {
    const { data: novo, error: loteErr } = await admin.from('lotes')
      .insert({ user_id: userId, org_id: orgId, status: 'processando', origem: 'manual' })
      .select('id').single();
    if (loteErr || !novo) return json({ error: 'Falha criando lote de cadastro.' }, 500);
    loteId = novo.id as string;
    const { data: numeroOrg } = await admin.rpc('proximo_numero_lote', { p_org: orgId });
    if (numeroOrg != null) await admin.from('lotes').update({ numero_org: numeroOrg }).eq('id', loteId);
  }

  const { familia, variacoes } = montarLinhasProduto(produto, { loteId, userId, orgId });

  const { data: familiaCriada, error: famErr } = await admin.from('familias')
    .insert(familia).select('id').single();
  if (famErr || !familiaCriada) return json({ error: famErr?.message ?? 'Falha criando família.' }, 400);
  const familiaId = familiaCriada.id as string;

  // O `select` é obrigatório: a etapa de fotos precisa do `variacoes.id` de cada SKU
  // (pre-subir-fotos.ts:42-55 vincula a foto pelo id da variação, não pelo código).
  const { data: variacoesCriadas, error: varErr } = await admin.from('variacoes')
    .insert(variacoes.map((v) => ({ ...v, familia_id: familiaId })))
    .select('id, codigo');
  if (varErr) {
    // Família sem variação é lixo — remove para não deixar estado parcial na Revisão.
    await admin.from('familias').delete().eq('id', familiaId);
    return json({ error: varErr.message }, 400);
  }

  // AGORA sim: a família já existe, então talvezFinalizarLote passa a enxergá-la e o
  // lote não pode ser fechado por baixo. Fazer isto antes do insert abriria a janela
  // de corrida com os workers de publicação.
  if (precisaMarcarProcessando) {
    await admin.from('lotes').update({ status: 'processando' }).eq('id', loteId);
  }

  // Estoque inicial entra pelo caminho ÚNICO de escrita de estoque (D-15), nunca por
  // UPDATE direto — assim o movimento aparece no ledger e o custo é validado no mesmo lugar.
  // A referência é derivada da família: se esta edge for re-executada (retry de rede,
  // duplo submit), a unique parcial do ledger impede somar o saldo duas vezes.
  const falhasEstoque: string[] = [];
  for (const v of produto.variacoes) {
    if (!v.estoqueInicial || v.estoqueInicial <= 0) continue;
    const codigo = v.codigo.trim();
    const { error } = await admin.rpc('registrar_entrada', {
      p_org: orgId, p_codigo: codigo, p_qtd: v.estoqueInicial,
      p_custo: v.custo ?? null, p_doc: 'Cadastro inicial', p_obs: null,
      p_criado_por: userId, p_ref: `cadastro:${familiaId}:${codigo}`,
    });
    if (error) falhasEstoque.push(`${codigo}: ${error.message}`);
  }

  // Mesmo enriquecimento por IA da planilha — process-familia exige familia_id E lote_id,
  // e os dois existem aqui justamente porque o cadastro cria um lote de verdade (D-1).
  // Falha de enfileiramento NÃO derruba o cadastro: a família fica 'pendente' e o
  // operador reprocessa pelo caminho que já existe (edge `reprocessar-familia`, ADR-0030).
  let filaOk = true;
  try {
    const messageId = await enfileirarFamilia({ familia_id: familiaId, lote_id: loteId });
    await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', familiaId);
  } catch (e) {
    filaOk = false;
    console.error('cadastrar_produto_enfileirar_falhou', { familiaId, erro: String(e) });
  }

  // Estado parcial é devolvido explicitamente, nunca escondido — a tela avisa o operador
  // em vez de deixá-lo achar que deu tudo certo e depois bater no 409 sem entender.
  // `variacoes` é o que a etapa de fotos consome para saber onde gravar cada imagem.
  return json({
    loteId, familiaId, filaOk, falhasEstoque,
    variacoes: (variacoesCriadas ?? []).map((v) => ({ id: v.id, codigo: v.codigo })),
  });
});
```

**Por que não há transação:** as escritas passam por três caminhos diferentes (tabela, RPC `security definer`, QStash), e o Supabase JS não expõe transação multi-statement. O desenho compensa com idempotência: re-executar o cadastro do mesmo produto para no guard 409 (que agora devolve `familiaId`/`loteId` para a tela oferecer "abrir o produto"), e re-executar o estoque inicial é no-op pela referência `cadastro:{familiaId}:{codigo}`.

Substitua `autenticar(req)` e `json(...)` pelos helpers reais do repositório — leia `supabase/functions/usuarios/index.ts` e copie exatamente os que ele usa.

- [ ] **Step 4: Verificar a assinatura de `enfileirarFamilia`**

```bash
rtk proxy grep -n "export async function enfileirarFamilia" -A 12 supabase/functions/_shared/queue.ts
```

Se a assinatura exigir mais campos que `{ familia_id, lote_id }`, ajuste a chamada. O código real vence este plano.

- [ ] **Step 5: Baseline**

```bash
pnpm test && npx tsc --noEmit && pnpm lint
deno check supabase/functions/cadastrar-produto/index.ts
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/cadastrar-produto/ supabase/functions/_shared/produto/modulo.ts supabase/config.toml
git commit -m "feat(e6b): edge cadastrar-produto (lote manual, guard de duplicata, gate de modulo)"
```

---

### Task 6: Edge `entrada-estoque`

**Files:**
- Create: `supabase/functions/entrada-estoque/index.ts`

**Interfaces:**
- Consumes: `exigirModulo` (Task 5), RPC `registrar_entrada` (Bloco A Task 3), `enfileirarSincronizacaoEstoque` (Bloco A Task 6).
- Produces: `POST /entrada-estoque` com body `{ codigo, quantidade, custo?, documento? }`, resposta `{ estoque }`.

- [ ] **Step 1: Implementar a edge**

```ts
// E6b (ADR-0054, D-9/D-10/D-15): entrada de mercadoria. Escrita de estoque só passa
// por aqui (service_role), nunca do browser direto — senão o trigger de ajuste manual
// registraria um segundo movimento para a mesma entrada.
import { adminClient } from '../_shared/supabase.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { userId, orgId } = await autenticar(req);          // mesmo helper da Task 5
  if (!userId || !orgId) return json({ error: 'não autenticado' }, 401);

  const admin = adminClient();
  if (!(await exigirModulo(admin, orgId, 'estoque'))) {
    return json({ error: 'Módulo de estoque não habilitado para esta organização.' }, 403);
  }

  const body = await req.json() as {
    codigo?: string; quantidade?: number; custo?: number | null;
    documento?: string | null; observacao?: string | null; ref?: string;
  };
  const codigo = body.codigo?.trim() ?? '';
  const quantidade = Number(body.quantidade ?? 0);
  if (!codigo) return json({ error: 'Informe o SKU.' }, 400);
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    return json({ error: 'Quantidade deve ser um inteiro maior que zero.' }, 400);
  }
  // Custo alimenta markup e preço (ADR-0055): valor inválido FALHA aqui e na RPC.
  const custo = body.custo == null ? null : Number(body.custo);
  if (custo !== null && !(custo > 0)) {
    return json({ error: 'Custo, quando informado, deve ser maior que zero.' }, 400);
  }
  // Idempotência: o cliente gera um uuid por submissão do formulário. Sem isso,
  // duplo clique ou retry de rede soma o saldo 2× e sobrescreve o custo 2× —
  // e isto é caminho financeiro (ADR-0055).
  const ref = body.ref?.trim();
  if (!ref) return json({ error: 'Referência de idempotência ausente.' }, 400);

  const { data: estoque, error } = await admin.rpc('registrar_entrada', {
    p_org: orgId, p_codigo: codigo, p_qtd: quantidade,
    p_custo: custo, p_doc: body.documento?.trim() || null,
    p_obs: body.observacao?.trim() || null,
    p_criado_por: userId, p_ref: `entrada:${ref}`,
  });
  if (error) return json({ error: error.message }, 400);
  const duplicada = estoque === null;   // a mesma submissão já foi aplicada — não é erro

  // Propaga na hora, para TODOS os canais publicados — inclusive o ML (D-10).
  // canal_origem null = push para todo mundo.
  //
  // O enfileiramento roda TAMBÉM no caminho duplicado: se a primeira tentativa
  // aplicou a entrada mas morreu antes de enfileirar, o retry cairia no `duplicada`
  // e o push nunca aconteceria. Push absoluto é idempotente, então re-enfileirar
  // é inofensivo — bem mais barato que perder a propagação.
  const { data: mov } = await admin.from('estoque_movimentos')
    .select('codigo_pai, estoque_resultante')
    .eq('org_id', orgId).eq('referencia_externa', `entrada:${ref}`).maybeSingle();

  let pushOk = true;
  if (mov?.codigo_pai) {
    try {
      await enfileirarSincronizacaoEstoque(
        { org_id: orgId, codigo_pai: mov.codigo_pai as string, canal_origem: null }, orgId,
      );
    } catch (e) {
      // A entrada já foi gravada e é a verdade; o push é recuperável pela reconciliação diária.
      pushOk = false;
      console.error('entrada_push_falhou', e);
    }
  }

  return json({
    estoque: duplicada ? (mov?.estoque_resultante ?? null) : estoque,
    duplicada, pushOk,
  });
});
```

`pushOk: false` não é erro de entrada — a tela mostra um aviso discreto ("saldo atualizado; os anúncios serão sincronizados em até 24h") em vez de sugerir que a entrada falhou.

- [ ] **Step 2: Baseline**

```bash
npx tsc --noEmit && pnpm lint
deno check supabase/functions/entrada-estoque/index.ts
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/entrada-estoque/
git commit -m "feat(e6b): edge entrada-estoque com push imediato para todos os canais"
```

---

### Task 7: Tela Estoque — lista, entrada e histórico

**Files:**
- Create: `src/pages/Estoque.tsx`
- Create: `src/components/estoque/dialog-entrada.tsx`
- Modify: `src/lib/queries.ts`
- Modify: `src/App.tsx`
- Test: `src/lib/__tests__/produtos-saldo.test.ts`

**Interfaces:**
- Consumes: `MovimentoEstoque`, `rotuloMotivo`, `fetchMovimentosEstoque` (Bloco A Task 10); edge `entrada-estoque` (Task 6).
- Produces:

```ts
export interface ProdutoComSaldo {
  codigoPai: string; nomePai: string;
  variacoes: Array<{ codigo: string; nome: string | null; cor: string | null; estoque: number; custo: number | null; preco: number }>;
  saldoTotal: number;
}
export function agruparProdutosComSaldo(linhas: LinhaVariacaoCrua[]): ProdutoComSaldo[]
export async function fetchProdutosComSaldo(): Promise<ProdutoComSaldo[]>
export async function registrarEntrada(p: { codigo: string; quantidade: number; custo?: number | null; documento?: string | null }): Promise<{ estoque: number }>
```

- [ ] **Step 1: Escrever o teste RED do agrupamento**

Crie `src/lib/__tests__/produtos-saldo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { agruparProdutosComSaldo } from '../queries';

const linhas = [
  { codigo: 'A1', nome: 'Azul', cor: 'Azul', estoque: 5, custo: 10, preco: 30, familias: { codigo_pai: 'P1', nome_pai: 'Camiseta', criado_em: '2026-07-02' } },
  { codigo: 'A2', nome: 'Rosa', cor: 'Rosa', estoque: 3, custo: 10, preco: 30, familias: { codigo_pai: 'P1', nome_pai: 'Camiseta', criado_em: '2026-07-02' } },
  { codigo: 'B1', nome: null, cor: null, estoque: 0, custo: null, preco: 15, familias: { codigo_pai: 'P2', nome_pai: 'Meia', criado_em: '2026-07-01' } },
];

describe('agruparProdutosComSaldo', () => {
  it('agrupa variações pelo produto pai', () => {
    const r = agruparProdutosComSaldo(linhas as never);
    expect(r).toHaveLength(2);
    expect(r.find((p) => p.codigoPai === 'P1')!.variacoes).toHaveLength(2);
  });

  it('soma o saldo total do produto', () => {
    const r = agruparProdutosComSaldo(linhas as never);
    expect(r.find((p) => p.codigoPai === 'P1')!.saldoTotal).toBe(8);
    expect(r.find((p) => p.codigoPai === 'P2')!.saldoTotal).toBe(0);
  });

  it('ordena por nome do produto', () => {
    const r = agruparProdutosComSaldo(linhas as never);
    expect(r.map((p) => p.nomePai)).toEqual(['Camiseta', 'Meia']);
  });

  it('lista vazia devolve vazio', () => {
    expect(agruparProdutosComSaldo([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e verificar que FALHA**

```bash
pnpm test src/lib/__tests__/produtos-saldo.test.ts
```

Expected: **FAIL** — `agruparProdutosComSaldo` não existe.

- [ ] **Step 3: Implementar em `src/lib/queries.ts`**

```ts
export interface LinhaVariacaoCrua {
  codigo: string; nome: string | null; cor: string | null;
  estoque: number; custo: number | null; preco: number;
  familias: { codigo_pai: string; nome_pai: string; criado_em: string } | null;
}

export interface ProdutoComSaldo {
  codigoPai: string;
  nomePai: string;
  variacoes: Array<{ codigo: string; nome: string | null; cor: string | null; estoque: number; custo: number | null; preco: number }>;
  saldoTotal: number;
}

export function agruparProdutosComSaldo(linhas: LinhaVariacaoCrua[]): ProdutoComSaldo[] {
  // Só a família MAIS RECENTE de cada codigo_pai é canônica (âncora ADR-0025, a mesma
  // que baixar_estoque e o worker de push usam). Org de planilha tem N lotes do mesmo
  // produto; sem este corte a tela duplicaria variação e somaria saldo histórico.
  const maisRecentePorPai = new Map<string, string>();
  for (const l of linhas) {
    const pai = l.familias?.codigo_pai;
    if (!pai) continue;
    const atual = maisRecentePorPai.get(pai);
    if (atual === undefined || l.familias!.criado_em > atual) {
      maisRecentePorPai.set(pai, l.familias!.criado_em);
    }
  }

  const porPai = new Map<string, ProdutoComSaldo>();
  for (const l of linhas) {
    const pai = l.familias?.codigo_pai;
    if (!pai) continue;
    if (l.familias!.criado_em !== maisRecentePorPai.get(pai)) continue;
    if (!porPai.has(pai)) {
      porPai.set(pai, { codigoPai: pai, nomePai: l.familias!.nome_pai, variacoes: [], saldoTotal: 0 });
    }
    const p = porPai.get(pai)!;
    p.variacoes.push({ codigo: l.codigo, nome: l.nome, cor: l.cor, estoque: l.estoque, custo: l.custo, preco: l.preco });
    p.saldoTotal += l.estoque;
  }
  return [...porPai.values()].sort((a, b) => a.nomePai.localeCompare(b.nomePai, 'pt-BR'));
}

/**
 * Produtos com saldo da org. Vem das variações da família MAIS RECENTE de cada
 * codigo_pai (mesma âncora do ADR-0025 usada pela baixa e pelo push) — por isso o
 * agrupamento acontece no cliente, sobre um select simples com RLS por org.
 */
export async function fetchProdutosComSaldo(): Promise<ProdutoComSaldo[]> {
  // PAGINAÇÃO OBRIGATÓRIA: o PostgREST trunca em ~1000 linhas. Truncar aqui é pior
  // que uma lista incompleta — o corte "família mais recente por codigo_pai" passaria
  // a escolher uma família HISTÓRICA como canônica se a atual caísse fora da página,
  // e a tela mostraria saldo errado. `buscarTodasPaginas` já existe (src/lib/fotos-produto.ts).
  const data = await buscarTodasPaginas<Record<string, unknown>>((de, ate) => supabase
    .from('variacoes')
    .select('codigo, nome, cor, estoque, custo, preco, familias!inner(codigo_pai, nome_pai, criado_em)')
    .range(de, ate));
  return agruparProdutosComSaldo(data as unknown as LinhaVariacaoCrua[]);
}

export async function registrarEntrada(p: {
  codigo: string; quantidade: number; custo?: number | null;
  documento?: string | null; observacao?: string | null;
  /** uuid gerado UMA vez por submissão do formulário — não regenerar no retry. */
  ref: string;
}): Promise<{ estoque: number | null; duplicada?: boolean; pushOk: boolean }> {
  const { data, error } = await supabase.functions.invoke('entrada-estoque', { body: p });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  const r = data as { estoque: number | null; duplicada?: boolean; pushOk?: boolean };
  return { ...r, pushOk: r.pushOk !== false };
}
```

**`pushOk` não pode ser descartado pelo diálogo.** Quando ele vem `false`, o saldo foi gravado mas os anúncios ficaram defasados — o operador precisa saber, senão acha que já pode vender. Regra: `pushOk === false` → toast de aviso ("Saldo atualizado. A sincronização com os marketplaces falhou e será refeita automaticamente em até 24h."), não um toast de sucesso limpo.

**Regra do `ref`:** o dialog gera `crypto.randomUUID()` ao **abrir**, não ao submeter, e só troca depois de um sucesso confirmado. Assim duplo clique e retry reusam a mesma referência e a segunda aplicação vira no-op.

**OBRIGATÓRIO, não opcional:** o `select` acima traz **todas** as famílias de cada `codigo_pai`, não só a mais recente. Org de planilha tem N lotes do mesmo produto, então a tela mostraria a mesma variação N vezes e o `saldoTotal` seria a soma de saldos históricos — número errado numa tela de estoque. Adicione a filtragem em `agruparProdutosComSaldo`: manter só as variações da família de `criado_em` **máximo** por `codigo_pai`, descartando as demais. Isso é a mesma âncora do ADR-0025 usada por `baixar_estoque` e pelo worker de push, então a tela passa a mostrar exatamente o saldo que o sistema considera canônico.

Acrescente este teste ao bloco da Step 1 antes de implementar:

```ts
it('mantém só a família mais recente de cada codigo_pai', () => {
  const r = agruparProdutosComSaldo([
    { codigo: 'A1', nome: null, cor: null, estoque: 2, custo: null, preco: 10,
      familias: { codigo_pai: 'P1', nome_pai: 'Camiseta', criado_em: '2026-06-01' } },
    { codigo: 'A1', nome: null, cor: null, estoque: 9, custo: null, preco: 10,
      familias: { codigo_pai: 'P1', nome_pai: 'Camiseta', criado_em: '2026-07-02' } },
  ] as never);
  expect(r).toHaveLength(1);
  expect(r[0].variacoes).toHaveLength(1);
  expect(r[0].saldoTotal).toBe(9);
});
```

- [ ] **Step 4: Rodar e verificar que PASSA**

```bash
pnpm test src/lib/__tests__/produtos-saldo.test.ts
```

Expected: **PASS**, 4 testes.

- [ ] **Step 5: Construir a tela**

Crie `src/pages/Estoque.tsx` seguindo o layout e os tokens visuais que as páginas existentes já usam (leia `src/pages/Publicados.tsx` como referência de estrutura). Conteúdo:

- Cabeçalho com título "Estoque" e dois botões: **Cadastrar produto** e **Dar entrada**.
- Tabela de produtos: **Produto · SKUs · Saldo total · Canais · Ações**. A coluna **Canais** (exigida pela spec §9) mostra em quais marketplaces o produto está publicado — um select adicional em `anuncios_externos` por `codigo_pai` com `status='publicado'`, agregado por canal, reusando o `CanalBadge` que já existe. Produto cadastrado e ainda não publicado aparece como "—".
- Linha expansível mostrando as variações (SKU, cor, saldo, custo, preço) e o histórico de movimentos (reusa `fetchMovimentosEstoque` e `rotuloMotivo` do Bloco A).
- Saldo zero destacado visualmente (o anúncio está pausado no ML).
- Estado vazio: "Nenhum produto cadastrado ainda. Comece cadastrando o primeiro."
- Light **e** dark.

Crie `src/components/estoque/dialog-entrada.tsx`: seleção de SKU (busca por código ou nome), quantidade (inteiro > 0), custo unitário (opcional; se preenchido tem que ser > 0), documento (texto livre, opcional). Ao salvar, chama `registrarEntrada` e invalida `['produtos-saldo']` e `QK.movimentosEstoque(codigoPai)`.

- [ ] **Step 5b: Rótulo de origem na tela de Lotes**

Exigido pela spec §9 e esquecido nas tasks. Localize a tela:

```bash
rtk proxy grep -rn "lotes" src/pages/ --include=*.tsx | rtk proxy grep -i "export default\|function Lotes" | rtk proxy head -3
```

Na listagem, mostre um chip discreto distinguindo **Planilha** de **Cadastro manual**, lendo `lotes.origem`. Inclua `origem` no `select` da query que alimenta a tela. Sem isso, o operador de uma org do módulo vê "Lote #12" sem saber de onde veio, e o operador de uma org mista não distingue os dois fluxos.

- [ ] **Step 6: Registrar a rota**

Em `src/App.tsx`, adicione `<Route path="/estoque" element={<Estoque />} />` dentro do mesmo shell autenticado onde vivem `/publicados` e `/faturamento`.

**Esconder o menu NÃO protege a rota** — URL direta renderiza a tela para uma org sem o módulo. Adicione o guard no próprio `Estoque.tsx`:

```tsx
const { data: modulos, isLoading } = useModulosHabilitados();
if (isLoading) return <TelaCarregando />;              // componente que a app já usa
if (!modulos?.includes('estoque')) return <Navigate to="/" replace />;
```

As escritas já estão protegidas pelas edges (403), então isto é UX e coerência — mas sem ele o critério de saída B.6 seria meia-verdade.

- [ ] **Step 7: Baseline + verificação visual**

```bash
pnpm test && npx tsc --noEmit && pnpm lint && pnpm build
```

Suba o dev server com o módulo habilitado e confira: lista, expandir, entrada, histórico — em light e dark.

- [ ] **Step 8: Commit**

```bash
git add src/
git commit -m "feat(e6b): tela Estoque com saldo por produto, entrada e historico"
```

---

### Task 8: Formulário de cadastro de produto (multi-variação + fotos)

**Files:**
- Create: `src/components/estoque/dialog-cadastro-produto.tsx`
- Modify: `src/lib/queries.ts` (`cadastrarProduto`, `uploadFotoProduto`)

**Interfaces:**
- Consumes: edge `cadastrar-produto` (Task 5); bucket `imagens`.
- Produces:

```ts
export async function cadastrarProduto(p: ProdutoEntradaUI): Promise<{ loteId: string; familiaId: string }>
export async function uploadFotoProduto(loteId: string, arquivo: File, alvo: { tipo: 'capa' | 'capa2' | 'capa3'; familiaId: string } | { tipo: 'variacao'; variacaoId: string }): Promise<void>
```

- [ ] **Step 1: Implementar as mutations**

Em `src/lib/queries.ts`:

```ts
export interface ResultadoCadastro {
  loteId: string;
  familiaId: string;
  /** id + codigo de cada variação criada — a etapa de fotos depende disto. */
  variacoes: Array<{ id: string; codigo: string }>;
  /** false = a família ficou 'pendente' sem job de IA; precisa reprocessar. */
  filaOk: boolean;
  /** SKUs cujo estoque inicial não foi aplicado. */
  falhasEstoque: string[];
}

export class ProdutoJaExisteError extends Error {
  constructor(msg: string, readonly familiaId: string, readonly loteId: string) { super(msg); }
}

export async function cadastrarProduto(p: ProdutoEntradaUI): Promise<ResultadoCadastro> {
  const { data, error } = await supabase.functions.invoke('cadastrar-produto', { body: p });

  // CUIDADO: em resposta não-2xx o supabase-js NÃO popula `data` — o corpo fica em
  // `error.context` (a app já lida com isso em src/pages/Organizacoes.tsx:29-43).
  // Fazer `if (error) throw error` antes de ler o contexto tornaria o tratamento de
  // 409 abaixo INALCANÇÁVEL, e o operador ficaria travado sem caminho de retomada
  // quando a resposta da primeira tentativa se perdesse na rede.
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx?.status === 409) {
      const corpo = await ctx.json().catch(() => ({} as Record<string, unknown>));
      const { error: msg, familiaId, loteId } = corpo as {
        error?: string; familiaId?: string; loteId?: string;
      };
      if (familiaId && loteId) {
        throw new ProdutoJaExisteError(msg ?? 'Produto já existe.', familiaId, loteId);
      }
    }
    if (ctx) {
      const corpo = await ctx.json().catch(() => ({} as Record<string, unknown>));
      const { error: msg, erros } = corpo as {
        error?: string; erros?: Array<{ campo: string; mensagem: string }>;
      };
      if (erros?.length) throw new Error(erros.map((e) => e.mensagem).join('\n'));
      if (msg) throw new Error(msg);
    }
    throw error;
  }

  const r = data as Partial<ResultadoCadastro>;
  return {
    loteId: r.loteId!, familiaId: r.familiaId!,
    variacoes: r.variacoes ?? [], filaOk: r.filaOk !== false, falhasEstoque: r.falhasEstoque ?? [],
  };
}
```

**Confirme o formato exato antes de codar** — leia `src/pages/Organizacoes.tsx:29-43` e reuse o helper que já existe lá, se houver, em vez de reimplementar a extração do corpo de erro. Aplique o mesmo cuidado em `registrarEntrada`: hoje ela assume que o erro vem em `data.error`, o que só vale para respostas 2xx.

**A UI não pode engolir `filaOk`/`falhasEstoque`.** Cadastro parcial reportado como sucesso é a pior falha possível aqui: o operador segue para as fotos e para a Revisão achando que está tudo certo, e o produto nunca é enriquecido pela IA (ou entra sem estoque). Regra:

- `filaOk === false` → banner de erro com botão **"Reprocessar"** chamando a edge `reprocessar-familia` (ADR-0030) com o `familiaId`. Não avance para a Revisão sem isso.
- `falhasEstoque.length > 0` → listar os SKUs e oferecer **"Dar entrada"** para cada um. O cadastro em si está bom; só o saldo faltou.
- Só quando os dois estiverem limpos a tela mostra "Produto cadastrado" e libera o "Ir para a Revisão".

Para a foto, escreva direto no bucket `imagens` no path `{user_id}/{lote_id}/{arquivo}` — as policies de storage exigem que a primeira pasta do path seja `auth.uid()`, e é exatamente o que `buildStoragePath` já monta. Reuse `buildStoragePath` e `uploadFile` de onde `useUploadLote.ts` os importa; **não** reescreva.

**Colisão de nome (achado da revisão):** com D-1.1 vários produtos vivem no **mesmo** lote, e o operador escolhe os nomes dos arquivos — dois produtos com `capa.jpg` ou `IMG_1234.jpg` colidiriam no mesmo path e um sobrescreveria o outro. Prefixe o nome com o id do alvo antes de montar o path:

```ts
export async function uploadFotoProduto(
  loteId: string,
  arquivo: File,
  alvo: { tipo: 'capa' | 'capa2' | 'capa3'; familiaId: string } | { tipo: 'variacao'; variacaoId: string },
): Promise<void> {
  // Prefixo único por alvo: elimina colisão entre produtos do mesmo lote manual.
  const idAlvo = alvo.tipo === 'variacao' ? alvo.variacaoId : `${alvo.familiaId}-${alvo.tipo}`;
  const path = buildStoragePath(storageOwner, loteId, `${idAlvo}-${arquivo.name}`);
  await uploadFile('imagens', path, arquivo);
  if (alvo.tipo === 'variacao') {
    const { error } = await supabase.from('variacoes').update({ imagem_path: path }).eq('id', alvo.variacaoId);
    if (error) throw error;
    return;
  }
  const coluna = alvo.tipo === 'capa' ? 'capa_storage_path'
    : alvo.tipo === 'capa2' ? 'capa2_storage_path' : 'capa3_storage_path';
  const { error } = await supabase.from('familias').update({ [coluna]: path }).eq('id', alvo.familiaId);
  if (error) throw error;
}
```

Confirme o nome exato de `storageOwner` e `buildStoragePath` lendo `src/hooks/useUploadLote.ts` — se forem parâmetros, propague-os.

- [ ] **Step 2: Construir o formulário**

`src/components/estoque/dialog-cadastro-produto.tsx`, em duas etapas:

**Etapa 1 — dados do produto e variações** (antes de existir `familiaId`, então sem fotos ainda):
- PAI: código, nome, descrição, unidade, fornecedor, origem (`nacional` | `importado`, radio).
- Tabela de variações, com botão "Adicionar variação". Colunas: SKU, nome/cor, GTIN, preço, custo, estoque inicial, peso (g), altura, largura, comprimento (cm).
- Validação no cliente espelhando `validarProdutoNovo` — mas **a edge é a autoridade**: mostre os erros que ela devolver, campo a campo.
- Salvar → `cadastrarProduto` → recebe `{ loteId, familiaId }`.

**Etapa 2 — fotos** (agora que família e variações existem):
- Só é liberada se `filaOk` e `falhasEstoque` estiverem limpos (ver acima); senão, mostra os avisos e as ações de reparo primeiro.
- Usa o `variacoes: [{id, codigo}]` devolvido pela edge para saber em qual `variacaoId` gravar cada foto — **não** tente descobrir o id por uma busca posterior.
- Upload da capa, capa2 e capa3 da família.
- Upload de uma foto por variação.
- Botão "Concluir" → navega para `/revisao/{loteId}`.

Deixe explícito na UI que a publicação acontece na Revisão — o cadastro **não** publica nada.

- [ ] **Step 3: Testar o caminho completo manualmente**

Com o módulo habilitado numa org de teste:

1. Cadastrar um produto com 2 variações, estoque inicial e fotos.
2. Confirmar que caiu na Revisão e que a IA preencheu categoria/título/atributos.
3. Confirmar no banco: `lotes.origem = 'manual'`, `familias.operacao = 'CREATE'`, movimentos `entrada` no ledger com o custo informado.
4. Cadastrar um **segundo** produto e confirmar que ele entrou **no mesmo lote** (D-1.1).
5. Tentar cadastrar de novo o **mesmo** `codigo_pai` e confirmar o erro 409 explícito.
6. Publicar pela Revisão e confirmar que o anúncio saiu no ML.

- [ ] **Step 4: Baseline + commit**

```bash
pnpm test && npx tsc --noEmit && pnpm lint && pnpm build
git add src/
git commit -m "feat(e6b): formulario de cadastro de produto multi-variacao com fotos"
```

---

### Task 9: Gate final — regressão da planilha, deploy e documentação

- [ ] **Step 1: Provar que o caminho de planilha não mudou**

Este é o critério mais importante do bloco. Com uma org **sem** o módulo habilitado:

1. Importar uma planilha real de teste e confirmar que o lote processa exatamente como antes.
2. Confirmar que `lotes.origem = 'planilha'` no lote novo.
3. Confirmar que o menu Estoque **não** aparece.
4. Chamar a edge `cadastrar-produto` com um token válido dessa org e confirmar **403** — o gate de menu não é a fronteira.
5. Confirmar que Dashboard, Publicados, Faturamento e Financeiro mostram os mesmos números de antes.

- [ ] **Step 2: Rodar a suite de isolamento**

```bash
npx tsx scripts/verificar-isolamento-tenant.ts
```

Expected: todas as asserções PASS. Confirme que a org B não vê lote manual, produto nem movimento da org A.

- [ ] **Step 3: Baseline completo**

```bash
pnpm test && npx tsc --noEmit && pnpm lint && pnpm build
deno check supabase/functions/cadastrar-produto/index.ts supabase/functions/entrada-estoque/index.ts supabase/functions/usuarios/index.ts
```

- [ ] **Step 4: PONTO DE DEPLOY — pedir OK explícito do Diego**

```bash
supabase db push
supabase functions deploy cadastrar-produto
supabase functions deploy entrada-estoque
supabase functions deploy usuarios
```

Calcule o blast radius com `deno info` antes: qualquer função que importe `_shared/produto/*` ou `_shared/queue.ts` precisa ser redeployada. Confirme a versão de cada função depois (`supabase functions list`) — tem que ter subido em 1.

**Cuidado específico:** o redeploy da `usuarios` já foi feito por engano com `--no-verify-jwt` uma vez (2026-07-15), o que destrancou o endpoint admin-only. Depois de deployar, **confirme 401 sem token**.

- [ ] **Step 5: Documentação — no mesmo commit da entrega**

| Arquivo | O que escrever |
|---|---|
| `docs/reference/modelo-de-dados.md` | `lotes.origem`, `organizations.modulos_habilitados`, RPC `modulos_habilitados_da_org` |
| `docs/reference/edge-functions.md` | `cadastrar-produto` e `entrada-estoque` (verify_jwt=true, gate de módulo, 403) |
| `docs/reference/glossario.md` | Remover a marcação "em design" das entradas de Estoque e de Cadastro manual |
| `docs/explanation/arquitetura.md` | As duas origens de produto (planilha e cadastro manual) convergindo no mesmo pipeline |
| `docs/how-to/operacoes-rotineiras.md` | Como cadastrar produto e dar entrada |
| `docs/tutorials/` | Fluxo do operador sem ERP, ponta a ponta |
| `docs/project-status.md` + `docs/TASKS.md` | E6b concluído |
| `obsidian-vault/06-Roadmap/Sprint Atual.md` | Próximo passo passa a ser o E5 Shopee |

- [ ] **Step 6: Re-ingerir o Graphify**

Duas edges novas, duas colunas novas, um menu novo, um registry novo.

- [ ] **Step 7: Commit final**

```bash
git add docs/ obsidian-vault/
git commit -m "docs(e6b): documentar cadastro manual, entrada de mercadoria e gate de modulo"
```

---

## Critério de saída do Bloco B

1. ✅ Cadastrar produto multi-variação com fotos pela UI → família enriquecida pela IA → aparece na Revisão → publica no ML pelo fluxo existente, sem nenhuma mudança no caminho de publicação.
2. ✅ Dois cadastros seguidos entram no **mesmo** lote manual aberto (D-1.1); depois de publicado e fechado, o próximo cadastro abre um lote novo. **Incluindo o interleaving:** publicar o produto A enquanto o produto B ainda está com a IA rodando **não** fecha o lote (Task 0).
3. ✅ `codigo_pai` duplicado na org é rejeitado com 409, mensagem que aponta para Entrada de estoque **e** os ids que permitem à tela abrir o produto existente.
4. ✅ Estoque inicial vira movimento `entrada` no ledger com o custo informado; custo zero ou negativo é rejeitado; re-executar o cadastro **não** soma o saldo de novo.
5. ✅ Entrada de mercadoria soma o saldo, sobrescreve o custo quando informado e propaga na hora para todos os canais publicados. **Duplo clique não duplica o saldo.**
5b. ✅ A tela de Estoque mostra o saldo **canônico** (família mais recente por `codigo_pai`), não a soma de saldos históricos.
5c. ✅ URL direta de `/estoque` numa org sem o módulo redireciona; as duas edges devolvem 403.
6. ✅ Menu Estoque só aparece com o módulo habilitado **e** as duas edges devolvem 403 para org sem o módulo.
7. ✅ Org de planilha segue funcionando byte-a-byte: nenhum número de nenhuma tela muda, `lotes.origem = 'planilha'` em todo lote histórico e novo.
8. ✅ Isolamento cross-tenant re-provado com `scripts/verificar-isolamento-tenant.ts`.

## Riscos residuais aceitos (registrar no ADR-0054)

- **O guard D-4 e o guard de SKU não são atômicos.** São check-then-insert, e não existe unique real por `(org_id, codigo_pai)` nem por `(org_id, codigo)` — nem pode existir, porque org de planilha legitimamente tem N famílias com o mesmo `codigo_pai` (uma por lote) e N variações com o mesmo `codigo`. Dois cadastros concorrentes do mesmo produto criariam duas famílias canônicas concorrentes. Probabilidade baixíssima (um operador, um formulário), consequência recuperável (excluir uma das famílias), custo de blindar alto. Aceito e documentado.
- **SKU repetido vindo de planilha continua possível.** O guard acima só protege o cadastro manual; uma planilha pode legitimamente trazer o mesmo `codigo` em produtos diferentes, e nesse caso a resolução por "família mais recente do `(org_id, codigo)`" nas RPCs pode baixar o produto errado. É risco **pré-existente** (o mesmo critério já governa o dedupe de Publicados, ADR-0025), não introduzido aqui — mas passa a ter consequência de estoque. Registrar no ADR e, se aparecer na prática, tratar com um relatório de SKUs ambíguos por org.
- **Ajuste manual não propaga na hora** (herdado do Bloco A): trigger Postgres não enfileira QStash. A reconciliação diária cobre em ≤24h.
- **Devolução não é tocada:** só o cancelamento visto pelo `sync-venda`.

## Self-review (executado na escrita do plano)

- **Cobertura da spec:** D-1 e D-1.1 (Task 5) · D-2 (Task 1) · D-3 (Tasks 4, 8) · D-4 (Task 5 Step 3) · D-9 (Tasks 4, 6) · D-13 (Tasks 1, 2, 3, 5, 6) · D-14 (nenhuma task — a baixa não é gated, e isso é ausência de código deliberada). D-5..D-12 e D-15 são do Bloco A.
- **Placeholders:** nenhum "TBD". Três pontos que dependem do código real viraram passos de verificação explícitos, não suposições: helpers de autenticação e `json()` da edge `usuarios` (Task 5 Step 3), assinatura de `enfileirarFamilia` (Task 5 Step 4), e `buildStoragePath`/`storageOwner` (Task 8 Step 1).
- **Consistência de tipos:** `ProdutoEntrada` (Task 4) é o body da edge (Task 5) e a base do `ProdutoEntradaUI` do formulário (Task 8). `ErroValidacao[]` sai da edge como `{ erros }` e é consumido campo a campo pelo formulário. `exigirModulo` (Task 5) é usado idêntico na Task 6. `ProdutoComSaldo` (Task 7) alimenta a tela e o dialog de entrada.
- **Risco conhecido e sinalizado:** o `select` de `fetchProdutosComSaldo` (Task 7 Step 3) traz todas as famílias de cada `codigo_pai`, não só a mais recente. Para org do módulo isso é inofensivo (um produto = uma família), mas para org de planilha com N lotes duplicaria variação. O passo carrega o aviso e a instrução de validar com dados reais antes de fechar.
