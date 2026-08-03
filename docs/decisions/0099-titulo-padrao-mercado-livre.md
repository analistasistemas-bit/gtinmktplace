# ADR-0099 — Título de anúncio no padrão Mercado Livre (contrato de slots)

**Status:** Aceito
**Data:** 2026-08-02
**Decisores:** Diego
**Relacionado:** ADR-0098 (copy ancorada na fonte — mesma causa raiz, mesmo princípio de exemplo few-shot vs. regra declarada); ADR-0054 (`tipo_produto_busca`); ADR-0030 (`gerarCopy` é a única etapa de IA sem fallback resiliente); ADR-0074 (modelo de IA por organização)

## Contexto

Censo de **143 títulos gerados por IA** em produção (`familias.titulo_ml`, excluídos os 24
editados pelo operador — de 167 no total):

| Defeito | Incidência |
|---|---|
| Termina em adjetivo vazio | **35%** (50/143) |
| Unidade não canônica (`MT`, `MTS`, `UND`, `GR`) | 52% |
| Separador `\|` | 94% |
| Palavra/marca sem acento | 14% |
| Abreviação de planilha (`C/`, `S/`, `P/`) | 3% |
| Título idêntico ao de outro produto distinto | 1 grupo |

Caudas mais frequentes: `100% POLIÉSTER` 31× (legítima — é composição ancorada), `ELEGANTE`
8×, `ALTA RESISTÊNCIA` 7×, `QUALIDADE PREMIUM` 4×, `RESISTENTE` 4×, `SECAGEM LIMPA` 4×,
`VERSÁTIL` 3×.

### Causa

A causa é **a mesma Causa C do ADR-0098**, ainda não corrigida do lado do título: o prompt
prescrevia literalmente o formato `MARCA MODELO MEDIDA | CARACTERÍSTICA PRINCIPAL |
DIFERENCIAL`, com o exemplo `... | 100% POLIÉSTER | RESISTENTE`. `QUALIDADE PREMIUM` e `ALTA
RESISTÊNCIA` são exatamente os superlativos que o ADR-0098 baniu da descrição — o título
ficou de fora daquela limpeza. **Exemplo few-shot vence regra declarada**: o defeito não é o
terceiro segmento, é o segmento sem dado atrás dele.

### Alcance real da mudança

`title` só é enviado ao Mercado Livre no **CREATE** (`_shared/ml/publicar.ts:207`). O
`atualizarItemML` monta o corpo do PUT com `variations`, `attributes` e `pictures` —
**nunca `title`**. Título de anúncio já publicado nunca é atualizado pelo PubliAI. Esta
mudança tem **raio zero sobre os 167 títulos já publicados**; vale só para anúncios novos
(CREATE) a partir da entrega.

## Decisão

### Contrato de dez slots

`gerarCopy` passa a devolver um título estruturado em dez slots nomeados, não uma string:
`produto` (único nunca vazio), `marca`, `modelo`, `medida`, `quantidade`, `material`,
`variacao`, `compatibilidade`, `aplicacao`, `sinonimo`. Schema com as dez chaves obrigatórias
(`""` para slot ausente) e `additionalProperties: false` — impede o modelo de improvisar um
slot `diferencial`/`beneficio`, o que reabriria a Causa C pela porta do schema.

**Ordem de leitura ≠ ordem de corte.** A posição no texto final segue `produto → marca →
modelo → medida → quantidade → material → variacao → compatibilidade → aplicacao →
sinonimo`. A ordem de corte ao estourar 60 caracteres é a hierarquia invertida, com dois
desvios deliberados: **`medida`** (sempre que existir) e **`variacao` quando é
discriminadora** nunca são cortados — são os únicos slots incortáveis. `montarTitulo` reduz
antes de remover (`10 Metros` → `10m`, `100% Poliéster` → `Poliéster`), nunca trunca no meio
de um token, e remove slots inteiros por prioridade quando a redução não basta.

**`TituloInviavelError`** — quando o conjunto de slots obrigatórios (produto + medida +
variação discriminadora) já excede 60 caracteres mesmo depois de esgotadas as reduções e
removidos todos os slots cortáveis, `montarTitulo` falha com erro tipado em vez de truncar ou
remover um discriminador em silêncio. Cada call site traduz o erro em falha acionável pelo
operador, nomeando os slots que não couberam.

**`posProcessarTitulo`** — pipeline único (validar schema → normalizar slots → aplicar guards
→ validar ancoragem → Title Case → montar/reduzir/remover por prioridade → validar
invariantes), chamado pelos três call sites que antes compunham guards divergentes à mão. A
montagem acontece **uma única vez, depois de todos os guards** — se um guard injetasse dado
depois da montagem, o sistema voltaria à classe de bug que este design existe para eliminar
(injeção e corte na mesma ponta, com perda silenciosa).

### Discriminador é sobre função, não sobre tipo

`variacao` é discriminadora quando identifica unicamente a família perante suas irmãs — hoje
isso ocorre quando a família é mono-cor (`nCores === 1`), mas a regra é fraseada em termos de
função, não de cor, para sobreviver à próxima categoria sem exigir um guard novo.

## Resultado do experimento A/B

n=70 famílias, API real, cenário A = `titulo_ml` gravado em produção, cenário B = pipeline
novo com `openai/gpt-4.1-mini` (padrão do PubliAI desde o ADR-0098). Zero falhas de geração.

