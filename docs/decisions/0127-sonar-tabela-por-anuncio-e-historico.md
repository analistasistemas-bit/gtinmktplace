# ADR-0127 — Sonar: tabela por anúncio + histórico de snapshots

- **Status:** aceito
- **Data:** 2026-08-19
- **Relacionados:** ADR-0120 (Sonar por termo), ADR-0122 (vendas via Apify), ADR-0124 (veredito),
  ADR-0125 (cruzamento ficha↔anúncio — **D4 superada em parte por este ADR**)

## Contexto

O ADR-0125 apostou no cruzamento ficha↔anúncio (D4) para juntar o painel oficial de fichas de
catálogo com a amostra Apify de anúncios. Medições em produção de 19/08/2026 (token real + dataset
Apify já pago, termo de referência "abraçadeira nylon", mais 4 nichos de controle) mostraram que a
ficha é a unidade errada:

- **Interseção 0**: nenhum `idPublicacao` dos 20 anúncios do topo da busca (Apify) caiu dentro dos
  `item_ids` das fichas do painel oficial no termo medido. O cruzamento D4 funciona e não casa nada.
- **21 das 40 fichas mortas**: mais da metade das fichas do topo do `/products/search` está sem
  vendedor ativo (404 "No winners found" ou `results: []`). Em 5 nichos medidos, fichas ativas
  variam de 10% a 60% do painel.
- **138 vs 44.680 visitas em 30 dias (324×)**: soma das visitas das 19 fichas vivas do painel atual
  contra a soma dos 20 anúncios da Apify (20/20 HTTP 200 em `/items/{id}/visits/time_window`,
  medido 19/08). O tráfego real do nicho está nos anúncios, não nas fichas.
- **14% das vendas em ficha**: só essa fração das vendas da amostra Apify está em anúncios
  vinculados a catálogo (`idProdutoCatalogo` presente em ~20-30% dos itens).
- **5 nichos com 10-60% de fichas ativas**: confirma que a morte de fichas não é peculiaridade de
  um termo.

O painel de fichas mede um universo pequeno, majoritariamente morto e com 324× menos tráfego que
os anúncios que a Apify já entrega pagos. É isso que justifica contradizer o ADR-0125/D4.

## Decisões

**D1 — Unidade da linha = ANÚNCIO; catálogo vira selo.** A tabela lista os até 20 anúncios da
amostra Apify, na ordem da busca. Anúncio com `catalog_product_id` ganha selo "Catálogo".
**Descartado:** manter fichas e "melhorar o cruzamento" — com interseção 0 medida, não há o que
melhorar.

**D2 — API oficial reduzida a visitas: 1 chamada por anúncio.** Único uso restante:
`/items/{id}/visits/time_window` (20/20 HTTP 200 para terceiros, medido 19/08). Morrem
`/products/search`, `/products/{id}/items`, preditor de categoria e `/users/{seller_id}`.
**Descartado:** manter a busca de fichas como fonte secundária de vendedores/UF — ~100-200
chamadas por garimpo para descrever um universo fora da tabela.

**D3 — Orquestração: `pulse-sonar-vendas` primária, edge nova `pulse-sonar-visitas`, `pulse-sonar`
deletada.** `pulse-sonar-vendas` segue dona do Apify. Edge nova e fina `pulse-sonar-visitas`
resolve conexão ML da org e chama visitas com concorrência 5. `pulse-sonar` morre por inteiro;
helpers compartilhados (`parseVisitasJanela`, `ufDoVendedor`, `extrairPalavrasChave`) sobrevivem
para o Radar. **Descartado:** fachada única que chama Apify + visitas + grava — reacopla o que o
ADR-0122 desacoplou e soma o timeout Apify (135s) com visitas no mesmo orçamento; gravação via
QStash — worker inteiro para ≤20 inserts de <0,5s.

