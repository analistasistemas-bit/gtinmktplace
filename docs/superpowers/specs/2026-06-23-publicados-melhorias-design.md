# Design — Melhorias no menu Publicados

**Data:** 2026-06-23
**Branch:** `worktree-publicados-melhorias`
**Autor:** Diego (+ assistente)

## Contexto

O menu **Faturamento** foi construído como referência de UX (vendas pedido a pedido, devoluções e
perguntas num lugar só, com filtro de período, indicador "Ao vivo" e markup). Este trabalho leva os
mesmos padrões ao menu **Publicados** e à sua tela de **Detalhe de vendas** (`/publicados/vendas`),
além de tornar acionável o KPI de encalhados.

Diagnóstico do estado atual (já em produção):

- A tela **Detalhe de vendas** (`/publicados/vendas`) consolida vendas por produto, mas:
  - O período só é herdado pela URL — **não há seletor** na própria tela (só um texto "últimos N dias").
  - Mostra faturamento e composição, mas **não mostra markup nem lucro por produto**.
  - Tem botão "Atualizar" estático, embora as vendas já façam polling de 45s (`useVendas`).
- A **lista Publicados** (dashboard) já tem KPIs (Faturamento, Unidades, Pedidos, Ticket, Markup %),
  card de **Encalhados** (ativos sem venda no período) e Top produtos, mas:
  - O card **Encalhados não é clicável** — não dá para filtrar a lista só nos encalhados.
  - Há **Markup %**, mas **não há Lucro em R$** (markup não revela o tamanho do lucro).

A infraestrutura de cálculo já existe e é reaproveitada: `ratearLiquidoPorFrete` (líquido por
pedido, com rateio de frete de pack — ADR-0039), rateio do líquido por item (como em
`agruparPorPedido`), `CustoResolver`/`PesoResolver` (`custos.ts`), e `calcularMarkup` (`markup.ts`).
O custo real do produto vem de `variacoes.custo` (nunca `familias.custo_centavos`).

## Decisões fechadas

1. **Markup por produto = média ponderada pelo valor**, não média aritmética: `(Σ líquido_item −
   Σ custo_item) / Σ custo_item` no período. É o markup real do produto e **bate com o número
   consolidado** da tela Publicados (mesma fórmula, mesmo líquido rateado).
2. **"Ao vivo" só no Detalhe de vendas**, não na lista. Motivo: o Detalhe mostra **só vendas**, que
   já fazem polling real de 45s — a bolinha é honesta e idêntica ao Faturamento, sem nenhuma chamada
   extra à API do ML. A **lista** mistura vendas (ao vivo) com estoque/preço/status do ML (sem
   polling); ali a bolinha seria enganosa, então mantém o botão "Atualizar".
3. **Sem polling de status do ML** (estoque/preço/status). Evita pressão na API do ML (risco de
   `429` afetar publicação/sincronização). Esses dados continuam atualizando ao abrir a tela
   (respeitando o cache de 5 min do React Query) e no refresh manual.
4. **Sem KPI de markup no topo do Detalhe de vendas** (já existe na tela Publicados). O markup/lucro
   aparece **linha a linha** por produto.

## Escopo

### A. Detalhe de vendas (`/publicados/vendas`)

**A1. Seletor de período na tela.** Extrair o seletor 7/30/90/custom (hoje duplicado em
`dashboard-publicados.tsx` e no Faturamento) para um componente reutilizável e usá-lo aqui. Trocar o
período **escreve na URL** (`setSearchParams(periodoToParams(...))`), mantendo o link compartilhável
e disparando o refetch.

**A2. Colunas Markup (%) e Lucro (R$) por produto.** Enriquecer `montarDetalheVendas` para receber
`custoResolver` + `pesoResolver` e calcular, por produto:
- `markup` = `(Σ líquido_item − Σ custo_item) / Σ custo_item` (null se nenhum item com custo).
- `lucro` = `Σ líquido_item − Σ custo_item` (sobre itens com custo).
- O líquido por item usa o **mesmo rateio** do Faturamento (`ratearLiquidoPorFrete` → líquido por
  pedido → rateio por valor bruto do item), garantindo consistência com o consolidado.
- Duas colunas novas na tabela, **ordenáveis**, formato `+120%`/`−5%` (verde/vermelho) e `fmtBRL`,
  **"—"** quando sem custo.
- Valem **só na seção "Seus anúncios (PubliAI)"**. Na seção "Fora do PubliAI" não há custo
  cadastrado → colunas mostram "—".
- O **subtotal (footer)** de cada seção mostra lucro somado e markup ponderado da seção.

**A3. Indicador "Ao vivo" + refresh.** Trocar o botão "Atualizar" pelo bloco do Faturamento: bolinha
verde piscando (`animate-ping` durante fetch, pulso lento entre ciclos) + "Ao vivo" + botão de
refresh ao lado. Mantém o "Voltar". Usa `isFetching`/`refetch` do `useVendas`.

### B. Lista Publicados (dashboard)

