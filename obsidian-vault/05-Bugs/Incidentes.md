---
tags: [bugs, incidentes]
atualizado: 2026-08-13
---

# Incidentes

Ocorrências reais em produção, documentadas em ADRs e `docs/TASKS.md`/`project-history.md`. Ver
[[Bugs Conhecidos]] (o que ainda está aberto), [[Problemas Resolvidos]].

## 2026-08-13 — variação viva no ML, inexistente no PubliAI (linha Xik, cor Azul)

Uma venda pelo anúncio de catálogo `MLB7010890734` não baixou estoque e caiu no alerta "venda sem
SKU reconhecido". O anúncio `MLB6901096672` tem **3** variações no ML — Branco, Preto e Azul
(`203375281741`, SKU `00220809`, GTIN `7894659007861`) — e o banco só tinha 2. O `seller_custom_field`
preenchido prova que a Azul foi publicada pelo próprio app.

**Causa raiz:** o UPDATE que cria cor nova pode criá-la no ML e **não** marcar `publicado_em`
(guard de `update-familia-ml/processar.ts`, quando o ML não devolve o vínculo da cor). Depois,
`excluir-lote` apaga toda família sem `publicado_em` (`_shared/lote/exclusao.ts`), levando junto a
variação. A cor continua viva no anúncio e nada no banco a representa. O silêncio veio de brinde:
com o SKU presente no pedido, a RPC devolvia `sku_nao_encontrado` e `registrarBaixaVenda` seguia
sem alertar — o alerta de 2026-08-11 só cobre item **sem** código.

**Impacto:** 2 unidades (21/07 e 13/08). Varredura dos 142 anúncios da conta AVIL (1.241
variações vivas no ML) confirmou que era a única órfã.

**Correção:** variação reinserida já reconciliada com os vínculos do ML (sem escrever no anúncio);
guard anti-órfão em `particionarExclusao`; alerta `estoque_sku_desconhecido` no `sync-venda`.
Ver [[Edge Functions]], `docs/TASKS.md`.

## 2026-08-11 — 12 unidades venderam sem baixar estoque (org DSA)

O NIVEA vendeu 12 unidades em 10 pedidos pagos e o saldo continuou 12. Na tela de Faturamento o
item aparecia com Código `—`.

**Causa raiz:** `carregarCatalogo` (`_shared/faturamento/io.ts`) filtrava `familias` e `variacoes`
por **`user_id`** — o `criado_por` da conexão do canal. O produto foi cadastrado por **outro
membro da mesma org**, então ficava fora do catálogo: `is_publiai = false`, código não resolvido e,
sem código, nenhuma baixa. Resíduo pré-multi-tenancy: o dado é org-scoped desde o E7 (ADR-0027), e
o próprio `backfill-faturamento` já chamava esse filtro de "proxy legado".

**Por que ninguém viu:** `selecionarBaixas` descartava item sem código **em silêncio**. O motivo
`venda_sku_nao_encontrado` já existia no ledger e tinha **0 linhas em todo o banco** — uma tabela
de diagnóstico vazia era, na verdade, o sintoma.

**Correção:** filtro por `org_id` (com fallback para `user_id` só quando não há conexão para
resolver a org); venda paga sem SKU vira movimento informativo (`quantidade = 0`) mais notificação;
e o `seller_custom_field` do ML entra como último recurso para resolver o código — **sem** promover
o item a `is_publiai`, que significa "anúncio gerenciado por nós". Alcance medido: Avil **0 de 297**
famílias, DSA **2 de 6**. Os 10 pedidos foram re-enfileirados e a baixa rodou de verdade (saldo 12
→ 0, o ML pausou o anúncio sozinho): nenhum ajuste manual foi usado, o histórico ficou com a causa
certa. 8 functions redeployadas.

**Lições:** (1) filtro por `user_id` em código org-scoped é bug latente em qualquer org com mais de
um membro; (2) tabela de diagnóstico com 0 linhas merece desconfiança, não conforto.

## 2026-08-11 — RPC de estoque publicada com `EXECUTE` para `PUBLIC`/`anon`/`authenticated`

Na entrega do ajuste de estoque (ADR-0110), os `revoke`/`grant` da função `ajustar_estoque` vieram
**depois** do `alter function … owner to estoque_rpc_executor`. Como o `supabase db push` **não**
envolve a migration em transação, o executor não era grantor válido e os comandos viraram **no-op
com WARNING, não erro** — a migration "passou" e a função ficou aberta.

Como toda RPC de estoque é `security definer` e recebe `p_org` por parâmetro, isso equivalia a
expor escrita de estoque de **qualquer organização** a qualquer usuário autenticado. Corrigido pela
migration `20260811203500`.

**Regra que fica:** grants **antes** do `alter owner`, ou `set local role` dentro de
`begin/commit` explícito — e conferir o resultado, porque a ausência de erro não prova nada aqui.
Ver [[Estoque]].

## 2026-08-07 — Publicados mostrava menos unidades vendidas que o Faturamento (protetor solar, DSA)

O protetor solar (`00000004`) aparecia com **38** unidades vendidas em Publicados e **59** no
Faturamento. O produto vende por dois MLB: o anúncio próprio (`MLB4982690837`) e o de catálogo
(`MLB7343614472`), vinculados por `variacoes.catalog_listing_id`. `Publicados.tsx` chamava
`calcularResumo` sem o mapa canônico (`anuncio-canonico.ts`), então as 21 unidades vendidas pelo
anúncio de catálogo ficavam num MLB que a tela não lista. Dashboard, Financeiro e Detalhe de vendas
já passavam o mapa — só o call site de Publicados divergia.

Fix: Publicados passou a consumir `useResumoVendas`, eliminando o call site duplicado. Lição: quando
um hook existe justamente para montar as dependências de um cálculo, chamar o cálculo direto na
página recria o bug que o hook previne. Ver [[Índice de ADRs]] (ADR-0021, ADR-0038, ADR-0055).

**Segundo defeito do mesmo dia — as entradas sumiam da aba Movimentos.** No card do mesmo produto, a
lista mostrava só vendas. `fetchMovimentosEstoque` tinha `limite = 20` e o componente nunca passava
outro valor; o produto tem 56 movimentos e as duas entradas caíam nas posições 37 e 56. Nada na tela
dizia que a lista estava cortada — a mesma classe de falha do caso acima: **truncagem silenciosa
parece um resultado completo**. Corrigido em duas etapas no mesmo dia: primeiro página de 100 com
aviso, depois paginação server-side com filtros de tipo, período e SKU (spec
`2026-08-07-paginacao-movimentos-estoque-design.md`). O default é "tudo, sem filtro de data" — um
default de 30 dias recriaria o defeito num produto parado. A regra que fica: **toda lista cortada
mostra o total**, senão ninguém descobre o que não está vendo.

