# Detalhe de vendas (composição do faturamento) + intervalo de datas personalizado

**Data:** 2026-06-19
**Status:** Aprovado (brainstorming) — pronto para plano de implementação
**Relacionado:** [ADR-0032](../../decisions/0032-kpis-publicados-contam-conta-inteira.md) (KPIs contam a conta inteira do ML), [spec dashboard-kpis-publicados](2026-06-17-dashboard-kpis-publicados-design.md), `metricas-vendas`, `_shared/ml/vendas.ts`

## Contexto e problema

A tela **Publicados** mostra KPIs de venda do período (ADR-0032: os totais do topo refletem
toda a conta do ML). Duas lacunas:

1. O card **Faturamento** mostra o total (ex.: R$ 606,80) mas não há como ver **o que o compõe**
   — quais anúncios formaram esse valor.
2. O filtro **"Vendas nos últimos"** só oferece presets fixos (7 / 30 / 90 dias); falta escolher
   um **intervalo de datas livre**.

Como o faturamento é **global** (inclui anúncios publicados fora do PubliAI — ver ADR-0032), a
tela de composição precisa incluir esses anúncios externos para fechar exatamente no total.

## Decisões do brainstorming

| Tema | Decisão |
|---|---|
| Granularidade da composição | **Por anúncio** (título, unidades, valor, % do total). |
| Anúncios fora do PubliAI | **Duas seções** com subtotais: "Seus anúncios (PubliAI)" e "Fora do PubliAI". Fecha no total global. |
| Forma da tela | **Página nova** (rota própria), com botão Voltar. Não é modal/drawer. |
| Período personalizado | 4º botão **"Personalizado"** + dois `<input type="date">` nativos (De / Até). Sem libs novas. |
| Propagação do período | Vai na **URL** da tela de detalhe (`?dias=30` ou `?de=…&ate=…`) — refresh-safe e compartilhável. |
| Fora de escopo (YAGNI) | Drill-down por pedido, exportar, gráfico de série temporal. |

## Arquitetura

### Feature 1 — Intervalo de datas personalizado

**Frontend.**

- Modelo de período generalizado em `src/lib/metricas.ts`:
  ```ts
  export type Periodo =
    | { tipo: 'preset'; dias: PeriodoDias }
    | { tipo: 'range'; desde: string; ate: string }; // ISO (YYYY-MM-DD → dia inteiro)
  ```
  Função `resolverJanela(p: Periodo): { desde: string; ate: string }` centraliza o cálculo
  (preset → `agora − dias` … `agora`; range → início do dia `desde` … fim do dia `ate`).
- `buscarMetricasVendas` passa a receber a **janela já resolvida** (`{ desde, ate }`) em vez de
  só `periodoDias`. A edge function **não muda** (já recebe `desde/ate`).
- `useMetricasVendas` é keyed pela janela resolvida (`['metricasVendas', desde, ate]`), mantendo
  o cache por intervalo.
- `DashboardPublicados`: adiciona o botão **"Personalizado"**. Quando ativo, exibe os dois campos
  De/Até. Estado do período sobe para `Publicados.tsx` (já é quem detém `periodo`).
- Validação: `desde ≤ ate`; default ao abrir o modo custom = janela do preset atual. Intervalos
  muito grandes caem na proteção de dados parciais já existente (teto 2000 pedidos / 25s) e
  mostram o aviso discreto atual.

### Feature 2 — Tela de detalhe de vendas

**Backend** (`_shared/ml/vendas.ts` + tipo canônico):

- `agregarPedidos` passa a acumular **também os itens fora do escopo** (hoje só soma `porItem`
  para itens do escopo). Novo agregado `porItemExterno: Record<id, { unidades, valor }>`.
- `lerVendasML` resolve os **títulos** dos ids externos via `GET /items?ids=…` em lote (mesmo
  padrão resiliente de `lerStatus`: chunks de 20, falha de bloco não derruba) e devolve
  `externos: Array<{ id, titulo, unidades, valor }>`. Falha ao resolver título → usa o id como
  rótulo (não quebra).
- Tipo `MetricasVendasCanal` ganha campo **opcional** `externos?`. O dashboard atual ignora;
  só a tela de detalhe consome. Multicanal preservado (campo canônico, não acoplado ao ML).
- A edge function `metricas-vendas` repassa `externos` na resposta (sem lógica nova).

**Frontend:**

- Rota nova em `App.tsx` (HashRouter): `/publicados/vendas`.
- O card **Faturamento** em `DashboardPublicados` vira um `<button>`/link que navega para
  `/publicados/vendas` carregando o período atual na query string.
