**Adote uma aba Resultados que responda “quanto vendeu, quanto sobrou e o que exige ação”, acompanhada de um PDF mensal de três páginas.**

**Análise 4/4 concluída, somente leitura.** Nenhum arquivo foi alterado. As conclusões abaixo vêm do código e da documentação; não consultei dados de produção nem executei testes. A inspeção no navegador ficou indisponível, portanto contraste, responsividade e navegação por teclado ainda exigem validação visual.

## 1. Para que serve a tela hoje — em cinco linhas

1. **Usuário:** Diego, super-admin da Daludi; o backend exige super-administrador ativo. Fonte: `supabase/functions/_shared/platform-admin/auth.ts:4`.
2. **Carteira:** acompanhar faturamento das organizações, previsão de cobrança e bloqueios. Fonte: `src/pages/Organizacoes.tsx:521`.
3. **Resultados:** consultar bruto, pedidos, ticket, markup e evolução mensal de uma organização. Fonte: `src/components/platform-admin/org-results.tsx:64`.
4. **Administração:** acessar consumo, extensão, cobrança, auditoria e configurações sem confundir essa área com o dashboard do cliente. Fontes: `CONTEXT.md:11`; `src/pages/OrganizacaoDetalhe.tsx:245`.
5. **Cobrança:** conferir a prévia e fechar demonstrativos mensais auditáveis; entrar na operação continua sendo um fluxo de suporte separado. Fontes: `docs/decisions/0155-central-organizacoes-cobranca-auditavel.md:5`; `src/components/platform-admin/org-billing.tsx:177`.

## 2. Diagnóstico: conteúdo, hierarquia e apresentação

### Os cinco problemas prioritários

| Prioridade | Diagnóstico factual | Consequência e recomendação |
|---|---|---|
| **Alta — conteúdo** | Os quatro KPIs são bruto, pedidos, ticket e markup; apenas bruto apresenta comparação. `src/components/platform-admin/org-results.tsx:64`. | A tela responde volume, mas não explica resultado econômico. Acrescentar resultado, margem e despesa de Ads, com cobertura e definição visíveis. |
| **Alta — hierarquia** | Todos usam `size="compact"`; nesse componente, o valor recebe `text-lg`. `src/components/platform-admin/org-results.tsx:66`; `src/components/ui/kpi-card.tsx:111`. | Os indicadores têm praticamente o mesmo peso. Dar destaque a faturamento e resultado; manter volume e eficiência como apoio. |
| **Alta — gráfico e espaço** | O gráfico mostra somente bruto, ocupa `h-64` e divide a linha com “Operação”, que contém apenas três registros. `src/components/platform-admin/org-results.tsx:88`, `:100`, `:130`. | Há pouca informação decisória para a área ocupada. Substituir essa dupla por evolução diária em largura total; transformar as três informações em apoio aos KPIs. |
| **Média — controles e navegação** | O mês é um **`input type="month"`**, não texto livre. As seis abas já existem e persistem na URL. `src/pages/OrganizacaoDetalhe.tsx:82`, `:139`, `:245`. | Melhorar a apresentação para “Outubro de 2026”, com navegação anterior/próximo. Preservar abas e URL; destacar situação do fechamento e bloqueios de Cobrança. |
| **Alta — carteira** | O valor do hero usa `totals`, mas sua variação é calculada a partir de `orgs`, que deriva das linhas da página. `src/pages/Organizacoes.tsx:107`, `:205`, `:522`. | Com paginação, o percentual pode representar um conjunto diferente do valor principal. A comparação agregada deve vir do mesmo universo dos totais, antes de paginar. |

**O card “Operação” sobra como bloco independente.** “Período anterior” e “Variação absoluta” pertencem à comparação do faturamento; “Cobertura de custo” pertence à explicação do resultado. Hoje estão separados do contexto que lhes dá significado. Fonte: `src/components/platform-admin/org-results.tsx:130`.

### Precisão financeira: o redesenho precisa resolver a linguagem

Há quatro distinções que devem aparecer no produto:

