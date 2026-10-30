# ADR-0179 — Painel de Ads com margem real (I2)

**Status:** Aceito (2026-10-05) — em piloto (aceite D7 pendente: Task 8, Diego)
**Data:** 2026-10-04
**Relacionado:** [ADR-0172](0172-vendas-sku-analise-por-variacao.md) (Fatia 2c: coleta de Ads e dossiê SKU),
[ADR-0109](0109-custo-congelado-por-venda.md) (custo congelado por venda),
[ADR-0048](0048-split-produto-n-anuncios-ml.md) e [ADR-0078](0078-preco-por-variacao-split-por-faixa-e-controle-de-preco-no-update.md) (família em N anúncios),
[ADR-0170](0170-central-de-promocoes-ml.md) (padrão de módulo por org)
**Design:** `docs/superpowers/specs/2026-10-04-painel-de-ads-design.md`
**Decisores:** Diego (grilling 2026-10-04), com parecer de produto do GPT-6 Astra.

## Contexto

A Avil gasta ~R$ 3,7 mil/mês em Product Ads (ROAS ~11,9 em 30 dias) e decide pelo ACOS/ROAS do ML, sem custo do
produto. A Fatia 2c já coleta o gasto diário por grupo de anúncios, mas só mostra Ads no dossiê de um SKU, onde o
gasto atribuível é ~20 % (o ML soma o gasto por grupo, e a maioria dos grupos cobre várias cores) e o Lucro após Ads
está indisponível nas 3 orgs pela regra de gasto fora dos grupos.

## Decisão

1. **Unidade = conta + família.** Na Avil a família cobre ~95 % do gasto. Família em N anúncios soma os grupos de
   todos eles, cada grupo uma vez; grupo com códigos de mais de uma família é gasto compartilhado. Nunca há rateio
   de gasto entre cores, famílias ou SKUs.
2. **Gasto de Ads não identificado** entra inteiro no total da conta numa linha própria; nas famílias vira aviso
   com o % da conta. **Emenda ao ADR-0172:** no dossiê SKU, `fora_dos_grupos` deixa de bloquear o Lucro após Ads
   e passa a aviso; gasto compartilhado e cobertura incompleta continuam bloqueando.
3. **ACOS de equilíbrio** (margem % antes de Ads da família) como referência, com semáforo contra o ACOS direto (gasto ÷ venda direta);
   sem meta configurável no MVP.
4. **Tela própria `/ads`**, módulo por org, nasce desligado; ligado na Avil no lançamento.
5. **Só leitura no ML.** Total da conta por período vem de uma **série diária do anunciante** gravada por org
   (`campaigns/search?aggregation_type=DAILY`, todos os status), relida nos 15 dias da atribuição em aberto;
   **não identificado(período) = Σ conta − Σ grupos com membro** e o % do aviso é o do período exibido, não fixo em 90 dias
   (substitui a Ruling 2c-8 para este fim). Medido no [spike 054](../spikes/054-total-de-ads-por-periodo.md):
   4 fontes do ML batem ao centavo; Avil 0,03 % não identificado em 30 dias.

## Alternativas descartadas

- **Unidade SKU** (estender o dossiê): ~80 % do gasto ficaria indisponível.
- **Unidade campanha** (como ML/MT): o `campaign_id` guardado é só o atual; histórico por campanha exige spike.
- **Regra rígida para gasto não identificado:** painel nasceria vazio nas 3 orgs.
- **Ratear o gasto não identificado:** número inventado.
- **Fila de revisão no MVP:** na Avil, 6 grupos concentram 99 % do gasto e todos vendem; a fila ficaria vazia.

## Consequências

- **Premissa herdada (vendas):** não há marcador de cobertura das vendas no backend (webhook `sync-venda` +
  `reconciliar-faturamento`); como Faturamento, Vendas SKU e Financeiro, o painel assume histórico completo a partir
  da primeira venda registrada e mostra essa data. Antes dela, lucro indisponível (`historico`).
