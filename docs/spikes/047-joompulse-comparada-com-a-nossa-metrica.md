# Spike 047 — A JoomPulse na mesma consulta: como ela chega no número, e como o nosso se compara

**Data:** 2026-08-29
**Pedido de Diego:** consultar a JoomPulse via MCP na mesma consulta, comparar, e investigar as divergências.
**ADR:** [0142](../decisions/0142-vendas-mensais-por-vendedor.md), [0145](../decisions/0145-vendedor-estabelecido-atividade-e-intensidade.md) — **esta medição obriga errata na 0145**
**Antecede:** [Spike 043](043-como-a-joompulse-estima-vendas.md), que abriu a pergunta e chegou a metade da resposta

## Resposta curta

1. **A fórmula da JoomPulse está decifrada, exata em 9 de 9:**
   `catalogOrderCount1m = catalogSales ÷ daysInAd × 30` — o **selo acumulado do ML dividido pela
   idade do anúncio**. Não é observação de venda; é média vitalícia.
2. **É exatamente a "candidata B" que a ADR-0142 refutou** por falta da idade do anúncio. A ADR
   afirma que a JoomPulse não tem esse dado. **Tem:** `adPublishDate` e `daysInAd`.
3. **`shopSales365Days` da JoomPulse é o MESMO campo que coletamos** (`transactions.total`) —
   confere em 5 de 5, diferença < 0,4%.
4. **A hipótese "vitalício" que a ADR-0145 adotou está refutada** (0,24x). O campo se comporta como
   janela de ~365 dias, como a ADR-0142 dizia originalmente.
5. **A nossa estimativa é a que mais se aproxima** de uma fonte independente: 0,71x contra 1,41x da
   divisão por 12.

---

## 1. Como a JoomPulse calcula — exato em 9 de 9

Os 9 catálogos do `aptamil premium 2`:

| productId | `catalogSales` (selo) | `daysInAd` | selo ÷ dias × 30 | `catalogOrderCount1m` |
|---|---|---|---|---|
| MLB10512495 | 100.000 | 2.938 | **1.021,1** | 1021 |
| MLB10512516 | 100.000 | 2.938 | 1.021,1 | 1021 |
| MLB34450041 | 10.000 | 912 | **328,9** | 329 |
| MLB34280841 | 10.000 | 912 | 328,9 | 329 |
| MLB17377790 | 1.000 | 2.020 | **14,85** | 15 |
| MLB17343353 | 1.000 | 2.040 | 14,7 | 15 |
| MLB17343352 | 1.000 | 2.040 | 14,7 | 15 |
| MLB10933634 | 1.000 | 2.918 | **10,3** | 10 |
| MLB29724117 | 100 | 972 | **3,09** | 3 |

E o GMV fecha o círculo: `orderGmv1m ÷ buyBoxPriceAmount = orderCount1m`, também exato em 9/9
(50.948 ÷ 49,90 = 1021; 99.343 ÷ 97,30 = 1021; …). O Spike 043 tinha visto essa segunda relação e
concluiu "ela dividia GMV por preço". A direção real é a inversa: **o count é primário** (selo ÷
idade) e o GMV é `count × preço`.

### Os dois defeitos que isso embute

1. **O numerador é um bucket em potências de 10.** `catalogSales` só assume 100, 1.000, 10.000,
   100.000 — é o selo "+N vendidos" do ML, arredondado para baixo. Um catálogo com 199.999 vendas
   entra como 100.000: **erro de até 2x, sempre para baixo**.

   > **Errata — não são potências de 10.** A escala medida é **25, 50, 100, 500, 1k, 5k, 10k, 50k,
   > 100k, 250k**, com degraus de **2x a 5x**: o erro do numerador vai **até ~5x**, não 2x. A
   > direção (sempre para baixo) permanece. Errata obrigada pelo
   > [Spike 048](048-transactions-total-e-janela-provada.md) §6.4 e nunca aplicada a este corpo;
   > o [Spike 050](050-a-formula-da-joompulse-reconstruida.md) §1.1 a confirma noutra categoria e
   > acrescenta o degrau **250.000**.
2. **O denominador é a idade do anúncio.** O resultado é a **média vitalícia**, não o ritmo atual.
   MLB10512495 está no ar há **2.938 dias (8 anos)**: os 1.021/mês são a média desde 2018, e não
   dizem nada sobre o mês corrente.

