# Título no padrão Mercado Livre — design

**Data:** 2026-08-02
**Escopo:** geração do título do anúncio (`copywriter-prompt.ts`, `titulo.ts`, `copywriter.ts`)
**Relacionado:** ADR-0098 (copy ancorada na fonte), ADR-0054 (tipo_produto_busca), ADR-0030 (gerarCopy sem fallback), ADR-0074 (modelo por org)

---

## 1. Problema, medido

Censo de **143 títulos gerados por IA** em produção (`familias.titulo_ml`, excluídos os 24
editados pelo operador — 14% do total de 167).

| Defeito | Incidência |
|---|---|
| Termina em adjetivo vazio | **35%** (50/143), gastando **16,6 chars** em média |
| Separador `\|` | 94% |
| Unidade não canônica (`MT`, `MTS`, `UND`, `GR`) | 52% |
| Palavra/marca sem acento (`BUFALO`, `LAPIS`, `CLEA`, `INGLES`, `POLIESTER`) | 14% |
| Abreviação de planilha (`C/`, `S/`, `P/`) | 3% |
| Título idêntico ao de outro produto distinto | 1 grupo |

Os 35% vêm da comparação contra a lista fechada de adjetivos efetivamente observados (§4, T3).
Uma medida mais frouxa — "cauda sem nenhum dígito" — dá 51%, mas conta `\| BRANCO` como
defeito, e cor é dado legítimo. **35% é o número defensável e é o alvo.**

Caudas mais frequentes: `100% POLIÉSTER` (31×, **legítima** — é composição ancorada),
`ELEGANTE` (8×), `ALTA RESISTÊNCIA` (7×), `QUALIDADE PREMIUM` (4×), `RESISTENTE` (4×),
`SECAGEM LIMPA` (4×), `VERSÁTIL` (3×), `CONFORTO E CONTROLE` (2×), `ALTA DURABILIDADE` (2×),
`TOQUE MACIO` (2×).

O defeito não é o terceiro segmento; é o segmento **sem dado**.

### Causa

O prompt **prescreve** o slot vazio e ensina como preenchê-lo:

```
- Formato: `MARCA MODELO MEDIDA | CARACTERÍSTICA PRINCIPAL | DIFERENCIAL`
- Exemplo: `FITA CETIM PROGRESSO N.1 100MT | 100% POLIÉSTER | RESISTENTE`
```

É a Causa C do ADR-0098 repetida: **exemplo few-shot vence regra declarada**. `QUALIDADE
PREMIUM` e `ALTA RESISTÊNCIA` são exatamente os superlativos que o ADR-0098 baniu da
descrição — o título ficou de fora daquela limpeza.

### Dois defeitos estruturais adjacentes

**Divergência entre call sites.** Os guards de título são compostos à mão em três lugares e
por isso divergem:

| Call site | Guards |
|---|---|
| `process-familia/index.ts:450` | 7 (cadeia completa) |
| `regenerar-copy-familia/index.ts:66` | 6 — **sem `garantirQuantidadeTitulo`** |
| `_shared/split/titulo-particao.ts:58` | 5 — **sem largura nem quantidade** |

Regenerar um título perde a garantia de quantidade em silêncio. É o mesmo defeito que o
`posProcessarDescricao` corrigiu do lado da descrição, ainda não corrigido do lado do título.

**Injeção e corte na mesma ponta.** Os guards injetam em `partes[0]` e o `clampTitulo` derruba
segmentos do fim. Com o pipe, são pontas opostas. **Sem o pipe, são a mesma ponta** — o clamp
comeria o dado que o guard acabou de injetar, sem erro visível. Mesma classe do bug de ordem
`removerPerguntasIncompletas` × `garantirLarguraDescricao` já corrigido no ADR-0098.

---

## 2. Alcance real da mudança

**`title` só é enviado ao ML no CREATE** (`_shared/ml/publicar.ts:207`). O `atualizarItemML`
(`_shared/ml/atualizar-item.ts:87`) monta o corpo do PUT com `variations`, `attributes` e
`pictures` — nunca `title`. E `regenerar-copy-familia` grava só em `familias`.

Consequência: **título de anúncio já publicado nunca é atualizado pelo PubliAI.**

- Anúncios novos adotam o formato novo automaticamente.
- Os 167 títulos já publicados ficam como estão. Raio de alcance zero sobre anúncios vivos.
- Corrigir título publicado exige um caminho que hoje não existe. **Fora de escopo.**

---

## 3. Arquitetura

Três camadas, separadas pelo que cada uma consegue garantir.

