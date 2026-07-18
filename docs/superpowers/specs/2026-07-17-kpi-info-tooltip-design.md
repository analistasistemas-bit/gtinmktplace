# Ícone de informação nos KPIs

## Objetivo

Todo KPI (Dashboard, Publicados, Financeiro, Faturamento/Vendas) ganha um ícone "i" clicável
que abre um popover explicando o que aquele número significa. Painéis multi-métrica (Saúde dos
anúncios, Encalhados, Rankings, em Publicados) ganham 1 ícone por painel, explicando o painel
como um todo — não 1 ícone por linha interna.

## Escopo

**Dentro:**
- Cards de valor único: `KpiCard` (Dashboard) + os 3 `Kpi` locais duplicados (Publicados,
  Financeiro, Faturamento/aba-vendas) + `HeroVenda` (Dashboard, 2 cards de destaque).
- Painéis multi-métrica em Publicados: "Saúde dos anúncios", "Encalhados", Rankings — 1 ícone
  por título de painel.

**Fora (decisão explícita, não esquecimento):**
- Divergência de pipeline de cálculo entre telas (ver seção "Achado colateral" abaixo) — vira
  nota em `TASKS.md`, não é corrigida nesta entrega.
- Qualquer outra tela (Lotes, Progresso, Revisão, Viabilidade, Canais, Organizações, Usuários,
  Configurações) não tem cards de KPI numérico hoje — nada a fazer ali.

## Arquitetura

### 1. `src/components/ui/popover.tsx` (novo)

Wrapper Radix Popover, mesmo molde de `src/components/ui/tooltip.tsx` (que já existe e é usado
só em gráficos). `radix-ui` (pacote guarda-chuva, já em `package.json`) inclui o primitivo
`Popover`. Fecha ao clicar fora ou Esc (comportamento nativo do Radix).

### 2. `src/lib/kpi-descriptions.ts` (novo) — dicionário central

`Record<string, string>` de chave → texto explicativo. Duas formas de chave:

- **Chave simples = label exato** (`"Faturamento bruto"`, `"Compradores"`, etc.) — para KPIs
  cujo cálculo é comprovadamente idêntico em todas as telas onde aparecem.
