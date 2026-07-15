# Menus multi-marketplace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preparar toda a UI do PubliAI para 5 marketplaces (ML ativo; Shopee/Magalu/Amazon/Casas Bahia "em breve"), com registry único no frontend + habilitação por org no banco, tabs de canal globais persistidas e tela "Canais" no sidebar.

**Architecture:** Registry estático (`src/lib/canais.ts`) desenha tabs/cards/badges; `organizations.canais_habilitados` (text[]) controla rollout por org; seletor global `useCanalAtivo` vive em `?canal=` + sessionStorage. Backend multicanal já existe (E6/E7) — este plano é UI + 1 migration aditiva + 1 edge ajustada. Spec: `docs/superpowers/specs/2026-07-14-menus-multicanal-design.md`.

**Tech Stack:** React 18 + Vite + TypeScript, react-router (HashRouter), TanStack Query, shadcn/ui (Tabs/Tooltip/Badge/Card), Tailwind, Vitest, Supabase (Postgres/RLS/Edge Functions Deno).

## Global Constraints

- Trabalhar no worktree `worktree-menus-multicanal` (já existe, spec commitada). NUNCA editar a main.
- Testes: `pnpm test` (vitest; exige `.env.test` na raiz — sem ele `supabase.ts` lança no boot).
- Migrations: **só** `supabase migration new <nome>` + editar o arquivo gerado. NUNCA `apply_migration`/painel (ADR-0043). `supabase db push` fica para o Diego aprovar no final.
- Edge functions alteradas (`usuarios`) NÃO são deployadas pelo executor — deploy via CLI fica para o Diego no final.
- Copy da UI em pt-BR com acentuação correta. Tudo funciona em light+dark (usar tokens `text-muted-foreground`, `bg-card` etc. — nunca cor fixa exceto `corMarca`).
- Não inventar dados de canais: capabilities só onde há fato conhecido (ML). Logos oficiais NÃO são desenhados — usar monograma colorido (placeholder trocável).
- Nada de `grep -R` sem escopo; buscar sempre com caminho (`src/`, `supabase/functions/`).
- Commit ao fim de cada task (mensagens `feat:`/`chore:`/`docs:` como no histórico). Sem push/PR — Diego valida local primeiro.
- Com apenas o ML conectado, **nenhum número de nenhuma tela pode mudar** — só aparecem as tabs/vitrine novas.

---

### Task 1: Registry de canais (`src/lib/canais.ts`) + testes

**Files:**
- Create: `src/lib/canais.ts`
- Test: `src/lib/__tests__/canais.test.ts`

**Interfaces:**
- Produces: `CanalId`, `CanalInfo`, `CANAIS`, `LISTA_CANAIS`, `infoCanal(id: string): CanalInfo | null`, `canaisOperaveis(habilitados: string[]): CanalInfo[]`, `canaisEmBreve(habilitados: string[]): CanalInfo[]`, `contrasteTexto(hex: string): '#000000' | '#ffffff'` — consumidos por todas as tasks seguintes.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/canais.test.ts
import { describe, it, expect } from 'vitest';
import {
  CANAIS, LISTA_CANAIS, infoCanal, canaisOperaveis, canaisEmBreve, contrasteTexto,
} from '@/lib/canais';

