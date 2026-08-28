# ADR-0137 — Sonar: Disputa com caminho B (concentração por anúncio) quando o rótulo não cobre a amostra

**Status:** Aceito — design fechado em entrevista (grilling, 2026-08-27); calibração derivada dos fixtures antes da implementação
**Data:** 2026-08-27
**Relacionados:** ADR-0124 (veredito), ADR-0127 (veredito v2 por anúncio, Calibração v2, trava D10), ADR-0128 (Entrada separada da Demanda)

## Problema

A Disputa v2 (ADR-0127/D11) mede concorrência por **rótulo de loja**: pulverização (rótulos
distintos ÷ anúncios com rótulo) + % Full. O rótulo vem do card raspado pela Apify — e a Apify
raramente o traz. Quando menos de 50% da amostra tem rótulo, a trava de cobertura (D10) derruba
Disputa e Tração juntas, o veredito se declara parcial e o card exibe "concorrência não medida".

Caso real que motivou este ADR (consulta "Latas Ninho Nestle Zero Lactose 700gr", 2026-08-27):
5 de 5 rivais do pódio sem rótulo, e o operador olhando para uma amostra cheia de dado utilizável —
vendidos, preço, Full e visitas por anúncio — enquanto o sistema respondia "não medi". A objeção
do operador estava certa no diagnóstico: **o sistema desistia tendo dado na mão.** A trava D10
protegia contra medir errado, mas pagava o preço de não medir nada.

Do pedido original do operador ("concorrência por venda, visitas, frete grátis, Full"), dois itens
já estavam no score ou foram medidos e descartados com dados — a resposta a eles é referência, não
mudança: **Full já é metade da Disputa** (por anúncio, sem rótulo); **frete grátis** foi medido
saturado (85–100% nos 3 nichos) e descartado no ADR-0127/D12; **visitas** ficaram fora do score
pela mesma decisão (sem corte derivável de N=3). **Vendas** entram via Tração e, agora, via
concentração — abaixo.

## Decisão

**A Disputa ganha dois caminhos. O caminho A (por rótulo) continua o titular; o caminho B (por
anúncio) entra quando a cobertura de rótulo é menor que 50% — exatamente onde hoje a trava D10
desiste.**

### Caminho A — inalterado

Cobertura ≥ 0,50: pulverização por rótulo + % Full, cortes da Calibração v2 intactos. Só o caminho
A pode declarar disputa **boa (🟢)** — é ele que detecta território de marca (EUCERIN: 20 anúncios
sob 2 rótulos, pulverização 0,10; por anúncio o mesmo nicho parece medianamente distribuído).

### Caminho B — concentração por anúncio + % Full

Cobertura < 0,50. Duas metades, cada uma podendo faltar independentemente:

1. **% Full** — como já é: sobre os anúncios com envio identificado (`fullPctAmostra`), sem rótulo.
   `full_pct >= 60` fecha sozinho (mesmo corte `fullMuito` do caminho A — o sinal "concorrente com
   estoque em CD" independe de saber o nome da loja).
2. **Concentração** — share do anúncio líder no faturamento medido da amostra:
   `top1 = maior(vendidos × preço) ÷ Σ(vendidos × preço)`, sobre os anúncios com `vendidos` E
   `preco` (elegíveis). Requer **≥ 5 elegíveis**; o corte é
   **`max(30%, 2 × (100% ÷ elegíveis))`** — dominante se um único anúncio leva mais de 30% do
   faturamento medido E mais que o dobro do share uniforme (o segundo termo só aperta com 5–6
   elegíveis: 40%/33%; de 7 em diante vale o 30%).

Regra do caminho B:

- **ruim (🔴)**: `full_pct >= 60` **ou** `top1 >= corte` (com elegibilidade).
- **médio (🟡)**: qualquer outra combinação em que ao menos uma metade foi medida. **É o teto do
  caminho B — 🟢 exige rótulo.** "Parece pulverizado por anúncio" é evidência fraca: N anúncios do
  mesmo vendedor contam como N rivais, então a concentração por anúncio **subestima** a real. A
  assimetria é deliberada: o caminho B fecha nicho com confiança (fundir anúncios do mesmo dono só
  concentraria mais) e nunca o declara aberto.
- **não medida**: `full_pct == null` E menos de 5 elegíveis — aí sim não há o que medir, e o texto
  diz o motivo verdadeiro ("só N de M anúncios têm venda registrada"), não "sem rótulo". Regra
  LOUD: ausência de dado não vira sinal, nem para cima nem para baixo.

### `parcial` redefinido; Tração intocada

`parcial` passa a significar **"a Disputa não foi medida por nenhum caminho"** (mais o caso
pré-existente de Full não medido no caminho A). A **Tração continua exigindo rótulo** — a escala
dela (R$/rótulo, cortes 15 mil/350 mil) não transfere para "por anúncio" sem segunda calibração, e
duas escalas convivendo mudariam o veredito entre consultas por troca de caminho. Sem rótulo, a
Tração sai da conta; o piso `PISO_FATORES_ALTA = 2` já existente continua impedindo "oportunidade
alta" com a Demanda sozinha. A Entrada (ADR-0128) deriva normalmente da Disputa medida pelo
caminho B.

### Textos (LOUD na UI)

O fator Disputa no caminho B declara a base e o limite (em "loja", nunca "vendedor" — convenção
de vocabulário do `veredito-sonar.ts`, o card do ML imprime marca, não nickname): share sobre o
**faturamento medido** (a
faixa "+N vendidos" é piso, e anúncio sem a faixa não soma — o share real pode ser menor), e
"anúncios da mesma loja podem estar contados como rivais separados; por isso este caminho
nunca declara o nicho aberto". Nada de "rótulo" na frase principal.

## Calibração (derivada dos fixtures de 19/08, custo zero)

Shares medidos sobre `src/lib/__tests__/fixtures/sonar-gabarito/` (Σ vendidos × preço dos
elegíveis; script reproduzível):

| Nicho | Elegíveis | top1 | top3 | Disputa (gabarito, caminho A) |
|---|---|---|---|---|
| EUCERIN protetor solar | 16 | **36,8%** | 60,2% | 🔴 |
| protetor solar facial | 16 | **42,1%** | 73,8% | 🔴 |
| tecido oxford 10 metros | 18 | **19,6%** | 57,1% | 🟢 |

- **top1, não top3.** O design inicial (entrevista) previa share do top 3; a medição o refutou:
  57,1% no nicho aberto contra 60,2% no fechado — 3 pontos de vão, indistinguível. O top1 separa
  com 17 pontos (19,6% vs. 36,8%). Trocado com o operador antes da implementação. Não reintroduzir
  top3 sem re-medir.
- **`top1Dominante = 30%`**: dentro do vão medido 19,6→36,8, com folga de 10,4 pts para o nicho
  aberto e 6,8 pts para o fechado mais próximo; e interpretável ("um anúncio leva quase um terço
  do faturamento medido").
- **`minElegiveis = 5` + fator 2× sobre o uniforme**: com poucos elegíveis o share do líder é alto
  por construção (uniforme = 1/N). O fator 2× exige distância real do uniforme onde o 30% seria
  frouxo (N=5–6). Abaixo de 5, medir seria artefato — não medida, com motivo.
- **Compatibilidade verificada censurando os rótulos dos 3 fixtures** (caminho B forçado):
  EUCERIN → 🔴 por top1 (36,8% ≥ 30%); facial → 🔴 por Full (100% sobre medidos); oxford → 🟡
  (teto — não fecha o nicho que o gabarito aprova, não o promove a 🟢 sem rótulo). Nenhum nicho
  fechado pelo caminho A escapa pelo B; o gabarito real (média/média/alta) não muda porque os 3
  têm cobertura ≥ 0,50 e permanecem no caminho A.
- **Oxford censurado** termina Demanda 🟢 + Disputa 🟡 (Tração fora) → `parcial = false`, Entrada
  aberta, veredito **média**. Ver a errata abaixo: a primeira redação deste ADR dava "alta" aqui, e
  isso era um furo.

`scripts/sonar-gabarito-verificar.mjs` ganha a variante censurada como parte da implementação — a
definição executável do caminho B, nos moldes das 4 variantes existentes.

## Alternativas descartadas

- **Trocar a pulverização por métricas de anúncio também quando há rótulo**: mataria a detecção de
  território de marca (EUCERIN viraria "20 concorrentes"). O rótulo, quando existe, é o dado mais
  forte da amostra.
- **HHI por anúncio**: estatística mais completa, ilegível para operador — o projeto já rejeitou
  score opaco (ADR-0124, linguajar de operador).
- **Concentração por visitas**: cobriria anúncios sem vendidos, mas visitas medem interesse, não
  conversão — tráfego concentrado em anúncio que não vende não é barreira; e visitas estão fora do
  score por decisão registrada (D12).
- **Medir concentração abaixo do piso "com aviso"**: com 3 elegíveis o share é forçado; fechar
  Entrada (decisão de não comprar estoque) sobre artefato matemático viola a regra LOUD.
- **Tração por anúncio**: segunda calibração inteira para um fator que o piso de 2 já dispensa no
  caminho B; e o veredito passaria a mudar por troca de escala entre consultas.

## Consequências

- Consultas com amostra sem rótulo (a maioria, dado o comportamento da Apify) passam a receber
  Disputa e Entrada medidas — "concorrência não medida" fica restrito a amostra sem envio E sem
  vendas suficientes.
- O caminho B nunca produz 🟢: nichos genuinamente abertos sem rótulo estacionam em 🟡. Preço
  aceito conscientemente; a alternativa era 🟢 estrutural em território de marca invisível.
- `subamostraNomeada`, cortes do caminho A, Tração e gabarito v2: intocados.
- Glossário ganha "concentração por anúncio" e "caminho A/B da Disputa".


## Errata 1 (2026-08-27) — o teto do caminho B não chegava ao veredito

A primeira redação decidiu que o caminho B nunca declara a Disputa **boa (🟢)**, porque a
concentração por anúncio subestima a real. A trava foi implementada no fator — e não aparecia na
resposta.

Com a Tração fora da conta (ela exige rótulo), `fatores` tem 2 itens e `maximo = 4`. A regra de
"alta" é `soma >= maximo - 1`, ou seja **3**. Disputa 🟡 soma 3 e Disputa 🟢 soma 4: **as duas
aprovam**. O teto que o ADR criou era invisível exatamente na faixa que significa "compre estoque",
e o `PISO_FATORES_ALTA = 2` — escrito para impedir "Demanda sozinha vira alta" — passava por
tecnicalidade, satisfeito por um fator estruturalmente incapaz de ser melhor que médio.

**Correção:** "alta" passa a exigir `disputa.caminho === 'rotulo'`. Uma cláusula no ternário de
`nivel`, ao lado de `!parcial` e `entrada === 'aberta'`.

O caminho B continua entregando o que motivou este ADR: Disputa medida, Entrada destravada, 🔴
quando o líder domina ou o Full é alto, e um card que responde em vez de dar de ombros. Ele só não
alcança a única faixa que autoriza compra de estoque, apoiado em evidência que este mesmo ADR
classifica como fraca. Nichos sem rótulo param em **média** — que é uma resposta, não um silêncio.

Gabarito real intocado: os 3 fixtures têm cobertura ≥ 0,50, seguem no caminho A, e média/média/alta
continua valendo. O gabarito censurado (`ruim/ruim/medio`) também não muda — ele afere a **Disputa**,
não o veredito final.