## 2026-08-06 — troca de categoria para competir no catálogo re-moderou o anúncio (Aquaphor, DSA)

Durante o destrave da vinculação de catálogo dos 3 anúncios da DSA, o Aquaphor Duo Pack
(`MLB7330859238`) casava por GTIN com a ficha `MLB25749603`, que vive no domínio
`MLB-FACIAL_SKIN_CARE_PRODUCTS` enquanto o anúncio estava em `MLB-BODY_SKIN_CARE_PRODUCTS`. O
opt-in devolvia `400 catalog_product_id.invalid ... does not belong to domain`. A categoria foi
trocada por `PUT /items/{id}` (aceito: item `active`, `sold_quantity: 0`, categoria alinhada à dos
3 concorrentes da ficha, `MLB264874`), o opt-in passou e criou `MLB7343603036` — e **~9 segundos
depois o ML re-moderou o par**: original e anúncio de catálogo em `under_review`/`forbidden`.
Nesse estado o item não é editável (`item.category_id.not_modifiable`), então a categoria não pôde
ser revertida; a contestação só existe no painel do ML.

Contexto que pesa no diagnóstico: `ml_moderacao` mostra que esses Eucerin **já tinham moderação
recorrente** por `pending_documentation` (`MLB4982690837` em 02/08, resolvida 04/08;
`MLB7330859238` em 05/08, resolvida no mesmo dia) — marca regulada, exigência de documentação na
conta. A troca de categoria muito provavelmente re-disparou a fila de moderação, que dessa vez
voltou como `forbidden`.

**Desfecho (mesmo dia):** o ML mandou dois e-mails — o anúncio de catálogo do protetor solar
pausado pedindo NF-e (o **original seguiu ativo e vendendo**), e o **original do Aquaphor cancelado
por propriedade intelectual** ("os dados do produto não correspondem ao produto original"): vincular
um Aquaphor corporal à ficha de *hidratante labial* do domínio facial é exatamente a incompatibilidade
que a política de PI pune. Estoque 12, zero vendas, `under_review`/`forbidden` — recuperável por
contestação com NF-e, que é o caminho em curso.

