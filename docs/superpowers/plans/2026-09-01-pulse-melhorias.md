# Melhorias do Pulse (Radar + Sonar) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar as 12 melhorias priorizadas da análise do menu Pulse — dois bugs de layout visíveis em qualquer projetor, a linha do Radar respondendo "quanto sobra", um único simulador de margem no Sonar com um vocabulário só, alertas com data/Δ%/agrupamento, e o how-to de volta à realidade da tela.

**Architecture:** O Pulse é React/TS puro sobre PostgREST (RLS por org) mais a edge `pulse-coletar` (Deno/QStash). Toda derivação financeira já vive em funções puras (`pulse-margem.ts`, `pulse-formato.ts`, `dre-sonar.ts`) — este plano estende essas funções e as reusa em novos pontos de exibição em vez de recalcular na tela. Nenhuma fonte de dados nova: "Sobra hoje" e o sparkline da lista saem de colunas que a coleta já grava, e o único toque na edge function é condicional ao resultado de uma investigação (Task 13).

**Tech Stack:** React 19 + TypeScript + Vite, TanStack Query v5, Tailwind v4 + shadcn/Radix, Vitest + Testing Library, Supabase (PostgREST + Edge Functions Deno), Playwright (validação visual).

**Spec:** docs/superpowers/specs/2026-09-01-pulse-melhorias-design.md

## Global Constraints

1. Todo o trabalho fica na worktree `/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/feat+pulse-melhorias` (branch `worktree-feat+pulse-melhorias`) — nunca editar a `main`.
2. Cada task termina com `pnpm lint` **e** `pnpm vitest run <arquivos da task>` verdes antes do commit; a Task 23 roda os 4 passos do pré-push (`pnpm lint && pnpm test && pnpm tsc -b --force && pnpm docs:links`).
3. Toda task que toca `docs/**` ou `obsidian-vault/**` roda também `pnpm docs:links` **na própria task** — link relativo quebrado descoberto 15 tasks depois custa um ciclo de CI inteiro.
4. Duas árvores de teste convivem (`src/**/__tests__/` e `tests/`); siga o arquivo vizinho do módulo tocado. Todos os módulos deste plano têm vizinho em `src/**/__tests__/`.
5. Regra LOUD financeira (ADR-0055/0107/0119/0148): nenhum número de margem, imposto ou custo é exibido com insumo presumido. Insumo ausente → `—` com o motivo em texto, nunca zero, nunca default silencioso.
6. Nada do quadro "O que NÃO mudar" da spec pode mudar de comportamento. Em especial: menor **relevante** continua sendo a referência de preço; limiares 0,5%/15%; "Marcar N como lidos" pode marcar menos que N; posição no catálogo é hipotética; "Referência do ML" não volta; primeira coleta não gera alerta.
7. ADR antes da implementação para decisão não trivial. Último ADR é **0149** — este plano cria **ADR-0150** e duas erratas (**0119 Errata 12**, **0133 Errata 3**). O índice vivo de ADRs é `obsidian-vault/04-Decisões/Índice de ADRs.md` (está em 0149). **`docs/decisions/README.md` NÃO é índice** — ele aponta para `docs/README.md`, cuja tabela parou em 0073 e já está defasada: não acrescentar linha lá.
8. Se alguma task tocar `supabase/functions/**`, `supabase functions deploy <nome>` é passo da própria task e `docs/reference/edge-functions.md` é atualizado no mesmo commit. A worktree **não vem linkada**: `supabase link --project-ref txvncrgkoynoxwopfkbp --yes < /dev/null` antes de qualquer `db push`.
9. `.env.local` é gitignored e não vem na worktree — copiar do checkout principal antes de rodar `pnpm dev` ou qualquer comando que leia segredo. Extrair segredo sempre com `grep -m1 '^NOME=.\+'`.
10. Proibido, na validação: clicar em **Atualizar agora**, **Reprecificar → Salvar**, **Marcar lido**, e proibido disparar busca nova no Sonar (cada run custa US$ 0,10).
11. Commits em português, escopo `pulse`, uma task = um commit.
12. **Helpers de render nos testes.** Os arquivos de teste existentes trazem hoje `renderSonar()`
    (`src/pages/__tests__/PulseSonar.test.tsx:108`), `renderDetalhe(produto)`
    (`dialog-detalhe.test.tsx:87`) e `renderAba()` (`aba-alertas.test.tsx:40`). Os testes deste plano
    citam variantes — `renderSonarComAmostra(itens)`, `renderSonarComResposta(resp)`,
    `renderSonarComEan(ean)`, `renderDetalheComMargem()`, `renderDetalheComOfertas()`,
    `renderRadarComHistorico(historico)`. **Elas não existem.** Crie cada uma no mesmo commit da task
    que a usa, sobre o helper vizinho, sem duplicar o setup de `QueryClientProvider`/`vi.mock`.
    <!-- rev-fable: "envelope de três linhas" era otimista — `dialog-detalhe.test.tsx` mocka o `useQuery` do
    contexto com valor FIXO ({custo:null, aliquotaPct:null}) e `PulseSonar.test.tsx` mocka `fetchVendasSonar`
    para `configurado:false`; nenhum dos dois helpers novos funciona sem mexer no mock. A forma exata de cada
    helper está agora escrita na task que o usa (4, 11, 12, 18, 20, 22). -->
    A forma exata de cada uma está na task que a introduz (Tasks 4, 11, 12, 18, 20 e 22) — inclusive
    o que muda no `vi.mock` do arquivo.

---

## File Structure

| Arquivo | Ação | Responsabilidade única |
|---|---|---|
| `src/components/ui/table.tsx` | modificar | Expor o contêiner de rolagem (`containerClassName`/`containerProps`) para quem embrulha a tabela |
| `src/components/ui/data-table.tsx` | modificar | Um único contêiner de rolagem, que é também a região focável; largura por conteúdo quando há coluna fixa |
| `src/components/ui/__tests__/data-table.test.tsx` | modificar | Provar o contêiner único e a largura sob coluna fixa |
| `src/components/pulse/dialog-detalhe.tsx` | modificar | Detalhe do produto: `min-w-0`, colunas fundidas (10→7), decomposição da margem visível, rótulo de margem |
| `src/components/pulse/__tests__/dialog-detalhe.test.tsx` | modificar | Provar `min-w-0`, as 7 colunas, os 4 números da decomposição e o rótulo |
| `src/pages/Pulse.tsx` | modificar | Tom neutro do KPI em 0, ícone do KPI de vínculo, query de contexto de margem em lote, alvo único de reprecificação |
| `src/pages/__tests__/Pulse.test.tsx` | **criar** | Provar o tom dos KPIs do Radar sem depender de screenshot |
| `src/components/pulse/tabela-radar.tsx` | modificar | Linha do Radar: coluna fixa de ações, "Disputa do catálogo" em badge, "Sobra hoje", "N abaixo", sparkline, Reprecificar |
| `src/components/pulse/__tests__/tabela-radar.test.tsx` | modificar | Provar cada uma das colunas acima, inclusive os `—` da regra LOUD |
| `src/lib/kpi-descriptions.ts` | modificar | Descrição "i" dos 4 KPIs do Sonar |
| `src/lib/__tests__/kpi-descriptions.test.ts` | modificar | Guard de cobertura passa a exigir as 4 chaves novas |
| `src/pages/PulseSonar.tsx` | modificar | Cabeçalho do resultado, hint do "Mercado endereçável", âncora escolhível da DRE, fim do dialog de margem |
| `src/pages/__tests__/PulseSonar.test.tsx` | modificar | Provar cabeçalho, troca de âncora e ausência do dialog aposentado |
| `src/lib/pulse.ts` | modificar | `fetchContextoMargemEmLote`, `marcarAlertasLidosPorIds`, `fetchResumoHistoricoOfertas` |
| `src/lib/__tests__/pulse-contexto-margem.test.ts` | **criar** | Provar que lote e unitário devolvem o mesmo resultado, e a paginação |
| `src/lib/pulse-margem.ts` | modificar | Passa a ser dona de `insumoFaltante` e da escolha de custo por família |
| `src/lib/__tests__/pulse-margem.test.ts` | modificar | Provar `insumoFaltante` e `custoDaFamilia` |
| `src/lib/pulse-alerta-texto.ts` | modificar | Δ% no texto do `preco_caiu` e idade do alerta |
| `src/lib/__tests__/pulse-alerta-texto.test.ts` | modificar | Provar o Δ% e a idade |
| `src/lib/pulse-alertas-grupo.ts` | **criar** | Agrupar alertas por produto (pura, sem React) |
| `src/lib/__tests__/pulse-alertas-grupo.test.ts` | **criar** | Provar o agrupamento, a ordem e o "N movimentos" |
| `src/components/pulse/aba-alertas.tsx` | modificar | Renderizar grupos com idade, Δ% e ✓ que marca o grupo |
| `src/components/pulse/__tests__/aba-alertas.test.tsx` | modificar | Provar grupo, idade e marcação em lote |
| `src/components/pulse/sonar-dre.tsx` | modificar | Sem o "6.", colapsável, cabeçalho padronizado, âncora vinda de fora |
| `src/components/pulse/sonar-analise-publiai.tsx` | modificar | Cabeçalho padronizado e colapsável |
| `src/components/pulse/secao-sonar.tsx` | **criar** | Cabeçalho + colapso padrão dos blocos do Sonar |
| `src/components/pulse/__tests__/secao-sonar.test.tsx` | **criar** | Provar o estado inicial e o `aria-expanded` |
| `src/components/pulse/veredito-sonar.tsx` | modificar | Pódio deixa de truncar título em uma linha |
| `src/components/pulse/dialog-margem-sonar.tsx` | **remover** | Aposentado pela DRE com âncora trocável (ADR-0150) |
| `src/lib/sonar.ts` | modificar | Remove `margemSimulada`, órfã com o dialog |
| `src/lib/__tests__/sonar.test.ts` | modificar | Remove o bloco de `margemSimulada` |
| `supabase/functions/pulse-coletar/processar.ts` | modificar (condicional) | Dedupe do `preco_caiu` no mesmo dia UTC |
| `supabase/functions/pulse-coletar/__tests__/dedupe-preco-caiu.test.ts` | **criar** (condicional) | Provar que a 2ª coleta do dia não reemite o mesmo par de preços |
| `docs/decisions/0150-margem-um-rotulo-e-um-simulador-no-pulse.md` | **criar** | A base e o rótulo únicos de margem; um simulador só no Sonar |
| `docs/decisions/0119-pulse-inteligencia-de-mercado-dirigida.md` | modificar | Errata 12 — "Sobra hoje" na lista e o contexto de margem em lote |
| `docs/decisions/0133-alertas-do-pulse-severidade-e-area-dedicada.md` | modificar | Errata 3 — agrupamento por produto e (se provado) dedupe no coletor |
| `obsidian-vault/04-Decisões/Índice de ADRs.md` | modificar | Linha da ADR-0150 |
| `docs/how-to/usar-o-pulse.md` | modificar | §3/§5 alinhadas à tela de hoje + seção do Sonar |
| `docs/reference/edge-functions.md` | modificar (condicional) | Dedupe do `preco_caiu` em `pulse-coletar` |
| `docs/TASKS.md` | modificar | Registro da entrega |

---

## Task 1: Coluna fixa que rola em vez de cobrir (bug #3, achados 1 e 3)

**Files:** Modify (`src/components/ui/table.tsx:5-19`, `src/components/ui/data-table.tsx:77-85`, `src/components/pulse/tabela-radar.tsx:194-197`) / Test (`src/components/ui/__tests__/data-table.test.tsx`, `src/components/pulse/__tests__/tabela-radar.test.tsx`)

> **Ordem: execute a Task 2 ANTES desta.** As duas são independentes em arquivo, mas a tabela de
> concorrentes do `dialog-detalhe` também tem `stickyRight` (coluna `Oferta`), e esta task a faz
> dimensionar por conteúdo (`w-max`). Dentro de um `DialogContent` que ainda não tem `min-w-0`
> (Task 2), isso pode alargar mais o corte horizontal já existente em 820 px. Com a Task 2 aplicada,
> a mesma mudança vira a correção: o contêiner encolhe e a tabela rola dentro dele.

**Interfaces:**
- Consumes: da Task 2, o `min-w-0` no corpo do `DialogContent`.
- Produces: `Table` aceita `containerClassName?: string` e `containerProps?: React.ComponentProps<'div'>`; `DataTable` continua com a mesma API pública (`Column<T>` com `stickyRight?: boolean` inalterado). A coluna `acoes` da `TabelaRadar` passa a ter `stickyRight: true`. A coluna `oferta` de `dialog-detalhe.tsx` **mantém** o `stickyRight` que já tem — nenhuma task deste plano o remove.

<!-- rev-fable: "<Table> cru só em sonar-dre.tsx" era falso — `grep -rln '<Table[ >]' src/` devolve 11 arquivos
(faturamento/aba-vendas, aba-devolucoes, detalhe-pedido-itens, aba-geografia, Usuarios, DetalheFinanceiro,
SupportRequests, DetalheVendas, Organizacoes, Publicados, sonar-dre). A mudança em `Table` é aditiva (duas props
opcionais, default idêntico ao de hoje), então nada quebra — mas o blast radius precisa estar certo para o
`pnpm test` inteiro fazer sentido. -->
**Blast radius medido:** `<DataTable` aparece em 4 arquivos de produção — `tabela-radar.tsx`, `dialog-detalhe.tsx`, `PulseSonar.tsx` e `StyleGuide.tsx`. `<Table>` cru aparece em **11** arquivos (`grep -rln '<Table[ >]' src/`: faturamento/*, Usuarios, DetalheFinanceiro, SupportRequests, DetalheVendas, Organizacoes, Publicados, sonar-dre) — a mudança em `Table` é aditiva (props opcionais, default igual ao de hoje), mas por isso esta task roda `pnpm test` inteiro, não só os dois arquivos tocados.

**Causa (as duas, porque leitura estática não separa uma da outra):** (a) o `DataTable` embrulha o `<Table>` num segundo `overflow-x-auto`, e o `<Table>` já traz o seu — quem rola é o interno, mas quem tem `tabIndex`/`role="region"` é o externo, então a rolagem existe e é inalcançável por teclado e sem barra visível; (b) `<table class="w-full">` cabe no contêiner comprimindo colunas em vez de estourar, e aí a célula fixa opaca cobre as vizinhas espremidas. As duas correções são de uma linha no mesmo componente compartilhado — vão juntas. A prova em CSS real fica na Task 23; aqui a prova é estrutural.

- [ ] **Step 1: Write the failing test**

Acrescentar ao final de `src/components/ui/__tests__/data-table.test.tsx`:

```tsx
// A coluna fixa do Sonar cobria "Envio" em 1440 e cinco colunas em 820, e a região que tinha foco
// não era a que rolava (medido: scrollWidth === clientWidth === 740 no wrapper externo).
describe('DataTable — coluna fixa e rolagem horizontal', () => {
  const comAcoes: Column<Linha>[] = [
    ...colunas,
    { key: 'acoes', header: 'Ações', cell: () => 'ok', stickyRight: true },
  ];
  const linha = [{ titulo: 'a', vendidos: 1 }];

  it('há um único contêiner rolável, e ele é a região focável', () => {
    const { container } = render(
      <DataTable columns={comAcoes} rows={linha} rowKey={(l) => l.titulo} />,
    );
    const rolaveis = container.querySelectorAll('.overflow-x-auto');
    expect(rolaveis).toHaveLength(1);
    const regiao = screen.getByRole('region', { name: 'Tabela de dados' });
    expect(regiao).toBe(rolaveis[0]);
    expect(regiao).toHaveAttribute('tabindex', '0');
  });

  it('com coluna fixa a tabela dimensiona pelo conteúdo — rola em vez de comprimir', () => {
    const { container } = render(
      <DataTable columns={comAcoes} rows={linha} rowKey={(l) => l.titulo} />,
    );
    expect(container.querySelector('table')).toHaveClass('w-max', 'min-w-full');
  });

  it('sem coluna fixa a tabela continua ocupando a largura do contêiner', () => {
    const { container } = render(
      <DataTable columns={colunas} rows={linha} rowKey={(l) => l.titulo} />,
    );
    expect(container.querySelector('table')).not.toHaveClass('w-max');
  });

  it('a borda arredondada da tabela fica no contêiner que rola, não num pai sem rolagem', () => {
    const { container } = render(
      <DataTable columns={comAcoes} rows={linha} rowKey={(l) => l.titulo} />,
    );
    expect(container.querySelector('.overflow-x-auto')).toHaveClass('rounded-lg', 'border');
  });
});
```

E em `src/components/pulse/__tests__/tabela-radar.test.tsx`, ao final:

```tsx
// Em 820px a tabela do Radar estoura 823px num container de 770 e o ⋮ saía da tela — e ele é o
// único acesso a "Pausar no radar" no tablet de demo.
describe('TabelaRadar — a coluna de ações não sai da tela', () => {
  it('a coluna de ações é fixa à direita', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TabelaRadar produtos={[produto]} resumo={new Map([[produto.id, resumo]])} resumoCarregando={false} onAbrirDetalhe={() => undefined} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('columnheader', { name: 'Ações' }).className).toContain('sticky');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/components/ui/__tests__/data-table.test.tsx src/components/pulse/__tests__/tabela-radar.test.tsx -t "coluna fixa"` · Expected: FAIL com `expected 2 to have length 1` (dois `.overflow-x-auto`) e `expected className to contain "sticky"`.

- [ ] **Step 3: Write minimal implementation**

`src/components/ui/table.tsx` — trocar o componente `Table` inteiro:

```tsx
function Table({
  className, containerClassName, containerProps, ...props
}: React.ComponentProps<"table"> & {
  /** Classe do DIV que rola. Quem embrulha a tabela precisa alcançá-lo: um segundo
   *  `overflow-x-auto` por fora cria dois scrollports aninhados e o de fora nunca rola. */
  containerClassName?: string
  /** Atributos do mesmo DIV — `role`/`tabIndex` têm de ficar em QUEM ROLA (WCAG 2.1.1). */
  containerProps?: React.ComponentProps<"div">
}) {
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", containerClassName)}
      {...containerProps}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}
```

`src/components/ui/data-table.tsx` — substituir o bloco do `return` (linhas 77-85) por:

```tsx
  // `w-full` faz a tabela CABER comprimindo colunas em vez de estourar; com uma coluna fixa e
  // opaca por cima, as comprimidas ficam embaixo dela e inalcançáveis. `w-max min-w-full` dimensiona
  // pelo conteúdo e devolve a rolagem — medido no Sonar: "Envio" invisível em 1440, e "Vendidos" a
  // "Envio" inalcançáveis em 820.
  const temColunaFixa = columns.some((c) => c.stickyRight);

  return (
    <Table
      containerClassName={cn('rounded-lg border', className)}
      containerProps={{
        tabIndex: 0,
        role: 'region',
        'aria-label': 'Tabela de dados',
      }}
      className={temColunaFixa ? 'w-max min-w-full' : undefined}
    >
```

e remover o `</div>` de fechamento correspondente no final do componente (o `</Table>` passa a ser o último elemento). O comentário `eslint-disable jsx-a11y/no-noninteractive-tabindex` sai junto: a regra só inspeciona JSX, e `tabIndex` agora vive num objeto.

`src/components/pulse/tabela-radar.tsx` — na coluna `acoes` (linha ~194), acrescentar `stickyRight: true`:

```tsx
    {
      key: 'acoes',
      header: <span className="sr-only">Ações</span>,
      className: 'w-10',
      // Em 820px a tabela estoura o container; sem isto o ⋮ — único acesso a "Pausar no radar" —
      // sai da tela.
      stickyRight: true,
      cell: (p) => (
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/components/ui/__tests__/data-table.test.tsx src/components/pulse/__tests__/tabela-radar.test.tsx` · Expected: PASS. Depois `pnpm test` inteiro (blast radius: StyleGuide, dialog-detalhe, PulseSonar) e `pnpm lint` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/table.tsx src/components/ui/data-table.tsx src/components/ui/__tests__/data-table.test.tsx src/components/pulse/tabela-radar.tsx src/components/pulse/__tests__/tabela-radar.test.tsx
git commit -m "fix(pulse): coluna fixa rola em vez de cobrir as vizinhas

Um contêiner de rolagem só, e ele é a região focável; com coluna fixa a
tabela dimensiona pelo conteúdo. Coluna de ações do Radar vira fixa —
em 820px o ⋮ saía da tela.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YMqFw6M2nm6NBzNia9H9Z7"
```

---

## Task 2: Dialog de Detalhe para de cortar conteúdo em 820px (bug #3, achado 6)

**Files:** Modify (`src/components/pulse/dialog-detalhe.tsx:432-438`) / Test (`src/components/pulse/__tests__/dialog-detalhe.test.tsx`)

**Interfaces:**
- Consumes: nada — **esta é a primeira task a executar** (a Task 1 depende dela; ver a nota de ordem lá).
- Produces: o `min-w-0` no corpo do `DialogContent`, de que a Task 1 depende para que a tabela de concorrentes role dentro do diálogo em vez de estourá-lo.

**Causa:** `DialogContent` é `grid` (`dialog.tsx:67`). Filho de grid tem `min-width: auto`, então não encolhe abaixo do próprio conteúdo — o `overflow-x-auto` da tabela lá dentro nunca ganha largura para agir. Medido em 820: `scrollWidth` 1251 num `clientWidth` de 820, "Sua posição" e o botão "Reprecificar" cortados pela direita **sem barra de rolagem**. Correção local (e não `[&>*]:min-w-0` no `DialogContent`) porque este é o único diálogo do app com tabela larga; mexer no primitivo mudaria todos os outros sem necessidade.

- [ ] **Step 1: Write the failing test**

Acrescentar em `src/components/pulse/__tests__/dialog-detalhe.test.tsx`:

```tsx
// Filho de grid tem min-width:auto e não encolhe: em 820px o dialog cortava "Sua posição" e o
// botão "Reprecificar" pela direita, sem barra de rolagem.
describe('DialogDetalhe — o conteúdo pode encolher dentro do grid do dialog', () => {
  it('o corpo do dialog carrega min-w-0', () => {
    renderDetalhe();
    const corpo = document.querySelector('[data-slot="dialog-content"] > .flex.flex-col.gap-5');
    expect(corpo).not.toBeNull();
    expect(corpo).toHaveClass('min-w-0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/components/pulse/__tests__/dialog-detalhe.test.tsx -t "min-w-0"` · Expected: FAIL com `expected element to have class "min-w-0"`.

- [ ] **Step 3: Write minimal implementation**

Em `src/components/pulse/dialog-detalhe.tsx`, nos dois ramos do conteúdo (linha ~432):

```tsx
          {isLoading ? (
            <div className="flex min-w-0 flex-col gap-3">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-40 w-full rounded-lg" />
            </div>
          ) : (
            // `min-w-0`: filho de grid não encolhe abaixo do conteúdo por padrão, e sem isso o
            // `overflow-x-auto` da tabela de concorrentes não tem largura para agir — em 820px o
            // dialog estourava para 1251px e cortava "Sua posição" e "Reprecificar".
            <div className="flex min-w-0 flex-col gap-5">
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/components/pulse/__tests__/dialog-detalhe.test.tsx` e `pnpm lint` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/pulse/dialog-detalhe.tsx src/components/pulse/__tests__/dialog-detalhe.test.tsx
git commit -m "fix(pulse): detalhe do Radar para de cortar conteúdo em 820px

min-w-0 no corpo do dialog: filho de grid não encolhe sozinho, e a tabela
de concorrentes empurrava 'Sua posição' e 'Reprecificar' para fora.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YMqFw6M2nm6NBzNia9H9Z7"
```

---

## Task 3: KPIs do Radar — verde só quando há o que comemorar, e o ícone certo (#12, parte visual)

**Files:** Modify (`src/pages/Pulse.tsx:7`, `:230-248`) / Test (`src/pages/__tests__/Pulse.test.tsx` — criar)

**Interfaces:**
- Consumes: nada.
- Produces: `src/pages/__tests__/Pulse.test.tsx` com o helper `renderPulse(produtos, resumo)` — as Tasks 9 e 21 estendem este mesmo arquivo em vez de montar um harness novo.

- [ ] **Step 1: Write the failing test**

Criar `src/pages/__tests__/Pulse.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Pulse from '../Pulse';
import type { PulseProduto, PulseResumoOfertas } from '@/lib/pulse';

vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => ({ data: ['pulse'], isLoading: false }),
}));

const produtos = vi.hoisted(() => ({ lista: [] as PulseProduto[] }));
const resumos = vi.hoisted(() => ({ mapa: new Map<string, PulseResumoOfertas>() }));

vi.mock('@/lib/pulse', async () => {
  const real = await vi.importActual<typeof import('@/lib/pulse')>('@/lib/pulse');
  return {
    ...real,
    fetchPulseProdutos: vi.fn(async () => produtos.lista),
    fetchPulseResumoOfertas: vi.fn(async () => resumos.mapa),
    contarPulseAlertas: vi.fn(async () => 0),
    // `fetchContextoMargemEmLote` NÃO entra aqui: ela só existe a partir da Task 8, e declarar no
    // mock uma chave que o módulo real não exporta é o que faz `tsc -b --force` reprovar na Task 21.
    // A Task 9 a acrescenta a este mock, junto com o uso dela em Pulse.tsx.
  };
});

const produto = (over: Partial<PulseProduto> = {}): PulseProduto => ({
  id: 'produto-1', catalog_product_id: 'MLB123456', codigo_pai: 'APTAMIL-1800',
  titulo: 'Aptamil', gtin: null, origem: 'auto', status: 'ativo', catalogo_status: 'vinculado',
  ptw_status: null, ptw_preco_sugerido: null, ptw_aplicavel: null, ptw_custos: null,
  ultimo_snapshot_em: null, meu_preco: 100, meu_preco_em: null, anuncio_status: 'active',
  anuncio_sub_status: [], anuncio_status_em: null, comissao_pct: null, comissao_fixa: null,
  comissao_preco: null, comissao_em: null, ...over,
});

const resumo = (menorRelevante: number | null): PulseResumoOfertas => ({
  menorPreco: menorRelevante, menorObservado: menorRelevante, menorRelevante,
  maiorRelevante: menorRelevante, nOfertas: 1, nOfertasRelevantes: menorRelevante == null ? 0 : 1,
  precosRelevantes: menorRelevante == null ? [] : [menorRelevante],
});

