# Spike 046 — Por que o aptamil dava mediana zero, e qual estatística usar

**Data:** 2026-08-29
**Origem:** Diego olhou a tela e apontou que "fica estranho no caso de aptamil com mediana zero, mesmo tendo fornecedores vendendo". Os anúncios da busca do ML mostram `+1000 vendidos` e `+100 mil vendidos`.
**ADR:** [0142](../decisions/0142-vendas-mensais-por-vendedor.md) (a fórmula), [0143](../decisions/0143-demanda-do-nicho-pela-ponte-do-catalogo.md) (a ponte), [0144](../decisions/0144-serie-de-vendedores-como-base-de-mercado.md) (a base)
**Método:** consultoria estatística + medição em produção sobre `pulse_vendedores` e `/products/{id}/items`

## Resposta curta

**Dois defeitos, e nenhum deles é a fórmula.**

1. **A premissa da janela estava errada.** A ADR-0142 D-3 afirma que `transactions.total` cobre
   "365 dias móveis". A API devolve **`{"period": "historic"}`** — é vitalício. O rótulo
   "janela móvel 365d" **está errado na tela**.
2. **A mediana media a população errada.** A ponte do catálogo importa a cauda inteira da ficha,
   inclusive contas que nunca venderam. Filtrando quem tem ao menos 50 vendas na vida, o aptamil
   **sai de 0 para 303 un./mês**.

---

## 1. O zero vem só de vendedor minúsculo

Sobre 432 vendedores com ≥2 snapshots e ≥5 dias de janela:

| Faixa de `total` histórico | Vendedores | % com delta zero | Delta mediano em ~13d |
|---|---|---|---|
| < 50 | 149 | **67%** | 0 |
| 50–500 | 60 | 3% | 7 |
| 500–5.000 | 95 | 0% | 59 |
| > 5.000 | 128 | 0% | 202 |

Se o gargalo fosse a **janela curta** (13 dias), vendedores médios também mostrariam zeros. Não
mostram: acima de 50 transações históricas, **97 a 100% têm movimento**. A janela é suficiente para
quem vende de verdade.

Há um efeito secundário real, mas menor: dentro da faixa `<50`, 13 dias não separa "vende 0" de
"vende 1–2 por mês" — um vendedor de 2/mês tem ~58% de chance de delta zero por Poisson (λ≈0,87).
Ou seja, parte dos 67% é volume baixo real, não inatividade. **Mais um motivo para não deixar essa
faixa votar na mediana: sobre ela o instrumento não tem resolução.**

## 2. Sensibilidade do corte — medido nos dois nichos

### `aptamil premium 2` (116 vendedores com série útil)

| Corte (`total` no 1º snapshot) | Estabelecidos | Com movimento | Share ativo | Mediana |
|---|---|---|---|---|
| **0** (hoje) | 116 | 48 | 41% | **0** |
| 20 | 54 | 39 | 72% | 238 |
| **50** | **50** | **37** | **74%** | **303** |
| 100 | 48 | 35 | 73% | 363 |
| 500 | 40 | 28 | 70% | 379 |

O corte remove 57% dos vendedores e o nicho **deixa de ser "parado"**: 74% dos 50 concorrentes
estabelecidos tiveram movimento, e o típico vende 303/mês.

A mediana varia de 238 a 379 entre os cortes 20 e 500 — **mesma ordem de grandeza**. O resultado
não é frágil à escolha exata; 50 é onde a tabela do §1 mostra a transição de fase.

### EAN `7891113175371` (fio de viscose, 6 vendedores)

| Corte | Estabelecidos | Share ativo | Mediana |
|---|---|---|---|
| 0 | 6 | 83% | 1.005 |
| 50 | 5 | 80% | 1.067 |
| 500 | 4 | 75% | 1.128 |

**O filtro conserta o aptamil sem quebrar o EAN.** Era o teste que importava.

## 3. Os deltas negativos não são cancelamento

Medido dia a dia sobre a base inteira:

| | |
|---|---|
| Quedas observadas | 525 |
| Vendedores afetados | 132 |
| **Queda mediana** | **−12** |
| Quedas de apenas 1 ou 2 | 96 (18%) |
| Pior queda | −2.036 |

Metade das quedas é de 12 ou mais. **Grande demais para ser cancelamento pontual** — parece
recálculo ou reset de contador do lado do ML.

**Conclusão: manter a trava `sem_estimativa_no_periodo` exatamente como está.** O que muda é só a
justificativa na ADR: a explicação da "janela móvel" caiu, e a causa real é desconhecida. Trava
empírica, não teórica.

## 4. Recomendação

**Duas métricas, ambas sobre a população filtrada por `total ≥ 50` no primeiro snapshot:**

| Métrica | Responde | Aptamil | EAN |
|---|---|---|---|
| **Atividade** — `X de N estabelecidos venderam em D dias` | "tem demanda aqui?" | 37 de 50 (74%) | 4 de 5 (80%) |
| **Intensidade** — mediana de vendas/mês entre eles | "quanto vende o típico?" | 303/mês | 1.067/mês |

