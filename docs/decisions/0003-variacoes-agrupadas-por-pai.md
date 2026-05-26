# ADR-0003: Variações agrupadas por código PAI no anúncio do Mercado Livre

**Status:** Aceito
**Data:** 2026-05-26
**Decisores:** Diego

## Contexto

A planilha exportada do sistema interno tem uma estrutura específica:

- Cada linha é um produto único com um `CODIGO`
- Cada linha tem uma coluna `PAI`:
  - Se `PAI = 0`, o produto é ele próprio um pai/agrupador (não é vendido diretamente)
  - Se `PAI = <codigo de outro produto>`, o produto é um filho/variação daquele pai
- Em aviamentos, a variação principal entre filhos da mesma família é **cor**
- Cada filho tem código próprio e pode ter EAN/GTIN próprio

Exemplo real (linhas de costura):
```
CODIGO=449253, PAI=0       → "LINHA P/COST.XIK 120 2000J CORES" (PAI, não vende)
CODIGO=736368, PAI=449253  → "LINHA P/COST.XIK 120 2000J 455"   (filho — cor 455)
CODIGO=736376, PAI=449253  → "LINHA P/COST.XIK 120 2000J 480"   (filho — cor 480)
```

O Mercado Livre suporta **variações nativamente** em anúncios. Uma família pode ser:
- (A) **1 anúncio com N variações** (cor como atributo de variação)
- (B) **N anúncios independentes**, cada cor com seu próprio anúncio

## Decisão

Publicamos cada **família PAI como 1 único anúncio no Mercado Livre**, com cada filho (cor) virando uma **variação nativa** dentro desse anúncio.

O título e a descrição do anúncio vêm da informação do PAI; cada variação tem sua própria foto, EAN, estoque e (potencialmente) preço.

## Alternativas consideradas

- **Opção A: Um anúncio por SKU (cada cor é um anúncio independente)**
  - Pros: implementação trivial (sem montar payload de variações); isolamento total entre cores; permite preços muito diferentes por cor
  - Cons: pior SEO (visualizações e perguntas fragmentadas entre anúncios "irmãos"); muito mais anúncios para gerenciar; categoria de moda/tecidos/aviamentos no ML penaliza anúncios que deveriam ser variações
  - Rejeitada porque vai contra as recomendações da Meli para essas categorias

- **Opção B: Híbrido configurável (flat por padrão, agrupar manualmente)**
  - Pros: máxima flexibilidade
  - Cons: dobra a complexidade da UI de revisão; introduz uma decisão por lote que o operador não tem motivo para fazer no MVP
  - Rejeitada como overengineering pro MVP

- **Opção C: Um anúncio por família PAI com variações (escolhida)**
  - Pros: SEO superior (anúncio único acumula visualizações, vendas, perguntas e reputação); experiência de compra melhor para o cliente final; alinhado com a recomendação da Meli para esses segmentos; menos anúncios para gerenciar
  - Cons: implementação mais complexa (montar payload de `variations` na API; lidar com foto por variação; lidar com estoque/preço por variação); se uma cor tiver problema, pode afetar o anúncio inteiro
  - Aceita por ser o padrão correto para o domínio

## Consequências

**Boas:**
- Modelo de dados reflete o domínio: `lotes → familias → variacoes`
- Operador revisa famílias inteiras, não filhos soltos — melhor UX
- Acumula reputação no anúncio único — vantagem competitiva relevante no ML

**Tradeoffs aceitos:**
- Lógica de publicação precisa lidar com erros parciais: o que fazer se 1 variação falha mas 9 outras seriam válidas? (decisão diferida — provavelmente: falhar o anúncio inteiro e mostrar o erro na tela de revisão, deixando o operador decidir)
- A "imagem de capa" do anúncio agrupado é uma decisão à parte: ADR-0004 aborda; convenção é foto do PAI se existir o arquivo, senão a foto da primeira variação encontrada
- Re-publicação (UPDATE) precisa lidar com adição/remoção de variações em anúncios já publicados (escopo da ADR-0005)

**Regra de negócio importante:** o PAI não é vendido — ele é só um agrupador conceitual. Quem é vendido são os filhos (cores). O título e a descrição base vêm da informação do PAI; cada variação carrega o que é específico dela.