| Distinção | Evidência no código | Tratamento recomendado |
|---|---|---|
| **Bruto não é base de cobrança** | O glossário separa os conceitos. `CONTEXT.md:19`, `:23`. | Usar rótulos diferentes e mostrar a composição da base na cobrança. |
| **Markup não é margem** | Markup divide resultado pelo custo; a margem atual do agregador divide pelo líquido após imposto. `supabase/functions/_shared/platform-admin/sales-summary.ts:275`, `:286`. | Informar denominador no botão “O que é”; não trocar os nomes. |
| **Cobertura por pedido não significa custo integral** | Um pack conta como coberto quando possui **qualquer item com custo**, entrando com o líquido inteiro. `supabase/functions/_shared/platform-admin/sales-summary.ts:165`, `:251`. | Acrescentar cobertura por item/valor. “100% dos pedidos com algum custo” não pode virar “lucro totalmente conhecido”. |
| **Lucro atual não é lucro líquido da loja** | O agregador calcula líquido após imposto menos custo; estornos são acumulados separadamente, e a fórmula não desconta Ads ou remuneração Daludi. `supabase/functions/_shared/platform-admin/sales-summary.ts:181`, `:275`. | Nomear o escopo do resultado e homologar a apuração antes de colocá-lo em destaque no PDF. |

Existe ainda uma divergência concreta: **Resultados desconta cupom do vendedor do bruto; a prévia de cobrança usa `total_amount` sem esse desconto**. Não corrigir essa diferença no front nem supor igualdade entre os valores. Fontes: `supabase/functions/_shared/platform-admin/sales-summary.ts:113`; `supabase/migrations/20261102221455_platform_devolucao_abatimento_automatico.sql:71`.

### Visual e acessibilidade

O caminho premium já existe no PubliAI: hero com gradiente suave no Dashboard, componentes de KPI, faixas de indicadores e gráfico diário no Ads. A própria StyleGuide restringe gradiente a áreas de destaque. Fontes: `src/pages/Dashboard.tsx:73`; `src/components/ads/faixa-kpis.tsx:15`; `src/components/ads/serie-diaria.tsx:102`; `src/pages/StyleGuide.tsx:147`.

Minha recomendação é **mais hierarquia e informação útil por área**, preservando a identidade atual:

- **Superfícies:** gradiente suave em um único destaque; demais cards com `bg-card`, borda discreta e números tabulares. Os tokens claro/escuro e `chart-1..5` já estão definidos em `src/index.css:81`, `:142`.
- **Abas:** preservar `Tabs`; o componente já prevê rolagem horizontal. Acrescentar alvos de toque maiores e indicação visível de conteúdo lateral em telas estreitas. Fonte: `src/components/ui/tabs.tsx:27`.
- **Gráfico:** o `role="img"` atual descreve o assunto, mas não oferece uma tabela dos valores naquele componente. Acrescentar “Ver dados”, resumo textual e interação acessível. Fonte: `src/components/platform-admin/org-results.tsx:100`.
- **Estados:** preservar erro com tentativa novamente e dados anteriores com aviso; esse tratamento já existe. Mostrar também data de leitura e motivo da indisponibilidade junto ao indicador. Fonte: `src/components/platform-admin/org-results.tsx:35`, `:57`.
- **Contraste e foco:** validar os dois temas. O Ads possui ajustes locais de foco, contraste e toque que não são automaticamente herdados pela Central. Fonte: `src/components/ads/tela-ads.ts:1`.

## 3. Proposta de “super painel premium”

### Composição da aba Resultados

```text
← Organizações
AVIL                                      [<] [Outubro de 2026 ▾] [>]
Resultados da operação                    [Gerar relatório mensal]

[Mês encerrado] [Demonstrativo fechado] [Ads provisório]
Vendas: período completo · Custos: cobertura X% · Ads: lido em DD/MM

Resultados | Pulse | Extensão | Cobrança [2] | Auditoria | Configurações

┌──────────────────────┬──────────────────────┬────────────┬────────────┐
│ FATURAMENTO BRUTO     │ RESULTADO APÓS ADS   │ MARGEM     │ PEDIDOS    │
│ R$ ...               │ R$ ...               │ ...%       │ ...        │
│ ↑ ...% · anterior... │ ↑ R$ ...             │ ... p.p.   │ ...%       │
└──────────────────────┴──────────────────────┴────────────┴────────────┘
┌────────────────┬────────────────┬────────────────┬───────────────────┐
│ UNIDADES       │ TICKET MÉDIO   │ PREÇO/UNIDADE  │ ESTORNOS          │
│ ...            │ R$ ...         │ R$ ...         │ R$ ...            │
└────────────────┴────────────────┴────────────────┴───────────────────┘
[Mostrar mais indicadores]

┌────────────────────────────────────────────────────────────────────┐
│ Evolução diária                     [Faturamento ▾] [Ver dados]     │
│ Atual ━━━   Anterior ┄┄┄                                          │
│                                                                    │
│ Tooltip: data · valor atual · anterior · diferença                   │
└────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────┬──────────────────────────────┐
│ Evolução mensal                     │ Composição do resultado      │
│ Faturamento e resultado em R$       │ Receita → taxas/frete        │
│ Margem em painel alinhado abaixo    │ → imposto → CMV → Ads        │
└─────────────────────────────────────┴──────────────────────────────┘

┌─────────────────────────────────────┬──────────────────────────────┐
│ Curva ABC · cinco principais        │ Ads                          │
│ Produto · qtd · receita · % · classe│ Investimento · ROAS · TACOS   │
│ Demais produtos / sem código        │ Receita atribuída · alertas   │
└─────────────────────────────────────┴──────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ Gestão Daludi: entregas comprovadas · alertas · próximos passos      │
└────────────────────────────────────────────────────────────────────┘
```

