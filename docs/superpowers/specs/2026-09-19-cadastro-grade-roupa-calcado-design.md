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

Em seguida, uma terceira revisão (Fable, leitura independente sem ter visto o brainstorming)
encontrou que "reaproveita `LinhaVariacaoForm`" e "reaproveita `subirLoteDeFotos`" eram otimistas
demais — boa parte da lógica do dialog atual é closure interna, não importável como está — e propôs
um desenho interno mais simples pra herança e pra reconciliação da grade. Também já incorporado
abaixo.

## Decisão

**Duas telas fisicamente separadas + herança de campo único com destrava por linha + foto por cor.**

### 1. Ponto de entrada — `src/pages/Estoque.tsx`

Um segundo botão, **"Cadastrar com grade"**, ao lado do "Cadastrar produto" atual — só aparece se
`useTiposProdutoHabilitados()` retornar pelo menos 1 tipo pra org. "Cadastrar produto" (sem grade)
fica **byte a byte igual a hoje**: sem Gênero, sem Tamanho, sem `GeradorVariacoes`. Zero pergunta
condicional de grade nesse caminho — reverte `dialog-cadastro-produto.tsx` ao formato de antes do
ADR-0166 (remove `temEixoTamanho`, `gruposTamanho`, o campo Gênero e o import de `GeradorVariacoes`).

### 2. Tela nova — `src/components/estoque/dialog-cadastro-grade.tsx`

Componente novo, não uma variante condicional do dialog atual — mas **não reescrito do zero**.

**Extração obrigatória antes de construir o dialog novo (achado do Fable):** ~500 das 860 linhas de
`dialog-cadastro-produto.tsx` (upload de fotos em lote com retry — `subirLoteDeFotos`/`subirFoto`,
etapa 2 de fotos, estado de `fotosEnviadas`/`trocando`/`confirmarFechar`, tratamento de 409 —
`resultadoAmbiguo`/`divergencia`, `chaveCadastro`, e o efeito de sugestão de NCM) são **closures
internas do componente**, não algo importável como está. "Reaproveita" só é verdade depois de extrair
essas partes pra um hook `useCadastroProduto()` + componente `EtapaFotos` compartilhados — usados
pelos DOIS dialogs (o atual e o novo). Sem essa extração, o dialog novo duplicaria ~500 linhas.
`dialog-cadastro-produto.test.tsx` (900 linhas) já cobre esse comportamento e serve de rede de
segurança pro refactor.

