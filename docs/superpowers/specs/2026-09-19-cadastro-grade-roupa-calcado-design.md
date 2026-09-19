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

## Revisão externa (Codex GPT-6-Astra, 2026-09-19)

Antes do plano de implementação, esta spec passou por uma segunda revisão técnica (Codex, modelo
GPT-6-Astra, `--effort high`, leitura read-only do repo). Achou 6 lacunas reais (paridade fiscal/foto
de capa esquecidas, nome de campo errado, identidade de combinação indefinida, herança sem
granularidade definida, foto por cor sem regra de atualização) e 2 melhorias de UX. Todas as seções
abaixo já incorporam essas decisões — o texto não separa mais "achado da Astra" de "decisão
original", é uma spec só, já corrigida.

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
- **Novo:** Preço mínimo (líquido)*, Custo, Peso, Altura, Largura, Comprimento — os mesmos 6 campos
  que hoje só existiam por linha (nome do campo preservado exatamente como em
  `linha-variacao-form.tsx:58`, não "Preço" genérico).
- **Fotos de capa** (capa/capa2/capa3) — mesmo campo que já existe no dialog de hoje
  (`fotosCapa`/`CampoFoto`), preenchido aqui uma vez só, igual ao comportamento atual. Não é foto por
  cor (isso é passo 3) — é a foto de capa do anúncio como um todo.
- **Etapa fiscal**, se `fiscalAtivo` (módulo fiscal da org ligado): mesmo `EtapaFiscalForm` que o
  dialog atual já usa, como um passo adicional (numeração "etapa N de M" ganha mais um). Sem isso a
  edge rejeitaria o cadastro pra quem tem o módulo fiscal — era uma lacuna real da primeira versão
  desta spec.

**Passo 2 — seleção de cor/tamanho, reaproveitando `GeradorVariacoes`:**
Chips clicáveis de cor (populares + "Adicionar cor", já existente) e checkboxes de tamanho/numeração
(já existente). Mudança de contrato: em vez de um botão "Gerar variações" que SUBSTITUI tudo,
`GeradorVariacoes` passa a **emitir o diff** a cada clique — marcar uma cor/tamanho a mais adiciona
só as linhas novas; desmarcar remove só as linhas daquela combinação. Sem botão "Gerar" — a seleção
já É a ação (decisão explícita pra evitar um clique extra sem propósito, já que cor/tamanho são
cliques discretos, não mais um textarea onde fazia sentido esperar o operador terminar de digitar).

**Regras de identidade, travadas nesta tela (achado da revisão Astra — o componente de hoje permite
o oposto, e isso quebraria o diff):**
- **Precisa de pelo menos 1 cor E 1 tamanho** pra gerar qualquer linha — ao contrário do
  `GeradorVariacoes` de hoje (usado no cadastro normal), que aceita cor sem tamanho ou tamanho sem
  cor. Numa grade isso não tem sentido: toda linha tem os dois eixos, sempre.
- **Cor e Tamanho da linha ficam travados** (não editáveis) depois de gerada — só o resto dos campos
  (preço, custo, estoque, GTIN, dimensão, foto) é editável por linha. Editar cor/tamanho dentro da
  linha desalinharia a chave que o diff usa pra saber o que já existe; se o operador errou a
  combinação, remove a linha (ver abaixo) e ajusta os chips.
- **Remover uma linha manualmente é permanente até nova ação explícita**: marcar o mesmo
  cor/tamanho nos chips de novo NÃO recria sozinha uma linha que o operador removeu — o diff só
  adiciona o que nunca existiu ou o que foi desmarcado-e-remarcado deliberadamente. Isso permite
  grade parcial (ex.: Preto/P, Preto/M, Azul/M, sem Azul/P) sem a UI insistir em recompletar o
  cartesiano.
- **Desmarcar uma cor/tamanho que já tem linha(s) com dado preenchido** (GTIN, estoque, ou foto
  destravada individualmente) **pede confirmação** (`AlertDialog`, mesmo padrão já usado no projeto,
  ex. "Remover" do Publicados) antes de apagar; linha ainda vazia/intacta remove direto, sem
  confirmação.
- **Limite de 60** (`LIMITE_VARIACOES_GERADAS`) é validado contra o **total resultante** a cada
  clique — o chip que faria o total estourar fica desabilitado (com tooltip explicando o motivo),
  em vez de aceitar o clique e falhar depois de gerar.

Interface aproximada (a forma exata fecha na implementação/TDD):

```ts
GeradorVariacoes({
  gruposTamanho: GrupoTamanho[],
  onAdicionar: (novas: Combinacao[]) => void,
  onRemover: (chaves: Array<{ cor: string; tamanho: string }>) => void,
})
```