**O desenho é uma proposta.** Os estados de demonstrativo e cobertura precisam de contratos explícitos; não devem ser deduzidos apenas pelo calendário.

### Componentes concretos

| Parte | Implementação visual recomendada |
|---|---|
| Cabeçalho e mês | `PageHeader`, `Button` e **`Select` de `src/components/ui/select.tsx`**; mês por extenso, anterior/próximo e estado persistido em `?mes=`. |
| Indicadores | `KpiCard`, `KpiInfoButton` e `StatusPill`; faturamento com `variant="brand"`, resultado com maior peso tipográfico, demais compactos. API disponível em `src/components/ui/kpi-card.tsx:13`. |
| Comparações | Valor atual, anterior, diferença e período escrito; aproveitar as regras de apresentação de `src/lib/ads-metricas.ts:76`, sem importar silenciosamente a janela temporal do Ads. |
| Gráficos | Recharts; reutilizar padrões de tooltip, legenda, lacunas e tabela da série de Ads. Fonte: `src/components/ads/serie-diaria.tsx:41`, `:93`, `:121`. |
| ABC e detalhes | `DataTable`, `Badge`/`StatusPill`, `EmptyState` e expansão progressiva; nenhuma tabela longa na primeira dobra. Esses componentes já são utilizados pela Central em `src/pages/Organizacoes.tsx:16`. |

No celular, apresentar primeiro faturamento, resultado, margem e pedidos; os demais ficam em “Mostrar mais”, como o Ads já faz com sua faixa de KPIs. Fonte: `src/components/ads/faixa-kpis.tsx:15`, `:41`.

### KPIs: fórmula e disponibilidade

**Legenda:** **DISPONÍVEL** significa que há fonte ou cálculo no código, não que a Central já exponha o agregado ou que a cobertura de produção tenha sido comprovada. “Agregar” não significa necessariamente criar nova coleta.

#### Volume e desempenho comercial

| KPI | Fórmula | Fonte e situação |
|---|---|---|
| **Faturamento bruto** | Σ(`total_amount − cupom_vendedor`) das vendas faturáveis | **DISPONÍVEL.** `sales-summary.ts:113`, `:182`, em `supabase/functions/_shared/platform-admin/`. |
| **Pedidos** | Contagem distinta de `pack_id ?? order_id` | **DISPONÍVEL.** `supabase/functions/_shared/platform-admin/sales-summary.ts:162`, `:186`. Identificar como checkouts/pedidos, sem prometer equivalência com toda métrica denominada “vendas” pelo ML. |
| **Unidades vendidas** | Σ`ml_vendas_itens.quantity` das vendas faturáveis | **DISPONÍVEL; falta expor na Central.** `supabase/functions/_shared/platform-admin/sales-summary.ts:188`. |
| **Ticket médio** | Faturamento bruto ÷ pedidos | **DISPONÍVEL.** `supabase/functions/_shared/platform-admin/sales-summary.ts:274`. |
| **Preço médio por unidade** | Faturamento bruto ÷ unidades | **DISPONÍVEL como insumos e em Vendas SKU.** `src/lib/vendas-sku.ts:92`, `:125`. Denominador zero deve produzir “sem base”, não um preço fictício. |

#### Resultado econômico

