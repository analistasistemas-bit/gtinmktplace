# Spike 050 — A fórmula da JoomPulse em escala: o acervo do catálogo tem dono errado

**Data:** 2026-08-29
**Pedido de Diego:** "fiz a análise desse produto na tela da JoomPulse utilizando a IA deles, como
eles conseguem chegar nesse nível de informação? Por que não consigo nem via Apify?"
**Confirma e amplia:** [Spike 047](047-joompulse-comparada-com-a-nossa-metrica.md) §1, que decifrou
a fórmula em 9 de 9
**ADR:** confirma [0147](../decisions/0147-radar-mostra-a-disputa-do-catalogo.md) e
[0146](../decisions/0146-media-mensal-12m-e-tendencia.md); **não pede emenda em nenhuma**

## Resposta curta

1. **A fórmula do [Spike 047](047-joompulse-comparada-com-a-nossa-metrica.md) §1 se confirma em
   escala:** `vendas/mês = catalogSales ÷ daysInAd × 30`, agora **100 de 100 catálogos exatos**,
   noutra categoria (Bebês) e noutro corte. E `receita = vendas × preço do buy-box`, 98 de 99.
2. **Achado principal — o agregado do catálogo é copiado para a linha do ganhador do buy-box e
   zerado nas demais**, e é oferecido no grão de anúncio (`orderCount1m` = "Vendas estimadas",
   filtro "Vendas mensais" da busca). Em **12 de 60** ganhadores de alto volume em Bebês
   (amostra filtrada por `orderCount1m > 300`, enviesada para cima), o número de **um mês de um
   anúncio supera o ano inteiro da loja toda** pela API oficial do ML — que vem na **mesma linha**
   da resposta deles (§2).
3. **Achado novo — a estimativa não carrega informação do produto.** Sete catálogos de mesma idade
   e mesmo selo recebem o **mesmo** número de vendas, a preços de R$ 18,90 a R$ 299,90 (§1.2).
4. **Achado novo — ela explode em catálogo novo.** 33 dias no ar com selo "+10 mil" viram
   **9.091 vendas/mês** (§1.3).
5. **Aplicada de passagem a errata que o [Spike 048](048-transactions-total-e-janela-provada.md)
   §6.4 obrigou** e nunca foi escrita no corpo do 047 — a escala do selo tem degraus de 2x a 5x,
   não potências de 10. Esta amostra a confirma e acrescenta o degrau **250.000** (§1.1).
6. **Resposta ao Apify: dá, e é esse o ponto.** Os dois insumos são públicos. O que não existe em
   fonte alguma é venda por anúncio de terceiro — a JoomPulse não a possui, ela a substitui por
   esta conta (§3).
7. **A única coisa deles que vale é o `buyBoxWiner`**, que o
   [Spike 049](049-buy-box-do-radar-o-que-e-mensuravel.md) provou não ser obtenível pela nossa API
   (`buy_box_winner` null em 40/40).

---

## 1. A fórmula em escala

Cubo `MlbProductsSortedByProductId`, categoria L1 `Bebês`, `catalogProduct = true`, top 100 por
`catalogOrderCount1m`. Snapshot JoomPulse de 2026-08-29.

| Verificação | Resultado |
|---|---|
| `catalogOrderCount1m == round(catalogSales ÷ daysInAd × 30)` | **100 de 100 exatos** |
| `catalogOrderGmv1m == round(catalogOrderCount1m × buyBoxPriceAmount)` | **98 de 99 exatos** |

Amostra:

| Catálogo | `catalogSales` | `daysInAd` | conta | JoomPulse |
|---|---:|---:|---:|---:|
| MLB75831480 | 10.000 | 33 | 9.090,9 | **9.091** |
| MLB56367175 | 100.000 | 348 | 8.620,7 | **8.621** |
| MLB37271347 | 250.000 | 1.824 | 4.111,8 | **4.112** |
| MLB10512495 (Aptamil) | 100.000 | 2.938 | 1.021,1 | **1.021** |
| MLB21392281 | 50.000 | 1.551 | 967,1 | **967** |

A receita fecha nos centavos: 1.021 × R$ 49,90 = **R$ 50.947,90**, exatamente o `R$ 50.948` da
tela. O schema deles documenta a direção que a Errata 3 do Spike 047 já havia corrigido no 043:
`orderGmv = orderCount × priceAmount`.

