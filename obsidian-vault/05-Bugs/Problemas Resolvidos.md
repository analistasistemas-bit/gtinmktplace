---
tags: [bugs, resolvidos]
atualizado: 2026-08-24
---

# Problemas Resolvidos

Bugs corrigidos e fechados. Fonte: histórico de commits e `docs/project-history.md`. Ver
[[Incidentes]] (com contexto completo de ADR), [[Bugs Conhecidos]] (o que falta).

## Correções recentes (commits mais recentes na `main`)

- **Cor vazia, foto de outra cor e código/EAN trocados no Faturamento (2026-08-11)** — três
  sintomas, **uma raiz**: o sistema resolvia "qual variação foi vendida?" pegando a **primeira da
  lista** quando não sabia. (1) *Cor* — o ML só manda `variation_attributes` em venda com variação;
  item plano (filho User Products, ADR-0088, ou família de 1 variação) chega sem, e 184 de 1350
  itens ficavam com `ml_vendas_itens.cor` nula, 183 deles com `variation_id` nulo. (2) *Foto* —
  `fotos-produto.ts` mapeava anúncio → foto da primeira variação, então as 9 cores de um anúncio
  herdavam a mesma imagem: a venda de "Amarelo Canário" aparecia vermelha. (3) *Código/EAN* —
  `fundirItensUP` preservava a entrada semeada pela família em vez do `sku` exato do filho
  (4 vendas com código errado, 3 com EAN errado).
  **Fix:** cor e foto resolvidas na **leitura** (`src/lib/cor-produto.ts`, `fotos-produto.ts`), o
  que conserta o histórico sem re-sync; código/EAN no sync (`catalogo-up.ts`, redeploy das 4
  functions que importam `carregarCatalogo`). Regra comum: **chave disputada por valores diferentes
  é anulada, não chutada** — cor ambígua vira "—", foto ambígua cai na capa da família, e o `sku`
  do filho UP (1:1 exato) sobrepõe qualquer palpite. **Custo e markup intactos**
  (`venda_item_custo`, ADR-0109, é chaveado por `(venda_id, ml_item_id, variation_id)` e é
  insert-once — conferido em produção).
  **Achado por revisão adversarial:** o guard inicial anulava a chave por anúncio mas ainda caía no
  fallback por `ean`/`codigo` — campos que o **próprio sync** havia gravado a partir da primeira
  variação arbitrária. O dado envenenado entrava pela linha da venda, não pelo mapa. Com
  `variation_id` nulo e anúncio ambíguo, o resolver agora para em `null`.
  **Lição operacional:** ao corrigir as 4 linhas históricas à mão, a query de apoio desempatou
  variações duplicadas (ADR-0108) por `atualizado_em` — que estava **idêntico** — e gravou o
  GTIN da família errada em 3 delas. O sync seguinte corrigiu sozinho. Código duplicado entre
  famílias só é desempatável pela **família do anúncio vendido**, nunca pelo código solto.
  Ver [[Índice de ADRs]] (ADR-0088, ADR-0108, ADR-0109) e [[Faturamento]].

- **"Unid. vendidas" do Eucerin aparecia em duas etapas no Publicados (2026-08-08)** — a coluna vem
  de `resumo.porItem`, que depende de **duas** queries: `useVendas` (as vendas da janela) e
  `useAnuncioCanonico` (o mapa listing de catálogo → anúncio dono, ADR-0021/0045). As vendas
  entradas pelo anúncio de **catálogo** só migram para a linha do dono quando a segunda resolve,
  então a linha ia de `—` → 45 → 82 unidades. Não é lentidão do produto: medido em produção na org
  DSA, vendas 0,7–1,2 s / 100 kB e mapa 0,5 s, e **não existe caminho de código por produto**
  (`resumo.porItem` tem um único consumidor). O operador só nota nesse item porque 37 das 82
  unidades vêm do catálogo e ele é 73 dos 81 pedidos da org no período — nos outros o salto é de 1
  ou 3. **Fix:** `useResumoVendas` expõe `canonicoPronto` (`isSuccess || isError` — erro degrada
  para o comportamento sem mapa, nunca prende a coluna em `—`) e `Publicados.tsx` só preenche as
  colunas de venda com o mapa assentado. **Descartado em revisão:** gatear o resumo inteiro no
  hook — o Dashboard tira o loading de `vendasRaw.isPending`, não do `isFetching` do hook, e zerar
  o resumo pintaria R$ 0,00 nos cards financeiros; o mapa não altera KPI agregado nenhum, só em que
  chave as unidades caem. **Não confundir com a latência da tela** (payload baixado inteiro a cada
  abertura, por `queryKey` instável da janela `preset`): medida no mesmo dia, fix adiado por
  decisão do Diego — ver `docs/TASKS.md`.

