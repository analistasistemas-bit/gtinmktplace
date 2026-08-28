# ADR-0138 — Sonar: linguagem comercial do veredito e condição de entrada

- **Status:** aceito
- **Data:** 2026-08-28
- **Relacionados:** ADR-0124 (veredito de oportunidade), ADR-0127 (veredito v2 por anúncio),
  ADR-0128 (Demanda e Entrada separadas), ADR-0137 (Disputa caminho B)

## Contexto

O Sonar apresentou o nicho "abraçadeira nylon" como **"Demanda ok · entrada fechada"**, com o
chip `entrada fechada` e a frase *"Mercado aquecido, mas dominado por quem já tem Full — entrar
com estoque grande é nadar contra a maré."*

Diego recusou o texto por três motivos, todos corretos do ponto de vista de quem compra estoque:

1. **"Entrada fechada" é erro de categoria.** Afirma impossibilidade quando o dado mede *custo de
   entrada*. Nenhum nicho do Mercado Livre é fechado a preço — é caro. Um anúncio com preço
   competitivo conquista fatia mesmo num topo dominado.
2. **O vocabulário não é o do comércio.** "Disputa", "Tração", "rótulo de loja", "pulverização",
   "nadar contra a maré" são termos de engenharia e de metáfora, não de quem decide compra.
3. **O app nunca diz o preço.** Toda a informação para calcular o preço a bater já está na tela
   (líder a R$ 39,90, 100% Full), e o veredito termina em *"não compre estoque"* sem nunca
   informar em quanto a entrada seria viável.

Diagnóstico adicional levantado na revisão: o código **já distingue** duas causas de
`entrada === 'fechada'` (Disputa ruim vs. Marca ruim) e as **colapsa numa palavra só**. As duas
são negócios diferentes:

- **Full dominante / líder concentrado** → barreira de **preço e logística**. Superável.
- **Loja oficial > 50%** → barreira **jurídica**: risco de moderação por propriedade intelectual
  (incidente Aquaphor, 2026-08-06). Preço nenhum resolve.

Tratar as duas como "entrada fechada" faz o texto soar burro no primeiro caso e frouxo no segundo.

## Decisão

Mudança **exclusivamente de apresentação**. Nenhum corte de calibração se move; o gabarito
(`scripts/sonar-gabarito-verificar.mjs`) continua valendo sem re-medição.

### 1. `Barreira` derivada — o eixo deixa de ser porta, vira custo

`NivelEntrada` (`aberta` | `fechada` | `nao_medida`) **permanece** como estado interno e sai da
interface. A tela passa a ler uma derivação:

```ts
type Barreira = 'nenhuma' | 'concorrencia' | 'marca' | 'mercado_apertado' | 'nao_medida';
```

**`Barreira` é função pura dos FATORES, nunca de `nivel`.** Essa é a diferença que importa: a
*Correção 2026-08-20* do ADR-0128 existe porque `nivel === 'baixa'` sequestrava título e ação
quando a causa real era outra. Derivar do `nivel` reintroduziria a mesma classe de bug.

```ts
if (entrada === 'nao_medida')     return 'nao_medida';
if (marca?.nivel === 'ruim')      return 'marca';            // barreira jurídica vence tudo
if (disputa?.nivel === 'ruim')    return 'concorrencia';
if (tracao?.nivel === 'ruim')     return 'mercado_apertado'; // bolo pequeno, topo livre
return 'nenhuma';
```

| `Barreira` | Causa | Rótulo na tela |
|---|---|---|
| `nenhuma` | nenhum fator ruim | campo aberto |
| `concorrencia` | Disputa ruim (Full ≥ 60% ou líder concentrado) | concorrência pesada |
| `marca` | Marca ruim (loja oficial > 50%) | risco de marca |
| `mercado_apertado` | Tração ruim com topo livre | mercado apertado |
| `nao_medida` | `parcial` | concorrência não medida |

Consistência com o ADR-0128: `entrada === 'fechada'` ⟺ `Barreira ∈ {concorrencia, marca}`;
`mercado_apertado` é subcaso de `entrada === 'aberta'`. `entrada` **não muda** — segue governando
o composite `nivel` como está.

**Inversão deliberada de prioridade:** hoje `resumoVeredito` resolve Full **antes** de marca.
A partir daqui **marca ruim vence sempre**, mesmo com Full dominante junto. Motivo: a recomendação
de preço (§3) é inválida sob risco de moderação — nenhum desconto evita um anúncio derrubado por
propriedade intelectual. A barreira mais cara tem de ser a que aparece.

