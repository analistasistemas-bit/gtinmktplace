# Redesenho premium do `/ads` — análise e plano de implementação

> **Para Claude:** revisar este documento e executar por tarefas com `superpowers:executing-plans`. Esta entrega contém somente análise e planejamento; nenhum arquivo foi alterado.
>
> **Objetivo:** permitir que o vendedor identifique em cinco segundos o resultado da conta após Ads e quais famílias precisam de atenção.
>
> **Arquitetura:** métricas comerciais obtidas sob demanda do Mercado Ads; resultado financeiro calculado com as vendas e os custos reais do PubliAI; coleta existente preservada para a análise por família.
>
> **Stack:** React, TypeScript, TanStack Query, Radix/shadcn, Tailwind v4, Recharts e Vitest.
>
> **Destino sugerido deste documento:** `docs/superpowers/plans/2026-10-30-ads-redesenho-premium.md`.

**Estado: análise e planejamento concluídos — etapa 5 de 5.** A implementação depende dos spikes de confirmação descritos abaixo. Não foram executados testes, chamadas autenticadas ao ML nem validação visual da aplicação.

A análise consultou `CLAUDE.md`, ADR-0179 inteiro, spec original, spikes 053/054/055/057, componentes de Ads, hooks, domínio financeiro, coleta, migrations e referências visuais do sistema. `graphify-out/` está ausente. A restrição de filesystem impediu criar outra worktree; toda a leitura ocorreu na worktree fornecida.

## 1. Diagnóstico

### 1.1. Por que a leitura atual exige esforço

| Problema | Evidência | Consequência |
|---|---|---|
| O período desaparece em Campanhas | `src/pages/Ads.tsx:276` condiciona as ações do cabeçalho à aba Desempenho | O usuário perde o principal controle de análise ao trocar de aba |
| A tela apresenta primeiro uma conta financeira, depois os indicadores publicitários | `src/components/ads/resumo-conta.tsx:187` e `:206` | É necessário compreender a decomposição da margem antes de reconhecer ROAS, ACOS e vendas |
| Dois percentuais diferentes aparecem condensados em uma frase | `src/components/ads/ranking-familias.tsx:67` | “Ads X% de Y% possíveis” exige lembrar o significado e o denominador de cada número |
| Campanhas abre diretamente famílias e configurações | `src/components/ads/campanhas/bloco-campanha.tsx:39` e `:74` | Falta uma tabela de campanhas para comparar investimento, receita e eficiência |
| KPIs importantes ficam ausentes ou escondidos | `src/components/ads/resumo-conta.tsx:204`; `src/components/ads/detalhe-familia.tsx` | Impressões e cliques já existem no domínio, mas não ajudam a leitura inicial; outros indicadores exigem expansão |

O problema central é **hierarquia e vocabulário**, acompanhado de uma lacuna real de dados em Campanhas. Aumentar fontes ou adicionar cards à estrutura atual não resolve isso.

Há dois cuidados adicionais:

- O rótulo “ROAS objetivo acima da margem”, em `src/lib/ads-campanhas.ts:21`, não descreve a condição implementada em `:83`: o teste compara **ACOS-alvo > equilíbrio**. O novo texto deve ser “ACOS-alvo acima do equilíbrio”, preservando a regra.
- `src/hooks/useVendasSku.ts:43` permite alíquotas padrão quando a configuração ainda não chegou. O `/ads` precisa de uma proteção explícita para não apresentar resultado financeiro como completo nessa condição.

### 1.2. O que aproveitar dos prints do Mercado Ads

| Referência | Copiar | Superar ou evitar |
|---|---|---|
| Prints 3 e 6: tabelas | Alinhamento numérico, ordenação, busca, filtros e comparação por período | Evitar uma tabela larga com todos os indicadores simultaneamente; oferecer visões “Resultado” e “Eficiência” |
| Prints 4 e 5: métricas e gráfico | Período visível, seleção de indicadores e evolução diária | Limitar a duas séries; explicitar unidades dos eixos e dias provisórios |
| Print 5: detalhe da campanha | Separação entre configuração e desempenho | Distinguir “Configuração atual” de “Métricas do período”; não inventar diagnóstico ou tipo |
| Print 3: competitividade | Explicar onde a campanha perde exposição | Mostrar somente após confirmar os campos na conta real; preferir barras rotuladas ao donut |
| Print 7: visão geral | Um fluxo consistente de período → KPIs → gráfico → campanhas | Remover distrações de aprendizagem e ações de edição; acrescentar margem real e integridade financeira |

