# ADR-0140 — Sonar por EAN: análise completa pela busca, sem escolha grátis/paga

**Data:** 2026-08-28
**Status:** aceito
**Relacionado:** [0120](0120-pulse-sonar-garimpo-por-termo.md) (Sonar por termo),
[0122](0122-sonar-vendas-estimadas-via-apify.md) (Apify),
[0127](0127-sonar-tabela-por-anuncio-e-historico.md) (Errata 1 criou a consulta por EAN e a escolha
grátis/paga; Errata 2 acrescentou o cruzamento com o catálogo da org),
[0136](0136-sonar-ean-cobertura-de-fichas-de-catalogo.md) (cobertura de fichas — **D-6 revogado
aqui**), [0119](0119-pulse-inteligencia-de-mercado-dirigida.md) (endpoints do ML que devolvem 403).

## Contexto

O Sonar tinha dois caminhos com resultados de naturezas diferentes:

- **Por termo** → amostra de 20 anúncios reais da busca do ML (Apify), veredito de oportunidade,
  insights do nicho, pódio de rivais, vendas, visitas, filtros e simulador de margem por anúncio.
- **Por EAN** → lookup oficial de catálogo (`/products/search` + `/products/{id}/items`), uma tabela
  enxuta de ofertas, e uma pergunta antes de tudo: "consultar grátis ou com vendidos (pago)?".

Diego pediu que a consulta por EAN entregue **a mesma análise completa da consulta por descrição**,
com a diferença de que o recorte é um produto só — o do EAN —, e que a escolha grátis/paga saia da
tela.

O caminho por catálogo não consegue entregar isso. Falta-lhe, por construção:

1. **Vendas** — `quantidadeVendida` não existe na API oficial; o "+N vendidos" só vem da página, via
   Apify (ADR-0122). Sem vendas não há veredito, não há pódio, não há faturamento estimado.
2. **Anúncios fora do catálogo** — `/products/{id}/items` só devolve ofertas vinculadas à ficha. O
   ADR-0136 registrou a consequência medida: EAN `7891113175371` devolvia **1 oferta** enquanto o
   site do ML mostrava **23 anúncios**. O ADR-0136 chamou isso de limite da plataforma e mandou
   dizê-lo na tela, porque pela API oficial é mesmo inalcançável (403 em `/items/{id}` de terceiro
   e em `/sites/MLB/search`, medido no ADR-0119).

## Medição que destrava a decisão (2026-08-28)

O actor da Apify recebe `keyword` livre. **Um EAN é uma keyword válida na busca do ML.** Rodado
contra o mesmo EAN do ADR-0136:

| | Caminho oficial (ADR-0136) | Busca por EAN via Apify (medido hoje) |
|---|---|---|
| Anúncios devolvidos | 1 (era 2 fichas após o D-1) | **20** (teto de gasto), de **24** que o ML reporta |
| Todos do produto certo? | sim | sim — "Linha Encanto Slim Círculo 240m 100g" e variantes |
| Vendidos | não (só na consulta paga) | sim, em 17 dos 20 |
| Anúncios fora do catálogo | nunca | sim — são a maioria da amostra |

A busca por EAN via Apify **é** o mercado inteiro daquele produto, que é o que o operador queria ver
e o que o ADR-0136 declarou inalcançável pelo caminho oficial. O limite era do endpoint de catálogo,
não do EAN.

## Decisões

### D-1 — EAN passa pelo mesmo pipeline da busca por termo

`garimpar()` deixa de ramificar por EAN. Um EAN digitado (ou escaneado) vira `termoBuscado` como
qualquer termo e percorre `pulse-sonar-vendas` → visitas → veredito → insights → pódio → tabela
filtrável → simulador de margem. Não há view própria de EAN: **é a mesma tela, com o recorte que a
própria busca do ML faz** quando a keyword é um código de barras.

Consequências que caem junto, todas por deixarem de existir:

- a nota permanente do ADR-0136 D-4 ("anúncios fora do catálogo não entram nesta consulta") — passou
  a ser falsa: eles entram, e são a maioria;
- o aviso de teto de fichas (ADR-0136 D-3) e a coluna "Ficha" — não há mais fichas no caminho;
- o bloco "quanto sobra vendendo a R$ X" da consulta por EAN — o equivalente por anúncio é o botão
  **Simular** de cada linha da tabela, que já cobre comissão, frete e imposto pelas alíquotas da org.