**Passo 3 — a grade em si (lista, não matriz):** uma linha por combinação, no mesmo componente
`LinhaVariacaoForm` de hoje, em **modo compacto por padrão** — mostra Cor · Tamanho (ex.: "Azul · M",
nunca "Variação 7"), Estoque e GTIN; os campos herdados (preço/custo/dimensão) ficam resumidos, só
expandem quando a linha tem alguma exceção. Evita repetir visualmente 6 campos em cada uma das até
60 linhas mesmo sem exigir redigitação.

**Herança é por CAMPO, não pela linha inteira.** Cada um dos 6 campos (Preço, Custo, Peso, Altura,
Largura, Comprimento) tem seu próprio estado herdado/destravado por linha — destravar só o Preço não
desvincula Custo ou Dimensão daquela mesma linha. Cada campo destravado ganha um botão **"Voltar a
herdar"** que descarta o valor próprio e volta a seguir o cabeçalho. Mudar um valor no cabeçalho
DEPOIS de gerar linhas só se propaga pros campos **ainda não destravados** — um campo destravado
nunca é sobrescrito por uma mudança posterior no cabeçalho (evita perder edição do operador). Se o
cabeçalho ficar vazio/inválido (só possível pro Preço, os únicos 5 restantes são opcionais), a linha
nova simplesmente nasce sem herança nesse campo — equivalente a como o formulário se comporta hoje,
não é um estado quebrado. GTIN e Estoque continuam por linha, sem herança — não existe "GTIN único"
nem "estoque único" pra um produto com várias combinações.

**Foto por cor, não por linha:** um campo de upload por cor selecionada (não por combinação). Ao
gerar as linhas de uma cor, cada linha nasce com `foto` pré-preenchida com o arquivo daquela cor —
reaproveita o mecanismo de upload por linha que já existe (`subirLoteDeFotos`, campo `foto` de
`LinhaVariacao`) sem nenhuma mudança de contrato ali; o que muda é só COMO a UI inicializa esse campo
(automaticamente a partir do estado por-cor, em vez de pedir uma foto por linha). **Trocar a foto de
uma cor depois de já ter gerado linhas propaga pra todas as linhas daquela cor que ainda não tiveram
a foto destravada/trocada individualmente** — mesmo princípio de herança por campo que preço/custo/
dimensão usam. Cada linha ainda guarda sua própria foto no banco (mesmo arquivo enviado uma vez por
SKU que compartilha a cor) — aceito como trade-off simples; não há necessidade de deduplicar
armazenamento pra fotos de produto. Reenvio de foto que falhou no upload em lote reaproveita o upload
manual avulso por variação que o dialog atual já tem — nada novo a construir aqui.

**Numeração de calçado sabidamente não publicável no ML** (pares como `"33/34"`, ou feminino
`45`/`46` — já documentados em `tipos-produto-valores.ts` como fora de `COMPRIMENTO_PE_CM`) ganha um
aviso inline junto ao checkbox no passo 2, tipo "cadastrável, mas hoje não publica no Mercado Livre" —
sem bloquear a seleção (o cadastro em si pode servir só pra controle de estoque, nem toda linha
precisa ir pro ML). Mesmo espírito da remoção do Tamanho Único, mas sem remover a opção da lista
porque aqui, ao contrário do Tamanho Único, a numeração existe de verdade fisicamente — só falta o
ML aceitar.

**Resumo antes de salvar:** logo acima do botão "Cadastrar", uma linha de texto resume quantidade de
SKUs, unidades totais (soma de estoque), quantas linhas ainda estão sem foto — pra conferência rápida
antes de confirmar, sem precisar rolar a lista inteira.

### 3. Trocar Roupa↔Calçado depois de já ter linhas geradas

Só relevante pra org com os 2 tipos habilitados (passo 0). Trocar o tipo **reseta a seleção de
cor/tamanho e limpa as linhas geradas** — com o mesmo `AlertDialog` de confirmação se já havia dado
digitado (mesma regra do passo 2 pra desmarcar cor/tamanho). Trocar de eixo (Tamanho↔Numeração) no
meio da grade não tenta "migrar" combinações de um eixo pro outro — não existe correspondência
sensata entre os dois, e é uma decisão rara/inicial do cadastro, não algo que aconteça com frequência.

### 4. Dados e backend — sem mudança de contrato

