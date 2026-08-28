# ADR-0140 — Análise PubliAI: JoomPulse no Radar e no Sonar

**Status:** Aceito — desenho fechado em entrevista com Diego (2026-08-28). **Implementação continua bloqueada** pelas questões #4–#16 da [ADR-0132](0132-analise-avancada-joompulse.md): OAuth multi-conta, storage de credencial, cache, quotas e a confirmação da parceria para uso server-to-server.
**Data:** 2026-08-28
**Decisores:** Diego
**Relaciona:** [0132](0132-analise-avancada-joompulse.md) (arquitetura do Gateway e do módulo — **esta ADR supersede a D-3 e emenda a D-7**), [Spike 038](../spikes/038-joompulse-parcial-correlacao-e-semantica.md) (achados que motivaram a revisão), [0119](0119-pulse-inteligencia-de-mercado-dirigida.md) (Radar; o 403 do ML; Errata 8 e Errata 10), [0120](0120-pulse-sonar-garimpo-por-termo.md) / [0122](0122-sonar-vendas-estimadas-via-apify.md) / [0127](0127-sonar-tabela-por-anuncio-e-historico.md) (Sonar, Apify e a tabela por anúncio), [0124](0124-veredito-de-oportunidade-do-sonar.md) / [0137](0137-sonar-disputa-caminho-b-concentracao-por-anuncio.md) / [0138](0138-sonar-linguagem-comercial-e-condicao-de-entrada.md) (veredito), [0130](0130-concorrentes-relevantes-pulse-viabilidade.md) (mercado relevante), [0020](0020-estrategia-de-preco-liquido-minimo.md) / [0055](0055-imposto-por-origem-nacional-importado.md) / [0107](0107-origem-obrigatoria-na-planilha.md) (margem e imposto por origem), [0086](0086-configuracao-org-scoped.md) (módulos)

## Problema

A ADR-0132 aprovou a direção arquitetural da integração com a JoomPulse, mas prometeu no v1 (D-3) "Radar enriquecido com vendas e receita estimadas **do rival**" e "Viabilidade com demanda ao lado do semáforo".

O Spike 038 provou que a primeira metade não é entregável. `orderCount1m` concentra-se no ganhador do buy-box; num catálogo com 15–18 concorrentes, 14 a 17 devolvem `0`, e esse `0` significa "não atribuído a esta listagem", não "não vendeu". Exibi-lo como venda do rival seria dado inventado.

A D-17 da ADR-0132 manda voltar para decisão. Esta ADR é essa decisão, tomada em entrevista estruturada: onde a JoomPulse entra, o que cada tela entrega, e quem calcula o quê.

## Decisão