**Recuperação (2026-08-06):** não havia contestação possível — o ML deu o anúncio como "Finalizado".
Republicado pelo fluxo normal do app (reset da família + `publish-familia-ml`), nos moldes originais:
`MLB5004717379`, categoria `MLB1262` (Cuidado do Corpo), título completo restaurado ("...Sem
Fragrância", que o vínculo tinha truncado), R$ 54,90, 12 un, Clássico, `me2` sem frete grátis, sem
vínculo de catálogo. O worker de catálogo rodou e **não** vinculou (a trava de domínio segura a
ficha facial). O anúncio novo entrou em `pending_documentation` ~40s após a criação — a mesma
exigência de NF-e da marca Eucerin que este produto já tinha sofrido em 05/08 e que foi resolvida
no mesmo dia; reativa sozinho quando a nota é apresentada. As 6 fotos que o operador havia
adicionado à mão no painel não voltam pelo app (ele só conhece capa + foto da variação) e
`pictures` não é editável sob revisão — restaurar só depois da reativação.

**Causa real do "a nota não corresponde ao produto" (2026-08-06):** a NF-e 000005064 (Drogaria
Moraes → CPF do titular da conta, EAN `4005800220012`, 12 un) descreve **"EUCERIN DUO-PACK AQUAPHOR
18G"**, enquanto o anúncio dizia **"10 ml 2 un"** — e o "10 ml" vinha do **cadastro da planilha**
(`descricao_pai`), de onde se espalhou para `nome_pai`, `titulo_ml`, `descricao_ml` e os atributos
(`UNIT_VOLUME = 10 mL`). O produto real é 18 g = **2 bisnagas de 9 g** (Ultrafarma e outros
varejistas; a ficha do catálogo do ML também está errada, dizendo 10 ml). Corrigido em todo o
cadastro: título `Pomada Reparadora Eucerin Aquaphor Duo Pack 18g 2x9g`, `UNIT_VOLUME` → `UNIT_WEIGHT
= 9 g` com `UNITS_PER_PACK = 2`, descrições reescritas, campos marcados como editados pelo operador
para um reprocesso não trazer o erro de volta. Republicado como `MLB7345071684` (ativo).
**Não há planilha a corrigir:** o lote é `origem: manual` (`planilha_path` nulo) — o produto foi
cadastrado pela tela, então a fonte do "10 ml" era o próprio cadastro no banco, já corrigido. Uma
varredura de todos os campos de `familias`/`variacoes` da família confirmou zero resíduo de
"10 ml"/"20 ml". Para lotes vindos de planilha, aí sim o arquivo de origem precisaria ser corrigido.
O "10 ml" também estava **dentro de uma das fotos**: o card "Informações do produto"
(`985349-MLB115653216497_082026`) diz *"10 ml cada / Conteúdo total: 20 ml"*. Ao restaurar as fotos
do anúncio antigo em `MLB7345071684`, essa ficou de fora — imagem também é dado do produto para a
moderação do ML, e recolocá-la reporia a contradição com a NF-e.

**Lição:** a categoria escolhida na publicação decide se o anúncio poderá competir no catálogo
(a ficha precisa ser do mesmo domínio). Trocar categoria depois de publicado é ação de risco —
re-modera o anúncio e pode derrubá-lo por PI. **Trava implementada no mesmo dia:**
`fichaEquivalente` reprova ficha de domínio diferente (`dominio_<ficha>_vs_<item>`), então o
sistema nunca mais aponta para uma ficha que só seria vinculável mudando a categoria. Validada
contra 5 vinculações reais (domínio idêntico em todas). Ver [[Índice de ADRs]] (ADR-0021, revisão
2026-08-06).

## 2026-08-04 — produto da Avil foi gravado indevidamente na DSA

**Sintoma:** uma família de tecido Oxford da Avil apareceu no estoque da DSA com cinco variações
e saldo total 1.000.

**Causa raiz:** não houve leitura cruzada por RLS. Uma intervenção SQL administrativa criou uma
segunda árvore de lote/família/variações na DSA e preencheu estoque diretamente, fora do fluxo de
cadastro e do ledger.

**Correção:** a árvore exata da DSA foi removida em transação após confirmar que não possuía
anúncios, movimentos ou vínculos externos; o produto legítimo da Avil permaneceu intacto. A
migration `20260804113000_guard_manual_product_direct_writes.sql` passou a validar a cadeia de
organização, imutabilidade do lote e invariantes do cadastro manual, além de permitir mudança de
saldo somente pelas RPCs auditadas. O token administrativo usado no incidente também foi
rotacionado e o anterior revogado.

**Lição:** `service_role`/SQL administrativo não substitui o fluxo de domínio. Toda mutação de
tenant precisa resolver o `org_id` explicitamente, mostrar o alvo antes da autorização e terminar
com readback cruzado comprovando que as demais organizações não mudaram.

## 2026-08-02 — Alertas Telegram pararam de chegar (token corrompido em Configurações)

**Sintoma:** Diego reportou que desde sexta-feira (2026-07-31) não recebia mais alertas Telegram
(vendas, perguntas, financeiro etc.), embora o resto do sistema seguisse normal.

**Causa raiz:** `configuracoes.telegram_bot_token` da org Avil tinha um valor de **8 caracteres** —
não é um token válido do Telegram (formato real `\d+:[A-Za-z0-9_-]{35}`, ~46 chars). Confirmado ao
vivo contra a API real do Telegram (`GET /bot<token>/getMe` via extensão `http` do Postgres, mesmo
padrão do incidente de frete/Mercado Envios — token nunca exposto no output): **404 Not Found**.
`atualizado_em` da linha: 2026-08-01 08:56 UTC (sábado), editado pela própria conta do Diego —
provável colagem incompleta do Bot token em Configurações → Alertas no Telegram.

**Por que ficou silencioso:** `enviarTelegram` (`_shared/notificacoes/telegram.ts`) só faz
`console.warn` na falha e retorna `false` — sem sinal nenhum na tela. As notificações in-app (mesmo
ponto de disparo, `notificarCategoria`) continuaram sendo gravadas normalmente todos os dias
(inclusive sexta, 40 registros) — isso isolou o problema no envio Telegram, não no pipeline de
disparo em si. RPC `telegram_config_status()` só informa `tem_token boolean`; não valida
formato/validade, então "tem token" não provava "token funciona".

**Alcance:** o bot é único por organização (ADR-0068) — Michael e Samuel (mesma org Avil) também
pararam de receber, não só o Diego.

**Correção:** Diego recolou o Bot token correto em Configurações → Alertas no Telegram.

**Lição:** um `console.warn`-e-segue em envio de notificação externa (mesmo padrão de outros
"best-effort" já documentados aqui) esconde falha de configuração indefinidamente. Testar o token
direto contra `getMe` da API do Telegram via extensão `http` é mais confiável que assumir "token
presente = token válido". Candidato a melhoria futura (não implementado): validar o formato do
token no momento do save em Configurações (checável sem nem chamar a API do Telegram) para falhar
LOUD ali, em vez de silenciar no primeiro envio real.

## 2026-07-30 — Frete da Viabilidade saía R$0 sem explicação (conta ML sem Mercado Envios)

**Sintoma:** Diego reportou que o "Frete (vendedor)" na Viabilidade estava R$12,35 pra um GTIN e
questionou se o ML pagava 50% do frete. Investigando, achou-se um segundo problema: no Safari
(logado como a org DSA) o mesmo GTIN mostrava frete **R$0**, sem a linha "Frete (vendedor)" — no
Chrome (org Avil), R$12,35 normal.

**Causa raiz nº 1 (menor, resolvida no mesmo fio):** o modo "Colar GTINs" da Viabilidade nunca
enviava dimensões de pacote pra `buscarFreteVendedor`, então sempre caía no pacote genérico
(16×11×6cm/300g) do `_shared/ml/frete.ts`, mesmo quando o produto já tinha dimensões reais
cadastradas em `variacoes`. Fix: buscar por `org_id`+`gtin` antes do fallback; sem achar (caso mais
comum — produto ainda não cadastrado, é o propósito da tela), oferecer input manual por linha.

**Causa raiz nº 2 (a divergência Safari×Chrome):** a conta DSA ($ANALISTA$, `ml_user_id` 9757132) —
NEWBIE, zero vendas — nunca aderiu ao **Mercado Envios** no Mercado Livre. `GET
/users/9757132/shipping_options/free` respondia **400 "does Not have me2 enabled"**, e
`buscarFreteVendedor` (best-effort, ADR-0050) engolia o erro e devolvia 0 silenciosamente — sem
distinguir "comprador paga o frete" (0 real) de "não deu pra calcular" (0 por falha).

**Achado colateral importante:** `GET /users/{id}` → `status.mercadoenvios` fica **desatualizado**
por um tempo depois da adesão real — confirmado ao vivo (um subagente checou minutos depois de
Diego ativar o Mercado Envios pelo painel: o campo ainda dizia `"not_accepted"`, mas
`shipping_options/free` já respondia 200 normalmente). A fonte confiável em tempo real é
`GET /users/{id}/shipping_preferences` → `"me2"` em `modes`.

**Correção (ADR-0095, PRs #37/#38/#39):** `ml-oauth-claim` passou a checar `shipping_preferences`
no momento da conexão e grava `marketplace_connections.me2_habilitado`. Quando `false`: aviso na
tela **Canais** (junto do card da conexão) e banner em toda análise da **Viabilidade** explicando
que o frete saiu R$0 por falta de adesão, não porque é zero de verdade. Testado ao vivo contra a
API real do ML via `supabase db query --linked` + extensão `http` do Postgres (token nunca exposto
no output — só usado dentro do header da chamada).

**Lição:** um "best-effort" que devolve 0 em qualquer falha (padrão correto pra não travar a tela)
fica mudo por design — sem um sinal parceiro do PORQUÊ, o operador não distingue "o comprador paga"
de "não conseguimos nem tentar". E campos de status de conta de plataforma externa podem ter
propagação assíncrona: não assumir que o campo "óbvio" reflete o estado real; testar
funcionalmente quando possível (aqui, `shipping_preferences` bateu com a realidade;
`status.mercadoenvios` não).

## 2026-07-31 — Devoluções do ML "sempre" divergindo do Dashboard (dois bugs, ambos silenciosos)

**Sintoma:** Diego reportou que as devoluções do ML "nunca são computadas" no PubliAI sozinhas —
sempre precisa pedir revisão manual. Print do painel do ML: 3 devoluções (R$59,99+R$35,76+R$12,50 =
R$108,25). Dashboard do PubliAI (90 dias): "2 devoluções · R$48,26" (só R$35,76+R$12,50).

**Causa raiz nº 1 — `reconciliar-faturamento` nunca completava, desde a criação do schedule
(24/07).** `GET /v2/events` do QStash: 94 de ~747 execuções em `ERROR`, TODAS aos ~150s
(`WORKER_RESOURCE_LIMIT`/`IDLE_TIMEOUT`) — ou seja, TODA hora, sem exceção. A função processava
Vendas (item mais caro) → Perguntas → Devoluções por último, para 2 orgs no mesmo loop: o
orçamento de 150s da edge function estourava antes de chegar em Devoluções. Mesmo sintoma já
corrigido em `backfill-faturamento` em 26/07 (reordenar + paralelizar), nunca replicado aqui — a
"rede de segurança" contra webhooks perdidos nunca rodava de fato.

**Causa raiz nº 2 — estorno TOTAL nunca era capturado, em nenhuma execução (não era timing).**
`carregarLiquidoMPDoPedido` só aceitava pagamento MP com `status === 'approved'`. No estorno
PARCIAL o MP mantém `approved` com `transaction_amount_refunded > 0`; no estorno TOTAL o `status`
vira `refunded` — excluído pra sempre pelo filtro, em qualquer execução futura. Afetava os 3
callers: `sync-devolucao` (real-time), `sync-venda`, `reconciliar-faturamento`. Provado ao vivo:
pedido do "Tecido Oxford" (R$59,99, estorno total) tinha claim `refunded` em `ml_devolucoes` mas
`ml_vendas.estorno = null` — o pagamento MP tinha `status: "refunded"`, descartado pelo filtro.

**Por que o Dashboard some com devolução mesmo tendo `ml_devolucoes` certo:** o Dashboard conta
por `ml_vendas.estorno > 0`, não por `ml_devolucoes` (decisão deliberada — comentário em
`Dashboard.tsx` diz que `ml_devolucoes` "tem lacunas de sincronização"). Só que o mecanismo que
alimenta `ml_vendas.estorno` pra devoluções antigas é o PRÓPRIO `reconciliar-faturamento` — os dois
bugs se reforçavam.

**Correção:** `reconciliar-faturamento` em duas passadas (devoluções+perguntas de todas as orgs
antes de vendas) + lotes de 5 + guarda de orçamento (nunca mais estoura 150s, responde 200 com o
que teve que pular). Filtro de estorno aceita `approved` e `refunded`, tanto no fetch por-pedido
quanto na varredura em lote (`buscarPagamentosMP`, 2 buscas por status — mesmo padrão de
`buscarClaimsSeller`). Redeploy de 4 funções (`reconciliar-faturamento`, `sync-devolucao`,
`sync-venda`, `backfill-faturamento`). Verificado ao vivo via QStash publish direto +
`supabase db query`: 2 execuções `DELIVERED`/200 em ~65s, `ml_vendas.estorno` do pedido Oxford
virou `59.99`. Detalhe técnico completo, incluindo a lacuna conhecida de 4 pedidos antigos sem
claim que ficaram de fora (fora das janelas de 72h/7d, tentativa de backfill manual amplo estourou
150s e foi abortada sem insistir):
[[Edge Functions#Histórico — reconciliar-faturamento estourava 150s em TODA execução + estorno total nunca capturado (corrigida)]].

**Lição:** um schedule "existir e não estar pausado" não prova que ele COMPLETA — checar o
histórico de execuções (`GET /v2/events`), não só `GET /v2/schedules`. E um filtro de status
allowlist (`=== 'approved'`) pra proteger contra um caso ruim (`rejected`) pode excluir
silenciosamente um caso bom que o autor não previu (`refunded`) — pensar em todos os status
terminais válidos, não só no que se quer bloquear.

### Continuação, mesmo dia — a própria correção acima gerou uma supercorreção (28 devoluções)

**Sintoma:** horas depois do fix acima, o Dashboard passou a mostrar **"28 devoluções ·
R$1.648,01"** no mês. O `reconciliar-faturamento` corrigido fez o backfill completo de
`ml_vendas.estorno`, e o proxy do Dashboard (`estorno > 0`) — decisão original do ADR-0038 para
fugir das lacunas de `ml_devolucoes` — passou a contar **qualquer** pedido com reembolso parcial
ou negociado no Mercado Pago, não só devolução de verdade. Antes do backfill completo a proxy
"acertava por acaso" (poucos pedidos tinham `estorno` populado); depois, não.

**Correção (2 rodadas):** trocado o proxy de `ml_vendas.estorno > 0` para `ml_devolucoes` com
`type = 'returns'` e `return_status_money = 'refunded'` — ver [[Glossário]] ("Devolução
(concluída)") para a definição completa. Primeira tentativa usou só `status !== 'opened'`, frouxa demais (contava
devolução rejeitada com dinheiro retido). Segunda rodada apertou pra `return_status_money`,
conferida pedido a pedido contra o painel do ML. PRs #45/#46/#47.

**Desvio investigado e descartado:** cheguei a suspeitar de um novo bug de sync (`buscarReturn`
gravando "reembolsada" antes da hora) porque 1 devolução batia no banco mas não aparecia como
"finalizada" no painel Devoluções do ML. Puxando a API do ML ao vivo (token da própria conexão via
RPC `get_connection_tokens`) para os 6 claims do período: todos batiam 1:1 com o banco
(`status: closed`, `status_money: refunded`, `resolution.applied_coverage: true`). Não era bug
nosso — claims resolvidos automaticamente por mediador (`low_cost`: item de baixo valor, ML
reembolsa sem devolução física; `item_returned`: devolução física normal, ambos com
`applied_coverage`) não geram card/busca confiável na própria tela "Devoluções" do ML. Resultado
final: **6 devoluções · R$212,42** confirmado correto.

**Lição:** um proxy "temporário" pra fugir de lacuna de sync (ADR-0038) precisa ser revisto quando
a causa que motivou o desvio é corrigida — ele pode passar a errar pro lado oposto. E "não bate com
a tela do sistema terceiro" nem sempre é bug nosso: a UI do próprio ML pode não listar de forma
confiável eventos resolvidos automaticamente (sem ação do vendedor) — checar a API ao vivo antes de
assumir que o dado gravado está errado.

## 2026-07-10 — Cache Redis de schema no formato antigo zerava o enriquecimento IA de atributos (fita)

**Sintoma:** Diego reportou que a IA não preencheu Comprimento/Largura em "Características
principais" de uma Fita Refletiva Fluorescente 5cmx100m (MLB4876171545), mesmo com "5 cm de largura
e 100 metros de comprimento" claro na descrição gerada pela própria IA.

**Causa raiz (não era o que parecia):** o [ADR-0049](../../docs/decisions/0049-atributos-opcionais-e-numericos-por-ia.md)
(29/06) adicionou `valueType`/`allowedUnits`/`tags` ao `parseAtributosSchema`, mas o schema é
cacheado no Redis por **30 dias** (`attrs:<categoria>`). Entradas gravadas antes de 29/06 ficaram no
shape antigo (sem `tags`). Num cache hit, `atributosAlvo` fazia `a.tags.some(...)` com
`a.tags===undefined` → **TypeError**, engolido pelo try/catch de `process-familia` (log genérico).
O item saía só com os atributos determinísticos de `montarAtributosML` → **zero** enriquecimento por
IA. Atingia **toda categoria cacheada antes de 29/06 dentro do TTL** — silencioso por ~11 dias.

**Diagnóstico (padrão replicável):** comparar irmãos do mesmo lote — famílias de categorias
cacheadas depois de 29/06 enriqueciam normal; as de antes ficavam peladas. Confirmado inspecionando
o Redis direto (`GET attrs:MLB255054` no shape antigo vs `attrs:MLB105311` no novo). Descartadas 3
teorias erradas antes (ambiguidade de texto, gap copywriter-vs-atributos, falha aleatória de LLM) —
o dado estava claro na descrição bruta; o problema era o schema nunca chegar aos alvos.

**Fix (PR #11, ADR-0049 adendo):** (1) versão no shape da chave → `attrs:v2:<categoria>`
(`CACHE_VER`), mudança futura de shape expira as entradas antigas sozinha; (2) guard `(a.tags ?? [])`
em `atributosAlvo` — degrada em vez de estourar-e-engolir. Teste de regressão adicionado.

**Remediação imediata (sem esperar deploy):** flush das 22 chaves `attrs:*` no Redis — o código em
produção já emitia o shape novo, então o próximo publish refez o fetch correto. Itens já publicados
degradados (MLB4876171545 + fitas do lote) corrigem no reprocessamento normal.

**Lição:** qualquer cache com TTL longo + shape versionável precisa de versão na chave; sem isso, a
mudança de formato do parser não invalida o que já está cacheado. E um `catch(() => ({}))` que
iguala falha técnica e omissão deliberada esconde bug — o que segurou este por 11 dias.

## Publicados "Indisponível" para membros não-donos (2026-07-03)

Com 3 membros na operação compartilhada (Diego admin, Michael, Samuel), a tela **Publicados**
mostrava tudo com status **"Indisponível"**, colunas Estoque/Preço/Vendas em `—`, card **Ativos
0/61** e **Encalhados 0** — para quem **não é dono** dos anúncios. Só o Diego via os dados
corretos.

**Causa raiz:** descompasso de multi-tenancy do ADR-0047. A **lista** de anúncios virou
compartilhada (RLS `is_membro_operacao()`), mas o **enriquecimento ao vivo** e as **ações** do ML
continuaram escopados ao chamador: `.eq('user_id', user.id)` + `getValidAccessToken(user.id)`. Só
o Diego é dono das 81 famílias e tem a **única** `ml_credentials` (conta AVILBV, `ml_user_id`
1003820507). Para Michael/Samuel, `status-publicados`/`metricas-vendas` devolviam `{ itens: [] }`
→ o front caía no fallback `'indisponivel'`. Não é concorrência (os 3 ao mesmo tempo foi
coincidência). O mesmo descompasso impedia publicar/remover/reprocessar/responder perguntas e
faria um lote ingerido por membro não-dono **duplicar** anúncios (viraria CREATE).

**Correção (ADR-0056 — `docs/decisions/0056-*`):** helper `_shared/ml/operacao.ts`
`userIdCredencialOperacaoML(admin)` (conexão ML da operação); 10 edge functions passam a usar
escopo + token + gravação da **operação**. `ingest-lote` grava `familias/variacoes.user_id` = dono
da conta ML (invariante que os 7 workers de publicação já assumem → intocados); operador fica em
`lotes.user_id`. Fila serial (ADR-0034) keyed por `familias.user_id`. Ponto único de troca para o
E7 (multi-org). Deploy CLI 10/10; `deno check` + `pnpm lint` + 1156 testes verdes.

## Título duplicado derruba anúncio (2026-06-22)

Duas famílias que diferem só na cor (ex.: "ALFINETE N.0 PRATA" e "ALFINETE N.0 DOURADO") viram
anúncios separados (1 família = 1 anúncio), mas o copywriter de IA removia a cor do título
(tratando como agrupado multi-cor) — os dois anúncios ficavam com título **100% idêntico**. O ML
detecta como duplicado e baixa o segundo (`under_review`, `sub_status=forbidden`). Item nesse
estado não é editável por API — só recriando.

**Impacto real:** 3 alfinetes Prata baixados (N.0/N.02/N.04); o N.03 Prata, cujo título já
continha "PRATA", permaneceu ativo — prova de que título diferenciado basta. Corrigido pelo
ADR-0044 (cor cravada no título de anúncios mono-cor). Ver `reference_ml_duplicado_titulo_cor`.

## Travamento em "publicando" por foto assíncrona (regressão)

Famílias ficavam muito tempo em `publicando` (parecendo travadas) ou caíam em `erro`. O ML
processa fotos de forma assíncrona: se a foto ainda não terminou, `POST /items` retorna
`item.pictures.unavailable`. Era uma **regressão**, não comportamento intrínseco. Corrigido pelo
ADR-0033 (parar de re-subir a foto no retry + retry interno).

## Vinculação de catálogo casando com ficha de kit (falso positivo)

**Gatilho real:** um cliente comprou pelo catálogo um anúncio de **1 rolo** que estava vinculado
à ficha `MLB25284234` = "Fita... Verde Menta... **Kit 5 Unidades**" — o título da ficha engana
(fichas-kit sem "kit"/quantidade no nome); a verdade está nos atributos estruturados
(`UNITS_PER_PACK`, `SALE_FORMAT`). Varredura em 3 famílias com catálogo achou **19 vinculações
erradas**: 17 fichas `SALE_FORMAT=Kit`/`UNITS_PER_PACK=5`, 1 `UNITS_PER_PACK=10`, 1 de dimensão
divergente. Os 19 foram **pausados no ML** (contenção). Corrigido pela trava `fichaEquivalente`
(anti-kit + metragem) no ADR-0021, com novo estado `catalog_status='ficha_divergente'`.

## Moderação sem visibilidade proativa

O ML modera anúncios (`under_review` + `poor_quality_thumbnail`/`forbidden`/
`waiting_for_patch`) e tira do ar sem avisar — o operador só percebia abrindo a tela Publicados.
A API do item só expõe o **código** do sub_status, sem texto do motivo; `/moderations/
infractions/search` (que teria o texto) retorna 401 (bloqueado por permissão, mesma classe do
`/orders`). Resolvido pelo ADR-0035: polling agendado (QStash a cada 6h) + alerta Telegram.

## Lote #41 travado com erro genérico "signal aborted" (2026-06-17)

A copy via IA (OpenRouter) excedeu o timeout de 30s no `process-familia`, e era a única etapa
sem fallback — derrubava a família inteira com mensagem genérica, sem indicar a causa real.
Corrigido pelo ADR-0030: `gerarCopy` com 1 retry + erro rotulado por etapa, nova edge function
`reprocessar-familia`, e botão "Reenviar" na UI.

## Colisão de numeração de ADRs (dois `0035`, dois `0037`)

Resolvida em 2026-06-27: `cor-no-titulo-mono-cor` virou **0044** (ex-0035) e
`vendas-catalogo-match-ean` virou **0045** (ex-0037). Detalhe em `docs/decisions/README.md`.

## Divergência de `verify_jwt` derruba o faturamento em tempo real (2026-06-28)

`ml-webhook`, `sync-venda`, `backfill-faturamento` e `reconciliar-faturamento` estavam com
`verify_jwt=true` no `config.toml`, mas são acionadas por QStash/webhook (sem JWT Supabase) — o
gateway rejeitava com **401 antes da função rodar**. `ml-webhook` enfileira `sync-venda`/
`sync-pergunta`/`sync-devolucao`; com ele rejeitado, nada era enfileirado → faturamento em tempo
real parado (dados só entravam por backfill manual).

**Impacto real (function_edge_logs, 24h):** `ml-webhook` 221 requisições, 401 em 100%;
`backfill-faturamento` 92 requisições, 401 em 100%. Mesma classe do incidente de
`process-familia` (`reference_workers_qstash_verify_jwt`). Corrigido pelo
[ADR-0046](../../docs/decisions/0046-verify-jwt-false-workers-webhook-faturamento.md):
`verify_jwt=false` nas quatro funções (autenticação real continua interna, por assinatura
QStash/`requireUser`).

## Nome do comprador: mascaramento intermitente do ML + regressão do fallback (2026-07-01)

Diego reportou que a coluna Comprador voltou a mostrar o nick em vez do nome real (ex.:
"TELE859877" em vez de "Leonardo Teixeira") num pedido onde o próprio Mercado Livre exibia o
nome completo na sua UI. Investigação (`systematic-debugging`) confirmou por dados reais de
produção (não suposição): `GET /orders/{id}` **mascara `buyer.first_name/last_name` de forma
intermitente** — o mesmo pedido (`2000017181156010`) veio com o dado completo às 14:55 e sem
ele 5 minutos depois, na sincronização seguinte. Não é bloqueio de permissão (hipótese do
endpoint CDA, `shops/cda/customers`, foi descartada com teste ao vivo).

**Regressão dentro da própria correção:** um commit anterior no mesmo dia (via Codex) tinha
removido o fallback pro `receiver_name` do envio achando que o buyer real sempre vinha — e como
cada sync recalculava `comprador_nome` do zero, um sync sem o buyer **apagava** um nome real já
capturado, substituindo pelo nome do destinatário do envio (que pode ser outra pessoa —
presente, portaria).

**Correção final:** nova função pura `escolherCompradorNome` prioriza nome real atual → nome já
salvo (nunca regride) → destinatário do envio (só quando nunca teve nada melhor). 1 pedido com
valor corrompido pela regressão corrigido manualmente via SQL (nome real já estava capturado no
`raw.buyer` de um sync anterior). Ver [ADR-0037](../../docs/decisions/0037-modulo-faturamento-webhooks-ml.md)
e `docs/TASKS.md` (2026-07-01).

## Cor do lote #24/#25: "Salmon"/"Rosa Pink" + rename e fotos no UPDATE (2026-07-06)

Diego enviou 4 cores para um tecido Oxford já publicado (`02989182`, anúncio `MLB4831319319`).
"Salmon" caiu em "Outra" e "Rosa Pink" virou só "Rosa". Investigação em três camadas:

**1. Dicionário de cores incompleto.** `_shared/cor/dicionario.ts` só tinha "salmão/salmao"
(faltava a grafia inglesa "salmon"), e "rosa"/"pink" tinham sinônimos do mesmo tamanho — o sort
por especificidade empatava e o match de primeiro-encontrado sempre pegava "rosa". Fix: sinônimo
`salmon` em Salmão + entrada composta `Rosa Pink`. Deploy das funções que bundlam `_shared/cor/`.

**2. Reprocessar não conserta cor já publicada.** No UPDATE, `ingest-lote` **herda** a cor da
família publicada (`cor: h?.cor ?? null`) e `process-familia` pula a resolução quando a cor já vem
setada (`if (v.cor) return v`). Além disso, "reprocessar" no app = **excluir o lote e re-ingerir**
(novo `numero_org`), então a correção manual feita no lote antigo (#24) foi descartada ao virar #25.
Cores já publicadas ficam congeladas; o fix do dicionário só age em cor genuinamente nova. Corrigido
editando a cor direto nas `variacoes` da família **publicada** (fonte da herança) + do lote em revisão.

**3. Publicar o UPDATE não propagava ao ML (ADR-0062).** Dois bugs no fluxo de publicação:
(a) `montarVariacoesUpdate` nunca enviava COLOR das variações **existentes** (só das novas) → rename
não ia ao ML; (b) fotos comuns CAPA2/CAPA3 duplicavam porque o dedupe comparava id de **upload**
cacheado vs id **re-hospedado** pelo ML — nunca casava, reinserindo a cada publish (até em reposição).
Fix: `buscarItemML` captura a cor atual (`corDaVariacaoML`); envia COLOR só quando muda; fotos comuns
só (re)enviadas ao criar cor nova. Ver [ADR-0062](../../docs/decisions/0062-update-cor-existente-e-fotos-comuns.md).

**Limitações (ADR-0062):** o ML pode recusar rename de COLOR em variação com vendas → anúncio já
quebrado se limpa manual no painel; adicionar cor nova a anúncio com capa2/capa3 ainda pode duplicar
(falta rastrear o id re-hospedado — ADR futuro).

## Lote #27: 4 bugs de publicação (kit, preço, categoria, concorrência) + resíduo BRILHO (2026-07-06)

Barbante Barroco Maxcolor (3 famílias). Cada família expôs uma falha diferente — "cada lote, um
erro novo". Todas corrigidas ([ADR-0063](../../docs/decisions/0063-publicacao-kit-preco-categoria-concorrencia.md)):

1. **"Unidades por kit" num produto avulso.** `UNITS_PER_PACK` é `conditional_required` no ML (só
   obrigatório SE for kit — confirmado na API para MLB271471), mas `atributosFaltantesGenerico`
   tratava todo `conditional_required` como obrigatório-duro → travava a Revisão. Fix:
   `preencherUnitsPerPack` assume 1 (produto avulso) quando não há contagem clara.
2. **Preço competitivo no prejuízo.** O ramo competitivo do `sugerirPrecoVenda` cravava
   `concorrente × (1−desc%)` ignorando custo/comissão/frete/imposto. Para barbante barato + frete
   por conta do vendedor, o preço saía abaixo do custo. Fix (decisão do Diego): `max(competitivo,
   gross-up)` — nunca abaixo do piso viável; avisa quando o piso passa da concorrência. Comissão/
   frete passaram a ser buscados também no caminho competitivo. Efeito: cores que apareciam
   "Prejuízo"/"Abaixo do mínimo" viraram "Vale a pena".
3. **Categoria "Outros".** O preditor de categoria é textual; nomes ruidosos ("BARROCO MAXCOLOR
   BRILHO 200GR") caíam na genérica. Fix: quando cai em genérico E a concorrência achou o produto
   no catálogo, re-roda o preditor com o **nome canônico do catálogo** (`concorrencia.product_name`,
   "Fio Barroco Maxcolor Brilho ... Crochê") → resolve "Lãs". **Verificado ao vivo via extensão
   `http` do Postgres** (token no Vault, RPC `get_connection_tokens`): o `category_id` do produto de
   catálogo NÃO é exposto pela API (só `domain_id=MLB-YARNS`), por isso a resolução é pelo nome.
4. **"Sem concorrência" com concorrência óbvia.** `buscarConcorrencia` usava
   `/products/search?q={gtin}` (busca textual frágil) em vez de `product_identifier={gtin}` (lookup
   oficial de EAN — que o módulo de catálogo já acertava, `catalogo.ts`), e tentava só 1 EAN. Fix:
   `product_identifier` + tenta até 5 EANs. Resultado: 01890131 subiu de 0→4 concorrentes.

**Resíduo aceito (não é bug):** o BRILHO segue **concorrência 0** — o produto de catálogo dele
(MLB22537928 etc.) genuinamente tem **0 vendedores ativos**. A concorrência que existe está em
anúncios sem vínculo de catálogo / outro EAN; pegá-los exigiria fallback por título (opção não
escolhida). A categoria do BRILHO foi corrigida para "Lãs".

Validado ao vivo (banco + browser-use no Chrome do Diego) reprocessando as 3 famílias do lote #27.

## Lote #33: kit real rejeitado — SALE_FORMAT="Unidade" × UNITS_PER_PACK>1 (2026-07-13)

Lápis de cor 24 unidades: CREATE falhou com `"Unidades por kit": Insira 1 neste campo porque você
preencheu "Unidade" no campo "Formato de venda"`. Causa: `preencherUnitsPerPack` (regex, ADR-0063)
extraiu corretamente `UNITS_PER_PACK=24` de "24UND" no título, mas a IA genérica de closed-set já
tinha preenchido `SALE_FORMAT="Unidade"` sem saber da contagem — as duas lógicas rodam em sequência
sem se comunicar. Fix ([ADR-0071](../../docs/decisions/0071-units-per-pack-forca-sale-format-kit.md)):
`preencherUnitsPerPack` agora sobrescreve `SALE_FORMAT` para "Kit" (value_id do schema dinâmico da
categoria) sempre que extrai uma contagem real (>1). Sem contagem clara (assume 1), não mexe.

## Lote #33: "N CORES" não sincronizava com UNITS_PER_PACK — produto 02905078 (2026-07-13)

Caso inverso do bug acima, mesmo lote, mesmo dia: `02905078` ("...TRACOS C/12 CORES") falhou no
CREATE com `"Unidades por kit": Insira um valor diferente de "1" porque você preencheu "Kit" no
campo "Formato de venda"`. Aqui a IA genérica preencheu `SALE_FORMAT="Kit"` corretamente (é uma
caixa de 12 lápis, um por cor), mas `extrairUnitsPerPack` não reconhecia "CORES" como token de
unidade (só `unidades/unid/und/un/pecas/pcs`) — `UNITS_PER_PACK` caiu no default `1`, contradizendo
o `Kit`. Confirmado lendo os dados reais da família em erro no banco antes de mexer no código. Fix
([ADR-0073](../../docs/decisions/0073-cores-conta-como-unidade-no-kit.md)): `RE_UNIDADES` passa a
aceitar `cores` como token de unidade — reusa o `forcarSaleFormatKit` do ADR-0071 sem mudança
adicional.

## Lote #33: título duplicado — tipo de produto/cor fora de ordem (2026-07-13)

Dois títulos com duplicação visível: `POMPOM POM POM BÚFALO 14MM...` e `LÁPIS DE ESCREVER RESINA 7
VERDE REF.SL101066-8 VERDE 7`. Não é qualidade do modelo de IA — o texto que a IA gerou já estava
correto; o bug está nos guards determinísticos de `_shared/ai/titulo.ts` que rodam depois, checando
"já está no título" por frase exata (mesma ordem/espaçamento) em vez de cobertura de informação.
1. `garantirTipoProdutoTitulo`: tipo `"pompom"` (colado, vindo da IA) não batia contra título com
   `"POM POM"` (espaçado, do nome_pai) → reprefixava.
2. `garantirCorTitulo`: cor real `"Verde 7"` não batia contra nome com `"...RESINA DE 7 VERDE..."`
   (mesmas palavras, ordem invertida) → reanexava a cor inteira de novo.
Fix ([ADR-0072](../../docs/decisions/0072-titulo-duplicacao-tipo-e-cor-fora-de-ordem.md)):
`todasPalavrasCobertas` (todas as palavras do termo, em qualquer ordem) substitui a checagem de
frase exata em `garantirCorTitulo`; `termoColadoNoTitulo` (fallback sem espaços) entra como OR na
checagem de `garantirTipoProdutoTitulo`.

## Lote #28: concorrência só olhava a 1ª cor (menor preço falso) + copy inventava "NOVO" (2026-07-08)

Linha Anne 500m (46 cores, cada uma um produto de catálogo distinto no ML) expôs dois bugs
independentes na mesma entrega.

**Parte 1 — Concorrência agregada (ADR-0064):**

A busca de concorrência parava no **1º GTIN que casava** no catálogo do ML — premissa do lote
#27 (todas as cores = mesmo produto). Falsa para o Anne: cada cor tem GTIN + produto de catálogo
(MLB ID) próprios, com preços diferentes. A 1ª cor que casou foi a Sereia 9490 (`MLB28400021`,
R$ 32,90), reportada como "menor preço da concorrência" da família toda — silenciando cores bem
mais baratas nunca consultadas (ex.: Branca 8001 → `MLB26672898`, R$ 22,39). Operador via um
"menor preço" acima do mercado real, com risco de precificação errada.

**Correção:** `buscarConcorrencia` passou a resolver **TODAS as variações válidas** em paralelo
(pool 6 workers, cap 60 GTINs) + nova função pura `agregarConcorrencia` combina os produtos: menor
preço = mínimo global, faixa = min–max global, vendedores = união distinta de seller_ids, ofertas
somadas, produto representativo = o da cor mais barata. Adicionado **negative caching** (tombstone
por GTIN) para EANs sem produto, evitando refazer as buscas inúteis a cada reprocess; erro
transitório (timeout/rede) não vira tombstone e não descarta os hits já resolvidos. Sem mudança de
schema nem de frontend (mesmos campos, valores corrigidos). Contrato de `buscarConcorrencia`
inalterado — callers `process-familia` e `analisar-viabilidade` seguem funcionando. Ver
[ADR-0064](../../docs/decisions/0064-concorrencia-agregada-por-variacao.md).

**Parte 2 — Copy IA inventava "NOVO":**

No mesmo lote, o copywriter de IA (OpenRouter) inventou "NOVO" no título ("NOVO NOVELO ANNE 500MT
| 100% ALGODÃO MERCERIZADO") — palavra que não existe na planilha nem na descrição fonte (provável
eco de "NOVELO"). A regra anti-alucinação do prompt só cobria specs técnicas; foi estendida para
proibir **adjetivos de marketing não-grounded** ("novo", "lançamento", "exclusivo", "original",
"premium", "importado") salvo se a palavra constar no nome/descrição de origem. Fix já em `main`
(commit `0254e70`), listado aqui por proximidade de timing.

**Validação (Parte 1):** ao vivo contra a API do ML (token real da org Avil) exercitando parse +
`agregarConcorrencia` sobre os 44 GTINs válidos do Anne → 43 cores com catálogo, menor preço
agregado **R$ 22,39** (Branca 8001) vs. R$ 32,90 do código antigo; 48 vendedores distintos.
Testes unitários do agregador: 11 casos. Suíte completa verde.

---

## 2026-07-10 — Publish despencou para >5 min/anúncio (era segundos) — propagação da foto no caminho crítico

**Sintoma:** operador relatou que dias antes publicava vários anúncios em segundos e passou a levar
>5 min por anúncio de 1 foto. Regressão iniciada no mesmo dia.

**Causa-raiz** (confirmada nos logs reais do QStash): o fix da manhã (retry 90s×5 para o
`item.pictures.unavailable`) deixou a espera da propagação da foto **no caminho crítico**. O
`subirFoto` (`POST /pictures`) rodava dentro do worker de publish, então o ML não tinha vantagem
nenhuma: todo publish de foto nova falhava na 1ª tentativa e ficava preso nos `retryDelay` de 90s até
a foto ficar utilizável no `POST /items` (~2,5–5 min). Log real: `CREATED 1:48:20 → 4×RETRY(90s) →
DELIVERED 1:54:39` = 6min19s. Fila serial (`parallelism:1`) amplificava: lote de N = N×6 min.

**Correção (2 etapas):**
1. **Pré-upload** das fotos no `process-familia` (`_shared/anuncios/pre-subir-fotos.ts`): a propagação
   corre antes do publish → `POST /items` acha o `picture_id` pronto → publica em segundos.
2. **Invalidação** do `*_ml_picture_id` na troca/remoção de foto (`upload-imagens-lote/processar.ts`,
   `src/lib/upload-imagens.ts`) — sem isso, reusaríamos a imagem antiga cacheada pelo ML. Corrige
   também bug latente do UPDATE.
3. Retry vira rede de segurança fina: 30s×10 (era 90s×5).

Ver [ADR-0033](../../docs/decisions/0033-retry-interno-foto-em-processamento.md) (adendo da tarde).

---

## 2026-07-10 — Cor "Outra" vazando: gap no UPDATE ao vivo + 14 anúncios já publicados com o defeito

**Sintoma:** Diego reportou "OUTRA" no título de um produto (screenshot). Investigação mostrou que
não era regressão do fix da manhã (`ehCorIndefinida`) — era dado processado ANTES do fix (título/
descrição só são calculados no processamento, publicar não recalcula).

**Alcance real, achado ao investigar:** 15 famílias no banco com o vazamento, **14 já publicadas
no Mercado Livre**, retroagindo a 12/06 (quase um mês). Uma publicou hoje 18:20 — **depois** do fix
— porque o texto já persistido (de antes do fix) foi simplesmente reusado no publish.

**Bug ativo adicional (não só dado velho):** o fluxo de UPDATE em anúncio já publicado
(`update-familia-ml` → `sincronizarDescricao`) filtrava só `cor != null`, sem excluir o sentinela
`'Outra'` — o mesmo vazamento, caminho diferente, ainda no código em produção. Corrigido com o
mesmo guard `ehCorIndefinida()` do CREATE.

**Gap de capacidade:** não existia mecanismo para corrigir o **título** de um anúncio já publicado
(só a descrição tinha push pós-publicação). Título só era editável antes de publicar. Adicionada
`atualizarTituloML()`.

**Remediação:** corrigidos título+descrição das 15 famílias no banco e ressincronizados no ML para
as 14 já publicadas, priorizando as 9 com "OUTRA" visível no título.

Ver [ADR-0044](../../docs/decisions/0044-cor-no-titulo-mono-cor.md) (adendo 2026-07-10).
