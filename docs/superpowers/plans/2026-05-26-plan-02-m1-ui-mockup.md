# Plano 02 — M1: UI Mockup com dados fake

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** entregar as 6 telas do produto (Dashboard, Novo Lote, Progresso, Revisão, Relatório, Configurações) navegáveis em produção (Render) com dados mockados realistas, prontas pra um walkthrough de aprovação com Diego antes de iniciar o backend (M2).

**Architecture:** monorepo simples (frontend Vite na raiz). App shell `<AppShell>` envolve todas as telas com Sidebar fixa + Topbar fina. Rotas via HashRouter (já existente do M0). Mocks são módulos TypeScript com dados estáticos; acesso via hooks que mais tarde (M2) viram queries TanStack mantendo a mesma assinatura. UI usa shadcn/ui + Tailwind 4 (já configurados).

**Tech Stack:**
- Vite 5 + React 18 + TypeScript 5 (strict)
- Tailwind 4 + shadcn/ui (preset Nova/neutral)
- React Router DOM 7 (HashRouter)
- Vitest + Testing Library
- react-dropzone (novo)
- Lucide icons (já incluído)

**Documentos relacionados:**
- Spec do M1: [docs/superpowers/specs/2026-05-26-m1-ui-mockup-design.md](../specs/2026-05-26-m1-ui-mockup-design.md)
- ROADMAP: [docs/ROADMAP.md](../../ROADMAP.md)
- CLAUDE.md: [CLAUDE.md](../../../CLAUDE.md)

**Quando o plano estiver completo:** [docs/TASKS.md](../../TASKS.md) — marcar M1 como ✅, atualizar ROADMAP "Estado geral" para `🟢 M1 concluído, pronto para M2`.

---

## File Structure

Arquivos que serão criados ou modificados:

```
src/
├── App.tsx                                  (MODIFY: substituir Home por AppShell + rotas)
├── components/
│   ├── ui/                                  (shadcn — vários novos via CLI)
│   │   ├── button.tsx                       (já existe)
│   │   ├── badge.tsx                        (NOVO via shadcn add)
│   │   ├── card.tsx                         (NOVO via shadcn add)
│   │   ├── checkbox.tsx                     (NOVO via shadcn add)
│   │   ├── input.tsx                        (NOVO via shadcn add)
│   │   ├── textarea.tsx                     (NOVO via shadcn add)
│   │   ├── progress.tsx                     (NOVO via shadcn add)
│   │   ├── radio-group.tsx                  (NOVO via shadcn add)
│   │   └── dropdown-menu.tsx                (NOVO via shadcn add)
│   ├── app-shell.tsx                        (NOVO)
│   ├── sidebar.tsx                          (NOVO)
│   ├── topbar.tsx                           (NOVO)
│   ├── status-badge.tsx                     (NOVO)
│   ├── lote-card.tsx                        (NOVO)
│   ├── dropzone.tsx                         (NOVO)
│   ├── stepper.tsx                          (NOVO)
│   ├── familia-row.tsx                      (NOVO)
│   ├── familia-expanded.tsx                 (NOVO)
│   └── variacao-card.tsx                    (NOVO)
├── hooks/
│   ├── useLotes.ts                          (NOVO)
│   ├── useFamilias.ts                       (NOVO)
│   └── useSelecao.ts                        (NOVO)
├── lib/
│   ├── supabase.ts                          (já existe)
│   ├── utils.ts                             (já existe)
│   └── mocks/
│       ├── types.ts                         (NOVO)
│       ├── lotes.ts                         (NOVO)
│       └── familias.ts                      (NOVO)
└── pages/
    ├── Dashboard.tsx                        (RENAME de Home.tsx)
    ├── NotFound.tsx                         (já existe)
    ├── NovoLote.tsx                         (NOVO)
    ├── Progresso.tsx                        (NOVO)
    ├── Revisao.tsx                          (NOVO)
    ├── Relatorio.tsx                        (NOVO)
    └── Configuracoes.tsx                    (NOVO)

tests/
├── App.test.tsx                             (MODIFY: cobrir as novas rotas)
├── supabaseClient.test.ts                   (já existe)
├── mocks/
│   ├── lotes.test.ts                        (NOVO)
│   └── familias.test.ts                     (NOVO)
├── hooks/
│   ├── useLotes.test.ts                     (NOVO)
│   └── useSelecao.test.ts                   (NOVO)
└── components/
    ├── lote-card.test.tsx                   (NOVO)
    ├── status-badge.test.tsx                (NOVO)
    ├── stepper.test.tsx                     (NOVO)
    ├── familia-row.test.tsx                 (NOVO)
    ├── revisao-filtros.test.tsx             (NOVO)
    └── revisao-acoes.test.tsx               (NOVO)
```

---

## Convenções deste plano

- **Working directory:** `/Users/diego/Desktop/IA/Anuncios MktPlace`
- **Package manager:** `pnpm`
- **TDD:** aplicado em **lógica** (hooks, filtros, seleção, parse de status). Componentes puramente visuais (Sidebar layout, LoteCard rendering) ganham apenas smoke test "renderiza sem crashar com props básicos" — TDD light, conforme exceções listadas em CLAUDE.md (§9).
- **Commits:** após cada Task, prefixo `feat:` ou `test:` conforme apropriado.
- **MCPs:** usar `shadcn` MCP quando disponível pra adicionar componentes; cair para `pnpm dlx shadcn@latest add <name>` quando não.
- **`pnpm test`** deve passar a cada commit.

---

## Pré-requisitos

- [ ] **PR-1: M0 concluído** (commit `c69cb75` ou mais recente em `main`)
- [ ] **PR-2: working tree clean** (`git status` mostra nada pendente)
- [ ] **PR-3: tests passing** (`pnpm test` retorna 4 passed)
- [ ] **PR-4: build OK** (`pnpm build` sem erros)

---

## Task 1: Setup — dependências e componentes shadcn

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Create (via shadcn CLI): `src/components/ui/badge.tsx`, `card.tsx`, `checkbox.tsx`, `input.tsx`, `textarea.tsx`, `progress.tsx`, `radio-group.tsx`, `dropdown-menu.tsx`

- [ ] **Step 1.1: Instalar react-dropzone**

```bash
pnpm add react-dropzone
```

Esperado: `+ react-dropzone X.Y.Z` em `dependencies` do `package.json`.

- [ ] **Step 1.2: Adicionar componentes shadcn em batch**

```bash
pnpm dlx shadcn@latest add badge card checkbox input textarea progress radio-group dropdown-menu
```

Quando perguntar "Would you like to use canary instead?" ou similar, aceitar o padrão (não-canary). Se algum falhar por incompatibilidade Tailwind 4, repetir individualmente com `pnpm dlx shadcn@canary add <nome>`.

Esperado: 8 arquivos novos em `src/components/ui/`.

- [ ] **Step 1.3: Validar build**

```bash
pnpm build
```

Esperado: build OK sem erros TypeScript.

- [ ] **Step 1.4: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/ui/ components.json
git commit -m "$(cat <<'EOF'
chore: add react-dropzone and shadcn components for M1

Components added via shadcn CLI: badge, card, checkbox, input,
textarea, progress, radio-group, dropdown-menu. Plano 02 Task 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Tipos compartilhados de mocks

**Files:**
- Create: `src/lib/mocks/types.ts`

> Tipos puros — sem teste TDD (são apenas declarações TypeScript).

- [ ] **Step 2.1: Criar `src/lib/mocks/types.ts`**

```ts
export type LoteStatus =
  | 'importando'
  | 'processando'
  | 'revisao'
  | 'publicando'
  | 'concluido'
  | 'erro';

export type OperacaoML = 'CREATE' | 'UPDATE';

export type EstrategiaPreco = 'PROPRIO' | 'COMPETITIVO';

export type Concorrencia = 'sem' | 'moderada' | 'alta';

export interface Lote {
  id: string;
  numero: number;
  criadoEm: string; // ISO 8601
  status: LoteStatus;
  totalFamilias: number;
  totalPublicadas: number;
  totalErros: number;
}

export interface Variacao {
  codigo: string;
  cor: string;
  corHex: string;
  preco: number;
  estoque: number;
  fotoUrl?: string;
  editadoPeloOperador?: boolean;
}

export interface Familia {
  id: string;
  loteId: string;
  codigoPai: string;
  titulo: string;
  descricao: string;
  operacao: OperacaoML;
  estrategiaPreco: EstrategiaPreco;
  estrategiaMotivo: string;
  concorrencia: Concorrencia;
  precoMin: number;
  precoMax: number;
  precoAbaixo20pc: boolean;
  fotoCapaUrl?: string;
  variacoes: Variacao[];
  editadoPeloOperador?: boolean;
}
```

- [ ] **Step 2.2: Validar tipos compilam**

```bash
pnpm build
```

