# Ícone de informação nos KPIs

## Objetivo

Todo KPI (Dashboard, Publicados, Financeiro, Faturamento/Vendas) ganha um ícone "i" clicável
que abre um popover explicando o que aquele número significa. Painéis multi-métrica (Saúde dos
anúncios, Encalhados, ranking de produtos, em Publicados) ganham 1 ícone por painel, explicando
o painel como um todo — não 1 ícone por linha interna.

## Escopo

**Dentro:**
- Cards de valor único: `KpiCard` (Dashboard) + os 3 `Kpi` locais duplicados (Publicados,
  Financeiro, Faturamento/aba-vendas) + `HeroVenda` (Dashboard, 2 cards de destaque) + o card
  "Líquido das vendas (você recebe)" em `Financeiro.tsx:180-213` (mesmo papel de hero
  destaque, hoje implementado em JSX próprio, não reusa `HeroVenda`/`KpiCard`).
- Painéis multi-métrica em Publicados: "Saúde dos anúncios", "Encalhados" e o painel de
  ranking "Top produtos (faturamento)" (`dashboard-publicados.tsx:144-160` — é só 1 painel de
  ranking hoje, não vários) — 1 ícone por título de painel.

**Fora (decisão explícita, não esquecimento):**
- Divergência de pipeline de cálculo entre telas (ver seção "Achado colateral" abaixo) — vira
  nota em `TASKS.md`, não é corrigida nesta entrega.
- Qualquer outra tela (Lotes, Progresso, Revisão, Viabilidade, Canais, Organizações, Usuários,
  Configurações) não tem cards de KPI numérico hoje — nada a fazer ali.

## Arquitetura

### 1. `src/components/ui/popover.tsx` (novo)

Wrapper Radix Popover, mesmo molde de `src/components/ui/tooltip.tsx` (componente já existente
no projeto, embora hoje sem nenhum importador real — é um template pronto pra copiar, não um
padrão em uso). `radix-ui` (pacote guarda-chuva, já em `package.json`) inclui o primitivo
`Popover`. Fecha ao clicar fora ou Esc (comportamento nativo do Radix).

### 2. `src/lib/kpi-descriptions.ts` (novo) — dicionário central

`Record<string, string>` de chave → texto explicativo. Duas formas de chave:

- **Chave simples = label exato** (`"Faturamento bruto"`, `"Compradores"`, etc.) — para KPIs
  cujo cálculo é comprovadamente idêntico em todas as telas onde aparecem.
