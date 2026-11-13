# Badges de kit e filtro por kits em Publicados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar, com a linha fechada em Publicados, badges por tipo de kit (vinculado, com variação, virtual) com detalhe no hover, e trocar o botão "Com kit de variação" por um filtro "Kits".

**Architecture:** Uma função pura em `src/lib/publicados.ts` (`indiceKits`) recebe os itens publicados e as duas listas de kits e devolve, por `codigoPai`, as marcas de kit do item. Badge e filtro leem só desse índice. Uma consulta nova e única traz os kits vinculados da org; variação e virtual já estão carregados.

**Tech Stack:** React 19 + TypeScript, TanStack Query, Tailwind, shadcn/Radix (`Select`, `Tooltip`), vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-13-badges-kit-publicados-design.md`

## Global Constraints

- Sem migration, sem edge function, sem escrita no ML.
- Rótulos exatos no produto-base: `Tem kit vinculado`, `Tem kit com variação`, `Compõe kit virtual`. No anúncio do kit: `Kit ×N`, `Kit com variação`. A linha de Kit Virtual (`LinhaKitVirtual`) não muda.
- Dropdown: sempre `Select` de `src/components/ui/select.tsx`. Hover: `Tooltip` de `src/components/ui/tooltip.tsx` com gatilho `button`.
- Texto da badge com contraste mínimo 4,5:1 nos temas claro e escuro. Nunca verde, amarelo ou vermelho (são cores de status). Rótulo de texto sempre visível.
- Parâmetro antigo `?comkit=1` continua aceito e equivale a `kit=variacao`; se `kit` vier junto, `kit` vence.
- Blocos "Kits vinculados" e "Kits com variação" da linha expandida não mudam.
- Worktree: `pnpm install` real (sem symlink de `node_modules`), copiar `.env.test` e `.env.local` do checkout principal. Git: `/usr/bin/git`, um comando por chamada.
- Antes de reportar pronto: `pnpm test -- <arquivos>`, `pnpm lint`, `pnpm build`.
- Commits terminam com `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. Leitura dos kits falhou ou ainda carrega e o filtro está em "Sem kit": nenhuma linha some; a tela avisa "Não foi possível ler os kits" em caso de falha. (Task 2, Task 4)
2. Link antigo `?comkit=1` com e sem o módulo `kit_variacao`: com módulo filtra variação; sem módulo o filtro é ignorado. (Task 2, Task 4)
3. Duas famílias de kit vinculado para a mesma base e multiplicador (ciclos de UPDATE): conta só a de `criadoEm` mais recente. (Task 1)
4. Anúncio que é kit vinculado e também compõe um kit virtual: recebe as duas marcas. (Task 1)
5. Componente de kit virtual com `codigo_pai` nulo: ignorado, sem erro. (Task 1)

---

### Task 1: Índice de kits (função pura) e dados

**Files:**
- Modify: `src/lib/publicados.ts` (tipos novos, `indiceKits`, campo em `PublicadoItem`)
- Modify: `src/lib/queries.ts` (`fetchKitsVinculadosDaOrg`, `QK.kitsVinculadosOrg`, preencher `kitVirtualComponentes` no bloco de kits virtuais de `fetchPublicados`, ~linha 1301)
- Test: `src/lib/__tests__/publicados-kits.test.ts`

**Interfaces:**
- Consumes: `KitVinculado` (`src/lib/queries.ts:121`), `KitVariacaoResumo` (`src/lib/kit-variacao-edge.ts:127`).
- Produces (em `src/lib/publicados.ts`):

