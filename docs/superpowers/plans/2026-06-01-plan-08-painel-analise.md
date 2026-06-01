# Painel de Análise na Revisão — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover estratégia/concorrência/categoria do final do painel expandido para um Painel de Análise visual no topo, ao lado da foto-capa.

**Architecture:** Componente de apresentação puro `PainelAnalise` que lê campos já existentes do tipo `Familia` (zero mudança em backend/schema/adapter). `FamiliaExpanded` passa a renderizá-lo no topo e remove o bloco de texto antigo + o alerta solto.

**Tech Stack:** React 18 + TypeScript, Tailwind, shadcn/ui (`Badge`), ícones `lucide-react`, Vitest + Testing Library. Util `fmtBRL` em `src/lib/formato.ts`, `cn` em `src/lib/utils.ts`.

**Spec:** `docs/superpowers/specs/2026-06-01-painel-analise-revisao-design.md`

---

## Convenções (ler antes de começar)

- Imports usam alias `@/` (ex.: `import { Badge } from '@/components/ui/badge'`).
- Componentes em `src/components/*.tsx`; testes em `tests/components/*.test.tsx`.
- Rodar 1 teste: `pnpm vitest run tests/components/<arquivo>.test.tsx`. Suíte: `pnpm test`.
- Tipos check/build: `pnpm build`. Lint: `pnpm lint` (deve ficar verde — 0 errors).
- Cores semânticas (classes Tailwind): azul `bg-blue-50 text-blue-700 border-blue-200`;
  âmbar `bg-amber-50 text-amber-700 border-amber-200`; neutro `bg-muted text-muted-foreground`;
  vermelho `text-destructive` + `border-destructive/30 bg-destructive/5`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/components/painel-analise.tsx` (criar) | Componente visual de análise + helper `nomeCategoriaAmigavel` |
| `tests/components/painel-analise.test.tsx` (criar) | Testes de render por cenário |
| `src/components/familia-expanded.tsx` (modificar) | Renderiza o painel no topo ao lado da foto; remove bloco antigo + alerta solto |

Campos lidos de `Familia` (já existem): `estrategiaPreco` (`'PROPRIO'|'COMPETITIVO'`),
`estrategiaMotivo`, `concorrencia` (`'sem'|'moderada'|'alta'`), `concorrenciaVendedores`,
`concorrenciaPrecoMin`, `tipoAviamento` (`'linha'|'botao'|'fita'|'outro'|null`), `categoriaMlId`,
`precoAbaixo20pc`.

---

### Task 1: Componente `PainelAnalise` (TDD)

**Files:**
- Create: `src/components/painel-analise.tsx`
- Test: `tests/components/painel-analise.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PainelAnalise } from '@/components/painel-analise';
import type { Familia } from '@/lib/tipos-dominio';

function familiaBase(over: Partial<Familia> = {}): Familia {
  return {
    id: 'f1', loteId: 'l1', codigoPai: '00445975',
    titulo: 'FITA CETIM N.3', descricao: '', operacao: 'CREATE',
    estrategiaPreco: 'PROPRIO', estrategiaMotivo: 'nosso preço já é mais competitivo que o mercado',
    concorrencia: 'alta', concorrenciaVendedores: 6, concorrenciaPrecoMin: 12.62,
    tipoAviamento: 'fita', categoriaMlId: 'MLB255054',
    precoMin: 2.95, precoMax: 2.95, precoAbaixo20pc: false,
    capaStoragePath: null, variacoes: [], status: 'pronto',
    tokensInput: null, tokensOutput: null, custoCentavos: null,
    tituloEditadoPeloOperador: false, descricaoEditadaPeloOperador: false,
    variacoesSemCor: 0,
    ...over,
  };
}

