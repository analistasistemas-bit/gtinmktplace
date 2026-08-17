# ADR-0119 — Pulse: inteligência de mercado dirigida, server-side e sem crawl massivo

**Status:** Aceito — design fechado em entrevista (grill-with-docs, 2026-08-16); implementação não iniciada
**Data:** 2026-08-16
**Relacionados:** ADR-0055 (markup/imposto por origem), ADR-0086 (config org-scoped), ADR-0118 (extensão `extensao-ml/`), ADR-0021 (catálogo)

## Problema

O operador decide preço, entrada em nicho e reação à concorrência às cegas: a API privada do ML
(Orders) só mostra as **próprias** vendas. Ferramentas como a Joom Pulse mostram vendas, receita e
histórico de preço **de qualquer anúncio** — e o segredo delas não é acesso especial, é coleta de
dados públicos acumulada ao longo do tempo:

- `sold_quantity` público (items/search) + **snapshots periódicos** → delta entre snapshots = vendas estimadas no período;
- estoque público (`available_quantity`), reputação de seller, catálogo, Trends API;
- extensão Chrome apenas como UX (overlay na página do ML) e ponto de coleta.

Queríamos essa capacidade dentro do PubliAI, sem "implementação gigante".

## Decisão

**Menu "Pulse" no PubliAI, alimentado por coletor server-side. Sem extensão Chrome no v1.**

1. **Radar dirigido, não crawl.** Monitoram-se apenas: (a) concorrentes auto-descobertos dos
   anúncios publicados da org — via `catalog_product_id` quando de catálogo, senão busca por
   GTIN/título, **top-10 por vendas** —; (b) itens adicionados manualmente (URL/MLB-id). Termos de
   busca monitorados (pesquisa de nicho) ficam para o v2 — o modelo de dados já os prevê.
2. **Snapshots com travas de crescimento:** grava-se linha diária por item **só se algo mudou**;
   cru diário vive 90 dias e é agregado em resumo semanal; item morto (anúncio encerrado, produto
   despublicado, tela sem acesso há 60 dias) sai de coleta; teto de itens por org (base de tier
   premium futuro). Banco estabiliza (~centenas de MB em anos, na escala atual).
3. **Coleta na stack existente:** QStash cron + edge function; baseline diário + tier "quente"
   (6/6h) para concorrentes diretos de anúncios ativos — alerta chega em horas.
4. **Escopo v1 (3 telas/decisões):** concorrência por anúncio (reprecificar?), alertas de mudança
   (agir quando?), rentabilidade real (até onde baixar? — usa `variacoes.custo`, comissão, imposto
   8/16% por origem, frete).
5. **Diferenciais v1 sobre a Joom Pulse** (ela só vê dado público e não age):
   **alerta acionável** — margem calculada no alerta + botão de reprecificar (com revisão humana,
   como sempre) — e **price-to-win do catálogo** (buy box: quem tem e qual preço ganha).
6. **Rollout:** coleta roda para **todas** as orgs desde o dia 1 (histórico acumula); menu visível
   por config org-scoped na tela de Configurações (mesmo padrão do menu Estoque, ADR-0086). Liga-se
   primeiro para DSA; Avil quando os números estiverem calibrados — e já nasce com histórico.

## Alternativas descartadas

- **Extensão Chrome no v1** (paridade com a Joom Pulse): custo permanente de manutenção (review da
  Web Store, MV3, DOM do ML quebrando) para ganhar apenas o overlay. O v2 pode reusar a
  `extensao-ml/` do ADR-0118 se o overlay provar valor.
- **Crawl massivo / pesquisa livre** (150M itens, estilo Joom Pulse): infra dedicada e banco
  crescendo antes de qualquer uso. O radar dirigido só paga pelo que está em decisão.
- **Números "instantâneos" sem espera:** desnecessário — o 1º snapshot já dá velocidade média
  vitalícia (`sold_quantity ÷ idade do anúncio`); só a tendência recente exige 1–2 semanas de
  acúmulo.

## Errata (2026-08-16, prova empírica com token real — antes de qualquer implementação)

Testes reais contra a API do ML corrigiram três premissas deste ADR:

1. **`/items/{id}` de terceiro devolve 403 sempre** (com token, sem token, multiget misto). O ML
   fechou o acesso a anúncios de terceiros: `sold_quantity` e estoque **por anúncio de
   concorrente não existem via API**. Ferramentas como a Joom Pulse obtêm isso raspando o site
   (extensão no navegador do usuário + crawlers de HTML), não pela API.
2. **Pivot aprovado pelo Diego:** vendas de concorrente no v1 são **por vendedor** — delta de
   `seller_reputation.transactions.total` de `/users/{seller_id}` entre snapshots (provado:
   20.500 transações de um seller terceiro) — rotuladas como estimativa. Vendas por anúncio de
   terceiro ficam para o v2, via extensão coletora de DOM (base: `extensao-ml/`, ADR-0118).
   Alertas de "estoque esgotado" de concorrente saem do escopo (dado inexistente); o sinal
   equivalente é "concorrente saiu do catálogo".
3. **Referência de preço confirmada melhor que o esperado**: `/suggestions/items/{id}/details`
   devolve status, preço sugerido e custos (comissão + frete) do próprio ML.
   *(Chamávamos isso de "price-to-win" — nome de outro endpoint. Ver Errata 3.)*
4. **§6 corrigido:** o "padrão do menu Estoque" é `organizations.modulos_habilitados` ligado
   pelo super-admin em `/admin` — não uma config na tela de Configurações. É esse o mecanismo
   do Pulse (o texto original conflacionava os dois padrões).

Dados próprios seguem intactos: `sold_quantity` exato dos nossos anúncios via multiget.
Plano: `docs/superpowers/plans/2026-08-16-pulse-v1-plan.md`.

## Errata 2 (2026-08-16, medição pós-deploy) — a cobertura do v1 é minoritária

Com o v1 no ar, medimos quantos anúncios publicados o radar realmente alcança:

| Organização | Anúncios publicados | Com ficha de catálogo | Fora do radar |
|---|---:|---:|---:|
| DSA | 7 | 5 | 2 |
| Avil | 133 | 15 | **118 (89%)** |

**Causa (verificada, não suposta):** os produtos fora do radar não têm ficha de catálogo no ML —
não é vínculo faltando. Testamos 10 GTINs de anúncios sem catálogo: **0 têm ficha**. Os códigos
começam com `2`, faixa GS1 de **uso interno da empresa** (não é GTIN global registrado) — são
aviamentos e itens genéricos, categoria que o catálogo do ML não cataloga.

**Não há caminho pela API para esses anúncios** (todos verificados com token real em 16/08/2026):

| Endpoint | Resultado |
|---|---|
| `/sites/MLB/search?q=` (busca textual) | 403 forbidden |
| `/sites/MLB/search?category=` | 403 forbidden |
| `/items/{id}` de terceiro | 403 forbidden |
| `/products/search?product_identifier={gtin}` | 200, mas sem ficha para esses GTINs |
| `/highlights/MLB/category/{cat}` | 200 — 20 posições, mas só 7 eram `PRODUCT` legível (9 `USER_PRODUCT`, 4 `ITEM`, ilegíveis para terceiros) |
| `/trends/MLB/{cat}` | 200 — termos mais buscados, dado de categoria |

**Consequência para o roadmap:** a extensão de navegador do v2 deixa de ser um acréscimo (vendas
por anúncio) e passa a ser **o que dá cobertura ao módulo**. Lendo a página na sessão logada do
operador, ela alcança qualquer anúncio — com ou sem catálogo, próprio ou de terceiro. Sem ela, o
Pulse permanece útil para a DSA (5 de 7) e marginal para a Avil (15 de 133).

Alternativa mais barata, se o v2 demorar: uma tela de **tendência por categoria** usando
`highlights` + `trends` (os dois únicos endpoints vivos). Não responde "quem é meu concorrente e a
que preço", mas responde "o que está vendendo neste nicho" — decisão de sortimento, não de preço.

## Errata 3 (2026-08-16) — "price-to-win" era o nome errado, e os selos estavam inventados

