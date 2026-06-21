# Repaginação Visual Premium — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevar o visual do PubliAI a um nível premium light-first (inspirado no CentralFlow), via tokens + primitivos, aplicado em 3 telas piloto, sem alterar comportamento.

**Architecture:** Mudança token-driven. A Fase 0 redefine tokens em `src/index.css` (cor, gradiente de marca, sombras premium) e refina os primitivos `Card`/`Button`/`KpiCard`, propagando para todo o app. A Fase 1 aplica o sistema em Dashboard, Financeiro e Publicados, provando a regra do híbrido (vitrine expressiva × dados minimalistas). Validação por screenshot + testes verdes.

**Tech Stack:** React 18, Tailwind v4 (config em CSS `@theme`), shadcn/ui, Radix, Geist (`@fontsource-variable/geist`), OKLCH, lucide-react. Testes: Vitest (`pnpm test`). Dev: `pnpm dev`.

## Global Constraints

- **Mudança puramente visual.** Zero alteração de lógica, rotas, dados, queries, hooks ou Edge Functions. Verbatim da spec: "tokens + componentes de apresentação".
- **Testes verdes** (`pnpm test`) ao fim de cada task.
- **Build verde** (`pnpm build`) ao fim de cada task de token/primitivo.
- **Acessibilidade AA** mantida (não rebaixar contraste dos tokens semânticos).
- **Light-first**: calibrar com o tema claro como foco; dark herda via tokens e deve ser verificado, não rebaixado.
- **Regra do híbrido**: vitrine (Dashboard, KPIs, nav, empty-states) = roxo + gradiente pontual + profundidade; dados (tabelas Publicados/Financeiro/Revisão) = minimalista, sem gradiente.
- **Git**: commits **locais** na branch `worktree-design+repaginacao-visual-premium`. **Nenhum push, PR ou deploy sem OK explícito do Diego.** (Confirmar no handoff se commits locais por task estão autorizados.)
- **Gradiente de marca**: somente roxo→índigo. Tons quentes (laranja/rosa) proibidos como cor de marca.
- **Fonte**: Geist mantida. Não trocar família.

---

## FASE 0 — Fundação (tokens + primitivos + StyleGuide)

### Task 1: Tokens de cor, gradiente e sombras premium

**Files:**
- Modify: `src/index.css:8-67` (bloco `@theme inline` — registrar tokens novos)
- Modify: `src/index.css:69-112` (`:root` — light)
- Modify: `src/index.css:114-155` (`.dark`)

**Interfaces:**
- Produces (tokens CSS consumíveis via Tailwind/`var()`):
  - `--brand-gradient`, `--brand-gradient-soft` (utilitários `bg-[image:var(--brand-gradient)]`)
  - `--shadow-brand` (glow roxo)
  - sombras `--shadow-xs/sm/md/lg` recalibradas com tint roxo

- [ ] **Step 1: Adicionar tokens de gradiente e shadow-brand no `:root`**

No bloco `:root` (após a linha `--ring:` ~L97), acrescentar:

```css
    /* Gradiente de marca — só vitrine (hero, KPIs destaque, logo, empty-state) */
    --brand-gradient: linear-gradient(135deg, oklch(0.56 0.21 277), oklch(0.585 0.21 300));
    /* Fundo sutil de marca para superfícies vitrine no light */
    --brand-gradient-soft: linear-gradient(135deg, oklch(0.965 0.03 277), oklch(0.97 0.03 300));
    /* Glow roxo para CTA/hero premium */
    --shadow-brand: 0 8px 24px oklch(0.55 0.20 277 / 0.22);
```

- [ ] **Step 2: Recalibrar sombras premium (tint roxo) no `@theme inline`**

Substituir as 4 linhas de `--shadow-*` (atuais `src/index.css:58-61`) por sombras com tint roxo sutil (mais coesas/premium que preto puro):

```css
    --shadow-xs: 0 1px 2px oklch(0.40 0.05 277 / 0.08);
    --shadow-sm: 0 1px 3px oklch(0.40 0.05 277 / 0.10), 0 1px 2px oklch(0.40 0.05 277 / 0.06);
    --shadow-md: 0 4px 16px oklch(0.40 0.06 277 / 0.12);
    --shadow-lg: 0 12px 40px oklch(0.40 0.08 277 / 0.16);
```

- [ ] **Step 3: Registrar gradientes como cores de tema no `@theme inline`**

No bloco `@theme inline` (junto às `--color-*`, ~L50), adicionar para expor utilitários:

```css
    --color-brand-gradient: var(--brand-gradient);
    --color-brand-gradient-soft: var(--brand-gradient-soft);
```

- [ ] **Step 4: Definir variante dark dos gradientes/glow no `.dark`**

No bloco `.dark` (após `--ring:` ~L141), acrescentar:

```css
    --brand-gradient: linear-gradient(135deg, oklch(0.64 0.18 277), oklch(0.66 0.19 300));
    --brand-gradient-soft: linear-gradient(135deg, oklch(0.30 0.045 277), oklch(0.31 0.05 300));
    --shadow-brand: 0 8px 28px oklch(0.64 0.18 277 / 0.30);
```

- [ ] **Step 5: Build + testes**

Run: `pnpm build && pnpm test`
Expected: build PASS, testes PASS (nenhuma referência quebrada; tokens são aditivos).

- [ ] **Step 6: Commit (se autorizado)**

```bash
git add src/index.css
git commit -m "feat(design): tokens de gradiente de marca e sombras premium (Fase 0)"
```

---

### Task 2: Primitivos premium — Card e Button

**Files:**
- Modify: `src/components/ui/card.tsx:14-16` (superfície do Card)
- Modify: `src/components/ui/button.tsx:12` (variante default)

**Interfaces:**
- Consumes: tokens da Task 1 (`--shadow-sm`, `--shadow-md`, `--shadow-brand`, `--brand-gradient`).
- Produces: `Card` com elevação premium + hover lift; `Button` default com profundidade. Assinaturas inalteradas (sem novas props).

- [ ] **Step 1: Card — trocar ring por sombra premium + hover lift**

Em `src/components/ui/card.tsx`, na string de classes do `Card` (L15), trocar `ring-1 ring-foreground/10` por elevação com transição:

```tsx
        "group/card flex flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 text-sm text-card-foreground shadow-sm ring-1 ring-foreground/5 transition-shadow duration-[180ms] hover:shadow-md has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
```

(Mantém um ring sutil `ring-foreground/5` para definição de borda + `shadow-sm` para premium; hover sobe para `shadow-md`.)

- [ ] **Step 2: Button default — profundidade sutil**

Em `src/components/ui/button.tsx:12`, na variante `default`, adicionar sombra sutil que reforça o CTA sem virar gradiente (gradiente fica reservado a um botão hero específico no Dashboard, Task 4):

```tsx
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 hover:shadow-sm",
```

- [ ] **Step 3: Build + testes**

Run: `pnpm build && pnpm test`
Expected: PASS.

- [ ] **Step 4: Screenshot de sanidade (StyleGuide)**

Run (com `pnpm dev` ativo em outro terminal):
```bash
browser-use open http://localhost:5173/style-guide && browser-use screenshot /tmp/sg-cards.png
```
Expected: cards com sombra suave + lift no hover; botões com profundidade. (Confirmar rota real do StyleGuide na Task 3.)

- [ ] **Step 5: Commit (se autorizado)**

```bash
git add src/components/ui/card.tsx src/components/ui/button.tsx
git commit -m "feat(design): elevacao premium em Card e Button (Fase 0)"
```

---

### Task 3: StyleGuide como vitrine do novo sistema

**Files:**
- Read primeiro: `src/pages/StyleGuide.tsx` (inteiro — entender seções atuais)
- Modify: `src/pages/StyleGuide.tsx` (adicionar seção "Gradiente de marca" + "Sombras")
- Confirm: rota do StyleGuide em `src/` (grep `StyleGuide` / `style-guide`)

**Interfaces:**
- Consumes: tokens da Task 1, primitivos da Task 2.

- [ ] **Step 1: Ler StyleGuide e localizar rota**

Run: `grep -rn "StyleGuide\|style-guide" src/` — anotar a rota exata (para os screenshots).

- [ ] **Step 2: Adicionar seção de gradiente de marca**

Acrescentar um bloco demonstrando os utilitários novos (swatch grande + chip de ícone):

```tsx
<section className="space-y-3">
  <h2 className="text-h2">Gradiente de marca</h2>
  <div className="flex gap-3">
    <div className="h-20 w-40 rounded-xl bg-[image:var(--brand-gradient)] shadow-brand" />
    <div className="h-20 w-40 rounded-xl bg-[image:var(--brand-gradient-soft)]" />
  </div>
  <p className="text-caption">Uso: só vitrine (hero, KPI destaque, logo, empty-state).</p>
</section>
```

- [ ] **Step 3: Build + testes**

Run: `pnpm build && pnpm test`
Expected: PASS.