**Diferencial PubliAI:** mostrar quanto sobrou na conta após a despesa de Ads e quais famílias operaram acima da margem observada.

A interface não deve transformar esse diferencial em uma afirmação causal. “A conta ficou positiva após Ads” é verificável; “o Ads gerou esse lucro” não é.

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

## 6. Emenda ao ADR-0179 pronta para colar

```markdown
## Emenda — métricas por período e redesenho do /ads (2026-10-30)

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
```

## 7. Plano de implementação

### 7.1. Restrições globais e verificação

**Método:** cada tarefa de código começa com o teste indicado falhando, recebe a alteração mínima e termina com o mesmo comando passando. Os trechos de asserção abaixo especificam o comportamento; usar os setups existentes de Vitest/Testing Library.

As estimativas de **2–5 minutos são por tarefa**, para um executor já com o contexto carregado. Spikes, espera de infraestrutura e falhas novas podem ampliar o tempo total.

Antes da primeira alteração, Claude deve criar sua worktree e conferir a presença de `.env.test`. Antes do navegador, garantir `.env.local` com as duas variáveis Vite exigidas, sem imprimir valores.

**Review Focus obrigatório:**

| Condição | Comportamento esperado |
|---|---|
| Troca de organização/período com resposta pendente | Nenhum dado da chave anterior entra na nova tela |
| Ausência de imposto, custo ou histórico | Motivo explícito; nenhum zero ou resultado completo presumido |
| Campanha removida ou produto transferido | Métrica histórica vem do ML; composição atual não é apresentada como histórica |
| Janela anterior fora da retenção ou ainda aberta | Comparação indisponível ou provisória; nenhum percentual definitivo |
| Grupo com vários MLBs e gasto compartilhado | Contagem distinta e dinheiro sem duplicação/rateio |

**Interfaces principais a manter entre tarefas:**

```ts
resolverPeriodoAds(
  periodo: PeriodoAds,
  agora: Date,
  ultimoOkEm: string | null,
): ResolucaoPeriodoAds;

janelaAnteriorAds(janela: JanelaDiasAds): JanelaDiasAds;

indicadoresAds(
  resumo: BlocoAdsMetricas['resumo'],
  faturamentoConta: number | null,
): Record<string, ValorAds>;

compararIndicadorAds(
  atual: ValorAds,
  anterior: ValorAds,
  unidade: 'moeda' | 'quantidade' | 'razao' | 'percentual',
  provisoria: boolean,
): {
  texto: string;
  direcao: 'up' | 'down' | 'neutral';
  tom: 'success' | 'danger' | 'neutral';
};

buscarMetricasAds(
  pedido: PedidoAdsMetricas,
): Promise<RespostaAdsMetricas>;

useAdsMetricas(
  pedido: PedidoAdsMetricas | null,
  habilitado: boolean,
): {
  data: RespostaAdsMetricas | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
};
```

`PeriodoAds` ganha `{ tipo: 'range'; desde: string; ate: string }`. A resolução ganha estado inválido com motivo, sem converter datas inválidas em outra janela.

### 7.2. Bloco A — decisão e provas da API

**Task 01 — registrar a decisão — 3 min**

- [ ] Salvar este plano no destino indicado e acrescentar a seção 6 ao `docs/decisions/0179-painel-de-ads.md`.
- [ ] Criar `docs/superpowers/specs/2026-10-30-ads-redesenho-premium-design.md` com as seções 2–5.
- [ ] Verificar: `rtk pnpm docs:links`. Aceite: referências locais válidas e emenda anterior preservada.

**Task 02 — preparar spike reproduzível — 5 min; depende de 01**