| # | Decisão |
|---|---|
| D-1 | A funcionalidade se chama **Análise PubliAI** — o mesmo rótulo no módulo do admin, no bloco de Canais e no botão do Pulse. O slug técnico `analise_avancada` permanece inalterado no banco. Os nomes "Análise Avançada" (rótulo da ADR-0132) e "PulseAI" ficam descartados: o primeiro é genérico, o segundo colide foneticamente com JoomPulse e com o menu Pulse. |
| D-2 | **Três camadas, fronteira rígida.** (1) O MCP da JoomPulse traz dado de mercado. (2) O código do PubliAI calcula **tudo que envolve dinheiro** — preço médio, comissão, frete, imposto, DRE, margem, ROI. (3) O modelo de IA recebe dados e números **já calculados** e escreve apenas texto interpretativo. **A IA é proibida de citar número que não recebeu pronto**, e nenhum número nasce dentro dela. Todo valor financeiro exibido tem função pura testada por trás. |
| D-3 | O v1 é **Radar + Sonar**. A Viabilidade **sai do escopo do v1** — não por impossibilidade técnica (é o encaixe mais limpo: `catalogOrderCount1m` é do catálogo e imune ao problema do buy-box, e o `product_id` já está em mãos em `analisar-item-viabilidade.ts:65`), mas por decisão de priorização. Fica registrada como candidata natural ao v2. |
| D-4 | **Radar:** a coluna "Referência do ML" é substituída pela coluna **Análise PubliAI**. Ao abrir a tela, **uma única consulta** traz o ganhador do buy-box de todos os produtos da página (filtro `buyBoxWiner = true`, uma linha por catálogo) e a célula já mostra se quem leva a venda é a org ou um rival, com o preço dele. Clicar abre um painel de números determinístico, com **uma frase** de leitura escrita por IA no topo. |
| D-5 | **Sonar:** após consultar um produto, o botão **Análise PubliAI** gera um relatório de 7 seções. As 6 seções de mercado saem imediatamente, sem pedir nada ao operador. A seção 6 (DRE) aparece como bloco que pede custo, origem, peso e dimensões — dados que não existem no banco porque o produto é do concorrente. Relatório parcial é entrega válida: no garimpo o operador frequentemente ainda não tem o custo. |
| D-6 | **O Apify permanece no Sonar**, e isso é requisito, não escolha: nem toda organização terá assinatura JoomPulse, e o Sonar precisa continuar íntegro sem ela. A JoomPulse entra exclusivamente **dentro do botão Análise PubliAI**, como camada adicional. O veredito 🟢/🟡/🔴 e o pódio continuam calibrados no Apify (ADR-0124/0137/0138) e **não são recalibrados** nesta entrega. |
| D-7 | Como as duas fontes coexistem na mesma tela, os rótulos são obrigatoriamente distintos e carregam unidade e janela: **"vendidos (acumulado, amostra)"** para o Apify e **"vendas/mês (estimativa JoomPulse)"** para a JoomPulse. Nenhuma tela exibe os dois sob o rótulo "vendas". |
| D-8 | A conexão da conta mora em **`/canais`, bloco "Análise PubliAI"** — mantém a D-6 da ADR-0132, muda apenas o rótulo. `src/pages/Canais.tsx` é hoje o único lugar do app que inicia um fluxo OAuth; um segundo lugar criaria duas portas para o mesmo gesto. O bloco só aparece com o módulo ligado. Configurações foi avaliada e descartada por isso. |
| D-9 | **Top 5 por faturamento estimado é um conjunto único**, lido três vezes: a seção 1 tira dele o preço médio sem extremos, a seção 4 o tabula, a seção 5 mostra os cards. O preço de referência passa a ser o praticado por quem efetivamente vende. Anúncio parado não é referência de mercado. |
| D-10 | **Menos de 5 anúncios no nicho: a média sem extremos não se aplica** e o relatório diz isso explicitamente. Com 3, excluir o menor e o maior deixaria 1; com 2, nenhum. Nunca se produz uma "média" de 2 elementos nem se completa a amostra. Anúncio sem venda estimada conta como concorrente, mas fica fora do cálculo de faturamento. |
| D-11 | **O nicho é o conjunto de anúncios que a busca do Sonar já retornou** — os `item_id` da amostra, que desde a ADR-0127 são a unidade da linha (a ficha de catálogo deixou de ser). Esses `item_id` são exatamente a dimensão `id` da JoomPulse: correlação direta, sem conversão, e **sem depender de catálogo** — anúncio sem ficha também é coberto. O que a JoomPulse acrescenta sobre a amostra atual é a venda e a receita **mensais estimadas** por anúncio, onde hoje só existe o acumulado do selo. Para os anúncios que têm `catalog_product_id`, o painel pode ainda puxar os demais concorrentes daquele catálogo. |
| D-12 | O fallback "similar title" que a JoomPulse oferece (`SN-10`) foi **avaliado e rejeitado**: casar concorrente por semelhança de título é exatamente o que a D-10 da ADR-0132 proíbe. Anúncio sem ficha de catálogo permanece sem Análise PubliAI. |
| D-13 | **O relatório é persistido por produto e reaproveitado no mesmo dia**, com data e hora da geração visíveis e um botão "atualizar". A fonte atualiza uma vez por dia (~03:25 UTC, snapshot D-1): regerar antes disso devolve números idênticos cobrando duas vezes — cota da JoomPulse do cliente e token do PubliAI. Alterar o custo recalcula **apenas a DRE**, localmente, sem tocar na JoomPulse. |
| D-14 | **O custo de IA é registrado por organização e por relatório, sem teto no v1.** Segue o padrão de `familias.custo_centavos`, que já registra custo de IA desde 2026-05 sem impor limite. O cache de uma geração por produto por dia (D-13) já limita o consumo. Teto ou vínculo a plano (ADR-0028) só depois de medir volume real — número de cota escolhido hoje seria chute. |
| D-15 | **A DRE estende `calcularSimulacaoML()` (`src/lib/calculadora-ml.ts`); não nasce um motor financeiro novo.** Essa função já decompõe custo, comissão, frete, imposto, custos fixos e variáveis, já aplica peso volumétrico (÷6000) e já roda 3 cenários de sensibilidade. Os 5 cenários comerciais são uma extensão dela. O projeto já tem quatro superfícies calculando margem (`pulse-margem.ts`, `sonar.ts`, `calculadora-ml.ts`, `semaforo.ts`) — **não haverá uma quinta**. |
| D-16 | **A entrada de peso e dimensões vive no bloco da DRE do relatório**, não em `DialogMargemSonar`. Um único lugar para digitar peso: dois divergem. O aviso atual do simulador ("produto ainda sem dimensões cadastradas — margem otimista, sem custo de frete") deixa de valer dentro do relatório, porque ali o frete é real. |
| D-17 | **O imposto é a alíquota confirmada da organização, escolhida pela origem do produto** (`configuracoes.aliquota_nacional_pct` / `aliquota_importado_pct`, ADR-0055/0107), e o operador informa a origem (nacional/importado). **Não existe campo livre de alíquota no relatório.** Vale a mesma trava LOUD já implementada no Sonar: sem alíquota confirmada, não se calcula. |
| D-18 | **Comissão e frete vêm das APIs oficiais do Mercado Livre já integradas** — `/sites/MLB/listing_prices` por categoria e tipo de anúncio (`_shared/ml/listing-prices.ts`) e `/users/{id}/shipping_options/free` (`_shared/ml/tabela-frete.ts`). **Nenhuma tabela de frete ou de comissão é embutida em código, prompt ou banco.** O valor da API já vem com o desconto de reputação do vendedor aplicado, então a distinção MercadoLíder/Verde sai automática. Não é necessária verificação diária de atualização de tabela: não há tabela local para envelhecer. |
| D-19 | **Quem enxerga o Pulse pode gerar a Análise PubliAI.** Conectar e desconectar a conta permanece restrito ao admin da organização (D-5 da ADR-0132). Usar consome cota da conta JoomPulse da org, mas o cache da D-13 limita o consumo, e restringir o uso a admin esvaziaria a feature para o operador que de fato garimpa. |