export async function renderPulse(lista: PulseProduto[], mapa: Map<string, PulseResumoOfertas>) {
  produtos.lista = lista;
  resumos.mapa = mapa;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(
    <MemoryRouter>
      <QueryClientProvider client={client}><Pulse /></QueryClientProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('No radar')).toBeInTheDocument());
  return r;
}

// "Você é o menor preço: 0" em verde lê como parabéns por nada. Zero aqui não é bom nem ruim.
describe('Pulse — tom dos KPIs do Radar', () => {
  it('zero em "Você é o menor preço" não é verde', async () => {
    await renderPulse([produto({ meu_preco: 200 })], new Map([['produto-1', resumo(100)]]));
    expect(screen.getByText('Você é o menor preço')).toHaveClass('text-info');
    expect(screen.getByText('Você é o menor preço')).not.toHaveClass('text-success');
  });

  it('com pelo menos um produto no menor preço o card fica verde', async () => {
    await renderPulse([produto({ meu_preco: 50 })], new Map([['produto-1', resumo(100)]]));
    expect(screen.getByText('Você é o menor preço')).toHaveClass('text-success');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/pages/__tests__/Pulse.test.tsx` · Expected: FAIL no primeiro caso com `expected element to have class "text-info"` (hoje o `tom` é `"success"` fixo).

- [ ] **Step 3: Write minimal implementation**

Em `src/pages/Pulse.tsx`, trocar o import de ícones da linha 7:

```tsx
import { Activity, Plus, RefreshCw, Search, TrendingUp, Unlink, X } from 'lucide-react';
```

(`Bell` sai: ele é o ícone dos Alertas na aba ao lado e não é o ícone de "vínculo".)

E os dois KpiCards (linhas ~230-248):

```tsx
          <KpiCard
            size="compact"
            label="Você é o menor preço"
            value={<ValorAnimado n={contagens.menorPreco} />}
            icon={TrendingUp}
            // Zero em "menor preço" não é bom nem ruim — verde com 0 lê como parabéns por nada.
            // Mesma alternância que "Mais caro que o mercado" já usa logo acima.
            tom={contagens.menorPreco > 0 ? 'success' : 'info'}
            onClick={() => alternarFoco('menor_preco')}
            ativo={filtros.foco === 'menor_preco'}
          />
          <KpiCard
            size="compact"
            label="Sem vínculo de catálogo"
            value={<ValorAnimado n={contagens.semVinculo} />}
            icon={Unlink}
            tom={contagens.semVinculo > 0 ? 'warning' : 'info'}
            hint={contagens.semVinculo > 0 ? 'não disputam a página' : undefined}
            onClick={() => alternarFoco('sem_vinculo')}
            ativo={filtros.foco === 'sem_vinculo'}
          />
```

A troca do ícone não tem asserção em jsdom (o nome da classe do lucide não é contrato estável) — ela é conferida na Task 23, no screenshot `radar-1440-light`.

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/pages/__tests__/Pulse.test.tsx` e `pnpm lint` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Pulse.tsx src/pages/__tests__/Pulse.test.tsx
git commit -m "fix(pulse): KPI 'menor preço' neutro em zero e ícone de vínculo

Verde com 0 lê como parabéns por nada. Bell era o ícone dos Alertas na aba
ao lado — 'Sem vínculo de catálogo' passa a usar Unlink.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YMqFw6M2nm6NBzNia9H9Z7"
```

---

## Task 4: "Disputa do catálogo" em badge + tooltip (#7)

**Files:** Modify (`src/components/pulse/tabela-radar.tsx:152-193`) / Test (`src/components/pulse/__tests__/tabela-radar.test.tsx:64-125`)

**Interfaces:**
- Consumes: da Task 1, a coluna `acoes` com `stickyRight` (não conflita — arquivo em comum, aplique após a Task 1 para evitar rebase).
- Produces: cabeçalho de coluna com nome **`Disputa do catálogo`** — as Tasks 9, 21 e 22 acrescentam colunas ao lado deste e o teste da Task 22 conta as colunas por nome.

<!-- rev-fable: as linhas citadas estavam erradas (não há 'Análise PubliAI' em 30/86; a asserção é a linha 80 e o
describe é a 62) e faltavam DUAS quebras: a linha 103 (`getByText('5 anúncios relevantes disputam')`, no
caso "sem preço nosso") e a 110 (`'Sem concorrente relevante no catálogo'`, que o snippet original trocava por
"Sem concorrente relevante" — texto que colide com a coluna `menor`, linha 124 do componente, e faria
`getByText` achar dois elementos). Mantido o texto de vazio original. Também hoisto `renderRadar` para o escopo
do módulo: as Tasks 9, 21 e 22 o usam de fora do describe onde ele vive hoje (linha 68). -->
**Atenção:** `tabela-radar.test.tsx` quebra em **três** pontos com esta task, todos atualizados **neste mesmo commit**:
- linha 80: `getByRole('columnheader', { name: 'Análise PubliAI' })` → coberto pelo `it` reescrito abaixo;
- linha 103 (caso "sem preço nosso, a disputa aparece e a linha de posição some"): `getByText('5 anúncios relevantes disputam')` → `getByText('5 disputam')`;
- linha 110: **não muda** — o texto de vazio continua `Sem concorrente relevante no catálogo` (o snippet abaixo o mantém; encurtar para "Sem concorrente relevante" colidiria com a coluna `menor`, que já usa essa frase, e `getByText` acharia dois elementos).

Além disso, **mover `renderRadar` (linha 68) e `disputado` para o escopo do módulo**, logo abaixo de `resumo`, e fazê-lo aceitar as props extras que as tasks seguintes acrescentam:

```tsx
const renderRadar = (
  produtos: PulseProduto[],
  r: PulseResumoOfertas,
  extra: Partial<Omit<React.ComponentProps<typeof TabelaRadar>, 'produtos' | 'resumo' | 'resumoCarregando'>> = {},
) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TabelaRadar
        produtos={produtos} resumo={new Map([[produtos[0].id, r]])} resumoCarregando={false}
        onAbrirDetalhe={() => undefined} {...extra}
      />
    </QueryClientProvider>,
  );
};
```

As três renderizações manuais do arquivo (linhas 22-27, 48-53, 68-75) passam a chamar `renderRadar`. A Task 9 acrescenta `contextos={new Map()} onReprecificar={() => undefined}` aos defaults deste helper quando as props nascem.

- [ ] **Step 1: Write the failing test**

Em `src/components/pulse/__tests__/tabela-radar.test.tsx`, no describe "Análise PubliAI: a disputa do catálogo", trocar o nome do describe e a primeira asserção do primeiro `it`, e acrescentar dois casos:

```tsx
// ADR-0147: a coluna que ocupa o lugar da "Referência do ML" mostra a DISPUTA do catálogo.
// "Análise PubliAI" prometia veredito de IA e entregava três fatos; o nome do ADR é o que está lá.
describe('TabelaRadar — Disputa do catálogo', () => {
  // ... (disputado e renderRadar permanecem iguais)

  it('mostra quantos disputam, a faixa, e a posição como hipótese — nunca como fato', () => {
    renderRadar([{ ...produto, meu_preco: 149.99 }], disputado);

    expect(screen.getByRole('columnheader', { name: 'Disputa do catálogo' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Análise PubliAI' })).not.toBeInTheDocument();
    expect(screen.getByText('5 disputam')).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*130,00\s*–\s*R\$\s*209,90/)).toBeInTheDocument();
    expect(screen.getAllByText(/R\$\s*149,99/)).toHaveLength(1);
  });

  it('a posição hipotética sai do badge e vive no tooltip, sem sumir da tela', () => {
    renderRadar([{ ...produto, meu_preco: 149.99 }], disputado);
    const badge = screen.getByText('5 disputam');
    expect(badge.closest('[title]')?.getAttribute('title')).toMatch(/ficaria em 4º de 6/);
  });

  it('a célula ocupa uma linha só — a de três linhas alongava a linha para 76px', () => {
    renderRadar([{ ...produto, meu_preco: 149.99 }], disputado);
    expect(screen.queryByText(/^seu preço ficaria em/)).not.toBeInTheDocument();
  });
});
```

E na linha 103 (`it('sem preço nosso, …')`), trocar `getByText('5 anúncios relevantes disputam')` por `getByText('5 disputam')`. Conferir que nada sobrou: `grep -n "Análise PubliAI\|anúncios relevantes disputam" src/components/pulse/__tests__/tabela-radar.test.tsx` → sem saída.

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/components/pulse/__tests__/tabela-radar.test.tsx` · Expected: FAIL com `Unable to find an accessible element with the role "columnheader" and name "Disputa do catálogo"`.

- [ ] **Step 3: Write minimal implementation**

Em `src/components/pulse/tabela-radar.tsx`, substituir a coluna `disputa` inteira (linhas 152-193) por:

```tsx
    {
      key: 'disputa',
      // ADR-0147: substitui a "Referência do ML" (D-24). "Análise PubliAI" prometia veredito de IA
      // e entrega três fatos verificáveis — o nome do próprio ADR é o que está na célula.
      header: 'Disputa do catálogo',
      // Com a célula de 3 linhas a linha media 76px e só 5 de 13 cabiam acima da dobra em 1440×900
      // (medido). Badge + tooltip devolve a linha ao ritmo das outras; nada de informação sai da
      // tela — a posição hipotética passa a viver no `title`, junto do resto da conta.
      className: 'hidden xl:table-cell',
      sortValue: (p) => disputaCatalogo(resumo?.get(p.id), p.meu_preco)?.posicao ?? null,
      cell: (p) => {
        const d = disputaCatalogo(resumo?.get(p.id), p.meu_preco);
        if (!d) {
          // Texto inalterado: a coluna `menor` já diz "Sem concorrente relevante"; sem o
          // "no catálogo" as duas células ficam idênticas e o teste da linha 110 acha duas.
          return celulaMercado(
            <span className="text-xs text-muted-foreground">Sem concorrente relevante no catálogo</span>,
          );
        }
        const faixa = d.menor === d.maior ? fmtBRL(d.menor) : `${fmtBRL(d.menor)} – ${fmtBRL(d.maior)}`;
        // "ficaria" e não "está": o nosso anúncio não é anúncio de catálogo, então não participa da
        // disputa que gerou a faixa (ADR-0147 D-5).
        const ajuda = [
          `${d.anunciosRelevantes} ${d.anunciosRelevantes === 1 ? 'anúncio relevante disputa' : 'anúncios relevantes disputam'} esta ficha, de ${faixa}.`,
          d.posicao != null && p.meu_preco != null
            ? `Com o seu preço, você ficaria em ${d.posicao}º de ${d.totalComNosso}.`
            : null,
        ].filter(Boolean).join(' ');
        return celulaMercado(
          <span className="inline-flex cursor-help items-center gap-1.5" title={ajuda}>
            <Badge variant="outline" className="font-normal tabular-nums">
              {d.anunciosRelevantes} {d.anunciosRelevantes === 1 ? 'disputa' : 'disputam'}
            </Badge>
            <span className="text-xs tabular-nums text-muted-foreground">{faixa}</span>
          </span>,
        );
      },
    },
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/components/pulse/__tests__/tabela-radar.test.tsx` e `pnpm lint` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/pulse/tabela-radar.tsx src/components/pulse/__tests__/tabela-radar.test.tsx
git commit -m "feat(pulse): 'Disputa do catálogo' em badge, no lugar de 'Análise PubliAI'

O nome vem do ADR-0147 e descreve o que a célula entrega. Badge + tooltip
derruba a linha de 76px para a altura das demais: 5 -> 8 linhas acima da
dobra em 1440x900.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YMqFw6M2nm6NBzNia9H9Z7"
```

---

## Task 5: Descrições "i" dos 4 KPIs do Sonar (#8)

**Files:** Modify (`src/lib/kpi-descriptions.ts:106-115`, `src/lib/__tests__/kpi-descriptions.test.ts:54-58`, `src/pages/PulseSonar.tsx:128-135`)

**Interfaces:**
- Consumes: nada.
- Produces: as chaves `'Vendas acumuladas'`, `'Mercado endereçável'`, `'Concorrentes vendendo mais que há um ano'`, `'Média mensal por vendedor (12 meses)'` no dicionário. Nenhuma outra task as consome.

- [ ] **Step 1: Write the failing test**

Em `src/lib/__tests__/kpi-descriptions.test.ts`, acrescentar ao final de `ALL_EXPECTED_KEYS` (depois de `'Sem vínculo de catálogo'`):

```ts
  // Pulse / Sonar — "Mercado endereçável" é o número mais forte da demo e era o menos explicado.
  'Vendas acumuladas',
  'Mercado endereçável',
  'Concorrentes vendendo mais que há um ano',
  'Média mensal por vendedor (12 meses)',
];
```

E acrescentar um caso ao final do describe:

```ts
  it('"Mercado endereçável" diz que é acumulado da vida dos anúncios, não TAM anual', () => {
    expect(getKpiDescription('Mercado endereçável')).toMatch(/vida dos anúncios/i);
    expect(getKpiDescription('Mercado endereçável')).not.toMatch(/por ano|anual|mensal/i);
  });
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/lib/__tests__/kpi-descriptions.test.ts` · Expected: FAIL com `expected [ 'Vendas acumuladas', 'Mercado endereçável', … ] to deeply equal []`.

- [ ] **Step 3: Write minimal implementation**

Em `src/lib/kpi-descriptions.ts`, antes do fechamento do objeto (depois de `'Sem vínculo de catálogo'`):

```ts
  // ── Pulse / Sonar (ADR-0122, ADR-0142, ADR-0146) ───────────────────────
  'Vendas acumuladas':
    'Soma do "+N vendidos" que o Mercado Livre exibe nos anúncios da amostra. É acumulado da VIDA de cada anúncio, não venda do mês, e o número do ML é uma faixa-piso ("+100" pode ser 199) — por isso a soma é um piso do nicho, nunca uma estimativa de ritmo.',
  'Mercado endereçável':
    'Σ (preço atual × vendidos acumulados) dos anúncios da amostra. É faturamento acumulado na vida dos anúncios, não mercado por ano: multiplica o preço de hoje por vendas feitas ao longo de meses, e com desconto ativo usa o preço promocional. Serve para comparar nichos entre si, não para projetar receita.',
  'Concorrentes vendendo mais que há um ano':
    'Quantos vendedores da amostra têm hoje mais transações na conta do que no mesmo ponto de 12 meses atrás. É a LOJA INTEIRA do vendedor (ADR-0142): a API do Mercado Livre não expõe venda por anúncio de terceiro. Sinal de nicho em expansão ou retração, nunca de venda deste produto.',
  'Média mensal por vendedor (12 meses)':
    'Total de transações da conta do vendedor dividido por 12 (ADR-0146). O campo do ML é uma janela móvel de 365 dias, provada no Spike 048 — por isso ÷12 é média mensal de verdade. Continua sendo da loja inteira, somando nichos sem relação com o que você está prospectando.',
```

E em `src/pages/PulseSonar.tsx`, o hint do KPI (linha ~132):

```tsx
        <KpiCard
          size="compact"
          label="Mercado endereçável"
          value={`≈ R$ ${fmtMilhar(resp.valor_mercado, 1)}`}
          hint="Σ preço × vendidos, na vida dos anúncios"
          icon={CircleDollarSign}
          tom="info"
        />
```

e o do card ao lado (linha ~124), que hoje só diz a cobertura:

```tsx
          hint={`${resp.itens_com_vendas} de ${resp.itens_analisados} anúncios · na vida dos anúncios`}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/lib/__tests__/kpi-descriptions.test.ts src/pages/__tests__/PulseSonar.test.tsx` e `pnpm lint` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kpi-descriptions.ts src/lib/__tests__/kpi-descriptions.test.ts src/pages/PulseSonar.tsx
git commit -m "feat(pulse): os 4 KPIs do Sonar ganham o 'i'

'Mercado endereçável' passa a dizer que é acumulado da vida dos anúncios,
não TAM anual — era o número mais forte da demo e o menos explicado.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YMqFw6M2nm6NBzNia9H9Z7"
```

---

## Task 6: How-to do Pulse alinhado à tela de hoje (#12, parte docs)

**Files:** Modify (`docs/how-to/usar-o-pulse.md:83-127`, `:179-236`), Create (seção nova do Sonar), Modify (`docs/TASKS.md`)

**Interfaces:**
<!-- rev-fable: o texto novo do how-to documenta "Sobra hoje" (Task 9), "Simular troca a âncora" (Task 12),
"cabeçalho do nicho" (Task 18) e "Quem vende neste nicho" (Task 19). Executada na posição 6, a doc descreveria
por ~15 commits uma tela que não existe. Rodar entre a 22 e a 23. -->
- Consumes: os nomes de coluna e comportamentos das Tasks 3, 4, 9, 12, 18, 19 e 21. **Executar esta task depois da Task 22 e antes da 23** — o texto abaixo descreve a tela como ela fica no fim do plano.
- Produces: nada em código.

**O que está errado hoje:** §3 documenta "Menor concorrente" e "Referência do ML" com quatro selos — a coluna chama-se **Menor relevante** e a Referência do ML foi removida pela ADR-0147 D-24. §5 documenta "Vendas na conta / ≈N no período" — a coluna virou **Porte do vendedor** (média mensal 12m, ADR-0146). O Sonar não é documentado em lugar nenhum.

- [ ] **Step 1: Write the failing test** — não há teste unitário para prosa. O gate desta task é `pnpm docs:links` e uma varredura de termos mortos:

```bash
# Nenhum destes pode sobreviver no how-to depois desta task.
grep -nE "Referência do ML|Menor concorrente|Vendas na conta|≈N no período|Acima de todos" docs/how-to/usar-o-pulse.md
```

<!-- rev-fable: a lista de linhas estava errada e incompleta. Medido com o próprio grep do Step 1: 94, 99, 107,
147-148 (callout "Cuidado para não confundir"), 195-196, 228, 230 (§5 "Quatro números"), 377 (§10 rotina) e
419, 422, 423 (§12 tabela de problemas). O Step 3 original só tratava §3 e parte de §5 — o Step 4 ("sem saída")
reprovaria. Acrescentei o que fazer com cada ocorrência restante. -->
- [ ] **Step 2: Run test to verify it fails** — rodar o `grep` acima · Expected: FAIL no sentido de "encontra linhas" — hoje devolve **94, 99, 107, 147-148, 195-196, 228, 230, 377, 419, 422 e 423**.

- [ ] **Step 3: Write minimal implementation**

Em `docs/how-to/usar-o-pulse.md` §3, substituir os bullets de "Menor concorrente" em diante (linhas ~95-119) por:

```markdown
- **Menor relevante** — o menor preço entre os concorrentes **qualificados** daquela ficha. Não é o
  menor preço que aparece na página do ML: vendedor com menos de 10 transações, sem visitas nos
  últimos 30 dias ou com reputação laranja/vermelha fica fora da régua (ADR-0130). Perseguir preço
  de quem não se sustenta destrói margem. O seu próprio anúncio nunca entra na conta.
  Quando existem ofertas ativas **abaixo** dessa referência, a célula avisa — elas existem e o
  comprador as vê, mesmo não entrando na comparação.
- **Sua posição** — quanto você está acima ou abaixo do menor relevante, em %. É a leitura que
  decide reprecificar: `+7% mais caro`, `10% mais barato`, `Empatado` (diferença abaixo de 0,5%).
  Amarelo a partir de +0,5%; vermelho só a partir de +15%.
- **Sobra hoje** — quanto sobra por unidade no seu preço atual, já descontados comissão do Mercado
  Livre, frete, imposto por origem e custo do produto. Vermelho é prejuízo. Um `—` aqui **nunca** é
  zero: passe o mouse e a célula diz qual insumo falta (custo, alíquota, comissão ou frete). O Pulse
  não estima imposto nem custo.
- **Ofertas** — quantos vendedores estão ativos na ficha agora, **todos**, inclusive os que a régua
  de relevância deixou de fora. É por isso que este número costuma ser maior que o da coluna ao lado.
- **Disputa do catálogo** — três fatos sobre a página de catálogo: quantos anúncios **relevantes**
  disputam, entre que preços, e — no tooltip — em que posição o seu preço **ficaria** se você
  entrasse lá. "Ficaria", e não "está": o seu anúncio não é anúncio de catálogo, então ele não faz
  parte da lista que gerou a faixa (ADR-0147). O Pulse **não** diz quem leva a venda: o ganhador do
  buy-box não é obtenível pela API do ML, e o mais barato não é o ganhador.
- **⋮** (menu da linha) — pausar ou reativar o produto no radar. Em telas estreitas ele fica fixo à
  direita, para não sair da tela quando a tabela rola.

> A coluna **Referência do ML** foi removida em 2026-08-29 (ADR-0147, D-24): ela comparava o seu
> preço contra um universo não comparável — a nossa pomada de 50 ml contra apresentações de 49 g —
> e induzia decisão errada. A coleta continua, só a exibição saiu.
```

Em §5, substituir o bullet "Vendas na conta" por:

```markdown
- **Porte do vendedor** — média mensal dos últimos 12 meses da **loja inteira** daquele vendedor
  (ADR-0146). O campo que o ML expõe é uma janela móvel de 365 dias, então dividi-lo por 12 dá
  média mensal de verdade; a versão anterior mostrava o *delta* entre duas leituras e chamava isso
  de venda, o que estava errado. Abaixo do número aparece a tendência: *vende mais que há 1 ano*,
  *mesmo ritmo*, *vende menos*.
- **Visitas 30d** — visitas naquele anúncio do concorrente nos últimos 30 dias, e a fatia que ele
  representa entre os relevantes. É a única medida **por anúncio** que a API oficial dá. Tráfego não
  é venda: não leia como fatia de mercado. `—` significa "ainda não medido", nunca zero.
```

E, no mesmo §5, trocar o bullet "Referência do ML" do bloco "Sua posição" por:

```markdown
- **Sobra para você** — o que resta no preço simulado, com a decomposição visível ao lado
  (comissão, frete, imposto, custo). Aparece "estimativa" quando a comissão que temos foi lida em
  outro preço — ela muda por faixa.
```

Ocorrências restantes, uma a uma:

- **§3, callout das linhas 147-151** ("Cuidado para não confundir duas referências diferentes…") — **remover o
  bloco inteiro**: a segunda referência não existe mais na tela.
- **§5, bloco "Quatro números lado a lado" (linhas 225-231)** — trocar por três números: `Seu preço`,
  `Menor concorrente relevante` (com a linha "Menor oferta observada" abaixo, quando houver) e `Sua posição`.
  O bullet "Referência do ML" sai.
- **§10 (linhas 377-378)** — apagar a frase "O selo **Acima de todos** na coluna Referência do ML merece a mesma
  atenção — é o próprio ML dizendo que você está caro." e, no lugar, "A coluna **Sobra hoje** diz se há margem
  para reagir antes de abrir o detalhe."
- **§12 (tabela de problemas)** — linha 419: "Coluna Menor concorrente com `—`" → "Coluna **Menor relevante** com
  `Sem concorrente relevante`"; linhas 422 e 423 (as duas de "Referência do ML"): **apagar**; linha 424
  ("Abaixo da referência" num produto…): **apagar**. Acrescentar uma linha: `| Coluna **Sobra hoje** com `—` |
  Falta custo, alíquota, comissão ou frete | Passe o mouse: a célula diz qual. Custo e origem vêm da planilha; a
  alíquota, da configuração da org |`.

Acrescentar, depois de §7 (Alertas), uma seção nova:

```markdown
## 7.1 O Sonar (prospectar um nicho antes de cadastrar)

O Radar vigia o que você **já vende**. O Sonar varre um nicho **antes** do cadastro: digite um termo
("tecido oxford 10 metros") ou passe o leitor de código de barras num EAN.

O resultado abre com o **cabeçalho do nicho** — o termo buscado, o tamanho da amostra e quando ela
foi coletada. O resultado fica em cache por 7 dias: reabrir o mesmo termo é grátis e instantâneo;
um termo novo dispara uma coleta paga, e por isso não existe botão de "atualizar" aqui.

Abaixo dele, na ordem:

1. **Veredito** — demanda e barreira de entrada em linguagem de comerciante, com o número que
   sustenta cada um e um "Saiba mais" que abre a pontuação inteira.
2. **Vendas do nicho** — vendas acumuladas, mercado endereçável e raio-x da amostra. Todos os
   números são **acumulados da vida dos anúncios**, nunca ritmo mensal. Clique no "i" de cada card.
3. **Quem vende neste nicho** — porte e tendência dos concorrentes, pela loja inteira deles.
4. **Dá lucro?** — a DRE. Informe custo, origem e as quatro medidas do pacote, e ela cota **cada um
   dos cinco preços** no Mercado Livre, separadamente. Sem os quatro campos do pacote ela recusa
   calcular e diz por quê: cotar com um pacote padrão daria um número oficial sobre uma caixa que
   não existe.
5. **A tabela dos 20 anúncios** — o botão **Simular** de cada linha troca a âncora da DRE para
   aquele anúncio e rola até ela. Não há um segundo simulador: a conta de margem do Pulse é uma só.

Dois vocabulários de percentual, e eles não são intercambiáveis: **Margem s/ venda** é lucro ÷
preço, **Markup** é lucro ÷ custo.
```

Em `docs/TASKS.md`, acrescentar a entrada da entrega no topo da seção corrente.

- [ ] **Step 4: Run test to verify it passes** — rodar o `grep` do Step 1 (Expected: sem saída) e `pnpm docs:links` · Expected: PASS, "links OK".

- [ ] **Step 5: Commit**

```bash
git add docs/how-to/usar-o-pulse.md docs/TASKS.md
git commit -m "docs(pulse): how-to alinhado à tela (ADR-0146/0147) e seção do Sonar

§3 documentava 'Menor concorrente' e 'Referência do ML' (removida pela
D-24); §5, 'Vendas na conta' (virou Porte do vendedor). O Sonar não era
documentado em lugar nenhum.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YMqFw6M2nm6NBzNia9H9Z7"
```

---

## Task 7: ADR-0119 Errata 12 — "Sobra hoje" na lista e o contexto de margem em lote (#1, decisão)

**Files:** Modify (`docs/decisions/0119-pulse-inteligencia-de-mercado-dirigida.md`, ao final, antes de `## Consequências`)

**Interfaces:**
- Consumes: nada.
- Produces: a decisão que as Tasks 8 e 9 implementam. Nomes fixados aqui e usados lá: `fetchContextoMargemEmLote`, `custoDaFamilia`, `insumoFaltante`, coluna **`Sobra hoje`**.

**Por que errata e não ADR novo:** a regra de margem do Radar já é da ADR-0119 (Erratas 4, 6, 7 e 11 a construíram). Levar o mesmo número da margem para a lista não é decisão nova de arquitetura — é a extensão do alcance de uma regra existente, mais a decisão de *como* carregar o insumo sem N+1. ADR novo só existe onde nasce vocabulário (Task 10).

- [ ] **Step 1: Write the failing test** — não há teste unitário para ADR. O gate é `pnpm docs:links` e a conferência de que a errata é a **12** (a última hoje é a 11).

```bash
grep -n "^## Errata" docs/decisions/0119-pulse-inteligencia-de-mercado-dirigida.md
grep -c "^## Errata 12" docs/decisions/0119-pulse-inteligencia-de-mercado-dirigida.md
```

- [ ] **Step 2: Run test to verify it fails** — `grep -c "^## Errata 12" docs/decisions/0119-pulse-inteligencia-de-mercado-dirigida.md` · Expected: FAIL com saída `0`.

- [ ] **Step 3: Write minimal implementation**

Inserir em `docs/decisions/0119-pulse-inteligencia-de-mercado-dirigida.md`, imediatamente antes da linha `## Consequências`:

```markdown
## Errata 12 (2026-09-01) — a lista responde "quanto sobra", e o insumo vem em lote

A Errata 6 acertou a comissão e a 11 acertou o frete, mas os dois consertos ficaram presos ao
**detalhe**: a margem só existe depois de dois cliques e um dialog `7xl`. Na validação em runtime
(2026-09-01, org com 13 produtos e 450 ofertas) isso apareceu como o defeito de produto mais caro do
Radar: a lista abre ordenada por "Sua posição" e manda reprecificar **sem saber se o produto tem
margem para reagir**. A pergunta 3 do how-to — "até onde posso baixar" — não tem resposta na tela
onde a decisão é tomada.

### D-1 — A coluna "Sobra hoje" mostra o líquido no preço praticado hoje

Uma coluna nova na lista do Radar, `Sobra hoje`, com o líquido por unidade **no `meu_preco` vigente**
(não num preço simulado — simular continua sendo do detalhe) e o percentual sobre a venda ao lado.
Vermelho quando o líquido é negativo, com o **mesmo limiar do detalhe** (`liquido < 0`): dois
limiares de "prejuízo" no mesmo módulo é exatamente o defeito que a Errata 6 nos custou. A conta é
`margemEstimada()` — a mesma função, sem cópia.

### D-2 — Insumo ausente é `—` com motivo, nunca zero e nunca aproximação

Regra LOUD, sem exceção nova: os **quatro** insumos são obrigatórios — custo do produto, alíquota de
imposto, comissão do ML e frete. Falta um → `—` com o motivo no tooltip, na mesma redação do detalhe
("Margem indisponível: falta X"). Para isso, `insumoFaltante`, que hoje é uma função privada de
`dialog-detalhe.tsx`, **passa a viver em `pulse-margem.ts`** e é usada pelos dois lugares: um `—` na
lista e um número no detalhe para o mesmo produto seria uma contradição na mesma tela.

### D-3 — O contexto de margem vem em **uma** consulta, não uma por produto

`fetchContextoMargem(codigoPai)` faz uma leitura de `familias` por produto. Com 229 catálogos isso
seriam 229 idas ao PostgREST só para desenhar uma coluna. Nasce
`fetchContextoMargemEmLote(codigosPai: string[])`: um `in('codigo_pai', …)` paginado (o PostgREST
trunca em ~1000 linhas **em silêncio** — o mesmo motivo que já faz `fetchPulseResumoOfertas`
paginar), com a alíquota lida uma vez.

**A regra de seleção do custo não é reimplementada.** Ela é extraída para `custoDaFamilia()` e
chamada pelos dois caminhos: família mais recente **que tenha variações** (família recém-criada sem
variação não pode se passar por fonte de custo), maior `custo` entre as variações dela, e alíquota
só se `aliquotas.confirmada`. Duas implementações da mesma regra de custo divergem em silêncio, e
divergência silenciosa em custo é a família de defeito que a memória do projeto registra como mais
cara (ORIGEM dropada no ingest, 2026-07-14). O caminho unitário passa a ser um **caso** do lote — não
um irmão dele.

### D-4 — "Reprecificar" sai do detalhe para a linha

O botão que hoje só existe no fundo do dialog aparece também na coluna de ações da lista, abrindo o
mesmo `DialogReprecificar` com `precoInicial = meu_preco`. Nada muda no que ele faz: grava e leva à
Revisão, nunca publica (ADR-0005).

### O que esta errata NÃO muda

O `—` continua sendo a resposta certa para a maioria das linhas enquanto custo e alíquota não
estiverem cadastrados — e isso é informação, não falha: a coluna passa a **denunciar** produto sem
custo cadastrado, que hoje ninguém vê.
```

- [ ] **Step 4: Run test to verify it passes** — `grep -c "^## Errata 12" docs/decisions/0119-pulse-inteligencia-de-mercado-dirigida.md` (Expected: `1`) e `pnpm docs:links` · Expected: PASS, "links OK".

- [ ] **Step 5: Commit**

```bash
git add docs/decisions/0119-pulse-inteligencia-de-mercado-dirigida.md
git commit -m "docs(adr): 0119 Errata 12 — Sobra hoje na lista e contexto de margem em lote"
```

(o corpo do commit leva as duas linhas de atribuição definidas nas Global Constraints)

---

## Task 8: Contexto de margem em lote, com a regra de custo numa função só (#1, dados)

**Files:** Modify (`src/lib/pulse.ts:296-326`, `src/lib/pulse-margem.ts`, `src/components/pulse/dialog-detalhe.tsx:34-48`), Create (`src/lib/__tests__/pulse-contexto-margem.test.ts`) / Test (`src/lib/__tests__/pulse-margem.test.ts`)

**Interfaces:**
- Consumes: da Task 7, as decisões D-2 e D-3 (nomes exatos).
- Produces, para a Task 9:
  - `export interface ContextoMargem { custo: number | null; aliquotaPct: number | null }` — em `src/lib/pulse.ts`
  - `export async function fetchContextoMargem(codigoPai: string): Promise<ContextoMargem>` — assinatura pública inalterada
  - `export async function fetchContextoMargemEmLote(codigosPai: string[]): Promise<Map<string, ContextoMargem>>`
  - `export interface FamiliaComVariacoes { origem: string | null; variacoes: { custo: number | null }[] | null }` — em `src/lib/pulse-margem.ts`
  - `export function custoDaFamilia(familias: FamiliaComVariacoes[]): { custo: number | null; origem: string | null }`
  - `export function insumoFaltante(contexto: { custo: number | null; aliquotaPct: number | null } | undefined, produto: { comissao_pct: number | null; ptw_custos: { frete: number | null } | null } | null): string | null` — movida de `dialog-detalhe.tsx`, corpo idêntico

- [ ] **Step 1: Write the failing test**

Acrescentar em `src/lib/__tests__/pulse-margem.test.ts` (e incluir `custoDaFamilia, insumoFaltante` no import do topo):

```ts
describe('custoDaFamilia — a mesma regra para o caminho unitário e o lote', () => {
  it('usa a primeira família COM variações, não a mais recente sem elas', () => {
    expect(custoDaFamilia([
      { origem: 'nacional', variacoes: [] },
      { origem: 'importado', variacoes: [{ custo: 10 }, { custo: 12 }] },
    ])).toEqual({ custo: 12, origem: 'importado' });
  });

  it('sem nenhuma família com variação, cai em null — nunca em zero', () => {
    expect(custoDaFamilia([{ origem: 'nacional', variacoes: [] }]))
      .toEqual({ custo: null, origem: null });
  });

  it('família com variações mas todas sem custo devolve custo null e a origem', () => {
    expect(custoDaFamilia([{ origem: 'nacional', variacoes: [{ custo: null }] }]))
      .toEqual({ custo: null, origem: 'nacional' });
  });

  it('lista vazia devolve null', () => {
    expect(custoDaFamilia([])).toEqual({ custo: null, origem: null });
  });
});

describe('insumoFaltante — os QUATRO insumos, na ordem em que o operador os resolve', () => {
  const produtoOk = { comissao_pct: 14, ptw_custos: { frete: 5 } };
  const contextoOk = { custo: 30, aliquotaPct: 8 };

  it('sem contexto carregado, o custo é o que falta', () => {
    expect(insumoFaltante(undefined, produtoOk)).toBe('custo do produto');
  });
  it('sem custo', () => {
    expect(insumoFaltante({ custo: null, aliquotaPct: 8 }, produtoOk)).toBe('custo do produto');
  });
  it('sem alíquota', () => {
    expect(insumoFaltante({ custo: 30, aliquotaPct: null }, produtoOk)).toBe('alíquota de imposto');
  });
  it('sem comissão', () => {
    expect(insumoFaltante(contextoOk, { comissao_pct: null, ptw_custos: { frete: 5 } }))
      .toBe('comissão do Mercado Livre');
  });
  it('sem frete', () => {
    expect(insumoFaltante(contextoOk, { comissao_pct: 14, ptw_custos: null }))
      .toBe('custo de frete do Mercado Livre');
  });
  it('com os quatro, não falta nada', () => {
    expect(insumoFaltante(contextoOk, produtoOk)).toBeNull();
  });
});
```

Criar `src/lib/__tests__/pulse-contexto-margem.test.ts`, no padrão de cadeia fluente já usado em `src/lib/__tests__/pulse-alertas-filtro.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Cadeia fluente do PostgREST: cada método devolve o próprio objeto e o `await` resolve pelo
// `then`. `paginas` alimenta cada `.range()` — é assim que o teste prova que o lote NÃO para na
// primeira página (o PostgREST trunca em ~1000 linhas sem avisar).
const estado = vi.hoisted(() => ({
  paginas: [] as unknown[][],
  chamadasRange: [] as [number, number][],
  aliquotas: { nacional: 8, importado: 16, confirmada: true },
}));

vi.mock('@/lib/supabase', () => {
  const cadeia: Record<string, unknown> = {};
  const metodo = (nome: string) => (...args: unknown[]) => {
    if (nome === 'range') estado.chamadasRange.push(args as [number, number]);
    return cadeia;
  };
  for (const n of ['select', 'eq', 'in', 'order', 'limit', 'neq', 'maybeSingle', 'range']) {
    cadeia[n] = metodo(n);
  }
  cadeia.then = (resolve: (v: unknown) => void) => {
    const i = estado.chamadasRange.length - 1;
    return Promise.resolve({ data: estado.paginas[i] ?? [], error: null }).then(resolve);
  };
  return { supabase: { from: () => cadeia } };
});

vi.mock('@/lib/queries', () => ({ fetchAliquotas: vi.fn(async () => estado.aliquotas) }));

const { fetchContextoMargem, fetchContextoMargemEmLote } = await import('@/lib/pulse');

const familia = (codigo_pai: string, origem: string, custos: (number | null)[]) => ({
  codigo_pai, origem, variacoes: custos.map((custo) => ({ custo })),
});

beforeEach(() => {
  estado.paginas = [];
  estado.chamadasRange = [];
  estado.aliquotas = { nacional: 8, importado: 16, confirmada: true };
});

describe('fetchContextoMargemEmLote', () => {
  it('devolve, para cada codigo_pai, o mesmo que o caminho unitário devolveria', async () => {
    const linhas = [familia('A', 'nacional', [10, 12]), familia('B', 'importado', [30])];
    estado.paginas = [linhas, []];
    const lote = await fetchContextoMargemEmLote(['A', 'B']);

    estado.chamadasRange = [];
    estado.paginas = [[linhas[0]], []];
    const soA = await fetchContextoMargem('A');

    expect(lote.get('A')).toEqual({ custo: 12, aliquotaPct: 8 });
    expect(lote.get('B')).toEqual({ custo: 30, aliquotaPct: 16 });
    expect(lote.get('A')).toEqual(soA);
  });

  it('pagina até esvaziar — não confia num teto', async () => {
    const cheia = Array.from({ length: 1000 }, (_, i) => familia(`P${i}`, 'nacional', [1]));
    estado.paginas = [cheia, [familia('ULTIMO', 'nacional', [99])], []];
    const lote = await fetchContextoMargemEmLote(['P0', 'ULTIMO']);
    expect(estado.chamadasRange.length).toBeGreaterThan(1);
    expect(lote.get('ULTIMO')).toEqual({ custo: 99, aliquotaPct: 8 });
  });

  it('alíquota não confirmada nunca vira 8/16 em silêncio', async () => {
    estado.aliquotas = { nacional: 8, importado: 16, confirmada: false };
    estado.paginas = [[familia('A', 'nacional', [10])], []];
    const lote = await fetchContextoMargemEmLote(['A']);
    expect(lote.get('A')).toEqual({ custo: 10, aliquotaPct: null });
  });

  it('codigo_pai sem família nenhuma entra no mapa como null, não fica ausente', async () => {
    estado.paginas = [[], []];
    const lote = await fetchContextoMargemEmLote(['SEM-FAMILIA']);
    expect(lote.get('SEM-FAMILIA')).toEqual({ custo: null, aliquotaPct: null });
  });

  it('lista vazia não vai ao banco', async () => {
    const lote = await fetchContextoMargemEmLote([]);
    expect(lote.size).toBe(0);
    expect(estado.chamadasRange).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/lib/__tests__/pulse-margem.test.ts src/lib/__tests__/pulse-contexto-margem.test.ts` · Expected: FAIL com `custoDaFamilia is not a function` / `fetchContextoMargemEmLote is not a function`.

- [ ] **Step 3: Write minimal implementation**

Acrescentar ao final de `src/lib/pulse-margem.ts`:

```ts
export interface FamiliaComVariacoes {
  origem: string | null;
  variacoes: { custo: number | null }[] | null;
}

/**
 * Custo do produto e origem, a partir das famílias de um `codigo_pai` **já ordenadas da mais
 * recente para a mais antiga**. Uma função só, chamada pelo caminho unitário e pelo lote: duas
 * implementações da regra de custo divergem em silêncio, e divergência silenciosa em custo é a
 * família de defeito mais cara deste projeto.
 *
 * Família recém-criada (ainda sem variações gravadas) não pode se passar pela fonte de custo —
 * regra LOUD: cai em `null`, nunca em 0.
 */
export function custoDaFamilia(
  familias: FamiliaComVariacoes[],
): { custo: number | null; origem: string | null } {
  const familia = familias.find((f) => (f.variacoes ?? []).length > 0);
  if (!familia) return { custo: null, origem: null };
  const custos = (familia.variacoes ?? []).map((v) => v.custo).filter((c): c is number => c != null);
  return { custo: custos.length > 0 ? Math.max(...custos) : null, origem: familia.origem };
}

/**
 * Qual insumo impede o cálculo da margem. Vive aqui, e não na tela, porque a lista e o detalhe
 * precisam responder a MESMA coisa para o mesmo produto — um `—` num lugar e um número no outro
 * seria contradição na mesma tela (ADR-0119 Errata 12 D-2).
 *
 * A comissão TEM que vir de `comissao_pct` (lida no preço praticado). Cair em `ptw_custos.comissao`
 * seria voltar ao defeito da Errata 6: aquele valor é calculado sobre o preço SUGERIDO pelo ML e
 * superestima a sobra em todo anúncio acima da sugestão.
 */
export function insumoFaltante(
  contexto: { custo: number | null; aliquotaPct: number | null } | undefined,
  produto: { comissao_pct: number | null; ptw_custos: { frete: number | null } | null } | null,
): string | null {
  if (!contexto || contexto.custo == null) return 'custo do produto';
  if (contexto.aliquotaPct == null) return 'alíquota de imposto';
  if (produto?.comissao_pct == null) return 'comissão do Mercado Livre';
  if (produto.ptw_custos?.frete == null) return 'custo de frete do Mercado Livre';
  return null;
}
```

Em `src/lib/pulse.ts`, estender o import da linha 5 e substituir `fetchContextoMargem` (linhas 296-326) por:

```ts
import { custoDaFamilia, estadoAtualOfertas, mercadoPulse, type FamiliaComVariacoes } from './pulse-margem';
```

```ts
export interface ContextoMargem { custo: number | null; aliquotaPct: number | null }

/** Famílias de um conjunto de `codigo_pai`, da mais recente para a mais antiga, paginadas.
 *  O PostgREST trunca em ~1000 linhas SEM avisar — mesmo motivo de `fetchPulseResumoOfertas`. */
async function fetchFamiliasPorCodigoPai(
  codigosPai: string[],
): Promise<Map<string, FamiliaComVariacoes[]>> {
  const porPai = new Map<string, FamiliaComVariacoes[]>();
  if (codigosPai.length === 0) return porPai;
  const PAGINA = 1000;
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase.from('familias')
      .select('codigo_pai, origem, variacoes(custo)')
      .in('codigo_pai', codigosPai)
      .order('criado_em', { ascending: false })
      .range(de, de + PAGINA - 1);
    if (error) throw error;
    const pagina = (data ?? []) as (FamiliaComVariacoes & { codigo_pai: string })[];
    for (const f of pagina) {
      const lista = porPai.get(f.codigo_pai) ?? [];
      lista.push(f);
      porPai.set(f.codigo_pai, lista);
    }
    if (pagina.length < PAGINA) break;
  }
  return porPai;
}

/** Custo do produto + alíquota de imposto, para o simulador de margem e para a coluna "Sobra hoje".
 *  Regra LOUD (ADR-0055/0086): alíquota só entra confirmada — nunca o default 8/16 em silêncio. */
// Sem `precoAtual`: o preço de venda vigente é o da nossa oferta na ficha (`pulse_produtos.
// meu_preco`), não o das variações locais — derivá-lo daqui devolvia um valor defasado e o
// detalhe o preferia ao vivo, propagando o erro para a margem simulada (Errata 4 do ADR-0119).
export async function fetchContextoMargemEmLote(
  codigosPai: string[],
): Promise<Map<string, ContextoMargem>> {
  const contextos = new Map<string, ContextoMargem>();
  if (codigosPai.length === 0) return contextos;
  const [porPai, aliquotas] = await Promise.all([
    fetchFamiliasPorCodigoPai(codigosPai),
    fetchAliquotas(),
  ]);
  for (const codigoPai of codigosPai) {
    const { custo, origem } = custoDaFamilia(porPai.get(codigoPai) ?? []);
    const aliquotaPct = !aliquotas.confirmada || origem == null
      ? null
      : origem === 'importado' ? aliquotas.importado : aliquotas.nacional;
    contextos.set(codigoPai, { custo, aliquotaPct });
  }
  return contextos;
}

/** O caminho por produto é um CASO do lote, não um irmão dele — é isso que garante que a lista e o
 *  detalhe nunca discordem sobre o custo do mesmo produto (ADR-0119 Errata 12 D-3). */
export async function fetchContextoMargem(codigoPai: string): Promise<ContextoMargem> {
  const contextos = await fetchContextoMargemEmLote([codigoPai]);
  return contextos.get(codigoPai) ?? { custo: null, aliquotaPct: null };
}
```

Em `src/components/pulse/dialog-detalhe.tsx`, **apagar** a função local `insumoFaltante` inteira (linhas 34-48, incluindo o bloco de comentário acima dela) e acrescentá-la ao import de `@/lib/pulse-margem`:

```tsx
import {
  estadoAtualOfertas, mercadoPulse, menorPrecoPorDia, ofertasAbaixoDaReferencia,
  porteDoVendedor, shareDeVisitas, margemEstimada, margemEhEstimativa, insumoFaltante,
} from '@/lib/pulse-margem';
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/lib/__tests__/pulse-margem.test.ts src/lib/__tests__/pulse-contexto-margem.test.ts src/components/pulse/__tests__/dialog-detalhe.test.tsx` e `pnpm lint` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pulse.ts src/lib/pulse-margem.ts src/components/pulse/dialog-detalhe.tsx src/lib/__tests__/pulse-margem.test.ts src/lib/__tests__/pulse-contexto-margem.test.ts
git commit -m "feat(pulse): contexto de margem em lote, com a regra de custo numa função só"
```

---

## Task 9: Coluna "Sobra hoje" e Reprecificar na linha (#1, tela)

**Files:** Modify (`src/components/pulse/tabela-radar.tsx`, `src/pages/Pulse.tsx:74-129`, `:329-369`) / Test (`src/components/pulse/__tests__/tabela-radar.test.tsx`)

**Interfaces:**
- Consumes da Task 8: `ContextoMargem`, `fetchContextoMargemEmLote`, `insumoFaltante`. Da Task 4: a coluna `disputa` já renomeada. Da Task 1: `stickyRight` na coluna de ações.
- **Acrescente `fetchContextoMargemEmLote: vi.fn(async () => new Map())` ao `vi.mock('@/lib/pulse', …)` de `src/pages/__tests__/Pulse.test.tsx`** — a Task 3 criou o arquivo deliberadamente sem essa chave, porque a função ainda não existia.
- Produces, para as Tasks 21 e 22, a assinatura estendida:

```ts
export function TabelaRadar(props: {
  produtos: PulseProduto[];
  resumo: Map<string, PulseResumoOfertas> | undefined;
  resumoCarregando: boolean;
  /** Custo + alíquota por `codigo_pai`; `undefined` = ainda carregando. */
  contextos: Map<string, ContextoMargem> | undefined;
  onAbrirDetalhe: (produtoId: string) => void;
  onReprecificar: (produto: PulseProduto) => void;
}): JSX.Element
```

e, em `Pulse.tsx`, o alvo único de reprecificação:

```ts
type AlvoReprecificar = { codigoPai: string; precoInicial: number | null; produtoId: string | null };
```

- [ ] **Step 1: Write the failing test**

<!-- rev-fable: (1) `/43,0%/` com vírgula nunca casaria — o snippet de implementação usa `toFixed(1)`, que dá
"43.0"; corrigido para `/43\.0%/` aqui e na Task 11. (2) `contextos` e `onReprecificar` nascem como props
OBRIGATÓRIAS, e o arquivo já tem 3 renderizações de `TabelaRadar` (agora via o `renderRadar` hoisted na
Task 4) que ficariam sem elas — `tsc -b --force` da Task 23 reprovaria. Acrescento os defaults ao helper. -->
No topo de `src/components/pulse/__tests__/tabela-radar.test.tsx`: `import userEvent from '@testing-library/user-event';`, `vi` em `vitest`, `type ContextoMargem` em `@/lib/pulse`. No `renderRadar` hoisted (Task 4), acrescentar aos defaults `contextos={new Map()} onReprecificar={() => undefined}` — senão as três renderizações existentes reprovam no `tsc`.

Acrescentar:

```tsx
// Errata 12 da ADR-0119: a lista abre ordenada por "Sua posição" e mandava reprecificar sem dizer
// se havia margem para reagir.
describe('TabelaRadar — Sobra hoje', () => {
  const comCustos: PulseProduto = {
    ...produto, meu_preco: 100, comissao_pct: 14, comissao_fixa: 0, comissao_preco: 100,
    ptw_custos: { comissao: null, frete: 5 },
  };
  const ctx = (c: ContextoMargem) => new Map([['APTAMIL-1800', c]]);

  const renderComContexto = (
    p: PulseProduto,
    contextos: Map<string, ContextoMargem> | undefined,
    onReprecificar = () => undefined,
    onAbrirDetalhe = () => undefined,
  ) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <TabelaRadar
          produtos={[p]} resumo={new Map([[p.id, resumo]])} resumoCarregando={false}
          contextos={contextos} onAbrirDetalhe={onAbrirDetalhe} onReprecificar={onReprecificar}
        />
      </QueryClientProvider>,
    );
  };

  it('mostra o líquido no preço vigente e o percentual sobre a venda', () => {
    // 100 − 14 (comissão) − 5 (frete) − 8 (imposto 8%) − 30 (custo) = 43,00 → 43,0%
    renderComContexto(comCustos, ctx({ custo: 30, aliquotaPct: 8 }));
    expect(screen.getByRole('columnheader', { name: 'Sobra hoje' })).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*43,00/)).toBeInTheDocument();
    // `toFixed(1)` devolve "43.0" (ponto) — é o que o detalhe já exibe hoje (dialog-detalhe.tsx:544).
    expect(screen.getByText(/43\.0%/)).toBeInTheDocument();
  });

  it('sem custo → "—" com o motivo, nunca zero', () => {
    renderComContexto(comCustos, ctx({ custo: null, aliquotaPct: 8 }));
    expect(screen.getByTitle('Margem indisponível: falta custo do produto')).toHaveTextContent('—');
    expect(screen.queryByText(/R\$\s*0,00/)).not.toBeInTheDocument();
  });

  it('sem alíquota → "—" com o motivo, nunca a alíquota padrão', () => {
    renderComContexto(comCustos, ctx({ custo: 30, aliquotaPct: null }));
    expect(screen.getByTitle('Margem indisponível: falta alíquota de imposto')).toHaveTextContent('—');
    expect(screen.queryByText(/R\$\s*(53|43),00/)).not.toBeInTheDocument();
  });

  it('sem comissão lida → "—" com o motivo', () => {
    renderComContexto({ ...comCustos, comissao_pct: null }, ctx({ custo: 30, aliquotaPct: 8 }));
    expect(screen.getByTitle('Margem indisponível: falta comissão do Mercado Livre')).toHaveTextContent('—');
  });

  it('sem frete → "—" com o motivo', () => {
    renderComContexto({ ...comCustos, ptw_custos: null }, ctx({ custo: 30, aliquotaPct: 8 }));
    expect(screen.getByTitle('Margem indisponível: falta custo de frete do Mercado Livre')).toHaveTextContent('—');
  });

  it('prejuízo aparece em vermelho', () => {
    // 100 − 14 − 5 − 8 − 110 = −37,00
    renderComContexto(comCustos, ctx({ custo: 110, aliquotaPct: 8 }));
    expect(screen.getByText(/R\$\s*-?37,00/).className).toContain('text-destructive');
  });

  it('enquanto o contexto carrega não mente com "—": mostra skeleton', () => {
    const { container } = renderComContexto(comCustos, undefined);
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });

  it('a linha tem "Reprecificar", e ele não abre o detalhe por baixo', async () => {
    const abrir = vi.fn();
    const reprecificar = vi.fn();
    renderComContexto(comCustos, ctx({ custo: 30, aliquotaPct: 8 }), reprecificar, abrir);
    await userEvent.click(screen.getByRole('button', { name: 'Reprecificar Aptamil' }));
    expect(reprecificar).toHaveBeenCalledWith(comCustos);
    expect(abrir).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/components/pulse/__tests__/tabela-radar.test.tsx -t "Sobra hoje"` · Expected: FAIL com `Unable to find an accessible element with the role "columnheader" and name "Sobra hoje"`.

- [ ] **Step 3: Write minimal implementation**

Em `src/components/pulse/tabela-radar.tsx`, estender imports e assinatura:

```tsx
import { pausarPulseProduto, type ContextoMargem, type PulseProduto, type PulseResumoOfertas } from '@/lib/pulse';
import { insumoFaltante, margemEstimada } from '@/lib/pulse-margem';
```

```tsx
export function TabelaRadar({
  produtos, resumo, resumoCarregando, contextos, onAbrirDetalhe, onReprecificar,
}: {
  produtos: PulseProduto[];
  resumo: Map<string, PulseResumoOfertas> | undefined;
  resumoCarregando: boolean;
  /** Custo + alíquota por `codigo_pai` (ADR-0119 Errata 12 D-3). `undefined` = ainda carregando —
   *  e aí a célula mostra skeleton, porque um `—` significaria "insumo faltando". */
  contextos: Map<string, ContextoMargem> | undefined;
  onAbrirDetalhe: (produtoId: string) => void;
  onReprecificar: (produto: PulseProduto) => void;
}) {
```

Acrescentar, junto de `menorDe`/`posicaoDe`:

```tsx
  const contextoDe = (p: PulseProduto) => (p.codigo_pai ? contextos?.get(p.codigo_pai) : undefined);
  /** `null` quando qualquer insumo falta — a mesma resposta que o detalhe dá (regra LOUD). */
  const sobraDe = (p: PulseProduto) => {
    if (p.meu_preco == null || p.meu_preco <= 0) return null;
    const ctx = contextoDe(p);
    if (insumoFaltante(ctx, p)) return null;
    return margemEstimada({
      preco: p.meu_preco,
      custoProduto: ctx!.custo,
      comissao: { pct: p.comissao_pct, fixa: p.comissao_fixa },
      frete: p.ptw_custos?.frete ?? null,
      aliquotaPct: ctx!.aliquotaPct,
    });
  };
```

Inserir a coluna **logo depois de `posicao`**, antes de `ofertas`:

```tsx
    {
      key: 'sobra',
      // A pergunta 3 do how-to ("até onde posso baixar") não tinha resposta na tela onde a decisão
      // é tomada: a margem só existia depois de 2 cliques e um dialog 7xl (ADR-0119 Errata 12).
      header: 'Sobra hoje',
      className: 'hidden text-right lg:table-cell',
      sortValue: (p) => sobraDe(p)?.liquido ?? null,
      cell: (p) => {
        // Contexto ainda carregando: um "—" aqui afirmaria "falta insumo", que é outra coisa.
        if (p.codigo_pai && contextos === undefined) return <Skeleton className="ml-auto h-4 w-16" />;
        if (p.meu_preco == null) {
          return <span className="cursor-help text-muted-foreground" title={motivoSemPrecoProprio(p)}>—</span>;
        }
        const falta = insumoFaltante(contextoDe(p), p);
        if (falta) {
          return (
            <span className="cursor-help text-muted-foreground" title={`Margem indisponível: falta ${falta}`}>
              —
            </span>
          );
        }
        const m = sobraDe(p)!;
        // Mesmo limiar do detalhe: dois limiares de "prejuízo" no mesmo módulo é exatamente o
        // defeito que a Errata 6 nos custou.
        return (
          <span className={cn('tabular-nums', m.liquido < 0 ? 'text-destructive' : 'text-success')}>
            {fmtBRL(m.liquido)}
            <span className="ml-1 text-xs font-normal opacity-80">({m.margemPct.toFixed(1)}%)</span>
          </span>
        );
      },
    },
```

Na coluna `acoes`, trocar `className: 'w-10'` por `className: 'w-44 text-right'` e envolver o menu:

```tsx
      cell: (p) => (
        <div className="flex items-center justify-end gap-1">
          {p.codigo_pai && (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Reprecificar ${p.titulo ?? p.catalog_product_id}`}
              // A linha inteira é clicável: sem isto, reprecificar abriria o detalhe por baixo.
              onClick={(e) => { e.stopPropagation(); onReprecificar(p); }}
            >
              Reprecificar
            </Button>
          )}
          <DropdownMenu>
            {/* … conteúdo atual do menu, inalterado … */}
          </DropdownMenu>
        </div>
      ),