```ts
export type TipoKit = 'vinculado' | 'variacao' | 'virtual';
export type EstadoKit = 'normal' | 'aguardando' | 'montando' | 'falha';
export interface MarcaKit {
  tipo: TipoKit;
  /** 'tem' = produto-base (ou componente, no virtual); 'e' = o anúncio é o próprio kit. */
  papel: 'tem' | 'e';
  /** Pior estado entre os kits da marca: falha > montando > aguardando > normal. */
  estado: EstadoKit;
  rotulo: string;
  detalhe: string;
}
export type IndiceKits = ReadonlyMap<string, MarcaKit[]>; // chave: PublicadoItem.codigoPai
export function indiceKits(
  itens: PublicadoItem[],
  vinculados: Array<Pick<KitVinculado, 'codigoPai' | 'kitBaseCodigoPai' | 'multiplicador' | 'status' | 'mlItemId' | 'criadoEm'>>,
  variacao: Array<Pick<KitVariacaoResumo, 'codigoPaiBase' | 'codigoPaiKit' | 'pecasPorKit' | 'status'>>,
): IndiceKits;
// PublicadoItem ganha:
//   kitVirtualComponentes?: string[]  // codigo_pai dos componentes (nulos fora); só com ehKitVirtual
```
- Produces (em `src/lib/queries.ts`): `fetchKitsVinculadosDaOrg(): Promise<KitVinculado[]>` (mesmo select e mapeamento de `fetchKitsDosProdutos`, sem o `.in`) e `QK.kitsVinculadosOrg = ['kits-do-produto', '__org'] as const` (fica sob `QK.kitsDoProdutoRaiz`, então as invalidações existentes já a renovam).

Regras que a assinatura não fixa:
- Vinculado, estado por kit: `erro` → falha; `publicando`, `pendente`, `processando` → montando; `pronto` sem `mlItemId` → aguardando; resto → normal. Mesmo base + multiplicador repetido: vale o `criadoEm` mais recente.
- Vinculado, textos: papel `tem` → rótulo `Tem kit vinculado`, detalhe `Kit vinculado: Kit 4 (ativo), Kit 6 (processando)` (palavras: ativo / processando / aguardando publicação / falhou, em ordem de multiplicador). Papel `e` (item com `kitBaseCodigoPai`) → rótulo `Kit ×N` (N do kit cujo `codigoPai` é o do item; sem achar, `Kit vinculado`), detalhe `Este anúncio é um kit vinculado de <kitBaseCodigoPai>`.
- Variação: ignora `status === 'encerrado'`. `erro` → falha; `publicando`, `encerrando` → montando. Papel `tem` (chave `codigoPaiBase`) → `Tem kit com variação`, detalhe `Kit com variação: Kit 3 · 00000250` (peças · `codigoPaiKit`, vários separados por vírgula). Papel `e` (chave `codigoPaiKit`) → `Kit com variação`, detalhe `Este anúncio é um kit com variação de <codigoPaiBase>`. A base recebe a marca mesmo sem o kit ter linha em `itens`.
- Virtual: para cada item com `ehKitVirtual`, o próprio item recebe `{ tipo: 'virtual', papel: 'e', rotulo: 'Kit Virtual', detalhe: 'Kit virtual' }` e cada código em `kitVirtualComponentes` recebe papel `tem`, rótulo `Compõe kit virtual`, detalhe `Compõe o kit virtual: <título>` (vários títulos separados por vírgula numa só marca). Estado sempre normal.
- Uma marca por (tipo, papel) por código. Ordem das marcas: vinculado, variacao, virtual.

- [ ] **Step 1: Escrever os testes que falham** em `src/lib/__tests__/publicados-kits.test.ts`, com um helper `item(codigoPai, extra?)` no estilo de `publicados-com-kit-variacao.test.ts`:

```ts
it('base com kit vinculado: rótulo, detalhe em ordem de multiplicador e pior estado', () => {
  const idx = indiceKits([item('BASE')], [
    v({ codigoPai: 'K6', kitBaseCodigoPai: 'BASE', multiplicador: 6, status: 'publicando' }),
    v({ codigoPai: 'K4', kitBaseCodigoPai: 'BASE', multiplicador: 4, status: 'publicado', mlItemId: 'MLB1' }),
  ], []);
  expect(idx.get('BASE')).toEqual([{ tipo: 'vinculado', papel: 'tem', estado: 'montando',
    rotulo: 'Tem kit vinculado', detalhe: 'Kit vinculado: Kit 4 (ativo), Kit 6 (processando)' }]);
});
it('kit vinculado em erro vence montagem; pronto sem ml_item_id é aguardando', ...);
  // erro + publicando → estado 'falha', detalhe contém 'Kit 4 (falhou)'
  // só pronto/mlItemId null → estado 'aguardando', detalhe 'Kit vinculado: Kit 4 (aguardando publicação)'
it('mesma base e multiplicador repetidos: vale o criadoEm mais recente', ...);
  // erro em 2026-11-01 + publicado em 2026-11-10 → estado 'normal', detalhe 'Kit vinculado: Kit 4 (ativo)'
it('anúncio que é kit vinculado: Kit ×N e a base no detalhe', ...);
  // item('K4', { kitBaseCodigoPai: 'BASE' }) → rotulo 'Kit ×4', papel 'e',
  // detalhe 'Este anúncio é um kit vinculado de BASE'
it('kit com variação: marca na base e no anúncio do kit; encerrado não acende', ...);
  // base: rotulo 'Tem kit com variação', detalhe 'Kit com variação: Kit 3 · KITVAR'
  // kit: rotulo 'Kit com variação', detalhe 'Este anúncio é um kit com variação de BASE'
  // status 'encerrado' → idx.get('BASE') undefined
it('base recebe a marca de variação mesmo sem o kit na lista de itens', ...);
it('kit virtual: componente recebe "Compõe kit virtual" e codigo nulo é ignorado', ...);
  // item('kit-virtual:1', { ehKitVirtual: true, titulo: 'Kit Escolar', kitVirtualComponentes: ['A', 'B'] })
  // idx.get('A') → [{ tipo: 'virtual', papel: 'tem', estado: 'normal',
  //   rotulo: 'Compõe kit virtual', detalhe: 'Compõe o kit virtual: Kit Escolar' }]
  // idx.get('kit-virtual:1')?.[0].papel === 'e'
it('anúncio que é kit vinculado e compõe kit virtual recebe as duas marcas', ...);
  // tipos em ordem: ['vinculado', 'virtual']
it('produto sem kit não entra no índice', ...);
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test -- src/lib/__tests__/publicados-kits.test.ts` → FAIL (`indiceKits` não existe).
- [ ] **Step 3: Implementar** os tipos e `indiceKits` em `src/lib/publicados.ts`; `fetchKitsVinculadosDaOrg` e `QK.kitsVinculadosOrg` em `src/lib/queries.ts`; em `fetchPublicados`, preencher `kitVirtualComponentes` com os `codigo_pai` não nulos de `kits_virtuais_componentes` (o select já os traz).
- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS. Rodar também `pnpm test -- src/lib/__tests__/publicados-kit-virtual.test.ts src/lib/__tests__/publicados-kit-virtual-fiscal.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(publicados): índice de kits por produto`.

### Task 2: Filtro por kits, URL e chip

**Files:**
- Modify: `src/lib/publicados.ts` (`FiltroPublicados`, `filtrarPublicados`)
- Modify: `src/lib/publicados-url.ts`
- Modify: `src/components/filtros-ativos.tsx`
- Modify: `src/lib/__tests__/publicados-com-kit-variacao.test.ts` (migrar para o filtro novo)
- Test: `src/lib/__tests__/publicados-filtro-kit.test.ts`

**Interfaces:**
- Consumes: `IndiceKits`, `TipoKit` (Task 1).
- Produces:

```ts
export type FiltroKit = 'qualquer' | TipoKit | 'sem';
// FiltroPublicados: sai `somenteComKitVariacao`, entra
//   kit?: FiltroKit | null;
export function filtrarPublicados(
  itens: PublicadoItem[], f: FiltroPublicados,
  /** undefined = kits ainda carregando ou leitura falhou: o filtro de kit não esconde nada. */
  kits?: IndiceKits,
): PublicadoItem[];
// filtros-ativos.tsx
export type ChaveFiltro = 'busca' | 'fornecedor' | 'status' | 'tipo' | 'kit';
```
- Semântica: `qualquer` = item com alguma marca; `vinculado`/`variacao`/`virtual` = item com marca desse tipo (papel `tem` ou `e`); `sem` = item sem marca.
- URL: serializa `kit=<valor>`; nunca mais escreve `comkit`. Na leitura, `kit` válido vence; sem `kit`, `comkit=1` vira `kit: 'variacao'`; valor inválido vira ausente.
- Chip de "Filtros ativos": `Kits: qualquer`, `Kits: vinculado`, `Kits: com variação`, `Kits: virtual`, `Kits: sem kit`.

- [ ] **Step 1: Escrever os testes que falham** em `src/lib/__tests__/publicados-filtro-kit.test.ts`:

```ts
// idx montado com indiceKits: BASE tem vinculado (K4 é o kit), VBASE/VKIT variação, 'kit-virtual:1' com componente A, SOLO sem kit
it.each([
  ['qualquer', ['BASE', 'K4', 'VBASE', 'VKIT', 'kit-virtual:1', 'A']],
  ['vinculado', ['BASE', 'K4']],
  ['variacao', ['VBASE', 'VKIT']],
  ['virtual', ['kit-virtual:1', 'A']],
  ['sem', ['SOLO']],
])('kit=%s', (kit, esperado) => { /* códigos de filtrarPublicados(itens, { kit }, idx) */ });
it('sem índice (carregando ou falha), kit="sem" não esconde nenhuma linha', () => {
  expect(filtrarPublicados(itens, { kit: 'sem' }, undefined)).toHaveLength(itens.length);
});
it('URL: kit=virtual vai e volta', ...);            // estadoParaParams → 'kit=virtual'; paramsParaEstado devolve kit 'virtual'
it('URL: comkit=1 antigo vira kit variacao', ...);   // paramsParaEstado(new URLSearchParams('comkit=1')).filtro.kit === 'variacao'
it('URL: kit vence comkit', ...);                    // 'comkit=1&kit=virtual' → 'virtual'
it('URL: kit inválido é ignorado', ...);             // 'kit=xyz' → filtro.kit undefined
it('URL: nunca mais escreve comkit', ...);           // estadoParaParams({ filtro: { kit: 'variacao' } }).has('comkit') === false
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test -- src/lib/__tests__/publicados-filtro-kit.test.ts` → FAIL.
- [ ] **Step 3: Implementar** as três mudanças e migrar `publicados-com-kit-variacao.test.ts` para `{ kit: 'variacao' }` + índice (mesmas expectativas de base e kit).
- [ ] **Step 4: Rodar e ver passar** — `pnpm test -- src/lib/__tests__` → PASS. `pnpm build` vai falhar em `Publicados.tsx` até a Task 4 (uso de `somenteComKitVariacao`): para manter o build verde nesta task, trocar ali o botão antigo por `kit === 'variacao'` de forma mínima.
- [ ] **Step 5: Commit** — `feat(publicados): filtro por tipo de kit na URL e nos chips`.

### Task 3: Componente das badges

**Files:**
- Create: `src/components/badge-kit.tsx`
- Test: `src/components/__tests__/badge-kit.test.tsx`

**Interfaces:**
- Consumes: `MarcaKit` (Task 1).
- Produces: `export function BadgesKit({ marcas, className }: { marcas: MarcaKit[]; className?: string })` — devolve `null` com lista vazia.

Decisões:
- Cada marca é um `button type="button"` (para receber foco) dentro de `Tooltip`; `onClick` faz `stopPropagation` (a linha expande ao clicar). `aria-label` = `rotulo` + `. ` + `detalhe`. Conteúdo do tooltip = `detalhe`.
- Forma igual à do `StatusPill`: `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium`.
- Ícone à esquerda (h-3 w-3, `aria-hidden`): `falha` → `AlertTriangle`; `montando` → `Loader2` com `motion-safe:animate-spin`; `aguardando` → `Clock`; `normal` → `Package` (vinculado), `Layers` (variação), `Boxes` (virtual).
- Cores (classe por tipo e papel; conferir como o projeto liga o tema escuro e seguir o mesmo mecanismo):

| Tipo | Papel `tem` (translúcido) | Papel `e` (cheio) |
|---|---|---|
| vinculado | `border-teal-600/30 bg-teal-500/10 text-teal-700 dark:text-teal-300` | `border-transparent bg-teal-700 text-white` |
| variacao | `border-violet-600/30 bg-violet-500/10 text-violet-700 dark:text-violet-300` | `border-transparent bg-violet-600 text-white` |
| virtual | `border-info/20 bg-info/10 text-info` (igual ao `StatusPill` info) | não renderiza (a `LinhaKitVirtual` já tem a pill) |

- [ ] **Step 1: Escrever os testes que falham**:

```tsx
it('mostra o rótulo e expõe o detalhe no aria-label', () => {
  render(<BadgesKit marcas={[marca({ rotulo: 'Tem kit vinculado', detalhe: 'Kit vinculado: Kit 4 (ativo)' })]} />);
  expect(screen.getByRole('button', { name: 'Tem kit vinculado. Kit vinculado: Kit 4 (ativo)' })).toHaveTextContent('Tem kit vinculado');
});
it('uma badge por marca, na ordem recebida', ...);          // 3 marcas → 3 buttons
it('papel "e" de kit virtual não renderiza', ...);          // lista só com ela → container vazio
it('clicar na badge não propaga para a linha', ...);        // onClick do pai não é chamado
it('estado falha troca o ícone', ...);                       // data-estado="falha" no button
it('lista vazia não renderiza nada', ...);
```