Esperado: build OK.

- [ ] **Step 2.3: Commit**

```bash
git add src/lib/mocks/types.ts
git commit -m "feat: add shared types for M1 mocks (Lote, Familia, Variacao)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Mock data — lotes

**Files:**
- Create: `src/lib/mocks/lotes.ts`, `tests/mocks/lotes.test.ts`

- [ ] **Step 3.1: Escrever teste falhando (RED)**

Criar `tests/mocks/lotes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MOCK_LOTES } from '@/lib/mocks/lotes';

describe('MOCK_LOTES', () => {
  it('tem ao menos 6 lotes', () => {
    expect(MOCK_LOTES.length).toBeGreaterThanOrEqual(6);
  });

  it('cobre todos os estados de LoteStatus', () => {
    const statuses = new Set(MOCK_LOTES.map((l) => l.status));
    expect(statuses).toContain('revisao');
    expect(statuses).toContain('concluido');
    expect(statuses).toContain('publicando');
    expect(statuses).toContain('erro');
    expect(statuses).toContain('processando');
  });

  it('tem ao menos um lote em revisao (alvo principal da tela Revisão)', () => {
    expect(MOCK_LOTES.filter((l) => l.status === 'revisao').length).toBeGreaterThanOrEqual(1);
  });

  it('IDs são únicos', () => {
    const ids = MOCK_LOTES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 3.2: Rodar — esperar FALHAR**

```bash
pnpm test tests/mocks/lotes.test.ts
```

Esperado: FAIL com "Failed to resolve import @/lib/mocks/lotes".

- [ ] **Step 3.3: Criar `src/lib/mocks/lotes.ts`**

```ts
import type { Lote } from './types';

export const MOCK_LOTES: Lote[] = [
  {
    id: 'lote-42',
    numero: 42,
    criadoEm: '2026-05-25T14:32:00.000Z',
    status: 'revisao',
    totalFamilias: 50,
    totalPublicadas: 0,
    totalErros: 0,
  },
  {
    id: 'lote-41',
    numero: 41,
    criadoEm: '2026-05-24T10:15:00.000Z',
    status: 'concluido',
    totalFamilias: 12,
    totalPublicadas: 11,
    totalErros: 1,
  },
  {
    id: 'lote-40',
    numero: 40,
    criadoEm: '2026-05-23T09:00:00.000Z',
    status: 'concluido',
    totalFamilias: 7,
    totalPublicadas: 7,
    totalErros: 0,
  },
  {
    id: 'lote-39',
    numero: 39,
    criadoEm: '2026-05-22T16:48:00.000Z',
    status: 'publicando',
    totalFamilias: 20,
    totalPublicadas: 5,
    totalErros: 0,
  },
  {
    id: 'lote-38',
    numero: 38,
    criadoEm: '2026-05-22T11:00:00.000Z',
    status: 'erro',
    totalFamilias: 0,
    totalPublicadas: 0,
    totalErros: 0,
  },
  {
    id: 'lote-37',
    numero: 37,
    criadoEm: '2026-05-22T08:30:00.000Z',
    status: 'processando',
    totalFamilias: 0,
    totalPublicadas: 0,
    totalErros: 0,
  },
];
```

- [ ] **Step 3.4: Rodar — esperar PASSAR**

```bash
pnpm test tests/mocks/lotes.test.ts
```

Esperado: 4 tests passed.

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/mocks/lotes.ts tests/mocks/lotes.test.ts
git commit -m "feat: add mock lotes covering all statuses (TDD)

6 lotes em estados variados: revisao, concluido (x2), publicando,
erro, processando. Plano 02 Task 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Mock data — famílias

**Files:**
- Create: `src/lib/mocks/familias.ts`, `tests/mocks/familias.test.ts`

- [ ] **Step 4.1: Escrever teste falhando (RED)**

Criar `tests/mocks/familias.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MOCK_FAMILIAS } from '@/lib/mocks/familias';

describe('MOCK_FAMILIAS (Lote #42)', () => {
  const familiasLote42 = MOCK_FAMILIAS.filter((f) => f.loteId === 'lote-42');

  it('tem 50 famílias no lote-42', () => {
    expect(familiasLote42.length).toBe(50);
  });

  it('tem mistura CREATE/UPDATE (38 CREATE + 12 UPDATE)', () => {
    const creates = familiasLote42.filter((f) => f.operacao === 'CREATE');
    const updates = familiasLote42.filter((f) => f.operacao === 'UPDATE');
    expect(creates.length).toBe(38);
    expect(updates.length).toBe(12);
  });

  it('tem ao menos 3 famílias com precoAbaixo20pc=true (alerta)', () => {
    const alertas = familiasLote42.filter((f) => f.precoAbaixo20pc);
    expect(alertas.length).toBeGreaterThanOrEqual(3);
  });

  it('tem todas as 3 categorias de concorrência presentes', () => {
    const concs = new Set(familiasLote42.map((f) => f.concorrencia));
    expect(concs).toContain('sem');
    expect(concs).toContain('moderada');
    expect(concs).toContain('alta');
  });

  it('cada família tem ao menos 1 variação', () => {
    expect(familiasLote42.every((f) => f.variacoes.length >= 1)).toBe(true);
  });

  it('IDs de família são únicos', () => {
    const ids = MOCK_FAMILIAS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 4.2: Rodar — esperar FALHAR**

```bash
pnpm test tests/mocks/familias.test.ts
```

Esperado: FAIL por módulo ausente.

- [ ] **Step 4.3: Criar `src/lib/mocks/familias.ts`**

> O arquivo é programático (gera as 50 famílias em loop) pra evitar 500 linhas de JSON literal e garantir distribuição CREATE/UPDATE/alerta/concorrência conforme spec.

```ts
import type { Familia, OperacaoML, Concorrencia, EstrategiaPreco, Variacao } from './types';

const CORES: Array<{ nome: string; hex: string }> = [
  { nome: 'Preto', hex: '#000000' },
  { nome: 'Branco', hex: '#ffffff' },
  { nome: 'Vermelho', hex: '#dc2626' },
  { nome: 'Azul Royal', hex: '#1e40af' },
  { nome: 'Verde Bandeira', hex: '#15803d' },
  { nome: 'Amarelo', hex: '#facc15' },
  { nome: 'Rosa Pink', hex: '#ec4899' },
  { nome: 'Cinza', hex: '#6b7280' },
  { nome: 'Marrom', hex: '#78350f' },
  { nome: 'Roxo', hex: '#7e22ce' },
  { nome: 'Laranja', hex: '#ea580c' },
  { nome: 'Cru', hex: '#e7d8c1' },
];

interface FamiliaTemplate {
  prefixoTitulo: string;
  descricaoBase: string;
  precoBase: number;
  precoVariacao: number; // amplitude entre min/max
}

const TEMPLATES: FamiliaTemplate[] = [
  // 30 linhas de costura
  ...Array.from({ length: 30 }, (_, i) => ({
    prefixoTitulo: 'Linha de Costura Algodão 500m',
    descricaoBase: 'Linha 100% algodão mercerizado, 500m, ideal para máquina doméstica. Cone industrial.',
    precoBase: 8.9 + (i % 5) * 0.5,
    precoVariacao: 3.6,
  })),
  // 10 botões
  ...Array.from({ length: 10 }, (_, i) => ({
    prefixoTitulo: `Botão Plástico ${10 + i}mm`,
    descricaoBase: 'Botão de plástico com 4 furos, ideal para roupas infantis e adultas.',
    precoBase: 0.15 + i * 0.02,
    precoVariacao: 0.1,
  })),
  // 5 fitas
  ...Array.from({ length: 5 }, (_, i) => ({
    prefixoTitulo: `Fita ${i % 2 === 0 ? 'Cetim' : 'Gorgurão'} 10mm`,
    descricaoBase: 'Fita 10mm para acabamentos e decoração. Rolo com 50 metros.',
    precoBase: 2.4,
    precoVariacao: 0.5,
  })),
  // 5 zíperes
  ...Array.from({ length: 5 }, (_, i) => ({
    prefixoTitulo: `Zíper Nylon #${3 + i} 15cm`,
    descricaoBase: 'Zíper nylon resistente, ideal para confecções e reparos.',
    precoBase: 1.8 + i * 0.3,
    precoVariacao: 1.4,
  })),
];

function gerarVariacoes(codigoPai: string, quantidade: number, precoBase: number, precoVariacao: number): Variacao[] {
  return Array.from({ length: quantidade }, (_, idx) => {
    const cor = CORES[idx % CORES.length];
    return {
      codigo: `${codigoPai}-${String(idx + 1).padStart(2, '0')}`,
      cor: cor.nome,
      corHex: cor.hex,
      preco: Math.round((precoBase + (idx / quantidade) * precoVariacao) * 100) / 100,
      estoque: Math.max(0, 50 - idx * 3),
    };
  });
}

function gerarFamilia(idx: number, template: FamiliaTemplate): Familia {
  const numeroPai = 1043812 + idx;
  const codigoPai = String(numeroPai);
  const quantidadeCores = 3 + (idx % 10); // 3 a 12 cores
  const variacoes = gerarVariacoes(codigoPai, quantidadeCores, template.precoBase, template.precoVariacao);
  const precoMin = Math.min(...variacoes.map((v) => v.preco));
  const precoMax = Math.max(...variacoes.map((v) => v.preco));

  // Distribuição CREATE/UPDATE: primeiros 38 CREATE, últimos 12 UPDATE
  const operacao: OperacaoML = idx < 38 ? 'CREATE' : 'UPDATE';

  // Distribuição de concorrência: a cada 10, 1 alta + 4 moderada + 5 sem
  const concorrencia: Concorrencia =
    idx % 10 === 0 ? 'alta' : idx % 10 < 5 ? 'moderada' : 'sem';

  // 3 famílias com preço abaixo de 20%: índices 5, 15, 25
  const precoAbaixo20pc = idx === 5 || idx === 15 || idx === 25;

  const estrategiaPreco: EstrategiaPreco = concorrencia === 'sem' ? 'PROPRIO' : 'COMPETITIVO';
  const estrategiaMotivo =
    estrategiaPreco === 'PROPRIO'
      ? 'Nenhum concorrente com mesmo GTIN — manter preço da planilha'
      : `Concorrência ${concorrencia}: alinhar com mediana do mercado`;

  // Editado pelo operador: famílias 2, 7
  const editadoPeloOperador = idx === 2 || idx === 7;

  return {
    id: `familia-lote42-${String(idx + 1).padStart(2, '0')}`,
    loteId: 'lote-42',
    codigoPai,
    titulo: template.prefixoTitulo,
    descricao: template.descricaoBase,
    operacao,
    estrategiaPreco,
    estrategiaMotivo,
    concorrencia,
    precoMin,
    precoMax,
    precoAbaixo20pc,
    variacoes,
    editadoPeloOperador,
  };
}

export const MOCK_FAMILIAS: Familia[] = TEMPLATES.map((tpl, idx) => gerarFamilia(idx, tpl));
```

- [ ] **Step 4.4: Rodar — esperar PASSAR**

```bash
pnpm test tests/mocks/familias.test.ts
```

Esperado: 6 tests passed.

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/mocks/familias.ts tests/mocks/familias.test.ts
git commit -m "feat: add 50 mock familias for lote-42 (linhas, botões, fitas, zíperes)

Geração programática garante distribuição: 38 CREATE + 12 UPDATE,
3 com alerta de preço, todas concorrências cobertas. Plano 02 Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Hooks de acesso aos mocks

**Files:**
- Create: `src/hooks/useLotes.ts`, `src/hooks/useFamilias.ts`, `tests/hooks/useLotes.test.ts`

- [ ] **Step 5.1: Escrever teste falhando (RED)**

Criar `tests/hooks/useLotes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLotes, useLote } from '@/hooks/useLotes';

describe('useLotes', () => {
  it('retorna lista de lotes', () => {
    const { result } = renderHook(() => useLotes());
    expect(result.current.length).toBeGreaterThanOrEqual(6);
  });
});

describe('useLote', () => {
  it('retorna o lote com o id fornecido', () => {
    const { result } = renderHook(() => useLote('lote-42'));
    expect(result.current).toBeDefined();
    expect(result.current?.numero).toBe(42);
  });

  it('retorna undefined para id desconhecido', () => {
    const { result } = renderHook(() => useLote('nao-existe'));
    expect(result.current).toBeUndefined();
  });
});
```

- [ ] **Step 5.2: Rodar — esperar FALHAR**

```bash
pnpm test tests/hooks/useLotes.test.ts
```

Esperado: FAIL por módulo ausente.

- [ ] **Step 5.3: Criar `src/hooks/useLotes.ts`**

```ts
import { MOCK_LOTES } from '@/lib/mocks/lotes';
import type { Lote } from '@/lib/mocks/types';

export function useLotes(): Lote[] {
  return MOCK_LOTES;
}

export function useLote(id: string | undefined): Lote | undefined {
  if (!id) return undefined;
  return MOCK_LOTES.find((l) => l.id === id);
}
```

- [ ] **Step 5.4: Criar `src/hooks/useFamilias.ts`**

```ts
import { MOCK_FAMILIAS } from '@/lib/mocks/familias';
import type { Familia } from '@/lib/mocks/types';

export function useFamilias(loteId: string | undefined): Familia[] {
  if (!loteId) return [];
  return MOCK_FAMILIAS.filter((f) => f.loteId === loteId);
}
```

- [ ] **Step 5.5: Rodar — esperar PASSAR**

```bash
pnpm test
```

Esperado: todos os testes passam.

- [ ] **Step 5.6: Commit**

```bash
git add src/hooks/useLotes.ts src/hooks/useFamilias.ts tests/hooks/useLotes.test.ts
git commit -m "feat: add useLotes/useLote/useFamilias hooks (TDD)

Hooks síncronos que envolvem mocks; assinatura compatível com TanStack
Query do M2 (componentes não precisarão mudar). Plano 02 Task 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: App shell — StatusBadge, Sidebar, Topbar, AppShell + rotas

**Files:**
- Create: `src/components/status-badge.tsx`, `src/components/sidebar.tsx`, `src/components/topbar.tsx`, `src/components/app-shell.tsx`
- Modify: `src/App.tsx`, `src/pages/Home.tsx` → rename `Dashboard.tsx`
- Create: `src/pages/NovoLote.tsx`, `Progresso.tsx`, `Revisao.tsx`, `Relatorio.tsx`, `Configuracoes.tsx` (placeholders)
- Modify: `tests/App.test.tsx`
- Create: `tests/components/status-badge.test.tsx`

> Estratégia: criar placeholders com `<h1>` único para cada rota; testar via `App.test.tsx` que a rota renderiza o placeholder certo. Conteúdo de cada tela vem nas tasks seguintes.

- [ ] **Step 6.1: Escrever teste do StatusBadge (RED)**

Criar `tests/components/status-badge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '@/components/status-badge';

describe('StatusBadge', () => {
  it('renderiza label correto para status revisao', () => {
    render(<StatusBadge status="revisao" />);
    expect(screen.getByText(/revis/i)).toBeInTheDocument();
  });

  it('renderiza label correto para status concluido', () => {
    render(<StatusBadge status="concluido" />);
    expect(screen.getByText(/conclu/i)).toBeInTheDocument();
  });

  it('renderiza label correto para status erro', () => {
    render(<StatusBadge status="erro" />);
    expect(screen.getByText(/erro/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6.2: Rodar — esperar FALHAR**

```bash
pnpm test tests/components/status-badge.test.tsx
```

Esperado: FAIL por módulo ausente.

- [ ] **Step 6.3: Criar `src/components/status-badge.tsx`**

```tsx
import { Badge } from '@/components/ui/badge';
import type { LoteStatus } from '@/lib/mocks/types';

const LABELS: Record<LoteStatus, string> = {
  importando: 'Importando',
  processando: 'Processando',
  revisao: 'Em revisão',
  publicando: 'Publicando',
  concluido: 'Concluído',
  erro: 'Erro',
};

const VARIANTS: Record<LoteStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  importando: 'outline',
  processando: 'outline',
  revisao: 'default',
  publicando: 'secondary',
  concluido: 'secondary',
  erro: 'destructive',
};

export function StatusBadge({ status }: { status: LoteStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
```

- [ ] **Step 6.4: Criar `src/components/sidebar.tsx`**

```tsx
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Upload, ListChecks, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/novo-lote', label: 'Novo lote', icon: Upload, end: false },
  { to: '/revisao/lote-42', label: 'Revisão', icon: ListChecks, end: false },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, end: false },
];

export function Sidebar() {
  return (
    <aside className="flex h-screen w-[180px] flex-col border-r bg-background">
      <div className="flex h-11 items-center px-4 font-semibold">PubliAI</div>
      <nav className="flex-1 px-2 py-2">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t px-4 py-3 text-xs text-muted-foreground">diego@empresa</div>
    </aside>
  );
}
```

- [ ] **Step 6.5: Criar `src/components/topbar.tsx`**

```tsx
import type { ReactNode } from 'react';

interface TopbarProps {
  breadcrumb: string;
  actions?: ReactNode;
}

export function Topbar({ breadcrumb, actions }: TopbarProps) {
  return (
    <header className="flex h-11 items-center justify-between border-b bg-background px-4 text-sm">
      <span className="text-muted-foreground">{breadcrumb}</span>
      <div className="flex items-center gap-2">{actions}</div>
    </header>
  );
}
```

- [ ] **Step 6.6: Criar `src/components/app-shell.tsx`**

```tsx
import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/sidebar';

export function AppShell() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-muted/30">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 6.7: Renomear Home.tsx → Dashboard.tsx e simplificar como placeholder**

```bash
git mv src/pages/Home.tsx src/pages/Dashboard.tsx
```

Substituir todo o conteúdo de `src/pages/Dashboard.tsx` por:

```tsx
export default function Dashboard() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-sm text-muted-foreground mt-1">Lotes recentes</p>
    </div>
  );
}
```

- [ ] **Step 6.8: Criar páginas placeholder restantes**

`src/pages/NovoLote.tsx`:
```tsx
export default function NovoLote() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Novo lote</h1>
    </div>
  );
}
```

`src/pages/Progresso.tsx`:
```tsx
export default function Progresso() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Processando</h1>
    </div>
  );
}
```

`src/pages/Revisao.tsx`:
```tsx
export default function Revisao() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Revisão</h1>
    </div>
  );
}
```

`src/pages/Relatorio.tsx`:
```tsx
export default function Relatorio() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Relatório</h1>
    </div>
  );
}
```

`src/pages/Configuracoes.tsx`:
```tsx
export default function Configuracoes() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Configurações</h1>
    </div>
  );
}
```

- [ ] **Step 6.9: Atualizar `src/App.tsx` com AppShell + rotas completas**

Substituir todo o conteúdo de `src/App.tsx`:

```tsx
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/app-shell';
import Dashboard from '@/pages/Dashboard';
import NovoLote from '@/pages/NovoLote';
import Progresso from '@/pages/Progresso';
import Revisao from '@/pages/Revisao';
import Relatorio from '@/pages/Relatorio';
import Configuracoes from '@/pages/Configuracoes';
import NotFound from '@/pages/NotFound';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/novo-lote" element={<NovoLote />} />
        <Route path="/progresso/:loteId" element={<Progresso />} />
        <Route path="/revisao/:loteId" element={<Revisao />} />
        <Route path="/relatorio/:loteId" element={<Relatorio />} />
        <Route path="/configuracoes" element={<Configuracoes />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  );
}

export default App;
```

- [ ] **Step 6.10: Atualizar `tests/App.test.tsx` para cobrir todas as rotas**

Substituir todo o conteúdo de `tests/App.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';

function renderRoute(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppRoutes />
    </MemoryRouter>
  );
}

describe('App routing', () => {
  it('renderiza Dashboard na rota /', () => {
    renderRoute('/');
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('renderiza NovoLote na rota /novo-lote', () => {
    renderRoute('/novo-lote');
    expect(screen.getByRole('heading', { name: /novo lote/i })).toBeInTheDocument();
  });

  it('renderiza Progresso na rota /progresso/:loteId', () => {
    renderRoute('/progresso/lote-37');
    expect(screen.getByRole('heading', { name: /processando/i })).toBeInTheDocument();
  });

  it('renderiza Revisao na rota /revisao/:loteId', () => {
    renderRoute('/revisao/lote-42');
    expect(screen.getByRole('heading', { name: /revis/i })).toBeInTheDocument();
  });

  it('renderiza Relatorio na rota /relatorio/:loteId', () => {
    renderRoute('/relatorio/lote-41');
    expect(screen.getByRole('heading', { name: /relat/i })).toBeInTheDocument();
  });

  it('renderiza Configuracoes na rota /configuracoes', () => {
    renderRoute('/configuracoes');
    expect(screen.getByRole('heading', { name: /config/i })).toBeInTheDocument();
  });

  it('renderiza NotFound em rota desconhecida', () => {
    renderRoute('/rota-que-nao-existe');
    expect(screen.getByText(/404/)).toBeInTheDocument();
    expect(screen.getByText(/Página não encontrada/i)).toBeInTheDocument();
  });

  it('renderiza Sidebar dentro das rotas com shell', () => {
    renderRoute('/');
    expect(screen.getByText('PubliAI')).toBeInTheDocument();
    expect(screen.getByText('diego@empresa')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6.11: Rodar — esperar PASSAR (todos os testes)**

```bash
pnpm test
```

Esperado: todos passam (~14 testes).

- [ ] **Step 6.12: Validar visualmente**

```bash
pnpm dev
```

Abrir `http://localhost:5173`. Verificar:
- Sidebar à esquerda com 4 items + "diego@empresa" no rodapé
- Clicar em "Novo lote" → URL muda pra `/#/novo-lote`, conteúdo é o placeholder "Novo lote"
- Item ativo destacado na sidebar
- `/#/algo-que-nao-existe` mostra 404

Encerrar com Ctrl+C.

- [ ] **Step 6.13: Commit**

```bash
git add -A
git commit -m "feat: add AppShell with Sidebar, Topbar, all routes (TDD)

App shell envolve as 6 rotas (Dashboard, Novo Lote, Progresso,
Revisão, Relatório, Configurações). NotFound fora do shell. Cada
página é um placeholder com h1 único; conteúdo real chega nas tasks
seguintes. StatusBadge component pronto pra LoteCard. Plano 02 Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Dashboard — LoteCard + tela

**Files:**
- Create: `src/components/lote-card.tsx`, `tests/components/lote-card.test.tsx`
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 7.1: Escrever teste do LoteCard (RED)**

Criar `tests/components/lote-card.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoteCard } from '@/components/lote-card';
import type { Lote } from '@/lib/mocks/types';

const LOTE_REVISAO: Lote = {
  id: 'lote-42',
  numero: 42,
  criadoEm: '2026-05-25T14:32:00.000Z',
  status: 'revisao',
  totalFamilias: 50,
  totalPublicadas: 0,
  totalErros: 0,
};

const LOTE_CONCLUIDO: Lote = {
  id: 'lote-41',
  numero: 41,
  criadoEm: '2026-05-24T10:15:00.000Z',
  status: 'concluido',
  totalFamilias: 12,
  totalPublicadas: 11,
  totalErros: 1,
};

function renderCard(lote: Lote) {
  return render(
    <MemoryRouter>
      <LoteCard lote={lote} />
    </MemoryRouter>
  );
}

describe('LoteCard', () => {
  it('mostra número, data, status e contadores', () => {
    renderCard(LOTE_REVISAO);
    expect(screen.getByText(/Lote #42/i)).toBeInTheDocument();
    expect(screen.getByText(/50 famílias/i)).toBeInTheDocument();
    expect(screen.getByText(/em revis/i)).toBeInTheDocument();
  });

  it('mostra contagem de publicadas e erros quando concluído', () => {
    renderCard(LOTE_CONCLUIDO);
    expect(screen.getByText(/11 publicadas/i)).toBeInTheDocument();
    expect(screen.getByText(/1 erro/i)).toBeInTheDocument();
  });

  it('link aponta para /revisao quando status=revisao', () => {
    renderCard(LOTE_REVISAO);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/revisao/lote-42');
  });

  it('link aponta para /relatorio quando status=concluido', () => {
    renderCard(LOTE_CONCLUIDO);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/relatorio/lote-41');
  });
});
```

- [ ] **Step 7.2: Rodar — esperar FALHAR**

```bash
pnpm test tests/components/lote-card.test.tsx
```

Esperado: FAIL por módulo ausente.

- [ ] **Step 7.3: Criar `src/components/lote-card.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import type { Lote, LoteStatus } from '@/lib/mocks/types';

function destinoDoLote(status: LoteStatus, id: string): string {
  if (status === 'revisao') return `/revisao/${id}`;
  if (status === 'concluido' || status === 'erro') return `/relatorio/${id}`;
  return `/progresso/${id}`;
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LoteCard({ lote }: { lote: Lote }) {
  return (
    <Link to={destinoDoLote(lote.status, lote.id)} className="block">
      <Card className="p-4 transition-colors hover:bg-accent">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">Lote #{lote.numero}</h3>
              <StatusBadge status={lote.status} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{formatarData(lote.criadoEm)}</p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <div>{lote.totalFamilias} famílias</div>
            {lote.status === 'concluido' && (
              <div className="text-xs">
                {lote.totalPublicadas} publicadas · {lote.totalErros}{' '}
                {lote.totalErros === 1 ? 'erro' : 'erros'}
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 7.4: Substituir `src/pages/Dashboard.tsx` pelo conteúdo final**

```tsx
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoteCard } from '@/components/lote-card';
import { useLotes } from '@/hooks/useLotes';

export default function Dashboard() {
  const lotes = useLotes();

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Lotes recentes</h1>
        <Button asChild>
          <Link to="/novo-lote">
            <Plus className="mr-1 h-4 w-4" />
            Novo lote
          </Link>
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        {lotes.map((lote) => (
          <LoteCard key={lote.id} lote={lote} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7.5: Rodar — esperar PASSAR**

```bash
pnpm test
```

Esperado: todos passam.

- [ ] **Step 7.6: Validar visualmente**

```bash
pnpm dev
```

Abrir `http://localhost:5173`. Esperado: lista de 6 cards de lote, botão "Novo lote" no topo direito. Clique no card de Lote #42 → navega para `/#/revisao/lote-42`. Clique no Lote #41 → `/#/relatorio/lote-41`. Encerrar.

- [ ] **Step 7.7: Commit**

```bash
git add -A
git commit -m "feat: Dashboard with LoteCard list and routing logic (TDD)

LoteCard escolhe destino conforme status (revisao→/revisao,
concluido/erro→/relatorio, demais→/progresso). Plano 02 Task 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Novo Lote — Dropzone duplo

**Files:**
- Create: `src/components/dropzone.tsx`
- Modify: `src/pages/NovoLote.tsx`

> Componente Dropzone é majoritariamente integração com `react-dropzone` (sem lógica de negócio testável). Smoke test apenas que renderiza ambas as zonas e que o botão "Processar" desabilita sem planilha.

- [ ] **Step 8.1: Criar `src/components/dropzone.tsx`**

```tsx
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';

interface DropzoneProps {
  label: string;
  accept: Record<string, string[]>;
  multiple: boolean;
  onFiles: (files: File[]) => void;
  files: File[];
}

export function Dropzone({ label, accept, multiple, onFiles, files }: DropzoneProps) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    multiple,
    onDrop: onFiles,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors',
        isDragActive ? 'border-primary bg-accent' : 'border-muted-foreground/25 hover:bg-accent/50'
      )}
    >
      <input {...getInputProps()} />
      <p className="text-sm font-medium">{label}</p>
      {files.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {isDragActive ? 'Solte aqui...' : 'Arraste ou clique para selecionar'}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          {multiple ? `${files.length} arquivo(s) selecionado(s)` : files[0].name}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 8.2: Substituir `src/pages/NovoLote.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/dropzone';

export default function NovoLote() {
  const navigate = useNavigate();
  const [planilha, setPlanilha] = useState<File[]>([]);
  const [imagens, setImagens] = useState<File[]>([]);

  const podeProcessar = planilha.length === 1;

  function handleProcessar() {
    // Mock: cria id fictício e navega para Progresso
    const loteId = `lote-novo-${Date.now()}`;
    navigate(`/progresso/${loteId}`);
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Novo lote</h1>
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Dropzone
          label="Planilha (.xlsx)"
          accept={{ 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }}
          multiple={false}
          onFiles={setPlanilha}
          files={planilha}
        />
        <Dropzone
          label="Imagens (.jpg, .jpeg, .png)"
          accept={{ 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'] }}
          multiple={true}
          onFiles={setImagens}
          files={imagens}
        />
        <Button onClick={handleProcessar} disabled={!podeProcessar} size="lg">
          Processar
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8.3: Validar**

```bash
pnpm test && pnpm build
```

Esperado: testes passam, build OK.

```bash
pnpm dev
```

Abrir `/#/novo-lote`. Verificar: 2 dropzones empilhados, botão "Processar" desabilitado. Encerrar.

- [ ] **Step 8.4: Commit**

```bash
git add -A
git commit -m "feat: NovoLote screen with stacked dropzones (planilha + imagens)

Validação só de extensão; mock cria loteId fictício e navega para
/progresso. Botão Processar desabilitado sem planilha. Plano 02 Task 8.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Progresso — Stepper + simulação

**Files:**
- Create: `src/components/stepper.tsx`, `tests/components/stepper.test.tsx`
- Modify: `src/pages/Progresso.tsx`

- [ ] **Step 9.1: Escrever teste do Stepper (RED)**

Criar `tests/components/stepper.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stepper } from '@/components/stepper';

const ETAPAS = ['Upload', 'Parse', 'Match imagens', 'Concorrência', 'Copy IA'];

describe('Stepper', () => {
  it('renderiza todas as etapas', () => {
    render(<Stepper etapas={ETAPAS} atual={0} />);
    ETAPAS.forEach((e) => {
      expect(screen.getByText(e)).toBeInTheDocument();
    });
  });

  it('marca etapa atual com label "atual"', () => {
    render(<Stepper etapas={ETAPAS} atual={2} />);
    const atualLabel = screen.getByLabelText('Etapa atual: Match imagens');
    expect(atualLabel).toBeInTheDocument();
  });

  it('marca etapas anteriores como concluídas', () => {
    render(<Stepper etapas={ETAPAS} atual={3} />);
    expect(screen.getByLabelText('Etapa concluída: Upload')).toBeInTheDocument();
    expect(screen.getByLabelText('Etapa concluída: Parse')).toBeInTheDocument();
    expect(screen.getByLabelText('Etapa concluída: Match imagens')).toBeInTheDocument();
  });
});
```

- [ ] **Step 9.2: Rodar — esperar FALHAR**

```bash
pnpm test tests/components/stepper.test.tsx
```

- [ ] **Step 9.3: Criar `src/components/stepper.tsx`**

```tsx
import { Check, Circle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StepperProps {
  etapas: string[];
  atual: number; // índice da etapa em andamento; -1 = nenhuma; etapas.length = todas concluídas
}

export function Stepper({ etapas, atual }: StepperProps) {
  return (
    <ol className="flex flex-col gap-3">
      {etapas.map((etapa, idx) => {
        const concluida = idx < atual;
        const emAndamento = idx === atual;
        return (
          <li
            key={etapa}
            className={cn(
              'flex items-center gap-3 rounded-md border p-3',
              concluida && 'border-green-200 bg-green-50',
              emAndamento && 'border-primary bg-accent'
            )}
            aria-label={
              concluida
                ? `Etapa concluída: ${etapa}`
                : emAndamento
                ? `Etapa atual: ${etapa}`
                : `Etapa pendente: ${etapa}`
            }
          >
            {concluida ? (
              <Check className="h-4 w-4 text-green-700" />
            ) : emAndamento ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground" />
            )}
            <span className={cn('text-sm', concluida && 'text-muted-foreground line-through')}>
              {etapa}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 9.4: Rodar — esperar PASSAR**

```bash
pnpm test tests/components/stepper.test.tsx
```

- [ ] **Step 9.5: Substituir `src/pages/Progresso.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Stepper } from '@/components/stepper';

const ETAPAS = [
  'Upload concluído',
  'Parse da planilha',
  'Match de imagens',
  'Detecção CREATE/UPDATE',
  'Busca de concorrência',
  'Geração de copy IA',
];

export default function Progresso() {
  const { loteId } = useParams();
  const navigate = useNavigate();
  const [atual, setAtual] = useState(0);

  useEffect(() => {
    if (atual >= ETAPAS.length) return;
    const timer = setTimeout(() => setAtual((a) => a + 1), 2000);
    return () => clearTimeout(timer);
  }, [atual]);

  const concluido = atual >= ETAPAS.length;
  const progressoPct = Math.min(100, Math.round((atual / ETAPAS.length) * 100));

  return (
    <div className="p-6">
      <h1 className="mb-1 text-2xl font-semibold">Processando lote</h1>
      <p className="mb-4 text-sm text-muted-foreground">ID: {loteId}</p>

      <div className="mx-auto max-w-2xl">
        <Progress value={progressoPct} className="mb-4" />

        <Stepper etapas={ETAPAS} atual={concluido ? ETAPAS.length : atual} />

        <div className="mt-6 rounded-md border bg-card p-4 text-sm">
          <div className="font-semibold mb-2">Resumo do lote</div>
          <p className="text-muted-foreground">
            38 famílias detectadas · 142 variações · 137 imagens matched · 5 órfãs
          </p>
        </div>

        {concluido && (
          <Button onClick={() => navigate('/revisao/lote-42')} size="lg" className="mt-6 w-full">
            Revisar lote
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9.6: Validar**

```bash
pnpm test && pnpm build
```

```bash
pnpm dev
```

Acessar `/#/progresso/lote-37`. Verificar: stepper avança 1 etapa a cada 2s, barra de progresso enche, após ~12s aparece botão "Revisar lote" que navega pra `/#/revisao/lote-42`. Encerrar.

- [ ] **Step 9.7: Commit**

```bash
git add -A
git commit -m "feat: Progresso screen with animated stepper (TDD)

6 etapas que avançam via setTimeout (2s cada). Após conclusão,
botão Revisar navega para /revisao/lote-42 (mock). Plano 02 Task 9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Revisão — esqueleto (tabela + filtros + busca)

**Files:**
- Create: `src/components/familia-row.tsx`, `tests/components/familia-row.test.tsx`, `tests/components/revisao-filtros.test.tsx`
- Modify: `src/pages/Revisao.tsx`

- [ ] **Step 10.1: Escrever teste do FamiliaRow (RED)**

Criar `tests/components/familia-row.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FamiliaRow } from '@/components/familia-row';
import type { Familia } from '@/lib/mocks/types';

const FAMILIA: Familia = {
  id: 'familia-1',
  loteId: 'lote-42',
  codigoPai: '1043812',
  titulo: 'Linha de Costura Algodão 500m',
  descricao: 'Linha 100% algodão...',
  operacao: 'CREATE',
  estrategiaPreco: 'PROPRIO',
  estrategiaMotivo: 'Nenhum concorrente',
  concorrencia: 'sem',
  precoMin: 8.9,
  precoMax: 12.5,
  precoAbaixo20pc: false,
  variacoes: [
    { codigo: '1043812-01', cor: 'Vermelho', corHex: '#dc2626', preco: 8.9, estoque: 50 },
  ],
};

describe('FamiliaRow', () => {
  it('mostra título, código PAI, operação e range de preço', () => {
    render(
      <FamiliaRow
        familia={FAMILIA}
        selecionada={false}
        expandida={false}
        onSelecionar={() => {}}
        onExpandir={() => {}}
      />
    );
    expect(screen.getByText(/Linha de Costura/)).toBeInTheDocument();
    expect(screen.getByText(/1043812/)).toBeInTheDocument();
    expect(screen.getByText(/CREATE/)).toBeInTheDocument();
    expect(screen.getByText(/R\$ 8,90/)).toBeInTheDocument();
  });

  it('marca checkbox como checked quando selecionada=true', () => {
    render(
      <FamiliaRow
        familia={FAMILIA}
        selecionada={true}
        expandida={false}
        onSelecionar={() => {}}
        onExpandir={() => {}}
      />
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('mostra alerta de preço quando precoAbaixo20pc=true', () => {
    render(
      <FamiliaRow
        familia={{ ...FAMILIA, precoAbaixo20pc: true }}
        selecionada={false}
        expandida={false}
        onSelecionar={() => {}}
        onExpandir={() => {}}
      />
    );
    expect(screen.getByLabelText(/preço abaixo de 20%/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 10.2: Rodar — esperar FALHAR**

```bash
pnpm test tests/components/familia-row.test.tsx
```

- [ ] **Step 10.3: Criar `src/components/familia-row.tsx`**

```tsx
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { Familia } from '@/lib/mocks/types';

interface FamiliaRowProps {
  familia: Familia;
  selecionada: boolean;
  expandida: boolean;
  onSelecionar: (id: string, valor: boolean) => void;
  onExpandir: (id: string) => void;
}

function formatarBRL(valor: number): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function FamiliaRow({ familia, selecionada, expandida, onSelecionar, onExpandir }: FamiliaRowProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-[24px_40px_1fr_80px_140px_40px] items-center gap-3 border-b px-4 py-2 text-sm',
        familia.editadoPeloOperador && 'border-l-2 border-l-purple-500'
      )}
    >
      <Checkbox
        checked={selecionada}
        onCheckedChange={(v) => onSelecionar(familia.id, v === true)}
      />
      <div
        className="h-8 w-8 rounded bg-muted"
        style={
          familia.variacoes[0]
            ? { backgroundColor: familia.variacoes[0].corHex }
            : undefined
        }
      />
      <div>
        <div className="font-medium">{familia.titulo}</div>
        <div className="text-xs text-muted-foreground">
          PAI {familia.codigoPai} · {familia.variacoes.length} cores
        </div>
      </div>
      <Badge variant={familia.operacao === 'CREATE' ? 'default' : 'secondary'}>
        {familia.operacao}
      </Badge>
      <div className="flex items-center gap-1">
        <span>
          R$ {formatarBRL(familia.precoMin)}
          {familia.precoMin !== familia.precoMax && `-${formatarBRL(familia.precoMax)}`}
        </span>
        {familia.precoAbaixo20pc && (
          <AlertTriangle
            className="h-4 w-4 text-destructive"
            aria-label="Preço abaixo de 20% do seu preço"
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => onExpandir(familia.id)}
        className="text-muted-foreground hover:text-foreground"
        aria-label={expandida ? 'Recolher' : 'Expandir'}
      >
        {expandida ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
    </div>
  );
}
```

- [ ] **Step 10.4: Escrever teste de filtros (RED)**

Criar `tests/components/revisao-filtros.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { filtrarFamilias } from '@/pages/Revisao';
import type { Familia } from '@/lib/mocks/types';

const FAMILIAS: Familia[] = [
  {
    id: 'a',
    loteId: 'lote-42',
    codigoPai: '1001',
    titulo: 'Linha Vermelha',
    descricao: '',
    operacao: 'CREATE',
    estrategiaPreco: 'PROPRIO',
    estrategiaMotivo: '',
    concorrencia: 'sem',
    precoMin: 1,
    precoMax: 1,
    precoAbaixo20pc: false,
    variacoes: [],
  },
  {
    id: 'b',
    loteId: 'lote-42',
    codigoPai: '1002',
    titulo: 'Botão Azul',
    descricao: '',
    operacao: 'UPDATE',
    estrategiaPreco: 'COMPETITIVO',
    estrategiaMotivo: '',
    concorrencia: 'alta',
    precoMin: 1,
    precoMax: 1,
    precoAbaixo20pc: true,
    variacoes: [],
  },
];

describe('filtrarFamilias', () => {
  it('retorna todas quando filtro=todos e busca vazia', () => {
    expect(filtrarFamilias(FAMILIAS, 'todos', '').length).toBe(2);
  });

  it('filtra só CREATE', () => {
    const out = filtrarFamilias(FAMILIAS, 'CREATE', '');
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('a');
  });

  it('filtra só UPDATE', () => {
    const out = filtrarFamilias(FAMILIAS, 'UPDATE', '');
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('b');
  });

  it('filtra avisos (precoAbaixo20pc=true)', () => {
    const out = filtrarFamilias(FAMILIAS, 'avisos', '');
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('b');
  });

  it('busca por código PAI (substring)', () => {
    const out = filtrarFamilias(FAMILIAS, 'todos', '1001');
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('a');
  });

  it('busca por título (case-insensitive)', () => {
    const out = filtrarFamilias(FAMILIAS, 'todos', 'azul');
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('b');
  });
});
```

- [ ] **Step 10.5: Rodar — esperar FALHAR (filtrarFamilias não exportada)**

```bash
pnpm test tests/components/revisao-filtros.test.tsx
```

- [ ] **Step 10.6: Substituir `src/pages/Revisao.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FamiliaRow } from '@/components/familia-row';
import { useFamilias } from '@/hooks/useFamilias';
import type { Familia } from '@/lib/mocks/types';

type FiltroOp = 'todos' | 'CREATE' | 'UPDATE' | 'avisos';

export function filtrarFamilias(familias: Familia[], filtro: FiltroOp, busca: string): Familia[] {
  const buscaLower = busca.trim().toLowerCase();
  return familias.filter((f) => {
    if (filtro === 'CREATE' && f.operacao !== 'CREATE') return false;
    if (filtro === 'UPDATE' && f.operacao !== 'UPDATE') return false;
    if (filtro === 'avisos' && !f.precoAbaixo20pc) return false;
    if (buscaLower && !f.titulo.toLowerCase().includes(buscaLower) && !f.codigoPai.includes(buscaLower))
      return false;
    return true;
  });
}

export default function Revisao() {
  const { loteId } = useParams();
  const familias = useFamilias(loteId);
  const [filtro, setFiltro] = useState<FiltroOp>('todos');
  const [busca, setBusca] = useState('');
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  const visiveis = useMemo(() => filtrarFamilias(familias, filtro, busca), [familias, filtro, busca]);

  function toggleSelecao(id: string, valor: boolean) {
    setSelecionadas((prev) => {
      const novo = new Set(prev);
      if (valor) novo.add(id);
      else novo.delete(id);
      return novo;
    });
  }

  function toggleExpansao(id: string) {
    setExpandidas((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  const counts = {
    todos: familias.length,
    CREATE: familias.filter((f) => f.operacao === 'CREATE').length,
    UPDATE: familias.filter((f) => f.operacao === 'UPDATE').length,
    avisos: familias.filter((f) => f.precoAbaixo20pc).length,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-background p-3 text-sm">
        <Input
          placeholder="Buscar por código ou nome..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-xs"
        />
        {(['todos', 'CREATE', 'UPDATE', 'avisos'] as FiltroOp[]).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={
              filtro === f
                ? 'rounded-md bg-accent px-3 py-1 font-medium'
                : 'rounded-md px-3 py-1 text-muted-foreground hover:bg-accent/50'
            }
          >
            {f === 'todos'
              ? `Todos (${counts.todos})`
              : f === 'avisos'
              ? `⚠ Avisos (${counts.avisos})`
              : `${f} (${counts[f]})`}
          </button>
        ))}
        <div className="ml-auto">
          {selecionadas.size > 0 && (
            <Badge variant="default">{selecionadas.size} selecionada(s)</Badge>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {visiveis.map((familia) => (
          <FamiliaRow
            key={familia.id}
            familia={familia}
            selecionada={selecionadas.has(familia.id)}
            expandida={expandidas.has(familia.id)}
            onSelecionar={toggleSelecao}
            onExpandir={toggleExpansao}
          />
        ))}
        {visiveis.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma família encontrada com esses filtros.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 10.7: Rodar — esperar PASSAR**

```bash
pnpm test
```

Esperado: todos passam.

- [ ] **Step 10.8: Validar visual**

```bash
pnpm dev
```

Acessar `/#/revisao/lote-42`. Verificar:
- 50 linhas listadas
- Clicar nos filtros muda a contagem
- Busca por "linha" filtra corretamente
- Checkboxes selecionam (badge "X selecionada(s)" aparece)
- Chevron muda quando clicado (mas conteúdo expandido ainda não chega — vem na Task 11)

Encerrar.

- [ ] **Step 10.9: Commit**

```bash
git add -A
git commit -m "feat: Revisao screen skeleton with filters, search, selection (TDD)

FamiliaRow + filtrarFamilias com testes. Filtros: todos/CREATE/
UPDATE/avisos. Busca por título ou código PAI (case-insensitive).
Seleção via Set<id>. Expansão preparada (UI vem na Task 11).
Plano 02 Task 10.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Revisão — expansão accordion + edição inline

**Files:**
- Create: `src/components/familia-expanded.tsx`, `src/components/variacao-card.tsx`
- Modify: `src/pages/Revisao.tsx`

> Sem testes adicionais — esta task é majoritariamente UI/layout, e edição inline é comportamento de form típico do React (testada implicitamente pelas mudanças de state). Test cobrirá no Task 12 quando entrar lógica de "aprovar/rejeitar".

- [ ] **Step 11.1: Criar `src/components/variacao-card.tsx`**

```tsx
import { Input } from '@/components/ui/input';
import type { Variacao } from '@/lib/mocks/types';

interface VariacaoCardProps {
  variacao: Variacao;
  onMudarPreco: (codigo: string, novoPreco: number) => void;
  onMudarCor: (codigo: string, novaCor: string) => void;
}

export function VariacaoCard({ variacao, onMudarPreco, onMudarCor }: VariacaoCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-background p-2 text-sm">
      <div
        className="h-6 w-6 shrink-0 rounded"
        style={{ backgroundColor: variacao.corHex }}
        aria-label={`Cor ${variacao.cor}`}
      />
      <Input
        value={variacao.cor}
        onChange={(e) => onMudarCor(variacao.codigo, e.target.value)}
        className="h-7 flex-1"
      />
      <Input
        type="number"
        step="0.01"
        value={variacao.preco}
        onChange={(e) => onMudarPreco(variacao.codigo, parseFloat(e.target.value) || 0)}
        className="h-7 w-24"
      />
      <span className="w-16 text-right text-xs text-muted-foreground">
        estq {variacao.estoque}
      </span>
    </div>
  );
}
```

- [ ] **Step 11.2: Criar `src/components/familia-expanded.tsx`**

```tsx
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { VariacaoCard } from '@/components/variacao-card';
import type { Familia } from '@/lib/mocks/types';

export function FamiliaExpanded({ familia }: { familia: Familia }) {
  const [titulo, setTitulo] = useState(familia.titulo);
  const [descricao, setDescricao] = useState(familia.descricao);
  const [variacoes, setVariacoes] = useState(familia.variacoes);

  function mudarPreco(codigo: string, novoPreco: number) {
    setVariacoes((vs) => vs.map((v) => (v.codigo === codigo ? { ...v, preco: novoPreco } : v)));
  }

  function mudarCor(codigo: string, novaCor: string) {
    setVariacoes((vs) => vs.map((v) => (v.codigo === codigo ? { ...v, cor: novaCor } : v)));
  }

  return (
    <div className="border-b bg-muted/30 p-4 text-sm">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">TÍTULO</label>
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />

          <label className="mb-1 mt-3 block text-xs font-semibold text-muted-foreground">DESCRIÇÃO</label>
          <Textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={5}
          />

          <div className="mt-4 flex items-center gap-2">
            <Badge variant={familia.estrategiaPreco === 'PROPRIO' ? 'outline' : 'secondary'}>
              {familia.estrategiaPreco}
            </Badge>
            <span className="text-xs text-muted-foreground">{familia.estrategiaMotivo}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Concorrência: <span className="font-medium">{familia.concorrencia}</span>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold text-muted-foreground">
            VARIAÇÕES ({variacoes.length})
          </label>
          <div className="flex flex-col gap-2">
            {variacoes.map((v) => (
              <VariacaoCard
                key={v.codigo}
                variacao={v}
                onMudarPreco={mudarPreco}
                onMudarCor={mudarCor}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 11.3: Modificar `src/pages/Revisao.tsx` para incluir expansão inline**

Localizar o `{visiveis.map((familia) => (...))}` e substituir por:

```tsx
{visiveis.map((familia) => (
  <div key={familia.id}>
    <FamiliaRow
      familia={familia}
      selecionada={selecionadas.has(familia.id)}
      expandida={expandidas.has(familia.id)}
      onSelecionar={toggleSelecao}
      onExpandir={toggleExpansao}
    />
    {expandidas.has(familia.id) && <FamiliaExpanded familia={familia} />}
  </div>
))}
```

E adicionar import no topo:
```tsx
import { FamiliaExpanded } from '@/components/familia-expanded';
```

- [ ] **Step 11.4: Validar**

```bash
pnpm test && pnpm build
```

```bash
pnpm dev
```

Acessar `/#/revisao/lote-42`. Verificar:
- Clicar no chevron de uma linha → expande mostrando título/descrição editáveis + lista de variações
- Várias podem ficar abertas ao mesmo tempo
- Editar preço de uma variação → input reflete o valor
- Estratégia de preço aparece como badge

Encerrar.

- [ ] **Step 11.5: Commit**

```bash
git add -A
git commit -m "feat: Revisao accordion expansion with inline editing (FamiliaExpanded)

Múltiplas famílias podem ficar abertas ao mesmo tempo. Edição inline
de título, descrição, cor e preço por variação (state local — não
persiste, é mock). Badge da estratégia de preço (PROPRIO/COMPETITIVO).
Plano 02 Task 11.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Revisão — ações em massa (Aprovar/Rejeitar)

**Files:**
- Create: `tests/components/revisao-acoes.test.tsx`
- Modify: `src/pages/Revisao.tsx`

- [ ] **Step 12.1: Escrever teste de ações (RED)**

Criar `tests/components/revisao-acoes.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Revisao from '@/pages/Revisao';

function renderRevisao() {
  return render(
    <MemoryRouter initialEntries={['/revisao/lote-42']}>
      <Routes>
        <Route path="/revisao/:loteId" element={<Revisao />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Revisao — ações em massa', () => {
  it('footer fica oculto quando nenhuma família selecionada', () => {
    renderRevisao();
    expect(screen.queryByRole('button', { name: /aprovar/i })).not.toBeInTheDocument();
  });

  it('footer aparece com botões Aprovar e Rejeitar ao selecionar', () => {
    renderRevisao();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(screen.getByRole('button', { name: /aprovar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rejeitar/i })).toBeInTheDocument();
  });

  it('clicar em Aprovar limpa seleção', () => {
    renderRevisao();
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    expect(screen.getByText(/2 selecionada/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /aprovar/i }));
    expect(screen.queryByText(/2 selecionada/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 12.2: Rodar — esperar FALHAR**

```bash
pnpm test tests/components/revisao-acoes.test.tsx
```

Esperado: testes falham porque footer com botões ainda não existe.

- [ ] **Step 12.3: Modificar `src/pages/Revisao.tsx` — adicionar footer sticky**

Adicionar antes do `</div>` que fecha o componente Revisao (no fim do JSX):

```tsx
{selecionadas.size > 0 && (
  <div className="flex items-center justify-between border-t bg-background px-4 py-3">
    <div className="text-sm text-muted-foreground">
      {selecionadas.size} selecionada(s) de {visiveis.length}
    </div>
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => setSelecionadas(new Set())}>
        Rejeitar
      </Button>
      <Button onClick={() => setSelecionadas(new Set())}>
        Aprovar selecionada{selecionadas.size > 1 ? 's' : ''}
      </Button>
    </div>
  </div>
)}
```

E adicionar import no topo do arquivo:
```tsx
import { Button } from '@/components/ui/button';
```

> Nota: tanto "Aprovar" quanto "Rejeitar" no M1 limpam a seleção (mock). Lógica real chega no M2/M4.

- [ ] **Step 12.4: Rodar — esperar PASSAR**

```bash
pnpm test
```

- [ ] **Step 12.5: Commit**

```bash
git add -A
git commit -m "feat: Revisao mass actions footer (Aprovar/Rejeitar) (TDD)

Footer sticky aparece quando ≥1 família selecionada. No M1 ambos
botões só limpam a seleção (mock); lógica real vem no M2/M4.
Plano 02 Task 12.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Relatório

**Files:**
- Modify: `src/pages/Relatorio.tsx`

> Sem testes — UI de apresentação, dados estáticos do mock.

- [ ] **Step 13.1: Substituir `src/pages/Relatorio.tsx`**

```tsx
import { Link, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLote } from '@/hooks/useLotes';
import { useFamilias } from '@/hooks/useFamilias';

export default function Relatorio() {
  const { loteId } = useParams();
  const lote = useLote(loteId);
  // No M1, usamos as famílias do lote-42 como mock visual mesmo para outros lotes
  const familias = useFamilias('lote-42').slice(0, lote?.totalFamilias ?? 0);

  if (!lote) return <div className="p-6">Lote não encontrado.</div>;

  const publicadas = familias.slice(0, lote.totalPublicadas);
  const erros = familias.slice(lote.totalPublicadas, lote.totalPublicadas + lote.totalErros);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Relatório · Lote #{lote.numero}
        </h1>
        <Button variant="outline" disabled>
          Exportar PDF
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-3xl font-semibold text-green-700">{lote.totalPublicadas}</div>
          <div className="text-xs text-muted-foreground">publicadas</div>
        </Card>
        <Card className="p-4">
          <div className="text-3xl font-semibold text-destructive">{lote.totalErros}</div>
          <div className="text-xs text-muted-foreground">com erro</div>
        </Card>
        <Card className="p-4">
          <div className="text-3xl font-semibold">R$ 0,42</div>
          <div className="text-xs text-muted-foreground">custo IA</div>
        </Card>
      </div>

      {publicadas.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold">Publicadas</h2>
          <div className="mb-6 flex flex-col gap-2">
            {publicadas.map((f) => (
              <Card key={f.id} className="flex items-center justify-between p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={f.operacao === 'CREATE' ? 'default' : 'secondary'}>
                    {f.operacao}
                  </Badge>
                  <span>{f.titulo}</span>
                </div>
                <Link
                  to="https://produto.mercadolivre.com.br/MLB-mockid"
                  className="text-primary hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver no Mercado Livre →
                </Link>
              </Card>
            ))}
          </div>
        </>
      )}

      {erros.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold">Com erro</h2>
          <div className="flex flex-col gap-2">
            {erros.map((f) => (
              <Card key={f.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <div>{f.titulo}</div>
                  <div className="text-xs text-destructive">Erro: campo obrigatório ausente</div>
                </div>
                <Button size="sm" variant="outline">
                  Editar e tentar de novo
                </Button>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 13.2: Validar**

```bash
pnpm test && pnpm build
```

```bash
pnpm dev
```

Acessar `/#/relatorio/lote-41`. Esperado: 3 cards de resumo (11 publicadas, 1 erro, R$ 0,42), 11 famílias publicadas listadas com link "Ver no Mercado Livre", 1 família com erro com botão "Editar e tentar de novo". Encerrar.

- [ ] **Step 13.3: Commit**

```bash
git add -A
git commit -m "feat: Relatorio screen with summary cards, publicadas, erros

Botão Exportar PDF é placeholder (disabled). Links mockados para
Mercado Livre. Plano 02 Task 13.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Configurações

**Files:**
- Modify: `src/pages/Configuracoes.tsx`

> UI estática — sem testes.

- [ ] **Step 14.1: Substituir `src/pages/Configuracoes.tsx`**

```tsx
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export default function Configuracoes() {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Configurações</h1>

      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Mercado Livre</h2>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Conectado</Badge>
              <span className="text-sm">como vendedor_mock</span>
            </div>
            <Button variant="outline" size="sm" disabled>
              Desconectar
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Estratégia de preço</h2>
          <RadioGroup defaultValue="condicional" className="flex flex-col gap-2">
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="proprio" id="r1" />
              <div>
                <div className="font-medium">Próprio sempre</div>
                <div className="text-xs text-muted-foreground">Manter o preço da planilha em todos os casos</div>
              </div>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="competitivo" id="r2" />
              <div>
                <div className="font-medium">Competitivo sempre</div>
                <div className="text-xs text-muted-foreground">Alinhar com mediana do mercado em todos os casos</div>
              </div>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="condicional" id="r3" />
              <div>
                <div className="font-medium">Condicional (recomendado)</div>
                <div className="text-xs text-muted-foreground">
                  PRÓPRIO quando sem concorrência; COMPETITIVO quando há concorrência (ADR-0008)
                </div>
              </div>
            </label>
          </RadioGroup>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Categorias padrão</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span>Linhas de Costura</span>
              <code className="text-xs">MLB1132</code>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span>Botões</span>
              <code className="text-xs">MLB1430</code>
            </div>
            <div className="flex justify-between">
              <span>Fitas</span>
              <code className="text-xs">MLB1429</code>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Definidas via ADR-0009 (lookup determinístico)</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 14.2: Validar**

```bash
pnpm test && pnpm build
```

```bash
pnpm dev
```

Acessar `/#/configuracoes`. Esperado: 3 cards (ML conectado, estratégia de preço com 3 radios, categorias padrão). Encerrar.

- [ ] **Step 14.3: Commit**

```bash
git add -A
git commit -m "feat: Configuracoes screen with ML status, price strategy, categorias

Tudo estático/informacional no M1. Plano 02 Task 14.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Atualizar TASKS e ROADMAP marcando M1 ✅; deploy

**Files:**
- Modify: `docs/TASKS.md`, `docs/ROADMAP.md`

- [ ] **Step 15.1: Push final para acionar deploy do Render**

```bash
git push
```

Aguardar deploy (~40s). Confirmar via list_deploys MCP ou checando `https://publiai-frontend.onrender.com/` manualmente.

- [ ] **Step 15.2: Walkthrough com Diego**

Pedir ao Diego para:
1. Abrir `https://publiai-frontend.onrender.com/`
2. Percorrer as 6 telas: Dashboard → clique em lote-42 → Revisão (expandir 2-3 famílias, editar 1 preço) → voltar → Novo Lote → Progresso (testar com `/#/progresso/lote-37`) → Relatório (lote-41) → Configurações
3. Listar ajustes percebidos

Cada ajuste vira uma nova task no `TASKS.md` antes de fechar M1.

- [ ] **Step 15.3: Atualizar `docs/TASKS.md`**

Trocar todos os `- [ ]` em `## 🏁 M1 — UI mockup com dados fake` para `- [x]`. Atualizar header da seção "Última atualização" e "Próximo passo recomendado" pra apontar para Plano 03 (M2 backend).

- [ ] **Step 15.4: Atualizar `docs/ROADMAP.md`**

Em "Estado geral" trocar para `🟢 M1 concluído, pronto para M2`. Na seção M1, mudar status para `✅ Concluído (data)`. Adicionar entrada no histórico.

- [ ] **Step 15.5: Commit e push**

```bash
git add docs/TASKS.md docs/ROADMAP.md
git commit -m "docs: mark M1 as complete in TASKS and ROADMAP

Plano 02 concluído. 6 telas navegáveis em produção, mockup validado
com Diego em walkthrough. Pronto para iniciar Plano 03 (M2 backend).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Critérios de saída do M1

- [ ] `pnpm test` passa todos os testes (≥ 20 testes)
- [ ] `pnpm build` completa sem erros
- [ ] Site em produção (Render) navega entre as 6 telas
- [ ] Revisão: tabela com 50 famílias, filtros + busca funcionam, expansão accordion abre múltiplas, edição inline reflete no state
- [ ] Walkthrough com Diego concluído com aprovação ou lista de ajustes documentada
- [ ] TASKS.md e ROADMAP.md atualizados

---

## Notas para quem executa este plano

**Erros comuns:**
- `pnpm dlx shadcn add` com Tailwind 4 pode pedir versão canary — tentar `@canary` se default falhar
- React Router 7 mudou alguns imports vs v6 — confirmar `react-router-dom` (não `react-router`)
- Mock data usa cor de fundo CSS em vez de imagens reais — placeholder visual aceitável no M1

**O que NÃO está neste plano:**
- Backend, auth real, upload real → Plano 03 (M2)
- IA/copywriter → Plano 04 (M3)
- Integração ML → Plano 05 (M4)
- Polimento (atalhos teclado, toast, PDF) → Plano 06 (M5)

**Estimativa:** 3-5 dias úteis concentrados. Tasks são independentes — se quiser pular ordem (ex: fazer Configurações antes de Revisão), funciona.
