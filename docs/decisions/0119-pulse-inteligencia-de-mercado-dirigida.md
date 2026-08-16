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

## Consequências

- O valor do histórico cresce com o tempo de coleta — ligar a coleta cedo é parte da decisão.
- Vendas são **estimativas** (delta de dado público, com faixas "50+" do ML); a UI deve rotulá-las
  como estimadas, nunca como fato.
- Novas orgs entram automaticamente no ciclo de coleta; histórico delas começa do zero na entrada.
