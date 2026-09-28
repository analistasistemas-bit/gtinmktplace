# Vendas SKU — design

**Data:** 2026-09-26 · **Origem:** grilling com Diego (8 perguntas) + benchmark do Mercado Turbo
*Vendas por SKU* · **ADR:** [0172](../../decisions/0172-vendas-sku-analise-por-variacao.md) ·
**Termos:** `docs/reference/glossario.md` → seção "Vendas SKU".

## Objetivo

Uma aba nova em Faturamento, **Vendas SKU**, que diz quais variações sustentam o resultado e conta a
**história** de cada uma desde a primeira venda registrada no PubliAI. Não é cópia do benchmark: ele é um
ranking de faturamento bruto do período. Aqui a análise é por **lucro**, ao longo do tempo, com eventos e
sinais de risco.

## Benchmark (Mercado Turbo, visitado 2026-09-26, só leitura)

| Tem lá | Fica? |
|---|---|
| KPIs: valor, qtde, ticket, SKUs com venda, concentração top 5 | fica, com Δ% contra o período anterior |
| Frase "X lidera com Y%" | vira 3 insights automáticos |
| Ranking com participação valor/qtde | fica, ordenado por lucro |
| Top 10 em barras (valor + ticket) | sai: o ranking ordenável (lucro, unidades, lucro/unidade) responde |
| Volume × Faturamento (5 cards) | sai, pelo mesmo motivo |
| Vendas por UF do SKU (modal) | vai para o dossiê |
| Faixas de ticket | sai (nunca definida) |
| Curva ABC em outra página e outro período | embutida, no mesmo período, por lucro ou faturamento |

O que falta lá e é o diferencial daqui: lucro/Markup/Margem s/ venda, comparação de períodos, canceladas e
devolvidas separadas, eixo de tempo, eventos, estoque/cobertura, visitas/conversão, busca e filtros, e
atalhos de período (lá é texto dd/mm/aaaa).

## Fatia 1 — aba `/faturamento?aba=sku`

**Fonte:** os itens de `agruparPorPedido` (a mesma da aba Vendas), agrupados por `codigo` no navegador
(ADR-0172 D-5). Sem RPC e sem fórmula nova. Enriquecimento pela família mais recente do `(org, codigo)`.

- **Filtros:** período com atalhos (7/30/90 dias, mês, custom) + comparar com o período anterior; busca
  por código/título; família, fornecedor, origem (nacional/importado); filtro **sem custo**; alternador
  **agrupar por família**.
- **Faixa "sem custo"** no topo quando houver: "N SKUs sem custo · R$ X de faturamento sem lucro calculado".
  Todo produto tem que ter custo.
- **KPIs:** faturamento, lucro, Markup, Margem s/ venda, unidades, SKUs com venda (e quantos venderam 1
  vez), concentração top 5, **% do faturamento com custo real** e **prejuízo total** (quanto os SKUs
  negativos tiraram). Δ contra o período anterior: % nos valores, **pontos percentuais** em Markup e Margem,
  e R$ quando a base anterior é zero ou negativa.
- **Quem explica a variação do lucro:** os SKUs que mais somaram ou tiraram em R$, incluindo "entrou no
  período" e "deixou de vender".
