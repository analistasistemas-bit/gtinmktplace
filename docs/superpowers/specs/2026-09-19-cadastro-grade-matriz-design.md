# Cadastro em grade: matriz Cor × Tamanho — design

**Status:** aprovado por Diego (autorização a priori — ver seção "Execução").
**Supersede:** a UX de linhas verticais descrita em
`docs/superpowers/specs/2026-09-19-cadastro-grade-roupa-calcado-design.md` (a parte de
apresentação apenas — modelo de dados, herança, `resolverLinha`/`reconciliarGrade`,
backend e ADR-0166/0167 continuam valendo sem alteração).

## Problema

A tela de cadastro em grade (branch `worktree-roupas-sapatos-grilling`, ainda não mergeada)
lista um card vertical por SKU (`LinhaGradeForm`, um por combinação Cor×Tamanho). Diego
validou a tela rodando e considerou a experiência longa e repetitiva para grades com várias
cores/tamanhos. Pediu uma UX tipo mini-planilha: matriz Cor×Tamanho, edição por teclado,
modos de edição (Estoque/GTIN/Preço/Custo), preenchimento em massa e detalhes do SKU em
segundo nível (drawer).

## Decisões de arquitetura (analisadas pelo Fable)

### O que NÃO muda

- `src/lib/cadastro-grade.ts`: `LinhaGrade`, `overrides: Partial<CamposHerdaveis>`,
  `resolverLinha`, `reconciliarGrade`, `CAMPOS_HERDAVEIS`, `chaveGrade`, `novaLinhaGrade`.
  A matriz é **uma view nova sobre `linhas`**, não um novo modelo de dados.
- `GeradorVariacoes` (seleção de cores/tamanhos, guarda de 60), `useCadastroProduto`,
  `EtapaFotos`, `EtapaFiscalForm`, "Foto por cor", submissão/payload (`montarPayload`
  segue mandando o valor *resolvido* por linha — nada muda no backend).
- Teto de `LIMITE_VARIACOES_GERADAS = 60` (ADR-0094) — a matriz não precisa de
  virtualização.
- Casamento posicional: `linhas[i] ↔ resolvidas[i]` continua a única fonte de verdade. A
  matriz **não tem estado próprio de linhas** — deriva `Map<chaveGrade, índice>` a cada
  render. Ordem visual não afeta o payload, só a identidade do array.

### O que muda

- `linha-grade-form.tsx` deixa de ser card; seu bloco expandido (6 campos herdáveis +
  cadeado) migra quase sem mudança para o drawer "Detalhes do SKU" (troca cadeado por radio
  herdado/específico, ver mockup do Diego).
- 3 funções puras novas em `src/lib/cadastro-grade.ts` (TDD, sonnet):
  - `ordenarEixos(cores: Set<string>, tamanhos: Set<string>, ordemCanonica: string[])` →
    `{ cores: string[], tamanhos: string[] }`. Corrige um bug latente: hoje `[...cores]`/
    `[...tamanhos]` preservam ordem de clique (marcar G antes de P lista "G, M, P"). Na
    lista de cards isso passava despercebido; em colunas de matriz fica visível e errado.
    Cores: ordem de `CORES_POPULARES` primeiro, depois personalizadas por ordem de
    inserção. Tamanhos: ordem do grupo canônico (`TAMANHOS_ROUPA` / numeração de calçado).
  - `aplicarEmMassa(linhas: LinhaGrade[], opts: { campo: 'estoqueInicial' | 'gtin' |
    CampoHerdavel; escopo: { tipo: 'todos' | 'cor' | 'tamanho'; valor?: string };
    valor: string | null }): LinhaGrade[]` — retorna novo array. `valor: null` num campo
    herdável remove o override (volta a herdar); em `estoqueInicial`/`gtin` limpa
    (`''`). Nunca gera GTIN.
  - `totaisDaGrade(resolvidas, cores, tamanhos)` → total por cor, por tamanho, geral, e
    contagem "sem GTIN" (para o resumo do topo).
- Componentes novos:
  - `matriz-grade.tsx` — `<table>` (reaproveita `ui/table`), linhas = cores, colunas =
    tamanhos + coluna Total, linha Total no rodapé. Tabs de modo (`Estoque | GTIN | Preço |
    Custo`) acima. Célula = `<Input>` com o MESMO `aria-label` que já existe hoje
    (`"${rotulo} de ${cor} · ${tamanho}"`) — preserva as 27 asserções de teste existentes
    no dialog. Cabeçalho de linha (cor) e de coluna (tamanho) são botões que abrem
    "Preencher em massa" com o escopo pré-selecionado.
  - `preencher-em-massa.tsx` — `Popover`: escopo (Todos / Uma cor / Um tamanho), campo,
    valor; para campos herdáveis, opção extra "Voltar ao herdado"; para estoque/GTIN,
    "Limpar". Sem opção de gerar GTIN.
  - `detalhes-sku.tsx` — `Sheet` (`ui/sheet.tsx`, já existe no projeto) com o conteúdo que
    hoje é o bloco expandido do `LinhaGradeForm`: campo por campo, radio "Herdar do
    produto" / "Usar valor específico" no lugar do cadeado. Reexporta/reaproveita
    `ROTULOS`.

### Comportamento de herança na célula (decisão explícita — evita ambiguidade na
implementação)

- Célula sem override: mostra o valor resolvido (herdado do cabeçalho/cor), estilo
  `muted`, sufixo "herdado" visível só quando a célula está com foco ou hover (não nas 60
  células ao mesmo tempo — sufixo permanente polui).
