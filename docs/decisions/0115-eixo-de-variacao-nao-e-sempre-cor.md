# ADR-0115 — O eixo de variação nem sempre é cor

**Status:** Aceito
**Data:** 2026-08-12
**Decisores:** Diego
**Relacionado:** ADR-0098 (copy ancorada na fonte e persuasiva); ADR-0099 (contrato de dez slots do título); ADR-0044 (cor no título mono-cor); ADR-0016 (UPDATE com reposição — `atualizarSecaoCores`)

## Contexto

Lote de 12/08/2026, família `92710170` — *Tecido Oxford Liso de 10m Estampas Exclusivas de
Natal Premium*, 7 variações nomeadas `Est.1`, `Est.6`, `Est.7`, `Est.9`, `Est.18`, `Est.31`,
`Est.33`.

A palavra "Natal" está no `nome_pai` **e** na `descricao_pai`. Mesmo assim não chegou ao título.
A descrição gerada anunciou:

```
🎨 CORES DISPONÍVEIS

- Verde Musgo
- Vermelho
```

O anúncio oferece **7 estampas**; a descrição publicada declarava **2 cores**. Os dois nomes
vieram do Vision lendo as fotos — não existe "Verde Musgo" na planilha.

### Evidência da regressão

O **mesmo produto** foi publicado em 29/07/2026 (família `02710170`, 5 variações `Est 5/11/16/20/43`,
`MLB7282797698`), antes da migração para slots:

| Data | Contrato do título | Resultado |
|---|---|---|
| 29/07 | string livre (`… \| CARACTERÍSTICA \| DIFERENCIAL`) | `TECIDO OXFORD LISO 10M \| ESTAMPAS EXCLUSIVAS NATAL \| PREMIUM` |
| 12/08 | dez slots (ADR-0099) | tema ausente |

Mesma planilha, mesmo eixo `Est-N`, 14 dias de diferença. A única variável que mudou foi o
contrato do título.

### Causa

**O sistema modela o eixo de variação como cor.** Esta família varia por estampa. O mesmo
defeito aparece em duas superfícies:

1. **Título** — o slot chama-se `variacao` e o prompt o define como *"cor ou tamanho, quando o
   anúncio é de UMA opção só"*. Com mais de uma cor, `titulo-guards.ts:380` zera o slot. Não
   existe slot para tema/coleção, e nada instrui o modelo a levar o tema para `produto`.
2. **Descrição** — a seção é a string fixa `🎨 CORES DISPONÍVEIS`, alimentada pelas cores
   resolvidas (dicionário → Vision). Numa família cujo eixo é estampa, o Vision responde a
   pergunta errada: ele classifica a cor predominante da foto de cada estampa.

O spike `docs/spikes/titulo-spec-marketplace-gap.md` (04/08) avaliou este caso ao rejeitar um
slot `atributo_principal` e concluiu que *"`Estampado Natal` pertence a `produto` ou
`variacao`"*. A premissa é falsa para família multi-variação: `variacao` é provadamente
indisponível, e sobra `produto` — para onde nada roteava o tema.

### O que NÃO é a causa

- Não há filtro de "Natal", "estampa" ou termo sazonal em lugar nenhum do código.
- A descrição de 12/08 **menciona** Natal em prosa três vezes. O problema dela é a lista de
  variações errada e duas seções ausentes, não o tema.
- O Vision nunca rodou nesta família em produção com `Est-N`: as cores foram definidas
  manualmente **depois** da geração da copy. No momento da geração eram `Verde Musgo` e
  `Vermelho`, ambas do Vision.

## Decisão

### 1. O eixo de variação é derivado da fonte, não presumido

Nova unidade `_shared/ai/eixo-variacao.ts`. O eixo sai do **sufixo discriminante** do nome de
cada variação em relação ao `nome_pai` — dado estrutural da planilha, não inferência sobre foto.