Por que filtrar pelo **primeiro** snapshot e não pelo delta: filtrar por `delta > 0` seria
condicionar no desfecho e empurraria a mediana para cima por construção. O `total` inicial é
pré-tratamento — não seleciona pelo resultado.

Por que não média aparada nem p75: a conta institucional "Mercado Livre Brasil" (31,7 mi de
transações) sobrevive a qualquer trim moderado. A mediana filtrada sobrevive por construção, e a
D-6 da ADR-0142 já bane a média.

### O piso de 5 muda de lugar, e degrada em vez de apagar

- **≥ 5 estabelecidos com estimativa** → exibe as duas métricas.
- **1 a 4** → **suprime a mediana** (não é robusta com N<5) mas **mantém a atividade**, que é
  contagem e não estimador de tendência central. Resolve a fragilidade do EAN passar com
  exatamente 5.
- **0** → ausência com motivo.

### Três estados de ausência, não um

| Situação | Sinal | O que a tela diz |
|---|---|---|
| Sem ponte | poucos anúncios com catálogo (3.3 já mede) | "nicho de anúncios sem catálogo" |
| Sem série | ponte existe, < 5 estabelecidos com 2 snapshots | "cobertura insuficiente: X de Y" |
| **Nicho parado de verdade** | ≥ 5 medidos e **share de atividade baixo** | os dois números, sem eufemismo |

O discriminador de "parado" passa a ser o **share entre estabelecidos**, não a mediana da população
crua. É por isso que a métrica de atividade precisa existir.

## 5. Ressalva sobre o corte de 50

Foi derivado de 432 vendedores majoritariamente vindos do Radar da DSA — população enviesada para
os nichos que a organização já monitora. **É calibração inicial revisável** conforme a base de
mercado (ADR-0144) cresce, não constante universal. Deve constar como tal na ADR que implementar.

## O que precisa de errata

- **ADR-0142 D-2 e D-3:** `period` é `historic`, não 365 dias móveis. A descoberta **melhora** a
  fórmula (com contador vitalício o delta é venda nova de fato), mas o rótulo cai.
- **ADR-0144:** a frase "aptamil premium 2, que é nicho parado" está errada — era artefato de
  composição da população.
- **`vendas-mensais-vendedor.ts`:** o comentário do topo repete "janela móvel de 365d".

---

## 6. Revisão final (2026-08-29) — o que a implementação revelou

### O critério de aceite 4 da ADR-0145 nasceu contraditório

A tabela do §2 deste spike foi calculada **sem aplicar o piso de 5**. A revisão reconstituiu a
aritmética e provou que a mediana de 1.067 do EAN saiu de **4** estimativas, não 5 — o
`BAZAR HORIZONTE` (65.370 transações) já estava com delta negativo na data da medição:

| Corte | Valores na mediana | Reconstituição | Tabela do §2 |
|---|---|---|---|
| 0 | {157, 254, 1005, 1128, 4142} | **1.005** | 1.005 ✓ |
| 50 | {1005, 1128} + 2 | (1005+1128)/2 = **1.066,5** | 1.067 ✓ |
| 500 | {1005, 1128, 4142} | **1.128** | 1.128 ✓ |

Três de três. **O comportamento correto do EAN é atividade sem mediana** — que é o que a
implementação faz. Errata aplicada na ADR-0145.

**Lição:** a tabela de sensibilidade de um corte precisa aplicar **todas** as regras vigentes, não
só a que está sendo calibrada.

### A tolerância proporcional para delta negativo foi recusada

Tentação: o `BAZAR HORIZONTE` é descartado por uma queda de **−159 sobre 65.370 (0,24%)**. Um
limiar percentual o resgataria.

Recusado por três motivos, o primeiro decisivo:

1. **A escala é errada.** Com tolerância de 0,5%, a conta "Mercado Livre Brasil" (31,7 mi de
   transações) absorveria **−158.000** como "movimento zero". Ninguém mediu que o processo gerador
   das quedas seja proporcional ao histórico.
2. **−159 não é ruído nesta distribuição.** Mediana das quedas é −12; um limiar que resgata algo
   13× a mediana não é filtro de ruído, é política.
3. **"Virar zero" fabrica dois dados:** injeta um 0 na mediana e declara parado um vendedor de 65
   mil transações.

### O estimador alternativo também foi refutado — medido

A hipótese era: o delta ponta-a-ponta joga fora os passos intermediários, e a mediana dos passos
diários seria robusta a um evento de recálculo no meio da série.

```
vendedores hoje sem estimativa (delta ponta-a-ponta < 0) : 59
        resgatados pela mediana dos passos diários       :  4  (7%)
        inalterados                                      : 376
```

**7% não é a maioria.** A hipótese do "reset pontual no meio da série" está **refutada**: para 55
dos 59, o contador desce de forma persistente, não num degrau isolado.

**Conclusão: `sem_estimativa_no_periodo` fica exatamente como está.** A causa do decréscimo
continua desconhecida, e agora sabe-se também que ela **não é** um evento pontual.