Isso também explica a suspeita do [Spike 041](041-joompulse-censo-do-radar-e-validacao-da-d4.md) §5,
de que os valores "cheiravam a bucket": dois catálogos com o mesmo selo e a mesma idade devolvem o
mesmo número — daí `1021` duas vezes e `15` três vezes.

## 2. `shopSales365Days` é o nosso campo

| Vendedor | JoomPulse `shopSales365Days` | Nosso `transactions_total` | Δ |
|---|---|---|---|
| Mercado Livre Brasil | 31.617.526 | 31.746.992 | 0,4% |
| BAZAR HORIZONTE | 65.441 | 65.211 | 0,4% |
| BAZARIMIRIM | 47.577 | 47.657 | 0,2% |
| ARMARINHOS.TEMTEM | 16.642 | 16.716 | 0,4% |
| VITRINE_ARTESANATO | 7.056 | 7.068 | 0,2% |

Mesmo campo, defasagem de snapshot. E a JoomPulse o documenta como *"completed transactions in the
last 365 days; from MeLi API directly, not JoomPulse"* — **365 dias**, enquanto a API devolve
`{"period": "historic"}`.

## 3. Qual leitura sobrevive — medido em 40 vendedores

Se o campo fosse **vitalício**, `total ÷ meses desde o registro da loja` deveria bater com uma
estimativa mensal independente. Se for **365 dias**, quem bate é `total ÷ 12`.

Razão contra a estimativa mensal da JoomPulse (1,00 = coincide):

| Hipótese | Mediana |
|---|---|
| `total ÷ meses de vida` (**vitalício**) | **0,24x** |
| `total ÷ 12` (**365 dias**) | 1,41x |
| **nosso delta extrapolado** | **0,71x** |

Casos que sozinhos derrubam o vitalício:

| Loja | Registro | `shopSales365Days` | ÷ vida | JoomPulse/mês |
|---|---|---|---|---|
| BOINGAVIAMENTOS | 2002 (24 anos) | 123.683 | 429/mês | 11.958 |
| MIDASCOSMETICO | 2006 (20 anos) | 402.127 | 1.662/mês | 17.678 |
| LE SUMMER | 2008 (18 anos) | 29.473 | 137/mês | 4.046 |
| RON_VIANA2010 | 2010 (16 anos) | **0** | 0 | 0 |

Uma conta de 2010 com **zero** vendas vitalícias é implausível; com zero nos últimos 365 dias é
comum. E lojas de 20 anos com um total tão baixo só fazem sentido como janela.

**Conclusão: "vitalício" está refutado. A ADR-0142 estava certa e a correção da ADR-0145 estava
errada** — o `period: "historic"` da API do ML não deve ser lido como "desde sempre".

## 4. E a nossa métrica?

**Ela é a que mais se aproxima da fonte independente: 0,71x, contra 1,41x da divisão por 12.**

Isso não é prova de acerto — a JoomPulse não é verdade fundamental, ela é selo ÷ idade com erro
próprio de até 2x. Mas mostra que o nosso número **não está fora de escala**, que era o risco real.

Fica um desconforto honesto e não resolvido: se o campo é uma janela móvel de 365 dias, um vendedor
em regime estacionário deveria ter delta zero, e medimos 63% com delta positivo. Ou a base está em
crescimento, ou a janela não é pura. **Não há dado aqui que feche isso.**

### O que muda na tela: nada

O rótulo em produção já é `movimento observado em N dias, extrapolado para 30` — que continua
correto sob **qualquer** das duas leituras, porque declara a nossa janela de observação e não a do
ML. A decisão da ADR-0145 D-4 (não prometer janela do fornecedor) sobrevive à reviravolta.

## 5. Comparação direta no `aptamil premium 2`

| | JoomPulse | PubliAI |
|---|---|---|
| Unidade | catálogo (produto) | vendedor (loja inteira) |
| Número | **2.758 un./mês** (soma dos 9 catálogos) | mediana **333 un./mês**, 36 de 49 ativos |
| Origem | selo ÷ idade do anúncio | delta de transações em 9 dias |
| Natureza | média vitalícia, numerador em potência de 10 | movimento recente medido |
| Envelhece | não muda até o selo trocar de faixa | acompanha o mês |

**Não são comparáveis diretamente** — respondem perguntas diferentes. O da JoomPulse diz "quanto
este produto vendeu por mês, em média, desde que foi criado". O nosso diz "quanto os concorrentes
estabelecidos deste nicho estão movimentando agora".

## Erratas obrigadas