| KPI | Fórmula / definição | Fonte e situação |
|---|---|---|
| **Líquido das vendas** | Bruto − comissão ML − frete efetivo | **DISPONÍVEL.** Reutilizar rateio e agregador; não somar frete bruto repetido entre orders do pack. `supabase/functions/_shared/platform-admin/sales-summary.ts:149`, `:259`. |
| **Resultado antes de Ads** | Hoje: líquido após imposto − custo, nos packs com algum custo | **DISPONÍVEL com limitação.** `supabase/functions/_shared/platform-admin/sales-summary.ts:248`, `:276`. A versão comercial precisa homologar devoluções e cobertura integral. |
| **Resultado após Ads** | Resultado homologado antes de Ads − investimento da conta nos mesmos dias | **DISPONÍVEL como fontes; integração da Central pendente.** A combinação por período já existe em `src/hooks/useAdsPainel.ts:64`, `:132`. Não representa lucro causado pelos anúncios. |
| **Margem** | **Proposta:** resultado de contribuição ÷ receita definida para esse resultado | **DISPONÍVEL parcialmente; decisão necessária.** Hoje há denominadores diferentes: líquido após imposto na Central e bruto com custo em Vendas SKU. Fontes: `sales-summary.ts:286`; `src/lib/vendas-sku.ts:91`. |
| **Markup e cobertura** | Markup = resultado antes de Ads ÷ CMV; cobertura proposta = receita com todos os custos conhecidos ÷ receita elegível | **Markup DISPONÍVEL; cobertura integral precisa ser agregada.** Preservar custo congelado como prioridade. Fontes: `sales-summary.ts:275`; `sales-costs.ts:106`, ambos em `supabase/functions/_shared/platform-admin/`. |

**Conceito comercial recomendado:** “Resultado de contribuição após Ads, antes da remuneração Daludi e das despesas fixas”. Se houver custo parcial, mostrar **“resultado parcial”**, abrangência e motivo; não extrapolar o resultado conhecido para toda a loja.

#### Ajustes, tráfego e cobrança

| KPI | Fórmula / definição | Fonte e situação |
|---|---|---|
| **Vendas canceladas** | Contagem de `order_id` distintos cancelados; manter separada de checkouts | **DISPONÍVEL como matéria-prima; agregado e distinção de devoluções precisam ser definidos.** O agregador atual exclui não faturáveis do bruto. `supabase/functions/_shared/platform-admin/sales-summary.ts:175`. |
| **Estornos registrados** | Σ`ml_vendas.estorno`, inclusive em cancelados | **DISPONÍVEL.** `supabase/functions/_shared/platform-admin/sales-summary.ts:175`. Não confundir com o abatimento de produto usado na cobrança. |
| **Visitas aos anúncios** | Σ visitas por `(org_id, ml_item_id, dia)`, sem duplicar MLB compartilhado | **DISPONÍVEL por anúncio/dia; precisa agregar e validar cobertura da loja.** `src/lib/sku-dossie-dados.ts:88`; `src/lib/sku-trafego.ts:129`. |
| **Conversão da loja equivalente ao ML** | Depende do numerador, denominador e universo oficiais | **PRECISA VALIDAR/COLETAR fonte equivalente.** O cálculo existente é **unidades por visita**, pode superar 100% e não é essa conversão. `src/lib/sku-trafego.ts:23`, `:155`. |
| **Base, comissão e total Daludi** | Usar diretamente `base_cents`, `fee_cents` e `total_cents` | **DISPONÍVEL.** `platform_billing_preview`; para mês fechado, snapshot do demonstrativo. Fontes: `supabase/functions/_shared/platform-admin/repository.ts:182`, `:185`. |

#### Ads: bloco próprio, sem misturar com conversão da loja

| Indicadores | Fórmula / fonte | Situação |
|---|---|---|
| **Investimento e receita atribuída** | `cost` e `total_amount` retornados pelo ML | **DISPONÍVEL, condicionado ao retorno.** `src/lib/ads-metricas.ts:37`. |
| **ROAS e ACOS** | Receita Ads ÷ investimento; investimento ÷ receita Ads | **DISPONÍVEL.** `src/lib/ads-metricas.ts:49`. |
| **TACOS da conta** | Investimento ÷ faturamento canônico total ML da organização | **DISPONÍVEL.** Inclui vendas fora do cadastro PubliAI conforme ADR. `src/lib/ads-metricas.ts:51`; `docs/decisions/0179-painel-de-ads.md:176`. |
| **Impressões, cliques, CTR e CPC** | `prints`, `clicks`; cliques ÷ impressões; investimento ÷ cliques | **DISPONÍVEL, condicionado ao retorno.** `src/lib/ads-metricas.ts:52`. |
| **Vendas e conversão Ads** | Vendas atribuídas = `units_quantity`; pedidos = `advertising_items_quantity`; conversão = `cvr` nativo | **DISPONÍVEL, condicionado ao retorno.** Não recalcular CVR com unidades ou pedidos. `src/lib/ads-metricas.ts:1`, `:46`. |

