# Plano — Sonar por EAN: correções + o que a consulta precisa entregar

> Status: **proposto, não implementado**. Levantamento feito em 2026-08-27 a pedido do Diego, a
> partir do caso real do EAN `7891000444764` (Leite Ninho Zero Lactose 700g): 1 oferta, R$ 80,00,
> vendedor `780167992`, Full `—`, Vendidos `—`. A tela responde "existe" e nada além disso.

## Diagnóstico

A view de EAN (ADR-0127 Errata 1) foi desenhada como **anti-nicho**: não reaproveita veredito,
raio-x nem painel de vendas porque ticket médio e "vencedor do nicho" não fazem sentido para um
produto já identificado. A decisão de não reaproveitar está certa. O que faltou foi **colocar algo
no lugar**: sobraram cinco colunas cruas que não respondem a pergunta que o analista comercial faz
ao bipar um código de barras — *"eu devo vender isto, e a que preço eu ganho dinheiro?"*.

O levantamento mostrou que quase tudo que falta **já existe no projeto**, como helper compartilhado
ou como dado que a própria função já calcula e joga fora.

## Passo 0 — ADR antes de implementar (bloqueante)

Mudar o shape da resposta de `pulse-sonar-ean`, acrescentar chamadas ao ML e criar chaves de cache
é mudança arquitetural. A regra do projeto exige ADR antes da implementação. Escrever como
**Errata 2 do ADR-0127** (onde a Errata 1 já vive), cobrindo: shape novo da resposta, fan-out por
consulta, chaves/TTL de cache e o bump de versão descrito abaixo.

### Achado que obriga bump de cache

`sonar:ean:v1:{ean}` guarda `LookupCache = { product_id, nome_produto, descricao_catalogo, ofertas }`.
O `category_id` **é calculado** por `parseItensProduto` e descartado antes de cachear. Como ele é a
chave para comissão (item 1), o lookup precisa passar a guardá-lo → **`sonar:ean:v2:{ean}`**. Sem o
bump, entrada cacheada antiga (TTL 24h) desserializa sem o campo e a UI nova mostra buraco.

---

## Parte A — Enriquecimento, por valor de decisão

### A1. "Quanto eu recebo por venda" — o maior salto, sem fonte de dado nova

Hoje a tela mostra o preço do concorrente. O analista precisa do **líquido**: comissão do ML +
frete do vendedor descontados do preço.

Peças, todas existentes:
- `category_id` — já calculado em `parseItensProduto`, hoje descartado (ver bump acima)
- `buscarListingPrice` + `comissaoDe` (`_shared/ml/listing-prices.ts`)
- `montarTarifa` (`_shared/ml/tarifa.ts`) — literalmente `recebe = preço − comissão − frete`
- `buscarFreteVendedor` (`_shared/ml/frete.ts`)

Fan-out: **1 chamada** de `listing_prices` por consulta (a categoria é a mesma para todas as ofertas
do produto) + 1 de frete por faixa de preço distinta. Cachear por `category_id`, não por EAN.

Entrega na tela: coluna "Você recebe" ao lado de "Preço", e a linha de resumo "vendendo a R$ X,
sobram R$ Y". É o que transforma a consulta em decisão.

### A2. "Eu já vendo isto?" — grátis, local, zero chamada ao ML

O maior sinal para o analista e o mais barato de todos: cruzar o EAN bipado com o que a org já tem.

- `variacoes.gtin` → **"você já vende este produto"** (com o código e o preço atual)
- `pulse_produtos.catalog_product_id` → **"já está no seu Radar"** (com link para o detalhe)

Duas queries locais, sujeitas a RLS, sem custo e sem rede externa. Quando as duas derem vazio, a
ausência também informa: é produto novo para a operação.

### A3. Nome do vendedor no lugar do número cru

`780167992` não diz nada. `buscarPerfilVendedor(token, sellerId)` (`_shared/ml/perfil-vendedor.ts`)
devolve nome e reputação. Fan-out: 1 chamada por **seller distinto** (não por oferta) — no caso do
Ninho, exatamente 1. Cache global por `seller_id`, mesmo racional do cache por item das visitas.

### A4. Visitas 30d por oferta — demanda real, reusando edge que já existe

`pulse-sonar-visitas` já aceita de 1 a 20 `item_ids`, tem cache global por item e **já tem cliente
no frontend** (`src/lib/sonar.ts:94`, usado pelo fluxo de nicho). Chamar a mesma edge com os
`item_ids` das ofertas do EAN: **nenhuma edge nova, nenhuma chave de cache nova**.

Isso responde "tem procura?" sem passar pela Apify — e no caminho grátis.

### A5. Descrição do catálogo — já está na resposta, a UI não mostra

`descricao_catalogo` é buscada, cacheada e devolvida em `RespostaEan`, e `SonarEanResultado`
simplesmente não renderiza. Ganho de zero custo: confirma visualmente que o EAN bateu na ficha
certa (hoje só o nome confirma).

### A6. Preço "de/por"

`parseItensProduto` já resolve `sale_price` sobre `price`, mas a UI mostra só o número final. O
nicho mostra "de R$ X · N% OFF" e é informação de disputa: concorrente em promoção agressiva muda
a leitura do preço.

---

## Parte B — As três correções levantadas

Fazem parte **do mesmo plano**, não de um segundo.

### B1. Vendedor cru → nome
É o A3. Não implementar como fix cosmético separado.

### B2. Nada avisa que digitar números muda o modo da tela
`EAN_RE = /^\d{8,14}$/` troca o fluxo inteiro sem aviso. O placeholder menciona EAN, mas a mudança
só se revela no resultado. Correção mínima: quando o campo casar com o padrão, sinalizar **antes**
de submeter (ex.: badge "EAN detectado — consulta de produto, não de nicho" junto ao campo). Barato
e resolve a surpresa que motivou este levantamento.

### B3. Coluna "Vendidos" sempre vazia na consulta grátis
**Dissolve com a Parte A** — não implementar em separado. Hoje a coluna incomoda porque é a única
coisa na tela; com "Você recebe", visitas e o cruzamento local, o `—` vira uma ausência entre
informações, com o tooltip que já distingue "não paguei por isso" de "paguei e a Apify não pegou".
Um fix cosmético agora seria revertido pela Parte A.

---

## Ordem sugerida

| # | Item | Custo de implementação | Chamadas novas ao ML |
|---|------|------------------------|----------------------|
| 0 | ADR-0127 Errata 2 | — | — |
| 1 | A2 — já vendo / já no Radar | baixo | nenhuma |
| 2 | A5 + A6 — descrição e de/por | muito baixo | nenhuma |
| 3 | A1 — quanto você recebe | médio (bump v2) | 1 por categoria + frete |
| 4 | A3 — nome do vendedor | baixo | 1 por seller distinto |
| 5 | A4 — visitas 30d | baixo (edge existente) | 1 em lote, cacheada |
| 6 | B2 — aviso de modo EAN | muito baixo | nenhuma |

Os itens 1 e 2 sozinhos já mudam a tela do print: o Ninho passaria a mostrar descrição da ficha,
promoção do concorrente e se a operação já trabalha com aquele produto — tudo sem uma chamada nova.

## O que este plano NÃO propõe

- Reaproveitar veredito/raio-x do nicho na view de EAN. A Errata 1 recusou isso com razão: são
  conceitos de nicho.
- Tornar a Apify default. A regra "grátis por padrão, pago sob clique explícito" continua.
- Câmera do celular para leitura de código de barras — segue fora de escopo (exige dependência
  nova), como a Errata 1 registrou.