- **Semáforo:** nasceu desligado; o spike 055 mostrou a mesma base de preço (100 % dos dias comparáveis) e o Diego o
  **ligou em 2026-10-05** (`BASE_ACOS_VALIDADA = true`). Ressalva aceita: o ML conta vendas depois canceladas, então
  o ACOS do Ads sai 1,5–7 % otimista (família no limite pode aparecer "dentro"); kits não foram testados (Avil sem
  kit). Custo parcial, gasto compartilhado, cobertura incompleta e histórico seguem sem semáforo.

- O Lucro após Ads do dossiê passa a aparecer quando o gasto é exclusivo, com aviso do % não identificado.
- "Resultado após Ads" não é lucro causado pelo Ads; a interface diz isso. Despesa é a informada pela API, não a
  fatura PADS.
- Aceite por piloto de 2 semanas na Avil: total bate com o Mercado Ads (≤ 1 %), sem dupla contagem, toda
  indisponibilidade com motivo, ≥ 1 decisão concreta tomada pelo painel.

## Produção (2026-10-04/05)

- **Em produção:** migration `20261005013741_ads_painel` (tabela `ml_ads_conta_dia`, coluna
  `ml_ads_sync.conta_cobertura_desde`, RPCs `gravar_ads_conta_dias`, `ads_painel`, `ads_resumo_periodo`; teste SQL
  em transação desfeita); edge `coletar-ads-ml` v12 (grava a série diária do anunciante; carga de 90 dias nas 3
  orgs, Σ igual ao spike 054 ao centavo); edge `usuarios` v45 (aceita menu/módulo `ads`).
- **Medições:** `EXPLAIN` na Avil (135 grupos, 12.161 linhas em `ml_ads_grupo_dia`): `ads_painel` 164 ms,
  `ads_resumo_periodo` 9 ms (orçamento 300 ms; remedir quando a Avil passar de ~300 grupos). CPU do worker v12: máx.
  123 ms por mensagem (teto 2 s), cada org fecha em 1 mensagem.
- **Front** (`/ads`, módulo `ads`, dossiê D2) entra com o merge da branch `worktree-i2-painel-ads`. O módulo `ads`
  nasce **desligado** em todas as orgs; o backfill de `allowed_menus` com `'ads'` vai numa migration depois do deploy
  do front (plano, Task 7 Step 5).
- **Regras fixadas na validação visual:** o período termina no último dia coletado (recuo máx. de 1 dia; antes, das
  00h às ~11h17 BRT o painel ficava indisponível); o dossiê usa lucro e Ads nos mesmos dias e aplica a trava de
  histórico da org (mínimo da primeira venda do catálogo), em paridade com o painel.
- **Semáforo do ACOS de equilíbrio ligado em 2026-10-05** por decisão do Diego (`BASE_ACOS_VALIDADA = true`), com
  base no spike 055 (`docs/spikes/055-base-acos-equilibrio.md`).
- **Redesenho da tela (2026-10-05, plano `docs/superpowers/plans/2026-10-05-ads-ui-premium.md`):** a interface passa
  a oferecer o preset **Mês atual** (padrão, por decisão do Diego), do primeiro dia do mês BRT até `fimDiasAds`; sem
  dia elegível, mostra "aguardando mês" com acesso aos últimos 30 dias. Despesa e resultado em destaque, ressalvas
  sempre visíveis, filtros por contagem e ranking compacto com detalhe expansível.
- **Ads sobre a margem (2026-10-05, pedido do Diego):** a coluna "ACOS direto × equilíbrio" vira barra + "Ads X% de
  Y% possíveis", com (i) explicando a leitura. A barra só aparece com semáforo (cor e selo vêm do domínio); sem
  semáforo fica só o texto. O detalhe da família mostra o **markup antes de Ads** (lucro ÷ custo do produto, a mesma
  conta de Vendas SKU), com a trava do equilíbrio: custo parcial, lucro desconhecido ou bruto zero → "—".
- **Emenda ao ADR-0172:** `fora_dos_grupos` deixa de bloquear o Lucro após Ads (vira aviso do % do período).
- **Pendente (Task 8, Diego):** ligar o módulo na Avil, conferir o total com o Mercado Ads (≤ 1 %), 2 semanas de
  piloto e ≥ 1 decisão registrada. Só então o épico fecha; até lá o status é "em piloto".

