# Redesign PubliAI — Fase 3: Revisão (centro de comando)

> Spec de design. Parte do redesign faseado. **Data:** 2026-06-08 · **Branch:** `feat/redesign-publiai` · **Pré-requisitos:** Fases 1 (DS) e 2 (shell).

## Objetivo

Redesenhar a tela mais importante do produto — a **Revisão** — para parecer um centro de comando premium, usando os tokens/componentes da Fase 1. **Re-skin 100% presentacional: ZERO mudança de lógica, hooks, handlers, estado, ordem de chamadas ou comportamento.** Cada handler, mutation, efeito e cálculo permanece idêntico; muda só markup/classes/estrutura visual.

## Estado atual (arquivos)

- `src/pages/Revisao.tsx` — barra de filtros (`<button>`s crus + emoji), dropzone, lista `FamiliaRow`+`FamiliaExpanded`, footer "Publicar selecionadas", `Dialog` de confirmação com tipo de anúncio (Clássico/Premium em `<button>`s).
- `src/components/familia-row.tsx` — linha em grid (checkbox, thumb 32px, título + pilha de badges coloridos, badge operação, faixa de preço, chevron) + `DescontoControle` (com `<input type=number>` e `<s>`).
- `src/components/familia-expanded.tsx` — `DiffEstoque`, faixa de fotos (capa+capa2), `PainelAnalise`, grid 2 colunas (Título/Descrição + Regenerar | Variações com `VariacaoCard`, markers "nova"/"principal").
- `src/components/painel-analise.tsx` — "Análise para publicação": banners (preço<20%, sem dimensões) + cards `div border` (Estratégia, Categoria, Concorrência, Potencial com emojis, `CardVoceRecebe`).

## Problemas

1. **Cores hardcoded sem dark** (blue/red/amber/green/emerald/purple-NNN) → quebram no dark mode e ignoram os tokens semânticos.
2. Filtros como `<button>` crus; sem `PageHeader`.
3. Badges = spans coloridos minúsculos (ruído).
4. `PainelAnalise` (o foco) usa `div border`, não `Card`; emojis como ícones.
5. Controles crus (number input, radio) fora do DS.

## Design

### Princípio mestre — mapa de tokens (aplica-se a TODOS os componentes)

Substituir cada cor hardcoded pelo `StatusPill`/token semântico equivalente. **Esta é a regra central do re-skin:**

| Hoje (hardcoded) | Novo |
|---|---|
| badge `CREATE` (default) | `StatusPill tone="info"` |
| badge `UPDATE` (secondary) | `StatusPill tone="neutral"` |
| `publicado`/`atualizado` green-100/800 | `StatusPill tone="success"` (mantém link ↗ quando houver permalink) |
| `🔒 incompleta` amber-100/800 | `StatusPill tone="warning"` |
| `⚠ mudança estrutural` amber | `StatusPill tone="warning"` |
| `⚠ N sem cor` red-100/700 | `StatusPill tone="danger"` |
| `estoque: N cor(es)` blue-100/700 | `StatusPill tone="info"` |
| marker `nova` emerald-100/700 | `StatusPill tone="success"` |
| marker `principal` blue-100/700 | `StatusPill tone="info"` |
| estratégia `PRÓPRIO` blue-50/700 | `StatusPill tone="info"` |
| estratégia `COMPETITIVO` amber-50/700 | `StatusPill tone="warning"` |
| concorrência `sem`/`moderada`/`alta` | `tone="neutral"`/`"info"`/`"warning"` |
| alerta preço<20% (destructive) | banner: `border-destructive/30 bg-destructive/5 text-destructive` (já é token — manter) |
| alerta sem dimensões (amber light-only) | banner com **token** `warning`: `border-warning/30 bg-warning/10 text-warning` |
| `border-l-purple-500` (editado) | `border-l-primary` |
| ícones-emoji 💲📈🚚🏆📅 (Potencial) | ícones lucide monocromáticos (`DollarSign`/`TrendingUp`/`Truck`/`Trophy`/`Calendar`) |

### 3a — Page chrome (Revisao.tsx)

