# ADR-0147 — A coluna do Radar mostra a **disputa** do catálogo, não o ganhador

**Status:** Aceito. Decisão de Diego em 2026-08-29, depois de medido que o ganhador não é obtenível.
**Data:** 2026-08-29
**Decisores:** Diego
**Relaciona:** [0141](0141-analise-publiai-joompulse-radar-e-sonar.md) (**emenda a D-4; a D-24 fica como está e já foi implementada**),
[0119](0119-pulse-inteligencia-de-mercado-dirigida.md) (o coletor e a régua de relevância),
[Spike 049](../spikes/049-buy-box-do-radar-o-que-e-mensuravel.md),
[Lições da JoomPulse para o Radar](../reference/licoes-joompulse-para-o-radar.md)

---

## Contexto

A D-4 da ADR-0141 prometia uma célula dizendo **"quem leva a venda: a org ou um rival"**. O
[Spike 049](../spikes/049-buy-box-do-radar-o-que-e-mensuravel.md) provou que isso não é obtenível
e, pior, que não seria útil se fosse:

1. **O ganhador de catálogo de terceiro não vem por rota nenhuma** — `buy_box_winner` é null em
   40/40, e as nove alternativas fecham em 403/404.
2. **A org não disputa buy-box.** `catalog_listing: true` em **0 de 137** anúncios da AVIL e 1 de 19
   da DSA. A emenda do Spike 039 ("identificar por vendedor") não conserta: o problema é **opt-in**,
   não cobertura — sem opt-in o `seller_id` da org não está na ponte, por nenhuma chave.

Diego escolheu, entre três desenhos medidos, **mostrar o tamanho e o preço da disputa**.

## Decisões

### D-1 — A célula mostra disputa, faixa e posição; nunca ganhador

```
12 concorrentes relevantes disputam
R$ 130,00 – R$ 465,80
seu preço R$ 149,99 ficaria em 4º
```

Três fatos verificáveis, nenhuma inferência sobre quem vende.

### D-2 — A fonte é `pulse_ofertas_atual`: zero chamada nova, zero migration

O `pulse-coletar` **já chama** `/products/{catalog_product_id}/items`
(`supabase/functions/pulse-coletar/processar.ts:376`) para todo produto do Radar, e já grava
`seller_id`, `preco` e `ativo` por oferta. `resumirMercadoQualificado` já calcula
`maior_relevante`, `total_relevantes` e `vendedores_relevantes` — eles apenas **não estavam
expostos** em `PulseResumoOfertas`.

**Consequência:** a D-4 não precisa de edge function, de coleta nova, de tabela nova nem dos ~229
chamados/17 s que o Spike 049 dimensionou. O custo dessa coluna é **uma projeção a mais no
`fetchPulseResumoOfertas` que já roda**.

Isto também **revoga a emenda da D-7** da ADR-0141, que abria exceção para "uma consulta em lote ao
abrir a página do Radar": não há consulta nova a abrir exceção para.

### D-3 — A população é a dos **relevantes**, e a célula a nomeia

Mesma régua de qualificação que já governa a coluna "Menor relevante" (ADR-0119 / ADR-0020 /
ADR-0050). Usar "observadas" aqui e "relevantes" ao lado criaria duas populações na mesma linha —
exatamente o defeito de denominador que se repetiu quatro vezes na entrega do Sonar.

**A célula escreve a população por extenso** ("12 concorrentes relevantes"), nunca um número nu.

### D-4 — Três estados, e "sem disputa" tem texto próprio

| Estado | Quando | Texto |
|---|---|---|
| **disputa** | ≥ 1 oferta relevante | as três linhas da D-1 |
| **sem disputa** | 0 ofertas relevantes | `sem concorrente relevante no catálogo` |
| **não lido** | resumo ainda carregando | skeleton, como as demais colunas |

O Spike 049 mediu que **22% dos catálogos do Radar não têm nenhum anúncio de catálogo ativo**
(`/products/{id}/items` devolve 404 com `/products/{id}` em 200 `active`). Esse é um estado
legítimo do mercado — não "sem dado", não tela quebrada — e merece a frase que o descreve.

### D-5 — A posição do nosso preço é declarada como **hipotética**

O anúncio da org **não é** anúncio de catálogo (D-1 do contexto: 0 de 137 na AVIL). Ele não está na
lista que gerou a faixa. Portanto a tela **não pode** dizer "você é o 4º" — diria que a org ocupa
uma posição numa disputa da qual não participa.