- Todas as variações nomeadas `{nome_pai} {sufixo}` com sufixos distintos → o eixo são os sufixos.
- O rótulo vem da palavra que a fonte usa: `estampa`/`estampado` → `ESTAMPAS DISPONÍVEIS`;
  sem palavra reconhecida → `VARIAÇÕES DISPONÍVEIS`.
- Sem sufixo discriminante → comportamento atual, `CORES DISPONÍVEIS` com as cores resolvidas.

`Est.6`, `Est-6` e `EST 6` normalizam para `Estampa 6`. Só o formato numerado é reescrito;
qualquer outro sufixo é usado literalmente — reescrever o que não se reconhece seria invenção.

**O eixo nunca é inventado.** Ele é um trecho literal do nome da variação. Isto o coloca sob a
mesma regra de ancoragem do ADR-0098: o que entra na copy vem da fonte.

### 2. O tema entra no slot `produto`

`produto` é **incortável** (`titulo-montar.ts`, `slotsIncortaveis`), então um tema roteado para
lá sobrevive ao corte de 60 caracteres. Não se cria um 11º slot: `additionalProperties: false`
continua fechado e a Causa C do ADR-0098 continua fechada com ele.

O prompt passa a instruir que `produto` incorpore tema/coleção **quando for trecho literal
contíguo da fonte** — o padrão de `validarTextoLivre` (ADR-0052), nunca o padrão frouxo de
`tipo_produto_busca`.

```
Fonte:  "Tecido Oxford Liso de 10m Estampas Exclusivas de Natal Premium"
Antes:  Tecido Oxford Liso 10m 100% Poliéster            (37 chars)
Depois: Tecido Oxford Estampa Natal 10m 100% Poliéster   (46 chars)
```

**A instrução sozinha não bastou — medido.** Com o parágrafo acima já no prompt, o
`gpt-4.1-mini` devolveu para a fonte do Oxford:

```json
{"produto":"Tecido Oxford Liso","medida":"10m x 1,50m","material":"100% Poliéster", ...}
```

Título resultante: `Tecido Oxford Liso 10m 100% Poliéster`, 37 caracteres. **Sobravam 23 e o tema
saiu mesmo assim** — não foi o corte de 60, foi o modelo. É a mesma lição do ADR-0099, agora
medida para tema: prompt não garante.

Entra então `cravarTema` em `aplicarGuardsTitulo`, no mesmo padrão de metragem/largura/cor:
lista **fechada** de temas comemorativos (`titulo-guards.ts`), cravados em `produto` só quando a
fonte os contém e o slot ainda não os cobre. Lista fechada, e não um extrator genérico do tipo
"a palavra depois de ESTAMPAS DE", porque `produto` é incortável — arrastar um substantivo
qualquer para lá é caro de errar.

Duas travas:

- **`Estampa Natal` vs `Natal`** — o prefixo `Estampa` só entra quando a fonte fala de estampa.
  Numa bola de Natal, afirmar "Estampa" inventaria um atributo.
- **Teto de 40 caracteres em `produto`** — `produto` e `medida` são os dois slots que nunca
  saem, então o teto reserva 20 para a medida. Estourando, o tema é abandonado. Sem isso,
  cravar em slot incortável transformaria um título viável em `TituloInviavelError`, e a família
  morreria por causa da melhoria.

Resultado na mesma fonte: `Tecido Oxford Liso Estampa Natal 10m 100% Poliéster`, 51 caracteres.

### 3. Perguntas frequentes deixam de ser opcionais quando há dado

`removerPerguntasIncompletas` sabia podar a seção com menos de três perguntas, mas nada a
recriava. Na família de 12/08 a seção sumiu inteira, com `descricao_status` e `descricao_erro`
nulos — a IA simplesmente não a escreveu, tendo quatro dados disponíveis.

Novo `garantirPerguntas`: seção ausente + ao menos três bullets mapeáveis em
`📌 ESPECIFICAÇÕES` → a seção é reconstruída a partir **dos próprios bullets**. Pergunta e
resposta saem de um dado que já passou por todos os guards. Zero invenção — é o mesmo espírito
de `garantirLarguraDescricao` e `garantirMetragemDescricao`.