- [ ] **Step 4: Screenshot do StyleGuide (light + dark)**

```bash
browser-use open http://localhost:5173/<rota-styleguide> && browser-use screenshot /tmp/sg-light.png
# alternar dark via toggle/classe, depois:
browser-use screenshot /tmp/sg-dark.png
```

- [ ] **Step 5: Commit (se autorizado)**

```bash
git add src/pages/StyleGuide.tsx
git commit -m "feat(design): StyleGuide documenta gradiente e sombras premium (Fase 0)"
```

---

## FASE 1 — Piloto (3 telas)

### Task 4: Dashboard (vitrine)

**Files:**
- Modify: `src/components/ui/kpi-card.tsx` (adicionar `variant?: 'default' | 'brand'`)
- Modify: `src/pages/Dashboard.tsx:54-72` (KPI destaque com `variant="brand"`)

**Interfaces:**
- Consumes: tokens Task 1, Card premium Task 2.
- Produces: `KpiCard` com prop opcional `variant` (default `'default'`; `'brand'` aplica fundo `--brand-gradient-soft` + ícone em chip `--brand-gradient`). Retrocompatível.

- [ ] **Step 1: KpiCard — variante brand**

Em `src/components/ui/kpi-card.tsx`, adicionar à interface (L9-18): `variant?: 'default' | 'brand';` e no corpo (L20) desestruturar `variant = 'default'`. No `Card` de render (L33), aplicar condicional:

```tsx
    <Card className={cn('p-4', variant === 'brand' && 'bg-[image:var(--brand-gradient-soft)]', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        {Icon && (
          <span className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-lg',
            variant === 'brand'
              ? 'bg-[image:var(--brand-gradient)] text-primary-foreground shadow-brand'
              : 'text-muted-foreground'
          )}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
```

(Manter o restante do componente igual.)

- [ ] **Step 2: Dashboard — destacar 1 KPI como brand**

Em `src/pages/Dashboard.tsx:55`, no primeiro `KpiCard` ("Anúncios publicados"), adicionar `variant="brand"`. Os demais permanecem default (disciplina: só 1 destaque vitrine).

- [ ] **Step 3: Build + testes**

Run: `pnpm build && pnpm test`
Expected: PASS.

- [ ] **Step 4: Screenshot antes/depois (light + dark)**

```bash
browser-use open http://localhost:5173/ && browser-use screenshot /tmp/dash-depois-light.png
```

- [ ] **Step 5: Commit (se autorizado)**

```bash
git add src/components/ui/kpi-card.tsx src/pages/Dashboard.tsx
git commit -m "feat(design): Dashboard vitrine com KPI de marca (Fase 1)"
```

---

### Task 5: Financeiro (meio-vitrine)

**Files:**
- Read primeiro: `src/pages/Financeiro.tsx` (inteiro), `src/components/card-voce-recebe.tsx`
- Modify: `src/pages/Financeiro.tsx` (KPIs com `variant="brand"` onde for o número-herói; tabelas/lançamentos = sem gradiente)

**Interfaces:**
- Consumes: `KpiCard variant='brand'` (Task 4), Card premium (Task 2).

- [ ] **Step 1: Ler Financeiro e identificar KPIs vs tabelas**

Run: `grep -n "KpiCard\|card-voce-recebe\|Table\|table" src/pages/Financeiro.tsx`
Mapear: qual KPI é o "número-herói" (ex: total a receber) → recebe `variant="brand"`. Tabelas de lançamentos → permanecem minimalistas.

- [ ] **Step 2: Aplicar variante brand no KPI-herói**

Adicionar `variant="brand"` apenas ao KPI principal do Financeiro. Demais KPIs e todas as tabelas: inalterados (herdam o Card premium da Task 2, sem gradiente).

- [ ] **Step 3: Build + testes**

Run: `pnpm build && pnpm test`
Expected: PASS.

- [ ] **Step 4: Screenshot (light + dark)**

```bash
browser-use open http://localhost:5173/financeiro && browser-use screenshot /tmp/fin-depois-light.png
```

- [ ] **Step 5: Commit (se autorizado)**

```bash
git add src/pages/Financeiro.tsx
git commit -m "feat(design): Financeiro com KPI-heroi de marca, tabelas minimalistas (Fase 1)"
```

---

### Task 6: Publicados (dados densos — minimalista)

**Files:**
- Read primeiro: `src/pages/Publicados.tsx` (inteiro, ~20K)
- Modify: `src/pages/Publicados.tsx` (somente onde houver superfícies que se beneficiem do Card premium; **sem gradiente**)

