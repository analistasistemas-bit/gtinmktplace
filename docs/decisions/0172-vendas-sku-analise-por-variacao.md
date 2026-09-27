# ADR-0172 — Vendas SKU: análise de vendas por variação, com história e coleta diária

**Status:** Proposto
**Data:** 2026-09-26
**Relacionado:** [ADR-0039](0039-faturamento-por-pedido-geografia-kpis.md) (revoga o "ranking de produto /
curva ABC fora de escopo"), [ADR-0047](0047-operacao-compartilhada-rbac-menu.md) (permissão por menu),
[ADR-0055](0055-imposto-por-origem-nacional-importado.md) (imposto), [ADR-0081](0081-corte-de-egress-url-assinada-persistida.md) (egress),
[ADR-0106](0106-devolucao-conta-no-periodo-do-estorno.md) (devolução no período do estorno),
[ADR-0109](0109-custo-congelado-por-venda.md) (custo congelado), [ADR-0119](0119-pulse-inteligencia-de-mercado-dirigida.md) /
[ADR-0140](0140-sonar-ean-analise-completa-pela-busca.md) (busca do ML fechada; Apify),
[ADR-0150](0150-margem-um-rotulo-e-um-simulador-no-pulse.md) (Margem s/ venda × Markup)
**Spec:** [2026-09-26-vendas-sku-design](../superpowers/specs/2026-09-26-vendas-sku-design.md)

## Contexto

O Faturamento responde "quanto vendi" por pedido. Não responde "quais produtos sustentam o resultado" nem
"o que aconteceu com este produto desde que começou a vender". O benchmark (Mercado Turbo, *Vendas por SKU*,
visitado em 2026-09-26) entrega só um ranking de faturamento bruto do período: sem eixo de tempo, sem
custo/lucro, sem comparação de períodos, com canceladas somadas ao total. O PubliAI já tem os dados que
faltam lá: custo congelado em 99,7% dos itens desde jun/2026, imposto por origem, devoluções, estoque e
promoções.

Medido em 2026-09-26: a Avil tem vendas no PubliAI a partir de **jun/2026** (101 · 740 · 1.134 · 1.288
pedidos/mês); `ml_vendas_itens.codigo` está preenchido em 99,9% dos itens.

O ADR-0039 deixou "ranking de produto, curva ABC" fora do Faturamento. Este ADR revoga esse trecho.

## Decisão

### D-1 — A unidade é a variação (`codigo`), com agrupamento por família
A análise segue o código, que atravessa republicação (MLB novo), canal e custo. Nunca o MLB. A lista pode
ser **agrupada por família**, que soma as variações e continua mostrando cada uma.

Chave = `ml_vendas_itens.codigo`. Título, foto, família e estoque vêm da **família mais recente** do
`(org_id, codigo)`, a mesma âncora do estoque canônico e do Publicados (ADR-0025). Cada reimportação cria
família nova com o mesmo código, então um join simples multiplicaria linhas. Medido em 2026-09-26: 99,9% dos
itens vendidos têm o código de uma variação real e nenhum tem o código pai. Item sem código cai numa linha
"sem código" e nunca é descartado. Kit vinculado aparece sob o próprio código. Kit Virtual aparece nos
componentes (o ML gera um pedido por componente).

### D-2 — A história começa na entrada da organização no PubliAI
Sem backfill de pedidos anteriores. A tela diz a partir de quando conta ("histórico desde jun/2026").

### D-3 — Lucro é o protagonista; dois percentuais com o denominador no nome
Ranking e Curva ABC ordenam por **lucro** (líquido − custo congelado) por padrão, com troca para
faturamento ou unidades. Ao lado aparecem **Markup** (`lucro ÷ custo`) e **Margem s/ venda**
(`lucro ÷ preço de venda`), com os nomes do ADR-0150.

O lucro é calculado **por item**, não por pedido. Assim, um pack com custo em só parte dos itens não infla o
lucro. A regra de custo é a da aba Vendas, mas visível. Com custo congelado, vale ele. Sem congelado, vale o
custo atual do cadastro, marcado **"custo estimado"**. Sem nenhum custo, o lucro fica vazio e o SKU sai do
ranking por lucro. SKU com parte das vendas sem custo mostra **"lucro parcial"**. Um KPI mostra o **% do
faturamento com custo real**.

**Todo produto tem que ter custo** (Diego, 2026-09-26). SKU sem custo é alerta de primeira classe, e não só
uma nota:
- uma faixa no topo da aba ("N SKUs sem custo · R$ X de faturamento sem lucro calculado");
- um filtro "sem custo";
- um selo na linha.

### D-4 — Mesma regra da aba Vendas para o dinheiro; taxa de devolução por coorte
O dinheiro segue `ehFaturavel` e o ADR-0106 (estorno no período em que aconteceu). A soma de todos os SKUs
de um período é igual ao total da aba Vendas no mesmo filtro, por construção (D-5).

A **taxa de devolução** olha as vendas do período: dos pedidos do SKU vendidos no período, quantos foram
devolvidos, qualquer que seja a data do estorno. É contada em pedidos, porque a devolução parcial não informa
a quantidade. A devolução chega ao SKU pelo pedido, porque no ML 1 pedido = 1 item (medido em 2026-09-26:
4.211 de 4.211). Medido também: 161 de 175 devoluções casam com um pedido. Devoluções de carrinho e de envio
sem pedido vão para "devolução não atribuída". Hoje `pedidos-faturamento.ts` joga o estorno inteiro no 1º
item do pedido, o que é indiferente com 1 item por pedido.

### D-5 — Cálculo no navegador, sobre os itens da aba Vendas
O ranking agrupa por SKU os **itens que `agruparPorPedido` já produz** (`src/lib/pedidos-faturamento.ts`), a
mesma fonte da aba Vendas, do Financeiro, do Dashboard e da Geografia. Não existe fórmula nova de lucro, nem
em SQL nem em TS. A soma bate com a aba Vendas por construção. A paginação (teto de 1.000 linhas) e o cache já
existem em `useVendas`. O período carregado estica para trás o necessário para a tendência (60 dias). O
dossiê (Fatia 2a) busca um SKU só. Migrar para agregação no banco só se uma org passar de ~10 mil pedidos no
período. Revisão Codex (GPT-6 Astra) de 2026-09-26: uma RPC seria a 3ª implementação de comissão, frete,
imposto por UF e custo. Permissão herdada do menu Faturamento (ADR-0047). A aba vive em
`/faturamento?aba=sku` e o dossiê em `/faturamento/sku/:codigo` (família:
`/faturamento/sku/familia/:codigo_pai`).

### D-6 — Coleta diária nova, só leitura no ML
Três séries diárias por anúncio próprio, gravadas pelo PubliAI:
- **Visitas** (API oficial `items/{id}/visits/time_window`), com carga inicial de até 150 dias. Com as vendas,
  dá a **conversão**.
- **Preço diário** (foto do preço do próprio anúncio). Só daqui para frente; o passado vem do preço
  praticado nas vendas.
- **Ads** (Product Ads), **condicionado a um spike**: permissão do app e uso real pelas orgs.

**Posição na busca** fica condicionada a um spike de custo. A busca oficial está fechada para nós
(ADR-0119), o caminho é Apify pago por consulta e exige uma palavra-chave por SKU. Nada é ligado antes de o
custo mensal medido ser aprovado pelo Diego.

Nenhuma coleta escreve no ML.

### D-7 — Limites de tendência e risco fixos na v1
Tendência (30 dias contra os 30 anteriores: ±20%, mínimo de 5 unidades), cobertura < 15 dias e devolução
> 5% (com ≥ 20 pedidos) são constantes no código, sem tela de configuração. Recalibrar com dado real.

## Consequências

- Um percentual novo ("Margem s/ venda") passa a existir fora do Pulse. É o mesmo nome e a mesma conta do
  ADR-0150, não um quinto cálculo de margem.
- A história da Avil começa com ~4 meses. Cresce sozinha.
- Promoção é evento **aproximado** na linha do tempo: guardamos o estado atual do item na campanha, não quando
  entrou ou saiu.
- As séries diárias criam tabelas e crons novos (migration + worker QStash com `verify_jwt=false`),
  entregues na Fatia 2b.
- Entrega: Fatia 1 (aba) → 2a (dossiê com dados existentes) → 2b (visitas, conversão, preço diário) → 2c
  (Ads e posição, após spikes) → 3 (recompra, exportação, ações).

## Alternativas descartadas

- **Unidade = família ou MLB:** o MLB muda na republicação e quebra a história; a família esconde qual cor
  puxa a venda.
- **Backfill de pedidos antigos:** Diego preferiu começar na entrada no PubliAI.
- **Ranking por faturamento (como o benchmark):** coloca no topo SKU que fatura e dá prejuízo.
- **Agregar no banco (RPC):** reescreveria em SQL comissão, frete rateado, imposto por UF e custo, uma 3ª
  fórmula que exigiria teste de paridade permanente com a aba Vendas.

## Nota — Fatia 2a: Dossiê do SKU (2026-09-27)

Entregue o **Dossiê do SKU** (`/faturamento/sku/:codigo` e `/faturamento/sku/familia/:codigoPai`), que
aprofunda a linha do ranking (D-1) num histórico completo: KPIs do período, série semanal/mensal com
eventos, estoque (com Kit Virtual vinculado), devoluções, vendas por UF, mix da família e situação nas
campanhas. Duas RPCs novas seguem a mesma linha de D-5 (cálculo no navegador; a RPC só **seleciona**,
nunca soma dinheiro): `vendas_sku_dossie_ids` devolve os ids de `ml_vendas` do código pedido **mais** todo
membro do mesmo pack/envio — para o rateio de frete de `agruparPorPedido` bater com a aba Vendas quando o
navegador reagrupa o pedido inteiro — e `vendas_sku_mlbs` devolve o vínculo de cada MLB (exato/
compartilhado/não resolvido), para a UI nunca inventar de qual anúncio uma venda saiu.

**Validação real (T10):** paridade confirmada (conta VALIDATION/org DSA, SKU 00000029, período
Personalizado 01–31/08/2026): Faturamento R$ 9.683,21 e Lucro R$ 1.173,72 idênticos entre o ranking da
Vendas SKU e os KPIs do Dossiê — os ids do dossiê foram calculados por SQL read-only com a mesma lógica
da RPC (`vendas_sku_dossie_ids` ainda não existe em produção) e injetados via mock de rede. Medição de
carga contra produção (SKU de maior volume da Avil, código `02989271`, 648 itens de venda → 708 ids após
expansão de pack) achou o `EXPLAIN` do `OR` de 3 `IN` **não usando** os dois índices parciais novos
(`ml_vendas_org_pack_idx`/`ml_vendas_org_shipping_idx`) — o planner resolve pelo índice de `org_id` já
existente e aplica o `OR` como filtro pós-scan. Rápido hoje (~13 ms, tabela pequena); se a carga crescer,
o remédio é trocar o `OR` por `UNION` das três consultas (registrado como melhoria futura, não bloqueante).
Migration `20260927045118_vendas_sku_dossie.sql` aplicada só localmente (Ruling 2a-1, sem `db push` nesta
fatia). **Status continua Proposto:** falta `db push`, revisão final e merge.

## Nota — Fatia 2b: Tráfego e oferta (2026-09-27)

Entregue a primeira parte de D-6: **visitas por dia** e **preço de oferta observado** por MLB, e o painel
**Tráfego e oferta** no Dossiê do SKU (visitas, **Unidades por visita** e preço de oferta mín./máx. por
intervalo). Ads e posição na busca continuam na Fatia 2c, condicionados aos spikes.

- **Contrato da API (spike 052):** o dia é o rótulo literal `results[].date[:10]`, em calendário **BRT**
  (UTC descartado; resíduo −04:00 registrado); dia sem ponto numa resposta 200 é **0 visitas `ok`**; dia
  com menos de 48 h fica `pendente`; 1 GET cobre 150 dias. Preço vem de
  `sale_price?context=channel_marketplace`.
- **Dados:** 4 tabelas (`ml_item_visitas_dia`, `ml_item_preco_dia`, `ml_trafego_sync`, `ml_trafego_item`)
  e 6 RPCs `service_role` (posse, CAS do cursor, 3 gravações, conclusão), migration
  `20260927084615_vendas_sku_trafego.sql`. O plano previa "3 tabelas + 2 RPCs"; a posse, o CAS do cursor e
  o status do anúncio entraram nas Tasks 2/4. `ok` nunca é trocado por `falha`/`pendente`; a 1ª observação
  de preço do dia fica. Retenção de 13 meses.
- **Worker:** `coletar-trafego-ml` (QStash, `verify_jwt=false`, só GET no ML): fan-out por org e cadeia
  de continuações com posse, lote de 20 MLBs, orçamento de 90 s. Carga inicial de 150 dias; depois, janela
  móvel de 7 dias estendida até o último `ok`. MLB sem coleta `ok` ganha os 150 dias.
- **Métrica:** Unidades por visita = Σ unidades ÷ Σ visitas nos mesmos MLBs e dias, só com todos os dias
  `ok`; o mapa MLB→código é o **vínculo atual** (sem vigência histórica — Ruling 2b-2).

**Validação real (T8):** `sincronizarTrafegoOrg` rodou com a fiação real (`depsTrafego`), o ML real da
Avil (só GET, token lido por SQL read-only, sem refresh) e o Postgres **local**, para 3 MLBs do spike
(dois ativos e um pausado). Os 149 dias de 01/05 a 26/09/2026 bateram 1:1 com o spike (12.960,
5.061 e 0 visitas); o preço de hoje (65,90, 39,90 e 14,89, sem promoção) é o mesmo do spike. Um 2º run não
duplicou nem regrediu nada (450 linhas de visitas, 3 de preço e 3 de status antes e depois; hash dos dias
`ok` idêntico; nenhum `ok` virou `falha`; nenhum GET de preço repetido). **Status continua Proposto:**
falta `db push`, deploy da função, schedule do QStash (runbook `docs/runbooks/coletar-trafego-ml.md`),
revisão final e merge.

## Nota — Fatia 2c: Ads no dossiê do SKU (2026-09-27)

Entregue a segunda parte de D-6: gasto e vendas atribuídas do **Product Ads** do ML no Dossiê do SKU
(painel `PainelAds`), com **Despesa de Ads do período** e **Lucro após Ads**. Só GET no ML (spike 053).

- **Unidade = grupo de anúncios (`ad_group_id`).** Toda soma é por grupo (ITEM, FAMILY ou CATALOG). O ML
  não separa o gasto por cor (R2): nenhum rateio por MLB, nenhum "gasto da cor".
- **Alcance:** `sku` ou `família` quando todos os grupos do alvo só anunciam códigos do alvo; `anúncio`
  quando algum grupo também anuncia outro código ou tem MLB sem código (gasto compartilhado); `indisponível`
  sem MLB. O mapa MLB → código vem de `vendas_sku_codigos_mlbs` (vínculo atual, sem vigência histórica,
  como na 2b).
- **Estados:** `sem_coleta`, `sem_permissao` (403 de política, nunca tratado como token expirado),
  `sem_advertiser`, `sem_acesso`, `parcial` (carga inicial não fechada: sem despesa), `desatualizado`,
  `sem_ads` (zero só quando o período inteiro está coberto) e `ok`. Dentro da cobertura, dia sem linha
  vale 0. **Lucro após Ads** só com gasto exclusivo e período inteiro coberto; senão fica indisponível
  com o motivo (compartilhado, sem lucro, cobertura, **gasto fora dos grupos listados**) e herda a marca
  do lucro atual (custo parcial ou estimado).
- **Dados:** 4 tabelas (`ml_ads_sync`, `ml_ads_grupo`, `ml_ads_grupo_item`, `ml_ads_grupo_dia`) e 6 RPCs
  (5 de escrita `service_role` + a leitura `vendas_sku_codigos_mlbs`), migration
  `20260927124602_vendas_sku_ads.sql`. Retenção de 13 meses.
- **Worker:** `coletar-ads-ml` (QStash, `verify_jwt=false`): carga inicial de 90 dias (o máximo da API),
  depois 15 dias relidos por dia, porque a atribuição de vendas muda por 14 dias (**atribuição em
  aberto**). Membros sempre lidos na janela de 90 dias; o vínculo nunca encolhe por uma leitura.
- **Ruling 2c-5:** um grupo não lido (5 adiamentos por 429/5xx/tempo) marca a flag `falhou`, que viaja em
  toda continuação; a rodada fecha em `erro`, nunca em `ok`, e o cursor é zerado.
- **Ruling 2c-6:** na carga inicial, a 1ª falha grava o que já leu, zera o cursor e fecha em `erro` na
  hora, sem continuação (senão os dias antigos do grupo falho ficariam sem leitura para sempre). Um 404 de
  grupo listado desconta o custo dele de `custo_listado` (piso 0), para o dossiê ver "gasto fora dos
  grupos" em vez de uma despesa menor sem aviso.
- **Ruling 2c-7:** grupo listado com gasto cujo `/ads` volta vazio e que não tem vínculo gravado (nenhum
  MLB conhecido) conta como **não listado**: o custo dele sai de `custo_listado` (piso 0), como no 404.
  Os dias dele continuam gravados, mas ele não chega a dossiê nenhum, então nunca infla o Lucro após Ads
  de um SKU. Grupo vazio com vínculo anterior preservado (`itens: null`) não é descontado.
- **Ruling 2c-8:** o aviso `fora_dos_grupos` cobre sempre os **últimos 90 dias**. Na carga inicial a
  busca principal já é de 90 dias; na diária, uma busca extra de `ad_groups/search` sobre os 90 dias
  (só para medir, não decide o que reler) calcula `custo_resumo` e `custo_listado`, com os descontos do
  404 e do 2c-7 em custo de 90 dias (`descontar90` na cadeia). Custo: ~3 GETs a mais por dia na Avil.
- **Consequência (2c-7 + 2c-8):** enquanto houver gasto de grupos excluídos ou sem membros nos últimos 90
  dias, o Lucro após Ads fica indisponível em toda a conta; hoje, na Avil, ~3 % do gasto está fora dos
  grupos, e por isso o Lucro após Ads fica indisponível. A despesa, o ROAS e o ACOS continuam visíveis.
  **Decisão pendente do Diego:** manter essa regra rígida ou mostrar o Lucro após Ads com um aviso
  ("~N % do gasto de Ads da conta não pôde ser atribuído").
- **Fora da 2c:** posição na busca (a fonte seria scraping, proibido pela cláusula 7.6 dos termos do
  programa de desenvolvedores do ML; `/sites/MLB/search` dá 403, ADR-0119); Ads no ranking, na curva ABC,
  no Financeiro e no billing; conferência com a fatura `PADS` (o app não tem permissão de faturamento: 403).

**Validação real (T7):** `sincronizarAdsOrg` rodou com a fiação real (`depsAds`), o ML real da Avil (só
GET, token lido por SQL só de leitura, sem refresh, nunca impresso) e o Postgres **local**, com a
continuação repetida como o QStash faria (`scripts/validar-ads-ml.ts`). O total de grupos do
`ad_groups/search` com o filtro de status é igual ao total sem filtro; os membros de 3 grupos FAMILY com
gasto são os mesmos na janela de 90 dias e na de 1 dia. A carga de 90 dias fechou em `ok`: `custo_listado`
**confere** com o Σ cost gravado dos grupos com vínculo (diferença zero); o gasto fora dos grupos
listados é 3,08 % do resumo do anunciante: ~2,57 % de grupos fora do search (o spike mediu ~2,6 %) mais
os 3 grupos `EMPTY` sem membros (2 FAMILY, 1 CATALOG; 0,52 % do gasto gravado), descontados pelo Ruling
2c-7. 134 grupos com gasto (84 ITEM, 31 FAMILY, 19 CATALOG, a mesma contagem
do spike), todos com a série densa de 90 dias; `max(dia)` = ontem, `min(dia)` = hoje − 90, cursor e posse
nulos. O 2º run (diária, 15 dias relidos) não mudou nenhum dia com mais de 15 dias, não duplicou chave
e, com o Ruling 2c-8, gravou o resumo de 90 dias: o gasto fora dos grupos segue em 3,08 %. Nenhum token nas
saídas. **Status continua Proposto:** falta `db push`, deploy de `coletar-ads-ml` e `coletar-trafego-ml`,
schedule do QStash (runbook `docs/runbooks/coletar-ads-ml.md`), revisão final e merge.