`LinhaVariacaoForm` continua sendo o formulário do cadastro normal e do "Adicionar variação"
(ADR-0129) — cor/tamanho travados, modo compacto e cadeado por campo (herança) são um layout
diferente o suficiente pra merecer um componente próprio, **`LinhaGradeForm`**, reaproveitando o tipo
`LinhaVariacao` e os helpers `erroCampo`/`parseNum` (não o JSX de `LinhaVariacaoForm`).

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
(já existente), só reportando a seleção pro dialog. Mudança de comportamento: em vez de um botão
"Gerar variações" que SUBSTITUI tudo, o dialog **reconcilia a grade a cada clique** (ver "Desenho
interno" abaixo) — marcar uma cor/tamanho a mais adiciona só as linhas novas; desmarcar remove só as
linhas daquela combinação. Sem botão "Gerar" — a seleção já É a ação (decisão explícita pra evitar um
clique extra sem propósito, já que cor/tamanho são cliques discretos, não mais um textarea onde fazia
sentido esperar o operador terminar de digitar).

**Regras de identidade, travadas nesta tela (achado da revisão Astra — o componente de hoje permite
o oposto, e isso quebraria o diff):**
- **Precisa de pelo menos 1 cor E 1 tamanho** pra gerar qualquer linha — ao contrário do
  `GeradorVariacoes` de hoje (usado no cadastro normal), que aceita cor sem tamanho ou tamanho sem
  cor. Numa grade isso não tem sentido: toda linha tem os dois eixos, sempre.
- **Cor e Tamanho da linha ficam travados** (não editáveis) depois de gerada — só o resto dos campos
  (preço, custo, estoque, GTIN, dimensão, foto) é editável por linha. Editar cor/tamanho dentro da
  linha desalinharia a chave que o diff usa pra saber o que já existe; se o operador errou a
  combinação, remove a linha (ver abaixo) e ajusta os chips.
- **Remover uma linha manualmente é permanente ENQUANTO os dois eixos daquela combinação
  continuarem marcados** — marcar o mesmo cor/tamanho de novo, com AMBOS já marcados antes e depois,
  não recria sozinha a linha que o operador removeu. Isso permite grade parcial (ex.: Preto/P,
  Preto/M, Azul/M, sem Azul/P) sem a UI insistir em recompletar o cartesiano. **Mas desmarcar um eixo
  inteiro (a cor ou o tamanho) e remarcar depois LIMPA essa memória de exclusão** pra aquele eixo —
  desmarcar "Azul" já é a ação de "não quero Azul", remarcar já é "quero Azul de novo, por completo";
  manter uma exclusão de célula viva através desse ciclo seria confuso, não uma continuidade real da
  mesma decisão (achado do Fable).
- **Desmarcar uma cor/tamanho que já tem linha(s) com dado preenchido** (GTIN, estoque, ou foto
  destravada individualmente) **pede confirmação** (`AlertDialog`, mesmo padrão já usado no projeto,
  ex. "Remover" do Publicados) antes de apagar; linha ainda vazia/intacta remove direto, sem
  confirmação.
- **Limite de 60** (`LIMITE_VARIACOES_GERADAS`) é validado contra o **cartesiano menos as exclusões
  manuais** a cada clique — o chip que faria esse total estourar fica desabilitado (com tooltip
  explicando o motivo), em vez de aceitar o clique e falhar depois de gerar.

**Desenho interno (achado do Fable — mais simples que emitir eventos a cada clique):** o dialog é
dono do estado bruto — `cores: Set<string>`, `tamanhos: Set<string>`, `removidas: Set<Chave>` (as
exclusões manuais) — e uma função pura `reconciliarGrade(cores, tamanhos, removidas, linhasAtuais)`
devolve `{ novas: Combinacao[], remover: Chave[] }` a cada mudança de seleção. `GeradorVariacoes`
continua sendo só a UI de chips/checkboxes; a reconciliação (incluindo a regra acima de limpar
`removidas` ao desmarcar um eixo inteiro) fica isolada numa função testável sem precisar montar o
componente.

Interface aproximada (a forma exata fecha na implementação/TDD):

```ts
GeradorVariacoes({
  gruposTamanho: GrupoTamanho[],
  cores: Set<string>, tamanhos: Set<string>,
  onMudarCores: (cores: Set<string>) => void,
  onMudarTamanhos: (tamanhos: Set<string>) => void,
})
// dialog: useEffect/memo chama reconciliarGrade() a cada mudança de cores/tamanhos/removidas
```

**Passo 3 — a grade em si (lista, não matriz):** uma linha por combinação, no mesmo componente
`LinhaVariacaoForm` de hoje, em **modo compacto por padrão** — mostra Cor · Tamanho (ex.: "Azul · M",
nunca "Variação 7"), Estoque e GTIN; os campos herdados (preço/custo/dimensão) ficam resumidos, só
expandem quando a linha tem alguma exceção. Evita repetir visualmente 6 campos em cada uma das até
60 linhas mesmo sem exigir redigitação.

**Herança é por CAMPO, não pela linha inteira.** Cada um dos 6 campos (Preço, Custo, Peso, Altura,
Largura, Comprimento) tem seu próprio estado herdado/destravado por linha — destravar só o Preço não
desvincula Custo ou Dimensão daquela mesma linha. Cada campo destravado ganha um botão **"Voltar a
herdar"**.

**Desenho interno (achado do Fable — resolver na leitura, não propagar na escrita):** a linha guarda
só os **overrides** que o operador de fato editou (`Partial<CamposHerdaveis>`), nunca uma cópia do
valor herdado. O valor efetivo de cada campo é sempre calculado por uma função pura,
`resolverLinha(cabecalho, fotoPorCor, linha)`, usada consistentemente por `montarPayload`,
`podeSalvar` e `subirLoteDeFotos`. Com isso, mudar o cabeçalho já "propaga" sozinho pra qualquer
campo sem override — não existe um evento de propagação pra disparar nem um bug de esquecer de
disparar; e "Voltar a herdar" é só apagar a chave do override. Se o cabeçalho ficar vazio/inválido
(só possível pro Preço, os únicos 5 restantes são opcionais), a linha sem override nesse campo
simplesmente resolve pra vazio — equivalente a como o formulário se comporta hoje, não é um estado
quebrado. GTIN e Estoque continuam por linha, sem herança — não existe "GTIN único" nem "estoque
único" pra um produto com várias combinações.

**Foto por cor, não por linha:** um campo de upload por cor selecionada (não por combinação), estado
`fotoPorCor: Record<string, File>` no dialog — o mesmo `resolverLinha(cabecalho, fotoPorCor, linha)`
da herança de preço resolve a foto efetiva de cada linha (override individual, se o operador destravou
aquela linha, senão a foto da cor). Na hora de enviar, `subirLoteDeFotos` recebe a foto já resolvida
por linha — sem nenhuma mudança de contrato nesse mecanismo, só a UI resolvendo o valor antes de
chamar. Cada linha ainda guarda sua própria foto no banco (mesmo arquivo enviado uma vez por SKU que
compartilha a cor) — aceito como trade-off simples; não há necessidade de deduplicar armazenamento
pra fotos de produto (confirmado sem risco de publicação: roupa/calçado publica via User Products, 1
item por SKU, sem a restrição "mesma foto pra toda a família" que `variations[]` legado teria).
Reenvio de foto que falhou no upload em lote reaproveita o upload manual avulso por variação que o
dialog atual já tem — nada novo a construir aqui.

**Numeração de calçado sabidamente não publicável no ML** (pares como `"33/34"`, ou feminino
`45`/`46` — já documentados em `tipos-produto-valores.ts` como fora de `COMPRIMENTO_PE_CM`) ganha um
aviso inline junto ao checkbox no passo 2, tipo "cadastrável, mas hoje não publica no Mercado Livre" —
sem bloquear a seleção (o cadastro em si pode servir só pra controle de estoque, nem toda linha
precisa ir pro ML). Mesmo espírito da remoção do Tamanho Único, mas sem remover a opção da lista
porque aqui, ao contrário do Tamanho Único, a numeração existe de verdade fisicamente — só falta o
ML aceitar. **O aviso depende do Gênero do cabeçalho** (45/46 só ficam fora da tabela pra feminino —
`COMPRIMENTO_PE_CM.feminino` para em 44, `COMPRIMENTO_PE_CM.masculino` vai até 48) — recalcula sempre
que o Gênero muda, não é uma lista estática por numeração.

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

### 6. Órfãos a limpar (achado do Fable)

Depois do revert de `dialog-cadastro-produto.tsx` e da remoção do Tamanho Único, ficam órfãos:
- `gruposTamanho` como prop de `LinhaVariacaoForm` (só existia pro caminho de grade, que sai dali).
- `linha-variacao-tamanho.test.tsx` (testa exatamente esse prop).
- Descrição de `tipos-produto.ts:29` que cita "Tamanho Único" — atualizar o texto.
- Conferir/ajustar: `tamanhos.test.ts:9,75,81`, `tipo-produto.test.ts:41`, `processar.test.ts:356`,
  `dialog-cadastro-produto.test.tsx:906` (todos citam Tamanho Único ou o layout antigo do dialog).
- **Checar por SQL (read-only) se existe alguma `variacoes.tamanho = 'Tamanho Único'` já gravada**
  (o próprio Diego testou o cadastro antes de pedir a remoção) — vira dado morto sem problema, não
  precisa de migration nem limpeza, só é bom saber que existe antes de estranhar no banco depois.
- **ADR-0166 ganha uma nota de amendment**: o eixo Gênero/Tamanho/Cor sai do dialog de cadastro
  normal e vira uma tela própria — decisão original (`temEixoTamanho` condicional no mesmo dialog)
  revisada por este design.

## Abordagens consideradas

1. **Esta (recomendada).** Lista + geração automática (já existente, comprovada pelo padrão de
   mercado) + herança de campo único com destrava por linha + foto por cor. Reaproveita
   `cadastrarProduto`/`subirLoteDeFotos` (edge/mecanismo de upload sem mudança de contrato) e os
   helpers de `LinhaVariacaoForm` (`erroCampo`, `parseNum`) — mas exige extrair um hook
   `useCadastroProduto()` + `EtapaFotos` compartilhados (achado do Fable) pra não duplicar a lógica
   de upload/retry/409 do dialog atual, e um `LinhaGradeForm` próprio pro layout de linha da grade.
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
- `reconciliarGrade(cores, tamanhos, removidas, linhasAtuais)` (função pura, testável isolada):
  marcar cor/tamanho a mais devolve só as combinações que ainda não existiam em `novas`; desmarcar
  devolve as combinações daquela seleção em `remover`; combinação já existente marcada de novo não
  duplica; combinação removida manualmente NÃO reaparece em `novas` enquanto os dois eixos
  continuarem marcados; desmarcar um eixo inteiro e remarcar LIMPA a exclusão daquele eixo em
  `removidas` (a combinação volta); cor sem tamanho (ou vice-versa) não gera nada; total
  (cartesiano − removidas) acima de 60 marca o próximo clique como bloqueado.
- `resolverLinha(cabecalho, fotoPorCor, linha)` (função pura): sem override, resolve pro valor do
  cabeçalho/foto da cor; com override, resolve pro valor próprio da linha; cabeçalho mudando depois
  não afeta campo com override; "Voltar a herdar" limpa o override e volta a resolver do cabeçalho.
- `useCadastroProduto()` (hook extraído): mesmo comportamento de hoje pros dois dialogs — upload em
  lote com retry, tratamento de 409 (`ProdutoJaExisteError`/`CadastroResultadoAmbiguoError`),
  `chaveCadastro` estável entre tentativas; cobertura via os testes já existentes de
  `dialog-cadastro-produto.test.tsx`, migrados pro hook sem perder nenhum caso.
- `dialog-cadastro-produto.tsx` (revertido): sem Gênero/Tamanho/grade pra nenhuma org, mesmo com
  `roupa`/`calcado` habilitado — comportamento agora é sempre igual ao de uma org sem nenhum tipo.
- `dialog-cadastro-grade.tsx` (novo, orquestra os testes acima em conjunto):
  - org com só 1 tipo habilitado pula o passo 0; org com os 2 tipos vê a escolha Roupa/Calçado;
    trocar o tipo depois de já ter linhas reseta a seleção (com confirmação se havia dado);
  - com o módulo fiscal ativo, o passo fiscal aparece e é obrigatório, igual ao dialog atual;
  - aviso de numeração não publicável aparece/some ao trocar o Gênero do cabeçalho;
  - controles de adicionar/remover/destravar linha ficam desabilitados durante `salvando=true`.
- Fluxo completo (`processar.test.ts` da edge `cadastrar-produto`, se necessário): payload final
  enviado pela tela de grade é campo a campo idêntico ao que a edge já aceita hoje — nenhuma mudança
  de contrato na edge.
