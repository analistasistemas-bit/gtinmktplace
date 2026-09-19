# Cadastro em grade: tela dedicada pra roupa e calçado

**Data:** 2026-09-19
**Status:** Aprovado (design) — plano de implementação a seguir
**Relacionado:** [ADR-0166](../../decisions/0166-tipo-de-produto-por-organizacao.md) (tipo de produto por
org), [ADR-0167](../../decisions/0167-guia-de-tamanhos-gerenciado-via-api.md) (guia de tamanhos ML),
`docs/spikes/051-guia-tamanhos-ml-api.md` §12 (Tamanho Único confirmado impossível de publicar),
`src/components/estoque/dialog-cadastro-produto.tsx`, `src/components/estoque/gerador-variacoes.tsx`,
`src/lib/tamanhos.ts`, `supabase/functions/_shared/produto/tipos-produto-valores.ts`, `src/pages/Estoque.tsx`

---

## Problema

O cadastro manual pra org com `roupa`/`calcado` habilitado (ADR-0166) hoje mistura o eixo de grade
(Gênero, Tamanho/Numeração, Cor) dentro do MESMO dialog do cadastro normal
(`dialog-cadastro-produto.tsx`) — os campos aparecem condicionalmente (`temEixoTamanho`) no meio de
um formulário pensado pra produto simples. Três problemas concretos, levantados pelo Diego depois de
usar a feature (jaqueta e sandália publicadas de verdade):

1. **"Tamanho Único" ainda é uma opção** em `TAMANHOS_ROUPA`, mas o Spike 051 §12 já confirmou, com
   teste real contra a API do ML, que não existe guia de tamanhos pra "Tamanho Único" nos domínios de
   vestuário suportados — publicar com esse valor falha sempre. A opção precisa sumir, não só ser
   documentada como "não usar".
2. **Cadastro com grade e sem grade são a mesma tela.** Pra quem não usa roupa/calçado, nada muda
   (bom); mas pra quem usa, o formulário pergunta Gênero/Tamanho/Cor misturado com Nome/Unidade/
   Fornecedor — nenhuma organização visual dedicada ao fluxo de grade.
3. **Repetição desnecessária.** Preço, custo e as 4 dimensões (peso/altura/largura/comprimento) são,
   na prática, os mesmos pra toda a grade de um produto — mas o formulário atual obriga digitar (ou
   pelo menos revisar) esses 6 campos em CADA linha gerada. Numa grade de 4 cores × 4 tamanhos = 16
   linhas, isso significa repetir a mesma informação 16 vezes.

## Pesquisa de mercado (pedido do Diego)

Antes de desenhar, pesquisei como Bling, Tiny, Omie e VTEX resolvem "cadastro em grade" — nenhum usa
uma matriz visual (cor × tamanho como eixos cruzados, célula = quantidade) na tela de CADASTRO; esse
padrão existe em telas de estoque/reposição, não de criação. O padrão vencedor nos três ERPs de
pequeno/médio porte (Bling, Tiny, Omie) é **atributo → lista de opções → geração automática de
linhas** — exatamente o que `GeradorVariacoes` já faz hoje. O que eles resolvem diferente é a
repetição: o Bling documenta explicitamente um toggle "Utilizar informações do produto pai" (ligado
por padrão) — a variação herda preço/peso/estoque do pai e só vira editável se o operador destravar
aquela linha. A VTEX (plataforma enterprise, fora do padrão de PME) nem isso faz na tela — resolve
grade por importação de planilha externa.

Essa pesquisa mudou a recomendação inicial (que seria uma matriz tipo planilha) pra uma solução mais
alinhada ao padrão de mercado comprovado, mantendo a base de código já existente.

## Decisão

**Duas telas fisicamente separadas + herança de campo único com destrava por linha + foto por cor.**

### 1. Ponto de entrada — `src/pages/Estoque.tsx`

Um segundo botão, **"Cadastrar com grade"**, ao lado do "Cadastrar produto" atual — só aparece se
`useTiposProdutoHabilitados()` retornar pelo menos 1 tipo pra org. "Cadastrar produto" (sem grade)
fica **byte a byte igual a hoje**: sem Gênero, sem Tamanho, sem `GeradorVariacoes`. Zero pergunta
condicional de grade nesse caminho — reverte `dialog-cadastro-produto.tsx` ao formato de antes do
ADR-0166 (remove `temEixoTamanho`, `gruposTamanho`, o campo Gênero e o import de `GeradorVariacoes`).