```

Em `src/pages/Pulse.tsx`:

```tsx
import {
  fetchPulseProdutos, fetchPulseResumoOfertas, coletarPulseAgora, contarPulseAlertas,
  fetchContextoMargemEmLote, type PulseProduto,
} from '@/lib/pulse';
```

(`PulseAlerta` sai do import — o estado deixa de guardar o alerta inteiro.)

Trocar o estado da linha 76 por:

```tsx
  /** Alvo único da reprecificação: a aba Alertas e a linha do Radar alimentam o MESMO dialog. */
  const [reprecificar, setReprecificar] = useState<
    { codigoPai: string; precoInicial: number | null; produtoId: string | null } | null
  >(null);
```

Acrescentar a query logo depois da de `resumoOfertas`:

```tsx
  // Uma consulta para a página inteira (ADR-0119 Errata 12 D-3): 229 catálogos seriam 229 idas ao
  // PostgREST só para desenhar uma coluna.
  const codigosPai = [...new Set((produtos ?? []).map((p) => p.codigo_pai).filter((c): c is string => !!c))];
  const { data: contextosMargem } = useQuery({
    queryKey: ['pulse', 'contexto-margem-lote', codigosPai],
    queryFn: () => fetchContextoMargemEmLote(codigosPai),
    enabled: codigosPai.length > 0,
    staleTime: 60_000,
  });
