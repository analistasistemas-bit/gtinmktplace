---
tags: [logs, changelog]
atualizado: 2026-07-12
---

# Changelog

Linha do tempo real, não redigida. Fonte: `docs/project-history.md` (curado até 2026-06-15) +
`docs/project-status.md` (snapshot mais recente) + histórico de commits na `main`. Ver
[[Sprint Atual]], [[Problemas Resolvidos]].

## 2026-07-12

- **Fix: re-ingest UPDATE republicava a foto antiga ao trocar capa/imagem (plano 031).** O re-ingest
  de planilha herdava o `picture_id` do anúncio anterior enquanto derivava o path do lote novo; como o
  `pre-subir-fotos` pula o upload quando já há id, o ML mantinha a foto cacheada — trocar a capa numa
  planilha re-ingerida publicava a imagem velha. Helper `herdarPictureId` (`_shared/update/heranca-foto.ts`):
  herda o id só sem foto nova (reposição só-planilha preserva a publicada); com foto nova, zera → força
  re-upload. Deploy `ingest-lote v39`. Ver [[Problemas Resolvidos]].
- **Perf: índice `(user_id, recebido_em)` no `ml_webhook_eventos` para o throttle do `ml-webhook`**
  (substitui o single `(user_id)`). Migration aplicada em produção. Deploy do throttle: `ml-webhook v19`
  (ACKa POSTs reais do ML com 200).
- **Chore: remove `atualizarTituloML` (dead code, 0 chamadores, plano 030)** e **religa os testes de
  `src/lib/__tests__`** (6 arquivos antes fora do include do vitest; suíte 1355→1384 verdes).
- Fecha a auditoria `improve` 017–033 (reconciliação com o `origin/main` do time + os 12 improvements
  limpos já mergeados nas sessões anteriores).

## 2026-07-11

- **Feature: notificações Telegram por destinatário e categoria (ADR-0068).** Antes o Telegram tinha
  1 destino por org (só Diego recebia tudo). Agora cada usuário cadastrado pode receber, e o admin
  escolhe **quem recebe quais categorias** (Vendas, Perguntas, Pós-venda, Financeiro, Moderação) na
  tela **Usuários** (dialog "Notificações": Chat ID + checkboxes). O bot continua único por org
  (`configuracoes`); o destino virou por profile (`profiles.telegram_chat_id`/`telegram_categorias`).
  Envio centralizado em `notificarCategoria` (`_shared/notificacoes/config.ts`); os 6 workers passam a
  informar sua categoria. Backfill preserva quem recebe hoje. Validado end-to-end no browser (login →
  editar → salvar → persistência → badges) + migration/CHECK. Testes verdes, lint/deno/build ok.
- **Feat: alerta global de "aguardando resposta" no avatar (ADR-0067 refino).** Badge no ícone do
  usuário (qualquer tela) somando perguntas pendentes + conversas cuja última mensagem é do
  comprador; some quando respondido — pelo PubliAI **ou** pelo painel do ML. Substitui o "não lida"
  (que limpava só por abrir). Só frontend.
- **Feat: mensagens pós-venda do ML no PubliAI (ADR-0067).** Mensagens do comprador (chat pós-venda,
  canal `/messages/packs`) eram invisíveis — a aba Perguntas só ingere perguntas pré-venda
  (`/questions`). Nova aba **Faturamento › Mensagens** espelhando Perguntas: worker `sync-mensagem`
  (topic `messages` no webhook), tabela `ml_mensagens`, backfill via "Sincronizar", resposta
  (`responder-mensagem`, ≤350 chars) e alerta Telegram. Validado no Supabase local via Playwright.
  Pendente deploy + habilitar topic `messages` no DevCenter ML.

## 2026-07-10