- **Chave composta `"<label>::<tela>"`** — só para os 2 labels confirmados divergentes entre
  pipelines de cálculo (ver "Achado colateral"): `"Pedidos"` e `"Ticket médio"`. Cada tela
  recebe texto específico mencionando a fonte real (ex.: "pedidos do checkout" vs. "linhas
  faturáveis agrupadas em pack").
- `"Markup no período"` **não diverge** — confirmado por leitura direta: Dashboard
  (`Dashboard.tsx:291`), Publicados (`dashboard-publicados.tsx:81`) e Financeiro
  (`Financeiro.tsx:254`) leem todos `r.markup`/`resumo.markup`, mesma `calcularResumo()`. Fica
  com chave simples, texto único. (Faturamento/aba-vendas tem um KPI de markup também, mas com
  label diferente — só `"Markup"`, não `"Markup no período"` — então nem colide.)
- `"Ticket médio líquido"` (Financeiro) e `"Markup"` (Faturamento/aba-vendas) são labels
  diferentes de `"Ticket médio"`/`"Markup no período"` — já são chaves próprias, sem
  ambiguidade, sem precisar de sufixo de tela.
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
  explicitamente pelos 2 labels de chave composta (`"Pedidos"`, `"Ticket médio"`).

Internamente, `KpiCard` resolve a descrição via `infoKey ?? label` no dicionário. Se existir,
renderiza um botão com ícone `Info` (lucide-react) ao lado do label, abrindo o `Popover`. Se não
existir entrada, nenhum ícone é renderizado (sem quebrar nada) — mas ver "Guarda de cobertura"
abaixo para não deixar isso passar em silêncio.

Quando o card tem `to` (drill-down, vira `Link`) **ou está envolvido por um `<Link>` externo**
(caso de `"Faturamento"` em `dashboard-publicados.tsx:68-74`, que embrulha o `Kpi` num `<Link>`
próprio em vez de usar a prop `to` do card): o botão do ícone precisa de
`onClick={(e) => { e.stopPropagation(); ... }}` para não disparar a navegação ao abrir o
popover. Regra geral: qualquer `KpiInfoButton` renderizado dentro de um elemento clicável
(`<Link>`/`<button>` ancestral) precisa desse guard — não só quando o `to` é prop direta do
`KpiCard`.

### 4. Migração dos 3 `Kpi` duplicados

`dashboard-publicados.tsx`, `aba-vendas.tsx`, `Financeiro.tsx`: a função local `Kpi(...)` é
removida; os call sites passam a usar `<KpiCard size="compact" tom=... ... />`. Elimina a
duplicação hoje existente (3 cópias quase idênticas) em vez de colar o ícone 3x.

### 5. `HeroVenda` (Dashboard) e hero card do Financeiro

`HeroVenda` (Dashboard, 2 usos) não vira `KpiCard` — visual muito diferente (texto 3xl,
gradiente de marca, card inteiro é link). O card "Líquido das vendas (você recebe)"
(`Financeiro.tsx:180-213`) é o mesmo papel (hero de destaque, mesmas classes de gradiente/3xl),
mas implementado em JSX próprio, com uma particularidade: o `<Link>` só existe quando
`podeDetalhar` é `true` (senão é uma `div` estática sem navegação) — o botão de info deve
funcionar nos dois ramos, mas só precisa do guard de `stopPropagation` no ramo com `Link`.

Ambos reaproveitam o mesmo subcomponente de ícone+popover (extraído de dentro de `KpiCard` como
peça pequena reusável, `KpiInfoButton`), com o cuidado de `stopPropagation` descrito acima —
aqui é ainda mais necessário, pois o card inteiro (quando linkado) é um `<Link>`.

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

Investigação de código (e re-checada linha a linha após revisão do spec, porque a primeira
leitura errou o alcance) confirmou que `"Pedidos"` e `"Ticket médio"` são calculados por **dois
pipelines diferentes**:

- **Dashboard** (`Dashboard.tsx:146-153,301-308`) e **Faturamento/aba-vendas**
  (`aba-vendas.tsx:374,376`) usam `agruparPorPedido()` + `calcularKpisPedidos()`
  (`lib/pedidos-faturamento.ts`) — conta pedido real (pack), não linha.
- **Publicados** (`dashboard-publicados.tsx:76-77`, via `totais.pedidos`/`totais.faturamento`
  vindos de `Publicados.tsx:675`) usa `calcularResumo()` (`lib/resumo-vendas.ts`) — conta por
  linha de `ml_vendas` agrupada em pack, filtro de "faturável" aplicado por linha, não por
  pedido.

Em packs com pedidos de status misto (um cancelado + um pago no mesmo carrinho), isso pode
produzir números diferentes pro mesmo período entre Publicados e as outras duas telas —
contradiz o que o ADR-0038 promete ("mesmo número em todas as telas"; ADR-0039 introduziu essa
divergência deliberadamente só pra Faturamento, e o Dashboard aderiu depois por conta própria).

**"Markup no período" não faz parte desse achado** — as 3 telas que usam esse label exato
(Dashboard, Publicados, Financeiro) leem todas de `calcularResumo()`; não há divergência ali.
ADR-0055 (fórmula de markup) está implementado corretamente onde é usado; o problema é só
granularidade do filtro "faturável" em `"Pedidos"`/`"Ticket médio"`.

Isto será registrado como nota em `docs/TASKS.md` para priorização futura — não é corrigido
nesta entrega (fora do pedido original, mexeria em lógica financeira sem ADR próprio).

## Validação

- `pnpm lint` + `pnpm test` (incluindo o teste de cobertura do dicionário).
- Verificação manual (dark/light) via browser-use: abrir Dashboard, Publicados, Financeiro,
  Faturamento; clicar em cada ícone "i"; conferir que o popover abre, fecha ao clicar fora, e
  que clicar no ícone **não dispara navegação** nos casos dentro de elemento clicável: Dashboard
  ("Compradores"/"Pedidos"/"Ticket médio"/"Líquido no faturamento", todos com `to`, e os 2
  `HeroVenda`), Publicados ("Faturamento", com `<Link>` externo), Financeiro (hero "Líquido das
  vendas" quando `podeDetalhar` é `true`).

## Limites

- Não adiciona ícone de informação em painéis fora de Publicados (não existem hoje em outras
  telas).
- Não corrige a divergência de pipeline (só documenta).
- Não altera nenhuma fórmula de cálculo existente.