- **Lote #11 travado na Revisão pedindo o atributo "Nome" (2026-08-07)** — categoria Cuidado Facial
  (`MLB264874`) marca `NAME` como `required` e `value_type=string`. Nada o preenchia:
  `montarAtributosBase` cobre só `BRAND`/`MANUFACTURER`/`MODEL`, e a IA, sob a regra anti-invenção
  do ADR-0052, só aceita texto-livre que conste **literalmente** no nome/descrição — no ML o "Nome"
  é o nome da *linha* ("Effaclar K+"), que a planilha não traz isolado, então ela corretamente
  omitia. **Fix:** `preencherNomeObrigatorio` (`_shared/categoria/atributos.ts`) grava `NAME` = nome
  do produto da planilha (mesma fonte do `MODEL`, sem inventar dado) quando a categoria o exige e
  ele está vazio, **depois** da IA (se ela inferir a linha, o valor dela vence). Levantamento na API
  do ML: os únicos texto-livre `required` são `BRAND`, `MANUFACTURER`, `MODEL` e `NAME` — com este,
  nenhum obrigatório de texto sobra para o operador. Ver [[Índice de ADRs]] (ADR-0052, adendo
  2026-08-07).

- **Pergunta respondida no ML continuava "Pendente" no PubliAI (2026-08-06)** — o ML notifica o
  tópico `questions` na criação **e** na resposta, sempre com o mesmo `resource`
  (`/questions/{id}`). O dedup por `(topic, resource)` do `ml-webhook` classificava a 2ª
  notificação como duplicado e a descartava, então a resposta só voltava na reconciliação
  (`:00`/`:30`) — medido em produção: resposta 14:13, app atualizado 14:30. **Fix:**
  `classificarDedupWebhook` passa a devolver `enfileirar` para `questions` e `claims` (mesmo
  problema: `opened → in_mediation → closed`) mesmo em conflito 23505; worker é idempotente e o
  throttle já cobre flood. Também não existia o "sync de 3 em 3 min" que o operador supunha: a aba
  só recarregava ao trocar de foco — `usePerguntas` ganhou `refetchInterval` de 60s. Ver
  [[Faturamento]].
- **Card de devoluções do Dashboard: uma finalizada contada como aberta, outra no mês errado
  (2026-08-06)** — Diego comparou com o painel do ML. Dois defeitos independentes, ambos medidos
  contra os 8 claims reais da AVIL no banco de produção. (1) "1 devolução aberta" em Precisa de
  atenção contava `acoes_pendentes.length > 0` sem olhar o status — o ML segue devolvendo
  `available_actions` ("return review ok", prazo 06/08) em claim **fechado e reembolsado**
  (5550524900, que no ML já era "Devolução finalizada"). Agora exige `status === 'opened'`.
  (2) "1 devolução · R$ 56,16" no Mês atual filtrava por `aberto_em`: o claim 5552400113 abriu
  31/07 e só foi reembolsado (R$ 70,50) em 03/08, então agosto — o mês que perdeu o dinheiro —
  não o via. Nova coluna `ml_devolucoes.fechado_em` (`resolution.date_created`), que é o mesmo
  instante do estorno no MP (conferido contra `payments[].date_last_modified` em 5 casos);
  agosto passa a **2 devoluções · R$ 126,66**. O número segue divergindo do painel do ML de
  propósito: aquela tela lista pela **chegada do pacote**, evento posterior ao estorno — e, como
  o glossário já registrava, não mostra claim resolvido por mediador. Ver [[Índice de ADRs]]
  (ADR-0106).

