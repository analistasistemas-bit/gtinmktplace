# ADR-0149 — DRE, fatia 2: cinco preços com cotação própria, e o capital do lote

**Status:** Aceito. Definido por Diego em 2026-08-29, respondendo às duas lacunas que a
[ADR-0148](0148-dre-fatia-1-uma-cotacao-e-o-guard-de-proveniencia.md) declarou.
**Data:** 2026-08-29
**Decisores:** Diego
**Relaciona:** [0148](0148-dre-fatia-1-uma-cotacao-e-o-guard-de-proveniencia.md) (a fatia 1 — o guard),
[0141](0141-analise-publiai-joompulse-radar-e-sonar.md) (**define a D-15, que estava em aberto**),
[Spike 040](../spikes/040-revisao-adversarial-adr-0141.md) (levantou as duas lacunas),
[Spike 049](../spikes/049-buy-box-do-radar-o-que-e-mensuravel.md) (**derruba o preço do buy-box como candidato**)

---

## Contexto

A D-15 da ADR-0141 prometia "5 cenários comerciais" e **nunca os enumerou**. A D-5 prometia ROI e
**nunca o definiu** — sem quantidade, capital nem horizonte, como o Spike 040 registrou e ninguém
respondeu.

A fatia 1 entregou a DRE de **um** preço e declarou as duas lacunas em vez de inventá-las. Diego
respondeu as duas: cenários são **preços de venda diferentes** (não mais testes de estresse), e o
ROI é sobre **capital imobilizado num lote**.

Duas correções entraram no caminho, ambas antes de qualquer código.

## Decisões

### D-1 — Os cinco preços, e por que o buy-box não é um deles

| # | Preço | Origem | Natureza |
|---|---|---|---|
| 1 | **mais barato da amostra** | menor `preco` dos anúncios | observado |
| 2 | **preço médio do nicho** | `raio_x.ticket_medio` | observado |
| 3 | **preço do anúncio que mais vende** | a âncora da ADR-0148 D-8 | observado |
| 4 | **preço-alvo** | a margem que o operador quer | derivado |
| 5 | **ponto de equilíbrio** | lucro zero | derivado |

**A recomendação original dizia "preço do buy-box". Ela cai.** O
[Spike 049](../spikes/049-buy-box-do-radar-o-que-e-mensuravel.md) provou que o ganhador do buy-box
não é obtenível — `buy_box_winner` vem null em 40 de 40 catálogos, e as nove rotas alternativas
fecham em 403/404. Um preço que não podemos ler não vira cenário. O lugar dele fica com o **anúncio
que mais vende**, que é dado real e já é a âncora da seção 6.

### D-2 — Cada preço tem a **sua** cotação; nada é extrapolado

O `calcularSensibilidade()` existente extrapola a comissão linearmente e **congela taxa fixa e
frete**. Comissão e frete do ML têm degraus por faixa: uma cotação em R$ 78,99 e um cenário em
R$ 79,00 caem em faixas diferentes, e a conta antiga erra **com aparência de precisão cirúrgica**
(Spike 040).

Nesta fatia, **cada um dos cinco preços é cotado de verdade** — cinco chamadas ao
`calcular-tarifa-ml`, cada uma com seu cache de 6 h. `calcularSensibilidade()` continua **não sendo
usada** pela DRE, pelo mesmo motivo da ADR-0148 D-1.

Sem endpoint em lote: cinco chamadas paralelas resolvem, e o cache absorve a repetição. Um modo
batch entra se e quando o custo de ida e volta doer, medido.

### D-3 — Os dois preços derivados são aproximados, e a tela diz isso

Preço-alvo e ponto de equilíbrio são calculados **a partir da cotação da âncora**, porque não há
como cotar um preço antes de conhecê-lo. Depois eles são **recotados no próprio valor**, e é essa
segunda cotação que produz os números exibidos.