**B1. Card "Encalhados" clicável.** Vira um **toggle** que filtra a tabela para mostrar só ativos
sem venda no período. Persistido na URL (`?encalhados=1`). Um clique liga, outro desliga. "Encalhado"
depende do período ativo (sem venda *naquele* período), então o filtro respeita o 7/30/90 escolhido.

**B2. Novo KPI "Lucro no período (R$)".** Exibir ao lado do Markup. O valor já é calculado
(`calcularResumo` retorna `lucro`); só não era exibido.

### Fora de escopo (não fazer agora)

- Menu **Faturamento** fica **intacto**.
- Card "Com problema" clicável (mesmo mecanismo do encalhados; adicionável depois se desejado).
- KPI de Margem % (redundante com markup para decisão).
- Valor imobilizado em encalhados (estoque × custo) — fase 2.
- Polling de estoque/preço/status do ML.

## Arquivos

| Arquivo | Mudança |
|---|---|
| `src/components/ui/seletor-periodo.tsx` | **novo** — seletor 7/30/90/custom controlado (`periodo` + `onPeriodo`) |
| `src/lib/detalhe-vendas.ts` | markup + lucro ponderados por produto; campos `markup`/`lucro` em `LinhaVenda` e `SecaoVendas` |
| `src/pages/DetalheVendas.tsx` | seletor na tela (escreve URL) + colunas Markup/Lucro (ordenáveis) + "Ao vivo" |
| `src/components/dashboard-publicados.tsx` | usa o seletor extraído; novo KPI Lucro R$; card Encalhados clicável |
| `src/pages/Publicados.tsx` | aplica o filtro de encalhados (toggle) à lista |
| `src/lib/publicados.ts` | critério `somenteEncalhados` em `FiltroPublicados` + `filtrarPublicados` |
| `src/lib/publicados-url.ts` | serializa/deserializa `encalhados` na URL |

## Componentes e contratos

**`SeletorPeriodo`** (`src/components/ui/seletor-periodo.tsx`)
- Props: `{ periodo: Periodo; onPeriodo: (p: Periodo) => void; carregando?: boolean }`.
- Rende presets 7/30/90 + "Personalizado" com inputs de data (rascunho local; aplica no OK).
- Reusa `resolverJanela`/`periodoToParams` de `metricas.ts`. Não conhece URL nem query — puro
  controlado. O consumidor decide se persiste em estado, URL ou ambos.
- Migra `dashboard-publicados.tsx` (mesmo menu) para ele. **Não** toca no Faturamento.

**`montarDetalheVendas`** (`src/lib/detalhe-vendas.ts`) — nova assinatura
- `montarDetalheVendas(vendas, custoResolver?, pesoResolver?): DetalheVendas`.
- `LinhaVenda` ganha `markup: number | null` e `lucro: number | null`.
- `SecaoVendas` ganha `lucro: number` e `markup: number | null` (consolidado da seção).
- Mantém comportamento atual de agrupamento por `ml_item_id`, separação PubliAI/externo e `valor`
  bruto exibido. O markup/lucro usam **líquido rateado** (não o `valor` bruto).

**`DetalheVendas.tsx`**
- Período vira controlado via `useSearchParams` (lê **e** escreve). `onPeriodo` → `setSearchParams`.
- Passa `useCustos()` resolvers a `montarDetalheVendas`.
- `SortKey` ganha `'markup'` e `'lucro'`.

**Filtro de encalhados** (`publicados.ts` / `publicados-url.ts` / `Publicados.tsx` / dashboard)
- `FiltroPublicados.somenteEncalhados?: boolean`.
- `filtrarPublicados`: quando ligado, mantém só `status === 'ativo' && (unidadesVendidas ?? 0) === 0`.
- URL: `encalhados=1`. Card no dashboard alterna o valor (clique → toggle).

## Testes (TDD)

`detalhe-vendas.ts` é função pura — alvo principal de testes (Vitest, fixtures `Venda` no padrão de
`faturamento.test.ts`):
- Markup/lucro por produto com custo → bate com `(Σ líquido − Σ custo)/Σ custo`.
- Produto sem custo → `markup`/`lucro` null (exibe "—").
- Pack com frete compartilhado → líquido rateado por peso reflete no markup por produto (não infla
  um produto e zera outro).
- Seção "Fora do PubliAI" → sem markup/lucro.
- Subtotal da seção → soma de lucro e markup ponderado coerentes.

`filtrarPublicados` com `somenteEncalhados`:
- Mantém só ativos com 0 venda; remove ativos com venda e não-ativos.

## Critérios de sucesso

1. No Detalhe de vendas, o operador troca 7/30/90/custom **na própria tela** e a URL acompanha.
2. Cada produto mostra **markup e lucro** consistentes com o consolidado da tela Publicados.
3. O Detalhe de vendas tem bolinha **"Ao vivo"** + refresh, sem chamadas extras à API do ML.
4. Um clique no card **Encalhados** filtra a lista só nos encalhados do período.
5. A lista exibe **Lucro em R$** do período ao lado do Markup.
6. `pnpm test` verde; Faturamento inalterado.