- **"vs. anterior" do filtro "Hoje" parecia número errado — era só o rótulo (2026-08-06)** — Diego
  viu, às 11h37, "Faturamento bruto R$ 1.158,21 · +27% vs. anterior" enquanto ontem fechado deu
  R$ 2.962,70, e leu como regressão do fix de 2026-07-06 (abaixo). **Não era bug de cálculo**: a
  janela anterior de 'hoje' é ontem 00:00 → ontem 11h37 (~R$ 912 / 10 pedidos), e os três cards
  fechavam entre si (+40% pedidos, −9% ticket). O problema é semântico — "vs. anterior" é lido
  como "ontem fechado", ainda mais depois que **Mês atual** passou a comparar dias inteiros
  (commit `316c45ce`, 2026-08-02). Manter a matemática: "Hoje" é 100% dia parcial, comparar
  contra ontem fechado mostraria −60% toda manhã. **Fix:** `rotuloAnterior(periodo)` em
  `src/lib/metricas.ts` — o card de "Hoje" (Dashboard e Financeiro) agora diz
  **"vs. ontem até agora"**; os demais períodos seguem "vs. anterior".

- **Descrição publicada saía "tudo junto" no ML (2026-08-06)** — Diego relatou a descrição do
  anúncio ilegível, com os títulos de seção colados no parágrafo anterior. Causa raiz no nosso
  lado: o gerador de copy separa as seções **apenas pelo emoji** do cabeçalho (`📌 ESPECIFICAÇÕES`),
  sem linha em branco, e `sanitizarDescricaoML` (`_shared/ml/criar-item.ts`) remove esses emojis
  antes do envio porque o ML os rejeita — sobrava texto sem separador algum (medido no
  `MLB7345071684`: 31 quebras de linha e **zero** linhas em branco). **Fix:** a sanitização passou a
  processar linha a linha e reconstruir uma linha em branco antes e depois de cada cabeçalho
  (linha iniciada por emoji que não seja bullet `✔`/`☑`), de forma idempotente. Como
  `resolverDescricaoUpdate` compara o texto sanitizado com o publicado, **os anúncios antigos se
  corrigem sozinhos no próximo UPDATE**, sem migração. 2.585 testes verdes. Ver [[Índice de ADRs]]
  (ADR-0103, revisão 2026-08-06), [[Edge Functions]].

- **Item plano nunca vinculava ao catálogo do ML (2026-08-06)** — Diego reportou que o produto do
  lote 10 da DSA (`MLB5001755829`, "Principia Gel De Limpeza Facial 350g") não se associou ao
  catálogo mesmo com concorrentes. Causa raiz: o **item plano** (ADR-0084 — categoria que exige
  `family_name`, 1 SKU, item sem `variations[]`) é publicado pela rota Legacy e grava
  `variacoes.ml_variation_id = ml_item_id`, mas `vincularVariacoesCatalogo` lia a elegibilidade só
  de `body.variations[]` — vazio nesse item, com o status na **raiz** do JSON. O mapa saía vazio,
  a decisão virava `pendente` ("ainda computando") e o worker respondia 500 até o QStash desistir;
  o GTIN nunca chegava a ser pesquisado no catálogo. **32 de 32** variações de item plano estavam
  presas assim, a mais antiga desde 20/07 (17 dias), contra 211 vinculados no Legacy
  multi-variação. **Fix:** `indexarElegibilidadeAnuncio` (raiz → indexa pelo item id, com
  `indexarEligibility` intacta) + `montarBodyOptinVariacao` (opt-in sem `variation_id` quando o id
  não é numérico, senão `Number('MLB…')` = `NaN`). As linhas já presas não se resolvem sozinhas —
  exigem re-enfileiramento do `vincular-catalogo`. Ver [[Índice de ADRs]] (ADR-0021, revisão
  2026-08-06), [[Edge Functions]].

- **Viabilidade ignorava promoção vigente do Mercado Livre (2026-08-04)** — para o GTIN
  `4005800220012`, a tela mostrava R$ 65,61 embora o anúncio estivesse por R$ 45,19. A busca de
  concorrência lia o campo legado `price` da lista de itens do produto, que pode refletir o preço
  padrão. Agora enriquece cada oferta com `GET /items/{item_id}/sale_price` no contexto do
  marketplace, mantém fallback em falha transitória e usa namespace de cache `gtin:v2:*` para não
  reaproveitar valores antigos. Afeta `analisar-viabilidade` e `process-familia`, os dois callers da
  busca compartilhada de concorrência. Sem migration ou mudança de contrato.

