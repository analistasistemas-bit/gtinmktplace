# ADR-0166 — Tipo de produto (roupa / calçado) por organização, combinável e aditivo

**Status:** Aceito
**Decisor:** Diego, 2026-09-18
**Relacionado:** [ADR-0004](0004-atribuicao-de-cor.md) (atribuição de cor), [ADR-0115](0115-eixo-de-variacao-nao-e-sempre-cor.md) (o eixo de variação nem sempre é cor), [ADR-0047](0047-operacao-compartilhada-rbac-menu.md) (módulos por organização), [ADR-0094](0094-estoque-unico-cadastro-manual.md) (cadastro manual), [ADR-0155](0155-central-organizacoes-cobranca-auditavel.md) (régua de cobrança), [ADR-0043](0043-fluxo-canonico-de-migrations.md) (canal único de migrations), [glossário — Domínio de produto](../reference/glossario.md), [plano](../superpowers/plans/2026-09-18-variacao-tamanho-numeracao-roupa-calcado.md), migrations `20260919105517_adr166_tipos_produto_por_org.sql`, `20260919110930_adr166_ajustes_revisao.sql`, `20260919114029_adr166_genero_e_tamanho.sql`

## Contexto

O modelo de variação do PubliAI é **cor**. Uma família vira um anúncio, e cada variação dentro dele é
um SKU identificado pela cor (ADR-0004 resolve a cor da variação; ADR-0115 reconheceu que o **rótulo**
do eixo nem sempre é "Cor" ao escrever o texto do anúncio, mas o eixo estrutural continuou sendo um
só). Isso atendeu aviamentos, que foi o escopo do MVP, e nunca precisou de um segundo eixo.

Roupa e calçado não cabem nesse modelo. Uma camisa varia por cor **e** tamanho; um tênis, por cor **e**
numeração. O SKU real é o par, não a cor. A organização piloto deste segmento é nova, não tem ERP e
não opera por planilha — cadastra produto pela própria UI — e vende roupa. Calçado entra junto como
segundo tipo porque a estrutura é a mesma (um eixo adicional de lista fixa) e porque quem vende roupa
costuma vender sapato também: qualquer classificação **exclusiva** (um enum, uma escolha única por
organização) quebraria no primeiro cliente que vendesse os dois. Hoje não existe cliente de calçado
real para calibrar a lista de numeração contra as categorias do ML — calçado nasce preparado, não
validado.

A decisão foi tomada em sessão de grilling/domain-modeling com o dono do produto em 2026-09-18, e o
vocabulário que ela fixou está registrado em [`docs/reference/glossario.md`](../reference/glossario.md),
seção "Domínio de produto" (verbetes **Tipo de produto habilitado**, **Tamanho (roupa)**,
**Numeração (calçado)**, **Guia de tamanhos (roupa)**).

**Nota de numeração.** Esta entrega foi planejada como ADR-0165. Enquanto a branch estava aberta, a
`origin/main` publicou um ADR-0165 diferente ([faixas regressivas de
cobrança](0165-faixas-regressivas-por-organizacao.md)). Quem já está na `main` não renumera: o plano
inteiro foi deslocado, esta decisão é a **0166** e o guia de tamanhos via API fica com a **0167**. As
migrations e os comentários de código desta entrega já nasceram citando 0166.

## Decisão

**1. A habilitação é uma lista combinável, não um enum.** `organizations.tipos_produto_habilitados`
é `text[] not null default '{}'`, com os valores `'roupa'` e `'calcado'` (sem acento no identificador;
o rótulo exibido é "Calçado"). Uma organização pode ter os dois ao mesmo tempo. Quem liga e desliga é
o super-admin, pela central de organizações.

**2. Tipo de produto não é módulo, nem no banco nem na tela.** A coluna é separada de
`modulos_habilitados`, e na UI o card fica fora da lista de módulos pagos
(`src/components/platform-admin/org-settings.tsx` — mesma tela, mesmo estilo, grupo próprio). **Módulo** é acesso pago a uma tela inteira — Estoque, Pulse, Fiscal (ADR-0047) — e
entra na régua de cobrança do ADR-0155. **Tipo de produto** muda a estrutura do cadastro (o SKU passa
a ser cor × tamanho) e não é cobrado. Misturar os dois faria o super-admin ligar um "módulo" que não
gera fatura, e esse item apareceria na cobrança.