- [ ] Criar `scripts/spike-ads-redesenho.py`, seguindo os scripts de spike existentes, com token somente em memória e saídas sanitizadas.
- [ ] Implementar `--help` e seleção explícita da conexão; não gravar payload com identificadores pessoais ou credenciais.
- [ ] Verificar: `rtk python3 scripts/spike-ads-redesenho.py --help`. Aceite: protocolo de somente GET e orçamento máximo de chamadas descritos.

**Task 03 — confirmar métricas e retenção — 5 min; depende de 02**

- [ ] Executar o spike para uma conexão autorizada: comparar E1 resumo, soma de E2 e E3 de uma campanha; testar atual/anterior e borda da retenção.
- [ ] Registrar a saída sanitizada em `docs/spikes/058-ads-redesenho-metricas.md`, incluindo filtros históricos, paginação e presença de vendas/unidades/CVR.
- [ ] Verificação: conferir `cost` e receitas em centavos, dias completos e ausência de duplicação de resumo. Diferença não explicada bloqueia a integração correspondente.

**Task 04 — confirmar campos opcionais — 5 min; depende de 03**

- [ ] Acrescentar ao mesmo spike E3 com competitividade e os campos `organic_*`, `sov`, `cvr`; registrar também eventuais recusas.
- [ ] Comparar CVR nativo com os possíveis numeradores, sem escolher fórmula por aproximação; conferir a escala dos percentuais.
- [ ] Aceite: `058-ads-redesenho-metricas.md` classifica cada campo como confirmado, ausente ou recusado. Nenhum painel opcional é habilitado por suposição.

**Task 05 — datas BRT e comparação — 5 min; depende de 03**

- [ ] RED em `tests/lib/ads-painel-dados.test.ts`: verificar range inválido, fevereiro, ontem BRT e janela anterior sem sobreposição.
- [ ] Alterar `src/lib/ads-painel-dados.ts`; implementar `janelaAnteriorAds()` e retirar o recuo automático por coleta apenas deste fluxo.
- [ ] Verificar: `rtk pnpm exec vitest run tests/lib/ads-painel-dados.test.ts`. Aceite: sete dias atuais geram sete dias anteriores, sem um dia compartilhado.

### 7.3. Bloco B — contratos, parsers e leitura

**Task 06 — parser de métricas — 5 min; depende de 04**

- [ ] RED em `supabase/functions/_shared/ads/__tests__/metricas.test.ts`: `expect(campoAusente.valor).toBeNull()` e `expect(zeroExplicito.valor).toBe(0)`.
- [ ] Criar `supabase/functions/_shared/ads/metricas.ts` com os contratos da seção 5 e parser estrito por campo.
- [ ] Verificar: `rtk pnpm exec vitest run supabase/functions/_shared/ads/__tests__/metricas.test.ts`.

**Task 07 — série diária íntegra — 5 min; depende de 06**

- [ ] RED no mesmo teste: duplicata, lacuna e data fora da janela devem produzir `completo=false`; zero explícito continua válido.
- [ ] Implementar validação da série em `_shared/ads/metricas.ts`, aceitando somente os envelopes observados no spike.
- [ ] Verificar: `rtk pnpm exec vitest run supabase/functions/_shared/ads/__tests__/metricas.test.ts -t serie`.

**Task 08 — URLs e status históricos — 4 min; depende de 06**

- [ ] RED no mesmo teste: URL contém datas, métricas, versão e status confirmados; nunca usa métricas de `/ads/search`.
- [ ] Acrescentar os builders de E1–E4 em `_shared/ads/metricas.ts`, sem alterar os builders do coletor.
- [ ] Verificar: `rtk pnpm exec vitest run supabase/functions/_shared/ads/__tests__/metricas.test.ts -t URLs`.

**Task 09 — paginação de campanhas — 5 min; depende de 08**

- [ ] RED em `supabase/functions/_shared/ads/__tests__/metricas-leitura.test.ts`: página vazia antes do total rejeita completude; resumo aparece uma vez.
- [ ] Criar `supabase/functions/_shared/ads/metricas-leitura.ts`; paginar E1 e unir períodos pelo ID.
- [ ] Verificar: `rtk pnpm exec vitest run supabase/functions/_shared/ads/__tests__/metricas-leitura.test.ts -t paginacao`.