describe('PainelAnalise', () => {
  it('estratégia PRÓPRIO com motivo', () => {
    render(<PainelAnalise familia={familiaBase()} />);
    expect(screen.getByText('PRÓPRIO')).toBeInTheDocument();
    expect(screen.getByText(/já é mais competitivo/i)).toBeInTheDocument();
  });

  it('estratégia COMPETITIVO', () => {
    render(<PainelAnalise familia={familiaBase({ estrategiaPreco: 'COMPETITIVO', estrategiaMotivo: 'concorrência presente — bater menor preço' })} />);
    expect(screen.getByText('COMPETITIVO')).toBeInTheDocument();
  });

  it('concorrência alta mostra vendedores e menor preço', () => {
    render(<PainelAnalise familia={familiaBase()} />);
    expect(screen.getByText(/alta/i)).toBeInTheDocument();
    expect(screen.getByText(/6 vendedores/i)).toBeInTheDocument();
    expect(screen.getByText(/12,62/)).toBeInTheDocument();
  });

  it('concorrência sem → "sem concorrência"', () => {
    render(<PainelAnalise familia={familiaBase({ concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null })} />);
    expect(screen.getByText(/sem concorrência/i)).toBeInTheDocument();
  });

  it('categoria definida mostra nome amigável + id', () => {
    render(<PainelAnalise familia={familiaBase()} />);
    expect(screen.getByText(/Fita de Cetim/i)).toBeInTheDocument();
    expect(screen.getByText(/MLB255054/)).toBeInTheDocument();
  });

  it('categoria indefinida (tipo outro / sem id) alerta', () => {
    render(<PainelAnalise familia={familiaBase({ tipoAviamento: 'outro', categoriaMlId: null })} />);
    expect(screen.getByText(/categoria indefinida/i)).toBeInTheDocument();
  });

  it('alerta de preço perigoso só quando precoAbaixo20pc', () => {
    const { rerender } = render(<PainelAnalise familia={familiaBase()} />);
    expect(screen.queryByText(/abaixo do m[íi]nimo/i)).not.toBeInTheDocument();
    rerender(<PainelAnalise familia={familiaBase({ precoAbaixo20pc: true })} />);
    expect(screen.getByText(/abaixo do m[íi]nimo/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm vitest run tests/components/painel-analise.test.tsx`
Expected: FAIL (módulo `@/components/painel-analise` não existe)

- [ ] **Step 3: Implementar o componente**

```tsx
import { Coins, Tag, Store, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import type { Familia, TipoAviamento, Concorrencia } from '@/lib/tipos-dominio';

function nomeCategoriaAmigavel(tipo: TipoAviamento | null): string {
  switch (tipo) {
    case 'linha': return 'Fios e Cadarços';
    case 'fita': return 'Fita de Cetim';
    case 'botao': return 'Botões';
    default: return '—';
  }
}

const CORES_CONCORRENCIA: Record<Concorrencia, string> = {
  sem: 'bg-muted text-muted-foreground',
  moderada: 'bg-blue-50 text-blue-700 border border-blue-200',
  alta: 'bg-amber-50 text-amber-700 border border-amber-200',
};

export function PainelAnalise({ familia }: { familia: Familia }) {
  const proprio = familia.estrategiaPreco === 'PROPRIO';
  const temConcorrencia = familia.concorrenciaVendedores > 0;
  const categoriaIndefinida = !familia.categoriaMlId;

  return (
    <div className="flex flex-1 flex-col gap-2 rounded-lg border bg-background p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Análise para publicação
      </span>

      {familia.precoAbaixo20pc && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span className="text-destructive">
            Preço de publicação abaixo do mínimo aceitável (mais de 20% abaixo da planilha). Reveja antes de aprovar.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {/* Estratégia */}
        <div className="rounded-md border p-2">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Coins className="h-3.5 w-3.5" /> Estratégia
          </div>
          <Badge
            className={cn(
              'font-semibold',
              proprio
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
            )}
          >
            {familia.estrategiaPreco}
          </Badge>
          <p className="mt-1 text-xs text-muted-foreground">{familia.estrategiaMotivo}</p>
        </div>

        {/* Categoria */}
        <div className={cn('rounded-md border p-2', categoriaIndefinida && 'border-destructive/30 bg-destructive/5')}>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Tag className="h-3.5 w-3.5" /> Categoria
          </div>
          {categoriaIndefinida ? (
            <p className="text-xs font-medium text-destructive">
              Categoria indefinida — escolha antes de publicar
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">{nomeCategoriaAmigavel(familia.tipoAviamento)}</p>
              <p className="text-xs text-muted-foreground">{familia.categoriaMlId}</p>
            </>
          )}
        </div>
      </div>

      {/* Concorrência */}
      <div className="rounded-md border p-2">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Store className="h-3.5 w-3.5" /> Concorrência
        </div>
        {temConcorrencia ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge className={cn('font-semibold capitalize', CORES_CONCORRENCIA[familia.concorrencia])}>
              {familia.concorrencia}
            </Badge>
            <span>{familia.concorrenciaVendedores} vendedores</span>
            {familia.concorrenciaPrecoMin != null && (
              <span>· menor preço <span className="font-medium text-foreground">{fmtBRL(familia.concorrenciaPrecoMin)}</span></span>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">sem concorrência detectada</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm vitest run tests/components/painel-analise.test.tsx`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add src/components/painel-analise.tsx tests/components/painel-analise.test.tsx
git commit -m "feat(ui): PainelAnalise visual (estrategia/concorrencia/categoria)"
```

---

### Task 2: Integrar no topo do `FamiliaExpanded` e remover o bloco antigo

**Files:**
- Modify: `src/components/familia-expanded.tsx`

- [ ] **Step 1: Importar o componente**

No topo do arquivo, junto aos outros imports de componentes:

```tsx
import { PainelAnalise } from '@/components/painel-analise';
```

- [ ] **Step 2: Reestruturar o bloco do topo (foto-capa + painel lado a lado)**

Localizar o bloco do topo (o `div` com `mb-4 flex items-start gap-4 border-b pb-4` que contém
`<FotoCapaFamilia>` e os botões Trocar/Subir/Remover) e envolvê-lo para acomodar o painel à
direita. Trocar a linha de abertura:

```tsx
      <div className="mb-4 flex items-start gap-4 border-b pb-4">
```

por:

```tsx
      <div className="mb-4 flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-start">
```

E, imediatamente **antes** do fechamento desse `div` (logo após o `</div>` que fecha a coluna
da foto-capa, antes do `</div>` externo do bloco do topo), inserir:

```tsx
        <PainelAnalise familia={familia} />
```

- [ ] **Step 3: Remover o alerta de preço perigoso solto do topo**

Localizar e **remover** este bloco inteiro (fica logo após o `</div>` do bloco da foto-capa):

```tsx
      {familia.precoAbaixo20pc && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <div className="font-semibold text-destructive">
              Atenção: preço sugerido abaixo do mínimo aceitável
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              O preço sugerido pela estratégia <strong>{familia.estrategiaPreco}</strong> ficou
              mais de 20% abaixo do preço da sua planilha. Reveja antes de aprovar — pode estar
              vendendo no prejuízo.
            </div>
          </div>
        </div>
      )}
```

(O alerta agora vive dentro do `PainelAnalise`.)

- [ ] **Step 4: Remover o bloco de texto antigo (estratégia/concorrência/categoria)**

Localizar e **remover** este bloco inteiro na coluna esquerda (vem depois do botão "Regenerar
descrição"):

```tsx
          <div className="mt-4 flex items-center gap-2">
            <Badge variant={familia.estrategiaPreco === 'PROPRIO' ? 'outline' : 'secondary'}>
              {familia.estrategiaPreco}
            </Badge>
            <span className="text-xs text-muted-foreground">{familia.estrategiaMotivo}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Concorrência: <span className="font-medium">{familia.concorrencia}</span>
            {familia.concorrenciaVendedores > 0 && (
              <>
                {' · '}
                {familia.concorrenciaVendedores}{' '}
                {familia.concorrenciaVendedores === 1 ? 'vendedor' : 'vendedores'}
                {familia.concorrenciaPrecoMin != null && (
                  <>
                    {' · menor preço '}
                    <span className="font-medium">{fmtBRL(familia.concorrenciaPrecoMin)}</span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {familia.categoriaMlId ? (
              <>
                Categoria: <span className="font-medium">{familia.categoriaMlId}</span>
                {familia.tipoAviamento && <> ({familia.tipoAviamento})</>}
              </>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-destructive">
                <AlertTriangle className="h-3 w-3" />
                Categoria indefinida — escolha manual antes de publicar
              </span>
            )}
          </div>
```

- [ ] **Step 5: Limpar imports órfãos**

Após as remoções, `Badge`, `AlertTriangle` e `fmtBRL` podem ter ficado sem uso em
`familia-expanded.tsx` (agora vivem no `PainelAnalise`). Verificar e remover dos imports os que
ficaram órfãos. Conferir com o lint (próximo passo) — `no-unused-vars` aponta.

- [ ] **Step 6: Build + lint + testes**

Run: `pnpm build && pnpm lint && pnpm test`
Expected: build sem erros TS; lint 0 errors; todos os testes passam (148 baseline + 7 do painel = 155).

- [ ] **Step 7: Commit**

```bash
git add src/components/familia-expanded.tsx
git commit -m "feat(ui): painel de analise no topo do expandido; remove bloco antigo"
```

---

### Task 3: Atualizar docs

**Files:**
- Modify: `docs/TASKS.md`, `CLAUDE.md` (histórico)

- [ ] **Step 1: Registrar no TASKS.md**

Na seção do M4/M1 (ajustes de UX da revisão), adicionar uma linha marcando a melhoria do painel
de análise como concluída, referenciando o spec/plano.

- [ ] **Step 2: Registrar no histórico do CLAUDE.md**

Adicionar linha na tabela "Histórico deste CLAUDE.md" (2026-06-01): painel de análise visual no
topo da revisão (spec + plano-08), só frontend, N testes verdes.

- [ ] **Step 3: Commit**

```bash
git add docs/TASKS.md CLAUDE.md
git commit -m "docs: painel de analise visual na revisao concluido"
```

---

## Self-Review

- **Cobertura do spec:** componente `PainelAnalise` com 4 elementos (estratégia/categoria/
  concorrência/alerta) — Task 1 ✓; localização no topo ao lado da foto + remoção do bloco antigo
  e do alerta solto — Task 2 ✓; helper `nomeCategoriaAmigavel` — Task 1 ✓; cores semânticas —
  Task 1 ✓; testes dos cenários — Task 1 ✓; responsivo (flex-col→sm:flex-row) — Task 2 Step 2 ✓;
  fora de escopo (FamiliaRow, backend) respeitado — nenhuma task toca.
- **Placeholders:** nenhum — todo código está completo nos steps.
- **Consistência de tipos:** `PainelAnalise({ familia })` usado igual em Task 1 e Task 2;
  `nomeCategoriaAmigavel(tipo: TipoAviamento | null)`; campos lidos batem com o tipo `Familia`
  atual (`tipos-dominio.ts`); `fmtBRL` de `@/lib/formato`; `Concorrencia`/`TipoAviamento`
  importados de `@/lib/tipos-dominio` (ambos exportados lá).
- **Risco conhecido:** os trechos a remover na Task 2 (Steps 3–4) devem casar exatamente com o
  arquivo atual; se o `familia-expanded.tsx` divergir, localizar pelos marcadores ("Regenerar
  descrição", "Concorrência:", "Categoria indefinida") e remover o equivalente.