**D4 — Amostra mantida: 20 anúncios, teto US$ 0,10 por garimpo.** Sem mudança de corte → sem bump
de chave (regra do ADR-0122 §4). **Descartado:** ampliar a amostra junto com a mudança de unidade
— mudaria custo e chave de cache na mesma entrega.

**D5 — Cache de vendas `sonar:vendas:v4` mantida, sem bump.** O shape de resposta não muda de
forma incompatível; gravação de histórico é efeito de servidor, invisível no payload cacheado.
Bump re-cobraria ~US$ 0,10 por termo cacheado nos últimos 7 dias, por nada. **Descartado:** bump
"por higiene" — viola a convenção do ADR-0125/D2.

**D6 — Visitas em chave própria por item: `sonar:visitas:v1:{item_id}`, TTL 24h.** Chave por
anúncio (não por termo) reaproveita a chamada entre termos garimpados. TTL 24h porque a janela de
30 dias anda todo dia. Dado público → chave global sem `org_id` (mesma regra do ADR-0120 §3).
**Descartado:** visitas dentro da chave de vendas — TTLs incompatíveis (7d vs 24h).

**D7 — Histórico gravado pela `pulse-sonar-vendas` no cache-miss.** Run Apify fresco grava ≤20
linhas em `sonar_snapshots` (upsert `on conflict do nothing`, `adminClient()`) antes de responder;
cache hit não grava (mesmo dado, nenhum ponto novo) — 1 snapshot por termo por ciclo de TTL, por
construção. Falha de insert não derruba a resposta, mas não é silenciosa: log + campo aditivo
`historico_gravado: boolean`, montado na hora de responder e nunca gravado no Redis (senão um
cache hit serviria um `true` de um miss antigo). **Descartado:** gravar também em cache hit
(duplicaria o ponto); gravação assíncrona (ver D3).

**D8 — Regra LOUD refinada: zero medido ≠ ausência de dado.** Medido 19/08: um anúncio devolveu
`total_visits = 0` com HTTP 200 — zero de verdade. HTTP 200 com total 0 → exibe "0"; falha de
chamada, item ausente ou org sem conexão ML → "—" e `null`. Nunca converter um no outro.
**Descartado:** tratar 0 como "sem dado" ou falha como 0 (violação clássica de LOUD).

**D9 — Sparkline de visitas: ordenar por data e preencher dias ausentes com 0.** Medido 19/08: a
API de visitas omite dias sem visita e devolve pontos fora de ordem (`last=30` devolveu 7 pontos
embaralhados numa janela de 30 dias). O front ordena por data e preenche a janela completa com 0
nos dias ausentes. **Refutação registrada:** "N pontos devolvidos" não é proxy de idade do
anúncio — os 7 pontos vieram de um anúncio sem 7 dias de vida. `date_created` de terceiro segue
inobtenível (ver "Refutações" abaixo).

**D10 — Veredito v2 sobre os anúncios reais, com trava LOUD de cobertura.** Demanda intacta;
Disputa e Tração reformuladas (D11); Marca vira % da amostra com loja oficial. Se `vendedor`
(nickname) vier em menos de 50% dos itens da amostra, Disputa e Tração saem da escala proporcional
(mecanismo que o ADR-0124 §4 já tem). **Descartado:** manter os fatores lendo o painel de fichas
(morre em D3); "vendedores distintos" por fonte oficial (403 medido).
**Ajustes vindos da implementação (Task 8), decididos sobre os números medidos:** (a) **"alta" exige
no mínimo 2 fatores pontuados** — com a trava disparada sobra só a Demanda, `maximo` cai para 2 e
`soma >= maximo - 1` faria a Demanda 🟡 sozinha virar oportunidade alta (fragilidade registrada na
Calibração v2); (b) **a trava não rebaixa em silêncio: o veredito se declara PARCIAL**
(`VereditoAnuncios.parcial`), com o motivo e a ação dizendo que não foi possível avaliar a
concorrência do nicho — o oxford mede cobertura exatamente 0,50, então um único anúncio sem rótulo
no próximo garimpo dispararia a trava, e rebaixar aí transformaria falta de dado em sinal de
negócio. Na prática o par (a)+(b) resolve todo painel travado em "média parcial" (ou "baixa" pelo
gate de Demanda), nunca em "alta"; (c) o vocabulário da UI fala em **rótulo de loja**, nunca
"vendedor" (o card imprime a marca — ver Fragilidades).