A gravação continua idêntica: cada linha da grade vira 1 `variacoes` com seu próprio
preço/custo/peso/dimensão/GTIN, através da mesma `cadastrarProduto()` → edge `cadastrar-produto`
(ADR-0094). A herança é 100% front-end (preenchimento automático do formulário antes de enviar); o
payload que sai pra edge é idêntico ao de hoje, campo a campo, por linha. **Nenhuma migration.**
Publicação (`_shared/ml/size-chart.ts`, ADR-0167) não muda nada — já funciona pra Cor×Tamanho e
Cor×Numeração, validado em produção com a jaqueta e a sandália reais.

O casamento POSICIONAL entre linha e resposta da edge (usado pro upload de fotos e pro retry —
mesma lógica já documentada em `dialog-cadastro-produto.tsx` sobre `subirLoteDeFotos`) exige que a
lista de linhas fique **congelada** durante o envio: os controles de adicionar/remover/destravar
linha ficam desabilitados enquanto `salvando=true`, mesmo padrão que o dialog atual já aplica.

### 5. Remoção do Tamanho Único

`TAMANHOS_ROUPA` (`supabase/functions/_shared/produto/tipos-produto-valores.ts:17`) perde o valor
`'Tamanho Único'`, ficando `['P', 'M', 'G', 'GG']`. Isso propaga pra `src/lib/tamanhos.ts` (reexport)
e pra qualquer checkbox/seletor que leia essa lista — sem lista própria duplicada em nenhum outro
lugar (já confirmado: é fonte única, R7 da revisão do Fable no ADR-0166). Essa é uma mudança de
**validação de backend** (a edge `cadastrar-produto` recusa qualquer tamanho fora da lista, não é só
sumir do frontend) — por design já é seguro: uma aba antiga aberta no navegador, ou um retry de
cadastro anterior com `'Tamanho Único'` salvo, é rejeitado pela edge com erro claro, não falha
silenciosa (mesma trava que já protege contra qualquer valor fora da lista hoje).

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

## Riscos conhecidos, pré-existentes (não introduzidos por este design)

Apontados na revisão do Codex, mas já existiam antes desta spec — não são regressão, só registro
pra não serem confundidos com lacuna nova:

- **Escopo real de domínios ML suportados é menor que "roupa/calçado funciona" sugere.** Hoje só
  `JACKETS_AND_COATS`, `SPORT_T_SHIRTS`, `SNEAKERS`, `SANDALS_AND_CLOGS` têm guia de tamanhos
  confirmado (`DOMINIOS_SUPORTADOS`, `_shared/ml/size-chart.ts:48`). Vestido, calça, outras
  numerações de calçado ainda não foram validados — publicar em domínio não suportado já falha alto
  hoje (mensagem clara), então não é um bug silencioso, mas a tela nova não deve prometer mais
  alcance do que existe.
- **Upload sequencial de fotos numa grade grande.** Até 60 combinações podem gerar até 60 uploads
  (mesmo reaproveitando poucos arquivos distintos por cor), sequencialmente, como o fluxo já faz
  hoje pro cadastro normal — não é regressão desta spec, mas vale observar tempo/UX no limite depois
  de implementado, e otimizar (paralelizar, ou deduplicar de fato) só se isso se confirmar um
  problema real de uso.

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
  seleção; combinação já existente marcada de novo não duplica; combinação removida manualmente NÃO
  reaparece sozinha ao remarcar o mesmo cor/tamanho; cor sem tamanho (ou vice-versa) não gera nada;
  chip que estouraria o limite de 60 fica desabilitado.
- `dialog-cadastro-grade.tsx` (novo):
  - linha nova nasce com os 6 campos herdados do cabeçalho (preço/custo/peso/altura/largura/
    comprimento), cada um com seu próprio estado herdado/destravado;
  - destravar só um campo não destrava os outros da mesma linha; "Voltar a herdar" volta a seguir o
    cabeçalho;
  - mudar o cabeçalho depois de gerar linhas não sobrescreve campo já destravado;
  - linha nova de uma cor já com foto escolhida nasce com aquela foto; trocar a foto da cor depois
    propaga pras linhas que não destravaram foto individualmente;
  - desmarcar cor/tamanho com linha vazia remove direto; com linha preenchida (GTIN/estoque/foto
    destravada) pede confirmação primeiro;
  - org com só 1 tipo habilitado pula o passo 0; org com os 2 tipos vê a escolha Roupa/Calçado;
    trocar o tipo depois de já ter linhas reseta a seleção (com confirmação se havia dado);
  - com o módulo fiscal ativo, o passo fiscal aparece e é obrigatório, igual ao dialog atual;
  - controles de adicionar/remover/destravar linha ficam desabilitados durante `salvando=true`.
- Fluxo completo (`processar.test.ts` da edge `cadastrar-produto`, se necessário): payload final
  enviado pela tela de grade é campo a campo idêntico ao que a edge já aceita hoje — nenhuma mudança
  de contrato na edge.