(Cada `button` leva `data-tipo`, `data-papel` e `data-estado` para os testes e para a validação visual.)

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test -- src/components/__tests__/badge-kit.test.tsx` → FAIL.
- [ ] **Step 3: Implementar** `src/components/badge-kit.tsx`.
- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS; `pnpm lint` limpo no arquivo.
- [ ] **Step 5: Commit** — `feat(publicados): badges de kit com detalhe no hover`.

### Task 4: Ligar na tela Publicados, docs e validação

**Files:**
- Modify: `src/pages/Publicados.tsx` (consulta, índice, badges na linha, `Select` de kits, aviso de falha)
- Create: `src/hooks/useKitsVinculadosOrg.ts`
- Test: `src/pages/__tests__/` — seguir o teste de página existente de Publicados se houver; senão cobrir a parte nova num teste de componente da linha
- Modify: `docs/TASKS.md` e o que a skill `docs-update-checklist` indicar

**Interfaces:**
- Consumes: `indiceKits`, `IndiceKits`, `FiltroKit`, `fetchKitsVinculadosDaOrg`, `QK.kitsVinculadosOrg`, `BadgesKit`, `filtrarPublicados(itens, f, kits?)`.
- Produces: `useKitsVinculadosOrg()` → `useQuery<KitVinculado[]>` com `staleTime: 30_000`.

Decisões:
- Índice na página: `undefined` enquanto `useKitsVinculadosOrg` carrega ou falhou, ou enquanto `useKitsVariacao` carrega ou falhou com o módulo ligado. Módulo `kit_variacao` desligado → lista de variação vazia.
- Filtro efetivo: `filtro.kit === 'variacao'` com módulo desligado é tratado como sem filtro de kit (cobre `?comkit=1` antigo).
- Substitui `codigosComKitVariacao` (linhas ~1564–1570) pelo índice.
- Badges: na coluna do produto, o `CanalBadge` e `<BadgesKit>` ficam num `div className="mt-1 flex flex-wrap items-center gap-1"` (tirar o `mt-1` do `CanalBadge` ali). Recebe `indice?.get(item.codigoPai) ?? []`.
- Filtro: `Select` logo depois do "Tipo", gatilho `h-8 w-full min-w-0 text-sm sm:w-[180px]`, placeholder `Kits`. Itens: `Todos kits` (`__todos`), `Com qualquer kit`, `Kit vinculado`, `Kit com variação` (só com o módulo), `Kit virtual`, `Sem kit`. Remove o botão "Com kit de variação".
- Falha de leitura com filtro de kit ligado: linha de texto acima da tabela, `role="status"`, `Não foi possível ler os kits. A lista está sem o filtro de kits.`
- `removerFiltro('kit')` zera `filtro.kit`; o foco pós-criação de kit (linha ~1591) também zera `kit`.

- [ ] **Step 1: Escrever os testes que falham**: (a) linha de produto com marca mostra o botão `Tem kit vinculado. …`; (b) com `?comkit=1` e módulo desligado a lista não é filtrada; (c) com a consulta de kits em erro e `kit=sem`, todas as linhas aparecem e o aviso `Não foi possível ler os kits` está na tela; (d) escolher `Kit vinculado` no Select deixa só base e kit.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Validação determinística** — `pnpm test`, `pnpm lint`, `pnpm build`, `pnpm preflight` → tudo verde.
- [ ] **Step 5: Validação visual** em sessão isolada (skill `playwright-cli`, nunca o Chrome do Diego), com dados injetados: print real da linha com as três badges nos temas claro e escuro e em 375 px de largura; conferir contraste das badges, quebra de linha na coluna de 260 px e o hover. Salvar os prints em `docs/superpowers/specs/evidencias/`.
- [ ] **Step 6: Docs** — rodar a skill `docs-update-checklist`; registrar em `docs/TASKS.md`.
- [ ] **Step 7: Commit** — `feat(publicados): badges de kit na linha e filtro por kits`.
