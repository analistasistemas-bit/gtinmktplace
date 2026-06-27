# Plan 014: Carregar jspdf/jspdf-autotable/xlsx sob demanda (dynamic import no export)

> **Executor instructions**: Follow step by step. Run every verification command. If
> anything in "STOP conditions" occurs, stop and report. When done, update the status
> row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7222675..HEAD -- src/lib/export/index.ts src/components/export/botao-exportar.tsx`
> Se algum mudou desde `7222675`, compare os excerpts; divergência = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `7222675`, 2026-06-26

## Why this matters

`src/lib/export/index.ts` importa **estaticamente** `./pdf` (que importa `jsPDF` + `jspdf-autotable`) e
`./excel` (que importa `* as XLSX` — o build completo do `xlsx`, a maior dependência do app). Como
`BotaoExportar` é usado em Financeiro, DetalheFinanceiro, Publicados e 4 abas de Faturamento, esses
pesos entram nos chunks dessas rotas **mesmo quando o usuário nunca clica em exportar**. Exportar é uma
ação rara; mover jspdf/xlsx para um chunk carregado sob demanda (no clique) tira esse peso do first paint.

## Current state

`src/lib/export/index.ts:1-7`:

```ts
import type { ReportData, ExportConfig, ExportFormato } from './tipos';
import { gerarPdf } from './pdf';
import { gerarExcel } from './excel';