**D11 — Disputa e Tração viram métricas invariantes ao tamanho da amostra; cortes antigos
inválidos na fonte nova.** Os cortes atuais (`DISPUTA = { vendedoresPoucos: 10, vendedoresMuitos:
25 }`, `TRACAO = { boa: 150_000, media: 30_000 }`) vivem numa escala cujo teto vinha de ~40 fichas
com todas as ofertas (o gabarito registra 27 vendedores no EUCERIN, ADR-0124). Na fonte nova a
contagem é censurada pela amostra (20 anúncios, nickname em ~13) — o corte 25 fica inatingível por
construção, inverteria silenciosamente o gabarito do EUCERIN. Reformulação: **Disputa v2 =
pulverização** (`vendedores_distintos ÷ anúncios com vendedor nomeado`, razão 0-1, invariante ao
tamanho da amostra); **Tração v2 = faturamento por vendedor da mesma subamostra nomeada**
(numerador e denominador sobre o mesmo subconjunto — sem isso o denominador censurado infla a
razão). As constantes antigas não são reaproveitadas nem ajustadas: viram constantes com nomes
novos (`DISPUTA_V2`, `TRACAO_V2`), re-derivadas na Calibração v2. **Descartado:** contagem absoluta
com cortes rebaixados "no olho" — continuaria censurada e os números seriam inventados, não
medidos. **Ajuste vindo da medição (ver Calibração v2):** o segundo termo da Disputa deixa de ser
`frete_gratis` (saturado em 85-100% nos três nichos) e passa a ser `% Full` — que é exatamente o
sinal que o frete grátis aproximava no ADR-0124 ("vendedor estruturado"), agora medido direto.

**D12 — Recalibração: 3 termos-gabarito, ≤ US$ 0,30, aceite "média / média / alta".** Fixtures
congelados de "EUCERIN protetor solar", "protetor solar facial" e "tecido oxford 10 metros". Os
cortes de Disputa v2, Tração v2 e do fallback de visitas saem desses payloads. Critério herdado do
ADR-0124: os 3 nichos reproduzem média/média/alta, nessa ordem ("tecido oxford = alta" é
inegociável). **Contingência:** se uma métrica não reproduzir o gabarito com nenhum corte
plausível, o fator vira informativo, não pontuado (mesmo tratamento da Marca). **Descartado:**
gabarito ampliado (20-30 termos) nesta entrega — custa US$ 2-3 e horas do Diego; segue follow-up.

**D13 — Histórico: delta entre snapshots de `vendidos` é PISO, nunca total.** `vendidos` vem em
faixas arredondadas pelo ML; 500→500 entre snapshots não significa "não vendeu", significa "não
cruzou a próxima faixa". O snapshot grava o número cru pós-`parseVendidos`; qualquer consumidor
futuro trata o delta como piso do período — variante direta de "nunca somar faixas arredondadas".

**D14 — Rollout de uma vez, sem feature flag.** Sonar é ferramenta interna de garimpo, não fluxo
de publicação; manter meia-tela velha + meia nova exigiria manter `PainelSonar` e o cruzamento
vivos só para a transição. **Descartado:** flag — custo permanente para proteger uma janela de
segundos.

**D15 — Link do anúncio: validar no browser durante a implementação, com fallback definido.** O
`link` da Apify (`/up/MLBU…`) não pôde ser validado por linha de comando — o ML redireciona
requisição sem sessão para verificação anti-bot (medido 19/08, tanto o link quanto a URL canônica
`produto.mercadolivre.com.br/MLB-{id}`). Fallback se `/up/MLBU…` não abrir: montar a URL canônica a
partir do `item_id`; se nenhum dos dois abrir, a célula perde o link.