**Task 10 — conta e detalhe — 5 min; depende de 07 e 09**

- [ ] RED no mesmo teste: resumo/diária da conta não são tratados como série por campanha; detalhe usa E3/E4.
- [ ] Implementar leitura dos escopos `conta` e `campanha`, com anterior opcional e isolamento de falha da comparação.
- [ ] Verificar: `rtk pnpm exec vitest run supabase/functions/_shared/ads/__tests__/metricas-leitura.test.ts -t escopos`.

### 7.4. Bloco C — edge, limites e cliente

**Task 11 — autorização da campanha — 5 min; depende de 09**

- [ ] RED em `metricas-leitura.test.ts`: campanha ausente da listagem autorizada não provoca chamada de detalhe.
- [ ] Implementar a checagem de pertencimento ao anunciante resolvido, inclusive para campanhas históricas.
- [ ] Verificar: `rtk pnpm exec vitest run supabase/functions/_shared/ads/__tests__/metricas-leitura.test.ts -t pertencimento`.

**Task 12 — orçamento de leitura — 5 min; depende de 10**

- [ ] RED no mesmo teste: atingir páginas, chamadas ou prazo produz motivo; 403 não repete e 429 respeita o prazo restante.
- [ ] Implementar os tetos da seção 5.5 em `_shared/ads/metricas-leitura.ts`, com relógio/fetch injetáveis.
- [ ] Verificar: `rtk pnpm exec vitest run supabase/functions/_shared/ads/__tests__/metricas-leitura.test.ts -t limites`.

**Task 13 — cache segregado e refresh — 5 min; depende de 12**

- [ ] RED em `supabase/functions/_shared/ads/__tests__/metricas-cache.test.ts`: chaves diferem por org, conexão, datas, campanha e comparação.
- [ ] Acrescentar ao módulo de leitura as deps de cache e throttle, usando `redisGet`, `redisSet` e `redisSetNX` existentes.
- [ ] Verificar: `rtk pnpm exec vitest run supabase/functions/_shared/ads/__tests__/metricas-cache.test.ts`. Aceite: repetição não acumula valores.

**Task 14 — fiação autenticada da edge — 5 min; depende de 11 e 13**

- [ ] RED em `supabase/functions/ads-metricas/__tests__/handler.test.ts`: sem sessão/módulo retorna recusa; `org_id` do body não determina conexão.
- [ ] Criar `supabase/functions/ads-metricas/handler.ts` testável e `index.ts` fino; registrar `[functions.ads-metricas] verify_jwt = true` em `supabase/config.toml`.
- [ ] Verificar: `rtk pnpm exec vitest run supabase/functions/ads-metricas/__tests__/handler.test.ts`.

**Task 15 — cliente e cache do front — 5 min; depende de 14**

- [ ] RED em `src/hooks/__tests__/useAdsMetricas.test.ts`: chave inclui organização e pedido; resposta tardia da chave anterior não substitui a atual.
- [ ] Criar `src/lib/ads-metricas-dados.ts` e `src/hooks/useAdsMetricas.ts`; usar `erroDaEdge`, `enabled`, sem polling nem `placeholderData` entre períodos.
- [ ] Verificar: `rtk pnpm exec vitest run src/hooks/__tests__/useAdsMetricas.test.ts`.

### 7.5. Bloco D — cálculo e integridade financeira

**Task 16 — razões e unidades — 5 min; depende de 06**

- [ ] RED em `tests/lib/ads-metricas.test.ts`: `ROAS = receita/gasto`, `ACOS = gasto/receita`; denominador zero retorna motivo.
- [ ] Criar `src/lib/ads-metricas.ts` com `indicadoresAds()`; manter quantidade de vendas separada de unidades e CVR nativo.
- [ ] Verificar: `rtk pnpm exec vitest run tests/lib/ads-metricas.test.ts -t indicadores`.

