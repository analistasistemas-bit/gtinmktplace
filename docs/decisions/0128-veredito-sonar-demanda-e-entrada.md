# ADR-0128 — Veredito Sonar: Demanda e Entrada separadas

- **Status:** aceito
- **Data:** 2026-08-20
- **Relacionados:** ADR-0124 (veredito de oportunidade), ADR-0127 (veredito v2 sobre anúncios)

## Contexto

O Sonar mostrou Aptamil como "Oportunidade média" porque a cobertura de rótulo de loja era 2/20
(trava D10 → veredito parcial). A demanda era forte (≈75% dos anúncios vendem, ~204k vendas). O
título único misturava duas perguntas:

1. **Demanda** — "vende neste nicho?"
2. **Entrada** — "dá para eu entrar?"

Diego compra estoque a partir deste veredito. Um falso "média" esconde demanda forte; um falso
"alta" empurra volume numa marca travada (laboratório/fórmula com loja oficial). As perguntas
precisam aparecer separadas.

## Decisão

### 1. Gate absoluto de demanda (inalterado)

`demanda === 'ruim'` → `nivel === 'baixa'`, título **"Oportunidade baixa"**. Não compre estoque.

### 2. Campo `entrada: NivelEntrada`

| Valor | Quando |
|---|---|
| `nao_medida` | cobertura &lt; 50% **ou** Full não medido (`parcial`) |
| `fechada` | concorrência medida **e** (Disputa ruim **ou** Marca ruim) |
| `aberta` | concorrência medida **e** Disputa não ruim **e** Marca não ruim |

Nunca declarar "Oportunidade alta" com `entrada !== 'aberta'`. `entrada === 'nao_medida'` **não**
usa o título "Oportunidade média".

### 3. Títulos

| Condição | `titulo` |
|---|---|
| demanda ruim / `nivel` baixa | Oportunidade baixa |
| `entrada` nao_medida + demanda bom | Demanda forte · concorrência não medida |
| `entrada` nao_medida + demanda medio | Demanda ok · concorrência não medida |
| `entrada` fechada + demanda bom | Demanda forte · entrada fechada |
| `entrada` fechada + demanda medio | Demanda ok · entrada fechada |
| `nivel` alta | Oportunidade alta |
| demais (`media` + entrada aberta) | Oportunidade média |

Badge `avaliação parcial` permanece quando `parcial`. Chip adicional de Entrada:
`entrada aberta` | `entrada fechada` | `concorrência não medida`.

### 4. Composite `nivel` (gabarito intacto)

Pontuação Demanda/Disputa/Tração igual ADR-0124/0127. Mudança única:

- `alta` exige também `entrada === 'aberta'` (marca ruim não pode ser alta).
- Mantém: `!parcial`, `fatores.length >= PISO_FATORES_ALTA`, `soma >= maximo - 1`.
- Mantém: demanda ruim **ou** `soma <= maximo/3` → baixa; senão media.

Gabarito: eucerin-protetor-solar = media, protetor-solar-facial = media,
tecido-oxford-10-metros = alta. Cobertura oxford exatamente 0,50 continua passando a trava D10.

Cortes `DISPUTA_V2` / `DEMANDA` / `COBERTURA_MINIMA` **não** mudam.

### 5. Fantasmas no pódio, não na pulverização

Anúncios com `vendedor == null` **não** entram em `subamostraNomeada` (fórmula de pulverização
inalterada). Eles **são** rivais por listing: `rivaisPodio` lista o top 5 por
`vendidos × preco` (inclui sem rótulo). No "Saiba mais", se houver fantasma: *"Anúncio sem rótulo
de loja ainda é rival — o líder sem nome não some da briga."*

### 6. Ação / estoque

| Situação | Ação |
|---|---|
| demanda baixa | não compre estoque |
| `entrada` nao_medida ou fechada | no máximo anúncio-teste mínimo, nunca volume |
| `entrada` aberta + alta | estoque ainda conservador |

Marca **não** pontua Demanda; marca ruim **fecha** Entrada. Sem classificador NLP de marca de
laboratório — o copy de `nao_medida` orienta: *"se for marca de laboratório/fórmula, trate como
entrada fechada até conferir loja oficial"*.

## Consequências

- Operador vê demanda forte mesmo quando a concorrência não pôde ser medida (caso Aptamil).
- "Oportunidade alta" só com entrada aberta e dado completo.
- Gabarito e cortes sagrados preservados; só títulos / `entrada` / rivais / gate de alta mudam.

## Implementação

- `src/lib/veredito-sonar.ts` — `calcularVereditoAnuncios`, `rivaisPodio`, tipos `NivelEntrada` /
  `RivalPodio`
- `src/components/pulse/veredito-sonar.tsx` — chip de entrada + pódio no Saiba mais
- Testes em `src/lib/__tests__/veredito-sonar.test.ts`; gabarito via
  `scripts/sonar-gabarito-verificar.mjs` (asserta `nivel`, não `titulo`)
