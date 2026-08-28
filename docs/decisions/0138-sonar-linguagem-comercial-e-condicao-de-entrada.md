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
type Barreira =
  | 'nenhuma' | 'topo_nao_confirmado' | 'concorrencia' | 'marca' | 'mercado_apertado' | 'nao_medida';
```

**`Barreira` é função pura dos FATORES, nunca de `nivel`.** Essa é a diferença que importa: a
*Correção 2026-08-20* do ADR-0128 existe porque `nivel === 'baixa'` sequestrava título e ação
quando a causa real era outra. Derivar do `nivel` reintroduziria a mesma classe de bug.

```ts
if (entrada === 'nao_medida')      return 'nao_medida';
if (marca?.nivel === 'ruim')       return 'marca';            // barreira jurídica vence tudo
if (disputa?.nivel === 'ruim')     return 'concorrencia';
if (tracao?.nivel === 'ruim')      return 'mercado_apertado'; // bolo pequeno, topo livre
if (disputa?.caminho === 'anuncio') return 'topo_nao_confirmado'; // teto do caminho B (ADR-0137)
return 'nenhuma';
```

| `Barreira` | Causa | Rótulo na tela |
|---|---|---|
| `nenhuma` | nenhum fator ruim, Disputa medida **por rótulo** | campo aberto |
| `topo_nao_confirmado` | nenhum fator ruim, mas Disputa veio do **caminho B** | topo aparentemente aberto |
| `concorrencia` | Disputa ruim (Full ≥ 60% ou líder concentrado) | concorrência pesada |
| `marca` | Marca ruim (loja oficial > 50%) | risco de marca |
| `mercado_apertado` | Tração ruim com topo livre | mercado apertado |
| `nao_medida` | `parcial` | concorrência não medida |

**`topo_nao_confirmado` — o teto do ADR-0137 vale para o TEXTO, não só para o score.** A errata do
ADR-0137 impediu o caminho B de chegar a "alta" porque a concentração por anúncio *subestima* a
concentração real (sem nome de loja, N anúncios de um dono contam como N rivais). Mas a primeira
versão deste ADR mandava esse caso para `nenhuma`, e o card passava a dizer **"campo aberto"** três
vezes, em verde — enquanto o Saiba mais do mesmo card dizia *"este caminho nunca declara o campo
aberto"*. Território de marca oculto (10 anúncios da mesma marca, ~10% de share cada, Full baixo)
apareceria como campo livre para quem decide compra de estoque olhando o título.

O estado próprio resolve sem tocar em `entrada` nem em `nivel`: rótulo hedgeado, ícone de
interrogação (não cadeado aberto), tom `medio` (nunca `bom`), e o texto manda **conferir quem está
por trás dos anúncios do topo** antes de tratar como campo aberto. Travado por teste
(`o título NUNCA declara campo aberto quando a Disputa veio do caminho B`).

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
| `concorrencia`/`topo_nao_confirmado`, Full ≥ 60% | `100% Full` |
| `concorrencia`/`topo_nao_confirmado`, caminho B | `líder leva 41%` |
| `concorrencia`, caminho A sem Full dominante | `3 concorrentes no topo` |
| `marca` | `loja oficial` |
| `nenhuma`, `mercado_apertado`, `nao_medida` | sem chip |

Nunca `N lojas`: o ADR-0127 registra que o card do ML imprime a **marca**, não o nickname —
contar "lojas" no chip desmentiria a ressalva que o Saiba mais faz duas linhas abaixo. `nao_medida`
não ganha chip porque o título já diz "· concorrência não medida", e o gate de demanda também não:
lá o título é "Sem prova de venda", sem eixo de barreira que sustente um chip de concorrência.

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
| caminho B sem fator ruim | Oportunidade média | Alta demanda · topo aparentemente aberto |
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

A condição é expressa **em percentual, nunca em reais**:

```
Com Full  → iguale o preço do concorrente equivalente ao seu produto — com 95% do topo
            entregando por Full, o prazo empata e a decisão volta pro preço.