- **Omissão de estorno de devolução no Dashboard/Faturamento (2026-07-27)** — Diego reportou que o reembolso de R$ 35,76 do pedido `#2000017218710936` não aparecia no card "Faturamento Bruto" do Dashboard (que mostrava apenas `1 devolução · R$ 12,50`). Causa raiz em duas frentes: (1) O pedido original foi criado em 02/07/2026 e o reembolso foi concluído em 20/07/2026; o `reconciliar-faturamento` só re-sincronizava vendas dos últimos 3 dias (`72h`), então o campo `estorno` no banco (`ml_vendas`) permaneceu `null`. (2) Em devoluções abertas sobre envios (`resource === 'shipment'`), `mapearDevolucao` mantinha `order_id = null`, impedindo o worker `sync-devolucao` de atualizar a venda. **Fix:** `upsertDevolucao` (`_shared/faturamento/devolucoes-io.ts`) passou a resolver o `order_id` via `shipping_id` na tabela `ml_vendas`. `reconciliar-faturamento` foi atualizado para re-sincronizar o pagamento/estorno via Mercado Pago para todos os pedidos com devoluções recentes (últimos 30 dias), independentemente da data da venda. Registro do pedido `#2000017218710936` reconciliado no banco (`estorno = 35.76`). 2.175 testes verdes, build limpo. Ver [[Faturamento]], [[Edge Functions]].

- **Semáforo da variação ignorava imposto por origem (lote 35, 2026-07-18)** — Diego reportou
  divergência: o card "Análise para publicação" mostrava "Abaixo do mínimo" no topo mas "Vale a
  pena" na linha da variação, para o mesmo item. Causa raiz: o rollout do ADR-0055 (imposto por
  origem, nacional 8%/importado 16%) atualizou `painel-analise.tsx` e `viabilidade-linha.tsx`
  para passar `aliquotaPct` ao `SemaforoPreco`, mas esqueceu `variacao-card.tsx` — o parâmetro
  caía no default `0` e o imposto sumia só nesse badge. Em item importado, o líquido real cruza o
  piso (badge do topo correto, "Abaixo do mínimo"); sem imposto, a linha da variação calculava
  líquido maior e mostrava falso "Vale a pena". Invisível em item nacional (imposto geralmente
  não é grande o bastante pra cruzar o piso). **Fix:** `familia-expanded.tsx` calcula
  `aliquotaPct` (mesmo padrão de `painel-analise.tsx`) e repassa a `VariacaoCard`, que agora
  exige a prop e a encaminha ao `SemaforoPreco`. Diff de 11 linhas. Segunda ocorrência do padrão
  "imposto por origem defaultando em silêncio" (1ª: `ingest-lote` dropando ORIGEM, 2026-07-14).
  Ver ADR-0055, ADR-0020.