describe('registry de canais', () => {
  it('tem os 5 marketplaces, só ML ativo', () => {
    expect(LISTA_CANAIS.map((c) => c.id)).toEqual([
      'mercado_livre', 'shopee', 'magalu', 'amazon', 'casas_bahia',
    ]);
    expect(CANAIS.mercado_livre.status).toBe('ativo');
    expect(LISTA_CANAIS.filter((c) => c.status === 'em_breve')).toHaveLength(4);
  });

  it('infoCanal devolve o canal ou null para id desconhecido', () => {
    expect(infoCanal('mercado_livre')?.nome).toBe('Mercado Livre');
    expect(infoCanal('aliexpress')).toBeNull();
  });

  it('canaisOperaveis = habilitados na org E ativos no registry', () => {
    expect(canaisOperaveis(['mercado_livre']).map((c) => c.id)).toEqual(['mercado_livre']);
    // shopee habilitada na org mas em_breve no registry → não operável
    expect(canaisOperaveis(['mercado_livre', 'shopee']).map((c) => c.id)).toEqual(['mercado_livre']);
    expect(canaisOperaveis([])).toEqual([]);
  });

  it('canaisEmBreve = todo o resto do registry (em_breve OU não habilitado)', () => {
    expect(canaisEmBreve(['mercado_livre']).map((c) => c.id)).toEqual([
      'shopee', 'magalu', 'amazon', 'casas_bahia',
    ]);
  });

  it('só o ML tem capabilities (não inventamos limites dos demais)', () => {
    expect(CANAIS.mercado_livre.capabilities?.tituloMax).toBe(60);
    expect(CANAIS.shopee.capabilities).toBeUndefined();
  });

  it('contrasteTexto escolhe texto legível sobre a cor da marca', () => {
    expect(contrasteTexto('#FFE600')).toBe('#000000'); // amarelo ML → texto preto
    expect(contrasteTexto('#EE4D2D')).toBe('#ffffff'); // laranja Shopee → texto branco
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/__tests__/canais.test.ts`
Expected: FAIL — `Cannot find module '@/lib/canais'` (ou equivalente).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/canais.ts
// Registry dos marketplaces (spec 2026-07-14-menus-multicanal). Fonte única que desenha
// tabs, cards e badges em toda a UI. Marketplace novo = 1 entrada aqui.
// Visibilidade POR ORG vem de organizations.canais_habilitados (D5): operável = habilitado E ativo.

export type CanalId = 'mercado_livre' | 'shopee' | 'magalu' | 'amazon' | 'casas_bahia';

export interface CapabilitiesCanal {
  /** Limite de caracteres do título no canal. */
  tituloMax: number;
}

export interface CanalInfo {
  id: CanalId;
  nome: string;
  /** Cor oficial da marca (hex) — badges, tabs e gráficos. */
  corMarca: string;
  /** Monograma exibido enquanto não houver logo SVG oficial (asset a adicionar depois). */
  monograma: string;
  status: 'ativo' | 'em_breve';
  /** Só canais implementados têm capabilities — não inventamos limites de canal futuro. */
  capabilities?: CapabilitiesCanal;
}

export const CANAIS: Record<CanalId, CanalInfo> = {
  mercado_livre: {
    id: 'mercado_livre', nome: 'Mercado Livre', corMarca: '#FFE600', monograma: 'ML',
    status: 'ativo', capabilities: { tituloMax: 60 },
  },
  shopee: { id: 'shopee', nome: 'Shopee', corMarca: '#EE4D2D', monograma: 'SH', status: 'em_breve' },
  magalu: { id: 'magalu', nome: 'Magazine Luiza', corMarca: '#0086FF', monograma: 'MG', status: 'em_breve' },
  amazon: { id: 'amazon', nome: 'Amazon', corMarca: '#FF9900', monograma: 'AZ', status: 'em_breve' },
  casas_bahia: { id: 'casas_bahia', nome: 'Casas Bahia', corMarca: '#0F38A8', monograma: 'CB', status: 'em_breve' },
};

export const LISTA_CANAIS: CanalInfo[] = Object.values(CANAIS);

export function infoCanal(id: string): CanalInfo | null {
  return (CANAIS as Record<string, CanalInfo>)[id] ?? null;
}

/** Canais que a org pode operar hoje: habilitados para ela E ativos no registry. */
export function canaisOperaveis(habilitados: string[]): CanalInfo[] {
  return LISTA_CANAIS.filter((c) => c.status === 'ativo' && habilitados.includes(c.id));
}

/** Vitrine "Em breve" da org: em_breve no registry OU ativo-mas-não-habilitado (D5). */
export function canaisEmBreve(habilitados: string[]): CanalInfo[] {
  return LISTA_CANAIS.filter((c) => c.status !== 'ativo' || !habilitados.includes(c.id));
}

/** Preto ou branco conforme a luminância da cor de fundo (WCAG aproximado). */
export function contrasteTexto(hex: string): '#000000' | '#ffffff' {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 150 ? '#000000' : '#ffffff';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/__tests__/canais.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/canais.ts src/lib/__tests__/canais.test.ts
git commit -m "feat(canais): registry dos 5 marketplaces (fonte única da UI multicanal)"
```

---

### Task 2: Canal ativo global — lib pura + hook (`?canal=` + sessão)

**Files:**
- Create: `src/lib/canal-ativo.ts`
- Create: `src/hooks/useCanalAtivo.ts`
- Test: `src/lib/__tests__/canal-ativo.test.ts`

**Interfaces:**
- Consumes: `canaisOperaveis` (Task 1); `useCanaisHabilitados` (Task 4 — até lá o hook compila com o fallback `['mercado_livre']` do próprio useQuery, ver Step 3).
- Produces: `type CanalAtivo = 'todos' | CanalId`; `parseCanalAtivo(v: string | null, operaveis: string[]): CanalAtivo`; hook `useCanalAtivo(): { canal: CanalAtivo; setCanal: (c: CanalAtivo) => void; habilitados: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/canal-ativo.test.ts
import { describe, it, expect } from 'vitest';
import { parseCanalAtivo } from '@/lib/canal-ativo';

describe('parseCanalAtivo', () => {
  const operaveis = ['mercado_livre'];
  it('aceita canal operável', () => {
    expect(parseCanalAtivo('mercado_livre', operaveis)).toBe('mercado_livre');
  });
  it('lixo, canal não-operável ou ausente → todos (fallback silencioso)', () => {
    expect(parseCanalAtivo(null, operaveis)).toBe('todos');
    expect(parseCanalAtivo('xpto', operaveis)).toBe('todos');
    expect(parseCanalAtivo('shopee', operaveis)).toBe('todos'); // em_breve não filtra dados
    expect(parseCanalAtivo('todos', operaveis)).toBe('todos');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/__tests__/canal-ativo.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Write minimal implementation (lib + hook)**

```ts
// src/lib/canal-ativo.ts
import type { CanalId } from '@/lib/canais';

export type CanalAtivo = 'todos' | CanalId;

/** Valida o valor de ?canal= contra os canais operáveis da org. Lixo/não-operável → 'todos'. */
export function parseCanalAtivo(v: string | null, operaveis: string[]): CanalAtivo {
  if (v && operaveis.includes(v)) return v as CanalId;
  return 'todos';
}
```

```ts
// src/hooks/useCanalAtivo.ts
import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { canaisOperaveis } from '@/lib/canais';
import { parseCanalAtivo, type CanalAtivo } from '@/lib/canal-ativo';
import { useCanaisHabilitados } from '@/hooks/useCanaisHabilitados';

const CHAVE_SESSAO = 'publiai:canal-ativo';

/**
 * Canal ativo GLOBAL (D3): vive em ?canal= (deep-link, padrão da Publicados/Onda 2) e
 * persiste em sessionStorage para seguir o operador entre telas. Default 'todos'.
 */
export function useCanalAtivo() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: habilitados = ['mercado_livre'] } = useCanaisHabilitados();
  const operaveis = useMemo(() => canaisOperaveis(habilitados).map((c) => c.id as string), [habilitados]);
  const canal = parseCanalAtivo(searchParams.get('canal'), operaveis);

  // Sem ?canal na URL, restaura a escolha da sessão (replace: não empilha histórico).
  useEffect(() => {
    if (searchParams.get('canal')) return;
    const salvo = sessionStorage.getItem(CHAVE_SESSAO);
    if (salvo && parseCanalAtivo(salvo, operaveis) !== 'todos') {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set('canal', salvo);
        return p;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams, operaveis]);

  const setCanal = useCallback((novo: CanalAtivo) => {
    if (novo === 'todos') sessionStorage.removeItem(CHAVE_SESSAO);
    else sessionStorage.setItem(CHAVE_SESSAO, novo);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (novo === 'todos') p.delete('canal');
      else p.set('canal', novo);
      return p;
    }, { replace: true });
  }, [setSearchParams]);

  return { canal, setCanal, habilitados };
}
```

Nota: `useCanaisHabilitados` só existe na Task 4. Para esta task compilar isolada, crie já o
arquivo stub `src/hooks/useCanaisHabilitados.ts` com o conteúdo REAL da Task 4 Step 4 (ele é
pequeno e não depende da migration para compilar — a RPC só falha em runtime até a migration
rodar, e o fallback `= ['mercado_livre']` cobre).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/__tests__/canal-ativo.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck e commit**

Run: `pnpm build` — Expected: sem erro de TS.

```bash
git add src/lib/canal-ativo.ts src/hooks/useCanalAtivo.ts src/hooks/useCanaisHabilitados.ts src/lib/__tests__/canal-ativo.test.ts
git commit -m "feat(canais): canal ativo global (?canal= + sessão) com fallback 'todos'"
```

---

### Task 3: Componentes `LogoCanal`/`CanalBadge` e `CanalTabs`

**Files:**
- Create: `src/components/canal-badge.tsx`
- Create: `src/components/canal-tabs.tsx`

**Interfaces:**
- Consumes: `CANAIS`, `infoCanal`, `canaisOperaveis`, `canaisEmBreve`, `contrasteTexto` (Task 1); `CanalAtivo` (Task 2); `Tabs/TabsList/TabsTrigger` de `@/components/ui/tabs`; `Tooltip` de `@/components/ui/tooltip`; `Badge` de `@/components/ui/badge`.
- Produces: `<LogoCanal canal className? />`, `<CanalBadge canal className? />`, `<CanalTabs canal onCanal habilitados contadores? className? />` — usados nas Tasks 6–12.

- [ ] **Step 1: Verificar a API do Tooltip do projeto**

Run: `sed -n '1,40p' src/components/ui/tooltip.tsx`
Se o arquivo exportar `TooltipProvider` e NÃO houver provider global (confira com
`grep -rn "TooltipProvider" src/components/app-shell.tsx src/main.tsx src/App.tsx`),
envolva o conteúdo do `CanalTabs` num `<TooltipProvider delayDuration={200}>` local, como abaixo.

- [ ] **Step 2: Criar os componentes**

```tsx
// src/components/canal-badge.tsx
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CANAIS, infoCanal, contrasteTexto, type CanalId } from '@/lib/canais';

/**
 * Monograma colorido do canal (placeholder de logo). Quando houver SVG oficial em
 * src/assets/canais/<id>.svg, trocar só aqui — a API não muda.
 */
export function LogoCanal({ canal, className }: { canal: CanalId; className?: string }) {
  const info = CANAIS[canal];
  return (
    <span
      aria-hidden
      className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold leading-none', className)}
      style={{ backgroundColor: info.corMarca, color: contrasteTexto(info.corMarca) }}
    >
      {info.monograma}
    </span>
  );
}

/** Chip logo+nome do canal — linhas de tabela, cards e selects. */
export function CanalBadge({ canal, className }: { canal: string; className?: string }) {
  const info = infoCanal(canal);
  if (!info) return <Badge variant="outline" className={className}>{canal}</Badge>;
  return (
    <Badge variant="outline" className={cn('gap-1 font-normal', className)}>
      <LogoCanal canal={info.id} className="h-3.5 w-3.5" />
      {info.nome}
    </Badge>
  );
}
```

```tsx
// src/components/canal-tabs.tsx
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { canaisOperaveis, canaisEmBreve } from '@/lib/canais';
import { LogoCanal } from '@/components/canal-badge';
import type { CanalAtivo } from '@/lib/canal-ativo';

/**
 * Barra global de canais (D2): "Todos" + canais operáveis + em-breve desabilitados
 * com tooltip. Controlado — as telas ligam em useCanalAtivo().
 */
