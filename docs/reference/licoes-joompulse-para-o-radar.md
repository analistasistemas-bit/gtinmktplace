# O que a checagem contra a JoomPulse ensinou — insumo para a ADR do Radar

**Data:** 2026-08-29
**Origem:** [Spike 043](../spikes/043-como-a-joompulse-estima-vendas.md),
[Spike 047](../spikes/047-joompulse-comparada-com-a-nossa-metrica.md),
[Spike 048](../spikes/048-transactions-total-e-janela-provada.md), [ADR-0146](../decisions/0146-media-mensal-12m-e-tendencia.md)
**Para:** a ADR que vai implementar a **D-4** (coluna Análise PubliAI no Radar) e a **D-24**
(remoção da "Referência do ML") da [ADR-0141](../decisions/0141-analise-publiai-joompulse-radar-e-sonar.md)

> Este documento **não reconta** os spikes. Ele transpõe cada achado para o que **proíbe** ou
> **destrava** no Radar. Nada aqui precisa ser remedido; tudo está citado na origem.

---

## 1. A D-4 perdeu a fonte de dados **e** o formato de chamada

A D-4 foi escrita contra o CubeJS da JoomPulse: `buyBoxShopId`, `buyBoxShopName`,
`buyBoxPriceAmount`, `numBuyBoxSellers`, em **lotes de 75 ids, 3 chamadas paralelas** para os 229
catálogos do Radar. A JoomPulse saiu (`995ab9f7`). O substituto é a API do ML, e ela é
**por catálogo**: 229 catálogos = **~229 chamadas**, não 3.

**Consequência que a D-4 nunca tratou:** rate limit, pool de concorrência e cache passam a ser
requisito de desenho, não detalhe de implementação.

**A máquina já existe e é reaproveitável** — `supabase/functions/_shared/analise/vendedores-do-catalogo.ts`,
construída para o Sonar nesta mesma entrega: pool de 5, cache Redis de 24 h
(`sonar:cat-vendedores:v1:{id}`), e `catalogosOk` separando "consultado" de "falhou".
O cache é **global e agnóstico de org** de propósito (a exclusão da conta própria é aplicada na
leitura, não na escrita) — o Radar entra nele sem alteração.

## 2. `buy_box_winner` **não existe para nós** — a premissa do Spike 047 está refutada

O Spike 047 §6 registrou como "achado colateral para o Radar" que `/products/{catalog_product_id}`
devolve `buy_box_winner`, "exatamente o que a D-4 precisa, sem custo adicional".

**Medido em 2026-08-29 — está errado:**

| Teste | Resultado |
|---|---|
| `buy_box_winner` em 40 catálogos ativos (Sonar + Radar) | **null em 40/40** |
| `?attributes=buy_box_winner`, `?include_attributes=all` | null nos dois |
| `/highlights/MLB/catalog/{id}` | **404** |
| `/sites/MLB/search?catalog_product_id=` | **403** (coerente com a ADR-0119) |
| campo `tier` nos itens da ponte | **vazio em 166/166** |

**A D-4 não pode ser escrita assumindo que o ganhador do buy-box vem pronto.** Ele não vem.

### O que a ponte do catálogo **de fato** entrega

`GET /products/{catalog_product_id}/items` é a única rota que responde, e devolve por anúncio:
`seller_id`, `price`, `original_price`, `shipping`, `official_store_id`, `listing_type_id`, `tags`
— mais `paging.total`.

Isso **cobre o `numBuyBoxSellers`** (é o `paging.total`) e permite dizer se a org disputa o catálogo
e a que preço. O que **não** cobre é *quem leva a venda*.

### A ordenação da ponte é ranking, não preço — e isso é uma pista

Medido em 17 catálogos com mais de um anúncio: **o primeiro resultado é o mais barato em apenas
9 deles.** Nos outros 8, o primeiro chega a custar **+95%** que o mais barato do catálogo:

| Catálogo | anúncios | 1º da lista | menor preço | diferença |
|---|---:|---:|---:|---:|
| MLB10512495 | 92 | R$ 70,19 | R$ 36,00 | **+95,0%** |
| MLB14489497 | 18 | R$ 59,99 | R$ 39,90 | +50,4% |
| MLB10512516 | 62 | R$ 71,99 | R$ 54,00 | +33,3% |
| MLB17343352 | 13 | R$ 149,99 | R$ 130,00 | +15,4% |

Duas leituras, ambas úteis para a ADR:

1. **Hipótese a verificar:** a ordem é o ranking do ML, e o primeiro elemento é candidato a
   ganhador do buy-box. É estável (`?limit=1` devolve o mesmo primeiro que a lista cheia).
   **Não verificado contra verdade fundamental** — a ADR precisa fechar isso antes de exibir
   "quem leva a venda" na tela.
2. **Já provado, e mais importante:** **menor preço ≠ ganhador.** Qualquer desenho do Radar que
   diga "o mais barato leva a venda" está errado em ~metade dos catálogos disputados.

Este é o **mesmo erro que a D-24 está removendo da tela**: a "Referência do ML" enganava por
comparar preço contra um universo não comparável (ADR-0119, Errata 10). Substituí-la por
"o mais barato ganha" trocaria um número enganoso por outro.

## 3. A métrica de venda precisa ser a **mesma** nas duas telas