1. **ADR-0145, Causa 2 e D-4:** a afirmação "é vitalício, `period: historic`" está **refutada**
   (0,24x contra 1,41x). O rótulo da tela continua certo por outro motivo — declara a nossa janela.
2. **ADR-0142, §Candidata B:** *"A JoomPulse também não tem: `createdAt` não existe no schema"* está
   **errado**. Existem `adPublishDate` e `daysInAd`, e é deles que sai o número dela.
3. **Spike 043:** a direção da derivação é `GMV = count × preço`, não `count = GMV ÷ preço`.

---

## 6. De onde a JoomPulse tira a idade — e nós temos a mesma fonte

`GET /products/{catalog_product_id}` devolve **`date_created`**, com **HTTP 200 para catálogo de
terceiro**, usando o nosso token. O 403 da ADR-0119 é só em `/items/{id}`.

O `daysInAd` da JoomPulse é a **idade do catálogo**, não do anúncio, apesar do nome:

| Catálogo | `date_created` (nosso) | Nossos dias | `daysInAd` (JP) | Erro |
|---|---|---|---|---|
| MLB10512495 | 2018-08-14 | 2.937 | 2.938 | −1 |
| MLB10512516 | 2018-08-14 | 2.937 | 2.938 | −1 |
| MLB17343352 | 2021-01-28 | 2.039 | 2.040 | −1 |
| MLB17343353 | 2021-01-28 | 2.039 | 2.040 | −1 |
| MLB17377790 | 2021-02-17 | 2.019 | 2.020 | −1 |
| MLB10933634 | 2018-09-03 | 2.917 | 2.918 | −1 |
| MLB34450041 | 2024-03-15 | 897 | 912 | −15 |
| MLB34280841 | 2024-03-11 | 901 | 912 | −11 |
| MLB29724117 | 2024-01-15 | 957 | 972 | −15 |

**6 de 9 em ±1 dia.** Os três que erram por 11–15 dias são catálogos de 2024 — provável defasagem
do snapshot dela, não fonte diferente.

Reproduzindo a conta dela com a **nossa** data, bate em 9 de 9:

| Catálogo | selo ÷ nossos dias × 30 | JoomPulse |
|---|---|---|
| MLB10512495 | 1.021,5 | 1021 |
| MLB34450041 | 334,4 | 329 |
| MLB17343353 | 14,7 | 15 |
| MLB10933634 | 10,3 | 10 |
| MLB29724117 | 3,1 | 3 |

### O que isso destrava, e o que não

**Destrava:** a "candidata B" da ADR-0142 (`acumulado ÷ idade`) deixa de estar bloqueada por falta
de idade. Podemos calcular exatamente o que a JoomPulse calcula.

**Não destrava sozinho:** copiar a fórmula copia os dois defeitos dela — numerador em potência de
10 e média vitalícia em vez de ritmo atual. **A idade só vale se houver um numerador melhor que o
selo.**

### Candidato a numerador melhor: reviews

`GET /reviews/item/{item_id}` responde **200 para item de terceiro** e devolve
`paging.total` — no `MLB2107927039`, **3.765 avaliações**. É um contador **exato**, não um bucket
em potência de 10. Se a razão review/venda for estável dentro de uma categoria,
`reviews ÷ idade` teria resolução muito melhor que `selo ÷ idade`.

**Não medido ainda** — em investigação.

### Achado colateral para o Radar — **REFUTADO em 2026-08-29**

> ~~`/products/{catalog_product_id}` também devolve **`buy_box_winner`**, que é exatamente o que a
> D-4 da ADR-0141 precisa e que está aberto no TASKS. Mesma chamada, sem custo adicional.~~
>
> **Errado.** Medido em 40 catálogos ativos: `buy_box_winner` vem **null em 40/40** com o nosso
> token — inclusive com `?attributes=buy_box_winner` e `?include_attributes=all`. `/highlights/`
> devolve 404, `/sites/MLB/search?catalog_product_id=` devolve 403, e o campo `tier` dos itens vem
> vazio em 166/166. Eu li o campo na documentação da resposta e não conferi o valor.
>
> O que a ponte entrega de verdade, e a hipótese que sobra para o ganhador, estão em
> [`../reference/licoes-joompulse-para-o-radar.md`](../reference/licoes-joompulse-para-o-radar.md) §2.
> Lá também fica provado que **menor preço ≠ ganhador** (o 1º da lista é o mais barato em só 9 de
> 17 catálogos disputados).
