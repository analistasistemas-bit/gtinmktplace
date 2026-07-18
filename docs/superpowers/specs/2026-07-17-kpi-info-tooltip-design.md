# Ícone de informação nos KPIs

## Objetivo

Todo KPI (Dashboard, Publicados, Financeiro, Faturamento — abas Vendas e Geografia) ganha um ícone "i" clicável
que abre um popover explicando o que aquele número significa. Painéis multi-métrica (Saúde dos
anúncios, Encalhados, ranking de produtos, em Publicados) ganham 1 ícone por painel, explicando
o painel como um todo — não 1 ícone por linha interna.

## Escopo

**Dentro:**
- Cards de valor único: `KpiCard` (Dashboard) + os 4 `Kpi` locais duplicados (Publicados,
  Financeiro, Faturamento/aba-vendas, Faturamento/aba-geografia — confirmado que Devoluções,
  Perguntas e Mensagens não têm KPIs) + `HeroVenda` (Dashboard, 2 cards de destaque) + o card
  "Líquido das vendas (você recebe)" em `Financeiro.tsx:180-213` (mesmo papel de hero
  destaque, hoje implementado em JSX próprio, não reusa `HeroVenda`/`KpiCard`).
- Painéis multi-métrica em Publicados: "Saúde dos anúncios", "Encalhados" e o painel de
  ranking "Top produtos (faturamento)" (`dashboard-publicados.tsx:144-160` — é só 1 painel de
  ranking hoje, não vários) — 1 ícone por título de painel.
- Cards "Resumo" nas páginas de detalhe (drill-down): `DetalheFinanceiro.tsx:452-460`
  ("Líquido total (você recebe)") e `DetalheVendas.tsx:362-378` ("Faturamento total") — mesma
  família visual dos heros já em escopo, e são o destino do clique dos cards de origem
  (Financeiro "Líquido das vendas" e Publicados "Faturamento") que já ganham o ícone.

**Fora (decisão explícita, não esquecimento):**
- Divergência de pipeline de cálculo entre telas (ver seção "Achado colateral" abaixo) — vira
  nota em `TASKS.md`, não é corrigida nesta entrega.
- As 3 "pills" de status em `Relatorio.tsx:75-86` (publicada(s)/publicando/com erro) — padrão
  visual e propósito diferentes (badge inline pequeno de contagem de status, não card de
  label+valor); não tratadas como KPI nesta entrega.
- Qualquer outra tela (Lotes, Progresso, Revisão, Viabilidade, Canais, Organizações, Usuários,
  Configurações) não tem cards de KPI numérico hoje — nada a fazer ali.

## Arquitetura

### 1. `src/components/ui/popover.tsx` (novo)

Wrapper Radix Popover, mesmo molde de `src/components/ui/tooltip.tsx` (componente já existente
no projeto, usado hoje em `canal-tabs.tsx` e `DetalheVendas.tsx` — mas sempre como
tooltip de hover em gráfico, nunca como ajuda contextual clicável; é um template válido pra
copiar, não um padrão a estender). `radix-ui` (pacote guarda-chuva, já em `package.json`) inclui
o primitivo `Popover`. Fecha ao clicar fora ou Esc (comportamento nativo do Radix).

### 2. `src/lib/kpi-descriptions.ts` (novo) — dicionário central

`Record<string, string>` de chave → texto explicativo. Duas formas de chave:

- **Chave simples = label exato** (`"Faturamento bruto"`, `"Compradores"`, etc.) — para KPIs
  cujo cálculo é comprovadamente idêntico em todas as telas onde aparecem.