export function CanalTabs({ canal, onCanal, habilitados, contadores, className }: {
  canal: CanalAtivo;
  onCanal: (c: CanalAtivo) => void;
  habilitados: string[];
  /** Contador opcional por canal (ex.: nº de anúncios) exibido na tab. */
  contadores?: Record<string, number>;
  className?: string;
}) {
  const operaveis = canaisOperaveis(habilitados);
  const emBreve = canaisEmBreve(habilitados);
  return (
    <Tabs value={canal} onValueChange={(v) => onCanal(v as CanalAtivo)} className={className}>
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="todos">Todos</TabsTrigger>
        {operaveis.map((c) => (
          <TabsTrigger key={c.id} value={c.id} className="gap-1.5">
            <LogoCanal canal={c.id} />
            {c.nome}
            {contadores?.[c.id] != null && (
              <Badge variant="secondary" className="ml-0.5">{contadores[c.id]}</Badge>
            )}
          </TabsTrigger>
        ))}
        <TooltipProvider delayDuration={200}>
          {emBreve.map((c) => (
            <Tooltip key={c.id}>
              <TooltipTrigger asChild>
                {/* span: trigger desabilitado não dispara tooltip sem wrapper */}
                <span className="inline-flex">
                  <TabsTrigger value={c.id} disabled className="gap-1.5 opacity-50 grayscale">
                    <LogoCanal canal={c.id} />
                    {c.nome}
                  </TabsTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent>Em breve no PubliAI</TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </TabsList>
    </Tabs>
  );
}
```

- [ ] **Step 3: Verificar build**

Run: `pnpm build`
Expected: sem erro. (Componentes ainda sem call site — ok, entram nas Tasks 6–12.)

- [ ] **Step 4: Commit**

```bash
git add src/components/canal-badge.tsx src/components/canal-tabs.tsx
git commit -m "feat(canais): CanalBadge (monograma da marca) e CanalTabs (Todos + em-breve)"
```

---

### Task 4: Migration aditiva + RPC + hook `useCanaisHabilitados` + types

**Files:**
- Create: `supabase/migrations/<timestamp>_menus_multicanal.sql` (via CLI)
- Create/confirm: `src/hooks/useCanaisHabilitados.ts` (stub criado na Task 2 — conferir conteúdo)
- Modify: `src/lib/database.types.ts:992-1020` (organizations) e `:756` (ml_vendas) — aditivo
- Modify: `src/lib/queries.ts:31` (chave QK)

**Interfaces:**
- Produces: coluna `organizations.canais_habilitados text[]`, coluna `ml_vendas.canal text`, RPC `canais_habilitados_da_org() returns text[]`; hook `useCanaisHabilitados(): UseQueryResult<string[]>`; `QK.canaisHabilitados`.

- [ ] **Step 1: Criar a migration**

Run: `supabase migration new menus_multicanal`
Edite o arquivo gerado em `supabase/migrations/`:

```sql
-- Menus multi-marketplace (spec 2026-07-14). Tudo aditivo e reversível.

-- D5: rollout por org — quais canais a empresa enxerga como conectáveis.
alter table organizations
  add column canais_habilitados text[] not null default '{mercado_livre}';

-- Dimensão canal nas vendas (preparação; hoje tudo é ML — nenhum número muda).
alter table ml_vendas
  add column canal text not null default 'mercado_livre';

-- Leitura estreita dos canais da própria org (evita abrir SELECT em organizations).
create or replace function canais_habilitados_da_org()
returns text[]
language sql stable security definer
set search_path = public
as $$
  select canais_habilitados from organizations where id = current_org_id()
$$;
revoke all on function canais_habilitados_da_org() from public;
grant execute on function canais_habilitados_da_org() to authenticated;

-- Menu novo 'canais': quem tem 'configuracoes' ganha acesso (backfill idempotente).
update profiles
  set allowed_menus = array_append(allowed_menus, 'canais')
  where 'configuracoes' = any(allowed_menus)
    and not ('canais' = any(allowed_menus));
```

- [ ] **Step 2: Validar a migration localmente**

Run: `supabase db reset` (usa o stack local) e depois `npm run db:check`
Expected: reset aplica todas as migrations sem erro; db:check OK.
Se o ambiente local não estiver disponível, valide ao menos com `supabase db lint` e registre no relato da task que o reset ficou pendente.

- [ ] **Step 3: Types aditivos**

Em `src/lib/database.types.ts`:
- No bloco `organizations` (linha ~992): adicionar `canais_habilitados: string[]` no `Row`, e `canais_habilitados?: string[]` em `Insert`/`Update`.
- No bloco `ml_vendas` (linha ~756): adicionar `canal: string` no `Row` e `canal?: string` em `Insert`/`Update`.
- No bloco `Functions` (perto de `desfazer_saque_ml_vendas`, linha ~1204), adicionar:

```ts
canais_habilitados_da_org: { Args: Record<PropertyKey, never>; Returns: string[] }
```

- [ ] **Step 4: Hook + chave de query**

Em `src/lib/queries.ts` linha 31, junto de `conexoes: ['conexoes'] as const,` adicionar:

```ts
canaisHabilitados: ['canais-habilitados'] as const,
```

Conteúdo definitivo de `src/hooks/useCanaisHabilitados.ts` (substitui/confirma o stub da Task 2):

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queries';

/** Canais habilitados para a org (D5) — editados pelo super-admin em /admin. */
export function useCanaisHabilitados() {
  return useQuery<string[]>({
    queryKey: QK.canaisHabilitados,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('canais_habilitados_da_org');
      if (error) throw error;
      return data ?? ['mercado_livre'];
    },
  });
}
```

- [ ] **Step 5: Build + testes + commit**

Run: `pnpm build && pnpm test`
Expected: PASS (nada consome a coluna ainda).

```bash
git add supabase/migrations src/lib/database.types.ts src/lib/queries.ts src/hooks/useCanaisHabilitados.ts
git commit -m "feat(canais): canais_habilitados por org + ml_vendas.canal + RPC (migration aditiva)"
```

---

### Task 5: Menu key `canais` (permissões) — frontend + edge `usuarios`

**Files:**
- Modify: `src/lib/menus.ts:1` (MENU_KEYS) e `:18-31` (PREFIX)
- Modify: `src/pages/Usuarios.tsx:20` (MENU_LABEL)
- Modify: `supabase/functions/usuarios/index.ts:6` (MENU_KEYS da edge)
- Test: testes existentes de menus (localize com `grep -rln "visibleMenus" src/lib/__tests__ src/test 2>/dev/null`)

**Interfaces:**
- Produces: `'canais'` como `MenuKey` válido; rota `/canais` mapeada no guard.

- [ ] **Step 1: Atualizar `src/lib/menus.ts`**

```ts
export const MENU_KEYS = ['dashboard', 'lotes', 'revisao', 'publicados', 'faturamento', 'financeiro', 'viabilidade', 'canais', 'configuracoes'] as const;
```

E no mapa `PREFIX`, adicionar a linha (junto de `configuracoes`):

```ts
  canais: 'canais',
```

- [ ] **Step 2: Rótulo na tela Usuários**

Em `src/pages/Usuarios.tsx:20`, no `MENU_LABEL`, adicionar:

```ts
  canais: 'Canais',
```

- [ ] **Step 3: Edge `usuarios` reconhece o menu**

Em `supabase/functions/usuarios/index.ts:6`:

```ts
const MENU_KEYS = ['dashboard', 'lotes', 'revisao', 'publicados', 'faturamento', 'financeiro', 'viabilidade', 'canais', 'configuracoes'];
```

- [ ] **Step 4: Rodar testes e corrigir expectativas**

Run: `pnpm test`
Se algum teste asserta a lista de menus (ex.: `visibleMenus`), atualize a expectativa para
incluir `'canais'` na posição correspondente (a mudança é essa, intencional).
Run: `deno check supabase/functions/usuarios/index.ts` — Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add src/lib/menus.ts src/pages/Usuarios.tsx supabase/functions/usuarios/index.ts src/lib/__tests__ src/test 2>/dev/null || true
git commit -m "feat(canais): menu key 'canais' no sistema de permissões (front + edge usuarios)"
```

---

### Task 6: Tela `/canais` + item no sidebar + OAuth migrado

**Files:**
- Create: `src/pages/Canais.tsx`
- Modify: `src/App.tsx:22-29` (lazy import) e `:44-60` (rota)
- Modify: `src/components/sidebar.tsx:8-18` (NAV_ITEMS)
- Modify: `src/pages/Configuracoes.tsx` (remove card ML, redireciona params OAuth, link para /canais)

**Interfaces:**
- Consumes: `useCanaisHabilitados`, `canaisOperaveis`/`canaisEmBreve`/`LISTA_CANAIS` (Task 1), `LogoCanal` (Task 3), `useMlConnection` (existente), `fetchConexoes`/`QK.conexoes` (existente, `src/lib/queries.ts:727`), `iniciarConexaoML`/`desconectarML` (`src/lib/ml-oauth.ts`).
- Produces: rota `/canais` funcional; Configurações sem card ML.

- [ ] **Step 1: Criar `src/pages/Canais.tsx`**

```tsx
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import { LISTA_CANAIS, canaisOperaveis, type CanalInfo } from '@/lib/canais';
import { LogoCanal } from '@/components/canal-badge';
import { useCanaisHabilitados } from '@/hooks/useCanaisHabilitados';
import { useMlConnection } from '@/hooks/useMlConnection';
import { QK, fetchConexoes } from '@/lib/queries';
import { iniciarConexaoML, desconectarML } from '@/lib/ml-oauth';

/** Vitrine + gestão de canais (D4): card por marketplace do registry. */
export default function Canais() {
  const { data: habilitados = ['mercado_livre'] } = useCanaisHabilitados();
  const { data: conexoes = [] } = useQuery({ queryKey: QK.conexoes, queryFn: fetchConexoes });
  const { data: conexaoML, isLoading: carregandoML } = useMlConnection();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  // Retorno do OAuth do ML (o callback redireciona com estes params — ver Configurações).
  const mlConectado = searchParams.get('ml_conectado') === 'true';
  const mlErro = searchParams.get('ml_erro');

  const operaveis = new Set(canaisOperaveis(habilitados).map((c) => c.id));
  const conectados = new Set(conexoes.map((c) => c.canal));

  async function handleConectar(canal: CanalInfo) {
    setErroAcao(null);
    try {
      if (canal.id === 'mercado_livre') await iniciarConexaoML();
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Falha ao conectar');
    }
  }

  async function handleDesconectarML() {
    setErroAcao(null);
    try {
      await desconectarML();
      await qc.invalidateQueries({ queryKey: ['ml-connection'] });
      await qc.invalidateQueries({ queryKey: QK.conexoes });
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Falha ao desconectar');
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Canais"
        subtitle="Marketplaces integrados ao PubliAI — conecte sua conta e publique da mesma planilha."
      />

      {!carregandoML && mlConectado && conexaoML?.conectado && (
        <p className="mb-4 rounded border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          Conta do Mercado Livre conectada com sucesso.
        </p>
      )}
      {mlErro && (
        <p className="mb-4 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {mlErro === 'state'
            ? 'Sessão de conexão expirou. Tente conectar de novo.'
            : 'Não foi possível conectar ao Mercado Livre. Tente de novo.'}
        </p>
      )}
      {erroAcao && (
        <p className="mb-4 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{erroAcao}</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LISTA_CANAIS.map((c) => {
          const operavel = operaveis.has(c.id);
          const conectado = c.id === 'mercado_livre' ? !!conexaoML?.conectado : conectados.has(c.id);
          return (
            <Card
              key={c.id}
              className={cn('flex flex-col gap-3 p-4', !operavel && 'opacity-70')}
              style={{ borderTop: `3px solid ${c.corMarca}` }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LogoCanal canal={c.id} className={cn('h-8 w-8 text-xs', !operavel && 'grayscale')} />
                  <span className="text-sm font-semibold">{c.nome}</span>
                </div>
                {!operavel ? (
                  <StatusPill tone="neutral">Em breve</StatusPill>
                ) : conectado ? (
                  <StatusPill tone="success">Conectado</StatusPill>
                ) : (
                  <StatusPill tone="warning">Não conectado</StatusPill>
                )}
              </div>

              {!operavel ? (
                <p className="text-xs text-muted-foreground">
                  Integração em desenvolvimento — em breve no PubliAI.
                </p>
              ) : c.id === 'mercado_livre' ? (
                carregandoML ? (
                  <span className="text-sm text-muted-foreground">Carregando…</span>
                ) : conexaoML?.conectado ? (
                  <div className="flex flex-col gap-2 text-sm">
                    <span>como <strong>{conexaoML.nickname ?? conexaoML.mlUserId}</strong></span>
                    <span className="truncate text-xs text-muted-foreground" title={conexaoML.scope ?? 'não informado'}>
                      Escopo OAuth: {conexaoML.scope ?? 'não informado'}
                    </span>
                    <Button variant="outline" size="sm" className="self-start" onClick={handleDesconectarML}>
                      Desconectar
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Nenhuma conta conectada.</span>
                    <Button size="sm" onClick={() => handleConectar(c)}>Conectar</Button>
                  </div>
                )
              ) : (
                <p className="text-xs text-muted-foreground">Canal habilitado — conector chega no lançamento.</p>
              )}
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        As demais configurações do app continuam em <Link to="/configuracoes" className="underline">Configurações</Link>.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Rota + lazy import em `src/App.tsx`**

Junto dos demais lazy (linha ~22):

```ts
const Canais = lazy(() => import('@/pages/Canais'));
```

Dentro do bloco `<Route element={<MenuGuard />}>` (junto de `/configuracoes`, linha ~51):

```tsx
            <Route path="/canais" element={<Canais />} />
```

- [ ] **Step 3: Item no sidebar (`src/components/sidebar.tsx:8-18`)**

Adicionar `Plug` ao import do lucide-react e a entrada em `NAV_ITEMS`, entre Viabilidade e Configurações:

```ts
  { to: '/canais', label: 'Canais', icon: Plug, end: false, key: 'canais' },
```

- [ ] **Step 4: Configurações — remover card ML, redirecionar OAuth, linkar**

Em `src/pages/Configuracoes.tsx`:
1. O callback OAuth (`supabase/functions/ml-oauth-callback/index.ts:5`) redireciona **fixo** para
   `/#/configuracoes` — NÃO mexer na edge. Adicionar no topo do componente (depois dos hooks):

```tsx
  // OAuth do ML retorna para /configuracoes (URL fixa na edge) — o card agora mora em /canais.
  if (searchParams.get('ml_conectado') || searchParams.get('ml_erro')) {
    return <Navigate to={{ pathname: '/canais', search: searchParams.toString() }} replace />;
  }
```

   Importar `Navigate` de `react-router-dom` (junto de `useSearchParams`).
2. Remover o `<Card>` inteiro do Mercado Livre (linhas 96–157) e os imports/estados/handlers que
   ficarem órfãos com a remoção: `useMlConnection`, `iniciarConexaoML`/`desconectarML`,
   `useQueryClient`, `StatusPill`, `ChevronRight`, `erroAcao`, `mlConectado`, `mlErro`,
   `handleConectar`, `handleDesconectar` (confira com `pnpm lint` — nada de deixar import morto).
   ATENÇÃO: `searchParams` continua usado pelo redirect acima.
3. No lugar do card removido, deixar um card-link mínimo:

```tsx
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Canais conectados</h2>
              <p className="text-xs text-muted-foreground">Mercado Livre e próximos marketplaces agora ficam no menu Canais.</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/canais">Gerenciar canais</Link>
            </Button>
          </div>
        </Card>
```

   Importar `Link` de `react-router-dom`.

- [ ] **Step 5: Verificar e commitar**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: tudo PASS, sem import órfão.

```bash
git add src/pages/Canais.tsx src/App.tsx src/components/sidebar.tsx src/pages/Configuracoes.tsx
git commit -m "feat(canais): tela /canais no sidebar (cards por marketplace) + OAuth ML migrado"
```

---

### Task 7: Vendas com dimensão canal (`buscarVendas`/`useVendas`/`useResumoVendas`)

**Files:**
- Modify: `src/lib/faturamento.ts:66` (buscarVendas) e o tipo `Venda` no mesmo arquivo
- Modify: `src/hooks/useVendas.ts:5-16`
- Modify: `src/hooks/useResumoVendas.ts:13-40`
- Test: `src/lib/__tests__/faturamento.test.ts` (só se quebrar — a mudança é aditiva)

**Interfaces:**
- Consumes: coluna `ml_vendas.canal` (Task 4); `CanalAtivo` (Task 2).
- Produces: `buscarVendas(janela, origem?, canal?: CanalAtivo)`; `useVendas(janela, origem, canal?: CanalAtivo)`; `useResumoVendas(janela, canal?: CanalAtivo)`. Default `'todos'` em todos → **call sites existentes compilam sem mudança e nenhum número muda**.

- [ ] **Step 1: Ler a função atual**

Run: `sed -n '40,110p' src/lib/faturamento.ts`
Entenda onde o select e os filtros da query são montados e onde `Venda` é tipado.

- [ ] **Step 2: Adicionar o parâmetro e o filtro**

Em `buscarVendas` (assinatura na linha 66):

```ts
import type { CanalAtivo } from '@/lib/canal-ativo';

export async function buscarVendas(janela: Janela, origem: OrigemVenda = 'todos', canal: CanalAtivo = 'todos'): Promise<Venda[]> {
```

No ponto onde a query encadeia filtros de janela/origem, acrescentar:

```ts
  if (canal !== 'todos') query = query.eq('canal', canal);
```

Adicionar `'canal'` à lista de colunas do select (se o select for `'*'`, nada a fazer) e ao tipo:

```ts
  /** Canal de origem da venda (hoje sempre 'mercado_livre'). */
  canal?: string;
```

no `interface Venda` (ou type equivalente) do mesmo arquivo, mapeando `canal: r.canal` onde as linhas são convertidas (siga o padrão dos campos vizinhos).

- [ ] **Step 3: Threading nos hooks**

`src/hooks/useVendas.ts`:

```ts
import type { CanalAtivo } from '@/lib/canal-ativo';

export function useVendas(janela: Janela, origem: OrigemVenda, canal: CanalAtivo = 'todos') {
  return useQuery<Venda[]>({
    queryKey: ['vendas', janela.desde, janela.ate, origem, canal],
    queryFn: () => buscarVendas(janela, origem, canal),
    // ... resto idêntico ao atual (staleTime, refetchInterval, refetchOnWindowFocus)
  });
}
```

`src/hooks/useResumoVendas.ts`: assinatura vira
`export function useResumoVendas(janela: Janela, canal: CanalAtivo = 'todos')` e a linha interna vira
`const vendasQ = useVendas(janela, 'todos', canal);` (importar o tipo).

- [ ] **Step 4: Verificar**

Run: `pnpm build && pnpm test`
Expected: PASS — defaults preservam todos os call sites (Dashboard, Financeiro, Publicados, DetalheVendas, DetalheFinanceiro).

- [ ] **Step 5: Commit**

```bash
git add src/lib/faturamento.ts src/hooks/useVendas.ts src/hooks/useResumoVendas.ts
git commit -m "feat(canais): dimensão canal em buscarVendas/useVendas/useResumoVendas (default 'todos')"
```

---

### Task 8: Publicados — CanalTabs, badge sempre visível, filtro por canal

**Files:**
- Modify: `src/pages/Publicados.tsx` (linhas indicadas abaixo)
- Delete: `src/lib/canais-ui.ts` — **ainda não** (Revisão também importa; deleção é na Task 10)

**Interfaces:**
- Consumes: `CanalTabs`, `CanalBadge`, `useCanalAtivo` (Tasks 2–3).
- Produces: tela Publicados filtrada pelo canal global; contadores por canal nas tabs.

- [ ] **Step 1: Trocar imports (linha 40)**

Remover `import { deveMostrarChipCanal } from '@/lib/canais-ui';` e adicionar:

```ts
import { CanalTabs } from '@/components/canal-tabs';
import { CanalBadge } from '@/components/canal-badge';
import { useCanalAtivo } from '@/hooks/useCanalAtivo';
```

- [ ] **Step 2: Badge sempre visível na linha**

1. Em `LinhaProps` (linha ~114): remover o campo `mostrarChipCanal` (e o comentário acima dele).
2. Remover `const NOME_CANAL: Record<string, string> = { mercado_livre: 'Mercado Livre' };` (linha 125).
3. Na assinatura de `LinhaTabela` (linha 149), remover `mostrarChipCanal` da desestruturação.
4. No JSX (linhas 182–186), trocar o bloco condicional por (sempre renderiza — D6):

```tsx
            <CanalBadge canal={item.canal ?? 'mercado_livre'} className="mt-1" />
```

- [ ] **Step 3: Canal ativo + contadores + filtro no componente principal**

1. Dentro de `Publicados()` (após a linha 378 `const { isAdmin } = useProfile();`):

```ts
  const { canal: canalAtivo, setCanal, habilitados } = useCanalAtivo();
```

2. Trocar a linha 383 para o KPI respeitar o canal:

```ts
  const { data: vendas, isFetching: fetchingMetricas, error: erroVendas, refetch: refetchMetricas } = useVendas(janela, 'todos', canalAtivo);
```

3. Remover o memo `mostrarChipCanal` (linhas 479–484) e substituir por:

```ts
  // Recorte da tela pelo canal global (D2/D3). Contadores por canal para as tabs.
  const contadoresCanal = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of merged) {
      const c = i.canal ?? 'mercado_livre';
      m[c] = (m[c] ?? 0) + 1;
    }
    return m;
  }, [merged]);
  const doCanal = useMemo(
    () => (canalAtivo === 'todos' ? merged : merged.filter((i) => (i.canal ?? 'mercado_livre') === canalAtivo)),
    [merged, canalAtivo],
  );
```

4. Trocar as bases de `totalModerados` (linha 486) e `itensExibidos` (linha 491) de `merged` → `doCanal`, e o `todosItens: merged` do export (linha 542) → `todosItens: doCanal`, e `itens={merged}` do `DashboardPublicados` (linha 665) → `itens={doCanal}`.
5. Renderizar as tabs logo APÓS o `<PageHeader …/>` (após a linha 588):

```tsx
      <CanalTabs
        canal={canalAtivo}
        onCanal={setCanal}
        habilitados={habilitados}
        contadores={contadoresCanal}
        className="mb-4"
      />
```

6. Na `LinhaTabela` do map (linha ~766), remover a prop `mostrarChipCanal={mostrarChipCanal}`.

- [ ] **Step 4: Verificar**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: PASS. Teste manual (se dev server disponível): com 1 canal, tab "Todos" + "Mercado Livre (N)" + 4 tabs cinza "em breve"; números idênticos aos de antes em "Todos" e em "Mercado Livre".

- [ ] **Step 5: Commit**

```bash
git add src/pages/Publicados.tsx
git commit -m "feat(canais): Publicados com CanalTabs, badge de canal sempre visível e filtro global"
```

---

### Task 9: Dashboard, Financeiro e Faturamento com CanalTabs

**Files:**
- Modify: `src/pages/Dashboard.tsx` (topo do componente + hooks de vendas)
- Modify: `src/pages/Financeiro.tsx:45-50` e JSX após o PageHeader
- Modify: `src/pages/Faturamento.tsx` (página inteira é pequena)

**Interfaces:**
- Consumes: `useCanalAtivo`, `CanalTabs` (Tasks 2–3), params de canal (Task 7).

- [ ] **Step 1: Financeiro**

Em `src/pages/Financeiro.tsx`:

```ts
import { CanalTabs } from '@/components/canal-tabs';
import { useCanalAtivo } from '@/hooks/useCanalAtivo';
```

Dentro de `Financeiro()` (linha ~46):

```ts
  const { canal: canalAtivo, setCanal, habilitados } = useCanalAtivo();
```

Trocar as duas chamadas (linhas 48 e 50):

```ts
  const { resumo: r, isFetching, refetch, error, dataUpdatedAt } = useResumoVendas(janela, canalAtivo);
  const { resumo: rAnt } = useResumoVendas(janelaAnt, canalAtivo);
```

Renderizar logo após o `<PageHeader …/>` (antes do banner de erro, linha ~111):

```tsx
      <CanalTabs canal={canalAtivo} onCanal={setCanal} habilitados={habilitados} className="mb-3" />
```

- [ ] **Step 2: Dashboard**

Em `src/pages/Dashboard.tsx`: mesmos imports do Step 1. Dentro do componente principal
(localize `export default function Dashboard` com `grep -n "export default" src/pages/Dashboard.tsx`),
adicionar `const { canal: canalAtivo, setCanal, habilitados } = useCanalAtivo();` no topo dos hooks,
renderizar `<CanalTabs canal={canalAtivo} onCanal={setCanal} habilitados={habilitados} className="mb-4" />`
logo após o `<PageHeader …/>`, e passar `canalAtivo` como último argumento de TODAS as chamadas
`useResumoVendas(...)` e `useVendas(...)` do arquivo (localize com
`grep -n "useResumoVendas(\|useVendas(" src/pages/Dashboard.tsx`).
KPIs não-venda (lotes, pendências, publicados) NÃO mudam — só as métricas de venda respeitam o canal.

- [ ] **Step 3: Faturamento**

`src/pages/Faturamento.tsx` — as abas (Vendas/Devoluções/Perguntas/Mensagens/Geografia) são
funcionalidades do ML. Comportamento: canal 'todos' ou 'mercado_livre' → tela como hoje;
outro canal operável → estado vazio da página. Novo corpo:

```tsx
import { Receipt, RotateCcw, MessageCircleQuestion, MessagesSquare, MapPin, PackageOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CanalTabs } from '@/components/canal-tabs';
import { useCanalAtivo } from '@/hooks/useCanalAtivo';
import { infoCanal } from '@/lib/canais';
import { AbaVendas } from '@/components/faturamento/aba-vendas';
import { AbaDevolucoes } from '@/components/faturamento/aba-devolucoes';
import { AbaPerguntas } from '@/components/faturamento/aba-perguntas';
import { AbaMensagens } from '@/components/faturamento/aba-mensagens';
import { AbaGeografia } from '@/components/faturamento/aba-geografia';
import { usePerguntasNaoRespondidas } from '@/hooks/usePerguntas';
import { useMensagensAguardando } from '@/hooks/useMensagens';

export default function Faturamento() {
  const { data: naoRespondidas } = usePerguntasNaoRespondidas();
  const mensagensAguardando = useMensagensAguardando();
  const { canal: canalAtivo, setCanal, habilitados } = useCanalAtivo();
  // Devoluções/Perguntas/Mensagens/Geografia são dados do ML; outro canal → vazio acionável.
  const canalSemDados = canalAtivo !== 'todos' && canalAtivo !== 'mercado_livre';

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Faturamento"
        subtitle="Vendas pedido a pedido, devoluções, perguntas e mensagens — num lugar só."
      />
      <CanalTabs canal={canalAtivo} onCanal={setCanal} habilitados={habilitados} className="mb-4" />
      {canalSemDados ? (
        <EmptyState
          icon={PackageOpen}
          title={`Ainda sem vendas no ${infoCanal(canalAtivo)?.nome ?? canalAtivo}`}
          description="Assim que este canal tiver pedidos, eles aparecem aqui."
          action={<Button asChild variant="outline"><Link to="/canais">Ver canais</Link></Button>}
        />
      ) : (
        <Tabs defaultValue="vendas">
          {/* TabsList e TabsContent EXATAMENTE como estão hoje (linhas 21–48 atuais) — não alterar. */}
        </Tabs>
      )}
    </div>
  );
}
```

(Preserve o bloco `<TabsList>…</TabsContent>` atual byte a byte dentro do ramo else.)

- [ ] **Step 4: Verificar e commitar**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: PASS; com 1 canal, as três telas idênticas + tabs novas no topo.

```bash
git add src/pages/Dashboard.tsx src/pages/Financeiro.tsx src/pages/Faturamento.tsx
git commit -m "feat(canais): CanalTabs global em Dashboard, Financeiro e Faturamento"
```

---

### Task 10: Revisão — seletor "Publicar em" registry-driven + pré-validação por capability

**Files:**
- Create: `src/lib/capabilities-canal.ts`
- Test: `src/lib/__tests__/capabilities-canal.test.ts`
- Modify: `src/pages/Revisao.tsx:30, 87-91, 216-223, 254-282, 574-590`
- Delete: `src/lib/canais-ui.ts` e seu teste (localize: `grep -rln "canais-ui" src/`)

**Interfaces:**
- Consumes: `canaisOperaveis`/`canaisEmBreve`/`CANAIS` (Task 1), `useCanaisHabilitados` (Task 4), `CanalBadge`/`LogoCanal` (Task 3).
- Produces: `avisosCapabilities(titulos: string[], canais: string[]): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/capabilities-canal.test.ts
import { describe, it, expect } from 'vitest';
import { avisosCapabilities } from '@/lib/capabilities-canal';

describe('avisosCapabilities', () => {
  it('avisa títulos acima do limite do canal (ML: 60)', () => {
    const avisos = avisosCapabilities(['a'.repeat(61), 'curto', 'b'.repeat(80)], ['mercado_livre']);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('2 título(s)');
    expect(avisos[0]).toContain('60');
    expect(avisos[0]).toContain('Mercado Livre');
  });
  it('sem excesso ou canal sem capabilities conhecidas → sem avisos', () => {
    expect(avisosCapabilities(['curto'], ['mercado_livre'])).toEqual([]);
    expect(avisosCapabilities(['x'.repeat(300)], ['shopee'])).toEqual([]); // não inventamos limite
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/__tests__/capabilities-canal.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementation**

```ts
// src/lib/capabilities-canal.ts
import { infoCanal } from '@/lib/canais';

/**
 * Pré-validação por capability (spec D1/bloco D): avisos ANTES de publicar, derivados
 * do registry. Só valida o que o canal declara — canal sem capabilities não gera aviso.
 */
export function avisosCapabilities(titulos: string[], canais: string[]): string[] {
  const avisos: string[] = [];
  for (const id of canais) {
    const cap = infoCanal(id)?.capabilities;
    if (!cap) continue;
    const excedem = titulos.filter((t) => t.length > cap.tituloMax).length;
    if (excedem > 0) {
      avisos.push(`${excedem} título(s) excedem o limite de ${cap.tituloMax} caracteres do ${infoCanal(id)!.nome}.`);
    }
  }
  return avisos;
}
```

Run: `pnpm test src/lib/__tests__/capabilities-canal.test.ts` — Expected: PASS.

- [ ] **Step 4: Revisão registry-driven**

Em `src/pages/Revisao.tsx`:
1. Linha 30: trocar `import { deveMostrarSeletorCanais } from '@/lib/canais-ui';` por:

```ts
import { canaisOperaveis, canaisEmBreve } from '@/lib/canais';
import { LogoCanal } from '@/components/canal-badge';
import { useCanaisHabilitados } from '@/hooks/useCanaisHabilitados';
import { avisosCapabilities } from '@/lib/capabilities-canal';
```

2. Linhas 87–91: substituir o bloco por:

```ts
  // Seleção de canais (D6): grupo SEMPRE visível — operáveis marcáveis (se conectados),
  // em-breve desabilitados como vitrine. ML pré-marcado.
  const { data: conexoes = [] } = useQuery({ queryKey: QK.conexoes, queryFn: fetchConexoes });
  const { data: habilitados = ['mercado_livre'] } = useCanaisHabilitados();
  const [canaisSelecionados, setCanaisSelecionados] = useState<Set<string>>(new Set(['mercado_livre']));
  const operaveis = canaisOperaveis(habilitados);
  const emBreve = canaisEmBreve(habilitados);
  const canaisConectados = useMemo(() => new Set(conexoes.map((c) => c.canal)), [conexoes]);
```

3. Em `confirmarPublicacao` (linhas 258–260), trocar o cálculo de `canais` por:

```ts
    // Publica só nos selecionados que têm conexão; fallback = ML (comportamento de sempre).
    const marcados = [...canaisSelecionados].filter((c) => canaisConectados.has(c));
    const canais = marcados.length > 0 ? marcados : ['mercado_livre'];
```

4. No dialog (linhas 574–590), substituir o bloco `{mostrarSeletorCanais && (…)}` por versão sempre visível:

```tsx
          <div className="mt-1">
            <span className="block text-xs font-semibold text-muted-foreground">Publicar em</span>
            <div className="mt-1 flex flex-wrap gap-3">
              {operaveis.map((c) => {
                const conectado = canaisConectados.has(c.id);
                return (
                  <label
                    key={c.id}
                    className={cn('flex items-center gap-1.5 text-sm', conectado ? 'cursor-pointer' : 'cursor-not-allowed opacity-60')}
                    title={conectado ? undefined : 'Conecte este canal no menu Canais para publicar nele'}
                  >
                    <Checkbox
                      checked={canaisSelecionados.has(c.id)}
                      disabled={!conectado}
                      onCheckedChange={(v) => toggleCanal(c.id, v === true)}
                      aria-label={`Publicar em ${c.nome}`}
                    />
                    <LogoCanal canal={c.id} />
                    {c.nome}
                  </label>
                );
              })}
              {emBreve.map((c) => (
                <span key={c.id} className="flex items-center gap-1.5 text-sm text-muted-foreground opacity-50 grayscale" title="Em breve no PubliAI">
                  <Checkbox disabled aria-label={`${c.nome} (em breve)`} />
                  <LogoCanal canal={c.id} />
                  {c.nome} <span className="text-[10px] uppercase">em breve</span>
                </span>
              ))}
            </div>
          </div>
```

5. Pré-validação no dialog — logo abaixo do bloco acima, antes de `{publicando && (`:

```tsx
          {(() => {
            const titulos = familias.filter((f) => selecionadas.has(f.id)).map((f) => f.titulo);
            const marcados = [...canaisSelecionados].filter((c) => canaisConectados.has(c));
            const avisos = avisosCapabilities(titulos, marcados.length > 0 ? marcados : ['mercado_livre']);
            return avisos.length > 0 ? (
              <div className="mt-1 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                {avisos.map((a) => <p key={a}>{a}</p>)}
              </div>
            ) : null;
          })()}
```

- [ ] **Step 5: Deletar `canais-ui.ts` + teste antigo**

Run: `grep -rln "canais-ui" src/` — Expected: nenhum resultado após os Steps (Publicados já limpou na Task 8).

```bash
git rm src/lib/canais-ui.ts
# remova também o arquivo de teste que o cite, se existir (grep acima aponta)
```

- [ ] **Step 6: Verificar e commitar**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: PASS (testes antigos de canais-ui removidos junto).

```bash
git add -A src/
git commit -m "feat(canais): seletor 'Publicar em' registry-driven na Revisão + pré-validação de título"
```

---

### Task 11: /admin — editor de canais por org (edge `usuarios` + Organizações)

**Files:**
- Modify: `supabase/functions/usuarios/index.ts:101-112` (list_orgs) e novo case
- Modify: `src/pages/Organizacoes.tsx:13-19, 63-96` (+ dialog novo)

**Interfaces:**
- Consumes: coluna `organizations.canais_habilitados` (Task 4).
- Produces: action `set_canais_org { org_id, canais: string[] }`; `list_orgs` passa a devolver `canais_habilitados`.

- [ ] **Step 1: Edge `usuarios`**

1. `list_orgs` (linha 103): trocar o select para
   `'id, nome, slug, criado_em, canais_habilitados'` e incluir
   `canais_habilitados: o.canais_habilitados` no objeto do `result.push(...)`.
2. Novo case, junto das ações de super-admin (após `create_org`):

```ts
    case 'set_canais_org': {
      if (!me.is_super_admin) return json({ error: 'forbidden' }, 403);
      const alvo = String(body.org_id ?? '');
      if (!alvo) return json({ error: 'org_id obrigatório' }, 400);
      // Mesmos ids do registry do frontend (src/lib/canais.ts) — manter em sincronia.
      const CANAIS_VALIDOS = ['mercado_livre', 'shopee', 'magalu', 'amazon', 'casas_bahia'];
      const canais = Array.isArray(body.canais)
        ? (body.canais as string[]).filter((c) => CANAIS_VALIDOS.includes(c))
        : [];
      if (!canais.includes('mercado_livre')) {
        return json({ error: 'mercado_livre não pode ser desabilitado' }, 400);
      }
      const { error } = await db.from('organizations')
        .update({ canais_habilitados: canais, atualizado_em: new Date().toISOString() })
        .eq('id', alvo);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
```

Run: `deno check supabase/functions/usuarios/index.ts` — Expected: OK.

- [ ] **Step 2: UI em Organizações**

Em `src/pages/Organizacoes.tsx`:
1. `OrgRow` (linha 13) ganha `canais_habilitados: string[];`.
2. Imports novos:

```ts
import { Checkbox } from '@/components/ui/checkbox';
import { LISTA_CANAIS } from '@/lib/canais';
import { CanalBadge } from '@/components/canal-badge';
```

3. Na tabela: novo `<TableHead>Canais</TableHead>` entre "Membros" e "Criada em", e na linha:

```tsx
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(o.canais_habilitados ?? ['mercado_livre']).map((c) => <CanalBadge key={c} canal={c} />)}
                  </div>
                </TableCell>
```

(ajuste o `colSpan={5}` do "Carregando…" para `6`).
4. Nas ações da linha, adicionar antes do botão Excluir:

```tsx
                  <Button variant="ghost" size="sm" onClick={() => setCanaisOrg(o)}>Canais</Button>
```

com estado `const [canaisOrg, setCanaisOrg] = useState<OrgRow | null>(null);` e o dialog:

```tsx
function CanaisOrgDialog({ org, onClose, onSaved }: {
  org: OrgRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [canais, setCanais] = useState<Set<string>>(new Set(['mercado_livre']));
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (org) setCanais(new Set(org.canais_habilitados ?? ['mercado_livre']));
  }, [org?.id]);

  async function salvar() {
    if (!org) return;
    setSalvando(true);
    try {
      await callUsuarios({ action: 'set_canais_org', org_id: org.id, canais: [...canais] });
      toast.success('✓ Canais atualizados');
      onClose();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar canais');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!org} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Canais de {org?.nome}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Canais que esta empresa enxerga como conectáveis. Canal "em breve" no produto continua
          em breve mesmo habilitado aqui — isto controla o rollout quando o canal for lançado.
        </p>
        <div className="flex flex-col gap-2">
          {LISTA_CANAIS.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={canais.has(c.id)}
                disabled={c.id === 'mercado_livre'}
                onCheckedChange={(v) => setCanais((prev) => {
                  const novo = new Set(prev);
                  if (v === true) novo.add(c.id); else novo.delete(c.id);
                  return novo;
                })}
              />
              {c.nome}
              {c.id === 'mercado_livre' && <span className="text-xs text-muted-foreground">(sempre ativo)</span>}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Renderize `<CanaisOrgDialog org={canaisOrg} onClose={() => setCanaisOrg(null)} onSaved={() => qc.invalidateQueries({ queryKey: ['organizacoes'] })} />` junto dos outros dialogs.

- [ ] **Step 3: Verificar e commitar**

Run: `pnpm lint && pnpm build && pnpm test`

```bash
git add supabase/functions/usuarios/index.ts src/pages/Organizacoes.tsx
git commit -m "feat(canais): editor de canais por org no /admin (action set_canais_org)"
```

---

### Task 12: Dashboard — resumo por canal em "Todos" (aparece só com >1 canal com dados)

**Files:**
- Create: `src/lib/resumo-por-canal.ts`
- Test: `src/lib/__tests__/resumo-por-canal.test.ts`
- Modify: `src/pages/Dashboard.tsx` (bloco de chips, condicional)

**Interfaces:**
- Consumes: `Venda` com campo `canal` (Task 7); `infoCanal` (Task 1).
- Produces: `liquidoPorCanal(vendas: Array<{ canal?: string; liquido: number }>): Array<{ canal: string; liquido: number; pedidos: number }>` (ordenado por líquido desc).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/resumo-por-canal.test.ts
import { describe, it, expect } from 'vitest';
import { liquidoPorCanal } from '@/lib/resumo-por-canal';

describe('liquidoPorCanal', () => {
  it('agrega líquido e pedidos por canal, ordenado por líquido desc', () => {
    const vendas = [
      { canal: 'mercado_livre', liquido: 100 },
      { canal: 'shopee', liquido: 300 },
      { canal: 'mercado_livre', liquido: 50 },
      { liquido: 10 }, // sem canal → mercado_livre
    ];
    expect(liquidoPorCanal(vendas)).toEqual([
      { canal: 'shopee', liquido: 300, pedidos: 1 },
      { canal: 'mercado_livre', liquido: 160, pedidos: 3 },
    ]);
  });
  it('lista vazia → vazio', () => {
    expect(liquidoPorCanal([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/__tests__/resumo-por-canal.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementation**

```ts
// src/lib/resumo-por-canal.ts
/** Breakdown por canal para o Dashboard em "Todos" (spec S3). Só é exibido com >1 canal. */
export function liquidoPorCanal(
  vendas: Array<{ canal?: string; liquido: number }>,
): Array<{ canal: string; liquido: number; pedidos: number }> {
  const m = new Map<string, { liquido: number; pedidos: number }>();
  for (const v of vendas) {
    const c = v.canal ?? 'mercado_livre';
    const atual = m.get(c) ?? { liquido: 0, pedidos: 0 };
    atual.liquido += v.liquido;
    atual.pedidos += 1;
    m.set(c, atual);
  }
  return [...m.entries()]
    .map(([canal, agg]) => ({ canal, ...agg }))
    .sort((a, b) => b.liquido - a.liquido);
}
```

Run: `pnpm test src/lib/__tests__/resumo-por-canal.test.ts` — Expected: PASS.

ATENÇÃO: confirme o nome do campo de líquido em `Venda` (`grep -n "liquido" src/lib/faturamento.ts | head`).
Se for outro nome, ajuste o teste e o tipo do parâmetro para o campo real — a função é
estrutural (`{ canal?, liquido }`), então o call site pode mapear.

- [ ] **Step 4: Chips no Dashboard**

Em `src/pages/Dashboard.tsx`, no JSX, logo abaixo do `<CanalTabs …/>` (Task 9), renderizar
condicionalmente (usar o array de vendas que o componente já tem via `useResumoVendas`/`useVendas` —
`r.vendas` no padrão do Financeiro):

```tsx
      {canalAtivo === 'todos' && (() => {
        const porCanal = liquidoPorCanal(r.vendas ?? []);
        if (porCanal.length <= 1) return null; // com 1 canal, nada muda (D6/constraint global)
        return (
          <div className="mb-4 flex flex-wrap gap-2">
            {porCanal.map((c) => (
              <button
                key={c.canal}
                type="button"
                onClick={() => setCanal(c.canal as CanalAtivo)}
                className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm shadow-sm transition-colors hover:bg-accent"
              >
                <CanalBadge canal={c.canal} />
                <span className="font-semibold tabular-nums">{fmtBRL(c.liquido)}</span>
                <span className="text-xs text-muted-foreground">{c.pedidos} venda(s)</span>
              </button>
            ))}
          </div>
        );
      })()}
```

Imports: `liquidoPorCanal`, `CanalBadge`, `type CanalAtivo`.

- [ ] **Step 5: Verificar e commitar**

Run: `pnpm lint && pnpm build && pnpm test`

```bash
git add src/lib/resumo-por-canal.ts src/lib/__tests__/resumo-por-canal.test.ts src/pages/Dashboard.tsx
git commit -m "feat(canais): breakdown de líquido por canal no Dashboard (visível só com >1 canal)"
```

---

### Task 13: Gate final + documentação

**Files:**
- Modify: `docs/reference/modelo-de-dados.md` (colunas novas + RPC)
- Modify: `docs/reference/edge-functions.md` (action `set_canais_org` + MENU_KEYS)
- Modify: `docs/TASKS.md` (registrar a entrega)
- Modify: `docs/explanation/arquitetura.md` (registry de canais no frontend, seção multicanal)
- Modify: `obsidian-vault/06-Roadmap/Sprint Atual.md` (se citar preparação multicanal)

- [ ] **Step 1: Gate completo**

Run: `pnpm lint && pnpm test && pnpm build && deno check supabase/functions/usuarios/index.ts`
Expected: TUDO PASS. Qualquer falha → corrigir antes de seguir.

- [ ] **Step 2: Documentação**

- `modelo-de-dados.md`: adicionar `organizations.canais_habilitados text[] default '{mercado_livre}'`, `ml_vendas.canal text default 'mercado_livre'` e a RPC `canais_habilitados_da_org()` nas seções correspondentes.
- `edge-functions.md`: na seção da `usuarios`, adicionar a action `set_canais_org` (super-admin) e o menu `canais`; anotar que a função precisa de redeploy.
- `TASKS.md`: entrada nova "Menus multi-marketplace (spec 2026-07-14): registry de canais, tela /canais, CanalTabs global, canais por org — aguardando db push + deploy da edge usuarios + validação browser do Diego".
- `arquitetura.md`: parágrafo curto na seção multicanal: UI dirigida por registry (`src/lib/canais.ts`) + habilitação por org.

- [ ] **Step 3: Commit final**

```bash
git add docs/ obsidian-vault/ 2>/dev/null
git commit -m "docs: registra menus multi-marketplace (registry, /canais, tabs globais, canais por org)"
```

- [ ] **Step 4: Relato de fechamento (para o Diego — NÃO executar deploy)**

Reportar pendências que ficam com o Diego, nesta ordem:
1. `supabase db push` (migration `menus_multicanal`).
2. `supabase functions deploy usuarios` (CLI completa).
3. Validação browser local (checklist: tabs em Dashboard/Publicados/Faturamento/Financeiro com números idênticos; tela /canais; menu Canais visível; convite de usuário com menu Canais; /admin editor de canais).
4. Merge/push da branch só após OK do Diego.

---

## Self-review (executado na escrita do plano)

- **Cobertura da spec:** D1 (A+B+C+D) ✓; D2 tabs nas 4 telas ✓ (Tasks 8–9); D3 global persistido ✓ (Task 2); D4 /canais no sidebar ✓ (Task 6); D5 híbrido registry+org ✓ (Tasks 1, 4, 11); D6 vitrine sempre visível ✓ (Tasks 3, 8, 10); D7 preço por canal **gated — sem task, correto** (spec: só com 2º canal real). Estados vazios acionáveis ✓ (Task 9). Backfill allowed_menus ✓ (Task 4).
- **Sem placeholders:** todos os steps têm código ou comando exato; os dois pontos onde o executor lê o arquivo antes (buscarVendas Task 7, Dashboard Task 9) têm o padrão exato a aplicar e o comando de localização.
- **Consistência de tipos:** `CanalAtivo`/`parseCanalAtivo` (T2) usados em T7–T9; `canaisOperaveis/canaisEmBreve` (T1) em T3/T6/T10; `useCanaisHabilitados` (T2-stub/T4) em T2/T6/T10; ids do registry duplicados conscientemente na edge (T11, com comentário de sincronia).
