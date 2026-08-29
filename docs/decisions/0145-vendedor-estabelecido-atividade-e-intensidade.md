# ADR-0145 — Vendedor estabelecido, e duas métricas no lugar de uma

**Status:** Aceito. Decisão de Diego em 2026-08-29, depois de ele apontar na tela que "fica estranho no caso de aptamil com mediana zero, mesmo tendo fornecedores vendendo".
**Data:** 2026-08-29
**Decisores:** Diego
**Relaciona:** [0142](0142-vendas-mensais-por-vendedor.md) (a fórmula — **emendada aqui**), [0143](0143-demanda-do-nicho-pela-ponte-do-catalogo.md) (a ponte pelo catálogo), [0144](0144-serie-de-vendedores-como-base-de-mercado.md) (a base de mercado — **corrigida aqui**), [Spike 046](../spikes/046-mediana-zero-e-a-cauda-do-catalogo.md)
**Contrato regido:** [contrato-analise-publiai-secoes-2-3-7.md](../reference/contrato-analise-publiai-secoes-2-3-7.md)

---

## Contexto

A busca `aptamil premium 2` exibia **mediana 0 un./mês** sobre 101 vendedores, num nicho onde os
anúncios da própria busca do ML mostram `+1000 vendidos` e `+100 mil vendidos`. O número estava
tecnicamente correto e comercialmente absurdo.

O [Spike 046](../spikes/046-mediana-zero-e-a-cauda-do-catalogo.md) mediu duas causas, **nenhuma
delas na fórmula da ADR-0142**.

### Causa 1 — a população, e ela domina

A ponte do catálogo (ADR-0143) traz **todos** os vendedores da ficha, inclusive contas que nunca
venderam nada. Medido sobre 432 vendedores:

| Faixa de `total` histórico | Vendedores | % com delta zero em ~13d |
|---|---|---|
| < 50 | 149 | **67%** |
| 50–500 | 60 | 3% |
| 500–5.000 | 95 | 0% |
| > 5.000 | 128 | 0% |

Acima de 50 transações históricas, **97 a 100% dos vendedores mostram movimento em 13 dias**. Se o
gargalo fosse a janela curta, a faixa do meio também zeraria. Não zera.

Efeito secundário registrado: dentro da faixa `<50`, 13 dias não separa "vende 0" de "vende 1–2 por
mês" — um vendedor de 2/mês tem ~58% de chance de delta zero (Poisson, λ≈0,87). É a faixa sobre a
qual **o instrumento não tem resolução**, o que reforça a mesma decisão.

### Causa 2 — a janela declarada não é verificável por nós

A ADR-0142 D-3 afirma que `transactions.total` cobre "365 dias móveis". A API devolve
**`{"period": "historic"}`**, o que sugeria contador vitalício.

> **Errata (2026-08-29, [Spike 047](../spikes/047-joompulse-comparada-com-a-nossa-metrica.md)):**
> **a leitura "vitalício" está refutada por medição.** Comparando 40 vendedores contra uma
> estimativa mensal independente, `total ÷ meses de vida da loja` dá **0,24x** enquanto
> `total ÷ 12` dá **1,41x** — e contas de 2002 a 2010 têm totais baixos demais para serem
> vitalícios (`RON_VIANA2010`, aberta em 2010, marca **zero**). O campo se comporta como janela de
> ~365 dias, como a ADR-0142 dizia. O `period: "historic"` do ML **não** deve ser lido como "desde
> sempre".
>
> **A D-4 abaixo sobrevive intacta, e agora por um motivo mais forte:** não sabemos a janela do
> fornecedor com certeza, então a tela declara **a nossa** — "movimento observado em N dias". Esse
> rótulo é correto sob as duas leituras.
>
> **A trava de delta negativo (D-5) também sobrevive**, e ganha de volta uma explicação plausível:
> numa janela móvel, a venda que sai pela cauda derruba o total sem nada ter acontecido hoje.
> Continua sem confirmação — a medição do §5 do Spike 046 mostrou que as quedas não são um degrau
> isolado.

Fica registrado o que **não** sabemos: se a janela é móvel, um vendedor em regime estacionário
teria delta zero, e 63% da base tem delta positivo. Ou a base está em crescimento, ou a janela não
é pura. Nenhum dado disponível fecha isso.