export * from './tipos';
export { gerarPdf } from './pdf';
export { gerarExcel, montarWorkbook } from './excel';
```

`exportar()` (`:31-54`) é **síncrono** (`: void`) e chama `gerarExcel`/`gerarPdf` direto. As re-exportações
estáticas (`:2-3`, `:6-7`) mantêm `pdf`/`excel` no grafo estático mesmo se `exportar` virar dinâmico —
por isso elas precisam sair ou ser redirecionadas.

`src/components/export/botao-exportar.tsx:54-62` — o handler `disparar` **já é async** e já mostra o
estado `gerando` ('Gerando…'); ele chama `exportar(data, config.formato)` **sem await** (porque hoje é
síncrono). Tornar `exportar` async e dar `await` encaixa na latência do import sob o spinner existente.

`src/lib/export/pdf.ts:1` importa `jsPDF` + `jspdf-autotable`. `src/lib/export/excel.ts:1` importa `* as XLSX`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Achar consumidores | `grep -rn "from '@/lib/export'" src tests` | lista quem importa do barrel |
| Build | `pnpm build` | exit 0; chunk separado p/ pdf/excel |
| Test | `pnpm test` | todos passam |
| Typecheck/Lint | `pnpm exec tsc -b && pnpm lint` | exit 0 / 0 errors |

## Scope

**In scope**:
- `src/lib/export/index.ts` (tornar `exportar` async + import dinâmico; remover re-exports estáticos de pdf/excel)
- `src/components/export/botao-exportar.tsx` (dar `await exportar(...)`)
- Quaisquer consumidores que importem `gerarPdf`/`gerarExcel`/`montarWorkbook` **do barrel** `@/lib/export`
  (redirecioná-los para `@/lib/export/pdf` ou `@/lib/export/excel`)

**Out of scope**:
- Não mudar a lógica de geração de PDF/Excel em si (`pdf.ts`/`excel.ts`).
- Não mudar o formato dos relatórios.

## Git workflow

- Worktree isolado. Commit, ex.: `perf(export): carrega jspdf/xlsx sob demanda via dynamic import (#014)`
- NÃO push/PR sem o operador pedir.

## Steps

### Step 1: Mapear quem usa as re-exportações do barrel

`grep -rn "gerarPdf\|gerarExcel\|montarWorkbook" src tests` — anote cada arquivo que as importa **de
`@/lib/export`** (e não direto de `./pdf`/`./excel`). Esses precisarão importar do submódulo direto.

**Verify**: você tem a lista de consumidores (provavelmente testes em `tests/lib/export/`).

### Step 2: Tornar `exportar` async com import dinâmico e remover os imports estáticos de pdf/excel

Reescreva o topo + `exportar` de `index.ts`:

```ts
import type { ReportData, ExportConfig, ExportFormato } from './tipos';

export * from './tipos';

function slug(/* ...inalterado... */) { /* ... */ }
export function nomeArquivo(/* ...inalterado... */) { /* ... */ }

export async function exportar(data: ReportData, config: ExportConfig | ExportFormato): Promise<void> {
  const formato = typeof config === 'string' ? config : config.formato;

  if (formato === 'excel') {
    const { gerarExcel } = await import('./excel');
    gerarExcel(data, nomeArquivo(data.titulo, 'xlsx'));
    return;
  }

  const { gerarPdf } = await import('./pdf');
  const doc = gerarPdf(data);
  if (formato === 'pdf') { doc.save(nomeArquivo(data.titulo, 'pdf')); return; }
  // imprimir: ...inalterado (abre blob)...
}
```

Remova as linhas `import { gerarPdf } from './pdf'`, `import { gerarExcel } from './excel'` e as
re-exportações `export { gerarPdf } from './pdf'` / `export { gerarExcel, montarWorkbook } from './excel'`.

**Verify**: `grep -n "from './pdf'\|from './excel'" src/lib/export/index.ts` → só dentro de `exportar` (dynamic import), nenhum estático no topo.

### Step 3: Redirecionar consumidores diretos (do Step 1)

Para cada arquivo que importava `gerarPdf`/`gerarExcel`/`montarWorkbook` de `@/lib/export`, troque para
`@/lib/export/pdf` ou `@/lib/export/excel`. (`exportar`/`nomeArquivo`/tipos continuam vindo de `@/lib/export`.)

**Verify**: `pnpm exec tsc -b` → exit 0 (nenhum import quebrado).

### Step 4: `await` no botão

Em `botao-exportar.tsx:58`, troque `exportar(data, config.formato);` por `await exportar(data, config.formato);`.

**Verify**: `grep -n "await exportar" src/components/export/botao-exportar.tsx` → mostra a linha.

### Step 5: Build + testes

**Verify**: `pnpm build` exit 0 (a saída deve listar um chunk separado contendo xlsx/jspdf, carregado sob
demanda — confirme que `xlsx`/`jspdf` **não** estão no chunk de entrada principal). `pnpm test` passa;
`pnpm exec tsc -b && pnpm lint` ok.

## Test plan

- Os testes existentes em `tests/lib/export/` (ex.: `adapters.test.ts`) devem continuar verdes após o
  redirecionamento de imports (Step 3). Se algum teste chamava `exportar` e agora ele é async, ajuste
  para `await`.
- Verificação: `pnpm test` + inspeção do output do `pnpm build` (chunk de export separado).

## Done criteria

- [ ] `exportar` é `async` e usa `await import('./pdf')`/`await import('./excel')`.
- [ ] `index.ts` não tem import estático de `./pdf`/`./excel` no topo nem re-export deles.
- [ ] Consumidores diretos de `gerarPdf`/`gerarExcel`/`montarWorkbook` importam do submódulo.
- [ ] `botao-exportar.tsx` dá `await exportar(...)`.
- [ ] `pnpm build` exit 0 com jspdf/xlsx em chunk sob demanda (não no entry principal).
- [ ] `pnpm test` passa; `pnpm exec tsc -b` 0; `pnpm lint` 0 errors.
- [ ] Linha de status atualizada em `plans/README.md`.

## STOP conditions

Pare e reporte se:

- Algum consumidor de `gerarPdf`/`gerarExcel`/`montarWorkbook` estiver num **caminho síncrono crítico**
  que não pode esperar um import dinâmico (não deveria — só `exportar` os usa em runtime de UI).
- O `pnpm build` não separar o chunk (sinal de que uma re-exportação estática sobrou).

## Maintenance notes

- Acoplamento a vigiar: novos formatos de export devem seguir o mesmo padrão (dynamic import no `exportar`).
- Revisor deve checar: nenhum import estático de `xlsx`/`jspdf` sobrou no grafo de entrada (olhar o build).
