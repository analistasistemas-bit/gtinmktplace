# ADR-0133 — Alertas do Pulse: severidade gravada e área dedicada

**Status:** Aceito — design fechado em entrevista (brainstorming + revisão adversarial, 2026-08-25); backend em produção desde 2026-08-25 (migration aplicada, `pulse-coletar` v25), frontend em implementação
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