A palavra **"fechada" nunca é impressa**. Fica como nome de estado interno significando
"barreira detectada".

### 1b. Chip: evidência, não estado

`LABEL_ENTRADA` (mapa estado → rótulo) morre. O chip ao lado do título passa a carregar o **número
que sustenta a barreira**, porque o estado já está escrito no próprio título:

| `Barreira` | Chip |
|---|---|
| `concorrencia`, Full ≥ 60% | `100% Full` |
| `concorrencia`, líder concentrado | `líder leva 41%` |
| `marca` | `loja oficial` |
| `nao_medida` | `não medida` |
| `nenhuma`, `mercado_apertado` | sem chip |

Badge `avaliação parcial` permanece como está.

### 2. Gramática única de título e dicionário comercial

Some `Oportunidade alta/média/baixa` do título — em **todos** os casos, inclusive entrada aberta.
`nivel` continua existindo e continua governando a **cor** do card (verde/amarelo/vermelho).
Título passa a ser sempre `<Demanda> · <Barreira>`:

| Situação | Antes | Depois |
|---|---|---|
| demanda ruim (gate) | Oportunidade baixa | Sem prova de venda |
| aberta + alta | Oportunidade alta | Alta demanda · campo aberto |
| aberta + média | Oportunidade média | Demanda comprovada · campo aberto |
| aberta + baixa | Oportunidade baixa | Demanda comprovada · mercado apertado |
| concorrência + demanda bom | Demanda forte · entrada fechada | Alta demanda · concorrência pesada |
| concorrência + demanda medio | Demanda ok · entrada fechada | Demanda comprovada · concorrência pesada |
| marca + demanda bom | Demanda forte · entrada fechada | Alta demanda · risco de marca |
| não medida + demanda bom | Demanda forte · concorrência não medida | Alta demanda · concorrência não medida |
| não medida + demanda medio | Demanda ok · concorrência não medida | Demanda comprovada · concorrência não medida |

Níveis de Demanda renomeados **sem mexer nos cortes do ADR-0124** (`liquidezBoa` 0,70,
`vendasBoas` 5.000, `liquidezRuim` 0,30, `vendasMinimas` 1.000):

| Nível | Antes | Depois |
|---|---|---|
| `bom` | Demanda forte | Alta demanda |
| `medio` | Demanda ok | Demanda comprovada |
| `ruim` | (gate) | Sem prova de venda |

Rótulos dos fatores:

| Antes | Depois |
|---|---|
| Disputa | Concorrência |
| Tração | Faturamento por concorrente |
| "rótulo de loja" | "concorrente" |
| "pulverização 0,85" | (sai do facial; permanece no Saiba mais) |

**"concorrente", não "vendedor".** O ADR-0127 registra que o card do ML imprime a **marca**, não o
nickname (EUCERIN devolve 2 rótulos em 20 anúncios). "Vendedor" afirmaria conta de loja e
subestimaria o número de rivais em nicho de marca. "Concorrente" é comercial sem fazer essa
afirmação. A ressalva técnica desce para o "Saiba mais": *"o Mercado Livre mostra a marca no card,
não a loja — duas lojas da mesma marca contam como uma."*

### 3. Condição de entrada com preço — dois ramos por Full

O `insightEntrada` deixa de ser `Entrada fechada / Para destravar: com Full abaixo de 60%…` e vira
**"Como entrar neste nicho"**. Motivo: "para destravar" é conselho inexecutável — manda esperar o
mercado mudar sozinho — e já está **duplicado** por fator dentro do "Saiba mais"
(`veredito-sonar.tsx:316`), onde permanece. Nenhuma informação é perdida; o adendo do ADR-0124
(explicar o que abriria o nicho) segue cumprido, só deixa de ser manchete.

Preço de referência: **preço do líder por faturamento** (`rivaisPodio[0].preco`).

```
Com Full  → bata R$ 39,90 (líder, +10.000 vendidos).
Sem Full  → avalie R$ 37,90 (5% abaixo) para compensar o prazo de entrega.
```

**Por que dois ramos.** Empatar preço com um concorrente Full sendo não-Full não empata a disputa:
o comprador decide pelo prazo antes de decidir pelo preço. O desconto compensa o handicap
logístico e devolve a chance de escolha.