```
IA          → escolhe o conteúdo de cada slot (T1–T7)
montarTitulo→ ordena, reduz e corta por prioridade, respeitando 60 chars
guards      → garantem os fatos críticos (metragem, largura, cor, quantidade, marca, unidade)
posProcessarTitulo → composição única, elimina a divergência dos 3 call sites
```

### 3.1 Mudança de contrato: a IA devolve slots, não uma string

Hoje `gerarCopy` devolve `{ titulo: string, descricao, tipo_produto_busca }`. O montador por
slots só funciona se receber os slots; decompor um título plano de volta em slots por regex
seria adivinhação.

`json_schema` do copywriter passa a exigir:

```ts
titulo_slots: {
  produto: string;          // obrigatório
  marca?: string;
  modelo?: string;          // numeração, linha, referência do consumidor
  medida?: string;
  quantidade?: string;
  material?: string;
  variacao?: string;        // cor ou tamanho
  compatibilidade?: string;
  aplicacao?: string;
  sinonimo?: string;
}
```

`familias.titulo_ml` continua sendo `string` — os slots são um artefato intermediário, montado
e descartado. Nenhuma migration.

**Não existe slot `extra`.** Um slot genérico misturaria compatibilidade, aplicação, sinônimo e
composição secundária, que têm prioridades de corte diferentes — o corte deixaria de ser
auditável. Slots vazios são normais e esperados.

### 3.2 Ordem de leitura ≠ ordem de corte

São dois contratos distintos, e confundi-los é o que quebra a unicidade entre famílias irmãs.

**Ordem de leitura** (posição no texto final):

```
produto → marca → modelo → medida → quantidade → material → variacao → compatibilidade → aplicacao → sinonimo
```

**Ordem de corte** (quem sai primeiro quando estoura 60), a hierarquia do documento invertida:

```
sinonimo → aplicacao → compatibilidade → variacao → material → quantidade → medida → modelo → marca → produto
```

**Dois slots são incortáveis, e isso é um desvio deliberado da hierarquia plana:**