O Sonar agora diz, por vendedor (ADR-0146):

- **intensidade** = `transactions_total ÷ 12` — média mensal dos últimos 12 meses, loja inteira;
- **tendência** = sinal do delta — vende mais / igual / menos que há um ano.

**Se o Radar exibir qualquer coisa com cara de venda, tem que ser esta definição.** Duas telas com
duas contas diferentes chamadas de "vendas" é o defeito mais caro que esta entrega poderia deixar
para trás — o operador não tem como saber qual está lendo.

**O Radar não herda o buraco de coleta do Sonar.** O `pulse-coletar` só cobre vendedores que a org
já rastreia; por construção, **os vendedores do Radar já estão em `pulse_vendedores`**. O buraco
(vendedor descoberto por termo arbitrário, sem série) é exclusivo do Sonar.

## 4. `date_created` do catálogo: presente, útil e perigoso

Confirmado disponível (`/products/{id}.date_created`, 200 para catálogo de terceiro) e é a fonte
do `daysInAd` da JoomPulse — reproduzimos a idade dela em **6 de 9 catálogos com erro de ±1 dia**
(Spike 047 §6).

**Destrava** a métrica "tamanho histórico do produto". **Mas é outra janela.** A média vitalícia do
catálogo e a média de 12 meses do vendedor não são comparáveis e não podem dividir a mesma coluna.

Regra herdada da ADR-0146 D-6 — esta foi a **quarta** iteração do rótulo desta métrica e a primeira
com a janela provada: **nenhum número vai à tela com janela que não foi verificada.** Se a idade do
catálogo for exibida, o rótulo diz "média desde a criação do catálogo", nunca "vendas por mês".

## 5. Composição domina qualquer mediana sobre catálogo

Medido no `aptamil premium 2` (ADR-0146 D-4):

| População | Mediana de `total ÷ 12` |
|---|---:|
| Todos os 116 do catálogo | **1 un./mês** |
| Os 50 estabelecidos (`t0 ≥ 50`) | **322 un./mês** |

E a cauda não é só pequena — ela é **estruturalmente parada**. Cruzando tendência contra o corte:

| | estabelecido (`t0 ≥ 50`) | fora (`t0 < 50`) |
|---|---:|---:|
| crescendo | 37 | 11 |
| **estável** | **0** | **54** |
| encolhendo | 13 | 1 |

**Todos os 54 vendedores estáveis estão abaixo do corte.** O corte de 50 não é só um conserto de
mediana: ele remove exatamente a população que nunca se move.

**Para o Radar:** toda agregação sobre os concorrentes de um catálogo herda isto. Um catálogo com
92 anúncios não tem 92 concorrentes reais.

## 6. Disciplina de denominador — o defeito que mais se repetiu

Quatro ocorrências da mesma família nesta entrega: a linha da UI, o campo `proporcao`, o
`LinhasCobertura`, e o `catalogos_com_falha` — este último **contado e não usado**, de forma que a
cobertura **subia** quando o ML estava instável.

Duas regras que a ADR do Radar deveria adotar explicitamente:

1. **Toda razão nomeia as duas populações na mesma frase.** "26 de 104 anúncios", nunca "25%".
2. **Falha de consulta reduz a cobertura, nunca a aumenta.** Se o catálogo não respondeu, ele conta
   no denominador e não no numerador.

## 7. Refutado — não tentar de novo

| Caminho | Por quê | Onde |
|---|---|---|
| **Reviews como numerador** | pool agregado na família: 7 dos 9 catálogos do aptamil devolvem o mesmo `paging.total`; razão review/pedido varia **7x dentro da mesma loja** | Spike 048 §5 |
| **Selo ÷ idade como métrica principal** | é a conta da JoomPulse; numerador em degraus de **2x a 5x** (25, 50, 100, 500, 1k, 5k, 10k, 50k, 100k), e o resultado é média vitalícia, não ritmo | Spikes 047 §1, 048 §6 |
| **`/items/{id}` e `/items?ids=` para vendedor de terceiro** | 403 nos dois | ADR-0119 |
| **`buy_box_winner`** | null em 40/40 | §2 acima |

## 8. O que sair da JoomPulse custou — nada, na métrica por vendedor

`shopSales365Days` da JoomPulse **é o mesmo campo** que já coletamos (`transactions.total`):
confere em 5 de 5 vendedores, diferença < 0,4% (Spike 047 §2).

O que perdemos foi só a estimativa **por catálogo** — que é justamente a defeituosa (selo em bucket
÷ idade = média vitalícia). **A pergunta "o Radar deveria voltar para a JoomPulse?" está respondida
antes de ser feita: não há dado dela que não tenhamos, exceto o que não queremos.**

---

## Perguntas abertas que a ADR do Radar precisa fechar

1. **Como identificar o ganhador do buy-box** sem `buy_box_winner`. Hipótese disponível (1º da
   ponte) e **não verificada**. Se não fechar, a D-4 exibe "a org disputa este catálogo, com N
   concorrentes, ao preço X" — que é menos do que prometeu, e honesto.
2. **Custo real de ~229 chamadas por abertura de página**, mesmo com cache de 24 h — e o
   comportamento na primeira abertura do dia, com cache frio.
3. **Se a coluna exibe venda**, confirmar que usa a definição da ADR-0146 e nenhuma outra.