Resta um resíduo honesto: se o preço derivado cruzar um degrau de comissão ou frete, o ponto de
equilíbrio real desloca um pouco. **A tela marca os dois como projeção** — o código já os nasce
assim (`PrecoProjetadoML.ehProjecao`), e a ADR-0141 D-2 proíbe número financeiro sem função pura
testada por trás, não número declaradamente projetado.

Não haverá solver iterativo: precisão de centavo num preço que o operador ainda vai escolher não
paga a complexidade.

### D-4 — ROI: a quantidade não muda o percentual, e a tela não finge que muda

**Correção matemática ao que foi aprovado.** ROI sobre capital imobilizado é

```
(lucro_unitário × Q) ÷ (custo_unitário × Q) = lucro_unitário ÷ custo_unitário
```

**A quantidade cancela.** Com R$ 42 de custo e R$ 19,67 de lucro dá 46,8% comprando 1 unidade ou
1.000 — exatamente o markup que o app já mostra. Exibir isso como "ROI" seria dar nome novo a um
número existente.

O que a quantidade **de fato** acrescenta são os absolutos, e são eles que vão à tela:

| | |
|---|---|
| **capital imobilizado** | `custo_unitário × Q` — quanto sai do caixa |
| **lucro total do lote** | `lucro_unitário × Q` — quanto volta |
| retorno sobre o capital | o mesmo percentual do markup, **rotulado como tal**, não como número novo |

**O percentual só divergiria** se o lote tivesse custos que não escalam com a quantidade (frete de
compra, importação, despachante) ou se o custo unitário caísse por volume. Nenhum dos dois é pedido
hoje — fica registrado como a extensão natural, e **explicitamente fora desta fatia**.

**Sem horizonte de tempo.** Diego o excluiu, e com razão: não temos velocidade de venda confiável
por produto, e um prazo de giro chutado contaminaria a única conta que o operador leva a sério.

### D-5 — O guard da D-28 vale para as cinco cotações, e a pior governa

Cada cenário exibe seus números **apenas se a própria cotação for `official`**. Um cenário que
recusa não derruba os outros — ele diz por que recusou, na própria linha.

O resumo do bloco (capital e lucro do lote) usa o cenário que o operador escolher, e **só existe se
aquele cenário estiver calculado**.

### D-6 — A quantidade não tem default

`Q` em branco não vira 1. Sem quantidade, a tela mostra os cinco cenários por unidade e **não
mostra capital nem lucro do lote** — mesmo princípio da origem na ADR-0148 D-6: número financeiro
não se presume.

## O que esta fatia NÃO entrega

- **Custos de lote que não escalam** (frete de compra, importação) — sem eles o percentual de
  retorno é o markup, como a D-4 registra.
- **Horizonte de tempo / prazo de giro** — excluído por falta de dado confiável.
- ~~**A D-16** (mover peso taxável da seção 3 para a 6), que segue aberta desde a ADR-0141.~~
  **Fechada em 2026-08-29 — ver Errata 1.**
- **Endpoint em lote** para as cotações (D-2).
- **A dívida do `cotacoesOficiaisDaTarifa`** herdada da ADR-0148: a calculadora da Revisão continua
  cravando `official`. Medido em 2026-08-29: **18 anúncios publicados** têm dimensão inválida
  (0,10 cm) e recebem frete de pacote padrão hoje.

## Consequências

**Ganhamos** a pergunta que o garimpo realmente faz — *"a que preço vale entrar, e quanto de caixa
isso trava?"* — com cinco preços cotados de verdade, sem extrapolação.

**Perdemos** a simplicidade da fatia 1: são cinco cotações em vez de uma, e dois dos preços são
declaradamente projeção.

**Fica registrado** que a recomendação original desta ADR continha dois erros — o preço do buy-box,
que não existe, e o ROI por quantidade, que é aritmeticamente igual ao markup — e que ambos foram
corrigidos **antes** de virar código.

## Critérios de aceite