**Como apareceu:** um produto com 79 ofertas coletadas exibia o selo "Sem concorrência".

**Causa:** a Errata 1 registrou `/suggestions/items/{id}/details` como "price-to-win", mas esse é
o nome de **outro** endpoint do ML (`/items/{id}/price_to_win`, a disputa pelo primeiro lugar do
catálogo, com status `winning` / `sharing_first_place` / `competing` / `listed`). O que nós
chamamos é a **referência de preço**, e ela tem um vocabulário próprio. O mapa de tradução da UI
foi escrito por aproximação a partir do nome errado: dos oito status que ele traduzia, **cinco não
existem** nessa API (`with_benchmark_lowest`, `with_benchmark_low`, `with_benchmark_mid`,
`no_benchmark`, `sharing_first_place`) e o único que aparecia na prática estava traduzido ao
contrário do que a documentação diz.

**Vocabulário correto** ([doc oficial](https://developers.mercadolivre.com.br/pt_br/referencias-de-precos)) —
quatro posições frente ao preço de referência:

| Status | Documentação do ML |
|---|---|
| `no_benchmark_lowest` | preço atual **abaixo** do referido |
| `no_benchmark_ok` | preço atual **igual** ao referido |
| `with_benchmark_high` | preço atual **alto** em relação ao referido |
| `with_benchmark_highest` | preço acima do referido **e** do maior preço dos concorrentes |

Quando a referência vencedora é do tipo Markdown, o status vira o estado da promoção:
`not_optin_applied`, `promotion_scheduled`, `promotion_active` — fora da escala de preço, porque
"promoção agendada" não é uma posição.

O prefixo `no_` vs `with_` **não está documentado**. Não inventar explicação para ele: foi
exatamente esse tipo de preenchimento de lacuna que produziu o bug.

**Consequência de leitura, que a correção torna visível:** o menor concorrente e a referência do ML
são medidas diferentes e podem apontar para lados opostos. O caso real: preço 47,90, menor rival
44,90 (`+7% mais caro`) e referência do ML 50,28 (`Abaixo da referência`). A referência é calculada
pelo ML a partir de concorrentes internos e externos (`strategy_type: similar_price`), não é o piso
da ficha. A UI e o guia dizem isso explicitamente.

**Escopo da correção:** só rótulo e ordenação (`src/lib/pulse-formato.ts`, cabeçalho da coluna,
bloco de decisão do detalhe) e a documentação. As colunas `ptw_*` continuam com esse nome no
schema — renomear exigiria migration sem ganho de comportamento.

**Follow-up não incluído:** a resposta do ML traz `applicable_suggestion`. Se ele marcar a
referência como não aplicável e a tela mostrar mesmo assim, o selo passa a afirmar mais do que o ML
afirma. Registrado em `docs/TASKS.md` — exige coluna nova e redeploy do coletor.

## Errata 4 (2026-08-16) — "Seu preço" não era o preço vigente

**Como apareceu:** Diego comparou a coluna com o painel do ML e os números não batiam.

**Causa:** `meu_preco` era derivado de `variacoes.preco_publicado_ml`, e esse campo só é escrito
por `publish-familia-ml`, `update-familia-ml`, `publicar-split-ml` e `remover-publicado` — ou seja,
**quando o app publica**. Nenhum job reconcilia esse valor com o ML. Não sabemos como o preço do
anúncio chegou a divergir, e a correção é a mesma em qualquer hipótese: o banco não é fonte da
verdade para o preço vigente.

**Verificado em três fontes independentes**, item `MLB7343600804` / `codigo_pai 00000022`:

| Fonte | Preço |
|---|---|
| `variacoes.preco_publicado_ml` (o que a tela mostrava) | 44,60 |
| Painel de anúncios do ML | 48,90 |
| `/items/{id}` com token | 48,90 |
| Nossa oferta em `/products/MLB36209242/items` | 48,90 |

Eram **três defeitos na mesma coluna**, todos medidos no radar de 222 produtos:

1. **Defasado** — sem reconciliação com o ML (o relatado).
2. **Substituição por rascunho** — `preco_publicado_ml ?? preco_publicacao` caía no preço
   *pretendido* em 2 produtos. Valor financeiro trocado por outro em silêncio, o que a regra LOUD
   proíbe.
3. **Escolha arbitrária** — `.find()` pegava a primeira variação com preço. 37 dos 222 (17%) têm
   mais de um preço distinto entre variações, e o PostgREST não garante ordem no array aninhado.
   O `DialogReprecificar` já **se recusa a agir** nesse caso; a lista exibia um dos preços e
   derivava dele o badge de posição.

**Decisão: o preço vivo vem da mesma resposta das concorrentes.** `/products/{id}/items` já traz a
nossa oferta ao lado das dos rivais — mesma fonte, mesmo instante, mesma base. Gravamos
`pulse_produtos.meu_preco` / `meu_item_id` / `meu_preco_em` na coleta. Zero chamadas novas.

**Por que não multiget de `/items`:** ele devolve o preço **base**, sem a promoção ativa
(verificado: `MLB7391084566` → `price: 38,90`, `deal_ids: []`, enquanto
`/seller-promotions/items/{id}?app_version=v2` devolve `PRICE_DISCOUNT started, price: 35,79`). As
ofertas dos concorrentes vêm com preço **efetivo** (rival com `price: 49,68`, `original_price: 54`).
Gravar o preço base compararia bases diferentes — 8% de erro em qualquer produto em campanha.

**Custo aceito:** só existe preço vivo quando temos oferta ativa na ficha. Dos 222 produtos, 117
são `catalogo_status='vinculado'`; os demais (99 `ficha_divergente` + 6 outros) passam a mostrar
"—" **com o motivo**, em vez de um número que não era o preço vigente nem comparável (nosso
anúncio nem está naquela ficha). Anúncio pausado ou sem estoque sai da ficha e também perde a
posição — correto: não está competindo.

**Split:** com o anúncio publicado por faixa temos várias ofertas na ficha; vence a de **menor
preço**, a única comparável com "menor concorrente".

**`meu_preco_em` carimba a leitura, não o achado.** Na primeira versão ele só era gravado quando a
oferta era encontrada, e `null` passava a significar duas coisas: "olhamos e não estamos na ficha"
e "ainda não olhamos". Como cada execução tem teto de produtos, a segunda população não é
hipotética — medida logo após o deploy: **30 dos 222** estavam nela, e a tela diria "pausado ou sem
estoque" para todos, afirmando sobre o anúncio a partir de uma leitura que não aconteceu.

**Achado colateral:** a coleta usava o default de paginação do ML (100). Nenhuma ficha atual passa
disso (máx. 85 medido), mas o teto é real: acima dele o radar veria um subconjunto e a nossa oferta
poderia cair fora, zerando a coluna sem motivo aparente. Agora o `limit=100` é explícito e o
excedente vai para o log.

## Errata 5 (2026-08-16) — anúncio publicado fora do radar, e "pausado" era a coisa errada

Duas queixas do mesmo dia, causas independentes.

### 1. Filtrar por "pausados" devolvia lista vazia

O filtro olhava `pulse_produtos.status`, que é o ciclo de vida do produto **dentro do radar**
(pausar/reativar pelo menu da linha). Nenhum produto jamais foi pausado ali — os 222 estavam
`ativo` — enquanto metade dos anúncios estava parada no ML por estoque zerado. O filtro estava
tecnicamente correto e respondia à pergunta errada.

Passa a usar a situação real, lida do multiget `/items?ids=…&attributes=id,status,sub_status` num
passo em lote (20 ids por chamada, ~8 requisições para 150 anúncios; dentro do loop por produto
seriam 222). O id vem de `anuncios_externos`, **não** de `meu_item_id`: anúncio pausado some da
ficha de catálogo, então `meu_item_id` é null exatamente quando a situação mais importa.

`out_of_stock` ganha texto próprio ("pausado por estoque zerado — repor o estoque o reativa")
porque é acionável; pausa por moderação não é a mesma coisa e não pode receber a mesma frase.
Com a situação conhecida, `motivoSemPrecoProprio` deixa de **deduzir** "pausado ou sem estoque" da
ausência na ficha — a ausência tem mais de uma causa.

### 2. Anúncio publicado e vinculado que nunca entrou no radar

`sincronizarRadar` montava a lista a partir de `anuncios_externos.variacoes_externas[].
catalog_product_id` — o espelho JSON da publicação. Quando esse campo não foi gravado, o anúncio
ficava **inteiro** fora do radar, mesmo com `variacoes.catalog_status = 'vinculado'`. Medido na
DSA: `MLB4982690837` (`00000004`), vinculado à ficha `MLB15976572`, ausente do radar.

Fonte de dado comparada antes de escolher:

| Fonte | Avil | DSA |
|---|---:|---:|
| JSON `variacoes_externas` (atual) | 217 | 5 |
| Todas as variações das famílias do código | 434 | 6 |
| Variações da família mais recente | 180 | 6 |
| **Só os códigos órfãos, família mais recente, `vinculado`** | **+0** | **+1** |

As duas fontes amplas trazem lixo histórico (re-ingest deixa várias famílias por `codigo_pai`) ou
perdem vínculos que o JSON tem. O recorte adotado é aditivo: consulta `variacoes` **apenas** para
os códigos publicados que hoje não têm nenhum `catalog_product_id` no JSON. Recupera exatamente a
ficha que faltava e não acrescenta nada na Avil — cujos 126 órfãos são os aviamentos sem catálogo
da Errata 2, confirmando aquela medição por outro caminho.

Verificado após o deploy: DSA passou de 5 para 6 produtos, 3 `active` e 3 `paused`/`out_of_stock`.
O produto recuperado aparece com "—" em Seu preço — correto, está pausado e portanto ausente da
ficha.

## Errata 6 (2026-08-16) — a comissão era a do preço errado

**Como apareceu:** Diego conferiu a "Sobra para você" contra o custo real e não bateu.

**Causa:** `ptw_custos.comissao` vem de `/suggestions/items/{id}/details` e é a comissão calculada
sobre o **`suggested_price`**, não sobre o preço praticado. O simulador aplicava esse valor ao
preço atual.

Medido no item `MLB5040504553` a R$ 39,90 (sugestão do ML: R$ 32,99):

| | Comissão | Sobra exibida |
|---|---:|---:|
| Como estava | R$ 4,62 (14% de 32,99) | R$ 5,36 — 13,4% |
| Correto | R$ 5,59 (14% de 39,90) | **R$ 4,39 — 11,0%** |

Confirmado em três fontes: `/sites/MLB/listing_prices`, o painel de anúncios do ML
("A pagar R$ 5,59" / "Você recebe R$ 27,66") e a aritmética 39,90 − 5,59 − 6,65 = 27,66.

**O erro tinha direção:** superestimava a sobra sempre que o preço estivesse **acima** da sugestão
do ML — exatamente as linhas de "mais caro que o mercado", que são as candidatas naturais a
reprecificar. Quem baixasse preço a partir daquele número trabalharia com quase R$ 1 a mais de
folga do que existia.

**Decisão: guardar a estrutura da taxa, não o valor pronto.** A coleta lê
`/sites/MLB/listing_prices?price=<preço praticado>&category_id=…&listing_type_id=…` e grava
`comissao_pct` + `comissao_fixa`. `categoria`/`tipo`/`preço` vêm do mesmo multiget que já busca a
situação do anúncio (dois atributos a mais, nenhuma chamada extra); `listing_prices` não tem
multiget, então é uma chamada por anúncio, no mesmo passo em lote e fora do teto de tempo.

**Limite conhecido e exibido:** a estrutura muda por faixa de preço. Medido na categoria
`MLB198494`: R$ 10 → 14% + R$ 4,99 fixo; R$ 25 a R$ 100 → 14%; R$ 250 → 11%. E varia por
categoria (o Principia sai a 12%). A estrutura guardada vale para o preço praticado, então no
simulador o resultado é rotulado **estimativa** quando o preço digitado difere do atual. Não
interpolamos em silêncio: um 14% aplicado a R$ 250 exageraria a comissão em R$ 7,50.

**Trava:** `insumoFaltante` (detalhe e reprecificar) passa a exigir `comissao_pct`. Sem ela a
margem some com "falta comissão do Mercado Livre" — cair de volta em `ptw_custos.comissao` seria
reintroduzir o defeito.

O frete continua vindo de `ptw_custos.frete`; ele bate com o painel do ML no caso medido e não
faz parte deste defeito.

## Errata 7 (2026-08-17) — a Errata 6 pedia o preço praticado e usava o preço base

Achado na revisão de código do módulo (Fable,
`.code-review-fable5/code-review-pulse-modulo-2026-08-17.md`), como contradição entre duas erratas
deste mesmo ADR.

A Errata 6 declarou que a comissão passa a ser lida "no preço praticado". A implementação
consultava `/sites/MLB/listing_prices?price=…` com o `price` vindo do multiget de `/items` — e a
**Errata 4 já havia provado, por medição, que esse endpoint devolve o preço BASE**, sem a promoção
ativa (`MLB7391084566`: 38,90 no `/items` contra 35,79 efetivos). Ou seja: a errata 6 pediu um
insumo que a errata 4 tinha acabado de desqualificar, e ninguém cruzou as duas.

**Por que importa:** a estrutura da comissão muda por faixa de preço (medido: 14% + R$ 4,99 fixo a
R$ 10; 14% de R$ 25 a R$ 100; 11% a R$ 250). Um anúncio com preço base acima do corte da parcela
fixa e promoção que leva o efetivo para baixo dele grava `comissao_fixa = 0` enquanto a venda real
paga a parcela. O erro tem direção: **superestima a sobra**, que é o lado que induz o operador a
baixar preço. É o mesmo defeito da Errata 6, um degrau acima — e a validação registrada em
`TASKS.md` ("batendo exatamente nos 3 produtos") foi feita em produtos **sem** promoção, então não
cobria o caso divergente.

**Agravante — o rótulo mentia junto.** `margemEstimativa` comparava o preço simulado com
`meu_preco`. No caso com promoção, a comissão vinha do preço base e o preço exibido era o efetivo:
os dois diferiam, mas a comparação era com `meu_preco`, então o número saía **sem** rótulo, com a
mesma confiança de um valor exato. Pior: o dialog de **reprecificar** — cuja função é justamente
digitar outro preço — não rotulava nada em hipótese alguma.

**Decisão.**

1. O coletor consulta `listing_prices` no preço **efetivo** (`meu_preco`, lido de
   `/products/{id}/items` na mesma execução) sempre que o conhece para o **mesmo** item; só cai no
   `price` do multiget quando aquele item não foi visto na coleta. A chave é o `item_id` da nossa
   oferta, e não o anúncio eleito por partição, para nunca casar o preço de um anúncio com a
   categoria de outro em anúncio publicado por faixa.
2. Nova coluna `pulse_produtos.comissao_preco` registra **em que preço a estrutura foi lida**.
3. `margemEhEstimativa(precoSimulado, comissaoPreco)` (função pura, testada) substitui a
   comparação com `meu_preco` nos dois dialogs. `comissao_preco` nulo — linha anterior a esta
   errata — conta como estimativa: preço da leitura desconhecido não pode virar afirmação de
   exatidão.

**Verificado em produção (2026-08-17), após deploy e coleta:** os 3 produtos com oferta viva
gravaram `comissao_preco = meu_preco` (39,90 / 48,90 / 96,90); os 3 sem oferta na ficha gravaram o
preço base do multiget (84,75 / 54,90 / 47,90), agora registrado em vez de anônimo. Regressão
conferida: NIVEA a R$ 39,90 continua com comissão R$ 5,59 e sobra R$ 4,39 (11,0%), idênticos ao
medido contra o painel do ML na Errata 6 — a correção não mexe em produto sem promoção.

## Consequências

- O valor do histórico cresce com o tempo de coleta — ligar a coleta cedo é parte da decisão.
- Vendas são **estimativas** (delta de dado público, com faixas "50+" do ML); a UI deve rotulá-las
  como estimadas, nunca como fato.
- Novas orgs entram automaticamente no ciclo de coleta; histórico delas começa do zero na entrada.