### Gráficos e comparação no estilo ML

1. **Diário do mês:** faturamento atual versus anterior; selecionar pedidos, unidades ou resultado. Tooltip com datas reais dos dois períodos, valor e diferença. Dias sem dado são lacunas; dias comprovadamente sem venda são zero.
2. **Mensal:** faturamento e resultado em R$; margem em gráfico menor alinhado abaixo. Evitar três escalas misturadas. Mostrar até seis meses disponíveis e identificar mês parcial.
3. **ABC:** classificação por faturamento sobre **todo o universo elegível**, exibindo cinco linhas. A regra já existe, com limites 80%/95% e acumulado anterior ao item. Fonte: `src/lib/vendas-sku.ts:287`.
4. **Ads:** investimento e receita atribuída por dia; ROAS como visão alternativa. Preservar sinalização de atribuição provisória e indisponibilidade.
5. **Comparações:** mês encerrado contra mês anterior completo; mês atual contra intervalo equivalente explicitado. Percentuais de margem/ACOS variam em **pontos percentuais**; base anterior zero não gera crescimento percentual.

Hoje a Central compara o mês corrente até o instante atual; o Ads trabalha com dias completos e janela imediatamente anterior de mesma duração. A proposta precisa harmonizar isso explicitamente. Fontes: `supabase/functions/_shared/platform-admin/metrics-repository.ts:472`, `:513`; `src/lib/ads-painel-dados.ts:81`.

**O backend atual ainda não entrega o painel inteiro:** o contrato de métricas possui bruto, pedidos, ticket, markup, cobertura e série mensal; não possui diário, lucro ou margem. `platform_org_month_metrics` é **tabela de cache reconstituível**, não demonstrativo congelado. Fontes: `supabase/functions/_shared/platform-admin/metrics-repository.ts:555`; `supabase/migrations/20260908030002_platform_org_month_metrics.sql:3`.

### Carteira: melhorar sem transformá-la em outro dashboard

Preservar sua função de triagem:

- Totais: faturamento, **previsão elegível de cobrança**, organizações com bloqueio e organizações ativas.
- Tabela: organização, faturamento/variação, resultado ou cobertura, previsão, situação do demonstrativo e ação principal.
- Evidenciar exclusões e falhas que tornam a previsão parcial; ela não significa dinheiro recebido.
- Calcular deltas e filtros de pendências sobre o conjunto inteiro, antes da paginação.
- Carregar ABC, diário e Ads detalhados apenas na organização aberta.

O repositório já calcula totais antes de paginar e restringe previsão a organizações com condições e sem bloqueio. Esse desenho deve ser preservado. Fonte: `supabase/functions/_shared/platform-admin/repository.ts:89`, `:139`.

## 4. PDF mensal: prestação de contas em dois minutos

**Formato proposto:** três páginas A4 em retrato, margens de 14 mm, fundo branco, texto escuro e identidade índigo/violeta. Gradiente apenas no cabeçalho ou destaque; gráficos com legenda e valores legíveis também em impressão.

O PDF atual do Dashboard já usa jsPDF, possui gráfico vetorial e cinco produtos, mas é A4 paisagem com segunda página geográfica. O PDF genérico utiliza `jspdf-autotable`. Reutilizar tecnologia e valores; criar composição própria para a prestação mensal. Fontes: `src/lib/export/pdf-dashboard.ts:164`, `:198`; `src/lib/export/pdf.ts:1`, `:128`.

### Página 1 — “Seu mês em números” — leitura de 45 segundos

| Região | Conteúdo | Visual |
|---|---|---|
| Cabeçalho | “Daludi · Relatório mensal”, organização, competência, período e emissão | Identidade de marca discreta; nome do cliente em destaque. |
| Resumo executivo | Até três frases: resultado principal, principal mudança e atenção relevante | Texto comercial curto, validado por Diego; sem causalidade inventada. |
| Indicadores | Faturamento, resultado após Ads, margem, pedidos; apoio com unidades, ticket e estornos | Dois destaques e uma faixa compacta; atual, anterior e diferença. |
| Evolução | Se houver **mais de um mês com vendas**, faturamento, resultado e margem por mês | R$ em painel principal; margem em painel alinhado. Um único mês: omitir e redistribuir espaço. |
| Leitura do resultado | Composição resumida e limitações de cobertura | Explicar o que foi descontado e o que permanece fora do resultado. |