Sem Full  → igualar não basta: o comprador escolhe pelo prazo. Avalie entrar 5% abaixo do
            concorrente equivalente para compensar a entrega — e confira na Viabilidade
            se esse desconto ainda fecha sua margem.
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

**Percentual, nunca reais — e por que (regra do operador, 28/08).** Este card só existe na busca
por **termo**, cuja amostra mistura embalagens: "abraçadeira nylon" devolve Kit 500 a R$ 39,90,
Kit 1000 a R$ 77,96 e Kit 50 a R$ 19,06 lado a lado. Um `bata R$ 39,90` seria alvo de prejuízo
para quem for cadastrar outro tamanho de kit — exatamente o erro que a **Errata 1 do ADR-0124**
proíbe (ela matou as faixas de preço do Sonar porque *tercil sobre embalagens diferentes não
descreve nicho nenhum*), reintroduzido justo no card que decide compra de estoque.

Percentual atravessa embalagem: "5% abaixo do equivalente" vale para qualquer kit. Valor absoluto
fica reservado à **consulta por EAN**, onde o produto é um só e a comparação é legítima — e aquela
view (`SonarEanResultado`, `PulseSonar.tsx:981`) é própria e **não usa este card**, então nada aqui
precisa de flag de modo.

**Regras de exibição:**

- Os dois ramos só aparecem quando `fullPct >= DISPUTA_V2.fullMuito` (60%) — sem Full dominante não
  há handicap de prazo a compensar, e o card fica só com o texto de barreira.
- `Barreira === 'marca'` **não mostra condição de preço nenhuma**. Copy: *"X% do topo é loja
  oficial — revender aqui corre risco de moderação por propriedade intelectual. Preço não resolve:
  só entra com autorização de revenda ou marca própria."*
- `gateDemanda` também não mostra: sem prova de compra não há entrada a condicionar.
- Nenhum ramo pode imprimir `R$` — travado por teste.
- O card aponta a Viabilidade para conferir se o desconto ainda fecha a margem.

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
| `concorrencia`, caminho B com líder dominante | Mercado aquecido, mas **um anúncio** concentra a maior parte do faturamento. Entrar exige preço melhor que o dele. |
| `concorrencia`, caminho A por pulverização | Mercado aquecido, mas **poucos concorrentes** dominam o topo. Entrar exige preço melhor que o deles. |
| `topo_nao_confirmado` | Ninguém domina o faturamento pelo que deu para medir — mas os cards não trazem nome de loja, então pode ser um dono só com vários anúncios. Confira antes de comprar volume. |
| `mercado_apertado` | Tem venda, mas o faturamento está diluído — sobra pouco por concorrente. Só compensa com custo baixo. |
| `nenhuma` + `nivel` alta | Venda comprovada e topo ainda aberto. Comece enxuto e valide o giro. |
| `nenhuma` + demais | Dá pra entrar sem briga pesada. Confira preço e frete contra os líderes antes de comprar volume. |

**A causa decide a frase.** Caminho A ruim mede *poucos concorrentes no topo*; caminho B ruim mede
*um anúncio concentrando faturamento*. Usar a segunda frase para o primeiro caso afirmaria um
mecanismo que ninguém mediu — num nicho com 4 rótulos e faturamento uniforme, nenhum anúncio
concentra nada.

O resumo de `alta` diz "venda comprovada", não "demanda comprovada": esse é o rótulo do nível
**médio** de Demanda no §2, e `nivel === 'alta'` é alcançável com Demanda média.

Nenhum resumo e nenhuma ação dizem "não compre" fora do gate de demanda — travado por teste.
O risco de marca **avisa do takedown** ("preço não resolve: só entra com autorização de revenda ou
marca própria") em vez de proibir: a decisão de assumir o risco é do operador, o dado é o aviso.

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