```ts
/** Handicap de preço para quem NÃO opera por Full, quando o topo do nicho é majoritariamente
 *  Full. HEURÍSTICA COMERCIAL do operador (28/08) — NÃO medida contra gabarito, ao contrário de
 *  DISPUTA_V2/TRACAO_V2/DEMANDA. Recalibrar com venda real, nunca com opinião. */
const HANDICAP_NAO_FULL = 0.05;
```

Escolha explícita contra escalar o desconto pelo `% Full`: seria uma curva que ninguém mediu, e
este arquivo é construído sobre a regra de não imprimir número sem lastro. Precisão falsa engana
mais que número redondo declarado como heurística.

**Regras de exibição:**

- Ramo "Sem Full" só aparece quando `fullPct >= DISPUTA_V2.fullMuito` (60%) — é onde o handicap
  existe de verdade.
- `Barreira === 'marca'` **não mostra preço nenhum**. Copy: *"X% do topo é loja oficial —
  revender aqui corre risco de moderação por propriedade intelectual. Preço não resolve: só entra
  com autorização de revenda ou marca própria."*
- Sem `rivaisPodio[0].preco` → só o texto qualitativo, sem número inventado.
- O card aponta a Viabilidade para conferir se o preço-alvo fecha a margem.

### 4. Ação deixa de ser ordem

`acaoVeredito` sai de *"**Não compre estoque neste nicho.**"* e passa a enunciar a condição:
*"Para entrar aqui, X e Y precisam ser verdade."* O gate de demanda (`gateDemanda`) é a **única**
exceção que mantém tom imperativo — sem prova de compra não há preço que resolva.

### 5. `resumoVeredito` — a caixa colorida, reescrita por `Barreira`

Esta é a frase do print (*"…entrar com estoque grande é nadar contra a maré"*) e a que mais
contradiz o card novo: sem reescrevê-la, a tela anunciaria "Como entrar neste nicho: bata
R$ 39,90" e, ao lado, mandaria não entrar. O eixo passa a ser `Barreira`, não `entrada`:

| Situação | Resumo |
|---|---|
| `gateDemanda` | Poucas provas de venda por aqui — teste antes de comprar estoque. |
| `nao_medida` | Tem gente comprando, mas não deu pra medir quem já ocupa o topo — vá com cautela, sem volume. |
| `marca` | A loja oficial domina o topo. O risco aqui não é preço, é ter o anúncio derrubado por propriedade intelectual. |
| `concorrencia`, Full dominante | Mercado aquecido e disputado no prazo: todo o topo entrega por Full. Dá pra entrar, mas o preço tem que compensar a entrega. |
| `concorrencia`, líder concentrado | Mercado aquecido, mas um anúncio concentra a maior parte do faturamento. Entrar exige preço melhor que o dele. |
| `mercado_apertado` | Tem venda, mas o faturamento está diluído — sobra pouco por concorrente. Só compensa com custo baixo. |
| `nenhuma` + `nivel` alta | Demanda comprovada e topo ainda aberto. Comece enxuto e valide o giro. |
| `nenhuma` + demais | Dá pra entrar sem briga pesada. Confira preço e frete contra os líderes antes de comprar volume. |

Nenhum resumo diz "não compre" fora do gate de demanda e do risco de marca — as duas únicas
situações em que preço não resolve.

### 6. `motivo` (subtítulo) é removido

Sob a gramática de dois eixos o subtítulo vira redundância pura: *"Concorrência alta demais para o
tamanho do mercado"* embaixo de *"Demanda comprovada · concorrência pesada"* repete o título com
outras palavras, e a caixa de resumo (§5) já faz a leitura. `montarMotivoAnuncios` e o campo
`VereditoAnuncios.motivo` são deletados; único consumidor era `veredito-sonar.tsx:191`.

## Consequências

- Nenhum corte se move. `sonar-gabarito-verificar.mjs` e os testes de faixa continuam válidos sem
  re-medição; os testes de **texto** em `__tests__/veredito-sonar.test.ts` mudam junto.
- `HANDICAP_NAO_FULL` é a **primeira constante não medida** do arquivo. Fica marcada como tal, ao
  lado das medidas, para não ser confundida com calibração em revisão futura.
- ADR-0128 §3 (tabela de títulos) e §6 (tabela de ações) ficam **substituídos** por §2 e §4 deste
  ADR. O restante do 0128 (gate de demanda, campo `entrada`, composite `nivel`, fantasmas no
  pódio) permanece intacto.
- Risco assumido: some do título a palavra que sinalizava "compre" (`Oportunidade alta`). Mitigado
  pela cor do card, inalterada, e pelo texto de ação, que passa a carregar a recomendação
  explícita.
