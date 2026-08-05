# ADR-0102 — A descrição não promete logística nem crava o conteúdo da embalagem

**Status:** Aceito
**Data:** 2026-08-04
**Decisores:** Diego
**Relaciona:** estende [ADR-0098](0098-copy-ancorada-na-fonte-e-persuasiva.md) (copy ancorada na
fonte — mantém R4/R8 intactas); mesma regra que o T3 de [ADR-0099](0099-titulo-padrao-mercado-livre.md)
já aplica ao título; medido com o método de [ADR-0100](0100-termos-com-risco-valvula-de-escape.md)
e [ADR-0101](0101-marca-do-mapa-nao-troca-entidade.md)

## Contexto

Um documento externo de especificação de descrições foi avaliado contra o pipeline atual. Como no
caso do título (`docs/spikes/titulo-spec-marketplace-gap.md`), o sistema já implementava a maior
parte — estrutura, ancoragem, proibições e conversão característica→benefício são do ADR-0098, e em
vários pontos mais fortes que a spec.

O conflito que se esperava — **emojis** — não existe: `sanitizarDescricaoML`
(`_shared/ml/criar-item.ts:36`) remove todos antes do envio, porque o próprio Mercado Livre rejeita
emoji na descrição (`DESCRIPTION_PLAIN_TEXT_NOT_ALLOWED`). O comprador nunca viu um. Os símbolos no
prompt são fronteira determinística de quatro guards, e o ADR-0098 já registra esse acoplamento.

O que a avaliação encontrou foi outra coisa, medida no catálogo (304 descrições, somente SELECT):

| Achado | Famílias |
|---|---|
| Contêm "envio rápido e seguro para todo o Brasil" | **298** |
| …sem qualquer respaldo na `descricao_pai` | **298** |
| …publicadas no Mercado Livre agora | **292** |
| Contêm a frase literal `1 unidade do produto na cor de sua escolha` | **222** |
| …dessas, famílias **sem nenhuma cor real** (a frase mente) | 25 |
| …dessas, famílias **multipack pela fonte** (título diz `144un`, descrição diz "1 unidade") | 6 |

As duas frases não vinham do modelo: estavam **hardcoded no template** do `SYSTEM`
(`copywriter-prompt.ts`), e o modelo copiava.

### Por que isso é defeito, e não escolha de copy

**O próprio sistema já bane essas palavras no título.** O T3 (`copywriter-prompt.ts:328`) proíbe
literalmente "pronta entrega" e "envio rápido" em qualquer slot. Banir num campo e injetar no outro
é incoerência interna, independente da spec externa.

E é uma afirmação que **o vendedor não controla**: prazo, modalidade, custo, cobertura e
transportadora são calculados e exibidos pelo Mercado Livre na própria página, por CEP. Prometer
"envio rápido para todo o Brasil" no corpo do anúncio é afirmar sobre logística de terceiro.

Agravante mecânico: a seção de envio era **o único bloco do template sem âncora na fonte** — e é
exatamente onde o modelo embelezava. Numa família ele escreveu "Produto **original** à pronta
entrega com **embalagem segura** e envio rápido para todo o Brasil": dois claims a mais, do nada.
Bloco livre convida preenchimento livre.

## Decisão

### 1. A seção de envio sai do template, e a proibição fica explícita

O bloco `🚚 ENVIO RÁPIDO` e sua frase-modelo são removidos. Em `TOM E ESTILO` entra a proibição
declarada, com a razão (o ML já exibe o dado real por CEP) e o paralelo com o título.

**As strings `'🚚 ENVIO RÁPIDO'` permanecem em `CABECALHOS_APOS_ESPECIFICACOES` e
`CABECALHOS_APOS_PERGUNTAS`.** Isso não é esquecimento: as 295 descrições **já gravadas** contêm a
seção, e os guards de injeção precisam continuar reconhecendo-a como fronteira. Removê-las das
listas faria `injetarBulletEspecificacoes` inserir no lugar errado justamente nas descrições
legadas. Há teste comportamental cobrindo esse caso.

### 2. O conteúdo da embalagem passa a derivar do dado

