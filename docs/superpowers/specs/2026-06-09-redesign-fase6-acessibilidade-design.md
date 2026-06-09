# Redesign PubliAI — Fase 6: Acessibilidade (a11y)

> Spec de design. Parte do redesign faseado. **Data:** 2026-06-09 · **Pré-requisitos:** Fases 1–5.

## Objetivo

Corrigir os achados de acessibilidade do diagnóstico e instalar um **gate permanente** (`eslint-plugin-jsx-a11y`) para não regredir. O diagnóstico mostrou que o app já está em bom estado (DS + Radix + app shell cuidaram da maior parte); o escopo aqui é cirúrgico. Padrão de referência: WCAG 2.1 AA.

## Diagnóstico (base desta fase)

Rodado com `eslint-plugin-jsx-a11y` (recommended) + varredura manual:

**Já OK:** 3 imagens com `alt`; 3/4 botões só-ícone com `aria-label` (topbar, theme-toggle, user-menu); `prefers-reduced-motion` nos tokens; foco/modais via Radix + `--ring`.

**Achados a corrigir:**
1. **`jsx-a11y/label-has-associated-control` — 5 ocorrências:**
   - `src/pages/Configuracoes.tsx:99,106,113` — labels do RadioGroup "Estratégia de preço" (envolvem `RadioGroupItem` com `id`, mas sem `htmlFor`).
   - `src/components/familia-expanded.tsx:307,317` — labels "TÍTULO"/"DESCRIÇÃO" não associados ao `Input`/`Textarea`.
2. **Botão só-ícone sem `aria-label` — 1 ocorrência:** `src/components/lote-card.tsx:86` (lixeira "Excluir lote"; hoje só `title`).
3. **Contraste de cor (não coberto por estática):** auditar os tokens semânticos usados no `StatusPill` (`text-<tone>` sobre `bg-<tone>/10`) e texto principal, em light e dark, contra o limiar AA.

## Design

### 6a — Correções de associação de label

- **Configuracoes.tsx:** adicionar `htmlFor="r1|r2|r3"` em cada `<label>` (os `RadioGroupItem` já têm `id="r1|r2|r3"`). Zero mudança de lógica/estado.
- **familia-expanded.tsx:** dar `id` único por família ao `Input` (título) e ao `Textarea` (descrição) e `htmlFor` correspondente nos labels. Como várias famílias podem estar expandidas ao mesmo tempo, o `id` precisa ser único por família (usar `familia.codigoPai`): `id={\`titulo-${familia.codigoPai}\`}` e `id={\`descricao-${familia.codigoPai}\`}`. Zero mudança de lógica.

### 6b — aria-label no botão só-ícone

- **lote-card.tsx:** adicionar `aria-label={bloqueado ? 'Aguarde…' : 'Excluir lote'}` no botão da lixeira (manter o `title` existente). Sem mudança de lógica.

### 6c — Gate permanente (anti-regressão)

- Instalar `eslint-plugin-jsx-a11y` como devDependency.
- Adicionar `jsx-a11y.flatConfigs.recommended` ao `eslint.config.js` (no bloco `**/*.{ts,tsx}`), de forma que `pnpm lint` passe a checar a11y. Após 6a/6b, `pnpm lint` deve ficar **0 errors** (os 7 warnings pré-existentes de `react-refresh` permanecem).

### 6d — Auditoria de contraste (tokens)

- Script de auditoria (descartável, não versionado em `src/`) que lê os tokens OKLCH de `src/index.css` (`--foreground`, `--muted-foreground`, `--success`, `--warning`, `--danger`, `--info`, `--background`, `--card` em `:root` e `.dark`), converte OKLCH→sRGB e calcula o contraste WCAG:
  - **Texto principal** `--foreground` sobre `--background` e `--card` (esperado: passa folgado).
  - **StatusPill:** texto `--<tone>` (sólido) sobre o fundo composto `0.1·<tone> + 0.9·card` (o `bg-<tone>/10`), em light e dark. Limiar: AA texto normal = 4.5:1 (o pill é `text-xs`).
- **Se algum tone reprovar**, ajustar o token correspondente em `src/index.css` (escurecer/clarear levemente o `--<tone>` no tema afetado) até passar AA, revalidando que o StatusPill continua legível. Se todos passarem, registrar e não mexer.

## Restrições

- Zero mudança de lógica/estado/handlers nos componentes (só atributos `htmlFor`/`id`/`aria-label` e, se necessário, valores de token).
- Não alterar a API do `KpiCard`/`StatusPill`/primitivos.
- Ajuste de token (se houver) deve preservar a identidade visual (mesma família de cor; só ajuste fino de luminância).

## Testes e verificação

- `pnpm lint` (já com jsx-a11y) → **0 errors**.
- `pnpm test` (345) verde, `pnpm exec tsc --noEmit`, `pnpm build` limpos.
- Relatório de contraste anexado ao commit/mensagem (números por token/tema).
- Visual: conferir os RadioItems/labels e os StatusPills no dark e light.

## Critérios de aceite

- [ ] `jsx-a11y` no eslint, `pnpm lint` 0 errors.
- [ ] 5 labels associados (Configuracoes + familia-expanded) e lixeira com `aria-label`.
- [ ] Contraste auditado; tokens reprovados (se houver) ajustados para AA; demais registrados.
- [ ] Zero mudança de comportamento; testes/tsc/build limpos.

## Fora de escopo (YAGNI)

- Teste automatizado de leitor de tela / navegação por teclado ponta-a-ponta (manual, fora desta fase).
- axe-core no browser (o login bloqueia automação; a auditoria de contraste é feita por cálculo dos tokens, que é determinístico e suficiente para o limiar AA).
- Reescrita de componentes; refatorações não relacionadas.
