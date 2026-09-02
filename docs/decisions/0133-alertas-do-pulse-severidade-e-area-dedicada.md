# ADR-0133 — Alertas do Pulse: severidade gravada e área dedicada

**Status:** Aceito — design fechado em entrevista (brainstorming + revisão adversarial, 2026-08-25); backend em produção desde 2026-08-25 (migration aplicada, `pulse-coletar` v26), frontend em implementação
**Data:** 2026-08-25
**Relacionados:** ADR-0119 (Pulse v1), ADR-0130 (concorrentes relevantes), ADR-0086 (config org-scoped)

## Problema

O painel de alertas do Pulse é uma lista corrida no topo da aba Radar. Com 228 produtos no radar
ele já ocupa a tela inteira; o operador pediu uma área dedicada antes de a base chegar a milhares
de produtos.

Medições na produção em 2026-08-25, antes de qualquer desenho:

| Medida | Valor |
|---|---|
| Produtos no radar | 228 (217 Avil + 11 DSA); 180 com ofertas ativas; 95 com `meu_preco` |
| Alertas gerados | 262 em 10 dias — ~26/dia, pico 42/dia |
| Taxa | **0,11 alerta por produto por dia** |
| Não lidos no momento da medição | 145, espalhados em 60 produtos |
| Distribuição por tipo | `concorrente_saiu` 48% · `novo_concorrente` 35% · `preco_caiu` 17% |
| Duplicatas com payload idêntico | 22 de 262 (8%) |

A projeção pela taxa medida: 2.000 produtos → ~230 alertas/dia; 5.000 → ~570/dia.

**O achado que decide o desenho:** dos 44 `preco_caiu`, 24 eram de produto sem preço nosso (não
vendemos o item) e 10 continuaram acima do nosso preço — só 10 colocaram um concorrente abaixo de
nós. Dos 91 `novo_concorrente`, apenas 4 entraram abaixo do nosso preço. Somando,
**14 de 262 alertas (5%) exigiam decisão do operador**. Na escala de 2.000 produtos isso é ~12 por
dia — uma lista curta, não uma parede.

O problema, portanto, não é só onde os alertas moram: é que 95% deles não pedem nada de ninguém e
disputam a mesma atenção dos 5% que pedem.

Dois defeitos colaterais foram medidos no mesmo levantamento:

- O cabeçalho "N alertas novos" **mente**: `fetchPulseAlertas` tem `.limit(20)` fixo e o componente
  renderiza `lista.length`. No dia da medição dizia "20" com 145 não lidos. (A ação de "Limpar
  todos" está correta — ela marca todos os não lidos, não só os 20 exibidos. Só o rótulo mente.)
- A notificação por Telegram dispara com `alertasTotal > 0` e diz "abra o menu Pulse para agir",
  sem distinguir severidade — hoje ~95% dessas notificações levam a um radar onde não há nada a
  fazer.

Uma suspeita inicial de que os alertas ignoravam a qualificação do ADR-0130 foi **refutada** pela
leitura do código: `entradaDiffRelevante` (`_shared/pulse/diff.ts`) filtra as ofertas relevantes
nos dois lados antes do diff que gera alerta. D-1 do ADR-0130 está implementado.

## Decisão

| # | Decisão | Racional |
|---|---|---|
| **D-1** | **Severidade `acao` \| `info` gravada na linha do alerta**, escrita pelo coletor e **congelada no instante do evento**. Nunca recalculada na leitura. | Um alerta de 18/08 classificado contra o preço de 25/08 afirmaria uma decisão que não existia quando o evento ocorreu. Severidade congelada também torna a coluna indexável e a contagem barata. |
| **D-2** | **Regra de severidade**: `preco_caiu` → `acao` quando o menor relevante ficou abaixo do nosso `meu_preco`; `novo_concorrente` → `acao` quando a oferta relevante entrou abaixo do `meu_preco`; `concorrente_saiu` → `acao` quando quem saiu estava abaixo do `meu_preco` **e**, depois da saída, nenhum relevante restante está abaixo dele; **`meu_preco` nulo → sempre `info`**. | Alerta é o que muda uma decisão de preço. `concorrente_saiu` entra pelo caso oposto ao dos outros dois: quem saiu era quem nos segurava embaixo, e permanecer no preço antigo é deixar margem na mesa — subir preço é decisão. Sem `meu_preco` não vendemos o item; não há decisão a tomar. |
| **D-3** | O `meu_preco` que alimenta a regra viaja **em memória** no `AlertaPendente`, colhido no mesmo snapshot da ficha que trouxe as concorrentes. Proibido reler `pulse_produtos` no passo de alertas. | É o mesmo instante de leitura das ofertas — atomicidade sem transação. Reler o banco herdaria o `update` de `pulse_produtos` que hoje não checa erro: uma falha silenciosa ali classificaria o alerta contra o preço da execução anterior. |
| **D-4** | Os alertas informativos **continuam sendo gravados**, acessíveis por filtro na área dedicada. | O ADR-0119 vendeu acumular histórico de mercado; descartar quem entrou e quem saiu de cada ficha destruiria exatamente esse ativo. Classificar custa uma coluna; apagar é irreversível. |
| **D-5** | **Área dedicada como terceira aba do Pulse** (`Radar · Sonar · Alertas`), roteada pelo `?tab=` que a página já usa. O painel some da aba Radar, **sem faixa substituta**. | O alerta descreve um produto do radar; separá-lo num item de menu próprio o afasta do seu contexto. O badge na própria aba comunica pendência a 40px de distância, sem estado a sincronizar. |
| **D-6** | **O badge conta alertas de `acao` não lidos** — não o total de não lidos. A aba abre no filtro Ação e o seu estado vazio aponta explicitamente para "Informativo (N)" e para o KPI "Mais caro que o mercado". | Badge com o total traria a parede de texto de volta como número. Badge com ação nasce em `0` após o backfill (D-8) e ficaria dias assim na taxa medida: sem um estado vazio que explique onde o resto está, o operador conclui que o módulo quebrou. |
| **D-7** | **Toda contagem exibida vem de `count: 'exact', head: true`**, separada da query de página, que passa a usar `.range()` com "carregar mais". Fim do `.limit(20)` com `lista.length` no rótulo. | Um número exibido tem de ser o número verdadeiro. O teto de leitura é da página, não da contagem. |
| **D-8** | A coluna nasce `not null default 'info'` com `check (severidade in ('acao','info'))`; os alertas já existentes ficam **todos** como `info`, sem `UPDATE` de backfill. | Classificar 262 linhas históricas contra o preço de hoje contradiz D-1. O default resolve o backfill na própria migration, e essas linhas serão marcadas como lidas em um dia de uso. |
| **D-9** | O escopo de "Marcar N como lidos" só admite **colunas locais de `pulse_alertas`** (`severidade`, `tipo`, `lido`). Busca por título de produto **não existe** na área. | O `update` do PostgREST não filtra por coluna de recurso embutido (`pulse_produtos.titulo`). Uma busca no escopo do marcar ou apagaria alertas que o operador não viu, ou marcaria só os carregados e mentiria no N — as duas saídas são piores que não ter busca. |
| **D-10** | A notificação por Telegram passa a distinguir severidade: "para agir" só quando houver `acao > 0`; caso contrário, texto neutro. O texto de ação cita a aba Alertas por escrito — **sem deep-link**: `notificacoes` grava só `user_id, org_id, categoria, texto`, e o Telegram recebe texto puro. | Uma notificação que promete ação e entrega uma lista informativa treina o operador a ignorá-la — e a próxima, que era real, morre junto. |

## Errata 1 (2026-08-25, revisão do diff da Task 1 — antes do deploy) — ausência de dado não aprova

D-2 tratava "nenhum concorrente relevante restante" como o caso mais forte de `acao`: não sobrou
ninguém para nos furar, logo dá para subir preço. **Está errado**, e o defeito é financeiro.

A lista relevante fica vazia por dois motivos que ela não distingue:

1. a ficha realmente esvaziou;
2. ninguém pôde ser **qualificado** nesta rodada — vendedor visto pela primeira vez no tier quente
   ainda não tem linha em `pulse_vendedores` (o passo de vendedores só roda no tier completo), ou a
   ficha foi truncada no `limit=100` e a oferta mais barata não foi lida.

No caso 2 o concorrente continua vendendo abaixo de nós. Cenário concreto: nosso preço R$90, ontem
relevantes a R$80 e R$85; hoje o de R$80 sai e o de R$85 aparece sem perfil. A regra original
classificaria `acao`, a notificação diria "exige decisão de preço", e o operador subiria o preço com
alguém vendendo mais barato — perdendo posição de venda.

**Correção — são duas condições, uma para cada motivo acima:**

1. Contra a não-qualificação: a aprovação exige que a ficha não tenha trazido **nenhuma oferta
   observada**, contada **antes** da qualificação e não depois.
2. Contra o truncamento: a aprovação exige que a ficha tenha sido **lida por inteiro**. Não basta
   `ofertasNaoLidas() === 0` — essa função devolve `0` tanto para "li tudo" quanto para "a resposta
   não trouxe `paging`", ambiguidade inofensiva num aviso de log e inaceitável numa resposta que
   autoriza subir preço. A checagem exige o `paging.total` explicitamente.

Sem qualquer uma das duas informações, o padrão é **não aprovar** — inclusive quando o menor preço
lido está acima do nosso, porque numa ficha truncada esse "menor" é só o menor da página lida.
Ausência de dado nunca aprova — a mesma doutrina que já
valia para `meu_preco` nulo, e o espelho do D-3 do ADR-0130 ("ausência de dado nunca reprova
sozinha"): aqui, ausência de dado nunca *aprova* sozinha.

## Errata 2 (2026-08-25, revisão do front) — o "Marcar N como lidos" tem teto

O diagnóstico acima afirma que "a ação de 'Limpar todos' está correta — ela marca todos os não
lidos". Deixou de ser literal na implementação: `marcarAlertasLidos` recebe uma âncora
`ateCriadoEm` e aplica `.lte('criado_em', ateCriadoEm)` com o `criado_em` do alerta mais **novo** já
carregado na tela (a lista vem em ordem decrescente, então é a primeira linha).

**Motivo:** contar e marcar são duas idas ao banco, e o coletor roda em cron. Sem teto, um alerta
inserido entre a contagem que o operador leu e o clique casaria `lido = false` e sumiria sem nunca
ter existido para ele — e o número que o botão anunciou não seria o número marcado.

**Invariante real: "nada mais novo do que o operador viu"** — não "nada que o operador não viu". O
teto exclui apenas o que for mais novo que a primeira linha; tudo o que for mais antigo é marcado,
**inclusive as páginas que ninguém rolou**. Isso é intencional. A âncora protege contra a corrida
com o coletor, não contra a paginação.

**O rótulo e o clique podem divergir, e a diferença é sempre para menos.** `contarPulseAlertas` não
aplica a âncora (ela nem existe no momento da contagem) e `marcarAlertasLidos` aplica: um alerta que
o coletor insira entre a contagem e a leitura da lista entra no número do botão e fica fora do
`.lte('criado_em', …)`. Na prática o rótulo diz "Marcar 150" e o clique marca 145, com os 5 restantes
continuando na tela depois do refetch. É o trade-off aceito do D-7: preferimos deixar a mais do que
apagar em silêncio um alerta que nunca existiu para o operador. Fechar a janela exigiria contar e
marcar na mesma transação, e com ~12 alertas de ação por dia isso não se paga.

## Errata 3 (2026-09-01, validação na org real) — `preco_caiu` grava uma vez por dia

Nove alertas na tela eram quatro produtos. A medição em produção achou a mesma queda
(`de=71.99`, `para=68.99`, produto `a00c41cc…`) gravada **duas vezes no mesmo dia** — 00:00:08 e
18:00:06 UTC — sem nenhuma escrita nova em `pulse_ofertas` entre as duas: o preço não se mexeu.

**Mecanismo.** Dentro de uma mesma execução, o lado `anteriores` do diff qualifica com o
`visitas_30d` **congelado** na linha gravada e o lado `atuais` com visitas **buscadas ao vivo**.
Um concorrente com zero visitas congelado cai como `fora_referencia` no "antes" e volta no
"agora": o mínimo "antes" sobe para o do item parado, o mínimo "agora" é o dele, e a mesma queda
é redetectada. `pulse_ofertas` absorvia isso por já ser idempotente em `(produto_id, item_id,
dia)`; `pulse_alertas` não tinha chave nenhuma e cada redetecção virava linha.

**Decisão: tratar o sintoma, não a régua.** A qualificação de relevância é decisão registrada
(ADR-0130 e este ADR) e mudá-la exige ADR novo e re-validação — trocar a régua para calar um
alerta repetido é o tipo de conserto que apaga queda real junto. O que muda é a gravação:
`preco_caiu` passa a ser idempotente por (produto, par `de`/`para`, **dia civil UTC**), em duas
travas — a leitura `alertasJaGravadosHoje` descarta o repetido antes de gravar, e o índice único
das colunas geradas `(dedupe_preco_caiu, dedupe_dia_utc)` fecha a corrida entre duas execuções
simultâneas (`ignoreDuplicates`, não erro).

**Por que a janela é o dia UTC, e não o dia BRT dos vizinhos** (`pulse_ofertas.dia`,
`pulse_vendedores.dia`): o cron desta função é UTC (`0 9 * * *` e `0 */6 * * *`), então as quatro
execuções do tier quente — 00, 06, 12 e 18 UTC — caem dentro do mesmo dia UTC. Em
`America/Sao_Paulo` a das 00:00 cai no dia anterior, e o caso medido (00:00:08 e 18:00:06 UTC de
2026-08-30) viraria 29/08 e 30/08: duas janelas, duplicata não pega. O dia civil do operador é o
recorte certo para o histórico de mercado; para uma janela de idempotência, o recorte certo é o da
execução. (A imutabilidade da expressão na coluna gerada **não** entra nessa escolha:
`at time zone <zona>` torna a conversão imutável com qualquer zona literal.)

**Limites explícitos.** A janela é o dia, não "os últimos N alertas": a mesma queda em dias
diferentes é movimento real (o preço voltou e caiu de novo) e continua alertando — a mesma
medição achou dois casos assim, em 3 e em 2 dias distintos. Se a leitura de dedupe falhar, o
coletor **grava assim mesmo**: deixar de alertar por causa de uma consulta que caiu troca ruído
por silêncio, e é o silêncio que custa dinheiro. E a assimetria de visitas continua lá — o que
sumiu foi a linha duplicada, não a redetecção.

## Errata 4 (2026-09-01, validação em runtime com dados reais) — a lista é por produto, e cada linha tem idade

A ADR-0133 acertou o que é decisão (`acao`) e o que é ruído (`info`), mas mediu isso **por evento**.
Na org de validação, os 9 alertas de Ação são na prática **4 produtos**: "Aptamil Premium 1" com duas
quedas (69,80→67,99 e 70,19→67,99), "Eucerin Aquaphor" com duas (77,87→72,31 e 70,90→68,90) e
"Aptamil Premium 2" com duas quedas idênticas (71,99→68,99). A fila de trabalho do operador é de
4 itens; a tela mostrava 9.

E `criado_em` só era usado para calcular a âncora do "marcar todos" (`aba-alertas.tsx:114`): a linha
não dizia **quando**. Sem isso não dá para priorizar nem para saber se já foi reagido — e, no caso
das duas quedas idênticas, nem para distinguir reemissão de queda real.

> **Medição da investigação (Task 13 do plano 2026-09-01, consultas read-only em produção):**
>
> **(A) mesmo produto + mesmo par `de`/`para` + mesmo dia UTC, `tipo = 'preco_caiu'`, 30 dias — 1 linha:**
> `produto_id=a00c41cc-a54c-4729-b69f-07ad8b3ac519`, `de=71.99`, `para=68.99`, dia `2026-08-30` (UTC),
> `severidade=acao`, `lido=false`, `n=2`, primeiro `2026-08-30 00:00:08 UTC`, último `2026-08-30 18:00:06 UTC`.
> A reconstrução em `pulse_ofertas` mostra que às 18:00 **nenhuma linha nova foi gravada** para esse
> produto: o preço não se mexeu entre os dois alertas.
>
> **(B) alertas de Ação não lidos, por produto — 16 produtos**, de 1 a 4 alertas cada (`5fbba21c…`: 4;
> `f84c8184…`, `aa09e2a4…`, `1c3730a7…`, `65c24cbf…`, `a00c41cc…`, `f9afebe4…`: 2 cada; outros 9 com 1).
> Os "9 alertas / 4 produtos" acima são a foto anterior; esta é a de 2026-09-01, com mais dado
> acumulado. Não se contradizem — as duas medem a mesma coisa: a fila real é menor que a lista.
>
> **(C) mesmo produto + mesmo par em dias distintos — 3 linhas:** `5080f872…` 28.44→26.39 em 3 dias e
> `91cec13b…` 20.25→15.9 em 2 dias (movimento real: o preço voltou e caiu de novo) e `a00c41cc…`
> 71.99→68.99 com `dias=1` — a mesma ocorrência de (A).
>
> **Veredito: REEMISSÃO.**

### D-1 — A linha da aba Alertas é o PRODUTO, não o evento

`agruparAlertasPorProduto(alertas): GrupoAlertas[]` agrupa por `produto_id`: uma linha por produto,
com o texto do alerta **mais recente** e, quando há mais de um, `· N movimentos` — expansível para
ver os demais em ordem decrescente de `criado_em`. **A ordem da lista é a do alerta mais recente de
cada grupo, decrescente** — a mesma ordem em que `fetchPulseAlertas` já devolve as linhas.

O agrupamento é **de exibição**: nenhuma linha de `pulse_alertas` deixa de existir, e a contagem do
botão "Marcar N como lidos" continua sendo a de **alertas**, não a de grupos, porque é ela que
descreve o que o clique vai fazer no banco (D-7 e Errata 2 seguem valendo).

Isto **revoga** a consequência "Sem agrupamento por produto na lista" registrada abaixo — e responde
à objeção dela em vez de ignorá-la. O agrupamento roda **sobre as páginas já carregadas**, não no
banco: como a posição de um grupo é o seu alerta mais novo, a página seguinte ou acrescenta alertas
mais antigos a um grupo que já está na tela (posição inalterada) ou abre um grupo novo abaixo de tudo
o que veio antes. Grupo não se parte, não se duplica e não reordena a cada "Carregar mais".
Corolário para quem implementa: `N movimentos` conta os alertas **carregados** e cresce conforme as
páginas chegam — não é um total por produto vindo do banco.

Os botões da linha seguem o grupo, não o evento. `Ver produto` aparece quando o grupo tem
`produto_id` (é o mesmo para todos os alertas do grupo). `Reprecificar` aparece quando o grupo
contém **algum** `preco_caiu` com `codigo_pai` — mesmo que o alerta mais recente seja de outro
tipo — e recebe o `preco_caiu` **mais recente** do grupo, para reprecificar contra o par de preços
mais fresco. Sem isso, uma queda encoberta por um `novo_concorrente` posterior perderia o botão.

Alerta sem `produto_id` (ficha removida) não é agrupado com os outros: vira grupo de um, com a
própria chave. Juntar "sem produto" num balde só misturaria produtos diferentes numa linha.

### D-2 — Cada linha diz a idade e, na queda de preço, o quanto caiu

`idadeAlerta(criadoEm)` devolve `há 3 horas`, exibido ao lado do texto; e `-4%` aparece junto do par
de preços em `preco_caiu`. "Caiu de R$ 49,90 para R$ 47,90" obrigava a conta mental exatamente no
momento em que a decisão é tomada. O percentual é derivado do payload, não gravado: é aritmética
sobre dois números que já estão lá (`de` e `para`). Idade e percentual são os do alerta mais recente
do grupo; os demais mostram os seus quando o grupo é expandido.

### D-3 — O ✓ do grupo marca o grupo inteiro

Marcar lido um produto e ver a mesma linha voltar com o segundo evento é a definição de fila que não
anda. `marcarAlertasLidosPorIds(ids)` faz um `update … in('id', ids)` — o mesmo grant column-level em
`lido`, uma ida ao banco. **Não** é um "marcar todos" disfarçado: o escopo é o conjunto de ids
renderizados naquela linha, e nada além.

**O que o agrupamento NÃO muda** — é aqui que aparece a tentação de "consertar junto":

- **"Marcar N como lidos" pode marcar menos do que N.** A âncora continua sendo o `criado_em` da
  primeira linha carregada, e existe para proteger da corrida com o coletor, não da paginação
  (Errata 2, inalterada). O rótulo diverge para menos, e isso é o comportamento correto.
- **O distintivo da aba conta alertas de ação não lidos**, não grupos — segue `contarPulseAlertas('acao')`.
- **A primeira coleta de um produto não gera alerta** (`primeiraColeta`, ADR-0119). Um produto que
  aparece pela primeira vez não abre grupo nenhum.

### D-4 — A reemissão já está corrigida; a causa raiz é dívida conhecida

A reemissão medida em (A) foi decidida e corrigida na **Errata 3**: dedupe de `preco_caiu` por
produto + par `de`/`para` + dia civil UTC, com índice único e gravação que ignora duplicata, mais a
limpeza das reemissões já gravadas. O agrupamento desta errata não depende disso — ele resolve a
leitura dos N movimentos **reais** do mesmo produto, que continuam existindo.

**Dívida conhecida, deliberadamente não paga aqui:** a causa raiz da redetecção segue de pé. Em
`supabase/functions/pulse-coletar/processar.ts:255-262` o lado `anteriores` do diff qualifica com o
`visitas_30d` **congelado** na linha gravada, e o lado `atuais` com visitas **buscadas ao vivo**;
`qualificarOferta` (`supabase/functions/_shared/concorrencia/qualificacao.ts:25`) exclui a oferta
inteira quando `visitas_30d === 0` (`SEM_VISITAS_30D`), então o mesmo concorrente pode sair do
"antes" e voltar no "agora" sem que preço nenhum tenha mudado. Não foi corrigido de propósito: a
régua de relevância é decisão registrada (ADR-0130 e este ADR) e mexer nela exige ADR novo e
re-validação — trocar a régua para calar um alerta repetido apaga queda real junto. O dedupe trata o
sintoma; a assimetria continua lá, e quem for pagá-la abre ADR antes.

## Consequências aceitas

- **O modelo permanece evento com marcar-lido.** A alternativa (condição aberta que se resolve
  sozinha) foi apresentada com os números e recusada pelo operador. Consequência: a caixa continua
  acumulando e exigindo limpeza manual — mas com ~12 alertas de ação por dia na escala de 2.000
  produtos, não ~230.
- **O evento não mostra quem já está perdendo preço.** Na medição, 52 dos 95 produtos com preço
  nosso tinham concorrente relevante abaixo, quase todos de antes da janela observada; nenhum deles
  gera alerta hoje, porque nada mudou. Essa visão já existe e permanece sendo o caminho para ela: o
  KPI **"Mais caro que o mercado"** do Radar, que filtra a tabela. Os dois se complementam — alerta
  é transição, KPI é estado. (O KPI usa limiar de 0,5% de diferença, então sua contagem diverge
  ligeiramente do número bruto acima.)
- **A aba é a caixa de não lidos, não o arquivo.** Os informativos ficam gravados (D-4) e visíveis
  enquanto não lidos; depois de marcados, saem da tela e permanecem só no banco. Uma tela de
  histórico consultável não faz parte deste escopo — se um dia fizer, o lugar natural é o detalhe
  do produto, não esta aba.
- **Sem agrupamento por produto na lista.** Agrupar quebra com paginação por `criado_em`: o mesmo
  produto cai em páginas diferentes e o grupo se parte ou se duplica a cada "carregar mais".
- **Nome do vendedor pode faltar nos alertas históricos.** O texto do alerta passa a nomear quem
  entrou ou saiu, com o `nickname` congelado no payload, e mantém um fallback para o `seller_id`.
  O fallback **não** existe para vendedor sem perfil: `qualificarOferta` devolve `observacao`
  quando `transactions_total` é null e `entradaDiffRelevante` só deixa passar `relevante`, então
  vendedor sem linha em `pulse_vendedores` nunca chega a um payload de alerta — e na medição de
  2026-08-25 `pulse_vendedores.nickname` não tinha nenhum nulo (0 de 2.729 linhas, 470 vendedores).
  O fallback existe para os **262 alertas históricos**, gravados antes desta mudança, cujo payload
  não tem o campo `nickname`.

## Alternativas descartadas

- **Item próprio no menu lateral** em vez de aba: separa o alerta do produto que ele descreve e
  duplica o controle de módulo habilitado, sem ganho de leitura.
- **Parar de gravar os tipos informativos**: banco e código menores, ao custo de perder para sempre
  o histórico de entrada e saída de concorrentes por ficha — o ativo que o ADR-0119 justifica
  acumular.
- **Calcular a severidade na leitura**, por join com `pulse_produtos`: dispensa a migration, mas
  reclassifica o passado a cada mudança de preço nosso e impede indexar a contagem.
- **Condição aberta em vez de evento**: limitaria a lista a uma linha por produto em risco e
  dispensaria o marcar-lido. Recusado pelo operador — ver Consequências.
- **Timeline de mercado no detalhe do produto** para os informativos: é onde o dado melhor serve,
  mas custa uma tela nova; fica para depois da aba provar valor.
- **Confirmação ao marcar muitos como lidos**: marcar lido não destrói dado (o alerta continua
  visível no filtro Informativo); é atrito sem risco correspondente.

## Verificação

Nenhum destes números é estimativa — todos saíram de consulta à produção em 2026-08-25 e da leitura
do código citado. A regra de severidade tem teste unitário obrigatório em `diff.test.ts` cobrindo os
três tipos contra `meu_preco` nulo, acima e abaixo; a área dedicada tem teste de componente para o
filtro, a contagem exata e o escopo do marcar-lido.

Spec: `docs/superpowers/specs/2026-08-25-alertas-pulse-severidade-design.md`.
