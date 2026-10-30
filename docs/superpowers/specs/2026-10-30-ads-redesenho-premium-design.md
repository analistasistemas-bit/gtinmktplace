# Spec — redesenho premium do /ads (2026-10-30)

Fonte: seções 2–5 de [docs/superpowers/plans/2026-10-30-ads-redesign-premium.md](../plans/2026-10-30-ads-redesign-premium.md); em divergência, vale o plano + ADR-0179.

## 2. Inventário de dados

### 2.1. Fontes existentes

| Fonte | Conteúdo disponível | Limitação |
|---|---|---|
| `ml_ads_conta_dia` | `cost`, `clicks`, `prints`, valores atribuídos diretos, indiretos e totais, por dia | Não guarda quantidades de vendas, unidades ou CVR |
| `ml_ads_grupo_dia` | Os campos anteriores, mais `direct_units` e `units` | Unidade é grupo de Ads; não campanha histórica |
| RPC `ads_painel(p_desde,p_ate)` | Série da conta e agregados por grupo, com membros atuais | Não devolve unidades; seleciona grupos com gasto ou receita atribuída |
| `ads-campanhas` | Configuração atual, anúncios, status, patrocínio e equilíbrio pelo preço | Não pede métricas; cache atual de 600 segundos |
| `ml_vendas`, `ml_vendas_itens`, `venda_item_custo` e cadastro | Faturamento, líquido, cupom, custo congelado e referências financeiras | Histórico e completude precisam permanecer explícitos |

A lista atual de métricas de grupo está em `supabase/functions/_shared/ads/fiacao.ts:8`:

```text
CLICKS, PRINTS, COST,
DIRECT_AMOUNT, INDIRECT_AMOUNT, TOTAL_AMOUNT,
DIRECT_UNITS_QUANTITY, UNITS_QUANTITY
```

A série da conta pede somente:

```text
clicks, prints, cost,
direct_amount, indirect_amount, total_amount
```

Portanto, **ter unidades nos grupos não significa ter vendas atribuídas ou conversão completas da conta**. Somar grupos identificados também não substitui o total do anunciante.

### 2.2. Endpoints adotados

Prefixo já usado e medido pelo projeto:

```text
/marketplace/advertising/MLB
```

| Identificador | Endpoint | Uso |
|---|---|---|
| E1 | `/advertisers/{advertiser_id}/product_ads/campaigns/search` | Resumo do anunciante e campanhas com métricas |
| E2 | E1 com `aggregation_type=DAILY` | Série diária da conta; as linhas não identificam campanha |
| E3 | `/product_ads/campaigns/{campaign_id}` | Resumo de uma campanha e competitividade |
| E4 | E3 com `aggregation_type=DAILY` | Série diária da campanha |
| E5 | `/advertisers/{advertiser_id}/product_ads/ads/search` | Listagem atual de anúncios, preservando o uso existente |

E1–E4 usam `api-version: 2`, `date_from` e `date_to`. E1 deve pedir `metrics_summary=true` quando precisar do resumo.