### 2. Tela nova — `src/components/estoque/dialog-cadastro-grade.tsx`

Componente novo, não uma variante condicional do dialog atual.

**Passo 0 (só se a org tem os 2 tipos habilitados):** escolher Roupa ou Calçado — decide se o eixo
de grade vem de `TAMANHOS_ROUPA` ou `NUMERACOES_CALCADO` (via `opcoesDeTamanho([tipoEscolhido])`).
Org com só 1 tipo pula direto pro passo 1.

**Passo 1 — cabeçalho (preenchido uma vez):**
- Nome*, Descrição, Unidade, Fornecedor, Origem*, Gênero* (sempre obrigatório aqui — toda linha de
  grade tem tamanho, então a trava condicional de hoje some, vira incondicional).
- **Novo:** Preço*, Custo, Peso, Altura, Largura, Comprimento — os mesmos 6 campos que hoje só
  existiam por linha.

**Passo 2 — seleção de cor/tamanho, reaproveitando `GeradorVariacoes`:**
Chips clicáveis de cor (populares + "Adicionar cor", já existente) e checkboxes de tamanho/numeração
(já existente). Mudança de contrato: em vez de um botão "Gerar variações" que SUBSTITUI tudo,
`GeradorVariacoes` passa a **emitir o diff** a cada clique — marcar uma cor/tamanho a mais adiciona
só as linhas novas; desmarcar remove só as linhas daquela combinação. Sem botão "Gerar" — a seleção
já É a ação (decisão explícita pra evitar um clique extra sem propósito, já que cor/tamanho são
cliques discretos, não mais um textarea onde fazia sentido esperar o operador terminar de digitar).
Interface aproximada (a forma exata fecha na implementação/TDD):

```ts
GeradorVariacoes({
  gruposTamanho: GrupoTamanho[],
  onAdicionar: (novas: Combinacao[]) => void,
  onRemover: (chaves: Array<{ cor: string; tamanho: string }>) => void,
})
```

**Passo 3 — a grade em si (lista, não matriz):** uma linha por combinação, no mesmo componente
`LinhaVariacaoForm` de hoje. Cada linha nova nasce com Preço/Custo/Peso/Altura/Largura/Comprimento
**herdados do cabeçalho** (visualmente marcados como herdados — cinza/ícone de cadeado); clicar
destrava e edita só aquela linha, sem afetar as outras nem o cabeçalho. Mudar um valor no cabeçalho
DEPOIS de gerar linhas só se propaga pras linhas que **ainda não foram destravadas** — uma linha
destravada nunca é sobrescrita por uma mudança posterior no cabeçalho (evita perder edição do
operador). GTIN e Estoque continuam por linha, sem herança — não existe "GTIN único" nem "estoque
único" pra um produto com várias combinações.

**Foto por cor, não por linha:** um campo de upload por cor selecionada (não por combinação). Ao
gerar as linhas de uma cor, cada linha nasce com `foto` pré-preenchida com o arquivo daquela cor —
reaproveita o mecanismo de upload por linha que já existe (`subirLoteDeFotos`, campo `foto` de
`LinhaVariacao`) sem nenhuma mudança de contrato ali; o que muda é só COMO a UI inicializa esse campo
(automaticamente a partir do estado por-cor, em vez de pedir uma foto por linha). Cada linha ainda
guarda sua própria foto no banco (mesmo arquivo enviado uma vez por SKU que compartilha a cor) —
aceito como trade-off simples; não há necessidade de deduplicar armazenamento pra fotos de produto.

### 3. Dados e backend — sem mudança de contrato

A gravação continua idêntica: cada linha da grade vira 1 `variacoes` com seu próprio
preço/custo/peso/dimensão/GTIN, através da mesma `cadastrarProduto()` → edge `cadastrar-produto`
(ADR-0094). A herança é 100% front-end (preenchimento automático do formulário antes de enviar); o
payload que sai pra edge é idêntico ao de hoje, campo a campo, por linha. **Nenhuma migration.**
Publicação (`_shared/ml/size-chart.ts`, ADR-0167) não muda nada — já funciona pra Cor×Tamanho e
Cor×Numeração, validado em produção com a jaqueta e a sandália reais.