O texto é **"seu preço R$ X ficaria em Nº"**: aritmética honesta sobre onde o preço cairia, sem
afirmar participação. Quando não há preço próprio, a linha some — não vira "—".

### D-6 — Nesta entrega não há painel nem frase de IA

A D-4 original previa "um painel de números determinístico, com uma frase de leitura escrita por
IA no topo". O painel existia para narrar **a disputa pelo buy-box**, que é justamente o que deixou
de existir. Reabri-lo agora seria desenhar em cima de uma pergunta que ninguém ainda fez.

Fica fora, explicitamente, e volta quando houver pergunta que o painel responda.

## Errata 1 (2026-08-29, na validação visual) — a célula não repete o preço próprio, e a coluna sobe para `xl`

A D-1 desenhou a terceira linha como `seu preço R$ 149,99 ficaria em 4º`. Medido no runtime com a
tela real, essa linha custava caro: a célula ficava com **222 px** de largura intrínseca e fazia a
tabela **estourar o container em 1024, 1100 e 1280 px**. Sem a coluna, a tabela cabe exata em toda
largura — o estouro era inteiramente dela.

Duas correções, ambas medidas:

1. **O preço sai da célula.** Ele já é a coluna "Seu preço", na mesma linha. A terceira linha vira
   `seu preço ficaria em 4º de 6` — a redundância era o que empurrava a tabela.
2. **A coluna passa de `lg` para `xl`.** A antiga "Referência do ML" cabia em `lg` por ser um badge
   de uma palavra; três linhas de texto não cabem.

Depois: 1100 px não exibe a coluna (correto), 1440 px cabe exato, e em 1280 px sobra um resíduo de
**4 px** — piso do próprio cabeçalho, absorvido pelo `overflow-x: auto` que a tabela já tem.

Um teste guarda a decisão: o preço próprio aparece **uma** vez na linha.

## Errata 2 (2026-08-29) — a invisibilidade no catálogo ganha aviso próprio, sem afirmar ganhador

Conferência contra a JoomPulse pediu por Diego, nos catálogos `MLB10512495` e `MLB10512516`. **A
faixa bate**: no Aptamil Premium 2, menor e maior idênticos (R$ 54,00 / R$ 391,98); no Premium 1 a
diferença é de centavos, compatível com o snapshot D-1 deles. E a **nossa cobertura é maior** — 98
anúncios contra 55, 69 contra 50.

O que a conferência revelou não foi erro de número, e sim **um silêncio da tela**: existe oferta
ativa muito abaixo da referência relevante, e o operador não sabia. Medido: **34 dos 178 produtos**
do Radar estão nessa situação; no Aptamil Premium 1 são **25 ofertas, a mais barata 48,7% abaixo**.

O dialog de detalhe passa a exibir um aviso **separado da faixa**:

> ⚠ 25 ofertas ativas abaixo da sua referência, a partir de R$ 36,00 (49% abaixo de R$ 70,19). São
> vendedores sem histórico suficiente, então não entram na comparação de preço — mas aparecem na
> mesma página do catálogo que a sua.

**A régua de relevância não muda.** Perseguir preço de vendedor sem histórico destrói margem atrás
de quem não se sustenta (ADR-0020/0050). O aviso informa; não recomenda.

**O aviso não diz quem leva a venda, e essa é a decisão.** A formulação inicialmente proposta era
*"o catálogo está sendo levado a R$ X"* — e ela é falsa por duas razões já provadas nesta ADR: o
ganhador do buy-box não é obtenível (Spike 049, `buy_box_winner` null em 40/40) e **o mais barato
não é o ganhador** (medido: só em 9 de 17 catálogos disputados). Confirmado no próprio caso: o mais
barato está em R$ 36,00 e a JoomPulse aponta o buy-box em outra oferta, de R$ 49,90 — de um
vendedor com **1 venda em 365 dias**.

## Errata 3 (2026-08-29) — o detalhe do Radar passa a usar a definição do Sonar

Revisão da tela de detalhe pedida por Diego. O achado central: **o Radar exibia o delta de
`transactions_total` como "≈N no período"** — e o [Spike 048](../spikes/048-transactions-total-e-janela-provada.md)
provou que esse campo é janela móvel de 365 dias, então o delta é *venda de agora menos venda do
mesmo período de um ano atrás*, não venda. O Sonar já tinha corrigido isso na
[ADR-0146](0146-media-mensal-12m-e-tendencia.md); o Radar ficou para trás, e **as duas telas
calculavam contas diferentes do mesmo campo chamando as duas de venda** — o defeito descrito em
[Lições da JoomPulse para o Radar](../reference/licoes-joompulse-para-o-radar.md) §3.