## Emenda — aba Campanhas (2026-10-20, grilling com o Diego)

**Contexto:** org com Ads ativo e sem gasto (Hairfly: campanha automática, 5 anúncios, R$ 10/dia, ROAS objetivo 5x)
vê o `/ads` vazio, porque o painel nasce do gasto. O Diego quer ver campanhas e produtos sem ir ao ML, sem repetir o
que o painel já mostra.

**Decisão:**
1. O `/ads` ganha duas abas: **Desempenho** (o painel atual, por período) e **Campanhas** (estado **atual** da
   configuração). Sem gasto no período, abre em Campanhas. Mesmo módulo `ads`, sem item novo no menu.
2. Campanhas nunca mostra gasto, ROAS/ACOS realizado nem resultado — só configuração (estado, estratégia, orçamento,
   ROAS objetivo) e se ela cabe na margem; cada família tem link para a sua linha em Desempenho.
3. **Leitura sob demanda** no ML ao abrir a aba (edge só GET, cache curto por org, botão Atualizar). Sem tabela,
   migration ou cron; sem histórico de configuração. Isto **não reabre** a alternativa "unidade campanha" descartada
   acima: lá o problema era histórico por campanha; aqui é só o agora.
4. Linha = **família**, expandindo para os MLBs patrocinados (status no Ads, estoque, preço); MLB sem família →
   linha "Fora do PubliAI".
5. Margem = **ACOS de equilíbrio pelo preço** (glossário), reaproveitando a projeção da Central de Promoções
   (ADR-0170) com o preço vivo; pior variação por MLB; nunca default de custo, origem ou comissão (ADR-0055).
6. Alertas da v1: ROAS objetivo acima da margem; patrocinado parado (pausado, sem estoque, inativo ou status no Ads
   ≠ ativo); família parcialmente patrocinada. **v2:** família candidata fora da campanha (exige projetar todas as
   publicadas — medir o custo de chamadas antes). **Fora:** orçamento ÷ margem.

**Spike 057 (2026-10-20, [docs/spikes/057-ads-campanhas-agora.md](../spikes/057-ads-campanhas-agora.md)):**
`ads/search` no nível do anunciante, filtrado por campanha ativa/pausada, dispensa a chamada por grupo. Diagnóstico
("Aprendendo") e tipo da campanha **não vêm na API** → saem da tela (fica nome, estado, estratégia, orçamento diário
e ROAS objetivo). `hold` no Ads não é "parado": o alerta usa o status do **item** (`/items/bulk`, ADR-0177), e
`hold` com irmão `active` no mesmo grupo (catálogo × comum) não alerta.

**Produção e ajustes da aba Campanhas (2026-10-20):** edge `ads-campanhas` v3, front na main. Medido com dados reais
(prova local só leitura, Hairfly e Avil): o filtro por campanha do ML devolveu 289 anúncios `idle` de outra campanha na
Avil → descartados (485 → 162). **Pacote a conferir** (decisão do Codex, opção B): quando o `resolverPack` escala o
custo pelo `UNITS_PER_PACK` a partir de um cadastro que não é kit próprio, o MLB fica sem número e sem alerta de margem
— na Avil 4 de 6 alertas eram custo do pacote ×N (ex.: linha C/10 com custo do pacote ×10 → −344 %), e a Central de
Promoções mostra hoje o mesmo custo inflado. A Central e o `resolverPack` não mudam aqui; a correção compartilhada
(como representar a unidade comercial do custo) exige ADR próprio. Tetos finais: 200 MLBs, 300 cores, 600 tarifas.
Com a emenda de 2026-10-20 ao ADR-0151 (anúncio próprio nunca escala o custo), os 4 casos da Avil voltam a ter número;
`pacote_a_conferir` fica só para escala a partir de cadastro sem kit próprio em anúncio de outro produto.

## Emenda — métricas por período e redesenho do /ads (2026-10-30)