- **Chave composta `"<label>::<tela>"`** — só para os 3 labels confirmados divergentes entre
  pipelines de cálculo (ver "Achado colateral"): `"Pedidos"`, `"Ticket médio"`, `"Markup no
  período"`. Cada tela recebe texto específico mencionando a fonte real (ex.: "pedidos do
  checkout" vs. "linhas faturáveis agrupadas em pack").
- `"Ticket médio líquido"` (Financeiro) é label diferente de `"Ticket médio"` — já é chave
  própria, sem ambiguidade.
- Painéis: chave pelo título do painel (`"Saúde dos anúncios"`, `"Encalhados"`, nome de cada
  ranking).

Toda descrição é escrita lendo a fórmula real em `useResumoVendas.ts` / `lib/metricas.ts` /
`lib/resumo-vendas.ts` / `lib/pedidos-faturamento.ts` / `lib/markup.ts` — não a partir de
suposição sobre o nome do label.

### 3. `KpiCard` (`src/components/ui/kpi-card.tsx`) — estendido

Novas props:
- `size?: 'default' | 'compact'` — `'compact'` reproduz o visual dos 3 `Kpi` locais
  (`px-3 py-2.5`, `text-lg`) hoje duplicados.
- `tom?: 'info' | 'success' | 'warning' | 'danger'` — cor do ícone do card, hoje só existente
  nos `Kpi` locais.
- `infoKey?: string` — chave a buscar no dicionário (default: usa o próprio `label`). Só passada
  explicitamente pelos 3 labels de chave composta.

Internamente, `KpiCard` resolve a descrição via `infoKey ?? label` no dicionário. Se existir,
renderiza um botão com ícone `Info` (lucide-react) ao lado do label, abrindo o `Popover`. Se não
existir entrada, nenhum ícone é renderizado (sem quebrar nada) — mas ver "Guarda de cobertura"
abaixo para não deixar isso passar em silêncio.

Quando o card tem `to` (drill-down, vira `Link`): o botão do ícone precisa de
`onClick={(e) => { e.stopPropagation(); ... }}` para não disparar a navegação do card ao abrir
o popover.

### 4. Migração dos 3 `Kpi` duplicados

`dashboard-publicados.tsx`, `aba-vendas.tsx`, `Financeiro.tsx`: a função local `Kpi(...)` é
removida; os call sites passam a usar `<KpiCard size="compact" tom=... ... />`. Elimina a
duplicação hoje existente (3 cópias quase idênticas) em vez de colar o ícone 3x.

### 5. `HeroVenda` (Dashboard, card-link de destaque)

Não vira `KpiCard` — visual muito diferente (texto 3xl, gradiente de marca, card inteiro é
link), só 2 usos. Reaproveita o mesmo subcomponente de ícone+popover (extraído de dentro de
`KpiCard` como peça pequena reusável, ex. `KpiInfoButton`), com o mesmo cuidado de
`stopPropagation` — aqui é ainda mais necessário, pois o card inteiro já é um `<Link>`.

### 6. Painéis multi-métrica (Publicados)

"Saúde dos anúncios", "Encalhados", cada card de ranking: hoje são `div`s soltas, não
`KpiCard`. Cada uma ganha o mesmo `KpiInfoButton` ao lado do título do painel (não por linha
interna), buscando a descrição do painel inteiro no dicionário pela chave do título.

## Interação e acessibilidade

- Ícone `Info` (lucide-react), clicável, `aria-label` descritivo (ex. `"O que é Faturamento
  bruto"`).
- Área de toque mínima ~40×40px (o glifo do ícone é menor, mas o botão precisa de padding
  suficiente — relevante em mobile/telas estreitas, como no print de referência).
- Abre ao clicar, fecha ao clicar fora ou Esc (Radix Popover, sem lógica extra).
- Popover: título curto (o label do KPI) + 1-2 frases de explicação.

## Guarda de cobertura ("todos os KPIs")

Como o requisito é literalmente "todos", um `label`/`infoKey` sem entrada no dicionário faz o
ícone simplesmente não aparecer — silencioso. Para não regredir isso no futuro sem perceber:
teste (`vitest`) que varre os componentes que usam `KpiCard`/`KpiInfoButton` em Dashboard,
Publicados, Financeiro e Faturamento e falha se algum `label`/`infoKey` renderizado não resolver
para uma entrada do dicionário.

## Achado colateral: divergência de pipeline (fora de escopo, registrar)

Investigação de código confirmou que `"Pedidos"`, `"Ticket médio"` e `"Markup no período"` são
calculados por **dois pipelines diferentes**: `calcularResumo()` (`lib/resumo-vendas.ts`, usado
por Dashboard/Publicados/Financeiro via `useResumoVendas`) vs. `agruparPorPedido()` +
`calcularKpisPedidos()` (`lib/pedidos-faturamento.ts`, usado por Faturamento/aba-vendas — e por
Dashboard especificamente para esses 3 labels, que migrou para o pipeline de pedidos citando
"mesmo nível do menu Faturamento"). Publicados e Financeiro ficaram no pipeline antigo. Isso
significa que, em packs com pedidos de status misto (um cancelado + um pago no mesmo carrinho),
o mesmo label pode mostrar números diferentes em telas diferentes no mesmo período — contradiz
o que o ADR-0038 promete ("mesmo número em todas as telas"). ADR-0055 (markup) está implementado
corretamente nos dois pipelines; a divergência é de granularidade do filtro "faturável", não de
fórmula.

Isto será registrado como nota em `docs/TASKS.md` para priorização futura — não é corrigido
nesta entrega (fora do pedido original, mexeria em lógica financeira sem ADR próprio).

## Validação

- `pnpm lint` + `pnpm test` (incluindo o teste de cobertura do dicionário).
- Verificação manual (dark/light) via browser-use: abrir Dashboard, Publicados, Financeiro,
  Faturamento; clicar em cada ícone "i"; conferir que o popover abre, fecha ao clicar fora, e
  que clicar no ícone dentro de um card-link (Dashboard "Compradores" com `to`, e ambos
  `HeroVenda`) não dispara navegação.

## Limites

- Não adiciona ícone de informação em painéis fora de Publicados (não existem hoje em outras
  telas).
- Não corrige a divergência de pipeline (só documenta).
- Não altera nenhuma fórmula de cálculo existente.