A documentação pública confirma métricas por campanha, agregação diária, `metrics_summary` e datas; também documenta retenção de 90 dias para trás. A aplicação deve confirmar a fronteira exata em chamada real, inclusive o comportamento dos status históricos. [Documentação oficial Product Ads v2](https://developers.mercadolivre.com.br/pt_br/product-ads-para-catalogo-e-user-products-leitura).

**Não usar métricas de E5 no redesenho.** A documentação marca os endpoints de métricas por anúncio como depreciados/removidos, apesar das respostas observadas pelos spikes existentes. A listagem atual de configuração permanece como já está; desempenho novo usa campanha ou grupo. [Documentação oficial sobre métricas e Ad Groups](https://global-selling.mercadolibre.com/devsite/en_us/seller-campaign/new-product-ads).

### 2.3. KPIs do topo: resultado comercial

Todos os quocientes usam valores agregados do período. Nunca calcular média de ROAS, ACOS, CTR ou CPC diários.

| KPI | Fonte exata | Já coletado? | Fórmula e regra |
|---|---|---|---|
| **Investimento** | E1/E2: `cost`; histórico em `ml_ads_conta_dia.cost` | Sim | `Σ cost` |
| **Vendas por Ads** | E1: `advertising_items_quantity` | Não | Quantidade atribuída devolvida pelo ML; não substituir por unidades |
| **ROAS** | E1: `total_amount`, `cost` | Insumos, sim | `Σ total_amount ÷ Σ cost`; investimento zero → indisponível |
| **ACOS** | E1: `cost`, `total_amount` | Insumos, sim | `Σ cost ÷ Σ total_amount`; receita atribuída zero → indisponível |
| **TACOS da conta** | Investimento de E1 + faturamento canônico ML do PubliAI | Insumos, sim | `investimento ÷ faturamento total ML no período`; receita zero ou histórico incompleto → indisponível |

**Faturamento do TACOS:** todas as vendas faturáveis da organização no Mercado Livre, incluindo vendas fora do cadastro PubliAI. Usar `paid`, `partially_refunded` e `refunded`, conforme `STATUS_FATURAVEL`, sem reinterpretar o tratamento financeiro existente.

Fonte de leitura: `buscarVendas()` em `src/lib/faturamento.ts:19`, com origem `todos`, canal `mercado_livre` e o intervalo BRT exato. Somar cada venda uma vez usando `brutoDaVenda()`:

```text
total_amount − cupom_vendedor
```

A definição canônica está em `supabase/functions/_shared/platform-admin/sales-summary.ts:115`. Não usar somente vendas das famílias patrocinadas ou somente linhas com custo.

**Importante:** o TACOS próprio deve aparecer como “TACOS da conta”. O campo `tacos` existente em alguns recursos do ML não comprova esse mesmo denominador.

### 2.4. KPIs do topo: alcance e eficiência

| KPI | Fonte exata | Já coletado? | Fórmula e regra |
|---|---|---|---|
| **Impressões** | E1/E2: `prints` | Sim | `Σ prints` |
| **Cliques** | E1/E2: `clicks` | Sim | `Σ clicks` |
| **CTR** | `clicks`, `prints` | Insumos, sim | `Σ clicks ÷ Σ prints`; impressões zero → indisponível |
| **CPC** | `cost`, `clicks` | Insumos, sim | `Σ cost ÷ Σ clicks`; cliques zero → indisponível |
| **Conversão — CVR do ML** | E1: `metrics_summary.cvr`; E3: `metrics.cvr` | Não | Normalizar percentual da API para fração interna; usar o agregado nativo, nunca média diária |

**CVR precisa de confirmação semântica no spike.** A documentação nomeia o campo, mas não fornece uma definição suficientemente inequívoca para escolher entre vendas e unidades no numerador. Não implementar `vendas ÷ cliques` ou `unidades ÷ cliques` por suposição. Se o campo agregado não vier, apresentar “Indisponível: o ML não retornou a conversão deste período”.

O exemplo documentado distingue quantidades de vendas e unidades. Essa diferença também impede chamar `units_quantity` de pedidos. [Glossário oficial de métricas](https://developers.mercadolivre.com.br/en_us/android/product-ads-us-read).

### 2.5. Métricas do detalhe

| Métrica | Fonte | Situação e apresentação |
|---|---|---|
| Receita Ads | `total_amount` | Já coletada; valor monetário. Aparece como apoio ao card Vendas por Ads e na tabela de campanhas |
| Receita direta / indireta | `direct_amount`, `indirect_amount` | Já coletadas; mostrar separadamente |
| Vendas diretas / indiretas | `direct_items_quantity`, `indirect_items_quantity` | Leitura nova sob demanda; campos ausentes ficam indisponíveis |
| Unidades diretas / indiretas / totais | `direct_units_quantity`, `indirect_units_quantity`, `units_quantity` | Diretas/totais já existem por grupo; conta e campanha vêm de E1/E3. Não derivar indiretas sem validar a identidade |
| Outras vendas e participação Ads | `organic_items_quantity`, `organic_units_quantity`, `organic_units_amount`, `sov` | Documentadas; confirmar no spike. Identificar como universo dos anúncios promovidos, sem chamar de orgânico da conta inteira |

### 2.6. Diferencial financeiro

| Indicador | Fonte exata | Fórmula e proteção |
|---|---|---|
| Lucro antes de Ads | Mesmo pipeline de `agruparPorPedido()` → `montarVendasSku()` → `metricas()` | Líquido econômico após imposto menos custo; preservar custo congelado, estimado e parcial |
| **Resultado após Ads** | Lucro da conta + `cost` da série completa do anunciante | `lucro antes de Ads − investimento`; nunca receita atribuída menos investimento |
| **Equilíbrio observado da família** | `lucroPorFamilia()` e `FamiliaPainel.acosEquilibrio` | `lucro antes de Ads ÷ brutoComCusto`, com as travas atuais |
| **Equilíbrio pelo preço atual** | `equilibrioDoMlb()` em `_shared/ads/campanhas.ts:140` | `(líquido no preço − custo) ÷ preço`; pior variação; família usa a referência conservadora existente |
| Equilíbrio observado da conta | Agregados financeiros da conta | `lucro antes de Ads ÷ faturamento da conta`, somente com base completa; referência de mix, sem semáforo contra o ACOS total |

**Não misturar os dois equilíbrios.**

- Desempenho: “ACOS de equilíbrio observado”, referente às vendas do período.
- Campanhas, no detalhe dos produtos: “ACOS de equilíbrio no preço atual”.
- O semáforo realizado da família continua comparando **ACOS direto** com equilíbrio observado.
- A referência da conta não autoriza distribuir margem entre campanhas.

Custo parcial mantém o tratamento atual, mas o texto passa a dizer **“Resultado parcial após Ads”**. Custo estimado exige marca **“Estimado”**. Nenhum desses estados recebe uma afirmação de lucro completo.

### 2.7. Disponibilidade dos demais elementos do ML

| Elemento | Verificação | Decisão |
|---|---|---|
| Impressões ganhas e perdidas | E3 documenta `impression_share`, `lost_impression_share_by_budget` e `lost_impression_share_by_ad_rank` | Implementar após spike; usar o agregado nativo da campanha |
| Impressões nas primeiras posições | `top_impression_share` | Não confundir com todas as impressões ganhas |
| Diagnóstico “Aprendendo” e tipo automática/personalizada | Não vieram no spike 057 | **Indisponíveis para o app**; não inferir por idade, estratégia ou nome |
| Bandeiras de alterações | Há `last_updated`, mas não há histórico validado de eventos no projeto | **Indisponível nesta entrega**; `last_updated` não reconstrói alterações |
| Lucro causal, margem da venda indireta e resultado por campanha | Não há atribuição financeira suficiente | **Indisponíveis**; não ratear lucro ou custos |

As métricas de competitividade estão documentadas no detalhe da campanha. A documentação não prova que todas estejam liberadas para o anunciante e a rota usados pelo app. Também não se deve calcular a participação da conta fazendo média das campanhas. [Métricas oficiais de competitividade](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/product-ads-para-catalogo-e-user-products-leitura).

## 3. Arquitetura de informação

### 3.1. Contexto único

O cabeçalho controla **as duas abas**:

```text
Ads
Período: Mês atual | 7 dias | 30 dias | 90 dias | Personalizado
Comparar com: Período anterior | Sem comparação
Intervalo efetivo em BRT
Atualizar
```

Regras:

1. Manter **Mês atual** como padrão; preferência e URL válidas têm precedência.
2. Usar dias completos até **ontem em BRT**. A coleta atrasada não desloca silenciosamente o período.
3. Personalizado só consulta após “Aplicar”; validar datas reais, ordem, duração e retenção.
4. Comparação anterior contém o mesmo número de dias completos, imediatamente antes do início atual.
5. Preservar período, comparação e aba na URL; usar a preferência antiga apenas quando a URL não os informar.

A seleção não depende da coleta agendada. Isso permite consultar Campanhas mesmo em uma organização cuja coleta financeira ainda não esteja pronta.

**Retenção:** não dividir chamadas para tentar contornar a retenção do ML. Uma janela anterior fora da disponibilidade fica indisponível, com motivo. O preset de 90 dias continua útil, mesmo quando a comparação anterior não é possível.

### 3.2. Ordem das seções

| Ordem | Desempenho | Campanhas |
|---|---|---|
| 1 | Contexto e faixa de KPIs da conta | O mesmo contexto e KPIs da conta, identificados como “Conta inteira” |
| 2 | Evolução diária da conta | Evolução diária da conta |
| 3 | Resultado após Ads e equilíbrio observado | O mesmo resultado da conta; nunca apresentado como resultado das campanhas |
| 4 | “Onde revisar” e ranking de famílias | Tabela de campanhas por período |
| 5 | Integridade e procedência | Detalhe da campanha, produtos atuais e integridade |

O resultado financeiro deve ser o elemento mais forte do terceiro bloco. Um resumo textual no cabeçalho desse bloco liga o valor à ação:

> “Resultado da conta após Ads”  
> “Ver famílias acima do equilíbrio”

Não produzir recomendações automáticas de aumentar orçamento.

### 3.3. Desempenho

A tabela principal deixa de usar “Ads X% de Y% possíveis”.

Visão padrão:

```text
Família | Investimento | ACOS direto | Equilíbrio observado | Resultado após Ads
```

Uma coluna pode usar duas linhas para número e estado, mas cada número mantém seu rótulo.

Busca por nome/código; filtros compactos:

```text
Todas | Acima do equilíbrio | Dentro do equilíbrio | Sem referência
```

Ordenação padrão: investimento decrescente, preservando o comportamento atual. O atalho “Ver famílias acima do equilíbrio” aplica o filtro e ordena por maior investimento.

No detalhe permanecem receita direta/total, ROAS direto/total, markup, composição, grupos, cobertura e links existentes.

### 3.4. Campanhas

Substituir a sequência de campanhas abertas por uma tabela comparável:

```text
Campanha | Investimento | Vendas Ads | Receita Ads | ROAS | ACOS
```

O nome inclui estado atual e acesso ao detalhe.

Visões de colunas:

| Visão | Colunas |
|---|---|
| Resultado | Investimento, Vendas Ads, Receita Ads, ROAS, ACOS |
| Eficiência | Impressões, Cliques, CTR, CPC, Conversão |
| Detalhe | Diretas/indiretas, unidades e valores; não ampliar a tabela principal |

Filtros de status mudam somente as linhas. **Não mudam os totais da conta.**

Incluir campanhas históricas devolvidas pelo ML com métricas no período, inclusive `deleted` e `error` quando suportadas. A tabela não pode depender somente da lista atual `active,paused`.

### 3.5. Drill-down da campanha

Abrir `Sheet` no desktop e detalhe de largura completa no mobile:

```text
Nome da campanha
Métricas do período
  Resumo + série diária + comparação
Competitividade
  Ganhas / perdidas por orçamento / perdidas por classificação
Configuração atual
  Estado, estratégia, orçamento diário, ROAS objetivo
Produtos patrocinados atualmente
  Famílias → grupos → MLBs
```

Reutilizar `BlocoCampanha`, `FamiliaCampanha` e `LinhaMlb` para o conteúdo atual.

**Separação histórica obrigatória:** produtos patrocinados hoje não representam automaticamente os produtos responsáveis pelas métricas históricas. Mostrar:

> “Produtos patrocinados atualmente. A composição pode ter mudado durante o período.”

O link para o desempenho financeiro da família conserva o mesmo período, mas abre a análise global daquela família — não uma margem atribuída à campanha selecionada.

## 4. Especificação visual

### 4.1. Direção de design

**Modo: system work.** Herdar `src/index.css`, Geist Variable e componentes Radix/shadcn existentes. As telas de referência internas são `src/pages/Promocoes.tsx` e `src/components/faturamento/aba-vendas-sku.tsx`.

**Assunto:** investimento em Product Ads confrontado com a margem do vendedor.  
**Público:** vendedor que conhece o Mercado Ads e precisa decidir rapidamente.  
**Trabalho da tela:** mostrar resultado, risco financeiro e local da revisão.

A consulta à skill UI/UX favoreceu densidade organizada, tabelas, filtros e gráficos temporais. A recomendação de landing page, paleta e fontes novas foi descartada porque a identidade do PubliAI já existe.

A intenção visual é **uma demonstração financeira legível, com a familiaridade dos indicadores do Mercado Ads**.

### 4.2. Wireframe — Desempenho desktop

Os wireframes representam estrutura; não apresentam métricas fictícias.

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Ads                                          Atualizar                 │
│ Período [Mês atual ▾]  [Personalizado]  Comparar [Anterior ▾]            │
│ Datas efetivas · BRT                    Datas comparadas · Provisório   │
├────────────────────────────────────────────────────────────────────────┤
│ [Desempenho] [Campanhas]                                                │
│ CONTA INTEIRA                                                          │
│ Investimento │ Vendas por Ads │ ROAS │ ACOS │ TACOS da conta            │
│ valor/delta  │ qtd + receita  │      │      │                           │
│ Impressões   │ Cliques        │ CTR  │ CPC  │ Conversão                 │
├────────────────────────────────────────────────────────────────────────┤
│ Evolução diária                 Séries [Investimento] [Receita Ads]    │
│                                                                        │
│          barras + linha; datas; unidade; faixa provisória               │
│                                                                        │
│ Legenda identificada                              [Ver dados em tabela]│
├────────────────────────────────────────────────────────────────────────┤
│ RESULTADO DA CONTA APÓS ADS          EQUILÍBRIO OBSERVADO DA CONTA       │
│ Valor + estado de completude        Percentual + referência do mix      │
│ Antes de Ads − investimento         [Como é calculado]                 │
│ [Ver famílias acima do equilíbrio]                                     │
│ Ressalva causal e avisos de integridade                                 │
├────────────────────────────────────────────────────────────────────────┤
│ Famílias                  [Buscar nome ou código] [Todas ▾]            │
│ Família │ Investimento │ ACOS direto │ Equilíbrio │ Resultado │ Detalhes│
│                         linhas ordenáveis                              │
├────────────────────────────────────────────────────────────────────────┤
│ Integridade: não identificado · compartilhado · cobertura · histórico  │
│ Origem dos números e horários de leitura/coleta                         │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.3. Wireframe — Desempenho mobile

```text
┌──────────────────────────────────┐
│ Ads                  Atualizar   │
│ [Mês atual ▾] [Comparar ▾]        │
│ Datas · BRT · Provisório         │
│ [Desempenho] [Campanhas]          │
├──────────────────────────────────┤
│ Investimento  │ Vendas por Ads    │
│ ROAS          │ ACOS              │
│ [Mostrar todos os indicadores]   │
├──────────────────────────────────┤
│ Evolução diária                  │
│ [Série principal ▾]              │
│ gráfico com datas e unidade      │
│ [Ver dados em tabela]            │
├──────────────────────────────────┤
│ Resultado da conta após Ads      │
│ valor + estado                   │
│ Equilíbrio observado             │
│ [Ver famílias acima do equilíbrio]│
│ avisos e ressalva causal         │
├──────────────────────────────────┤
│ Famílias                         │
│ [Buscar] [Situação ▾]            │
│ Nome da família                  │
│ Investimento                     │
│ ACOS direto │ Equilíbrio         │
│ Resultado + motivo quando ausente│
│ [Detalhes]                       │
└──────────────────────────────────┘
```

Os seis indicadores restantes ficam acessíveis em expansão identificada. Não usar carrossel horizontal de KPIs.

### 4.4. Wireframe — Campanhas desktop

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Ads · período/comparação compartilhados                    Atualizar   │
│ [Desempenho] [Campanhas]                                                │
├────────────────────────────────────────────────────────────────────────┤
│ CONTA INTEIRA: faixa dos dez indicadores + evolução diária              │
├────────────────────────────────────────────────────────────────────────┤
│ Resultado após Ads da conta │ Equilíbrio observado da conta             │
│ Integridade financeira                                                 │
├────────────────────────────────────────────────────────────────────────┤
│ Campanhas                                                             │
│ [Buscar campanha] [Status ▾]              [Visão: Resultado ▾]          │
│ Campanha │ Investimento │ Vendas Ads │ Receita Ads │ ROAS │ ACOS        │
│ Nome     │ valor/delta  │ qtd/delta  │ valor/delta │      │             │
│ Estado atual                                     [Ver campanha]        │
└────────────────────────────────────────────────────────────────────────┘

Ao abrir uma campanha:
┌──────────────────────────────────────────────────┐
│ Campanha                                    Fechar│
│ MÉTRICAS DO PERÍODO · datas                      │
│ indicadores + comparação + gráfico diário        │
│ Competitividade: barras rotuladas                │
├──────────────────────────────────────────────────┤
│ CONFIGURAÇÃO ATUAL · lida em                     │
│ Estado │ Orçamento │ ROAS objetivo │ Estratégia   │
├──────────────────────────────────────────────────┤
│ PRODUTOS PATROCINADOS ATUALMENTE                  │
│ Família │ Equilíbrio no preço atual │ Alertas    │
│   Expandir → grupos e MLBs                       │
└──────────────────────────────────────────────────┘
```

### 4.5. Wireframe — Campanhas mobile

```text
┌──────────────────────────────────┐
│ Ads · período e comparação       │
│ [Desempenho] [Campanhas]          │
│ KPIs da conta + gráfico          │
│ Resultado financeiro da conta    │
├──────────────────────────────────┤
│ Campanhas                        │
│ [Buscar] [Status ▾] [Visão ▾]    │
│ Nome + estado atual              │
│ Investimento │ Receita Ads       │
│ Vendas Ads   │ ROAS │ ACOS       │
│ comparação por indicador         │
│ [Ver campanha]                   │
├──────────────────────────────────┤
│ Detalhe em largura completa      │
│ [Voltar para campanhas]          │
│ Métricas do período              │
│ gráfico + competitividade        │
│ Configuração atual               │
│ Produtos atuais → detalhes       │
└──────────────────────────────────┘
```

### 4.6. Componentes, densidade e tipografia

| Elemento | Especificação |
|---|---|
| Contêiner | Preservar `max-w-[1440px]`, `p-4 sm:p-6`; escala de espaçamento de 4 px |
| Tipografia | Geist existente; título `text-h1`, seções `text-h3`, números dos KPIs em 24 px, resultado em 28–32 px |
| Números | `tabular-nums`; valores alinhados à direita; R$ com duas casas; razões com `×`; porcentagens e p.p. explicitados |
| Tabelas | Cabeçalhos ordenáveis com `aria-sort`; nome em até duas linhas com acesso ao texto completo; detalhes por botão rotulado |
| Controles | `Select` de `src/components/ui/select.tsx`; `Input`, `Button`, `Popover`, `Sheet`, `Skeleton`, `Table` e `StatusPill` existentes |

No mobile, controles e texto principal usam 16 px; metadados podem usar 12–14 px. Alvos de toque de pelo menos 44 × 44 px, com foco visível.

Não modificar o `SeletorPeriodo` global apenas para atender Ads: ele oferece “Hoje” e usa resolução local de datas. Criar um componente específico, pequeno, reaproveitando o idioma visual e os primitives existentes.

### 4.7. Cores e acessibilidade

| Significado | Tokens | Regra |
|---|---|---|
| Favorável | `success` + ícone/texto | Resultado completo positivo; família dentro do equilíbrio |
| Desfavorável | `danger` + ícone/texto | Resultado completo negativo; ACOS direto acima do equilíbrio |
| Atenção | `warning` | Dados provisórios, incompletos ou coleta atrasada |
| Neutro | `foreground`, `muted-foreground`, `border` | Zero, ausência de comparação e variação sem interpretação financeira |
| Seleção | `primary`, `ring` | Série selecionada, aba e foco; não significa resultado positivo |

Os tokens atuais de texto sobre `bg-card` apresentam contraste calculado em sRGB de aproximadamente:

| Texto | Claro | Escuro |
|---|---:|---:|
| `success` | 5,32:1 | 6,10:1 |
| `danger` | 5,56:1 | 4,88:1 |
| `warning` | 5,39:1 | 8,04:1 |
| `muted-foreground` | 5,52:1 | 5,95:1 |

Esses cálculos não substituem a medição no navegador. **Não presumir que o mesmo contraste vale sobre fundos translúcidos:** `danger` sobre sua tonalidade de 10% no escuro ficou abaixo de 4,5:1 no cálculo. Nos novos avisos, usar texto semântico sobre `bg-card`, ou texto `foreground` acompanhado de ícone semântico.

Variação crescente não significa automaticamente bom:

- Investimento, impressões, cliques e CPC: neutros.
- ROAS, ACOS e conversão: sinal de eficiência somente com comparação válida; não equivalem a lucro.
- Qualquer comparação com atribuição aberta: neutra e marcada “Provisória”.
- Resultado financeiro: cor somente quando a base permite interpretação completa.

A faixa de KPIs deve controlar direção da seta e significado separadamente. Não passar queda de ACOS como `deltaTrend="up"` apenas para obter verde no `KpiCard` existente.

### 4.8. Gráficos

**Biblioteca existente:** `recharts: ^3.8.1`, em `package.json:41`. Não adicionar dependência.

Reutilizar padrões de `src/components/sku-dossie/serie-dossie.tsx` e `ads-dossie.tsx`, sem extrair uma biblioteca genérica.

| Aspecto | Especificação |
|---|---|
| Padrão | Investimento em barras e Receita Ads em linha, ambos em R$, no mesmo eixo |
| Seleção | Até duas séries; ao escolher uma terceira, solicitar substituição por controle explícito |
| ROAS | Segundo eixo somente quando selecionado, rotulado em `×`; linha linear, sem suavização que sugira valores não observados |
| Provisório | Faixa hachurada com descrição; dia ausente é lacuna, nunca zero |
| Acessibilidade | Legenda com nomes/formas, tooltip por foco/toque e alternativa “Ver dados em tabela” |

“Vendas Ads × Outras vendas + ROAS” pode ser uma visão adicional após o spike confirmar os campos. “Outras vendas” deve explicar o universo considerado pelo ML.

No mobile, iniciar com uma série e permitir a segunda. Reservar altura para evitar salto de layout e respeitar `prefers-reduced-motion`.

### 4.9. Estados e microcopy

| Estado | Apresentação | Texto/ação |
|---|---|---|
| Carregamento inicial | Skeleton nas posições finais; carregamento independente por bloco | “Lendo as métricas do período…” |
| Atualização da mesma janela | Manter valores com horário visível | “Atualizando…” |
| Novo período | Retirar números da janela anterior das posições atuais | Skeleton; não reetiquetar dados antigos |
| Sem gasto, leitura completa | Investimento zero explícito; ROAS e razões sem denominador ficam indisponíveis | “Sem investimento em Ads neste período. Suas campanhas continuam disponíveis.” |
| Erro ou dado indisponível | Motivo ao lado do bloco/célula | “O ML não retornou esta métrica.” / “Tentar novamente” |

Demais textos obrigatórios:

```text
Resultado depois da despesa de Ads; não é o lucro causado pelo Ads.

ACOS direto: investimento dividido pela receita atribuída diretamente
aos produtos desta família.

Equilíbrio observado: margem antes de Ads nas vendas desta família
durante o período. O mix das vendas atribuídas pode ser diferente.

Comparação provisória: o ML ainda pode revisar a atribuição de vendas.

Sem comparação: o período anterior está fora do histórico disponível no ML.

Gasto compartilhado entre famílias: não foi rateado.

Gasto de Ads não identificado: incluído no investimento da conta,
sem distribuição entre famílias.

Resultado indisponível: confirme as alíquotas em Configurações.

Produtos patrocinados atualmente. A composição pode ter mudado
durante o período.
```

Sem conexão, anunciante ou permissão: preservar os textos e caminhos de recuperação de `src/components/ads/aviso.tsx`.

## 5. Backend e contratos

### 5.1. Decisão de arquitetura

Criar **`ads-metricas`**, uma edge de leitura sob demanda.

Preservar:

- `ads-campanhas`: configuração atual e projeção de margem, cache de 600 segundos.
- `coletar-ads-ml`: coleta diária existente, sem ampliação de cron ou de schema.
- RPCs e tabelas atuais: continuam atendendo histórico e detalhe financeiro das famílias.

A nova edge evita acoplar a consulta rápida de métricas à leitura de cadastro, itens e tarifas da configuração atual.

**Nenhuma migration é necessária.** Os dados novos são consultados sob demanda e mantidos em Redis. Não persistir CVR, unidades ou métricas históricas de campanha em novas tabelas.

### 5.2. Contrato de entrada

```ts
type EscopoAdsMetricas =
  | 'conta'
  | 'campanhas'
  | 'campanha'
  | 'competitividade';

interface PedidoAdsMetricas {
  desde: string;
  ate: string;
  comparar: 'anterior' | 'nenhum';
  escopo: EscopoAdsMetricas;
  campanhaId?: number;
  fresco?: boolean;
}
```

`POST` da aplicação com JWT; no ML, somente `GET`. O refresh OAuth existente permanece a única exceção técnica.

**Segurança:** resolver organização por `requireUserOrg(req, { access: 'read' })`, verificar módulo `ads` e resolver a conexão dessa organização. Não aceitar `org_id` ou `advertiser_id` do body.

Para consultar E3/E4, verificar previamente que o `campanhaId` pertence ao anunciante resolvido. A presença do ID na URL não é autorização.

### 5.3. Contrato de saída

```ts
type MetricaBrutaAds =
  | 'cost' | 'prints' | 'clicks'
  | 'direct_amount' | 'indirect_amount' | 'total_amount'
  | 'direct_items_quantity' | 'indirect_items_quantity'
  | 'advertising_items_quantity'
  | 'direct_units_quantity' | 'indirect_units_quantity' | 'units_quantity'
  | 'organic_items_quantity' | 'organic_units_quantity'
  | 'organic_units_amount' | 'cvr' | 'sov'
  | 'impression_share' | 'top_impression_share'
  | 'lost_impression_share_by_budget'
  | 'lost_impression_share_by_ad_rank';

type MotivoMetricaAds =
  | 'nao_retornada'
  | 'fora_da_retencao'
  | 'sem_denominador'
  | 'resposta_invalida'
  | 'sem_permissao'
  | 'limite_de_leitura';

interface ValorAds {
  valor: number | null;
  motivo: MotivoMetricaAds | null;
}

interface JanelaAdsMetricas {
  desde: string;
  ate: string;
}

interface DiaAdsMetricas {
  dia: string;
  metricas: Partial<Record<MetricaBrutaAds, ValorAds>>;
}

interface BlocoAdsMetricas {
  janela: JanelaAdsMetricas;
  resumo: Partial<Record<MetricaBrutaAds, ValorAds>>;
  serie: DiaAdsMetricas[];
  completo: boolean;
  lidoEm: string;
}

interface CampanhaPeriodoAds {
  id: number;
  nome: string;
  statusAtual: string;
  atual: BlocoAdsMetricas;
  anterior: BlocoAdsMetricas | null;
}

interface RespostaAdsMetricas {
  ok: true;
  estado:
    | 'ok'
    | 'parcial'
    | 'sem_conexao'
    | 'sem_advertiser'
    | 'sem_acesso'
    | 'sem_permissao';
  escopo: EscopoAdsMetricas;
  atual: BlocoAdsMetricas | null;
  anterior: BlocoAdsMetricas | null;
  campanhas: CampanhaPeriodoAds[];
  comparacao: {
    estado: 'disponivel' | 'provisoria' | 'indisponivel' | 'desligada';
    motivo: string | null;
  };
  disponibilidade: {
    desde: string;
    ate: string;
    fuso: 'America/Sao_Paulo';
  };
  avisos: string[];
}
```

Campos percentuais brutos preservam a unidade documentada pelo fornecedor; o adaptador de apresentação normaliza para fração. Identificar essa conversão por campo, sem heurística do tipo “valor maior que 1”.

Regras do parser:

1. Zero explícito é zero; campo ausente é `null` com motivo.
2. Dia repetido, fora do intervalo ou valor principal inválido invalida a série.
3. A série completa deve conter cada dia solicitado; não preencher lacunas com zero.
4. Paginação incompleta não produz total completo.
5. `metrics_summary` é consumido uma vez; não somar o mesmo resumo em cada página.

### 5.4. Leitura por escopo

| Escopo | Chamadas |
|---|---|
| `conta` | E1 com resumo + E2; repetir para anterior somente quando disponível |
| `campanhas` | E1 paginado para atual e anterior; unir pelo ID, preservando campanhas presentes em apenas uma janela |
| `campanha` | E3/E4 da campanha autorizada, para atual e anterior |
| `competitividade` | E3 com campos de participação; leitura separada para falha opcional não derrubar os KPIs |

Usar `active,paused,deleted,error` nas consultas de desempenho quando confirmado pela rota real, seguindo os spikes 053/054. Configuração continua com seu universo atual.

Não reconstruir desempenho histórico usando `ml_ads_grupo.campaign_id`, que guarda somente a associação atual.

### 5.5. Cache, limites e idempotência

| Item | Regra proposta |
|---|---|
| Cache de métricas | 300 segundos, por versão do contrato, organização, conexão, anunciante, escopo, campanha, datas e comparação |
| Configuração atual | Manter 600 segundos; troca de período não invalida projeções de preço |
| Atualização forçada | No máximo uma por organização a cada 60 segundos, com `redisSetNX` existente |
| Orçamento da leitura | Concorrência máxima 4, até 20 páginas por requisição, até 32 chamadas externas incluindo retries e prazo total de 20 segundos |
| Erros transitórios | Uma repetição para 429/5xx dentro do prazo; respeitar `Retry-After`. Não repetir 403; 401 segue a reautenticação existente |

Esses tetos são **orçamentos da aplicação**, não limites alegados da API.

Quando o orçamento acabar, devolver indisponibilidade explícita do recurso afetado. Não armazenar uma listagem truncada como resposta completa.

A operação é idempotente: não escreve em campanhas, anúncios ou estoque; repetições substituem o cache da mesma chave. Não incrementam nem acumulam métricas de negócio.

Se o Redis não permitir impor o throttle da atualização forçada, recusá-la temporariamente com mensagem recuperável. Uma falha de cache não autoriza uma sequência ilimitada de chamadas.

### 5.6. Integração financeira sem misturar bases

A série completa da conta lida ao vivo pode alimentar o investimento do resultado financeiro. Para isso:

1. `useAdsPainel` recebe a janela já resolvida e a série da conta explicitamente validada.
2. O lucro vem das vendas nessa mesma janela BRT, com canal ML e origem `todos`.
3. A conta pode mostrar resultado mesmo sem coleta de grupos pronta, desde que vendas, base fiscal e série da conta estejam completas.
4. As famílias continuam dependendo da cobertura dos grupos; a disponibilidade da conta não libera seu semáforo.
5. A composição “famílias + compartilhado + não identificado” só é confrontada com a conta ao vivo quando a coleta cobre a janela e os custos diários da conta coletada conciliam em centavos com a leitura atual.

Se a última condição falhar:

> “A leitura atual do ML ainda não está conciliada com a coleta das famílias.”

Preservar a composição da última coleta em detalhe identificado pelo horário. Não transformar diferença de atualização em “gasto não identificado”.

A proteção fiscal deve verificar confirmação, configuração disponível e resolução da alíquota dos itens relevantes. Alíquota explicitamente zero é válida; ausência não é zero.