### 4. Remoção do Tamanho Único

`TAMANHOS_ROUPA` (`supabase/functions/_shared/produto/tipos-produto-valores.ts:17`) perde o valor
`'Tamanho Único'`, ficando `['P', 'M', 'G', 'GG']`. Isso propaga pra `src/lib/tamanhos.ts` (reexport)
e pra qualquer checkbox/seletor que leia essa lista — sem lista própria duplicada em nenhum outro
lugar (já confirmado: é fonte única, R7 da revisão do Fable no ADR-0166).

## Abordagens consideradas

1. **Esta (recomendada).** Lista + geração automática (já existente, comprovada pelo padrão de
   mercado) + herança de campo único com destrava por linha + foto por cor. Reaproveita
   `GeradorVariacoes`, `LinhaVariacaoForm`, `cadastrarProduto`, `subirLoteDeFotos` quase sem mudança
   de contrato — o grosso do trabalho é UI nova (`dialog-cadastro-grade.tsx`) e um ajuste de diff em
   `GeradorVariacoes`.
2. **Matriz visual (planilha real, tamanho×coluna, cor×linha, célula=quantidade).** Era a sugestão
   inicial do Diego. Rejeitada depois da pesquisa: nenhum concorrente pesquisado usa esse padrão pra
   CADASTRO (existe em estoque/reposição); seria UI inteiramente nova, sem precedente validado, maior
   risco de não acertar de primeira — sem ganho de velocidade claro sobre a opção 1, que já resolve a
   queixa real (repetição de preço/custo/dimensão) via herança.
3. **Manter tudo no mesmo dialog, só reordenando campos.** Rejeitada: não resolve a queixa #2
   (perguntas de grade aparecendo pra quem não usa) nem simplifica a repetição de campo único —
   continuaria sendo o mesmo formulário genérico tentando servir dois casos de uso diferentes.

## Fora de escopo (explicitamente)

- Mudança de schema/migration — zero coluna nova, zero tabela nova.
- Cadastro normal (sem grade), Kit vinculado, Kit Virtual, Catálogo, importação por planilha
  (`ingest-lote`) — nenhum desses fluxos muda.
- Publicação/guia de tamanhos no ML (ADR-0167) — já funciona, não é tocado por este design.
- Adicionar cor/tamanho a uma família **já publicada** — isso é o escopo do ADR-0129 (hoje só sabe
  adicionar cor nova a um Legacy publicado); grade nova a partir de um anúncio já no ar fica pra uma
  entrega futura, se e quando aparecer demanda real.
- Limite de 60 variações por geração (`LIMITE_VARIACOES_GERADAS`) continua valendo sem mudança.
- Deduplicar armazenamento de foto (mesmo arquivo, N linhas) — aceito como trade-off simples, não é
  problema real pra foto de produto.

## Testes

- `TAMANHOS_ROUPA` sem `'Tamanho Único'`; nenhum teste existente depende desse valor (checar
  `grep -rn "Tamanho Único"` antes de remover, pra achar qualquer teste que precise de ajuste).
- `dialog-cadastro-produto.tsx`: sem Gênero/Tamanho/`GeradorVariacoes` pra nenhuma org, mesmo com
  `roupa`/`calcado` habilitado — comportamento agora é sempre igual ao de uma org sem nenhum tipo.
- `GeradorVariacoes` (contrato novo): marcar uma cor/tamanho a mais chama `onAdicionar` só com as
  combinações que ainda não existiam; desmarcar chama `onRemover` só com as combinações daquela
  seleção; combinação já existente marcada de novo não duplica.
- `dialog-cadastro-grade.tsx` (novo): linha nova nasce com preço/custo/dimensão herdados do
  cabeçalho; destravar uma linha e depois mudar o cabeçalho não sobrescreve a linha destravada;
  linha nova de uma cor já com foto escolhida nasce com aquela foto; org com só 1 tipo habilitado
  pula o passo 0; org com os 2 tipos vê a escolha Roupa/Calçado.
- Fluxo completo (`processar.test.ts` da edge `cadastrar-produto`, se necessário): payload final
  enviado pela tela de grade é campo a campo idêntico ao que a edge já aceita hoje — nenhuma mudança
  de contrato na edge.