**D16 — Sem Apify, o Sonar não tem tabela: falha explícita, nunca tela vazia.** Hoje, org sem
`APIFY_TOKEN` vê aviso e a tabela de fichas continua funcionando (vinha da API oficial). Na
arquitetura nova a tabela inteira nasce da Apify: sem token → estado vazio explicando a
dependência; Apify configurada mas run falha/estoura teto → erro explícito com termo e causa,
nunca "0 anúncios encontrados"; Apify responde mas org sem conexão ML → tabela completa, só
Visitas fica "—" (único modo degradado útil). **Custo aceito:** ponto único de falha (plano Apify
de US$ 5/mês). Aceitável porque o que ele degradava para mostrar é, medidamente, o cemitério do
catálogo (21/40 mortas, 138 visitas). **Descartado:** manter a `pulse-sonar` viva só como modo
degradado — preservaria a edge mais complexa do par para um caminho que entrega dado que já
decidimos não olhar.

## Calibração v2

Medição real de **19/08/2026** (custo US$ 0,30 — 3 runs Apify de US$ 0,10, nenhum dos termos em
cache). Fixtures congelados em `src/lib/__tests__/fixtures/sonar-gabarito/`, produzidos por
`scripts/sonar-gabarito-fixtures.mjs`. Todos os números abaixo saem desses arquivos; nenhum foi
estimado.

### Números medidos (amostra = 20 anúncios por termo)

| Métrica | EUCERIN protetor solar | protetor solar facial | tecido oxford 10 metros |
|---|---|---|---|
| itens analisados / com vendas | 20 / 16 | 20 / 16 | 20 / 18 |
| liquidez | 0,80 | 0,80 | 0,90 |
| vendas totais (acumuladas) | 123.650 | 662.500 | 5.375 |
| valor de mercado | R$ 11,36 mi | R$ 46,75 mi | R$ 382 mil |
| **cobertura de vendedor** | **1,00** | **0,80** | **0,50** |
| vendedores distintos / nomeados | 2 / 20 | 11 / 16 | 6 / 10 |
| **pulverização** | **0,10** | **0,69** | **0,60** |
| **% Full** | **35%** | **85%** | **20%** |
| % frete grátis | 100% | 85% | 95% |
| % patrocinado | 0% | 0% | 0% |
| % loja oficial (Marca) | 35% | 65% | 25% |
| **tração v2** (R$/vendedor nomeado) | **R$ 5,68 mi** | **R$ 4,07 mi** | **R$ 31.050** |
| visitas 30d (20/20 itens medidos) | 106.258 | 370.872 | 7.605 |
| total de anúncios (contador do ML) | 65 | 8.895 | 293 |

### Cortes escolhidos

```ts
const DISPUTA_V2 = { pulverizacaoConcentrada: 0.25, pulverizacaoAberta: 0.40, fullMuito: 60, fullPouco: 40 };
const TRACAO_V2  = { boa: 350_000, media: 15_000 };
```

Regra de Disputa v2 (mesma forma da antiga — um OR para ruim, um AND para bom):
**ruim** se `pulverizacao <= 0,25` **ou** `full_pct >= 60`; **bom** se `pulverizacao >= 0,40`
**e** `full_pct <= 40`; senão **médio**.

| Corte | Valor | De onde saiu |
|---|---|---|
| `pulverizacaoConcentrada` | 0,25 | entre EUCERIN (0,10) e o próximo nicho (0,60) — topo da busca sob 1-2 rótulos é território fechado, não campo livre |
| `pulverizacaoAberta` | 0,40 | entre EUCERIN (0,10) e oxford (0,60); oxford fica 0,20 acima do corte |
| `fullMuito` | 60% | entre oxford/EUCERIN (20%/35%) e facial (85%) — maioria Full = concorrente com estoque em CD |
| `fullPouco` | 40% | 20 pontos acima de oxford (20%), sem depender do 35% do EUCERIN |
| `TRACAO_V2.media` | R$ 15 mil | metade do menor nicho aprovado pelo gabarito (oxford, R$ 31.050) — só marca ruim bem abaixo de qualquer nicho aceito |
| `TRACAO_V2.boa` | R$ 350 mil | centro geométrico do vão medido entre oxford (R$ 31 mil) e facial (R$ 4,07 mi) — 11× de folga para cada lado |