**Task 17 — deltas honestos — 5 min; depende de 16**

- [ ] RED no mesmo teste: percentuais usam p.p.; base zero gera “Sem base de comparação”; base negativa de resultado usa diferença em R$; provisório fica neutro.
- [ ] Implementar `compararIndicadorAds()` com direção separada de tom.
- [ ] Verificar: `rtk pnpm exec vitest run tests/lib/ads-metricas.test.ts -t comparacao`.

**Task 18 — canal e faturamento da conta — 5 min; depende de 05**

- [ ] RED em `src/hooks/__tests__/useVendasSku.test.ts`: `/ads` solicita canal ML e origem `todos`; receita fora do catálogo continua no denominador.
- [ ] Acrescentar opção de canal a `src/hooks/useVendasSku.ts`, mantendo o default dos outros consumidores; expor faturamento atual/anterior calculado com `brutoDaVenda()`.
- [ ] Verificar: `rtk pnpm exec vitest run src/hooks/__tests__/useVendasSku.test.ts`.

**Task 19 — proteção fiscal — 5 min; depende de 18**

- [ ] RED no mesmo teste: configuração pendente, não confirmada, erro e origem não resolvida sinalizam base financeira indisponível; alíquota zero explícita é aceita.
- [ ] Expor integridade fiscal por código em `useVendasSku.ts`, usando os mesmos resolvers; o consumidor Ads não libera lucro/equilíbrio com a base inválida.
- [ ] Verificar: `rtk pnpm exec vitest run src/hooks/__tests__/useVendasSku.test.ts -t fiscal`.

**Task 20 — conta com série ao vivo — 5 min; depende de 16 e 19**

- [ ] RED em `tests/lib/ads-painel.test.ts`: conta completa ao vivo pode calcular resultado sem grupos prontos; família continua bloqueada por cobertura.
- [ ] Alterar `src/lib/ads-painel.ts` para receber a fonte da conta ao vivo explicitamente, sem falsificar os marcadores do sync.
- [ ] Verificar: `rtk pnpm exec vitest run tests/lib/ads-painel.test.ts`.

### 7.6. Bloco E — conciliação e componentes principais

**Task 21 — conciliação entre fontes — 5 min; depende de 20**

- [ ] RED em `ads-painel.test.ts`: custo diário divergente entre conta coletada e ao vivo gera pendência de conciliação, sem fabricar não identificado.
- [ ] Acrescentar a condição de compatibilidade em `src/lib/ads-painel.ts`; preservar a composição coletada identificada por horário.
- [ ] Verificar: `rtk pnpm exec vitest run tests/lib/ads-painel.test.ts -t conciliacao`.

**Task 22 — hook financeiro desacoplado da seleção — 5 min; depende de 15 e 21**

- [ ] RED em `src/hooks/__tests__/useAdsPainel.test.ts`: usa a janela recebida, inclui org nas chaves e não espera sync para iniciar finanças da conta.
- [ ] Alterar `src/hooks/useAdsPainel.ts` para consumir janela e fonte ao vivo; manter grupos, histórico e proteção fiscal independentes.
- [ ] Verificar: `rtk pnpm exec vitest run src/hooks/__tests__/useAdsPainel.test.ts`.

**Task 23 — seletor compartilhado — 5 min; depende de 05**

- [ ] RED em `src/components/ads/__tests__/periodo-ads.test.tsx`: digitar datas não consulta; “Aplicar” envia range válido; “Hoje” não aparece.
- [ ] Criar `src/components/ads/periodo-ads.tsx` com presets, datas e comparação, usando os primitives existentes.
- [ ] Verificar: `rtk pnpm exec vitest run src/components/ads/__tests__/periodo-ads.test.tsx`.

**Task 24 — faixa dos dez KPIs — 5 min; depende de 16 e 17**

- [ ] RED em `src/components/ads/__tests__/faixa-kpis.test.tsx`: `getByText('Vendas por Ads')` mostra quantidade; receita é identificada separadamente; indisponibilidade tem motivo.
- [ ] Criar `src/components/ads/faixa-kpis.tsx`; reutilizar `KpiCard` com apresentação local do delta para separar seta e tom.
- [ ] Verificar: `rtk pnpm exec vitest run src/components/ads/__tests__/faixa-kpis.test.tsx`.