Exemplo de redação, **sem números fictícios apresentados como reais**:

> “A loja encerrou o mês com R$ [faturamento] em vendas. O resultado após Ads foi de R$ [resultado], com margem de [margem]. A principal atenção para o próximo mês é [ação sustentada pelos dados].”

### Página 2 — “Produtos, publicidade e gestão” — leitura de 45 segundos

| Região | Conteúdo | Visual |
|---|---|---|
| ABC | **No máximo cinco produtos:** descrição, quantidade, faturamento, participação e classe | Tabela enxuta; classificação calculada antes de limitar a cinco. |
| Conciliação do mix | Participação dos cinco, demais produtos e vendas sem código | Rodapé que explique a diferença entre universo ABC e total da loja. |
| Ads | Investimento, receita atribuída, unidades atribuídas, ROAS, ACOS e TACOS; apoio com impressões/cliques | Faixa de KPIs e uma conclusão direta sobre custo/desempenho. |
| Gestão realizada | Até três entregas comprovadas, com quantidade e efeito operacional | “Preços ajustados”, “anúncios incluídos em promoção”; sem confundir execução com resultado comercial. |
| Próximo mês | Até três ações com responsável e motivo | Texto curto: ação → problema/oportunidade atendida. |

**Decisão de agrupamento:** recomendo produtos por família na apresentação comercial, se essa for a unidade reconhecida pelo cliente. A ABC existente é por SKU; agrupar famílias exige recalcular os acumulados, não somar classes. Fonte: `src/lib/vendas-sku.ts:105`, `:289`.

### Página 3 — “Demonstrativo Daludi · valor a depositar” — leitura de 30 segundos

```text
DALUDI · DEMONSTRATIVO MENSAL
Organização: [nome]                  Competência: [mês/ano]
Demonstrativo: [identificador]       Fechado em: [data]

Faturamento considerado na cobrança                  R$ [...]
(-) Devoluções abatidas                               R$ [...]
Base de cobrança Daludi                              R$ [...]

Faixa e percentual aplicados                         [...]%
Remuneração percentual da gestão                     R$ [...]
Infraestrutura / Sonar / implantação, quando aplicáveis
(-) Créditos de períodos anteriores                   R$ [...]

┌──────────────────────────────────────────────────────────┐
│ TOTAL A DEPOSITAR NA CONTA DA DALUDI             R$ [...] │
└──────────────────────────────────────────────────────────┘

Beneficiário · banco/Pix · vencimento · identificação do pagamento
```

Regras obrigatórias da proposta:

1. **Mês fechado usa o snapshot do demonstrativo.** A prévia serve para conferência antes do fechamento. O repositório já devolve snapshots para exportação. Fonte: `supabase/functions/_shared/platform-admin/repository.ts:185`.
2. **Comissão e depósito são valores diferentes:** `fee_cents` é remuneração percentual; `total_cents` contempla os demais componentes e créditos. Não recalcular nenhum deles no front. Fonte: `supabase/migrations/20261102221455_platform_devolucao_abatimento_automatico.sql:181`.
3. **Devoluções:** usar os abatimentos já apurados pelo backend. O código prioriza conciliação manual, depois estorno e pagamentos reembolsados; trata créditos tardios com a alíquota original. Fonte: mesma migration, linhas `:71`, `:138`.
4. **Cobrança existente:** reutilizar `buildBillingReport` como referência de valores, deixando a listagem de vendas conciliadas em exportação técnica separada. Fonte: `src/lib/export/platform-billing.ts:10`, `:48`.
5. **Dados bancários e vencimento:** definir fonte administrada e conferida. Esses campos não constam dos contratos de cobrança inspecionados. Fonte: `supabase/functions/_shared/platform-admin/types.ts:45`, `:84`.

Se não houver total positivo a pagar, a página deve apresentar a situação correspondente, sem instrução de depósito indevida.

**Ads pode continuar provisório mesmo com a cobrança fechada.** A regra exige releitura 15 dias após cada dia para encerrar a atribuição; outubro emitido em 02/11 ainda pode sofrer revisão. Fonte: `src/lib/sku-ads.ts:79`.

