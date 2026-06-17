# Dashboard de KPIs de venda na tela Publicados

**Data:** 2026-06-17
**Status:** Aprovado (brainstorming) — pronto para plano de implementação
**Relacionado:** ADR-0024 (camada de abstração de canais), ADR-0025 (modelo multicanal `anuncios_externos`), `status-publicados`

## Contexto e problema

A tela **Publicados** lista os anúncios do usuário com status/estoque/preço ao vivo (via conector de canal, `lerStatus`), mas **não mostra nenhum dado de venda**. O operador (Diego) não consegue, dentro do app, responder "quanto vendi", "o que mais sai" e "o que está encalhado". O pedido tem três frentes:

1. Um **dashboard de KPIs de venda** no topo da tela.
2. A coluna **Fornecedor** deve exibir só o primeiro nome (ex.: `DETALLIA FITAS TEXTEIS LTDA` → `DETALLIA`).
3. Cada linha de produto deve mostrar **quantidade e valor vendido**.

Restrição estratégica: **outros marketplaces entrarão em breve** (Shopee é o próximo épico). O desenho precisa ser multicanal por construção, não um retrofit.

## Decisões do brainstorming

| Tema | Decisão |
|---|---|
| Recorte de tempo | **Período selecionável**: 7 / 30 / 90 dias. Fonte: `/orders` do ML (valor e data reais). |
| KPIs do topo | **Todos os 4 blocos**: Vendas no período; Saúde dos anúncios; Encalhados; Rankings (top produtos). |
| Visitas/conversão | **Fora de escopo** por agora (pode somar depois sem retrabalho). |
| Atualização | **On-demand + botão Atualizar**; cache no cliente (React Query). Sem cache server-side no MVP. |
| Multicanal | **Estrutura de dados pronta** (métricas por canal no backend); **UI sem seletor** de canal enquanto só houver ML. |
| Fornecedor | Exibir **1ª palavra** na tabela/cards (nome completo no tooltip); **filtro e ordenação seguem pelo nome real**. |
| Layout | Cards de KPI **no topo da própria tela Publicados**, acima da tabela; tabela ganha 2 colunas. |

## Arquitetura

### Backend (multicanal por design)

**1. Novo método no contrato de canal** (`_shared/canais/contrato.ts`):

```ts
export interface MetricasVendasCanal {
  porItem: Record<string, { unidades: number; valor: number }>; // itemExternoId → agregado
  totais: { faturamento: number; unidades: number; pedidos: number };
}

interface ChannelConnector {
  // …existentes…
  /** Agrega vendas do período (inclusive ambos os limites). Lança se o token falhar. */
  lerMetricasVendas(
    ctx: ContextoCanal,
    intervalo: { desde: string; ate: string }, // ISO 8601
    itemExternoIds: string[],                   // escopo: só anúncios gerenciados pelo app
  ): Promise<MetricasVendasCanal>;
}
```

**2. Adapter Mercado Livre** (`_shared/ml/vendas.ts`, ligado em `canais/mercado-livre.ts`):
- Varre `GET /orders/search?seller={id}&order.status=paid&order.date_created.from={desde}&order.date_created.to={ate}` com paginação (`offset`/`limit`, máx 50/página) até esgotar.
- Para cada pedido, percorre `order_items`: soma `quantity` (unidades) e `quantity × unit_price` (valor) por `item.id`.
- **Escopo**: agrega apenas os `item.id` presentes em `itemExternoIds` (anúncios do app). Pedidos de itens fora do app são ignorados — os KPIs refletem o catálogo do PubliAI.
- `totais` = soma dos itens no escopo; `pedidos` = nº de pedidos distintos que tocaram ≥1 item do escopo.
- Resiliência/timeout: `AbortSignal.timeout`, e erro de página interrompe com o que já agregou (não derruba a tela). Rate-limit (429) → para a varredura e retorna parcial marcando incompleto (ver "Erros").