- **`medida`, sempre que existir.** `10m` e `100m` são produtos distintos, assim como `1kg` e
  `500g`. É a razão de existir do `garantirMetragemTitulo`, cujo comentário registra que a IA
  descarta a metragem sob o teto de 60 chars mesmo com o dado no nome. O prompt em produção já
  crava `MEDIDA > MARCA`. O documento do padrão ML põe marca (#2) acima de medida (#4); aqui a
  prática vence, porque perder a medida funde dois produtos diferentes num título só.
- **`variacao`, quando `nCores === 1`.** Nesse caso a cor é o único dado que distingue duas
  famílias irmãs, e perdê-la produz títulos idênticos — o `garantirCorTitulo` existe porque o
  ML derrubou o segundo anúncio como duplicado.

A proteção altera só a ordem de corte; a posição de leitura não muda. Dentro do conjunto
cortável, a regra "nenhum slot de prioridade maior sai enquanto existir um de menor" vale
integralmente.

### 3.3 Redução antes de remoção

Ao estourar 60, o montador **primeiro reduz**, depois remove. Reduções são determinísticas e
específicas por slot — nunca um clamp genérico por caractere:

| Slot | Forma longa | Forma reduzida |
|---|---|---|
| `medida` | `10 Metros` | `10m` |
| `medida` | `1,80 Metros de Largura` | `1,80m` |
| `material` | `100% Poliéster` | `Poliéster` |
| `modelo` | `Número 6` | `N.6` |
| `quantidade` | `10 Unidades` | `10un` |

Esgotadas as reduções, remove slots inteiros na ordem de corte. **Nunca trunca no meio de um
token.**

```
Tecido Helanca Light 10m 1,80m Poliéster Preto Para Forro   ← cabe
Tecido Helanca Light 10m 1,80m Poliéster Preto              ← removeu `aplicacao`
Tecido Helanca Light 10m 1,80m Poliéster Preto Para Fo      ← PROIBIDO
```

### 3.4 `posProcessarTitulo`

Composição única, chamada pelos três call sites. Substitui as três cadeias divergentes.
Recebe os slots da IA e os dados da fonte; devolve a string final.

---

## 4. Regras do prompt (T1–T7)

Substituem integralmente o bloco `TÍTULO` do `SYSTEM`.

**T1 — Ordem.** Produto → Marca → Modelo/numeração → Medida → Quantidade → Material →
Variação → Compatibilidade → Aplicação → Sinônimo. Nem todo slot se aplica a todo produto;
slot sem dado na fonte fica vazio.

**T2 — Sem separador.** Texto corrido. Proibidos `|`, `★`, `!!!`, `[...]`, e qualquer caractere
decorativo. Proibido emoji.

**T3 — Proibido adjetivo sem dado.** Lista fechada dos reincidentes medidos em produção:
`elegante`, `versátil`, `resistente`, `super resistente`, `alta resistência`, `alta
durabilidade`, `qualidade premium`, `alta qualidade`, `qualidade superior`, `toque macio`,
`conforto e controle`, `secagem limpa`, `adesão firme`, `uso profissional`, `alta performance`,
`excelente qualidade`, `melhor`, `imperdível`, `promoção`, `oferta`, `pronta entrega`, `envio
rápido`, `compre agora`.

Também proibidos no título: dados de contato, telefone e nome da loja (`Avil`, `DS`).

Estas expressões são proibidas **em termos absolutos**, mesmo quando a fonte as contém. O
sistema não consegue hoje rastrear a origem por campo — a fonte é um blob de texto —, então não
há como distinguir "alta resistência declarada pelo fabricante como atributo técnico" de "alta
resistência inventada pelo modelo". Na dúvida, a proibição absoluta é o comportamento seguro, e
é coerente com a regra que o ADR-0098 já aplica à descrição (superlativo vindo da fonte é
removido, não reproduzido).

**T4 — Expandir o dialeto de planilha.** O comprador não busca por abreviação de estoque:
`C/` → com, `S/` → sem, `P/` → para, `NIQ` → niquelado, `AG` → agulha, `HEXAG` → hexagonal,
`ESP.` → especial, `BCO` → branco, `DESL` → deslize. Ruído sem valor é descartado, não
traduzido: `TAM UND`, `TAM VR`, `C VAR`, `CORES` (quando significa apenas "há variação").

**T5 — Proibido código interno.** Referências de estoque não são buscadas por ninguém:
`T-007`, `BAR-03-VR`, `REF.275`, `GRD 7`, e código de cor solto (`610` em `LINHA ESP.
P/RENASCENCA COR 610 BEGE`). Numeração que o **consumidor** usa para escolher (`N.3`, `Nº 6`,
`Tex 29`, `4/6`) é modelo legítimo e permanece.

**T6 — Completude acima de ocupação.**

> O título não deve tentar preencher os 60 caracteres. Depois de incluir todos os dados
> relevantes e comprovados, encerre o título. Um título curto, preciso e completo é superior a
> um título longo preenchido com adjetivos, aplicações genéricas, sinônimos fracos ou
> expressões promocionais. **Espaço restante não é motivo para adicionar palavras.**

T3 e T6 cumprem funções diferentes e ambas são necessárias. **T3 é controle lexical** — bloqueia
reincidentes conhecidos. **T6 é controle de objetivo** — impede a criação da expressão na
origem. Sem T6, proibir `toque macio` faz o modelo escrever `sensação suave`, e a lista negra
vira uma corrida sem fim. Ampliar o vocabulário proibido indefinidamente não resolve; remover a
meta de preenchimento resolve.

**T7 — Sinônimo secundário restrito.** Só pode ser usado quando estiver **presente na fonte**.
É proibido o modelo criar sinônimo por conta própria. Permitido: `helanca light` → `helanquinha`
(quando "helanquinha" consta na fonte). Proibido: `barbante` → `cordão`, `linha` → `fio`,
`tecido` → `malha` — esses trocam a identidade técnica do produto. Proibido empilhar
palavra-chave (`Barbante Fio Cordão Linha Artesanato Crochê`).

### Few-shots

Dois exemplos curtos, não um longo. O primeiro ensina o formato; o segundo ensina que **terminar
com bastante espaço livre é aceitável**.

```
Fonte: Produto: Barbante · Marca: Bandeirante · Modelo: 4/6 · Metragem: 570 m · Composição: 85% algodão
CORRETO:  Barbante Bandeirante 4/6 570m 85% Algodão            (41 chars)
ERRADO:   Barbante Bandeirante 4/6 570m 85% Algodão Resistente Premium

Fonte: Produto: Agulha de Crochê · Marca: Círculo · Medida: 3,5 mm · Material: Alumínio
CORRETO:  Agulha de Crochê Círculo 3,5mm Alumínio              (39 chars)
ERRADO:   Agulha de Crochê Círculo 3,5mm Alumínio Confortável Versátil Profissional
```

Nenhum exemplo do prompt pode conter adjetivo no fim — é o mecanismo que criou o problema atual.

---

## 5. Guards determinísticos

### 5.1 Unidade canônica

`normalizarUnidade` (`titulo.ts:17`) hoje **emite `MT` ativamente**. Passa a emitir `m`.

`extrairMetragem` é consumido também por `garantirMetragemDescricao`, do lado da descrição —
a mudança precisa de teste que confirme que a descrição não regride (o bullet
`• Metragem: 100m` é aceitável; sumir não é).

Formas canônicas: `570m`, `500g`, `10kg`, `2l`, `6mm`, `3,5cm`, `10un`. Nunca `570mt`, `500gr`,
`10 kilos`, `1000UND`.

### 5.2 Title Case

**É geração, não transformação.** A entrada é toda em CAPS (`FITA CETIM BUFALO N.3 16MM CORES
10MT`), então não há capitalização original a preservar. Unidade testada com regras explícitas:

- Preposições e artigos em minúscula, exceto na primeira palavra: `de`, `da`, `do`, `das`,
  `dos`, `e`, `em`, `com`, `sem`, `para`, `por`, `a`, `o`
- Tokens de unidade em minúscula após a canonicalização: `100m`, `6mm`, `500g`, `10un`
- Siglas em caixa alta, lista fechada: `PVC`, `EVA`, `MDF`, `MDP`, `FPS`, `LED`, `ABS`, `PET`
- `NN%` seguido de palavra em Title Case: `100% Poliéster`, `85% Algodão`
- Marca soletrada pelo mapa (§5.3), não pelo Title Case genérico
- `Tex 29`, não `TEX 29` — sigla não é lista aberta

`N.3` **não** é normalizado para `Nº 3`. O catálogo tem `N.0`, `N.02`, `N.07`, `N.12`; os zeros
à esquerda são artefato de planilha, mas é plausível que o comprador busque a forma da fonte.
Manter a forma da fonte é a escolha conservadora.

### 5.3 Mapa de marcas

`familias.fornecedor` é **razão social truncada em 30 chars**, não marca. Derivar a marca por
heurística não funciona — medido: o primeiro token útil produz `"BARBANTE"` para
`FABRICA DE BARBANTE BANDEIRANT`, `"V"` para `V.R.MACHADO SILK SREEN EM GERA`, `"BR17-COATS"`
para `BR17-COATS CORRENTE LTDA` e `"LINHAS"` para `LINHAS SETTA LTDA`.

O mapa é **curado à mão** e chaveado na string **como está gravada** (truncada), porque essa
forma é estável:

```ts
const MARCAS: Record<string, string | null> = {
  'BUFALO': 'Búfalo',
  'CIRCULO S.A.': 'Círculo',
  'DETALLIA FITAS TEXTEIS LTDA': 'Detallia',
  'ECOFIBRA INDUSTRIA TEXTIL': 'Ecofibra',
  'TRINITY': 'Trinity',
  'FABRICA DE BARBANTE BANDEIRANT': 'Bandeirante',
  'LINHANYL S/A': 'Linhanyl',
  'BR17-COATS CORRENTE LTDA': 'Corrente',
  'LINHAS SETTA LTDA': 'Setta',
  'FISCHER COMERCIO DE PRODUTOS P': 'Fischer',
  'Eucerin': 'Eucerin',
  // Sem marca comercial identificável na razão social — nunca vira marca:
  'V.R.MACHADO SILK SREEN EM GERA': null,
  'S.PROCHOWNIK COMERCIAL LTDA': null,
  // Nome da loja gravado como fornecedor. Bloqueio explícito:
  'AVIL': null,
};
```

**O mapa fornece a grafia; a fonte fornece a permissão.** A marca só entra no título se aparecer
em `nome_pai` ou `descricao_pai` (comparação com acento normalizado), espelhando
`validarTipoProdutoBusca`. Sem isso o sistema estaria afirmando uma marca a partir de um campo de
fornecedor — precisamente o que o padrão do ML proíbe ("não invente marca, não use nome da loja").

Fornecedor fora do mapa não bloqueia nada: a marca que a IA extraiu da fonte segue o caminho
normal, e o Title Case genérico cuida da grafia.

**Cobertura de marca é parcial e assim permanece.** Medido sobre 166 famílias com fornecedor:

| Fornecedor | Famílias | Marca ancorada na fonte |
|---|---|---|
| BUFALO | 109 | 74 (68%) |
| CIRCULO S.A. | 17 | 9 (53%) |
| DETALLIA FITAS TEXTEIS LTDA | 15 | 0 |
| ECOFIBRA INDUSTRIA TEXTIL | 5 | 0 |
| TRINITY | 5 | 0 |
| LINHANYL S/A | 2 | 2 |
| Eucerin | 1 | 1 |

Para cerca de metade do catálogo a marca **não existe na fonte** e o título corretamente não a
terá. O elemento #2 do padrão é best-effort, não garantido. Preenchê-lo à força seria invenção.

### 5.4 Emissão em caixa alta

Seis sites emitem CAPS e precisam mudar sob Title Case. Se qualquer um escapar, um guard
reinjeta `BRANCO` num título Title Case:

| Site | Emissão |
|---|---|
| `garantirTipoProdutoTitulo:263` | `${tipo.toUpperCase()} ${titulo}` |
| `garantirTipoFioTitulo:307` | `declarado`, vindo em CAPS de `tipoFioDeclaradoNoNome:290` |
| `garantirCorTitulo:324` | `corLimpa.toUpperCase()` |
| `garantirLarguraTitulo:353` | `largura.toUpperCase()` — transforma `6mm` em `6MM` |
| `extrairContagem:113` | `'PEÇAS'` / `'UNIDADES'` literais |
| `normalizarUnidade:17` | `'MT'` / `'M'` literais |

O lado da **detecção** não muda: os regexes carregam `/i` e `normalizarBusca`/`normalizarToken`
normalizam os dois lados.

---

## 6. Critérios de aceite

### Asserções duras (falham o build, não viram percentual)

1. **Todo dado garantido sobrevive** à montagem por slots: metragem, largura, cor e quantidade.
   É a regressão que o refactor arrisca e a mesma classe de perda silenciosa já vista no ADR-0098.
2. **Nenhum token truncado no meio.** Todo token do título final existe íntegro na entrada ou na
   tabela de reduções.
3. **Nenhum slot de prioridade maior é removido enquanto existir slot de prioridade menor.**
4. **`variacao` sobrevive aos 60 chars quando `nCores === 1`** — é o que separa famílias irmãs.
5. **Nome da loja nunca aparece no título:** `Avil`, `DS`, e o fornecedor `AVIL`.
6. **Nenhum `|` no título.**

### Experimento A/B

Baseline grátis, como no ADR-0098: `familias.titulo_ml` já gravado, filtrado por
`not titulo_editado_pelo_operador`. Não re-executa o prompt antigo (ele deixa de existir na
árvore).

Medido sobre os 143 títulos de IA (n=138 para marca, as famílias cujo fornecedor está no mapa):

| Métrica | Baseline | Alvo |
|---|---|---|
| % que termina **sem** informação artificial | 65% | ~100% |
| % unidade canônica | 48% | 100% |
| % com `\|` | 0% após a mudança | 0% (baseline 94%) |
| % marca presente **e** ancorada | 36% | ≥ 36% |
| % marca no título **sem** ancoragem | 0% | 0% |
| Média de caracteres | 50,8 | reportada, não otimizada |
| Colisão de título entre famílias irmãs | 1 | 0 |

A linha `% marca no título sem ancoragem` merece registro: nas 49 famílias em que a marca
aparece no título, **as 49 estão ancoradas na fonte**. A regra anti-invenção já funciona para
marca e a mudança não pode regredir isso — daí o alvo ser 0%, não "baixo".

**Ocupação maior não é sucesso.** Um título de 44 chars pode ser melhor que um de 59; a média de
caracteres é reportada, não otimizada. A métrica principal é: *percentual de títulos que contêm
todos os campos prioritários disponíveis, sem conteúdo não ancorado.*

---

## 7. Fora de escopo

- **Corrigir os 167 títulos já publicados.** Não existe caminho no sistema (§2) e títulos são o
  que a moderação do ML usa para detectar duplicado. Decisão do Diego levantar, se quiser.
- **Conflito `nome_pai` × `descricao_pai`.** A família `FITAS DE VELUDO 20MM CORES C/25MTS` tem
  `descricao_pai` descrevendo **velcro** ("O VELCRO BÚFALO DE 20MM É A SOLUÇÃO IDEAL..."), e a IA
  obedeceu a descrição, gerando `FITA VELCRO`. Resolver isso muda a definição de "fonte de
  verdade" e alcança muito além do título. O `garantirTipoFioTitulo` já tem o precedente de
  `nome_pai` vencer na identidade do produto — é a extensão natural, num passo separado.
- **Dicionário de sinônimos de busca por categoria.** T7 restringe o sinônimo ao que está na
  fonte. Um dicionário validado por dados de busca é uma evolução posterior.
