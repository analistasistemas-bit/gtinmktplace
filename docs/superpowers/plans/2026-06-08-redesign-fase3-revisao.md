# Redesign PubliAI — Fase 3 (Revisão) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Re-skin premium da tela Revisão (centro de comando) com os tokens/componentes da Fase 1 — **zero mudança de lógica**.

**Architecture:** Re-skin presentacional de 4 arquivos. Cada cor hardcoded → `StatusPill`/token semântico (mapa no spec). Filtros → `Tabs`. PainelAnalise → cards do DS + ícones lucide. **Todo handler/hook/mutation/useState/efeito/cálculo permanece idêntico — muda só markup/classes.**

**Tech Stack:** React 18 + shadcn (StatusPill, Tabs, Card, Badge, Input já existem), lucide. Branch `feat/redesign-publiai`.

**Spec:** `docs/superpowers/specs/2026-06-08-redesign-fase3-revisao-design.md` — **leia o "mapa de tokens" lá; é a regra central.**

**Regra de ouro (todas as tasks):** antes de editar, o implementador faz `git stash`-mental do comportamento: nenhuma linha de lógica muda. Forma de garantir: ao terminar cada arquivo, comparar mentalmente que todo `useState`, hook, `mutate*`, `on*`, `async function`, cálculo e condicional continua **textualmente igual** — só JSX/className/estrutura visual mudou. Rodar os testes existentes (devem passar; se um quebrar por texto/cor, ajustar o seletor SEM afrouxar a asserção de comportamento).

**Testes que cobrem esta tela (devem seguir verdes):** `tests/components/familia-row.test.tsx`, `familia-row-publicavel.test.tsx`, `revisao-acoes.test.tsx`, `revisao-filtros.test.tsx`, `painel-analise.test.tsx`, `card-voce-recebe.test.tsx`.

---

## Task 3a: Revisao.tsx — PageHeader, Tabs, footer, modal

**Files:** Modify `src/pages/Revisao.tsx`

- [ ] **Step 1: PageHeader + Tabs nos filtros**

Preserve TODO o estado/handlers (`filtro`, `setFiltro`, `busca`, `counts`, `toggleLote`, `lidarArquivosDrop`, seleção, publicação). Mudanças visuais:
- Importar `PageHeader` (`@/components/ui/page-header`), `Tabs, TabsList, TabsTrigger` (`@/components/ui/tabs`), `Badge`.
- Acima da barra: `<PageHeader title="Revisão" subtitle={\`${familias.length} famílias\`} actions={<botão de desconto do lote>} />` (mover o botão "Ativar/Desativar desconto no lote" para `actions`, mantendo `onClick={() => toggleLote.mutate(!todasComDesconto)}`).
- Trocar o bloco dos 5 `<button>` de filtro por `Tabs` controlado:
  ```tsx
  <Tabs value={filtro} onValueChange={(v) => setFiltro(v as FiltroOp)}>
    <TabsList>
      <TabsTrigger value="todos">Todos <Badge variant="secondary" className="ml-1.5">{counts.todos}</Badge></TabsTrigger>
      <TabsTrigger value="CREATE">CREATE <Badge variant="secondary" className="ml-1.5">{counts.CREATE}</Badge></TabsTrigger>
      <TabsTrigger value="UPDATE">UPDATE <Badge variant="secondary" className="ml-1.5">{counts.UPDATE}</Badge></TabsTrigger>
      <TabsTrigger value="avisos">Avisos <Badge variant="secondary" className="ml-1.5">{counts.avisos}</Badge></TabsTrigger>
      <TabsTrigger value="incompletas">Incompletas <Badge variant="secondary" className="ml-1.5">{counts.incompletas}</Badge></TabsTrigger>
    </TabsList>
  </Tabs>
  ```
  Manter o `<Input>` de busca ao lado (mesma lógica `busca`/`setBusca`). O banner de "avisos" (`filtro === 'avisos'`) permanece, com as classes de token destructive atuais.

- [ ] **Step 2: Footer sticky + modal re-skin**