## 5. Como aumentar a percepção de valor da gestão Daludi

| Melhoria | Valor × esforço | Entrega recomendada e limite |
|---|---|---|
| **Explicar o resultado, inclusive quando cair** | **Alto × baixo** | Três frases que distingam volume, ticket, mix e custo. Usar decomposição verificável; Vendas SKU já possui explicação dos produtos que alteraram o lucro. Fonte: `src/lib/vendas-sku.ts:310`. |
| **Mostrar trabalho efetivamente entregue** | **Alto × médio** | Contar promoções, reajustes, pausas e reativações confirmados, por autor Daludi. Existem organização, criador, datas e estados de execução. Fontes: `supabase/migrations/20260928013318_operacoes_massa.sql:2`; `src/lib/operacoes.ts:6`. |
| **Relacionar ação a oportunidade ou risco** | **Alto × médio** | Ex.: “Revisamos preços dos produtos A para proteger margem”. Mostrar evidência operacional e objetivo; não afirmar aumento de vendas causado pela ação sem análise que o sustente. |
| **Próximos passos com compromisso** | **Alto × baixo** | Até três ações: responsável, prazo e motivo. Incluir dependências do cliente, como custo ausente ou reposição. Isso transforma o relatório em acompanhamento de gestão. |
| **Metas e acompanhamento histórico** | **Médio × médio** | Após homologar os indicadores, acompanhar metas acordadas de resultado, cobertura e execução. Deixar monetização de “perdas evitadas” para depois: exige metodologia e pode reduzir credibilidade. |

**Cuidado com “anúncios publicados no mês”:** `publicado_em` é atualizado na persistência de sucesso, e o fluxo atende CREATE e UPDATE. Esse timestamp sozinho não comprova anúncio novo nem autoria Daludi. É preciso validar evento de conclusão CREATE e responsável. Fontes: `supabase/functions/publicar-anuncio/processar.ts:37`, `:137`, `:153`.

Também não contar “Já estava” como nova entrega ou “Saída pedida” como saída concluída; esses estados são distintos no domínio. Fonte: `src/lib/operacoes.ts:76`.

## 6. Riscos e decisões em aberto

| Decisão do dono | Risco identificado | Recomendação |
|---|---|---|
| **1. Qual lucro e qual margem serão apresentados?** | Central e Vendas SKU têm bases de margem diferentes; a cobertura atual por pack não prova CMV completo. Fontes: `sales-summary.ts:165`, `:286`; `src/lib/vendas-sku.ts:91`. | Adotar resultado de contribuição após Ads, antes de remuneração Daludi/despesas fixas; margem sobre receita explicitamente definida. Homologar devoluções e custos antes do destaque comercial. |
| **2. Qual regra comercial prevalece?** | Cupom é descontado em Resultados, mas não na base atual da cobrança. Além disso, `CONTEXT.md:40` admite infraestrutura na modalidade 2, enquanto ADR-0165 e validação a proíbem. Fontes: `sales-summary.ts:113`; migration `20261102221455...:72`; `validation.ts:44`, em `_shared/platform-admin/`. | Preservar a cobrança vigente no PDF e decidir ajustes contratuais em trabalho próprio. Explicitar que as faixas usam a base após abatimentos, conforme ADR-0165:67. |
| **3. O que significa “mês fechado”?** | Mês-calendário encerrado, demonstrativo fechado e Ads consolidado são estados diferentes. O fechamento exige revisão válida, ausência de bloqueios e sequência de meses. Fontes: `supabase/migrations/20260918010100_platform_billing_tiers.sql:223`; `src/lib/sku-ads.ts:79`. | PDF oficial com cobrança congelada; Ads identificado como provisório quando necessário. Definir política de revisão da parte gerencial. |
| **4. Onde gerar e como reproduzir o PDF?** | O Ads ao vivo tem janela de 91 dias no código; o cache mensal da Central é recalculável. Fontes: `src/lib/ads-painel-dados.ts:39`; `supabase/migrations/20260908030002_platform_org_month_metrics.sql:3`. | Backend autorizado entrega o conjunto de dados; front renderiza com jsPDF no MVP. Guardar versão/snapshot gerencial se for necessário reproduzir exatamente relatórios antigos. |
| **5. Quem aprova e envia?** | O relatório envolve valores, dados bancários, autoria de ações e conteúdo comercial. A exportação atual gera download, sem definir esse processo de prestação de contas. Fonte: `src/lib/export/index.ts:27`. | Diego revisa e baixa no MVP; envio manual pelo canal acordado. Definir beneficiário, vencimento, destinatário e agrupamento ABC antes de automatizar. |

