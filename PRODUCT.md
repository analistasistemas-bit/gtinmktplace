# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

O usuário principal é o dono ou gestor de uma operação de marketplace. Ele avalia oportunidades de compra, negocia com fornecedores e decide por quanto vender produtos no Mercado Livre. Operadores que preparam lotes e anúncios são usuários secundários.

## Product Purpose

O PubliAI transforma dados de produtos em operações de marketplace mais seguras e eficientes. Na Viabilidade, a calculadora deve ajudar o gestor a decidir se vale a pena comprar um produto e por quanto vendê-lo, começando pela viabilidade da compra.

Sucesso significa revelar custos, margem e riscos antes do investimento em estoque, reduzindo compras inviáveis e preços que geram prejuízo.

## Positioning

A calculadora combina os dados reais da conta Mercado Livre da organização, dados dos produtos do PubliAI e simulações estratégicas. Em vez de apenas exibir números, produz um veredito acionável e explicável: comprar, negociar custo, ajustar preço ou evitar.

## Operating Context

O gestor usa a calculadora durante a prospecção de produtos, a negociação com fornecedores e a definição do preço de venda. Pode partir de um produto já cadastrado ou simular manualmente um novo produto. Categoria, comissão, frete, reputação, dimensões, peso, impostos e custos operacionais influenciam a decisão.

## Capabilities and Constraints

- A primeira versão é uma calculadora essencial dentro do menu Viabilidade; não inclui simulações salvas nem precificação em massa.
- A categoria Mercado Livre é opcional, mas sua ausência deve ser comunicada como perda de precisão.
- Quando disponível, a categoria deve ser pesquisada e validada pela API oficial do Mercado Livre.
- Cálculos dependentes da conta devem priorizar dados oficiais da organização conectada ao Mercado Livre.
- Resultados precisam distinguir dados oficiais, valores informados pelo usuário e estimativas.
- O veredito deve explicar os fatores que sustentam a recomendação e nunca ocultar incertezas.

## Evidence on Hand

- Captura da calculadora Pronix Tools: `/Users/diego/Downloads/FireShot Capture 096 - Pronix Tools - Ferramentas Marketplaces - [pronixtools.com.br].png`.
- Fonte NotebookLM `Analise de Mercado - Aula 8 (Calculadora)` no caderno `Consultoria Mercado Livre`.
- Implementação atual de Viabilidade e integrações oficiais do Mercado Livre no repositório.
- Não existem depoimentos, benchmarks comerciais ou métricas públicas aprovadas para esta feature; não devem ser inventados.

## Product Principles

- Decisão antes do estoque: revelar viabilidade antes da compra.
- Precisão com procedência: mostrar de onde veio cada custo e tarifa.
- Recomendação explicável: transformar números em uma ação justificável.
- Simulação estratégica: explorar custo, preço e margem sem alterar dados operacionais.
- Incerteza visível: nunca apresentar estimativa como valor oficial.

## Accessibility & Inclusion

A experiência deve funcionar por teclado, não depender apenas de cor para comunicar lucro ou risco e apresentar valores monetários e percentuais com rótulos claros em português do Brasil.