> **As duas exceções em cem:** `MLB36776116` traz GMV de R$ 123.712 para 2.082 vendas — preço
> implícito de R$ 59,42 contra `buyBoxPriceAmount` de R$ 87,50; e `MLB42438627` traz GMV **zero**
> com preço de R$ 56,99. Não abalam a identidade.

### 1.1 A escala do selo — errata pendente do Spike 048, agora aplicada

O [Spike 048](048-transactions-total-e-janela-provada.md) §6.4 **já havia obrigado** a errata: a
escala do selo tem degraus de 2x a 5x (25, 50, 100, 500, 1k, 5k, 10k, 50k, 100k), não "potências de
10 com erro até 2x" como o [Spike 047](047-joompulse-comparada-com-a-nossa-metrica.md) §1 escreveu.
**A errata nunca foi aplicada ao corpo do 047** — corrigido agora, no lugar certo.

Esta amostra confirma a escala noutra categoria e **acrescenta o degrau 250.000**:

| Degrau observado em `Bebês` | razão para o seguinte |
|---|---:|
| 1.000 → 5.000 | **5,0x** |
| 5.000 → 10.000 | 2,0x |
| 10.000 → 50.000 | **5,0x** |
| 50.000 → 100.000 | 2,0x |
| **100.000 → 250.000** | **2,5x** |

O erro embutido no numerador é de até ~5x, sempre para baixo: um catálogo com 4.999 vendas entra
como 1.000.

### 1.2 A estimativa não distingue produtos

Catálogos de mesma idade e mesmo selo recebem o **mesmo** número, a preços incomparáveis:

| Catálogos | `daysInAd` | selo | vendas/mês atribuídas | faixa de preço |
|---|---:|---:|---:|---|
| MLB10512495 · 10512514 · 10512516 | 2.938 | 100.000 | **1.021** aos três | R$ 49,90 – 155,00 |
| MLB18392608 · 643 · 647 · 651 · 677 · 724 · MLB18410058 | 1.831–1.832 | 100.000 | **1.638** aos sete | R$ 18,90 – 64,09 |
| MLB17335903 · 933 · 975 · 17336057 · 067 · 378 · 383 | 2.042 | 100.000 | **1.469** aos sete | R$ 46,55 – 299,90 |
| MLB69620405 · 627 · 69621080 · 632 | 109 | 10.000 | **2.752** aos quatro | R$ 159,90 – 256,90 |

O 047 §1 já tinha visto `1021` duas vezes e `15` três vezes **dentro da mesma família de produto**.
Em escala fica claro que a colisão não é do produto: é da fórmula. Bucket igual + idade igual ⇒
número igual, qualquer que seja o item.

### 1.3 E ela explode em catálogo novo

O denominador ser a idade do catálogo tem um efeito que o 047 não alcançou, porque a amostra dele
era de catálogos maduros:

| Catálogo | idade | selo | resultado |
|---|---:|---:|---|
| MLB75831480 | **33 dias** | 10.000 | **9.091 vendas/mês** |
| MLB75971196 · MLB76064731 | **31 dias** | 1.000 | 968 vendas/mês cada |
| MLB70587169 | **90 dias** | 5.000 | 1.667/mês × R$ 478 = **R$ 796.826/mês** |

Um catálogo recém-criado que herdou selo alto vira campeão de vendas por construção aritmética.

### 1.4 Cegueira a tendência, por construção

O número só se move quando o selo cruza um degrau (100 mil → 250 mil), o que num catálogo de oito
anos praticamente nunca acontece. Um produto que vendeu forte em 2020 e morreu em 2024 exibe o
mesmo `1.021/mês` de um que está crescendo hoje. O 047 §1 já dizia "não diz nada sobre o mês
corrente"; o que se acrescenta é que **não pode vir a dizer** — não há caminho pelo qual esse
número reflita o presente.

## 2. Achado novo — a atribuição, que a própria resposta deles denuncia

**O mecanismo primeiro, porque ele é o que sustenta o achado.** O
[Spike 043](043-como-a-joompulse-estima-vendas.md) §2 já havia medido que `orderCount1m` e
`catalogOrderCount1m` são **o mesmo número, idênticos em 100/100 linhas**. O que este spike
acrescenta é *como* essa cópia se distribui pelas ofertas do catálogo:

| | `orderCount1m` | `catalogOrderCount1m` |
|---|---:|---:|
| oferta com `buyBoxWiner = true` | **1.021** | 1.021 |
| as outras 39 da amostra | **0** | 1.021 |

**O agregado do catálogo é copiado para a linha do ganhador do buy-box e zerado nas demais.**
Ninguém "estimou 1.021 vendas para a ANDRESSAMELOARF" — o número é do catálogo inteiro, e ela
recebeu a cópia por estar na caixa no dia da coleta.

Isso não é detalhe de implementação que absolva o número: a documentação deles mapeia
`orderCount1m` para `Vendas estimadas (dia/semana/mês)` no **grão de anúncio**, separado de
`catalogOrderCount1m` → `Vendas do catálogo`, e a Busca de Produtos expõe "Vendas mensais" como
filtro **por anúncio**. A cópia é oferecida como venda do anúncio. Daí a afirmação defensável:

> **Todo uso de `orderCount1m` no grão de anúncio herda o agregado do catálogo — e em 12 de 60
> ganhadores de alto volume em Bebês (amostra enviesada, ver abaixo) isso produz um número que a
> API do ML refuta na mesma linha da resposta.**

No catálogo do Aptamil (`MLB10512495`, `numBuyBoxSellers = 53`), essa mesma linha traz
`shopSales365Days`, que o [Spike 047](047-joompulse-comparada-com-a-nossa-metrica.md)
§2 provou ser o nosso `transactions.total` (Δ < 0,4% em 5 de 5) e que o
[Spike 048](048-transactions-total-e-janela-provada.md) provou ser janela móvel de 365 dias:

```
MLB3250921353 · ANDRESSAMELOARF · R$ 49,90 · gold_pro
   JoomPulse  orderCount1m      = 1.021 vendas/mês
   API do ML  shopSales365Days  =     1 transação em 365 dias
```

**Nosso banco confirma o vendedor e acrescenta o golpe final:**

```sql
select item_id, seller_id, preco, tier, ativo, visitas_30d from pulse_ofertas_atual
where item_id = 'MLB3250921353';
-- MLB3250921353 | 277478030 | 49.90 | gold_pro | true | visitas_30d = 1
```

**Uma visita em 30 dias.** Não se vendem 1.021 unidades com uma visita. As 100 mil saíram de 53
vendedores ao longo de oito anos; a JoomPulse entrega o acervo inteiro a quem ganhou a caixa no dia
da coleta.

### Quão comum é — e o viés da amostra, declarado

60 ganhadores de buy-box da categoria Bebês **filtrados por `orderCount1m > 300`**:

| Teste | Resultado |
|---|---:|
| um **mês** do anúncio > um **ano** da loja inteira (API oficial) | **12 de 60** |
| estimativa **anualizada** > o ano da loja inteira | **37 de 60** |

> **O filtro enviesa para cima, e o número deve ser sempre citado com ele.** `orderCount1m > 300`
> seleciona justamente numerador grande sobre denominador pequeno, que é a condição que gera a
> impossibilidade. Logo: **20% dos ganhadores de alto volume em Bebês**, e não 20% dos catálogos.
> A taxa sobre o universo inteiro não foi medida.

Os extremos:

| Vendedor | JoomPulse | API do ML (loja toda, 365 d) | fator |
|---|---:|---:|---:|
| ARTHALUNA | 2.752/mês | **21** | 131x |
| TSTECOMMERCE | 2.013/mês | **27** | 75x |
| FARMACIACHARRUA | 1.543/mês | **21** | 73x |
| DYNAMISBRASIL EQUIPAMENTOS | 2.073/mês | **47** | 44x |
| CEGONHADISTRIBUIDORA | 1.680/mês | **96** | 18x |

Não é margem de erro de estimativa: é impossibilidade aritmética, publicada ao lado do campo que a
refuta.

### A IA deles leu a própria tabela errado

O texto gerado afirma *"R$ 49,90 no anúncio de maior volume"*, mas a coluna da tela está rotulada
`Catálogo total`. A IA atribuiu a **um anúncio** o que é do **catálogo** — o erro de granularidade
que o [doc de lições](../reference/licoes-joompulse-para-o-radar.md) §3 descreve.

Mesmo alerta para `reviewsCount` (3.754) e `daysInAd` (2.938): vieram **idênticos nas 40 ofertas**
do catálogo. A documentação deles avisa que são de catálogo e que compará-los entre ofertas
*"implies a difference that does not exist"*.