- Digitar numa célula herdada cria o override **com o texto digitado**, não com o valor
  resolvido — diferente do fluxo antigo do card (onde "destravar" semeava com o valor
  resolvido antes de editar). Isso é intencional: a célula já está editável por padrão, não
  existe estado "travado" prévio para semear.
- Apagar o texto de uma célula até vazio **não** volta a herdar automaticamente — vira
  override `''` (mesma regra que `resolverLinha` já documenta para `foto`: presença da
  chave em `overrides` é a decisão do operador, não o conteúdo). Voltar a herdar só por
  ação explícita: botão "Voltar ao herdado" na célula (aparece quando há override), no
  drawer, ou via "Preencher em massa" → Voltar ao herdado.
- Célula de uma combinação removida manualmente (`reconciliarGrade` a excluiu da grade)
  não vira buraco mudo: mostra um "+" para reincluir aquela combinação específica (o card
  antigo simplesmente sumia da lista; a matriz precisa de affordance porque a célula
  continua visível espacialmente).

### Teclado

`Tab` / `Shift+Tab` nativo do navegador (ordem DOM = ordem das colunas dentro de cada
linha). `Enter` confirma e move para a célula de baixo na mesma coluna. Setas movem entre
células só quando o cursor de texto está na borda do valor (não conflita com edição). Célula
ativa é rastreada via `data-r`/`data-c` + `element.focus()` no DOM — **não** via estado
React (um estado de "célula ativa" causaria rerender da matriz inteira a cada tecla).

### Ordenação de eixos (bug latente corrigido nesta entrega)

`reconciliarGrade` é alimentado por `[...cores]`/`[...tamanhos]` em ordem de `Set`, isto é,
ordem de clique. A tela atual (cards) não expõe isso. A matriz expõe imediatamente (coluna
"G, M, P" em vez de "P, M, G" se o operador clicou fora de ordem). Fix: aplicar
`ordenarEixos` antes de `reconciliarGrade`, então `linhas`/matriz/códigos de SKU seguem
sempre a ordem canônica, independente da ordem de clique.

## Escopo v1 (autorizado por Diego)

**Entra nesta entrega:**
matriz + 4 modos de edição + totais (linha/coluna/geral) + navegação por teclado (Tab/
Shift+Tab/Enter/setas) + herança visível por célula (com as regras acima) + preencher em
massa (todos/cor/tamanho, incluindo "voltar ao herdado" e "limpar") + drawer de detalhes do
SKU + célula removida com reincluir + `ordenarEixos` (fix do bug latente) + resumo do topo
com "sem GTIN" + sticky (primeira coluna + cabeçalho) + scroll horizontal para grades
largas (calçado, até 10 colunas) + regressão: os 27 testes existentes do dialog continuam
passando com os mesmos `aria-label`.

**Fica para v1.1 (fora desta entrega, com justificativa do Fable):**
- **Colar da área de transferência** (§15 do pedido original) — o próprio Diego marcou
  como opcional. Veredito do Fable: adiar, mas é o item de maior valor do v1.1 (GTIN
  costuma vir de planilha do fornecedor) e barato de implementar depois
  (`distribuirColagem` pura + `onPaste` na célula) — não é motivo para atrasar esta
  entrega.
- **Seleção múltipla de células** (§16) — os próprios exemplos do Diego (§28/§29) só usam
  escopo por cor/tamanho/todos; seleção com Shift-range é a maior fonte de estado novo e
  de poluição visual, sem uso comprovado nos fluxos reais descritos.
- **Validação de dígito verificador de GTIN** — hoje `erroCampo` não valida isso no
  cadastro (só existe checagem de formato em `_shared/concorrencia/gtin.ts`, módulo
  diferente). Fora de escopo aqui; vira aviso não-bloqueante depois, se pedido.
- **Estados de salvamento por célula** (salvando/salvo/erro de API por célula) — esta tela
  é cadastro em lote: nada persiste antes do botão final "Cadastrar". Não existe erro de
  API "naquela célula" hoje; não inventar esse estado.
- **Edição de grade já publicada** — não existe hoje (o dialog é só create). Fora de
  escopo.

## Reaproveitamento de teste

`dialog-cadastro-grade.test.tsx` e `linha-grade-form.test.tsx` (este último é substituído
por `detalhes-sku.test.tsx` e `matriz-grade.test.tsx`) já cobrem: herança/override,
`aria-label` por célula, congelamento durante `salvando`, grade parcial (linha removida na
mão). Os testes de herança e congelamento migram quase 1:1 — só troca o seletor de
`getByLabelText` de dentro de um card para dentro de uma célula de tabela.

## ADR

Amendment em `docs/decisions/0166-tipo-de-produto-por-organizacao.md`: a seção que hoje
descreve "grade vira tela própria" passa a descrever a apresentação como matriz, não lista
de cards. Nenhuma decisão de dados muda — só a UI da etapa de preenchimento.

## Execução

Diego autorizou pular o checkpoint de aprovação intermediária (a Fase 2 do pedido original
dele pedia para parar aqui — ele revogou isso nesta execução): depois deste spec e do plano
de implementação (a seguir, via `writing-plans`, revisado pelo Fable), a execução segue
direto para `subagent-driven-development` com o roteamento de modelos do CLAUDE.md do
projeto, sem novo check-in, terminando em revisão final de branch + validação visual
(Playwright, sessão própria — nunca disputar o Chrome do Diego).