---

## Decisões

### D-1 — Só **vendedor estabelecido** entra na conta

Estabelecido = `transactions_total ≥ 50` **no primeiro snapshot da série**.

`MIN_TOTAL_ESTABELECIDO = 50`. Vendedor abaixo disso não entra na mediana, nem no denominador do
piso, nem na atividade.

**O filtro é pelo primeiro snapshot, nunca pelo delta.** Filtrar por `delta > 0` seria condicionar
no desfecho e empurraria a mediana para cima por construção. O `total` inicial é pré-tratamento:
não seleciona pelo resultado. Vendedor que cruza 50 durante a janela continua fora até a próxima
consulta.

Medido no `aptamil premium 2`: 116 vendedores com série útil → **50 estabelecidos**, e a mediana
sai de **0 para 303 un./mês**.

### D-2 — Duas métricas, porque são duas perguntas

| Métrica | Pergunta | Forma | Aptamil | EAN fio viscose |
|---|---|---|---|---|
| **Atividade** (3.6, nova) | "tem demanda aqui?" | `X de N estabelecidos com delta > 0, em D dias` | **37 de 50 (74%)** | 4 de 5 (80%) |
| **Intensidade** (3.2, existente) | "quanto vende o típico?" | mediana de `vendas_mes` entre estabelecidos | **303/mês** | 1.067/mês |

A atividade é o campo que faltava: é ele que separa mercado vivo de mercado morto, e é ele que
carrega a distinção da D-6 abaixo. A intensidade continua sendo a fórmula da ADR-0142, intacta —
**muda a população, não a conta**.

### D-3 — O piso de 5 muda de lugar e passa a degradar

O piso da ADR-0143 contava "vendedores com estimativa" da população crua: o aptamil passava com
101 fantasmas dentro e o EAN passava raspando com 5 reais. Agora:

| Estabelecidos com estimativa | Comportamento |
|---|---|
| **≥ 5** | exibe atividade **e** intensidade |
| **1 a 4** | **suprime a intensidade** (mediana não é robusta com N<5) e **mantém a atividade**, com aviso de base pequena |
| **0** | ausência com motivo (D-6) |

Contagem e share **não precisam de piso de robustez** — são contagens, não estimadores de tendência
central. Isso resolve a fragilidade registrada na ADR-0143 D-6, em que o EAN passava com exatamente
5 e um vendedor a menos apagaria o card.

Não baixar o piso da mediana para 3: com N=3 a mediana é a loja do meio de três, e isso é anedota
com nome de estatística.

### D-4 — Nenhum rótulo diz "365d"

A janela que existe é a **nossa janela de observação**, e ela é declarável com exatidão.

- Delta: `movimento observado em N dias, extrapolado para 30 — loja inteira do vendedor`
- `total` histórico, se exibido: `vendas acumuladas da loja (histórico)`

Sai da tela, da ADR-0142 (D-2, D-3), da ADR-0143, do contrato e do comentário no topo de
`vendas-mensais-vendedor.ts`.

### D-5 — Delta negativo: a trava fica, a explicação muda

A justificativa da ADR-0142 D-3 ("a janela móvel expulsa vendas antigas") **caiu junto com a
janela**. A trava continua, agora como fato empírico:

| Quedas medidas dia a dia | |
|---|---|
| Ocorrências | 525 |
| Vendedores afetados | 132 |
| **Queda mediana** | **−12** |
| Quedas de apenas 1 ou 2 | 96 (18%) |
| Pior queda | −2.036 |

Metade das quedas é de 12 ou mais — **grande demais para ser cancelamento pontual**. Parece
recálculo ou reset do contador no lado do ML, mas isso é hipótese, não medição.

`sem_estimativa_no_periodo` permanece **exatamente como está**. Não tolerar deltas levemente
negativos: sem saber a causa, tolerar é inventar.

### D-6 — Três estados de ausência, não um

Hoje "não tem catálogo", "não tenho histórico" e "o nicho está parado" desembocam todos em zero ou
num `sem_dado` genérico.