A frase fixa dá lugar a uma instrução que deriva quantidade e apresentação da fonte, com as duas
proibições que os dados mostraram serem necessárias: nunca "na cor de sua escolha" sem variação de
cor, nunca "1 unidade" quando a fonte declara pacote com mais de uma peça.

**Honestidade sobre o tamanho do problema:** das 28 famílias multipack, o modelo já adaptava em 22
— o template só vencia na minoria em que ele copiava o literal em vez de derivar do dado. A
mudança fecha essa minoria.

### 3. A abertura ganha teto de uma frase, e o produto é nomeado no primeiro parágrafo

A spec pedia banir a abertura por contexto de categoria. **Isso é rejeitado:** essa abertura é a R4
do ADR-0098, decidida com medição, e carrega o carve-out do qual a R8 depende — derrubá-la reabriria
alternativa já rejeitada.

O que sobrevive da crítica é a **posição do produto**, não a existência da dor. A saída real para o
único cosmético do catálogo gastava duas frases e ~280 caracteres antes de nomear o produto, e a
segunda frase era definição de dicionário ("Pomadas reparadoras são produtos usados para hidratar a
pele") — enchimento, não contexto de uso.

Decisão: **no máximo uma frase de contexto de categoria, e o produto nomeado ainda no primeiro
parágrafo.** Compatível com R4 e R8.

## Efeito medido

Geração real com o template novo, para uma caixa com 144 unidades (o caso em que o template antigo
escrevia "1 unidade na cor de sua escolha"):

```
promete envio/frete          : não          (antes: seção fixa em toda descrição)
CONTEÚDO DA EMBALAGEM        : "• 1 caixa com 144 unidades"
produto nomeado no 1º parágr.: sim, na 2ª frase, sem definição de dicionário
```

## Consequências

**Muda:** descrições geradas a partir de agora — CREATE e `regenerar-copy-familia`.

**NÃO muda os 292 anúncios que hoje prometem frete.** `posProcessarDescricao` e o `SYSTEM` só rodam
na geração; `sincronizarDescricao` reenvia a `descricao_ml` **já gravada** sem re-executar IA. Para
limpar o que está no ar seria preciso reescrever `familias.descricao_ml` — DML em produção, via
`supabase migration new` + `db push` (ADR-0043), com dry-run e excluindo as **6** famílias com
`descricao_editada_pelo_operador`. **Fora do escopo deste ADR**, registrado como pendência com
número.

**Não muda:** emojis (já removidos no envio), R4/R8 do ADR-0098, os guards de injeção, o
reconhecimento da seção legada como fronteira.

## Rejeitados da spec, com o motivo

- **Emojis (§4/§11)** — já cumprido no ML por `sanitizarDescricaoML`; os símbolos no prompt são
  fronteira de quatro guards.
- **Abertura como escrita (§7)** — derrubaria a R4, medida, por asserção não medida.
- **"Diferencial da oferta" (§8.7)** — campo livre para o diferencial é a forma exata da Causa C, a
  mesma que matou `atributo_principal` no título.
- **"Como usar" (§8.8)** — 8 fontes em 305 sustentam a seção, e a própria spec proíbe inventar o
  conteúdo.
- **Seção de cores com um item (§15)** — o cabeçalho `🎨 CORES DISPONÍVEIS` é âncora de
  `atualizarSecaoCores` (ADR-0016); removê-lo faria a seção ser recriada no fim do texto quando a
  segunda cor chegasse.
- **Telefone/contato/loja (§4)** — 0 ocorrências em 304 descrições; guard para defeito inexistente
  é risco puro.

Diferidos por falta de população, com gatilho declarado: lista de usos que exigem confirmação
(§8.5 — bebê, pós-tatuagem, ferida, gestante), regras de cosmético (§12-13) e `Linha` ≠ `Modelo`
(§8.6). Gatilho: cosmético/higiene virar volume no catálogo.

## Como reverter

Restaurar o bloco `🚚 ENVIO RÁPIDO`, a frase de conteúdo da embalagem e o texto original do
parágrafo 1 em `copywriter-prompt.ts`, e remover a proibição de `TOM E ESTILO`. Os testes de
`copywriter-envio.test.ts` falham, que é o esperado na reversão.