**3. Lista vazia significa "nada muda" — e isso é invariante do sistema, não default.** Toda
organização em produção hoje tem `'{}'`, e nenhuma tem o array preenchido. Não há valor default
diferente de vazio e **não há backfill**. Toda leitura do campo é condicional: UI, edge, payload de
publicação e payload de UPDATE de uma organização sem tipo habilitado são idênticos aos de antes
desta entrega. Ausência de tipo é ausência de feature, nunca "o tipo razoável".

**4. O dado de produto entra só pelo cadastro manual.** `familias.genero` e `variacoes.tamanho` são
gravados pelo cadastro manual (ADR-0094). A planilha (`ingest-lote`) fica **registrada como feature
futura**, não como pendência: a organização piloto não tem ERP e não opera por planilha, então
construir o suporte agora seria especulação sem cliente real contra o qual validar. Família vinda de
planilha continua nascendo com as duas colunas nulas, deliberadamente.

As duas colunas guardam o **valor do operador** (`'masculino'`, `'P'`, `'42'`), nunca o `value_id` do
ML — o id é detalhe do canal, varia por categoria e é resolvido na publicação, o mesmo padrão já usado
para cor (ADR-0004).

## Alternativas descartadas

**Enum exclusivo (`tipo_produto` com um valor por organização).** Mais simples de validar e de exibir,
mas erra o domínio: o primeiro cliente que vender roupa e sapato exigiria ou uma segunda organização,
ou uma migração de tipo para array com dado já em produção. O custo de começar em `text[]` é
praticamente zero; o de sair do enum, não.

**Reaproveitar `modulos_habilitados`.** Economiza uma coluna, uma RPC e um card. Descartado pelo
efeito colateral do ADR-0155: tudo que é módulo é candidato a faturamento, e tipo de produto não é
cobrado. A economia seria de estrutura, e o preço, uma linha errada na régua de cobrança.

**`CHECK` de valores no banco, em vez de whitelist na edge.** Um `CHECK` sobre array obriga migration a
cada valor novo de tipo de produto, e `modulos_habilitados`/`canais_habilitados` já seguem o padrão
oposto (whitelist na edge `usuarios`). Mesma razão vale para `variacoes.tamanho`, cuja lista de
numeração ainda vai ser calibrada contra a categoria real do ML. `familias.genero` é a exceção
deliberada: são três valores fechados e o ML exige que o gênero do anúncio bata com o da tabela de
medidas — valor errado ali derruba a publicação inteira, então a trava fica no banco, num `CHECK`
nomeado (`familias_genero_valido`).

**Domínio de `genero` é v1, não o conjunto completo do ML.** O `CHECK` cobre só
`'masculino'|'feminino'|'unissex'` — os três valores que a organização piloto usa. A tabela de
medidas do Mercado Livre e o atributo `GENDER` do canal têm um domínio maior (inclui infantil:
meninos, meninas, bebês), e uma organização de roupa pode vender linha infantil. Alterar o `CHECK`
depois é `drop constraint` + `add constraint`, uma migration pequena — não vale alargar o domínio
hoje sem cliente real do segmento infantil para validar contra.

## Consequências

- `familias.genero` e `variacoes.tamanho` passam a existir para toda organização, e nascem `null` em
  toda linha existente. Fora dos tipos habilitados elas permanecem nulas — é esse `null` que carrega a
  invariante da Decisão 3 no dado de produto.
- **`resolverEixoVariacao` (ADR-0115) continua intocado**, e os dois conceitos não competem. O eixo do
  ADR-0115 é derivado do **sufixo textual** do nome da variação e serve para a geração de COPY
  (`_shared/ai/eixo-variacao.ts`, consumido só pelo `copywriter-prompt.ts`): é um rótulo para o texto
  do anúncio. O tamanho deste ADR é um eixo **estrutural** do SKU, gravado em coluna própria e emitido
  no payload do canal. Quem ler os dois ADRs não deve confundi-los — nenhum substitui o outro.
- O payload de publicação do ML (`attribute_combinations`) precisará aceitar COLOR **+** SIZE_GRID
  quando houver tamanho. É trabalho de fase futura, dependente do guia de tamanhos (ADR-0167), e não
  faz parte desta decisão. Sem tamanho, o payload sai byte a byte igual ao de hoje.