Roda **depois** dos guards de largura/metragem, para aproveitar os bullets que eles injetam, e
depois da poda, preservando a ordem que o ADR-0098 estabeleceu (podar antes de ancorar).

### 4. Seções nomeadas pelo que o comprador procura

| Antes | Depois |
|---|---|
| `✅ BENEFÍCIOS` | `✅ POR QUE ESCOLHER` |
| `📦 CONTEÚDO DA EMBALAGEM` | `📦 O QUE VOCÊ RECEBE` |
| `🎨 CORES DISPONÍVEIS` | rótulo do eixo (item 1) |

`🎯 INDICAÇÕES DE USO` passa de 4-6 para 4-12 bullets no prompt. Aplicação típica da categoria já
é permitida pela regra CATEGORIA versus PRODUTO — o teto baixo é que era arbitrário.

**Medido e NÃO entregue.** Duas execuções contra a mesma fonte devolveram 4 e 3 bullets — a
segunda abaixo até do piso antigo. É o mesmo modo de falha do tema, e aqui não há guard: gerar
aplicação deterministicamente exigiria uma tabela categoria → aplicações, que é conhecimento de
domínio inventado fora da fonte, exatamente o que o ADR-0098 proíbe. Fica registrado como não
resolvido, e não como comportamento novo. Alternativa a avaliar num próximo caso: derivar as
aplicações do `tipo_produto_busca` com curadoria humana por categoria, o que é uma decisão de
produto, não de prompt.

As listas `CABECALHOS_APOS_ESPECIFICACOES` e `CABECALHOS_APOS_PERGUNTAS` passam a casar **pelo
emoji**, não pelo texto do cabeçalho. Casar por texto tornaria toda renomeação futura uma
quebra silenciosa: os guards deixariam de achar a fronteira da seção e injetariam bullet no
lugar errado.

`atualizarSecaoCores` (`_shared/ml/criar-item.ts`, usado no UPDATE) passa a reconhecer os três
rótulos e a **preservar o rótulo existente** ao reescrever. Sem isso, uma família com
`ESTAMPAS DISPONÍVEIS` ganharia uma segunda seção `CORES DISPONÍVEIS` no fim da descrição a
cada reposição de variação.

## Consequências

- Anúncio novo cujo eixo é estampa passa a listar as estampas reais em vez da cor que o Vision
  leu da foto. **Raio zero sobre anúncio já publicado** — título nunca é atualizado
  (`atualizarItemML` não envia `title`), e a descrição só é reescrita no UPDATE.
- A seção de perguntas deixa de depender da obediência do modelo quando há dado para ela.
- Famílias cujo eixo continua sendo cor não mudam de comportamento: o caminho novo exige
  sufixo discriminante, e sem ele tudo cai no fluxo atual.
- Produto sem tema na lista fechada não é afetado — `cravarTema` sai no primeiro `find` vazio.
- **Limitação conhecida:** `atualizarSecaoCores` (UPDATE) reescreve a lista com os valores que o
  chamador passa, que continuam vindo de `variacoes.cor`. Numa família estampada cujas cores no
  banco estejam como `Est-6`, a lista republicada sai `Est-6` em vez de `Estampa 6` — o rótulo
  da seção é preservado, mas o formato dos itens diverge do que o CREATE escreveu. Só aparece
  em UPDATE de família estampada com cor preenchida à mão; não foi tratado aqui para manter o
  raio da mudança no CREATE.

## Não decidido aqui

Seção de envio, superlativos vindos da fonte ("excelente rendimento", "ótimo caimento") e
adjetivos de `ADJETIVOS_VAZIOS` ("resistente") foram pedidos e **ficam de fora**. Continuam
regidos pelo ADR-0098 e pela proibição de envio em `copywriter-prompt.ts` — o Mercado Livre
calcula frete por CEP, e prometer prazo é afirmar o que o vendedor não controla.