- **Chave composta `"<label>::<tela>"`** — só para os 2 labels confirmados divergentes entre
  pipelines de cálculo (ver "Achado colateral"): `"Pedidos"` e `"Ticket médio"`. Cada tela
  recebe texto específico mencionando a fonte real (ex., em Publicados: "conta como faturável
  se qualquer item do pedido foi faturado"; em Dashboard/Faturamento: "conta como faturável
  pelo status do pedido no checkout").
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
- `size?: 'default' | 'compact'` — `'compact'` reproduz o visual dos 4 `Kpi` locais
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

### 4. Migração dos 4 `Kpi` duplicados

`dashboard-publicados.tsx`, `aba-vendas.tsx`, `Financeiro.tsx`, `aba-geografia.tsx`: a função
local `Kpi(...)` é removida em cada um; os call sites passam a usar
`<KpiCard size="compact" tom=... ... />`. Elimina a duplicação hoje existente (4 cópias quase
idênticas) em vez de colar o ícone 4x. KPIs novos cobertos por essa migração:
`aba-geografia.tsx:136-163` → "Estados atingidos", "Top estado", "Cidades", "Sem localização".

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

### 6. Cards "Resumo" nas páginas de detalhe

`DetalheFinanceiro.tsx:452-460` e `DetalheVendas.tsx:362-378`: mesmo molde de card-hero
(gradiente + valor `2xl`), sem `Link` (já são a página de destino, não navegam). Reaproveitam o
mesmo `KpiInfoButton`, sem necessidade de `stopPropagation` (não há ancestral clicável).

### 7. Painéis multi-métrica (Publicados)

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
teste (`vitest`) que varre os componentes que usam `KpiCard`/`KpiInfoButton` nas telas em
escopo (Dashboard, Publicados, Financeiro, Faturamento/Vendas, Faturamento/Geografia,
DetalheFinanceiro, DetalheVendas) e falha
se algum `label`/`infoKey` renderizado não resolver para uma entrada do dicionário. O uso de
`KpiCard` em `StyleGuide.tsx` (vitrine de componentes, labels de exemplo) fica fora desse teste
— não é tela de produto.

## Achado colateral: divergência de pipeline (fora de escopo, registrar)

Investigação de código (e re-checada linha a linha após revisão do spec, porque a primeira
leitura errou o alcance) confirmou que `"Pedidos"` e `"Ticket médio"` são calculados por **dois
pipelines diferentes**:

- **Dashboard** (`Dashboard.tsx:146-153,301-308`) e **Faturamento/aba-vendas**
  (`aba-vendas.tsx:374,376`) usam `agruparPorPedido()` + `calcularKpisPedidos()`
  (`lib/pedidos-faturamento.ts:104-125,240-243`) — agrupa por pack e decide "faturável" pelo
  status de **uma única linha representante** do pack (a primeira, ordenada por `order_id`).
- **Publicados** (`dashboard-publicados.tsx:76-77`, via `totais.pedidos`/`totais.faturamento`
  vindos de `Publicados.tsx:675`) usa `calcularResumo()` (`lib/resumo-vendas.ts:144-162`) —
  também agrupa por pack, mas decide "faturável" **por linha** antes de agrupar (o pack conta
  como faturável se qualquer linha dele for).

Num pack com uma linha cancelada + uma paga, a linha-representante escolhida por
`agruparPorPedido` pode não ser a mesma condição usada por `calcularResumo` — então o pack pode
ser contado num pipeline e descartado no outro pro mesmo período. Contradiz o que o ADR-0038
promete ("mesmo número em todas as telas"; ADR-0039 introduziu essa divergência deliberadamente
só pra Faturamento, e o Dashboard aderiu depois por conta própria).

**"Markup no período" não faz parte desse achado** — as 3 telas que usam esse label exato
(Dashboard, Publicados, Financeiro) leem todas de `calcularResumo()`; não há divergência ali.
ADR-0055 (fórmula de markup) está implementado corretamente onde é usado; o problema é só
granularidade do filtro "faturável" em `"Pedidos"`/`"Ticket médio"`.

Isto será registrado como nota em `docs/TASKS.md` para priorização futura — não é corrigido
nesta entrega (fora do pedido original, mexeria em lógica financeira sem ADR próprio).

## Validação

- `pnpm lint` + `pnpm test` (incluindo o teste de cobertura do dicionário).
- Verificação manual (dark/light) via browser-use: abrir Dashboard, Publicados, Financeiro,
  Faturamento (Vendas + Geografia), DetalheFinanceiro, DetalheVendas; clicar em cada ícone "i";
  conferir que o popover abre, fecha ao clicar fora, e
  que clicar no ícone **não dispara navegação** nos casos dentro de elemento clicável: Dashboard
  ("Compradores"/"Pedidos"/"Ticket médio"/"Líquido no faturamento", todos com `to`, e os 2
  `HeroVenda`), Publicados ("Faturamento", com `<Link>` externo), Financeiro (hero "Líquido das
  vendas" quando `podeDetalhar` é `true`).

## Limites

- Não adiciona ícone de informação em painéis fora de Publicados (não existem hoje em outras
  telas).
- Não corrige a divergência de pipeline (só documenta).
- Não altera nenhuma fórmula de cálculo existente.