## 3. Por que o Apify não resolve — e o que resolveria

Resolve, e é esse o ponto. Os dois insumos estão na página pública do ML:

| Insumo | Onde está | Documentação deles |
|---|---|---|
| `catalogSales` | selo "+N vendidos" | *"MeLi cumulative sold-badge buckets; lifetime, not a rate"* |
| `daysInAd` | idade do catálogo | *mapeia para `listing_activity_days`* |
| `buyBoxPriceAmount` | preço exposto na caixa | *"real, not estimated"* |

E o [Spike 047](047-joompulse-comparada-com-a-nossa-metrica.md) §6 mostrou que **já temos a idade
sem scraping**: `GET /products/{catalog_product_id}` devolve `date_created` com 200 para catálogo de
terceiro. Reproduzir a conta deles nunca esteve bloqueado — **decidimos não fazê-la.**

O que **não** existe em fonte nenhuma é venda por anúncio de terceiro. A JoomPulse não a possui;
ela a substitui por esta divisão. Comprar o dado deles é comprar a conta, não a observação.

**A exceção que valeria scraping é o `buyBoxWiner`.** O [Spike 049](049-buy-box-do-radar-o-que-e-mensuravel.md)
fechou todas as rotas de API para o ganhador de catálogo de terceiro — `buy_box_winner` null em
40/40, `price_to_win` 403 para item alheio. A página pública expõe quem está na caixa, e é dela que
a JoomPulse lê.

## 4. Consequências para o Radar

**Nenhuma emenda necessária.** As decisões em produção saem confirmadas:

- A [ADR-0147](../decisions/0147-radar-mostra-a-disputa-do-catalogo.md) mostra a **disputa** e nunca
  o ganhador. Correto: o ganhador não é obtenível pela API, e o único fornecedor que o publica erra
  a atribuição de forma verificável em **12 de 60 ganhadores de alto volume em Bebês** (amostra
  filtrada por `orderCount1m > 300`, enviesada para cima — §2).
- A recusa em publicar "vendas do produto" continua certa.
- **O aviso de ofertas abaixo da referência mirou no anúncio certo.** Ele sinaliza a oferta de
  R$ 49,90 de um vendedor sem histórico; o `buyBoxWiner` da JoomPulse mostra que **é justamente
  essa** que está na caixa de compra. O aviso apontava para o anúncio certo sem saber por quê.
- A [ADR-0146](../decisions/0146-media-mensal-12m-e-tendencia.md) não é atingida: `transactions_total
  ÷ 12` é da **loja inteira**, rotulada como porte de loja e nunca como venda de produto.
- **"Selo ÷ idade" já estava refutado** como métrica principal no
  [doc de lições](../reference/licoes-joompulse-para-o-radar.md) §7, por bucket grosso e por ser
  média vitalícia. O que este spike acrescenta é uma **segunda camada de refutação, específica do
  grão de anúncio**: mesmo que o quociente do catálogo fosse aceitável, atribuí-lo ao ganhador do
  buy-box produz 12 impossibilidades em 60. Vale como nota histórica que o
  [Spike 043](043-como-a-joompulse-estima-vendas.md) chegou a recomendar essa conta como
  alternativa auditável à derivação deles, sem saber que **era a derivação deles**.

**Fica registrado para a decisão de opt-in do Diego** (AVIL: 0 de 137 anúncios em catálogo,
[Spike 049](049-buy-box-do-radar-o-que-e-mensuravel.md) §1): estar fora da vitrine do Aptamil é
perder para uma oferta com 1 transação no ano e 1 visita em 30 dias.

## 5. Não medido

- **Se a fórmula vale fora de Bebês.** 100/100 numa categoria L1, 9/9 no `aptamil premium 2` do
  Spike 047. Não há razão para variar por categoria, mas não foi medido numa terceira.
- **Se existem degraus de selo acima de 250.000.** A amostra não os alcançou; o erro de ~5x é piso,
  não teto.
- **Como a JoomPulse trata a troca de mãos do buy-box** entre coletas. O snapshot é diário
  (~03:25 UTC) e a atribuição de todo o acervo troca de dono junto.
- **De onde sai `catalogSales` quando o ML não exibe selo.** Toda a amostra tinha selo.