| Situação | Como se reconhece | O que a tela diz |
|---|---|---|
| **Sem ponte** | poucos anúncios com `catalog_product_id` (3.3 já mede) | "nicho de anúncios sem catálogo — sem ponte para vendedores" |
| **Sem série** | ponte existe, mas < 5 estabelecidos com ≥2 snapshots | "cobertura insuficiente: X de Y vendedores estabelecidos têm série" |
| **Parado de verdade** | ≥ 5 estabelecidos medidos e **share de atividade baixo** | os dois números, sem eufemismo |

O discriminador de "parado" passa a ser o **share entre estabelecidos**, nunca a mediana da
população crua.

### D-7 — O corte de 50 é calibração, não constante universal

Derivado de 432 vendedores majoritariamente vindos do Radar da DSA — população enviesada para os
nichos que a organização já monitora.

Sensibilidade medida no aptamil: cortes de 20 a 500 produzem mediana entre **238 e 379** — mesma
ordem de grandeza, e todos removem o zero. O resultado não depende do valor exato.

**Revisar quando a base de mercado (ADR-0144) crescer.** A constante fica nomeada, num só lugar,
com referência a este ADR.

---

## Erratas que esta decisão obriga

1. **ADR-0142, D-2 e D-3:** `period` é `historic`, não "365 dias móveis". A fórmula fica; o rótulo e
   a explicação do delta negativo saem.
2. **ADR-0144, seção de consequências:** a frase *"em contraste útil com a mediana 0 do
   `aptamil premium 2`, que é nicho parado"* está **errada** — era artefato de composição da
   população, e o nicho tem 74% dos estabelecidos ativos.
3. **ADR-0143, D-6:** a fragilidade do "passa com exatamente 5" é resolvida pela D-3 acima.

## Consequências

**Ganhamos** um par de números que responde as duas perguntas que o operador faz de verdade, e o
fim do caso em que um mercado comprovadamente ativo aparecia como parado.

**Perdemos** a simplicidade de um número só na tela, e passamos a carregar uma constante calibrada
que precisará de revisão.

**Fica em aberto:** a atribuição anúncio ↔ vendedor (herdada da ADR-0142) e a causa dos deltas
negativos (D-5).

## Critérios de aceite

1. Vendedor com `total < 50` no primeiro snapshot não entra na mediana nem no denominador do piso.
2. O filtro usa o **primeiro** snapshot: vendedor com `t0 = 40` e `t1 = 80` continua fora.
3. `aptamil premium 2` com dados reais: mediana **> 0**, ou ausência por cobertura — nunca mais
   "0 un./mês" como resumo do nicho.
4. ~~EAN `7891113175371`: os 5 vendedores passam o filtro e a mediana permanece na casa de 1.000.~~
   **Errata (2026-08-29, revisão final):** este critério **nasceu contraditório com a D-3 e nunca foi
   satisfazível**. Prova aritmética: a mediana 1.067 da tabela do Spike 046 foi calculada sobre
   **4** estimativas, não 5 — o `BAZAR HORIZONTE` (65.370 transações) já estava com delta negativo
   na data do spike, e as três medianas da tabela só se reproduzem sob essa hipótese (corte 0 →
   1.005; corte 50 → (1005+1128)/2 = 1.067; corte 500 → 1.128). A D-3 manda suprimir mediana com
   menos de 5 valores. **Comportamento correto do EAN: atividade sem mediana**, que é o que a
   implementação faz. O defeito era do documento, não do código.
5. Com 1 a 4 estabelecidos: intensidade suprimida, **atividade exibida** com aviso de base pequena.
6. Delta negativo continua `sem_estimativa_no_periodo` (caso real −4.875).
7. Nenhum **rótulo de tela** nem **comentário de código** contém "365": `grep -rn "365" src/ supabase/functions/`
   volta vazio. Em `docs/`, as ocorrências restantes são apenas dentro de errata ou de citação do
   texto antigo (a ADR-0141 §112 descreve a JoomPulse, abandonada, e fica como registro histórico).
8. A atividade exibe os dias de janela observados ("em N dias"), nunca uma janela do ML.
9. Mediana nunca é calculada com menos de 5 estabelecidos; média aritmética continua banida
   (ADR-0142 D-6).
10. Validado contra `pulse_vendedores` real, não só mock (regra pós-ADR-0129).
11. `pnpm test`, `pnpm lint` e `npx tsc -b --force` verdes.