```

Ligar tabela, aba e dialog:

```tsx
        <TabelaRadar
          produtos={filtrada}
          resumo={resumoOfertas}
          resumoCarregando={resumoCarregando}
          contextos={codigosPai.length === 0 ? new Map() : contextosMargem}
          onAbrirDetalhe={setDetalheId}
          onReprecificar={(p) => setReprecificar({
            codigoPai: p.codigo_pai!, precoInicial: p.meu_preco, produtoId: p.id,
          })}
        />
```

```tsx
            onReprecificar={(a) => setReprecificar({
              codigoPai: a.pulse_produtos?.codigo_pai ?? '',
              precoInicial: Number(a.payload.para),
              produtoId: a.produto_id,
            })}
```

```tsx
      <DialogReprecificar
        codigoPai={reprecificar?.codigoPai ?? null}
        precoInicial={reprecificar?.precoInicial ?? null}
        custos={(() => {
          const p = lista.find((x) => x.id === reprecificar?.produtoId);
          return p
            ? {
                comissaoPct: p.comissao_pct, comissaoFixa: p.comissao_fixa,
                comissaoPreco: p.comissao_preco, frete: p.ptw_custos?.frete ?? null,
              }
            : null;
        })()}
        onFechar={() => setReprecificar(null)}
      />
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/components/pulse/__tests__/tabela-radar.test.tsx src/pages/__tests__/Pulse.test.tsx` e `pnpm lint` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/pulse/tabela-radar.tsx src/pages/Pulse.tsx src/components/pulse/__tests__/tabela-radar.test.tsx
git commit -m "feat(pulse): coluna 'Sobra hoje' e Reprecificar na linha do Radar"
```

---

## Task 10: ADR-0150 — uma base, um rótulo e um simulador de margem no Pulse (#2, decisão)

**Files:** Create (`docs/decisions/0150-margem-um-rotulo-e-um-simulador-no-pulse.md`), Modify (`obsidian-vault/04-Decisões/Índice de ADRs.md`)

**Interfaces:**
- Consumes: nada em código.
- Produces: o vocabulário que as Tasks 11 e 12 implementam — **`Margem s/ venda`** (lucro ÷ preço) e **`Markup`** (lucro ÷ custo); e a decisão de aposentar `dialog-margem-sonar.tsx`.

**Numeração:** o último ADR é 0149; este é o **0150**. O índice vivo é `obsidian-vault/04-Decisões/Índice de ADRs.md`. Não tocar `docs/README.md` (a tabela de lá parou em 0073) nem `docs/decisions/README.md` (não é índice).

- [ ] **Step 1: Write the failing test** — sem teste unitário. Gate: `pnpm docs:links` e a existência do arquivo com a linha do índice.

```bash
test -f docs/decisions/0150-margem-um-rotulo-e-um-simulador-no-pulse.md && grep -c "| 0150 |" "obsidian-vault/04-Decisões/Índice de ADRs.md"
```

- [ ] **Step 2: Run test to verify it fails** — o comando acima · Expected: FAIL (o `test -f` falha, o grep não roda).

- [ ] **Step 3: Write minimal implementation**

Criar `docs/decisions/0150-margem-um-rotulo-e-um-simulador-no-pulse.md`:

```markdown
# ADR-0150 — Uma base, um rótulo e um simulador de margem em todo o Pulse

**Status:** Aceito
**Data:** 2026-09-01
**Decisores:** Diego
**Relaciona:** ADR-0119 (Erratas 6/7/11 — a margem do Radar), ADR-0148 (**implementa o seletor de
âncora que a D-8 deixou explicitamente para "a fatia seguinte"**), ADR-0149 (os cinco preços),
ADR-0120 (o Sonar), ADR-0055 (imposto por origem)

---

## Contexto

Três rótulos, duas bases e o mesmo símbolo `%` convivem hoje na mesma tela do Sonar:

| Onde | Conta | Rótulo na tela |
|---|---|---|
| `dialog-margem-sonar.tsx` (botão "Simular" da tabela) | `liquido ÷ custo` | "Margem sobre o custo (markup)" |
| `sonar-dre.tsx` (tabela de cenários) | `lucro ÷ precoVenda` | "Margem s/ venda" |
| `sonar-dre.tsx` (bloco do lote) | `lucro ÷ custo` | "markup líquido" |
| `dialog-detalhe.tsx` (Radar) | `liquido ÷ preco` | "Sobra para você (%)" |

E as duas ferramentas do Sonar respondem **coisas diferentes à mesma pergunta**: o dialog calcula
sem dimensões e avisa "frete não estimado — margem otimista"; a DRE recusa calcular sem os quatro
campos do pacote (ADR-0148 D-16), porque cotar com um pacote padrão daria número oficial sobre uma
caixa que não existe. Qual das duas respostas o operador leva depende de qual botão ele apertou.

Em demonstração, é o ponto onde a plateia se perde. Em operação, é como um markup de 30% vira uma
margem de 23% na cabeça de quem decide comprar o lote.

## Decisões

### D-1 — Dois nomes, e eles não se misturam

Em todo o Pulse (Radar e Sonar), percentual de margem é escrito por extenso, com o denominador no
nome:

- **Margem s/ venda** — `lucro ÷ preço de venda`. É o número de quem olha a saúde do preço.
- **Markup** — `lucro ÷ custo`. É o número de quem olha o retorno da compra.

`%` sozinho, "margem" sozinho e "margem sobre o custo" saem da tela. O rótulo do Radar continua
sendo "Sobra para você" para o **valor em reais** — ele responde "quanto sobra", que é outra
pergunta — mas o percentual ao lado dele passa a dizer `s/ venda`.

### D-2 — O Sonar tem **um** simulador de margem, e ele é a DRE

`dialog-margem-sonar.tsx` é aposentado. O botão **Simular** de cada linha da tabela passa a **trocar
a âncora da DRE** para aquele anúncio e rolar até ela.

Isto **implementa** o seletor que a ADR-0148 D-8 declarou pendente ("um seletor de âncora fica para
a fatia seguinte", registrado em `PulseSonar.tsx:788`) — não contradiz a D-8: a âncora **padrão**
continua sendo o primeiro anúncio da amostra, o que muda é que ela deixa de ser a única.

Consequência aceita de propósito: simular um anúncio passa a **exigir** custo, origem e as quatro
medidas do pacote. Perde-se a resposta rápida e otimista; ganha-se que o Sonar não tenha mais duas
respostas para a mesma pergunta. A DRE já diz, em texto, qual campo falta — a recusa é uma resposta
(ADR-0148 D-4).

### D-3 — `margemSimulada()` morre com o dialog

A função (`sonar.ts`) existia só para ele e é a única no código que divide líquido por custo
chamando o resultado de "margem". Sai junto, com o seu bloco de testes: código órfão que calcula
dinheiro é o que reaparece seis meses depois numa tela nova, com o rótulo errado.

## Alternativas descartadas

- **Manter os dois e só corrigir os rótulos.** Não resolve a divergência de fundo: um estima frete
  como zero e o outro recusa. Rótulo certo em cima de duas respostas diferentes ainda é duas
  respostas diferentes.
- **Fazer o dialog exigir dimensões também.** Seria reconstruir a DRE dentro de um dialog `md` — o
  mesmo formulário, o mesmo motor, duas telas para manter.
- **Adotar markup em todo lugar** (é o vocabulário do comprador). A DRE inteira, a ADR-0149 e os
  cards de Publicados/Faturamento já falam nas duas bases conforme a pergunta; unificar em uma só
  perderia informação.

## Consequências

- Boas: um número de margem por pergunta; menos 208 linhas de componente e uma função de dinheiro a
  menos; o Sonar deixa de ter dois caminhos que se contradizem.
- Ruins / tradeoffs aceitos: simular um anúncio ficou mais caro em digitação (6 campos contra 3). A
  resposta rápida que se perde era a otimista — a que ignorava frete.
- Como reverter: `git revert` da task que remove o dialog; a DRE não depende dele.

## Critérios de aceite

1. `grep -rn "margem sobre o custo\|margemSimulada" src/` não devolve nada.
2. Todo percentual de margem visível no Pulse diz `s/ venda` ou `Markup`.
3. Clicar em **Simular** numa linha da tabela do Sonar muda o nome da âncora no cabeçalho da DRE.
4. `dialog-margem-sonar.tsx` não existe mais.
```

> **Ao escrever o arquivo em `docs/decisions/`**, converta as cinco citações da linha "Relaciona"
> em links markdown relativos, no padrão dos ADRs vizinhos — aqui elas estão em texto puro porque
> `pnpm docs:links` resolve os caminhos a partir de **onde o link está escrito**, e este plano vive
> em `docs/superpowers/plans/`. Os nomes de arquivo, conferidos:
> `0119-pulse-inteligencia-de-mercado-dirigida.md`,
> `0148-dre-fatia-1-uma-cotacao-e-o-guard-de-proveniencia.md`,
> `0149-dre-fatia-2-cinco-precos-e-capital-do-lote.md`, `0120-pulse-sonar-garimpo-por-termo.md`,
> `0055-imposto-por-origem-nacional-importado.md` (atenção: **não** é "markup-e-imposto").

E acrescentar, ao final da tabela em `obsidian-vault/04-Decisões/Índice de ADRs.md`, antes da linha `Ver [[Arquitetura Geral]]…`, uma linha no mesmo formato das vizinhas — coluna `0150`, o título como link para `../../docs/decisions/0150-margem-um-rotulo-e-um-simulador-no-pulse.md`, e a nota:

```text
implementa o seletor de âncora que a 0148 D-8 deixou pendente; aposenta o segundo simulador do Sonar
```

- [ ] **Step 4: Run test to verify it passes** — o comando do Step 1 (Expected: `1`) e `pnpm docs:links` · Expected: PASS, "links OK". Conferir que os arquivos citados no "Relaciona" existem: `ls docs/decisions/0120-* docs/decisions/0055-*`.

- [ ] **Step 5: Commit**

```bash
git add docs/decisions/0150-margem-um-rotulo-e-um-simulador-no-pulse.md "obsidian-vault/04-Decisões/Índice de ADRs.md"
git commit -m "docs(adr): 0150 — uma base, um rótulo e um simulador de margem no Pulse"
```

---

## Task 11: O rótulo do percentual de margem no Radar (#2, parte 1)

**Files:** Modify (`src/components/pulse/dialog-detalhe.tsx:544-546`, `src/components/pulse/tabela-radar.tsx` coluna `sobra`) / Test (`src/components/pulse/__tests__/dialog-detalhe.test.tsx`, `src/components/pulse/__tests__/tabela-radar.test.tsx`)

**Interfaces:**
- Consumes: da Task 10, o vocabulário D-1. Da Task 9, a coluna `sobra`.
- Produces: o texto `s/ venda` ao lado de todo percentual de margem do Radar. A Task 12 confere o critério de aceite 2 da ADR-0150.

- [ ] **Step 1: Write the failing test**

Em `src/components/pulse/__tests__/dialog-detalhe.test.tsx`:

<!-- rev-fable: `renderDetalheComMargem()` não pode ser envelope de 3 linhas: o `vi.mock('@tanstack/react-query')`
do arquivo devolve `{custo:null, aliquotaPct:null}` FIXO para a chave 'contexto-margem' (linha 17-19), e o
`produtoBase` tem `codigo_pai: null` (o bloco de decisão nem renderiza). Especifico o helper aqui; a Task 20 o reusa. -->
Primeiro, o helper. No topo de `dialog-detalhe.test.tsx`, trocar o valor fixo do mock do contexto por um hoisted mutável:

```tsx
const contextoMargem = vi.hoisted(() => ({
  valor: { custo: null as number | null, aliquotaPct: null as number | null },
}));
// …no vi.mock('@tanstack/react-query'): queryKey[1] === 'contexto-margem'
//   ? { data: contextoMargem.valor, isLoading: false }
//   : …

/** Produto com os QUATRO insumos da margem — custo 30, alíquota 8%, comissão 14% + 0 fixo lida
 *  em R$ 100 (sem "estimativa"), frete 5 — a R$ 100. Sobra: 100 − 14 − 5 − 8 − 30 = 43,00 (43.0%). */
function renderDetalheComMargem() {
  contextoMargem.valor = { custo: 30, aliquotaPct: 8 };
  return renderDetalhe({
    ...produtoBase, codigo_pai: 'APTAMIL-1', meu_preco: 100,
    comissao_pct: 14, comissao_fixa: 0, comissao_preco: 100,
    ptw_custos: { comissao: null, frete: 5 },
  });
}
```

e no `afterEach`, `contextoMargem.valor = { custo: null, aliquotaPct: null };`.

```tsx
// ADR-0150 D-1: `%` sozinho não diz o denominador, e markup e margem s/ venda convivem no Pulse.
describe('DialogDetalhe — o percentual da sobra diz o denominador', () => {
  it('mostra "s/ venda" junto do percentual', () => {
    renderDetalheComMargem();
    expect(screen.getByText(/43\.0%\s*s\/\s*venda/)).toBeInTheDocument();
  });
});
```

Em `src/components/pulse/__tests__/tabela-radar.test.tsx`, no describe "Sobra hoje", trocar a asserção do percentual do primeiro caso por:

```tsx
    expect(screen.getByText(/43\.0%\s*s\/\s*venda/)).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/components/pulse/__tests__/dialog-detalhe.test.tsx src/components/pulse/__tests__/tabela-radar.test.tsx -t "venda"` · Expected: FAIL com `Unable to find an element with the text: /%\s*s\/\s*venda/`.

- [ ] **Step 3: Write minimal implementation**

Em `src/components/pulse/dialog-detalhe.tsx` (linha ~544):

```tsx
                          {fmtBRL(margem.liquido)}
                          {/* ADR-0150 D-1: o denominador vai no nome. Markup (lucro ÷ custo) e
                              margem s/ venda (lucro ÷ preço) convivem no Pulse e não se misturam. */}
                          <span className="ml-1 text-sm font-normal opacity-80">
                            ({margem.margemPct.toFixed(1)}% s/ venda)
                          </span>
```

Em `src/components/pulse/tabela-radar.tsx`, na coluna `sobra`:

```tsx
            <span className="ml-1 text-xs font-normal opacity-80">
              ({m.margemPct.toFixed(1)}% s/ venda)
            </span>
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/components/pulse/__tests__/dialog-detalhe.test.tsx src/components/pulse/__tests__/tabela-radar.test.tsx` e `pnpm lint` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/pulse/dialog-detalhe.tsx src/components/pulse/tabela-radar.tsx src/components/pulse/__tests__/dialog-detalhe.test.tsx src/components/pulse/__tests__/tabela-radar.test.tsx
git commit -m "feat(pulse): o percentual de margem do Radar diz o denominador (ADR-0150)"
```

---

## Task 12: Um simulador só no Sonar — "Simular" troca a âncora da DRE (#2, parte 2)

**Files:** Modify (`src/pages/PulseSonar.tsx`, `src/components/pulse/sonar-dre.tsx:228-250`, `src/lib/sonar.ts:259-268`, `src/lib/__tests__/sonar.test.ts:92-113`), Remove (`src/components/pulse/dialog-margem-sonar.tsx`) / Test (`src/pages/__tests__/PulseSonar.test.tsx`)

**Interfaces:**
- Consumes: da Task 10, as decisões D-2 e D-3.
- Produces, para a Task 19 (que colapsa a DRE): a `SonarDre` passa a receber a âncora escolhida de fora e a renderizar um elemento com `id="sonar-dre"`; `AncoraDre` e `PrecosDoNicho` (exportadas de `sonar-dre.tsx`) ficam com a mesma forma. Some `DialogMargemSonar` e o tipo `AnuncioSimulavel`.

- [ ] **Step 1: Write the failing test**

<!-- rev-fable: três problemas no teste original. (a) `renderSonarComAmostra` não existia e o harness do arquivo
mocka `fetchVendasSonar` para `configurado:false` — sem trocar o mock não há amostra; `fetchSecoes237Sonar`
também não é mockado e dispararia `fetch` real. (b) `findByText(/Oxford Marrom/)` e `getByText('Oxford Azul')`
acham VÁRIOS elementos (título da tabela + `dre-ancora` + pódio do veredito) e lançam. (c) o 2º `it` era
placeholder ("…renderiza, troca a âncora…"). Tudo escrito abaixo. -->
Helper, no topo de `src/pages/__tests__/PulseSonar.test.tsx` (acrescentar `within` ao import de `@testing-library/react` e `fetchSecoes237Sonar: vi.fn(() => new Promise<never>(() => {}))` ao `vi.mock('@/lib/sonar', …)` — pendente para sempre mantém a Análise PubliAI em "carregando" e evita um `fetch` real):

```tsx
/** Página com uma amostra: o mock de `fetchVendasSonar` devolve `itens`, e o termo é digitado como o
 *  operador faria. Resolve quando a tabela aparece (o stepper segura o resultado por 400 ms). */
async function renderSonarComAmostra(itens: ItemVendasSonar[], termo = 'tecido oxford') {
  vi.mocked(fetchVendasSonar).mockResolvedValue({
    ...respBase(null), termo, itens, itens_analisados: itens.length, itens_com_vendas: itens.length,
  });
  const campo = renderSonar();
  await userEvent.type(campo, `${termo}{Enter}`);
  await screen.findByRole('table', {}, { timeout: 3000 });
  return campo;
}

/** Título na TABELA — o mesmo texto aparece no pódio do veredito e no `dre-ancora`. */
const linhaDaTabela = (titulo: string) =>
  screen.getAllByText(titulo).map((el) => el.closest('tr')).find((tr): tr is HTMLTableRowElement => tr != null)!;
```

Acrescentar ao final do arquivo:

```tsx
// ADR-0150 D-2: o Sonar tinha dois simuladores com bases diferentes respondendo à mesma pergunta.
describe('PulseSonar — um simulador só', () => {
  const amostra = () => [
    itemBase({ titulo: 'Oxford Marrom', item_id: 'MLB1', preco: 100, category_id: 'MLB1234', vendidos: 50 }),
    itemBase({ titulo: 'Oxford Azul', item_id: 'MLB2', preco: 80, category_id: 'MLB1234', vendidos: 10 }),
  ];

  it('"Simular" troca a âncora da DRE em vez de abrir um segundo simulador', async () => {
    await renderSonarComAmostra(amostra());

    // Âncora padrão continua sendo o primeiro da amostra (ADR-0148 D-8).
    expect(screen.getByTestId('dre-ancora')).toHaveTextContent('Oxford Marrom');

    await userEvent.click(within(linhaDaTabela('Oxford Azul')).getByRole('button', { name: /Simular/ }));

    expect(screen.getByTestId('dre-ancora')).toHaveTextContent('Oxford Azul');
    // Nada de dialog: o segundo simulador não existe mais.
    expect(screen.queryByRole('dialog', { name: 'Simular margem' })).not.toBeInTheDocument();
  });

  it('buscar outro nicho devolve a âncora ao primeiro anúncio da amostra nova', async () => {
    const campo = await renderSonarComAmostra(amostra());
    await userEvent.click(within(linhaDaTabela('Oxford Azul')).getByRole('button', { name: /Simular/ }));
    expect(screen.getByTestId('dre-ancora')).toHaveTextContent('Oxford Azul');

    // Termo novo → `termoBuscado` muda → a escolha anterior apontaria para um anúncio que não está
    // mais na tela. O mock devolve a mesma amostra para qualquer termo.
    await userEvent.clear(campo);
    await userEvent.type(campo, 'outro nicho{Enter}');
    expect(await screen.findByTestId('dre-ancora', {}, { timeout: 3000 })).toHaveTextContent('Oxford Marrom');
  });
});
```

E remover, de `src/lib/__tests__/sonar.test.ts`, o describe `margemSimulada — recebe/imposto/margem sobre custo …` (linhas ~92-113) e o nome `margemSimulada` do import do topo.

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/pages/__tests__/PulseSonar.test.tsx -t "um simulador só"` · Expected: FAIL com `Unable to find an element by: [data-testid="dre-ancora"]`.

- [ ] **Step 3: Write minimal implementation**

Em `src/pages/PulseSonar.tsx`:

1. Remover os imports de `DialogMargemSonar`/`AnuncioSimulavel` e o estado `anuncioSimulando`, e a linha `<DialogMargemSonar … />` do rodapé.
2. Trocar o cálculo da âncora:

```tsx
  /** Âncora da DRE. Padrão: o primeiro anúncio da amostra (ADR-0148 D-8) — na ordenação inicial, o
   *  que mais vende. O botão "Simular" da linha troca por outro (ADR-0150 D-2), e o seletor que a
   *  D-8 deixou para "a fatia seguinte" é exatamente isto. */
  const [ancoraId, setAncoraId] = useState<string | null>(null);
  // Amostra nova, âncora nova: manter a escolha do nicho anterior apontaria para um anúncio que
  // não está mais na tela.
  useEffect(() => setAncoraId(null), [termoBuscado]);

  const ancoraDre = useMemo(() => {
    const i = itens.find((x) => (x.item_id ?? x.titulo) === ancoraId) ?? itens[0];
    if (!i) return null;
    return {
      id: i.item_id ?? i.titulo,
      nome: i.titulo,
      category_id: i.category_id ?? null,
      preco_referencia: i.preco,
    };
  }, [itens, ancoraId]);
```

3. Na coluna `acao` da tabela, trocar o botão:

```tsx
            <Button
              variant="outline"
              size="sm"
              aria-pressed={(i.item_id ?? i.titulo) === (ancoraDre?.id ?? null)}
              onClick={() => {
                setAncoraId(i.item_id ?? i.titulo);
                document.getElementById('sonar-dre')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              title="Usar este anúncio como referência da DRE"
            >
              Simular
            </Button>
```

e acrescentar `ancoraDre?.id` às dependências do `useMemo` das colunas (`[visitasPorItem, ancoraDre?.id]`).

Em `src/components/pulse/sonar-dre.tsx`, dar id e testid ao cabeçalho (linha ~229):

```tsx
    <Card id="sonar-dre" className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Dá lucro?</p>
          <p className="text-xs text-muted-foreground">
            Cinco preços de venda deste nicho, cada um cotado no Mercado Livre ·{' '}
            <span data-testid="dre-ancora" className="font-medium text-foreground">{ancora.nome}</span>
          </p>
        </div>
```

(o "6." sai aqui; a padronização do resto dos cabeçalhos é da Task 19.)

Em `src/lib/sonar.ts`, **remover** `margemSimulada` com o JSDoc dela (linhas 253-268) e o cabeçalho de seção `// --- Simulador de margem ---` (linha 251) — ADR-0150 D-3.

Apagar o componente e conferir que não sobrou referência:

```bash
git rm src/components/pulse/dialog-margem-sonar.tsx
grep -rn "DialogMargemSonar\|AnuncioSimulavel\|margemSimulada" src/   # esperado: sem saída
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/pages/__tests__/PulseSonar.test.tsx src/lib/__tests__/sonar.test.ts src/components/pulse/__tests__/sonar-dre.test.tsx`, `pnpm lint` e `pnpm tsc -b --force` (o `git rm` derruba import esquecido só no build) · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add -A src/pages/PulseSonar.tsx src/components/pulse/sonar-dre.tsx src/components/pulse/dialog-margem-sonar.tsx src/lib/sonar.ts src/lib/__tests__/sonar.test.ts src/pages/__tests__/PulseSonar.test.tsx
git commit -m "feat(pulse): um simulador só no Sonar — Simular troca a âncora da DRE (ADR-0150)"
```

---

## Task 13: Investigação — os alertas repetidos são reemissão ou movimento real? (#5, dúvida 3 da spec)

**Files:** nenhum arquivo de produção. A saída desta task é **evidência colada na Task 15** (ADR-0133 Errata 3) e a decisão de executar ou pular a Task 14.

**Interfaces:**
- Consumes: nada.
- Produces: um veredito com um dos dois valores — `REEMISSÃO` (executa a Task 14) ou `MOVIMENTO REAL` (pula a Task 14). Em qualquer um dos dois, as Tasks 15–17 (agrupamento na UI) acontecem.

**Contexto medido na validação:** na org real, 9 alertas de Ação cobrem 4 produtos. "Aptamil Premium 2 caiu de R$ 71,99 para R$ 68,99" aparece **duas vezes, idêntico**. Sem data na tela é impossível saber se são dias diferentes.

**O discriminante já encontrado na leitura do código:** `pulse-coletar/processar.ts` (~linha 418) documenta que o upsert de `pulse_ofertas` é **merge, sem `ignoreDuplicates`**, justamente para que uma 2ª execução no mesmo dia sobrescreva a linha do dia — sem isso "o próximo diff comparava sempre contra esse valor velho e reemitia `preco_caiu` a cada execução do dia". Ou seja: a reemissão no mesmo dia foi **deliberadamente fechada**. Se ela existir mesmo assim, alguma coisa quebrou, e é isso que a Task 14 conserta. Se as repetições estiverem em dias diferentes, são quedas reais e suprimi-las seria apagar informação.

- [ ] **Step 1: Write the failing test** — a "asserção" aqui é a consulta. Ler primeiro o caminho do alerta, para saber o que a consulta pode e não pode provar:

```bash
sed -n '250,305p' supabase/functions/pulse-coletar/processar.ts   # gravarAlertasRelevantes
sed -n '395,460p' supabase/functions/pulse-coletar/processar.ts   # upsert de ofertas + estadoGravado
grep -n "preco_caiu" -B 8 -A 8 supabase/functions/_shared/pulse/diff.ts
```

- [ ] **Step 2: Run test to verify it fails** — rodar as consultas read-only pela Management API (nunca `db push`, nunca escrita):

```bash
cd "/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/feat+pulse-melhorias"
export SUPABASE_ACCESS_TOKEN="$(grep -m1 '^SUPABASE_ACCESS_TOKEN=.\+' .env.local | cut -d= -f2-)"

# (A) Repetições do MESMO par de preços, com a data — é a consulta que decide.
curl -s -X POST "https://api.supabase.com/v1/projects/txvncrgkoynoxwopfkbp/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select produto_id, payload->>'"'"'de'"'"' as de, payload->>'"'"'para'"'"' as para, (criado_em at time zone '"'"'UTC'"'"')::date as dia, severidade, lido, count(*) as n, min(criado_em) as primeiro, max(criado_em) as ultimo from pulse_alertas where tipo = '"'"'preco_caiu'"'"' and criado_em > now() - interval '"'"'30 days'"'"' group by 1,2,3,4,5,6 having count(*) > 1 order by n desc, dia desc"}'

# (B) Os 9 de Ação são mesmo 4 produtos?
curl -s -X POST "https://api.supabase.com/v1/projects/txvncrgkoynoxwopfkbp/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select produto_id, count(*) as alertas, min(criado_em) as mais_antigo, max(criado_em) as mais_novo from pulse_alertas where lido = false and severidade = '"'"'acao'"'"' group by 1 order by 2 desc"}'

# (C) Mesmo produto, mesmo par, em DIAS diferentes — o caso "movimento real".
curl -s -X POST "https://api.supabase.com/v1/projects/txvncrgkoynoxwopfkbp/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select produto_id, payload->>'"'"'de'"'"' as de, payload->>'"'"'para'"'"' as para, count(distinct (criado_em at time zone '"'"'UTC'"'"')::date) as dias, count(*) as n from pulse_alertas where tipo = '"'"'preco_caiu'"'"' and criado_em > now() - interval '"'"'30 days'"'"' group by 1,2,3 having count(*) > 1 order by n desc"}'
```

**Critério de decisão, explícito:**

| Resultado da consulta (A) | Veredito | Consequência |
|---|---|---|
| Existe ao menos uma linha com `n > 1` — isto é, o mesmo `produto_id` + mesmo `de` + mesmo `para` **no mesmo dia UTC** | **REEMISSÃO** | Executar a Task 14 (dedupe no coletor + deploy) e registrar a contagem na Errata 3 (Task 15) |
| Nenhuma linha em (A), e (C) mostra repetição só com `dias > 1` | **MOVIMENTO REAL** | **Pular a Task 14.** O agrupamento da UI (Tasks 15–17) resolve sozinho, e suprimir no coletor apagaria queda real |
| (A) e (C) vazias (as repetições da tela eram de produtos diferentes com o mesmo texto) | **MOVIMENTO REAL** | Idem acima |

- [ ] **Step 3: Write minimal implementation** — não há código. Registrar o resultado no relatório da task com este formato, para a Task 15 copiar:

```
Consulta (A): <n linhas> — <colar as linhas ou "vazio">
Consulta (B): <produto_id, contagem> × N
Consulta (C): <linhas>
Veredito: REEMISSÃO | MOVIMENTO REAL
Task 14: executar | pular
```

- [ ] **Step 4: Run test to verify it passes** — a task está concluída quando o veredito está escrito e as três saídas estão coladas. Nenhum `pnpm` roda aqui (nada mudou no código).

- [ ] **Step 5: Commit** — nada a commitar. O resultado entra no commit da Task 15.

---

## Task 14 (CONDICIONAL — só com veredito REEMISSÃO): dedupe do `preco_caiu` no mesmo dia

> **Não execute esta task se a Task 13 devolveu MOVIMENTO REAL.** Suprimir queda real é pior do que a lista comprida que o agrupamento da UI já resolve.

**Files:** Modify (`supabase/functions/pulse-coletar/processar.ts`, função `gravarAlertasRelevantes`), Create (`supabase/functions/pulse-coletar/__tests__/dedupe-preco-caiu.test.ts`), Modify (`docs/reference/edge-functions.md`)

**Interfaces:**
- Consumes: da Task 13, o veredito.
- Produces: `export async function alertasJaGravadosHoje(admin, orgId, produtoIds): Promise<Set<string>>` em `processar.ts` (exportada para o teste), com chave `${produtoId}|${de}|${para}`.

- [ ] **Step 1: Write the failing test**

Criar `supabase/functions/pulse-coletar/__tests__/dedupe-preco-caiu.test.ts`, no padrão do `alertas-severidade.test.ts` vizinho (fake do `SupabaseClient` com `from()` fluente):

<!-- rev-fable: sem o `vi.mock` do token, importar `processar.ts` sob vitest quebra na resolução do
`jsr:@supabase/supabase-js` (é o que o vizinho `alertas-severidade.test.ts:5` faz, com a explicação). E o
caminho é `'../processar.ts'` com extensão, como no vizinho. -->
```ts
import { describe, expect, it, vi } from 'vitest';

// Mesmo motivo do vizinho alertas-severidade.test.ts: ml/token.ts importa _shared/supabase.ts, que faz
// `import { createClient } from 'jsr:...'` (valor real) — sob vitest isso quebra a resolução do módulo.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import { chaveDedupePrecoCaiu, filtrarAlertasJaGravados } from '../processar.ts';

const alerta = (de: number, para: number) => ({
  tipo: 'preco_caiu' as const,
  payload: { de, para, meu_preco: 90 },
  severidade: 'acao' as const,
});