**3. Nova edge function `metricas-vendas`** (espelha `status-publicados`):
- `requireUser` (JWT) → busca `ml_item_id` distintos do user em `familias` → resolve o conector `mercado_livre` → chama `lerMetricasVendas(ctx, intervalo, ids)`.
- Body: `{ desde, ate }` (o front calcula a partir do período escolhido).
- Resposta: `{ totais, porItem }`. Sem credencial ML → `{ semCredencialML: true, totais: zerados, porItem: {} }`.
- `verify_jwt=false` (valida o Bearer internamente, como as demais).

### Frontend

**4. `src/lib/metricas.ts`** — tipo `MetricasVendas` + função `buscarMetricasVendas(periodoDias)` (fetch autenticado, calcula `desde/ate`). `periodoDias ∈ {7,30,90}`.

**5. `src/hooks/useMetricasVendas.ts`** — React Query keyed por período; `staleTime` de alguns minutos; exposto `refetch`/`isFetching` para o botão Atualizar (compartilha o botão com o refresh de status).

**6. `src/components/dashboard-publicados.tsx`** — recebe `metricas`, `publicados` (com status merge) e o período/handler. Renderiza:
- **Vendas**: Faturamento (R$), Unidades, Nº de pedidos, Ticket médio (faturamento ÷ pedidos; 0 se pedidos=0).
- **Saúde**: ativos / total; nº com problema (status ∈ {moderado, inativo, pausado}). Reusa o status já carregado.
- **Encalhados**: anúncios `ativo` com `porItem[id].unidades` ausente/0 no período.
- **Rankings**: top 5 por faturamento e por unidades (lista compacta com título + número), a partir de `porItem`.
- Seletor de período **7/30/90** (default 30).

**7. Tabela (`Publicados.tsx` + `lib/publicados.ts`)**:
- Merge das métricas por `ml_item_id` em `PublicadoItem` (campos `unidadesVendidas?`, `valorVendido?`), análogo ao merge de status.
- Duas colunas novas **Unidades vendidas** e **Valor vendido**, ordenáveis (`ColunaOrdenavel` + `chaveOrdenacao`). Nulos vão para o fim (regra existente).
- **Fornecedor**: nova função pura `primeiroNome(fornecedor)` em `lib/publicados.ts` (primeira palavra antes do espaço, preservando o original). Exibição usa `primeiroNome`, com `title={fornecedor}` (tooltip). `filtrarPublicados`/`ordenarPublicados` e a lista do `<Select>` de fornecedores continuam usando o **nome completo**.

### Multicanal

O método e os tipos são canônicos (`MetricasVendasCanal`), não acoplados ao ML. Quando um 2º canal entrar, ele implementa `lerMetricasVendas` e a edge function passa a agregar por canal; a UI ganha o seletor então. Nada no front fica preso a "Mercado Livre".

## Fora de escopo (YAGNI)

- Visitas e taxa de conversão (visitas→vendas).
- Cache server-side (Redis/cron) — só se o on-demand ficar lento.
- Seletor visível de canal enquanto houver apenas ML.
- Histórico/série temporal de vendas (gráfico de linha) — só os agregados do período.

## Erros e estados

- **Sem credencial ML**: dashboard mostra os cards zerados + o banner atual "Conecte sua conta ML"; colunas de venda ficam `—`.
- **Falha/parcial na varredura de orders** (rate-limit, timeout): retorna o que agregou e o front sinaliza discretamente que os números podem estar incompletos ("dados parciais — tente Atualizar"). Não derruba a tabela.
- **Período sem vendas**: cards em zero; "Encalhados" tende a 100% dos ativos — comportamento correto.

## Critérios de sucesso

1. Com credencial ML, ao abrir Publicados e escolher um período, os cards mostram faturamento/unidades/pedidos/ticket coerentes com os pedidos `paid` do período, **restritos aos anúncios do app**.
2. Cada linha mostra unidades e valor vendido do período; colunas ordenáveis.
3. Fornecedor aparece como 1ª palavra; filtro por fornecedor continua exato.
4. Trocar 7/30/90 reconsulta e atualiza cards + colunas; botão Atualizar força refetch.
5. Sem credencial ML, a tela não quebra (cards zerados + banner).
6. `lerMetricasVendas` está no contrato de canal (não em código específico de ML no front), pronto para um 2º marketplace.
