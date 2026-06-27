# Design System — PubliAI (Fase 1)

> Fonte da verdade = `src/index.css` + a rota `/#/style-guide`.
> Este guia é derivado do código real e deve ser mantido sincronizado com ele.

**Catálogo vivo:** o projeto tem Storybook configurado (`.storybook/`). Rode
`pnpm storybook` (porta 6006) para navegar tokens e componentes com toggle dark/light,
ou `pnpm build-storybook` para o build estático. Stories ficam em `src/**/*.stories.tsx`.

---

## Sumário

1. [Paleta de cores](#1-paleta-de-cores)
2. [Tokens semânticos (feedback)](#2-tokens-semânticos-feedback)
3. [Tipografia](#3-tipografia)
4. [Elevação](#4-elevação)
5. [Motion](#5-motion)
6. [Tema dark/light](#6-tema-darklight)
7. [Componentes reutilizáveis](#7-componentes-reutilizáveis)

---

## 1. Paleta de cores

Todos os tokens são variáveis CSS definidas em `src/index.css` e expostos ao Tailwind via `@theme inline`. A paleta usa o espaço de cor **OKLCH**; os dois hues de marca são **~277 (indigo)** e **~300 (violeta)**.

### Tokens base — light (`:root`)

| Token CSS | Tailwind | Descrição |
|---|---|---|
| `--background` | `bg-background` | Fundo da página — quase branco com toque indigo |
| `--foreground` | `text-foreground` | Texto principal |
| `--card` | `bg-card` | Fundo de cards — branco puro |
| `--card-foreground` | `text-card-foreground` | Texto sobre card |
| `--primary` | `bg-primary` / `text-primary` | Indigo médio — ações principais |
| `--primary-foreground` | `text-primary-foreground` | Texto sobre botão primary |
| `--secondary` | `bg-secondary` | Indigo muito claro — botões secundários |
| `--secondary-foreground` | `text-secondary-foreground` | Texto sobre secondary |
| `--muted` | `bg-muted` | Fundos subdued (ícones, badges neutros) |
| `--muted-foreground` | `text-muted-foreground` | Texto de suporte / placeholder |
| `--accent` | `bg-accent` | Violeta suave (~300) — destaques de hover |
| `--accent-foreground` | `text-accent-foreground` | Texto sobre accent |
| `--border` | `border-border` | Bordas padrão |
| `--ring` | `ring-ring` | Outline de foco |
| `--destructive` | `bg-destructive` | Vermelho para ações destrutivas |

### Tokens base — dark (`.dark`)

Os mesmos tokens têm valores escuros. Diferenças notáveis:

- `--background`: `oklch(0.165 0.012 277)` — quase preto acinzentado
- `--card`: `oklch(0.205 0.014 277)` — cinza escuro com toque indigo
- `--primary`: `oklch(0.64 0.18 277)` — indigo mais claro que no light (mais legível sobre fundo escuro)
- `--border`: `oklch(1 0 0 / 10%)` — branco semitransparente

---

## 2. Tokens semânticos (feedback)

Quatro tokens de estado, cada um com variante `-foreground`. Definidos em ambos os temas.

| Token | Light (background) | Dark (background) | Uso semântico |
|---|---|---|---|
| `--success` | `oklch(0.62 0.15 150)` | `oklch(0.70 0.15 150)` | Publicado, operação concluída |
| `--warning` | `oklch(0.72 0.16 75)` | `oklch(0.80 0.15 75)` | Atenção, incompleto |
| `--info` | `oklch(0.60 0.14 240)` | `oklch(0.70 0.14 240)` | Informativo, neutro-positivo |
| `--danger` | `oklch(0.58 0.22 25)` | `oklch(0.68 0.19 25)` | Erro, falha crítica |

### Como usar os tokens semânticos

```tsx
// Fundo sólido
<div className="bg-success text-success-foreground">Publicado</div>

// Fundo translúcido (10%) — padrão em badges/pills
<div className="bg-success/10 text-success border border-success/20">Publicado</div>

// Via componente StatusPill (recomendado)
<StatusPill tone="success">Publicado</StatusPill>
<StatusPill tone="warning">Incompleto</StatusPill>
<StatusPill tone="danger">Erro</StatusPill>
<StatusPill tone="info">Processando</StatusPill>
<StatusPill tone="neutral">Rascunho</StatusPill>
```

---

## 3. Tipografia

Fonte: **Geist Variable** (`@fontsource-variable/geist`). Classes de utilitário definidas em `@layer components` no `src/index.css`:

| Classe | Tamanho | Peso | Uso |
|---|---|---|---|
| `.text-display` | 2.25 rem | 600 | Títulos de landing / hero (uso raro) |
| `.text-h1` | 1.5 rem | 600 | Título principal de página |
| `.text-h2` | 1.25 rem | 600 | Subtítulo de seção |
| `.text-h3` | 1.0625 rem | 600 | Cabeçalho de card / grupo |
| `.text-caption` | 0.75 rem | regular | Metadados, datas, labels auxiliares (cor muted) |

Todas as classes de heading têm `letter-spacing` negativo para densidade visual.

```tsx
<h1 className="text-display">PubliAI</h1>
<h2 className="text-h1">Revisão do lote</h2>
<h3 className="text-h2">Famílias</h3>
<p className="text-caption">Atualizado há 3 minutos</p>
```

---

## 4. Elevação

Quatro níveis de sombra definidos via `@theme inline` em `src/index.css`:

| Token | Tailwind | Definição | Uso típico |
|---|---|---|---|
| `--shadow-xs` | `shadow-xs` | `0 1px 2px oklch(0 0 0 / 16%)` | Pill / badge flutuante |
| `--shadow-sm` | `shadow-sm` | `0 1px 3px / 22% + 0 1px 2px / 14%` | Dropdown, tooltip |
| `--shadow-md` | `shadow-md` | `0 4px 12px oklch(0 0 0 / 26%)` | Card interativo (hover) |
| `--shadow-lg` | `shadow-lg` | `0 12px 32px oklch(0 0 0 / 32%)` | Modal, popover |

---

## 5. Motion

Tokens de easing e duração definidos em `@theme inline`:

| Token CSS | Valor | Descrição |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Saída rápida — entradas de UI |
| `--ease-emph` | `cubic-bezier(0.65, 0, 0.35, 1)` | Ênfase — transições de estado |
| `--duration-fast` | `120ms` | Micro-interações (hover, toggle) |
| `--duration-base` | `180ms` | Transições padrão |
| `--duration-slow` | `240ms` | Animações maiores (modal open) |

O media query `prefers-reduced-motion` reduz todas as durações a `0.01ms` automaticamente.

```css
/* Uso em CSS puro */
transition: opacity var(--duration-base) var(--ease-out);
```

---

## 6. Tema dark/light

- **Padrão:** dark mode (classe `.dark` no `<html>`)
- **Persistência:** `localStorage['publiai-theme']`
- **Anti-flash:** script inline no `index.html` aplica a classe antes do React hidratar

### Hook `useTheme()`

```tsx
import { useTheme } from '@/components/theme-provider';

function ThemeToggleButton() {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={toggle}>
      {theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
    </button>
  );
}
```

Interface completa:

```ts
interface ThemeContextValue {
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;
  toggle: () => void;
}
```

O `ThemeProvider` deve envolver o app no `main.tsx`:

```tsx
<ThemeProvider>
  <App />
</ThemeProvider>
```

---

## 7. Componentes reutilizáveis

Todos os componentes abaixo aceitam `className?: string` para overrides pontuais via `cn()`.

---

### PageHeader

Cabeçalho padrão de página: título, subtítulo opcional e slot de ações à direita.

```tsx
import { PageHeader } from '@/components/ui/page-header';

<PageHeader
  title="Lotes importados"
  subtitle="Gerencie os lotes de planilhas enviados."
  actions={<Button>Novo lote</Button>}
/>
```

**Props:**

| Prop | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `title` | `string` | sim | Título principal (renderizado como `<h1 className="text-h1">`) |
| `subtitle` | `string` | não | Subtítulo em `text-muted-foreground` |
| `actions` | `ReactNode` | não | Botões/ações alinhados à direita |
| `className` | `string` | não | Override de classes |

---

### Section

Agrupa conteúdo sob um cabeçalho de seção com título, descrição e ações opcionais.

```tsx
import { Section } from '@/components/ui/section';

<Section
  title="Famílias prontas"
  description="Revisadas e aptas para publicação."
  actions={<Button variant="outline" size="sm">Filtrar</Button>}
>
  {/* conteúdo */}
</Section>
```

**Props:**

| Prop | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `title` | `string` | não | Cabeçalho (`text-h3`) |
| `description` | `string` | não | Texto auxiliar em `text-muted-foreground` |
| `actions` | `ReactNode` | não | Ações alinhadas à direita do título |
| `children` | `ReactNode` | sim | Conteúdo da seção |
| `className` | `string` | não | Override de classes |

---

### EmptyState

Estado vazio com ícone, mensagem e ação opcional. Exibido dentro de listas/tabelas sem dados.

```tsx
import { EmptyState } from '@/components/ui/empty-state';
import { PackageOpen } from 'lucide-react';

<EmptyState
  icon={PackageOpen}
  title="Nenhum lote encontrado"
  description="Faça upload de uma planilha para começar."
  action={<Button>Importar planilha</Button>}
/>
```

**Props:**

| Prop | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `icon` | `ComponentType<{ className?: string }>` | não | Componente Lucide (recebe `className`) |
| `title` | `string` | sim | Mensagem principal |
| `description` | `string` | não | Mensagem de suporte |
| `action` | `ReactNode` | não | Botão de CTA |
| `className` | `string` | não | Override de classes |

---

### StatusPill

Badge de status semântico. Usa os tokens `success/warning/danger/info` com fundo translúcido (10%) e borda (20%).

```tsx
import { StatusPill } from '@/components/ui/status-pill';

<StatusPill tone="success">Publicado</StatusPill>
<StatusPill tone="warning">Incompleto</StatusPill>
<StatusPill tone="danger">Erro</StatusPill>
<StatusPill tone="info">Processando</StatusPill>
<StatusPill tone="neutral">Rascunho</StatusPill>
```

**Props:**

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `tone` | `'success' \| 'warning' \| 'danger' \| 'info' \| 'neutral'` | `'neutral'` | Tom semântico |
| `children` | `ReactNode` | — | Texto/ícone do pill |
| `className` | `string` | — | Override de classes |

Aceita qualquer `ReactNode` como filho — comum adicionar um ícone Lucide com `h-3 w-3` antes do texto.

---

### KpiCard

Card de métrica com label, valor, ícone, variação (delta) e hint.

```tsx
import { KpiCard } from '@/components/ui/kpi-card';
import { Package } from 'lucide-react';

<KpiCard
  label="Famílias publicadas"
  value={42}
  icon={Package}
  delta="+5 hoje"
  deltaTrend="up"
  hint="vs. ontem"
/>

// Estado de carregamento
<KpiCard label="..." value="" loading />
```

**Props:**

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `label` | `string` | — | Label da métrica |
| `value` | `string \| number` | — | Valor principal |
| `icon` | `ComponentType<{ className?: string }>` | — | Ícone Lucide no canto superior direito |
| `delta` | `string` | — | Variação (ex.: `"+5"`) |
| `deltaTrend` | `'up' \| 'down' \| 'neutral'` | `'neutral'` | Direciona cor e ícone da seta |
| `hint` | `string` | — | Texto auxiliar ao lado do delta |
| `loading` | `boolean` | — | Exibe skeleton no lugar do conteúdo |
| `className` | `string` | — | Override de classes |

Cores do delta: `up` → `text-success`, `down` → `text-destructive`, `neutral` → `text-muted-foreground`.

---

### DataTable

Tabela genérica com colunas tipadas, estado de carregamento (skeleton) e estado vazio.

```tsx
import { DataTable, type Column } from '@/components/ui/data-table';

interface Produto { id: string; nome: string; preco: number; }

const columns: Column<Produto>[] = [
  { key: 'nome',  header: 'Nome',  cell: (r) => r.nome },
  { key: 'preco', header: 'Preço', cell: (r) => `R$ ${r.preco.toFixed(2)}` },
];

<DataTable
  columns={columns}
  rows={produtos}
  rowKey={(r) => r.id}
  loading={isLoading}
  skeletonRows={3}
  empty={<EmptyState title="Nenhum produto." />}
/>
```

**Props:**

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `columns` | `Column<T>[]` | — | Definição de colunas |
| `rows` | `T[]` | — | Dados |
| `rowKey` | `(row: T) => string` | — | Chave única por linha |
| `loading` | `boolean` | — | Exibe N linhas skeleton |
| `empty` | `ReactNode` | mensagem padrão | Conteúdo quando `rows` está vazio |
| `skeletonRows` | `number` | `5` | Quantidade de linhas skeleton |
| `className` | `string` | — | Override no wrapper |

**Tipo `Column<T>`:**

```ts
interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;  // aplicado em TableHead e TableCell
}
```