`DEMANDA` fica intacta (D11): os três nichos dão 🟢 com os cortes atuais.

### Gabarito reproduzido

| Termo | Demanda / Disputa / Tração | Soma | Veredito | Esperado |
|---|---|---|---|---|
| EUCERIN protetor solar | 🟢 / 🔴 (pulv. 0,10) / 🟢 | 4/6 | média | média ✅ |
| protetor solar facial | 🟢 / 🔴 (Full 85%) / 🟢 | 4/6 | média | média ✅ |
| tecido oxford 10 metros | 🟢 / 🟢 / 🟡 | 5/6 | **alta** | alta ✅ |

`node scripts/sonar-gabarito-verificar.mjs` re-deriva tudo dos fixtures commitados (offline, custo
zero) e confere as 4 variantes — nickname cru vs. normalizado (`toLowerCase` + remoção do sufixo
" Loja oficial") × `% Full` sobre `itens_analisados` vs. só sobre itens com `full != null`. Os três
vereditos não mudam em nenhuma delas. Esse script é a **definição executável das fórmulas**: se a
implementação em TS der outro número, é ela que divergiu, não o corte.

### Contingências aplicadas (D12) — fatores medidos que NÃO entram na pontuação

- **`patrocinado` não tem variância — e a causa provável é o actor, não o mercado.** 60/60 itens
  dos 3 termos vieram com `tipoResultado = ORGANIC` (0 nulos). Isso **não** é "0% de anúncios
  patrocinados nestes nichos": num termo de 8.895 anúncios em cosmético, placement patrocinado é
  quase certo na página real, e o ADR-0125 já registrou o campo `patrocinado` do actor vazio em
  0/20. Sem variância não existe corte derivável, seja qual for a causa; o campo continua no
  payload como informação da linha, fora do score.
- **`frete_gratis` saiu do score.** Medido 100% / 85% / 95% — saturado e **invertido** em relação
  ao gabarito de fichas do ADR-0124 (oxford era 23% lá, é 95% aqui). O corte antigo
  `freteMuito: 85` marcaria **os três** nichos como disputa ruim. O sinal que ele aproximava
  ("vendedor estruturado, Full") agora é medido direto pelo campo `full` — que é o que entra no
  lugar dele. Frete grátis segue no raio-X como contexto.
- **Sem `VISITAS_V2`.** A revogação do ADR-0124 §6 (nas Consequências abaixo) apagou o único
  consumidor de um corte de visitas — o fallback de Demanda por tráfego. Nenhum corte foi
  inventado para um caminho de código deletado. Registro da medição para quem retomar o assunto:
  qualquer piso futuro tem de ficar **abaixo de 7.605 visitas/30d para 20 anúncios**, que é o
  valor do oxford — o nicho que o gabarito obriga a aprovar. Visitas seguem como coluna medida.

### Fragilidades conhecidas desta calibração

- **`vendedor` é o rótulo do card, não o nickname do vendedor.** Em termo de marca, os 20 anúncios
  imprimem "EUCERIN" / "EUCERIN Loja oficial" — a pulverização 0,10 do EUCERIN lê *território de
  marca*, não 2 lojas. É o que queremos medir (topo fechado), mas o texto da UI tem de dizer
  "rótulos distintos na amostra", nunca "2 vendedores". Pela mesma razão, a Tração de R$ 5,68 mi
  "por vendedor" do EUCERIN é R$/rótulo.
- **EUCERIN só é 🔴 pela cláusula de pulverização.** Com 6 rótulos distintos ele viraria 🟡 e o
  veredito subiria para alta. N=3 continua o limite real da calibração (ADR-0124, premissa 2).