| Métrica | A | B |
|---|---|---|
| Termina em adjetivo vazio | 32,9% | **0%** |
| Unidade canônica | 64,3% | **100%** |
| Com `\|` | 92,9% | **0%** |
| Marca presente e ancorada | 26,2% | **55,4%** |
| Média de caracteres | 51,5 | 45,6 |
| Colisão entre `codigo_pai` distintos | 0 | 0 |

### Cobertura de marca

166 famílias com fornecedor: BUFALO 109 famílias (74 = 68% com marca ancorada na fonte),
CIRCULO S.A. 17 (9 = 53%), DETALLIA 15 (0), ECOFIBRA 5 (0), TRINITY 5 (0), LINHANYL 2 (2),
Eucerin 1 (1). Para cerca de metade do catálogo a marca não existe na fonte, e o título
corretamente não a terá — marca é **best-effort**, nunca inventada.

## Consequências

**Muda:**

- Anúncios novos (CREATE) adotam o formato de dez slots automaticamente.
- Título não termina mais em adjetivo vazio, unidade passa a canônica, pipe sai do padrão.

**Não muda:**

- Os 167 títulos já publicados — `atualizarItemML` nunca envia `title`. Corrigir título de
  anúncio já publicado exige um caminho que hoje não existe e está fora de escopo.
- A ordem das seções da descrição (ADR-0098) e os guards de largura/metragem da descrição.

## Alternativas descartadas

**Manter o separador `\|`.** Contraria o padrão de título do Mercado Livre — o próprio
documento oficial do ML não usa pipe como separador de seções dentro do título.

**Derivar marca do campo `fornecedor` por heurística (primeiro token útil).** Medido contra o
catálogo real: produz `"BARBANTE"` para `FABRICA DE BARBANTE BANDEIRANT`, `"V"` para
`V.R.MACHADO SILK SREEN EM GERA`, e `"LINHAS"` para `LINHAS SETTA LTDA`. Nenhum é uma marca
válida. `fornecedor` é razão social, não marca — não há heurística de tokenização que resolva
isso; a marca precisa vir ancorada na descrição da fonte ou ficar ausente.

**Truncar o título quando os slots obrigatórios não cabem em 60 caracteres.** Funde produtos
distintos num título só (dois SKUs diferentes por metragem ou cor, truncados para a mesma
string), e o Mercado Livre derruba o segundo anúncio por duplicado. Por isso a decisão de
falhar alto com `TituloInviavelError`, com a causa nomeada para o operador, em vez de mascarar
o problema com um corte silencioso.

## Regressões encontradas na migração

A migração dos guards de string (compostos à mão, string a string) para o contrato de slots
perdeu, **em silêncio**, oito travas que o projeto já tinha conquistado com incidentes reais.
Todas as oito foram encontradas e corrigidas antes do merge — nenhuma sobreviveu à entrega —
mas cada uma por um método diferente, e vale registrar o padrão: **nenhuma delas seria
detectada pela suíte**, que ficou verde (2400+ casos) o tempo todo, porque os testes que as
detectariam eram exatamente os que asseveravam as funções sendo removidas.

1. **Cor indefinida (`Outra`) vazando para o título** (lote #31) — duas instâncias: o guard de
   IA e o fallback de partição. 16 de 70 famílias mono-cor afetadas. No fallback era pior:
   `Outra` vencia cores reais no `sort` alfabético.
2. **Marketing não ancorado** (`novo`, `exclusivo`, `original`, `importado`) sem equivalente no
   contrato novo (lote #28).
3. **Cor multi-palavra duplicada e tipo de produto na forma colada** (`Pompom Pom Pom`, lote
   #33). 3 famílias reais, 2 já publicadas.
4. **Dedup cross-slot de metragem** — o guard antigo limpava o título inteiro ao detectar
   metragem duplicada; o novo só recomputava o slot `medida`, deixando a duplicata em outro
   slot intacta (lote #65).
5. **Largura `NNmm` sem a palavra LARGURA na fonte era descartada** — 4 fitas de veludo irmãs
   (16/20/25/50MM) colapsavam em um título só. 20 famílias em risco, 6 grupos de irmãs.
6. **Unidade por extenso da IA não canonicalizada** quando a fonte não tinha medida extraível.

O que encontrou cada uma, porque é o mais útil de registrar:

- **Teste de mutação** (remover a linha do guard e ver se a suíte continua verde) — pegou as
  três primeiras.
- **Portar as asserções dos testes antigos antes de apagá-los**, em vez de só apagar os testes
  do guard antigo — pegou a regressão 3.
- **Auditar a tabela de "onde cada garantia vive agora"** em vez de aceitá-la de bandeja —
  pegou a regressão 4.
- **Rodar o experimento contra a API e o banco reais** — pegou as regressões 5 e 6; nenhuma das
  duas apareceria num teste unitário com fixtures sintéticas, só com produtos reais do
  catálogo.

**Lição para a próxima migração de guards:** uma suíte verde não é evidência de que uma
garantia sobreviveu à refatoração quando o teste que a provava foi removido junto com o código
antigo que ele testava. A suíte ficar verde é necessária, não suficiente — o método que fecha a
lacuna é comparar a garantia antiga, uma a uma, contra onde ela vive agora, não confiar que a
migração preservou tudo por construção.