## O que muda na ADR-0132

| Decisão da 0132 | Situação |
|---|---|
| D-3 (escopo do v1) | **Superseded.** O Radar entrega *quem detém o buy-box + demanda do catálogo*, não "vendas do rival"; o Sonar ganha o relatório; a Viabilidade sai do v1. |
| D-7 (pedido só no uso) | **Emendada.** Continua valendo que o cron nunca chama o Gateway, mas surge um padrão de chamada que a D-7 não previa: uma consulta em lote ao abrir a página do Radar (D-4). Não é prefetch nem enriquecimento em lote — é uma consulta por página efetivamente aberta pelo operador. |
| D-6 (conexão em Canais) | **Mantida**, com o rótulo do bloco renomeado para "Análise PubliAI". |
| D-10 (correlação) | **Satisfeita.** Chaves fechadas pelo Spike 038 (`ml_item_id`→`id`, `catalog_product_id`→`productId`), e o nicho do Sonar reusa as fichas que ele já achou. Nenhum casamento por título em nenhum ponto (D-12). |
| D-1, D-2, D-4, D-5, D-8, D-9, D-11 a D-16, D-18 | **Intactas.** Gateway como único cliente MCP, módulo desligado por padrão com verificação server-side, OAuth por organização, allowlist fechada, isolamento por org, observabilidade. |

## Rótulos e unidades

Toda métrica de mercado exibida carrega fonte, janela e a indicação de estimativa — exigência da própria JoomPulse, e já era requisito da ADR-0132.

| O que aparece | Unidade | Fonte | Natureza |
|---|---|---|---|
| Vendas/mês do catálogo | unidades | JoomPulse | Estimativa, janela móvel de 30 dias sobre snapshot D-1 |
| Receita/mês do catálogo | BRL | JoomPulse | Estimativa (`vendas × preço`) |
| Vendas/mês do ganhador | unidades | JoomPulse | Estimativa, atribuída ao buy-box |
| Preço do concorrente | BRL | JoomPulse | **Real** |
| Preço mínimo histórico / desconto máximo | BRL / % | JoomPulse | **Real** |
| Vendas dos últimos 365 dias do vendedor | unidades | API do ML via JoomPulse | **Real** (transações concluídas) |
| Vendidos (selo) | faixa | JoomPulse | Acumulado vitalício — **não é taxa** |
| Vendidos (pódio do Sonar) | unidades | Apify | Acumulado, **amostra** top-20/30/48 |

**`orderCountMin`/`Max` não são banda de confiança** — são agregadores do recorte da consulta. A indicação de estimativa é rótulo, nunca faixa.

## Estados da célula do Radar

Deriva da tabela-verdade do Spike 038. Os quatro estados são distintos e não podem ser reduzidos ao mesmo travessão.

| Situação | Célula |
|---|---|
| Anúncio não rastreado pela JoomPulse | travessão + "sem dado" |
| A org detém o buy-box | "Você leva" + vendas estimadas do catálogo |
| Rival detém o buy-box | nome do rival + preço dele; destaque quando a org é mais barata e mesmo assim não leva |
| Catálogo sem venda estimada | "sem venda estimada no período" |