- **Kit vinculado (ADR-0151), Kit Virtual (ADR-0154), Catálogo (ADR-0021) e Pulse continuam sem
  suporte a tamanho no v1**, por decisão explícita de escopo do dono do produto. Nenhum deles ganha o
  eixo novo e nenhum deles pode quebrar por causa dele.
- **Risco conhecido e aceito, pré-existente:** a validação dos valores de
  `tipos_produto_habilitados` existe **só** na whitelist da edge `usuarios`. Não há `CHECK` na coluna e
  não há `revoke` de `UPDATE` em `public.organizations` para `authenticated`, então um admin da própria
  organização consegue escrever qualquer valor direto pelo PostgREST e pular a edge inteira.
  `modulos_habilitados` tem exatamente o mesmo buraco — é anterior a esta entrega e fora do escopo
  dela. Vira decisão separada com o dono do produto. O comentário da coluna foi corrigido para não
  prometer uma trava que o banco não dá.
- A RPC de leitura `tipos_produto_da_org()` devolve `'{}'` também quando **não há linha** (perfil sem
  organização, sessão de suporte expirada), não `null`: o `coalesce` envolve a subquery inteira. Sem
  isso o front receberia `null` e teria um terceiro estado além de "vazio" e "habilitado".

## Amendment (2026-09-19) — o eixo de grade saiu do dialog de cadastro normal

A decisão original punha Gênero, Tamanho/Numeração e o gerador de variações **dentro** do dialog
de cadastro existente, condicionados a `temEixoTamanho`. Depois de a org piloto cadastrar e
publicar de verdade (uma jaqueta e uma sandália), o dono do produto apontou três problemas: o
formulário misturava perguntas de grade com as de produto simples, preço/custo/dimensão tinham
de ser revisados em cada uma das até 60 linhas, e "Tamanho Único" continuava sendo oferecido.

Fica revisado assim, conforme
`docs/superpowers/specs/2026-09-19-cadastro-grade-roupa-calcado-design.md`:

- O cadastro em grade ganha **tela própria** (`src/components/estoque/dialog-cadastro-grade.tsx`),
  aberta por um segundo botão em Estoque que só aparece para org com tipo habilitado.
  `dialog-cadastro-produto.tsx` volta ao formato de antes deste ADR — sem Gênero, sem Tamanho,
  sem `GeradorVariacoes`, para qualquer org.
- Preço mínimo (líquido), custo e as 4 dimensões passam a ser **preenchidos uma vez** no
  cabeçalho e herdados por linha, com destrava e "Voltar a herdar" por campo. A herança é
  100% de frontend: o payload enviado à edge continua idêntico, campo a campo, por variação.
- `'Tamanho Único'` sai de `TAMANHOS_ROUPA`. O Spike 051 §12 confirmou por chamada real que o ML
  não tem guia de tamanhos para esse valor nos domínios de vestuário suportados — publicar com
  ele falha sempre. Como a lista é a whitelist que a edge `cadastrar-produto` valida, a remoção
  também recusa o valor vindo de aba antiga ou retry, com erro claro.

O que **não** muda: o modelo de dados (`familias.genero`, `variacoes.tamanho`,
`organizations.tipos_produto_habilitados`), a RPC `tipos_produto_da_org()`, o *mecanismo* de
validação de backend (a edge `cadastrar-produto` continua validando contra uma whitelist — só a
LISTA que a whitelist usa mudou, com a saída de `'Tamanho Único'`) e a publicação com guia de
tamanhos (ADR-0167). Nenhuma migration.

## Amendment (2026-09-19b) — a grade é apresentada em matriz, não em lista de cards

O amendment anterior criou a tela própria de cadastro em grade com uma linha (card) por SKU. Com
a tela rodando, o dono do produto apontou que preencher 12 a 60 cards verticais é longo e
repetitivo: o operador repete o mesmo gesto por combinação e perde a visão do conjunto.

Fica revisado assim, conforme
`docs/superpowers/specs/2026-09-19-cadastro-grade-matriz-design.md` e o plano
`docs/superpowers/plans/2026-09-19-cadastro-grade-matriz.md`:

- A etapa de preenchimento da grade é uma **matriz Cor × Tamanho** (linhas = cores, colunas =
  tamanhos), com abas de modo (Estoque / GTIN / Preço / Custo), totais por linha, por coluna e
  geral, navegação por teclado, preenchimento em massa por escopo (toda a grade / uma cor / um
  tamanho) e um drawer "Detalhes do SKU" para os 6 campos herdáveis. `linha-grade-form.tsx`
  deixa de existir.
- A herança por campo continua exatamente a mesma decisão do amendment anterior — muda só como
  ela aparece: o cadeado por campo vira valor em cinza na célula (com botão de voltar ao herdado
  quando há override) e um par de radios "Herdar do produto" / "Usar valor específico" no drawer.
- Uma regra de herança fica explícita porque a matriz a torna alcançável: **apagar o conteúdo de
  uma célula não volta a herdar** — vira override vazio. Voltar a herdar é sempre ação explícita.
  É a mesma regra que `resolverLinha` já aplicava a `foto` (a presença da chave em `overrides` é
  a decisão do operador, não o conteúdo).
- Bug latente corrigido junto: os eixos passam por `ordenarEixos` antes de `reconciliarGrade`, e
  a grade deixa de seguir a ordem de CLIQUE do operador. Em lista de cards isso passava
  despercebido; em colunas de matriz "G, M, P" é visivelmente errado — e a ordem também define a
  sequência dos códigos de SKU reservados.

O que **não** muda: o modelo de dados, `resolverLinha`/`reconciliarGrade` (assinatura pública
intacta), o payload enviado à edge `cadastrar-produto` (continua um valor resolvido por variação,
campo a campo), o teto de 60 variações (ADR-0094), a revisão humana antes de publicar e a
validação de whitelist no backend. Nenhuma migration.

Ficou fora, por decisão: colar da área de transferência, seleção múltipla de células, validação de
dígito verificador de GTIN, estado de salvamento por célula e edição de grade já publicada.

## Amendment (2026-09-24c) — grade publicada passa a ser operável pela tela Estoque

O amendment 2026-09-19b deixou "edição de grade já publicada" fora. A auditoria da tela Estoque
(2026-09-24) mostrou o custo disso: "Adicionar variação" abria o dialog só de cor e a edge recusava
com 400 depois de o operador preencher tudo, e lista, Entrada, Ajuste e Movimentos não exibiam o
tamanho — cinco SKUs "Preto" indistinguíveis na hora de dar entrada.

Fica revisado assim, conforme `docs/superpowers/specs/2026-09-24-estoque-grade-operacao-design.md`:

- **Acrescentar** cores e/ou tamanhos a uma família de grade publicada entra no escopo, pelo fluxo do
  ADR-0129 (lote de UPDATE direto, sem Revisão), com tela própria que estende a matriz Cor × Tamanho
  com as células publicadas travadas. Só os SKUs novos vão ao ML (`preservarPublicadas`, ADR-0160/I10).
- Os códigos dos SKUs novos de grade são reservados pelo sistema (`proximo_codigo_produto`), como no
  cadastro em grade; o fluxo sem tamanho continua pedindo o código digitado.
- A trava da edge `adicionar-variacoes-familia` passa a recusar só família com tamanho **fora** de User
  Products — pelo ADR-0167 grade sempre publica em UP, então a trava fica como guarda, não como caminho.
- `SIZE`, `SIZE_GRID_ID` e `SIZE_GRID_ROW_ID` deixam de ser herdados da ficha do item irmão no UPDATE
  UP: são por SKU, como `COLOR`/`GTIN`. Sem isso o SKU novo nasceria com o tamanho do irmão.
- As telas do Estoque exibem `cor · tamanho` onde identificam uma variação.

Continua fora: mudar o tamanho de SKU existente, remover SKU da grade, editar preço ou atributo das
irmãs por este fluxo, grade via planilha. A invariante da Decisão 3 não muda: produto sem tamanho
segue byte a byte igual.

## Como reverter

Remover as colunas `familias.genero`, `variacoes.tamanho` e
`organizations.tipos_produto_habilitados`, mais a função `tipos_produto_da_org()`. Nenhuma
organização em produção tem o array preenchido e as duas colunas de produto são nulas em todas as
linhas, então a reversão não perde dado. Migration antiga nunca é editada (ADR-0043): a reversão é
uma migration nova.