- **Insights:** de 0 a 3, só com evidência (ex.: "3 SKUs fazem 50% do lucro", "4 SKUs com cobertura
  < 15 dias").
- **Ranking:** código + título + miniatura, unidades, faturamento, lucro, **lucro por unidade**, Markup,
  Margem s/ venda, ticket, canceladas, taxa de devolução, **tendência** e **alertas** (glossário). Ordena
  por lucro por padrão. Selos: "custo estimado", "lucro parcial", "sem custo". Linha extra: "devolução não
  atribuída" e "sem código".
- **Abrir a conta da linha:** bruto → comissão + frete → imposto → custo → lucro, com a quantidade de
  pedidos. Comissão e frete aparecem juntos porque o item só carrega o líquido rateado. O link para os
  pedidos fica no dossiê (2a).
- **Curva ABC** (lucro | faturamento). Por lucro, só sobre o lucro positivo; SKUs com prejuízo ficam na
  faixa "D — prejuízo".
- **Cobertura:** kit vinculado mostra "estoque compartilhado com a base", sem dias.
- **Invariante:** a soma dos SKUs no período = total da aba Vendas no mesmo filtro (por construção; teste
  de guarda).

## Fatia 2a — Dossiê `/faturamento/sku/:codigo` (dados existentes)

> Revisada pelo GPT-6 Astra em 2026-09-27 ("sim com ajustes"). As decisões abaixo incorporam a revisão.

**Contrato: histórico observado, com cobertura explícita.** O dossiê mostra o que os registros do PubliAI
comprovam, desde a primeira venda registrada. Não promete "história completa": publicação, promoção e
estoque têm cobertura parcial, e a tela diz isso.

**Carga (sem fórmula nova):** uma RPC de **seleção** (`security definer`, `current_org_id()`, sem dinheiro)
devolve os ids das vendas que contêm o código **mais os demais membros dos mesmos packs/envios**. O
navegador busca essas vendas com o mesmo `select` de `buscarVendas`, roda os mesmos resolvers e
`agruparPorPedido`, e **só depois** separa os itens do SKU. Assim o rateio de frete e os centavos são
os da aba Vendas. Paginação por GET com desempate por id; colunas explícitas, nunca `raw` inteiro.
Critério de aceite: medir linhas, bytes e tempo do SKU de maior volume da Avil, incluindo a expansão dos
packs.

**Referência temporal:** gráfico e KPIs seguem o período escolhido; tendência e cobertura são a posição
**de hoje** ("posição em dd/mm"). Calendário em BRT: semana começa na segunda, mês civil, intervalos
sem sobreposição; a semana/mês corrente é marcada como incompleta.

**Cabeçalho:** foto, título, família, 1ª e última venda, idade comercial, tendência, alertas, e o bloco
**Qualidade do histórico**: desde quando há vendas, % do faturamento com custo real, e quais fontes têm
cobertura parcial.

**Linha do tempo** (semanal/mensal): unidades, faturamento, lucro e **preço vendido** = média ponderada
por quantidade, com faixa mín./máx.; semana sem venda fica sem preço. Na família, avisa que o preço
médio também muda pelo mix. Clicar num ponto abre os pedidos daquele intervalo, com o SKU destacado.

**Eventos**, cada um com o vínculo declarado: **SKU exato**, **anúncio compartilhado** (evento do MLB que
atende várias variações) ou **não resolvido**.
- Anúncios identificados nos registros (vínculo atual, vendas antigas e snapshot PxV). Não existe
  histórico geral de republicação; primeira venda de um MLB não vira "data de publicação".
- Entrada registrada com custo X (`estoque_movimentos`); ruptura = saldo anterior > 0 → resultante 0;
  retorno = anterior 0 → resultante > 0. Movimento sem saldo é ignorado.
- Moderação **detectada** / **resolução observada** (`ml_moderacao`, por MLB → anúncio compartilhado
  quando o MLB tem várias variações).
- Devolução (só `type='returns'`, a mesma definição da Fatia 1): evento em `aberto_em`, estorno em
  `fechado_em`. Motivo = texto traduzido, código cru ou "não informado".
- Perguntas: faixa semanal de contagem, por MLB (anúncio compartilhado).
- Promoção: **não entra na linha do tempo**. Vira o bloco **Situação atual nas campanhas** (status e
  última sincronização). Se houver faixa no gráfico, o texto é "vigência da campanha; participação
  histórica desconhecida".

**Estoque:** saldo canônico e cobertura (posição de hoje). **Kit vinculado:** saldo = `floor(base/N)`,
cobertura "estoque compartilhado" sem dias, ruptura quando `floor(base/N)` chega a 0; entradas pertencem
à base.

**Devoluções:** taxa por coorte (pedidos, só `returns`), motivos. **UFs:** agregadas pelos **itens
faturáveis do SKU** com a UF da respectiva order (nunca o bruto do pack inteiro), com "sem localização".

**Família** (`/faturamento/sku/familia/:codigo_pai`): composição **atual** pelo catálogo, incluindo
irmãs **sem vendas**; soma valores e unidades e recalcula percentuais (nunca soma taxas nem coberturas);
eventos compartilhados deduplicados pelo id original; pedidos contados por order. **Mix das irmãs**:
participação em unidades e contribuição para o lucro, contra o período anterior.

**Kit Virtual:** vendas com `kit_item_id` aparecem separadas ("vendido dentro de kit"), com aviso de
cobertura parcial (sem backfill de `kit_item_id`).

**Estados:** cadastrado sem vendas (idade e tendência indisponíveis), histórico sem cadastro atual
(vendas aparecem, família/estoque não), código não encontrado (404 do app), estoque desconhecido ≠ zero.
A linha "sem código" do ranking não abre dossiê.

**Segurança:** rotas sob os guards existentes; a RPC nova deriva a org no servidor, fixa
`search_path`, revoga `public`/`anon`, e tem teste com o mesmo código/MLB em duas orgs e chamada anônima.

**Fora da 2a:** histórico completo de publicação/republicação, adesão/saída histórica de promoção e efeito
atribuído à campanha, dias exatos sem estoque/demanda perdida, marcador por mudança de preço ou por
pergunta, lucro líquido de devoluções como métrica nova.

## Fatia 2b — coleta diária (visitas, conversão, preço)

> Revisada pelo GPT-6 Astra em 2026-09-27 ("sim com ajustes"). Decisões abaixo seguem as recomendações da revisão.

**Unidade da coleta:** `org + MLB + dia da fonte`. A associação MLB → SKU fica separada, com vigência
declarada. Nada é rateado entre cores.

**Métrica: "unidades por visita"** (Σ unidades ÷ Σ visitas, nos mesmos MLBs e dias cobertos; nunca média de
taxas; pode passar de 100%). No dossiê do SKU só aparece quando o MLB atende **exclusivamente** aquele código
no período; anúncio compartilhado mostra "visitas do anúncio compartilhado" e a métrica do anúncio inteiro,
rotulada. Vínculo incerto → indisponível. Vendas dentro de Kit Virtual ficam fora do numerador.

**Inventário:** anúncios do PubliAI (vínculos atuais, filhos UP pelo MLB técnico, oferta própria de catálogo,
anúncio antigo do PxV) **mais** MLBs observados nas vendas da org (anúncios externos), com titularidade pela
conexão. Paginado. Anúncio encerrado há mais de 30 dias sai da coleta.

**Calendário:** um spike lê a API real de visitas (só GET) e registra os limites do dia (UTC ou BRT) e se
`ending` é exclusivo. Se o dia for UTC, o tráfego vira **painel próprio com o calendário declarado**,
nunca sobreposto às semanas BRT do faturamento como se fossem os mesmos intervalos.

**Frescor:** recoleta de uma janela móvel de 7 dias; um dia só é "estabilizado" quando encerrado há 48 h e
consultado depois disso. Estados distintos: zero retornado, pendente, falha, ausente. Lacuna nunca vira zero;
conversão nunca usa denominador parcial. A conversão é calculada na leitura (não congelada pelo worker).
Cobertura calculada (a partir de quando há série, por MLB).

**Preço:** "preço de oferta observado às HH:mm" via `GET /items/{id}/sale_price?context=channel_marketplace`
(moeda, instante, origem; preço regular separado quando vier), só daqui para frente, uma observação por dia.
Separado do "preço vendido" ponderado da 2a. SKU com várias ofertas mostra a faixa. Retentativa não preenche o
preço de um dia que já passou.

**Worker:** descoberta por org → carga inicial (até 150 dias) → coleta incremental diária, em lotes pequenos
(20 MLBs) com cursor persistido, orçamento de 90 s por invocação, reserva atômica e proteção contra rodada
antiga (padrão de `sincronizar-promocoes`). 429/5xx recuperáveis com `Retry-After`; itens com falha
reprocessados; falha fica visível (nunca 200 silencioso — ADR-0171). Token por
`getValidAccessTokenConexao` (lock Redis + renovador proativo). QStash com assinatura validada
(`verify_jwt=false`). Cron fora da virada da hora. Só leitura no ML.

**Persistência:** tabelas org-scoped com RLS (`select` por `current_org_id()`, sem escrita de usuário,
`revoke` de anon), chave única `(org_id, ml_item_id, dia)`, frescor de visitas e de preço independentes,
upsert que aceita revisão de visitas mas não deixa rodada antiga sobrescrever a nova. Sem JSON bruto por
ponto. Retenção: 13 meses de detalhe diário.

**No dossiê:** painel alternável "Tráfego e oferta" (visitas/dia, unidades por visita, preço observado), sem
empilhar mais curvas no gráfico de vendas; busca só os MLBs e o intervalo necessários; falha na coleta não
derruba o dossiê financeiro.

**Fora da 2b:** conversão por cor em anúncio compartilhado, rateio de visitas, deduplicação de pessoas entre
anúncios, preço histórico reconstruído, cupom/atacado/comprador, varredura diária da conta inteira, Ads e
posição (2c).

## Fatia 2c — Ads (após spike); posição na busca fora

Revisada pelo GPT-6 Astra em 2026-09-27. Ads e posição são entregas independentes.

- **Posição na busca: fora da 2c.** A fonte seria scraping (Apify), e a cláusula 7.6 dos termos do
  programa de desenvolvedores do ML proíbe scraping para acessar conteúdo do ML. O ADR-0119 registra 403 em
  `/sites/MLB/search?q=`, e não há palavra-chave canônica por família. Volta só se o Diego decidir assumir
  o risco contratual (o Sonar já usa Apify) ou se surgir uma fonte oficial. Nesse caso: termo confirmado
  pelo operador por família, rótulo "posição observada nesta consulta" e teto de custo aprovado.
- **Spike Ads (só GET, token nunca impresso nem renovado):**
  1. Acesso: matriz Avil/DSA com org, conta, advertiser, permissão "Publicidade" efetiva e HTTP de cada
     chamada. Distinguir token inválido, acesso negado, sem advertiser, sem campanha e gasto zero.
  2. Granularidade: a métrica atual é por Ad Group (`ITEM`/`FAMILY`/`CATALOG`), não por anúncio. Mapear
     grupo → MLBs → códigos com casos reais (legado multi-cor, UP, catálogo, kit), sem contar grupo duas
     vezes na família.
  3. Métricas e calendário: campos, moeda, datas inclusivas, fuso, atribuição direta/indireta (janela de
     14 dias), atraso e revisão. Conferir uma janela contra o painel oficial.
  4. Reconciliação: uma competência com gasto contra `sale_fee`, cobranças e lucro atual. Provar que não há
     dupla contagem.
  5. Operação: paginação, histórico disponível, volume de grupos, chamadas, latência, 401/403/429.
     Resultado negativo (sem acesso ou sem Ads) encerra o spike e a 2c.
- **Se o spike der sim:** o dossiê ganha métricas de Ads no alcance comprovado (grupo exclusivo do SKU,
  anúncio ou família), com CPC/ROAS agregados por numerador e denominador, nunca por média de percentuais.
  "Após Ads" é a **despesa de Ads do período**, rotulada e separada do lucro atual, sem rateio por cor.
  Grupo compartilhado mostra o gasto do grupo e o lucro por SKU fica indisponível. Estados honestos: sem
  permissão, sem Ads, zero comprovado, parcial e desatualizado. Coleta reaproveita assinatura QStash,
  posse e cursor da 2b, com estado próprio, RLS por org e retenção de 13 meses.
- **Fora da 2c:** lucro após Ads por cor em grupo compartilhado, visitas orgânicas por subtração
  (visitas − cliques), causalidade Ads → vendas, e Ads no ranking, na ABC, no Financeiro ou no billing.

## Fatia 3 — recompra, exportação e atalhos

Revisada pelo GPT-6 Astra em 2026-09-27. Três entregas independentes.

- **Recompra (só no dossiê):**
  - **Métrica:** "Compradores recorrentes do SKU no período" = compradores identificados com compra
    elegível no período e outra ocasião anterior do **mesmo código** ÷ compradores identificados com
    compra elegível no período.
  - **Identidade:** a conta compradora `(org_id, ml_vendas.comprador_id)`. Um ID ausente fica fora e
    aparece como cobertura ("N de M compradores identificados"). Nunca usar nome ou nickname.
  - **Ocasião:** `pack_id ?? order_id`. Várias unidades ou orders do mesmo pack não são recompra.
  - **Histórico:** a compra anterior pode ser de antes do período, desde a entrada da org
    ("observado desde dd/mm/aaaa"). "Primeira compra observada" não significa cliente novo.
  - **Elegibilidade:** saem as canceladas, as reembolsadas integralmente e as devoluções (`returns`).
    Devolução em aberto fica de fora. A regra vale para a compra anterior e para a atual e não muda
    os KPIs financeiros.
  - **Outra cor:** não conta no SKU. Na visão da família, conta com rótulo próprio e deduplicação entre
    as irmãs. Kit vinculado fica separado. Compra dentro de Kit Virtual fica fora da 1ª versão, com
    aviso.
  - **Amostra:** com menos de 20 compradores identificados elegíveis, mostra "amostra insuficiente".
  - **Não reaproveitar** `pctRecompra` de `calcularKpisPedidos`, que é outra métrica.
  - **LGPD:** a tela mostra só agregados. Nenhum ID, nome, nickname, endereço ou rastreio. Testes com
    duas orgs e dados sintéticos.
- **Exportação (XLSX, infraestrutura `src/lib/export/`):**
  - O que sai: ranking filtrado, ranking agrupado por família e série semanal/mensal do dossiê.
  - Os objetos exportados são os mesmos que alimentam a tabela/série. Não recalcular dinheiro.
  - A planilha distingue "total das linhas exportadas" de "KPIs gerais do período" e registra
    período BRT, comparação, filtros e instante da extração.
  - Valores e estados:
    - `fonteCusto` e cobertura de custo exportados;
    - indisponível sai como célula vazia, nunca zero;
    - código como texto, preservando zeros à esquerda.
  - Sem dados de comprador.
  - Um arquivo truncado é proibido: informar a contagem e, acima do teto medido, pedir um período
    menor.
- **Atalhos (só navegação):**
  - "Analisar família" abre `/faturamento/sku/familia/:codigoPai`.
  - "Ver em Publicados" abre `/publicados?q=<codigo>`, que é uma busca, não seleção.
  - "Ver campanha" abre `/promocoes/:promocaoId`. Para isso, preservar o `promocao_id` em
    `situacaoCampanhas`, com um link por campanha.
  - Cada atalho só aparece com permissão do menu de destino e com o módulo contratado.
  - Nenhuma ação publica, pausa, reativa, altera preço ou estoque, ou mexe em promoção no ML.
- **Fora da Fatia 3:**
  - recompra no ranking inteiro;
  - coortes 30/90 dias, previsão e alertas;
  - lista ou exportação de compradores;
  - PDF do dossiê e exportação de pedidos brutos;
  - CSV (que exige neutralizar fórmulas).

## Fora

Pausa/reativação na linha do tempo, enquanto não houver registro. Tela de configuração dos limites.
Backfill de pedidos anteriores à entrada no PubliAI.

## Pré-requisitos corrigidos antes da Fatia 1 (2026-09-26)

- **Centavos:** o rateio do líquido entre itens (`agruparPorPedido`) agora joga o resíduo no item faturável
  de maior valor. A soma dos itens = líquido do pedido.
- **Unidades:** `Pedido.unidadesFaturaveis` alimenta o KPI "Unidades" da aba Vendas e a Geografia. Pack
  com order cancelada não conta o item cancelado, igual ao Financeiro.
- **Não alterado, de propósito:** o markup por pedido/pack continua entrando com o líquido inteiro quando
  qualquer item tem custo (`sales-summary.ts`, comentário "assim markup/lucro batem entre todas as telas").
  Medido: 1 pack em 3.778. A Vendas SKU calcula por item e não herda isso.

## Riscos

- Dossiê de SKU com pouco volume vira ruído: a tendência exige ≥ 5 unidades na janela.
- Kit vinculado: estoque vem da base (`floor(base/N)`); cobertura é "estoque compartilhado", sem dias.
- Janela de 48h das visitas: a conversão do dia corrente não é mostrada.