- Nova página `src/pages/DetalheVendas.tsx`:
  - Lê o período da URL (`?dias=` ou `?de=&ate=`) e resolve a janela.
  - Reusa `useMetricasVendas(janela)` (cache compartilhado com a tela Publicados) e `usePublicados`
    (para títulos/fornecedor dos anúncios do app).
  - **Resumo** no topo: Faturamento total + quebra "Seus anúncios (PubliAI)" (= `totais` do app,
    soma de `porItem`) vs "Fora do PubliAI" (soma de `externos`), com % de cada.
  - **Seção 1 "Seus anúncios (PubliAI)"**: tabela (Título | Unid. | Valor | % do total), ordenada
    por valor desc, com linha de subtotal. Dados: merge de `porItem` (escopo) com títulos de
    `usePublicados`.
  - **Seção 2 "Fora do PubliAI"**: mesma tabela, a partir de `externos`. Subtotal.
  - Header: título, rótulo do período, botão **Atualizar** (refetch) e **Voltar**.
- Reuso de `table` e `badge` existentes; sem libs novas.

### Layout (referência)

```
Detalhe de vendas                          [período]  [Atualizar] [Voltar]

Faturamento total .................. R$ 606,80   ·   24 pedidos
  ├─ Seus anúncios (PubliAI) ...... R$ 417,50  (68,8%)
  └─ Fora do PubliAI .............. R$ 189,30  (31,2%)

Seus anúncios (PubliAI)
Título                         | Unid. |   Valor   | % total
…                              |   2   | R$ 90,20  | 14,9%
Subtotal                       |  23   | R$ 417,50 | 68,8%

Fora do PubliAI (publicados direto no ML)
Título                         | Unid. |   Valor   | % total
Fita De Cetim Progresso 15…    |   5   | R$ 62,50  | 10,3%
Subtotal                       |  13   | R$ 189,30 | 31,2%
```

**Contagem de pedidos:** exibida só no total (ex.: 24), não por seção. Unidades e valor somam
exatamente entre as seções; o nº de pedidos **não** é particionável sem ambiguidade (um pedido
pode tocar um anúncio do app e um externo ao mesmo tempo, entrando nas duas seções). Por isso as
seções mostram subtotais de **unidades e valor**, e o total de pedidos fica no resumo do topo.

## Componentes (limites e responsabilidades)

- `lib/metricas.ts` — modelo `Periodo`, `resolverJanela`, `buscarMetricasVendas(janela)`. Puro/IO.
- `_shared/ml/vendas.ts` — `agregarPedidos` (puro; testável: agora também agrega externos) e
  `lerVendasML` (IO; resolve títulos externos).
- `DashboardPublicados` — seletor de período (presets + custom) e card Faturamento clicável.
- `DetalheVendas.tsx` — composição visual; sem lógica de rede própria (reusa hooks).

## Erros e estados

- **Sem credencial ML**: tela de detalhe mostra cards zerados + banner (igual Publicados).
- **Falha ao resolver título externo**: usa o id como rótulo; não quebra a tela.
- **Dados parciais** (rate-limit/timeout em intervalo grande): aviso discreto já existente.
- **Período inválido na URL** (`de > ate` ou ausente): cai no default de 30 dias.

## Testes

- `agregarPedidos`: novo caso garantindo que itens fora do escopo aparecem em `porItemExterno`
  com unidades/valor corretos, sem poluir `porItem` (estende a suíte existente em
  `_shared/ml/__tests__/vendas.test.ts`).
- `resolverJanela`: preset → janela `agora−dias`; range → dia inteiro `desde`..`ate`; borda
  `desde === ate` (um dia).
- Render de `DetalheVendas` com mock de métricas: dois subtotais corretos e soma = total.

## Critérios de sucesso

1. Clicar em **Faturamento** abre `/publicados/vendas` mostrando a composição por anúncio.
2. As duas seções somam **exatamente** o faturamento do card (app + externo = total global).
3. O período selecionado (preset ou intervalo) é refletido na tela de detalhe e em refresh.
4. O seletor de período ganha **"Personalizado"** com De/Até; trocar reconsulta cards + tela.
5. Sem credencial ML, nenhuma tela quebra.
6. Nenhuma dependência nova adicionada.

## Base e logística

Decisão do Diego: **o Financeiro (WIP não-commitado na worktree `financeiro-recebivel`) será
commitado/integrado primeiro**; só então este trabalho ramifica da `main` atualizada. A
implementação fica bloqueada até esse sinal. As mudanças aqui são majoritariamente aditivas
(rota, página e campo opcional no backend); o único arquivo com sobreposição potencial é
`Publicados.tsx` (banner do Financeiro vs. seletor de período).