**Task 25 — evolução diária — 5 min; depende de 07 e 16**

- [ ] RED em `src/components/ads/__tests__/serie-diaria.test.tsx`: lacuna não vira zero; tabela acessível reproduz os dias; seleção limita a duas séries.
- [ ] Criar `src/components/ads/serie-diaria.tsx`, usando Recharts e o padrão de teste de `ResponsiveContainer` do dossiê.
- [ ] Verificar: `rtk pnpm exec vitest run src/components/ads/__tests__/serie-diaria.test.tsx`.

### 7.7. Bloco F — resultado, famílias e campanhas

**Task 26 — resultado compacto — 5 min; depende de 20 e 22**

- [ ] RED em `tests/pages/Ads.test.tsx`: resultado completo, parcial, estimado e indisponível têm textos distintos; ressalva causal permanece visível.
- [ ] Redesenhar `src/components/ads/resumo-conta.tsx`; acrescentar referência de equilíbrio da conta sem comparar seu valor ao ACOS total.
- [ ] Verificar: `rtk pnpm exec vitest run tests/pages/Ads.test.tsx -t resultado`.

**Task 27 — integridade visível — 4 min; depende de 21**

- [ ] RED em `src/components/ads/__tests__/integridade-ads.test.tsx`: compartilhado, não identificado, cobertura, histórico e desatualização são acessíveis sem abrir um tooltip.
- [ ] Criar `src/components/ads/integridade-ads.tsx`; reutilizar `GastosAssociados` e seu detalhamento.
- [ ] Verificar: `rtk pnpm exec vitest run src/components/ads/__tests__/integridade-ads.test.tsx`.

**Task 28 — filtros e ordenação das famílias — 5 min; depende de 20**

- [ ] RED em `tests/lib/ads-apresentacao.test.ts`: busca por nome/código, ordenação estável e nulos no fim; filtro não altera totais.
- [ ] Alterar `src/lib/ads-apresentacao.ts`; usar `normalizarParaBusca` existente.
- [ ] Verificar: `rtk pnpm exec vitest run tests/lib/ads-apresentacao.test.ts`.

**Task 29 — tabela financeira legível — 5 min; depende de 28**

- [ ] RED em `tests/pages/Ads.test.tsx`: cabeçalhos “ACOS direto” e “Equilíbrio observado” substituem a frase condensada; motivos continuam na linha.
- [ ] Alterar `src/components/ads/ranking-familias.tsx` e `detalhe-familia.tsx`, preservando o semáforo do domínio e o layout mobile.
- [ ] Verificar: `rtk pnpm exec vitest run tests/pages/Ads.test.tsx -t familias`.

**Task 30 — tabela de campanhas — 5 min; depende de 09 e 15**

- [ ] RED em `src/components/ads/__tests__/tabela-campanhas.test.tsx`: inclui histórica devolvida pelo ML; ordenar/filtrar linhas não muda o resumo da conta.
- [ ] Criar `src/components/ads/campanhas/tabela-campanhas.tsx` com visões Resultado/Eficiência.
- [ ] Verificar: `rtk pnpm exec vitest run src/components/ads/__tests__/tabela-campanhas.test.tsx`.

### 7.8. Bloco G — detalhe e integração da página

**Task 31 — detalhe da campanha — 5 min; depende de 25 e 30**

- [ ] RED em `src/components/ads/__tests__/detalhe-campanha.test.tsx`: separa “Métricas do período” e “Configuração atual”; gráfico carrega somente ao abrir.
- [ ] Criar `src/components/ads/campanhas/detalhe-campanha.tsx`; reutilizar `BlocoCampanha` para famílias/MLBs atuais.
- [ ] Verificar: `rtk pnpm exec vitest run src/components/ads/__tests__/detalhe-campanha.test.tsx`.

**Task 32 — competitividade opcional — 5 min; depende de 04 e 31**

