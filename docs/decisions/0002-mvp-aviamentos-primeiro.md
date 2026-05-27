# ADR-0002: MVP começa por aviamentos, não tecidos

**Status:** Aceito
**Data:** 2026-05-26
**Decisores:** Diego

## Contexto

A proposta original do Leonardo Freitas focava em **tecidos** como produto inicial. Tecidos têm várias dimensões variáveis (largura em cm, composição em %, gramatura em g/m², unidade de venda — metro/rolo/peça) que complicam a modelagem, o prompt de IA, e o mapeamento para os atributos obrigatórios do Mercado Livre.

Durante o brainstorming, Diego informou um pivot do produto inicial: a empresa decidiu começar publicando **aviamentos** (linha de costura, botões, fitas) e deixar tecidos para uma versão futura.

## Decisão

O MVP do PubliAI foca exclusivamente em **aviamentos** (linha de costura, botões, fitas). Tecidos entram em uma fase posterior, possivelmente como uma "categoria de produto" plugável.

## Alternativas consideradas

- **Opção A: Construir genérico desde o início, suportar tecidos E aviamentos**
  - Pros: arquitetura preparada para múltiplas categorias
  - Cons: complexidade prematura; muitos atributos opcionais; risco de não fazer nenhuma categoria bem
  - Rejeitada por ferir o princípio "MVP enxuto"

- **Opção B: Começar por tecidos (proposta original)**
  - Pros: maior parte do faturamento da empresa
  - Cons: variável de unidade de venda (metro/rolo) introduz complexidade no preço, no estoque, e na integração com ML; atributos exigidos pela categoria têxtil no ML são numerosos e cheios de regras especiais
  - Rejeitada após reavaliação do Diego

- **Opção C: Aviamentos primeiro, tecidos depois (escolhida)**
  - Pros: atributos mais simples (peso, dimensões da embalagem, composição linear), unidade de venda majoritariamente por peça/cone, variação principal é só cor
  - Cons: cobre uma parcela menor do catálogo da empresa inicialmente
  - Aceita porque permite validar o pipeline completo antes de adicionar a complexidade de tecidos

## Consequências

**Boas:**
- Pipeline mais simples no MVP: sem unidade de venda variável; sem largura/gramatura como atributos críticos
- Variação principal é **cor** apenas — caso clean para validar atribuição via IA Vision (ADR-0004)
- Reduz superfície de bugs e edge cases iniciais
- Permite ajustar UX e prompt de IA com um domínio focado antes de generalizar

**Tradeoffs aceitos:**
- Catálogo inicial cobre só uma fatia do catálogo total da empresa
- Versão para tecidos vai exigir reabertura do modelo de dados (provavelmente acréscimo de campos opcionais, não breaking change)

**Como reverter:**
- Decisão de produto, não técnica. A qualquer momento, o escopo pode ser expandido para tecidos sem refactor estrutural — basta adicionar campos opcionais na tabela `familias` e ajustar o prompt de IA por categoria.