- **Fix: atributo obrigatório `string` com valores sugeridos era tratado como closed-set (Material
  faltante nos Pingentes, lote #31, ADR-0052 adendo).** Diego reportou "Atributos obrigatórios
  faltando: Material" em dois pingentes decorativos búfalo (PAI 02954524 e 02954818, categoria
  Pingentes MLB7017). Investigação: o obrigatório `MATERIAL` é `value_type=string` (texto-livre no
  ML) mas vem acompanhado de 4 valores *sugeridos* (Alpaca/Ouro/Prata/Vidro). Causa raiz: `tipoAlvo`
  (`_shared/ai/atributos-llm-core.ts`) decidia o tipo por `valores.length > 0` **antes** de olhar
  `valueType`, classificando o atributo como closed-set estrito — a IA era instruída a escolher só
  entre as 4 sugestões e a regra de ouro anti-invenção (`validarTextoLivre`, ADR-0052) nunca rodava.
  Resultado: "poliéster", presente na descrição do 14,5cm ("FABRICADO EM 100% POLIÉSTER"), era
  descartado por não estar entre as sugestões. Fix: `value_type=string` é sempre texto-livre (os
  `values` são sugestão, não lista fechada — essa é `value_type=list`) → passa pela regra de ouro e
  aceita o valor extraído do texto. Vale para qualquer atributo string obrigatório de qualquer
  categoria; sem regressão para `list`/`number`. +4 casos em `atributos-llm.test.ts` (38 verdes no
  arquivo, 203 no conjunto ai+categoria), lint limpo. Deploy confirmado (`process-familia` v84,
  `definir-categoria-familia` v15, `verify_jwt` conferido). Famílias do lote #31: 02954818 resolvido
  (Material=Poliéster, dado real da descrição, ajustado direto no banco por não estar publicada);
  02954524 segue no fallback manual da Revisão — a descrição de origem dele não menciona material e o
  ADR-0052 impede a IA de inventar. Commit `701bb6a`.

## 2026-07-09