1. Os cinco preços saem das fontes da D-1; nenhum texto menciona buy-box.
2. Cada cenário usa a cotação **do seu próprio preço** — nenhum reaproveita a cotação de outro.
3. Cenário com cotação não-`official` recusa **sozinho**, sem derrubar os demais.
4. Preço-alvo e ponto de equilíbrio aparecem marcados como projeção.
5. Sem quantidade informada, não há capital nem lucro de lote na tela.
6. O percentual de retorno é rotulado como retorno sobre o custo, **nunca** como um número
   diferente do markup.
7. Nenhum texto promete prazo, giro ou horizonte.
8. `pnpm test`, `pnpm lint`, `npx tsc -b --force`, `deno lint` e `pnpm docs:links` verdes.

---

## Errata 1 (2026-08-29) — a D-16 fechada, porque sem ela a seção 6 nascia morta

Diego pesquisou o Aptamil Premium 2 no Sonar e os **cinco** cenários recusaram, todos com o mesmo
texto: *"o frete foi calculado com um pacote padrão porque as dimensões do produto não foram
informadas"*.

**Não era defeito: era a fatia 1 funcionando e a D-5 pela metade.** A D-5 da ADR-0148 especificou um
formulário que pede *"custo, origem, peso e dimensões"*; só custo e origem foram construídos.
`calcularTarifaML(preco, categoria, dim?)` **já aceitava** o terceiro argumento — a tela nunca o
passava. Logo toda cotação saía do `DIMENSOES_DEFAULT` (16×11×6 cm, 300 g) de
`_shared/ml/frete.ts`, a proveniência voltava `partial` e o guard da D-28 recusava **sempre**. A
própria ADR-0148 previu o sintoma ("no Sonar o produto é do concorrente — dimensões faltando ali é o
caso comum") sem notar que ele tornava a seção inutilizável.

### Dimensão automática está descartada, e isso foi medido

| Fonte | O que devolve |
|---|---|
| `GET /products/{catalog_product_id}` | apenas `UNIT_WEIGHT = 800 g` — peso do **produto**, não do pacote; nenhum `PACKAGE_*` |
| `GET /products/{id}/items` (a ponte) | `shipping` sem dimensão alguma |

Usar os 800 g como peso de envio seria o palpite silencioso que a D-28 existe para matar. **O
pacote só pode vir do operador**, como a origem já vinha (ADR-0107 / D-6).

### O que muda

1. **`dimensoes` é entrada obrigatória de `EntradaDreSonar`**, não campo opcional. Quatro campos
   novos na seção 6: peso (g), altura, largura e comprimento (cm). Só existem juntos — cotar com
   três deles seria completar o quarto com o padrão do ML.
2. **O guard das dimensões vem ANTES do da tarifa.** Sem eles, dizer "o frete usou um pacote
   padrão" mandaria o operador esperar o ML resolver um campo que só ele preenche. A frase passa a
   ser *"informe o peso e as dimensões do pacote"*.
3. **Dimensão inválida recusa, não estoura.** `calcularPesoUtilizado` lança `RangeError` em valor
   não-positivo e a seção 6 recebe digitação livre. A validação do motor é reusada, não repetida —
   uma segunda cópia das regras seria a segunda fonte de verdade que a D-15 proíbe.
4. **A seção 6 passa a mostrar peso físico, volumétrico (`C × L × A ÷ 6000`) e taxável**, dizendo
   qual venceu, mais quem paga o frete naquele preço. `calcularPesoUtilizado` já existia em
   `calculadora-ml.ts` e já era devolvido por `calcularSimulacaoML` — nada de aritmética nova.

### O que estava em jogo, medido

Cotação real no catálogo `MLB10512495` (categoria `MLB269341`), pacote padrão contra a lata de
800 g (18×13×13 cm, 950 g):

| Preço | Pacote padrão | Lata real | Delta |
|---|---:|---:|---:|
| R$ 70,19 | R$ 8,15 | R$ 8,45 | +R$ 0,30 |
| R$ 73,55 | R$ 8,15 | R$ 8,45 | +R$ 0,30 |
| R$ 297,61 | R$ 21,65 | R$ 24,45 | +R$ 2,80 |

O erro é pequeno em reais e **irrelevante para a decisão**: o guard não recusa por magnitude, recusa
por não poder afirmar. O que a errata corrige é que ele recusava sem oferecer saída.

### Custo

Cinco preços × uma cotação cada, agora com a dimensão na `queryKey` — sem isso o react-query serviria
a cotação do pacote anterior quando o operador corrigisse uma medida. Nenhuma chamada nova: as
mesmas cinco, com um parâmetro a mais.

### Segue aberto

A dívida do `cotacoesOficiaisDaTarifa` na Revisão. (Os **18 anúncios publicados com 0,10 cm**
saíram de pauta: Diego encerrou a correção em 2026-08-29. Fica como registro, não como tarefa.)

---

## Errata 2 (2026-08-29) — a DRE afirmava Clássico sem dizer que era Clássico

Diego pediu "a opção para escolher se o anúncio será clássico ou premium". Ao implementar,
apareceu que isto **não era só uma funcionalidade que faltava: era uma afirmação silenciosa.**

`calcularSimulacaoML()` devolve `modalidades: { classico, premium }` — as **duas**, sempre. O
`dre-sonar.ts` lia apenas `simulacao.modalidades.classico`, em dois lugares, e a tela apresentava
o resultado sem rótulo de modalidade. Um operador que vende Premium lia comissão de 14% onde a
dele é 18%, sem nenhum aviso — o mesmo gênero de defeito que a D-28 existe para matar, só que por
omissão de rótulo em vez de proveniência.

### O que muda

1. **`modalidade` é campo obrigatório de `EntradaDreSonar`**, não opcional com default. Default
   silencioso é exatamente o que produziu o problema.
2. **A modalidade move o ponto de equilíbrio e o preço-alvo**, não apenas a linha da comissão.
   `precosDerivadosDre` lia `classico` fixo; quem vende Premium via um piso otimista. Há teste
   provando que o equilíbrio do Premium é maior.
3. **Quase custo zero de cotação — e a exceção importa.** A tarifa traz Clássico e Premium na
   mesma resposta, e o frete é idêntico nas duas (`_shared/ml/frete.ts`: *"Clássico == Premium
   (mesmo custo), então uma chamada basta"*). Logo os preços **observados** (mais barato, médio,
   anúncio que mais vende) **não** são recotados ao trocar de modalidade.

   Mas o ponto de equilíbrio **é outro preço** no Premium, e a D-2 exige que cada preço seja cotado
   no próprio valor — então a troca dispara **uma** cotação, a do preço que se moveu (duas, se
   houver margem-alvo preenchida). Há teste cravando `antes + 1`.

   > Uma versão anterior desta errata afirmava "o seletor não acrescenta nenhuma chamada ao ML".
   > **Estava errado**, e foi o teste que derrubou a afirmação antes dela virar verdade oficial.

### A tabela, e a coluna que faltava

Diego também apontou que a lista de cenários estava ilegível ("no lugar de ter os nomes ao lado dos
valores, ter as colunas com nomes"). Ao redesenhar apareceu uma ausência: **a decomposição não
mostrava o custo do produto.** Com comissão, frete e imposto apenas, o lucro não era conferível.
Com a coluna de custo, cada linha fecha na horizontal:

```
70,19 − 9,83 − 8,45 − 5,62 − 30,00 = 16,29
```

### O que NÃO mudou, por decisão de Diego

**"Quantidade do lote" fica.** Eu recomendei remover — as duas contas que ela produz são
`custo × N` e `lucro × N`, e o percentual de retorno ignora a quantidade (D-4). Diego optou por
manter: ver o capital travado em reais ajuda a decidir a compra. Registrado aqui para não voltar
a ser proposto.