- **Metragem decimal fabricando número no título (lote #65, bordados Búfalo, 2026-07-17)** —
  Diego reportou título confuso `...13,7MT 71MT | 5CM LARGURA`, com "71MT" sem lastro na
  descrição. Causa raiz: `RE_METRAGEM` (`_shared/ai/titulo.ts`) parava na vírgula de metragens
  decimais (`nome_pai` com "13,71MT"), extraindo só a cauda ("71MT") como se fosse a metragem
  real; `garantirMetragemTitulo` injetava esse fragmento fabricado. **Fix em 2 rodadas**: 1ª
  corrigiu a extração (`\d+(?:,\d+)?`) mas o reprocessamento real revelou resíduo — a IA ainda
  duplicava a metragem de 3 formas (arredondada no mesmo segmento, arredondada com unidade
  errada, duplicada entre segmentos sem acionar o guard antigo); 2ª rodada trocou "checa se já
  contém" por "remove toda menção existente, reanexa a correta" (`RE_METRAGEM_TOKEN` global) —
  um único caminho cobre os 3 padrões. Achado colateral: "lote #35" citado pelo Diego não existe
  mais na base (lotes 32-38 excluídos); os registros reais eram do **lote #65**. Atributo
  obrigatório "Tipo de embalagem" faltando em 1 das 4 famílias (mesmas irmãs, categoria idêntica)
  confirmado como inconsistência real de chamada de IA por família (não falta de lastro no
  texto) — resolvido via editor manual (`atributos-familia`), sem IA. Detalhe completo:
  [TASKS.md](../../docs/TASKS.md) (topo do arquivo).
- **Follow-ups de mensagens pós-venda nunca sincronizavam em tempo real (plano 035, 2026-07-12)** —
  o `ml-webhook` deduplica notificações por `(topic, resource)`, mas o resource de `messages`
  (`/messages/packs/{pack}/sellers/{seller}`) é **idêntico para toda mensagem da mesma conversa**.
  A 1ª mensagem do comprador inseria a linha de dedup; da 2ª em diante o insert conflitava e o
  webhook fazia ACK sem reenfileirar `sync-mensagem` — o operador só via a resposta no badge (e
  nunca recebia alerta) depois do backfill horário, que explicitamente não alerta (evita spam ao
  importar histórico). **Fix:** `sync-mensagem` apaga a linha de dedup do pack ao terminar de
  processar (reabre para a próxima mensagem da conversa); o webhook reenfileira mesmo em conflito
  quando a linha existente é antiga (>2min) e nunca foi processada (sinal de job perdido —
  `deveReenfileirarMensagens`). De carona, o alerta saiu do chat único da org (`lerConfigTelegram`)
  e passou a rotear por `notificarCategoria('mensagens', ...)`, o mesmo modelo por destinatário dos
  demais tópicos (ADR-0068) — faltava essa categoria existir. Deploy `ml-webhook v20`,
  `sync-mensagem v2`, `usuarios` (também consome a lista de categorias — faltou no 1º deploy,
  corrigido no ato). Bug **real e ativo** (não latente) — todo comprador que mandasse uma 2ª
  mensagem numa conversa parava de gerar alerta/atualização em tempo real desde que o fluxo de
  mensagens entrou em produção. Ver [[Incidentes]] e ADR-0067/ADR-0068.
- **Re-ingest UPDATE de planilha republicava a foto ANTIGA ao trocar capa/imagem (plano 031, 2026-07-12)** —
  o ramo de re-ingest UPDATE do `ingest-lote` herdava `capa_ml_picture_id`/`ml_picture_id` do anúncio
  anterior enquanto derivava `capa_storage_path`/`imagem_path` do lote novo. Como os paths embutem o
  `lote_id` (`buildStoragePath`) e o `pre-subir-fotos` pula o upload quando já há `picId`, o ML mantinha
  a foto cacheada do lote anterior — trocar a capa numa planilha re-ingerida publicava a imagem velha. O
  upload interativo (`upload-imagens-lote`) já zerava o id certo; só o re-ingest de planilha ficava fora
  da invariante. **Fix:** helper puro `herdarPictureId(pathNovo, idAnterior)` (`_shared/update/heranca-foto.ts`)
  — herda o id só sem foto nova (reposição só-planilha preserva a publicada); com foto nova, zera → força
  re-upload da atual. Aplicado à capa e às variações. Bug **latente/pré-existente** (não tinha mordido
  ainda). Deploy `ingest-lote v39`, testes verdes. Ver [[Incidentes]] e ADR-0033 (invariante de foto).
- **Editor manual "Complete para publicar" travava MATERIAL em closed-set, lote #31 (2026-07-10)** —
  `MATERIAL` (Pingentes, PAI 02954524) é `value_type=string` no ML (texto-livre; os values que o
  acompanham são sugestão, não lista fechada), mas o dropdown do editor manual só oferecia as 4
  sugestões (Alpaca/Ouro/Prata/Vidro), sem opção de digitar "100% Poliéster". Mesma classe do fix da
  manhã (ADR-0052), só que num segundo lugar: `tipoDe` em `_shared/categoria/faltantes-editaveis.ts`
  duplicava `tipoAlvo` (`atributos-llm-core.ts`, já corrigido) sem o mesmo fix. Corrigido, deploy
  `atributos-familia` v7. Confirmado ao vivo: Diego digitou o valor, família publicou (`MLB4875907185`).
- **Publicação travando com "Problema nas fotos" — `item.pictures.unavailable`, lote #31 (2026-07-10)** —
  o ML processa a picture de forma assíncrona: ela fica `status: ACTIVE` em ~2s, mas só vira
  **utilizável no `POST /items` após MINUTOS** (medido ~142s a ~5 min, com o token real da conta via
  `POST /items/validate`). O retry cobria só ~1 min → erro sempre para produto de 1 foto; multi-cor
  escapava pela folga de subir várias fotos. Corrigiu a **premissa de tempo** do ADR-0033: removido o
  retry interno de 12s, `retryDelay` do QStash 10s→90s (retries 5), **reusando o mesmo `picture_id`**
  (re-subir reinicia a propagação — a mensagem "envie novamente" é cilada). Estendido a UPDATE e split
  (que só retentavam 5xx/429). Confirmado ao vivo: `MLB4875716733`. Lição: `ACTIVE` da picture ≠
  disponível para o item; tratar como "aguardar a mesma foto propagar", nunca re-subir. Ver [[Incidentes]].
- **Cor "Outra" do Vision vazando p/ título e descrição do anúncio, lote #31 (2026-07-10)** — `'Outra'`
  é o veredito do Vision para "não identifiquei a cor", mas era tratado como cor real: aparecia como
  "OUTRA" no título e na seção de cores da descrição de um produto sem cor. Fix: predicado único
  `ehCorIndefinida` barra os sentinelas no título (`garantirCorTitulo`) e omite a seção de cores da
  descrição quando não há cor real (ADR-0044).
- **Markup do Faturamento › Vendas divergia do Dashboard/Publicados/Financeiro (2026-07-09)** —
  +38% no Faturamento vs. +37% nas outras 3 telas, confirmado ao vivo com os mesmos 187
  pedidos/382 unidades (não era filtro/período). Causa: `custoDaVenda` (Dashboard/Publicados/
  Financeiro) somava o custo bruto do pedido inteiro e arredondava 1x no final; `custoDoItem`
  (Faturamento, a "fonte da verdade") arredonda por item antes de somar — como `variacoes.custo`
  é `numeric` sem escala fixa, pedidos multi-item acumulam centavos de diferença entre os dois
  caminhos. Fix: `custoDaVenda` passou a arredondar por item também.
- **"vs. anterior" do filtro "Hoje" (Dashboard/Financeiro) comparava com o pedaço errado de ontem
  (2026-07-06)** — `janelaAnterior()` desloca a janela atual pela sua duração decorrida (certo pra
  presets/range, blocos fechados de N dias); "hoje" cresce o dia todo, então deslocar por poucas
  horas colava a comparação no fim de ontem (ex.: ontem 11h47→meia-noite), perdendo a manhã. Diego
  notou pelo Pedidos: +14% com 8 hoje vs. 11 ontem no dia inteiro, número que não fechava de
  nenhuma forma intuitiva. Fix: "hoje" desloca a janela inteira em 24h (ontem 00:00 → ontem mesma
  hora de agora).
- **KPI "Variações publicadas" (Publicados) subcontava produtos que cresceram em UPDATE (2026-07-06)**
  — mesma causa raiz do fix de busca por código abaixo (2026-07-03): a família **representante** de
  cada anúncio (`dedupePublicados`) é a mais **antiga** por `ml_item_id`; contar `variacoes` só dela
  ignora variações adicionadas em ciclos de UPDATE posteriores. Passou por um número errado por
  contagem duplicada (1268 — somava variações de todas as linhas de família, não só a atual) antes
  de reconciliar. Fix: contar por `anuncios_externos.variacoes_externas` (espelho do worker), não
  pela família. Confirmado ao vivo contra a API do ML: 856 variações em anúncios ativos.
- **Famílias fora dos 4 aviamentos travavam pra sempre em "Categoria indefinida" (2026-07-04,
  ADR-0057/0058)** — o seletor manual de categoria só oferecia linha/fita/botão/cola; qualquer
  produto fora desses 4 tipos (ex.: "BAINHA INSTANTÂNEA 4MT UND", lote 51) ficava bloqueado sem
  saída. Causa raiz: pendência aberta desde o ADR-0022 (11/06) e nunca fechada — cada ADR seguinte
  melhorou o resolver automático e deixou o escape manual intacto. Fix: `CardCategoria` ganha busca
  livre no `domain_discovery` do ML; `definir-categoria-familia` generaliza pra aceitar qualquer
  categoria; categoria do concorrente (já calculada, descartada antes) vira sugestão não-vinculante
  (nunca aplicada sem clique — validado ao vivo que pra bainha ela é "Brinquedos de Pegadinhas",
  confirma o motivo do ADR-0054 de nunca aceitar isso automaticamente). Fecha a "Camada 2 (UI de
  atributos + categoria livre)" que o fix do barbante (lote #49, abaixo) tinha deixado pendente.
  ADR-0058 (mesmo dia): "Outros" vira fallback visível em vez de bloqueio quando não há candidato
  específico algum.