- **Fix: IA inventava atributo numérico opcional sem lastro no texto (peso errado no ML, lote
  #30, ADR-0049 adendo).** Diego reportou peso errado na ficha técnica do anúncio do lote #30
  ("Peso: 120 g" no ML). Investigação via banco descartou de cara a hipótese óbvia: não é o peso
  de frete (`SELLER_PACKAGE_WEIGHT`, correto em 660g e idêntico nas 10 variações) — é o atributo
  de categoria `WEIGHT` (ficha técnica do item) dentro de `familias.atributos_ml`, preenchido por
  IA e sem qualquer relação com `variacoes.peso_gramas`. Causa raiz: `validarNumerico`
  (`_shared/ai/atributos-llm-core.ts`) validava só o **formato** do número extraído pela IA (número
  + unidade permitida), sem checar se o número constava no título/descrição — diferente do
  texto-livre, que já tem essa trava desde o ADR-0052. O título do lote #30 ("Tecido Helanca
  Light... 3,00 X 1,80 Metros") não menciona peso nenhum; a IA "chutou" 120g (gramatura plausível
  de tecido leve) e passou pela validação, apesar do ADR-0049 já prometer "só se claro no
  título/descrição" — a promessa nunca virou invariante testável para numéricos, só para
  texto-livre. Fix: `validarRespostaAtributos` (numérico) agora exige que o número extraído conste
  no nome/descrição, mesma trava do texto-livre — fecha a lacuna para qualquer atributo numérico
  opcional, não só `WEIGHT`. 1279 testes verdes (36 novos/ajustados em `atributos-llm.test.ts`,
  incluindo caso que reproduz o bug do lote #30), lint limpo. Deploy confirmado em produção
  (`process-familia` v83, `definir-categoria-familia` v14, `verify_jwt` conferido pós-deploy).
  Correção do anúncio já publicado (MLB7132904138) feita manualmente por Diego no painel do ML
  — o app não tem hoje um caminho de UPDATE que resincroniza atributos de ficha técnica com um
  anúncio já publicado (só `SELLER_PACKAGE_*`/frete, `BRAND`, preço, estoque, fotos e descrição
  são resincronizados; atributos gerais só são enviados uma vez, no CREATE — lacuna própria,
  fora de escopo deste fix). PR #6, commit `f3a59b0` (squash) em `main`.

- **Fix: markup do Faturamento › Vendas divergia do Dashboard/Publicados/Financeiro.** Diego pediu
  pra investigar por que o Faturamento mostrava +38% de markup enquanto Dashboard, Publicados e
  Financeiro mostravam +37%. Descartei diferença de filtro/período/origem comparando ao vivo (via
  browser-use, Chrome do Diego) os mesmos 187 pedidos/382 unidades nas duas telas — a divergência
  era real, não dado desatualizado. Causa: `custoDaVenda` (`resumo-vendas.ts`, fonte de
  Dashboard/Publicados/Financeiro via `calcularResumo`) somava o custo bruto de todos os itens de
  um pedido e arredondava a **soma inteira** uma única vez; `custoDoItem`
  (`pedidos-faturamento.ts`, Faturamento — chamada de "fonte da verdade" no próprio comentário do
  código) arredonda **cada item individualmente** antes de somar. Como `variacoes.custo` é
  `numeric` sem escala fixa (pode ter mais de 2 casas), um pedido com 2+ itens (média do
  Faturamento: 2,0 itens/pedido) acumula centavos de diferença entre os dois caminhos de
  arredondamento — suficiente, somado em ~187 pedidos, pra deslocar o markup agregado em um ponto
  percentual inteiro. Fix: `custoDaVenda` passou a arredondar por item também, alinhando com a
  "fonte da verdade" do Faturamento. Não mexe em imposto/ADR-0055 (esse já usava a mesma
  granularidade por item nos dois caminhos). 1 teste de regressão novo reproduzindo o cenário
  (custo de 3 casas em pedido de 2 itens), 1277 testes verdes, lint limpo. Só frontend
  (`src/lib/resumo-vendas.ts`), sem migration/edge function. Commit `b5ecbc4`, deploy Render
  confirmado `live`.

- **Fix: "Líquido" no Financeiro › Detalhe do líquido não pode mais descontar imposto (ADR-0066,
  refina ADR-0055).** Diego reportou pedido com R$ 38,15 recebidos no Mercado Pago aparecendo como
  R$ 31,75 na tabela — divergência de exatamente 8% (alíquota nacional). Causa: essa tela já tinha
  dois cálculos de "líquido" coexistindo — o banner "Líquido total" (via `calcularResumo`) nunca
  descontou imposto, mas a tabela de pedidos abaixo (via `agruparPorPedido`, código compartilhado
  com Faturamento › Vendas) descontava, seguindo a regra "todas as telas" da ADR-0055. Regra nova:
  nessa tela específica "Líquido" nunca desconta imposto (bate 1:1 com o Mercado Pago); "Markup"
  continua líquido de imposto, sem mudança. Escopo restrito ao Financeiro — Faturamento › Vendas e
  Publicados › Detalhe de vendas continuam mostrando líquido já líquido de imposto. Implementado
  como prop `liquidoBruto` em `DetalhePedidoItens` (default `false`, ligada só no
  `DetalheFinanceiro.tsx`) — sem mudar o formato de `Pedido`/`ItemPedido`. Export "Financeiro ·
  Detalhe" ajustado junto. Achado à parte: o fixture de teste de `adapters.test.ts` nunca setava
  `imposto` (campo obrigatório do tipo `Pedido`/`ItemPedido`), mascarado porque nenhum teste
  conferia o valor exato da célula "líquido" — corrigido junto com 2 testes novos. 1276 testes
  verdes. Só frontend.

## 2026-07-06

- **Fix: "vs. anterior" do filtro "Hoje" (Dashboard/Financeiro) comparava com o pedaço errado de
  ontem.** Diego notou +14% em Pedidos no "Hoje" mesmo com 8 pedidos hoje vs. 11 ontem no dia
  inteiro — número não batia nem como "ontem inteiro" nem como "ontem até a mesma hora de agora".
  Causa: `janelaAnterior()` desloca a janela atual pela sua **duração decorrida** — fórmula certa
  pra presets/range (blocos fechados de N dias), quebrada pra "hoje" (janela que cresce o dia
  todo): deslocar por poucas horas decorridas cola a comparação no fim de ontem (ex.: ontem
  11h47→meia-noite), perdendo a manhã inteira. Fix: `tipo: 'hoje'` desloca a janela inteira em
  exatamente 24h (ontem 00:00 → ontem na mesma hora de agora); presets/range inalterados. Achado à
  parte, não corrigido: `src/lib/__tests__/metricas-hoje.test.ts` nunca roda — fora do `include` do
  `vitest.config.ts`. TDD (1 teste novo em `tests/lib/metricas.test.ts`, o arquivo que roda de
  fato); 1206 testes verdes. Só frontend. Merge → main → deploy live.

- **Feat: mapa "Vendas por estado" (Dashboard) clicável — mostra pedidos e valor.** Pedido do
  Diego, com um requisito específico de mobile: nada de popover/tooltip (hover não existe em
  toque) — uma linha compacta abaixo do mapa (`UF · N pedidos · valor`), que aparece ao clicar e
  some ao clicar de novo. `MapaBrasil` já tinha os props `selecionada`/`onSelecionar` (usados em
  Faturamento › Geografia); só faltava ligar no Dashboard. Efeito colateral bom: a contagem por UF
  passou de `vendasPorUf` (linha de `ml_vendas`, podia inflar pacotes multi-item) para
  `agruparPorGeografia(pedidos)` — mesma fonte de Faturamento › Geografia, nível de pedido —
  ganhando o valor por UF de graça e fechando uma divergência de contagem que já existia entre o
  mapa do Dashboard e o resto do app. 1205 testes verdes. Só frontend.

- **Feat/Fix: KPI "Variações publicadas" no card "Saúde dos anúncios" (Publicados).** Pedido do
  Diego. A 1ª tentativa contava `variacoes` da família **representante** de cada anúncio, que
  `dedupePublicados` elege como a mais **antiga** por `ml_item_id` — mesmo root-cause do fix de
  busca por código de 2026-07-03: produto que cresceu em ciclos de UPDATE fica subcontado pela
  família antiga. Passou por 1268 (bug de contagem: somava variações de **todas** as linhas de
  família, duplicando por ciclo de UPDATE) e 678/676 (só a família mais antiga) até reconciliar
  contra a fonte certa. Fix definitivo: `qtdVariacoes` por anúncio vem de
  `anuncios_externos.variacoes_externas` (mantido pelos workers no publish), somado no resumo e
  espelhado no relatório exportado. Validado contra 4 fontes independentes — incluindo consulta ao
  vivo autenticada à API do Mercado Livre feita direto no Postgres (extensão `http` + `vault`, token
  nunca sai do servidor) — todas convergindo em **856** variações publicadas em anúncios ativos.
  1203 testes verdes. Só frontend.

## 2026-07-05

- **Fix: conexão ML de empresa nova aparecia "não conectada" na UI.** O hook `useMlConnection`
  (`src/hooks/useMlConnection.ts`) ainda lia a tabela **congelada** `ml_credentials` (ADR-0027),
  enquanto o callback OAuth grava em `marketplace_connections`. Toda conexão feita após a migração
  ficava invisível no front — só a AVIL aparecia (linha legada de 2026-06-17). A DSA (empresa nova)
  estava corretamente conectada (`$ANALISTA$`, id 9757132) em `marketplace_connections`, mas a tela
  lia a tabela errada. Corrigido: hook lê `marketplace_connections` (filtro `canal='mercado_livre'`,
  RLS `select org` já escopa por `current_org_id()`). `ml_credentials` agora está morta no front
  (drop da tabela é follow-up). Validado em runtime (login DSA → "Conectado como $ANALISTA$").

## 2026-07-04

- **Feat: categoria de seleção livre + "Outros" como fallback visível (ADR-0057/0058).** Famílias
  fora dos 4 tipos de aviamento conhecidos (linha/fita/botão/cola) ficavam travadas pra sempre em
  "Categoria indefinida" — pendência aberta desde o ADR-0022 (11/06), nunca fechada; caso real:
  "BAINHA INSTANTÂNEA 4MT UND" (lote 51). `CardCategoria` troca o seletor fixo de 4 opções por
  busca livre no `domain_discovery` do ML (`buscarCategoriaPreditor`, já existia); `definir-categoria-familia`
  generaliza o contrato pra `{categoria_ml_id, categoria_nome}` (quebra intencional do contrato
  antigo — app de deploy único, sem consumidor externo); `resolverAtributosGenericos` extraído do
  `process-familia` pra reuso sem duplicar lógica entre o fluxo automático e o manual. Categoria do
  concorrente (já calculada, antes descartada) vira sugestão clicável **não-vinculante** — nunca
  aplicada sem clique explícito (travado por teste de regressão específico, ADR-0054: validado ao
  vivo que a categoria do concorrente pra bainha é "Brinquedos de Pegadinhas", colisão de catálogo).
  ADR-0058 (mesmo dia, a pedido do Diego): quando o preditor só acha candidatos genéricos
  ("Outros"), a família deixa de travar — aplica o genérico como fallback visível (`tipo_origem='generico'`,
  selo de aviso na Revisão), busca continua disponível pra trocar; revisão humana antes de publicar
  segue obrigatória (regra inalterada). `process-familia` não mudou (branch já era baseado em
  categoria/tipo, não em origem). Migrations aditivas (`concorrencia_categoria_id`, enum
  `tipo_origem` + `'generico'`); 1165 testes verdes; validado no app real (browser-use):
  reprocessamento ao vivo confirmou busca funcionando com candidatos reais do ML e a sugestão do
  concorrente aparecendo corretamente como não-aplicável sozinha.

- **Feat: pausar/reativar anúncio publicado no Mercado Livre (ADR-0060).** Novo 3º ícone na linha
  da tela Publicados (`Pause`/`Play`), restrito a **admin** — primeira ação de escrita do projeto
  gated por `profiles.is_admin`, não só por membro autenticado da operação. `ChannelConnector`
  ganha `atualizarStatus` (contrato multicanal, ADR-0024), implementado no conector ML via
  `PUT /items/{id}` com `{status}`; nova edge function `atualizar-status-publicado`
  (`requireAdmin` + token da operação, mesmo padrão do `status-publicados`/ADR-0056).
  Confirmação (`AlertDialog`) só ao pausar; reativar é direto. Sem persistência local de status —
  a ação invalida o cache de status ao vivo (`QK.statusPublicados`), forçando reconsulta real no
  ML. Validado end-to-end no browser contra o Mercado Livre real: pausou e reativou um anúncio de
  baixo risco (zero vendas no período), terminou como "Ativo". Deploy da função nova via CLI
  (v1, ACTIVE) durante a implementação; redeploy completo das demais funções afetadas (mesmos
  `_shared` importados, comportamento inalterado) feito no fechamento da branch.

## 2026-07-03

- **Fix: linha expandida "para detalhar" recolhia ao trocar de tela/aba ou no refetch.** Mesma
  causa do fix de ordenação (`62eeeba`): o `aberto` vivia em `useState` local por linha, zerado a
  cada remount (troca de aba no Faturamento desmonta o `TabsContent`; sair/voltar de um detalhe;
  refetch de 45s remonta as linhas; ordenar/filtrar/paginar reordena e remonta). Trocado por
  `useSessionState` (o hook do fix de sort) com chave estável por linha em: **aba-vendas**
  (`expand:faturamento-vendas:${chave}`), **DetalheFinanceiro** (`expand:detalhe-financeiro:${chave}`),
  **Publicados** (`expand:publicados:${familiaId}`). **Revisão** tinha o estado num `Set` no nível da
  página (zerava ao sair/voltar): virou `useSessionState<string[]>('expand:revisao', [])` (array
  porque sessionStorage é JSON e `Set` não serializa). A expansão escolhida sobrevive a remount e
  refetch; limpa ao fechar a aba do browser. Teste `Publicados.test.tsx` passou a limpar
  `sessionStorage` no `beforeEach` (expansão persistente vazava entre casos). Frontend-only.
- **Feat: coluna "Taxas" no Detalhe de vendas (Publicados › `/publicados/vendas`)** com balão no
  hover (Tooltip shadcn) abrindo o breakdown **comissão + frete + imposto**. Taxas por produto =
  `valor − líquido + imposto`; comissão real (`Σ sale_fee × qtd`), frete como resíduo do retido
  (mesma filosofia do `resumo-vendas.ts`), imposto por origem (ADR-0055). Mantém o invariante
  `valor − taxas − custo = lucro` já exibido. Motivo: item barato/pesado (ex.: COLA 1KG) mostrava
  markup ~7% e não ficava óbvio que ~52% do faturamento ia em taxas+frete. `detalhe-vendas.ts` +
  `DetalheVendas.tsx` + teste do invariante. Não é decisão nova (ADR não necessário).
- **Fix: catálogo truncado em 1000 linhas quebrava casamento por GTIN (Fora do PubliAI sem
  código/EAN):** `carregarCatalogo` (`_shared/faturamento/io.ts`) lia `variacoes` **sem paginação** —
  contas com >1000 variações (esta conta tem 1505) tinham o corte padrão do PostgREST (~1000 linhas
  sem `ORDER BY`), então produtos fora dessa fatia arbitrária nunca entravam no mapa `infoPorGtin`.
  Vendas de catálogo desses produtos ficavam permanentemente em "Fora do PubliAI" sem código/EAN,
  mesmo cadastrados há semanas — não era timing nem deploy desatualizado, era truncamento silencioso
  (mesma classe de bug que `buscarTodasPaginas` já resolve no frontend, `custos.ts`). Confirmado no
  banco: 0 de 43 itens "Fora" tinham código em toda a história (desde 2026-06-06), apesar do GTIN
  bater com `variacoes` cadastradas em junho. Corrigido com `paginarTudo` (paginação por `.range()`,
  igual ao `buscarTodasPaginas` do frontend) em `carregarCatalogo`, tanto para `familias` quanto
  `variacoes`. Redeploy: `sync-venda`, `backfill-faturamento`, `reconciliar-faturamento`, `ml-webhook`
  (todas importam `_shared/faturamento/io.ts`).
- **Markup consistente entre telas (imposto — ADR-0055):** o Detalhe de vendas (Publicados) calculava
  markup/lucro por produto **sem descontar imposto**, então mostrava +65% enquanto o KPI mostrava +27%
  para o mesmo período. `montarDetalheVendas` (`detalhe-vendas.ts`) passou a receber `aliquotaResolver`
  e descontar o imposto do líquido — `(Σ líquido − Σ imposto − Σ custo)/Σ custo`, idêntico a
  `calcularResumo`/`pedidos-faturamento`. `DetalheVendas.tsx` passa o resolver (`useAliquotas`). Validado
  com dados reais: Dashboard, Publicados, Detalhe de vendas, Faturamento e Financeiro agora mostram o
  MESMO markup (+27%). Frontend-only (markup é derivado, sem escrita no banco).
- **Fix comissão por quantidade (pedidos qtd>1):** `sale_fee` do ML é tarifa **por unidade**, mas
  `mapearPedidoParaVenda` somava sem `× quantity` → `sale_fee_total`/`liquido` inflados em pedidos
  com mais de 1 unidade (o líquido do PubliAI aparecia maior que o "Total" real do ML — ex.: fita
  3 un mostrava R$ 17,35 vs R$ 13,23 no ML). Corrigido em `_shared/faturamento/venda.ts` e
  `_shared/ml/pedidos.ts` (rateio do Financeiro). Redeploy: `backfill-faturamento`,
  `reconciliar-faturamento`, `ml-webhook`, `sync-venda`, `resumo-financeiro`. Re-backfill de
  produção: 34 vendas recalculadas (comissão subestimada somava R$ 178,21). Afeta Faturamento,
  Publicados (detalhe de vendas), Financeiro e todos os KPIs de líquido/markup/lucro.
- Imposto por origem (nacional/importado) no preço e markup (ADR-0055): planilha ganha coluna
  `ORIGEM` (opcional, lida da linha PAI → `familias.origem`, enum `origem_produto`); alíquotas
  parametrizáveis em Configurações (nacional 8% / importado 16%, por usuário). Imposto =
  `preço × alíquota` descontado do líquido em "Você recebe", "Vale a pena" e markup em todas as
  telas (análise de publicação, viabilidade item-a-item, faturamento pós-venda); gross-up do
  preço sugerido passa a `÷(1 − comissão% − alíquota%)`. Migration + edge functions
  (`process-familia`, `analisar-viabilidade`, `ingest-lote`) deployadas. Planilha "Geral
  Publicado" aplicada: 217 custos corrigidos, 57 famílias marcadas importado.
- Imposto visível no Faturamento (ADR-0055): campo **Imposto** no cabeçalho do detalhe do pedido
  (ao lado de Comissão ML / Frete vendedor; compartilhado com o Detalhe do líquido no Financeiro)
  e no sub do KPI "Lucro líquido no período". `imposto` exposto em `ResumoVendas`. Não entra em
  "Taxas e frete (ML)"/"Líquido você recebe" (retenção do ML, não tributo do vendedor).
- Link para o anúncio no ML em Publicados → Detalhe de vendas: botão discreto ↗ ML por produto
  (seção "Seus anúncios (PubliAI)"), padrão do Publicados. URL construída do `ml_item_id`
  (`produto.mercadolivre.com.br/MLB-<id>`) — cobre 100%, inclusive vendas cujo item foi
  republicado e não está mais em `familias`.
- Fix: ordenação das tabelas "Ao vivo" não persistia. O `sort` vivia em `useState` local, que
  era zerado a cada remount — trocar de aba no Faturamento (Radix `TabsContent` desmonta a aba
  inativa) ou sair/voltar de um detalhe. Novo hook `useSessionState` (persiste em
  `sessionStorage`) substitui os 3 `useState<Sort>` (aba-vendas, Detalhe do líquido, Detalhe de
  vendas — chave por seção). Auto-refresh de 45s segue ativo; a ordenação escolhida agora
  sobrevive a remount e refetch. Validado no app real (browser-use).
- **Campo de busca no Detalhe de vendas** (Publicados › `/publicados/vendas`): filtro por
  título/código/EAN nas duas seções (mesmo padrão do `Input` de Publicados). Subtotal do rodapé
  recalculado a partir das linhas filtradas quando há busca ativa (evita mostrar o total da seção
  inteira ao lado de 1-2 linhas exibidas); mensagem própria para "sem resultado" vs "sem vendas no
  período". `DetalheVendas.tsx`. Frontend-only.

## 2026-07-02

- Fix categoria/título — tipo de produto genérico via IA (lote #50, ADR-0054): categoria "Outros"
  nunca mais é resposta final automática; busca de categoria no ML roda com nome bruto + query
  limpa (`tipo_produto_busca`, extraída pelo copywriter); IA de desempate pode abster-se
  deliberadamente; título ganha o tipo de produto quando ausente do nome. Deployado em
  `process-familia`, `regenerar-copy-familia`, `publicar-split-ml`.

## 2026-06-29

- Split de produto em N anúncios para produtos com >100 cores (ADR-0048)
- Cor nova com foto+estoque entra marcada por padrão no UPDATE (opt-out)

## 2026-06-28

- Multiusuário com permissão de menu (ADR-0047) — operação compartilhada, fase pré-`E7`
- Divergência de `verify_jwt` confirmada em produção via logs (ver [[Bugs Conhecidos]])

## 2026-06-25 a 2026-06-27

- Líquido econômico correto (ADR-0042) — corrige markup falso de cross-docking/pack
- Colisão de numeração de ADRs resolvida (0035→0044, 0037→0045)
- Correções de segurança: migração SheetJS (CVE), `notificar-liberacao` autenticada,
  `telegram_config_status()` revogada de anon

## 2026-06-22 a 2026-06-23

- Módulo Financeiro impecável (ADR-0040) — implementado, pendente validação/deploy
- Monitoramento de anúncios moderados (ADR-0035)
- Cor no título de anúncios mono-cor, anti-duplicado (ADR-0044)
- Módulo Faturamento — webhooks ML (ADR-0037)

## 2026-06-14

- `E1`/`E1b` — camada de abstração de canais (CREATE + UPDATE + status)
- `E2` — modelo multicanal `anuncios_externos`
- `E3` — categoria genérica por preditor/LLM
- `E4` — atributos obrigatórios por IA closed-set

## 2026-07-10

- Fix: cache Redis de schema ML no formato antigo (pós-ADR-0049) fazia `atributosAlvo` estourar e
  zerava o enriquecimento IA de atributos (fita sem Comprimento/Largura). Chave versionada
  `attrs:v2:` + guard defensivo + flush do cache. Ver [[Incidentes]] e ADR-0049 (adendo). (PR #11)

## Correções recentes (commits na `main`, sem data de doc)

GTIN de comprimento inválido tratado como ausente; Fabricante preenchido na categoria genérica;
cor/metragem separada corrigida; comprador real nas vendas (Faturamento). Ver
[[Problemas Resolvidos]] para o detalhe completo.

## Histórico anterior (M0–M4, 2026-05-26 a 2026-06-15)

Ver `docs/project-history.md` para a linha do tempo curada dos marcos M0 a M4 e a reauditoria
E1–E4. Ver também [[Releases]] para os marcos por milestone.