**Visitas não exigem começar do zero.** Há coleta por anúncio, mas ela não certifica automaticamente toda a loja; visitas de anúncios compartilhados também não podem ser somadas por SKU. A conversão equivalente ao resumo do ML permanece dependente de definição e fonte validada. Fontes: `supabase/functions/coletar-trafego-ml/index.ts:1`; `src/lib/sku-trafego.ts:11`, `:129`.

## 7. Plano de implementação em fatias — sem código

Estimativa inicial: **7–12 dias úteis de engenharia**, após as decisões financeiras, com dados de validação disponíveis. Histórico completo de autoria e automação de envio ficam fora dessa estimativa.

| Fatia | Escopo e arquivos | Validação e critério de conclusão |
|---|---|---|
| **1 — Contrato financeiro e temporal** — 1–2 dias | Documentar resultado, margem, devoluções, cobertura e comparação. Revisar `sales-summary.ts`, `sales-costs.ts`, `metrics-repository.ts` e tipos de `platform-admin`. Definir a ponte entre bruto operacional e cobrança. | Casos de pack parcialmente custeado, cupom, reembolso parcial, mês sem vendas e configuração tributária ausente. Nenhum valor desconhecido vira zero ou lucro integral. |
| **2 — Dados do painel por organização** — 2–3 dias | Ampliar leitura em `_shared/platform-admin/`, `handler.ts`, `repository.ts`, `types.ts` e `usePlatformAdmin.ts`. Entregar diário, histórico financeiro, ABC e Ads sob demanda. Corrigir comparação agregada da carteira. | Testar isolamento de organizações, períodos, packs, unidades, custos, ABC completo antes do top 5 e carteira com mais de uma página. Preservar autorização do super-admin de `auth.ts:4`. |
| **3 — Resultados premium** — 1–2 dias | `OrganizacaoDetalhe.tsx`, `org-results.tsx` e componentes locais necessários; ajustes pontuais em `Organizacoes.tsx`. Reutilizar `Select`, `KpiCard`, tabelas e padrões de gráfico existentes. | Testes de mês/URL, comparação, indisponibilidade e expansão. QA em desktop/mobile e claro/escuro; teclado, foco, tooltip, tabela alternativa e textos longos. |
| **4 — PDF mensal** — 2–3 dias | Novo renderer/adapter em `src/lib/export/`, integrado à organização. Reutilizar `pdf-dashboard.ts`, `pdf.ts` e dados de `platform-billing.ts`, preservando o PDF atual do cliente. | Três páginas legíveis; máximo cinco produtos; histórico condicional; comissão diferente de total; Ads provisório; reexportação com cobrança congelada após devolução tardia. Renderizar e revisar visualmente. |
| **5 — Evidências de gestão e piloto** — 1–2 dias | Agregar operações confirmadas, autoria e próximos passos; validar fonte de novas publicações. Acrescentar tráfego apenas com cobertura certificada. | Uma organização piloto e um mês fechado: conciliar vendas, Ads e demonstrativo. Confirmar que cliente entende resultado e depósito em dois minutos. |

**Testes existentes que devem orientar essas fatias:**

- Backend financeiro: `supabase/functions/_shared/platform-admin/__tests__/metrics-repository.test.ts`, `metrics-parity.test.ts` e `repository.test.ts`.
- Interface: `src/components/platform-admin/__tests__/org-results.test.tsx` e `src/pages/__tests__/OrganizacaoDetalhe.test.tsx`.
- ABC, tráfego e Ads: `tests/lib/vendas-sku.test.ts`, `sku-trafego.test.ts` e `ads-metricas.test.ts`.
- Exportação: `src/lib/export/__tests__/pdf-dashboard.test.ts` e `platform-billing.test.ts`.
- Cobrança SQL: `supabase/tests/platform_billing.sql`, exclusivamente em banco de teste.

Esses testes foram identificados, **não executados nesta análise**. A implementação deve rodar apenas os conjuntos afetados por cada fatia, além da revisão visual do novo PDF.

**Próxima ação — 2 minutos:** confirme se o indicador principal será **“resultado após Ads, antes da remuneração Daludi e das despesas fixas”**. Essa escolha define a fórmula do painel e do relatório.