- **Busca da Publicados não achava código de variação de ciclos de UPDATE (2026-07-03)** — buscar
  por código/GTIN de variação (ex.: `01813412`) na tela Publicados dava "Nenhum resultado" para
  **alguns** produtos, mesmo com o fix anterior de `identificadores` (5febb1d). Causa raiz: vários
  ciclos de UPDATE geram várias `familias` com o mesmo `ml_item_id`; `dedupePublicados` (`publicados.ts`)
  elege como representante a família **mais antiga** (preserva a data de publicação original) e a busca
  usava só os `identificadores` dela. Quando a variação buscada nasceu num ciclo posterior (a antiga
  tinha, p.ex., 1 só variação), o código nunca entrava no índice de busca. Fix: `dedupePublicados` passa
  a **unir** os `identificadores` de todas as famílias do grupo, mantendo o representante mais antigo
  para o resto. Teste de regressão trava a invariante.
- **Markup por produto divergente: Detalhe de vendas × Detalhe do pedido (2026-07-03)** — o mesmo
  produto mostrava markups diferentes (ex.: cód. 03096963 → +843% no Detalhe de vendas vs +592% no
  Detalhe do pedido). Causa raiz: `montarDetalheVendas` (`detalhe-vendas.ts`) rateava o líquido **por
  linha de order_id**; num pack com um order_id por produto, o item leve/barato (fita) ficava com o
  líquido inteiro do seu order_id (frete rateado por peso quase não pesa nele) e inflava o markup. Fix:
  poolar o líquido por **pack** (`pack_id ?? order_id`) e redistribuir por valor bruto com o mesmo
  `round2` por item do `agruparPorPedido` (menu Faturamento, fonte da verdade — ADR-0055). Markup por
  produto passa a bater 1:1 entre as telas; teste de regressão trava a invariante.
