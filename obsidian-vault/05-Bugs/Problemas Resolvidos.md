---
tags: [bugs, resolvidos]
atualizado: 2026-07-01
---

# Problemas Resolvidos

Bugs corrigidos e fechados. Fonte: histórico de commits e `docs/project-history.md`. Ver
[[Incidentes]] (com contexto completo de ADR), [[Bugs Conhecidos]] (o que falta).

## Correções recentes (commits mais recentes na `main`)

- **Markup por produto divergente: Detalhe de vendas × Detalhe do pedido (2026-07-03)** — o mesmo
  produto mostrava markups diferentes (ex.: cód. 03096963 → +843% no Detalhe de vendas vs +592% no
  Detalhe do pedido). Causa raiz: `montarDetalheVendas` (`detalhe-vendas.ts`) rateava o líquido **por
  linha de order_id**; num pack com um order_id por produto, o item leve/barato (fita) ficava com o
  líquido inteiro do seu order_id (frete rateado por peso quase não pesa nele) e inflava o markup. Fix:
  poolar o líquido por **pack** (`pack_id ?? order_id`) e redistribuir por valor bruto com o mesmo
  `round2` por item do `agruparPorPedido` (menu Faturamento, fonte da verdade — ADR-0055). Markup por
  produto passa a bater 1:1 entre as telas; teste de regressão trava a invariante.
- **Barbante recusado por atributo/tipo (lote #49, ADR-0051)** — "BARBANTE" não estava na regex de
  `linha` → caía em `tipo='outro'`; o preditor do ML acertava a categoria (MLB270273, Fios e Cadarços)
  mas o código fixava `tipo='outro'`, então `BRAND`/`MODEL` nunca eram montados e o ML recusava. Fix:
  `barbante` na regex + `tipoParaCategoria` (deriva o tipo da categoria do preditor) + `process-familia`
  monta obrigatórios curados para todo tipo conhecido. **Robustez SaaS** junto: caminho genérico nunca
  publica sem validar (schema/IA falha → trava na Revisão com sentinela, não vai quebrado ao ML) e
  `COLOR` deixa de ser falso-faltante. Camada 2 (UI de atributos + categoria livre) pendente. As 3
  famílias do #49 reprocessadas e prontas.
- **Frete no preço sugerido (PRÓPRIO)** — o gross-up só descontava a comissão; o preço
  sugerido do ramo próprio agora cobre comissão **+ frete grátis** do vendedor, garantindo
  o líquido mínimo (PRECO da planilha). O semáforo do item passou a considerar as dimensões
  e concorda com o da família. No competitivo o preço segue puro mercado por design (o
  semáforo avisa). Lote #49: R$19,80 → R$27,45 (ADR-0050).
- **GTIN de comprimento inválido tratado como ausente** — GTIN com tamanho fora do padrão
  passou a ser rejeitado como se não existisse, em vez de propagar um valor inválido.
- **Fabricante (MANUFACTURER) preenchido na categoria genérica** — atributo estava faltando na
  publicação (lote #48).
- **Cor + metragem separada** — planilha com "10 mt" no nome estava virando cor errada (lote #48).
- **Comprador real nas vendas (Faturamento)** — ver [[Incidentes]] (nome do comprador: mascaramento
  intermitente do ML + regressão do fallback, 2026-07-01).
- **Divergência de `verify_jwt` no faturamento (ADR-0046)** — ver [[Incidentes]] (webhooks/workers
  rejeitados com 401 antes de rodar, faturamento em tempo real parado, 2026-06-28).
- **Contagem de pedidos por pack** — Financeiro/Publicados contavam por `order_id` em vez de por
  pack, gerando divergência entre as duas telas.
- **Markup/custo por pacote** — inconsistência entre telas no cálculo de KPI.

## Da linha do tempo do projeto (`docs/project-history.md`)

- **Busca de concorrência** — `/sites/MLB/search` retornava `403` (descontinuado pelo ML);
  recalibrado para usar `/products/search` → `/products/{id}/items` (ADR-0014, adendo).
- **Foto-capa `CAPA_`** — corrigida no ingest; depois `CAPA2_` e `CAPA3_` incorporadas.
- **Lotes travados em `processando`** — corrigidos para transicionar corretamente para `revisao`.
- **`EMPTY_GTIN_REASON`, descrição separada, fotos por variação** — ajustados em bug bash real.
- **UPDATE de descrição para cores novas** — corrigido para refletir a mudança.
- **Atributo `IS_DOUBLE_FACE` de fitas** — corrigido.
- **Cor falsa por descrição incidental ("Multicolor")** — corrigida.
- **Permissão `/orders`** — estava bloqueada (mesma classe de `/moderations`); confirmado
  posteriormente que voltou a funcionar (ver ADR-0037).

## Incidentes já corrigidos com detalhe completo

Ver [[Incidentes]]: título duplicado (ADR-0044), foto assíncrona travando publicação (ADR-0033),
vinculação de catálogo com ficha de kit (ADR-0021), moderação sem alerta (ADR-0035), lote #41
com erro genérico (ADR-0030), divergência de `verify_jwt` no faturamento (ADR-0046), nome do
comprador (mascaramento intermitente do ML + regressão do fallback).