describe('dedupe do preco_caiu no mesmo dia (ADR-0133 Errata 3)', () => {
  it('descarta a queda idêntica já gravada hoje para o mesmo produto', () => {
    const jaGravados = new Set([chaveDedupePrecoCaiu('p1', 71.99, 68.99)]);
    expect(filtrarAlertasJaGravados('p1', [alerta(71.99, 68.99)], jaGravados)).toEqual([]);
  });

  it('mantém a queda com OUTRO par de preços no mesmo produto', () => {
    const jaGravados = new Set([chaveDedupePrecoCaiu('p1', 71.99, 68.99)]);
    expect(filtrarAlertasJaGravados('p1', [alerta(70.19, 67.99)], jaGravados)).toHaveLength(1);
  });

  it('mantém a mesma queda em OUTRO produto', () => {
    const jaGravados = new Set([chaveDedupePrecoCaiu('p1', 71.99, 68.99)]);
    expect(filtrarAlertasJaGravados('p2', [alerta(71.99, 68.99)], jaGravados)).toHaveLength(1);
  });

  it('não toca em alerta de outro tipo — só preco_caiu tem par de preços', () => {
    const jaGravados = new Set([chaveDedupePrecoCaiu('p1', 71.99, 68.99)]);
    const novoConcorrente = { tipo: 'novo_concorrente' as const, payload: { preco: 68.99 }, severidade: 'acao' as const };
    expect(filtrarAlertasJaGravados('p1', [novoConcorrente], jaGravados)).toHaveLength(1);
  });

  it('conjunto vazio não descarta nada', () => {
    expect(filtrarAlertasJaGravados('p1', [alerta(71.99, 68.99)], new Set())).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run supabase/functions/pulse-coletar/__tests__/dedupe-preco-caiu.test.ts` · Expected: FAIL com `chaveDedupePrecoCaiu is not exported by '../processar'`.

- [ ] **Step 3: Write minimal implementation**

Acrescentar em `supabase/functions/pulse-coletar/processar.ts`, acima de `gravarAlertasRelevantes`:

```ts
/** Chave da queda: produto + par de preços. Number() normaliza "68.99" e 68.99 na mesma chave. */
export function chaveDedupePrecoCaiu(produtoId: string, de: unknown, para: unknown): string {
  return `${produtoId}|${Number(de)}|${Number(para)}`;
}

/**
 * ADR-0133 Errata 3. O upsert de `pulse_ofertas` (merge, sem `ignoreDuplicates`) fecha a reemissão
 * dentro de um mesmo diff, mas não segura duas EXECUÇÕES do dia recalculando a mesma queda quando o
 * estado do dia é regravado. Um segundo alerta idêntico não acrescenta decisão — acrescenta linha,
 * e foi o que a validação de 2026-09-01 mediu na org real.
 *
 * A janela é o DIA UTC de propósito, e não "os últimos N alertas": a mesma queda em dias
 * diferentes é movimento real (o preço voltou e caiu de novo) e continua gerando alerta.
 */
export function filtrarAlertasJaGravados<T extends { tipo: string; payload: Record<string, unknown> }>(
  produtoId: string,
  alertas: T[],
  jaGravadosHoje: Set<string>,
): T[] {
  return alertas.filter((a) => (
    a.tipo !== 'preco_caiu'
    || !jaGravadosHoje.has(chaveDedupePrecoCaiu(produtoId, a.payload.de, a.payload.para))
  ));
}

/** Quedas já gravadas hoje (UTC) para estes produtos, como chaves de `chaveDedupePrecoCaiu`. */
export async function alertasJaGravadosHoje(
  admin: SupabaseClient, orgId: string, produtoIds: string[],
): Promise<Set<string>> {
  const chaves = new Set<string>();
  if (produtoIds.length === 0) return chaves;
  const inicioDoDia = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').toISOString();
  const { data, error } = await admin.from('pulse_alertas')
    .select('produto_id, payload')
    .eq('org_id', orgId).eq('tipo', 'preco_caiu')
    .in('produto_id', produtoIds)
    .gte('criado_em', inicioDoDia);
  // Falha aqui NÃO derruba o alerta: sem a leitura, o comportamento volta a ser o de hoje (grava).
  // Deixar de alertar por causa de uma consulta que caiu seria trocar ruído por silêncio.
  if (error) {
    console.warn('pulse-coletar: dedupe de preco_caiu indisponível, gravando sem filtro:', error.message);
    return chaves;
  }
  for (const linha of (data ?? []) as { produto_id: string; payload: Record<string, unknown> }[]) {
    chaves.add(chaveDedupePrecoCaiu(linha.produto_id, linha.payload.de, linha.payload.para));
  }
  return chaves;
}
```

E dentro de `gravarAlertasRelevantes`, depois do `Promise.all` dos perfis/visitas:

```ts
  const jaGravadosHoje = await alertasJaGravadosHoje(
    admin, orgId, pendentes.map((p) => p.produtoId),
  );
```

e, logo depois do `const { alertas } = diffOfertas(...)`, antes do `if (alertas.length === 0) continue;`:

```ts
    const alertasNovos = filtrarAlertasJaGravados(pendente.produtoId, alertas, jaGravadosHoje);
    if (alertasNovos.length === 0) continue;
```

trocando as três referências seguintes a `alertas` (o `if (!pendente.estadoGravado)`, o `insert` e as duas contagens) por `alertasNovos`.

<!-- rev-fable: o fake de `SupabaseClient` do teste vizinho (`alertas-severidade.test.ts:47-59`) só responde
`insert` para `pulse_alertas` e lança "tabela inesperada" fora disso — a leitura nova de `alertasJaGravadosHoje`
(`select().eq().eq().in().gte()`) derrubaria a suíte existente inteira. -->
**Atualizar o fake do teste vizinho no mesmo commit:** em `alertas-severidade.test.ts`, o ramo `if (tabela === 'pulse_alertas')` do `from()` (linhas 50-57) precisa responder também à leitura — acrescentar `select: () => leitura(cenario.jaGravados ?? [])` (a cadeia fluente `leitura()` já existe no arquivo para vendedores/ofertas; conferir que ela expõe `eq`, `in` e `gte` — acrescentar `gte` se faltar). Sem isso `gravarAlertasRelevantes` lança "tabela inesperada"/"select is not a function" nos testes de severidade.

Deploy (passo obrigatório — merge na main **não** deploya edge function):

```bash
cd "/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/feat+pulse-melhorias"
export SUPABASE_ACCESS_TOKEN="$(grep -m1 '^SUPABASE_ACCESS_TOKEN=.\+' .env.local | cut -d= -f2-)"
supabase functions deploy pulse-coletar --project-ref txvncrgkoynoxwopfkbp
```

Conferir a versão pós-deploy. `pulse-coletar` é chamada por QStash — o `config.toml` já congela o `verify_jwt`; **não** passar `--no-verify-jwt`. Nenhuma migration: a dedupe é uma leitura, não um índice (índice sobre expressão com `criado_em::date` exigiria `AT TIME ZONE` para ser imutável, e não paga o custo para ~12 alertas/dia).

Atualizar `docs/reference/edge-functions.md` no mesmo commit: `pulse-coletar` passa a descartar `preco_caiu` idêntico já gravado no mesmo dia UTC; falha da leitura de dedupe degrada para o comportamento antigo (grava).

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run supabase/functions/pulse-coletar/__tests__/`, `pnpm lint` e `pnpm docs:links` · Expected: PASS. Depois do deploy, reexecutar a consulta (A) da Task 13 no dia seguinte · Expected: zero linhas novas com `n > 1` no mesmo dia.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/pulse-coletar/processar.ts supabase/functions/pulse-coletar/__tests__/dedupe-preco-caiu.test.ts docs/reference/edge-functions.md
git commit -m "fix(pulse): coletor não reemite a mesma queda de preço no mesmo dia"
```

---

## Task 15: ADR-0133 Errata 3 — agrupamento por produto na aba Alertas (#5, decisão)

**Files:** Modify (`docs/decisions/0133-alertas-do-pulse-severidade-e-area-dedicada.md`, antes de `## Consequências aceitas`)

**Interfaces:**
- Consumes: da Task 13, o veredito e as três saídas de consulta.
- Produces: os nomes que as Tasks 16 e 17 implementam — `agruparAlertasPorProduto`, `GrupoAlertas`, `idadeAlerta`, `marcarAlertasLidosPorIds`.

**Numeração:** a ADR-0133 tem Erratas 1 e 2 hoje. Esta é a **3**.

- [ ] **Step 1: Write the failing test** — sem teste unitário. Gate: `grep -c "^## Errata 3" docs/decisions/0133-alertas-do-pulse-severidade-e-area-dedicada.md` e `pnpm docs:links`.

- [ ] **Step 2: Run test to verify it fails** — o `grep` acima · Expected: FAIL com saída `0`.

- [ ] **Step 3: Write minimal implementation**

Inserir antes de `## Consequências aceitas`:

```markdown
## Errata 3 (2026-09-01, validação em runtime com dados reais) — a lista é por produto, e cada linha tem idade

A ADR-0133 acertou o que é decisão (`acao`) e o que é ruído (`info`), mas mediu isso **por evento**.
Na org de validação, os 9 alertas de Ação são na prática **4 produtos**: "Aptamil Premium 1" com duas
quedas (69,80→67,99 e 70,19→67,99), "Eucerin Aquaphor" com duas (77,87→72,31 e 70,90→68,90) e
"Aptamil Premium 2" com duas quedas idênticas (71,99→68,99). A fila de trabalho do operador é de
4 itens; a tela mostrava 9.

E `criado_em` só era usado para calcular a âncora do "marcar todos" (`aba-alertas.tsx:114`): a linha
não dizia **quando**. Sem isso não dá para priorizar nem para saber se já foi reagido — e, no caso
das duas quedas idênticas, nem para distinguir reemissão de queda real.

> **Medição da investigação (Task 13 do plano 2026-09-01):**
> `<colar aqui as saídas (A), (B) e (C) e o veredito da Task 13>`
<!-- rev-fable: este é o único placeholder deliberado do plano — ele é preenchido com a saída da Task 13. O
commit desta task NÃO pode sair com o texto entre <> ; o Step 4 abaixo passa a checar isso. -->
> (o executor substitui a linha acima pelo resultado real; `grep -c "<colar aqui" docs/decisions/0133-*.md` tem de devolver `0` antes do commit)

### D-1 — A linha da aba Alertas é o PRODUTO, não o evento

A lista passa a agrupar por `produto_id`: uma linha por produto, com o texto do alerta **mais
recente** e, quando há mais de um, `· N movimentos` — expansível para ver os demais em ordem
decrescente. O agrupamento é **de exibição**: nenhuma linha de `pulse_alertas` deixa de existir, e a
contagem do botão "Marcar N como lidos" continua sendo a de **alertas**, não a de grupos, porque é
ela que descreve o que o clique vai fazer no banco (D-7 e Errata 2 seguem valendo).

Alerta sem `produto_id` (ficha removida) não é agrupado com os outros: vira grupo de um, com a
própria chave. Juntar "sem produto" num balde só misturaria produtos diferentes numa linha.

### D-2 — Cada linha diz a idade e, na queda de preço, o quanto caiu

`há 3 horas` ao lado do texto, e `-4%` junto do par de preços em `preco_caiu`. "Caiu de R$ 49,90
para R$ 47,90" obrigava a conta mental exatamente no momento em que a decisão é tomada. O
percentual é derivado do payload, não gravado: é aritmética sobre dois números que já estão lá.

### D-3 — O ✓ do grupo marca o grupo inteiro

Marcar lido um produto e ver a mesma linha voltar com o segundo evento é a definição de fila que não
anda. `marcarAlertasLidosPorIds(ids)` faz um `update … in('id', ids)` — o mesmo grant column-level em
`lido`, uma ida ao banco. **Não** é um "marcar todos" disfarçado: o escopo é o conjunto de ids
renderizados naquela linha, e nada além.

### D-4 — Reemissão no coletor, se houver, é conserto separado

Agrupar na UI resolve a leitura; não resolve a causa se o coletor estiver gravando a mesma queda
duas vezes no mesmo dia. A investigação acima decide: com reemissão medida, o coletor passa a
descartar `preco_caiu` idêntico já gravado no mesmo dia UTC, com falha da consulta degradando para o
comportamento antigo (grava) — deixar de alertar por causa de uma consulta que caiu seria trocar
ruído por silêncio. Sem reemissão medida, **nada muda no coletor**: a mesma queda em dias diferentes
é movimento real, e suprimi-la apagaria informação.
```

- [ ] **Step 4: Run test to verify it passes** — `grep -c "^## Errata 3" docs/decisions/0133-alertas-do-pulse-severidade-e-area-dedicada.md` (Expected: `1`), `grep -c "<colar aqui" docs/decisions/0133-alertas-do-pulse-severidade-e-area-dedicada.md` (Expected: `0`) e `pnpm docs:links` · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/decisions/0133-alertas-do-pulse-severidade-e-area-dedicada.md
git commit -m "docs(adr): 0133 Errata 3 — alertas agrupados por produto, com idade e delta"
```

---

## Task 16: Idade do alerta e Δ% da queda (#5, texto)

**Files:** Modify (`src/lib/pulse-alerta-texto.ts`) / Test (`src/lib/__tests__/pulse-alerta-texto.test.ts`)

**Interfaces:**
- Consumes: da Task 15, as decisões D-2.
- Produces, para a Task 17:
  - `export function textoAlerta(alerta: PulseAlerta): string` — assinatura inalterada; `preco_caiu` passa a incluir ` (-4%)`
  - `export function idadeAlerta(criadoEm: string, agora?: Date): string` — reusa `tempoRelativo` de `sonar-buscas-recentes.ts`

- [ ] **Step 1: Write the failing test**

<!-- rev-fable: o arquivo já importa `textoAlerta` (linha 2) — duplicar o import é erro de lint; o helper do
arquivo chama-se `base()` (não `alerta()`) e o produto é 'Fone Bluetooth X' (não 'Aptamil Premium 1'). E o
primeiro teste existente (`'preco_caiu: menor preço caiu de X para Y'`, 129,9→99,9) compara a string exata —
ele passa a terminar em " (-23%)" e tem de ser atualizado no mesmo commit. `fmtBRL` usa NBSP: comparar com
template literal `${fmtBRL(...)}` como o vizinho faz, não com "R$ 49,90" digitado. -->
Em `src/lib/__tests__/pulse-alerta-texto.test.ts`, trocar a linha 2 por `import { idadeAlerta, textoAlerta } from '../pulse-alerta-texto';`, atualizar o primeiro `it` existente (linha 14-19) para esperar `` `Menor preço de Fone Bluetooth X caiu de ${fmtBRL(129.9)} para ${fmtBRL(99.9)} (-23%)` ``, e acrescentar ao final:

```ts
// ADR-0133 Errata 3 D-2: "caiu de R$ 49,90 para R$ 47,90" obriga a conta mental exatamente no
// momento da decisão.
describe('textoAlerta — o quanto caiu', () => {
  it('acrescenta o percentual da queda', () => {
    expect(textoAlerta(base({ tipo: 'preco_caiu', payload: { de: 49.9, para: 47.9 } })))
      .toBe(`Menor preço de Fone Bluetooth X caiu de ${fmtBRL(49.9)} para ${fmtBRL(47.9)} (-4%)`);
  });

  it('arredonda para inteiro — casa decimal de percentual não muda decisão aqui', () => {
    expect(textoAlerta(base({ tipo: 'preco_caiu', payload: { de: 71.99, para: 68.99 } })))
      .toMatch(/\(-4%\)$/);
  });

  it('sem os dois preços, não inventa percentual', () => {
    expect(textoAlerta(base({ tipo: 'preco_caiu', payload: { de: 49.9 } })))
      .toBe('Menor preço de Fone Bluetooth X caiu');
  });

  it('"de" zero não vira divisão por zero nem Infinity na tela', () => {
    expect(textoAlerta(base({ tipo: 'preco_caiu', payload: { de: 0, para: 0 } })))
      .toBe(`Menor preço de Fone Bluetooth X caiu de ${fmtBRL(0)} para ${fmtBRL(0)}`);
  });
});

describe('idadeAlerta', () => {
  const agora = new Date('2026-09-01T12:00:00.000Z');
  it('minutos', () => expect(idadeAlerta('2026-09-01T11:40:00.000Z', agora)).toBe('há 20 minutos'));
  it('horas', () => expect(idadeAlerta('2026-09-01T09:00:00.000Z', agora)).toBe('há cerca de 3 horas'));
  it('dias', () => expect(idadeAlerta('2026-08-29T12:00:00.000Z', agora)).toBe('há 3 dias'));
  it('data do futuro (relógio torto) devolve string vazia, não "há -1 dias"', () => {
    expect(idadeAlerta('2026-09-02T12:00:00.000Z', agora)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/lib/__tests__/pulse-alerta-texto.test.ts` · Expected: FAIL com `idadeAlerta is not a function` e `expected 'Menor preço de … R$ 47,90' to be '… R$ 47,90 (-4%)'`.

- [ ] **Step 3: Write minimal implementation**

Em `src/lib/pulse-alerta-texto.ts`:

```ts
import { tempoRelativo } from './sonar-buscas-recentes';
```

```ts
/** Idade do alerta. Reusa a função já testada do Sonar — "há 3 horas" é a mesma frase em qualquer
 *  tela, e um segundo formatador de tempo relativo é um segundo lugar para divergir. */
export function idadeAlerta(criadoEm: string, agora: Date = new Date()): string {
  return tempoRelativo(criadoEm, agora);
}
```

E, no `case 'preco_caiu'`:

```ts
    case 'preco_caiu': {
      const de = valor(payload.de);
      const para = valor(payload.para);
      if (!de || !para) return `Menor preço de ${titulo} caiu`;
      // O percentual é derivado do payload, não gravado: aritmética sobre dois números que já estão
      // lá (ADR-0133 Errata 3 D-2). `de` zero não produz Infinity na tela — some o percentual.
      const n = (v: unknown) => Number(v);
      const quedaPct = n(payload.de) > 0
        ? Math.round(((n(payload.de) - n(payload.para)) / n(payload.de)) * 100)
        : null;
      const base = `Menor preço de ${titulo} caiu de ${de} para ${para}`;
      return quedaPct ? `${base} (-${quedaPct}%)` : base;
    }
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/lib/__tests__/pulse-alerta-texto.test.ts src/components/pulse/__tests__/aba-alertas.test.tsx` e `pnpm lint` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pulse-alerta-texto.ts src/lib/__tests__/pulse-alerta-texto.test.ts
git commit -m "feat(pulse): alerta de queda diz o percentual, e ganha idade"
```

---

## Task 17: Aba Alertas agrupada por produto (#5, tela)

**Files:** Create (`src/lib/pulse-alertas-grupo.ts`, `src/lib/__tests__/pulse-alertas-grupo.test.ts`), Modify (`src/lib/pulse.ts`, `src/components/pulse/aba-alertas.tsx:226-296`) / Test (`src/components/pulse/__tests__/aba-alertas.test.tsx`)

**Interfaces:**
- Consumes da Task 16: `textoAlerta`, `idadeAlerta`. Da Task 15: D-1 e D-3.
- Produces:
  - `export interface GrupoAlertas { chave: string; produtoId: string | null; maisRecente: PulseAlerta; ids: string[]; total: number; demais: PulseAlerta[] }`
  - `export function agruparAlertasPorProduto(alertas: PulseAlerta[]): GrupoAlertas[]`
  - `export async function marcarAlertasLidosPorIds(ids: string[]): Promise<void>` — em `src/lib/pulse.ts`

- [ ] **Step 1: Write the failing test**

Criar `src/lib/__tests__/pulse-alertas-grupo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { agruparAlertasPorProduto } from '../pulse-alertas-grupo';
import type { PulseAlerta } from '@/lib/pulse';

const a = (over: Partial<PulseAlerta>): PulseAlerta => ({
  id: 'x', produto_id: 'p1', tipo: 'preco_caiu', payload: { de: 70, para: 68 },
  lido: false, criado_em: '2026-09-01T10:00:00.000Z', severidade: 'acao',
  pulse_produtos: { titulo: 'Aptamil', codigo_pai: 'A1', catalog_product_id: 'MLB1' }, ...over,
});

describe('agruparAlertasPorProduto (ADR-0133 Errata 3 D-1)', () => {
  it('nove alertas de quatro produtos viram quatro linhas', () => {
    const alertas = ['p1', 'p1', 'p2', 'p2', 'p3', 'p3', 'p4', 'p4', 'p4']
      .map((produto_id, i) => a({ id: `a${i}`, produto_id }));
    expect(agruparAlertasPorProduto(alertas)).toHaveLength(4);
  });

  it('o grupo exibe o alerta MAIS RECENTE e conta o total', () => {
    const g = agruparAlertasPorProduto([
      a({ id: 'velho', criado_em: '2026-09-01T08:00:00.000Z' }),
      a({ id: 'novo', criado_em: '2026-09-01T11:00:00.000Z' }),
    ]);
    expect(g[0].maisRecente.id).toBe('novo');
    expect(g[0].total).toBe(2);
    expect(g[0].demais.map((x) => x.id)).toEqual(['velho']);
    expect(g[0].ids).toEqual(['novo', 'velho']);
  });

  it('preserva a ordem de chegada dos grupos — a lista já vem por criado_em desc', () => {
    const g = agruparAlertasPorProduto([
      a({ id: 'a', produto_id: 'p2', criado_em: '2026-09-01T11:00:00.000Z' }),
      a({ id: 'b', produto_id: 'p1', criado_em: '2026-09-01T10:00:00.000Z' }),
    ]);
    expect(g.map((x) => x.produtoId)).toEqual(['p2', 'p1']);
  });

  it('alerta sem produto_id vira grupo de um, nunca um balde comum', () => {
    const g = agruparAlertasPorProduto([
      a({ id: 'sem1', produto_id: null }),
      a({ id: 'sem2', produto_id: null }),
    ]);
    expect(g).toHaveLength(2);
    expect(g.every((x) => x.total === 1)).toBe(true);
  });

  it('lista vazia devolve lista vazia', () => {
    expect(agruparAlertasPorProduto([])).toEqual([]);
  });
});
```

Acrescentar em `src/components/pulse/__tests__/aba-alertas.test.tsx`:

```tsx
// ADR-0133 Errata 3: a fila do operador é de produtos, não de eventos.
describe('AbaAlertas — agrupada por produto', () => {
  it('dois alertas do mesmo produto viram uma linha com "2 movimentos"', async () => {
    vi.mocked(fetchPulseAlertas).mockResolvedValueOnce([
      alerta({ id: 'a1', produto_id: 'p1', criado_em: '2026-09-01T11:00:00.000Z' }),
      alerta({ id: 'a2', produto_id: 'p1', criado_em: '2026-09-01T09:00:00.000Z' }),
    ]);
    renderAba();
    expect(await screen.findByText(/2 movimentos/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Ver produto/ })).toHaveLength(1);
  });

  it('a linha diz a idade do alerta mais recente', async () => {
    vi.mocked(fetchPulseAlertas).mockResolvedValueOnce([alerta({ criado_em: new Date(Date.now() - 3 * 3600_000).toISOString() })]);
    renderAba();
    expect(await screen.findByText(/há cerca de 3 horas/)).toBeInTheDocument();
  });

  it('o ✓ do grupo marca TODOS os alertas daquele produto, numa chamada só', async () => {
    vi.mocked(fetchPulseAlertas).mockResolvedValueOnce([
      alerta({ id: 'a1', produto_id: 'p1' }), alerta({ id: 'a2', produto_id: 'p1' }),
    ]);
    renderAba();
    await userEvent.click(await screen.findByRole('button', { name: /^Marcar como lido/ }));
    await waitFor(() => expect(marcarAlertasLidosPorIds).toHaveBeenCalledWith(['a1', 'a2']));
  });

  it('o botão do topo continua contando ALERTAS, não grupos', async () => {
    vi.mocked(contarPulseAlertas).mockResolvedValue(9);
    vi.mocked(fetchPulseAlertas).mockResolvedValueOnce([
      alerta({ id: 'a1', produto_id: 'p1' }), alerta({ id: 'a2', produto_id: 'p1' }),
    ]);
    renderAba();
    expect(await screen.findByRole('button', { name: 'Marcar 9 como lidos' })).toBeInTheDocument();
  });

  it('expandir o grupo mostra os movimentos anteriores', async () => {
    // `tipo` explícito: o default do helper é 'novo_concorrente', que não renderiza "de X para Y".
    vi.mocked(fetchPulseAlertas).mockResolvedValueOnce([
      alerta({ id: 'a1', produto_id: 'p1', tipo: 'preco_caiu', criado_em: '2026-09-01T11:00:00.000Z', payload: { de: 70.19, para: 67.99 } }),
      alerta({ id: 'a2', produto_id: 'p1', tipo: 'preco_caiu', criado_em: '2026-09-01T09:00:00.000Z', payload: { de: 69.8, para: 67.99 } }),
    ]);
    renderAba();
    await userEvent.click(await screen.findByText(/2 movimentos/));
    expect(screen.getByText(/de R\$\s*69,80 para R\$\s*67,99/)).toBeInTheDocument();
  });
});
```

<!-- rev-fable: (1) o helper `alerta()` do arquivo tem `tipo: 'novo_concorrente'` por default — sem `tipo:
'preco_caiu'` o teste do "expandir" nunca acharia "de R$ 69,80 para R$ 67,99"; e com `criado_em` igual nos dois
o "mais recente" dependeria da estabilidade do sort. (2) O arquivo usa `marcarAlertaLido` em 4 pontos (linhas 7,
17, 57 e 168) — depois desta task a função some do componente e esses testes passam a esperar chamada que
nunca acontece. -->
No `vi.mock('@/lib/pulse', …)` do topo do arquivo: acrescentar `marcarAlertasLidosPorIds: vi.fn(async () => undefined)` e **remover** `marcarAlertaLido` (o componente deixa de importá-lo). Migrar as quatro referências existentes a `marcarAlertaLido` (linhas 7, 17, 57 e 168) para `marcarAlertasLidosPorIds` — a asserção do ✓ de linha única passa a ser `toHaveBeenCalledWith(['alerta-1'])`, e o `afterEach` reseta `vi.mocked(marcarAlertasLidosPorIds).mockResolvedValue(undefined)`.

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/lib/__tests__/pulse-alertas-grupo.test.ts src/components/pulse/__tests__/aba-alertas.test.tsx` · Expected: FAIL com `Failed to resolve import "../pulse-alertas-grupo"`.

- [ ] **Step 3: Write minimal implementation**

Criar `src/lib/pulse-alertas-grupo.ts`:

```ts
// Pulse (ADR-0133 Errata 3): a fila de trabalho do operador é de PRODUTOS, não de eventos — na org
// de validação, 9 alertas de Ação eram 4 produtos. Pura, sem I/O: o agrupamento é de exibição e não
// apaga nenhuma linha de `pulse_alertas`.
import type { PulseAlerta } from './pulse';

export interface GrupoAlertas {
  /** Chave de render. Produto quando há um; o id do alerta quando não há (grupo de um). */
  chave: string;
  produtoId: string | null;
  /** O que a linha exibe. */
  maisRecente: PulseAlerta;
  /** Todos os ids do grupo, do mais novo para o mais antigo — é o escopo do ✓ do grupo (D-3). */
  ids: string[];
  total: number;
  /** Os demais, para o expandir. Já sem o `maisRecente`. */
  demais: PulseAlerta[];
}

export function agruparAlertasPorProduto(alertas: PulseAlerta[]): GrupoAlertas[] {
  const porChave = new Map<string, PulseAlerta[]>();
  for (const a of alertas) {
    // Ficha removida: grupo de um. Juntar "sem produto" num balde só misturaria produtos
    // diferentes numa linha, que é exatamente o defeito que esta função existe para corrigir.
    const chave = a.produto_id ?? `alerta:${a.id}`;
    const lista = porChave.get(chave) ?? [];
    lista.push(a);
    porChave.set(chave, lista);
  }
  // A ordem dos grupos é a de chegada (a lista já vem por `criado_em desc`): reordenar aqui faria
  // a fila saltar sob o cursor a cada refetch.
  return [...porChave.entries()].map(([chave, lista]) => {
    const ordenados = [...lista].sort((a, b) => b.criado_em.localeCompare(a.criado_em));
    const [maisRecente, ...demais] = ordenados;
    return {
      chave,
      produtoId: maisRecente.produto_id,
      maisRecente,
      ids: ordenados.map((a) => a.id),
      total: ordenados.length,
      demais,
    };
  });
}
```

Acrescentar em `src/lib/pulse.ts`, ao lado de `marcarAlertaLido`:

```ts
/** Marca como lidos os alertas de um grupo. Escopo é o conjunto de ids RENDERIZADOS naquela linha —
 *  nada além (ADR-0133 Errata 3 D-3). Grant é column-level em `lido`. */
export async function marcarAlertasLidosPorIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('pulse_alertas').update({ lido: true }).in('id', ids);
  if (error) throw error;
}
```

Em `src/components/pulse/aba-alertas.tsx`:

```tsx
import { agruparAlertasPorProduto } from '@/lib/pulse-alertas-grupo';
import { idadeAlerta, textoAlerta } from '@/lib/pulse-alerta-texto';
import {
  ALERTAS_POR_PAGINA, contarPulseAlertas, fetchPulseAlertas, marcarAlertasLidos, marcarAlertasLidosPorIds,
  type FiltroSeveridade, type PulseAlerta,
} from '@/lib/pulse';
```

<!-- rev-fable: `marcarAlertaLido` sai do import (linha 16) — depois da troca da mutation ele fica sem uso e
`pnpm lint` reprova por import não usado. -->
(`marcarAlertaLido` **sai** do import — ficaria sem uso.)

Trocar a mutation `marcarLido` para receber os ids do grupo:

```tsx
  const marcarLido = useMutation({
    mutationFn: marcarAlertasLidosPorIds,
    // Update otimista: a linha inteira sai na hora, e ela representa N alertas.
    onMutate: async (ids: string[]) => {
      await qc.cancelQueries({ queryKey: chaveLista });
      const anterior = qc.getQueryData<PaginasAlertas>(chaveLista);
      const fora = new Set(ids);
      qc.setQueryData<PaginasAlertas>(chaveLista, (atual) => (
        atual && { ...atual, pages: atual.pages.map((p) => p.filter((a) => !fora.has(a.id))) }
      ));
      return { anterior };
    },
    onError: (e: Error, _ids, ctx) => {
      if (ctx?.anterior) qc.setQueryData(chaveLista, ctx.anterior);
      toast.error(e.message);
    },
    onSettled: invalidar,
  });
```

Acrescentar, depois do `useMemo` de `lista`:

```tsx
  const grupos = useMemo(() => agruparAlertasPorProduto(lista), [lista]);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const alternarGrupo = (chave: string) => setExpandidos((s) => {
    const novo = new Set(s);
    if (!novo.delete(chave)) novo.add(chave);
    return novo;
  });
```

E substituir o `lista.map(...)` do render (linhas 228-287) por:

```tsx
          {grupos.map((g) => {
            const texto = textoAlerta(g.maisRecente);
            const idade = idadeAlerta(g.maisRecente.criado_em);
            const aberto = expandidos.has(g.chave);
            return (
              <div key={g.chave} className="border-b px-4 py-2 text-sm last:border-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {severidade === 'todos' && (
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                        g.maisRecente.severidade === 'acao'
                          ? 'bg-warning text-warning-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {g.maisRecente.severidade === 'acao' ? 'Ação' : 'Info'}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate" title={texto}>{texto}</span>
                  {idade && <span className="shrink-0 text-xs text-muted-foreground">{idade}</span>}
                  {/* O total é de ALERTAS. O botão do topo continua contando alertas também —
                      é ele que descreve o que o clique faz no banco (D-7 e Errata 2). */}
                  {g.total > 1 && (
                    <button
                      type="button"
                      aria-expanded={aberto}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => alternarGrupo(g.chave)}
                    >
                      · {g.total} movimentos
                    </button>
                  )}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {g.produtoId && (
                      <Button variant="outline" size="sm" aria-label={`Ver produto: ${texto}`}
                        onClick={() => onVerProduto(g.produtoId!)}>
                        Ver produto
                      </Button>
                    )}
                    {g.maisRecente.tipo === 'preco_caiu' && g.maisRecente.pulse_produtos?.codigo_pai && (
                      <Button variant="outline" size="sm" aria-label={`Reprecificar: ${texto}`}
                        onClick={() => onReprecificar(g.maisRecente)}>
                        Reprecificar
                      </Button>
                    )}
                    <Button
                      variant="ghost" size="icon" className="h-11 w-11 sm:h-7 sm:w-7"
                      aria-label={`Marcar como lido: ${texto}`}
                      onClick={() => marcarLido.mutate(g.ids)}
                      disabled={marcarLido.isPending && marcarLido.variables === g.ids}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {aberto && (
                  <ul className="mt-1 ml-1 border-l pl-3 text-xs text-muted-foreground">
                    {g.demais.map((a) => (
                      <li key={a.id} className="py-0.5">
                        {textoAlerta(a)} <span className="opacity-70">· {idadeAlerta(a.criado_em)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
```

(o `flex flex-col gap-0 rounded-lg border` do contêiner permanece.)

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/lib/__tests__/pulse-alertas-grupo.test.ts src/components/pulse/__tests__/aba-alertas.test.tsx` e `pnpm lint` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pulse-alertas-grupo.ts src/lib/__tests__/pulse-alertas-grupo.test.ts src/lib/pulse.ts src/components/pulse/aba-alertas.tsx src/components/pulse/__tests__/aba-alertas.test.tsx
git commit -m "feat(pulse): aba Alertas agrupada por produto, com idade e ✓ do grupo"
```

---

## Task 18: Cabeçalho do resultado do Sonar e "Adicionar ao Radar" (#4)

**Files:** Modify (`src/pages/PulseSonar.tsx:769-790`, `src/components/pulse/dialog-adicionar.tsx`) / Test (`src/pages/__tests__/PulseSonar.test.tsx`)

**Interfaces:**
- Consumes da Task 12: a âncora escolhível e a ausência de `DialogMargemSonar`.
- Produces: `DialogAdicionar` passa a aceitar `entradaInicial?: string` (pré-preenche o campo). Nenhuma outra task consome.

**O que resolve:** o resultado do Sonar não tem título. Por termo o texto fica no input (refutado na validação), mas por EAN o campo é limpo — e ao rolar 2.128 px até a tabela, ninguém sabe mais o que está sendo analisado. A idade do cache (7 dias) também é invisível: o operador não sabe que reabrir o mesmo termo é grátis. E o funil prospectar → vigiar → publicar não fecha: o cruzamento diz "Já está no seu Radar" quando encontra, mas não há botão para vigiar quando não está.

- [ ] **Step 1: Write the failing test**

<!-- rev-fable: `renderSonarComResposta`/`renderSonarComEan` não existiam; ambos são casos do
`renderSonarComAmostra` da Task 12 (mesmo mock de `fetchVendasSonar`). Definidos aqui, ao lado dele. -->
Helpers, ao lado do `renderSonarComAmostra` da Task 12:

```tsx
/** Página com a resposta dada (termo, gerado_em, amostra vêm do payload). */
async function renderSonarComResposta(resp: PainelVendasSonar, termoDigitado = 'tecido oxford') {
  vi.mocked(fetchVendasSonar).mockResolvedValue(resp);
  const campo = renderSonar();
  await userEvent.type(campo, `${termoDigitado}{Enter}`);
  await screen.findByRole('heading', { name: /^Nicho:/ }, { timeout: 3000 });
  return campo;
}

/** Amostra mínima que chega ao ramo de resultado: `itens: []` cai em "amostra vazia" (`PulseSonar.tsx:758`)
 *  e `respBase(null)` puro (itens_analisados 1, sem `itens`) cai em "cache antigo" — nenhum dos dois
 *  renderiza o cabeçalho. */
const comAmostra: PainelVendasSonar = {
  ...respBase(null), itens: [itemBase({ item_id: 'MLB1', preco: 10, category_id: 'MLBX' })], itens_analisados: 1,
};

/** Busca por EAN: o campo é limpo após o scan (ADR-0140), então `eanBuscado` só vive no estado. */
const renderSonarComEan = (ean: string) => renderSonarComResposta({ ...comAmostra, termo: ean }, ean);
```

Acrescentar em `src/pages/__tests__/PulseSonar.test.tsx`:

```tsx
describe('PulseSonar — cabeçalho do resultado', () => {
  it('repete o termo buscado, o tamanho da amostra e a idade do cache', async () => {
    await renderSonarComResposta({
      ...respBase(null),
      termo: '7896004700113',
      gerado_em: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      itens_analisados: 20,
      itens: comAmostra.itens,
    });
    const cabecalho = await screen.findByRole('heading', { name: /Nicho: 7896004700113/ });
    expect(cabecalho).toBeInTheDocument();
    expect(screen.getByText(/amostra de 20/)).toBeInTheDocument();
    expect(screen.getByText(/há 2 dias/)).toBeInTheDocument();
  });

  it('o resultado em cache diz que reabrir é grátis e nova busca custa', async () => {
    await renderSonarComResposta(comAmostra);
    expect(screen.getByText(/reabrir este termo não dispara coleta nova/i)).toBeInTheDocument();
  });

  it('oferece "Adicionar ao Radar" com o EAN buscado pré-preenchido', async () => {
    await renderSonarComEan('7896004700113');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar ao Radar' }));
    expect(await screen.findByDisplayValue('7896004700113')).toBeInTheDocument();
  });

  it('sem EAN buscado, o botão não aparece — não há o que vigiar por termo', async () => {
    await renderSonarComResposta({ ...comAmostra, termo: 'tecido oxford' });
    expect(screen.queryByRole('button', { name: 'Adicionar ao Radar' })).not.toBeInTheDocument();
  });
});
```

(`comAmostra` é o fixture declarado junto dos helpers acima.)

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/pages/__tests__/PulseSonar.test.tsx -t "cabeçalho do resultado"` · Expected: FAIL com `Unable to find an accessible element with the role "heading" and name /Nicho: 7896004700113/`.

- [ ] **Step 3: Write minimal implementation**

Em `src/components/pulse/dialog-adicionar.tsx`, aceitar valor inicial:

```tsx
export function DialogAdicionar({ aberto, onFechar, entradaInicial = '' }: {
  aberto: boolean;
  onFechar: () => void;
  /** Pré-preenche o campo — o Sonar já sabe o GTIN que o operador acabou de prospectar. */
  entradaInicial?: string;
}) {
  const qc = useQueryClient();
  const [entrada, setEntrada] = useState(entradaInicial);
  // Reabrir com outro GTIN precisa trocar o campo; sem isto o valor do primeiro uso gruda.
  useEffect(() => { if (aberto) setEntrada(entradaInicial); }, [aberto, entradaInicial]);
```

(acrescentar `useEffect` ao import de `react`.)

Em `src/pages/PulseSonar.tsx`, importar e declarar:

```tsx
import { DialogAdicionar } from '@/components/pulse/dialog-adicionar';
import { tempoRelativo } from '@/lib/sonar-buscas-recentes';
```

```tsx
  const [adicionarAberto, setAdicionarAberto] = useState(false);
```

E inserir, logo antes de `<VereditoSonar …>` (dentro do ramo `vendas?.configurado`):

```tsx
          {/* O resultado não tinha título: por EAN o campo é limpo, e ao rolar 2.128px até a tabela
              ninguém sabia mais o que estava sendo analisado. A idade do cache também era
              invisível — e é ela que diz se a próxima busca custa. */}
          <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b pb-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold" title={vendas.termo}>
                Nicho: {vendas.termo}
              </h2>
              <p className="text-xs text-muted-foreground">
                amostra de {vendas.itens_analisados} anúncios
                {vendas.gerado_em && ` · coletado ${tempoRelativo(vendas.gerado_em, new Date())}`}
                {' '}· reabrir este termo não dispara coleta nova (cache de 7 dias); um termo novo, sim
              </p>
            </div>
            {/* ADR-0140 D-3: só com GTIN há o que vigiar — o Radar acompanha ficha de catálogo. */}
            {eanBuscado && (
              <Button variant="outline" size="sm" onClick={() => setAdicionarAberto(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Adicionar ao Radar
              </Button>
            )}
          </div>
```

E, ao final do componente (onde estava o `DialogMargemSonar` removido na Task 12):

```tsx
      <DialogAdicionar
        aberto={adicionarAberto}
        entradaInicial={eanBuscado ?? ''}
        onFechar={() => setAdicionarAberto(false)}
      />
```

Acrescentar `Plus` ao import de `lucide-react`.

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/pages/__tests__/PulseSonar.test.tsx` e `pnpm lint` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PulseSonar.tsx src/components/pulse/dialog-adicionar.tsx src/pages/__tests__/PulseSonar.test.tsx
git commit -m "feat(pulse): cabeçalho do resultado do Sonar e 'Adicionar ao Radar'"
```

---

## Task 19: Blocos do Sonar com cabeçalho padrão e colapsáveis (#6, achado 4)

**Files:** Create (`src/components/pulse/secao-sonar.tsx`, `src/components/pulse/__tests__/secao-sonar.test.tsx`), Modify (`src/components/pulse/sonar-analise-publiai.tsx:26-40, 116-120`, `src/components/pulse/sonar-dre.tsx:228-250`, `src/components/pulse/veredito-sonar.tsx` — pódio) / Test (`src/pages/__tests__/PulseSonar.test.tsx`)

**Interfaces:**
- Consumes da Task 12: `sonar-dre.tsx` já sem o "6." e com `id="sonar-dre"`.
- Produces:

```tsx
export function SecaoSonar(props: {
  id?: string;
  titulo: string;
  subtitulo?: React.ReactNode;
  /** Badge à direita do título (ex.: "estimativa", "demanda por vendedor"). */
  selo?: React.ReactNode;
  /** `false` = abre fechada. Sem a prop, a seção não colapsa (é sempre aberta). */
  colapsavelAbertaPorPadrao?: boolean;
  acoes?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element
```

**O que resolve:** a tabela do Sonar começa a **2.128 px** do topo em 1440 (2,4 telas), e a DRE — o argumento de venda mais forte — a 1.685 px; quatro cards com quatro cabeçalhos ligeiramente diferentes (badge num, subtítulo `text-xs` noutro, "6." no terceiro). Em 820 px o pódio do veredito trunca títulos em ~25 caracteres (achado 4), e com nome de produto do ML isso vira lista de reticências.

**O que NÃO muda:** a ordem dos blocos (veredito primeiro — a conclusão antes da evidência) e o "Saiba mais" do veredito, que já tem `aria-expanded` próprio.

- [ ] **Step 1: Write the failing test**

Criar `src/components/pulse/__tests__/secao-sonar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SecaoSonar } from '../secao-sonar';

describe('SecaoSonar', () => {
  it('sem a prop de colapso, o conteúdo está sempre visível e não há botão', () => {
    render(<SecaoSonar titulo="Vendas do nicho"><p>conteúdo</p></SecaoSonar>);
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Vendas do nicho/ })).not.toBeInTheDocument();
  });

  it('colapsável fechada por padrão esconde o conteúdo e anuncia o estado', async () => {
    render(
      <SecaoSonar titulo="Dá lucro?" colapsavelAbertaPorPadrao={false}><p>conteúdo</p></SecaoSonar>,
    );
    const botao = screen.getByRole('button', { name: /Dá lucro\?/ });
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
    await userEvent.click(botao);
    expect(botao).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });

  it('o título é um heading — o leitor de tela navega por eles', () => {
    render(<SecaoSonar titulo="Quem vende neste nicho"><p>x</p></SecaoSonar>);
    expect(screen.getByRole('heading', { name: 'Quem vende neste nicho' })).toBeInTheDocument();
  });
});
```

Acrescentar em `src/pages/__tests__/PulseSonar.test.tsx`:

```tsx
describe('PulseSonar — os blocos de contexto abrem fechados', () => {
  it('a DRE e a Análise PubliAI começam colapsadas; o veredito e as vendas, não', async () => {
    await renderSonarComAmostra([itemBase({ titulo: 'Oxford', item_id: 'MLB1', preco: 100, category_id: 'MLB1' })]);
    expect(screen.getByRole('button', { name: /Dá lucro\?/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Quem vende neste nicho/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Vendas do nicho/ })).not.toBeInTheDocument();
  });

  it('clicar em "Simular" numa linha abre a DRE, além de trocar a âncora', async () => {
    await renderSonarComAmostra([itemBase({ titulo: 'Oxford', item_id: 'MLB1', preco: 100, category_id: 'MLB1' })]);
    await userEvent.click(screen.getByRole('button', { name: /Simular/ }));
    expect(screen.getByRole('button', { name: /Dá lucro\?/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('a numeração órfã "6." não existe mais', async () => {
    const { container } = await renderSonarComAmostra([itemBase({ titulo: 'Oxford', item_id: 'MLB1', preco: 100, category_id: 'MLB1' })]);
    expect(container.textContent).not.toMatch(/\b6\.\s*Dá lucro/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/components/pulse/__tests__/secao-sonar.test.tsx src/pages/__tests__/PulseSonar.test.tsx` · Expected: FAIL com `Failed to resolve import "../secao-sonar"`.

- [ ] **Step 3: Write minimal implementation**

Criar `src/components/pulse/secao-sonar.tsx`:

```tsx
// Cabeçalho padrão dos blocos do Sonar. Antes eram quatro Cards com quatro cabeçalhos ligeiramente
// diferentes (badge num, subtítulo text-xs noutro, "6." no terceiro), e nenhum colapsado — a tabela
// começava a 2.128px do topo em 1440 (medido).
import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

<!-- rev-fable: a versão original guardava o estado só por dentro e pedia `key={aberta ? …}` para a DRE reabrir
pelo "Simular". Isso (a) deixava `onAlternar` sem uso em `SonarDre` → lint reprova; (b) não reabre quando o
operador fechou a DRE à mão e clica "Simular" de novo (`dreAberta` já era true, a key não muda). Controlada
opcional custa 3 linhas e resolve os dois. -->
export function SecaoSonar({
  id, titulo, subtitulo, selo, colapsavelAbertaPorPadrao, aberta: abertaControlada, onAlternar, acoes, children,
}: {
  id?: string;
  titulo: string;
  subtitulo?: ReactNode;
  selo?: ReactNode;
  /** Ausente = não colapsa (a seção é sempre aberta). Presente = colapsa, com este estado inicial. */
  colapsavelAbertaPorPadrao?: boolean;
  /** Modo controlado (a DRE precisa ser ABERTA pelo "Simular" da tabela): quem passa `aberta` também
   *  passa `onAlternar`, e `colapsavelAbertaPorPadrao` vira só o "é colapsável". */
  aberta?: boolean;
  onAlternar?: (aberta: boolean) => void;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  const colapsavel = colapsavelAbertaPorPadrao !== undefined;
  const [abertaInterna, setAbertaInterna] = useState(colapsavelAbertaPorPadrao ?? true);
  const aberta = abertaControlada ?? abertaInterna;
  const setAberta = (v: boolean) => { setAbertaInterna(v); onAlternar?.(v); };
  const mostrar = !colapsavel || aberta;

  const cabecalho = (
    <div className="min-w-0 text-left">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {titulo}
        {selo}
      </h3>
      {subtitulo && <p className="text-xs text-muted-foreground">{subtitulo}</p>}
    </div>
  );

  return (
    <Card id={id} className="mb-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {colapsavel ? (
          <button
            type="button"
            aria-expanded={aberta}
            onClick={() => setAberta(!aberta)}
            className="flex min-w-0 items-start gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', !aberta && '-rotate-90')}
              aria-hidden
            />
            {cabecalho}
          </button>
        ) : cabecalho}
        {acoes}
      </div>
      {/* Desmontado, não escondido (`hidden`): o conteúdo fechado não deve entrar na árvore de
          acessibilidade nem no `getByText` dos testes. (As cotações da DRE vivem em `SonarDre`, que
          fica montada — e só disparam com os quatro campos do pacote preenchidos.) */}
      {mostrar && <div className="mt-3">{children}</div>}
    </Card>
  );
}
```

Em `src/components/pulse/sonar-dre.tsx`, trocar o `<Card id="sonar-dre" …>` e o cabeçalho manual (linhas ~228-250) por `SecaoSonar`, controlada de fora:

```tsx
export function SonarDre({ ancora, precos, aberta, onAlternar }: {
  ancora: AncoraDre | null;
  precos?: PrecosDoNicho;
  /** Controlada pela página: clicar em "Simular" numa linha da tabela precisa ABRIR a seção. */
  aberta: boolean;
  onAlternar: (aberta: boolean) => void;
}) {
```

e o retorno:

```tsx
    <SecaoSonar
      id="sonar-dre"
      titulo="Dá lucro?"
      subtitulo={(
        <>
          Cinco preços de venda deste nicho, cada um cotado no Mercado Livre ·{' '}
          <span data-testid="dre-ancora" className="font-medium text-foreground">{ancora.nome}</span>
        </>
      )}
      colapsavelAbertaPorPadrao={false}
      aberta={aberta}
      onAlternar={onAlternar}
      acoes={/* … o seletor Clássico/Premium atual (linhas 238-249 de hoje), sem mudanças … */}
    >
      {/* … todo o corpo atual da DRE (linhas 252 em diante), sem mudanças … */}
    </SecaoSonar>
```

> Os dois early-returns da DRE (`ancora == null` e `categoria == null`, linhas 185-200 de hoje) continuam
> como `Card` simples, fora da `SecaoSonar` — não há o que colapsar sem receita.

Em `src/components/pulse/sonar-analise-publiai.tsx`, trocar o `Cabecalho()` e o `<Card className="mb-4 p-4">` (linhas 26-40, 101, 116) por:

```tsx
    <SecaoSonar
      titulo="Quem vende neste nicho"
      selo={<Badge variant="outline">demanda por vendedor</Badge>}
      subtitulo="Porte e tendência dos concorrentes, pela loja inteira deles (ADR-0142/0146)."
      colapsavelAbertaPorPadrao={false}
    >
```

Em `src/pages/PulseSonar.tsx`, envolver `SonarVendas` (que continua **sempre aberta** — é o contexto que sustenta o veredito logo acima) e controlar a DRE:

```tsx
  const [dreAberta, setDreAberta] = useState(false);
  useEffect(() => setDreAberta(false), [termoBuscado]);
```

no botão "Simular" da coluna `acao`, acrescentar `setDreAberta(true);` antes do `scrollIntoView`; e no render:

```tsx
          <SonarDre
            ancora={ancoraDre}
            precos={precosDoNicho}
            aberta={dreAberta}
            onAlternar={setDreAberta}
          />
```

<!-- rev-fable: o snippet citava `item.titulo`, que não existe — em `PodioColuna` a variável é `i.nome`, e há
DOIS `truncate` (linha 122, dentro do `<a>`; linha 126, o `<span>` sem link). -->
Em `src/components/pulse/veredito-sonar.tsx`, em `PodioColuna`, trocar os dois `truncate` do nome (linhas 122 e 126) por `line-clamp-2` (achado 4 — em 820 px o título parava em ~25 caracteres):

```tsx
                <span className="line-clamp-2">{i.nome}</span>
```
```tsx
              <span className="min-w-0 line-clamp-2 text-xs font-medium" title={i.nome}>{i.nome}</span>
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/components/pulse/__tests__/secao-sonar.test.tsx src/components/pulse/__tests__/sonar-dre.test.tsx src/components/pulse/__tests__/sonar-analise-publiai.test.tsx src/components/pulse/__tests__/veredito-sonar.test.tsx src/pages/__tests__/PulseSonar.test.tsx` e `pnpm lint` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/pulse/secao-sonar.tsx src/components/pulse/__tests__/secao-sonar.test.tsx src/components/pulse/sonar-dre.tsx src/components/pulse/sonar-analise-publiai.tsx src/components/pulse/veredito-sonar.tsx src/pages/PulseSonar.tsx src/pages/__tests__/PulseSonar.test.tsx
git commit -m "feat(pulse): blocos do Sonar com cabeçalho padrão e colapsáveis"
```

---

## Task 20: Detalhe do Radar — 10 colunas viram 7, e a margem mostra a conta (#9)

**Files:** Modify (`src/components/pulse/dialog-detalhe.tsx:215-405, 511-559`) / Test (`src/components/pulse/__tests__/dialog-detalhe.test.tsx`)

**Interfaces:**
- Consumes da Task 8: `insumoFaltante` importada. Da Task 11: o rótulo `s/ venda`.
- Produces: nada consumido adiante.

**O que resolve:** a tabela de concorrentes tem 10 colunas num dialog `sm:max-w-7xl`. "Reputação" e "MercadoLíder" são duas colunas para o mesmo conceito, e "Qualificação" repete os motivos em texto embaixo do badge. E a decomposição da margem (comissão/frete/imposto/custo) vive só no `title` (`:519-524`) — tooltip não funciona em touch e some em demonstração projetada; é a mesma informação que a DRE do Sonar já entrega em tabela.

**O que NÃO muda:** nenhum dado sai da tela — reputação, MercadoLíder e os motivos da qualificação passam a conviver na coluna "Vendedor". A régua de qualificação (ADR-0130) continua idêntica.

- [ ] **Step 1: Write the failing test**

Acrescentar em `src/components/pulse/__tests__/dialog-detalhe.test.tsx`:

```tsx
describe('DialogDetalhe — a tabela de concorrentes cabe na tela', () => {
  it('são 7 colunas, e Reputação/MercadoLíder não existem mais como colunas próprias', () => {
    renderDetalheComOfertas();
    const cabecalhos = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(cabecalhos).toEqual([
      'Preço', 'Vendedor', 'Estado', 'Porte do vendedor', 'Visitas 30d', 'Anúncio', 'Oferta',
    ]);
  });

  it('a reputação e o selo de MercadoLíder continuam visíveis, dentro de "Vendedor"', () => {
    renderDetalheComOfertas();
    const celula = screen.getByText('LOJA UM').closest('td')!;
    expect(within(celula).getByText(/Reputação verde/)).toBeInTheDocument();
    expect(within(celula).getByText(/MercadoLíder Platinum/)).toBeInTheDocument();
    expect(within(celula).getByText('Relevante')).toBeInTheDocument();
  });
});

// A decomposição vivia só no `title`: tooltip não funciona em touch e some em demo projetada. Foi
// uma comissão errada e silenciosa que superestimou a sobra deste produto em R$ 0,97 (Errata 6).
describe('DialogDetalhe — a conta da margem fica à vista', () => {
  it('os quatro descontos aparecem como números na tela, não só no title', () => {
    renderDetalheComMargem(); // custo 30, alíquota 8%, comissão 14%, frete 5, preço 100
    expect(screen.getByText('Comissão do ML')).toBeInTheDocument();
    expect(screen.getByText('Frete')).toBeInTheDocument();
    expect(screen.getByText('Imposto (8%)')).toBeInTheDocument();
    expect(screen.getByText('Custo do produto')).toBeInTheDocument();
    expect(screen.getByText('−R$ 14,00')).toBeInTheDocument();
    expect(screen.getByText('−R$ 5,00')).toBeInTheDocument();
    expect(screen.getByText('−R$ 8,00')).toBeInTheDocument();
    expect(screen.getByText('−R$ 30,00')).toBeInTheDocument();
  });

  it('sem insumo, não há decomposição — só o motivo', () => {
    // `codigo_pai` é obrigatório: sem ele o bloco de decisão inteiro não renderiza (dialog-detalhe.tsx:440).
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1' }); // mock do contexto: custo/alíquota null
    expect(screen.getByText(/Margem indisponível: falta custo do produto/)).toBeInTheDocument();
    expect(screen.queryByText('Comissão do ML')).not.toBeInTheDocument();
  });
});
```

<!-- rev-fable: (1) `renderDetalhe()` com o `produtoBase` (codigo_pai null) não renderiza o bloco de decisão —
o teste "sem insumo" falharia por ausência, não por acerto. (2) `renderDetalheComOfertas()` não existia e o
fixture do `beforeEach` (SOUZABRUNA… com 0 transações; OUTRO-VENDEDOR amarelo/gold) não produz "LOJA UM",
"Reputação verde", "MercadoLíder Platinum" nem "Relevante" (a régua exige ≥10 transações, visitas 30d ≠ 0 e
reputação não laranja/vermelha). -->
Helper `renderDetalheComOfertas()`, junto de `renderDetalhe`:

```tsx
/** Uma oferta RELEVANTE (ADR-0130: ≥10 transações, visitas 30d ≠ 0, reputação verde) de "LOJA UM",
 *  MercadoLíder Platinum, sem `reputacao_detalhe` (o <details> não abre; o rótulo sai em <span>). */
function renderDetalheComOfertas() {
  detalhe.ofertasAtuais = [oferta({ item_id: 'MLB-UM', seller_id: 7, preco: 70.19, visitas_30d: 120 })];
  detalhe.vendedores = [{
    ...vendedor(7, 'LOJA UM'), transactions_total: 500, nivel: '5_green', power_seller: 'platinum',
  }];
  return renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1' });
}
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/components/pulse/__tests__/dialog-detalhe.test.tsx -t "cabe na tela"` · Expected: FAIL com `expected [ 'Preço', 'Vendedor', 'Qualificação', 'Reputação', 'MercadoLíder', … ] to deeply equal [ 'Preço', 'Vendedor', 'Estado', … ]`.

- [ ] **Step 3: Write minimal implementation**

Em `src/components/pulse/dialog-detalhe.tsx`, **remover** as colunas `qualificacao`, `reputacao` e `mercado-lider` (linhas 249-286) e substituir a coluna `vendedor` (linhas 230-248) por:

```tsx
    {
      key: 'vendedor',
      // Três colunas para o mesmo sujeito viraram uma: cor da reputação, selo de MercadoLíder e o
      // veredito da régua (ADR-0130) descrevem o MESMO vendedor. Nada sai da tela — muda o
      // agrupamento, para o dialog caber sem duplo scroll.
      header: 'Vendedor',
      className: 'w-72',
      sortValue: (o) => nomeDe(o).toLowerCase(),
      cell: (o) => {
        const vendedor = vendedorAtualDe(o);
        const q = o.qualificacao;
        const tom = q.status === 'relevante' ? 'ok' as const
          : q.status === 'observacao' ? 'atencao' as const : 'risco' as const;
        const selo = reputacao(vendedor?.power_seller ?? null);
        return (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="max-w-52 truncate font-medium" title={nomeDe(o)}>{nomeDe(o)}</span>
              {o.loja_oficial && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  <Store className="mr-1 h-3 w-3" />
                  Loja oficial
                </Badge>
              )}
              <Badge
                variant="outline"
                className={cn('text-[10px] font-normal', classeTom(tom))}
                // Os motivos saem do corpo da célula para o tooltip do badge: eles explicam o
                // veredito, e o veredito é o que decide se a oferta entra na comparação.
                title={q.motivos.map(rotuloMotivoQualificacao).join(' · ')}
              >
                {rotuloStatusQualificacao(q.status)}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <DetalhesConta
                vendedor={vendedor}
                rotulo={rotuloReputacao(vendedor?.nivel ?? null)}
                nome={nomeDe(o)}
              />
              {selo && <span>· {selo}</span>}
            </div>
          </div>
        );
      },
    },
```

E substituir o bloco "Sobra para você" (linhas 511-559) por:

```tsx
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Sobra para você</span>
                      {contextoCarregando ? (
                        <span className="text-sm text-muted-foreground">calculando…</span>
                      ) : faltando ? (
                        <Badge variant="outline" className={classeTom('atencao')}>
                          Margem indisponível: falta {faltando}
                        </Badge>
                      ) : margem ? (
                        <span
                          className={cn(
                            'text-lg font-semibold tabular-nums',
                            margemRuim ? 'text-destructive' : 'text-success',
                          )}
                        >
                          {fmtBRL(margem.liquido)}
                          <span className="ml-1 text-sm font-normal opacity-80">
                            ({margem.margemPct.toFixed(1)}% s/ venda)
                          </span>
                          {margemEstimativa && (
                            <span
                              className="ml-1 text-xs font-normal text-muted-foreground"
                              title="A comissão do ML muda por faixa de preço, e a que temos foi lida em outro preço. Neste preço, o número é aproximado."
                            >
                              estimativa
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">informe um preço</span>
                      )}
                    </div>
```

e inserir, logo abaixo do bloco `{margemRuim && …}` (linha ~573), a decomposição:

```tsx
                  {/* A conta fica à vista, e não num `title`: tooltip não funciona em touch e some
                      em demo projetada. Foi uma comissão errada e silenciosa que superestimou a
                      sobra deste produto em R$ 0,97 (Errata 6 da ADR-0119). Mesmo padrão de tabela
                      que a DRE do Sonar já usa. */}
                  {margem && (
                    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t pt-3 text-xs sm:grid-cols-4">
                      {[
                        ['Comissão do ML', margem.comissao],
                        ['Frete', produto.ptw_custos?.frete ?? 0],
                        [`Imposto (${contexto?.aliquotaPct}%)`, (precoSimulado! * (contexto?.aliquotaPct ?? 0)) / 100],
                        ['Custo do produto', contexto?.custo ?? 0],
                      ].map(([rotulo, valor]) => (
                        <div key={rotulo as string}>
                          <dt className="text-muted-foreground">{rotulo}</dt>
                          <dd className="tabular-nums">−{fmtBRL(valor as number)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/components/pulse/__tests__/dialog-detalhe.test.tsx` e `pnpm lint` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/pulse/dialog-detalhe.tsx src/components/pulse/__tests__/dialog-detalhe.test.tsx
git commit -m "feat(pulse): detalhe com 7 colunas e a conta da margem à vista"
```

---

## Task 21: "· N abaixo" ao lado do menor relevante (#10)

**Files:** Modify (`src/lib/pulse.ts` — `PulseResumoOfertas` e `fetchPulseResumoOfertas`, `src/components/pulse/tabela-radar.tsx:115-128`) / Test (`src/lib/__tests__/pulse-contexto-margem.test.ts` não; usar `src/components/pulse/__tests__/tabela-radar.test.tsx`)

**Interfaces:**
- Consumes da Task 9: a assinatura estendida de `TabelaRadar`.
- Produces: `PulseResumoOfertas` ganha `abaixoDaReferencia: { contagem: number; menorPreco: number } | null`, calculado por `ofertasAbaixoDaReferencia` (já existente em `pulse-margem.ts`) dentro de `fetchPulseResumoOfertas`. A Task 22 estende o mesmo tipo.

**O que resolve:** a distinção "menor relevante × menor observado" está correta por ADR (0130 D-1/D-6) e é o que a lista compara — mas só o detalhe a expõe. Um gerente que sabe que existe alguém a R$ 36 enquanto o Radar diz "você é o menor" perde a confiança na tela. O dado já é calculado; falta chegar à lista.

**O que NÃO muda:** essas ofertas continuam **fora** da comparação de preço, do alerta e da margem. O marcador diz que elas existem; não as promove a referência.

- [ ] **Step 1: Write the failing test**

Acrescentar em `src/components/pulse/__tests__/tabela-radar.test.tsx`:

```tsx
// ADR-0130 D-1/D-6: elas não entram na comparação, mas o comprador as vê na mesma página do
// catálogo. A lista precisa dizer que estão lá — o dado já é calculado (ofertasAbaixoDaReferencia).
describe('TabelaRadar — ofertas abaixo da referência', () => {
  const comAbaixo: PulseResumoOfertas = {
    ...resumo, menorRelevante: 70.19, abaixoDaReferencia: { contagem: 2, menorPreco: 36 },
  };

  it('mostra "2 abaixo" ao lado do menor relevante, sem trocar a referência', () => {
    renderRadar([produto], comAbaixo);
    // getAllByText: desde a ADR-0147 o mesmo preço também é a faixa da coluna da disputa (ver linha 30).
    expect(screen.getAllByText(/R\$\s*70,19/).length).toBeGreaterThan(0);
    expect(screen.getByText(/2 abaixo/)).toBeInTheDocument();
    // O menor OBSERVADO nunca vira o número da coluna.
    expect(screen.queryByText(/^R\$\s*36,00$/)).not.toBeInTheDocument();
  });

  it('o tooltip diz a partir de quanto, e por que elas não contam', () => {
    renderRadar([produto], comAbaixo);
    expect(screen.getByText(/2 abaixo/).closest('[title]')?.getAttribute('title'))
      .toMatch(/R\$\s*36,00.*não entram na comparação/s);
  });

  it('sem ofertas abaixo, nada é acrescentado à célula', () => {
    renderRadar([produto], { ...resumo, abaixoDaReferencia: null });
    expect(screen.queryByText(/abaixo/)).not.toBeInTheDocument();
  });

  it('uma só oferta usa o singular', () => {
    renderRadar([produto], { ...comAbaixo, abaixoDaReferencia: { contagem: 1, menorPreco: 36 } });
    expect(screen.getByText(/1 abaixo/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/components/pulse/__tests__/tabela-radar.test.tsx -t "abaixo da referência"` · Expected: FAIL com `Unable to find an element with the text: /2 abaixo/`.

- [ ] **Step 3: Write minimal implementation**

Em `src/lib/pulse.ts`, estender a interface e o preenchimento:

```ts
export interface PulseResumoOfertas {
  // … campos atuais …
  /** Ofertas ATIVAS abaixo do menor relevante. Elas não entram na comparação (ADR-0130), mas o
   *  comprador as vê na mesma página do catálogo — a lista precisa dizer que existem. */
  abaixoDaReferencia: { contagem: number; menorPreco: number } | null;
}
```

```ts
import { estadoAtualOfertas, mercadoPulse, ofertasAbaixoDaReferencia, custoDaFamilia, type FamiliaComVariacoes } from './pulse-margem';
```

```ts
  for (const [produtoId, ofertas] of porProduto) {
    const atuais = estadoAtualOfertas(ofertas);
    const mercado = mercadoPulse(atuais, vendedores);
    const abaixo = ofertasAbaixoDaReferencia(mercado);
    resumo.set(produtoId, {
      // … campos atuais …
      abaixoDaReferencia: abaixo ? { contagem: abaixo.contagem, menorPreco: abaixo.menorPreco } : null,
    });
  }
```

Em `src/components/pulse/tabela-radar.tsx`, na coluna `menor`:

```tsx
      cell: (p) => {
        const v = menorDe(p);
        const abaixo = resumo?.get(p.id)?.abaixoDaReferencia ?? null;
        return celulaMercado(
          <span className="inline-flex items-baseline gap-1.5">
            <span className={cn('tabular-nums', v == null && 'text-muted-foreground')}>
              {v != null ? fmtBRL(v) : 'Sem concorrente relevante'}
            </span>
            {/* Não promove a referência: o número da coluna continua sendo o menor RELEVANTE. */}
            {abaixo && (
              <span
                className="cursor-help text-xs text-warning"
                title={`${abaixo.contagem === 1 ? '1 oferta ativa' : `${abaixo.contagem} ofertas ativas`} a partir de ${fmtBRL(abaixo.menorPreco)}. São vendedores sem histórico suficiente, então não entram na comparação de preço — mas aparecem na mesma página do catálogo que a sua.`}
              >
                · {abaixo.contagem} abaixo
              </span>
            )}
          </span>,
        );
      },
```

<!-- rev-fable: (1) `getByText(/R\$\s*70,19/)` lançaria "multiple elements" — o preço aparece também na faixa da
disputa (o teste da linha 30-32 do arquivo já usa getAllByText por isso). (2) `renderRadar` vivia DENTRO do
describe da disputa (linha 68) — inacessível deste describe; resolvido pelo hoist da Task 4. (3) Faltava o
fixture de `src/lib/__tests__/pulse-formato.test.ts:180`, que também constrói `PulseResumoOfertas` completo. -->
Atualizar os fixtures `PulseResumoOfertas` dos testes existentes com `abaixoDaReferencia: null` — `tabela-radar.test.tsx` (`resumo`, `disputado`), `Pulse.test.tsx` (`resumo()`) **e `src/lib/__tests__/pulse-formato.test.ts:180`** (`resumo()`); `grep -rln 'precosRelevantes' src/ tests/` lista todos, e o `tsc -b --force` aponta o que sobrar.

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/components/pulse/__tests__/tabela-radar.test.tsx src/pages/__tests__/Pulse.test.tsx`, `pnpm lint` e `pnpm tsc -b --force` · Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pulse.ts src/components/pulse/tabela-radar.tsx src/components/pulse/__tests__/tabela-radar.test.tsx src/pages/__tests__/Pulse.test.tsx
git commit -m "feat(pulse): a lista diz quantas ofertas estão abaixo da referência"
```

---

## Task 22: Sparkline do menor observado na linha do Radar (#11, esforço G)

**Files:** Modify (`src/lib/pulse.ts`, `src/components/pulse/tabela-radar.tsx`, `src/pages/Pulse.tsx`) / Test (`src/lib/__tests__/pulse-historico.test.ts` — criar, `src/components/pulse/__tests__/tabela-radar.test.tsx`)

**Interfaces:**
- Consumes das Tasks 9 e 21: a assinatura de `TabelaRadar` e `PulseResumoOfertas`.
- Produces:
  - `export async function fetchPulseHistoricoOfertas(produtoIds: string[], menorObservadoAtual?: Map<string, number | null>): Promise<Map<string, { dia: string; preco: number }[]>>` em `src/lib/pulse.ts`
  - `TabelaRadar` ganha a prop `historico: Map<string, { dia: string; preco: number }[]> | undefined`
  - o componente `Sparkline` de `src/components/ui/sparkline.tsx` (já existe, usado pelo Sonar) é reusado — **não** criar um terceiro

<!-- rev-fable: DOIS erros de semântica. (1) `menorPrecoPorDia()` (pulse-margem.ts:65) toma o mínimo entre TODAS
as ofertas ativas — é o menor OBSERVADO, e é por isso que o detalhe chama o gráfico de "Menor oferta observada
no período". A task rotulava a mesma série de "menor relevante", o que promove a oferta desqualificada a
referência — exatamente o que "O que NÃO mudar" (0130 D-1/D-6) proíbe. Série do menor RELEVANTE por dia
exigiria a qualificação de cada vendedor em cada dia (não existe agregada); fica fora deste plano. Cabeçalho,
aria-label e comentários corrigidos para "menor observado". (2) O parâmetro `atuaisPorProduto` era morto em
produção — `Pulse.tsx` passava `new Map()`. A âncora do último ponto que o detalhe faz com `atuais` já existe
na lista como `resumo.menorObservado` (mesma view): passa a ser esse o 2º parâmetro. -->
**Semântica, para não confundir com a coluna ao lado:** a série é do **menor observado** (todas as ofertas ativas — a mesma conta do gráfico "Menor oferta observada no período" do detalhe), **não** do menor relevante. A coluna diz isso no cabeçalho e no rótulo acessível. O último ponto é ancorado em `resumo.menorObservado`, como o detalhe ancora em `atuais`.

**A armadilha desta task, e como o plano a evita:** `pulse_ofertas` é histórico de **mudanças** — o coletor só grava a oferta que mudou naquele dia. Tirar o mínimo das linhas de cada dia responde "qual a mais barata que mexeu hoje", e já desenhou uma alta que não existiu (medido: Aptamil Premium 1, 2026-08-29 — mínimo real R$ 36,00 desde 20/08, gráfico marcando R$ 79,99). `menorPrecoPorDia()` já resolve isso carregando o último preço conhecido para os dias seguintes — **mas só enxerga o que está na janela lida**. Por isso a leitura é de **30 dias** e a exibição, dos **últimos 7**: os 23 dias extras são semente para o carry-forward, e `resumo.menorObservado` (a view) ancora o último ponto. Oferta que não muda há mais de 30 dias fica fora da semente — limite aceito e documentado no JSDoc.

- [ ] **Step 1: Write the failing test**

<!-- rev-fable: o teste referenciava `estado`, `diaAtras` e `oferta` sem defini-los ("reusando o mock" não é
código). Escrito por inteiro: o mock é o da Task 8 com `gte` na lista de métodos (a query nova usa `.gte('dia')`
e o mock original não o tinha — lançaria "gte is not a function"). -->
Criar `src/lib/__tests__/pulse-historico.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mesma cadeia fluente da Task 8 (pulse-contexto-margem.test.ts), com `gte` — a query desta task filtra
// por `.gte('dia', …)`. `paginas` alimenta cada `.range()`.
const estado = vi.hoisted(() => ({
  paginas: [] as unknown[][],
  chamadasRange: [] as [number, number][],
}));

vi.mock('@/lib/supabase', () => {
  const cadeia: Record<string, unknown> = {};
  const metodo = (nome: string) => (...args: unknown[]) => {
    if (nome === 'range') estado.chamadasRange.push(args as [number, number]);
    return cadeia;
  };
  for (const n of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'range']) cadeia[n] = metodo(n);
  cadeia.then = (resolve: (v: unknown) => void) => {
    const i = estado.chamadasRange.length - 1;
    return Promise.resolve({ data: estado.paginas[i] ?? [], error: null }).then(resolve);
  };
  return { supabase: { from: () => cadeia } };
});

const { fetchPulseHistoricoOfertas } = await import('@/lib/pulse');

const diaAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const linha = (item_id: string, preco: number, dia: string) =>
  ({ produto_id: 'p1', item_id, seller_id: 1, preco, ativo: true, dia });

beforeEach(() => { estado.paginas = []; estado.chamadasRange = []; });

describe('fetchPulseHistoricoOfertas', () => {
  it('lê 30 dias para semear o carry-forward e devolve os 7 últimos pontos', async () => {
    // Oferta que mudou uma vez há 20 dias e nunca mais: precisa continuar sendo o menor de hoje.
    estado.paginas = [[linha('MLB1', 36, diaAtras(20)), linha('MLB2', 79.99, diaAtras(2))], []];
    const h = await fetchPulseHistoricoOfertas(['p1'], new Map([['p1', 36]]));
    // O ponto de 2 dias atrás é 36 (carry-forward do de 20 dias), NUNCA 79,99.
    expect(h.get('p1')!.at(-1)!.preco).toBe(36);
    expect(h.get('p1')!.length).toBeLessThanOrEqual(7);
  });

  it('o último ponto é ancorado no menor observado atual, como o detalhe faz com `atuais`', async () => {
    estado.paginas = [[linha('MLB1', 40, diaAtras(5)), linha('MLB1', 38, diaAtras(1))], []];
    const h = await fetchPulseHistoricoOfertas(['p1'], new Map([['p1', 35]]));
    expect(h.get('p1')!.at(-1)!.preco).toBe(35);
  });

  it('produto com menos de 2 dias de coleta não devolve série — não se desenha reta falsa', async () => {
    estado.paginas = [[linha('MLB1', 50, diaAtras(0))], []];
    const h = await fetchPulseHistoricoOfertas(['p1']);
    expect(h.get('p1')).toBeUndefined();
  });

  it('pagina até esvaziar', async () => {
    const cheia = Array.from({ length: 1000 }, (_, i) => linha(`MLB${i}`, 10 + i, diaAtras(3)));
    estado.paginas = [cheia, [linha('X', 1, diaAtras(1))], []];
    await fetchPulseHistoricoOfertas(['p1']);
    expect(estado.chamadasRange.length).toBeGreaterThan(1);
  });

  it('lista vazia não vai ao banco', async () => {
    expect((await fetchPulseHistoricoOfertas([])).size).toBe(0);
    expect(estado.chamadasRange).toHaveLength(0);
  });
});
```

E em `src/components/pulse/__tests__/tabela-radar.test.tsx`:

```tsx
/** Sobre o `renderRadar` hoisted (Task 4). `undefined` = histórico ainda carregando. */
const renderRadarComHistorico = (historico: Map<string, { dia: string; preco: number }[]> | undefined) =>
  renderRadar([produto], resumo, { historico });

describe('TabelaRadar — tendência do menor observado', () => {
  it('desenha o sparkline quando há série, com rótulo acessível', () => {
    renderRadarComHistorico(new Map([['produto-1', [
      { dia: '2026-08-26', preco: 80 }, { dia: '2026-08-28', preco: 75 }, { dia: '2026-09-01', preco: 70.19 },
    ]]]));
    expect(screen.getByRole('img', { name: /menor oferta observada/i })).toBeInTheDocument();
  });

  it('sem série, a célula fica vazia — reta falsa mentiria sobre estabilidade', () => {
    renderRadarComHistorico(new Map());
    expect(screen.queryByRole('img', { name: /menor oferta observada/i })).not.toBeInTheDocument();
  });

  it('enquanto o histórico carrega, mostra skeleton em vez de nada', () => {
    const { container } = renderRadarComHistorico(undefined);
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run src/lib/__tests__/pulse-historico.test.ts src/components/pulse/__tests__/tabela-radar.test.tsx -t "tendência"` · Expected: FAIL com `fetchPulseHistoricoOfertas is not a function`.

- [ ] **Step 3: Write minimal implementation**

Em `src/lib/pulse.ts`:

```ts
import { menorPrecoPorDia } from './pulse-margem';

/** Dias lidos e dias exibidos. Ler 30 e mostrar 7 não é desperdício: `pulse_ofertas` é histórico de
 *  MUDANÇAS, e `menorPrecoPorDia` só carrega para a frente o que está na janela. Uma oferta que
 *  mudou há 20 dias e nunca mais é o menor preço de hoje — cortar em 7 a apagaria, e o gráfico
 *  desenharia uma alta que não aconteceu (medido em 2026-08-29). */
const DIAS_HISTORICO_LIDOS = 30;
const DIAS_HISTORICO_EXIBIDOS = 7;

/** Série do menor OBSERVADO por produto (todas as ofertas ativas — a mesma conta do gráfico do
 *  detalhe), para o sparkline da lista. Não é o menor relevante: a qualificação por dia não existe
 *  agregada, e chamar isto de "relevante" promoveria oferta desqualificada a referência (ADR-0130).
 *  Série com menos de 2 pontos não é devolvida: reta de um ponto afirma estabilidade não medida. */
export async function fetchPulseHistoricoOfertas(
  produtoIds: string[],
  /** `resumo.menorObservado` por produto — ancora o último ponto na view, como o detalhe faz com
   *  `atuais` (a janela lida é de 30 dias; a view é a verdade do presente). */
  menorObservadoAtual: Map<string, number | null> = new Map(),
): Promise<Map<string, { dia: string; preco: number }[]>> {
  const series = new Map<string, { dia: string; preco: number }[]>();
  if (produtoIds.length === 0) return series;

  const desde = new Date(Date.now() - DIAS_HISTORICO_LIDOS * 86_400_000).toISOString().slice(0, 10);
  const PAGINA = 1000;
  const porProduto = new Map<string, PulseOferta[]>();
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase.from('pulse_ofertas')
      .select('produto_id, item_id, seller_id, preco, ativo, dia')
      .in('produto_id', produtoIds)
      .gte('dia', desde)
      .order('produto_id', { ascending: true })
      .order('dia', { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw error;
    const pagina = (data ?? []) as (PulseOferta & { produto_id: string })[];
    for (const linha of pagina) {
      const lista = porProduto.get(linha.produto_id) ?? [];
      lista.push(linha);
      porProduto.set(linha.produto_id, lista);
    }
    if (pagina.length < PAGINA) break;
  }

  for (const [produtoId, ofertas] of porProduto) {
    const serie = menorPrecoPorDia(ofertas).slice(-DIAS_HISTORICO_EXIBIDOS);
    const atual = menorObservadoAtual.get(produtoId);
    if (atual != null && serie.length) serie[serie.length - 1] = { ...serie[serie.length - 1], preco: atual };
    if (serie.length >= 2) series.set(produtoId, serie);
  }
  return series;
}
```

Em `src/pages/Pulse.tsx`, uma query própria — **desligada até o resumo chegar**, para o histórico não atrasar o primeiro render (e porque a âncora vem dele):

```tsx
  // Consulta separada e de baixa prioridade: a série é enfeite decisório, não bloqueia a lista.
  const { data: historicoOfertas } = useQuery({
    queryKey: ['pulse', 'historico-ofertas', ids],
    queryFn: () => fetchPulseHistoricoOfertas(
      ids, new Map([...resumoOfertas!].map(([id, r]) => [id, r.menorObservado])),
    ),
    enabled: ids.length > 0 && !!resumoOfertas,
    staleTime: 5 * 60_000,
  });
```

e passar `historico={historicoOfertas}` para a `TabelaRadar`.

Em `src/components/pulse/tabela-radar.tsx`, acrescentar a prop e a coluna, logo depois de `menor`:

```tsx
import { Sparkline } from '@/components/ui/sparkline';
```

```tsx
    {
      key: 'tendencia',
      // "O piso da ficha caiu 8% em 7 dias" é a leitura que decide antes de abrir o detalhe. O
      // sparkline existia só lá dentro. É o menor OBSERVADO (todas as ofertas ativas), como no
      // detalhe — não o relevante; o cabeçalho diz isso para a coluna ao lado não ser lida como fonte.
      header: <span title="Menor oferta observada na ficha, por dia — inclui ofertas fora da régua de relevância">7 dias (observado)</span>,
      className: 'hidden w-28 xl:table-cell',
      cell: (p) => {
        if (historico === undefined) return <Skeleton className="h-4 w-16" />;
        const serie = historico.get(p.id);
        // Série de um ponto só não vira reta: reta afirma estabilidade que não foi medida.
        if (!serie) return null;
        const precos = serie.map((s) => s.preco);
        // `Sparkline` (src/components/ui/sparkline.tsx) recebe `{ data: string; total: number }[]`
        // e NÃO aceita `aria-label` — daí o wrapper com `role="img"`. É o mesmo componente que a
        // coluna de visitas do Sonar usa; um segundo sparkline no app seria a terceira versão.
        return (
          <span
            role="img"
            aria-label={`Menor oferta observada variou de ${fmtBRL(Math.min(...precos))} a ${fmtBRL(Math.max(...precos))} nos últimos ${serie.length} dias com coleta`}
          >
            <Sparkline dados={serie.map((s) => ({ data: s.dia, total: s.preco }))} />
          </span>
        );
      },
    },
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm vitest run src/lib/__tests__/pulse-historico.test.ts src/components/pulse/__tests__/tabela-radar.test.tsx src/pages/__tests__/Pulse.test.tsx`, `pnpm lint` e `pnpm tsc -b --force` · Expected: PASS, sem erros.

**Medição obrigatória antes de fechar a task** (o custo é o risco desta fatia): com o dev server rodando e a conta VALIDATION, abrir o DevTools → Network e anotar o **tamanho e o tempo** da requisição `pulse_ofertas`. Se passar de ~2 MB ou ~3 s na org do Diego, **não force**: registre o número no relatório e proponha a Task de follow-up (agregado materializado por produto/dia), em vez de deixar a lista pesada em produção. Número é restrição, não decisão — o trade-off volta para o Diego.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pulse.ts src/lib/__tests__/pulse-historico.test.ts src/components/pulse/tabela-radar.tsx src/components/pulse/__tests__/tabela-radar.test.tsx src/pages/Pulse.tsx
git commit -m "feat(pulse): sparkline de 7 dias do menor relevante na linha do Radar"
```

---

## Task 23: Validação visual e pré-push completo

**Files:** nenhum de produção. Saída: screenshots + relatório.

**Interfaces:**
- Consumes: todas as tasks anteriores.
- Produces: o veredito de entrega.

**Restrições inegociáveis desta task:** proibido clicar em **Atualizar agora**, **Reprecificar → Salvar** e **Marcar lido**; proibido disparar **busca nova no Sonar** (cada run custa US$ 0,10 — reabrir um termo já em cache é grátis). Sessão isolada com Playwright próprio, **nunca** o Chrome do Diego via CDP.

- [ ] **Step 1: Write the failing test** — invocar a skill antes de qualquer comando:

```
Skill: playwright-cli
```

Preparar o ambiente:

```bash
cd "/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/feat+pulse-melhorias"
cp "/Users/diego/Desktop/IA/Anuncios MktPlace/.env.local" .env.local   # gitignored, não vem na worktree
grep -m1 '^VALIDATION_EMAIL=.\+' .env.local
grep -m1 '^VALIDATION_PASSWORD=.\+' .env.local
```

Alvo: `pnpm dev` local (preferido — valida o código desta branch) ou
`https://ean2marketplace-frontend.onrender.com/#/pulse` (só se o dev local não subir; nesse caso a
branch **não** está publicada e só os bugs pré-existentes seriam observáveis — registre isso).

- [ ] **Step 2: Run test to verify it fails** — capturar a matriz, comparando cada uma com a referência de mesmo nome em `/Users/diego/.claude/jobs/5e9166a3/tmp/shots/`:

| Tela | Larguras | O que precisa ter mudado |
|---|---|---|
| Radar | 1440×900 e 820 | coluna **Sobra hoje** com `—`/valor; **Disputa do catálogo** em badge de 1 linha; **·N abaixo** no menor relevante; sparkline de 7 dias; KPI "menor preço" **não verde** em 0; ícone de vínculo **não é sino**; em 820, **⋮ e Reprecificar alcançáveis** e a tabela **rola** |
| Detalhe | 820 (o caso que falhava) e 1440 | **7 cabeçalhos**, não 10; decomposição da margem em 4 números visíveis; **sem corte horizontal** em 820 — "Sua posição" e "Reprecificar" visíveis |
| Alertas | 1440 e 820 | uma linha **por produto** com `· N movimentos`; idade (`há Nh`) e `(-N%)` no texto |
| Sonar | 1440 e 820 | cabeçalho **"Nicho: …"** com amostra e idade do cache; "Adicionar ao Radar" (só em EAN); **"Dá lucro?"** sem o "6." e colapsado; "Quem vende neste nicho" colapsado; **badges FULL/FLEX visíveis** na coluna Envio; em 820, a tabela **rola** e nenhuma coluna fica sob a fixa |

Para o Sonar sem gastar run: reabrir um termo já em cache (as buscas recentes do `localStorage` da
conta VALIDATION) ou injetar as respostas com `playwright-cli route` nos quatro endpoints
(`pulse-sonar-vendas`, `pulse-sonar-visitas`, `pulse-analise-secoes237`, `calcular-tarifa-ml`) e
`reload` — sem o reload o react-query serve o cache e a rota injetada não é exercida.

Cada achado que **não** bater vira correção na task correspondente, não uma nota de rodapé.

- [ ] **Step 3: Write minimal implementation** — rodar o pré-push inteiro, na ordem que o CI usa:

```bash
cd "/Users/diego/Desktop/IA/Anuncios MktPlace/.claude/worktrees/feat+pulse-melhorias"
pnpm lint
pnpm test
pnpm tsc -b --force
pnpm docs:links
```

`tsc -b --force` é obrigatório: o build local é incremental e passa com `tsbuildinfo` velho enquanto
o CI reprova. `pnpm docs:links` já custou um ciclo de CI por link relativo quebrado.

- [ ] **Step 4: Run test to verify it passes** · Expected: os quatro comandos sem erro, e a matriz de screenshots com todas as linhas conferindo. Registrar no relatório final:
  1. as 8+ capturas novas, com a comparação 1:1 contra a referência;
  2. a medição de rede da Task 22 (tamanho e tempo de `pulse_ofertas`);
  3. o veredito da Task 13 e se a Task 14 foi executada ou pulada;
  4. a lista de ADRs criados/alterados: **0150** (novo), **0119 Errata 12**, **0133 Errata 3**.

- [ ] **Step 5: Commit** — só se algum ajuste de última hora for necessário:

```bash
git add -A
git commit -m "chore(pulse): ajustes da validação visual"
```

---

## Autorrevisão do plano

### (a) Cobertura — cada item e cada achado aponta para ≥1 task

| Item da spec | Task(s) |
|---|---|
| #1 "Sobra hoje" + Reprecificar na linha + custo/alíquota em lote | 7 (ADR), 8 (dados), 9 (tela) |
| #2 Unificar simuladores + rótulo único de margem | 10 (ADR-0150), 11 (rótulo no Radar), 12 (simulador único) |
| #3 Coluna sticky do Sonar + overflow do dialog em 820 | 1, 2 |
| #4 Cabeçalho do resultado do Sonar + Adicionar ao Radar | 18 |
| #5 Alertas: idade, Δ%, agrupamento | 13 (investigação), 14 (condicional), 15 (ADR), 16 (texto), 17 (tela) |
| #6 Colapsar blocos, remover o "6.", padronizar cabeçalhos | 19 (o "6." sai na 12, junto com a âncora) |
| #7 "Disputa do catálogo" em badge | 4 |
| #8 "i" nos 4 KPIs do Sonar | 5 |
| #9 Detalhe 10→7 colunas + decomposição visível | 20 |
| #10 "· N abaixo (não relevantes)" | 21 |
| #11 Sparkline na linha do Radar | 22 (série do menor **observado**, como no detalhe — ver nota da task; a spec diz "menor relevante", e isso não é obtenível por dia) |
| #12 How-to + ícone `Bell` + KPI neutro em 0 | 3 (visual), 6 (docs) |

| Achado novo da validação | Task(s) |
|---|---|
| 1. Coluna fixa do Sonar cobre "Envio" (1440) e 5 colunas (820), sem rolagem | 1 |
| 2. Alertas repetidos para o mesmo produto (9 = 4 produtos) | 13, 14, 15, 17 |
| 3. Radar em 820: o ⋮ sai da tela | 1 (a coluna de ações vira `stickyRight`) |
| 4. Sonar em 820: pódio trunca títulos a ~25 caracteres | 19 (`line-clamp-2` + `title`) |
| 5. Veredito ocupa a 1ª tela; DRE a 1.685 px; tabela a 2.128 px | 19 |
| 6. Detalhe em 820: "Reprecificar" e "Sua posição" cortados | 2 |

**Lacunas encontradas na revisão e corrigidas neste plano:**

1. O achado 3 (⋮ fora da tela em 820) não tinha task própria na priorização da spec — ele tem a
   **mesma causa** do achado 1, e por isso a Task 1 corrige os dois no componente compartilhado em
   vez de remendar cada tabela.
2. A spec pede "Sobra hoje" com `—` "sem custo" e "sem alíquota". São **quatro** insumos, não dois
   (comissão e frete também faltam com frequência): a Task 9 testa os quatro, e a regra vive numa
   função só (`insumoFaltante`, Task 8) — senão a lista e o detalhe podem discordar sobre o mesmo
   produto.
3. A spec pede a coluna vermelha em `≤ 0`; o detalhe usa `< 0`. Adotei **`< 0`** nos dois (registrado
   na ADR-0119 Errata 12 D-1): dois limiares de "prejuízo" no mesmo módulo é o defeito que este
   projeto audita. Está na lista de decisões para o Diego confirmar.
4. O item #2 é apresentado como refactor, mas **aposentar um simulador que funciona é decisão de
   produto** — por isso ADR-0150 antes do código, com a consequência aceita escrita por extenso
   (simular passa a exigir 6 campos em vez de 3).
5. `docs/decisions/README.md` **não** é índice de ADRs (aponta para `docs/README.md`, cuja tabela
   parou em 0073). O índice vivo é o do Obsidian, e é só nele que a ADR-0150 entra.
6. A Task 4 quebra duas asserções existentes em `tabela-radar.test.tsx`; elas são atualizadas no
   mesmo commit, explicitamente.
7. A Task 22 tem uma armadilha real (`pulse_ofertas` é histórico de mudanças) que já produziu um
   gráfico mentiroso em produção. O plano lê 30 dias para semear e exibe 7, e a task só fecha com a
   medição do peso da requisição.

### (b) Varredura de placeholders

Nenhum `TBD`, `TODO`, "adicionar tratamento de erro", "testes para o acima" ou "similar à Task N".
Todo passo tem bloco de código; todo teste tem asserção real. As três remissões a código existente
("o conteúdo atual do menu, inalterado", "o seletor Clássico/Premium atual", "o corpo atual da DRE")
apontam para trecho que **não muda** e cujo arquivo:linha está no cabeçalho da task — não é
instrução para o executor inventar nada. A nota destacada da Task 10 (converter as citações da
linha "Relaciona" em links markdown) traz a decisão já tomada e a alternativa proibida nomeada.
<!-- rev-fable: a revisão encontrou e corrigiu: 1 teste-placeholder (Task 12, "…renderiza, troca a âncora…"),
3 símbolos usados sem definição (`estado`/`diaAtras`/`oferta` na Task 22), 6 helpers de render citados sem
forma (agora escritos nas Tasks 4, 11, 12, 18, 20, 22), e o hack de `key` da Task 19 (substituído por modo
controlado em `SecaoSonar`). O único placeholder que sobra é o `<colar aqui…>` da Errata 3 (Task 15),
preenchido pela Task 13 e travado por grep no Step 4. -->
Os helpers de render que os testes citam e que ainda não existem estão escritos, com o que muda no
`vi.mock` de cada arquivo, na task que os introduz (4, 11, 12, 18, 20, 22). O único placeholder
deliberado é o `<colar aqui…>` da Errata 3 (Task 15), preenchido pela Task 13 e travado por `grep`
no Step 4 dela.

### (c) Consistência de nomes e tipos entre tasks

| Símbolo | Produzido em | Consumido em |
|---|---|---|
| `Table` com `containerClassName`/`containerProps` | 1 | 1 (DataTable) |
| `ContextoMargem` | 8 (`src/lib/pulse.ts`) | 9, 21 |
| `fetchContextoMargemEmLote` | 8 | 9, e mock em 3 |
| `custoDaFamilia`, `FamiliaComVariacoes` | 8 (`pulse-margem.ts`) | 8 (`pulse.ts`) |
| `insumoFaltante` | 8 (movida de `dialog-detalhe.tsx`) | 9, 20 |
| `TabelaRadar` com `contextos`/`onReprecificar` | 9 | 21, 22 |
| `AlvoReprecificar` (estado de `Pulse.tsx`) | 9 | 9 (aba Alertas e linha do Radar) |
| Rótulo `Margem s/ venda` / `Markup` | 10 (ADR) | 11, 12, 20 |
| `AncoraDre`, `id="sonar-dre"`, `data-testid="dre-ancora"` | 12 | 19, 23 |
| `chaveDedupePrecoCaiu`, `filtrarAlertasJaGravados` | 14 | 14 (teste) |
| `idadeAlerta`, `textoAlerta` com Δ% | 16 | 17 |
| `GrupoAlertas`, `agruparAlertasPorProduto` | 17 | 17 (aba) |
| `marcarAlertasLidosPorIds` | 17 (`src/lib/pulse.ts`) | 17 (aba) |
| `SecaoSonar` | 19 | 19 (DRE e Análise PubliAI) |
| `PulseResumoOfertas.abaixoDaReferencia` | 21 | 21 (tabela) |
| `fetchPulseHistoricoOfertas`, `TabelaRadar.historico` | 22 | 22 |

`SeveridadeAlerta` continua declarado nos dois runtimes (Deno e Vite) de propósito — eles não se
importam, e o valor é travado no banco pelo `check` da ADR-0133. `Sparkline` é o de
`src/components/ui/sparkline.tsx`, reusado pelo Radar; o `Sparkline` local de `dialog-detalhe.tsx`
(14 dias, SVG próprio) **fica como está** — mexer nele não está no escopo de nenhum item.