- Footer (`selecionadas.size > 0`): manter os contadores e o `onClick={() => setConfirmando(true)}`; aplicar `sticky bottom-0`, `bg-background/95 backdrop-blur`, `border-t`, sombra do DS. Botão primário igual.
- Dialog: manter todo o conteúdo/condicionais (`selecaoTemCreate`/`selecaoTemUpdate`, `coresSelecionadas`, `confirmarPublicacao`). Os 2 `<button>` de listing-type (Clássico/Premium) ganham visual de cartão selecionável do DS (ativo: `border-primary bg-accent`); manter `onClick={() => setListingType(opt.v)}` e o estado.

- [ ] **Step 3: verificar (zero lógica + testes)**

Run: `pnpm test -- tests/components/revisao-filtros.test.tsx tests/components/revisao-acoes.test.tsx` → verdes (ajustar seletores se necessário, sem afrouxar).
Run: `pnpm exec tsc --noEmit` e `pnpm build` → limpos.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Revisao.tsx
git commit -m "feat(redesign): Revisao re-skin (PageHeader, Tabs, footer sticky, modal) — sem mudanca de logica"
```

---

## Task 3b: familia-row.tsx — StatusPill + DS

**Files:** Modify `src/components/familia-row.tsx`

- [ ] **Step 1: Badges → StatusPill, estado editado, DescontoControle**

Preserve TODA a lógica (`useImageUrl`, `familiaPublicavel`, `coresComEstoqueAlterado`, `precoVendaMin/Max`, `DescontoControle` com seus hooks/mutations). Mudanças visuais:
- Importar `StatusPill` (`@/components/ui/status-pill`).
- Trocar cada span/badge colorido pelo `StatusPill` do mapa (spec): operação CREATE→`tone="info"` (ou manter `Badge` default primary), UPDATE→`neutral`; `estoque: N`→`info`; `N sem cor`→`danger`; `🔒 incompleta`→`warning` (manter o `title={pub.motivos.join('\n')}`); `publicado/atualizado`→`success` (manter o `<a href={mlPermalink}>` quando houver); `mudança estrutural`→`warning` (manter o `title`).
- Estado editado: trocar `border-l-purple-500` por `border-l-primary` (manter `border-l-2` e a condicional `familia.editadoPeloOperador`).
- `DescontoControle`: trocar `<input type="number" className="w-14 rounded border px-1">` pelo `Input` do DS (`import { Input }`), mantendo `defaultValue`, `min/max`, `onBlur` idênticos; o "de/por" (`<s>R$ …</s> · R$ … · N% OFF`) re-estilizado com `text-muted-foreground` (sem cor hardcoded). `Checkbox` e mutations intactos.
- A faixa de preço do cabeçalho com `tabular-nums`.

- [ ] **Step 2: verificar**

Run: `pnpm test -- tests/components/familia-row.test.tsx tests/components/familia-row-publicavel.test.tsx` → verdes (ajustar seletores se necessário).
Run: `pnpm exec tsc --noEmit` e `pnpm build` → limpos.

- [ ] **Step 3: Commit**

```bash
git add src/components/familia-row.tsx
git commit -m "feat(redesign): FamiliaRow re-skin (StatusPill, tokens semanticos) — sem mudanca de logica"
```

---

## Task 3c: painel-analise.tsx + card-voce-recebe.tsx — a estrela

**Files:** Modify `src/components/painel-analise.tsx`, `src/components/card-voce-recebe.tsx`

- [ ] **Step 1: PainelAnalise em cards do DS + ícones lucide + tons semânticos**

Preserve TODA a lógica de derivação (`incluidas`, `precoPublicacao`, `variacaoRepresentativa`, `custoRepresentativo`, `proprio`, `temConcorrencia`, `categoriaIndefinida`, `semDimensoes`) e as condicionais de render. Mudanças visuais:
- Cada card (`min-w-[…] flex-1 rounded-md border p-2`) vira um padrão consistente do DS (pode usar o `Card` ou manter o `div` com `border`/`rounded-lg`/`bg-card` por token + label com ícone). Header de cada card: ícone lucide (já importados: `Coins/Tag/Store/TrendingUp`) + label `text-muted-foreground`.
- **Estratégia**: `StatusPill tone={proprio ? 'info' : 'warning'}` no lugar do `Badge` com `blue-50/amber-50` hardcoded. Texto `estrategiaMotivo` igual.
- **Concorrência**: `CORES_CONCORRENCIA` → mapa de `StatusPill` tone (`sem`→neutral, `moderada`→info, `alta`→warning). Mesmos dados (vendedores, menor preço).
- **Potencial de venda**: trocar os emojis (💲📈🚚🏆📅) por ícones lucide (`DollarSign`, `TrendingUp`, `Truck`, `Trophy`, `Calendar`) inline antes de cada linha. **Mesmos dados e condicionais** (preço concorrentes, líderes, frete grátis/FULL, ranking, desde). Importar os ícones novos de `lucide-react`.
- Banner "preço<20%" mantém tokens destructive. Banner "sem dimensões": trocar as classes `amber-300/amber-50/amber-600/amber-700` (light-only) por tokens `warning`: `border-warning/30 bg-warning/10 text-warning` (ícone `Truck` `text-warning`). Texto igual.
- Categoria indefinida: mantém `border-destructive/30 bg-destructive/5` (já token).

- [ ] **Step 2: CardVoceRecebe re-skin**

Ler `src/components/card-voce-recebe.tsx`. Re-skin para o padrão de card do DS (tokens), **sem alterar** `useTarifaML`, props (`preco`, `categoriaMlId`, `custo`), cálculos de markup/líquido nem as condicionais de loading/indisponível. Trocar quaisquer cores hardcoded por tokens (success/danger para lucro/prejuízo).

- [ ] **Step 3: verificar**

Run: `pnpm test -- tests/components/painel-analise.test.tsx tests/components/card-voce-recebe.test.tsx` → verdes (ajustar seletores se necessário).
Run: `pnpm exec tsc --noEmit` e `pnpm build` → limpos.

- [ ] **Step 4: Commit**

```bash
git add src/components/painel-analise.tsx src/components/card-voce-recebe.tsx
git commit -m "feat(redesign): PainelAnalise + CardVoceRecebe re-skin (cards DS, icones lucide, tons semanticos)"
```

---

## Task 3d: familia-expanded.tsx — polish

**Files:** Modify `src/components/familia-expanded.tsx`

- [ ] **Step 1: Markers StatusPill + polish**

Preserve TODA a lógica (todos os `useState`, `flash*`, `salvar*`, `lidar*Capa*`, mutations, `setVariacaoExcluida`, `updatePrincipal`). Mudanças visuais:
- Marker "nova" (`bg-emerald-100 text-emerald-700`) → `StatusPill tone="success"` ("nova"). Marker "principal" ativo (`bg-blue-100 text-blue-700`) → `StatusPill tone="info"`.
- Labels de seção (TÍTULO/DESCRIÇÃO/VARIAÇÕES) com a tipografia/`text-muted-foreground` do DS. Espaçamento dos painéis coerente. `StatusInline` (auto-save) e o `Textarea`/`Input`/`Button` (Regenerar com `Sparkles`) intactos.
- O `<input type="radio">` da principal: manter `name`, `checked`, `onChange={() => updatePrincipal.mutate(...)}` idênticos; pode estilizar o label, mas a semântica do radio é preservada.
- Faixa de fotos e `FotoCapaFamilia` mantidos.

- [ ] **Step 2: verificar (suite inteira)**

Run: `pnpm test` → todos verdes.
Run: `pnpm exec tsc --noEmit`, `pnpm lint` (0 errors), `pnpm build` → limpos.

- [ ] **Step 3: Commit**

```bash
git add src/components/familia-expanded.tsx
git commit -m "feat(redesign): FamiliaExpanded re-skin (markers StatusPill, polish) — sem mudanca de logica"
```

---

## Self-Review

- Mapa de tokens aplicado em 3a–3d (badges/banners/estratégia/concorrência/markers). ✓
- Filtros→Tabs (3a), PageHeader (3a), footer sticky + modal (3a). ✓
- PainelAnalise cards DS + ícones lucide (3c). ✓
- CardVoceRecebe re-skin sem tocar `useTarifaML` (3c). ✓
- Zero mudança de lógica: cada task exige preservação textual dos handlers/hooks/cálculos + testes existentes verdes. ✓
- Risco: testes que asseram texto/cor podem precisar de ajuste de seletor (sem afrouxar comportamento) — sinalizado em cada task.