- [ ] RED em `src/components/ads/__tests__/competitividade.test.tsx`: campo ausente não vira zero; `top_impression_share` não substitui `impression_share`.
- [ ] Criar `src/components/ads/campanhas/competitividade.tsx` com barras rotuladas; solicitar o escopo opcional somente ao expandir.
- [ ] Verificar: `rtk pnpm exec vitest run src/components/ads/__tests__/competitividade.test.tsx`.

**Task 33 — contagem e alerta corretos — 4 min; depende de 31**

- [ ] RED em `src/components/ads/__tests__/campanhas.test.tsx`: grupos distintos são separados de quantidade de MLBs; alerta usa “ACOS-alvo acima do equilíbrio”.
- [ ] Alterar `bloco-campanha.tsx`, `familia-campanha.tsx` e o rótulo em `src/lib/ads-campanhas.ts`; manter `hold` e os critérios atuais.
- [ ] Verificar: `rtk pnpm exec vitest run src/components/ads/__tests__/campanhas.test.tsx tests/lib/ads-campanhas.test.ts`.

**Task 34 — página com período único — 5 min; depende de 22–27 e 30**

- [ ] RED em `tests/pages/Ads.test.tsx`: trocar a aba preserva datas/comparação; reload restaura URL; seleção explícita de aba não é desfeita por resposta tardia.
- [ ] Integrar os blocos em `src/pages/Ads.tsx`; adaptar `campanhas/aba-campanhas.tsx`; manter escopo da conta visível.
- [ ] Verificar: `rtk pnpm exec vitest run tests/pages/Ads.test.tsx`.

**Task 35 — estados sem gasto e falhas parciais — 5 min; depende de 34**

- [ ] RED em `Ads.test.tsx`: zero confirmado mostra campanhas; falha da configuração não apaga métricas; falha da comparação não apaga período atual.
- [ ] Ajustar a composição de estados em `Ads.tsx`, `aba-campanhas.tsx` e `aviso.tsx`, sem um erro global para fontes independentes.
- [ ] Verificar: `rtk pnpm exec vitest run tests/pages/Ads.test.tsx -t estados`.

### 7.9. Bloco H — acabamento, QA e disponibilização

**Task 36 — glossário e contratos regressivos — 5 min; depende de 35**

- [ ] RED em `src/lib/__tests__/kpi-descriptions.test.ts` para todos os novos rótulos `::Ads`.
- [ ] Atualizar `src/lib/kpi-descriptions.ts`; confirmar quantidade, receita, unidades, TACOS, equilíbrio observado e preço atual.
- [ ] Verificar: `rtk pnpm exec vitest run src/lib/__tests__/kpi-descriptions.test.ts tests/lib/ads-painel.test.ts tests/lib/ads-campanhas.test.ts`.

**Task 37 — revisão visual desktop — 5 min; depende de 36**

- [ ] Abrir `/ads` em 1440 × 900 e 1280 × 800, claro e escuro; capturar as duas abas e um detalhe.
- [ ] Conferir leitura em cinco segundos: localizar investimento, receita, resultado e primeiro caminho de revisão sem explicar a tela.
- [ ] Registrar evidências em `docs/superpowers/plans/2026-10-30-ads-redesenho-qa.md`; correções pontuais devem repetir o teste afetado antes da nova captura.

**Task 38 — revisão mobile e teclado — 5 min; depende de 37**

- [ ] Conferir 360 × 800 e 390 × 844, ambos os temas, além de orientação horizontal.
- [ ] Verificar ausência de scroll horizontal da página, alvos de 44 px, teclado, foco, abertura/fechamento do detalhe e retorno à campanha.
- [ ] Registrar no mesmo QA: período, motivo de indisponibilidade e resultado continuam acessíveis sem depender de hover.

**Task 39 — contraste e regressão final — 5 min; depende de 38**

- [ ] Medir os pares renderizados de texto, pills, alertas e gráficos; exigir AA e testar movimento reduzido.
- [ ] Executar os testes de Ads alterados e os testes compartilhados de Vendas SKU; executar lint e Deno check somente nos arquivos afetados.
- [ ] Rodar os preflights das skills nos componentes alterados com herança de paleta; revisar falsos positivos sem alterar textos obrigatórios ou números financeiros.