**Interfaces:**
- Consumes: Card premium (Task 2). **Não** consome gradiente de marca (regra do híbrido — é tela de dados).

- [ ] **Step 1: Ler Publicados e inventariar superfícies**

Run: `grep -n "Card\|Table\|rounded\|shadow\|bg-" src/pages/Publicados.tsx | head -40`
Objetivo: confirmar que a tela já herda os primitivos premium (Card/Button) automaticamente. Anotar qualquer superfície "crua" (div com borda manual) que deva adotar o `Card`.

- [ ] **Step 2: Normalizar superfícies para o Card premium (se houver cruas)**

Onde houver cards/painéis montados à mão com `border rounded-*` em vez do componente `Card`, trocar pelo `Card` (herda sombra premium). **Não** adicionar gradiente. Se a tela já usa `Card`, esta task é majoritariamente verificação (nenhuma mudança = resultado válido).

- [ ] **Step 3: Build + testes**

Run: `pnpm build && pnpm test`
Expected: PASS.

- [ ] **Step 4: Screenshot (light + dark)**

```bash
browser-use open http://localhost:5173/publicados && browser-use screenshot /tmp/pub-depois-light.png
```

- [ ] **Step 5: Commit (se autorizado)**

```bash
git add src/pages/Publicados.tsx
git commit -m "refactor(design): Publicados adota superficies premium minimalistas (Fase 1)"
```

---

### Task 7: Captura comparativa + gate de validação

**Files:** nenhum (entrega de evidência).

- [ ] **Step 1: Gerar baseline "antes" a partir da main**

Em um worktree/checkout da `main` rodando em outra porta (ou via screenshots já existentes), capturar Dashboard, Financeiro, Publicados em light+dark como "antes". Se inviável, anotar que o "antes" é o estado pré-Fase-0.

- [ ] **Step 2: Montar o comparativo**

Reunir os pares antes/depois (light + dark) das 3 telas + StyleGuide em `/tmp/` e apresentar ao Diego.

- [ ] **Step 3: GATE — validação do Diego**

Diego roda `pnpm dev` na branch, navega Dashboard/Financeiro/Publicados, e aprova ou pede ajustes de calibração (cor/sombra/raio/gradiente). Calibração fina dos valores OKLCH acontece aqui, iterando sobre a Task 1.

- [ ] **Step 4: Decisão de propagação**

Só com OK explícito: abrir o plano da **Fase 2** (propagação às ~14 telas restantes, padrão repetível: herdam tokens/Card premium; aplicar `variant="brand"` só em superfícies de vitrine).

---

## FASE 2 — Propagação (esboço; detalhar após OK do piloto)

Após aprovação do piloto, propagar o sistema às telas restantes. Padrão repetível por tela:
1. Tela herda automaticamente tokens + Card/Button premium (nada a fazer na maioria).
2. Identificar se a tela é vitrine (aplica `variant="brand"` no número/superfície-herói) ou dados (mantém minimalista).
3. Normalizar superfícies "cruas" para o componente `Card`.
4. Build + testes + screenshot.

Telas restantes (inventariar na abertura da Fase 2): Revisao, RevisaoIndex, Viabilidade, NovoLote, Progresso, Relatorio, Configuracoes, Cadastro, Login, ResetSenha, DetalheFinanceiro, DetalheVendas, NotFound. Componentes de domínio: `lote-card`, `familia-row`, `familia-expanded`, `variacao-card`, `painel-analise`, `viabilidade-linha`, `dashboard-publicados`, `semaforo-preco`, etc.

---

## Self-Review (coberto)

- **Spec coverage:** escopo visual (Tasks 1-6), light-first (Constraints + Task 1 Step 4), híbrido (Tasks 4-6), cor/gradiente/Geist (Task 1 + Constraints), rollout faseado (Fases 0/1/2), piloto Dashboard+Publicados+Financeiro (Tasks 4-6), guard-rails (Global Constraints), validação local (Task 7). ✓
- **Placeholders:** valores OKLCH e classes concretas em todas as tasks; "Step 1: ler X" onde o arquivo é grande demais para citar verbatim aqui (Financeiro/Publicados/StyleGuide) — leitura é o primeiro passo da própria task, não um placeholder de implementação. ✓
- **Type consistency:** `variant?: 'default' | 'brand'` definido na Task 4 e consumido nas Tasks 4-5 com o mesmo nome. Tokens `--brand-gradient`/`--brand-gradient-soft`/`--shadow-brand` definidos na Task 1 e usados nas Tasks 2-5 com os mesmos nomes. ✓