- **`cobertura` do oxford é exatamente 0,50** — em cima da trava do D10. A trava tem de ser
  "*menos de* 50% derruba" (`>= 0.5` passa); um único anúncio perdendo o rótulo de vendedor no
  próximo garimpo derruba Disputa e Tração do único nicho que o gabarito obriga a aprovar.
- **Escala proporcional degenerada com 1 fator.** Se a trava de cobertura disparar, sobra só
  Demanda: `maximo = 2` e `soma >= maximo - 1` transforma **Demanda 🟡 sozinha em "oportunidade
  alta"**. A regra precisa de piso de fatores disponíveis (alta exige ≥ 2 fatores).

## Refutações registradas (não tentar de novo)

- **`date_created` de anúncio de terceiro é inobtenível pela API oficial do ML.** O ADR-0125/D9 já
  havia recebido 403 no GET unitário; a sonda por multiget (`/items?ids=...&attributes=id,
  date_created`), na aposta de que passaria por não ser GET direto, também recebeu 403 em produção
  em 19/08/2026 — sem exceção. O campo também não veio no dataset Apify em uso. Não há caminho
  restante além de scraping, fora de escopo.
- **"N pontos de visitas" não é proxy de idade do anúncio** (D9 acima) — um anúncio recém-criado e
  um anúncio maduro sem tráfego recente podem devolver a mesma contagem de pontos; a janela
  simplesmente omite dias sem visita.

## Consequências

- `sonar_snapshots` nasce como tabela **global, sem `org_id`**, com RLS habilitada e policy de
  `select` aberta a `authenticated` — variação consciente do padrão org-scoped de
  `20260816125057_pulse_v1.sql`. Justificativa: é o mesmo dado público que já vive em cache Redis
  com chave global (ADR-0120 §3; `sonar:vendas:v4` não tem `org_id`). Escrita exclusiva do
  `service_role` (edge) — nenhuma policy de insert/update/delete para `authenticated`.
- **ADR-0124 §6 (fallback sem Apify: Demanda por proxy de visitas 30d quando a Apify falha) é
  revogado.** Dependia de a lista de anúncios vir da API oficial (fichas); na arquitetura nova a
  lista de anúncios vem da própria Apify — sem ela não há `item_ids`, logo não há visitas para
  somar. O caminho de código do fallback é removido, não reescrito.
- `ItemVendas` (shared) ganha campos derivados do payload Apify já pago — zero chamada nova.
- Perdas assumidas em relação à tela atual: vendedores/UF e reputação do vendedor
  (`vendedorID` 0/20 na Apify, `/users/{seller_id}` sem seller_id); seção "fichas sem vendedor
  ativo"; faixa de preço min/mediana/máx por ficha; ofertas por ficha; palavras-chave de fichas
  (ficam as dos títulos da amostra). Em relação ao Hunter Spy, idade do anúncio e vendas/mês
  estimadas seguem inobteníveis — o histórico desta entrega é o substituto: vendas do período
  medidas, não estimadas.
- `pulse-sonar` (edge), `src/lib/sonar-cruzamento.ts` e o cruzamento D4 do ADR-0125 são deletados.

## Superação parcial do ADR-0125

Este ADR supersede o **ADR-0125/D4** (casamento ficha↔anúncio no frontend por `idPublicacao`): a
interseção 0 medida em 19/08 mostra que os dois universos não se cruzam o suficiente para o
cruzamento ter utilidade prática, então a unidade da tabela deixa de ser a ficha. As demais decisões
do ADR-0125 (D1 agregação por MAIOR, D2 cache `v4`+`por_anuncio`, D3 bump `sonar:v3`, D9 sonda de
`date_created` e sua refutação) continuam válidas como registro de medição — nada nelas é
contradito por este ADR; D3 fica órfã com a deleção da `pulse-sonar` (D3 acima), mas o cache expira
sozinho em 24h.