**Task 40 — deploy da edge e aceite — 5 min; depende de 39 e CI verde**

- [ ] Executar `rtk pnpm exec supabase functions deploy ads-metricas`; confirmar versão ativa e uma leitura autenticada de cada escopo.
- [ ] Comparar investimento e receita com o Mercado Ads no mesmo intervalo; exigir diferença ≤ 1%, sem duplicação. Confrontar resultado e TACOS com as fontes canônicas locais.
- [ ] Atualizar `docs/reference/edge-functions.md`, `docs/project-status.md`, `docs/TASKS.md` e o registro de QA. Não declarar entrega disponível apenas porque o CI passou: o CI não faz deploy da edge.

**Commits:** ao concluir cada bloco, criar um commit com seus arquivos explícitos. Não incluir mudanças de publicação, estoque ou anúncios.

### 7.10. Aceite verificável

| Área | Condição de aceite |
|---|---|
| Clareza | O vendedor identifica resultado da conta e um caminho de revisão em cinco segundos, sem interpretar a antiga barra de percentuais |
| Período | As abas compartilham seleção, comparação e URL; nenhuma célula usa dados de outra janela |
| Dados | KPIs mostram fonte e motivo quando ausentes; totais conciliam; vendas e unidades permanecem distintos |
| Integridade | Nenhum rateio, default silencioso ou remoção de avisos; ausência de cobertura bloqueia somente o dado dependente |
| Visual e operação | Claro/escuro, mobile, teclado e contraste aprovados; edge ativa; ML permanece somente leitura |

## 8. Riscos e perguntas abertas para Diego

As decisões já fechadas permanecem preservadas. Os pontos abaixo não impedem elaborar ou revisar o plano.

| Ponto | Risco | Recomendação |
|---|---|---|
| Campos novos na conta real | Documentação pode divergir da rota ou permissão efetiva | Tornar os spikes 03/04 obrigatórios; mostrar motivo quando o fornecedor não entregar |
| Resultado financeiro versus lucro causal | Um resultado positivo pode ser interpretado como prova de retorno incremental | Manter “Resultado da conta após Ads” e a ressalva causal visível |
| Histórico e configuração atual | Produtos podem mudar de campanha durante o período | Mostrar métricas nativas históricas e produtos atuais em seções separadas |
| Comparação provisória | Atribuição em aberto pode alterar o sinal da variação | Exibir diferenças neutras com selo provisório; não recomendar mudança de orçamento por esse sinal |
| Primeiro teste de clareza | Falta confirmar se a nova hierarquia resolve a dificuldade do Diego | Usar Avil e uma conta com campanhas sem gasto no aceite; manter o piloto do ADR-0179 até registrar uma decisão concreta |

**Próxima ação — até 2 minutos:** Claude revisar a emenda da seção 6 antes de iniciar a Task 01.
## 9. Revisão do Claude e decisão do Diego (2026-10-30)

1. **Métricas por anúncio (prints 3–4 do ML):** a Task 04 passa a testar também as métricas de `/ads/search`
   (impressões, cliques, CPC, vendas atribuídas, receita, ACOS por MLB) no período — a documentação marca como
   depreciado, mas o spike 057 observou respostas. **Se o spike confirmar:** o detalhe da campanha (Task 31) ganha a
   tabela "Anúncios patrocinados" com essas colunas, ordenáveis, com variação vs período anterior. **Se não:** a seção
   aparece como indisponível com motivo. Decisão do Diego: incluir condicionado ao spike.
2. **Gráfico padrão:** se o spike confirmar `organic_items_quantity` (ou equivalente), a evolução diária (Task 25) abre
   em "Vendas atribuídas × Outras vendas + ROAS" (barras empilhadas + linha em eixo `×`), como no Mercado Ads; senão,
   mantém Investimento × Receita Ads.
3. Nome do arquivo: o plano fica em `2026-10-30-ads-redesign-premium.md` (a Task 01 não renomeia).