Verificado em produção: `Mercado Livre Brasil` foi de 31.347.465 a 31.746.992 em 8 dias de coleta.
O número era real; o rótulo é que estava errado.

| | antes | depois |
|---|---:|---:|
| Mercado Livre Brasil | ≈399.527 "no período" | **2.645.583/mês** |
| WEBSTOREVIX | ≈137 | **2.791/mês** |
| CIRURGICANOVAERA | ≈1.413 | **2.980/mês** |

Mudanças:

1. **"Vendas na conta" vira "Porte do vendedor"** — `transactions_total ÷ 12` (mesma
   `mediaMensal12m` que o Sonar usa) mais a tendência (crescendo / estável / encolhendo). Continua
   sendo a **loja inteira**, e o tooltip diz isso: venda por anúncio de terceiro não é obtenível
   (ADR-0142). `vendasEstimadasVendedor` ficou órfã e foi removida.
2. **Visitas 30d ganha a fatia entre os relevantes.** É a única medida **por anúncio** que a API
   oficial dá, e por isso o melhor proxy de tração daquele anúncio. Medido no `aptamil premium 1`:
   a WEBSTOREVIX é 13x maior como loja que a DROGACENTERATAC e tem **10 visitas contra 735** — o
   porte da loja e a disputa daquele produto contam histórias opostas. **Não é fatia de mercado:**
   tráfego não é conversão, e anúncios sem medição ficam fora do denominador.
3. **FULL passa a aparecer.** `full_ml` já era coletado, já entrava na qualificação e nunca
   chegava à tela.
4. **Composição dos relevantes** acima da tabela (vendedores, frete grátis, FULL, faixa da
   disputa) — tudo já calculado em `resumirMercadoQualificado` e descartado.

**Rejeitado:** remover a coluna "Anúncio". A sugestão veio de `tier` vir vazio na ponte do
catálogo, mas em `pulse_ofertas_atual` ele está preenchido — **1.059 `gold_special` e 353
`gold_pro`** —, e distingue Clássico de Premium, que muda a comissão de 14% para 18%.

**Registrado, não corrigido:** `fetchPulseDetalhe` lê `pulse_vendedores` sem paginar
(`src/lib/pulse.ts`), enquanto `fetchPulseResumoOfertas` pagina de propósito contra o truncamento
silencioso do PostgREST. Hoje são 495 linhas no total e no máximo 13 por vendedor — risco latente,
longe do limite.

## O que esta decisão NÃO resolve

**A org continua fora dos catálogos.** Entrar (opt-in de `catalog_listing`) é decisão comercial do
Diego, não de engenharia, e esta ADR não a toma nem a recomenda. O que ela faz é **tornar o fato
visível**: com a faixa na tela, o operador vê a disputa que está acontecendo sem ele.

**Quem leva a venda continua desconhecido** para catálogo de terceiro, e provavelmente continuará —
a matriz de rotas do Spike 049 §4 está fechada.

## Consequências

**Ganhamos** uma coluna que funciona em 100% das linhas com catálogo, sem coleta nova, sem
migration e sem custo de abertura de página.

**Perdemos** a promessa original da D-4. O Radar não dirá quem ganha o buy-box — nem hoje, nem
depois de opt-in, enquanto a API não abrir o campo.

**Fica registrado** que a coluna nasce menor do que a ADR-0141 desenhou, e que isso é consequência
de medição, não de corte de escopo.

## Critérios de aceite

1. A célula exibe contagem, faixa e posição hipotética, com a população nomeada por extenso.
2. Zero chamada nova à API do ML e zero migration — o diff não toca `supabase/`.
3. Catálogo sem oferta relevante exibe a frase da D-4, não "—" nem "0".
4. Produto sem `meu_preco` não exibe a linha de posição.
5. A palavra "ganhador"/"buy-box"/"leva a venda" não aparece em nenhum texto da coluna.
6. A faixa usa `maior_relevante` e `menor_relevante` — nunca `menor_observado`, que já enganou na
   Errata do mercado relevante.
7. `pnpm test`, `pnpm lint`, `npx tsc -b --force` e `pnpm docs:links` verdes.