**`orderCount1m = 0` em anúncio que não detém o buy-box nunca é renderizado como zero de vendas.** É ausência de atribuição.

Os estados de módulo desligado, conta não conectada, credencial expirada, quota insuficiente e provedor indisponível seguem a máquina de estados da ADR-0132, sem alteração.

## Campos que não diferenciam concorrentes

`reviewsCount`, `reviewsRating`, `numImages` e `daysInAd` são **do catálogo**: retornam idênticos para todos os anúncios de um mesmo `productId`. Podem ser exibidos como fato do produto; **nunca** lado a lado como diferença entre rivais, porque sugeririam uma distinção inexistente.

## Ganho colateral: link do anúncio do concorrente

A Errata 8 da ADR-0119 mediu 36 ofertas e registrou que a API do ML não devolve o `permalink` do anúncio individual do concorrente — só o da ficha. A JoomPulse documenta o formato de deep link por grão de identificador, o que resolve a limitação e viabiliza a seção 5 do relatório (cards dos anúncios) sem trabalho adicional.

## Alternativas descartadas

- Chamar a **JoomAI** (a IA da JoomPulse) a partir do PubliAI — o MCP expõe 5 ferramentas de dados e nenhuma de conversa. Além disso, a JoomAI **recusa cálculo de margem por design** (§5.6 do `pulse://overview`, gatilhos "comissão Premium vs Clássico", "Simples Nacional", "custos adicionais") e não vê dado interno do vendedor (§5.5), então nunca produziria a seção 6.
- IA calculando a DRE a partir de dados brutos e de uma tabela de frete colada no prompt.
- Relatório 100% determinístico, sem parecer nem plano de ação.
- Mandar o operador para a JoomPulse quando quiser análise — tira o operador do produto no momento da decisão, e lá ele não tem custo nem DRE.
- Aposentar o Apify e tornar a JoomPulse a fonte única de vendas do Sonar.
- Conjuntos separados para o preço médio e para o Top 5.
- Top 5 ordenado por unidades vendidas em vez de faturamento.
- Formulário de custo/peso/dimensões **antes** de gerar qualquer coisa.
- Relatório efêmero, regerado a cada abertura.
- Teto diário de análises ou vínculo a plano no v1.
- Conexão da conta em Configurações.
- Coluna do Radar como botão puro, sem prévia.
- Relatório longo com IA também no Radar.
- Manter a coluna "Referência do ML".

## Consequências

- O Radar passa a responder uma pergunta que **nenhuma tela do PubliAI responde hoje**: quem está levando a venda, e se a org é mais barata e mesmo assim perde.
- Sai da tela a "Referência do ML", cujo problema já estava documentado na Errata 10 da ADR-0119 (produto mais barato entre concorrentes reais exibido como "acima da referência", porque a referência do ML inclui universo não comparável). O campo irmão `ptw_custos` (comissão/frete) **permanece** — alimenta a margem. A exibição secundária no dialog de detalhe precisa de decisão própria na implementação.
- O Sonar ganha profundidade sem perder autonomia: quem não tem JoomPulse continua com o Sonar íntegro.
- Duas fontes de "vendas" convivem na mesma tela para quem tem as duas coisas — mitigado por rótulo (D-7), não eliminado.
- O custo de IA passa a existir por clique, registrado e observável, mas sem teto no v1.
- A dependência de assinatura JoomPulse por organização é assumida: a feature é opcional por construção.
- **Nada disso entra em margem, piso, semáforo, preço recomendado, reprecificação ou publicação.** A separação exigida pela ADR-0132 permanece, e vale também para o relatório: a DRE é simulação exibida ao operador, não decisão automatizada.

## O que continua bloqueando a implementação

Esta ADR fecha **o quê**. A ADR-0132 ainda não fechou **como conectar**:

- #4 contrato HTTP do Gateway
- #5/#6 storage e cifragem de credencial
- #7/#8 refresh rotation, revogação e o que "Desconectar" executa
- #9/#10 backend de cache, TTLs e invariância entre contas
- #11/#12 rate limits, timeouts, latência e cold start
- #13/#14 ciclo de vida da credencial e expurgo no offboarding
- #15 alertas e thresholds
- #16 confirmação com a JoomPulse de que a parceria cobre uso server-to-server desta superfície

A cobertura real (quantos anúncios do PubliAI existem no snapshot da JoomPulse) também não foi medida e precisa de sonda em produção antes de qualquer promessa de UI.