- **Barbante recusado por atributo/tipo (lote #49, ADR-0051)** — "BARBANTE" não estava na regex de
  `linha` → caía em `tipo='outro'`; o preditor do ML acertava a categoria (MLB270273, Fios e Cadarços)
  mas o código fixava `tipo='outro'`, então `BRAND`/`MODEL` nunca eram montados e o ML recusava. Fix:
  `barbante` na regex + `tipoParaCategoria` (deriva o tipo da categoria do preditor) + `process-familia`
  monta obrigatórios curados para todo tipo conhecido. **Robustez SaaS** junto: caminho genérico nunca
  publica sem validar (schema/IA falha → trava na Revisão com sentinela, não vai quebrado ao ML) e
  `COLOR` deixa de ser falso-faltante. Camada 2 (UI de atributos + categoria livre) pendente. As 3
  famílias do #49 reprocessadas e prontas.
- **Frete no preço sugerido (PRÓPRIO)** — o gross-up só descontava a comissão; o preço
  sugerido do ramo próprio agora cobre comissão **+ frete grátis** do vendedor, garantindo
  o líquido mínimo (PRECO da planilha). O semáforo do item passou a considerar as dimensões
  e concorda com o da família. No competitivo o preço segue puro mercado por design (o
  semáforo avisa). Lote #49: R$19,80 → R$27,45 (ADR-0050).
- **Relatório dizia "Publicado" em lote que não publicou nada (2026-08-12)** — lote #46: stepper
  com as 4 etapas verdes ao lado de "0 publicada(s) · 1 com erro". `jornadaDoLote` lia só
  `lote.status`, e `concluido` quer dizer "terminou de rodar", não "publicou" — lote com todas as
  famílias recusadas pelo ML fecha concluído do mesmo jeito. A função passou a aceitar o desfecho
  (`{ publicadas, erros }`) e o Relatório o informa: sem nenhuma publicada, a etapa final fica
  vermelha e lê **"Não publicado"**. Publicação parcial segue concluída. O badge do card no
  Dashboard tinha o mesmo problema ("Concluído" verde ao lado de "0 publicadas · 1 erro") e lê a
  mesma regra — o predicado `loteFalhouNaPublicacao` em `lib/jornada.ts` é fonte única dos dois.
  **Lição:** corrigir só a tela do print não bastou. "Editar e tentar de novo" devolve o operador à
  **Revisão** com o lote concluído, onde o stepper continuava verde. O `resultado` virou prop
  obrigatória de `JornadaLote` (o compilador cobra de qualquer tela nova) e o cálculo virou a função
  `resultadoPublicacao(familias)` — Revisão, Relatório, Progresso e o card do Dashboard leem dela.
- **GTIN de comprimento inválido tratado como ausente** — GTIN com tamanho fora do padrão
  passou a ser rejeitado como se não existisse, em vez de propagar um valor inválido.
- **GTIN com dígito verificador errado derrubava a publicação (2026-08-12, ADR-0116)** — lote #46,
  tecido Oxford Natal importado: o CREATE inteiro voltava com `Product Identifier [GTIN] contains
  values with invalid format: [48251671]`. Comprimento de EAN-8 certo, verificador GS1 errado
  (deveria ser `9`) — código do fornecedor na coluna GTIN, o de sempre em planilha de importado.
  `gtinAusente` passou a checar o mod-10, então a variação sai como `EMPTY_GTIN_REASON` em vez de
  derrubar o anúncio. O GTIN também virou **editável na Revisão**, com aviso inline: antes o
  operador via o erro e não tinha o que fazer a não ser corrigir a planilha e re-ingerir o lote.
- **Fabricante (MANUFACTURER) preenchido na categoria genérica** — atributo estava faltando na
  publicação (lote #48).
- **Cor + metragem separada** — planilha com "10 mt" no nome estava virando cor errada (lote #48).
- **Comprador real nas vendas (Faturamento)** — ver [[Incidentes]] (nome do comprador: mascaramento
  intermitente do ML + regressão do fallback, 2026-07-01).
- **Divergência de `verify_jwt` no faturamento (ADR-0046)** — ver [[Incidentes]] (webhooks/workers
  rejeitados com 401 antes de rodar, faturamento em tempo real parado, 2026-06-28).
- **Contagem de pedidos por pack** — Financeiro/Publicados contavam por `order_id` em vez de por
  pack, gerando divergência entre as duas telas.
- **Markup/custo por pacote** — inconsistência entre telas no cálculo de KPI.

## Da linha do tempo do projeto (`docs/project-history.md`)

- **Busca de concorrência** — `/sites/MLB/search` retornava `403` (descontinuado pelo ML);
  recalibrado para usar `/products/search` → `/products/{id}/items` (ADR-0014, adendo).
- **Foto-capa `CAPA_`** — corrigida no ingest; depois `CAPA2_` e `CAPA3_` incorporadas.
- **Lotes travados em `processando`** — corrigidos para transicionar corretamente para `revisao`.
- **`EMPTY_GTIN_REASON`, descrição separada, fotos por variação** — ajustados em bug bash real.
- **UPDATE de descrição para cores novas** — corrigido para refletir a mudança.
- **Atributo `IS_DOUBLE_FACE` de fitas** — corrigido.
- **Cor falsa por descrição incidental ("Multicolor")** — corrigida.
- **Permissão `/orders`** — estava bloqueada (mesma classe de `/moderations`); confirmado
  posteriormente que voltou a funcionar (ver ADR-0037).

## Incidentes já corrigidos com detalhe completo

Ver [[Incidentes]]: título duplicado (ADR-0044), foto assíncrona travando publicação (ADR-0033),
vinculação de catálogo com ficha de kit (ADR-0021), moderação sem alerta (ADR-0035), lote #41
com erro genérico (ADR-0030), divergência de `verify_jwt` no faturamento (ADR-0046), nome do
comprador (mascaramento intermitente do ML + regressão do fallback).