- **`PageHeader`** no topo: título "Revisão" + subtítulo "Lote — N famílias" + (ações: o botão de desconto do lote). *(O DropZone e a barra de filtros ficam abaixo.)*
- **Filtros → `Tabs`** (shadcn) com rótulo + contador em `Badge`/número. Mesma lógica `setFiltro`; só troca o markup dos botões por `TabsList/TabsTrigger`. Banner de "avisos" preservado (token danger).
- **Footer de publicar** → barra de ação **sticky** mais sólida (borda/elevação do DS); botão primário. Mesma lógica/contadores.
- **Dialog de confirmação** → mesmo conteúdo, listing-type (Clássico/Premium) re-skin com cartões selecionáveis do DS (borda `--primary` no ativo). Lógica idêntica.

### 3b — FamiliaRow

- Grade mais respirável (gap/altura), thumbnail no padrão DS (radius/border tokens). **Todos os badges → `StatusPill`** conforme o mapa. Faixa de preço com `tabular-nums`; ícone de alerta com `text-destructive`. Estado editado: `border-l-primary`. `DescontoControle`: trocar `<input type=number>` pelo `Input` do DS (mantendo `defaultValue`/`onBlur`); o "de/por" com `<s>` re-estilizado com `text-muted-foreground`. Mesma lógica de mutations.

### 3c — PainelAnalise + CardVoceRecebe (a estrela)

- Wrapper vira um bloco com header claro "Análise para publicação".
- Cada card (Estratégia/Categoria/Concorrência/Potencial/Você recebe) usa o `Card` do DS (ou um padrão visual consistente com ícone no topo + `--muted-foreground` no label). Tons semânticos pelo mapa. Banners de alerta com tokens.
- **Potencial de venda**: emojis → ícones lucide; manter exatamente os mesmos dados/condicionais.
- `CardVoceRecebe`: re-skin para o padrão de card do DS, **sem alterar** o cálculo/hook `useTarifaML` nem as props.

### 3d — FamiliaExpanded

- Faixa de fotos e os 2 painéis (Título/Descrição | Variações) re-skin com espaçamento/labels do DS. Markers "nova"/"principal" → `StatusPill`. Radio da principal pode virar um controle visual do DS, mas **a lógica `updatePrincipal`/`name` do radio é preservada**. `StatusInline` (auto-save) intocado. Botão "Regenerar" mantém ícone `Sparkles`.

## Restrições (inegociáveis)

- **Zero** alteração de lógica: handlers, hooks, mutations, `useState`, efeitos, ordens de await, cálculos (`precoVendaMin`, `coresSelecionadas`, `familiaPublicavel`, etc.) **idênticos**. Só markup/classes.
- Não tocar em: edge functions, queries, schema, `lib/*` de domínio. As funções puras exportadas (`filtrarFamilias`) permanecem com a mesma assinatura e comportamento (e seus testes seguem verdes).
- Dark + light corretos (é o motivo do mapa de tokens). Contraste AA. Foco visível.

## Testes e verificação

- **Não-regressão é o critério-chave:** todos os testes atuais da Revisão seguem verdes sem alteração de asserção de comportamento — em especial `tests/pages`/`tests/components` que cobrem `filtrarFamilias`, `FamiliaRow` (publicável/checkbox), filtros e ações. Se um teste quebrar por seletor de cor/texto, ajustar o seletor **sem** afrouxar a asserção de comportamento.
- `pnpm test` verde, tsc/lint/build limpos.
- Visual: validar dark + light ao vivo (a tela inteira, expandida).

## Critérios de aceite

- [ ] Nenhuma cor hardcoded sem dark remanescente nos 4 arquivos (tudo via token/StatusPill).
- [ ] Filtros em Tabs com contador; PageHeader; footer sticky; modal re-skin.
- [ ] PainelAnalise em cards do DS, ícones lucide, tons semânticos.
- [ ] Dark e light corretos na tela inteira.
- [ ] Zero mudança de comportamento; testes verdes; tsc/lint/build limpos.

## Fora de escopo

`VariacaoCard`, `DiffEstoque`, `FotoCapaFamilia`, `StatusInline` internos (re-skin leve só se necessário para coerência; sem mudança de lógica). Dashboard/Publicados/Config = outras fases.