**Plano:** [docs/superpowers/plans/2026-10-30-ads-redesign-premium.md](../superpowers/plans/2026-10-30-ads-redesign-premium.md)

**Contexto:** a aba Campanhas apresenta configuração atual, mas não permite
analisar investimento e desempenho por período. A apresentação atual do painel
também exige interpretar conceitos de margem antes de localizar os KPIs
conhecidos do Mercado Ads.

**Decisão:**

1. Esta emenda substitui o item 2 da emenda de 2026-10-20. A aba Campanhas passa
   a apresentar métricas realizadas por período, obtidas sob demanda do Mercado
   Livre: investimento, impressões, cliques, CTR, CPC, vendas e receitas diretas
   e indiretas, unidades, ACOS, ROAS e conversão, conforme disponibilidade real
   dos campos. Configuração atual e métricas históricas são identificadas
   separadamente. A mudança não autoriza atribuir lucro ou margem às campanhas.

2. Desempenho e Campanhas compartilham um único seletor de período e comparação.
   Mês atual permanece o padrão. Presets e intervalos personalizados usam dias
   completos em America/Sao_Paulo, terminando no máximo em ontem. Atraso na coleta
   não desloca silenciosamente a janela: bloqueia somente os indicadores que
   dependem da cobertura ausente. A comparação usa uma janela imediatamente
   anterior com a mesma quantidade de dias completos.

3. O topo apresenta Investimento, Vendas por Ads, ROAS, ACOS, TACOS da conta,
   Impressões, Cliques, CTR, CPC e Conversão, acompanhado de evolução diária.
   Logo abaixo permanecem o diferencial financeiro do PubliAI: Resultado após
   Ads e ACOS de equilíbrio. Vendas atribuídas e unidades são conceitos distintos
   e devem usar seus respectivos campos do fornecedor.

4. Esta emenda refina a D3 do desenho original: diferenças entre períodos com
   atribuição aberta podem ser exibidas, sempre identificadas como provisórias
   e com apresentação neutra. Não fundamentam afirmações de tendência consolidada
   nem recomendações automáticas. Comparações consolidadas exigem janelas
   completas e atribuição efetivamente encerrada.

5. A nova edge ads-metricas realiza somente leitura no ML e usa cache curto
   segregado por organização, conexão, anunciante, período e recurso. Não cria
   tabela de métricas de campanha, migration ou cron. A janela consultável é a
   mantida pelo ML; intervalo anterior fora da retenção permanece indisponível
   com motivo, sem truncamento ou reconstrução a partir do campaign_id atual.

6. O Resultado após Ads da conta pode utilizar a série diária completa do
   anunciante obtida sob demanda, confrontada com as vendas dos mesmos dias.
   A análise por família continua utilizando a coleta existente e suas travas.
   A composição do gasto só é conciliada entre fontes compatíveis; diferença
   de atualização não deve ser classificada como gasto não identificado.

7. TACOS da conta é investimento dividido pelo faturamento canônico total
   do Mercado Livre da organização no período, incluindo vendas fora do
   cadastro PubliAI e descontando cupom do vendedor conforme ADR-0180.
   Não se presume equivalência com o campo tacos de outros recursos do ML.
   O equilíbrio observado da conta é referência do mix vendido, sem semáforo
   contra o ACOS total. Nas famílias, o semáforo continua usando ACOS direto.

8. Permanecem todas as proteções: nenhum rateio entre famílias, nenhum default
   silencioso de custo ou imposto, identificação de custo parcial/estimado,
   avisos de histórico, cobertura, gasto compartilhado e gasto não identificado.
   Resultado após Ads não é lucro causado pelo Ads. Diagnóstico e tipo de
   campanha permanecem indisponíveis conforme spike 057; histórico de alterações
   não é inferido de last_updated.

**Consequências:** a interface adota o vocabulário do Mercado Ads e acrescenta
margem real, sem reconstruir atribuição financeira por campanha. Métricas
opcionais, competitividade e semântica de conversão exigem confirmação no
anunciante real antes de habilitação. Todas as indisponibilidades preservam
o motivo.