### D-2 — A escolha grátis/paga sai da tela

`SonarEanEscolha` é removido. Toda consulta por EAN é uma consulta paga da Apify, como já é toda
consulta por termo. **Isto revoga o ADR-0136 D-6** ("Apify NÃO entra neste caminho") e a decisão da
Errata 1 do ADR-0127 de que a busca por EAN é grátis por padrão.

Consequência de custo, declarada e não escondida: cada EAN novo custa ~US$ 0,10 (teto por run,
ADR-0122). O cache de 7 dias por termo normalizado vale igual para EAN, então re-escanear o mesmo
produto dentro da semana não cobra de novo. Escanear N produtos distintos em sequência com o leitor
de código de barras passa a custar N × US$ 0,10 — antes o default era grátis. Diego pediu a remoção
da escolha sabendo disso.

### D-3 — O cruzamento com o catálogo da org fica, mas só afirma o que mediu

"Eu já vendo isto?" (ADR-0127 Errata 2) é o sinal de maior valor e menor custo da consulta por EAN,
e é a única coisa da view antiga que a tela por termo não tem. Fica, com duas metades de
confiabilidade diferente:

- **`minhas` (variações da org com este GTIN)** — leitura local por `gtin` exato, sob RLS. Não
  depende da Apify. Continua confiável, e sua ausência continua sendo afirmação válida
  ("produto novo para o seu catálogo").
- **`no_radar`** — cruza por `catalog_product_id`. A fonte dos ids deixou de ser o lookup oficial de
  catálogo e passou a ser o que a amostra da Apify trouxer, e **medição de hoje: só 7 dos 20
  anúncios trazem `idProdutoCatalogo`**. Com base parcial, ausência deixou de ser informação.

Regra: **o Radar só é afirmado no positivo.** Achou linha → "Já está no seu Radar". Não achou → a
tela não diz nada sobre o Radar, em vez de escrever "não está no Radar" a partir de uma amostra que
sabidamente não tem os ids de 13 dos 20 anúncios. A frase antiga "não está no seu catálogo nem no
Radar" vira "Produto novo para o seu catálogo", que é o que de fato se mediu.

Esta é a mesma regra LOUD que o projeto aplica a imposto e a visitas: ausência de dado nunca vira
afirmação de ausência do fato.

### D-4 — `pulse-sonar-ean` deixa de ser chamada, mas continua deployada

O front perde `fetchSonarPorEan` e os tipos da resposta (órfãos desta mudança). A edge
`pulse-sonar-ean` e `_shared/pulse/sonar-ean.ts` **não são removidas nesta entrega**: continuar
deployada sem chamador não custa nada nem quebra nada, e mantém o caminho oficial a um commit de
distância caso a cobertura pela busca decepcione em algum EAN. Remoção fica como follow-up
explícito, não como limpeza silenciosa.

## Refutações registradas (não tentar de novo)

- **Manter o lookup oficial de catálogo como "consulta grátis" ao lado da análise completa.** É a
  escolha que o pedido mandou tirar, e os dois resultados divergem em ordem de grandeza (1 vs 20
  anúncios para o mesmo EAN) — dois números para a mesma pergunta é pior que um número só.
- **Cruzar o Radar por `catalog_product_id` e afirmar ausência.** Medido: 7/20 anúncios têm o id.
  Ver D-3.
- **Buscar anúncio avulso por `/items/{id}` ou `/sites/MLB/search` para completar o caminho
  oficial.** 403 sempre (ADR-0119). Continua valendo; deixou de importar porque a busca resolve.

## Consequências

- A consulta por EAN ganha veredito, insights, pódio de rivais, faturamento estimado, visitas 30d,
  filtros, histórico de snapshots (`sonar_snapshots` passa a gravar EANs como termo) e simulador de
  margem por anúncio.
- A consulta por EAN passa a custar. Ver D-2.
- A consulta por EAN passa a enxergar anúncios fora do catálogo — o buraco que o ADR-0136 documentou
  como intransponível.
- A tela perde a descrição do catálogo e o nome canônico da ficha do ML. Quem identifica o produto
  agora é o título dos anúncios e o card de produto destaque, como na busca por termo.
- O veredito e os insights falam em "nicho". Para um EAN o nicho é o conjunto de vendedores daquele
  produto — a leitura ("o líder leva X% do faturamento medido") continua correta, mas a palavra é
  imprecisa. Não foi trocada nesta entrega.
