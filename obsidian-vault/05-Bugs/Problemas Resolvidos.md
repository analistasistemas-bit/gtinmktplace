---
tags: [bugs, resolvidos]
atualizado: 2026-07-09
---

# Problemas Resolvidos

Bugs corrigidos e fechados. Fonte: histórico de commits e `docs/project-history.md`. Ver
[[Incidentes]] (com contexto completo de ADR), [[Bugs Conhecidos]] (o que falta).

## Correções recentes (commits mais recentes na `main`)

- **Markup do Faturamento › Vendas divergia do Dashboard/Publicados/Financeiro (2026-07-09)** —
  +38% no Faturamento vs. +37% nas outras 3 telas, confirmado ao vivo com os mesmos 187
  pedidos/382 unidades (não era filtro/período). Causa: `custoDaVenda` (Dashboard/Publicados/
  Financeiro) somava o custo bruto do pedido inteiro e arredondava 1x no final; `custoDoItem`
  (Faturamento, a "fonte da verdade") arredonda por item antes de somar — como `variacoes.custo`
  é `numeric` sem escala fixa, pedidos multi-item acumulam centavos de diferença entre os dois
  caminhos. Fix: `custoDaVenda` passou a arredondar por item também.
- **"vs. anterior" do filtro "Hoje" (Dashboard/Financeiro) comparava com o pedaço errado de ontem
  (2026-07-06)** — `janelaAnterior()` desloca a janela atual pela sua duração decorrida (certo pra
  presets/range, blocos fechados de N dias); "hoje" cresce o dia todo, então deslocar por poucas
  horas colava a comparação no fim de ontem (ex.: ontem 11h47→meia-noite), perdendo a manhã. Diego
  notou pelo Pedidos: +14% com 8 hoje vs. 11 ontem no dia inteiro, número que não fechava de
  nenhuma forma intuitiva. Fix: "hoje" desloca a janela inteira em 24h (ontem 00:00 → ontem mesma
  hora de agora).
- **KPI "Variações publicadas" (Publicados) subcontava produtos que cresceram em UPDATE (2026-07-06)**
  — mesma causa raiz do fix de busca por código abaixo (2026-07-03): a família **representante** de
  cada anúncio (`dedupePublicados`) é a mais **antiga** por `ml_item_id`; contar `variacoes` só dela
  ignora variações adicionadas em ciclos de UPDATE posteriores. Passou por um número errado por
  contagem duplicada (1268 — somava variações de todas as linhas de família, não só a atual) antes
  de reconciliar. Fix: contar por `anuncios_externos.variacoes_externas` (espelho do worker), não
  pela família. Confirmado ao vivo contra a API do ML: 856 variações em anúncios ativos.
- **Famílias fora dos 4 aviamentos travavam pra sempre em "Categoria indefinida" (2026-07-04,
  ADR-0057/0058)** — o seletor manual de categoria só oferecia linha/fita/botão/cola; qualquer
  produto fora desses 4 tipos (ex.: "BAINHA INSTANTÂNEA 4MT UND", lote 51) ficava bloqueado sem
  saída. Causa raiz: pendência aberta desde o ADR-0022 (11/06) e nunca fechada — cada ADR seguinte
  melhorou o resolver automático e deixou o escape manual intacto. Fix: `CardCategoria` ganha busca
  livre no `domain_discovery` do ML; `definir-categoria-familia` generaliza pra aceitar qualquer
  categoria; categoria do concorrente (já calculada, descartada antes) vira sugestão não-vinculante
  (nunca aplicada sem clique — validado ao vivo que pra bainha ela é "Brinquedos de Pegadinhas",
  confirma o motivo do ADR-0054 de nunca aceitar isso automaticamente). Fecha a "Camada 2 (UI de
  atributos + categoria livre)" que o fix do barbante (lote #49, abaixo) tinha deixado pendente.
  ADR-0058 (mesmo dia): "Outros" vira fallback visível em vez de bloqueio quando não há candidato
  específico algum.
- **Busca da Publicados não achava código de variação de ciclos de UPDATE (2026-07-03)** — buscar
  por código/GTIN de variação (ex.: `01813412`) na tela Publicados dava "Nenhum resultado" para
  **alguns** produtos, mesmo com o fix anterior de `identificadores` (5febb1d). Causa raiz: vários
  ciclos de UPDATE geram várias `familias` com o mesmo `ml_item_id`; `dedupePublicados` (`publicados.ts`)
  elege como representante a família **mais antiga** (preserva a data de publicação original) e a busca
  usava só os `identificadores` dela. Quando a variação buscada nasceu num ciclo posterior (a antiga
  tinha, p.ex., 1 só variação), o código nunca entrava no índice de busca. Fix: `dedupePublicados` passa
  a **unir** os `identificadores` de todas as famílias do grupo, mantendo o representante mais antigo
  para o resto. Teste de regressão trava a invariante.
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
