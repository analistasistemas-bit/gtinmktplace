# PubliAI — Tasks

> Checklist operacional. Atualize o status conforme as tarefas avançam. Para visão estratégica das fases, ver [ROADMAP.md](ROADMAP.md).

## Concorrentes relevantes no Pulse e na Viabilidade (spec `2026-08-20-concorrentes-relevantes-pulse-viabilidade-design.md`) — 2026-08-21

- [x] Classificador compartilhado `qualificarOferta`/`resumirMercadoQualificado`
  (`_shared/concorrencia/qualificacao.ts`): relevante (≥10 transações, visitas 30d ≠ 0 medido,
  reputação fora de `1_red`/`2_orange`), observação (sem `transactions_total`) ou fora da referência
  — mesma função no Pulse e na Viabilidade.
- [x] Migration `20260821110914_pulse_qualificacao_vendedor.sql`: `pulse_vendedores.reputacao_detalhe`/
  `perfil_coletado_em`, `pulse_ofertas.visitas_30d_em`, view `pulse_ofertas_atual` estendida.
- [x] `normalizarPerfilVendedor` lê `seller_reputation` aninhado (não mais o nível raiz de
  `/users/{seller_id}`); cache `cache:seller:v2:{seller_id}` global, TTL 24h.
- [x] Pulse/Radar: alertas, posição e estatísticas (menor/maior, vendedores, frete grátis, FULL)
  passam a usar só o mercado relevante; mercado observado preservado para auditoria na UI
  (`Menor concorrente relevante` / `Menor oferta observada` / `X de Y`).
- [x] Viabilidade: `resolverMercadoRelevante` (`_shared/analise/mercado-relevante.ts`) reaproveita
  snapshot Pulse ≤24h por org/produto ou busca reputação/visitas sob demanda com pool compartilhado
  de concorrência 6 e dedupe por chave, retry-safe após rejeição (promise só é evictada do `Map` se
  ainda for a atual). Cálculo financeiro só roda com `mercado.menor != null`; sem relevante mostra
  `Sem concorrente relevante` e travessão, nunca R$ 0,00 nem o observado como fallback.
- [x] Cache `chaveCacheGtin` bump `gtin:v4` → `gtin:v5` (payload agora exige `item_id`,
  `frete_gratis`, `full`).
- [x] Suíte focada 161/161, `tsc -b --force`, `deno check`/`check:functions`, `pnpm lint` (0 erros
  no diff, 12 warnings preexistentes), `git diff --check` verdes. Dry-run da migration confirmou
  só o arquivo esperado pendente.
- [x] Documentação (`edge-functions.md`, `glossario.md`, `project-status.md`) atualizada no mesmo
  ciclo; `modelo-de-dados.md` já havia sido atualizado junto da migration.
- [x] ADR própria escrita: [decisions/0130](decisions/0130-concorrentes-relevantes-pulse-viabilidade.md)
  — registrada em `obsidian-vault/04-Decisões/Índice de ADRs.md`; corrigido de quebra o contador
  desatualizado de `docs/README.md` (dizia "126 documentos, mais recente 0126", já estava defasado
  antes desta sessão — agora 130/0130).
- [ ] **Pendente: deploy/push/merge** — migration, `pulse-coletar` e `analisar-viabilidade` só
  validadas localmente/dry-run; nada foi implantado. Ordem prevista em
  `.superpowers/sdd/2026-08-20-concorrentes-relevantes-pulse-viabilidade/task-8-brief.md`.
- [x] **Revisão final adversarial (independente, diff completo desde o merge-base com main):**
  aprovado com ressalvas, nenhum achado bloqueante. `mercado?.observado?.menor`/`vendedores` em
  `viabilidade-linha.tsx` ganhou guard defensivo contra payload de edge ainda não implantada
  (janela transitória de deploy front↔edge) — commit `ab26df48`, com teste de regressão que provava
  o `TypeError` sem o guard.
- [x] **Checagem visual em runtime real** (Vite + Playwright isolado, conta VALIDATION, dados
  injetados via `page.route` — sem tocar dados reais nem o Chrome do Diego): confirmou os estados
  "com relevante" e "sem concorrente relevante" no Radar, no dialog de detalhe do Pulse e na
  Viabilidade, em tema claro e escuro, sem nenhuma divergência da spec.
- [ ] **Limitações conhecidas, não corrigidas (aceitas como estão, revisar se incomodarem em
  produção):** (1) oferta nova de vendedor ainda sem perfil (`transactions_total` null) que entra
  numa coleta do tier quente (6/6h) some do diff quando o perfil chega na coleta completa seguinte —
  o alerta `novo_concorrente` não é adiado, é perdido silenciosamente para aquela entrada específica;
  (2) `full_relevantes` do Pulse é sempre 0 — o snapshot do Pulse não coleta logística FULL, só a
  Viabilidade tem esse dado via API do ML.

## Sonar — Demanda ≠ Entrada no veredito (ADR-0128) — 2026-08-20

- [x] Separar perguntas "vende?" e "dá para entrar?": campo `entrada` (`aberta` / `fechada` /
  `nao_medida`), títulos compostos quando parcial ou fechada, chip de Entrada na UI.
- [x] `alta` exige `entrada === 'aberta'`; marca ruim fecha Entrada sem pontuar Demanda.
- [x] Pódio de rivais por faturamento inclui fantasmas sem rótulo (pulverização inalterada).
- [x] Gabarito ADR-0127 intacto (média / média / alta); cortes D10/DISPUTA_V2/DEMANDA sagrados.
- [x] **2026-08-20:** `nivel baixa` não sequestra título/ação quando Entrada fechada (copy de demanda
  insuficiente só em `gateDemanda`).

## Adicionar variação a família publicada, direto da tela Estoque (ADR-0129) — 2026-08-20

- [x] Edge nova `adicionar-variacoes-familia` (admin-only + módulo `estoque`): clona a família
  publicada mais recente + variações vivas para um **lote dedicado** de UPDATE, insere N cores
  novas digitadas (foto já no storage), registra estoque inicial pelo ledger e encadeia
  `publicar-familias` (server-to-server, JWT encaminhado) — não `enfileirarFamilias`, que deixaria
  o lote preso na Revisão (D-10). Idempotente por `chave_cadastro`; retry com família ainda
  `'pronto'` re-encadeia a publicação em vez de fabricar sucesso. Guard D-8 recusa lote não-terminal
  em andamento para o mesmo `codigo_pai`. Falha no insert de variações limpa família **e** lote.
- [x] Migration `20260820143736_guard_estoque_update_manual.sql`: guard de estoque de
  `validar_variacao_no_tenant` (que exigia estoque zero no INSERT em lote manual) passa a valer só
  para `familias.operacao='CREATE'` — a família de UPDATE clona o estoque vivo das irmãs.
- [x] Sino de notificação (`update-familia-ml/processar.ts`) no desfecho final do UPDATE, gated a
  lote `origem='manual'` + família `operacao='UPDATE'`, categoria `integracao`, best-effort.
- [x] `dialog-adicionar-variacao.tsx` na tela Estoque (admin-only): linhas repetíveis, banner de
  bloqueio quando há atualização em voo (pré-check D-8), badge de status no card do produto.
- [x] `codigosJaUsados` extraído para `_shared/produto/codigos.ts` (reusado por `cadastrar-produto`
  e pela edge nova).
- [x] `pnpm lint` + `pnpm test` + `npx tsc -b --force` + `deno lint`/`deno check` verdes.
  Documentação (`edge-functions.md`, `modelo-de-dados.md`, ADR-0129) atualizada no mesmo ciclo.
- [x] **2026-08-21:** D-6 estendido — Custo e Preço mínimo (líquido) também pré-preenchidos da
  variação irmã, editável (mesma query de prefill, sem chamada nova).
- [x] **2026-08-21 — hotfix de produção:** Salvar falhava em 100% dos casos
  (`null value in column "preco_editado_pelo_operador" ... violates not-null constraint`).
  Insert multi-row com clones (`select('*')`) e linhas novas no mesmo array: o PostgREST usa a
  UNIÃO das chaves e grava NULL explícito nas ausentes de cada linha, atropelando o DEFAULT da
  coluna. Quatro colunas NOT NULL estavam só no clone (`preco_editado_pelo_operador`,
  `cor_editada_pelo_operador`, `catalog_status`, `atualizado_em` — esta última também um bug de
  dado: o trigger `moddatetime` é `before update` e o clone gravava o timestamp congelado).
  Corrigido com paridade EXATA de chaves entre os dois builders + `atualizado_em` em
  `STRIP_VARIACAO`, travado por teste que lê as colunas reais de `src/lib/database.types.ts`.
  Nenhum resíduo das tentativas que falharam (rollback confirmado no banco). Ver ADR-0129,
  seção "Correção pós-produção (2026-08-21)".
- [x] **2026-08-21 — sinal de conclusão claro (relato do Diego: "sumiu, não sei se deu certo").**
  Dois problemas achados na mesma sessão, com o backend já 100% correto (confirmado por SQL
  direto): (1) `dialog-adicionar-variacao.tsx` invalidava `QK.produtosEstoqueResumo` (contagem do
  cabeçalho) mas não `QK.variacoesEstoque` (a lista expandida do card, query separada em
  `produto-card.tsx`) — a tela mostrava "Variações (11)" com só 8 linhas na tabela. (2) o badge
  "Atualizando…" só desaparecia ao terminar, sem distinguir sucesso de qualquer outro desfecho.
  `codigosConcluidosComSucesso` (nova, `estoque-update-status.ts`) compara dois snapshots
  consecutivos do poll de 15s; quem sai de `atualizando` sem virar `erro` dispara toast de sucesso
  + invalida `QK.variacoesEstoque` daquele produto (cobre também o caso do `ml_variation_id` só
  ser atribuído depois da primeira invalidação, no submit).
- [x] **2026-08-21 — badge por linha nas variações recém-adicionadas (pedido do Diego).**
  `dialog-adicionar-variacao.tsx` marca os SKUs da submissão (normalizados) em
  `QK.variacoesRecemAdicionadas(codigoPai)` (`setQueryData`, nunca vai à rede — estado só de UI).
  `produto-card.tsx` cruza o marcador com o `statusUpdate` (D-11) e passa
  `statusPublicacao: 'atualizando' | 'erro' | 'publicado'` pra cada linha; `PillPublicacao`
  (`variacao-estoque-linha.tsx`) renderiza o badge ao lado do SKU. Reaproveita o `StatusPill`
  já usado em `PillSaldo`.

## Sonar — tabela por anúncio + histórico de snapshots (ADR-0127) — 2026-08-19

- [x] **Unidade da tabela virou anúncio**, não mais ficha de catálogo: interseção 0 medida entre
  fichas do painel oficial e os 20 anúncios da amostra Apify (ADR-0127/D1). Cruzamento
  ficha↔anúncio do ADR-0125/D4 (`src/lib/sonar-cruzamento.ts`) foi deletado.
- [x] **Edge `pulse-sonar` removida do repositório** (fichas de catálogo, API oficial): fonte e
  entrada no `config.toml` apagadas. A função **segue deployada em produção de propósito** — o
  front que está no ar ainda a chama; o `supabase functions delete pulse-sonar` é pendência
  pós-merge (item aberto no fim desta seção). **Edge nova
  `pulse-sonar-visitas`** (`{item_ids}`, teto 20, cache `sonar:visitas:v1:{item_id}` TTL 24h,
  `{conectado:false}` sem conexão ML) assume o único uso restante da API oficial: visitas 30d por
  anúncio. `pulse-sonar-vendas` (Apify) continua primária e passa a gravar histórico em
  cache-miss.
- [x] **Tabela nova `sonar_snapshots`**: uma linha por anúncio por garimpo fresco, global sem
  `org_id`, RLS com leitura para `authenticated` e escrita só `service_role`, unique `(termo,
  item_id, gerado_em)`. Delta de `vendidos` entre snapshots é PISO do período, nunca total
  (ADR-0127/D13).
- [x] **Veredito recalibrado sobre anúncios**: Disputa vira pulverização de vendedores, Tração vira
  faturamento por vendedor da mesma subamostra — métricas invariantes ao tamanho da amostra
  (ADR-0127/D11), com trava LOUD de cobertura quando o nickname do vendedor vem em <50% da
  amostra (D10).
- [x] Documentação (`edge-functions.md`, `modelo-de-dados.md`, `glossario.md`, obsidian-vault)
  atualizada no mesmo ciclo. ADR-0127 supersede em parte o ADR-0125/D4.
- [ ] **Pendente pós-merge: `supabase functions delete pulse-sonar`.** A edge não tem mais fonte no
  repositório, mas continua deployada porque o front em produção ainda a chama. Só depois do merge
  na `main` e do deploy do front novo o delete pode ser executado — até lá é uma função viva sem
  código versionado, e sem este item ela sobreviveria esquecida.

## Sonar — remoção da sonda `date_created` (ADR-0125/D9) — 2026-08-19

- [x] A sonda multiget `/items?ids=...&attributes=id,date_created` (coluna "Criação") foi ao ar
  em produção e recebeu **403 também no multiget** para itens de terceiros — a flag
  `sonar:items-multiget-403` ficou ativa, provando a hipótese errada. Como a flag expira em 24h,
  o garimpo voltaria a tentar (e falhar) todo dia para sempre. Removida: `sondarCriadoEm`,
  `parseDateCreatedMultiget`, `sondaDeveDesligar`, o campo `criado_em` (edge, front e cruzamento) e
  a coluna "Criação" da tabela do Sonar. `itemMaisBarato` foi mantida — as visitas continuam
  usando; `diasDesde` foi removida por ficar sem nenhum uso após o resto ir embora.
- [x] Cache `pulse-sonar` **não** bumpou (`sonar:v3` seguiu): remover campo opcional que ninguém
  lê é retrocompatível; entradas antigas com `criado_em` expiram em 24h sozinhas.
- [x] ADR-0125/D9 reescrita com o resultado empírico. 384 arquivos / 3521 testes verdes (-9: os
  testes das duas funções removidas); `pnpm lint` 0 erros; `tsc -b --force` e `deno lint`/`deno
  check` verdes.

## Calculadora Mercado Livre premium na Viabilidade (ADR-0126) — 2026-08-19

- [x] Simulação simultânea de anúncio Clássico e Premium, lucro, margem, custos, peso cúbico,
  sensibilidades e preço para margem-alvo em motor financeiro puro e testado.
- [x] Categoria opcional com aviso persistente e sugestões via Edge Function read-only; sem
  categoria ou API, fallback manual identificado como estimado.
- [x] Tarifa API-first com proveniência oficial/parcial/estimada; frete desconhecido nunca vira
  zero e frete gratuito exige confirmação explícita.
- [x] Produto cadastrado como preenchimento editável, UI responsiva e validação visual desktop +
  mobile. Simulações não são persistidas e nenhuma escrita de tenant foi adicionada.

## Sonar — tabela de produtos: cruzamento ficha↔anúncio + colunas Hunter (ADR-0125) — 2026-08-19

- [x] **Cruzamento ficha↔anúncio no front** (`src/lib/sonar-cruzamento.ts`), chaveado por
  `idPublicacao` (item_id, primário) com atalho por `idProdutoCatalogo` — dado já pago da Apify
  que a tabela descartava. Anúncio principal = maior `vendidos` (nunca soma faixas arredondadas de
  amostra parcial), desempate menor `posicao`. Colunas novas: Vendas (acum.), Faturamento (acum.),
  Avaliação, Posição (orgânica), Envio (FULL/FLEX + internacional) — só aparecem com Apify
  configurada e `por_anuncio` presente (D5); célula sem casamento mostra "—", nunca 0.
- [x] **Filtros client-side** (`src/lib/sonar-filtros.ts`): mín. vendas/visitas, máx. vendedores,
  faixa de preço, nota mínima, toggles (só FULL, só com desconto, esconder patrocinados, esconder
  loja oficial). Filtro numérico com campo `null` na ficha EXCLUI e conta em "N sem esse dado"
  (D14) — nunca trata ausência como 0. KPIs e veredito continuam sobre o painel inteiro, nunca
  sobre as linhas filtradas.
- [x] **Sonda `date_created` via multiget** (`pulse-sonar/index.ts`, coluna "Criação"): aposta do
  ADR-0119 Errata 1 de que `/items?ids=...&attributes=id,date_created` passa para itens de
  terceiro (como já passa para os PRÓPRIOS no coletor Pulse) — provada com `fetch` local (status
  inspecionado, `mlGet` não tocado). Auto-desligável: 403 no todo ou em todos os envelopes grava
  flag Redis `sonar:items-multiget-403` (TTL 24h) e para de tentar; falha transitória não grava a
  flag. Coluna só existe quando alguma ficha tem `criado_em`, nunca quebra a tela.
- [x] Cache `pulse-sonar` bump `sonar:v2` → `sonar:v3` (`item_ids` obrigatório para o cruzamento,
  D3); `pulse-sonar-vendas` manteve `sonar:vendas:v4` com campo aditivo `por_anuncio` (D2, sem
  bump — cache já pago não é recobrado). ADR-0125 registra as decisões D1-D4 e D9.
- [x] 378 arquivos / 3482 testes verdes (+9: parser da sonda + decisão pura de desligar a sonda,
  extraída depois de revisão — 403 misturado com falha transitória NÃO desliga); `pnpm lint` 0
  erros/12 warnings pré-existentes; `tsc -b --force` e `deno lint`/`deno check` (242/243 arquivos)
  verdes.

## Sonar — buscas recentes — 2026-08-18

- [x] **Card "Buscas recentes" na tela inicial do Sonar** (pedido do Diego, referência Hunter
  Spy): últimas 10 buscas com tempo relativo ("há 23 minutos"), clique re-garimpa (termo em cache
  volta em ~2s sem custo), "Limpar tudo". Substitui o EmptyState quando há histórico.
- [x] **localStorage por navegador** (`sonar:buscas-recentes`), sem tabela/RLS de propósito —
  vira coluna em `configuracoes` se um dia precisar seguir o usuário entre máquinas. Lógica em
  funções puras (`src/lib/sonar-buscas-recentes.ts`, 10 testes): dedup por termo normalizado
  move ao topo, corte em 10, tempo relativo pt-BR.

## Sonar — raio-X do nicho (adendo ADR-0122) — 2026-08-18

- [x] **Barra no card "Vendas do nicho"** (pedido do Diego, referência Hunter Spy): ticket médio,
  lojas oficiais, Full, frete grátis e internacionais **da amostra já paga** (campos que o dataset
  da Apify já trazia sem uso) + **total de anúncios** absoluto (o "N resultados" da página).
  Custo adicional zero. "Novos (15d)" e "Flex" ficaram de fora: o dataset não tem o dado.
- [x] **Fonte oficial testada e morta:** `/sites/MLB/search` (contagens absolutas via
  `available_filters`) devolve **403 com token de usuário válido** — registrado no adendo do
  ADR-0122 para não retestar. Cache bump `sonar:vendas:v4` (v3 aposentada = corte de 6).
- [x] 5 testes novos de parser (17 no total no módulo); validação ao vivo com run real
  ("abraçadeira nylon": total 9.999, Full 16/20, oficiais 3/20) + screenshot.

## Tabela de frete ML na Viabilidade — 2026-08-18

- [x] **Edge `tabela-frete-ml`** (`verify_jwt=true`): grade compacta 7×4 (peso × preço) via
  `shipping_options/free`, cache Redis 24h por org+categoria. Retorna `{ indisponivel, motivo: 'sem_me2' }`
  quando a conta não tem Mercado Envios.
- [x] **Frontend:** card na Viabilidade após analisar (≥1 item `existeNoML`), com aviso de categorias
  mistas. `categoriaMlId` exposto em `ItemAnalisado`.
- [x] **Deploy:** `supabase functions deploy tabela-frete-ml` (2026-08-18).

## Sonar — veredito de oportunidade (ADR-0124) — 2026-08-18

- [x] **Card de veredito no topo do Sonar** (🟢 alta / 🟡 média / 🔴 baixa + frase de motivo):
  função pura `src/lib/veredito-sonar.ts` combinando os dois payloads que a tela já recebe —
  sem endpoint novo, sem custo extra. Fatores: Demanda (liquidez da amostra + piso de vendas),
  Disputa (vendedores + % frete grátis como proxy de profissionalização), Tração (R$ por
  vendedor). Marca (% loja oficial) **só alerta** — decisão do Diego, não pontua.
- [x] **Calibração contra 3 nichos reais** virou gabarito em teste: EUCERIN 🟡 (disputa
  profissionalizada), genérico 🟡, tecido oxford 🟢 — critério de aceitação: nicho pequeno onde a
  operação lucra não pode ser punido por ser pequeno. Guard de `total_catalogo` descartado (o ML
  satura em 10.000 até em nicho pequeno; teste trava isso).
- [x] **Formatação abreviada pt-BR** (`fmtMilhar` ganhou casa decimal opcional): "140,8 mil"
  visitas, "10 mil+" fichas (satura), "≈ 812 mil unidades" (rótulo novo — era lido como R$),
  "≈ R$ 58,8 mi" mercado.
- [x] 9 testes do veredito + 3 do fmtMilhar; validação visual via Playwright na branch.
- [x] **Tela abre completa de uma vez (pedido do Diego 18/08):** o stepper ganhou a 5ª etapa
  "Consultando vendas do nicho" e só libera o resultado quando painel E vendas resolvem — antes
  o painel estreava com esqueleto no bloco de vendas e o veredito trocava de nível na frente do
  operador quando a Apify respondia. Falha nas vendas também libera (retry desligado).

## Detalhe do líquido divergia do Mercado Pago (ADR-0123) — 2026-08-18

- [x] **Diagnóstico:** o líquido por venda estava certo (17/08: 17 vendas = R$ 949,92 vs
  R$ 948,93 de net no MP, delta = o pagamento de frete). Errada era a **data**: o MP antecipa
  `money_release_date` na confirmação da entrega, o ML não emite webhook, e a venda já saiu da
  janela de 72h do `reconciliar-faturamento` → estimativa original (~D+30) congelada.
  Medido na org AVIL: **222/1157 vendas divergentes, R$ 3.136,21** já na conta exibidos como
  "A liberar".
- [x] **Telegram inocentado:** os R$ 989,21 / 25 vendas da notificação são do **dia 18**, idênticos
  ao banco — a comparação era com o dia 17 da tela, não um erro de cálculo.
- [x] **Fix (ADR-0123):** passo novo no `reconciliar-faturamento` realinha `money_release_date` de
  todas as vendas da org usando o mapa de pagamentos que `carregarLiquidoMP` já carrega (120 dias,
  zero requisições extras). `mapaLiberacaoPorOrder` (puro, 3 testes) + `reconciliarLiberacoes`.
- [x] **Verificado em produção (18/08):** divergentes 222 → **0**; dia 17/08 passou a ter 26 vendas
  / R$ 1.320,92 contra 26 pagamentos / R$ 1.302,95 de net no MP — a diferença de R$ 17,97 são os 3
  pagamentos de frete que o MP credita à parte. Deploy `reconciliar-faturamento` v71.
- [ ] **Em aberto (decisão do Diego):** a notificação do Telegram só avisa o que libera no dia
  corrente. Liberação descoberta com atraso pela reconciliação não gera aviso. Ampliar para janela
  retroativa exige decidir o tamanho e o tratamento do backlog histórico.

## Sonar — vendas estimadas via Apify (ADR-0122) — 2026-08-18

- [x] **ADR-0122:** scraping pago reavaliado (ressalva do ADR-0120) — Apify contratada pelo Diego
  para dar ao Sonar paridade com o Hunter Spy (vendas totais, mercado endereçável, produto
  destaque). Visitas seguem só pela API oficial: nenhum scraper entrega visitas.
- [x] **Edge nova `pulse-sonar-vendas`** (`verify_jwt=true`), separada da `pulse-sonar` (run da
  Apify pode levar minutos; falha degrada só o bloco de vendas). Actor
  `karamelo/mercadolivre-scraper-brasil-portugues` síncrono (120s), cache Redis global 24h
  `sonar:vendas:v1:MLB:<termo>`. Sem `APIFY_TOKEN` → `{configurado:false}`, nunca erro.
- [x] **Parsers puros** em `_shared/pulse/sonar-vendas.ts` (12 testes): "+N vendidos"/"5 mil" →
  inteiro, preço pt-BR, `vendas_totais`, `valor_mercado` (Σ preço × vendidos), `produto_destaque`,
  palavras-chave dos títulos reais. Sem dado nunca vira zero (LOUD).
- [x] **UI:** seção "Vendas do nicho" no Sonar (badge "estimativa · via Apify", valores com "≈" e
  rótulo de acumulado), carregando em paralelo ao painel oficial; `retry: false` (run pago).
- [ ] **Pendente do operador:** colar o token em `.env.local` (`APIFY_TOKEN=`) e configurar em
  produção: `supabase secrets set APIFY_TOKEN=<valor>` + deploy da edge.

## Cancelamento tratado pela reconciliação (ADR-0121) — 2026-08-18

- [x] **Investigação do estoque do sabonete NIVEA (SKU 00000029):** saldo local 0 está correto
  (174 un de entrada − 1 ajuste − 173 baixadas). O ML vendeu 184 pagas, ou seja **11 unidades
  acima do que entrou**, com 13 un registradas como oversell (`quantidade=0` no ledger).
- [x] **Causa do silêncio:** os pedidos cancelados `2000017926934620` e `2000017939290244`
  receberam um único webhook cada (o da compra, `paid`, que baixou o estoque). O cancelamento
  chegou pela varredura do `reconciliar-faturamento`, que não tocava estoque nem notificava —
  zero linhas `pos_venda` na org contra 888 em `vendas`.
- [x] **`_shared/estoque/cancelamento.ts` (novo):** `tratarPedidoCancelado` com a decisão do
  ADR-0094 D-7 (allowlist de pré-despacho repõe; o resto avisa em `pos_venda`), idempotente pelos
  dois lados. Fiação real isolada em `cancelamento-deps.ts` (o módulo é testado por vitest e não
  pode arrastar `queue.ts`, que só existe no runtime Deno). 10 testes.
- [x] **Dois gatilhos:** `sync-venda` (webhook) e `reconciliar-faturamento` (passos de claims e de
  vendas). O passo de claims é o que alcança pedido cancelado dias depois, fora da janela de 72h.
- [x] **Envio `cancelled` avisa, não repõe:** os dois pedidos foram cancelamento por mediação com
  devolução — repor criaria estoque fantasma e ampliaria o oversell.
- [ ] **Pendente do operador:** conferir fisicamente o que voltou dos pedidos cancelados e dar
  entrada manual (5 un entre 00000029 e 00000005). O sistema não corrige saldo passado.

## Pulse Sonar — garimpo on-demand por termo (ADR-0120) — 2026-08-17/18

- [x] **Edge nova `pulse-sonar`** (`verify_jwt=true`). Busca livre por termo (mínimo 3 caracteres)
  em `/products/search` (até 40 fichas), enriquece só ficha com oferta ativa (categoria via
  `buscarCategoriaPreditor` com `comTimeout` de 10s, visitas de 30 dias do item mais barato,
  vendedores com cache por request) e monta `PainelSonar`. Cache Redis global 24h
  (`sonar:v2:MLB:<termo>` — dado público, sem `org_id`). Deployada em produção (v2).
- [x] **Edge `pulse-coletar` ganhou o passo 7:** coleta visitas de 30 dias de cada oferta viva
  no baseline diário (`tier === 'completo'` do schedule sem escopo de org — nunca no botão manual
  nem no tier quente), fila com o menos medido primeiro, teto de 30s por org, falha de leitura
  preserva a medida anterior em vez de gravar `null`. Deployada em produção (v15).
- [x] **Migration `20260818012222_pulse_ofertas_visitas_30d.sql`.** Coluna `visitas_30d integer`
  em `pulse_ofertas` + view `pulse_ofertas_atual` recriada (coluna no fim, `security_invoker=true`).
  Aplicada em produção.
- [x] **Frontend.** Aba "Sonar" no Pulse (`src/pages/PulseSonar.tsx`, `Tabs` em `Pulse.tsx`,
  `dialog-margem-sonar.tsx`, `lib/sonar.ts`) e coluna "Visitas 30d" no detalhe do Radar
  (`dialog-detalhe.tsx`).
- [x] **Documentação.** ADR-0120 e Errata 9 do ADR-0119 registrados; glossário e índice de ADRs
  no vault atualizados; `docs/reference/edge-functions.md` e `docs/reference/modelo-de-dados.md`
  cobrem o shape novo (edge nova, passo 7, coluna/view).
## Sonar: tabela de fichas ordenável — 2026-08-18

- [x] **Ordenação por coluna** na tabela de fichas do Sonar: a `<Table>` manual virou o `DataTable`
  genérico (`components/ui/data-table.tsx`, o mesmo de Publicados/Faturamento), que já traz
  cabeçalho clicável, asc/desc e nulos sempre no fim. Ordena por Produto (texto), Ofertas,
  Faixa de preço (pelo piso da faixa), Visitas 30d (ficha não medida vai para o fim) e nº de
  vendedores. Sem `defaultSort`: a ordem inicial continua sendo o ranking de relevância do ML.
- [x] **Atalho para o ML** em cada linha: ícone de link externo ao lado de "Simular margem",
  apontando para `mercadolivre.com.br/p/{product_id}` (ficha de catálogo — a URL do anúncio de
  terceiro não é derivável pela API). Mesmo formato já usado no dialog de detalhe do Radar.

## Sonar: "Saiba mais" do veredito — 2026-08-18

- [x] **Explicação determinística do veredito** (adendo no ADR-0124): expansível "Saiba mais" no
  card com pontuação real + gate de Demanda, frase de mercado por fator (número da amostra vs.
  corte), mini-régua das faixas, delta "para destravar", frase de ação por nível e bloco
  "Contexto do nicho" (mediana de preço, ticket médio, % Full, % internacionais — fora do score).
  Sem IA, sem rede: `explicacao` aditiva em `lib/veredito-sonar.ts` + `contextoNicho`; render em
  `components/pulse/veredito-sonar.tsx`. Testes estendidos sobre os nichos-gabarito (12/12);
  validado em runtime com Playwright + mocks das duas edges.

## Egress PostgREST estourando a cota do Free Plan — 2026-08-18

- [x] **Incidente.** Supabase avisou que restringiria os projetos da org em 18/08 por consumo:
  4,98 GB de 5 GB no ciclo 24/07–24/08, com **PostgREST = 93,4% do egress** (172,7 MB só em 17/08)
  e piso noturno constante — sinal de tráfego automático, não de uso humano.
- [x] **Diagnóstico (read-only, `edge_logs` 24h + `pg_stat_statements`).** Não era payload gordo
  nem o frontend (já corrigido em ADR-0081/0082, <1 MB/dia): era **volume de requisições dos
  workers de faturamento** — ~155 mil requests REST/dia. `upsertVenda` gasta 6 requisições por
  venda e era re-executado para cada venda a cada hora, mesmo sem mudança: 870 mil upserts em
  `ml_vendas` desde maio para 1.734 vendas (~500 regravações por venda). Relatório completo em
  `docs/analise-egress-postgrest.md`.
- [x] **Correção 1 — schedule do `backfill-faturamento`: `30 * * * *` → `30 6 * * *`** (24×/dia →
  1×/dia, 03:30 BRT). Só QStash, sem código. A rede de segurança de 7 dias re-varrida de hora em
  hora era redundância tripla sobre webhook + `reconciliar-faturamento` (72h). **−33 MB/dia.**
- [x] **Correção 3 — `memoCatalogo`** (`_shared/faturamento/io.ts`): o `reconciliar-faturamento`
  carregava o mesmo catálogo da org duas vezes por execução (passo de claims e passo de vendas),
  cada carga paginando `familias` + `variacoes` + `anuncios_externos_itens` inteiras (5.395
  variações = 6 páginas). Memo por **invocação** (guarda a Promise, não o valor — dedup de
  concorrência); cache de módulo não serve porque vive por isolate e entregaria catálogo velho.
  **−12 a 20 MB/dia.**
- [x] **Correção 4 — filtro de reprocesso** (`_shared/faturamento/reconciliar-filtros.ts`, puro e
  testado): estado local carregado em lote e só processa o que mudou. Medido antes do fix: 87 das
  88 perguntas `ANSWERED`/imutáveis e 67 dos 88 claims fechados há >7 dias, todos regravados de
  hora em hora. Predicado de claim mantém graça de 7 dias pós-fechamento e nunca pula dinheiro em
  trânsito (`return_status_money` vem de `GET /returns` e muda **invisível** no payload do claim).
  Predicado vive no chamador periódico, não em `upsertPergunta`/`upsertDevolucao` — essas servem o
  webhook, que dispara porque algo mudou. **−8 a 10 MB/dia**, mais o fim do bump horário de
  `ml_vendas.atualizado_em` que fazia o delta-poll do frontend devolver linhas em todo tick.
- [x] **Testes:** `reconciliar-filtros.test.ts` — 21 casos, cada "pula" com o simétrico "não pula".
  Suíte 3353/3353, `deno lint`/`deno check` zerados, `pnpm lint` 0 erros.
- [x] **Validado em produção** (2026-08-18 00:5x UTC, duas execuções disparadas via QStash, números
  idênticos nas duas = convergiu): `perguntas 0/85` e `0/2` — **nenhuma escrita em `ml_perguntas`
  em 25 min**, contra 87 upserts/hora antes; `claims 37/96` e `2/17`, com **14 escritas** em
  `ml_devolucoes` no lugar de 88+. `ml_vendas` seguiu com 287 escritas — é a correção 2, intocada.
- [ ] **Achado durante a validação: ~25 claims que NUNCA convergem.** O ML devolve 113 claims, mas
  `ml_devolucoes` tem 88 linhas: a diferença são claims em que a conta é a **compradora**, que
  `upsertDevolucao` descarta via `ehClaimDeCompra` sem gravar nada. Como não gravam, o predicado os
  vê como "novos" toda hora e eles são reprocessados para sempre — ~8 requisições REST cada,
  ~4,8 mil/dia (~2,6 MB/dia). Pior: o `index.ts` ignora o `ignorado: true` do retorno e ainda roda
  `buscarPedido` + `upsertVenda` num pedido que não é venda nossa. Fix candidato: filtrar por
  `ehClaimDeCompra` antes do loop. Não entrou aqui por estar fora do escopo pedido — precisa
  confirmar que nenhum desses pedidos deva mesmo virar venda.
- [ ] **`backfill-faturamento` continua sem o filtro.** Importa os mesmos `perguntas-io` /
  `devolucoes-io` e faz a varredura sem filtrar. Inofensivo a 1×/dia, mas se alguém restaurar o
  cron horário o desperdício volta inteiro — `memoCatalogo` e os predicados já estão prontos para
  reuso lá.
- [ ] **Correção 2 (pendente, maior alavanca restante): early-exit no `upsertVenda`** por
  `date_last_updated` — **−45 a 55 MB/dia**. Não feita nesta entrega: é código financeiro e o
  critério de "nada mudou" precisa cobrir `shipment`/frete/`money_release`, que vêm de FORA do
  pedido. Exige ADR + trava de teste. **Sem ela, o esperado com 1+3+4 é ~85–105 MB/dia**
  (≈3,1–3,6 GB/mês contra os 5 GB do plano) — passa da cota, mas com folga estreita. E o ciclo
  atual (até 24/08) já queimou 4,98 GB: estas correções protegem o ciclo SEGUINTE, não este.

## Vendas por anúncio: irmão legado sem vínculo sumia da tela — 2026-08-17

- [x] **Bug (reportado por Diego).** "Unid. vendidas" e "Valor vendido" abaixo do real em vários
  produtos. Causa: a atribuição casa `ml_vendas_itens.ml_item_id` com o anúncio listado; produto que
  já vendia no ML como **N anúncios (um MLB por cor/estampa)** entrou no app com só um MLB
  vinculado, e as vendas dos irmãos ficavam órfãs — nenhuma linha as recebia. Medido na org AVIL
  (90 dias): **18 MLBs órfãos, 89 un, R$ 5.450**. Caso do print — Helanca `26705343`: tela mostrava
  **7 un / R$ 538,30**, real **49 un / R$ 3.757,28** (9 anúncios, um por cor).
- [x] **Fix (adendo do ADR-0045, sem ADR novo).** O critério é o GTIN, o mesmo que o ingest já usa
  (`_shared/faturamento/venda.ts` marca `is_publiai` por EAN) — o frontend passou a aplicá-lo na
  chave de agregação. `MapaCanonico` (`src/lib/anuncio-canonico.ts`) ganhou `gtins` e `conhecidos`;
  `canonizarItem(mlItemId, mapa, ean?)` resolve na ordem: vínculo de catálogo → MLB que o app já
  lista (dono de si) → GTIN → o próprio MLB.
- [x] **Guard contra falso positivo.** GTIN que aponta para mais de um anúncio é descartado do mapa
  — é a assinatura de kit x unidade (ADR-0071) e split por faixa (ADR-0078/0048), que o ADR-0045
  temia fundir. Ambiguidade real: 11 de 3.170 GTINs (0,35%). O `ean` é **opt-in**: `fotos-produto` e
  `cor-produto` seguem sem ele e não mudam de comportamento.
- [x] **Menus corrigidos:** Publicados (colunas por anúncio, Encalhados, Top produtos, export),
  Dashboard (Top produtos + PDF), Detalhe de vendas. KPIs monetários (bruto/líquido/pedidos) não
  eram afetados — agregam por pack. Estoque, Pulse e Geografia não usam essa chave.
- [x] **Testes:** `irmao-legado-vendas.test.ts` (6 casos: os 3 agregadores + GTIN ambíguo + anúncio
  já listado + degradação sem mapa), casos novos em `anuncio-canonico.test.ts` e em
  `tests/pages/Publicados.test.tsx` (renderiza 7 → 49). Suíte: 3.331 testes verdes, lint sem erro,
  `tsc -b --force` limpo.
- [x] **Validação em runtime:** queries novas conferidas no PostgREST real (embed e filtros) e app
  local aberto no navegador com a tela Publicados renderizando sem erro de console.
- [ ] **Resíduo declarado:** 5 dos 18 MLBs órfãos (**R$ 1.999,92** — Oxford Natal `02710170` e o
  item `00000033`) têm `variacoes.gtin = null`; sem EAN nenhum critério de GTIN os alcança.
  Resolver exige vincular os MLBs irmãos como anúncios do produto (mudança de modelo, ADR próprio).

## Publicados — "Corrigir e republicar" pausa o anúncio Legacy no ML — 2026-08-17

- [x] **Bug.** O modo republicar (`remover-publicado` com `preservar_familia: true`) só pausava
  itens de família User Products (mini-saga do ADR-0088). Em família **Legacy** (anúncio único,
  ex.: Eucerin `00000034`) ele cortava o vínculo local sem tocar o ML: o anúncio antigo ficava
  **ativo e órfão** no ML e a republicação (CREATE) criava um duplicado — contrariando o próprio
  diálogo da UI ("Todos os itens desta família serão pausados"). A spec de 2026-07-28 só cobria UP.
- [x] **Fix em `remover-publicado/processar.ts`:** quando a saga UP não pausou filhos (Legacy ou
  UP-esvaziada), o modo republicar pausa o próprio `ml_item_id`. GET decide: `active` → PUT
  pausar; pausado/closed/moderado → segue sem PUT (PUT em closed daria 400 e travaria a
  recuperação de anúncio moderado); 404/410 → item já sumiu, seguro. Erro transiente (GET ou PUT)
  aborta fail-closed ANTES de qualquer mutação local — o clique é idempotente. Caminho passa a
  exigir conexão ML viva; a remoção comum de Legacy segue sem token.
- [x] **Testes:** 6 novos casos (pausa, skip por status, 404, fail-closed em GET/PUT, sem conexão)
  + ajuste do caso ADR-0097 que chamava o modo republicar sem conexão. Suíte completa verde.
- [ ] **Deploy pendente:** `supabase functions deploy remover-publicado` após merge (deploy de
  edge não acompanha o push na main).

## Estoque — preço da coluna passa a ser o do anúncio — 2026-08-16

- [x] **Bug.** A coluna "Preço" do painel de variações mostrava `variacoes.preco`, o preço local da
  planilha/markup, que nenhum job reconcilia com o canal. Medido na org DSA: NIVEA `00000029` a
  R$ 28,99 na tela contra R$ 39,90 no anúncio; Principia `00000023` a R$ 29,00 contra R$ 48,90;
  Eucerin `00000035` a R$ 75,00 contra R$ 96,90.
- [x] **Fonte do preço vivo: `status-publicados`**, não o Pulse. O `pulse_produtos.meu_preco` só
  existe onde há ficha de catálogo (3 de 7 produtos na DSA, 15 de 133 na Avil — Errata 2 do
  ADR-0119); `status-publicados` já faz multiget `/items?attributes=...,price` e cobre 100% dos
  anúncios da org. Conferido nos 2 produtos com as duas fontes: 39,90 e 96,90 em ambas.
- [x] **Migration `20260816230056_estoque_preco_ml_por_sku.sql`.** `variacoes_estoque_produto`
  devolve `ml_item_id` por SKU — precedência `anuncios_externos_itens` (User Products, 1 item por
  SKU) → partição de `anuncios_externos` que contém o SKU (split) → `familias.ml_item_id`. Sem
  isso, todas as cores de um produto UP exibiriam o preço do mesmo anúncio.
- [x] **UI.** A coluna mostra o preço do anúncio e, quando diverge, o local vira nota (`local
  R$ 28,99`). Sem anúncio, status carregando ou org sem credencial → segue o local. O status ao
  vivo só é buscado com um card aberto (`useStatusPublicados({ enabled })`) — a chamada varre
  todos os anúncios da org. `variacoes.preco` NÃO é sobrescrito: é ele que alimenta markup e o
  próximo push (ADR-0055).
- [ ] **Limitação conhecida.** `/items` devolve o preço BASE; com promoção ativa do vendedor o
  efetivo é menor (medido na Errata 4 do ADR-0119: 38,90 base contra 35,79 em `/seller-promotions`).
  Nenhum dos casos medidos na DSA tinha promoção ativa. Se aparecer, o caminho é acrescentar o
  preço promocional ao `lerStatus` como campo NOVO — `StatusCanal.preco` é usado como faixa viva
  do split (ADR-0078) e não pode mudar de semântica.

## Pulse v1 — radar de concorrência (ADR-0119) — 2026-08-16

- [x] **Migration `20260816125057_pulse_v1.sql`.** 4 tabelas Grupo B — `pulse_produtos`,
  `pulse_ofertas`, `pulse_vendedores`, `pulse_alertas` — RLS por org (select), duas exceções de
  UPDATE do membro (`pulse_produtos.status`, `pulse_alertas.lido`). Categoria de notificação
  `'pulse'` liberada em `notificacoes_categoria_check` e `profiles_telegram_categorias_validas`,
  com 2 backfills (menu `'pulse'` para não-admins, assinatura Telegram para admins ativos).
- [x] **Coletor server-side (`pulse-coletar`).** Dual-mode como `monitorar-moderados` (QStash sem
  escopo de org vs. usuário logado escopado + tier `completo`). Tier `completo` (schedule diário)
  sincroniza o radar a partir de `anuncios_externos` publicados, coleta ofertas + vendedores + PTW;
  tier `quente` (schedule 6/6h) só reconsulta ofertas dos produtos `origem='auto'`. Lógica pura
  (`parseOfertasProduto`, `diffOfertas`, `deveGravarVendedor`) em `_shared/pulse/` com testes
  isolados.
- [x] **Adicionar manualmente (`pulse-adicionar`).** Link de catálogo ou GTIN; item avulso de
  anúncio de terceiro é 403 sempre na API do ML — recusado com mensagem explícita (errata do
  ADR-0119).
- [x] **Menu/rota `/pulse` org-gated** (mesmo padrão do módulo Estoque).
- [x] **UI:** `tabela-radar.tsx` + `dialog-detalhe.tsx` (margem estimada via `pulse-margem.ts`,
  simulador de preço), `dialog-adicionar.tsx`, `painel-alertas.tsx` (texto por tipo de alerta —
  `preco_caiu`/`novo_concorrente`/`concorrente_saiu` — em `pulse-alerta-texto.ts`) e
  `dialog-reprecificar.tsx`, que grava o novo preço via `updateVariacaoPreco` existente e leva à
  Revisão — **nenhuma escrita nova no ML**, publicação continua 100% no fluxo Revisão.
- [x] **Testes e lint.** `pulse-margem.test.ts`, `pulse-alerta-texto.test.ts` + suíte pura do
  coletor; suíte verde 365 arquivos / 3217 testes, `pnpm lint` 0 erros (verificado nesta Task 7).
- [x] **Code review (Fable, `.code-review-fable5/code-review-v1.md`) — 91/100, 3 achados corrigidos:**
  (1) ALTA — a lista de ofertas do catálogo inclui a **nossa própria oferta**; sem filtrar por
  `conexao.contaExternaId` o radar alertava contra o próprio anúncio e oferecia reprecificar para
  cobrir o próprio preço; (2) MÉDIA — estado anterior lido do histórico com teto de linhas
  ressuscitava concorrente antigo como "novo" → passou a usar a view `pulse_ofertas_atual`;
  (3) MÉDIA — loop de orgs sem teto de tempo (precedente `reconciliar-faturamento` /
  `WORKER_RESOURCE_LIMIT`) → teto de 100s com rotação justa por `ultimo_snapshot_em asc`.
- [x] **Deploy (2026-08-16).** Migration aplicada (`supabase db push`), `pulse-coletar` e
  `pulse-adicionar` deployadas, schedules QStash criados (`scd_7whbaAZrFGPAL3JkbWsmNuYb2AVc`
  tier completo `0 9 * * *`; `scd_5pCHsB95LbDd7cpJMLsJNK8iHNQC` tier quente `0 */6 * * *`, body
  auditado como JSON puro). Módulo `pulse` habilitado só na org **DSA** (Avil fica de fora até a
  calibração, mas **já coleta** — o histórico dela acumula desde hoje).
- [x] **Validação em produção (1ª coleta real, 2026-08-16).** 222 produtos no radar (217 Avil +
  5 DSA, auto-descobertos), ofertas reais gravadas (até 84 por produto), 267 vendedores, 31
  produtos com price-to-win, 0 alertas (correto: 1ª coleta não alerta por design) e **0 ofertas
  da própria loja** — a trava do achado ALTA confirmada com dado real.

- [x] **Correção de vocabulário (2026-08-16).** Um produto com 79 ofertas exibia "Sem concorrência":
  o mapa de tradução dos status traduzia 5 valores que não existem na API e invertia o sentido do
  único que aparece na prática. Corrigido contra a doc oficial, coluna renomeada para "Referência
  do ML" e o conflito aparente com "Menor concorrente" explicado na UI e no guia (Errata 3 do
  ADR-0119). Só frontend — nenhum redeploy de edge function.

- [x] **"Seu preço" agora é o preço vivo (2026-08-16).** A coluna vinha de
  `variacoes.preco_publicado_ml`, escrito só na publicação e nunca reconciliado: medido 44,60 no
  banco contra 48,90 no ML. Passa a vir da nossa própria oferta em `/products/{id}/items` — mesma
  resposta das concorrentes, mesma base de comparação, zero chamadas novas. Também corrigidos a
  substituição pelo preço de rascunho e a escolha arbitrária de variação em famílias com preço por
  faixa (37 de 222). Migration + `pulse-coletar` deployados e coleta verificada: 87 de 222 com
  preço vivo; o restante mostra "—" com o motivo (Errata 4 do ADR-0119).

- [x] **Situação do anúncio e resgate de órfãos (2026-08-16).** O filtro de "pausados" olhava o
  status no radar (sempre vazio) em vez do anúncio no ML; e anúncio publicado cujo JSON
  `variacoes_externas` não guardou o `catalog_product_id` ficava inteiro fora do radar mesmo com o
  vínculo confirmado em `variacoes`. Corrigidos os dois (Errata 5 do ADR-0119). Verificado: DSA
  5 → 6 produtos, 3 ativos e 3 pausados por estoque zerado; Avil +0 (os 126 órfãos dela são os
  aviamentos sem catálogo da Errata 2).

- [x] **Comissão do ML no preço certo (2026-08-16).** A margem usava `ptw_custos.comissao`, que é a
  comissão do preço SUGERIDO pelo ML — superestimava a sobra em todo anúncio acima da sugestão,
  justamente as linhas candidatas a reprecificar. Medido: NIVEA a R$ 39,90 mostrava R$ 5,36 (13,4%)
  contra R$ 4,39 (11,0%) reais. Passa a ler `sale_fee_details` de `/sites/MLB/listing_prices` no
  preço praticado. Verificado contra o painel do ML nos 3 produtos com preço: 5,59 / 13,57 / 5,87,
  batendo exatamente (Errata 6 do ADR-0119). **Ressalva descoberta em 2026-08-17:** essa validação
  foi feita só em produtos sem promoção ativa — ver a correção abaixo.

- [x] **Links individuais das ofertas do Pulse (2026-08-20).** O enriquecimento por
  `GET /items?ids=…` deixava todas as ofertas como "Indisponível", porque o ML restringe os
  detalhes dos anúncios concorrentes. `pulse-coletar` agora deriva a URL pública diretamente do
  `item_id` MLB, preserva permalinks válidos já existentes e não faz a chamada bloqueada. Caso real
  `MLB6803357628` coberto por teste; revisão Sol sem achados críticos/importantes; deploy v20 ativo.

## Pulse — revisão de código do módulo (Fable) — 2026-08-17

Revisão integral do módulo (33 arquivos), relatório em
`.code-review-fable5/code-review-pulse-modulo-2026-08-17.md`:
72/100, aprovar com ressalvas, nenhum achado crítico. Corrigido nesta rodada:

- [x] **Comissão lida no preço BASE, não no efetivo (ALTA, Errata 7 do ADR-0119).** A Errata 6
  pedia a comissão "no preço praticado" mas a consulta usava o `price` do multiget de `/items` —
  que a Errata 4 já havia provado ser o preço base, sem promoção. Com promoção cruzando faixa, a
  estrutura era gravada errada e a sobra exibida **superestimava**, na direção que induz a baixar
  preço. Agravante: o rótulo "estimativa" ancorava em `meu_preco`, então esse caso saía sem rótulo;
  e o dialog de reprecificar não rotulava nada em hipótese alguma. Corrigido em três partes: preço
  efetivo na consulta (casado pelo `item_id` da nossa oferta), coluna `comissao_preco` registrando
  o preço da leitura, e `margemEhEstimativa` (pura, 6 testes) ancorando nela nos dois dialogs.
  Verificado em produção após deploy: os 3 produtos com oferta viva gravaram
  `comissao_preco = meu_preco`; NIVEA segue em R$ 5,59 / R$ 4,39 (sem regressão).
- [x] **Adicionar manual rebaixava produto do radar (MÉDIA).** O upsert de `pulse-adicionar`
  mandava `origem:'manual'` e `status:'ativo'` incondicionalmente: readicionar uma ficha que já
  estava no radar como `auto` tirava o produto do tier quente, congelava a referência de preço e
  fazia a tela dizer "você não vende este produto". O `origem` voltava sozinho no tier completo
  seguinte (≤24h), mas o `status` não voltava nunca. Agora a linha existente é reaproveitada; só
  ficha **arquivada** é reativada, e só o `status` muda.
- [x] **Alertas saíam mesmo com a gravação das ofertas falhando (MÉDIA).** Sem o estado novo no
  banco, o ciclo seguinte recomputava o mesmo diff e reemitia os mesmos alertas — sem chave de
  idempotência para segurar. Agora o insert de alertas exige os dois upserts terem passado.
- [x] **Arquivamento sem paginação (MÉDIA).** A lista de candidatos a arquivar truncava em ~1000
  linhas em silêncio: produto além do teto ficaria no radar para sempre. Passa por `paginarTudo`.
- [x] **Passo 5 sem `status='publicado'` (BAIXA).** Elegia anúncio com status `erro` de partição
  menor e consultava a referência de preço de um item morto. Alinhado ao passo 5b.
- [x] **Ficha inexistente criava linha morta (BAIXA).** Link `/p/MLB999…` errado entrava no radar e
  ficava em "Ainda sem a primeira coleta" para sempre. Agora devolve 404.
- [x] **Comentário factualmente errado sobre o PostgREST.** O código afirmava que `numeric` chega
  como string. Medido contra a produção em 2026-08-17: chega como **número JSON**. A confusão vem
  do `node-postgres` (que devolve string), driver que não usamos. Comentário corrigido; os
  `Number()` ficaram como cinto de segurança barato, agora documentados como tal. **Consequência:**
  o achado do relatório sobre `menorPrecoPorDia` comparar preços lexicograficamente não procede —
  a comparação é numérica.

**Follow-ups pendentes:**
- [ ] **Paginar as duas queries de lista restantes.** `variacoes` por `.in(catalog_product_id)` no
  `sincronizarRadar` e `fetchPulseProdutos` no front carregam o radar inteiro numa query. Hoje são
  ~222 linhas por org — sem sintoma; acima de 1000 o PostgREST trunca em silêncio e o radar exibe
  um subconjunto sem avisar. O Pulse v2 (extensão) existe para multiplicar essa contagem.
- [ ] **Teto de itens por org (ADR-0119 §2) nunca foi implementado nem registrado.** Das travas de
  crescimento do ADR, é a única sem dono: `pulse-adicionar` aceita adições manuais sem limite.
- [ ] **Painel de alertas não diz QUAL concorrente.** Dois concorrentes distintos saindo da mesma
  ficha geram duas linhas de texto idêntico ("Um concorrente saiu de X"), sem nada que as
  diferencie — provável origem da queixa de "alerta do Telegram não bate com o do app". O payload
  já tem `item_id` e `seller_id`; falta decidir o que exibir (nickname do vendedor exige join com
  `pulse_vendedores`).
- [ ] **Alerta de produto arquivado tem "Ver produto" inerte, e o input do Reprecificar pode nascer
  "NaN"** quando o payload não tem `para`. Ambos cosméticos.
- [ ] **KPIs contam sobre a lista cheia.** Com busca ou situação aplicadas, clicar num card de "12"
  mostra menos de 12 linhas (a contagem "N de M" ao lado mitiga). Comportamento defensável — cards
  como termômetro global — mas contradiz o comentário no código. Decidir e documentar.
- [ ] **Grants amplos — do projeto inteiro, não do Pulse (achado 2026-08-16, revisto 2026-08-17).**
  A migration `20260816125057_pulse_v1.sql` concede `grant update (status) on pulse_produtos`, mas
  os default privileges do schema `public` já davam ALL antes, então o grant restrito ficou
  redundante. **Medido em produção: as 25 tabelas do schema `public` têm exatamente os mesmos
  privilégios** (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER), e para `anon` além de
  `authenticated` — não é desvio do Pulse, é o default do Supabase. Corrigir só as `pulse_*` daria
  falsa sensação de segurança; o item é de endurecimento do schema, com ADR próprio.
  O que a RLS de fato segura hoje (verificado nas policies): INSERT e DELETE não têm policy em
  nenhuma tabela `pulse_*` → negados. UPDATE só tem policy em `pulse_produtos` e `pulse_alertas`,
  presa a `current_org_id()` → sem vazamento entre organizações. Resta que um membro da própria org
  pode escrever em qualquer coluna dessas duas (`meu_preco`, `comissao_pct`, `ptw_*`), quando a
  intenção era só `status` e `lido`. TRUNCATE não é sujeito a RLS, mas o PostgREST não o expõe.
  Correção quando for feita: `revoke insert, update, delete ... from authenticated, anon` seguido de
  `grant update (status) on pulse_produtos` e `grant update (lido) on pulse_alertas` — são as duas
  únicas escritas do cliente (`pausarPulseProduto`, `marcarAlertaLido` em `src/lib/pulse.ts`);
  revogar sem recriar as duas quebra o pausar/reativar e o marcar-alerta-como-lido.
- [x] **Respeitar `applicable_suggestion` (2026-08-17).** A tela mostrava a referência de preço
  mesmo quando o ML a marcava como não aplicável — o selo afirmava mais do que o ML afirma, e ele é
  lido como veredito de preço. Coluna `ptw_aplicavel` + selo neutro "Referência não aplicável", que
  também sai da escala de ordenação e suprime o valor em destaque no detalhe. Medido: dos 5
  produtos com referência, 3 vieram `true` e 2 sem o campo — por isso `null` mantém o comportamento
  anterior em vez de esconder selo bom (Errata 3 do ADR-0119).
- [ ] Pulse: job de agregação semanal + prune de 90d + auto-pausa de produto sem acesso há 60d —
  antes de 2026-11-14.
- [ ] **Pulse v2: extensão coletora de DOM — PRIORIDADE ALTA, é o que dá cobertura ao módulo.**
  Medição de 16/08 (errata 2 do ADR-0119): o radar alcança **5 de 7** anúncios da DSA e apenas
  **15 de 133** da Avil — 89% dela está fora porque são aviamentos sem ficha de catálogo no ML
  (códigos de barras internos, faixa GS1 `2`, não GTIN global). Verificado que **não há caminho
  pela API** para esses: busca textual e por categoria devolvem 403, anúncio de terceiro 403.
  A extensão (base `extensao-ml/`, ADR-0118) lê a página na sessão logada e alcança qualquer
  anúncio — resolve cobertura **e** vendas por anúncio de uma vez.
- [ ] Pulse: alternativa barata se a extensão demorar — tela de tendência por categoria com
  `/highlights/MLB/category/{cat}` e `/trends/MLB/{cat}` (únicos endpoints vivos sem catálogo).
  Responde "o que vende neste nicho", não "quem é meu concorrente e a que preço".

## Estoque — P2.3 virtualização expand — 2026-08-14

- [x] **P2.3 — Virtualização no expand.** Acima de 50 SKUs (`VARIACOES_VIRTUAL_THRESHOLD`), a aba
  Variações usa `@tanstack/react-virtual` com scroll `max-h-[min(24rem,50vh)]`; cabeçalho fixo fora
  do virtualizer; aba Movimentos inalterada.
- [x] **Testes.** `produto-card.test.tsx`: 51 variações → container virtual + DOM parcial; 50 e 5 → map
  completo sem virtual scroll.
- [x] **Revisão Opus.** Bordas entre linhas no modo virtual; scroll focável (`tabIndex` + `role="region"`);
  `scrollbar-gutter: stable`; testes com bounds no DOM parcial.
- [x] **Deploy.** Frontend via main `c75f8983` (sem migration).

## Estoque — P2 busca + prefetch — 2026-08-14

- [x] **P2.1 — Busca por nome de variação.** Migration `20260814184715_estoque_p2_nomes_busca.sql`:
  `produtos_estoque_resumo()` agrega array `nomes` das variações canônicas; `casaTermo()` inclui
  `...p.nomes` nos alvos de busca client-side.
- [x] **P2.2 — Prefetch + cache.** Chaves centralizadas em `QK` (`produtosEstoqueResumo`,
  `canaisPorProduto`, `variacoesEstoque`); `staleTime` do resumo 180s e canais 120s; hook
  `usePrefetchEstoque` dispara prefetch no hover/focus do menu Estoque (só com módulo habilitado).
- [x] **Testes.** `produtos-saldo-filtro` (nome variação), `mapResumoEstoqueRpc`, Estoque, produto-card.
- [x] **Fix cadastro.** `dialog-cadastro-produto` invalida `QK.produtosEstoqueResumo` (chave morta `produtos-saldo` desde P0/P1).
- [x] **Deploy.** Migration aplicada (`supabase db push`); frontend via main `3ee838c5`.

## Estoque — performance carga Avil — 2026-08-14

- [x] **Motivo.** Org Avil carregava 5388 linhas de variação em 6 páginas HTTP sequenciais (~40% descartadas no browser pelo corte de família canônica). Query DB ~13ms — gargalo era rede + payload + agrupamento client-side.
- [x] **Migration `20260814181410_estoque_perf_rpc.sql`.** Três RPCs `security definer` com escopo `current_org_id()`:
  - `produtos_estoque_resumo()` — KPIs + lista slim (DISTINCT ON família canônica)
  - `variacoes_estoque_produto(p_codigo_pai)` — variações sob demanda ao expandir card
  - `skus_estoque_org()` — picker flat do DialogEntrada
- [x] **Frontend two-phase.** `fetchProdutosEstoqueResumo` na carga inicial; variações e SKUs lazy; `buscarTodasPaginasParalelo` em `fetchCanaisPorProduto`.
- [x] **Testes.** Mappers RPC, Estoque, produto-card, dialog-entrada, filtro (gtins/codigos/cores).
- [x] **Deploy.** Migration aplicada (`supabase db push`); frontend via main `6dfcc175`. Validar carga Avil em produção.

## Estoque — alerta "Venda sem saldo suficiente" vs desync ML — 2026-08-14

ADR: `docs/decisions/0094-estoque-ledger-e-push.md` (Bloco A, alertas operacionais)

- [x] **Motivo.** Telegram mostrava `⚠️ Venda sem saldo suficiente` em vendas com saldo já zerado há
  dias (desync ML ↔ PubliAI). A mensagem genérica + dedupe por pedido gerava spam quando o anúncio
  seguia publicado no ML com estoque interno 0. Vender a **última unidade** (1→0) **não** alerta —
  o critério antigo (`estoque_anterior < pedido`) era correto, mas indistinguível na mensagem.
- [x] **Classificação pura.** `classificarBaixaSemSaldo()` em `_shared/estoque/baixa.ts`:
  `ok` (aplicada ≥ pedida), `parcial` (havia saldo >0 mas insuficiente), `desync`
  (`estoque_anterior === 0`).
- [x] **Mensagens distintas no `sync-venda`.** Parcial mantém dedupe por pedido
  (`estoque_sem_saldo`); desync usa dedupe por SKU/dia (`estoque_desync_ml:{codigo}:{YYYY-MM-DD}`,
  fuso America/Sao_Paulo) com texto "ML vendeu com estoque zerado no PubliAI".
- [x] **Testes.** +126 linhas em `baixa.test.ts` (31 testes no módulo).
- [x] **Merge e deploy.** Main `be14f101`; `sync-venda` redeployada (v66).
- [ ] **P1 (fora de escopo):** verificação pós-push ao zerar estoque no ML para evitar desync
  prolongado (ex.: SKU `00000005` / MLB4982690837, 6 dias zerado e ainda publicado).

## Financeiro — filtros Devolvidos e Cancelados no Detalhe do líquido — 2026-08-14

ADR: `docs/decisions/0117-financeiro-controle-de-liberacao-e-saque.md` (adendo 2026-08-14) ·
glossário **Devolução (concluída)** · ADR-0106

- [x] **Motivo.** A aba `Devolvidos` listava dezenas de linhas (não batia com ~5 devoluções do painel
  ML). Duas causas: (1) o filtro usava `!faturavel` e misturava cancelamentos; (2) mesmo após separar
  abas, `tem_devolucao` é setada em **qualquer** claim (`upsertDevolucao`), inclusive mediação e
  `cancel_sale` — o rótulo `devolvido` aparecia onde o glossário exige `type = 'returns'`.
- [x] **Filtro `Cancelados`.** Pedido não faturável sem claim `returns` (`!faturavel &&
  !pedidoTemDevolucaoReal`). Botão próprio na barra (Sacados → Cancelados → Devolvidos). Commits
  `6c1b9ef2`.
- [x] **Filtro `Devolvidos`.** Cruza `ml_devolucoes` via `orderIdsComDevolucaoReal` (só
  `type = 'returns'`), não a flag `tem_devolucao`. `DetalheFinanceiro` carrega `useDevolucoes`.
  Commit `6e235c62`.
- [x] **Validação.** Conta AVIL, 30 dias, browser-use em produção pós-deploy: **5** Devolvidos (todos
  `devolvido`), **32** Cancelados (todos `cancelado`); ~30 linhas que estavam erradas em Devolvidos
  migraram para Cancelados. Testes: `financeiro-detalhe-filtro`, `financeiro-cancelado`,
  `devolucoes-cards` (24 no escopo).
- [ ] **Baixo (opcional):** `aria-label` do checkbox ainda diz "devolvido" em linha cancelada.

## Catálogo — botão "Tentar catálogo de novo" (Publicados) — 2026-08-14

ADR: `docs/decisions/0021-vinculacao-automatica-ao-catalogo-ml.md` (extensão operacional)

- [x] **Edge `retentar-catalogo`** — re-enfileira `vincular-catalogo` (delay 60s) para família
  publicada com variação/item em `erro` ou `nao_elegivel` sem listing.
- [x] **UI Publicados** — botão ↻ na coluna Ações (só admin, flag `catalogRetentavel`).
- [x] **Testes** — pure `catalogo-retentavel` + botão em `Publicados.test.tsx`.

## Catálogo — opt-in recusado por under_review — 2026-08-14

ADR: `docs/decisions/0021-vinculacao-automatica-ao-catalogo-ml.md` (adendo pós-incidente lote #16)

- [x] **Helper `optinErroRetentavel`** — classifica 400 `under_review` como retentável.
- [x] **Orquestradores Legacy e UP** — opt-in under_review conta/persiste como `nao_elegivel` (backoff + alerta existentes); outros 400 continuam `erro`.
- [x] **Testes** — helper + integração item plano e UP; `decidirResultadoRodadaCatalogo` inalterado.

## Catálogo em risco — anúncios pausando sem aviso — 2026-08-13

Spec: `docs/superpowers/specs/2026-08-12-catalogo-em-risco-design.md` ·
Plano: `docs/superpowers/plans/2026-08-12-catalogo-em-risco-plan.md`

- [x] **Diagnóstico.** O ML sinalizava 3 anúncios como "Próximos a serem pausados" e o PubliAI não
  avisava nada. Causa: `pendente` devolvia 500 e vivia só do retry curto do QStash (minutos),
  enquanto a elegibilidade do ML leva horas ou dias — o retry esgotava e a família congelava. Como
  `deveAlertarCatalogoNoMatch` exigia `pendente === 0`, o alerta do ADR-0036 também nunca saía.
  Medido: **93 famílias / 296 variações** publicadas congeladas.
- [x] **Backend.** `pendente` e `nao_elegivel` passam a dividir o backoff longo; falha de leitura da
  elegibilidade propaga em vez de finalizar a rodada zerada (Legacy e User Products); alerta cobre
  `pendente` residual com motivo `elegibilidade_nao_resolvida`; worker honra `alertar: false` no
  body do job para o backfill rodar em silêncio. Sem migration.
- [x] **Tela.** Card "Catálogo em risco" em Publicados, com contagem, motivo predominante e link
  direto para o catálogo do ML por anúncio.
- [x] **Script de backfill.** `scripts/backfill-catalogo-pendente.ts` (dry-run por padrão).
- [ ] **Deploy** das 8 funções afetadas (`vincular-catalogo` + os 7 importadores de `telegram.ts`).
- [ ] **Executar o backfill** das 93 famílias — depois do deploy, com aprovação do Diego.
- [x] **Fase 3 — contrato resolvido e validado em produção** (2026-08-13, ADR-0118). O `productId`
  é o `parent_catalog_product.id`, não o `user_product_id`. São **duas** chamadas por anúncio, e a
  segunda depende do desfecho da primeira: `invalidate_summary_confirm` quando nenhuma variação tem
  ficha, `massive_summary_confirm` quando sobra vinculada. Os 3 anúncios sinalizados foram
  resolvidos (66 cliques manuais → segundos), sem perder nenhum dos 9 vínculos que competiam.
- [x] **Escopo passou a ser a tag `catalog_forewarning`** do próprio ML (o mesmo sinal de "Próximos
  a serem pausados"), no lugar da heurística local que listava 130 anúncios. Decisão do Diego.
- [x] **Deploy concluído (2026-08-13).** 15 edge functions, com `status-publicados` (v46→v47)
  deployada ANTES do merge do front — a ordem importa: com o campo ausente o card sumiria sem erro.
  Front no Render, main `5cb33680`. Card validado em produção com dados injetados: de dois anúncios
  em risco local, só o sinalizado pelo ML aparece.
- [x] **Runbook do operador:** `docs/runbooks/catalogo-anuncios-a-pausar.md` — como agir nas
  próximas vezes que o ML sinalizar anúncios.
- [ ] **Exercitar a extensão pelo painel.** As chamadas foram validadas direto na página; o fluxo de
  clique do operador ainda não foi percorrido ponta a ponta.
- [ ] **Item plano** (16 anúncios, `ml_variation_id = ml_item_id`) usa outro fluxo no ML — fora do
  lote da extensão.

## Estoque — variação órfã no ML vendia sem baixar — 2026-08-13

- [x] **Diagnóstico.** Venda pelo anúncio de catálogo `MLB7010890734` (cor Azul da linha Xik) não
  baixou estoque. Causa: o anúncio `MLB6901096672` tem **3** variações no ML (Branco, Preto, Azul
  `203375281741` / SKU `00220809`) e o PubliAI só conhecia 2 — a Azul não existia em `variacoes`.
  Com isso os três caminhos de resolução de SKU falham (item id fora de `idsPubliai`, GTIN
  `7894659007861` ausente do catálogo, anúncio de catálogo não carrega `seller_custom_field`).
  2 unidades vendidas sem baixa (pedidos `2000017520752664` e `2000017906471986`).
- [x] **Dado corrigido.** Variação Azul reinserida com os vínculos vivos (`ml_variation_id`,
  `catalog_listing_id=MLB7010890734`, `catalog_product_id=MLB74323526`), estoque 100 e custo 3,51
  (mesmo do Branco, definido pelo Diego). Varredura dos 142 anúncios da conta (1.241 variações
  vivas no ML) confirma: era a **única** órfã.
- [x] **Guard anti-órfão em `excluir-lote`.** `particionarExclusao` preserva a família não
  publicada cujo `ml_item_id|ml_variation_id` não sobrevive em nenhuma outra família da org.
  Fail-closed quando a consulta de vínculos falha.
- [x] **Alerta de SKU fora do catálogo em `sync-venda`.** `sku_nao_encontrado` da RPC deixou de
  ser descartado em silêncio: volta em `skuDesconhecido` e vira notificação em `vendas`.
- [ ] **Pendente:** nome interno da variação Azul gravado como `LINHA P/COST.XIK 120 2000J AZUL`
  (a planilha usa sufixo de cor, ex.: "10 BCA"); e o ML segue com 1.205 até o próximo push.

## Financeiro — compra virava venda e saque em devolvido (ADR-0117) — 2026-08-12

- [x] **Revisão completa do menu** (`.code-review-fable5/code-review-v11.md`): 42/100, BLOQUEAR.
  2 críticos, 6 altos, 4 médios. Escopo redesenhado com o Diego: o menu responde uma pergunta —
  quanto o ML liberou, quanto falta, o que já foi sacado.
- [x] **C1 — compras da própria conta em `ml_vendas`.** O webhook `orders_v2` notifica pedidos em
  que a conta é COMPRADORA e `sync-venda` gravava todos: 23 linhas (R$ 37.118,27), 7 em `paid`
  contando como faturamento (R$ 8.810,50). `ehVendaDaConta` recusa na ingestão (sync-venda v65,
  deployado ANTES da migration — com o worker antigo no ar, o próximo webhook reinseriria).
- [x] **C2 — saque em pedido devolvido.** A RPC nunca olhava `status`: 46 devoluções marcadas como
  sacadas (R$ 2.849,54). Travado em três camadas — ingestão, RPC e interface (checkbox desabilitada).
- [x] **A6 — saque exige admin** (`is_admin()`, mesmo predicado do ADR-0060).
- [x] **A1 — card "Estornos"** mostrava R$ 12,55 de R$ 3.394,20 reais (30d): devolução vira
  `cancelled` e sumia do KPI. Agora o estorno conta sempre.
- [x] **A2 — novo `aSacar`**: "Já liberado" misturava sacado e não sacado (R$ 11.436,85 = 10.893,29
  + 543,56). O card principal passou a ser o acionável.
- [x] **A3/A4/A5 — Detalhe do líquido:** lista só venda faturável (filtro `Devolvidos` para
  conferir), busca geral (`pedidoCasaBusca`) e paginação de 50 (a tela renderizava 985 pedidos).
  Totais do rodapé continuam somando o filtro inteiro, não a página.
- [x] Tela enxuta: 11 KPIs → 6. Saíram markup, lucro líquido, ticket médio e nº de vendas (vivem no
  Faturamento e no Dashboard).
- [x] Migration aplicada e verificada em produção: 0 compras, 0 saques indevidos, 695→649 sacadas,
  `db:check` alinhado. 3.026 testes verdes; validado em runtime com dados injetados (screenshots).
- [x] **Baixos fechados (13/08):** `sacado_por` passou a aparecer na coluna Liberação ("por Fulano",
  via `useNomesUsuarios` — a RLS de `profiles` entrega os perfis da org ao admin, e saque é
  admin-only); autor invisível cai em fallback silencioso, nunca UUID cru. Nota de rodapé do
  Financeiro reescrita para o escopo atual (6 linhas → 4). Com isso o code-review-v11 fica sem
  itens abertos.
- [x] **Médios fechados (mesma data):** `statusLiberacao` ganhou `sem_direito` (a aba Devolvidos
  mostrava "liberado" numa linha devolvida); confirmação no saque acima de 20 pedidos com
  quantidade e valor; aviso de volume no export acima de 200 linhas. O 4º médio (KPIs duplicados)
  já tinha caído com a tela enxuta. Validados em runtime: 49 pedidos/R$ 763,84 no diálogo,
  252 linhas no aviso de export.
- [x] **Regressão corrigida (13/08):** as 23 compras VOLTARAM 27 min após a primeira migration — a
  guarda ficou no `sync-venda`, mas `upsertVenda` tem 4 chamadores e o `sync-devolucao` reprocessa
  o pedido de cada claim. Trava movida para dentro do `upsertVenda` (`contaExternaId` obrigatório);
  `upsertDevolucao` recusa claim de compra via `ehClaimDeCompra`. 4 functions redeployadas ANTES da
  limpeza; segunda migration apagou 23 compras + 25 claims de compra.

## Financeiro — venda devolvida aparecia como retida pelo ML (ADR-0038) — 2026-08-12

- [x] **Motivo:** no Detalhe Financeiro, vários recebimentos saíam com Líquido `R$ 0,00`, markup `—`
  e **Retido (ML) igual ao Bruto**. Todas as linhas eram vendas `cancelled` com `tem_devolucao` e
  estorno de 100% — devoluções reais. `ehFaturavel` já zerava líquido/imposto/custo (ADR-0038), mas
  `retidoDoPedido` fazia `bruto − 0 − 0` e a tela dizia que o ML ficou com tudo; o dinheiro tinha
  voltado ao comprador.
- [x] A tabela e o rodapé filtravam só por `statusLiberacao`, nunca por faturável: o rodapé somava o
  bruto das devoluções e divergia do banner de KPIs da **mesma tela** — R$ 2.666,20 em julho/2026
  (33 pedidos), R$ 1.354,93 em agosto.
- [x] Segundo canal de divergência, achado ao verificar o número: `Pedido.status` é o do membro de
  **menor `order_id`**, e `Pedido.bruto` somava membros não faturáveis. Num pack misto (existe 1 na
  base, jun/2026, com a order mais antiga cancelada) filtrar por status descartaria a venda paga
  junto. Pedido ganhou `brutoFaturavel` + `faturavel`; `calcularKpisPedidos` (menu Faturamento) usa
  os dois no lugar do status representativo.
- [x] `totaisFinanceiro(pedidos)` virou o caminho único dos totais (tela + PDF) e
  `rotuloNaoFaturavel(p)` marca a linha como **devolvido/cancelado** — na tela (bruto riscado,
  retido/líquido "—") e no PDF exportado, que antes não carregava sinal nenhum de devolução.
- [x] Testes: 6 em `tests/lib/financeiro-cancelado.test.ts`, um deles provando que o rodapé
  (`totaisFinanceiro`, por pack) fecha com o banner (`calcularResumo`, por venda) em bruto, retido e
  líquido. Validado na tela com dados injetados: rodapé R$ 116,15 / R$ 30,95 / R$ 85,20 == banner.
- [x] Adendo no ADR-0038 com o caso real (sem ADR nova: é conformidade com a decisão existente).

## Stepper do Relatório dizia "Publicado" em lote que falhou — 2026-08-12

- [x] **Motivo:** Relatório do lote #46 acendia as 4 etapas em verde (Enviado → Processando →
  Revisão → **Publicado**) na mesma tela que mostrava `0 publicada(s)` e `1 com erro`.
  `jornadaDoLote` só olhava `lote.status`, e `concluido` significa "o lote terminou de rodar",
  não "publicou" — um lote com todas as famílias recusadas pelo ML fecha como concluído igual.
- [x] `jornadaDoLote(status, resultado?)` aceita `{ publicadas, erros }`: concluído com
  `publicadas === 0 && erros > 0` para na etapa Publicado em estado de erro. Publicação parcial
  (algumas publicaram) segue concluída — publicou de fato, e o resumo mostra os erros.
- [x] A etapa ganhou `labelErro` — mostra **"Não publicado"**, porque "Publicado" em vermelho
  continua lendo como publicado.
- [x] **Corrigido em TODAS as telas com stepper, não só no Relatório.** A premissa "só o Relatório
  exibe lote concluído" era falsa: "Editar e tentar de novo" leva o operador de volta à **Revisão**
  com o lote já fechado, e lá o stepper seguia verde logo acima do botão "Reenviar 1 com erro"
  (reportado no lote #46 depois do primeiro fix). Agora `resultado` é **prop obrigatória** de
  `JornadaLote` — o compilador cobra de toda tela nova — e o cálculo virou a função pura
  `resultadoPublicacao(familias)`, usada por Revisão, Relatório, Progresso e o card
  "Continuar de onde parei" (este via `totalPublicadas`/`totalErros` do lote).
- [x] **Badge do card do Dashboard idem** — exibia "Concluído" verde ao lado de
  "0 publicadas · 1 erro". A regra virou o predicado `loteFalhouNaPublicacao` em `lib/jornada.ts`,
  fonte única de stepper e badge; o card passa `{ publicadas: totalPublicadas, erros: totalErros }`.
- [x] Testes: 7 em `lib/__tests__/jornada.test.ts`, 3 em `components/__tests__/jornada-lote.test.tsx`,
  4 em `components/__tests__/status-badge.test.tsx`.

## GTIN inválido derrubava o lote (ADR-0116) — 2026-08-12

- [x] **Motivo:** lote #46, família `92710170` (Tecido Oxford Natal, importado) — CREATE recusado
  com `Product Identifier [GTIN] contains values with invalid format: [48251671]`. O número tem
  8 dígitos (comprimento de EAN-8), mas o verificador GS1 deveria ser `9`: é código de fornecedor
  na coluna GTIN, padrão de planilha de importado. Descartada corrupção por zeros à esquerda —
  lido como GTIN-8/12/13/14 o verificador dá `9` nos quatro casos.
- [x] `gtinAusente` (`_shared/ml/publicar.ts`) valida o mod-10 GS1 além do comprimento →
  variação cai em `EMPTY_GTIN_REASON` em vez de derrubar a publicação. Mesmo predicado guarda a
  busca de catálogo (`catalogo.ts:277`), que com GTIN inválido nunca acharia ficha legítima.
- [x] GTIN passou a ser **editável na Revisão** (`variacao-card.tsx`), com aviso inline quando o
  verificador não fecha; campo vazio publica como "sem código universal". A mutation
  `updateVariacaoGtin` existia órfã em `queries.ts` desde sempre — ganhou hook e UI.
- [x] Fixtures de teste com EAN de verificador errado (`7891234567890`) trocados por
  `7891234567895` em `publicar.test.ts`, `atualizar.test.ts` e `ml/catalogo-up.test.ts`.
- [x] Testes: 4 em `variacao-card-gtin.test.tsx`, 7 em `lib/__tests__/gtin.test.ts`, 2 novos em
  `publicar.test.ts` (EAN-8 válido vs. lote #46). Suíte completa verde.
- [x] **Deployado em produção (2026-08-12):** 13 functions que alcançam `_shared/ml/publicar.ts`
  pelo fecho transitivo de imports — `atualizar-status-publicado`, `metricas-vendas`,
  `monitorar-moderados`, `process-familia`, `publicar-anuncio`, `publicar-split-ml`,
  `publish-familia-ml`, `reconciliar-convergencia-up`, `remover-publicado`,
  `sincronizar-estoque`, `status-publicados`, `update-familia-ml`, `vincular-catalogo`.
  `verify_jwt` conferido pós-deploy: workers seguem `false`.

## Visibilidade dos descartes do título (ADR-0116) — 2026-08-12

- [x] **Motivo:** investigando o sumiço de "Natal" num título, dois obstáculos apareceram fora do
  código de título. (a) `editado_em` nunca era gravado — as famílias de 29/07 e 12/08 apareciam
  ambas com `te=true, editado_em=null` e não dava para separar "a IA gerou assim" de "o operador
  reescreveu". (b) Ninguém sabe o que o pipeline descarta; o spike de 04/08 chamou isso de "a
  única pergunta aberta", e ela bloqueia qualquer decisão sobre prioridade de termos.
- [x] `updateFamiliaTitulo`/`updateFamiliaDescricao` (`src/lib/queries.ts`) gravam `editado_em`.
- [x] `diagnosticarTitulo` (`_shared/ai/titulo-pos.ts`): mesmo pipeline, devolvendo
  `{slot, etapa, de, para}` por etapa. `posProcessarTitulo` virou wrapper de uma linha — sem
  segundo pipeline para divergir. `corte` compara por PRESENÇA (nova `montarTituloDetalhado`),
  não por diff, porque remove o slot inteiro em vez de reescrever.
- [x] Migration `20260812182613_adr116_titulo_descartes.sql`: `familias.titulo_descartes jsonb`,
  anulável e sem default — `NULL` = família anterior ao diagnóstico, `[]` = nada descartado.
- [x] **Censo rejeitou o guard de termos promocionais isolados** (lacuna 3a do Fable): `qualidade`
  6 ocorrências, `profissional` 1, todas ancoradas na fonte e **todas com `|` no título** — ou
  seja, formato pré-ADR-0099, nenhuma saída do pipeline de slots. `top`/`super`/`excelente`/
  `oferta`/`promocao`/`imperdivel`/`original`/`exclusivo`: zero. Ressalva que impede a conclusão
  oposta: 304 famílias pré-slots contra **6 pós-slots** (4 não editadas) — zero em 4 não prova
  ausência. Gatilho para reavaliar: ~50 famílias pós-slots, e aí o censo sai de `titulo_descartes`
  em vez de regex sobre o texto final.
- [x] Testes: 8 novos. Suíte verde: 346 arquivos / 3003 testes; `pnpm lint` 0 erros.
- [x] Deploy 2026-08-12, nesta ordem: migration via `supabase db push --linked` (dry-run antes),
  `npm run db:check` → "Migrations alinhadas (local = remoto)", coluna conferida no
  `information_schema` (`titulo_descartes jsonb`, nullable), **e só então** as functions.
  Fan-out por `deno info` sobre `titulo-pos.ts`/`titulo-montar.ts` → 3: `process-familia` v151,
  `publicar-split-ml` v73, `regenerar-copy-familia` v50, todas ACTIVE.
  A ordem importa: as functions escrevem a coluna, então deployá-las antes da migration derrubaria
  toda família processada no intervalo.

## Copy: o eixo de variação nem sempre é cor (ADR-0115) — 2026-08-12

- [x] **Motivo:** família de tecido Oxford com 7 estampas de Natal saiu com a descrição
  anunciando `🎨 CORES DISPONÍVEIS: Verde Musgo, Vermelho` — as duas cores que o Vision leu nas
  fotos. O anúncio oferece 7 estampas; a descrição declarava 2 cores. O título perdeu o tema.
- [x] **Regressão confirmada com o mesmo produto:** lote de 29/07 (pré-slots) publicou
  `TECIDO OXFORD LISO 10M | ESTAMPAS EXCLUSIVAS NATAL | PREMIUM` (`MLB7282797698`); o de 12/08,
  pós-ADR-0099, perdeu o tema. Mesma planilha, mesmo eixo `Est-N`, 14 dias.
- [x] `_shared/ai/eixo-variacao.ts`: o eixo sai do **sufixo do nome da variação** em relação ao
  `nome_pai` (dado da planilha), não da cor. Rótulo vem da palavra da fonte —
  `ESTAMPAS DISPONÍVEIS` / `VARIAÇÕES DISPONÍVEIS` / `CORES DISPONÍVEIS`. `Est.6`/`Est-6`/`EST 6`
  → `Estampa 6`; ordem numérica (6 antes de 18). Sem sufixo discriminante, nada muda.
- [x] `cravarTema` em `aplicarGuardsTitulo`: lista fechada de temas comemorativos cravada em
  `produto` (incortável). **A instrução no prompt sozinha não bastou** — medido: o modelo
  devolveu `produto="Tecido Oxford Liso"` com 23 chars sobrando. Teto de 40 chars em `produto`
  evita transformar título viável em `TituloInviavelError`.
- [x] `garantirPerguntas`: a seção `❓` sumia inteira com dado para 4 perguntas
  (`descricao_status`/`descricao_erro` nulos — a IA só não escreveu). Agora é reconstruída a
  partir dos bullets de `📌 ESPECIFICAÇÕES`, depois dos guards de largura/metragem.
- [x] Seções renomeadas: `✅ POR QUE ESCOLHER`, `📦 O QUE VOCÊ RECEBE`. `CABECALHOS_APOS_*`
  passam a casar pelo **emoji**, não pelo texto do cabeçalho.
- [x] `atualizarSecaoCores` reconhece os 3 rótulos e preserva o existente — sem isso, família
  estampada ganhava uma 2ª seção `CORES DISPONÍVEIS` no fim a cada reposição.
- [x] **Revisão da spec do operador (Fable, 2026-08-12):** sistema entrega ~70% da spec de
  descrição e ~80% da de título; quase toda ausência é rejeição já medida (spike 04/08, ADR-0102),
  não esquecimento. Achado que dissolve o pedido "sem emojis": `sanitizarDescricaoML` já os remove
  antes do envio — o ML rejeita (`DESCRIPTION_PLAIN_TEXT_NOT_ALLOWED`); no prompt eles são
  fronteira determinística de 4 guards. Rejeitados com motivo: prioridade atribuída pela IA
  (é a Causa C por outro canal), ordem dinâmica por categoria (benefício zero medido),
  "Como usar" (8 fontes em 305), Compatibilidade (campo inexistente na planilha).
- [x] `garantirConteudoEmbalagem`: a única seção que o operador chama de obrigatória era a única
  obrigatória sem rede. Bullets derivados de `extrairContagem`/`extrairMetragem` + substantivo do
  eixo ("Estampa escolhida no anúncio"). Sem dado derivável, **não** cria a seção.
- [x] `garantirDisclaimerTonalidade`: texto fixo ao fim da lista de variação, só quando há lista.
  Dentro da seção `🎨` — seção própria exigiria um 8º emoji na whitelist e nas duas listas de
  fronteira, custo desproporcional a uma linha.
- [x] Testes: 49 novos (15 eixo, 9 perguntas, 7 tema, 14 embalagem/tonalidade, 2 UPDATE, 2 prompt).
  Suíte verde: 340 arquivos / 2964 testes; `pnpm lint` 0 erros.
- [ ] **NÃO entregue — `🎯 INDICAÇÕES DE USO` de 4-6 para 4-12 bullets é prompt-only e não pegou.**
  Duas execuções reais contra a mesma fonte deram 4 e 3 bullets; a segunda ficou abaixo até do
  piso antigo. Mesmo modo de falha já medido para o tema. Fica pendente decidir se vira guard
  determinístico — é o item que mais separa a saída atual das 15 aplicações que o operador quer.
- [ ] **Limitação em produção hoje:** as 7 variações da família `92710170` têm `variacoes.cor`
  preenchida à mão como `Est-1`…`Est-33`. O CREATE escreve `- Estampa 6`, mas um UPDATE nessa
  família republica `- Est-6` sob o mesmo cabeçalho (ver Consequências do ADR-0115).
- [x] Deploy 2026-08-12: mudança em `_shared/ai` e `_shared/ml/criar-item.ts` → **12 functions**
  pelo grafo de imports (`deno info`), todas ACTIVE e conferidas pós-deploy:
  `atualizar-status-publicado` v33, `metricas-vendas` v42, `monitorar-moderados` v48,
  `process-familia` v149, `publicar-anuncio` v39, `publicar-split-ml` v71,
  `publish-familia-ml` v97, `reconciliar-convergencia-up` v21, `regenerar-copy-familia` v49,
  `sincronizar-estoque` v15, `status-publicados` v45, `update-familia-ml` v84.
  O merge na main **não** deploya Edge Functions — foi etapa separada via CLI.

## Estoque — excluir produto (ADR-0113) — 2026-08-12

- [x] **Motivo:** o ADR-0094 deu ao Estoque a porta de entrada (cadastro manual) sem a de saída.
  Produto criado errado ou de teste ficava para sempre na lista, inflando os KPIs da tela.
- [x] Edge `excluir-produto` (`verify_jwt=true`, admin-only, módulo `estoque`), body
  `{ codigo_pai }`. Reusa `pathsDaFamilia`/`filtrarPathsDeDonos`, `recontarOuRemoverLote` e
  `limparMovimentosOrfaos` de `_shared` — não duplica a saga de ML de `remover-publicado`.
- [x] Trava ADR-0019: 409 se **qualquer** família do `codigo_pai` tiver `ml_item_id`. Varre o
  código inteiro porque a tela só mostra a família mais recente — irmã publicada é invisível ali.
- [x] Delete leva todas as famílias do `codigo_pai`; varredura de órfãos **depois** do delete
  (ADR-0097 D-2); fotos só sob o prefixo do dono de cada família.
- [x] UI: menu `⋮` na linha do produto (só admin, só a partir de `md`), diálogo com saldo +
  confirmação digitada do código. Coluna de ações 12.5rem → 15rem no desktop; track mobile
  intacta — medido em 375px, um 3º botão derrubava o nome do produto para 49px de texto.
- [x] Testes: 6 do `processar` (recusa publicado/em voo sem apagar nada, ordem da varredura, guard
  de posse de Storage, fail-closed), 2 do diálogo, 2 do card.
- [x] Deploy: `supabase functions deploy excluir-produto` em 2026-08-12 (v1, ACTIVE,
  `verify_jwt=true`). O merge na main **não** deploya Edge Functions — é etapa separada.

## Imposto — alíquota interna por UF da empresa (ADR-0112) — 2026-08-11

- [x] **Motivo:** a AVIL é de PE e paga 1% ao vender para cliente do próprio estado. Com só as
  alíquotas por origem (8% nacional / 16% importado), toda venda intraestadual saía com imposto
  8×/16× maior que o real, derrubando líquido, lucro e markup nas telas de apuração.
- [x] Migration `20260812004735`: `configuracoes.uf_empresa` + `configuracoes.aliquota_interna_pct`,
  nullable e sem default (nulos = parâmetro desligado = regra por origem), com CHECK de coerência
  (os dois ou nenhum), formato de UF e faixa 0–100.
- [x] `AliquotaResolver` passa a receber a UF de entrega do pedido em parâmetro **obrigatório** —
  opcional, um call site esquecido devolveria a alíquota por origem em silêncio.
- [x] `montarAliquotaResolver`: UF do pedido = UF da empresa → alíquota interna (sobrepõe nacional
  e importado); senão, origem. UF do pedido nula ou parâmetro desligado → origem.
- [x] Campos "Venda dentro do estado" em Configurações (admin), com recusa de meia-configuração.
- [x] Recálculo retroativo sai de graça: imposto e markup não são persistidos, são derivados na
  leitura. **Limite medido:** só 1 pedido em 1389 está sem `ml_vendas.uf` — continua na regra por
  origem, sem necessidade de backfill.
- [x] Validado no runtime (pedido `2000017819569754`, entrega em PE): com o parâmetro ligado,
  imposto R$ 0,85 (1%), líquido R$ 59,69, markup +40%; desligado, R$ 6,78 (8%), líquido R$ 53,76,
  markup +26%.
- [x] Configurado em produção: org **Avil** com `uf_empresa = PE` e `aliquota_interna_pct = 1`
  (72 pedidos entregues em PE no histórico). Org DSA segue sem o parâmetro.
- [x] Escopo: só apuração pós-venda. Preço sugerido/gross-up seguem na origem — o anúncio tem preço
  único para o país e a UF do comprador só existe depois do pedido.

## Estoque — repor estoque reativa o anúncio pausado (ADR-0111) — 2026-08-11

- [x] **Motivo:** o ML só desfaz sozinho a pausa que ele mesmo aplicou por falta de estoque. Pausa
  do vendedor fica de pé mesmo com o saldo já no canal — `MLB5040504553` ficou `paused` com as 70
  unidades corretas, e o operador não tinha como saber por quê.
- [x] `sincronizar-estoque`: com `reativar` no job e saldo > 0, lê o status ao vivo depois do push e
  devolve `pausado` → `ativo`. Já ativo não recebe PUT (o job é reentregue). `moderado`,
  `encerrado`, `inativo` e `indisponivel` intocados.
- [x] A flag é ligada por quem **repõe**: `entrada-estoque` direto, e o outbox pelo **sinal da
  quantidade** (`quantidade > 0` → entrada e estorno; venda e ajuste ficam fora). `reposicao` entrou
  na chave de agrupamento de `despacharPushPendente` — sem isso a entrada seria despachada com a
  intenção da venda.
- [x] Reconciliação diária **não** reativa: ela re-empurra saldo de produto com movimento recente, e
  reativar ali traria de volta um anúncio pausado à mão sem reposição nenhuma.
- [x] 10 testes novos (7 no worker + 3 no despacho, que não tinha cobertura), RED confirmado.

## Faturamento — MLB do anúncio de catálogo entra no catálogo (ADR-0021) — 2026-08-11

- [x] **Lacuna:** `carregarCatalogo` só conhecia `familias.ml_item_id`. O vínculo de catálogo cria
  um anúncio **separado** (`variacoes.catalog_listing_id`), então a venda dele só era reconhecida
  pelo fallback de GTIN — produto sem EAN ficaria sem código, e sem código não há baixa de estoque.
- [x] `catalog_listing_id` registrado em `idsPubliai`/`codPorItem`/`eanPorItem`. 5 testes novos
  (`catalogo-anuncio-catalogo.test.ts`), RED confirmado antes do fix.
- [x] **Sem dado errado hoje:** nenhum SKU vinculado está sem GTIN (288 Avil, 4 DSA). Vendas de
  catálogo já baixavam estoque — Avil 86/87 e DSA 55/55 desde 2026-07-29, quando a baixa entrou.
  A única fora é o pedido `2000017642757888` (do próprio dia 29/07, 1 unidade do `03059251`).
- [x] Vale para syncs futuros; `ml_vendas` já gravadas mantêm o código até re-sincronizar.

## Estoque — 7 de 147 produtos sem foto: re-ingest sem imagens não herda `imagem_path` — 2026-08-11

- [x] **Conferido:** nos 7, nem a família nem nenhuma variação têm `imagem_path`/`ml_picture_id`.
  A tela lê essas colunas, então não há o que renderizar — o fallback de foto do ML funciona
  (os outros 140 mostram miniatura).
- [x] **Causa:** o lote #45 (`Atualizar_estoque_-_03082026.xlsx`, 03/08, ainda em `revisao`) subiu
  **sem nenhuma imagem** e recriou **135 famílias**. Como a tela adota a família **mais recente**
  de cada `codigo_pai` (âncora ADR-0025), essas passaram a ser as canônicas. Em `ingest-lote`,
  `imagem_path` vem só de `matchImagem(CODIGO, lote.imagens_paths)` — o lote atual. **Nunca é
  herdado da família anterior**; só o `ml_picture_id` é (`herdarPictureId`).
- [x] Por isso 128 dos 135 escaparam: são publicados e herdaram o `ml_picture_id`. Os que ficaram
  em branco são justamente os **não publicados**, que não tinham id de foto do ML para herdar.
- [x] **2 dos 7 têm o arquivo no Storage**, do lote #33 (13/07): `03149730` (VELLUT AMIGURUMI,
  28 de 28 variações) e `02960150` (KIT AGULHA 25, 1 de 1). O arquivo sobreviveu, o vínculo não.
- [x] Os outros 4 (`00300705`, `00440663` — o do print, `00440680`, `03031799`) não têm arquivo
  nenhum no Storage: nunca tiveram foto.
- [x] O 7º é `EXT-MLB6901126538` (publicado, importado): a foto existe no anúncio do ML, mas
  `capa_ml_picture_id` está nulo. Prefixo `EXT-` não é gerado por nenhum código do repositório —
  linha criada fora do fluxo em 2026-07-09.
- [ ] **Decisão pendente do Diego.** Herdar `imagem_path` no re-ingest não é trocar uma linha:
  `herdarPictureId(base.imagem_path, herdado)` zera o id do ML quando enxerga imagem nova, então
  passar o caminho herdado ali derrubaria a foto de produto **publicado**. Alternativas: (a) religar
  só as 29 variações dos 2 produtos por SQL; (b) reenviar as fotos no lote #45; (c) herdar
  `imagem_path` com uma flag que não invalide o `ml_picture_id`.

## Faturamento/Estoque — venda não baixava estoque de produto de outro membro da org — 2026-08-11

- [x] **Sintoma:** 12 unidades do NIVEA (org DSA) venderam em 10 pedidos pagos e o saldo continuou
  12. Na tela de Faturamento o item aparecia com **Código `—`**.
- [x] **Causa raiz:** `carregarCatalogo` (`_shared/faturamento/io.ts`) filtrava `familias` e
  `variacoes` por **`user_id`** — o `criado_por` da conexão do canal. O NIVEA foi cadastrado por
  outro membro da mesma org, então ficava fora do catálogo: `is_publiai = false` e código não
  resolvido. Resíduo pré-multi-tenancy; o dado é org-scoped desde o E7/ADR-0027 (o próprio
  `backfill-faturamento:56` já chamava isso de "proxy legado"). Agora filtra por `org_id`, com
  fallback para `user_id` só quando não há conexão para resolver a org.
- [x] **Por que ninguém viu:** `selecionarBaixas` descartava item sem código **em silêncio** — nem
  o motivo `venda_sku_nao_encontrado`, que já existia no ledger, era gravado (0 linhas em todo o
  banco). Agora venda paga sem SKU vira movimento informativo (`quantidade = 0`, `codigo_pai`
  vazio para nunca virar push) mais notificação na categoria `vendas`.
- [x] **Rede de segurança:** o ML manda o SKU em `seller_custom_field` (vinha preenchido com
  `00000029` o tempo todo). Passa a ser o último recurso para resolver o código — **sem** promover
  o item a `is_publiai`, que significa "anúncio gerenciado por nós" e o vendedor pode preencher
  esse campo em qualquer anúncio dele.
- [x] **Alcance medido:** Avil **0 de 297** famílias afetadas; DSA **2 de 6** (as cadastradas pelo
  outro membro). 22 das 124 vendas da DSA estavam com `is_publiai = false`.
- [x] **Correção do saldo:** os 10 pedidos foram re-enfileirados no `sync-venda` depois do deploy.
  A baixa rodou de verdade (10 movimentos `venda`, −12 no total), o saldo foi de 12 para **0** e o
  push levou 0 ao ML, que pausou o anúncio sozinho. Nenhum ajuste manual foi usado — o histórico
  ficou com a causa certa.
- [x] Redeploy das 8 funções que dependem do `_shared` alterado: `sync-venda`, `sync-devolucao`,
  `reconciliar-faturamento`, `backfill-faturamento`, `ml-webhook`, `reconciliar-estoque`,
  `sync-mensagem`, `sync-pergunta`.

## Estoque — botão "Ajustar" cortado e foto do produto pai — 2026-08-11

- [x] **O botão "Ajustar" vazava para fora da tela.** A última coluna do `GRID_LINHA_PRODUTO`
  media `6.5rem` (uma ação só) e os dois botões usavam `w-full` — dois filhos pedindo 100% CADA
  um da coluna. A linha não tem overflow que segure, então o segundo saía da viewport. Coluna
  passou para `12.5rem` (`5.5rem` no mobile) e os botões para `flex-1 min-w-0`.
- [x] **Produto pai aparecia sem foto.** Produto de planilha nasce sem capa própria — na AVIL,
  **1 de 147** famílias tinha `capa_storage_path`, e só 11 tinham `imagem_path` em alguma
  variação. A foto real vive no anúncio: **140 de 147** têm `ml_picture_id`. A tela agora cai
  para a foto do ML (`urlFotoMl` → `https://http2.mlstatic.com/D_{id}-V.jpg`, a variante
  reduzida), preferindo a capa da família, depois a variação principal, depois a primeira
  variação com foto. Mesma cadeia na linha de variação do painel expandido. Sem nenhuma foto,
  continua o placeholder.

## Estoque — ajustar/zerar pelo PubliAI (ADR-0110) — 2026-08-11

- [x] **Diagnóstico: cor zerada no ML voltava sozinha.** O push é absoluto e o cron
  `reconciliar-estoque` (`30 12 * * *`) re-empurra todo produto com movimento nas últimas 24h com
  `canal_origem: null` fixo (`reconciliar-estoque/index.ts:93`), descartando o `push_canal_origem`
  que o `sync-venda` grava justamente para não ecoar ao ML. Confirmado em produção: 13 pushes
  criados às 12:30 UTC de 11/08 e saldo local do Vermelho intacto (2000/1990/2000) nos três
  anúncios Helanca Light.
- [x] **Migration `20260811201026`:** motivo `ajuste` no ledger + RPC `ajustar_estoque`. A RPC
  precisa pertencer ao role `estoque_rpc_executor` — o trigger de bloqueio só libera esse
  `current_user` desde o guard de 2026-08-04. Sem isso, `42501` na primeira escrita real; pego
  testando contra produção dentro de `begin/rollback`.
- [x] **Edge `ajustar-estoque`:** admin-only, módulo `estoque`, lista de ajustes com **`ref` por
  item** (`ajuste:{ref}:{codigo}`) — ref compartilhada faria o 2º item colidir na unique e o
  "Zerar tudo" aplicaria só a primeira cor devolvendo sucesso. SKU repetido é 400.
- [x] **UI:** botão "Ajustar" no card do produto (só admin), diálogo com campo por variação,
  "Zerar" por linha e "Zerar tudo", trava de aumento apontando para a Entrada, aviso de que
  estorno posterior repõe o saldo. Motivo `ajuste` ganhou rótulo e grupo no histórico.
- [x] Docs: ADR-0110, spec, plano, `edge-functions.md`, `modelo-de-dados.md` (inclusive a
  descrição desatualizada do trigger, que ainda dizia `auth.uid()`), `operacoes-rotineiras.md`
  com a regra **nunca editar estoque direto no ML**.
- [x] **Falha de segurança encontrada e fechada no deploy (migration `20260811203500`).** O
  `revoke`/`grant` da migration original rodava DEPOIS do `alter owner`, então o executor não era
  grantor válido e os dois viraram no-op — com WARNING, não com erro. A função ficou com o default
  do Postgres (EXECUTE para PUBLIC) mais `anon` e `authenticated`; como é `security definer` e
  recebe `p_org` por parâmetro, qualquer usuário autenticado poderia chamá-la via PostgREST e
  zerar estoque de **qualquer organização**. Corrigido com `set local role estoque_rpc_executor`
  dentro de `begin/commit` explícito (o `db push` não abre transação). Verificado depois:
  `POST /rest/v1/rpc/ajustar_estoque` com JWT de usuário devolve `42501 permission denied`.
- [ ] **Pendência (baixa severidade): `postgres` ficou membro de `estoque_rpc_executor`.** O
  `grant` necessário ao `alter owner` foi gravado com `grantor = supabase_admin`, e nem a
  Management API nem o `db push` (ambos rodam como `postgres`, que não é superuser nem membro de
  `supabase_admin`) conseguem revogá-lo — `no possible grantors`. **O guard essencial segue
  intacto:** `service_role`, `authenticated` e `anon` continuam sem poder assumir o role
  (verificado por `pg_has_role`), então nenhuma via da aplicação escreve saldo direto. O que mudou
  é que quem tem a credencial `postgres` pode `set role` — e essa credencial já podia alterar o
  trigger de qualquer forma. Resolver exige uma sessão com `supabase_admin` (suporte Supabase).
- [x] Validado em produção: RPC exercitada com `begin/rollback` (6 casos), ajuste real na org DSA
  e reversão por Entrada, e a UI conferida no dev local — inclusive o "Zerar tudo" com 3 cores
  (−5871 em 3 variações).
- [x] **Propagação ao ML provada de ponta a ponta.** A primeira tentativa (SKU `00000027`) mostrou
  `DELIVERED 200` no QStash mas o ML continuou em 12: o anúncio está **moderado/forbidden** e o ML
  recusou o PUT com 400 (`estoque_push_definitivo` no log da função). `sincronizar-estoque`
  devolve 200 mesmo em falha definitiva, então **fila entregue não é prova de canal atualizado**.
  Repetido no `00000029` (item `MLB5040504553`, saudável): estoque no ML foi de **0 → 11**, lido
  pelo mesmo caminho da tela Publicados (`lerStatus`). Estado devolvido ao original em seguida.
- [x] **Achado do ML:** repor estoque **reativa** anúncio pausado (o `MLB5040504553` voltou de
  `paused` para `active` sozinho ao receber 11, sem nenhum PUT de status; foi re-pausado depois).
  Registrado no ADR-0110 e em `operacoes-rotineiras.md`.

## Faturamento — miniatura mostrava a foto de outra cor — 2026-08-11

- [x] **A venda de "Amarelo Canário" aparecia com a foto do Vermelho.** Mesmo landmine dos itens
  abaixo, agora em `src/lib/fotos-produto.ts`: o mapa por anúncio era first-wins, então um anúncio
  com N cores guardava a foto da PRIMEIRA variação da lista e todas as cores herdavam. Atinge os
  mesmos 8 anúncios em que o `item_externo_id` do filho UP é também o `familias.ml_item_id`
  (as demais cores caem no fallback por GTIN, que é exato — por isso a foto do Branco já estava
  certa). Corrigido com a mesma disciplina de `cor-produto.ts`: chave disputada por fotos
  diferentes é anulada, e o `sku` do filho UP sobrepõe. Sem chute: a cadeia segue para GTIN/código
  (exatos) e, no pior caso, para a capa da família — genérica, nunca de outra cor.
  Simulado contra produção: 424 itens sem variação, 4 mudam de foto e os 4 vão de errada para
  certa (314 → 318 batendo com o código vendido), nenhuma regressão e nenhum item perde foto.

## Faturamento — coluna "Cor" vazia em item plano — 2026-08-11

- [x] **Cor do produto não aparecia em 184 de 1350 itens vendidos** (Faturamento e Detalhe do
  líquido). O sync grava `ml_vendas_itens.cor` a partir de `order_items[].item.variation_attributes`
  (`_shared/faturamento/venda.ts`), que o ML só manda quando a venda tem variação. Item **plano** —
  filho User Products (ADR-0088, 1 item ML por cor) ou família de 1 variação — vende sem variação:
  183 das 184 linhas têm `variation_id` nulo. Corrigido na **leitura** (`src/lib/cor-produto.ts`,
  espelhando `fotos-produto.ts`), o que conserta as vendas já sincronizadas sem re-sync nem deploy
  de Edge Function. A resolução por anúncio só vale quando o anúncio tem uma cor única, e o SKU do
  filho UP sobrepõe o chute da família — chave ambígua devolve "—" em vez de inventar cor.
  Simulado contra produção: 144 resolvidas (as outras 40 não têm cor em lugar nenhum), todas
  batendo com o título do anúncio.

- [x] **Código/EAN da venda apontavam para outra cor em filho User Products.** Achado ao investigar
  o item acima. Quando o `item_externo_id` do filho UP é também o `familias.ml_item_id` (cor 1 da
  família migrada, 8 dos 53 filhos), `carregarCatalogo` já semeou `codPorItem`/`eanPorItem` com a
  primeira variação da família em ordem arbitrária (`io.ts:96-98`) ou com `codigo_pai`
  (`io.ts:103`), e `fundirItensUP` se recusava a sobrescrever. Em produção: 4 vendas com código
  errado, 3 delas também com EAN errado (ex.: `MLB4959919693`, Amarelo Canário, exibia código `18760903`, de
  Vermelho). Corrigido em `catalogo-up.ts`: o par `item_externo_id → sku` é 1:1 exato (ADR-0088
  "Ancoragem") e agora sobrescreve. Anúncio com variações reais não é afetado — a venda traz
  `variation_id` e o resolver acha por `codPorVar` antes do mapa por item.
  **Custo e markup NÃO foram afetados:** `venda_item_custo` (ADR-0109) é chaveado por
  `(venda_id, ml_item_id, variation_id)`, não por código, e é insert-once — verificado em produção,
  o custo congelado das 15 vendas de filho UP está correto (cores da mesma família compartilham
  custo). O erro era só de rastreabilidade.
  **Entregue em produção (2026-08-11):** deploy de `sync-venda` (v61), `reconciliar-faturamento`
  (v61), `backfill-faturamento` (v64) e `sync-devolucao` (v41) — todas importam `carregarCatalogo`.
  As 4 linhas históricas foram corrigidas por UPDATE derivado de `anuncios_externos_itens.sku`
  (mesma fonte que o código deployado usa), já que o backfill exige JWT de sessão. Conferido
  depois: 0 códigos errados, 0 EANs errados, 0 divergências em `venda_item_custo`.

## Faturamento — paginação de Perguntas e Mensagens — 2026-08-08

- [x] **Faturamento — paginação de Perguntas e Mensagens** — as duas abas despejavam a lista
  inteira numa página só, sem divisão (spec `2026-08-08-paginacao-perguntas-mensagens-design.md`).
  Perguntas ganhou busca paginada server-side (mesmo padrão de Movimentos de estoque); Mensagens
  pagina no cliente sobre as conversas já agrupadas (db-side fica para quando o volume pedir —
  exigiria view/RPC nova). As duas ganharam abas de status (Pendentes/Respondidas/Todas e
  Aguardando/Todas) no lugar da ordenação implícita "pendente primeiro", que não sobrevive a
  paginação sem virar filtro explícito.

## "Unidades vendidas" lento no Publicados — causa medida, fix pendente de decisão — 2026-08-08

Diego reportou demora para carregar "unidades vendidas" no menu Publicados.

**Tentativa 1 (rejeitada por auditoria) — não repetir:** o agente diagnosticou "nenhum índice em
`org_id` existe em `ml_vendas`" e criou a migration `20260808102551_ml_vendas_org_index.sql`
(`(org_id, date_closed desc)`), aplicada em produção e mergeada. **Diagnóstico errado, achado por
auditoria com Opus no mesmo dia:** já existia índice `(org_id)` desde 05/07
(`20260705165131_e7_org_id_dominio.sql`, mesma fase E7, confirmado vivo em produção com 903 index
scans) — o agente não viu essa migration. Além disso `ml_vendas` tem só ~4,4 MB (~1226 linhas);
seq scan nesse tamanho é milissegundos, não a causa de lentidão perceptível. Nenhuma medição
(EXPLAIN, cronometragem) foi feita antes de aplicar o fix. O índice novo não é nocivo (torna o
`(org_id)` puro redundante — candidato a drop futuro, sem urgência) mas é **placebo**: não resolve
o sintoma relatado. Ver correção em `docs/reference/modelo-de-dados.md`.

**Medição feita (2026-08-08, org Avil em produção — `pg_stat_statements` + tamanho real de payload
via Management API read-only). Volumes Avil: 5380 variações, 862 vendas em 30d, 297 famílias
publicadas.**

| Camada | Medido | Veredito |
|---|---|---|
| DB — query de vendas (PostgREST, 2 embeds) | 20–35 ms média, máx 220 ms | rápido |
| DB — query de custos (`variacoes`) | ~23 ms/página, máx 319 ms | rápido |
| ML API — `status-publicados` / `lerStatus` | chunks de 20 em `Promise.all` (~15 paralelos) | ok, O(1) |
| **Rede — payload de vendas (30d)** | **1155 kB por carga** | **gargalo** |
| **Rede — payload de custos** | **1301 kB em 6 round trips SEQUENCIAIS** | **gargalo (1ª carga)** |

O banco não é o gargalo em nenhuma camada — o índice da Tentativa 1 está definitivamente descartado
como solução.

**Causa raiz (confirmada, não mais hipótese):** `Publicados.tsx:422` usa
`{ tipo: 'preset', dias: 30 }`; `resolverJanela` (`src/lib/metricas.ts`) calcula
`desde = new Date() − 30d` — timestamp com milissegundos que muda a cada montagem.
`chaveJanela` (`src/hooks/useVendas.ts:37`) trunca só o `ate`, **nunca** o `desde` (deliberado,
por correção financeira — ver comentário no próprio arquivo). Logo a `queryKey` do React Query é
**nova a cada abertura da tela** → nunca há cache hit → baixa os 1155 kB inteiros toda vez, e o
poll incremental do ADR-0082 nunca entra em ação (ele exige cache prévio para calcular o delta).
Custos têm chave estável (`['custos']`, staleTime 30 min) → pesam só na 1ª carga da sessão.

**Custo por visita: 1ª abertura ≈ 2,4 MB; cada reabertura ≈ 1,1 MB, sempre do zero.**

**Opções de fix levantadas (Diego optou por não implementar agora — 2026-08-08):**
1. *Alinhar a janela `preset` ao dia* — `resolverJanela` começar às 00:00 de N dias atrás em vez de
   "agora − N dias". A chave vira estável por construção → cache + delta do ADR-0082 voltam a
   funcionar. **Muda ligeiramente os KPIs de "últimos 30 dias" em Publicados, Faturamento,
   Dashboard e Financeiro** (passam a cobrir dias inteiros) → exige ADR/adendo ao 0082.
2. *Só cortar payload, sem tocar na janela* — paralelizar a paginação de `buscarCustos`
   (`src/lib/paginacao-supabase.ts`, hoje `await` em loop) e enxugar colunas do select de vendas.
   Não altera nenhum KPI, mas o refetch de 1,1 MB por reabertura permanece.

- [x] Migration `20260808102551_ml_vendas_org_index.sql` aplicada (não reverter — inofensiva, só
  não é a solução).
- [x] Medir gargalo real.
- [ ] Corrigir com base na medição — **decisão de Diego pendente** (opção 1 exige ADR).

### Faceta 2: o dois-passos da linha (org DSA, produto Eucerin) — corrigido 2026-08-08

Relato: "a coluna de unidades vendidas do PROTETOR SOLAR EUCERIN demora só na 1ª carga; os outros
produtos aparecem instantâneo". Medido na org DSA (81 vendas em 30d, 100 kB): a query de vendas
leva 0,7–1,2 s e a do mapa canônico 0,5 s — nenhuma das duas é lenta, e **não existe caminho de
código por produto** (`resumo.porItem` tem um único consumidor, `Publicados.tsx:513`).

O que é específico daquele produto: 37 das suas 82 unidades entram pelo anúncio de **catálogo**
(`MLB7343614472` → dono `MLB4982690837`), e essa fatia só migra para a linha quando a **segunda**
query (`useAnuncioCanonico`) resolve. A linha ia de `—` → 45 → 82 enquanto as outras resolviam num
passo. Ele nota nesse produto porque são 73 dos 81 pedidos da org no período — os demais mostram 1
ou 3 unidades, onde o salto é invisível.

Descartados por medição: `date_closed` nulo (0), `canal` nulo (0), teto de paginação (81 « 1000),
RLS multi-org (`current_org_id()` devolve uma org por vez).

- [x] `useResumoVendas` expõe `canonicoPronto` (`isSuccess || isError` — erro degrada para o
  comportamento sem mapa, nunca deixa a coluna presa em `—`).
- [x] `Publicados.tsx` só preenche `unidadesVendidas`/`valorVendido` com o mapa assentado.
- [x] **Não gatear o resumo inteiro no hook** (proposta descartada em revisão): `Dashboard.tsx:114`
  tira o loading de `vendasRaw.isPending`, não do `isFetching` deste hook — zerar o resumo pintaria
  R$ 0,00 nos cards financeiros. O mapa canônico não altera nenhum KPI agregado (bruto, líquido,
  unidades, pedidos), só em que chave as unidades caem.
- [x] Testes: 3 no hook (flag pendente/sucesso/erro + KPIs não segurados) e 1 na tela (mapa
  pendente → sem parcial, ponte de líquido intacta).
- Escopo: elimina o salto, **não reduz** o tempo até o número final aparecer — isso depende da
  decisão pendente acima (chave de cache instável + payload).

## Alíquota do imposto ao lado do valor no Faturamento — 2026-08-08

No detalhe de cada pedido (Faturamento e Detalhe do líquido), a linha "Imposto" passa a mostrar a
alíquota entre parênteses: `Imposto R$ 3,56 (8%)`.

- [x] `ItemPedido.aliquotaPct` carrega o valor cru do `AliquotaResolver` (8/16 — ADR-0055).
- [x] `detalhe-pedido-itens.tsx` exibe o %, formatado em pt-BR, com média ponderada pelo valor
  quando o pedido mistura origens.
- [x] **Nunca derivar o % de `imposto ÷ valor`**: o imposto é arredondado a centavos e a divisão de
  volta erra a alíquota (R$ 44,55 a 8% → 7,99%; R$ 45,07 → 8,01%, ambos em linhas reais). Pego na
  revisão antes do merge; 10 testes travam o comportamento, incluindo a regressão do R$ 44,55.
- [x] Validado ao vivo com dado de produção em 1280px e 375px.
- [x] **Só no desktop** (pedido do Diego, 08/08): o `%` fica `hidden sm:inline` — no mobile o bloco
  divide 2 colunas estreitas e o percentual vira ruído. O valor em R$ continua nos dois tamanhos.
  O teste assere a classe porque o jsdom não aplica Tailwind: sem isso, remover o `hidden` passaria
  despercebido.
- Achado pré-existente, **não corrigido** (fora do escopo): no mobile, "Comissão ML" e "Imposto"
  ficam na 2ª coluna do grid de meta e só aparecem rolando a tabela de itens para a direita.

## Atributo `NAME` obrigatório preenchido sozinho (adendo ADR-0052) — 2026-08-07

Lote #11 (Gel de Limpeza Facial, MLB264874) travou pedindo "Nome" ao operador — obrigatório
texto-livre que nem a base determinística nem a IA (regra anti-invenção) preenchiam.

- [x] `preencherNomeObrigatorio` em `_shared/categoria/atributos.ts`: `NAME` obrigatório e vazio →
  nome do produto da planilha (mesma fonte do `MODEL`), rodando **depois** da IA.
- [x] Aplicado nos dois ramos: genérico (`resolver-atributos-genericos.ts`, cobre também o seletor
  manual de categoria) e aviamento (`process-familia`).
- [x] Testes (6 unitários + 1 de integração) e adendo no ADR-0052.
- [x] **Deploy** de `process-familia` (v147), `definir-categoria-familia` (v41),
  `atributos-familia` (v29) e `publicar-split-ml` (v70) — mudança em `_shared/`.
- [x] Lote #11 destravado: `NAME` gravado com o mesmo valor determinístico que o código novo
  produz + `atributos_faltantes` zerado. Correção pontual de dado em vez de reprocesso completo —
  reprocessar regeneraria título/copy/preço por IA sem necessidade. A UI não oferecia botão: o
  "Reenviar" da Revisão só cobre família em status `erro`, e esta estava em `pronto`.
- Confirmado no dado real: a IA rodou nessa família (`LINE`, `SKIN_TYPE`, `APPLICATION_MOMENT`,
  `UNIT_WEIGHT`, `PRODUCT_FORMAT`… preenchidos) — só o `NAME` escapava, sem falha silenciosa de LLM.

## Custo congelado no instante da venda (ADR-0109) — 2026-08-07

Markup histórico fiel: o ADR-0108 deixou isto registrado como decisão não tomada; Diego pediu.

- [x] **T0 ADR-0109** + índice de ADRs.
- [x] **T1 migration** `venda_item_custo`: satélite insert-once, `unique nulls not distinct`,
  trigger que faz `UPDATE` do custo falhar, RLS select por org + grant.
- [x] **T2 `custo-vigente.ts`** (espelho servidor de `src/lib/custos.ts`) + **teste de paridade
  FE↔BE**. O teste já valeu o preço: pegou que o FE deixava `NaN` passar (`Number('abc')` é NaN e
  `NaN <= 0` é false) enquanto o BE devolvia null — guarda de `isFinite` aplicada nos dois lados.
- [x] **T3 congelamento dentro do `upsertVenda`**, não nos callers: são 4 (`sync-venda`,
  `sync-devolucao`, `backfill-faturamento`, `reconciliar-faturamento`×2). `custoVigenteResolver`
  é campo obrigatório — quem esquecer não compila (verificado com o `deno check` do CI).
- [x] **T4 backfill** por lote vigente na data, idempotente, `fonte='backfill'`. Simulado contra
  produção antes de aplicar: 1166 linhas.
- [x] **T5 frontend**: embed de `venda_item_custo` em `buscarVendas`; `montarCustoResolver` prefere
  o congelado e cai no dinâmico sem ele. Nenhuma mudança visual.
- [x] **T6 docs**: modelo-de-dados, edge-functions, este arquivo, índice de ADRs.
- [ ] **T7 deploy + verificação — BLOQUEADO:** `supabase db push` exige a senha do Postgres, que
  não está no `.env.local` (só o `SUPABASE_ACCESS_TOKEN`, que serve à API e não à conexão direta).
  Ordem obrigatória: **`db push` primeiro, deploy depois** — vendas sincronizadas na janela entre
  os dois ficam sem custo e se curam no backfill horário seguinte.
  Redeploy das **10** functions que importam `io.ts` (não só as 4 que chamam `upsertVenda`):
  `sync-venda`, `sync-devolucao`, `sync-pergunta`, `sync-mensagem`, `backfill-faturamento`,
  `reconciliar-faturamento`, `ml-webhook`, `responder-pergunta`, `responder-mensagem`, `usuarios`.

## Custo inflado por variação duplicada (ADR-0108) — 2026-08-07

- [x] Diego reportou: venda de 2 un. da COLA EM BASTÃO (`02841037`) exibindo custo R$ 34,24 com
  custo cadastrado de R$ 15,86 (esperado R$ 31,71). **Causa:** a variação existe em 3 famílias
  (lotes 26, 39 e 78) com **todas as chaves idênticas** — mesmo `ml_variation_id`, `ml_item_id`,
  `gtin` e `codigo`. Duas têm o custo antigo `17,1224`, a mais nova tem `15,8558`, e o tie-break
  de `montarMapasCusto` era **maior custo** → `17,1224 × 2 = 34,24`.
- [x] **Não veio da mudança de ORIGEM do mesmo dia:** aquele update tocou 19 variações de Helanca
  às 17:49; a cola mudou às 17:33, por outro caminho. O `upsertMax` existe desde 2026-06-23
  (`59f7f6aa`), sem ADR.
- [x] **Alcance medido:** 309 códigos da org estavam com custo inflado pelo mesmo motivo
  (diferença média R$ 0,17/un, máxima R$ 1,89) — markup subestimado em todos.
- [x] **Fix (ADR-0108):** tie-break passa a ser a linha mais recente (`atualizado_em`), que entrou
  no `select` de `buscarCustos`. Data ausente/inválida = `-Infinity` e a troca exige data
  estritamente maior, então nada fica não-determinístico. 5 testes novos, incluindo o caso real da
  cola pelas 4 chaves. Suíte: 2657 verdes.
- [x] **Risco do critério medido:** `atualizado_em` também muda por baixa de estoque (o timestamp
  de 17:33 da cola era a venda, não o custo). Se uma baixa tocasse uma linha antiga, o custo velho
  voltaria a vencer. Medido nos 1683 códigos duplicados da org: **em 100% a linha mais recente é a
  do lote mais novo, zero divergências**. A query de verificação está no ADR-0108 — rodar de novo
  se custo antigo voltar a aparecer.
- [x] **Achado:** o re-ingest sobrescreve `custo` com o valor da planilha sempre (`preco_publicacao`
  é preservado, ADR-0016). Não existe modo "somente estoque" — uma planilha de atualizar estoque
  com custo defasado do ERP substitui o custo bom sem avisar.
- [ ] **Raiz não resolvida:** a duplicação de `familias` no re-ingest continua (mesma coisa vista
  nos tecidos: 3 famílias com o mesmo `ml_item_id`). Enquanto existir, toda resolução por chave
  depende de tie-break. Deduplicar é trabalho à parte — mexe em famílias publicadas e no vínculo
  com o ML.

## ORIGEM obrigatória na planilha — imposto nunca presumido (ADR-0107) — 2026-08-07

- [x] Diego reportou: venda do Oxford 10m com imposto R$ 4,49 sobre R$ 56,16 = **8% (nacional)**
  num produto **importado** (16% = R$ 8,99). **Causa:** `familias.origem = 'nacional'`.
- [x] **Investigação:** lotes 53/55 (06/07) caíram no bug do map que dropava ORIGEM (`e7bb78ed`);
  o backfill de 14/07 só cobriu os lotes 61/63/64. Mas o **Oxford Natal (lote 72, 29/07) é
  pós-fix** e também estava nacional: a planilha não trazia a coluna, então a trava
  `verificarOrigemInviolavel` aprovou (crua e montada concordavam em `nacional`).
- [x] **Correção de dados (produção):** 9 famílias → `importado`, confirmadas pelo Diego. Oxford
  10m (`02989182`, lotes 48/53/55), Oxford 5m (`29891825`, lotes 52/56), Oxford Natal
  (`02710170`, lote 72), Helanca Light 10 Metros (`26705341`, lote 62), Helanca Light 3,00×1,80
  (`02670534`, lote 60), Helanquinha Forro Decoração 10m (`26705343`, lote 71). Verificado
  depois: **nenhuma família de Oxford/Helanca ficou `nacional`**. Imposto é calculado em tempo de
  leitura → vendas passadas corrigidas sozinhas.
- [x] **Auditoria dos demais candidatos:** o que restou `nacional` nos lotes 48–62 é toda a linha
  de fios e barbantes (Euroroma, Barroco MaxColor, Anne, Amigurumi, Encanto, Fio Náutico, Charme,
  Bainha, Remendo) — nacional de verdade. Os importados eram os tecidos.
- [x] **Fix estrutural (ADR-0107):** `ORIGEM` entra em `COLUNAS_OBRIGATORIAS` + nova
  `exigirOrigemExplicita` exige `NACIONAL`/`IMPORTADO` em toda linha PAI, abortando o lote com a
  lista dos códigos. Mais dois buracos fechados na revisão: `lerOrigemCrua` acha a coluna
  case-insensitive nos três pontos do caminho (header `Origem` passava em `validarColunas` e
  chegava `undefined` no map — o bug de 8% de volta), e `src/lib/validar-planilha.ts` (checagem
  do cabeçalho no cliente, antes do upload) ganhou `ORIGEM` com teste comparando-a à lista do
  backend. Suíte: 2653 verdes.
- [ ] **Deploy (`_shared/types.ts` mudou):** `supabase functions deploy ingest-lote` e
  `analisar-viabilidade` — são as duas únicas que alcançam `parser.ts`/`types.ts`
  (`analisar-viabilidade` via `_shared/analise/extrair-itens.ts`). Conferir versão pós-deploy.
- [x] **Planilhas no Storage corrigidas (2026-08-07):** as 9 planilhas dos lotes de tecido (48,
  52, 53, 55, 56, 60, 62, 71, 72) **não tinham a coluna ORIGEM** — nem a do lote 72, de 29/07,
  posterior ao fix. Ganharam `ORIGEM` com `IMPORTADO` na linha PAI. Isso importa além de não
  reverter a correção: o `ingest-lote` lê a planilha do **Storage**, então depois do deploy um
  reprocesso desses lotes abortaria por falta da coluna. Escritas com SheetJS (a mesma lib que o
  ingest usa para ler) preservando as duas abas e a ordem; verificado re-baixando do Storage e
  rodando `validarColunas` + `exigirOrigemExplicita` + `agruparPorPai` + `verificarOrigemInviolavel`
  contra os arquivos em produção (9/9, origem `importado`, valores originais e anomalias idênticos).
  Originais em `~/Desktop/backup-planilhas-origem-2026-08-07/`.
- [x] **Planilhas do operador (fonte):** os arquivos são export de uma query Oracle sobre
  `A_CADCITEM` (a própria planilha guarda a query na aba `SQL Statement`). Diego ajustou a query
  em 2026-08-07 — os próximos exports já saem com a coluna `ORIGEM`, então o deploy da trava não
  quebra o fluxo. Regra:
  `CASE WHEN i.dba_git_estado = 'EX' THEN 'IMPORTADO' ELSE 'NACIONAL' END`.
  **Validada contra os 6 pais corrigidos à mão** (`2989182`, `29891825`, `2710170`, `26705341`,
  `26705343`, `2670534`): os 6 saem `IMPORTADO`. Use esses 6 como caso de regressão se a regra
  mudar. Ressalva conhecida: `dba_git_estado` nulo cai em `NACIONAL` sem disparar a trava (a
  trava só pega coluna ausente ou valor inválido — um `NACIONAL` errado passa). Um
  `WHEN i.dba_git_estado IS NULL THEN 'REVISAR'` fecharia isso.
- [~] **Erro de dados no lote 71 — NÃO SERÁ CORRIGIDO (decisão do Diego, 2026-08-07).** O código
  `18760903` aparece 2× na planilha (como "Vermelho" e como "Rosa Pink"). O parser dedupe por
  CODIGO (ADR-0013) e descartou o Rosa Pink — por isso a família `26705343` tem 9 cores em vez de
  10. É comportamento conhecido e aceito, não um bug a caçar.
- [~] **Re-preço — NÃO SERÁ FEITO (decisão do Diego, 2026-08-07).** O gross-up das 9 famílias de
  tecido foi calculado com 8% e os anúncios seguem no ar com esse preço; corrigir a origem não
  recalcula preço publicado (ADR-0016). O markup real dessas famílias é menor que o do momento da
  publicação — é conhecido e aceito, **não reprocessar "para consertar"**. Fecha também a mesma
  pendência aberta em 2026-07-14, que ficou sem resposta desde então.

## Estoque › Movimentos — entradas não apareciam na lista — 2026-08-07

Origem: no card do protetor solar (`00000004`), a aba Movimentos mostrava só vendas — nem a entrada
inicial nem a reposição.

- [x] **Causa** — `fetchMovimentosEstoque` tem `limite = 20` e o componente nunca passava outro
  valor. O produto tem **56 movimentos**: 54 vendas (03/08→07/08) e 2 entradas (+20 em 01/08, +40 em
  05/08). As entradas estão nas posições 37 e 56 da ordem por data, então caíam fora da janela — e
  nada na tela dizia que a lista estava cortada. Não era decisão do ADR-0094: o 20 é do código.
- [x] **Fix** — página de 100 (busca `limite + 1` para detectar resto, sem `count` extra), rodapé
  "Mostrando os N movimentos mais recentes" e botão **Carregar mais** quando há mais. `QK` ganhou
  `movimentosEstoquePagina`; o prefixo `movimentosEstoque` segue valendo para a invalidação do
  `dialog-entrada` alcançar todas as páginas. TDD (RED → GREEN em
  `tests/components/movimentos-estoque.test.tsx`), 2615 testes verdes.
- [x] **Evolução (mesmo dia)** — "Carregar mais" virou paginação server-side com filtros de tipo,
  período e SKU (spec `2026-08-07-paginacao-movimentos-estoque-design.md`, plano
  `2026-08-07-paginacao-movimentos-estoque.md`). O total do rodapé é a trava permanente contra
  truncagem silenciosa; o default é "tudo, sem filtro de data" porque um default de 30 dias
  recriaria o defeito num produto parado. Sem migration: os índices já existiam. 2640 testes verdes.

## Publicados — "Unid. vendidas" menor que o Faturamento — 2026-08-07

Origem: o protetor solar (`00000004`) mostrava **38** unidades em Publicados e **59** no Faturamento.

- [x] **Causa** — o produto tem dois MLB: o próprio (`MLB4982690837`, 38 un. faturáveis) e o de
  catálogo (`MLB7343614472`, 21 un.), vinculados em `variacoes.catalog_listing_id`. `Publicados.tsx`
  chamava `calcularResumo` direto **sem** o 6º argumento (o mapa canônico), então as vendas do
  anúncio de catálogo ficavam presas num MLB que a tela não lista. Confirmado no banco: 59 un. `paid`
  + 1 `cancelled` somando os dois MLB. Dashboard, Financeiro e Detalhe de vendas já passavam o mapa.
- [x] **Fix** — a tela passou a consumir `useResumoVendas(janela, canalAtivo)` (que já monta o mapa),
  em vez de duplicar a montagem do resumo. Some o call site que podia divergir de novo, e a tela
  herda a guarda do ADR-0055 (sem default silencioso de alíquota em erro de configuração).
  TDD (RED → GREEN em `tests/pages/Publicados.test.tsx`), 2613 testes verdes.
- [ ] **Aberto (decisão do Diego)** — período default divergente entre menus: Dashboard e Faturamento
  abrem em "Mês atual"; Publicados e Financeiro abrem em "30 dias". Números batem quando a janela é a
  mesma, mas o default diferente faz duas telas mostrarem valores distintos ao abrir.

## Faturamento › Perguntas — resposta dada no ML não voltava para o app — 2026-08-06

Origem: Diego respondeu a pergunta 13635743825 direto no ML às 14:13 UTC e o PubliAI continuou
mostrando "Pendente". Diagnóstico contra o banco de produção (só SELECT): `ml_webhook_eventos` tem
**uma única** linha `/questions/13635743825` (recebida 14:03, processada 14:04 — a criação);
`ml_perguntas.atualizado_em` só virou `ANSWERED` às 14:30, ou seja pelo `backfill-faturamento`
(`30 * * * *`), não por webhook.

- [x] **Causa** — o ML notifica o tópico `questions` na criação **e** na resposta, com o mesmo
  `resource`. O dedup `(topic, resource)` do `ml-webhook` batia 23505 e `classificarDedupWebhook`
  devolvia `ignorar` → o job nunca era enfileirado. O mesmo vale para `claims`
  (`opened → in_mediation → closed`).
- [x] **Fix** — `classificarDedupWebhook` devolve `enfileirar` para `questions`/`claims` mesmo em
  duplicado real (worker idempotente; throttle de 200/janela cobre flood; alerta não duplica porque
  `novaNaoRespondida` exige pergunta desconhecida). `orders_v2`/`shipments` seguem ignorando.
  TDD (RED → GREEN em `reenfileirar-mensagens.test.ts`), 2590 testes verdes.
- [x] **Tela parada** — não existe sync "de 3 em 3 min": `usePerguntas` tinha `staleTime` 60s e
  **nenhum** `refetchInterval`, então a aba aberta só recarregava ao trocar de foco. Adicionado
  `refetchInterval: 60_000` na lista e no badge.
- [ ] **Validar em produção** — responder uma pergunta no ML e conferir `ml_perguntas.atualizado_em`
  mexendo em segundos (não na virada da hora).
## Dashboard › card de devoluções e rótulo do comparativo — 2026-08-06

Origem: Diego reportou dois números do Dashboard. Diagnóstico contra o banco de produção (8 claims
reais da AVIL, service_role, só leitura) e contra o painel nativo do ML.

- [x] **"+27% vs. anterior" no filtro Hoje não era erro de cálculo** — a janela anterior de 'hoje'
  é ontem 00:00→mesma hora (fix `6e77a491`), então às 11h37 comparava com ~R$ 912 de ontem, não
  com os R$ 2.962,70 do dia fechado. O rótulo é que induzia ao erro: `rotuloAnterior(periodo)` em
  `src/lib/metricas.ts` faz o card de Hoje dizer **"vs. ontem até agora"** (Dashboard e
  Financeiro; o PDF do Dashboard herda o texto). Matemática inalterada.
- [x] **"1 devolução aberta" (Precisa de atenção) contava devolução já finalizada** — o critério
  era só `acoes_pendentes.length > 0`, e o ML segue devolvendo `available_actions` ("return review
  ok", com prazo) em claim **fechado e reembolsado** (claim 5550524900). Agora exige
  `status === 'opened'`, o mesmo da pill da aba Devoluções.
- [x] **"1 devolução · R$ 56,16" (Mês atual) atribuía o estorno ao mês errado** — o filtro usava
  `aberto_em`. Nova coluna `ml_devolucoes.fechado_em` (`claim.resolution.date_created`, migration
  `20260806151323`, backfill pelo `raw`), que é o **mesmo instante** do estorno no MP — conferido
  contra `payments[].date_last_modified` em 5 devoluções. Mês atual passa a mostrar
  **2 devoluções · R$ 126,66** (claims 5552400113 e 5553795965, ambos reembolsados em 03/08).
  Critério de "concluída" inalterado (`returns` + `refunded`). ADR-0106.
- [x] Regras viraram funções puras em `src/lib/devolucoes.ts` (`devolucoesAbertas`,
  `devolucoesConcluidasNoPeriodo`), testadas com os 8 claims reais como fixture.
- [x] Migration aplicada em produção e edge functions deployadas (`reconciliar-faturamento`,
  `backfill-faturamento`, `sync-devolucao` — todas usam `mapearDevolucao`).
- Docs: `docs/decisions/0106-devolucao-conta-no-periodo-do-estorno.md`,
  `docs/reference/glossario.md` ("Devolução (concluída)"), `docs/reference/modelo-de-dados.md`
  (`ml_devolucoes.fechado_em`), `obsidian-vault/05-Bugs/Problemas Resolvidos.md`.

## Faturamento › Perguntas — atalho certo e nome de quem perguntou — 2026-08-06

Origem: Diego apontou dois problemas na aba Perguntas. Diagnóstico confirmado contra a API do ML
(token de produção da AVILBV, só GET): o ícone abria o anúncio, e o comprador vinha vazio porque a
v4 devolve `from: { id }` **sem `nickname`** — `raw->'from'` no banco é `{"id": …}` em 100% das
linhas. O ML só entrega o apelido anonimizado (`OLCA4176283`), não o nome civil.

- [x] **Atalho** — aponta para a caixa de perguntas do vendedor
  (`URL_PERGUNTAS_ML`, `www.mercadolivre.com.br/perguntas/vendedor`). A API não expõe permalink
  por pergunta, então não há deep link por `question_id`.
- [x] **Nick do comprador** — `upsertPergunta` recebe o token e resolve o nome via
  `GET /users/{id}` (`buscarNickname`, cache por invocação); os 4 callers passam o token.
- [x] **`preservarComprador`** — rede defensiva: payload sem `from` não apaga mais o
  `comprador_id`/`comprador_nick` já salvo.
- [x] Linhas antigas só ganham o nick no próximo `reconciliar-faturamento`/backfill (o upsert
  repopula), não há migration de backfill.
- [x] **Notificação do Telegram/sino** — `montarMensagemNovaPergunta` também apontava para o
  anúncio; passa a linkar a mesma caixa de perguntas. `NovaPerguntaAlerta.item_id` virou órfão e
  saiu (junto com o campo no caller `sync-pergunta`).
- [x] **Nome civil em vez do apelido** — Diego pediu o mesmo formato da aba Vendas ("Carla
  Fabiana"). `GET /users/{id}` devolve `first_name`/`last_name` **null** para o vendedor; o nome só
  existe em pedido. `buscarPerguntas` cruza `comprador_id` com `ml_vendas.comprador_nome` (1 query
  extra, sem chamada ao ML) e a UI reusa `nomeCurtoComprador`. Quem nunca comprou continua no
  apelido — o ML não tem outro dado. Hoje: 11 de 69 perguntas têm venda associada.

## Catálogo do ML — item plano destravado e os 3 anúncios da DSA vinculados — 2026-08-06

Origem: Diego perguntou por que o produto do lote 10 (Principia) não se associou ao catálogo mesmo
tendo concorrentes. Diagnóstico: **32 de 32** variações de item plano estavam `pendente` desde
20/07 — a rota Legacy lia a elegibilidade só de `variations[]`, vazio nesse formato.

- [x] **`indexarElegibilidadeAnuncio`** — item plano (sem `variations[]`) passa a ser lido pela
  raiz do JSON e indexado pelo item id; `indexarEligibility` segue intacta.
- [x] **`montarBodyOptinVariacao`** — opt-in sem `variation_id` quando o id não é numérico
  (`Number('MLB…')` seria `NaN`).
- [x] **`podeTentarOptin`** — `CATALOG_PRODUCT_ID_NULL` e `PRODUCT_INACTIVE` também aceitam o POST
  (medido com token real); `FAMILY_DIFF`/`NOT_ELIGIBLE` seguem bloqueados.
- [x] **`ALREADY_OPTED_IN` → `ja_vinculado`** — persiste `vinculado` com o listing id de
  `item_relations`, em vez de backoff + alerta de no-match falso.
- [x] **Trava anti-kit compara com o nosso item** — Duo Pack 2un × ficha Kit/2un é equivalente;
  item sem `UNITS_PER_PACK` (fitas/linhas) segue reprovando qualquer ficha-kit.
- [x] **`catalog_erro` guarda a causa real** do 400 (`cause[]`), não o "Validation error" genérico.
- [x] Os 3 anúncios da DSA vinculados: Principia → `MLB7343600804` (ativo, competindo);
  Eucerin Sun → `MLB7343614472`; Aquaphor → `MLB7343603036` (feito pelo próprio worker).
- [x] **Trava de domínio** — `fichaEquivalente` reprova ficha de domínio diferente do anúncio
  (`dominio_<ficha>_vs_<item>`), a raiz do incidente do Aquaphor. Validada contra 5 vinculações
  reais (domínio idêntico em todas): sem regressão nas 211 existentes.
- [x] **Aquaphor republicado** — o ML finalizou `MLB7330859238` por PI (sem contestação possível).
  Republicado pelo fluxo do app como `MLB5004717379`, nos moldes originais (categoria `MLB1262`,
  título completo, R$ 54,90, 12 un, Clássico, `me2`, sem catálogo). O worker de catálogo rodou e
  não vinculou — a trava de domínio segurou.
- [x] **Cadastro do Aquaphor corrigido para bater com a NF-e** — a nota descreve "EUCERIN DUO-PACK
  AQUAPHOR 18G" e o anúncio dizia "10 ml 2 un" (erro vindo da planilha, propagado a título,
  descrições e `UNIT_VOLUME`). O produto é 18 g = 2 bisnagas de 9 g. Corrigidos `nome_pai`,
  `titulo_ml`, `descricao_ml`/`descricao_pai` e atributos (`UNIT_WEIGHT = 9 g` + `UNITS_PER_PACK
  = 2`, `SALE_FORMAT = Kit`), com os campos marcados como editados pelo operador. Republicado como
  `MLB7345071684`. Não há planilha a corrigir: o lote é `origem: manual` (`planilha_path` nulo),
  cadastrado pela tela — a fonte do "10 ml" era o próprio cadastro, e uma varredura de todos os
  campos de `familias`/`variacoes` confirmou que não sobrou resíduo de "10 ml"/"20 ml".
- [x] **Descrição saía "tudo junto" no ML** — o gerador separa as seções só pelo emoji do cabeçalho
  e `sanitizarDescricaoML` remove esses emojis antes do envio (o ML os rejeita), deixando o texto
  sem separador nenhum (medido: 31 quebras de linha, zero linhas em branco). A sanitização passa a
  reconstruir a linha em branco em volta de cada cabeçalho, de forma idempotente — os anúncios
  antigos se corrigem no próximo UPDATE, sem migração. ADR-0103 (revisão 2026-08-06). Deploy:
  `publish-familia-ml`, `update-familia-ml`, `publicar-split-ml`, `publicar-anuncio`,
  `reconciliar-convergencia-up`.
- [ ] **Pendente com o ML (ação humana):** apresentar a NF-e em `MLB7345071684` e `MLB7343614472`
  (`pending_documentation` — exigência de marca recorrente da Eucerin nesta conta, registrada em
  `ml_moderacao` desde 02/08, antes de qualquer mexida). Agora a nota corresponde ao anúncio.
- [x] **Fotos do Aquaphor restauradas** em `MLB7345071684` (7 no total, na ordem original). **Uma
  das 6 do anúncio antigo ficou de fora de propósito** — o card "Informações do produto"
  (`985349-MLB115653216497_082026`) afirma *"10 ml cada / Conteúdo total: 20 ml"*, contradizendo a
  NF-e (18 g) e o cadastro corrigido; recolocá-la reintroduziria a divergência que derrubou o
  anúncio. Precisa ser refeita com "9 g cada / 18 g no total" antes de voltar.
- [ ] **29 itens planos restantes** (org AVIL) seguem `pendente`: o QStash já desistiu deles;
  precisam de re-enfileiramento de `vincular-catalogo` — não executado sem ordem do operador.

## Produto sem variação — publicação destravada e cadastro explicado — 2026-08-06

Origem: Diego cadastrou um produto simples (Principia Gel de Limpeza 350g) com foto só na Capa
e a Revisão o marcou "Incompleta · sem foto", travando a publicação.

- [x] **`familiaExigeFotoPorVariacao()`** (`src/lib/publicavel.ts`) — produto simples (CREATE,
  `tipoAviamento='outro'`, 1 variação incluída) **com capa** não exige mais foto por variação. Era
  falso-positivo: o backend lidera a galeria de toda variação com a capa (`capa ?? propria`,
  `_shared/ml/publicar.ts`) e sobe a capa ao ML no pre-publish (`_shared/anuncios/pre-subir-fotos.ts`),
  então o anúncio já sairia com imagem. A condição compartilhada com `familiaExigeCor` saiu para
  `familiaProdutoSimples()`. Sem capa, com 2+ cores ou no UPDATE nada muda.
- [x] **Ligado na UI** (`familia-row.tsx`, `familia-expanded.tsx`) — mesma regra no selo de bloqueio
  e na crítica da linha, para badge e publicabilidade não divergirem.
- [x] **Teste através do mapeador real** (`src/lib/__tests__/queries.test.ts`) — a cadeia
  row → `familiaFromRow` → `familiaPublicavel`, não só fixture montado à mão: o fix é client-side e só
  vale na tela se `capa_storage_path` chegar mapeado. Verificado que falha sem o fix.
- [x] **Dica no cadastro** (`dialog-cadastro-produto.tsx`) — "Produto sem variação? Deixe só a
  Variação 1 e o campo Cor / nome em branco". Some ao adicionar a 2ª variação. Validada em runtime
  (Playwright, screenshot nos dois estados).

## Estoque — layout de operação (nível SaaS) — 2026-08-05

- [x] **Faixa de KPIs** (`src/lib/produtos-saldo-resumo.ts`, `src/components/estoque/resumo-estoque.tsx`) —
  SKUs cadastrados, unidades em estoque, SKUs sem estoque e valor em estoque. Os agregados saem da lista
  COMPLETA (não do resultado da busca). `valorEmEstoque` soma só SKUs com custo e expõe `skusSemCusto`,
  porque `variacoes.custo` é nullable (ADR-0094 D-9) e a soma sozinha subnotificaria em silêncio — a UI
  avisa "N SKUs sem custo — fora do total".
- [x] **Lista com colunas alinhadas** (`produto-card.tsx`) — cabeçalho PRODUTO / SKUS / SALDO / SITUAÇÃO /
  CANAIS + linhas usando o MESMO template de CSS Grid (`GRID_LINHA_PRODUTO`), com tracks numéricas de
  largura fixa e `tabular-nums`. **Continua sem nenhuma `<table>`**: o alinhamento vem de grid com tracks
  fixos, que não dimensiona por conteúdo — a guarda de `document.querySelectorAll('table').length === 0`
  segue valendo.
- [x] **Painel expandido vira lista tabulada** (`variacao-estoque-linha.tsx`, substitui
  `variacao-estoque-card.tsx`) — SKU / GTIN / peso e dimensões / custo / preço / saldo em colunas
  alinhadas, no lugar do bloco de 5 linhas de texto corrido. Abaixo de `lg` as colunas do meio somem e
  custo/preço voltam como linha secundária.
- [x] **Descrição de marketing removida do painel** — `descricao_pai` são 3 linhas de copy do anúncio por
  produto, não informação de estoque; era o maior bloco da tela e não respondia nenhuma pergunta feita
  aqui. Teste de regressão em `produto-card.test.tsx`.
- [x] **Toolbar re-hierarquizada** (`barra-filtros-estoque.tsx`) — filtro virou segmented control com
  borda (excludente, estado visível) e ordenação virou `Select` rotulado "Ordenar por": eram seis botões
  idênticos em fila, sem como distinguir filtro de ordenação. Busca com ícone e contador de resultados.
- [x] **Bug de alinhamento achado só no Playwright ao vivo** — a célula vazia da coluna da foto usava
  `sr-only`, que é `position:absolute` e portanto NÃO ocupa track de grid: o cabeçalho inteiro deslizava
  uma coluna à esquerda. Contar células não pegava; teste novo olha a classe.
- [x] **Validado ao vivo** — 1440/768/375 com produto expandido, temas claro e escuro,
  `scrollWidth <= clientWidth` em todas as larguras (sem overflow horizontal).

## Publicados — busca deixava linhas fantasmas na tabela — 2026-08-05

- [x] **Key da linha passa a ser `mlItemId`** (`src/pages/Publicados.tsx`) — anúncios split
  (ADR-0048) herdam o `familiaId` da família representativa, então vários anúncios usavam a
  mesma `key`. Ao buscar/filtrar, o React não removia as linhas antigas: a tabela mostrava
  itens que não casavam com o termo enquanto o rodapé já contava o total correto.
- [x] **Estado de expansão por anúncio** — `expand:publicados:${mlItemId}` (antes compartilhado
  entre anúncios split).
- [x] **`fetchPublicados` não repete `mlItemId`** (`src/lib/queries.ts`) + teste
  (`src/lib/__tests__/publicados-key-unica.test.ts`).

## Título e descrição — specs externas avaliadas + 3 defeitos corrigidos — 2026-08-04

Duas "especificações mestre" externas (título e descrição) foram avaliadas contra o pipeline atual.
O sistema já implementava ~80-85% das duas; o valor saiu dos defeitos que a avaliação revelou.
Análise completa em `docs/spikes/titulo-spec-marketplace-gap.md`.

- [x] **Censo do catálogo de títulos** (`scripts/censo-titulo/`) — rejeitou por **inexistência**
  quase toda a spec de título: `2x10ml` em 1 família de 305, `SORT`/`PAD`/`PC` em zero, gramatura
  já canônica na fonte.
- [x] **ADR-0100 — `termos_com_risco`** (PR #75): 11º campo, irmão de `titulo_slots` e nunca dentro
  dele, para o modelo depositar termo não comprovado em vez de contrabandeá-lo num slot. O censo
  de descartes (`scripts/censo-descartes/`) mostrou que dispara em 17/304 famílias (5,6%).
- [x] **ADR-0101 — marca no título** (PR #76): o mapa razão social→marca sobrescrevia a marca da IA
  sem condição, e o validador derrubava a substituta por falta de ancoragem. **52 de 304 famílias
  ficavam sem marca** (EUROROMA→Ecofibra, Progresso→Detallia, Cléa→Círculo, Bandeirantes→Bandeirante).
- [x] **ADR-0102 — descrição sem promessa logística** (PR #77): o template injetava "pronta entrega
  com envio rápido e seguro para todo o Brasil" em **298 de 304 descrições, 292 publicadas**, sem
  respaldo na fonte — enquanto o T3 já bane as mesmas palavras no título. Também trocou o
  `CONTEÚDO DA EMBALAGEM` cravado (222 famílias, 25 sem cor nenhuma, 6 contradizendo o próprio
  título) por derivação do dado, e limitou a abertura a uma frase de contexto.
- [x] **ADR-0103 — cabeçalho `BENEFÍCIOS`** (PR #78): `✅` era tratado como bullet e virava
  `- BENEFÍCIOS` no anúncio, enquanto os outros sete cabeçalhos saíam limpos.
- [x] Deploy conferido pós-merge (11 edge functions, versões verificadas uma a uma).

**Pendências registradas:**

- [ ] **292 anúncios publicados ainda prometem frete.** O ADR-0102 só afeta geração nova
  (`sincronizarDescricao` reenvia a `descricao_ml` já gravada sem re-executar IA). Limpar exige
  reescrever `familias.descricao_ml` por migration (ADR-0043), com dry-run e **excluindo as 6
  famílias com `descricao_editada_pelo_operador`**.
- [ ] Diferidos da spec de descrição, com gatilho "cosmético/higiene virar volume": lista de usos
  que exigem confirmação (bebê, pós-tatuagem, ferida, gestante), regras de cosmético e
  `Linha` ≠ `Modelo`.

## Preparação para a migração automática do ML para User Products — 2026-08-04 (ADR-0104)

O Mercado Livre está migrando categorias para User Products de forma **automática e gradual**, em
anúncios já publicados. Duas lacunas foram fechadas antes de a migração alcançar as famílias
multi-cor:

- [x] **`somente estoque` pausava anúncio sozinho (bug latente, já existia).** No caminho UP a
  composição vinha da planilha: cor ausente virava "retirada" e o item era **pausado no ML** numa
  reposição pura. O Legacy nunca fez isso (mapeia sobre as variações vivas do `GET`). Contradizia o
  texto do ADR-0089. Guard dentro de `atualizarComposicao` — composição agora é exclusiva de
  "Atualizar tudo".
- [x] **UPDATE de família migrada pelo ML.** O roteamento UP lia estado **local**, que uma família
  migrada nunca teve → caía no Legacy → erro 400 pedindo reposição manual no painel, por família, em
  cada lote. Agora o conector devolve `MIGRADO_PARA_UP` tipado (detecção por `GET` ao vivo, zero
  chamada extra) e o worker adota os itens irmãos por SKU (tudo-ou-nada, só leitura remota) antes de
  entregar à saga UP.
- [x] Migration `20260805020213_adr104_adotar_familia_migrada_up.sql` aplicada e validada
  (`db:check` alinhado, `supabase db lint` sem erros de schema).
- [x] **Validado na realidade — e a hipótese estava errada.** Ver a seção do ADR-0105 abaixo.
- [ ] **Limite conhecido (ADR-0104 §2):** irmãos fora da planilha do lote ficam sem linha filha —
  vendas deles não são atribuídas à família até um lote futuro incluir a cor.

## Família DISSOLVIDA pelo ML em User Products — 2026-08-06 (ADR-0105)

A primeira migração real chegou (lote #45, `PAI 02186551`) e a forma **não** é a que o ADR-0104
supôs: o ML **não converte** o item — ele **fecha** o anúncio Legacy (`status: closed`,
`sub_status: []`, sem `family_id`/`family_name`/`parent_item_id`) e cria N itens novos sob um
`family_id`, **todos sem `seller_custom_field`**. Consequência: o guard de anúncio morto disparava
primeiro (o operador via "republique o produto") e, mesmo se não disparasse, a busca por SKU acharia
0 de 17.

- [x] **Gatilho novo:** `status` terminal **sem** `sub_status` de remoção vira `MIGRADO_PARA_UP`
  tipado, carregando título, categoria e o mapa `SKU → COR` das variações do item morto. `deleted`/
  `forbidden` continuam falhando na hora, sem gastar busca.
- [x] **Descoberta** (`_shared/ml/descobrir-familia-up.ts`): localiza a família por `?q=<título>`
  (fail-closed: um único `family_id` entre candidatos do mesmo seller/categoria, sem `variations`) e
  a enumera pela fonte autoritativa `?family_id=`.
- [x] **Casamento por `COLOR.value_name`**, com os dois lados vindo de dados autorais do ML.
  `variacoes.cor` do nosso banco **nunca** entra (ADR-0105 §2).
- [x] **Adoção reusada inteira** do ADR-0104 — tudo-ou-nada, validações, RPC. Só a porta
  `buscarPorSku` muda (resolve pelo mapa de cor em vez de bater na API).
- [x] **RPC re-aponta todas as famílias do `codigo_pai`** que apontavam para o item dissolvido
  (`p_ml_item_id_antigo`) — há uma `familias` por lote; a irmã ficava com `ml_item_id` morto e
  `ml_variation_id` órfão.
- [x] **`atualizarEstoque` (push rápido) ganhou o guard de anúncio morto** — escrevia em item
  `closed` e devolvia o erro cru do ML.
- [ ] **Limite conhecido (ADR-0105 §6):** o push rápido de estoque **não** re-vincula sozinho —
  exige uma passada de UPDATE na família migrada.
- [x] **Aplicado em produção 2026-08-06** (main `08dbb9e4`): migration `20260806003628` via
  `db push` (`db:check` alinhado, RPC só com a assinatura de 8 args) e `functions deploy` das **15**
  funções do blast radius calculado por `deno info` — todas +1 de versão, `verify_jwt` preservado.
- [x] **Validado ponta a ponta no lote #45.** O UPDATE re-vinculou sozinho: raiz partição 0 com
  `item_externo_id = MLB7210143182`, `skus_esperados` de 17, 17 filhos `ativo` sob o único
  `family_id 2244380420892433`, todos com `user_product_id`, nenhum `retirado`;
  `ml_variation_id` nulado nas **duas** famílias do `codigo_pai` e `ml_item_id` re-apontado em ambas
  (§5 confirmado na prática). Estoque conferido 1:1 contra a API do ML nos 17 SKUs — bate em todos.
  As duas cores com estoque 0 aparecem `paused` **no ML**: é o ML que pausa item sem estoque, não o
  PubliAI (coerente com ADR-0089).
- [x] **Achado pós-produção (ADR-0105 §5.1):** o link "ver anúncio" continuava abrindo o anúncio
  finalizado — todo link de família na UI sai de `familias.ml_permalink`/`anuncios_externos.permalink`,
  e a adoção re-apontava só o `ml_item_id`. A RPC passa a derivar o permalink do filho representante
  e propagá-lo no mesmo escopo; migration `20260806010922` inclui backfill genérico e idempotente do
  que já havia sido adotado. Links de Faturamento não eram afetados (usam o `item_id` do evento).
- [x] **Split (ADR-0048) não re-vincula — e agora diz isso.** O conector é compartilhado, então
  `publicar-split-ml` também recebia o sinal `MIGRADO_PARA_UP`, mas não sabe adotar: o operador leria
  "verificando se foi migrado", verificação que aquele caminho não faz. `mensagemDissolvidoSemRevinculo`
  devolve a mensagem original do guard + o motivo. Em produção: 3 famílias divididas (`02841240`,
  `02835002`, `02841290`).
- [ ] **Quando a 1ª família DIVIDIDA for dissolvida pelo ML:** apurar a forma real (uma família UP por
  partição? uma só? parcial?) e decidir em ADR próprio. Não construir por suposição.
- [ ] **Limite observado:** a 18ª cor da família no ML (`Rosa Bebê - 510`, `MLB7218244860`) segue sem
  linha filha — está fora da planilha do lote. É o limite conhecido do ADR-0104 §2, não um defeito.

## Produto gravado na organização errada — corrigido 2026-08-04

- [x] **Causa raiz confirmada:** não foi vazamento de leitura por RLS. Uma gravação SQL
  administrativa direta criou na DSA uma segunda árvore de lote/família/variações baseada em um
  produto da Avil, contornando o fluxo oficial e o ledger de estoque.
- [x] **Remediação:** a árvore indevida da DSA foi removida com assertions transacionais e
  readback cruzado; a família legítima da Avil foi preservada.
- [x] **Prevenção:** migration `20260804113000_guard_manual_product_direct_writes.sql` torna
  `lotes.org_id`/`origem` imutáveis, valida a cadeia de `org_id`, rejeita cadastro manual sem
  chave/código de oito dígitos e bloqueia estoque direto fora das RPCs auditadas.
- [x] **Menor privilégio:** as RPCs de estoque pertencem a `estoque_rpc_executor` (`NOLOGIN`, sem
  `BYPASSRLS`), com políticas RLS explícitas; `postgres` não pode assumir nem herdar o papel.
- [x] **Credencial administrativa:** PAT usado na intervenção foi rotacionado, substituído nas
  três configurações locais identificadas, validado pela CLI e revogado no painel.
- [x] **Validação:** regressão transacional, `supabase db lint`, migration remota e CI do PR #70
  passaram.

## Viabilidade usava preço padrão em vez da promoção vigente no ML (2026-08-04)

- [x] Reproduzido com GTIN `4005800220012`: API interna mostrava R$ 65,61 enquanto a página do
  Mercado Livre vendia por R$ 45,19.
- [x] Causa raiz: `_shared/ml/concorrencia.ts` consumia o campo legado `price` de
  `/products/{product_id}/items`, que pode representar o preço padrão sem a promoção ativa.
- [x] Cada oferta passa a consultar `/items/{item_id}/sale_price?context=channel_marketplace`,
  preservando o preço anterior como fallback; cache de GTIN versionado para `v2`.
- [x] Regressão TDD cobre R$ 65,61 → R$ 45,19 e fallback. 28 testes focados verdes;
  `deno check`, `deno lint` e `git diff --check` limpos.

## Enfileiramento em loop deixando famílias órfãs — 3 correções (2026-08-03)

Um incidente, três lugares com o mesmo padrão: marcar N registros no banco e **depois**
enfileirar um por um em loop. Quando o loop morre no meio, os registros já marcados ficam
órfãos — sem mensagem no QStash, invisíveis para o operador e fora do alcance do "Reenviar".

- [x] **Lote #44 — `ingest-lote` (PR #64).** Planilha de 3.299 linhas: 1 publish por família
  pendente em loop; falhou na 1ª chamada com `"Rate limit exceeded for trace ... Retry after
  42349ms"`, derrubando o lote (18 famílias presas em `pendente`). Fix: `enfileirarFamilias`
  publica em blocos (`batchJSON`, até 100). **Causa raiz não confirmada** — a doc da Upstash diz
  que `publish`/`batch` NÃO têm rate limit por segundo, e a mensagem não bate com nenhuma das
  classes de erro tipadas do SDK. O batch é melhor de todo modo (menos HTTP, menos superfície).
- [x] **Upsert de fila repetido (PR #65).** `garantirFilaSerial`/`garantirFilaSerialCanal` faziam
  `queue().upsert()` 1x por item dentro dos loops, sempre com a MESMA fila — até 1000 chamadas
  numa execução do `reconciliar-estoque`. `queues` **é** endpoint com rate limit por segundo
  (ao contrário de publish/batch), então era o candidato real. Fix: `memoizar-por-chave.ts`.
- [x] **Lote #45 — `publicar-familias` (PR #66).** O que de fato falhou em produção: 126 famílias
  marcadas `publicando` num UPDATE em massa, depois enfileiradas uma a uma; o loop morreu com 68
  feitas e **58 presas em `publicando` sem mensagem**. Invisíveis (não são `erro`) e fora do
  alcance do `reprocessar-familia` (que filtra `status='erro'`) — a tela ficou parada em 38/135
  sem ação possível pela UI. Recuperado com reenfileiramento manual em batch via API do QStash
  (117 publicadas). Fix: `enfileirarPublicacoes` (1 batch por dono/alvo na mesma fila serial) +
  órfãs viram `erro` recuperável quando o batch falha.
- [x] **Achado de método (revisão do Opus 5 no PR #64):** a 1ª versão do fix revertia TODAS as
  famílias para `erro` quando o batch falhava — inclusive as de um bloco anterior que já tinham
  mensagem viva, podendo pisar em família que o worker já movera para `processando`/`pronto`.
  Corrigido antes do merge: o erro carrega `enfileirados` (prefixo já publicado) e só quem
  ficou sem mensagem é revertido, com guard de status.
- [x] **Achado de processo:** o `deno lint` do CI (`require-await`) pegou o que o `deno check`
  local não pegava. Passei a rodar os 5 passos do CI localmente antes do push.
- Docs: `docs/reference/edge-functions.md` (`queue.ts`).
- **Pendente:** 9 famílias do #45 com erro de negócio do ML (`variations is not modifiable`,
  `cannot change attribute combinations if the variation has bids`) — ADR-0062, sem relação com
  enfileiramento; precisa decisão de produto sobre rename de cor em variação com vendas.

## Botão "Sincronizar" dando 546 — a correção anterior era inerte (2026-08-03)

- [x] **A correção de 03/08 (`a3a4f2c`) não chegava a alterar o botão.** Ela mudou o *default* de
  `sincronizarFaturamento(dias = 30 → 7)`, mas o único chamador —
  `src/components/faturamento/aba-vendas.tsx:247` — passa `30` explícito desde 26/07 (`42a702a`).
  O botão continuava pedindo 30 dias e o 546 voltaria no clique seguinte. Fix: chamar sem
  argumento, deixando a janela com uma fonte só (o default, hoje 7, igual ao schedule do QStash).
- [x] **Devoluções não dependem da janela.** `buscarClaimsSeller` varre todos os claims
  `opened`+`closed` do vendedor sem filtro de data — reduzir `dias` não perde nenhuma devolução no
  backfill. Quem cobre o dinheiro (`ml_vendas.estorno`/`liquido`) de devolução em venda antiga é
  o `reconciliar-faturamento` (claims sem limite de janela + resync de estorno via MP, de hora em
  hora, com guarda de orçamento) e o `sync-devolucao` em tempo real, que re-busca o pedido e chama
  `upsertVenda` em qualquer idade. O Passo 2 do backfill grava o claim mas **não** recalcula a
  venda — não era ele que sustentava os 30 dias.
- [x] **O problema de fundo não é a janela.** O custo do backfill cresce sem depender de `dias`:
  os Passos 1 e 2 releem o histórico inteiro do vendedor a cada execução (`buscarPerguntasSeller`
  e `buscarClaimsSeller`, sem filtro de data, teto de 2000 cada, + 1 GET de return por claim) —
  cada devolução nova encarece TODA execução futura, para sempre. O Passo 4 é capado
  (`listarPacksDeVendas`, `limite = 200`). Medido no schedule (`dias:7`, todas as orgs,
  só ciclos sem retry): mediana **70s em 27/07 → 81s em 03/08** (~+1,6s/dia), com 5 falhas no
  período (546 em 30/07, 31/07, 02/08; 504 em 30/07; 520 em 02/08), todas salvas pelo retry do
  QStash. Encolher a janela só compra tempo. **Pendente (não feito aqui):** portar `ORCAMENTO_MS`
  + retomabilidade do `reconciliar-faturamento` para o `backfill-faturamento`.
- Docs: `docs/reference/edge-functions.md` (medição + nota de que o backfill não tem a guarda de
  orçamento que o `reconciliar-faturamento` ganhou em 31/07). Sem mudança em
  `supabase/functions/**` — nenhum deploy de edge necessário.

## Redesenho da tela de Estoque — concluído 2026-08-02

- [x] **Causa raiz:** listagem, cadastro e o card de movimentos/variações usavam `<table>`
  aninhada dentro de `<table>`; em telas estreitas isso forçava scroll horizontal na página
  inteira (bug visível tanto em Estoque quanto em Publicados, que compartilha o componente
  `MovimentosEstoque`).
- [x] **Fix:** listagem de Estoque virou cards; movimentos e variações saíram de dentro de
  `<table>`; cadastro virou cards por variação com upload de foto já na etapa 1. 11 tasks de
  implementação (TDD, review em 2 estágios) + esta Task 12 de fechamento. Spec completa em
  `docs/superpowers/specs/2026-08-01-estoque-redesign-design.md`; plano e reports por task em
  `.superpowers/sdd/2026-08-01-estoque-redesign/`.
- [x] **Suíte automatizada:** `pnpm lint` (0 erros, 11 warnings pré-existentes de
  `react-refresh/only-export-components`, nenhum novo) e `pnpm test` (287 arquivos, 2355 testes,
  0 skip) verdes.
- [x] **QA visual — concluído via `playwright-cli` contra conta de validação.** Depois de duas
  tentativas frustradas de anexar via CDP no Chrome pessoal do Diego, ele criou uma conta de
  validação (`VALIDATION_EMAIL`/`VALIDATION_PASSWORD` em `.env.local`) e o `playwright-cli`
  logou sozinho, sem depender do Chrome de ninguém — sessão só leitura, nenhuma publicação,
  exclusão ou edição de dado real. 10 screenshots reais (5 cenários × 1440px/768px), todos com
  `document.documentElement.scrollWidth <= window.innerWidth` **confirmado**:
  - Estoque colapsado: 1440 → `1440 vs 1440`; 768 → `768 vs 768`.
  - Estoque expandido, aba Variações: 1440 → `1440 vs 1440`; 768 → `768 vs 768`.
  - Estoque expandido, aba Movimentos: 1440 → `1440 vs 1440`; 768 → `768 vs 768`.
  - Publicados, linha expandida (`MovimentosEstoque` compartilhado): 1440 → `1440 vs 1440`; 768 →
    `768 vs 768`.
  - Diálogo de cadastro com 3 variações preenchidas: 1440 → `1440 vs 1440`; 768 → `768 vs 768`
    (checagem repetida no `[role=dialog]` isoladamente: `768 vs 768` nos dois viewports).
  10/10 checagens passaram — o bug de scroll horizontal por tabela aninhada está morto em
  Estoque e em Publicados, larga e estreita. O diálogo de cadastro coube nos dois viewports sem
  corte visível nos prints, então `src/components/estoque/dialog-cadastro-produto.tsx` não
  precisou de ajuste de largura.
- [x] **`docs/reference/` e `obsidian-vault/`:** conferidos, sem necessidade de alteração —
  entrega 100% frontend, sem mudança de edge function, modelo de dados ou decisão arquitetural.
- [x] **Limitação conhecida:** a foto escolhida no cadastro NÃO participa do enriquecimento por
  IA nesta entrega (decisão §8.2 da spec) — a edge enfileira o processamento antes do upload
  terminar. O operador que depende da cor por Vision resolve na Revisão, como já acontece hoje.
- [x] **Segunda revisão independente (`code-review-fable5`, antes do merge com main), 4 achados de
  risco real corrigidos e re-revisados individualmente antes do merge:** parsing de milhar
  pt-BR em campo monetário (`"1.234"` virava `1,234` — preço/custo 1000x menor em silêncio;
  parser único `parseNumeroPtBr` em `src/lib/formato.ts`, reusado no cadastro e na entrada de
  mercadoria — mesmo bug segue em aberto em `variacao-card.tsx`, fora do escopo deste branch);
  `chaveCadastro` preservada quando o resultado do submit é ambíguo (falha de rede — antes
  regenerava ao fechar o diálogo, risco de duplicar produto no retry); casamento posicional
  foto↔variação travado quando a contagem diverge (antes descartava a foto em silêncio); saldo
  negativo recusado, `aria-pressed` nos filtros, flash de lista vazia de 1 frame eliminado, e
  teste cobrindo a 2ª `invalidateQueries` "OBRIGATÓRIA" do lote de fotos. `tsc -b --noEmit`
  também rodado à parte — achou e corrigiu 1 erro de tipo que `pnpm test`/`pnpm lint` não
  pegam (Vitest só transpila, não type-checa).

## Exclusão deixava movimentos de estoque órfãos no banco — corrigido 2026-08-01

- [x] **Causa raiz:** `estoque_movimentos` não tem FK para `variacoes` (de propósito — uma venda
  de SKU inexistente precisa ser gravável como `venda_sku_nao_encontrado`). Logo o cascade da
  exclusão de família nunca alcançou o ledger: excluir produto ou lote deixava os movimentos para
  trás. Auditoria da DSA em 2026-08-01: **5 movimentos órfãos**, 3 deles de 29/07.
- [x] RPC `limpar_movimentos_orfaos(p_org)` (`security definer`, só `service_role`): apaga os
  movimentos da org cujo `codigo` não existe em nenhuma variação viva. **Anti-join**, não "os
  códigos recém-apagados" — `excluir-lote` preserva famílias publicadas (ADR-0019 D-1) e o mesmo
  `codigo_pai` tem várias famílias após ciclos de UPDATE.
- [x] Chamada em `excluir-lote` e `remover-publicado`, **depois** do delete commitar (antes, o
  cascade ainda não rodou e o conjunto sairia vazio). Modo republicar não varre.
- [x] **Achado da revisão:** o anti-join sozinho apagava o tombstone `cancelamento_sem_baixa` —
  guarda funcional do D-19, lida por `baixar_estoque` para recusar baixa de pedido cancelado.
  Perdê-la abriria baixa silenciosa num pedido cancelado após reimportar o mesmo CODIGO.
  Migration `20260801092323` exclui os 4 motivos que nascem órfãos por construção. Validado no
  banco em transação com rollback: tombstone e `venda_sku_nao_encontrado` sobrevivem, `entrada`
  órfã é removida.
- [x] A migration limpou os 5 órfãos existentes na aplicação (o pedido era no presente).
- [x] **Fotos já estavam limpas** — auditoria do Storage: zero arquivos órfãos. `pathsDaFamilia`
  cobre capas + imagens de variação nas duas portas. Nada a construir; registrado no ADR para a
  próxima revisão não "consertar" o que funciona.
- [x] Deploy: migration aplicada (`npm run db:check` ✓), `excluir-lote` v20 e `remover-publicado`
  v31 ACTIVE. 2321 testes passando.
- Docs: `docs/decisions/0097-exclusao-limpa-movimentos-orfaos.md`, adendo em ADR-0094 (D-5),
  `docs/reference/modelo-de-dados.md`, `docs/reference/edge-functions.md`,
  `obsidian-vault/04-Decisões/Índice de ADRs.md`.

## Código de produto automático no cadastro manual — concluído 2026-07-31

- [x] **Causa raiz:** quem usa o módulo de estoque não tem ERP, então não tem código de produto
  nem SKU — o `DialogCadastroProduto` exigia os dois e o operador preenchia com o que tinha à
  mão. No primeiro cadastro real da DSA o SKU virou o próprio EAN de 13 dígitos, que nunca casa
  com o contrato de oito dígitos do upload de foto (`^\d{8}`), quebrando a foto em silêncio.
- [x] **Fix:** o sistema passou a gerar PAI e SKUs — sequência única e crescente por
  organização (`organizations.produto_seq`), oito dígitos com zeros à esquerda, reservada pela
  RPC `proximo_codigo_produto` (`SECURITY DEFINER`, só a edge `cadastrar-produto` chama). Campos
  "Código do produto (PAI)" e "SKU" saíram da tela. Idempotência da submissão por
  `familias.chave_cadastro` (uuid gerado pelo front, unique parcial por org). Guards de
  duplicata agora cruzam `familias.codigo_pai` e `variacoes.codigo`; colisão sobre código
  gerado dispara ressincronização automática da sequência antes de falhar.
  Três migrations: `20260731192443` (coluna, índice, RPC), `20260731193955` (inicialização
  reaplicável — a original rebobinava a sequência se reaplicada), `20260731194443` (Avil
  deslocada para a faixa reservada `99000000`; DSA permanece em `1`).
- [ ] **Branch em validação** (`worktree-codigo-produto-automatico`) — pendente QA/merge.
- Docs: `docs/decisions/0096-codigo-produto-automatico.md`,
  `docs/reference/edge-functions.md` (`cadastrar-produto`), `docs/reference/modelo-de-dados.md`
  (`organizations.produto_seq`, `familias.chave_cadastro`, RPC `proximo_codigo_produto`).

## Dashboard mostrava 28 devoluções (só 3 são reais) — corrigido 2026-07-31

- [x] **Causa raiz:** o backfill completo do `reconciliar-faturamento` (task abaixo, mesmo dia)
  passou a popular `ml_vendas.estorno` para TODO pedido com `transaction_amount_refunded > 0` no
  Mercado Pago — inclusive reembolsos parciais/negociados sem devolução real (ajuste de preço,
  frete, etc.). O card "Faturamento Bruto" do Dashboard usava `pedido.estorno > 0` como proxy de
  "devolução concluída" (decisão do ADR-0038, para fugir das lacunas de sync de `ml_devolucoes`).
  Antes do backfill completo essa proxy coincidia por acaso com as devoluções reais; depois,
  passou a contar 28 pedidos com algum estorno no mês vs. as 3 devoluções de fato concluídas no
  painel nativo do ML.
- [x] **Fix v1:** `devolucoesPeriodo` em `src/pages/Dashboard.tsx` passou a contar `ml_devolucoes`
  com `type === 'returns'` e `status !== 'opened'`. Commitado, PR #45 mesclado em `main`.
- [x] **Fix v2 (mesmo dia, ainda mais preciso):** `status !== 'opened'` sozinho ainda incluía claim
  fechado sem reembolso de verdade — achado ao conferir pedido a pedido contra o ML: 1 caso com
  `return_status='cancelled'`/`status_money='retained'` (devolução rejeitada, dinheiro retido, não
  é devolução) e 1 caso com `status_money='refunded'` no banco mas que o ML ainda mostra em
  andamento ("Venda entregue", não "finalizada") — ver achado de bug abaixo. Critério trocado para
  `return_status_money === 'refunded'`, que bate com a frase exata do ML ("Devolução finalizada
  com reembolso para o comprador") e foi conferido 1:1 contra as devoluções reais do Diego.
- [x] **Suspeita de bug de sync DESCARTADA, verificado ao vivo:** cheguei a suspeitar que
  `buscarReturn` (`devolucoes-io.ts:19-28`) gravava `status_money='refunded'` cedo demais (pack
  `#2000013737917865`, claim `5540650071`, que no painel Devoluções do ML aparecia só como "Venda
  entregue"). Puxando a API do ML ao vivo (token da conexão via `get_connection_tokens`) pros 6
  claims do período: todos batem 1:1 com o banco — `status: closed`, `status_money: refunded`,
  `resolution.applied_coverage: true`, comprador (`complainant`) beneficiado. Duas categorias
  legítimas: `item_returned` (devolução física normal) e `low_cost` (item de baixo valor — ML
  reembolsa direto sem exigir devolução física, não compensa a logística reversa). A divergência
  com o painel "Devoluções" do ML não é bug nosso: claims resolvidos automaticamente por mediador
  (sem exigir ação do vendedor) não parecem virar card/busca confiável naquela tela do próprio ML
  — mesmo padrão do "Não foi possível exibir esta informação da venda" visto na aba Reclamações e
  mediações. **6 devoluções · R$212,42 (mês atual) confirmado correto.**
- [x] **Branch validada e mesclada** (PR #45 + #46 + #47, `main`).
- Docs: `docs/reference/glossario.md` ("Devolução (concluída)") e
  `obsidian-vault/05-Bugs/Incidentes.md` (continuação do incidente "2026-07-31 — Devoluções do ML").

## Devoluções ML não computadas automaticamente — 2 bugs corrigidos e DEPLOYADOS 2026-07-31

- [x] **Causa raiz nº 1:** `reconciliar-faturamento` (schedule QStash 1h) estourava o limite de
  150s da edge function em TODA execução desde a criação (94/747 eventos `ERROR` via `GET
  /v2/events` do QStash) — Vendas rodava antes de Devoluções, que nunca era alcançada. Fix: duas
  passadas (devoluções+perguntas de todas as orgs antes de vendas) + lotes de 5 + guarda de
  orçamento (nunca mais 546/504, responde 200 com o que pulou). Mesmo padrão já usado em
  `backfill-faturamento` (26/07).
- [x] **Causa raiz nº 2:** `carregarLiquidoMPDoPedido` (por-pedido) e `buscarPagamentosMP`
  (varredura em lote) só aceitavam pagamento MP `status === 'approved'`, excluindo pra sempre
  estornos TOTAIS (MP muda o status pra `refunded`, não mantém `approved`). Afetava
  `sync-devolucao`, `sync-venda`, `reconciliar-faturamento` e `backfill-faturamento`. Fix: aceitar
  `approved` OU `refunded` nos dois (2 buscas na varredura, mesmo padrão de `buscarClaimsSeller`).
  Teste novo em `enriquecimento.test.ts`.
- [ ] **Lacuna conhecida, não corrigida:** 4 pedidos antigos (30/06–22/07, R$66,12) com estorno
  total mas SEM claim ficaram fora das janelas de rotina (72h/7d) — tentativa de backfill manual
  amplo estourou 150s (`backfill-faturamento` não tem guarda de orçamento ainda) e foi abortada.
  Corrigir com backfill manual mais estreito (1 org) ou levar a guarda de orçamento pra
  `backfill-faturamento` também.
- [x] **Achado à parte, corrigido junto:** `TIPO_LABEL` em `src/lib/devolucoes.ts` mapeava a
  chave `'return'` (singular), mas a API do ML manda `type: 'returns'` (plural) — toda devolução
  de verdade mostrava a string crua na aba Devoluções (e no export) em vez de "Devolução". Também
  faltavam `ml_case`/`fulfillment` (4+1 ocorrências sem label no banco). Puramente cosmético, sem
  impacto em dado/cálculo. Teste novo em `src/lib/__tests__/devolucoes.test.ts`.
- [x] **Verificado ao vivo em produção:** publish direto via QStash (2x) + `supabase db query` —
  `reconciliar-faturamento` completou em ~65s (era 546/504 sempre); `ml_vendas.estorno` do pedido
  com estorno total foi de `null` para `59.99`. Dashboard passa a bater com o painel do ML (3
  devoluções · R$108,25 em vez de 2 · R$48,26).
- [x] **Deploy já feito** (`reconciliar-faturamento`, `sync-devolucao`, `sync-venda`,
  `backfill-faturamento` — mudou `_shared/faturamento/enriquecimento.ts` e
  `_shared/mercadopago/financeiro.ts`) — urgência: bug financeiro ativo em produção,
  reconciliação horária rodando e falhando desde a criação do schedule em 24/07.
- [ ] **Branch aguardando validação local do Diego** antes de push/merge (fluxo de entrega padrão).
- Docs: `docs/reference/edge-functions.md` (histórico + descrição atualizada) e
  `obsidian-vault/05-Bugs/Incidentes.md` (2026-07-31).

## Cobertura máxima de atributos ML sem inventar dado (adendo ADR-0052) — BRANCH 2026-07-30

- [x] **4 causas de código corrigidas** em `supabase/functions/_shared/ai/atributos-llm-core.ts`:
  tokenizer do guard anti-invenção quebrava em pontuação colada ("ALGODÃO." não batia "algodão");
  atributos `multivalued` (COMPOSITION, RECOMMENDED_USES) eram banidos do alvo da IA; texto-livre
  opcional sem `values[]` sugeridos nunca era tentado (só obrigatório, ADR-0052 original); guard de
  `number_unit` só checava se o número aparecia solto no texto, sem checar unidade do contexto
  (deixava "224 metros" virar `UNIT_WEIGHT: 224 g`). Detalhe completo:
  `docs/superpowers/specs/2026-07-30-atributos-ml-cobertura-maxima-design.md` e adendo em
  `docs/decisions/0052-camada2-atributos-ia-first-com-fallback.md`.
- [x] **Teste golden com schema real** (`MLB270273`, família da investigação): alvos de IA foram de
  3 para 6 atributos pro mesmo produto, sem inventar valor (regra de ouro substring continua o único
  portão de aceitação).
- [x] **Limitação conhecida documentada** (`ponytail:` no código, item 3 do adendo ADR-0052): guard de
  unidade exige adjacência regex (número colado à unidade); frase com unidade não-adjacente ("224 de
  comprimento") pode sub-preencher se o mesmo número aparecer noutro trecho com unidade conflitante
  adjacente. Direção seletiva a favor da segurança (nunca inventa, só perde cobertura) — aceito sem
  bloquear esta entrega.
- [ ] **Deploy pendente** — mudou `_shared/ai/atributos-llm-core.ts` e `_shared/categoria/atributos.ts`,
  consumidos por `process-familia` e `definir-categoria-familia`; exige `supabase functions deploy`
  (todas as funções que importam `_shared/**`) antes de considerar em produção (regra "Deploy nunca
  defasado" do CLAUDE.md).
- [ ] **Branch aguardando validação local do Diego** antes de push/merge (fluxo de entrega padrão).

## E6b Bloco A — Estoque único cross-canal (ADR-0094) — EM PRODUÇÃO 2026-07-29

- [x] **ADR-0094 escrito e aceito** — `docs/decisions/0094-estoque-unico-cadastro-manual.md`
  (numerado 0094 porque o 0054 já estava ocupado por outro ADR). Cobre os dois blocos do épico;
  só o Bloco A (estoque) foi construído e deployado nesta entrega.
- [x] **Ledger `estoque_movimentos` + 3 RPCs `security definer`** — migration
  `20260729084329_e6b_estoque_movimentos.sql`: `baixar_estoque` (baixa atômica e idempotente,
  advisory lock compartilhado com o estorno, tombstone de cancelamento), `estornar_estoque`
  (repõe só o que foi de fato baixado, D-7), `registrar_entrada` (entrada de mercadoria, custo
  falha LOUD se `<= 0`). As três revogadas de `public`/`anon`/`authenticated`, concedidas só a
  `service_role`. Trigger `variacoes_bloquear_escrita_direta_estoque` bloqueia escrita direta em
  `variacoes.estoque` (D-20) — não existe mais "ajuste manual" pelo app.
- [x] **2 edge functions novas deployadas** — `sincronizar-estoque` v1 (worker, fila serial
  `estoque-{orgId}`, push absoluto por canal publicado exceto o de origem) e `reconciliar-estoque`
  v1 (schedule QStash, rede de segurança do push — só re-empurra produto com movimento no ledger,
  D-12). Ambas `verify_jwt=false`.
- [x] **`sync-venda` redeployada (v50)** — baixa em `pedido.status === 'paid'` (não o gancho
  one-shot `novaPaga`) via `registrarBaixaVenda`; estorno no cancelamento pré-despacho via
  `estornarVendaCancelada`; despacho desconhecido/já ocorrido só notifica; devolução
  (`sync-devolucao`) não é tocada. Try/catch: a venda é sagrada, estoque nunca a derruba.
- [x] **Schedule QStash criado e confirmado** — `reconciliar-estoque`, cron `30 12 * * *`, 3
  retries, body `{}` (`scd_5WETvRdUHQr7pzKqgv4Pg4QrFNgA`), confirmado via `GET /v2/schedules`.
- [x] **Suíte de testes 2181 → 2215.**
- [x] **Docs atualizadas no mesmo lote:** `modelo-de-dados.md` (tabela `estoque_movimentos` +
  RPCs + trigger), `edge-functions.md` (as 2 funções + schedule + mudança no `sync-venda`),
  `arquitetura.md` (fluxo venda paga→baixa→outbox→fila serial→push absoluto), `glossario.md`
  (removida a marcação "em design" das entradas de estoque; corrigidas 3 divergências — ver nota
  abaixo), `project-status.md`.
- [x] **Frontend deployado** — a seção "Movimentos de estoque" no expandir de Publicados foi
  mergeada e está no ar (deploy `823843e9` no Render). Suíte `verificar-isolamento-tenant.ts`
  rodada contra produção: 54 asserções passando.
- [x] **Bloco B (cadastro manual de produto + entrada de mercadoria pela UI, gated por módulo)**
  — **EM PRODUÇÃO 2026-07-29**. Migration
  `20260729124711_e6b_origem_lote_e_modulos.sql` (`lotes.origem`,
  `organizations.modulos_habilitados`, `modulos_habilitados_da_org()`), edges
  `cadastrar-produto` e `entrada-estoque`, tela `/estoque`, `set_modulos_org` no `/admin`,
  chip de origem no LoteCard. Suíte 2215 → 2255.
- [x] **Deploy do Bloco B** — feito 2026-07-29 na ordem obrigatória (o frontend depende da RPC
  nova e o Render auto-deploya no push da main):
  1. `supabase db push` + `npm run db:check` ✓ (migrations alinhadas)
  2. `supabase functions deploy` das 6 funções ✓ — `cadastrar-produto` v1, `entrada-estoque` v1
     (ambas `verify_jwt=true`), `usuarios` v22, `publish-familia-ml` v82, `update-familia-ml`
     v69, `publicar-split-ml` v47
  3. merge na main (`823843e..2d94b4e`, fast-forward) → Render `live` em `2d94b4e9`, CI verde
  Verificado em produção: todos os lotes históricos com `origem='planilha'`, as 2 orgs com
  `modulos_habilitados` vazio (impacto zero até ligar em `/admin`), e a RPC
  `modulos_habilitados_da_org` devolve `null` para `anon` (mesma ACL do
  `canais_habilitados_da_org`, que é o default privilege do Supabase — não vaza).
- [x] **E2E manual do Bloco B** — feito 2026-07-29 via Playwright CLI, ao vivo na org DSA
  (`is_test=true`), módulo `estoque` ligado em `/admin`. Confirmado: cadastro de 2 produtos reais
  (2 variações + estoque inicial cada) caiu na Revisão com a IA rodando de verdade (título gerado,
  preço recalculado com markup+alíquota, categoria detectada); 2º produto entrou no MESMO lote
  (D-1.1); mesmo `codigo_pai` deu 409 com toast + "Abrir na Revisão"; ledger gravou `motivo=entrada`
  com o custo certo. Embed `familias!inner(codigo_pai)` confirmado como objeto (não array) via
  curl direto no PostgREST — guard de SKU correto. Parado **antes** do clique de publicar de
  verdade no Mercado Livre (decisão do Diego); produtos de teste (`99000001`/`99000002`) deixados
  na DSA — procedimento de limpeza em `docs/how-to/operacoes-rotineiras.md`.
  **4 bugs reais achados e corrigidos no mesmo dia** (só apareciam com screenshot real, não no
  snapshot de acessibilidade): (1) `className="max-w-4xl"`/`"max-w-lg"` sem o prefixo `sm:` não
  vencia o `sm:max-w-sm` default do `DialogContent` — tailwind-merge trata como grupos diferentes,
  o dialog renderizava com 384px em qualquer desktop; (2) `min-w-0` faltando no wrapper do
  formulário — `DialogContent` é um `grid` sem `minmax(0,1fr)`, o min-content da tabela de
  variações vazava pro dialog inteiro; (3) mesmo corrigido, a tabela de 10 colunas ainda cortava a
  SKU em `sm:max-w-4xl` (862px úteis vs 924px necessários) — subiu para `sm:max-w-5xl`;
  (4) GTIN/dimensões/descrição eram capturados no cadastro mas não apareciam de volta na tela
  `/estoque` — adicionadas colunas GTIN/Dimensões + linha de descrição na tabela expandida.

> **Divergências encontradas na documentação pré-existente (corrigidas nesta entrega):**
> `glossario.md` descrevia "Ajuste manual" como um tipo de movimento existente (não existe — a
> escrita direta é bloqueada por trigger, D-20); descrevia a baixa como acionada pelo gancho
> `novaPaga` (é `pedido.status === 'paid'`); e descrevia devolução como "não repõe, só notifica"
> quando na verdade devolução **não é tocada de forma nenhuma** (nem repõe, nem notifica — quem só
> notifica é o cancelamento com despacho desconhecido/confirmado, caminho diferente).

## `backfill-faturamento` — timeout horário corrigido (2026-07-27)

**Sintoma:** 504/546 de hora em hora, **28 FAILED contra 1 DELIVERED** em 2026-07-26. Não era
regressão do ADR-0093 — o primeiro erro do ciclo das 23:00 foi às 23:02:32, antes daquele deploy
terminar (~23:35).

### Causa raiz: o body do schedule estava duplamente codificado

O schedule do QStash guardava `body = '"{\"dias\":30}"'`. O worker faz `JSON.parse(body)` e
recebia uma **string**, não um objeto — logo `payload.dias` era `undefined` e o `janela()` caía no
default `dias = 90`. **O backfill agendado nunca rodou 30 dias: sempre rodou 90.** Pelo modelo de
custo medido (abaixo), 90 dias ≈ 294s contra um teto de ~150s — nunca teve como passar.

É a mesma armadilha de double-encoding do QStash já registrada no runbook do projeto. Auditados os
5 schedules: **só o backfill passa body**, e era o único afetado.

**Correção:** schedule recriado com body JSON correto.

Config final: cron **`30 * * * *`** e **`{"dias":7}`** (66s, ~56% de folga). Duas razões, ambas de
margem e não de falha observada:
- 30 dias fecha em **129s** contra teto de ~150s — 14% de folga é pouco para um job de produção
  cujo custo cresce com o volume de pedidos.
- No minuto `:00` disparam três schedules juntos (`backfill`, `reconciliar-faturamento`,
  `reconciliar-convergencia-up`), todos batendo na API do ML. Sair do `:00` remove essa disputa.

Reduzir a janela **não perde cobertura**: o schedule nunca funcionou (sempre 90 dias por causa do
body), então não havia cobertura a preservar — sai de "falha sempre" para "sincroniza 7 dias de
forma confiável". O `reconciliar-faturamento` cobre 72h de hora em hora sem falhar, e 7 dias dá
2,3× essa margem. Schedule atual: `scd_5cJRAXQbinVvzgg5vfRKhzhRH6sJ`.

> **Correção de método (registrada de propósito):** durante a verificação eu reportei que os ciclos
> das 01:00 e 02:00 haviam falhado *depois* da correção. **Era falso** — o filtro de eventos
> comparava só a hora (`hour==1`), sem a data, e casou com eventos do dia anterior. Os dados reais:
> última falha em **26/07 23:40** (pré-correção) e **três DELIVERED 200** em 27/07 00:09, 00:13 e
> 00:15 (pós-correção). Ao auditar QStash, sempre comparar timestamp absoluto contra `date -u`.

### Correção de desempenho (necessária, mas não era a causa raiz)

Medição antes de assumir: com `dias:1` — quase só o custo fixo — a execução levava **117s**. Três
laços rodavam **um item por vez**, o pior 1 GET por pack de mensagens, até 200 packs. Passaram a
usar o mesmo `chunk(_, PARALELAS=5)` que o laço de pedidos já usava. A dedupe de títulos por item
foi preservada (prefetch dos ids únicos).

Sem isso, mesmo com o body corrigido os 30 dias não caberiam.

**Medido em produção depois das duas correções:**

| janela | antes | depois |
|---|---|---|
| 30 dias (o que o schedule pede) | timeout | **129s · DELIVERED 200** |
| 7 dias | — | 66s |

Modelo de custo: ≈**47s fixos + ~2,7s por dia de janela** (Avil, ~600 pedidos/30d).

### Achados junto

- O botão "Sincronizar" do Faturamento mandava `dias=90` → ~294s pelo modelo. **Nunca completou.**
  Reduzido para 30 (≈129s).
- O cabeçalho do backfill afirmava "não busca shipment por pedido (evita N+1)" — o `9675f3a`
  adicionou frete/rastreio de propósito. Comentário corrigido, com o teto medido documentado.

- [x] Body do schedule corrigido (causa raiz).
- [x] Laços sequenciais paralelizados; deploy v48.
- [x] Botão "Sincronizar" de 90 → 30 dias.
- [x] Schedule para `30 * * * *` + `dias:7` (66s, ~56% de folga).
- [ ] **Observar:** o custo cresce ~2,7s por dia de janela e com o volume de pedidos. Quando os 7
  dias passarem de ~100s, o caminho é tornar o backfill retomável entre execuções (processar em
  fatias e continuar na execução seguinte), não encolher mais a janela.
- [ ] **Nota de arquitetura:** o botão "Sincronizar" (30 dias, ~129s) roda isolado e passa, mas
  está no mesmo limite. Se der timeout para o usuário, é o mesmo teto — não um bug novo.

## Financeiro do Mercado Pago pela conexão OAuth do ML (ADR-0093) — 2026-07-26

Substitui o token estático `MP_ACCESS_TOKEN`/fallback cross-tenant: o financeiro passa a ler a
conta MP do vendedor com o token da conexão `mercado_livre` da própria org — não existe "conexão
do Mercado Pago" separada. [ADR-0093](decisions/0093-financeiro-mp-pela-conexao-ml.md) · plano em
`plans/2026-07-26-financeiro-mp-pela-conexao-ml.md`.

- [x] `carregarLiquidoMP` recebe `token`/`contaId` do worker chamador (some `resolverTokenMP`/
  `getContaId`) e devolve `Map | null` (`null` = leitura do MP falhou); `montarMapaLiquido`
  extraída pura e testada.
- [x] `preservarDadosMP` (`_shared/faturamento/venda.ts`) preserva `estorno`/`money_release_date`
  já gravados quando o MP falha, ligada no `upsertVenda`.
- [x] Os 4 workers (`sync-venda`, `sync-devolucao`, `backfill-faturamento`,
  `reconciliar-faturamento`) religados: os dois de evento gravam e respondem 502 em falha do MP
  (retry via QStash); os dois de varredura logam e seguem.
- [x] Caminho morto do MP ao vivo removido de fato: edge `resumo-financeiro` (código),
  `src/lib/financeiro.ts`, `src/hooks/useResumoFinanceiro.ts`, `_shared/mercadopago/rateio.ts` e
  os órfãos (`resolverTokenMP`, `escolherTokenMP`, `getContaId`, `agregarFinanceiro`,
  `montarInfoPorPagamento`, `buscarPedidosML`, `mapearPagamentoParaItem`). Ver correção do
  registro histórico deste mesmo arquivo (seção do ADR-0042, 2026-06-25) — o caminho morto **não**
  havia sido removido naquela data.
- [x] Migration `20260726215859_mp_token_pela_conexao_ml.sql` (`drop function get_mp_token` +
  `drop column configuracoes.mp_access_token_secret_id`) escrita.
- [x] Documentação atualizada (`edge-functions.md`, `modelo-de-dados.md`, `arquitetura.md`,
  `obsidian-vault/01-Arquitetura/Integrações.md`, `project-status.md`, este arquivo).
- [x] Leitura por pedido nos workers de evento: `carregarLiquidoMPDoPedido` busca os pagamentos
  por id (`GET /v1/payments/{id}`) em vez de varrer 120 dias — de até 40 requisições ao MP por
  pedido para 1-2. Workers de lote seguem varrendo.
- [x] **EM PRODUÇÃO (2026-07-26):** 7 edge functions deployadas (`verify_jwt=false` conferido nas
  7), edge `resumo-financeiro` removida do Supabase (era v14 ACTIVE), migration aplicada
  (`get_mp_token` → 404, coluna → 42703), secrets `MP_ACCESS_TOKEN`/`MP_FALLBACK_ORG_ID`
  removidos.
- [x] Validado em produção 3× (antes da migration, depois dela e depois da remoção dos secrets)
  com `sync-venda` real no pedido 2000016957965428 (`partially_refunded`, estorno R$ 12,50):
  QStash **DELIVERED HTTP 200** nas três — logo a leitura do MP funcionou, não foi o guard
  preservando valor antigo — e `estorno`/`money_release_date`/`liquido` intactos. Cruzado com
  `GET /v1/payments/163485429941`: `approved`, refunded 12.5, data batendo com o banco.
- [x] Validado na tela com browser-use (Chrome do Diego, somente leitura): Financeiro antes vs
  depois **idêntico em todos os números** (líquido R$ 19.823,52 · bruto R$ 29.541,04 · taxas
  R$ 9.717,52 · estornos R$ 0,00 · já liberado R$ 6.008,66 · a liberar R$ 13.750,15 · 504
  vendas); o único diff foi o relógio "Atualizado às". Detalhe do líquido íntegro, com a coluna
  Liberação renderizando datas e selo "a liberar".

## Acesso temporário de suporte — finalização operacional (2026-07-26)

- [x] Migration `20260726153552_finalize_support_access.sql`: RPC transacional para iniciar e
  renovar sessão, janela de 15 minutos, auditoria atômica, permissões `service_role`, cron diário
  de retenção e validação final de `profiles_identity_xor`.
- [x] Edge `suporte`: o início delega à RPC e converte falha/resultado vazio em conflito `409`.
- [x] Contrato SQL cobre renovação, rollback, isolamento entre tenant/solicitante, retenção com
  `legal_hold`, XOR e job cron.
- [x] Roteiro de implantação exige conferir as identidades antes de `supabase db push` e exercita
  renovação na DSA; não usar Avil para mutações de teste.

## Seed de user_products corrigido (ponta solta do bloqueio de desconto) — 2026-07-25

Descoberto ao preparar o `db push` da varredura de segurança: a migration
`20260724150000_seed_user_products_desconto_incompativel.sql` (commit `9a0a067`, leva de
24/07 09:38–09:47 que entregou "bloquear desconto visual em user products") **nunca foi
aplicada** — o código foi para produção, a migration ficou para trás. O nome do arquivo tem
timestamp redondo (`150000`), incompatível com o que o `supabase migration new` gera, o que
sugere arquivo escrito à mão e fora do fluxo de push.

- [x] **MLB270273 (Fios e Cadarços) removida do seed.** Não se sustenta: 32 famílias
  publicadas com sucesso pelo caminho legacy `variations[]`, nunca observada com a assinatura
  reativa de UP (o cache aprendido em produção tem só MLB271701 e MLB419782), e fora do Set
  `CATEGORIAS_QUE_EXIGEM_FAMILY_NAME` do ADR-0084. Não seria cosmético: cache `user_products`
  faz `publish-familia-ml` pular a tentativa `variations` e rejeitar de imediato família com
  desconto (`processar.ts:150-160`). O ADR-0088 §3 já dizia em código que seed não prova UP.
- [x] **MLB271227 (Zíperes) mantida.** É a categoria do ADR-0084, exige item plano de verdade
  e já está no Set — o seed não muda a rota, só antecipa o bloqueio de desconto, que é o
  propósito declarado da entrega original.
- [x] **Cópia solta `"... 2.sql"` removida** (untracked, sufixo de duplicação do macOS). Fazia
  o `supabase migration list` enxergar a versão `20260724150000` duplicada — um `db push`
  tentaria aplicar duas migrations com a mesma versão.
- [x] **`db push` aplicado** (2026-07-25) das duas migrations. Verificado no banco: o seed
  gravou só `MLB271227` (2 conexões), e `ml_formato_publicacao` segue com MLB271701/MLB419782
  aprendidas reativamente — MLB270273 não entrou.

## Correções da varredura de segurança (relatório CLAUDE-SECURITY-20260724-125213) — 2026-07-25

Branch `fix-security-e7`. 10 achados verificados por painel adversarial (4 HIGH, 6 MEDIUM):
**8 corrigidos aqui (F1, F2, F3, F5, F7, F8, F9, F10), 2 pendentes (F4, F6).** Nada foi
aplicado no banco nem deployado.

> **Ressalva sobre o relatório.** A seção "Working-tree note" do
> `CLAUDE-SECURITY-RESULTS.md` atribui a árvore suja a trabalho concorrente "no mesmo
> worktree". O que houve foi outro: o worktree usado como raiz do scan foi **removido do git
> por outra sessão durante a execução**, e o `git` daquele caminho passou a resolver para o
> checkout principal. Daí o carimbo citar `17ca699` (commit que entrou no meio da rodada) em
> vez de `b15ecb8` (o que foi realmente lido) e marcar `-dirty` por alterações do checkout
> principal. `supabase/functions` é idêntico entre os dois commits (`git diff` vazio no
> escopo). Por causa dessa incerteza, **todo achado foi reconferido linha a linha contra o
> checkout principal em `17ca699` antes de virar correção** — todos bateram.

- [x] **F2/F7/F8** — `ingest-lote` lia o lote por id cru e buscava famílias anteriores só por
  `codigo_pai`, ambos no client service_role (RLS desligada): dava leitura/escrita cross-tenant
  e vazava `ml_item_id`/preço/análise de concorrência de outra org. Os dois filtros agora são
  por `org_id` (ADR-0056 §4: "quando existir org_id, os filtros viram `.eq('org_id', …)`"),
  preservando o compartilhamento intra-org que evita duplicar anúncio no ML.
- [x] **F1** — `excluir-lote` e `remover-publicado` apagavam do Storage caminhos vindos de
  colunas escritas pelo cliente, via service_role (RLS de storage não se aplica). Guard novo
  `filtrarPathsDeDonos`: `excluir-lote` trava no `lote.user_id`, `remover-publicado` nos
  profiles da própria org. Limite conhecido: path fora da convenção `${userId}/…` vira arquivo
  órfão — nunca delete indevido.
- [x] **F3** — RLS é row-level, não column-level: qualquer admin de org fazia `PATCH` no
  PostgREST com `is_super_admin: true` e virava super-admin da plataforma. Migration
  `20260725140339_lockdown_escrita_profiles.sql` revoga update/insert/delete de `authenticated`
  e `anon`. **ADR-0090. Aplicada em produção 2026-07-25** — verificado via
  `information_schema.role_table_grants`: `authenticated`/`anon` ficaram só com SELECT,
  `service_role` mantém escrita. Confirmado antes que ninguém havia se promovido (único
  `is_super_admin` é a conta do Diego).

> ⚠️ **`npm run db:check` acusa divergência até o merge.** A migration do F3 foi aplicada no
> remoto a partir deste branch, e o arquivo ainda não existe na `main` — daí a linha
> `| 20260725140339` só do lado remoto. **Mergear `fix-security-e7` resolve.** Nada a corrigir
> no banco.
- [x] **F5** — override de `chatId` no teste do Telegram agora exige admin (a tela que o usa,
  `/usuarios`, já é admin-only); o teste sem override segue liberado para membro comum.
- [x] **F9** — SSRF: `categoria_ml_id` ia cru para o caminho de
  `https://api.mercadolibre.com/categories/${id}/attributes`, numa chamada que leva o token de
  vendedor da org; como o parser de URL resolve `..` antes de enviar, `../` colapsava o caminho
  e virava um GET autenticado em qualquer outro endpoint do ML. Agora exige `/^MLB\d+$/`, no
  call site (`definir-categoria-familia`, com 400 explícito) e dentro de `lerSchemaAtributos`.
- [x] **F10** — `resource` do webhook ganhou teto de tamanho e formato, e o throttle saiu da
  contagem de linhas (que o próprio INSERT falhando zerava) para um contador no Redis.
- [ ] **F4** — `state` do OAuth do ML não é amarrado ao browser: um admin gera o link e a vítima
  que autorizar entrega os tokens dela para a org do atacante. **Não corrigido**: exige hop GET
  no domínio das functions para setar cookie first-party (o front hoje chama por XHR, e o CORS é
  `Allow-Origin: *`, o que impede credencial), `GETDEL` atômico no Redis e índice único parcial
  em `marketplace_connections(canal, conta_externa_id)` — hoje a mesma conta ML em duas orgs faz
  `resolverIdentidade` (`maybeSingle`) derrubar os webhooks das duas.
- [ ] **F6** — supressão de notificação no `ml-webhook`: quem sabe o `mlUserId` público enche a
  janela do vendedor e faz o evento legítimo ser descartado. Só autenticação de origem resolve
  (allowlist de IP do ML ou segredo na URL de notificação). Não coberto pelo F10.
- [ ] **Checagem antes do push (F2)** — se uma colisão de `codigo_pai` entre orgs já tiver
  copiado um `ml_item_id` de um tenant para outro, o filtro novo faz aquele pai voltar a ser
  tratado como CREATE no próximo ingest e **duplicar um anúncio real no ML**. Conferir antes:
  `select codigo_pai, count(distinct org_id) from public.familias where ml_item_id is not null group by 1 having count(distinct org_id) > 1;`
  Se voltar linha, resolver o vínculo à mão antes de subir o fix.
- [ ] **Deploy** — tudo exceto o F3 mexe em `supabase/functions/**`; merge não deploya. Rodar
  `supabase functions deploy` das funções afetadas: `ingest-lote`, `excluir-lote`,
  `remover-publicado`, `monitorar-moderados`, `ml-webhook`, `definir-categoria-familia` (mudou
  `_shared/`: redeployar todas as que importam `lote/exclusao.ts`, `faturamento/venda.ts`,
  `redis/client.ts` e `categoria/schema.ts`).

## Link direto pro ML nas notificações (venda/pergunta/devolução) — 2026-07-24

- [x] `montarMensagemNovaVenda`/`NovaPergunta`/`NovaDevolucao` (`_shared/notificacoes/telegram.ts`)
  passaram a embutir, como última linha do texto, a URL específica no Mercado Livre (pedido/pacote,
  anúncio do item, ou reclamação — mesmos formatos já usados em `detalhe-pedido-itens.tsx` e
  `aba-devolucoes.tsx`). O sino in-app (`notificacoes-bell.tsx`) já fazia `linkify()` de qualquer
  URL crua no texto, então zero mudança de frontend ou migration — só os 3 workers (`sync-venda`,
  `sync-pergunta`) passando o dado extra (`pack_id`, `item_id`) que já tinham em mãos.

## Atualização rápida de estoque (1-clique) — ADR-0089 — 2026-07-24

- [x] **Grill-with-docs + domain-modeling** (investigação antes de desenhar): a feature pedida
  ("importar planilha e só atualizar estoque") já existia em parte — `ingest-lote` UPDATE só
  toca estoque (ADR-0016) e a publicação já tinha o toggle `somenteEstoqueGlobal` que suprime
  preço (ADR-0078). O gap real era a fricção: reposição pura de estoque ainda exigia entrar na
  Revisão e selecionar família a família manualmente.
- [x] **ADR-0089 escrita e revisada adversarialmente pelo Fable 5** (`Agent model: fable`) *antes*
  de codar — achou e evitou um furo real: o critério inicial (só `familiaPublicavel`) deixaria
  passar cor nova *completa* (foto+preço+estoque, mas nunca publicada no ML) no atalho de
  1-clique, o que criaria uma variação nova no anúncio disfarçada de "atualização de estoque".
- [x] **Implementado via subagent-driven-development** (3 tasks, TDD, 1 subagent por task): `src/lib/estoque-rapido.ts`
  (`familiasElegiveisEstoqueRapido` + `calcularZerados`, 19 testes) → gate de 1-clique em
  `Progresso.tsx` (restrito a `UPDATE` sem nenhuma pendência e sem nenhuma cor nova mesmo
  completa; preço sempre suprimido) → seção "estoque zerado nesta atualização" (variações +
  famílias 100% zeradas) em `Relatorio.tsx`. 100% frontend — zero migration, zero edge function
  nova/alterada.
- [x] **Revisão pós-build achou e corrigiu 1 bug real**: o gate exigia zero famílias em `erro` no
  lote pra aparecer, escondendo o atalho sempre que qualquer família falhasse — mesmo com
  dezenas de `UPDATE` já elegíveis. Corrigido pra espelhar a condição real do trigger de banco
  `update_lote_counters` (só bloqueia com família `pendente`/`processando`, não `erro`).
- [x] **`/code-review-fable5` rodado na branch inteira**: 88/100, APROVAR, 2 achados MÉDIOS — custo
  de polling contínuo do fetch pesado (`useFamilias`) durante toda a fase de processamento, e a
  lógica do gate sem teste dedicado (justo a que já tinha causado o bug acima). Ambos corrigidos
  no mesmo dia: `deveExibirGateEstoqueRapido` extraída como função pura testada (5 casos novos,
  incluindo a regressão real como caso de teste) e o polling do fetch pesado agora só liga perto
  do fim do processamento (≤10% das famílias ainda pendentes).
- [x] **Merge direto pra `main`** (fast-forward `c8ac841..3906a2a`, sem PR), suíte completa (2082
  testes) + `pnpm build` + `pnpm lint` verdes antes do push. `docs/decisions/0089-atualizacao-rapida-de-estoque.md`,
  `docs/superpowers/plans/2026-07-24-atualizacao-rapida-de-estoque.md`.

## Largura em mm omitida no título/descrição do copywriter — 2026-07-24

- [x] **Produto 02994771 (lantejoula Búfalo) saiu de revisão sem "6mm de largura" no
  título/descrição** — investigado com `systematic-debugging`. Confirmado via `supabase db
  query --linked`: `descricao_pai` (planilha) tem "6MM DE LARGURA" íntegro (sem truncamento em
  nenhum ponto do pipeline); `atributos_ml.DIAMETER` já capturava "6 mm" corretamente (caminho
  determinístico da ficha técnica, ADR-0049); só `titulo_ml`/`descricao_ml` (texto livre do
  copywriter, gpt-4o-mini) omitiam o dado. Causa raiz: ao contrário de metragem/cor/tipo de
  produto, que têm rede de segurança determinística em `titulo.ts`
  (`garantirMetragemTitulo`/`garantirCorTitulo`/`garantirTipoProdutoTitulo`), não havia guard
  nenhum para largura — o prompt só *pede* pra IA citar "Largura" em ESPECIFICAÇÕES, sem
  garantir, e a IA às vezes pula a seção inteira (era o caso real deste produto).
- [x] **Fix determinístico**: `extrairLarguraMm`/`garantirLarguraDescricao`
  (`_shared/ai/copywriter-prompt.ts`) — extrai "Xmm" grounded em nome_pai/descricao_pai e injeta
  `• Largura: Xmm` na seção "📌 ESPECIFICAÇÕES" da descrição, criando a seção quando a IA a
  omitiu. Aplicado nos dois pontos que persistem `descricao_ml`: `process-familia/index.ts`
  (fluxo normal) e `regenerar-copy-familia/index.ts` (botão de regenerar copy do operador) —
  mesma duplicação de guards já existente entre os dois arquivos. TDD: 11 testes novos
  (`copywriter-largura.test.ts`), incluindo o cenário real do produto 02994771; suíte completa
  (2028 testes) + `tsc` + `deno check` (`pnpm check:functions`) + `pnpm lint` verdes.
- [x] **Reprocessar produto 02994771** — deploy feito (`process-familia` v115,
  `regenerar-copy-familia` v34, `publicar-split-ml` v39 por higiene); Diego clicou em
  "Regenerar descrição" e confirmou "Largura: 6mm" na descrição.
- [x] **2 gaps descobertos no teste real do Diego, mesmo dia**: (1) a mesma geração que trouxe a
  largura saiu sem QUALQUER menção a metragem (nem bullet, nem prosa "rolo contendo 50 metros")
  — a IA pode descartar os dois dados juntos ou separado, e metragem nunca teve guard na
  descrição (só no título, via `garantirMetragemTitulo`); (2) Diego pediu explicitamente a
  largura também no título (decisão de produto, não só na descrição) — título só trazia "50MT".
  Fix: `garantirLarguraTitulo` (`_shared/ai/titulo.ts`, mesmo padrão clamp-a-60 de
  `garantirCorTitulo`) crava a largura no título logo após a metragem; `garantirMetragemDescricao`
  (`_shared/ai/copywriter-prompt.ts`) crava `• Metragem: Xmt` em ESPECIFICAÇÕES quando ausente
  (usa `contemMetragem`, tolerante a menção em prosa, pra não duplicar). `extrairLarguraMm`
  migrou de `copywriter-prompt.ts` para `titulo.ts` (mesma casa de `extrairMetragem`), reusado
  pelos dois lados (título e descrição) sem duplicar a extração. 14 testes novos
  (`titulo-largura.test.ts` + ampliação de `copywriter-largura.test.ts`, incluindo composição
  título+cor+metragem+largura e descrição largura+metragem sem duplicar cabeçalho); suíte
  completa (2052 testes) + `tsc` + `deno check` + `pnpm lint` verdes.
- [x] **Achado ao checar pendências**: `extrairLarguraMm` só reconhecia unidade MM; outras 3
  famílias em revisão (franjas `03106110`/`03070220`/`03106098`) têm largura em **CM** na
  descrição (`"5/8/10 CM DE LARGURA"`) — mesmo gap, unidade diferente, sem cobertura. Nota: o
  `nome_pai` dessas franjas diz "5MM"/"8MM"/"10MM" mas a `descricao_pai` do mesmo produto diz
  "CM" — inconsistência pré-existente da planilha, não alterada aqui, só capturada nas duas
  formas. Fix: `extrairLarguraMm` renomeado para `extrairLargura` (`_shared/ai/titulo.ts`),
  regex aceita `MM|CM`; `garantirLarguraDescricao` (`copywriter-prompt.ts`) generalizou a
  checagem "já contém" pra extrair a unidade certa do valor achado, evitando que um "5mm" solto
  na descrição seja confundido com uma largura de "5cm" grounded (dado diferente). 6 testes
  novos cobrindo CM (extração, título, descrição, e não-confusão com mm); suíte completa
  (2058 testes) + `tsc` + `deno check` + `pnpm lint` verdes.

## Flake do smoke test de rota do Dashboard — 2026-07-24

- [x] Investigado o flake histórico de `tests/App.test.tsx` ("renderiza Dashboard na rota /").
  A falha deixava o DOM no fallback de `Suspense`: não era fetch do Dashboard, TanStack Query,
  autenticação nem pool do Vitest. Causa raiz: o teste misturava o timeout padrão de 1s do
  `findByRole` com o primeiro transform/import dinâmico de `Dashboard.tsx`; sob coleta concorrente
  de outros arquivos, esse custo variava acima de 1s. Evidências RED: suíte completa falhou em
  1,694ms; par mínimo `Dashboard.test.tsx` + `App.test.tsx` falhou em 1,189ms; isolado passou em
  663ms. Um segundo teste da rota `/` passava em 87ms após o módulo entrar no cache.
- [x] Fix sem timeout maior nem mudança de produção: `tests/App.test.tsx` pré-carrega o módulo real
  `@/pages/Dashboard` durante a coleta, deixando o smoke test medir somente roteamento/renderização
  via `React.lazy`. Par mínimo verde (15/15) e duas execuções completas consecutivas de
  `pnpm test -- --run` verdes.

## Sino sem refresh + 2 bugs de CI silenciosos na main + branch protection — 2026-07-23

- [x] **Sino de notificações não atualizava sozinho** — `useNotificacoesNaoLidas`/`useListaNotificacoes`
  nunca tiveram `refetchInterval`, e o app desliga `refetchOnWindowFocus` globalmente
  (`query-client.ts`). Como o sino mora só no Topbar (nunca remonta ao navegar) e nenhuma outra tela
  empresta refetch pra essa queryKey, a contagem ficava congelada no valor do carregamento inicial da
  aba pelo resto da sessão. Fix: `refetchInterval: 60_000` + `refetchOnWindowFocus: true` nos dois
  hooks. Tooltip "Atualiza sozinho a cada 45s" (desatualizado desde o ADR-0081, que cortou pra 3min)
  corrigido em `ao-vivo.tsx`/`aba-vendas.tsx`/`DetalheVendas.tsx`.
- [x] **`deno lint` quebrado na main havia ~26 dias sem ninguém notar** — `userId` morto em
  `process-familia/index.ts` (introduzido em 2026-05-28, antes do gate de lint existir no CI).
  Removido.
- [x] **`deno check` quebrado desde o commit `7107933` (ADR-0088 F2, 2026-07-22)** —
  `ResultadoComposicao` (`atualizar-composicao.ts`) tinha um membro `{codigo: 'a'|'b'|'c'}` com 3
  literais em vez de um discriminante único, então o TS não eliminava esse membro no ternário de
  `atualizar-familia-up.ts:308` e barrava o acesso a `.sku`/`.status` do membro
  `filho_em_estado_terminal`. Fix: separa em 3 membros (1 literal cada) — nenhum construtor mudou.
- [x] **Causa raiz dos 2 bugs de CI**: `main` não tinha branch protection (`gh api
  .../branches/main/protection` → 404) — os comentários do `ci.yml` diziam "Bloqueante... mantenha
  em 0", mas nada tecnicamente impedia merge/push com `frontend`/`backend-lint` vermelhos. Configurado
  branch protection no `main` exigindo os dois como required status checks (`enforce_admins: false`,
  `strict: false`) — ver [[desenvolvimento-local.md]].

## Config org-scoped + imposto LOUD + token MP por org (ADR-0086) — 2026-07-22

- [x] **Increment A** — leitura de `configuracoes` no backend por `org_id` (era `user_id`): membros
  sem linha própria caíam no default 8/16 / desconto 15. 4 read-sites (`process-familia`, `publicar-split-ml`,
  `update-familia-ml`, `montar-canonico`). Em prod.
- [x] **CRÍTICA MP (cross-tenant, era VIVO)** — `resolverTokenMP` caía no `MP_ACCESS_TOKEN` global (conta
  da Avil) p/ qualquer org sem secret; a 2ª org (DSA) leria a conta MP da Avil. Gate por `MP_FALLBACK_ORG_ID`
  (só a Avil usa o global). Em prod (secret setado antes do deploy).
- [x] **Increment B** — LOUD do imposto: flag `configuracoes.aliquotas_confirmadas_em`; `process-familia`
  bloqueia a publicação (CREATE e UPDATE) se a org não confirmou, em vez de aplicar 8/16 em silêncio;
  `telegram_config_status` passou a filtrar por org. Banner + botão "Confirmar alíquotas" em Configurações
  (gate admin). Em prod (migration+backfill → Avil confirmada verificada → deploy).
- [x] **Increment C** — `configuracoes` org-scoped: `org_id` vira PK (via `USING INDEX`, sem rewrite);
  `user_id` = auditoria nullable + FK `ON DELETE SET NULL`; FK `org_id` `ON DELETE CASCADE`; trigger
  `seed_configuracoes_org` (config default por org nova) + backfill (DSA). Em prod.
- [x] Todos os incrementos revisados por Codex (`gpt-5.6-sol`) antes do merge; docs atualizados
  (`modelo-de-dados.md`, `edge-functions.md`, ADR-0086 + índice, este TASKS, Sprint Atual).

## Notificação in-app, espelho do Telegram (ADR-0085) — 2026-07-21

- [x] Todo alerta operacional (catálogo sem match, moderação, venda, pergunta, mensagem,
  devolução, liberação de saldo) saía só por Telegram — sem fallback dentro do próprio app para
  quem não usa Telegram ou não estava de olho no celular. Nova tabela `notificacoes` (in-app),
  escrita pelo mesmo ponto único que já dispara o Telegram (`notificarCategoria`,
  `_shared/notificacoes/config.ts`) — zero mudança nos 8 call-sites existentes.
- [x] Mesmos assinantes de categoria do Telegram (`profiles.telegram_categorias`, ADR-0068), sem
  exigir Telegram configurado. Sino no topbar (`useNotificacoes`, `staleTime` 60s, mesmo padrão
  sem realtime de `usePerguntasNaoRespondidas`); badge de não lidas; RPC
  `marcar_notificacoes_lidas` marca todas ao abrir o dropdown.
- [x] Fix de grants: migration nasce só com `select` para `authenticated`, sem repetir o bug do
  `grant all` para `anon` que a `ml_mensagens` teve (precisou de migration de revogação depois).
- [x] Migration `20260721094323_notificacoes_in_app` aplicada em produção; as 8 edge functions
  (`vincular-catalogo`, `monitorar-moderados`, `notificar-liberacao`, `reconciliar-faturamento`,
  `sync-devolucao`, `sync-mensagem`, `sync-pergunta`, `sync-venda`) redeployadas; frontend
  confirmado `live` no Render. `pnpm test` verde (215 arquivos, 1697 testes).

## Devoluções no Dashboard + fix do valor sempre "—" (2026-07-19)

- [x] Card "Faturamento bruto" do Dashboard ganha uma linha discreta com qtd. de devoluções
  concluídas com reembolso e valor estornado no período — só aparece quando há alguma (sem "0
  devoluções" poluindo quando não há).
- [x] Bug real encontrado durante a implementação: `ml_devolucoes.valor_em_jogo` sempre `null`
  (a API de claims do ML não traz campo monetário) — a coluna "Valor" da aba Faturamento ›
  Devoluções mostrava "—" para 100% das linhas, sempre, em produção. Fix: `buscarDevolucoes`
  (`src/lib/devolucoes.ts`) passou a juntar com `ml_vendas.estorno` (Mercado Pago, ADR-0038).
  Coluna renomeada para "Estornado" na aba Devoluções e no export.
- [x] 2ª volta, reportada pelo Diego com print real do ML: contar por `type` da claim (returns/
  mediations) não bate com a tela do ML — achamos devolução concluída com reembolso classificada
  como `mediations` (subcontava) e uma devolução real que **nunca sincronizou** em
  `ml_devolucoes` (lacuna de sincronização, fora de escopo aqui). Decisão final do Diego: contar
  só devolução **concluída com reembolso confirmado**. Reimplementado no Dashboard usando
  `pedidos` (já agrupado por pack, mesmo array de "293 pedidos") filtrando `estorno > 0` — mesma
  fonte/janela (`date_closed`) do card "Estornos" do Financeiro, sem depender de `ml_devolucoes`
  (evita a lacuna de sync e a ambiguidade de `type`).
  **Nota de escopo**: janela usa a data de FECHAMENTO DA VENDA, não a data do reembolso (não
  existe coluna de data do estorno) — uma devolução pode aparecer num mês diferente de quando o
  dinheiro efetivamente voltou, mesmo critério que "Estornos" do Financeiro já usa.
- [x] `pnpm lint`/`tsc -b`/`pnpm test` (205 arquivos, 1599 testes) verdes; validado ao vivo via
  Playwright (login real, Dashboard + aba Devoluções, várias janelas de período) contra print
  real do Mercado Livre.

## Redesign dark premium das telas de auth (plano 017, ADR-0080) — 2026-07-19

- [x] Sessão de grelha com o Diego (skill `grilling`) definiu o escopo: elevar `/login`,
  `/reset-senha` e `/definir-senha` (hoje card genérico em `bg-muted/30`) para visual "dark
  premium/glass" (mood Linear/Raycast), com logo-hero em destaque e motion CSS-only — sem
  copy nova, sem painel de features, sem dependência nova.
- [x] Plano `plans/017-redesign-telas-auth-dark-premium.md` escrito com o modelo Fable 5.
- [x] ADR-0080 (telas de auth sempre dark, sobrepondo o tema salvo) criado antes do código.
- [x] `AuthShell` (`src/components/auth-shell.tsx`) compartilhado pelas 3 páginas: dark
  forçado local (sem tocar `ThemeProvider`), logo-hero com glow de marca, grid sutil
  (`.auth-grid`), card com glassmorphism. Motion em cascata na entrada (logo → card,
  stagger de 1 token) e sucesso no submit (check + fade-out) via `tw-animate-css` + tokens
  de `src/motion/`, sem nenhuma lib nova.
- [x] `pnpm lint`/`tsc -b`/`pnpm test` (203 arquivos, 1596 testes)/`pnpm build` verdes.
- [x] QA visual headless (Playwright): 3 rotas, mobile 375px, `prefers-reduced-motion`
  (card visível sem delay), estado de erro de login intacto, zero erro de console além do
  400 esperado de credencial inválida.
- [ ] Validação final do Diego em runtime real (login com credenciais válidas — animação de
  sucesso completa — e confirmação de que o tema light salvo não vaza pro app interno após
  logar) antes de merge.

## Documentação de arquitetura visual (Archify) — 2026-07-19

- [x] 8 diagramas Archify criados em `docs/architecture/diagrams/` a partir das fontes de
  conhecimento existentes (obsidian-vault → docs/ → Graphify → config/infra), sem
  engenharia reversa de código: Platform Overview, General Architecture, Publication Flow,
  Marketplace Sync, Simplified Data Model, Multi-Tenant, Infrastructure e um TO-BE simplificado
  (≤5 melhorias). Cada diagrama tem `diagram.html` (fonte canônica) + SVG/PNG exportados +
  README próprio.
- [x] Revisão de overflow de texto (relatada pelo Diego em screenshot) corrigida em todos os
  diagramas afetados — validado por script próprio de detecção de overflow, inspeção visual
  e revisão independente via modelo Opus antes da entrega.
- [x] Merge → main → deploy (commits `6d953c6`/`bf76396`). `docs/README.md` e
  `docs/explanation/arquitetura.md` cruzam para os novos diagramas; `obsidian-vault/00-Home/Visão
  Geral.md` e `obsidian-vault/01-Arquitetura/Arquitetura Geral.md` corrigidos (nota desatualizada
  de multi-tenancy pré-E7) e cruzados também.
- [ ] Graphify (`graphify-out/graph.json`) ainda não reindexa esse conteúdo novo — `--update`
  bateu no shrink-guard (net negativo por reextração mais conservadora de poucos arquivos já
  indexados); rebuild completo (`--force`) pendente, a ser rodado quando o custo fizer sentido.

## Fix: semáforo da variação ignorava imposto por origem (lote 35) — 2026-07-18

- [x] Diego reportou: no card "Análise para publicação", o badge do topo mostrava "Abaixo do
  mínimo" mas o badge da linha da variação mostrava "Vale a pena" para o mesmo item. Investigado
  antes de mexer (ADRs + código) — não era comportamento intencional.
- [x] Causa raiz: rollout do ADR-0055 (imposto por origem) atualizou `painel-analise.tsx` e
  `viabilidade-linha.tsx` para passar `aliquotaPct` ao `SemaforoPreco`, mas esqueceu
  `variacao-card.tsx` — o parâmetro caía no default `0`, então o imposto sumia só nesse badge.
  Em item importado (16%), o líquido real (após imposto) cruza o piso e o topo mostra "Abaixo do
  mínimo" corretamente; a variação, sem imposto, calcula líquido maior e mostra o falso "Vale a
  pena". Some em item nacional (8%) porque o imposto geralmente não é grande o bastante pra cruzar
  o piso.
- [x] Fix: `familia-expanded.tsx` calcula `aliquotaPct` (mesmo padrão de `painel-analise.tsx`,
  via `useAliquotas()` + `familia.origem`) e repassa como prop a `VariacaoCard`, que agora exige
  `aliquotaPct` e a encaminha ao `SemaforoPreco`. Diff de 11 linhas, 2 arquivos.
- [x] Typecheck, lint e suíte completa (1596 testes) verdes.
- [x] Registrado em [[../obsidian-vault/05-Bugs/Problemas Resolvidos|Problemas Resolvidos]] e
  na memória de sessão (padrão recorrente de imposto por origem defaultando em silêncio).
- [ ] QA visual ao vivo (branch não mergeada — decisão de merge/PR fica com o Diego).

## Motion Design System — branch `feat/motion-design-system` — 2026-07-18

- [x] Contrato técnico e operacional (`docs/motion/contrato-motion-v5.md`) travado via
  grill-with-docs + 3 rounds de revisão adversarial do Codex (`docs/motion/PLAN.md`,
  `PLAN-REVIEW-LOG.md`). Divisão construtor (Fable 5, Fases 1-3) × executor (Sonnet 5, Fases 4-5).
- [x] **Fase 1 (Auditoria):** sem lib de animação nova — `tw-animate-css` + Radix + CSS puro
  cobrem tudo; fonte única TS→CSS proposta e aprovada no GATE 1.
- [x] **Fase 2 (Fundação):** `src/motion/` (tokens, easings, reduced-motion) + gerador +
  drift test. Commit `c1ee040`. ADR-0079.
- [x] **Fase 3 (Piloto):** fluxo de Revisão (`Revisao.tsx`, `familia-row.tsx`,
  `familia-expanded.tsx`) — entrada, expansão (Radix Collapsible), seleção, erro, sucesso,
  reduced-motion. Commits `fb266d7`/`9a97e3b`. **Aprovado integralmente pelo Diego** após QA
  ao vivo (lote real, via browser automation) — GATE 3.
- [x] **Fase 4 (Validação):** zero regressão, zero arquivo alterado.
- [x] **Fase 5 (Expansão), todos os lotes nomeados do contrato fechados:**
  - 5A (globais): overlays/feedback (`3734bae`) + navegação/formulário (auditado, sem alteração
    necessária).
  - 5B (importação/catálogo): `b3b26d7`.
  - 5C (revisão/validação): alertas de margem/categoria, `3c29fab`.
  - 5D (publicação/sincronização): `8c252b9`.
  - 5E (demais áreas — financeiro, dashboard, canais; configurações/usuários auditados sem
    necessidade de mudança): `9384674` + `2adb865`.
  - Fixes de acessibilidade achados durante a QA (fora do escopo de motion, autorizados à
    parte): `9dc31f7`, `80152d3`, `2a3825c`.
- [x] Guardrail financeiro respeitado em toda a iniciativa: `familias.custo_centavos` nunca
  confundido com `variacoes.custo`; nenhuma função de cálculo/markup/margem tocada — só
  `className`/estrutura visual.
- [x] Documentação: `src/motion/README.md` (princípios, tokens, checklist de revisão),
  `docs/explanation/arquitetura.md` + `obsidian-vault/01-Arquitetura/Frontend.md` atualizados.
- [ ] QA visual final ao vivo (financeiro, importação, publicação) — em andamento.
- [ ] **Branch não mergeada.** 1596+ testes passando, lint/build limpos em cada commit. Decisão
  de merge/PR fica com o Diego — nada foi pushado.

## Ícone de informação nos KPIs — 2026-07-18

- [x] Ícone "i" clicável em todo KPI do app (Dashboard, Publicados, Financeiro,
  Faturamento/Vendas, Faturamento/Geografia, DetalheFinanceiro, DetalheVendas), abrindo um
  popover com a explicação — dicionário central em `src/lib/kpi-descriptions.ts` (36 entradas,
  escritas a partir da fórmula real de cada KPI, com teste de guarda de cobertura). Design em
  `docs/superpowers/specs/2026-07-17-kpi-info-tooltip-design.md`, plano em
  `docs/superpowers/plans/2026-07-17-kpi-info-tooltip.md`. Consolidou 4 componentes `Kpi`
  duplicados no `KpiCard` compartilhado (`size="compact"`). Sem ADR (feature de UI/copy, não
  mexe em regra de negócio nem cálculo financeiro).
- [x] **Bug crítico achado só em teste real no browser** (nenhuma das ~20 revisões de código
  estáticas pegou): clicar no ícone dentro de um card-link disparava a navegação mesmo assim —
  `stopPropagation()` sozinho não impede a navegação nativa do `<a>`. Fix: `preventDefault()` +
  `open` do popover controlado manualmente via `useState` (o Radix pula o próprio toggle ao ver
  `defaultPrevented`). Commit `2baada2`.
- [x] Fix de acessibilidade: painel "Encalhados" tinha `<button>` (ícone de info) dentro de
  outro `<button>` (toggle do filtro) — HTML inválido. Trocado por `<div role="button"
  tabIndex>` com `onKeyDown` para Enter/Espaço, preservando o toggle e a navegação por teclado.
  Commit `b9a922f`.
- [x] Validado ao vivo (Chrome real, logado) em todas as telas, desktop e mobile (390×844),
  dark e light. Suíte 201/201 arquivos, 1593/1593 testes, lint e tsc limpos. Merge direto em
  `main` (fast-forward, sem PR).

## Divergência de pipeline entre "Pedidos"/"Ticket médio"/"Faturamento" em Publicados vs. Dashboard/Faturamento — 2026-07-18

- [ ] **Achado durante o design do ícone de informação nos KPIs** (`docs/superpowers/specs/2026-07-17-kpi-info-tooltip-design.md`), não corrigido nesta entrega: `calcularResumo()` (`src/lib/resumo-vendas.ts`) filtra "faturável" por linha antes de agrupar em pack; `agruparPorPedido()` + `calcularKpisPedidos()` (`src/lib/pedidos-faturamento.ts`) filtra pelo status de uma linha representante do pack inteiro. Em packs com status misto (1 item cancelado + 1 pago no mesmo carrinho), os dois pipelines podem contar o pack de forma diferente — contradiz o que o ADR-0038 promete ("mesmo número em todas as telas"). Precisa de ADR próprio antes de unificar os pipelines.

## Título com metragem decimal fabricada ("71MT") — lote #65, bordados Búfalo — 2026-07-17

- [x] Diego reportou (screenshot) título confuso `BORDADO INGLES BUFALO T-007 13,7MT 71MT | 5CM
  LARGURA` — "71MT" não aparece em lugar nenhum da descrição. **Root cause confirmado com dados
  reais**: é o **lote #65** (o "#35" citado pelo Diego não existe mais na base — lotes 32-38 foram
  excluídos). `RE_METRAGEM` (`_shared/ai/titulo.ts`) parava na vírgula de metragens decimais
  (`nome_pai` com "C/13,71MT"), extraindo só a cauda ("71MT") como se fosse a metragem real;
  `garantirMetragemTitulo` injetava esse fragmento fabricado quando a IA já tinha escrito uma
  versão arredondada ("13,7MT") no título.
- [x] Fix: `RE_METRAGEM` e a extração do `numero` em `garantirMetragemTitulo` aceitam decimal com
  vírgula (`\d+(?:,\d+)?`). 2 testes de regressão em `titulo-clamp-metragem.test.ts`, grounded nos
  dados reais do lote #65. 1586/1586 testes verdes, lint limpo. Merge direto em main (fast-forward,
  sem PR — commit `ee97780`).
- [x] Confirmado no banco: 3 das 4 famílias de bordado do lote #65 têm o bug (`02851865`/TC-002,
  `02851903`/T-007, `02851890`/T-035); a 4ª (`02905310`/T-003) escapou por coincidência (a IA já
  tinha escrito a metragem decimal completa). **Nenhuma das 4 foi publicada no ML**
  (`publicado_em` null) — nada ao vivo com o título quebrado.
- [x] **2ª pergunta do Diego respondida** (atributo obrigatório faltando em 1 produto, não nos
  demais): confirmado — `02851903`/T-007 (a mesma família do título quebrado) está com
  `atributos_faltantes = ["Tipo de embalagem"]` (PACKAGING_TYPE), enquanto as 3 irmãs têm o campo
  preenchido. Não é "sem lastro no texto" (ADR-0052): a palavra "PECA" está no `nome_pai` dessa
  família tanto quanto na da irmã `02851865`, que preencheu certo — é inconsistência real da
  chamada de IA por família (`resolverAtributosGenericos`/`atributos-llm-core.ts`), cada uma
  independente, sem retry. Comportamento seguro (o gate bloqueia a publicação em vez de publicar
  faltando), mas não é 100% consistente. Fix não implementado — avaliar se vale um extrator
  determinístico (mesmo padrão de `THICKNESS`/`UNITS_PER_PACK`) ou retry na falha vazia.
- [x] **Deploy + reprocessamento real (mesma sessão):** deploy CLI das 3 functions afetadas
  (`process-familia` v99, `regenerar-copy-familia` v30, `publicar-split-ml` v26 — versões
  conferidas pós-deploy) e chamada de `regenerar-copy-familia` (mesma ação do botão "Regenerar
  copy" da Revisão, autenticado com a conta de validação) para as 3 famílias quebradas. **1ª
  rodada não saiu limpa**: sem o fragmento fabricado "71MT", mas com metragem duplicada de 3
  formas diferentes — `13,7MT 13,71MT` (TC-002), `13,7M 13,71MT` (T-007), e `13,71MT ... |
  13,7MT` (T-035, um caso à parte: a IA já duplicava sozinha, o guard antigo nem chegava a agir
  porque achava a metragem certa e parava sem notar a errada ao lado). Fix estendido:
  `garantirMetragemTitulo` agora remove TODA menção de metragem já no título antes de reanexar a
  correta (`RE_METRAGEM_TOKEN`, global), em vez de só checar presença. 3 testes novos com os
  títulos reais devolvidos pelo reprocessamento; 1589/1589 verdes, lint limpo. Redeploy das
  mesmas 3 functions + 2ª rodada de reprocessamento: os 3 saíram limpos (uma menção de "13,71MT"
  cada, confirmado no banco). Merge direto em main (commit `21a4da4`).
- [x] **Títulos validados por Diego na tela** (screenshot) — os 3 saíram corretos:
  `BORDADO INGLÊS BÚFALO TC-002 13,71MT BRANCO | 2,5CM LARGURA`,
  `BORDADO INGLÊS BÚFALO 13,71MT | 90% POLIÉSTER | VERSÁTIL 5CM` (T-007, perdeu o modelo no
  reprocessamento — variância normal da IA, não é bug de metragem),
  `BORDADO INGLES BUFALO T-035 13,71MT BRANCO | 10CM LARGURA`.
- [x] **Atributo "Tipo de embalagem" de `02851903`/T-007 resolvido** — Diego perguntou por que não
  tinha sido corrigido junto: `regenerar-copy-familia` só mexe em título/descrição, nunca em
  atributos (chamada de IA separada, só roda dentro do processamento completo). Preenchido via o
  editor manual de atributos (`atributos-familia` action `salvar` — mesmo caminho do "Complete
  para publicar" da Revisão, sem IA, sem exigir lastro no texto por ser o operador informando o
  dado real). `PACKAGING_TYPE = "Peça"` (mesmo valor da irmã `02851865`, mesma categoria/produto).
  `atributos_faltantes` zerado; `atributos_editados_pelo_operador = true` protege contra
  sobrescrita se a família for reprocessada de novo; `titulo_ml` intocado. **Lote #65: caso
  encerrado.**

## Catálogo ML — retry limitado para elegibilidade transitória — 2026-07-15

- [x] Corrigido o encerramento prematuro de `nao_elegivel`: decisão unificada por rodada e backoff
  limitado até ~3,3 dias, com alerta somente após o esgotamento.
- [x] A checagem ao vivo do `MLB4862137331` revelou um incidente sistêmico: ~1035
  variações afetadas desde 2026-06-17.
- [x] A revisão adversarial do plano pelo Codex encontrou e corrigiu um bug real de ordenação
  (`pendente` precisa preceder o reagendamento) antes de qualquer código ser escrito.

## ADR-0078 Fase 1 — controle de preço no UPDATE (badge + filtro "preço alterado", somente estoque) — 2026-07-15

- [x] Badge + filtro "preço alterado" na Revisão, coluna `variacoes.preco_publicado_ml`, escolha
  global "Atualizar tudo × Somente estoque" + override por produto — implementada na branch
  `worktree-preco-por-variacao-split`.
- [x] Validação/deploy — merged e em produção.

## ADR-0078 Fase 2a — split por faixa de preço (motor backend) — 2026-07-17

- [x] Motivador: ML passou a rejeitar publicação de famílias com preço divergente entre variações
  (`Found different prices in variations`) — incidente real em produção (PAI 02841240, 02841290).
- [x] `particionarPorPreco`, `decidirSplit`, `resolverConfigGrupo`/`agregarAtacadoStatus`, guards
  LOUD de uniformidade em `publish-familia-ml`/`update-familia-ml`, `publicar-split-ml` reescrito
  para particionar por preço (ancoragem preservada) — subagent-driven-development, 8 tasks, merge
  `0364878`, deploy em produção.
- [x] Validação real em produção (2026-07-17): reincluídas as cores excluídas em ambas as famílias
  do incidente e republicadas de fato. PAI 02841240 → 3 anúncios (Preto+Branco ancorados no
  original, Laranja e Verde Musgo novos, cada um no seu preço). PAI 02841290 → 2 anúncios (base
  ancorada + Verde Musgo novo). Todos `publicado`, sem erro.
- [x] **Fase 2b (UI: config por grupo de preço, badge por variação, LOUD no diálogo de publicação)** —
  2026-07-17, branch `preco-por-variacao-split-fase2b`, planejada em
  `docs/superpowers/plans/2026-07-17-preco-por-variacao-split-fase2b-ui-config-grupo.md`. Tipos
  `Variacao.exibirComDesconto/descontoPct/atacado` + `setDescontoGrupo`/`setAtacadoGrupo`; helpers
  puros `src/lib/grupos-preco.ts` (`gruposDePreco`, `alvosAplicarPreco`, `exigeDivisaoUpdate`,
  `configGrupoPendente`); badge "preço alterado" (`temAlteracaoPreco`) passou a comparar por
  variação em vez de colapsado por família; editar preço de 1 cor numa família com mais de 1 cor
  abre prompt "aplicar às demais?" ("Sim" replica/pina todas, "Não" salva só a cor e cria
  divergência de propósito); família divergente ganhou `ConfigGruposPreco` (desconto/atacado por
  faixa, grava `false`/`[]` explícito — nunca `null`) no lugar dos controles família-level
  bloqueados; botões de lote seguem bloqueados para famílias divergentes (só o aviso mudou);
  diálogo de publicação ganhou aviso LOUD para UPDATEs que exigiriam dividir um anúncio já
  publicado (aviso, não bloqueio — quem bloqueia é o backend da F2a). ADR-0078 status atualizado
  para "Aceito — implementado (F1+F2)". Review final de branch encontrou e corrigiu 2 achados
  reais (copy do prompt enganosa em UPDATE já publicado; LOUD do diálogo ignorava somente-estoque)
  antes do merge. Validado manualmente pelo Diego (dev server, passo a passo guiado) e mergeado em
  main (`39eefa0`) — **Fase 2 completa (backend + UI)**.
- [x] Follow-up flagado na revisão da Fase 2a: `update-familia-ml` tinha o mesmo bug de "limpar
  atacado bloqueado sem preço-base conhecido" já corrigido no `publicar-split-ml` (Task 7) —
  corrigido espelhando o mesmo padrão, revisado, mergeado (`da6b56d`) e deployado (2026-07-17).

## Menus multi-marketplace (spec 2026-07-14): registry de canais, tela /canais, CanalTabs global, canais por org — EM PRODUÇÃO (2026-07-15)

- [x] **Registry** `src/lib/canais.ts`: 5 marketplaces (Mercado Livre, Shopee, Magalu, Amazon,
  Casas Bahia); só ML `status: 'ativo'` — os demais são vitrine "em breve". `canaisOperaveis`/
  `canaisEmBreve` cruzam o registry com `organizations.canais_habilitados` (D5, híbrido).
- [x] **Canal ativo global** (`?canal=` + sessão, `parseCanalAtivo`/`useCanalAtivo`) + componentes
  `CanalBadge`/`CanalTabs` reutilizados em Dashboard, Publicados, Financeiro e Faturamento.
- [x] **Migration `20260715014055_menus_multicanal.sql`:** `organizations.canais_habilitados
  text[]` (default `'{mercado_livre}'`), `ml_vendas.canal text` (default `'mercado_livre'`, ainda
  fora do `select` de `buscarVendas`), RPC `canais_habilitados_da_org()` (`security definer`,
  `search_path=''`), backfill de `allowed_menus` com a chave `'canais'` para quem já tinha
  `'configuracoes'`.
- [x] **Tela `/canais`:** OAuth do Mercado Livre migrado de Configurações (que agora só redireciona
  os params `ml_conectado`/`ml_erro`); menu `canais` novo.
- [x] **Revisão:** seletor de canal dirigido pelo registry + `avisosCapabilities` (ex.: `tituloMax`
  60 do ML) + `canaisEfetivos`. `canais-ui.ts` (hard-code antigo) deletado.
- [x] **Edge `usuarios`:** action `set_canais_org` (super-admin, trava `mercado_livre` sempre
  habilitado), `canais_habilitados` no `list_orgs`, `'canais'` em `MENU_KEYS`.
- [x] **`/admin`:** editor de canais habilitados por organização.
- [x] **Dashboard:** chips de líquido por canal (mesmo rateio de frete do headline, ADR-0042) —
  visíveis só com >1 canal com dados.
- [x] Gate completo (`pnpm lint && pnpm test && pnpm build`) limpo — 186 arquivos/1477 testes.
  `deno check supabase/functions/usuarios/index.ts` **não roda** neste ambiente (bloqueado em
  `npm:@supabase/realtime-js`, pré-existente e alheio a este branch — sem sinal sobre o TS da
  função, não é validação, é ausência de validação).
- [x] **Validação do Diego:** browser local contra Supabase remoto (aviso de colunas pendentes) e,
  depois, contra banco local `db reset` (org + usuário admin sintéticos criados só para o teste,
  descartáveis). Aprovado.
- [x] **`supabase db reset` + `npm run db:check` local:** Docker subido sob demanda; reset aplicou
  as 52 migrations (incluindo a nova) sem erro; schema conferido direto no Postgres local
  (`organizations.canais_habilitados`, `ml_vendas.canal`, RPC `canais_habilitados_da_org`,
  backfill idempotente com 0 profiles locais — esperado, banco vazio).
- [x] **`supabase db push`:** migration aplicada em produção; `db:check` confirmou local=remoto.
- [x] **Deploy da edge `usuarios`:** **incidente pego no ato** — o 1º deploy usou por engano
  `--no-verify-jwt` (copiado de outro deploy da mesma sessão), sobrescrevendo o `verify_jwt=true`
  do `config.toml` (a `usuarios` autentica o chamador via `requireUser`, admin-only). Redeploy
  imediato sem a flag; confirmado `401` numa chamada sem `Authorization`. Ver
  `docs/reference/edge-functions.md`.
- [x] **Merge/push:** branch já continha os commits paralelos que entraram na main nesse meio-tempo
  (ADR-0055 ORIGEM, ADR-0075/0076 preço, fix mensagens 404 — zero overlap de arquivo); fast-forward
  puro `git push origin HEAD:main`. Render auto-deploy confirmado `live`
  (`ean2marketplace-frontend`, commit `6c15257`).
- [ ] **Follow-ups registrados (não bloqueiam — ficam para o E5/Shopee):** (a) incluir `canal` no
  `select` de `buscarVendas` quando fizer sentido explorar por canal nas telas; (b) título do
  dialog de publicação ainda diz "Publicar no Mercado Livre" — atualizar quando houver 2º canal;
  (c) sub-abas do Faturamento (Devoluções/Perguntas/Mensagens/Geografia) não recebem o parâmetro
  canal — hoje sem efeito (só ML tem dado), seam do E5.

## URGENTE: ingest-lote dropava ORIGEM → imposto sempre 8% (fix + deploy + backfill) — 2026-07-14

- [x] Diego reportou: planilha Velcro.xlsx com ORIGEM=IMPORTADO, mas família (lote 64, hoje)
  gravada como `nacional` → imposto 8% em vez de 16%. **Root cause:** `ingest-lote/index.ts`
  remontava cada linha num `PlanilhaRow` com whitelist de 14 campos e **omitia ORIGEM**; o parser
  lê `pai.ORIGEM` → chegava `undefined` → `normalizarOrigem` → `'nacional'` sempre. Desde o
  ADR-0055 (2026-07-03) toda ingestão virava nacional (o preview `extrair-itens` lia certo).
- [x] **Fix:** map extraído para `ingest-lote/mapear-linha.ts` (pura, testada) incluindo ORIGEM +
  teste de regressão que guarda contra drop silencioso de coluna. `deno check`/`deno lint` limpos.
  **Deploy isolado de `ingest-lote` em produção.**
- [x] **Backfill:** re-derivada `familias.origem` das planilhas (storage). Só **lotes 61 (10),
  63 (9) e 64 (7) = 26 famílias** tinham PAI IMPORTADO gravado como nacional → corrigidas. Demais
  lotes eram legitimamente nacional (planilha sem coluna ORIGEM ou PAI todo nacional).
  ⚠️ **Esta última frase estava errada** — ver 2026-08-07 abaixo: o backfill não leu os lotes
  48–60 e 62, e o Oxford (importado) ficou a 8% por mais três semanas.
- [x] **Re-preço:** origem corrigida não recalcula preço sozinha (ADR-0016). Reprocessadas só as
  **2 não publicadas** do lote 64 (aplicaram 16% + o frete iterado do ADR-0076). As **24
  publicadas** (lote 61: 10, 63: 9, 64: 5) o Diego **decidiu não reprecificar** — seguem ao vivo no
  ML na base 8%. A origem delas já está `importado`, então o 16% entra sozinho se um dia forem
  reprocessadas/republicadas. Reprecificar publicada = decisão de negócio + update de preço no ML
  (não é reprocesso), fora de escopo por ora.
- [x] **Trava inviolável (não pode mais acontecer):** `ingest-lote/verificar-origem.ts` — depois de
  agrupar, compara a `origem` montada com a ORIGEM **crua** da planilha (linha PAI, lida de
  `rowsRaw` ANTES de qualquer map). Divergiu → lança e **aborta o lote** (o catch marca 'erro'), sem
  persistir imposto errado. Lê a fonte crua de propósito (comparar com o dado já mapeado deixaria o
  próprio drop passar). 4 testes (incl. cadeia raw→mapearLinha→agruparPorPai e o caso de drop que
  aborta). Regra registrada como inviolável (imposto por origem, ADR-0055).

## Gross-up itera o frete por variação até estabilizar (ADR-0076) — 2026-07-14

- [x] Diego reportou: cor Laranja (família FITAS DE VELUDO) 🟡 "Abaixo do mínimo" **sem
  concorrência**. Verificado com tarifa real do ML (Redis): as 4 cores têm dimensões idênticas e
  são todas `proprio`; o preço 105,95 = `(piso 78 + frete 6,75)/(1−12%−8%)`. O frete família (6,75,
  avaliado no preço ~R$28 da cor mais barata) foi aplicado à Laranja, cujo preço cruza os ~R$79 —
  onde o frete real é 16,15. Líquido `105,95 − 12,71 − 16,15 = 77,09` < piso 78 (falta R$0,91). O
  gross-up de passada única (ADR-0050) subestima o frete ao trocar de faixa.
- [x] ADR-0076: no ramo próprio, o frete do gross-up passa a ser **por variação e iterado** até o
  preço estabilizar. Nova função pura `freteEstavelGrossUp` (`_shared/preco/sugerir.ts`) devolve o
  frete no preço convergido; `sugerirPrecoVenda`/`grossUp` inalterados. Wiring em `process-familia`
  (loop por variação, memoizado por piso+dimensões p/ não estourar chamadas em split ADR-0048;
  resiliente: falha de ML → frete família; competitivo/`estrategiaFamilia` inalterados). Laranja
  105,95 → ~117,70; cores abaixo de R$79 (frete flat) não mudam.
- [x] TDD: 4 casos novos em `sugerir.test.ts` (frete flat, cruza faixa, itera de verdade, respeita
  maxIter). `pnpm test` 1460/1460 (o único fail no run cheio é flaky pré-existente de
  `App.test.tsx` — passa isolado), `deno check` + `deno lint` limpos. **Só CREATE/reprocessamento**
  (ADR-0016): só muda ao reprocessar a família. **Deployado em produção + main (2026-07-14)**
  (process-familia redeployado), e as 2 famílias não publicadas do lote 64 reprocessadas com o
  frete iterado + 16% de imposto (Laranja 25mm: R$117,75 → R$134; cores < R$79 inalteradas).

## Análise para publicação por variação (seletor + semáforo por cor) — 2026-07-14

- [x] Diego reportou: numa família com variações de custos diferentes (ex.: FITAS DE VELUDO —
  Branco/Preto R$36,60 🟢, Verde Musgo R$45,95 🟢, Laranja R$105,95 🟡), o painel "Análise para
  publicação" só mostrava o detalhamento da variação mais barata (representativa). Não dava para
  avaliar cada cor sem inferir. O dado já era calculado por variação (o `SemaforoPreco` de cada
  `VariacaoCard` já roda `useTarifaML` por cor) — faltava só exibir.
- [x] Seletor de variação no `PainelAnalise` (só na Revisão — `precoOverride == null` — e com ≥2
  variações incluídas): troca `SemaforoPreco` + `CardVoceRecebe` para a cor escolhida. Default = a
  representativa (menor preço) → painel abre idêntico a hoje. Sem fetch novo (react-query deduplica
  a tarifa já buscada pela lista). Cada opção do dropdown mostra a bolinha do semáforo 🟢🟡🔴 da
  cor (pior→melhor: `SemaforoDot` reusa `calcularSemaforo`), com `title`/`aria-label`. Publicados
  (preço family-level) e família de 1 cor: inalterados.
- [x] Helpers puras extraídas em `src/lib/analise-viabilidade.ts` (`variacaoRepresentativa`,
  `propsAnaliseDaVariacao`) com teste novo (`src/lib/__tests__/analise-viabilidade.test.ts`).
  `pnpm test` (181/181 arquivos, 1456/1456 testes), `pnpm lint` (0 erros) e `tsc` limpos. Frontend
  only — sem edge functions, migrations, schema ou ADR (exibição de dado já existente). Diferido a
  pedido do Diego: sinal de pior-caso na linha da família (triagem da lista sem expandir).

## Piso de R$12,55 também no ramo competitivo (ADR-0075) — 2026-07-14

- [x] Diego reportou lote #34 (LINHA ANNE 65 65MT): estratégia COMPETITIVO publicou preço abaixo
  de R$12,55, faixa em que o ML cobra tarifa fixa adicional de ~50% (abismo do ADR-0023). O piso
  já existia, mas só no ramo PRÓPRIO (`grossUp`); o ramo COMPETITIVO (`sugerirPrecoVenda`) seguia
  mercado puro sem piso (ADR-0020), como já tinha sido tentado uma vez e revertido (ADR-0063).
- [x] ADR-0075: piso fixo de R$12,55 aplicado também no ramo competitivo, depois do desconto de
  concorrência e de uma eventual re-âncora de líder (ADR-0065) — nunca antes. Diferente do piso
  viável revertido no ADR-0063 (margem calculada por produto), é um valor fixo pequeno ancorado
  no limite mecânico real da tarifa do ML. Quando o piso decide o preço, o `motivo`
  (`estrategia_motivo`, já exibido na Revisão) sinaliza isso ao operador — sem selo/flag nova.
- [x] `supabase/functions/_shared/preco/sugerir.ts` + 7 casos novos/ajustados em
  `__tests__/sugerir.test.ts` (piso puro, borda no arredondamento, interação com re-âncora, ramo
  próprio inalterado). `pnpm test` (180/180 arquivos, 1450/1450 testes) e `pnpm lint`/`pnpm build`
  limpos. Sem mudança de schema/UI. Cobre CREATE e todo UPDATE que reprocesse a família (cor
  nova → IA); **não** cobre UPDATE sem cor nova, que herda o preço já publicado sem recalcular
  (ADR-0016) — anúncio já ao vivo abaixo de R$12,55 fica congelado até reprocessar a família ou
  o operador ajustar manualmente. Detalhe no ADR-0075.

## Telegram: nome real na venda + teste por destinatário — 2026-07-14

- [x] Diego reportou que a notificação de "Nova venda" no Telegram mostrava o nickname do ML
  (ex.: `LARROQUEKATIA...`) em vez do nome real. Causa raiz: `sync-venda/index.ts` montava o
  alerta com `pedido.buyer?.nickname` em vez do `comprador_nome` já resolvido por `upsertVenda`
  (first_name+last_name, com fallback pro nome salvo e pro destinatário do frete — mesmo campo
  que a tela de Vendas usa). Fix: `upsertVenda` passa a retornar `compradorNome`; `sync-venda` usa
  esse valor. Deploy de `sync-venda`, `reconciliar-faturamento`, `backfill-faturamento` (mudança
  em `_shared/`).
- [x] Diálogo "Notificações" (tela Usuários, ADR-0068) ganhou botão **Enviar teste** dentro da
  seção Categorias — testa o Chat ID digitado na hora, sem depender do Chat ID de Configurações
  (`monitorar-moderados` aceita `chatId` opcional no payload de teste) — e checkbox **Marcar
  todas** para (des)marcar as categorias de uma vez. Testado ponta a ponta em produção com
  destinatário real (Samuel Tavares).
- [x] `docs/how-to/operacoes-rotineiras.md` atualizado com o passo de teste inline.

## Fix: colisão de cor no Vision por sufixo "UND" no NOME — 2026-07-13

- [x] Diego reportou (print da tela de Revisão do lote #33) duas variações de fio com fotos
  visivelmente diferentes ("verde água claro" vs. "azul piscina") ambas com `cor = Azul Claro`.
  Investigação seguiu ADR-0004: a Camada 1 (dicionário) corretamente não lê `descricao_detalhado`
  (adendo 2026-06-12) — a causa não foi essa exclusão.
- [x] Causa raiz: `extrairCorECodigo` (`_shared/cor/extrair.ts`) contava o sufixo de unidade do
  fornecedor ("... COR UND") como palavra extra da cor, estourando `MAX_PALAVRAS_COR` e jogando
  o caso pro Vision (Camada 2). O `CORES_VALIDAS` do Vision (`_shared/ai/vision.ts`) tinha 23
  cores fixas desde a criação (28/mai) e nunca foi sincronizado com o crescimento do
  `DICIONARIO_CORES` (~49 cores) — sem bucket de água/turquesa, o modelo forçou os dois tons
  pro vizinho mais próximo disponível ("Azul Claro"), causando a colisão.
- [x] Fix: `extrairCorECodigo` descarta sufixo de unidade ao final (reusa `UNIDADES_METRAGEM`);
  `CORES_VALIDAS`/prompt do Vision ganharam `Turquesa`, `Petróleo`, `Azul Petróleo`. Teste de
  regressão em `extrair.test.ts`. Os 2 registros já processados do lote #33 (`03071979` →
  `Verde Água Claro`, `03075958` → `Azul Piscina`) foram corrigidos direto no banco
  (`cor_origem = manual`), já que o fix de código só evita recorrência.
- [x] PR: [#24](https://github.com/analistasistemas-bit/gtinmktplace/pull/24)

## Seleção de modelo de IA (texto/imagem) por organização — ADR-0074 — 2026-07-13

- [x] Diego pediu para escolher o modelo de IA de texto por organização direto na tela
  Configurações (incluindo `deepseek/deepseek-v4-flash` como opção nova, além do padrão
  `openai/gpt-4o-mini`) e reservar, na mesma tela, um seletor de modelo de imagem
  (`google/gemini-2.5-flash-image`, "Nano Banana") para uma feature de geração de imagem ainda
  não implementada. ADR-0074 escrito antes da implementação.
- [x] Migration `20260713120000_ai_model_por_org.sql`: `configuracoes.ai_model_texto`/
  `ai_model_imagem` (text, nullable, CHECK com lista curada). `NULL` → fallback `MODELO_COPY`/env.
  Sem RLS nova — `configuracoes` já é admin-only por org (`20260705165828_e7_rls_org.sql`).
- [x] Backend: novo `resolverModeloTexto(admin, orgId)` (`_shared/ai/modelos.ts`), com fallback
  seguro (nunca propaga erro). `tokens.ts::PRECOS` ganha `deepseek/deepseek-v4-flash`
  ($0,09/$0,18 por 1M tokens); `google/gemini-2.5-flash-image` fica fora de `PRECOS` (dormente,
  sem consumidor). As 4 funções de IA-texto (`gerarCopy`, `desempatarAtributosLLM`,
  `desempatarCategoriaLLM`, `sugerirResposta`) passam a aceitar `modelo` opcional em vez de ler a
  constante direto.
- [x] 5 edge functions passam a resolver o modelo da org antes de chamar IA: `process-familia`,
  `definir-categoria-familia`, `regenerar-copy-familia` (passou a selecionar `org_id` de
  `familias`), `sugerir-resposta-pergunta` (trocou `requireUser` por `requireUserOrg` — deixa de
  ser a única função autenticada sem escopo de org), `publicar-split-ml` (via novo campo
  `modelo?` em `OpcoesTituloParticao`, `titulo-particao.ts`).
- [x] Frontend: tela **Configurações** ganha card "Modelo de IA" com dois `Select` (texto/
  imagem), admin-only na UI (`disabled` + tooltip; enforcement real é a RLS), feedback
  "Salvando…"/"✓ Salvo". Novo `src/lib/ai-modelos.ts` (lista curada slug/label/preço para a UI);
  `queries.ts`/`useConfiguracoes.ts` ganham fetch/upsert/hooks seguindo o padrão já existente de
  `configuracoes`.
- [x] 180 arquivos de teste, 1432+ testes verdes; lint limpo. Revisão de spec compliance + code
  quality por task.
- [x] Migration aplicada em produção (`supabase db push`, autorizado por Diego); `database.types.ts`
  regenerado; cast temporário em `queries.ts` removido.
- [x] Deploy das 5 edge functions afetadas via CLI (`process-familia` v95,
  `definir-categoria-familia` v21, `regenerar-copy-familia` v29, `sugerir-resposta-pergunta` v9,
  `publicar-split-ml` v23 — versões conferidas pós-deploy). Frontend publicado automaticamente
  pelo auto-deploy do Render a partir do commit de merge na main (`dep-d9am1l647okc73atad7g`,
  status `live`). Feature completa e em produção.

## "N CORES" não sincronizava com UNITS_PER_PACK — lote #33, produto 02905078 (ADR-0073) — 2026-07-13

- [x] Bug reportado: lápis de cor "C/12 CORES" falhou no CREATE — ML: `"Unidades por kit": Insira
  um valor diferente de "1" porque você preencheu "Kit" no campo "Formato de venda"`. Caso inverso
  do ADR-0071 (mesmo lote, mesmo dia): a IA genérica preencheu `SALE_FORMAT=Kit` corretamente, mas
  `extrairUnitsPerPack` não reconhecia "CORES" como token de unidade (só `unidades/unid/und/un/
  pecas/pcs`) e `UNITS_PER_PACK` caiu no default `1`.
- [x] Confirmado via `execute_sql` (dados reais da família em erro no banco) antes de mexer no
  código — evitou repetir o erro de "corrigir sem ler os dados reais".
- [x] Fix: `RE_UNIDADES` (`_shared/categoria/atributos.ts`) aceita `cores` como token de unidade,
  reusando o `forcarSaleFormatKit` do ADR-0071 sem mudança adicional.
- [x] `pnpm test` (2 testes novos + suíte completa, 1437 testes — 1 flaky pré-existente em
  `App.test.tsx` não relacionado, passa isolado) e `pnpm lint` passando.

## Título duplicado — tipo de produto/cor fora de ordem — lote #33 (ADR-0072) — 2026-07-13

- [x] Bug reportado: dois títulos com duplicação visível — `POMPOM POM POM BÚFALO 14MM...` e
  `LÁPIS DE ESCREVER RESINA 7 VERDE REF.SL101066-8 VERDE 7`. Investigação (dados reais do lote
  #33 no banco) confirmou: não é qualidade de modelo de IA, é bug nos guards determinísticos de
  `_shared/ai/titulo.ts` que comparam frase inteira/mesma ordem para decidir "já está no título".
  1. `garantirTipoProdutoTitulo`: tipo "pompom" (colado) não batia contra título com "POM POM"
     (espaçado) → reprefixava.
  2. `garantirCorTitulo`: cor real "Verde 7" não batia contra nome com "...7 VERDE..." (ordem
     invertida) → reanexava a cor inteira de novo.
- [x] Fix: `todasPalavrasCobertas` (todas as palavras do termo, em qualquer ordem, já presentes)
  substitui a checagem de frase exata em `garantirCorTitulo`; `termoColadoNoTitulo` (fallback sem
  espaços) entra como OR na checagem de `garantirTipoProdutoTitulo`.
- [x] `pnpm test` (4 testes novos + suíte completa, 1435 testes), `deno lint`/`deno check`/eslint
  passando.

## Kit rejeitado no CREATE — SALE_FORMAT×UNITS_PER_PACK — lote #33 (ADR-0071) — 2026-07-13

- [x] Bug reportado: lápis de cor 24un falhou no CREATE — ML: `"Unidades por kit": Insira 1 porque
  você preencheu "Unidade" no campo "Formato de venda"`. Investigação (Graphify + ADR-0063 +
  testes existentes): `preencherUnitsPerPack` extraiu `UNITS_PER_PACK=24` de "24UND" no título
  (comportamento intencional desde o lote #27), mas a IA genérica de closed-set já tinha
  preenchido `SALE_FORMAT="Unidade"` sem saber da contagem — as duas lógicas rodam em sequência
  sem se comunicar.
- [x] Fix: `preencherUnitsPerPack` (`_shared/categoria/atributos.ts`) sobrescreve `SALE_FORMAT`
  para "Kit" (value_id do schema dinâmico da categoria) quando a contagem extraída é real (>1).
  Sem contagem clara (assume 1), não mexe em `SALE_FORMAT`.
- [x] `pnpm test` (5 testes novos + suíte completa, 1431 testes) e `pnpm lint` passando.

## Título com sinônimo de tipo de fio errado — lote #63 "Linha Cléa" (ADR-0070) — 2026-07-13

- [x] Bug reportado: título gerado "FIO CLÉA 1000..." quando a descrição diz "Linha Cléa" —
  investigação em produção achou 2 famílias reais do lote 63 (`L.CLEA 1000`, `CLEA DUPLO`) com o
  mesmo bug e confirmou por que os guards existentes (ADR-0054) não pegam: "fio" e "linha" aparecem
  os dois, literalmente, na `descricao_pai` — ambos "grounded", a IA só escolhe o errado às vezes.
- [x] `tipo_aviamento` descartado como critério de correção: categoria ML (`Fios e Cadarços`)
  mistura barbante/fio/linha legítimos; canonicalizar por ali reverteria a cravação de "BARBANTE"
  no EUROROMA (ADR-0054) e trocaria títulos corretos como "FIO NAUTICO" por "LINHA NAUTICO".
- [x] Fix: `garantirTipoFioTitulo` (`_shared/ai/titulo.ts`) corrige a 1ª palavra do título quando é
  um sinônimo (linha/fio/barbante) diferente do que `nome_pai` já declara por extenso ou pela
  abreviação `"L."` (`L.CLEA` = Linha Cléa). Sem sinal em `nome_pai` → não mexe. Encadeado nos 3
  pontos que montam título (`process-familia`, `regenerar-copy-familia`, `titulo-particao.ts`),
  sempre depois de `garantirTipoProdutoTitulo` (ordem importa — ver ADR-0070).
- [x] `pnpm test` (7 testes novos + suíte completa) e `pnpm lint` passando.
- [ ] Pendência operacional (não corrigida automaticamente): as 2 famílias reais do lote 63 com
  título errado seguem com "FIO" no banco/ML — regenerar copy manualmente se quiser corrigi-las.

## Roadmap estratégico v2 — revisão CTO do relatório de evolução do produto — 2026-07-12

- [x] Revisão crítica de `Sugestões para Evolução do Produto.md` (50 funcionalidades) sob a ótica
  de founder/head of product/arquiteto/PMF/growth/VC/estratégia competitiva — questionou a
  priorização por Score Final e reorganizou por DAG de dependências + fases de construção da
  empresa.
- [x] Principais correções de sequenciamento: **Shopee** antecipado para trilha paralela (E6 já
  paga a infra do worker genérico `publicar-anuncio`); **billing** reduzido a escopo mínimo viável
  (assinar/cobrar/suspender) com venda manual assistida em paralelo aos primeiros design partners;
  **telemetria de IA** promovida à Fase 0 (packs verticais, benchmark, autopilot e digital twin
  dependem de coleta iniciada desde já).
- [x] Nova funcionalidade **51 — Dashboard Executivo "Mission Control"** (ausente do backlog
  original): primeira tela do sistema, agrega anúncios com erro, produtos sem margem, integrações
  offline, jobs com falha, vendas, margem, caixa e ações prioritárias.
- [x] Documento entregue em `docs/Roadmap-Estrategico-PubliAI-v2.md` (11 etapas: revisão crítica,
  DAG, categorização, tabela mestra com 14 campos por funcionalidade, teste dos 30 dias, matriz de
  desbloqueio, matriz de ROI, roadmap em 8 fases, 3 roadmaps por lente — técnico/comercial/
  estratégico —, seção "Se eu fosse o fundador" e respostas objetivas finais).
- [x] Mergeado via PR #15 (`e5a811c`).

## Liveness ML — gap do refresh de token (ADR-0069, plano 040) — 2026-07-12

- [x] Gap conhecido documentado em `docs/reference/edge-functions.md`: `classificarErroML`
  (ADR-0069) só olhava status HTTP, então `POST /oauth/token` respondendo **400** com
  `refresh_token` revogado (ADR-0012) nunca alertava (caía em `transiente`).
- [x] Fix cirúrgico: `postToken` (`_shared/ml/token.ts`) parseia o corpo de erro e extrai o campo
  OAuth2 `error` (RFC 6749 §5.2); `MLApiError` ganha `oauthError`; `classificarErroML` trata
  `oauthError === 'invalid_grant'` como `permanente-auth` mesmo com status 400 — sem generalizar
  para qualquer 400 (preserva o caso benigno da corrida de refresh do ADR-0012 como `transiente`).
  4 workers (`sync-venda/pergunta/devolucao`, `reconciliar-faturamento`) passam `oauthError` no
  catch do token (nunca no catch do fetch de recurso — confirmado que `buscarPedido`/
  `buscarPergunta`/`buscarClaim` nunca populam esse campo).
- [x] Testes: 4 casos novos em `erro-ml.test.ts` (400 puro segue `transiente`; 400+`invalid_grant`
  → `permanente-auth`; 400+`invalid_client` segue `transiente`; 401+`invalid_grant` →
  `permanente-auth`). `pnpm test` (1420/1420), `deno lint`/`deno check`/`pnpm build` limpos.
- [ ] **Pendência aceita:** o formato real do corpo de erro do ML para `invalid_grant` nunca foi
  observado ao vivo (só documentado pela RFC) — pior caso se divergir é `oauthError` ficar `null`
  e o comportamento continuar idêntico ao pré-fix. Confirma organicamente na 1ª revogação real.

## Auditoria `improve` rodada 3 — mensagens pós-venda (planos 034-038) — 2026-07-12

- [x] Nova auditoria pós-017-033 na superfície ADR-0067/0068: sem IDOR cross-tenant (classe do
  plano 017 não regrediu). Planos 034-038 escritos (`plans/README.md`).
- [x] **034 — testes de caracterização** do fluxo de mensagens antes de mexer nele. +12 testes.
- [x] **035 — fix real: follow-ups de mensagens nunca sincronizavam em tempo real** (dedup
  pack-level no `ml-webhook` bloqueava tudo após a 1ª mensagem da conversa). Alerta migrado para
  `notificarCategoria('mensagens', ...)`. Ver acima e [[Problemas Resolvidos]].
- [x] **036 — perf: badge do menu via RPC** `contar_conversas_aguardando()` em vez de baixar
  `ml_mensagens` inteira no browser.
- [x] **037 — hardening (5 itens):** revoke de `grant all` p/ `anon` em `ml_mensagens`; validação de
  `pack_id`; nulls não decidem mais o badge; race de contagem dupla em `upsertMensagens` eliminada;
  guard de super-admin em `usuarios`.
- [x] Todas as 3 migrations aplicadas em produção; `ml-webhook`, `sync-mensagem`, `usuarios`,
  `responder-mensagem`, `backfill-faturamento` redeployadas. Testes 177/177, lint/deno check/build
  limpos em cada merge.
- [ ] **Pendências (Diego):** plano 038 (design de liveness de integração — spike 032 → ADR) depende
  de decisão sobre 4 questões abertas; confirmar topic `messages` habilitado no DevCenter ML (ver
  item acima).

## Notificações Telegram por destinatário e categoria — ADR-0068 — 2026-07-11

- [x] Antes: 1 chat_id por org (`configuracoes.telegram_chat_id`) recebia tudo — só o super-admin.
  Agora cada usuário cadastrado pode receber, e o admin escolhe quem recebe quais **categorias**
  (Vendas, Perguntas, Pós-venda, Financeiro, Moderação).
- [x] Schema: `profiles.telegram_chat_id` + `telegram_categorias text[]` (CHECK das 5 categorias);
  bot/token continuam por org. Backfill preserva quem recebe hoje (`configuracoes.user_id` → profile,
  todas as categorias) — verificado read-only que a única org ativa resolve.
- [x] Backend: `notificarCategoria(admin, orgId, categoria, texto)` (`_shared/notificacoes/config.ts`)
  resolve destinatários e envia; os 6 call sites (sync-venda/pergunta/devolucao, notificar-liberacao,
  monitorar-moderados, vincular-catalogo) passam a informar sua categoria. `vincular-catalogo` deixou
  de ler config inline por `user_id` (legado) e usa `notificarCategoria` por `org_id`.
- [x] UI: tela **Usuários** ganha coluna Notificações + dialog (Chat ID + checkboxes), via edge
  function `usuarios` ação `update_notificacoes` (sanitiza chat_id numérico e categorias). Campo Chat
  ID em Configurações relabelado para "teste de conexão".
- [x] Validado end-to-end no browser (Playwright, Supabase local): login → editar → salvar →
  persistência → re-render das badges; trust-boundary (chat inválido → 400); migration + CHECK.
  Testes verdes (novos: `sanitizarDestinatario`, `notificarCategoria`, `lerDestinatarios`), lint +
  deno check + build ok.

## Mensagens pós-venda do ML: canal invisível no PubliAI ganha ingestão + aba — ADR-0067 — 2026-07-11

- [x] Diego reportou que uma mensagem do comprador (chat pós-venda, "preciso de mais 50m…") não
  aparecia no PubliAI. Investigação: é outro canal — a aba Perguntas só ingere perguntas pré-venda
  (`/questions`); mensagens pós-venda vivem em `/messages/packs` e não eram ingeridas (webhook não
  escutava o topic `messages`; único uso de `/messages` era o envio de boas-vindas).
- [x] ADR-0067 escrito. Implementado espelhando o fluxo de Perguntas: migration `ml_mensagens` +
  RLS + RPC `marcar_mensagens_lidas`; mapper puro + IO com testes; worker `sync-mensagem`
  (QStash); rota `messages` no `ml-webhook` (extrai `pack_id` do resource, não o seller);
  `backfill-faturamento` passo 4 (puxa mensagens dos packs); `responder-mensagem` (≤350 chars,
  variante que lança); front: lib/hook/aba-mensagens + badge de não-lidas; alerta Telegram.
- [x] Verificação: lint 0 erros, vitest 1306 verdes, tsc front limpo, deno check nas 4 functions.
  Validado em runtime no Supabase local via Playwright — a aba renderiza a conversa da Anne Marie,
  badge "1", pill "não lida", caixa de resposta; RPC de marcar-lida grava no DB (RLS-scoped).
- [x] Migration validada aplicando-a **limpa** (drop + re-run) e revalidando pelo browser sem
  nenhum grant manual — os `grant` de tabela estão explícitos no arquivo (não dependem de default
  privileges), espelhando o grant explícito da RPC.
- [x] **Migration + deploy em prod** — feito (sessão 2026-07-12).
- [x] **Dedup do pack-level corrigido (plano 035, 2026-07-12)** — confirmado que o resource É
  pack-level (`/messages/packs/{pack}/sellers/{seller}`, idêntico p/ toda a conversa); a 2ª mensagem
  em diante realmente dedupava e nunca reenfileirava (bug real, não hipotético — o "Sincronizar"
  mitigava só a UI, sem alertar). Fix: `sync-mensagem` apaga a linha de dedup ao processar (reabre
  para a próxima mensagem); webhook reenfileira job perdido (linha órfã >2min). Ver
  [[Problemas Resolvidos]] no vault.
- [ ] **Pendências (Diego):** confirmar se o topic `messages` está habilitado no DevCenter ML — até
  2026-07-12 nenhum evento `messages` real chegou em `ml_webhook_eventos` (0 linhas), então o parse
  defensivo do resource (`/messages/packs/{pack}/sellers/{seller}`) segue **não confirmado com
  tráfego real de produção** — só com o backfill/"Sincronizar". Validar no 1º webhook real.

## Cor "Outra" vazando: gap no UPDATE ao vivo + remediação de 15 anúncios já publicados — ADR-0044 — 2026-07-10

- [x] Diego reportou "OUTRA" no título de um produto ainda não publicado (screenshot). Investigação:
  não é regressão do fix desta manhã (`ehCorIndefinida`, TASKS.md 11:16) — é dado processado 3h34min
  ANTES do fix, nunca reprocessado (título/descrição só são calculados no processamento, não no publish).
- [x] Levantamento no banco achou alcance bem maior: **15 famílias** afetadas, **14 já publicadas no
  ML** (9 com "OUTRA" no título, todas com "- Outra" na lista de cores da descrição), retroagindo a
  **12/06** — quase um mês, não só o "lote #31" de hoje. Uma delas publicou hoje **18:20, depois** do
  fix, porque publicar reusa texto já persistido.
- [x] Achado ativo (não só dado velho): `update-familia-ml` (fluxo de UPDATE em anúncio já publicado)
  filtrava só `cor != null` na lista de cores da descrição, sem excluir `'Outra'` — o mesmo bug,
  caminho diferente, ainda live. Fix: filtro `ehCorIndefinida()` + `atualizarSecaoCores` agora remove
  a seção de cores inteira quando não sobra nenhuma cor real (antes deixava cabeçalho pendurado vazio).
- [x] Gap adicional: não existia mecanismo para corrigir **título** de anúncio já publicado (só
  descrição). Nova `atualizarTituloML()` (`ml/atualizar-item.ts`), PUT parcial `{title}`.
- [x] Remediação retroativa: título+descrição corrigidos no banco para as 15 famílias e
  ressincronizados no ML (`atualizarTituloML`/`garantirDescricaoML`) para as 14 já publicadas,
  priorizando as 9 com "OUTRA" no título. Ver detalhe/resultado no ADR-0044 (adendo).
- [x] Testes: `descricao.test.ts` (+1, lista vazia remove seção); 1298 verdes, lint limpo, deno check ok.

## Publish voltou a segundos: pré-upload da foto tira a propagação do ML do caminho crítico — ADR-0033 — 2026-07-10

- [x] Regressão do dia: publish de 1 foto passou a levar >5 min (era segundos). Causa: o adendo da
  manhã deixou a espera da propagação da foto (~2,5–5 min) NO caminho crítico do publish — o `subirFoto`
  rodava dentro do worker, então todo publish falhava com `item.pictures.unavailable` e esperava os
  `retryDelay` de 90s. Confirmado em logs reais do QStash (`CREATED→DELIVERED` ~6 min, 4–5 retries).
  Amplificado pela fila serial (`parallelism:1`): lote de N = N×6 min.
- [x] **Etapa 0 (mitigação):** `RETRY_DELAY_PUBLICACAO_ML` 90s→30s, `RETRIES_PUBLICACAO_ML` 5→10,
  `MAX_RETRIES_TRANSIENTES` 5→10 — granularidade fina, vira rede de segurança.
- [x] **Etapa 1 (fix real):** pré-upload das fotos no `process-familia`
  (`_shared/anuncios/pre-subir-fotos.ts`) → propagação corre antes do publish → `POST /items` de
  primeira, em segundos. + invalidação do `*_ml_picture_id` na troca/remoção de foto
  (`upload-imagens-lote/processar.ts`, `src/lib/upload-imagens.ts`) — evita publicar foto velha
  cacheada; corrige bug latente do UPDATE. Testes: `retry.test.ts` (boundary 10) + novo
  `pre-subir-fotos.test.ts`. `pnpm lint`/`pnpm test` (1297) e `deno check` verdes.
- [x] Deploy: `publicar-familias`, `publish-familia-ml`, `update-familia-ml`, `publicar-split-ml`,
  `process-familia`, `upload-imagens-lote`.

## Editor manual de atributos travava MATERIAL em closed-set (Pingentes, lote #31, PAI 02954524) — ADR-0052 — 2026-07-10

- [x] Diego: dropdown "Complete para publicar" só oferecia Alpaca/Ouro/Prata/Vidro (sugestões do ML),
  sem opção de digitar "100% Poliéster". Mesmo bug do fix desta manhã (`MATERIAL` é `value_type=string`,
  texto-livre — os values que acompanham são sugestão, não lista fechada), mas o fix de hoje cedo só
  cobriu o preenchimento por IA (`atributos-llm-core.ts`); `tipoDe` em
  `_shared/categoria/faltantes-editaveis.ts` (editor manual, mesmo cálculo duplicado) não tinha recebido
  a correção. Fix: mesma checagem `valueType === 'string' → texto`, antes de olhar `valores.length`. +2
  testes (`faltantesEditaveis` classifica como texto; `validarValorAtributo` aceita valor fora das
  sugestões). 762 testes verdes (`_shared`), lint limpo. Deploy: `atributos-familia` v7. **Confirmado
  end-to-end**: Diego digitou "100% Poliester" no campo (agora texto-livre), família publicou sem
  intervenção adicional (`MLB4875907185`).

## Publicação travada por `item.pictures.unavailable` — race de propagação da foto no ML (lote #31) — ADR-0033 — 2026-07-10

- [x] Diego: publicação do lápis (PAI 02844281) falhando 2× com "Problema nas fotos... Ocorreu um erro
  ao processar a foto. Por favor, envie-a novamente.". **Investigação sistemática (skill debug), causa
  raiz reproduzida via `POST /items/validate` com o token real da conta:** a foto NÃO estava com defeito
  — `POST /pictures` (source URL) deixa a picture `ACTIVE` em ~2s, mas o ML só a torna **utilizável no
  `POST /items` após MINUTOS** (varia: ~142s numa amostra isolada, ~5 min na publicação real de
  confirmação); antes disso devolve `item.pictures.unavailable`. O publish criava
  o item quase imediatamente e a cobertura de retry (interno 12s + QStash 3×10s ≈ 42s) **não alcançava**
  essa janela → erro sempre. Produto de 1 variação (1 foto) não tinha folga; multi-cor (ex.: FIO CHARME, 12
  fotos) escapava porque subir várias fotos já consumia o tempo de propagação. A mensagem "envie
  novamente" é cilada: re-upar cria nova picture e **reinicia** o relógio de propagação.
- [x] Hipótese inicial ("picture envenenada/terminal") **refutada** por evidência: `GET /pictures/{id}`
  mostrou as pictures `ACTIVE` com todas as variations. O commit que descartava o `picture_id` ao errar
  (baseado nessa hipótese) foi **revertido** — descartar PIORA (reinicia a propagação).
- [x] Fix (raiz): reusar o mesmo `picture_id` (não re-subir) e dar ao QStash tempo de cobrir a
  propagação. `queue.ts`: `retryDelay` 10s→90s e `retries` 3→5 nas escritas ML (cobre ~7,5 min);
  `retry.ts`: `MAX_RETRIES_TRANSIENTES` 3→5; `publish-familia-ml`: removido o retry interno de 12s
  (inútil — a foto leva minutos). 1289 testes verdes, lint limpo. Deploy: `publicar-familias`,
  `publish-familia-ml`. **Confirmado end-to-end**: republicação real do lote #31 com foto NOVA (cenário
  que quebrava) → QStash retentou reusando o mesmo picture_id e **publicou** (item `MLB4875716733`,
  após ~6 min de retries, sem intervenção manual). A margem generosa (5×90s) absorveu a propagação de
  ~5 min desta foto.
- [x] Estendido a UPDATE e split (mesma race, encontrada na revisão): `update-familia-ml` e
  `publicar-split-ml` só retentavam `5xx/429` — o erro de foto (`400` retentável) caía em erro definitivo.
  Novo `decidirRetryTransitorio` (`publicacao/retry.ts`); ambos passaram a propagar `retentavel` ao lançar
  e a retentar a foto via QStash reusando o `picture_id`; removido o retry interno de 12s do split. No
  UPDATE, a limpeza `ml_picture_id=null` (fallback p/ "Picture id does not exist") foi movida para SÓ
  após esgotar os retries — antes rodava a cada erro e reiniciava o relógio de propagação. +2 testes;
  deploy `update-familia-ml` v42, `publicar-split-ml` v13.

## Cor `Outra` (veredito do Vision) vazava para título e descrição do anúncio (lote #31) — ADR-0044 — 2026-07-10

- [x] Diego reportou "OUTRA" no título e na descrição de um anúncio sem cor real
  (`LÁPIS COMUM FANTASIA POTE C/72UND OUTRA`, PAI 02844281, pote multicolorido). Causa raiz:
  `'Outra'` é o veredito do Vision para "não identifiquei a cor" (dúvida/multicolor; ver `ai/vision.ts`,
  regra 3 do prompt), mas era tratado como cor real. O guard de `garantirCorTitulo` (`ai/titulo.ts`) só
  barrava o placeholder `(sem cor identificada)`, não `'Outra'` → cravava "OUTRA" no título; e
  `montarUserPrompt` (`ai/copywriter-prompt.ts`) listava `- Outra` em "Cores disponíveis" → a IA
  copywriter escrevia "Outra" na descrição. Divergência de sentinelas (placeholder tratado, `'Outra'`
  esquecido). Fix de raiz: predicado único `ehCorIndefinida()` em `_shared/cor/indefinida.ts` que
  reconhece os sentinelas de "não é cor real" (`'Outra'` e o placeholder), consumido em dois pontos:
  título (`garantirCorTitulo` não crava cor indefinida) e descrição (`montarUserPrompt` só lista cores
  reais; sem nenhuma cor real, o prompt manda a IA OMITIR a seção 🎨 CORES DISPONÍVEIS — nunca listar
  placeholder). Cobre os dois fluxos de persistência (ADR-0044): `process-familia` e
  `regenerar-copy-familia`. `vision.ts` intocado — `'Outra'` segue como sinal de validação manual na
  Revisão, só não vaza para o anúncio. +5 testes (`titulo-cor`, `copywriter-prompt`); 1289 verdes,
  lint limpo. Deploy: `process-familia` v86, `regenerar-copy-familia` v24. Lote #31: copy regenerada.

## Atributo `string` com valores sugeridos tratado como closed-set (Material faltante nos Pingentes, lote #31) — ADR-0052 (adendo) — 2026-07-10

- [x] Diego reportou "Atributos obrigatórios faltando: Material" em dois pingentes búfalo
  (PAI 02954524 e 02954818, categoria Pingentes MLB7017). Causa raiz: `MATERIAL` é
  `value_type=string` (texto-livre no ML) com 4 valores *sugeridos*; `tipoAlvo`
  (`atributos-llm-core.ts`) classificava por `valores.length>0` antes de `valueType`, tratando o
  atributo como closed-set estrito — a IA só podia escolher entre as sugestões e a regra de ouro
  (`validarTextoLivre`, ADR-0052) nunca rodava, descartando "poliéster" que constava na descrição
  do 14,5cm. Fix: `value_type=string` é sempre texto-livre (values são sugestão, não lista
  fechada) → passa pela regra de ouro. +4 casos em `atributos-llm.test.ts` (203 verdes no conjunto
  ai+categoria), lint limpo. Ver adendo 2026-07-10 no
  [ADR-0052](decisions/0052-camada2-atributos-ia-first-com-fallback.md). Deploy confirmado
  (`process-familia` v84, `definir-categoria-familia` v15). Lote #31: 02954818 resolvido
  (Material=Poliéster, ajustado direto no banco — família não publicada); 02954524 fica no fallback
  manual da Revisão (descrição de origem sem material; ADR-0052 impede a IA de inventar). Commit
  `701bb6a`.

## Atributo numérico "WEIGHT" inventado pela IA (peso errado no ML, lote #30) — ADR-0049 (adendo) — 2026-07-09

- [x] Diego reportou peso errado na ficha técnica do anúncio do lote #30 (tecido, "Peso:
  120 g" no ML) mesmo com `PESO_GRAMAS=660` correto e igual em todas as 10 variações na
  planilha/banco. Confirmado via banco: **não é** o peso de frete (`SELLER_PACKAGE_WEIGHT`,
  que estava correto em 660g) — é o atributo de ficha técnica `WEIGHT` em `atributos_ml`,
  preenchido por IA, sem qualquer relação com `peso_gramas`. Causa raiz: `validarNumerico`
  (`atributos-llm-core.ts`) só validava formato do número que a IA extraía, sem checar se
  o número constava no título/descrição — ao contrário do texto-livre, que já tem essa trava
  desde o ADR-0052. O título do lote #30 não menciona peso nenhum; a IA "chutou" 120g
  (gramatura plausível de tecido leve) e passou pela validação.
  Fix: `validarRespostaAtributos` (numérico) agora exige grounding no nome/descrição, mesma
  invariante do texto-livre — fecha a lacuna para qualquer atributo numérico opcional, não só
  `WEIGHT`. Ver adendo 2026-07-09 no [ADR-0049](decisions/0049-atributos-opcionais-e-numericos-por-ia.md).
  1279 testes verdes (36 novos/ajustados em `atributos-llm.test.ts`). Deploy confirmado
  (`process-familia` v83, `definir-categoria-familia` v14). Anúncio já publicado
  (MLB7132904138) corrigido manualmente por Diego no painel do ML — sem pendência.

## Markup do Faturamento divergia do Dashboard/Publicados/Financeiro — 2026-07-09

- [x] Diego notou +38% no Faturamento › Vendas vs. +37% no Dashboard/Publicados/Financeiro,
  mesmos 187 pedidos/382 unidades (confirmado ao vivo via browser-use, descartando filtro/período).
  Causa: `custoDaVenda` (`resumo-vendas.ts`, usada por Dashboard/Publicados/Financeiro) somava o
  custo bruto de todos os itens do pedido e arredondava 1x no final; `custoDoItem`
  (`pedidos-faturamento.ts`, Faturamento — a "fonte da verdade" segundo o próprio comentário do
  código) arredonda por ITEM antes de somar. Como `variacoes.custo` é `numeric` sem escala fixa,
  pedidos multi-item (média 2 itens/pedido) acumulavam centavos de diferença entre os dois
  caminhos, suficiente pra deslocar o markup agregado em pontos percentuais inteiros. Fix:
  `custoDaVenda` também arredonda por item. 1 teste de regressão novo, 1277 testes verdes.
  Só frontend, sem migration/edge function.

## Financeiro > Detalhe do líquido: "Líquido" não pode descontar imposto — 2026-07-09

- [x] Diego reportou pedido com R$ 38,15 recebidos no MP aparecendo como R$ 31,75 na tabela.
  Causa: a tela tinha dois cálculos de "líquido" coexistindo (banner sem imposto, tabela com
  imposto descontado). Fix escopado só ao Financeiro (ADR-0066, refina ADR-0055): "Líquido"
  nunca desconta imposto (bate com o MP); "Markup" continua líquido de imposto. Faturamento >
  Vendas e Publicados > Detalhe de vendas inalterados. Ver [[Changelog]] 2026-07-09.

## Dicionário de cores — sinônimos e compostos faltando (lote #30) — 2026-07-09

- [x] **Lote #30 (Tecido Helanca Light):** não era violação da regra "descrição vs Vision"
  (ADR-0004 — a Camada 1 já lê corretamente `nome`/`nome_pai`, exclui a descrição de
  propósito). Duas falhas de cobertura do dicionário: (1) `Champagne` e `Marfin` (sinônimos
  de Bege) ausentes, caíam no fallback Vision gastando chamada de IA à toa; (2) `Azul
  Petróleo` e `Cinza Médio` casavam só no sinônimo curto já cadastrado (`Petróleo`, `Cinza`)
  e perdiam o qualificador, sem cair no Vision (achava uma cor "válida", mas menos precisa).
  Fix: 4 sinônimos/compostos novos em `dicionario.ts`, seguindo o precedente já usado
  (`Azul Royal`, `Rosa Pink`, `Cinza Claro/Escuro`). 1265 testes verdes (4 regressões novas);
  deploy `process-familia` (v80).
- [x] **Auditoria dos 10 códigos do lote #30** (não só os 5 visíveis na tela) achou mais 2
  casos do mesmo bug: `Amarelo Canário` → `Amarelo` e `Roxo Médio` → `Roxo`. +2 compostos no
  dicionário, +2 regressões (1263 testes verdes), redeploy `process-familia` (v81). Como o
  lote já estava ingerido (status `pronto`, ainda não publicado), as 6 variações afetadas
  foram corrigidas direto no banco (`UPDATE variacoes SET cor=…`, só onde
  `cor_editada_pelo_operador=false`) em vez de reprocessar a família inteira.
- [x] **Inconsistência no fix 1:** `Champagne`/`Marfin` tinham virado sinônimo de `Bege`
  (colapsava pro genérico) em vez de cor própria, ao contrário do critério usado pros outros 4
  compostos (preservar o nome que o fornecedor deu). Diego notou pela tela — `Bege` continuava
  igual. Corrigido: `Champagne` e `Marfim` (normaliza "Marfin" → "Marfim") viram cores
  canônicas próprias. Redeploy `process-familia` (v82); `variacoes.cor` do lote #30 atualizado
  de novo pros 2 códigos. As 10 variações do lote agora preservam o nome específico do
  fornecedor de ponta a ponta.

## Preço ancorado no maior vendedor MercadoLíder ao dar prejuízo — ADR-0065 — 2026-07-08

- [x] **Regra:** no CREATE, quando o preço competitivo de uma família dá prejuízo real
  (líquido Clássico < custo), re-ancora no preço do concorrente **MercadoLíder com mais
  vendas** (empate → menor preço; vendedor em várias cores → menor preço dele) em vez do
  menor preço global (frequentemente vendedor sem nota/sem imposto). Gated por toggle
  `configuracoes.reancora_lider_ativa` (Configurações); sinalizado por
  `familias.preco_reancorado_lider` + selo "COMPETITIVO · âncora líder" na Revisão.
  Nunca sobe acima do preço-âncora nem faz gross-up no ramo competitivo — não repete o
  "piso viável" revertido em `e6dee14` (2026-07-06). Novas funções puras
  `precoLiderMaisVendas`/`calcularPrecoLiderMaisVendas` (`_shared/preco/piso-lider.ts`) e
  `liquidoClassico` (`_shared/preco/liquido.ts`). 1264 testes verdes; `pnpm build` ok.
  Validado ao vivo (família Anne 500m, lote #28): reancorou para R$29,98 (vendedor de
  61.706 vendas) em vez do menor preço entre líderes (R$22,50, 13.180 vendas) — a 1ª
  versão da regra usava "menor preço entre líderes"; corrigida para "mais vendas" após o
  Diego notar a divergência (`main` 092e8cb).

## Concorrência agregada por variação (lote #28) — ADR-0064 — 2026-07-08

- [x] **Lote #28 (Anne 500m):** `buscarConcorrencia` parava no 1º GTIN que casasse no
  catálogo — falso para famílias cujas cores são produtos de catálogo distintos, reportava
  o preço de UMA cor (R$32,90) como se fosse o menor preço da família toda (havia cores a
  R$22,39). Corrigido: resolve TODOS os GTINs válidos em paralelo (pool 6, cap 60) e agrega
  via `agregarConcorrencia` (menor preço global, união de vendedores, representativo = mais
  barato); negative caching (tombstone) evita refazer buscas a cada reprocess; falha
  parcial de rede degrada para os hits em cache em vez de zerar tudo. Verificado ao vivo
  contra o ML (44 GTINs → min real R$22,39). Deploy: `process-familia`,
  `analisar-viabilidade` (`main` 78110a1).
- [x] **Bônus (mesmo lote):** IA de copy inventava "NOVO" no título (alucinação de
  marketing, não coberta pela regra anti-alucinação original). Guard determinístico
  `removerMarketingNaoGrounded` remove termos de marketing que não constam na fonte
  (nome/descrição) — prompt sozinho não bastava (reincidiu num reprocesso mesmo já
  deployado). Encadeado em `process-familia`, `regenerar-copy-familia`, split
  (`main` 1dd6898).

## Categoria genérica (BRILHO / lote #27) — resolver pelo nome de catálogo — ADR-0063 — 2026-07-06

- [x] **Resíduo do lote #27**: família BRILHO ficava categoria "Outros" mesmo com o produto no
  catálogo do ML. Causa: o `category_id` do produto de catálogo **não é exposto** pela API (só
  `domain_id=MLB-YARNS`) — verificado ao vivo via extensão `http`. Fix (revisa o fix 3 do ADR-0063):
  quando o preditor textual cai em genérico/manual, re-roda o preditor com o **nome canônico do
  catálogo** (`concorrencia.product_name`, "Fio Barroco Maxcolor Brilho ... Crochê") → resolve
  MLB271471 "Lãs" (confirmado na API). 1221 testes verdes; deno lint + check ok.

## Publicação — 4 bugs do lote #27 (kit, preço, categoria, concorrência) — ADR-0063 — 2026-07-06

- [x] **Lote #27 (barbante Barroco Maxcolor)**, 4 falhas independentes corrigidas (ADR-0063):
  1. **Kit:** `UNITS_PER_PACK` (conditional_required no ML) travava a Revisão pedindo "unidades por
     kit" num produto avulso. `preencherUnitsPerPack` passa a assumir 1 quando não há contagem clara.
  2. **Preço no prejuízo:** ramo competitivo do `sugerirPrecoVenda` ignorava custo/comissão/frete.
     Agora `max(competitivo, gross-up)` — nunca abaixo do piso viável; avisa quando o piso passa da
     concorrência (decisão do Diego). Comissão/frete buscados também no caminho competitivo.
  3. **Categoria "Outros":** preditor textual caía na genérica; agora usa a categoria dos
     concorrentes no catálogo (`ofertas.category_id` + `buscarNomeCategoria`) quando desistiria.
  4. **Concorrência 0:** `product_identifier={gtin}` em vez de `q={gtin}` (busca textual frágil),
     tentando até 5 EANs da família. Alinha com o módulo de catálogo.
  1221 testes verdes; deno lint + deno check + eslint ok. Deploy: process-familia + os shared
  (`_shared/preco`, `_shared/categoria`, `_shared/concorrencia`, `_shared/ml/concorrencia`).

## Ingest UPDATE — herdar `categoria_nome` (categoria "—" na Revisão) — 2026-07-06

- [x] **Lote #26**: família UPDATE aparecia com categoria "—" na Revisão embora o produto já
  estivesse publicado. Causa: `ingest-lote` herdava `categoria_ml_id` da família publicada mas
  **não** `categoria_nome` (ausente do select do anterior e do insert do UPDATE). O ID vinha certo
  (MLB439096) — a publicação usa o ID, então nunca publicou na categoria errada; só o **nome**
  (display) faltava → "—". Sem relação com o ADR-0062 (que mexeu só na publicação). Fix: incluir
  `categoria_nome` no select e no insert de UPDATE do `ingest-lote`. Backfill do banco: 46 famílias
  históricas com o gap corrigidas (nome copiado de irmã com mesmo `categoria_ml_id`; MLB277319 sem
  fonte local → nome obtido da API pública de categorias do ML = "Bastãoes de Cola"). 1217 testes
  verdes; eslint/deno lint ok.

## UPDATE ML — renomear cor de variação existente + fotos comuns duplicando (ADR-0062) — 2026-07-06

- [x] **Lote #24/#25 (anúncio MLB4831319319)**: publicar o UPDATE não renomeava a cor de
  variação já publicada no ML, e as fotos CAPA2/CAPA3 duplicavam a cada publicação. Causas:
  (1) `montarVariacoesUpdate` nunca enviava COLOR das variações existentes — só de cores novas;
  (2) dedupe de fotos comparava id de upload (cacheado) vs id re-hospedado pelo ML → nunca casava,
  reinserindo capa2/capa3 a cada publish (até em reposição pura de estoque). Fix (ADR-0062):
  `buscarItemML` captura a cor atual do ML (`corDaVariacaoML`); `montarVariacoesUpdate` envia COLOR
  só quando a cor muda vs. o ML (idempotente); fotos comuns só (re)enviadas ao criar cor nova.
  Contrato `AtualizacaoCanonica.existentes` passou a carregar `cor` (callers: update-familia-ml,
  publicar-split-ml, publicar-anuncio). Testes: 1217 verdes (+ regressões de COLOR e `corDaVariacaoML`).
  eslint 0 erros, deno lint ok. Limitação residual documentada no ADR (adicionar cor nova a anúncio
  com capa2/capa3 ainda pode duplicar; ML pode recusar rename de cor em variação com vendas — anúncio
  já quebrado é limpo manual no painel). Docs: ADR-0062 + edge-functions.md.

## Dicionário de cores — Salmon (inglês) e Rosa Pink (composta) — 2026-07-06

- [x] **Lote #24**: "Salmon" caía em "Outra" e "Rosa Pink" virava só "Rosa" ao processar a
  planilha (`process-familia` → `_shared/cor/dicionario.ts`). Causa: dicionário só tinha
  "salmão/salmao" (faltava a grafia inglesa) e "rosa"/"pink" tinham sinônimos do mesmo tamanho —
  o sort por especificidade empatava e o match de primeiro-encontrado sempre pegava "rosa"
  primeiro. Fix: sinônimo `'salmon'` adicionado a Salmão + nova entrada composta `Rosa Pink`.
  2 testes de regressão adicionados; 1209 testes verdes. Deploy: 10 edge functions que bundlam
  `_shared/cor/` (process-familia, regenerar-copy-familia, publish-familia-ml, update-familia-ml,
  publicar-anuncio, publicar-split-ml, status-publicados, atualizar-status-publicado,
  monitorar-moderados, metricas-vendas) — verify_jwt conferido pós-deploy, sem drift.

## Dashboard — mapa "Vendas por estado" clicável (pedidos + valor) — 2026-07-06

- [x] **Clicar num estado do mapa (Dashboard) mostra pedidos e valor vendido no período**,
  pedido do Diego (mobile-friendly: linha compacta de uma linha só, não popover/tooltip — hover
  não funciona em toque). `MapaBrasil` já tinha `selecionada`/`onSelecionar` (usado em
  Faturamento › Geografia); só faltava ligar no Dashboard. Aproveitado para trocar a fonte da
  contagem por UF de `vendasPorUf` (contava por **linha** de `ml_vendas`) para
  `agruparPorGeografia(pedidos)` (mesma agregação de Faturamento › Geografia, nível de
  **pacote/pedido**) — dá o valor por UF de graça e fecha uma pequena divergência de contagem que
  já existia entre o mapa do Dashboard e o resto do app. `vendasPorUf` (`cockpit.ts`) mantido —
  ainda tem teste próprio, sem outro uso a remover. 1205 testes verdes; build/lint ok. Validado
  local (dev) antes do merge, sob comando "atualizar" do Diego. Merge → main (rebase limpo sobre
  `1ad2cab`) → deploy live (commit `c32e6a4`).

## Publicados — KPI "Variações publicadas" no card de saúde — 2026-07-06

- [x] **Novo KPI "Variações publicadas" no card "Saúde dos anúncios" (Publicados)**, pedido do
  Diego. Contagem inicial usava as `variacoes` da família **representante** de cada anúncio
  (`publicadoFromRow`/`dedupePublicados` elegem a mais **antiga** por `ml_item_id`) — mesma classe
  de bug do fix de busca por código de 2026-07-03 (ver [[Problemas Resolvidos]]): produto que ganhou
  variações em ciclos de UPDATE fica subcontado pela família antiga. 3 números errados no caminho
  (1268 → contagem duplicada somando todas as linhas de família por ciclo de UPDATE; 678/676 → só a
  família mais antiga) antes de reconciliar contra a fonte certa. Fix: `qtdVariacoes` por anúncio
  passa a vir de `anuncios_externos.variacoes_externas` (espelho mantido pelos workers no publish),
  somado no `calcularResumoPublicados` (`resumo-publicados.ts`) e espelhado no relatório exportado
  (`export/adapters.ts`). Validado contra 4 fontes independentes, incluindo chamada ao vivo à API do
  ML autenticada via a extensão `http` + `vault` direto no Postgres (sem expor token): todas convergem em **856**
  variações publicadas em anúncios ativos. 1203 testes verdes. Merge → main → deploy live
  (commit `16ac2bb`).

- [x] **Colunas Fornecedor e Tipo removidas da tabela de Publicados** (pedido do Diego). Os filtros
  de Fornecedor e Tipo (dropdowns) já operavam sobre os dados independente da coluna aparecer na
  tabela — nenhuma mudança de lógica de filtro foi necessária, só remoção das duas colunas
  (`ThOrdenavel` + `TableCell`) e ajuste do `colSpan`. Validado no browser: colunas ausentes,
  filtros combinados (Fornecedor + Tipo) reduzindo a lista corretamente. Só frontend. Merge → main
  → deploy (commit `3d72b60`).

## Fix: genérico descartado quando a IA rejeita um falso-amigo + busca sempre disponível — 2026-07-04

- [x] **Achado ao vivo (mesmo dia do ADR-0058): a Bainha do lote 51 ainda travava**, mesmo com o
  fallback genérico novo. Causa raiz: o preditor do ML devolvia, na mesma busca, o genérico
  correto do segmento (`MLB1371` "Outros" — Artes e artesanatos) **e** um específico falso-amigo
  ("Bainhas para Facas", homônimo de bainha de tecido); a IA de desempate corretamente recusava o
  específico errado, mas o resolver então caía direto em `manual`, jogando fora o genérico certo
  que já estava na mesma lista. Fix: `resolverCategoria` resgata pro melhor genérico disponível em
  qualquer ponto que devolveria `manual` (não só quando não sobra específico nenhum) — nunca
  escolhe um específico errado, só evita descartar um genérico que o ML já tinha respondido.
- [x] **Segundo achado, ao vivo também**: o operador digitou literalmente "outros" no campo de
  busca livre pra tentar "forçar" o fallback — o ML devolveu buckets "Outros" de domínios de
  veículos náuticos (`MLB1905` e afins, coincidência textual). Como a categoria escolhida
  manualmente grava `tipo_origem='manual'` (não `'generico'`), o link de busca desaparecia
  completamente — o operador ficou sem nenhuma forma visível de corrigir. Fix: `CardCategoria`
  ganha um "Trocar categoria" sempre alcançável pra qualquer categoria já definida, não só a
  genérica automática, com `useEffect` garantindo abertura automática quando o card já montado
  vira genérico num refetch ao vivo (ex.: reprocessar com a tela aberta).
- Verificação: 22 testes novos/atualizados (resolver.test.ts + card-categoria.test.tsx), revisão
  adversarial (3 agentes independentes: lógica do resolver, estados da UI, cenário ponta a ponta)
  sem achados bloqueantes, 1169 testes verdes, build/lint limpos. `docs/decisions/0058-*.md`
  (adendo). Branch `fix-trocar-categoria-sempre-disponivel`.

## Categoria de seleção livre + "Outros" como fallback visível — 2026-07-04

- [x] **Famílias fora dos 4 aviamentos conhecidos (ex.: "BAINHA INSTANTÂNEA 4MT UND", lote 51)
  ficavam travadas para sempre** — o seletor manual só oferecia linha/fita/botão/cola. Causa
  raiz: pendência aberta desde o ADR-0022 (11/06), nunca fechada. ADR-0057: `CardCategoria` troca
  o seletor fixo por busca livre no `domain_discovery` do ML (reusa `buscarCategoriaPreditor` já
  existente); `definir-categoria-familia` generaliza o contrato para `{categoria_ml_id,
  categoria_nome}`; `resolverAtributosGenericos` extraído do `process-familia` p/ reuso sem
  duplicar lógica. Categoria do concorrente (já calculada, antes descartada) vira sugestão
  clicável não-vinculante — nunca aplicada sem clique explícito (trava de regressão pro
  incidente do ADR-0054).
- [x] **ADR-0058 (mesmo dia, a pedido do Diego):** quando o preditor só acha candidatos genéricos
  ("Outros"), a família deixa de travar em `manual` — aplica o genérico como fallback visível
  (`tipo_origem='generico'`, selo de aviso na Revisão) e a busca continua disponível pra trocar.
  Revisão humana antes de publicar continua obrigatória (regra inalterada); zero mudança no
  `process-familia` (branch já era baseado em `categoria_ml_id`/`tipo`, não em `origem`).
  Migrations aditivas (`concorrencia_categoria_id`, enum `tipo_origem` + `'generico'`), 1165
  testes verdes, edge functions (`process-familia`, `definir-categoria-familia`,
  `atributos-familia`) deployadas e versão conferida. Branch `fix-categoria-selecao-livre`.

## Campo de busca no Detalhe de vendas — 2026-07-03

- [x] **Detalhe de vendas (Publicados › `/publicados/vendas`) ganhou campo de busca** por
  título/código/EAN, mesmo padrão do `Input` usado em Publicados. Filtra as duas seções (Seus
  anúncios PubliAI / Fora do PubliAI); o subtotal do rodapé passa a refletir só as linhas
  filtradas (senão o número da seção inteira ficava enganoso ao lado de 1-2 linhas exibidas).
  Mensagem "Nenhum resultado para a busca." diferencia de "Sem vendas no período." quando o filtro
  não bate com nada. `DetalheVendas.tsx`. Frontend-only, sem ADR (não é decisão arquitetural).
  Verificação: 1160 testes verdes, lint limpo, validado no app real (browser-use).

## Fix markup por produto divergente (Detalhe de vendas × Detalhe do pedido) — 2026-07-03

- [x] **Mesmo produto mostrava markups diferentes nas duas telas** (ex.: cód. 03096963 → +843% no
  Detalhe de vendas vs +592% no Detalhe do pedido). Causa raiz: `montarDetalheVendas`
  (`detalhe-vendas.ts`) rateava o líquido **por linha de order_id**; num pack com um order_id por
  produto, o item leve/barato (fita) ficava com o líquido inteiro do seu order_id (quase sem frete,
  rateado por peso) e inflava o markup. Fix: poolar o líquido por **pack** (`pack_id ?? order_id`) e
  redistribuir por valor bruto com o mesmo `round2` por item do `agruparPorPedido` (menu Faturamento,
  fonte da verdade — ADR-0055). Agora o markup por produto bate 1:1 entre as telas. Teste de
  regressão em `tests/lib/detalhe-vendas.test.ts` trava a invariante. Verificação: 1158 testes
  verdes; lint do arquivo limpo.

## Fix overflow horizontal / responsividade — 2026-07-03

- [x] **Telas escapavam das margens (desktop 15" Windows) e panavam lateralmente (mobile)** —
  causa raiz no shell: a coluna de conteúdo (`flex flex-1 flex-col`) tinha `min-width:auto`
  implícito, então tabelas largas a expandiam além da viewport e o `main` (`overflow-auto`) panava
  a página inteira. Fix: `min-w-0` na coluna + `main` → `overflow-y-auto overflow-x-hidden`
  (`app-shell.tsx`); tabela crua da Viabilidade envolvida em `overflow-x-auto` + padding de página
  (`Viabilidade.tsx`); cards do `painel-analise` empilham `w-full` no mobile (piso de largura só a
  partir de `sm`). Verificação: `pnpm lint` + `pnpm build` verdes; medição headless logada = 0
  overflow em 22 medições (10 rotas × 1366/375, incluindo linha de Publicados expandida).

## Multi-tenant: operações do ML usam escopo/token da operação — 2026-07-03

- [x] **Publicados "Indisponível" para membros não-donos** — descompasso do ADR-0047 (lista
  compartilhada × enriquecimento/ações escopados ao chamador). Helper `_shared/ml/operacao.ts`
  `userIdCredencialOperacaoML` + 10 edge functions (`status-publicados`, `metricas-vendas`,
  `publicar-familias`, `remover-publicado`, `reprocessar-familia`, `regenerar-copy-familia`,
  `definir-categoria-familia`, `responder-pergunta`, `calcular-tarifa-ml`, `ingest-lote`) passam a
  usar escopo + token + gravação da operação; `ingest-lote` grava `familias/variacoes.user_id` =
  dono da conta ML (workers de publicação intocados) e casa anteriores por `codigo_pai` em toda a
  operação (evita duplicar anúncio). Deploy CLI 10/10; `deno check` + `pnpm lint` + 1156 testes
  verdes. [ADR-0056](decisions/0056-enriquecimento-ao-vivo-escopo-da-operacao.md).
- [ ] **Validação runtime pendente** — logar como Michael/Samuel e confirmar Publicados igual ao Diego.

## Imposto por origem (nacional/importado) — 2026-07-03

- [x] **Imposto sobre a venda entra no preço e no markup** — coluna opcional `ORIGEM`
  (`NACIONAL`/`IMPORTADO`) na planilha (linha PAI, default `nacional`) grava `familias.origem`
  (enum `origem_produto`, não confundir com `tipo_origem`). Duas alíquotas parametrizáveis em
  Configurações (`aliquota_nacional_pct` default 8%, `aliquota_importado_pct` default 16%,
  globais por usuário, sem override por família). Imposto = preço × alíquota, descontado do
  líquido junto com comissão e frete e somado ao gross-up do preço sugerido, reduzindo
  markup/lucro/"Vale a pena" em todas as telas (análise de publicação, viabilidade item-a-item,
  faturamento pós-venda). [ADR-0055](decisions/0055-imposto-por-origem-nacional-importado.md).

## Planos E7 + E6 + E6b — SaaS multi-empresa, multicanal e estoque único — 2026-07-02

- [x] **Planos de implementação escritos e aprovados como documento** — análise profunda do código (RLS/modelo de dados + camada de canais) e planos completos, com decisão de **ordem E7 → E6** (E7 primeiro: isolamento por org é o objetivo SaaS; E6 nasce tenant-aware; validação real do E6 com 2 canais depende do E5 Shopee). Planos: [E7 multi-tenancy](superpowers/plans/2026-07-02-e7-multi-tenancy-org-id.md) (7 fases expand→migrate→contract, suite executável de isolamento cross-tenant, `marketplace_connections` por org resolvendo a pendência do ADR-0047) · [E6 orquestração](superpowers/plans/2026-07-02-e6-orquestracao-multicanal.md) (worker genérico `publicar-anuncio`, estado por canal em `anuncios_externos`, caminho ML intocado).
- [x] **Decisão (Diego, 2026-07-02): próximo épico = E7** — ordem E7 → E6 aprovada; E5 (Shopee) fica para depois. Cada PONTO DE DEPLOY do plano E7 segue exigindo OK explícito.
- [x] **Épico novo E6b — Estoque único e sincronização cross-canal (2026-07-02)** — venda paga em qualquer canal → baixa atômica idempotente no estoque canônico (ledger `estoque_movimentos` + `baixar_estoque`) → push de valores absolutos aos demais canais (`sincronizar-estoque`, fila serial por org) → reconciliação diária. Registrado no doc mestre (seção E6b) e com plano completo: [E6b estoque único](superpowers/plans/2026-07-02-e6b-estoque-unico-cross-canal.md). Executa após E7+E6; validação plena (2 canais reais) depende do E5.
- [ ] **Execução do E7** — próximo passo (iniciar pela Task 1: ADR-0027).
- [ ] **Execução do E6** — após E7 concluído.
- [x] **Execução do E6b Bloco A** — EM PRODUÇÃO 2026-07-29, ver
  "E6b Bloco A — Estoque único cross-canal (ADR-0094)" no topo deste arquivo. Bloco B (cadastro
  manual + entrada de mercadoria) segue pendente.

## Lote #49 — barbante recusado por atributo/tipo (ADR-0051) — 2026-07-01

- [x] **Barbante classificado como `outro` → sem BRAND/MODEL → ML recusa** — investigado com `systematic-debugging` nos dados de produção. 3 famílias de barbante do lote #49 com `tipo_aviamento='outro'`, `categoria_ml_id=MLB270273` (Fios e Cadarços = a categoria de `linha`), `atributos_ml=[]`, `atributos_faltantes=[]`; na mesma categoria há 13 publicadas como `linha` (0 erros). Duas causas: (1) `barbante` faltava na regex de `linha` (`detectar.ts`); (2) sem override, o preditor acerta a categoria mas devolvia `tipo:'outro'` fixo → `process-familia` seguia o ramo genérico (schema+IA) que, ao falhar, deixa atributos e faltantes vazios → o gate do publish não bloqueia. Fix: `barbante`/`barbantes` na regex + `tipoParaCategoria` (lookup reverso categoria→tipo) no `resolver` + `process-familia` usa o caminho determinístico para todo tipo conhecido (`categoriaParaTipo(tipo)!=null`, não só `origem==='regex'`). TDD: casos novos em `detectar`/`resolver`/`atributos`; 1074 testes + tsc + `deno check` + eslint verdes. [ADR-0051](decisions/0051-tipo-aviamento-derivado-da-categoria-do-preditor.md).
- [x] **Deploy + reprocessamento das 3 famílias do lote #49** — ✅ deployado e reprocessado em produção (validado 2026-07-02).
- [x] **Robustez SaaS — fim da falha silenciosa do ramo genérico** — para preparar publicação de **qualquer** produto (SaaS multiempresa): `process-familia` nunca mais publica sem validar. Se schema indisponível/vazio/sem token ou erro da IA, persiste `atributos_faltantes=[FALTANTE_ATRIBUTOS_NAO_VALIDADOS]` → gate trava na Revisão (não vai quebrado ao ML). `COLOR` entra em `FALTANTES_IGNORAR` (atributo de variação; evita falso-faltante em categorias que o exigem). Testes novos em `atributos-generico`; suíte + tsc + `deno check` verdes.
- [x] **Camada 2A — IA infere texto-livre obrigatório do texto do produto (ADR-0052)** — a IA passa a preencher atributos de texto-livre obrigatórios inferindo do nome/descrição, sem inventar: valor só é aceito se suas palavras aparecerem em sequência contígua na fonte (match por token + piso de comprimento — furos apontados em code-review). `AtributoAlvo` ganhou discriminador `tipo` (closed/numero/texto). Reduz produtos travados por atributo. TDD (1087 testes + tsc + deno check + smoke no runtime Deno verdes), code-review independente aplicado. `process-familia` v57 deployado (`verify_jwt=false`). Plano em `docs/superpowers/plans/2026-07-01-camada2a-ia-texto-livre.md`.
- [x] **Camada 2B — fallback: editor de atributos faltantes na Revisão (ADR-0052)** — quando a IA não resolve um obrigatório, o operador completa inline no card de categoria (Select p/ closed-set, Input p/ texto/numérico, auto-save com `StatusInline`); a publicação fica travada até resolver e a edição sobrevive ao reprocesso. Backend: migration `atributos_editados_pelo_operador` + guarda em `process-familia` (só preserva se a categoria não mudou); funções puras `faltantesEditaveis`/`validarValorAtributo` (validação server-side); edge function `atributos-familia` (lista faltantes-com-schema + salva/recalcula, `verify_jwt=true`). Front: tipos/query/hook + `editor-atributos-faltantes.tsx` + trava em `publicavel.ts` (CREATE e UPDATE). TDD (1103 testes + tsc + deno + build + eslint verdes); code-review independente (6 achados corrigidos: gate↔editor alinhados, try/catch, stale-query, categoria órfã); smoke visual (app sobe, login, Dashboard OK). Deploy: `atributos-familia` v1 + `process-familia` v58 (+3 por não-defasar). Plano em `docs/superpowers/plans/2026-07-01-camada2b-fallback-editor-atributos.md`.
- [ ] **Fase posterior:** troca livre de categoria (busca no catálogo ML) + remontagem de atributos; **dívida multi-tenant:** marca padrão `Avil` hard-coded em `atributos.ts` — trocar por config da empresa.

## Comprador real nas vendas — correção da regressão + anti-flakiness (2026-07-01)

- [x] **Coluna Comprador mostrando o nick em vez do nome real** — investigado com `systematic-debugging`: `GET /orders/{id}` mascara `buyer.first_name/last_name` por um tempo após a criação do pedido (não é bloqueio de permissão — hipótese de precisar do endpoint CDA descartada). Fix 1: `comprador_nome` volta a cair pro `receiver_name` do envio quando o buyer não vem (`supabase/functions/_shared/faturamento/io.ts`).
- [x] **Regressão descoberta em seguida: nome do destinatário aparecendo em vez do comprador** — o ML é **inconsistente** em retornar `buyer.first_name/last_name` (o mesmo pedido veio com o dado num sync e sem no seguinte, ~5min depois), e cada sync recalculava `comprador_nome` do zero — um sync sem o buyer apagava um nome real já capturado. Fix 2: nova função pura `escolherCompradorNome` (`_shared/faturamento/venda.ts`) prioriza nome real atual → nome já salvo (nunca regride) → nome do destinatário (só quando nunca teve nada melhor) → nick na UI. 4 testes novos (42 no total no módulo). `sync-venda` (v21), `backfill-faturamento` (v21), `reconciliar-faturamento` (v19) deployadas, `verify_jwt=false` preservado.
- [x] **Histórico corrigido** — os ~105 registros de `ml_vendas` (desde 2026-06-06) já foram populados por uma sincronização completa; 1 pedido com valor corrompido pela regressão (destinatário salvo como comprador) corrigido manualmente via SQL após confirmar o nome real no `raw.buyer` já capturado.
- [ ] **Limitação conhecida:** como `comprador_nome` não distingue a origem do dado (buyer real vs. destinatário), um valor gravado como fallback (destinatário) só é substituído pelo nome real se um sync futuro conseguir o buyer do ML — não há forma de forçar isso hoje.

## Atributos opcionais/numéricos por IA — nota de qualidade (ADR-0049) — 2026-06-29

- [x] **Anúncio preenche mais características (não só obrigatórias)** — anúncios de aviamentos saíam só com os obrigatórios (ex.: fita → `BRAND`+`RIBBON_TYPE`) → ML marca qualidade "ruim". O caminho regex do `process-familia` agora **enriquece** os obrigatórios curados com o schema da categoria: closed-set opcionais (ex.: *Formato da fita*) + numéricos (ex.: *Comprimento*/*Largura* extraídos da descrição), via IA validada contra o schema (nunca inventa); texto livre como `MODEL` fica de fora. `schema.ts` (`valueType`/`allowedUnits`), `atributos-llm-core.ts` (alvos closed-set opcionais + numéricos; ignora `COLOR`/`UNITS_PER_PACK`), `process-familia` (ramo regex). Filtro de tags exclui atributos de variação/ocultos/read-only/multivalor (achado do probe em MLB255054). TDD: 59 testes nos módulos + 1045 na suíte, typecheck/`deno check` verdes. **`process-familia` deployado (v50, `verify_jwt=false` preservado).** Validado manualmente em 2 anúncios reais (MLB7064230644, MLB4770357327): de 2 → 6 características, nota de qualidade subiu. [ADR-0049](decisions/0049-atributos-opcionais-e-numericos-por-ia.md).

## Mensagem automática ao comprador — 2026-06-29

- [x] **Mensagem de boas-vindas ao pagar** — `sync-venda` envia `POST /messages/packs/{packId}/sellers/{sellerId}/messages` na primeira transição `→ paid` (flag `novaPaga` já idempotente, sem coluna nova). Novo helper `_shared/ml/mensagem.ts`. Falha de mensagem é logada mas não trava o worker. `sync-venda` deployado (v17). Docs atualizadas (`edge-functions.md`).

## Split de produto em N anúncios ML (ADR-0048) — 2026-06-29

- [x] **Cor nova entra MARCADA por padrão no UPDATE (opt-out)** — antes, cor nova num UPDATE nascia desmarcada (opt-in, ADR-0016 adendo 2026-06-04); ao subir lote com muitas cores novas todas ficavam de fora sem aviso. Invertido: cor nova com **foto E estoque** entra marcada; senão dorme. Operador ainda pode desmarcar na Revisão. `ingest-lote` (1 linha) + adendo no ADR-0016. `ingest-lote` deployado.
- [x] **Limites do ML descobertos** — anúncio aceita no máx. **100 variações** E **99.999 de estoque somado**. 3 produtos com >100 cores (Fita Cetim N.1=137, N.2=132, Linha 1500m=120). Registrado em `reference_ml_limites_anuncio`.
- [x] **Split automático em N anúncios** — produto com >100 cores publica em N anúncios ("partições"). Worker isolado **`publicar-split-ml`** (caminho normal dos 73 produtos intocado); partição alfabética por cor com **ancoragem** (cor publicada não migra), título distinto por **IA** (fallback determinístico), **cap de estoque por teto** no conector ML (no-op nos anúncios atuais), espelho por partição. `anuncios_externos` ganhou `particao`+`titulo` (migration aplicada) e virou âncora do split. Roteamento em `publicar-familias` (>100 cores → split). Funções puras `particionar`/`caparEstoque`/`montarAncoragem` com TDD. [ADR-0048](decisions/0048-split-produto-n-anuncios-ml.md) · spec em `superpowers/specs/2026-06-29-split-anuncio-100-variacoes-design.md`.
- [x] **E2E validado em produção** — `02835002` (120 cores) publicado em 2 anúncios reais: `MLB6914358210` (100 cores) + `MLB4828349403` (18 cores, título IA distinto), 118 `variation_id` distintos (zero duplicação), cap aplicado (estoque real 155k → enviado ≤99.999). 1035 testes + deno check/lint/build verdes.
- [x] **UI mostra os N anúncios** — Relatório e Publicados liam só `familias.ml_item_id` (partição 0); agora juntam `anuncios_externos` e mostram um "ver anúncio" por partição; `status-publicados` busca status ao vivo de todas as partições. Validado com browser-use (2 links no Relatório; 2º anúncio "Ativo" na Publicados). Frontend no Render.
- [ ] **Follow-up:** catálogo (opt-in, `vincular-catalogo`) por-partição — hoje cobre só a partição 0; UI de "N anúncios por produto" agrupada (hoje listados como 2 linhas); aplicar split aos outros 2 produtos grandes quando reimportados.

## Multiusuário + permissão de menu (operação compartilhada, ADR-0047) — 2026-06-29

- [x] **Cadastro de usuários por convite + acesso por menu** — antecipa parte do `E7`. Tabela `public.profiles` (1:1 com `auth.users`: `is_admin`, `is_active`, `allowed_menus[]`) + helpers `is_admin()`/`is_membro_operacao()` (SECURITY DEFINER, `search_path=''`, `anon` revogado) + trigger `handle_new_user` + backfill (usuários existentes viram admin). **RLS migrada** de `user_id` para `is_membro_operacao()` (operação compartilhada) nas 12 tabelas de domínio + storage `imagens`; `user_id` vira `criado_por`. Edge function `usuarios` (admin-only, `service_role`): `invite`/`update_menus`/`set_active`/`set_admin`. Frontend: tela **Usuários** (tabela + convidar com **toggle Admin** que auto-marca/trava menus + editar/desativar/promover), `MenuGuard` de rota, `profile` no auth-store, `/sem-acesso`, `/definir-senha` (consome `token_hash` via `verifyOtp`), `/cadastro` público removido. 3 migrations aplicadas via `db push`, edge deployada, frontend no Render. Advisors limpos. Validado em produção com browser-use (login admin → menu → convite → toggle Admin). [ADR-0047](decisions/0047-operacao-compartilhada-rbac-menu.md) · plano em `superpowers/plans/2026-06-28-usuarios-menus-rbac.md`.
- [x] **E-mail transacional via Resend (SMTP próprio)** — saiu do serviço interno do Supabase (que só entrega à equipe do projeto) para **SMTP do Resend** (`smtp.resend.com`, remetente `publiai@daludi.com.br`, domínio `daludi.com.br` verificado) configurado no Supabase Auth via Management API + templates de Convite/Reset com `token_hash` + `site_url` de produção. Validado: e-mail de teste, recuperação e convite (michael) com `last_event: delivered` e link correto. Secrets `RESEND_API_KEY`/`RESEND_SENDER_EMAIL` no `.env.local` + secret `APP_URL` na edge. How-to em [operacoes-rotineiras.md](how-to/operacoes-rotineiras.md#e-mail-transacional-smtp-via-resend).
- [x] **Hotfixes do convite (2026-06-29)** — (1) a UI mostrava só "Edge Function returned a non-2xx" porque o `supabase.functions.invoke` não popula `data` em respostas não-2xx; `callUsuarios` passou a ler a mensagem real do corpo (`error.context.json()`). (2) E-mail já cadastrado retorna **409** com mensagem PT amigável. (3) **Causa raiz dos convites falhando: `rate_limit_email_sent` do Supabase Auth estava no default 2/hora** (não sobe ao ligar SMTP) — elevado para **50/hora** via Management API. Edge `usuarios` redeployada + front no Render; validado com browser-use (erro de duplicado aparece na tela).
- [ ] **Pendente (pré-E7):** resolver a conexão ML da operação (não do chamador) para membros publicarem; manter publicação restrita ao admin-dono até lá.

## Líquido econômico — fim do artefato cross-docking (ADR-0042) — 2026-06-25

- [x] **Líquido da venda = `bruto − comissão − frete real` (não o `net_received_amount` do MP)** — o net do Mercado Pago é **inconsistente**: em envio cross-docking (`shp_cross_docking`) ele desconta o frete CHEIO da etiqueta e ignora a comissão; em pack desconta a comissão e ignora o frete. Isso gerava **markup falso** (item vendido a ~3× o custo aparecia com −56%). Passa a computar de fontes autoritativas: `sale_fee` do pedido + `senders[].cost` do envio (`_shared/faturamento/venda.ts`). **Rateio de pack net-independente** (`ratearLiquidoPorFrete`, compartilhado por Faturamento e Financeiro): frete do envio uma vez, por peso. Faturamento e Financeiro batem por construção (fonte única `ml_vendas`). DB **reconciliado** (46 pedidos; líquido total do período R$ 602,93). [ADR-0042](decisions/0042-liquido-economico-cross-docking.md). **Deployado:** edges `ml-webhook` (v5), `sync-venda` (v10), `backfill-faturamento` (v12), `reconciliar-faturamento` (v9) — `verify_jwt=false` preservado — + front (Render, commit `6d3758d`). Validado com browser-use (item Rosa Amaranto: 2,36 / −56% → **7,63 / +43%**). 935 testes verdes.
- [x] ~~Removido o caminho morto do MP ao vivo~~ — **item incorreto, corrigido em 2026-07-26.**
  `src/lib/financeiro.ts`, `src/hooks/useResumoFinanceiro.ts` e a edge `resumo-financeiro`
  continuaram no repositório — e a edge seguiu **deployada e `ACTIVE` (v14)** — até a remoção
  real pelo [ADR-0093](decisions/0093-financeiro-mp-pela-conexao-ml.md). Substituídos por
  `ml_vendas`/`resumo-vendas.ts` no ADR-0038; pendência herdada do ADR-0040.

## Publicados — expandir item: análise + modo Clássico/Premium — 2026-06-24

- [x] **Cada anúncio publicado expande mostrando a "Análise para publicação"** (reuso do `PainelAnalise` da Revisão) recalculada pelo **preço atual no ML**, e indica se foi publicado em **Clássico** (`gold_special`) ou **Premium** (`gold_pro`). O `listing_type_id` vem **ao vivo** do ML via `status-publicados` (atributo extra em `lerStatus`, mapeado em `parseStatusML` → `StatusCanal.listingType`), **sem migração**. Front: linha de Publicados expansível (linha inteira clicável, lazy-load da família via `useFamilia`/`fetchFamiliaPublicada`), **selo Clássico/Premium no topo-direito da linha** e destaque "✓ publicado" no card "Você recebe por venda". 941 testes verdes, validado com browser-use. spec/plano em `superpowers/specs/2026-06-24-publicados-expandir-analise-design.md` + `superpowers/plans/2026-06-24-publicados-expandir-analise.md`. **`status-publicados` já deployada; demais edge functions do `_shared` deployadas preservando `verify_jwt`.**

## Módulo Financeiro impecável (ADR-0040) — 2026-06-23

- [x] **Menu Financeiro completo — caixa, lucro/margem, evolução, comparativo, período personalizado, CSV** — tela `/financeiro` e detalhe do líquido derivam tudo de `ml_vendas` (fonte única, ADR-0038). Novidades: **período personalizado** (intervalo de datas), **faixa de caixa** (já liberado vs a liberar, por `money_release_date` — NÃO é o "A receber" do MP, ver ADR-0031), **lucro líquido + margem%** com nota de cobertura, **breakdown de taxas** (comissão vs frete), **comparativo com período anterior** (seta ↑/↓), **gráfico de evolução** do líquido (recharts), e no detalhe: **export CSV**, **filtro liberado/a liberar** (rodapé filtro-aware) e **retido negativo como crédito**. Lógica pura em `lib/resumo-vendas.ts` (+ `lib/csv.ts`, `lib/metricas.ts`), TDD vitest. [ADR-0040](decisions/0040-financeiro-caixa-evolucao-notificacao.md) · spec [2026-06-23-financeiro-impecavel-design.md](superpowers/specs/2026-06-23-financeiro-impecavel-design.md). **✅ Validado e mergeado→deployado em produção (2026-07-02).**
- [x] **Notificação Telegram de liberação** — edge `notificar-liberacao` (pública/QStash, idempotente via coluna `ml_vendas.liberacao_notificada_em`): avisa quando o dinheiro das vendas é liberado HOJE em BRT no saldo Mercado Pago. Reusa a infra de Telegram. Migration `20260623160000_ml_vendas_liberacao_notificada.sql`.
  - **✅ CONCLUÍDO (2026-07-02):** migration aplicada, `notificar-liberacao` deployada (`--no-verify-jwt`), smoke test OK e **QStash schedule diário** ativo → `.../functions/v1/notificar-liberacao`.
  - [x] ~~Caminho morto do MP ao vivo removido~~ (2026-06-25, junto do ADR-0042) — **item incorreto,
    corrigido em 2026-07-26**: `lib/financeiro.ts`, `useResumoFinanceiro` e a edge `resumo-financeiro`
    não foram removidos nessa data, e a edge seguiu deployada `ACTIVE` (v14) até então. Remoção real
    pelo [ADR-0093](decisions/0093-financeiro-mp-pela-conexao-ml.md), ver seção dedicada abaixo.

## Módulo Faturamento (ADR-0037) — 2026-06-22

- [x] **Menu Faturamento — vendas + devoluções + perguntas** — novo menu `/faturamento` com 3 abas: **Vendas** (pedido a pedido, KPIs só de pagos, árvore expansível com itens/comissão/frete/rastreio, filtros período/origem, botão Sincronizar), **Devoluções** (claims post-purchase: motivo/status/ações com prazo), **Perguntas** (responder pelo app + sugestão de IA via OpenRouter). Dados persistidos (`ml_vendas`/`ml_vendas_itens`/`ml_perguntas`/`ml_devolucoes`/`ml_webhook_eventos`, RLS por user) via **webhooks ML** (`ml-webhook`→QStash→`sync-venda`/`sync-pergunta`/`sync-devolucao`) + `backfill-faturamento` + `reconciliar-faturamento`. Alertas Telegram (nova venda/pergunta/devolução). [ADR-0037](decisions/0037-modulo-faturamento-webhooks-ml.md) · spec [2026-06-22-menu-faturamento-vendas-design.md](superpowers/specs/2026-06-22-menu-faturamento-vendas-design.md). Migrations + 8 edge functions deployadas; backfill validado (R$ 776,83 / 33 pedidos batem com a tela existente); validado end-to-end com browser-use (3 abas + IA). **✅ Mergeado→deployado em produção (2026-07-02).**
  - **✅ CONCLUÍDO (2026-07-02):** (1) DevCenter → URL de notificações = `.../functions/v1/ml-webhook` + tópicos `orders_v2`/`questions`/`claims`/`shipments` configurados; (2) QStash schedule (1h) ativo → `.../functions/v1/reconciliar-faturamento`.

**Última atualização:** 2026-06-21 — Repaginação visual premium + Tarefa 2/Onda 1 (workflow operacional) entregues e deployadas (ver bloco abaixo). **Iniciada a Evolução v2 — SaaS multicanal** (ver [seção dedicada](#-evolução-v2--saas-multicanal) abaixo + [documento mestre](superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md)).

**Design/UX 2026-06-21 (preparação para SaaS comercial — em produção, light+dark, TDD na lógica):**
- **Tarefa 1 — Repaginação visual premium (light-first):** sistema de tokens (gradiente de marca roxo→índigo, sombras recalibradas, elevação por cor no dark), regra híbrida vitrine/dados, hero cards e hover padronizado nos KPIs. Specs em `superpowers/specs/2026-06-20-repaginacao-visual-premium-design.md`.
- **Tarefa 1.5 — Refinamento pós-review (Codex):** hierarquia de elevação do Dashboard, borda tonal no dark, OAuth colapsado em "Detalhes técnicos" (Configurações), "Atualizado às HH:mm" no Financeiro, acento lateral por status na Revisão, dropzone expressiva na Viabilidade. Plano em `superpowers/plans/2026-06-21-refinamento-1-5-design.md`.
- **Tarefa 2 / Onda 1 — Workflow operacional contínuo (4 fatias, TDD):**
  1. **Jornada do lote** — stepper "você está aqui" (Progresso/Revisão/Relatório) + card "Continuar de onde parei" no Dashboard (`lib/jornada.ts`).
  2. **Painel "Precisa da sua atenção"** — pendências acionáveis no Dashboard (anúncios com problema, erros de publicação) (`lib/pendencias.ts`).
  3. **Revisão por exceção** — lista ordenada problemas-primeiro (erro→incompleta→aviso→ok→publicado), tabs/filtros intactos (`lib/revisao-ordem.ts`).
  4. **Pré-validação do upload** — valida as 14 colunas obrigatórias no cliente antes de enviar, feedback inline, bloqueia "Processar" se faltar coluna (`lib/validar-planilha.ts`).
  Specs em `superpowers/specs/2026-06-21-jornada-lote-design.md`, `…-dashboard-pendencias-design.md`, `…-revisao-excecao-prevalidacao-design.md`. 772 testes (21 novos), commits `efbbee5`→`022e84e`→`3ef0de9`, deploy live. **Sem tocar backend/lifecycle.**
- **Tarefa 2 / Onda 2 — Tirar atrito (2 fatias, TDD):**
  1. **Estado na URL + chips (Publicados)** — filtros/ordenação/página/tamanho passam a viver na URL (`lib/publicados-url.ts`), restaurados pelo back do navegador; chips de filtros ativos removíveis + "Limpar tudo" (`components/filtros-ativos.tsx`).
  2. **Quick wins** — paginação default 10 (era 5); estado vazio da Publicados com CTA "Novo lote".
  Spec `superpowers/specs/2026-06-21-onda2-atrito-design.md`. 780 testes (8 novos), validado em light+dark.
- **Tarefa 2 / Onda 3 — Navegação & orientação (2 fatias, TDD) — fecha a Tarefa 2:**
  1. **Breadcrumbs** nas telas profundas (Detalhe das vendas, Detalhe do líquido, Relatório) — componente acessível `components/ui/breadcrumbs.tsx`.
  2. **KPIs navegáveis (drill-down)** no Dashboard — `KpiCard` ganha prop `to`; "Anúncios publicados"→/publicados, "Ativos"→/publicados?status=ativo (usa o deep-link da Onda 2), "Com problema"→/publicados. Demais KPIs seguem informativos (sem redundância com pendências).
  Spec `superpowers/specs/2026-06-21-onda3-navegacao-design.md`. 783 testes (3 novos), validado em light+dark. **Tarefa 2 concluída.**
  **Backlog pós-Tarefa 2 (adiado com justificativa):** busca global (custo alto/valor baixo single-tenant), ações em massa na Revisão (mexe no gate "revisão humana antes de publicar" — exige decisão), a11y aprofundada (épico próprio), período sincronizado Publicados↔Financeiro, links cruzados, scroll restoration, aviso global do worker.
**📍 Passo atual:** Evolução v2 · Fase 0 · **E1 + E1b ✅ VALIDADOS EM PRODUÇÃO** (2026-06-14) — toda a camada de abstração de canais (CREATE + UPDATE + status) está atrás do `ChannelConnector`, mergeada, deployada e validada por bug bash real via automação de navegador (E1b: família de teste CREATE→UPDATE com reposição + cor nova + leitura de status ao vivo; anúncio `MLB6966427644` removido após). **Próximo épico: E2** (modelo de dados multicanal: `anuncios_externos` 1:N).

**Hotfix 2026-06-15:** tela `Publicados` corrigida para exibir `tipo_aviamento='cola'` como `Cola` e incluir esse valor no filtro de tipos. A causa era somente de renderização no frontend; banco já estava correto.

**Hotfix 2026-06-17 (ADR-0030 — reprocessamento de família em erro):** o lote #41 ficou em `erro` com a mensagem genérica `"The signal has been aborted"` — causa: a copy (IA/OpenRouter) excedeu o timeout de 30s no `process-familia`, e a única etapa de IA sem fallback derrubou a família. Entregue: (1) `gerarCopy` com 1 retry + erro **rotulado por etapa** (não mais o abort genérico); (2) nova edge function `reprocessar-familia` (reseta `erro→pendente` e re-enfileira via `enfileirarFamilia`, idempotente, por `familia_id` ou `lote_id`); (3) UI: status `erro` + `erro_mensagem` agora visíveis na linha da família, com botão **Reenviar** (por família) e **Reenviar N com erro** no header do lote. Ver [ADR-0030](decisions/0030-reprocessamento-de-familia-em-erro.md).

**Feature 2026-06-17 (Dashboard de KPIs em Publicados):** a tela `Publicados` ganhou um dashboard de vendas no topo (período selecionável 7/30/90d via `/orders` do ML): faturamento, unidades, pedidos, ticket médio, saúde dos anúncios, encalhados e top produtos. Tabela ganhou colunas **Unid. vendidas** e **Valor vendido**; **Fornecedor** passou a exibir a 1ª palavra (ex.: `DETALLIA`), com filtro pelo nome completo. Métrica abstraída no contrato de canal (`lerMetricasVendas`/`MetricasVendasCanal`) → multicanal-ready; nova edge function `metricas-vendas`. Validado em browser (login real, edge 200, fornecedor/colunas/seletor OK). Spec: [dashboard-kpis-publicados](superpowers/specs/2026-06-17-dashboard-kpis-publicados-design.md).

**Progresso desta sessão (terceira sessão, 2026-05-26 — fechamento do M0):**
- [x] Task 2 (Supabase URL/ANON_KEY) — captured via MCP
- [x] Task 3 (Upstash Redis + QStash) — pré-existente, captured via MCP
- [x] Task 8 (cliente Supabase) — commit `9a0eabc` — TDD limpo (RED→GREEN), `src/lib/supabase.ts` com fail-fast
- [x] Task 9 (Edge Function `hello`) — commit `9159e27` — deployada via MCP `deploy_edge_function` (sem CLI/Docker), curl confirmado HTTP 200
- [x] Task 10 (Render Static Site) — commits `bad04ca` → `4e1ad16` → `7d25229` — service `srv-d8at8arbc2fs73e5qcb0`, auto-deploy ativo, URL `https://ean2marketplace-frontend.onrender.com`
- *Desvio M0.1:* Render Static Site usa **HashRouter** em vez de BrowserRouter — rule `/* → /index.html` do Render retorna 200 com body vazio (bug; investigado a fundo, doc context7 confere sintaxe; HashRouter contorna sem depender da config do servidor)
- *Desvio M0.2:* Steps de Supabase CLI (`supabase init`/`link`/CLI install) pulados — MCP `deploy_edge_function` cobre o caso sem precisar de password do banco

**Progresso da sessão anterior (Plano 01 — Tasks 5/6/7):**
- [x] Task 5 (Tailwind 4 + shadcn) — commit `e103dc3` — *desvio:* preset Nova/`neutral` (4.8.0 mudou defaults)
- [x] Task 6 (Vitest + smoke) — commit `f77e24e` — *desvio:* vitest pinado em `^3` (4.x exige Vite 6)
- [x] Task 7 (React Router + TDD) — commit `04f6779` — react-router-dom v7

**Estado do sistema ao final desta sessão:**
1. Supabase: `gtin_mktplace_ia` / ref `txvncrgkoynoxwopfkbp` — ativo, com Edge Function `hello` deployada e responsiva
2. Frontend: deployado em `https://ean2marketplace-frontend.onrender.com` (HashRouter, refresh sempre funciona)
3. Repo GitHub: `analistasistemas-bit/gtinmktplace` — main pushed
4. Build OK: `pnpm build` (153 módulos, 21 kB CSS, 212 kB JS gzip 69 kB) | Test OK: `pnpm test` (4 passed)
5. Credenciais em `.env.local` (gitignored): Supabase URL+key, Upstash Redis+QStash tokens+signing keys, OpenRouter API key
6. **Ainda pendente para próximo bloco de trabalho:** (a) `supabase secrets set` para envs do backend antes do primeiro Edge Function que use IA/Redis; (b) trilho ML Developers — Diego precisa criar o app no portal ML

---

## Resumo de progresso

| Marco | Status |
|---|---|
| Pré-implementação (brainstorming + ADRs) | ✅ |
| M0 — Setup inicial | ✅ |
| M1 — UI mockup com dados fake | ✅ (pendente walkthrough Diego) |
| M2 — Backend core | ✅ |
| M3 — IA copywriting + Vision | ✅ |
| M3.1 — Foto-capa + polimento UX | ✅ |
| M4 — Integração Mercado Livre | ⬜ |
| M5 — Polimento e testes | ⬜ |
| M6 — Lançamento | ⬜ |
| Trilho paralelo: app ML Developers | ✅ (criada em 2026-05-27, certificação dispensada — uso interno) |
| 🚀 Evolução v2 — SaaS multicanal | 🟡 em andamento (Fase 0 / Épico E1) — ver [seção dedicada](#-evolução-v2--saas-multicanal) |

---

## Como usar este arquivo

- Cada tarefa tem **status** (símbolo) + **estimativa** + **dependências** (quando relevante)
- Marque ✅ assim que concluir; mantenha 🟡 enquanto trabalha em uma; ⏸️ quando bloqueado
- Quando bloqueado, comentar a linha abaixo com o motivo
- Não delete tarefas concluídas — servem de histórico

---

## Pré-implementação (esta semana)

### Brainstorming e planejamento

- [x] Levantamento de contexto (perfil do usuário, projeto, MCPs)
- [x] Reformulação em relação ao PDF original
- [x] Definição de arquitetura técnica
- [x] Definição do modelo de dados
- [x] Definição do pipeline detalhado
- [x] Definição de UX e telas
- [x] Definição de roadmap e marcos
- [x] Criação dos 8 ADRs iniciais
- [x] Criação do ROADMAP.md
- [x] Criação do TASKS.md
- [x] Escrita do design doc consolidado em `docs/superpowers/specs/2026-05-26-publiai-design.md` — existe e é referenciado no CLAUDE.md
- [x] Revisão crítica do design doc (Diego ou agente revisor) — feita; achados viraram os gaps §543+
- [x] Escrita do plano de implementação detalhado (`writing-plans`) — planos 01–06 em `docs/superpowers/plans/`

---

## 🏁 M0 — Setup inicial

### Contas e provisionamento

- [x] Criar repositório Git no GitHub (`gtinmktplace`) — *Diego criou; remote adicionado e pushed nesta sessão*
- [x] Inicializar projeto local (`git init`, README inicial) — *feito na sessão 1 (Plano 01 Task 1)*
- [x] Criar projeto Supabase (via supabase-mcp-server) — *Diego criou manualmente como `gtin_mktplace_ia` / ref `txvncrgkoynoxwopfkbp`*
- [x] Anotar URL e ANON_KEY do Supabase em `.env.local` — *capturado via MCP `get_project_url` + `get_publishable_keys` (publishable key, não legacy anon)*
- [x] Criar Render Static Site conectado ao repo — *service `srv-d8at8arbc2fs73e5qcb0` criado via MCP, auto-deploy ativo, URL pública responsiva*
- [x] Criar conta Upstash + QStash + Redis (via upstash MCP) — *Redis `mktplace-redis` (us-east-1 global, free) + QStash (eu-central-1, free) já provisionados*
- [x] Anotar tokens de QStash e Redis em `.env.local` — *gravado em `.env.local` (gitignored)*
- [x] (Substituída por ADR-0010) Criar conta OpenRouter + adicionar crédito mínimo — *Diego forneceu a key, gravada em `.env.local`*
- [x] Provisionar `OPENROUTER_API_KEY` + `UPSTASH_*` + `QSTASH_TOKEN` como Supabase secrets (`supabase secrets set ...`) — configurados no M2/M3 (edge functions de IA/Redis em produção)

### Trilho paralelo: Mercado Livre Developers ✅ (2026-05-27)

- [x] Acessar [Mercado Livre Developers](https://developers.mercadolibre.com.br/) — conta da Avil Têxtil já existia
- [x] Criar app "PubliAI" — Client ID `5907788004648058`, fluxos `Authorization Code` + `Refresh Token`
- [x] Configurar redirect URI — Supabase Edge Function (`ml-oauth-callback`) — ver [ADR-0011](decisions/0011-redirect-uri-via-edge-function.md)
- [x] `ML_CLIENT_ID` + `ML_CLIENT_SECRET` em `.env.local` (gitignored; serão movidos para Supabase Vault no M4)
- [⏭️] Submeter app para certificação — **dispensado**: uso interno, PubliAI publica nos anúncios da própria Daludi
- [⏭️] Aguardar aprovação — N/A (certificação dispensada)

### Setup do projeto frontend

- [x] Criar projeto Vite + React + TypeScript (`pnpm create vite`) — *Plano 01 Task 4 (sessão 1)*
- [x] Instalar Tailwind + setup conforme docs do Tailwind 4 — *commit `e103dc3`; Tailwind 4 CSS-only via `@import` + `@theme`*
- [x] Instalar shadcn/ui via CLI e inicializar — *commit `e103dc3`; preset Nova/neutral em vez de Slate (4.8 mudou default)*
- [x] Adicionar componentes shadcn iniciais (Button, Card, Badge, Dialog, Input, Sheet, Table) — adicionados sob demanda ao longo de M1–M3
- [x] Instalar TanStack Query, Zustand — `@tanstack/react-query` + `zustand` no `package.json`
- [x] Instalar Supabase JS client e configurar — *commit `9a0eabc`; TDD limpo (`src/lib/supabase.ts`)*
- [x] Criar estrutura de pastas: `src/components`, `src/lib`, `src/pages` — *`src/hooks` ainda não — criar no M1 quando precisar*
- [x] Verificar build local roda (`pnpm dev`) — *múltiplos builds OK na sessão; deploy Render confirma*

### Setup do projeto backend (Supabase)

- [ ] Instalar Supabase CLI localmente — *deferido; MCP `deploy_edge_function` cobre deploy sem CLI. Instalar se um dia precisar de dev local com Docker*
- [ ] `supabase init` + `supabase link` ao projeto remoto — *idem: deferido com MCP*
- [x] Criar pasta `supabase/functions` para Edge Functions — *criada no commit `9159e27`*
- [x] Criar Edge Function de teste `hello` para validar deploy — *commit `9159e27`, deployada via MCP, curl HTTP 200*

### Configuração geral

- [x] Adicionar `.env.example` + `.env.local` ao gitignore — *gitignore criado na sessão 1; `.env.local` verificado via `git check-ignore`*
- [x] Configurar Render para deploy automático ao push na main — *autoDeploy:yes via MCP; cada push em main triggera novo deploy em ~40s*
- [x] Validar que push gera deploy bem-sucedido — *commits `bad04ca`/`4e1ad16`/`7d25229` deployados live com sucesso*
- [x] Atualizar TASKS.md marcando M0 como completo — *esta atualização*

---

## 🏁 M1 — UI mockup com dados fake

### Layout e tema

- [x] Layout geral com sidebar + topbar + tema shadcn — *Nova/neutral mantido do M0; AppShell com Sidebar persistente + Topbar fina (commit `b9a6a97`)*
- [x] Criar mock data em `src/lib/mocks/` (lotes, famílias, variações realistas) — *types + 6 lotes + 50 famílias programáticas (commits `b4283a3` `79e6b53` `fa521d5`)*
- [x] Criar rota wrapper de autenticação simulada — *skipped no M1 conforme decisão UX: sidebar hardcoded `diego@empresa`*

### Tela Dashboard (lista de lotes)

- [x] Componente `LoteCard` (status, contadores, ações) — *commit `cc742f2`, TDD com destinoDoLote*
- [x] Lista de lotes consumindo mock — *useLotes hook (commit `25ab568`)*
- [x] Botão "Novo lote" navegando — *Plus icon + Link → /novo-lote*

### Tela Novo Lote (upload)

- [x] Componente `Dropzone` para planilha + imagens (react-dropzone) — *commit `a1b6ac2`, props reusáveis*
- [x] Validação de tipo de arquivo (`.xlsx` e `.jpg`/`.jpeg`/`.png`) — *via prop accept; CSV deferido pra M2 quando parse real entrar*
- [x] Preview de quantidade de arquivos — *"X arquivo(s) selecionado(s)" ou nome único*
- [x] Botão "Processar" navegando para tela de progresso — *navega para `/progresso/lote-novo-{timestamp}` (mock)*

### Tela Progresso

- [x] Layout de etapas com checkpoints visuais — *Stepper com aria-labels concluída/atual/pendente (commit `90db4d4`, TDD)*
- [x] Barra de progresso geral — *shadcn Progress*
- [x] Resumo do lote (mockado) — *38 famílias detectadas · 142 variações · 137 imagens matched · 5 órfãs (hardcoded)*
- [x] Simulação de progresso via timeout (avança a cada 2s) — *useEffect com setTimeout + cleanup*

### Tela Revisão em Lote (a mais complexa)

- [x] Componente `FamiliaRow` (substitui FamiliaCard original; design final é tabela densa) — *commit `8d1b9df`, TDD*
- [x] Cabeçalho da linha: badge CREATE/UPDATE, nome, thumbnail (cor), código PAI — *grid 6 cols, layout compacto*
- [x] Visualização da estratégia de preço (PRÓPRIO/COMPETITIVO com motivo) — *no FamiliaExpanded (commit `165a900`)*
- [x] Visualização de concorrência (sem/moderada/alta) — *no FamiliaExpanded*
- [x] Expansão accordion inline para mostrar variações — *FamiliaExpanded; múltiplas podem ficar abertas*
- [x] Edição inline de título, descrição, cor, preço (com `<Input>` controlado) — *state local no FamiliaExpanded; persistência só em M2*
- [x] Seleção em massa (checkbox por família) — *Set<id>, toggleSelecao imutável*
- [x] Ações em massa (Aprovar/Rejeitar selecionadas) — *footer sticky, commit `42b1414`, TDD; ambos limpam seleção em M1 (mock)*
- [x] Filtros chips (todos/CREATE/UPDATE/avisos) — *filtrarFamilias pura + 6 testes*
- [x] Busca por código ou nome — *case-insensitive em título, substring em PAI*
- [ ] Atalhos de teclado (J/K/A/R/Espaço) — *deferido para M5 (polimento)*
- [x] Footer com contadores e botões "Aprovar/Rejeitar selecionadas" — *sticky bottom, condicional em selecionadas.size > 0*

### Tela Relatório Final

- [x] Cards de resumo (publicadas, com erro, custo IA) — *3 cards grid, commit `ab85ba5`*
- [x] Lista de famílias com link clicável simulado — *href fixo `https://produto.mercadolivre.com.br/MLB-mockid`*
- [x] Botão "Editar e tentar de novo" para erros — *visual apenas no M1*
- [x] Botão "Exportar PDF" (placeholder, implementa em M5) — *Button disabled*

### Tela Configurações

- [x] Seção de conexão ML (estado mockado "Conectado") — *Badge verde + "como vendedor_mock" (commit `1aa0fd8`)*
- [x] Seção de estratégia de preço (radio buttons informacionais) — *RadioGroup default condicional, referencia ADR-0008*
- [x] Seção de categorias padrão — *MLB1132/1430/1429, referencia ADR-0009*

### Validação com Diego

- [x] Deploy de mockup em URL pública (Render) — *auto-deploy ativo desde M0; último deploy contém todas as 14 tasks*
- [ ] Walkthrough ao vivo: Diego percorre todas as telas — *aguardando Diego abrir a URL e validar*
- [ ] Lista de ajustes identificados na validação (acrescenta em TASKS) — *pós-walkthrough*

---

## 🏁 M2 — Backend core

### Status final (2026-05-27)

**M2 concluído** ✅ — pipeline técnico implementado em 1 sessão (16 tasks via Subagent-Driven Development) + bug bash com planilha real (290 variações da LINHA P/COST.XIK 120) realizado no mesmo dia. Pendências bloqueantes resolvidas (secrets configurados, usuário criado, validação ponta-a-ponta feita).

**Cobertura final:**
- Schema (4 tabelas + 7 enums + Vault standalone), auth, upload real para Storage privado, edge functions (ingest-lote completa + process-familia stub idempotente), TanStack Query com adapters DB→M1, Realtime via supabase channels + polling fallback
- **61 testes passando**, deploy automático Render (`ean2marketplace-frontend.onrender.com`), Edge Functions ACTIVE

**Bug bash do M2 — correções aplicadas no mesmo dia:**
- URL fix: sidebar Revisão apontava para `/revisao/lote-42` (uuid fake do M1) → agora vai para o lote mais recente via `RevisaoIndex`
- URL fix: docs/render.yaml diziam `publiai-frontend.onrender.com` mas o serviço Render se chama `ean2marketplace-frontend` desde a criação (Render não renomeia ao mudar yaml)
- Display: estoque "estq 92" → label "Estoque" + número formatado pt-BR (`1.400`)
- Display: imagens das variações + capa da família agora renderizadas via signed URLs (hook `useImageUrl`)
- Persistência: edição inline de título/descrição/preço agora grava no banco onBlur, com feedback visual `Salvando…` → `✓ Salvo` (antes era só estado React local)
- Busca: filtros agora encontram famílias também pelo código de qualquer variação filha
- Race condition: `useFamilias` aceita `refetchInterval`; Progresso poll 2.5s enquanto lote em trânsito (cobre gap se realtime perder evento)

**Desvios vs spec original (documentados nos commits):**
- pgsodium removido das migrations: extensão descontinuada pelo Supabase em 2024; supabase_vault 0.3.1 funciona standalone
- xlsx@^0.20 → ^0.18.5: SheetJS moveu versões novas só pro CDN próprio; npm registry só vai até 0.18.5 (mesma API)
- Migration `rls_initplan_fix` + `secure_trigger_and_indexes`: ajustes pós-review (auth.uid() wrap, revoke execute, drop índices redundantes)
- **TEMP: process-familia bypassando verificação de assinatura QStash** — o `Receiver.verify()` rejeitava com 401 (provavelmente chave de assinatura incorreta no Supabase Vault vs Upstash console). Restaurar em M3 quando as chaves forem reconfirmadas.

**Tarefas antecipadas do M3 (já implementadas no M2):**
- Edição inline persistindo no banco (M3 §300)
- Polling fallback no progresso (não estava no plano, ganho do bug bash)

**Tarefas adiadas pra M3 (decididas no bug bash):**
- Upload posterior de imagens em lote existente — drop zone + ícone por variação (ver §M3)

### Schema do banco

- [x] Criar migration inicial com enums (status, operacao, cor_origem, estrategia_preco) — `~2h`
- [x] Criar tabelas `lotes`, `familias`, `variacoes`, `ml_credentials` — `~3h`
- [x] Criar políticas RLS por user_id em todas as tabelas — `~2h`
- [x] Configurar Supabase Vault para tokens criptografados — `~1h`
- [x] Gerar tipos TypeScript do schema (`supabase gen types`) — `~30 min`
- [x] Validar políticas RLS com testes manuais — `~2h`

### Autenticação

- [x] Tela de Login (email/senha) com Supabase Auth — `~3h`
- [x] Tela de Cadastro (email/senha) — `~2h`
- [x] Tela de Reset de senha — `~2h`
- [x] Middleware de rota protegida — `~1h`
- [x] Hook `useAuth` com Zustand — `~1h`

### Storage

- [x] Criar bucket `imagens` privado no Supabase Storage — `~30 min`
- [x] Políticas RLS de Storage por user_id — `~1h`
- [x] Função helper para upload com retry — `~2h`
- [x] Função helper para gerar signed URL — `~30 min`

### Upload direto do frontend

- [x] Upload de planilha + imagens diretos pro Storage (chunks paralelos) — `~4h`
- [x] Barra de progresso real (não simulada) — `~2h`
- [x] Tratamento de erros de upload (rede, tamanho, tipo) — `~2h`

### Edge function `ingest-lote`

- [x] Setup base da edge function + tipos compartilhados — `~1h`
- [x] Parse de .xlsx usando SheetJS — `~2h`
- [x] Validação de colunas obrigatórias — `~2h`
- [x] Agrupamento por PAI (detecção do PAI=0) — `~2h`
- [x] Match de imagens por nome de arquivo (`00CODIGO.jpeg`) — `~2h`
- [x] Detecção de famílias já publicadas (query em `familias.ml_item_id`) — `~2h`
- [x] Persistência em `lotes` + `familias` + `variacoes` — `~3h`
- [x] Enfileiramento de jobs no QStash (via lib `lib/queue.ts`) — `~2h`
- [x] Retorno de `lote_id` para o frontend — `~30 min`
- [x] Tratamento de erros: planilha inválida, imagens órfãs, etc. — `~3h`

### Realtime no frontend

- [x] Hook `useLoteRealtime(loteId)` com Supabase channels — `~3h`
- [x] Atualização ao vivo da tela de Progresso — `~2h`
- [x] Reconexão automática se canal cai — `~1h`

### Bug bash do M2

- [x] Importar planilha real do Diego (LINHA P/COST.XIK 120 — 1 família, 290 variações, 2 imagens) — `~30 min`
- [x] Identificar edge cases e fixar — 7 correções aplicadas no mesmo dia (ver Status final acima)
- [x] Atualizar TASKS.md marcando M2 como completo

---

## 🏁 M3 — IA copywriting + Vision

### Status final (2026-05-28)

**M3 concluído** ✅ — pipeline IA implementado em 1 sessão (Plano 04, 20 tasks via Subagent-Driven Development) + bug bash colaborativo com 4 famílias reais no mesmo dia. Diego aprovou o output final: *"ficou ótimo agora"*.

**Cobertura final:**
- Edge functions deployadas via MCP: **process-familia v11** (pipeline real), **upload-imagens-lote v1**, **invalidar-cache-cor v1**
- Camada IA isolada: `_shared/ai/{client,modelos,tokens,vision,copywriter}.ts`
- Parser cor: `_shared/cor/{dicionario,extrair}.ts` com 42 cores PT-BR + word boundary unicode
- Cache Redis: `_shared/redis/{client,cache-cor}.ts` com TTL 90d + invalidação manual
- Pool concorrência: `_shared/concorrencia/pool.ts` (máx 5 chamadas Vision paralelas)
- Tela de Revisão consome dados reais; ganha BadgeCorOrigem + alerta sem cor + DropZoneImagensExistente + BotaoTrocarFoto
- **86 testes passando**, deploy automático Render confirmado

**Iteração do prompt (5 ajustes via bug bash):**
1. Título sem "Disponível em N cores"
2. Descrição sem preço por cor
3. Descrição sem código do produto
4. Lista de cores só com nomes ("- Preto" / "- Branco")
5. SEMPRE incluir seção "Aplicações" / "Para que serve"

**Vision endurecido:** cor muito escura → Preto; dúvida → Outra (operador valida manual)

**Restauração QStash:** signing keys rotacionadas via console Upstash + secrets atualizados no Supabase; smoke test via MCP confirma assinatura passa (401 → 400 por bug do MCP de teste, mas SDK do `ingest-lote` em produção funciona normal).

### Edge function `process-familia`

- [x] Esqueleto da edge function com idempotência (UPDATE atômico) — herdado do M2
- [x] Configurar QStash para chamar `process-familia` — herdado do M2
- [x] Validar idempotência com dispatch duplicado intencional — claim atômico via `UPDATE ... WHERE status='pendente'`

### OpenAI client + helpers

- [x] Setup do OpenAI SDK na edge function — `_shared/ai/client.ts` via OpenRouter
- [x] Error handling (rate limit, timeout, payload inválido) — try/catch + AbortSignal.timeout(30s)
- [x] Retry com backoff em erros transientes — delegado ao QStash (5xx retenta; 4xx persiste erro_mensagem)

### Atribuição de cor

- [x] Função `extrairCorDoTexto(texto)` com regex + dicionário PT-BR — 7 testes
- [x] Dicionário de cores comuns para aviamentos (42 canônicas + sinônimos) — 4 testes
- [x] Chamada de Vision para fallback — `_shared/ai/vision.ts` com prompt conservador
- [x] Prompt de Vision iterado e validado — endurecido após primeiro lote (Preto vs Azul Marinho)
- [x] Cache `cache:cor:{user_id}:{codigo}` no Upstash Redis (TTL 90d) — `_shared/redis/cache-cor.ts`
- [x] Salvar `cor_origem` (descricao/vision/manual) na variação — `OrigemCor` enum

### Geração de copy

- [x] Prompt base do copywriter de aviamentos — 6 regras inegociáveis
- [x] Validação com famílias reais — 4 famílias na sessão de bug bash
- [x] Iteração do prompt baseado em feedback do Diego — 2 ciclos (v9 → v10 → v11)
- [x] Função `gerarCopy(input)` retornando JSON estruturado — via `response_format: json_schema strict`
- [x] Parser do JSON com fallback de erro — try/catch dentro do adapter

### Tela de Revisão consome dados reais

- [x] Substituir mocks por hooks `useFamilias(loteId)` consumindo banco — `useFamilias` já existia desde M2; tipos/adapters estendidos com novos campos
- [x] Realtime update da tela conforme famílias ficam ready — herdado do M2
- [x] Edição inline persistindo no banco — para título, descrição, cor, preço com `*_editado_pelo_operador`
- [x] Flags `editado_pelo_operador` marcadas corretamente — flag de cor adicionada na migration 0007
- [x] Invalidação de cache Redis ao editar cor manualmente — `updateVariacaoCor` chama edge `invalidar-cache-cor`

### Upload posterior de imagens (decidido no bug bash M2)

- [x] Drop zone na Revisão para adicionar imagens em massa — `DropZoneImagensExistente` (component test)
- [x] Ícone de câmera por VariacaoCard — `BotaoTrocarFoto` (component test)
- [x] Edge function `upload-imagens-lote` — JWT auth, match por código com 8 dígitos, retorna `{ok, ja_tinha, sem_match, erros}`
- [x] Helper `src/lib/upload-imagens.ts` que chama a edge via fetch + invalida query TanStack

### Bug bash do M3

- [x] Lote real processado completamente — 4 famílias (linha + fitas + linha)
- [x] Diego revisou qualidade da IA e indicou ajustes — 5 ajustes aplicados via prompt iteration
- [x] Diego aprovou output final — "ficou ótimo agora"
- [x] Atualizar TASKS.md/ROADMAP.md marcando M3 como completo

---

## M3.1 — Foto-capa por família + polimento UX (2026-05-28)

### Foto-capa (Plano 05, 12 tasks subagent-driven)

- [x] Task 1 — Migration `capa_familia` + regeneração de tipos (commit `d57e10a`)
- [x] Task 2 — Expor `capaStoragePath` em Familia + mapper (`7f0344e`)
- [x] Task 3 — Helper TDD `classificarArquivo` (6 testes verdes, `fcb4cca`)
- [x] Task 4 — Edge function `upload-imagens-lote` v5 detecta prefixo CAPA_ (6 testes, `c69d926`)
- [x] Task 5 — Helpers cliente `subirCapaFamilia` / `removerCapaFamilia` (`3dfc479`)
- [x] Task 6 — Componente `<FotoCapaFamilia>` (3 testes, `6735f5b`)
- [x] Task 7 — Helper `urlCapaFamilia` (signedUrl, `48448a2`)
- [x] Task 8 — Card colapsado prioriza capa explícita (`5fe6183`)
- [x] Task 9 — Card expandido com Trocar/Remover (`47e1ddc`)
- [x] Task 10 — Contadores `capas_ok` no drop-zone (`b2be2d9`)
- [x] Task 11 — Smoke test manual aprovado por Diego
- [x] Task 12 — Docs finais (esta task)

### Ajustes adicionais do dia

- [x] Barra de progresso real no drop em lote (chunks de 5) — `de1f034`
- [x] Novo template de descrição com seções emoji — `b6fd20f` + process-familia v12
- [x] Botão "Regenerar descrição" por família — `f2340a5` + regenerar-copy-familia v1
- [x] Fix: regenerar atualiza state local imediato — `20c8fdf`
- [x] Badge cor_origem compacto (só ícone com tooltip) — `7b5d2ae` + `dcf23a1` + `7f40f87`
- [x] GTIN/EAN editável por variação — `8865dad`

**Status final do dia:** 101/101 testes passando, build verde, push concluído. Próximo marco: M4 (Integração Mercado Livre).

---

## 🏁 M4 — Integração Mercado Livre

### OAuth Mercado Livre ✅ (2026-05-29)

**Bloco OAuth concluído** via subagent-driven (spec + ADR-0012 + plano 15 tasks). Bug bash real aprovado: conectou como `AVILBV` (ml_user_id 1003820507), token gravado no Vault, scope com `write`/`publish-sync`/`offline_access`; disconnect limpa linha + segredos (0 órfãos). Ver [spec](superpowers/specs/2026-05-29-m4-oauth-ml-design.md) e [plano](superpowers/plans/2026-05-29-m4-oauth-ml.md).

- [x] Tela "Conectar Mercado Livre" em Configurações — seção real com badge/nickname + Conectar/Desconectar (`useMlConnection`)
- [x] Botão que abre URL de autorização (com state CSRF) — `ml-oauth-start` gera state no Redis (TTL 10min) + `montarAuthUrl`
- [⏭️] Página de callback (`/ml-callback`) — **dispensada**: callback é a Edge Function (ADR-0011), não rota do frontend
- [x] Edge function `ml-oauth-callback` (troca code por tokens) — deployada `verify_jwt:false`, redireciona com `?ml_conectado`/`?ml_erro`
- [x] Criptografia dos tokens via Supabase Vault — **reaproveitada do M2** (`upsert_ml_credentials`/`get_ml_tokens`); só faltou `delete_ml_credentials` (migration nova) p/ o disconnect
- [x] Helper de refresh proativo — `getValidAccessToken` (`_shared/ml/token.ts`) com lock distribuído Redis `SET NX` ([ADR-0012](decisions/0012-refresh-token-oauth-ml-com-lock-redis.md)); resolve gap §541
- [x] Validação manual do fluxo OAuth de ponta a ponta — bug bash 2026-05-29 (Diego)

**Desvios/achados do bug bash:**
- Bug corrigido: domínio de autorização do **Brasil é `auth.mercadolivre.com.br`** (com "v"), não `mercadolibre.com.br` — DNS NXDOMAIN no primeiro teste.
- Bug corrigido: banner "Conta conectada" ficava preso após disconnect (param `?ml_conectado` na URL) → agora gated no estado real.
- Sem testes unitários da orquestração (token.ts/edge functions): restrição do vitest (só funções puras importáveis) — `montarAuthUrl`/`precisaRenovar` testadas; resto validado no bug bash. 106/106 testes verdes.
- [x] **eslint instalado (2026-05-31)** — toolchain ESLint 9 flat config (`@eslint/js` + `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` + `globals`), config em `eslint.config.js`. `pnpm lint` passa (0 errors, 3 warnings benignos de `react-refresh` em arquivos shadcn ui + Revisao). `no-explicit-any` desligado só em `tests/**` (mocks do Supabase). Edge Functions (`supabase/functions`, Deno) ficam fora do lint do frontend.
- `getValidAccessToken` ainda **não tem consumidor** — será usado nos blocos de concorrência/publicação.

### Busca de concorrência

> **Plano:** [plano-07](superpowers/plans/2026-05-31-plan-07-busca-concorrencia.md) · **Spec/ADR:** [ADR-0014](decisions/0014-busca-de-concorrencia.md). Tasks 1–9 ✅ na `main` — **122 testes verdes**. Migration `add_concorrencia_familias` aplicada via MCP (2026-06-01); `process-familia` **v14** ACTIVE integra a busca. Falta só a Task 10 (bug bash com token ML real).

- [x] Função de busca por GTIN — `_shared/ml/concorrencia.ts` (`buscarConcorrencia`, ramo `gtin`) + `escolherIdentificador`/`gtinValido`
- [x] Função de busca por título (fallback) — mesmo `buscarConcorrencia`, ramo `titulo` (baixa confiança)
- [x] Classificação (sem/moderada/alta) — `_shared/concorrencia/classificar.ts`
- [x] Cache `cache:concorrencia:*` no Redis (TTL 6h) — `_shared/redis/cache-concorrencia.ts` (chave com hash do título)
- [x] **Migration** (2 enums + 4 colunas `concorrencia_*` em `familias`) + regenerar tipos — plano-07 Task 8 (MCP `apply_migration` `add_concorrencia_familias`; `database.types.ts` atualizado; build verde)
- [x] **Integração na edge function `process-familia` + deploy** — plano-07 Task 9 (busca 1×/família após a copy; `process-familia` v14 deployada via MCP)
- [x] **Bug bash** (lote real #5, 4 famílias) — plano-07 Task 10 ✅. **Achado:** `/sites/MLB/search` retorna 403 (descontinuado pelo ML). Corrigido para catálogo `/products/search` → `/products/{id}/items` (ver Adendo do [ADR-0014](decisions/0014-busca-de-concorrencia.md)). **Validação ponta a ponta (v15, token AVILBV):** FITA N.3 → 6 vend./R$12,62; LINHA XIK → 6/R$12,90; FITA N.9 → 9/R$17,99 (todas `origem=gtin`, classe alta); LINHA 1500MT (GTIN fora do catálogo ML) → `gtin`/0 vendedores, status `pronto` (resiliência OK). Ramo título não quantifica (catálogo textual = ~10k ruído) → `origem='titulo'`/PRÓPRIO seguro (sem família sem-GTIN no lote; lógica é retorno trivial). **Nota:** o MCP QStash não aciona o `process-familia` (conta divergente das signing keys); reprocessar exige lote novo pela UI (`ingest-lote` usa o SDK QStash real).

### Estratégia de preço condicional ✅ (2026-06-01)

> `process-familia` **v16** · função pura `calcularEstrategiaPreco` (TDD, 6 testes) · ADR-0008.

- [x] Função `calcularEstrategiaPreco(preco_planilha, concorrencia)` conforme ADR-0008 — `_shared/preco/calcular.ts` (TDD, 6 testes; cobre os 3 ramos + edge "já menor" + dado incompleto)
- [x] Persistência: `estrategia_preco`/`estrategia_motivo` na família + `preco_publicacao` por variação (preserva `preco_editado_pelo_operador`) — `process-familia` v16
- [x] Sinalização visual: badge PRÓPRIO/COMPETITIVO (já existia) + linha "publica: R$ X" no card + vendedores/menor preço no expandido + alerta de preço perigoso (gap §556, `precoAbaixo20pc` real no adapter)
- **Validação (projeção SQL com dados reais do lote #5):** Daludi vende 2–3× mais barato que o ML → todas as famílias caem em **PRÓPRIO ("já menor")**; o ramo COMPETITIVO raramente dispara na prática. Confirma o edge case central do ADR-0008. _Persistência v16 na UI fica visível no próximo lote subido (v16 só roda em lotes processados após o deploy)._

### Mapeamento de categorias e atributos ✅ (2026-06-01)

> `process-familia` **v17** · `_shared/categoria/{detectar,atributos}.ts` (TDD, 17 testes) · ADR-0009 + Adendo. **IDs do ADR estavam errados** (chutes) → reais validados via API ML.

- [x] Categoria ML para Linhas → **MLB270273** (Fios e Cadarços de Armarinho), não MLB1132
- [x] Categoria ML para Botões → **MLB270272**, não MLB1430
- [x] Categoria ML para Fitas → **MLB255054** (Fitas de Cetim), não MLB1429
- [x] Detecção de tipo (`detectarTipoAviamento`, regex PT-BR; camada IA fica como melhoria futura)
- [x] Atributos obrigatórios por categoria (mapa real da API: BRAND+MODEL / BRAND+RIBBON_TYPE / BRAND+MATERIAL)
- [x] Função `montarAtributosML(tipo, nome)` — BRAND fixo "Avil", MODEL=nome, RIBBON_TYPE/MATERIAL inferidos
- [x] Validação `atributosFaltantes` + badge "categoria indefinida" na revisão quando `tipo=outro`
- Persiste `tipo_aviamento`/`tipo_origem`/`categoria_ml_id`/`atributos_ml`. IDs corrigidos também na tela Configurações.

### Publicação CREATE

- [x] **Pré-publicação: implementar [ADR-0013](decisions/0013-edge-cases-da-planilha-no-ingest.md)** (edge cases da planilha, não-bloqueantes) ✅ 2026-06-03 — `agruparPorPai` retorna `{ grupos, anomalias }` com dedup por CODIGO (1ª vence) + coleta de órfãos/PAI-sem-filho (sem `throw`); `ingest-lote` aborta só se sobrar 0 família e persiste `anomalias` na coluna `lotes.anomalias_planilha` (jsonb, migration `add_anomalias_planilha_lotes`); `Progresso.tsx` mostra faixa âmbar dos descartados. TDD: `_shared/__tests__/parser.test.ts` (5) + `tests/lib/anomalias.test.ts` (5). 173 testes verdes. **Falta:** deploy do `ingest-lote` via MCP.
> **Implementado via [plano-10](superpowers/plans/2026-06-03-plan-10-publicacao-create.md)** (subagent-driven, spec `2026-06-03-m4-publicacao-create-design.md`). 14 tasks + correções pós-review. 190 testes verdes, build/lint verdes. **Falta só o bug bash com token real (Task 13 abaixo).**

- [x] **Seleção do que publicar (pedido do Diego)** ✅ 2026-06-03 — granularidade família + excluir cores; `familiaPublicavel` (TDD, 9 testes) bloqueia incompletas com motivo; selo na `FamiliaRow`, checkbox "incluir cor" no `FamiliaExpanded` (persiste `variacoes.excluida_da_publicacao`), filtro "🔒 Incompletas", footer "Publicar selecionadas" + modal de confirmação.
- [x] Edge function `publish-familia-ml` (worker) ✅ — deploy **v2** (correções de idempotência pós-review). Idempotente (`ml_item_id`), valida atributos server-side, sobe fotos, `POST /items`, persiste.
- [x] Edge function `publicar-familias` (disparo) ✅ — deploy v1. Claim atômico `status='publicando'` (filtra user_id/CREATE/pronto/`ml_item_id` null) + enfileira no QStash via `enfileirarPublicacao`.
- [x] Montar payload com variações nativas ✅ — `montarPayloadItem` (`_shared/ml/publicar.ts`, TDD 4 testes). _Defaults `listing_type_id`/`condition`/GTIN a confirmar no bug bash._
- [x] Upload das fotos para o ML ✅ — `subirFotoML` (`POST /pictures`); signed URL TTL 2h (gap §569); capa cacheada em `familias.capa_ml_picture_id` (idempotente em retries).
- [x] POST `/items` com tratamento de resposta ✅ — `criarItemML` (`_shared/ml/criar-item.ts`), propaga `status` HTTP.
- [x] Salvar `ml_item_id`, `ml_permalink`, `ml_variation_id`s ✅ — no worker; `ml_variation_id` casado por `seller_custom_field` com fallback por índice.
- [x] Tratamento de erros 4xx vs 5xx (retry vs fail) ✅ — 4xx/erro local → `status='erro'`; 5xx/429 → mantém `publicando` e relança p/ QStash retentar; transição do lote `publicando→concluido/revisao` ao fim.

### Publicação UPDATE

- [ ] Montar payload de atualização (variações com estoque/preço novos) — `~3h`
- [ ] PUT `/items/{ml_item_id}` — `~2h`
- [ ] Verificar se UPDATE detecta variações novas ou removidas — `~2h`
- [ ] Atualizar `publicado_em` no banco — `~30 min`

### Tela de Relatório Final

- [x] Consumir dados reais (sucesso/erro por família) ✅ 2026-06-03 — `Relatorio.tsx` via `useFamilias`/`useLote`/`useLoteRealtime` + polling enquanto `lote.status='publicando'`
- [x] Links clicáveis para anúncios publicados ✅ — `mlPermalink` exposto no adapter
- [x] Botão "Editar e tentar de novo" para erros ✅ — mostra `erroMensagem` + volta à Revisão
- [ ] Custo de IA somado do lote — `~2h` (deferido; cards atuais: publicadas/publicando/erro)

### Bug bash do M4 (Publicação CREATE) — **✅ VALIDADO (2026-06-04, 2 anúncios reais; ver histórico no CLAUDE.md)**

> Task 13 do plano-10. Edges deployadas: `publicar-familias` v1, `publish-familia-ml` v2. Os 3 pontos da spec §5.4 foram descobertos e resolvidos contra a API real (GTIN sem EAN → `EMPTY_GTIN_REASON`; `listing_type_id` Clássico/Premium via modal; foto via `POST /pictures`). UPDATE, capa2/capa3, preço v2, catálogo e retry de foto também já validados em lotes reais posteriores.

- [x] Subir um lote novo pela UI (1 família simples, fotos + GTIN válido), processar até `pronto`
- [x] Selecionar e publicar pela UI; observar `familias.erro_mensagem` se falhar
- [x] Iterar os 3 pontos de descoberta (GTIN/listing_type/foto) re-deployando o worker
- [x] Validar 1 publicação real bem-sucedida (anúncio no ML com fotos/cores/preço; ids persistidos)
- [x] Atualizar os testes de `montarPayloadItem` para o formato final + ADR de fechamento se surgir decisão nova
- [x] (UPDATE validado em blocos seguintes — lotes #28/#31)

---

## 🏁 M5 — Polimento e testes

### Reprocessamento e edição pós-erro

- [ ] Botão "tentar de novo" reenfileira família com erro — `~2h`
- [ ] Substituir foto de variação na tela de revisão (upload pontual) — `~3h`

### Auditoria e qualidade IA

- [ ] Painel simples mostrando "% editado pelo operador" por categoria — `~3h`
- [ ] Export de pares "IA gerou X, operador editou pra Y" pra retroalimentar prompt — `~3h`

### Filtros e produtividade

- [ ] Atalhos de teclado finalizados (A/R/J/K/Espaço/Ctrl+A) — `~3h`
- [ ] Filtros funcionais na tela de revisão — `~3h`
- [ ] Busca por código ou nome com debounce — `~2h`

### Notificações

- [ ] Notification API do browser quando lote termina processamento — `~2h`
- [ ] Toast Sonner em sucessos/erros — `~2h`

### Export de relatório

- [ ] Geração de PDF do relatório (react-pdf ou similar) — `~4h`

### Bug bash final

- [ ] Lote real grande (50+ famílias) ponta a ponta — `~2h`
- [ ] Tudo o que aparecer no bug bash, fixar ou diferir explicitamente — *variável*

---

## 🏁 M6 — Lançamento

### Deploy de produção

- [ ] Configurar domínio customizado em Render (se aplicável) — `~2h`
- [ ] Configurar HTTPS e cookies seguros — `~1h`
- [ ] Smoke test em produção — `~1h`

### Documentação para operador

- [ ] Guia rápido em 1 página (fluxo + atalhos) — `~3h`
- [ ] Vídeo curto (3-5 min) gravando uma sessão completa — `~1h`

### Treinamento e acompanhamento

- [ ] Sessão presencial ou remoto com operador (1h) — `~1h`
- [ ] Acompanhar primeiros 3 lotes de uso real — *contínuo*
- [ ] Coletar feedback do operador e abrir tasks de melhorias — *contínuo*

### Métricas iniciais

- [ ] Medir tempo médio de processamento por lote — `~1h`
- [ ] Medir tempo médio de revisão pelo operador — `~1h`
- [ ] Medir taxa de aprovação sem edição (proxy de qualidade IA) — `~1h`
- [ ] Medir custo operacional mensal real — `~1h`

---

## 🚀 Evolução v2 — SaaS multicanal

> Decomposição operacional do [documento mestre](superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md). **Convenção:** após cada implementação, marco o checkbox e atualizo o **"📍 Passo atual"** no topo deste arquivo — assim você sempre sabe exatamente onde estamos. Cada épico roda em **branch isolada da `main`** (app em produção); merge → `main` + deploy só com OK do Diego.

**📍 Passo atual:** Evolução SaaS · Fase 1 · **E1 + E1b + E2 + E3 + E4 ✅ validados em produção** — a camada de canais, o modelo multicanal `anuncios_externos`, a categoria genérica e os atributos por IA closed-set estão em produção. Bug bash real do E4 cobriu publicação de vertical nova pela UI (`MLB4779431383`, depois removido do sistema; `anuncios_externos` voltou a 21). Próximo: **E5** (conector Shopee, ADR-0027).

| Fase | Épico | Status | ADR |
|---|---|---|---|
| 0 | E1 Camada de abstração (CREATE) | ✅ validado em produção | 0024 |
| 0 | E1b Abstração UPDATE + status | ✅ validado em produção | 0024 |
| 0 | E2 Modelo de dados multicanal | ✅ validado em produção | 0025 |
| 1 | E3 Taxonomia canônica + categoria por IA | ✅ validado em produção | 0026 |
| 1 | E4 Atributos por IA (closed-set) | ✅ validado em produção | 0026 |
| 2 | E5 Conector Shopee | ⬜ | (a criar) |
| 2 | E6 Orquestração multicanal | ⬜ | (a criar) |
| 3 | E7 Multi-tenancy | ⬜ | 0027 |
| 3 | E8 Billing (Asaas) + LGPD | ⬜ | 0028 |
| 3 | E9 Operação SaaS | ⬜ | (a criar) |

### Fase 0 — Fundação (sem mudança visível)

**E1 — Camada de abstração de canais (CREATE)** · [plano](superpowers/plans/2026-06-14-e1-camada-abstracao-canais.md) · ADR-0024 · ✅ **validado em produção**
- [x] E1.1 `contrato.ts` — `ChannelConnector` + tipos canônicos (`AnuncioCanonico`, `ResultadoCanal`, `Capabilities`, `RefAnuncio`) — commit `d64e256`
- [x] E1.2 `mapeamento.ts` — puras `mapearVariacoesExternas` + `classificarErroCanal` (TDD, 6 testes) — commit `e8f0116`
- [x] E1.3 `mercado-livre.ts` — `MercadoLivreConnector` delegando ao `_shared/ml` — commit `540066b`
- [x] E1.4 `registry.ts` — `getConnector` (TDD, 2 testes) — commit `bc61f95`
- [x] E1.5 religar `publish-familia-ml` via conector (comportamento idêntico) — commit `542c061`, review independente (opus) APROVADO
- [x] E1.✅ verificação: backend 505 testes verdes + lint + diff review + review opus + **bug bash real ✅** (lote de teste via automação de navegador → publicou `MLB6966315202` pelo conector; id/variação/foto persistidos; anúncio encerrado e removido) + merge→`main` (`1118d62`) + deploy `publish-familia-ml` via CLI **validado em produção (2026-06-14)**. As falhas transientes de foto no caminho foram tratadas corretamente pelo conector (retentável → retry).

**E1b — Abstração UPDATE + status** · [plano](superpowers/plans/2026-06-14-e1b-abstracao-update-status.md) · ADR-0024 · ✅ **validado em produção (2026-06-14)**
- [x] E1b.1 contrato: `atualizarAnuncio` + `sincronizarDescricao` + `lerStatus` + tipos `AtualizacaoCanonica`/`ResultadoAtualizacao`/`StatusCanal` + `status?` no `ErroCanal` — commit `d6d64bd`
- [x] E1b.2 `MercadoLivreConnector` implementa os 3 métodos delegando a `atualizar-item`/`atualizar`/`criar-item`/`pacote`/`status`; `mapearVariacoesPorSku` (UPDATE casa só por `seller_custom_field`, TDD) — commit `d6d64bd`
- [x] E1b.3 religar `update-familia-ml` via `conn.atualizarAnuncio`/`sincronizarDescricao`/`subirFoto` (catch/idempotência/limpeza de cache de foto preservados) — commit `a9f2510`
- [x] E1b.4 religar `status-publicados` via `conn.lerStatus` (`semCredencialML` preservado) — commit `a9f2510`
- [x] E1b.✅ backend 340 testes verdes + lint 0 erros + review independente (opus) **APROVADO — EQUIVALENTE** (8 pontos, `tsc` 0 erros) + merge→`main` (`08e77e5`) + deploy `update-familia-ml` v26/`status-publicados` v4/`publish-familia-ml` v25 via CLI + **bug bash real via automação de navegador**: família de teste descartável CREATE→UPDATE (reposição estoque 10→25/8→3 **+ cor nova** criada e casada via refetch; descrição "CORES DISPONÍVEIS" atualizada; estoque ao vivo 43 lido por `lerStatus` na tela Publicados) — anúncio `MLB6966427644` encerrado e todo o dado de teste removido (ML/banco/storage)

**E2 — Modelo de dados multicanal** · [plano](superpowers/plans/2026-06-14-e2-modelo-dados-multicanal.md) · [spec](superpowers/specs/2026-06-14-e2-modelo-dados-multicanal-design.md) · ADR-0025 · ✅ **validado em produção (2026-06-14)**
- [x] E2.1 migration aditiva `anuncios_externos` (1 produto → N anúncios) + enum `canal_externo` + RLS + índice + trigger — ancorada em `(user_id, canal, codigo_pai)` (não `familia_id`: `familias` é por-lote e várias linhas compartilham `ml_item_id`). `canais_conectados` diferido p/ E7; estoque único (decisões Diego)
- [x] E2.2 backfill na própria migration (agrega todas as variações de todas as famílias do mesmo `(user_id, codigo_pai)`, dedup por código) — verificado: 21 anúncios, 414 entradas == 414 `(codigo_pai,codigo)` distintos casados
- [x] E2.3 helper `_shared/anuncios/espelhar.ts` — puras `montarAnuncioExterno` + `mesclarVariacoesExternas` (TDD, 7 testes) + `espelharAnuncioExterno` best-effort (merge antes do upsert: reposição parcial não trunca o mapa)
- [x] E2.4 dual-write nos workers `publish-familia-ml`/`update-familia-ml`/`vincular-catalogo` (após a persistência `ml_*`, best-effort, leitura/idempotência inalteradas)
- [x] E2.✅ 579 testes verdes + tsc/lint 0 erros + **review independente (opus) APROVADO COM RESSALVAS** (🟠 do truncamento corrigido com merge + backfill agregado; 🟡 status/erro só no sucesso = intencional) + deploy `publish`/`update`/`vincular-catalogo` via CLI + **bug bash real via browser**: família de teste descartável **CREATE** (`MLB6966524308`, espelho criado com mapa de 2 cores) → **UPDATE** (reposição + cor nova Verde → mapa cresceu p/ 3, merge preservou as antigas) → **catálogo** (job QStash → `catalog_status` gravado no mapa) — anúncio encerrado no ML e todo o dado de teste removido (espelho voltou a 21 linhas de produção)
- [ ] E2.5 (diferido) view de compatibilidade + cutover de leitura para `anuncios_externos` + remover colunas `ml_*`/`catalog_*` de `familias`/`variacoes` quando o frontend migrar ("corte do tronco")

### Fase 1 — "Qualquer produto"

**E3 — Categoria genérica + schema dinâmico** · [spec](superpowers/specs/2026-06-14-e3-categoria-generica-design.md) · ADR-0026 · ✅ **validado em produção (2026-06-14)**
- [x] E3.1 resolução em camadas: override por vertical → preditor nativo ML (`domain_discovery`) → LLM desempate closed-set → manual
- [x] E3.2 schema dinâmico de atributos via `/categories/{id}/attributes` (cache Redis) + persistência de `categoria_nome`/`atributos_faltantes`
- [x] E3.3 UI da Revisão mostra categoria prevista, origem e faltantes; aviamentos mantêm override determinístico sem regressão
- [x] E3.✅ 25 testes novos, review independente aprovado, deploy via CLI e bug bash real via browser-use

**E4 — Preenchimento de atributos por IA (closed-set) + validação** · [spec](superpowers/specs/2026-06-14-e4-atributos-ia-closed-set-design.md) · ADR-0026 · ✅ **validado em produção (2026-06-14)**
- [x] E4.1 LLM extrai valores escolhendo dentro de `values[]` permitidos (closed-set), sem inventar `value_id`
- [x] E4.2 gate de publicação generalizado para categoria prevista/manual e aviamentos sem regressão
- [x] E4.3 `EMPTY_GTIN_REASON` generalizado por schema da categoria quando suportado pelo ML
- [x] E4.✅ 14 testes novos, review independente sem bloqueios, deploy via CLI, publicação real de vertical nova pela UI (`MLB4779431383`) e limpeza total do dado de teste (`anuncios_externos` voltou a 21)

### Fase 2 — 2º canal

**E5 — Conector Shopee** · ADR a criar · [deep-dive §8.1 do doc mestre]
- [ ] E5.1 registrar app no Shopee Open Platform (`partner_id`/`partner_key`); confirmar requisitos BR no portal logado
- [ ] E5.2 `ShopeeConnector`: auth OAuth + HMAC-SHA256 + refresh proativo (lock Redis, reusar ADR-0012); `capabilities`
- [ ] E5.3 mapeador `AnuncioCanonico → add_item` (item + `tier_variation`/`models`); upload `media_space`; categoria + `get_attribute_tree` + `brand`
- [ ] E5.4 `update_stock`/`update_price`/`lerStatus`
- [ ] E5.5 classificador de erro Shopee → enum canônico
- [ ] E5.6 bug bash com token real Shopee BR (GTIN/EAN: `3000*` não passa — depende do E3/E4)

**E6 — Orquestração multicanal** · ADR a criar
- [ ] E6.1 `publicar-familias` aceita `{ familia_ids, canais[] }`
- [ ] E6.2 worker genérico `publicar-anuncio` (`{ familia_id, canal }`); idempotência por `(familia,canal)`
- [ ] E6.3 fan-out com delay escalonado por canal (rate limit)
- [ ] E6.4 reconciliação: `lerStatus` por `(familia,canal)`
- [ ] E6.5 frontend: seleção de canais na Revisão + status por canal em Publicados

### Fase 3 — Virar SaaS comercial (só quando houver interessado externo)

**E7 — Multi-tenancy** · ADR-0027
- [ ] E7.1 migration: `organizations` + `organization_members` + `organization_invitations` + enum `org_role` + funções `is_member_of`/`has_role_on_org`
- [ ] E7.2 `org_id` aditivo em `lotes`/`familias`/`variacoes`/`anuncios_externos` + backfill (org pessoal) + índices
- [ ] E7.3 trocar policies `user_id=auth.uid()` → `is_member_of(org_id)` (manter `user_id` como criado_por)
- [ ] E7.4 `ml_credentials` → `marketplace_connections` (org+canal+conta); helpers Vault por `connection_id`
- [ ] E7.5 🔴 blindar edge functions (resolver+validar `org_id` do JWT antes de tocar segredos)
- [ ] E7.6 onboarding self-serve (`handle_new_user` + `accept-invite`) + troca de org ativa no frontend
- [ ] E7.7 `lotes.numero` global → sequência por org
- [ ] E7.✅ validar isolamento (get_advisors security + teste cross-tenant)

**E8 — Billing (Asaas) + LGPD** · ADR-0028
- [ ] E8.1 integrar Asaas (Pix/boleto/cartão recorrente + Pix Automático)
- [ ] E8.2 tabelas `assinaturas` + `uso_ciclo` (RLS por org)
- [ ] E8.3 edge `webhook-asaas` (HMAC + idempotência) + reconciliação por cron
- [ ] E8.4 entitlements/gating server-side (checar limite antes do claim; medir anúncios ATIVOS; repasse de IA com franquia+teto)
- [ ] E8.5 planos (Free/Starter/Pro/Scale)
- [ ] E8.6 LGPD: `audit_log` por org + DPA + export/exclusão de titular

**E9 — Operação SaaS**
- [ ] E9.1 observabilidade por canal (erro/latência/rate-limit) + alertas
- [ ] E9.2 gestão de rate-limit por canal (token bucket) no fan-out
- [ ] E9.3 painel de saúde de integração
- [ ] E9.4 suporte: logs por tenant + replay de job + fila de exceções
- [ ] E9.5 Supabase: pooler Supavisor (transaction mode) nas edges + revisão de plano/custo

---

## Backlog (v2 e além)

- [x] **UI não atualiza sozinha após "Reenviar" na Revisão** (achado 2026-07-22, durante validação do ADR-0088; corrigido 2026-07-23) — Diego reportou que a tela ficava presa em "Ainda em processamento" e só refletia o status real (`pronto`/`publicando`/`erro`) depois de F5 manual. Causa raiz: `Revisao.tsx` era a única tela do fluxo (vs. `Progresso.tsx`/`Relatorio.tsx`) sem assinatura realtime — `useReprocessar`'s `onSuccess` invalidava a query cedo demais (antes do worker `process-familia`, disparado via QStash, terminar), e sem realtime não havia segundo gatilho pra refletir o resultado final. Fix: `useLoteRealtime(loteId)` adicionado em `Revisao.tsx`, mesmo padrão das outras duas telas. 1 teste novo (`Revisao.realtime.test.tsx`, mock de `useLoteRealtime` provando a chamada com o `loteId` da rota). **Pendente:** validação em navegador real (Playwright) — código e teste unitário prontos, mas o comportamento visual ("some sozinho sem F5") ainda não foi observado ao vivo.

Itens fora do MVP, deliberadamente diferidos:

- Suporte a tecidos (escopo + atributos diferentes)
- Outros marketplaces (Shopee, Magalu, Amazon)
- Sincronização contínua com sistema interno (CDC/webhook)
- Multi-usuário com permissões
- Dashboard analítico (vendas, conversão)
- Bot de Q&A no ML
- Tabela "de-para" fornecedor → cor (caso Vision dê erro recorrente)
- Estratégias de preço configuráveis por lote

---

## ⚠ Gaps conhecidos da revisão crítica do spec (2026-05-26)

A revisão independente do spec (executada via agente crítico em 2026-05-26) levantou achados 🔴 críticos e 🟠 altos. Os 2 críticos foram **resolvidos** via [ADR-0009](decisions/0009-campos-payload-ml-e-categoria-deterministica.md). Os 4 altos foram **deferidos para tratamento durante a implementação** — abaixo, listados onde cada um precisa ser retomado para não cair no esquecimento.

### 🟠 Tratar durante M4 (Integração ML)

- [ ] **UPDATE com variação adicionada/removida** — quando reimportar uma família já publicada e ela ganhar/perder cores, sistema deve detectar e sinalizar com badge na tela de revisão. Não precisa publicar a mudança automaticamente, mas precisa COMUNICAR. Senão o operador publica com estoque/variação errados. Atualizar [ADR-0005](decisions/0005-lifecycle-publish-and-update.md) com regra antes de implementar.
- [x] **OAuth refresh com lock no Redis** — ✅ resolvido no bloco OAuth do M4. `getValidAccessToken` usa lock `SET NX` no Upstash (TTL 30s) + refresh proativo (buffer 5min). Documentado em [ADR-0012](decisions/0012-refresh-token-oauth-ml-com-lock-redis.md) (o gap citava "ADR-0010", mas esse número já era do OpenRouter).
- [x] **Alerta visual de preço perigoso** — ✅ 2026-06-01. `precoAbaixo20pc` no adapter (`familiaFromRow`): alguma variação com `preco_publicacao < 0.8 × preco`. O alerta vermelho na tela de revisão já existia (`familia-expanded.tsx`), agora alimentado por dado real. Não bloqueia publicação, só sinaliza.
- [ ] **Reavaliar duração de M4 para 3 semanas** — escopo real (~20 tarefas substanciais) parece pedir 3 semanas. Decidir ao iniciar M4: ou estender M4, ou mover busca de concorrência + estratégia de preço para M3 (são independentes do OAuth).

### 🟡 Tratar durante M2 (parsing de planilha) e M4

- [ ] **Edge cases da planilha** — regra definida em [ADR-0013](decisions/0013-edge-cases-da-planilha-no-ingest.md) (2026-05-31): todas não-bloqueantes (descartar + contar no resumo). CODIGO duplicado → manter a 1ª; filho órfão → pular o filho; PAI sem filho → pular a família. **Hoje os três casos ou rejeitam o lote (órfão/PAI vazio) ou são silenciosos (duplicado)** — ver comportamento atual no ADR. **Implementação pendente** no fluxo de ingest/publicação do M4 (dedup por CODIGO + trocar os 2 `throw` por coleta + contadores no resumo do lote).
- [ ] **Signed URL com TTL longo para foto no ML** — API ML faz download assíncrono; signed URL precisa de TTL > tempo de processamento ML (≥1h) ou usar upload direto via `POST /pictures`.
- [x] **Critérios de classificação de concorrência** — definidos em [ADR-0014](decisions/0014-busca-de-concorrencia.md): sem=0; moderada=1–5; alta=6+ (apenas informativo; o preço segue a regra binária do ADR-0008).
- [x] **Invalidar cache de cor** — implementado no M3: edge `invalidar-cache-cor` é chamada quando o operador edita a cor manualmente.

### 🟢 Lembretes pequenos

- [x] **CORS** — `_shared/cors.ts` aplicado em todas as Edge Functions (`handleOptions` + `corsHeaders`).
- [x] **Zustand vs TanStack Query** — divisão aplicada na prática: Zustand para UI/auth state; TanStack Query para server state.

---

## Ajustes de UX da Revisão

- [x] **Painel de Análise visual no topo do anúncio** (2026-06-01) — move estratégia/concorrência/categoria do final do expandido para um painel visual (cards + ícones + cores semânticas) ao lado da foto-capa; consolida o alerta de preço perigoso. Componente `PainelAnalise` (TDD 7 testes). Spec: [2026-06-01-painel-analise-revisao-design.md](superpowers/specs/2026-06-01-painel-analise-revisao-design.md) · Plano: [plano-08](superpowers/plans/2026-06-01-plan-08-painel-analise.md). Só frontend; 155 testes verdes.
- [x] **Card "Potencial de venda" no painel** (2026-06-01) — proxies de mercado (faixa de preço dos concorrentes, frete grátis, FULL, força dos concorrentes = MercadoLíder + maior vendas, ranking da categoria, idade no catálogo), já que a venda exata por produto não é exposta pela API do ML. Backend: `parseItensProduto`→`DadosOfertas` + `analisarMercado` (`_shared/ml/mercado.ts`, cache seller 24h/highlights 6h) + coluna `analise_mercado jsonb`; `process-familia` **v18**. Frontend: card no `PainelAnalise` (`fmtMilhar`). [ADR-0015](decisions/0015-potencial-de-venda-via-proxies.md) · spec `2026-06-01-potencial-de-venda-design.md` · [plano-09](superpowers/plans/2026-06-01-plan-09-potencial-de-venda.md). 162 testes verdes. **Falta:** bug bash com lote real (validar `analise_mercado` persistido + card na tela).

---

## Notas livres

Espaço para observações, decisões pendentes pequenas, ideias durante a implementação:

> _(adicione aqui conforme o projeto avança — exemplos: "operador prefere foto na esquerda", "categoria de fitas precisa de atributo X", etc.)_

- [x] **Fix margem `-Infinity` + JSON nulo no Faturamento** (2026-06-26) — `calcularResumo` dividia por `liqComCusto` com guarda em `custoTotal` (venda com líquido 0 e custo > 0 → `-Infinity`); guarda corrigida para `liqComCusto > 0`. Também: `faturamento.ts`/`financeiro.ts`/`perguntas.ts` retornavam `null as T` quando o body 200 não era JSON válido — agora lançam erro. TDD (1 teste novo). 900 testes verdes. Só frontend.
- [x] **Lazy routes + dedup `normGtin`** (2026-06-26) — páginas viraram `React.lazy` + `Suspense` em `App.tsx` (code-splitting): bundle inicial saiu de ~tudo para `index` 180kB gzip + chunk da rota; `Faturamento`/`Financeiro`/`xlsx`/`html2canvas` agora sob demanda. `normGtin` extraído p/ `lib/gtin.ts` (fonte única). **Não** mesclei as cadeias custos↔fotos (duplicação proposital p/ isolar o fluxo de dinheiro). 993 testes verdes; validado no browser. Só frontend.
- [x] **Segurança B+C** (2026-06-26) — **B:** `notificar-liberacao` era pública (`verify_jwt=false`) sem verificar assinatura QStash; adicionada `verificarAssinatura` (igual aos outros 11 workers), deployada com `--no-verify-jwt`. Validado: request sem assinatura → 401. **C:** `telegram_config_status()` (SECURITY DEFINER) tinha EXECUTE p/ `anon` (advisor 0028); migration revoga de anon (mantém authenticated). Validado no app (Configurações carrega). **D (proteção de senha vazada / HIBP):** bloqueada — só no plano Pro do Supabase; reabilitar quando fizer upgrade.
- [x] **Segurança A — migração SheetJS** (2026-06-26) — `xlsx` do npm (`^0.18.5`) está descontinuado/sem patch (Prototype Pollution CVE-2023-30533 + ReDoS CVE-2024-22363) e é usado p/ parsear uploads (`validar-planilha.ts` `XLSX.read`). Trocado pela versão oficial da CDN do SheetJS `0.20.3` (`pnpm add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`). `pnpm audit --prod` não acusa mais SheetJS. 993 testes verdes; validado no browser (upload real → "Planilha válida, 14 colunas presentes"). Frontend.
- [x] **Fix categoria/título — tipo de produto genérico via IA (lote #50)** (2026-07-02) — 5 famílias do lote #50 saíram com categoria "Outros" (2x) ou "Corantes" (errada, 2x — barbante Euroroma confundido por colisão textual "CORES"→"Corantes" na busca do ML) e título sem o tipo de produto ("BARBANTE" sumiu mesmo estando na descrição-fonte). Root-cause via chamadas reais à API do ML (não hipotética): nome bruto da planilha é ruído de SKU pra busca textual do preditor; query limpa resolve. `gerarCopy` ganhou campo `tipo_produto_busca` (grounded, mesmo espírito anti-invenção do ADR-0052) que alimenta uma 2ª busca ao preditor + guard determinístico de título (`garantirTipoProdutoTitulo`). Candidatos de categoria genéricos ("Outros" etc.) nunca são aceitos como resposta final; IA de desempate passa a rodar sempre que houver candidato específico e ganhou permissão de abster-se (`category_id: null` — achado empírico: o modelo devolve a STRING `"null"`, não o literal, tratado explicitamente). [ADR-0054](decisions/0054-categoria-titulo-tipo-produto-generico.md) · plano [2026-07-02-categoria-titulo-tipo-produto.md](superpowers/plans/2026-07-02-categoria-titulo-tipo-produto.md). Fase 2 (sinal de categoria de concorrentes, já buscado hoje pra preço mas descartado) avaliada e adiada — testes empíricos mostram unanimidade de concorrentes pode ser **errada** (colisão de GTIN/catálogo). TDD completo (resolver.test.ts (a)-(k) preservados intactos + (l)-(r) novos); 1129 testes verdes (suíte inteira); wiring nos 3 pontos que chamam `gerarCopy` (`process-familia`, `regenerar-copy-familia`, `titulo-particao.ts`). Branch aguardando validação do Diego.
- [x] **Fix busca por código/EAN de variação (Publicados + Revisão + Vendas)** (2026-07-03) — na tela **Publicados**, buscar pelo código de uma variação (ex.: `03096963`, cuja família tem `codigo_pai` `03096955`) retornava "Nenhum resultado": `filtrarPublicados` só casava `codigoPai` + GTIN representativo, e `publicadoFromRow` descartava o `codigo`/`gtin` de cada variação (embora carregados no `select`). Root-cause via SQL real no banco (confirmado `03096963` = `variacoes.codigo`, não `codigo_pai`). Fix: `PublicadoItem.identificadores[]` (todos os codigo+gtin das variações) montado em `publicadoFromRow` e casado em `filtrarPublicados`. Auditadas as outras 2 buscas textuais do sistema: **Revisão** já casava `v.codigo` mas ignorava o GTIN (add `v.gtin` em `filtrarFamilias`); **Faturamento→Vendas** casava `it.codigo` mas omitia o EAN existente (add `it.ean` em `pedidoCasaBusca`). Demais telas (Financeiro/Viabilidade/Lotes/Dashboard) sem busca textual por código — N/A. TDD (RED→GREEN em `publicados.test.ts`); 1157 testes verdes; build ok. Só frontend. Branch aguardando validação do Diego.
- [x] **Desconto sobre concorrência configurável** (2026-07-04) — o percentual de desconto aplicado ao preço quando há concorrente (`preço = menor_concorrente × 0,95`, ADR-0020) estava fixo no código, já sinalizado como "config futura". Vira parâmetro por usuário: coluna `configuracoes.desconto_concorrencia_pct` (default 5), 6º argumento opcional em `sugerirPrecoVenda` (`_shared/preco/sugerir.ts`), lido em `process-familia` junto com as alíquotas, editável em Configurações (card "Desconto sobre concorrência", mesmo padrão de "Desconto de marketing"). [ADR-0059](decisions/0059-desconto-concorrencia-configuravel.md). TDD (1 teste novo, motivo dinâmico no texto); 1170 testes (2 falhas pré-existentes em `Publicados.test.tsx`, não relacionadas). Só backend/config — sem mudança na tela de Revisão.
- [x] **Busca na aba Vendas do Faturamento** (2026-07-03) — campo de busca livre (client-side) por cliente, produto (título/código), número do pedido e valor. `pedidoCasaBusca` extraída como função pura em `pedidos-faturamento.ts`, indexando valores no mesmo formato exibido na tela (`fmtBRLSemSimbolo`, achado da revisão de código — `String(number)` cru nunca batia com o que o operador vê em `fmtBRL`). Combina (AND) com o filtro de status de envio já existente; inclui `p.chave` p/ achar pack pelo pack_id. Estado vazio diferenciado ("Nenhum pedido encontrado para essa busca/filtro") quando o filtro zera a lista mas há vendas no período. Spec: [2026-07-03-busca-vendas-faturamento-design.md](superpowers/specs/2026-07-03-busca-vendas-faturamento-design.md). TDD (10 testes novos); 1156 testes verdes; validado no browser (nome, valor exibido, sem-resultado). Só Vendas — Devoluções/Perguntas/Geografia ficaram fora por decisão do Diego. Merge → main → deploy live (commit `2397e2a`).
- [x] **Oculta card "Categorias padrão" do menu de Configurações** (2026-07-04) — card mostrava só o lookup fixo de 3 tipos (linha/botão/fita, ADR-0009) e dava a impressão enganosa de que o sistema só publica nesses 3 tipos; hoje o resolver cobre qualquer categoria via preditor+IA+busca livre (ADR-0057/0058), então a info estava desatualizada. Removido a pedido do Diego em vez de reescrever o texto. Só frontend; sem teste (remoção de JSX estático, sem lógica). Merge → main → deploy live (commit `c03db17`).
- [x] **Pausar/reativar anúncio publicado (ML)** (2026-07-04) — novo toggle na tela Publicados (3º ícone na linha, `Pause`/`Play`), restrito a admin (1ª ação de escrita do projeto gated por `profiles.is_admin`, não só membro). `ChannelConnector` ganha `atualizarStatus` (contrato multicanal, ADR-0024) implementado em `mercado-livre.ts` via `PUT /items/{id}` com `{status}`; nova edge function `atualizar-status-publicado` (`requireAdmin` + token da operação, mesmo padrão de `status-publicados`/ADR-0056). Confirmação (`AlertDialog`) só ao pausar; reativar é direto. Sem persistência local de status — `onSuccess` invalida `QK.statusPublicados` (mesmo padrão de `useRemoverPublicado`). [ADR-0060](decisions/0060-pausar-reativar-anuncio-ml.md). Deploy da nova função via CLI (versão 1, ACTIVE); as ~18 funções que também importam `_shared/auth.ts`/`_shared/canais` (comportamento comprovadamente inalterado — só aditivo) ficam para o redeploy completo pós-merge, conforme o próprio workflow documentado em `docs/how-to/deploy-e-migrations.md`. 1170 testes verdes (2 falhas pré-existentes em `Publicados.test.tsx`, confirmadas no baseline antes desta mudança — não relacionadas); `deno check`/`deno lint` das functions limpos. Validado end-to-end no browser contra o Mercado Livre real: pausou e reativou um anúncio de baixo risco (zero vendas no período), badge/ícone corretos nos dois sentidos, terminou como "Ativo". Branch aguardando validação/decisão do Diego.
- [x] **Fix markup absurdo em pedido cancelado (Faturamento)** (2026-07-06) — Diego notou um pedido cancelado com markup ~-200% no menu Faturamento (esperado: "—"/zerado, já que a venda não aconteceu). Causa raiz: `agruparPorPedido` era a única função de KPI/markup do projeto que não filtrava por `ehFaturavel(status)` — o líquido cru (sem o rateio de frete de pack, que já pula não-faturáveis) somado ao imposto ainda descontado inflava o "prejuízo" da linha/detalhe do pedido. Auditados todos os outros agregadores (`calcularResumo`, `calcularKpisPedidos`, `montarDetalheVendas`, `cockpit.ts`, `geografia-vendas.ts`): já excluíam cancelados corretamente (ADR-0038) — os KPIs agregados dos 3 menus (Publicados/Financeiro/Faturamento) nunca estiveram contaminados, só a linha/expand do pedido no Faturamento. Fix: líquido/imposto/custo/markup em `agruparPorPedido` só computam para membros/itens faturáveis; pedido cancelado passa a mostrar líquido R$0,00 e markup "—" (custo do produto continua visível, é atributo do item). TDD (1 teste novo replicando os números do pedido relatado); 1205 testes verdes. Só frontend. Merge → main → deploy live.
- [x] **Fix "vs. anterior" do filtro "Hoje" no Dashboard/Financeiro** (2026-07-06) — Diego notou que "Hoje" mostrava +14% vs. anterior em Pedidos mesmo com 11 pedidos o dia inteiro ontem (vs. 8 hoje até o momento) — número não fazia sentido nem como "ontem inteiro" nem como "ontem até a mesma hora". Causa raiz: `janelaAnterior()` (`lib/metricas.ts`) usa uma fórmula genérica — desloca a janela atual para trás pela sua **duração decorrida** — que é correta para presets/range (blocos fechados de N dias), mas quebra para "hoje": essa janela cresce o dia todo, então deslocar pelas horas já decorridas (ex.: 12h) não dá "ontem", dá um pedaço de ontem colado à meia-noite (ontem 12h→24h), perdendo a manhã de ontem inteira. Fix: `janelaAnterior` ganha 2º parâmetro opcional (`Periodo`); quando `tipo === 'hoje'`, desloca a janela inteira em exatamente 24h (ontem 00:00 → ontem na mesma hora de agora) em vez de pela duração decorrida. Presets/range inalterados (mesmo resultado matemático de antes). Call sites em `Dashboard.tsx`/`Financeiro.tsx` passam `periodo`. Achado à parte (não corrigido, fora de escopo): `src/lib/__tests__/metricas-hoje.test.ts` nunca roda — `vitest.config.ts` só inclui `./tests/**` e `./supabase/functions/**/__tests__/**`, não `src/**/__tests__/**`; teste real de `janelaAnterior`/`resolverJanela` vive em `tests/lib/metricas.test.ts`. TDD (1 teste novo reproduzindo o bug + o fix, no arquivo que de fato roda); 1206 testes verdes. Só frontend. Branch aguardando validação do Diego.
- [x] **Fix envio de resposta de mensagem pós-venda — ML `/messages` 404** (2026-07-14) — Diego reportou "Falha ao enviar: ML /messages 404: resource not found" ao responder no menu Faturamento→Mensagens. Causa raiz: o POST montava a URL errada em 3 pontos vs. a API documentada do ML (`POST /messages/packs/{pack}/sellers/{seller}?tag=post_sale` com body `{ from, to, text }`): (a) path com sufixo extra `/messages` — é o que gera o `resource not found`; (b) sem o query `?tag=post_sale`; (c) body `{ text, message_attachments: null }` sem os objetos `from`/`to` exigidos. O corpo de erro em espanhol ("Si quieres conocer los recursos de la API...") é a resposta genérica de rota-não-encontrada do ML, confirmando path inexistente (não recusa de regra). Mesma URL malformada existia duplicada no welcome fire-and-forget (`_shared/ml/mensagem.ts`, que engolia o erro) — fix na raiz: helper único `enviarMsgML` (path+tag+body corretos) usado pelos dois callers, cada um mantendo seu comportamento de erro (reply relança, welcome engole). O `to.user_id` (comprador) não era montado em lugar nenhum: para o reply, `resolverCompradorId` lê o `from` de uma mensagem `recebida` já sincronizada em `ml_mensagens` (scoped por `org_id`); para o welcome, `pedido.buyer.id` (já em escopo no `sync-venda`). TDD (teste de `responderMensagemPedido` reescrito fixando URL `?tag=post_sale` sem `/messages` + body `{ from, to, text }`); 1456 testes verdes; lint limpo. **Requer deploy CLI** de `responder-mensagem` + `sync-venda` (mudança em `_shared/` → redeployar as afetadas) e validação de um envio real ao ML pelo Diego. Branch aguardando validação/deploy do Diego.
- [x] **Fix fotos de produto sumindo no detalhe do pedido (Faturamento)** (2026-07-13) — Diego reportou pedido com 3 itens todos caindo no ícone de fallback (pacote genérico) em vez da foto. Descartada hipótese de dado/RLS: confirmado via SQL direto que `variacoes.imagem_path` existia, `ml_variation_id` batia com o item vendido, família publicada e o arquivo existia no storage com RLS liberando acesso. Causa raiz: `buscarFotos()` (`src/lib/fotos-produto.ts`) buscava todas as variações-com-foto da org numa query só, sem paginar; a org tinha 1249 linhas, acima do teto padrão (1000) do PostgREST, então ~249 fotos (entre elas as desses 3 itens) somem silenciosamente do mapa de resolução. `buscarVendas()` (`faturamento.ts`) já tinha essa proteção (`buscarTodasPaginas`) documentada pelo mesmo motivo; `buscarFotos()` ficou de fora. Fix: reaproveita `buscarTodasPaginas` em `buscarFotos()`. Confirmado via SQL que a 2ª página trazia exatamente as 249 linhas faltantes. 1442 testes verdes (suíte inteira, sem teste novo — wiring de paginação já coberto indiretamente por `buscarVendas`). Só frontend. Merge → main → deploy live (commit `594e3d4`).
- [x] **Ocultar lucro no card do Dashboard por padrão** (2026-07-17) — o card "Líquido no faturamento" mostrava sempre o lucro do período (`hint` "lucro R$ X"); Diego pediu para ficar oculto por padrão. Nova coluna `configuracoes.mostrar_lucro_dashboard` (default false, por org) segue 1:1 o padrão de `reancora_lider_ativa`; toggle em Configurações (`useMostrarLucroDashboard`/`useSalvarMostrarLucroDashboard`). `Dashboard.tsx` só monta o `hint` do `KpiCard` quando o toggle está ligado. Spec: [2026-07-17-ocultar-lucro-dashboard-design.md](superpowers/specs/2026-07-17-ocultar-lucro-dashboard-design.md) · Plano: [2026-07-17-ocultar-lucro-dashboard.md](superpowers/plans/2026-07-17-ocultar-lucro-dashboard.md). TDD (3 testes novos/ajustados); 1521 testes verdes (suíte inteira, confirmado independentemente). Só frontend + 1 coluna nova (sem RLS nova).
- [x] **Corte de egress do Supabase (estouro da cota Free)** (2026-07-19) — e-mail do Supabase avisando estouro: 6,74 GB de Egress contra 5 GB do plano Free, carência até 18/08/2026 (depois disso, 402 nas requisições). Diagnóstico pelo endpoint `usage/daily` do dashboard, não por estimativa: **Storage 4,75 GB (70%)**, **PostgREST 1,98 GB (29%)**, resto <1%; todo o consumo é do projeto `gtin_mktplace_ia` (o outro projeto da org marcou 0 GB). O bucket `imagens` tem 2.548 arquivos somando 377 MB, ou seja, saía inteiro ~12,6× no mês. Descartadas por evidência as duas fontes server-side: Vision de cor tem cache Redis por código (`process-familia`), e só ~120 anúncios foram criados/atualizados no período (~180 MB, 4%). Causa real: `useImageUrl` gerava signed URL nova a cada sessão → URL sempre diferente → CDN e navegador nunca cacheavam (Cached Egress em 0,04/5 GB confirmava). Os objetos **já** carregavam `cache-control: max-age=3600` — o cache existia e era anulado pelo token rotativo. Fix: signed URL de 7 dias persistida em `localStorage` (`publiai:img-urls:v1`, varredura de expirados na escrita) + `invalidarImagem(qc, path)` nos 3 handlers de troca de capa (token novo fura o cache do navegador ao trocar a foto). No REST, `useVendas` fazia poll de 45s com a janela inteira de vendas (~1.900 req/dia) e havia subido de 27 → 227 MB/dia: passou para 180s, `refetchOnWindowFocus` mantido. **Bucket público foi avaliado e recusado**: a policy ativa é `imagens: select org` (ADR-0027/E7) e existe isolamento multi-tenant real; URL pública não expira e um vazamento exporia o lote inteiro (nomes previsíveis `CAPA_00CODIGO.jpg`), incluindo foto de produto não publicado. [ADR-0081](decisions/0081-corte-de-egress-url-assinada-persistida.md). 1604 testes verdes (5 novos para o cache); lint e tsc limpos. Sem migration. Só frontend. Verificação é empírica no próximo ciclo de billing: Egress cobrado abaixo de 5,5 GB e Cached Egress subindo. Branch `fix/reduzir-egress-supabase` aguardando validação do Diego.
- [x] **Corte de egress fase 2 — poll incremental de vendas e select enxuto** (2026-07-19) — continuação do ADR-0081, atacando os dois maiores residuais medidos. **(A) `useVendas` incremental por marca d'água ([ADR-0082](decisions/0082-poll-incremental-de-vendas-por-marca-dagua.md)):** cada tick baixava a janela inteira com itens (~120 KB); agora, a partir do 2º tick, busca só `atualizado_em >= marca` e mescla (`marcaDagua`/`mesclarVendas`, funções puras testadas). Medido em runtime: `prev: 376` vendas em cache, `atualizado_em=gte.` na querystring, delta típico = **0 linhas** contra 376 do fetch completo. Impõe o contrato "todo writer que altera coluna exibida bumpa `atualizado_em`" — migration recria as 2 RPCs de saque e `devolucoes-io.ts` bumpa junto com `tem_devolucao`. **Folga de 60s na marca d'água** (achado da revisão): `atualizado_em = now()` é o timestamp do INÍCIO da transação, então escrita que começou antes e commitou depois tem timestamp menor e o delta a pularia para sempre — venda sumindo do Faturamento em silêncio; confirmado em produção que o backfill grava várias linhas no mesmo segundo. **Armadilha da migration** (achado da revisão): o corpo correto das RPCs é o de produção (`pg_get_functiondef`), não o da migration `20260702162832` — a E7 dropou `is_membro_operacao()` e reescreveu para `current_org_id()` + `org_id = v_org`; copiar da antiga quebraria o saque e removeria o isolamento entre organizações. **(B) Select enxuto em Progresso/Relatorio:** o poll de 2,5s baixava `select('*, variacoes(*)')` do lote inteiro (~300–500 KB/tick, ~10 MB/min durante o processamento); novo `fetchFamiliasResumo` traz 7 colunas, cache próprio (`familias-resumo`), realtime invalidando as duas queries. Cadência de 2,5s mantida de propósito — o corte é de payload, não de responsividade. Validado no browser: `select=id,codigo_pai,titulo_ml,nome_pai,status,erro_mensagem,ml_permalink`, telas renderizando idênticas. **Itens avaliados e recusados com números:** `fetchFamilias`/invalidate da Revisão (~200 MB/ciclo que não crescem, contra 1-2 dias no campo minado do ADR-0078) e miniaturas (backfill exigiria baixar os 377 MB do bucket para economizar ~90 MB/ciclo; transformação nativa é Pro-only). 1620 testes verdes, lint/tsc/build limpos. **Não aplicado em produção:** falta `supabase db push` da migration + redeploy de `sync-devolucao`, `backfill-faturamento` e `reconciliar-faturamento` — nessa ordem, ANTES do deploy do frontend. Branch `fix/reduzir-egress-supabase` aguardando validação do Diego.
- [x] **Fix: troca de aba no Faturamento refazia o fetch completo de vendas** (2026-07-19) — achado durante a validação do ADR-0082. `resolverJanela` chama `new Date()`: 'hoje'/'mes_atual' têm `ate` = agora e 'preset' tem também o `desde` = agora−N, então duas montagens do mesmo período produziam ISOs diferentes por alguns segundos. Com o ISO cheio na queryKey isso virava **cache distinto**; como as abas do Faturamento desmontam ao trocar (Radix `TabsContent`), cada ida e volta entre Vendas e Geografia refazia o fetch completo da janela (~376 vendas) e ainda descartava o cache de que o delta do poll incremental depende. Fix: `chaveJanela` trunca **só o `ate`** na data — seguro porque não existe venda com `date_closed` no futuro. O `desde` fica inteiro de propósito: truncá-lo também (primeira versão, pega na auditoria do Fable 5) faria um preset resolvido às 15:00 colidir com um range que começa 00:00 do mesmo dia, o range herdaria o cache do preset e o refetch em modo delta nunca traria as vendas da madrugada — **KPI financeiro menor que o real, em silêncio**. Consequência aceita: telas com período `preset` (Geografia, Devoluções) seguem refazendo o fetch a cada remontagem; 'hoje'/'mes_atual'/'range' reaproveitam. Medido no browser: **3 fetches completos em 4 trocas de aba → 2**. 4 testes novos; 1624 testes verdes, lint/tsc/build limpos. Só frontend, sem migration. [ADR-0082](decisions/0082-poll-incremental-de-vendas-por-marca-dagua.md).
- [x] **Fix categoria "cursor" (deslizador de zíper) caindo em "Outros" (lote #36)** (2026-07-20) — Diego reportou 2 de 4 famílias de "cursor" com categoria errada. Investigação real (API do ML + cache Redis de produção, não hipotética): o preditor (`domain_discovery`) devolveu **Zíperes (MLB271227) como único candidato, correto nos 4 casos** — a diferença estava na IA de desempate (ADR-0054), que abstraiu (`null`) incorretamente pra 2 famílias mesmo com um candidato certo e único. "Cursor" vira 5º tipo de aviamento determinístico (`detectar.ts`/`atributos.ts`, mesmo padrão de linha/fita/botao/cola do ADR-0009), bypassando preditor+IA por completo pra esse tipo — obrigatórios `BRAND+MODEL` e `EMPTY_GTIN_REASON` validados via API real. Migration aditiva no enum `tipo_aviamento` (`ALTER TYPE ... ADD VALUE 'cursor'`, mesmo padrão do `cola`). [ADR-0083](decisions/0083-cursor-de-zíper-tipo-aviamento-determinístico.md). Testes novos em `detectar.test.ts`/`atributos.test.ts`; 1627 testes verdes, lint/tsc limpos. Migration aplicada em produção e `db:check` validado. Merge direto → main (sem PR, a pedido do Diego).
- [x] **Fix: botão de escolher categoria (busca livre) sem feedback de carregamento** (2026-07-20) — Diego notou que clicar num candidato de categoria (`CardCategoria`/`BuscaCategoria`) "não fazia nada" por ~10s até a tela atualizar sozinha — a mutação já ficava `isPending` (botões desabilitados), mas sem nenhuma pista visual, parecendo travado. A latência real vem do backend (`definir-categoria-familia` → `resolverAtributosGenericos`, schema+IA, ADR-0052), não é bug de rede. Fix: mesmo padrão já usado em `config-telegram.tsx`/`familia-row.tsx` (spinner `Loader2` + troca de texto durante `isPending`) — usa `mutation.variables` do TanStack Query pra saber qual candidato específico foi clicado (sem state extra) e mostra "Aplicando…" só nele; busca (input + botão) desabilitada enquanto qualquer aplicação está em andamento. Só frontend, sem lógica de negócio alterada. 1 teste novo; 1628 testes verdes, lint/tsc limpos.
- [x] **Detecção reativa de categoria que exige item plano — sem lista mantida à mão (lote #37)** (2026-07-22) — "KIT AGULHA CROCHÊ" falhou no `POST /items` com a mesma assinatura do ADR-0084 (lote #36), numa categoria diferente de `MLB271227` — o `Set` hardcoded (`CATEGORIAS_QUE_EXIGEM_FAMILY_NAME`) não escala pra catálogo genérico: cada categoria nova do ML com esse comportamento vira incidente em produção antes do fix. Revisão adversarial (Codex, 5 rodadas via `codex-review`, log completo em [spike 034](spikes/034-review-codex-adr-0087.md)) descartou 2 desenhos mais complexos: gate preventivo por tag da conta (`user_product_seller`, achado real do ML — existe, mas não diz qual categoria específica, então não elimina custo real) e persistir o formato usado no CREATE pro UPDATE consultar depois (o `GET` ao vivo que o UPDATE já faz é mais confiável — persistir arriscaria reintroduzir o no-op silencioso do próprio ADR-0084 se o ML migrar o item depois, fora do controle do PubliAI). Decisão final: `criarAnuncio` tenta `variations` (ou `plano` direto se a categoria já estiver no `Set`, sem custo extra pra categorias conhecidas); se o ML rejeitar com a assinatura exata (`precisaItemPlano`: status 400 + `cause_id` 369+374, nenhuma causa bloqueante a mais, mensagens batendo com os termos esperados), reconstrói em formato plano e tenta 1 única vez a mais — tudo dentro de 1 único `try/catch` (achado da própria revisão: o retry, se mal colocado, deixaria exceção escapar do contrato "nunca lança" do conector). UPDATE **intocado**. [ADR-0087](decisions/0087-family-name-deteccao-reativa.md). TDD completo (RED→GREEN em 4 arquivos: `erro-ml.test.ts`, `criar-item.test.ts` novo, `publicar.test.ts`, `mercado-livre.test.ts`). Revisão adversarial do Codex (`/codex:adversarial-review`) achou 1 falha real pré-deploy: `TERMOS_369` usava alternação (`family_name|price|available_quantity`) em vez de exigir os 3 termos juntos — uma causa 369 mencionando só 1 dos 3 já disparava o retry; corrigido (`TERMOS_369.every(...)`) com 8 testes novos cobrindo cada termo isolado e cada combinação incompleta (matriz completa pedida pelo Codex). 1743 testes verdes (suíte inteira), lint e `deno check` limpos. **Deployado em produção (2026-07-22):** 26 functions que dependem (mapeadas via `deno info`, não grep manual) de `canais/mercado-livre.ts`/`ml/erro-ml.ts`/`ml/criar-item.ts`/`ml/publicar.ts` — todas as versões confirmadas +1 pós-deploy. **Merge com `main` + achado operacional:** a branch foi mergeada com a `main` (11 commits novos nesse meio-tempo, incluindo dedupe de notificações em `sync-venda`/`sync-devolucao`/`sync-pergunta`) — o deploy inicial (pré-merge) tinha sobrescrito essas 3 functions sem essa feature; detectado baixando o código real (`supabase functions download`, não assumido) e corrigido com 1 redeploy a mais dessas 3 (versões finais: sync-venda 40, sync-pergunta 18, sync-devolucao 21 — 2 bumps cada), confirmado que as duas features coexistem no bundle. Suíte reconfirmada verde pós-merge (1750 testes). **Pendente, requer ação humana:** reprocessar o lote #37 pelo botão "Reenviar" no app — `reprocessar-familia` exige sessão autenticada real (`requireUserOrg`), não dá pra disparar por CLI/agente. Branch aguardando o Diego clicar Reenviar pra validação end-to-end final, e aguardando OK pra push do merge pra `origin/main`.
- [x] **ADR-0088: publicação em User Products com N itens técnicos por família (multi-cor, lote #37 pt.2)** (2026-07-22) — mesmo lote #37, categoria diferente: "AGULHA CROCHÊ CABO PLÁSTICO MATTE" (`MLB419782`, 9 cores) caiu no `throw` proposital do ADR-0084/0087 pra famílias com >1 variação em categoria que exige item plano — publicar N cores nessa categoria exige N itens ML separados (1 por cor), linkados por `family_id`/`family_name`; a ML agrega os N itens numa única página de produto com seletor de cor pro cliente final (redesenho que os dois ADRs anteriores deixaram fora de escopo de propósito). Outro agente (Codex) escreveu um plano de implementação completo ([spec](superpowers/plans/2026-07-22-publicacao-legacy-user-products.md)) que foi revisado por 2 análises independentes (Sonnet 5 + Fable 5) antes de qualquer ADR: achados reais — deploy list hardcoded que repetiria o incidente do ADR-0087 (functions de faturamento/exclusão de lote fora da lista); escopo real de adaptação de vendas/moderação/status errado (`vendas.ts` não tem granularidade de variação hoje); remoção desnecessária do retry de 1 cor do ADR-0087, regredindo um 3º caller (`publicar-anuncio/processar.ts`) que o plano nem listava; `familias.ml_item_id` virando "1º item da partição 0" sem inventariar consumidores. ADR-0088 escrito incorporando essas 5 correções, depois revisado adversarialmente pelo Codex por **5 rodadas** (teto do skill `codex-review`, log completo em [spike 035](spikes/035-review-codex-adr-0088.md)) — a maioria dos achados foi aceita e corrigida (janela de idempotência por crash entre POST e persistência do ID, resolvida com busca real no ML por `seller_custom_field`/SKU, `GET /users/{id}/items/search?sku=...` confirmado na doc oficial; ancoragem da linha filha por `(anuncio_externo_id, sku)` em vez de `variacao_id`, que muda a cada re-ingest; `family_name` carregando identificador de partição pra não misturar faixas de preço na mesma UPP; função total de agregação de estado dos N filhos com `zero filhos → publicando`, snapshot explícito `skus_esperados` em vez de contagem solta, e flag `retirado` pra cor removida não travar a partição em `parcial` pra sempre; FK composta `(anuncio_externo_id, org_id)` de verdade em vez de "trigger/check" inválido no Postgres; mini-saga de mudança de composição no UPDATE). Duas alegações do Codex foram checadas e rejeitadas com evidência (RLS de `anuncios_externos` já é org-scoped desde `20260705165828_e7_rls_org.sql` — o grep dele não bateu porque o SQL usa `format()` com nome de tabela variável; `atualizar-status-publicado` não é IDOR real porque a posse do item já é garantida pelo token OAuth do próprio Mercado Livre). A 5ª rodada bateu o teto do skill (`MAX_ROUNDS=5`) ainda em `REVISE`, restrito ao caso de UPDATE (add/remover cor); Diego decidiu aplicar esse fix final fora do loop formal e aceitar a ADR. [ADR-0088](decisions/0088-publicacao-user-products-multi-item.md), status **Aceito**.

**Fase 1 implementada via TDD e validada em produção no mesmo dia (2026-07-22).** Migration (`anuncios_externos_itens` + `ml_formato_publicacao`, colunas `estado_desejado`/`skus_esperados`/`mudando_composicao` em `anuncios_externos`); cache de formato (`ml/formato-publicacao.ts`); `criarAnuncio` devolvendo `FORMATO_INCOMPATIVEL` só quando `variacoes.length > 1` em categoria UP (retry de 1 cor do ADR-0087 intocado — regressão testada); saga `user-products/publicar-grupo.ts` (reserva por `(anuncio_externo_id, sku)`, busca de órfão real via `GET /users/{seller}/items/search?sku=`, criar-pausado→confirmar→ativar, `agregarEstado` função total dos 10 casos da ADR); integração em `publish-familia-ml` (`publicar-familia-up.ts`); 3 consumidores de escopo §2 (`metricas-vendas`, `monitorar-moderados`, `status-publicados` + `faturamento/io.ts`); guarda mínima em `remover-publicado` (recusa remover família UP em vez de apagar local e deixar itens órfãos ativos no ML). 1845/1846 testes verdes (1 flake pré-existente do `App.test.tsx`, confirmado passando isolado), lint e `deno check` limpos.

**Deploy em produção:** migration aplicada (`supabase db push`) + 19 functions do blast radius recalculado via `deno info` (`atualizar-status-publicado`, `calcular-tarifa-ml`, `metricas-vendas`, `monitorar-moderados`, `process-familia`, `publicar-anuncio`, `publicar-split-ml`, `publish-familia-ml`, `status-publicados`, `update-familia-ml`, `vincular-catalogo`, `backfill-faturamento`, `ml-webhook`, `reconciliar-faturamento`, `sync-devolucao`, `sync-mensagem`, `sync-pergunta`, `sync-venda`, `remover-publicado`), todas confirmadas +1 de versão.

**3 bugs reais achados e corrigidos durante a validação end-to-end real (não pegos pelos testes, que usam fakes em memória sem constraints reais):**
1. Upsert da raiz UP não gravava `user_id` (`anuncios_externos.user_id` é NOT NULL — coluna original pré-E7, sobrevivente à migração pra `org_id`) → `null value in column "user_id"` em produção. Corrigido via TDD (teste RED confirmado, fix, GREEN), `publish-familia-ml` redeployado.
2. `family_name` podia passar de 60 caracteres (limite real do ML, "Family Name length is over of 60 character") quando o título já vinha no limite e o sufixo de partição `[p0]` estourava — truncagem adicionada.
3. O sufixo `[p0]` (pra desambiguar partições) vazava pro **título visível ao cliente final** na página do produto — achado só depois de publicar de verdade. Removido: este worker (`publish-familia-ml`) só publica a partição 0 e nunca precisa desambiguar (isso só existiria no split, que ainda não integra a saga UP).

**Validação real, família de 9 cores (PAI `03103331`, `MLB419782`, "AGULHA CROCHÊ CABO PLÁSTICO MATTE"):** publicada com sucesso — 9 itens ML criados (`MLB4931162851`, `MLB4931130399`, `MLB4931162903`, `MLB4931162923`, `MLB4931130471`, `MLB4931162979`, `MLB4931130513`, `MLB4931120073`, `MLB4931120097`), todos com o **mesmo `family_id` (5179533274814609)**, todos `ativo`, confirmado visualmente na página real do produto (9 cores selecionáveis na mesma UPP).

- [x] **Fase 2 — UPDATE por item filho + mini-saga de composição (adicionar/retirar cor de família UP já publicada)** (2026-07-23) — famílias UP tinham `variacoes.ml_variation_id=null` em todas as cores por design; rodar o `update-familia-ml` Legacy sem-modificação classificaria TODAS as cores como "novas" e tentaria criar variações indevidas. Implementado: `atualizar-composicao.ts` (mini-saga pura, segue os 4 passos literais da ADR — grava `skus_esperados`+`mudando_composicao=true` ANTES de qualquer chamada remota, muta (cor nova→CREATE plano; cor readicionada `retirado=true`→REATIVA, nunca recria; cor retirada→pausa), confirma por GET, só então marca `retirado`/limpa a flag) + `atualizar-familia-up.ts` (adapter real, reaproveitando `buscarItemUP`/`criarItemML`/`atualizarStatusML`/`atualizarItemPlanoML` já existentes) + roteamento em `update-familia-ml/processar.ts` (extraído de `index.ts`, mesmo padrão de `publish-familia-ml`/`remover-publicado`). **Revisão em 3 rodadas** (`code-review-fable5` solo + 2 segundas opiniões independentes do Codex, achados verificados linha a linha antes de aceitar) — achou e corrigiu, na 1ª leva, 1 CRÍTICA (exceção no meio da composição deixava `mudando_composicao=true` pra sempre, mascarando o erro atrás do gate de "mudança em andamento") + 4 ALTA (reativação cega de filho em `erro`/`compensacao_pendente`/`remocao_pendente`/pausado-administrativo; erro de query no roteamento caindo silencioso no Legacy; resultado "incompleto" nunca convergindo pra terminal + confirmação colapsando GET-falhou com seller-divergente; caminho UP pulando catálogo/descrição/atacado que o Legacy já faz) + 1 MÉDIA (`familyIdEsperado=null` desligava a validação de agrupamento entre cores readicionadas na mesma chamada); na 2ª leva, mais 1 bug real (o rastreamento de `criadas` — base do reenfileirar catálogo — se perdia numa retomada pós-crash, podendo deixar uma cor genuinamente nova sem vínculo de catálogo pra sempre) + revalidação de `family_id` ausente na confirmação PÓS-ativação + atacado não espelhava a condição exata do Legacy (não limpava PxQ quando faixas somem). 1915/1916 testes verdes (suíte inteira, só o flake conhecido de `App.test.tsx`), `deno lint` limpo. **Gap conhecido, registrado e não corrigido nesta entrega**: a sincronização de descrição no UPDATE UP reenvia o texto já persistido (`garantirDescricao`) em vez de recalcular a lista de cores como o Legacy faz (`sincronizarDescricao`) — a seção de cores da descrição pode ficar desatualizada depois de adicionar/retirar uma cor via UP. Proteção contra 2 execuções CONCORRENTES da mesma família permanece fora de escopo (limitação pré-existente e aceita de todo o ADR-0088, igual à saga de criação).
- [x] **Fix: gate de publicabilidade do frontend bloqueava QUALQUER UPDATE de família UP** (2026-07-23) — achado testando ao vivo em produção (Playwright + dev server local contra o Supabase real): reingestei a família real de 9 cores (PAI `03103331`) adicionando 1 cor de teste, e a tela de Revisão travou a família inteira com cadeado 🔒, exigindo foto nova para as 9 cores JÁ publicadas, não só a genuinamente nova. Causa: `src/lib/publicavel.ts` (`familiaPublicavel`/`criticasVariacao`/`variacoesEstoqueAlterado`) usava `v.mlVariationId` como único sinal de "cor já casada no ML" — sinal sempre `null` numa família UP por design (cada cor é seu próprio item ML). Fix: sinal `Variacao.jaCasadaUP` (resolvido em `src/lib/queries.ts`, nova `fetchSkusAtivosUP` espelhando a detecção do backend — raiz `anuncios_externos` partição 0 → filhos não-retirados com `item_externo_id` em `anuncios_externos_itens`) + predicado unificado `casadaNoMl = mlVariationId || jaCasadaUP` nos 3 lugares; Legacy cai byte-a-byte no comportamento antigo (`jaCasadaUP` undefined). 11 testes novos + regressão Legacy explícita, suíte inteira verde. **Validado contra produção real**: reingestei de novo depois do fix, o cadeado sumiu, publiquei a família com a cor de teste — bateu um caso real de `family_id` divergente (ML agrupou a cor nova numa família diferente), a mini-saga isolou corretamente só a cor nova em erro (9 cores reais intocadas, item nunca ativado no ML) — depois removi a cor de teste com sucesso (família voltou a `publicado` sem erro, 9 cores reais seguem `ativo` do início ao fim).
- [x] **Reconciliador de convergência automatizado** (2026-07-23) — retoma em background raízes UP travadas em `mudando_composicao=true` (antes só o "Reenviar" manual resolvia). `reconciliar-convergencia-up` (schedule QStash) reusa `atualizarFamiliaUP` por completo: janela anti-corrida de 15min + **claim atômico** (`reconciliar_convergencia_claim`, RPC — re-checa `mudando_composicao=true`/`atualizado_em` velho DENTRO do mesmo UPDATE que incrementa `reconciliacao_tentativas`); resolve a família EXATA do episódio via nova coluna durável `mudando_composicao_familia_id` (nunca por recência — múltiplas `familias` compartilham `codigo_pai`). **Revisão adversarial do Codex em 4 rodadas** (achados verificados linha a linha, 2 escaladas a mim mesmo confirmadas com re-leitura do código real, não aceitas de bandeja): 1ª rodada achou erro de compilação (`codigoPai` ausente do tipo), "anti-corrida" que era só delay sem exclusão real, resolução de família por `publicado_em` mais recente (ERRADA — corrigida com a coluna durável), risco de crash com SKU do override sem dado fonte, perda de `titulo`/`criado_em`, uso do contador de tentativas antes do increment — todos corrigidos via reescrita completa. 2ª rodada achou 4 problemas: guard de SKU ainda isentava SKUs "já ativos" (mas `reposicao()` zera estoque de QUALQUER SKU sem dado em `variacoes`, ativo ou não — isenção removida); `sem_mudanca` (early-return da saga) nunca limpa `mudando_composicao`, causando reclaim infinito (rede de segurança adicionada, só neste adapter — não na saga compartilhada); bug de ordenação de migration (função referenciava coluna de uma migration posterior — consolidado num único arquivo, ordem correta); comentário da migration superestimava a garantia do claim (reescrito: fecha a corrida entre execuções do reconciliador e contra worker que já tocou a raiz ANTES do claim, mas não contra um que comece um instante DEPOIS — risco residual aceito, mesma classe de "sem lock" já aceita no resto do ADR-0088). 3ª rodada achou o bug mais sutil: a rede de segurança do `sem_mudanca` engolia o próprio erro de UPDATE com `console.error`, podendo reportar `convergiu` com a raiz AINDA travada (e no caminho `sem_mudanca` o orçamento de tentativas nem se aplica → reclaim eterno) — trocado por `throw` (o catch já existente no driver mapeia pra `erro`), 3 testes novos cobrindo o payload exato da limpeza, a propagação da falha e o não-disparo em `retry`. 4ª rodada: **APPROVED**. `processar.ts` extraído (mesmo padrão de `remover-publicado`/`update-familia-ml`), 17 testes novos entre driver+adapter. Suíte inteira (241 arquivos/2017 testes) verde, `deno check`/`deno lint` limpos. **Deployado em produção (2026-07-24):** migration aplicada, function v1 ativa, schedule QStash `*/15 * * * *` criado (`scd_5P1xe886r5SXj6ywwfUdEvY1stKn`).
- [x] **Reconciliador de backfill** (2026-07-23) — importa pro modelo User Products itens planos já publicados no ML antes do ADR-0088 (ADR-0084/0087), sem linha em `anuncios_externos_itens`. Endpoint admin `reconciliar-user-products` (HTTP, JWT manual + `isAdmin`). **Revisão adversarial do Codex em 3 rodadas:** 1ª achou 6 problemas na versão inicial (client-side, 2 queries) — faltava `user_id` no upsert, upsert raiz+filho não-atômico em 2 chamadas HTTP, risco de truncar sem paginação (>1000 raízes), reprocessamento de `codigo_pai` duplicado (múltiplas `familias` históricas por âncora), status desconhecido defaultando pra ativo, sem verificação de posse (`seller_id`) — todos corrigidos com 2 novas RPCs `security definer` (`reconciliar_backfill_up_candidatas`: `distinct on (codigo_pai)` + `not exists` server-side, sem truncamento; `reconciliar_backfill_up_upsert`: raiz+filho numa única transação) + validação de posse/status no driver puro. 2ª rodada achou 2 bugs reais de SQL: `COMMENT ON FUNCTION` sem assinatura completa dos parâmetros (erro de sintaxe real — a migration falharia ao aplicar) e funções `SECURITY DEFINER` executáveis por `PUBLIC` por padrão (buraco de segurança real — qualquer cliente autenticado/anônimo chamaria a RPC direto via PostgREST, ignorando RLS) — corrigidos com assinaturas completas nos comentários + `REVOKE`/`GRANT` explícito só pra `service_role`, mais `search_path=''` e `pg_catalog.jsonb_build_array` qualificado. 3ª rodada: **APPROVED**. 21 testes novos (`buscar-item-backfill.test.ts` + `reconciliar-backfill.test.ts`). **Deployado em produção (2026-07-24):** migration aplicada, function v1 ativa.
- [x] **Sincronizar descrição no UPDATE UP recalculando a lista de cores** (2026-07-23) — antes, o UPDATE UP só reenviava o texto de descrição já persistido (`garantirDescricao`), sem recalcular a seção "🎨 CORES DISPONÍVEIS" ao adicionar/retirar cor. Fix: `atualizarSecaoCores` (`_shared/ml/criar-item.ts`) ganhou a capacidade de **recriar** a seção quando ausente (antes só sabia removê-la — assimetria real); `efeitosPosComposicao` (`atualizar-familia-up.ts`) agora empurra a descrição pra TODOS os N itens ativos incondicionalmente. **Revisão adversarial do Codex em 4 rodadas + 1 escalada real ao Opus:** 1ª rodada achou o push gated por "texto mudou" (bloquearia reparo de um push que falhou antes, já que o texto local já estaria atualizado) e o caso `finais.length===0` tratado como sucesso silencioso — ambos corrigidos. Disputa genuína sobre durabilidade do sinal de erro (eu e a 1ª leitura do Opus achamos que a notificação Telegram/in-app já bastava; Codex contra-argumentou que `gravarNotificacoesInApp` retorna cedo sem assinantes, então não é durável) — **escalado ao Opus para arbitragem final**, que confirmou o ponto do Codex: adicionadas colunas durável `descricao_status`/`descricao_erro` (mesmo padrão de `atacado_status`/`atacado_erro`, incluindo badge `descrição ⚠` na Revisão só em erro). 2ª rodada achou que a escrita do próprio `descricao_status` não checava seu erro, reintroduzindo a mesma classe de bug um nível abaixo — corrigido com `throw` (aproveita a cadeia de retry QStash já existente, confirmado via rastreamento do catch até `decidirRetryTransitorio`). 3ª e 4ª rodadas: **APPROVED**. Migration `20260723211633_adr88_descricao_status.sql`. **Deployado em produção (2026-07-24):** migration aplicada, functions afetadas redeployadas (blast radius recalculado via `deno info`, 12 functions, versões confirmadas +1).
- [x] **Guarda completa de remoção UP** (2026-07-23) — antes, `remover-publicado` só recusava remover famílias UP (guarda mínima); agora executa a mini-saga completa: pausa todos os N filhos, confirma por `GET`, só então deleta local. `remover-composicao.ts` (nova saga pura) + reescrita de `remover-publicado/processar.ts` (fail-closed em toda query, antes várias liam `{error}` e seguiam como sucesso). **Revisão adversarial do Codex em 4 rodadas + 1 escalada real ao Opus:** 1ª rodada achou 6 problemas (query de roteamento fail-open, TRY-ALL não sobrevivia a exceção real — só a "não-ok", erros de delete/select ignorados, gate `em_voo` fail-open) — todos corrigidos. Achado mais profundo, verificado relendo `atualizar-composicao.ts` linha a linha: confiar em `retirado=true` ou `item_externo_id=null` como "seguro pular" era provadamente errado — existem janelas de crash reais na mini-saga de composição onde um filho `retirado=true` ainda está genuinamente ativo no ML — **escalado ao Opus**, que definiu a regra final: iterar TODOS os filhos com `item_externo_id` (retirado ou não), TRY-ALL por filho (continua após exceção), tratar `404`/`410` como "item já sumiu, seguro" e só `criacao_incerta` (entre os `item_externo_id=null`) como perigoso o suficiente pra bloquear a remoção sem marcar `remocao_pendente` (evita travar a própria adoção de órfão da composição). 2ª rodada achou a re-checagem TOCTOU rodando DEPOIS de `storage.remove(paths)` (uma composição em voo ainda perderia as fotos mesmo com o delete do banco abortado) — movida pra antes, com teste provando que `removidos` fica vazio no abort. 3ª e 4ª rodadas: **APPROVED**. ~22 testes novos em `remover-publicado/__tests__/processar.test.ts`. **Risco residual aceito** (mesma classe do resto do ADR-0088): a corrida entre o 2º check e o delete é reduzida, não eliminada. **Deployado em produção (2026-07-24)**, incluso no blast radius de 12 functions redeployadas.

- [x] **Achado à parte: `reconciliar-faturamento` sem schedule QStash desde a criação** (2026-07-24, achado investigando o schedule do reconciliador de convergência acima) — a função foi criada em 2026-06-22 (ADR-0037) com a intenção explícita de "QStash schedule 1h", mas nenhum schedule apontava pra ela de fato (`GET /v2/schedules` só trazia `backfill-faturamento`/`monitorar-moderados`/`notificar-liberacao`); a função exige assinatura QStash e não tem nenhuma outra via de disparo — a rede de segurança contra webhooks perdidos de vendas/perguntas/devoluções nunca rodou automaticamente desde que foi construída (~1 mês). Corrigido: schedule `0 * * * *` criado em produção (`scd_7HR22qXe5kx4LogfYb2GStCDGcTD`), junto com o do reconciliador de convergência (`*/15 * * * *`). Detalhe em [edge-functions.md](reference/edge-functions.md).

- [x] **Fase 2 — Vinculação de catálogo (ADR-0021) para o caminho User Products** (2026-07-22) — achado durante a validação real do ADR-0088: o caminho Legacy chama `enfileirarVinculacaoCatalogo` automaticamente após o CREATE, o caminho UP (N itens separados) não tinha equivalente. Implementado: migration `20260722175451_adr88_catalogo_up.sql` espelha em `anuncios_externos_itens` as 4 colunas de catálogo de `variacoes` (mesmo `check`, nulável sem default); `catalogo.ts` ganha o equivalente "por item" (elegibilidade lida da raiz do JSON — item sem `variations[]` — e opt-in sem `variation_id`, confirmado contra a doc oficial do ML), reaproveitando `decidirAcaoCatalogo`/`fichaEquivalente`/`optinCatalogo` do Legacy sem alterá-los; `vincular-catalogo/vinculacao.ts` roteia UP↔Legacy pela presença de linhas em `anuncios_externos_itens`; `publicar-familia-up.ts` enfileira a mesma fila no sucesso da saga. **Revisão dupla antes de fechar** (`/code-review-fable5` solo + segunda opinião independente do Codex via `codex exec -s read-only`, achados cruzados linha a linha antes de aceitar — relatórios em `.code-review-fable5/code-review-v1.md`/`v2.md`): achou e **corrigiu** 2 ALTA reais — (1) `carregarFilhosCatalogoUP` engolia erro de query e virava silenciosamente "família é Legacy" numa família UP real, podendo gravar `catalog_status` errado em `variacoes` e disparar alerta falso de "todas as cores sem match" (agora propaga o erro); (2) falha ao persistir depois de um opt-in bem-sucedido no ML contava como sucesso, arriscando um 2º opt-in não-idempotente na próxima rodada (agora só conta sucesso depois de confirmar a persistência) — mesmo padrão pré-existente no `setVar` do Legacy, não corrigido lá (tech debt registrado, fora do escopo desta mudança). Também corrigido: query da raiz agora trava em `particao=0` (só a partição que a saga UP escreve hoje — evita misturar cores de partições diferentes quando o split for integrado); branch "item ainda não existe no ML" conta como `pendente` (retentável) em vez de reusar `sem_variation_id` (a mensagem de alerta antiga falava em "identificador de variação", que não existe no modelo UP). 5 testes novos cobrindo os 2 ALTA + partição; 1875 testes verdes, lint/`deno check` limpos.
- [x] **Fix publicação categoria Zíperes — item plano com `family_name` (lote #36)** (2026-07-20) — as 2 famílias "CURSOR N.3" com categoria certa (`MLB271227`, ADR-0083) falhavam no `POST /items`: `"The field variations is invalid with family name"` + `"body does not contains... [family_name, price, available_quantity]"`. Descartado por evidência: não é "1 variação inválida" (já publica em 6+ categorias, incl. `catalog_required`), não é diferença de config/atributos de categoria (idêntico às categorias já em produção via `GET /categories`). Causa real, confirmada em 3 rodadas de teste contra produção (log bruto via Management API, `function_logs`): a categoria não aceita o array `variations` de jeito nenhum — exige **item plano** (1 anúncio por cor, sem agrupamento), com `family_name` no corpo e **sem** `title`/`original_price` (a ML gera o título sozinha a partir de atributos/family_name). Escopo limitado a famílias com 1 variação (só caso real hoje); >1 cor falha alto (`throw`) em vez de arriscar payload errado — modelo N-itens-por-família é redesenho maior, fora de escopo. [ADR-0084](decisions/0084-family-name-categoria-zipper.md). 4 testes novos (`publicar.test.ts`); 1682 testes verdes, lint/tsc limpos. Deploy das 12 functions que importam `ml/publicar.ts`/`categoria/atributos.ts`. **Publicado em produção:** `02841061`→`MLB7209437722`, `02841096`→`MLB7209468002`. **UPDATE: achado, corrigido e validado end-to-end no mesmo dia.** 1ª simulação (bump de estoque/preço + revert) revelou que `atualizarAnuncio` mandava PUT `{variations:[]}` (GET do item plano não tem sub-recurso `variations`) — a ML aceitava sem erro, nada mudava no anúncio, e o app achava que tinha dado certo (no-op silencioso, pior que erro). Implementado o PUT plano de verdade: `atualizarItemPlanoML` (`ml/atualizar-item.ts`) manda `price`/`available_quantity` direto no corpo raiz (nunca `original_price` — a ML rejeita); `atualizarAnuncio` usa esse caminho quando detecta item plano com exatamente 1 variação e sem cor nova (>1 cor/cor nova segue falhando alto — redesenho maior, fora de escopo). 2ª simulação confirmou o fix: bump → `preco_publicado_ml` mudou de verdade (129,9→130,9 no banco, log sem erro) → revert → confirmado de volta a 129,9. 6 testes novos (`mercado-livre.test.ts`); 1685 testes verdes, lint/tsc limpos. Deploy das 12 functions. Sincronização de vendas (`vendas.ts`) segue não testada.
- [x] **Fix: refresh de token ML zerava `me2_habilitado` a cada ~6h (adendo ADR-0095)** (2026-07-31) — investigando "Viabilidade da org DSA não recalcula o frete" ao colocar dimensões manuais: descartado por evidência que fosse bug de cálculo — chamando `GET /users/9757132/shipping_options/free` direto com o token real da DSA, `list_cost` variou com dimensão maior (12,35→17,05→93,25) e só ficou igual pro item testado (Eucerin Protetor Solar 50ml, R$84,99) porque o pacote genérico (16×11×6cm/300g) e o real (14×4×4cm/80g) caem na mesma faixa da tabela do ML até ~2kg — comportamento correto, não bug. Achado de verdade: `gravarRotacaoConexao` (`_shared/ml/token.ts`), chamada a cada refresh de token (o access token do ML dura ~6h, então roda o dia todo em produção), reescrevia a conexão via `upsert_marketplace_connection` sem passar `p_me2_habilitado` — a RPC usa `default null` e sobrescreve a coluna incondicionalmente no UPDATE, então todo refresh apagava de volta pra `null` o valor gravado no claim OAuth ou em um backfill manual. Confirmado ao vivo: conexão da DSA backfillada `true` em 2026-07-30, com `atualizado_em` de hoje (refresh do dia) e `me2_habilitado` já `null` de novo, mesmo com `shipping_preferences.modes` incluindo `me2` e o frete real funcionando. Fix: `gravarRotacaoConexao` agora relê `me2_habilitado` junto dos outros campos preservados e repassa pro upsert. 1 teste novo (`token-refresh-me2.test.ts`, provado que falha sem o fix); suíte inteira (275 arquivos/2278 testes) verde, lint limpo. [Adendo ADR-0095](decisions/0095-mercado-envios-via-shipping-preferences.md). **Deployado em produção (2026-07-31):** blast radius calculado via `deno info` (28 functions, não ~26 — lista completa no adendo do ADR), todas redeployadas com sucesso (versões bumpadas, `verify_jwt` conferido função a função contra o esperado, sem regressão). Backfill manual `me2_habilitado=true` aplicado nas conexões da DSA **e** da Avil (ambas confirmadas com Mercado Envios genuinamente ativo ao vivo) — agora protegidas pelo fix, não devem mais zerar no próximo refresh.
- [x] **Legenda do desconto de frete na Viabilidade, igual à Revisão** (2026-07-31) — Diego pediu que o card de cada item na Viabilidade explicasse o desconto de "Frete (vendedor)" da mesma forma que já acontece em `CardVoceRecebe` (Revisão): "ℹ️ Já desconta o frete grátis ao comprador por sua conta: −R$ X (estimado; varia por região)" quando o vendedor paga, ou "ℹ️ Acima de R$19, o Mercado Livre dá frete grátis ao comprador por sua conta (varia por região)" quando não paga. `viabilidade-linha.tsx` reusa o mesmo texto/condição (`frete > 0`), abaixo do grid Clássico/Premium. 2 testes novos (`tests/components/viabilidade-linha.test.tsx`, mirror do padrão já usado em `card-voce-recebe.test.tsx`); suíte inteira (276 arquivos/2281 testes) verde, lint limpo. Só frontend, sem migration.
- [x] **Fix "vs. anterior" do "Mês atual" no Dashboard/Financeiro** (2026-08-02) — Diego notou que "Mês atual" (01-02/08) mostrava -34% vs. anterior em Faturamento bruto mesmo vendendo mais (R$1.984,90) que o mesmo período de julho (R$1.277,53, card "Personalizado" mostrava corretamente +36%). Mesma causa raiz do fix de "Hoje" (2026-07-06, entrada acima): `janelaAnterior()` desloca a janela atual pra trás pela sua **duração decorrida**, o que quebra pra qualquer janela que cresce (dia ou mês) — só o branch `tipo === 'hoje'` tinha ganho o fix na época; `mes_atual` ficou de fora e continuava caindo no fallback genérico, comparando com um pedaço do FIM do mês anterior (30-31/07) em vez do mesmo trecho (01-02/07). Triangulado sem tocar banco: os KPIs do print (bruto/pedidos/ticket médio do "anterior") batiam entre si assumindo ~30-31/07 como janela, não 01-02/07 — descartando de cara a hipótese inicial de "compara com julho inteiro". Fix: `janelaAnterior` ganha branch `mes_atual` espelhando `hoje`, usando `setMonth(-1)` (mesmo dia/hora do mês anterior) em vez de deslocar pela duração. `ponytail`: `setMonth()` em dias 29-31 pode rolar pro mês seguinte quando o mês anterior é mais curto (ex. 31/03→"31/02" não existe, vira 02-03/03) — ceiling raro (fim de mês em fevereiro), aceito, upgrade (clamp no último dia do mês anterior) se virar reclamação real. TDD (1 teste novo, `tests/lib/metricas.test.ts`); suíte isolada verde (App.test.tsx 11/11, metricas 16/16 — falhas vistas em rodadas com testes concorrentes eram contenção de CPU dos próprios processos vitest em paralelo, confirmado rodando isolado). Só frontend, sem migration. Branch aguardando validação do Diego.
- [x] **Fix round 2 — "vs. anterior" do "Mês atual" ainda errado depois do fix acima (agora +242% em vez de -34%)** (2026-08-02) — Diego reportou que o fix anterior não resolveu: o mesmo card mostrava +242% vs. anterior. Investigação com o modelo Opus (consulta pedida pelo Diego), que rodou a janela calculada contra o banco de produção real e confirmou o número batendo dígito a dígito com o código — **não era bug de aritmética**. Causa: o fix anterior comparava "mesma HORA do relógio" (mirror do padrão já usado em `hoje`), então a janela "anterior" de `mes_atual` cortava no meio do último dia (ex.: 01/07 00:00→02/07 07:55, em vez do dia inteiro) — perdendo as vendas da tarde/noite de 02/07 e inflando o % artificialmente. Instabilidade real medida: 1 único pedido de madrugada mudou a manchete de +315% para +242% (73 pontos). Opus achou 2 problemas a mais nessa varredura: (1) o mesmo `setMonth()` do fix anterior tinha rollover real em dias 29-31 (31/mar → "31/02" inexistente vira 02-03/mar) — já sinalizado como risco (`ponytail:`) mas nunca disparado num teste; (2) **achado à parte, não corrigido nesta entrega**: `chaveJanela` (`src/hooks/useVendas.ts:24`) trunca a chave de cache em `ate.slice(0,10)` assumindo que toda janela termina em "agora" — falso para a janela *anterior* de `hoje`/`mes_atual` (termina num horário passado, num dia que ainda vai receber mais vendas); abrir o Dashboard de manhã e recarregar à noite cai na mesma chave de cache e a janela "anterior" congela no valor da manhã. Com o fix desta entrada isso deixa de afetar `mes_atual` (a janela anterior passa a ter `ate` fixo em fim de dia, não depende mais da hora de carregamento) mas **`hoje` continua exposto** nos dois menus (Dashboard e Financeiro) — decisão pendente do Diego sobre corrigir. Decisão de semântica levada ao Diego via pergunta direta (dias de calendário vs. mesma hora do relógio) — escolheu **dias de calendário**, batendo com o card "Personalizado" e evitando a oscilação por pedido isolado, aceitando que o dia corrente (incompleto) suba a % de forma monotônica conforme o dia avança em vez de comparar frações iguais. Fix: `janelaAnterior` pro tipo `mes_atual` agora resolve o mês anterior inteiro por dias corridos (`new Date(ano, mes-1, 1, 0,0,0,0)` até `new Date(ano, mes-1, dia, 23,59,59,999)`), com `dia = Math.min(dia_atual, último_dia_do_mês_anterior)` — resolve o rollover do `setMonth()` de brinde. `hoje` inalterado (fora de escopo — já validado com critério diferente em 2026-07-06, perfil de uso de dia único não sofre do mesmo problema de corte parcial multi-dia). 2 testes novos (dia inteiro + clamp 31/mar→28/fev); suíte inteira (281 arquivos/2323 testes) verde isolado, lint limpo.
- [x] **Fix cache stale de `chaveJanela` na janela "anterior" de "Hoje"** (2026-08-02, achado à parte na investigação do round 2 acima) — `chaveJanela` (`src/hooks/useVendas.ts`) truncava `ate` na DATA pra qualquer janela, assumindo que duas janelas terminando no mesmo dia sempre cobrem o mesmo conjunto (verdade só quando `ate` = "agora", já que não existe `date_closed` no futuro). A janela "anterior" de `hoje` termina ONTEM na mesma hora do relógio de agora — recalculada às 06h corta ontem 06h, recalculada às 18h (outra montagem do componente, ex. trocar de aba no Faturamento) corta ontem 18h; mesmo `desde` (ontem 00:00 fixo), `ate` diferente, mas a chave truncada colidia nas duas. O refetch em modo delta (`buscarVendas` filtra `date_closed BETWEEN [desde,ate] AND atualizado_em >= marca`, ADR-0082) não preenche esse buraco: uma venda de ontem entre 06h-18h cujo `atualizado_em` seja mais velho que a marca já cacheada (comum — a marca é só o máximo do lote já buscado, não tem relação com a venda nova) nunca seria buscada, congelando o "vs. anterior" no valor de quando o Dashboard foi aberto pela primeira vez no dia. Fix: `chaveJanela` só trunca `ate` na data quando a data bate com HOJE (real); janelas terminando num dia passado (a "anterior" de `hoje`, ranges/"Personalizado" históricos) mantêm o ISO completo na chave — nesses casos o `ate` já é um valor estável (não depende de quando foi computado, só de qual dia é), então perder o compartilhamento de cache não custa nada. `mes_atual` não precisava desse fix — o round 2 acima já deixou sua janela "anterior" com `ate` fixo em fim de dia, resolvendo a mesma classe de bug de brinde. 2 testes novos em `useVendas-chave.test.ts` (1 reescrito com fake timer pra continuar cobrindo o caso original de janela terminando hoje; 1 novo reproduzindo a colisão de "anterior" com corte de hora diferente); suíte inteira (281 arquivos/2324 testes) verde isolado, lint limpo. Só frontend, sem migration.
- [x] **Fix round 3 — filtro "Personalizado" do Dashboard não mudava os números** (2026-08-02, mesma família dos dois fixes acima) — Diego reportou que escolher "Personalizado" 01/08→01/08 devolvia exatamente os mesmos KPIs de "Mês atual" (R$ 3.516,14 · 52 pedidos), com só o "vs. anterior" mudando. Esse padrão (valores principais idênticos, % do comparativo diferentes) é a assinatura de colisão de `queryKey` na janela principal com `janelaAnt` tendo chave própria — confirmado reproduzindo as duas chaves em Node sob `TZ=America/Sao_Paulo`: **idênticas**, `['2026-08-01T03:00:00.000Z', '2026-08-02']`. Causa raiz: o fix da entrada anterior fez `chaveJanela` truncar o `ate` só quando a janela "termina hoje", mas comparava `ate.slice(0, 10)` (data **UTC** do ISO) com `new Date().toISOString().slice(0, 10)` (hoje em **UTC**). Em BRT (-03) o fim de um dia local — `resolverJanela` monta `01/08 23:59:59.999` local = `02/08 02:59:59.999Z` — já é o dia seguinte em UTC, então um range terminando ONTEM passava no teste "termina hoje", tinha o `ate` truncado para a data de hoje e colidia com a chave de `mes_atual`, que tem exatamente o mesmo `desde` (1º do mês 00:00 local = `T03:00:00.000Z`). O React Query servia o array já cacheado do mês inteiro. Fix: novo helper `diaLocal` (`src/lib/metricas.ts`) converte o instante pela data **local**; `chaveJanela` compara `diaLocal(janela.ate) === diaLocal(new Date())`. Não custa compartilhamento de cache nenhum: o `ate` de um range vem da string de data, não de `new Date()`, então já era estável entre montagens — o truncamento nunca fez trabalho útil nesse caso; o ganho do ADR-0082 para `hoje`/`mes_atual` fica intacto. Mesmo `slice(0, 10)` em UTC estava no prefill do seletor (`rascunhoDe`, `seletor-periodo.tsx`), que depois das 21h BRT sugeria o dia seguinte nos campos De/Até — corrigido pelo mesmo helper. **`vitest.config.ts` passa a fixar `TZ=America/Sao_Paulo`**: as fixtures de janela já eram escritas em BRT (`T03:00:00.000Z` = 00:00 local) e este bug simplesmente não existe em UTC — sem o pin, o teste de regressão seria vazio no CI. Isso expôs que a fixture do teste "termina HOJE" usava `ate` às 01:42Z, que em BRT é o dia anterior — movida para o meio do dia (11:42Z), a asserção não foi afrouxada. 1 teste novo (provado que falha no código antigo mesmo com `TZ=UTC` no shell, o que também confirma que o pin do vitest.config vale); suíte inteira (289 arquivos/2397 testes) verde, lint limpo (0 erros, 11 warnings pré-existentes). **Nota para a validação:** escolher `01/08 → 02/08` (range que termina HOJE, começando no 1º) vai continuar mostrando os mesmos números de "Mês atual" — isso é correto, é a mesma janela de dados, não regressão. Só frontend, sem migration. [ADR-0082](decisions/0082-poll-incremental-de-vendas-por-marca-dagua.md). Branch `worktree-fix-filtro-personalizado-cache` aguardando validação do Diego.
- [x] **Copy premium na descrição de anúncio — prompt ancorado na fonte e persuasivo** (2026-08-02, [ADR-0098](decisions/0098-copy-ancorada-na-fonte-e-persuasiva.md)) — Diego trouxe uma análise externa de conversão (nota 7,3/10, 12 pontos) de um anúncio gerado. A investigação separou os 12 pontos em **três causas** que estavam sendo tratadas como uma. **(A)** A frase mais criticada, "amplamente reconhecida como a melhor do mercado", está **literalmente na `familias.descricao_pai`** vinda da planilha — a regra anti-alucinação foi obedecida, a IA ecoou a fonte; reforçá-la não resolveria nada. **(B)** O `SYSTEM` era 96 linhas quase inteiramente proibitivas, sem nenhuma instrução de persuasão. **(C, achado central)** O prompt **prescrevia** os bullets genéricos: a linha 154 listava "Alta resistência", "Ótimo custo-benefício" como exemplo, e eles apareciam em **125/166 (75%)** e **78/166 (47%)** do catálogo, verbatim — os pontos "benefícios genéricos" e "não existe diferenciação" da análise eram o prompt se auto-cumprindo. Eram 3 armadilhas, não 1 (linhas 146, 154 e 174). Princípio que decorre: **exemplo few-shot vence regra declarada** — escrever regras novas e deixar os exemplos antigos as tornaria inertes. Implementado R1–R9: conversão característica→benefício, proibição de quantificação/comparação implícita ("30% mais resistente", "menos trocas de cone" — comparado a quê?), superlativo da fonte **removido** quando nenhum fato o sustenta (nunca suavizado), lista negra de fórmulas de prova social, abertura pela dor **da categoria** sem prometer que o produto a resolve, termos de busca, fechamento ancorado, seção nova `❓ PERGUNTAS SOBRE ESTE PRODUTO` onde **o dado gera a pergunta e nunca o contrário**, e neutralidade de segmento nos exemplos (R9 — os few-shot antigos eram todos de aviamento; trocá-los por outros de aviamento replicaria a Causa C com roupa nova). Ordem das seções **preservada** de propósito (a própria análise dá 8/10 pra estrutura, e enterrar ESPECIFICAÇÕES prejudica quem escaneia atrás de composição/metragem). **Experimento A/B/C** (30 famílias reais, 60 gerações, ~R$5): A = `descricao_ml` já gravada (o prompt antigo deixa de existir após a edição; a saída real de produção é mais fiel que uma regeração), B = prompt novo + `gpt-4o-mini`, C = prompt novo + `gpt-4o`. Previsão registrada **antes** de rodar, pra não ler o resultado a favor da hipótese cara. Resultado: bullets repetidos 0,352→**0,254**; "Alta resistência" 18→**5** (−72%); "Ótimo custo-benefício" 10→**2** (−80%); medidas não ancoradas 3→1. **C saiu pior que B** — repete mais bullets (0,307) e adere menos ao template (seção de perguntas em 7/30 contra 12/30) — então **o modelo continua `gpt-4o-mini`** e o custo segue em ~1,2 centavo/família em vez dos ~9 da troca. Dois achados durante a execução: **(1)** a métrica de comparações acusou 36→72, **falso positivo integral** — contava `100% poliéster` (composição da fonte) e acusava mais o prompt novo justamente porque R5 manda repetir "linha 100% poliéster" nos termos de busca; corrigida pra comparar contra a fonte, dá **0 em todos os cenários**. **(2)** o modelo desobedece o mínimo de 3 perguntas de R6 em **10 das 22 seções (45%)**; entrou o guard determinístico `removerPerguntasIncompletas`, que remove a **seção inteira** (bloco estruturado com fronteira conhecida — não contradiz a rejeição de editar prosa por regex, que remendaria oração no meio de período). Os dois call sites que compunham os guards à mão (`process-familia`, `regenerar-copy-familia`) passaram a chamar `posProcessarDescricao`. **Rollout sob demanda**: vale para o que entrar daqui pra frente; as 166 famílias publicadas não são tocadas em lote (regeração família a família por giro, via `regenerar-copy-familia`), e as 5 descrições editadas manualmente ficam intactas por construção. Revisão do design pelo modelo Fable (**APROVADO**, após verificar as afirmações da spec contra o código) trouxe 2 correções reais incorporadas antes da implementação. 291 arquivos/2428 testes verdes, lint limpo. Sem migration. **Nada deployado ainda** — branch aguardando validação do Diego.
- [x] **Título de anúncio no padrão Mercado Livre — contrato de dez slots** (2026-08-02, [ADR-0099](decisions/0099-titulo-padrao-mercado-livre.md)) — mesma causa raiz do ADR-0098 (Causa C: exemplo few-shot vence regra declarada), ainda não corrigida do lado do título: censo de 143 títulos (excluídos os 24 editados pelo operador, de 167) achou **35%** terminando em adjetivo vazio, **52%** unidade não canônica, **94%** com separador `\|`, **14%** sem acento, **3%** abreviação de planilha, 1 colisão entre produtos distintos. `gerarCopy` passa a devolver dez slots nomeados (`produto` nunca vazio, `marca`, `modelo`, `medida`, `quantidade`, `material`, `variacao`, `compatibilidade`, `aplicacao`, `sinonimo`, `additionalProperties:false`) em vez de string plana; `montarTitulo` ordena por leitura, reduz e corta por prioridade (hierarquia invertida da leitura), com `medida` e `variacao`-discriminadora **incortáveis**; `TituloInviavelError` falha alto (nunca trunca) quando os slots obrigatórios não cabem em 60 chars mesmo após reduzir e remover tudo o que é cortável; `posProcessarTitulo` unifica os três call sites que antes compunham guards divergentes à mão. **Experimento A/B final** (n=70 famílias, API real, `openai/gpt-4.1-mini`, 0 falhas): adjetivo vazio 32,9%→**0%**, unidade canônica 64,3%→**100%**, com `\|` 92,9%→**0%**, marca ancorada 26,2%→**55,4%**, colisões 0→0. Marca é best-effort — de 166 famílias com fornecedor, BUFALO (109) tem 68% com marca ancorada na fonte, mas DETALLIA/ECOFIBRA/TRINITY (37 famílias) têm 0%; derivar marca do campo `fornecedor` por heurística foi descartado por medição (produz `"BARBANTE"` para `FABRICA DE BARBANTE BANDEIRANT`, `"V"` para `V.R.MACHADO SILK SREEN EM GERA`). **Alcance zero sobre os 167 anúncios já publicados** — `atualizarItemML` nunca envia `title`, só o CREATE manda (`_shared/ml/publicar.ts:207`). **8 regressões silenciosas encontradas e corrigidas na migração dos guards de string para slots antes do merge** (cor `Outra` vazando pro título — lote #31, 2 instâncias, 16/70 famílias mono-cor; marketing não ancorado sem equivalente — lote #28; cor multi-palavra duplicada/tipo colado — lote #33, 3 famílias, 2 já publicadas; dedup cross-slot de metragem que o guard novo não recomputava fora do slot `medida` — lote #65; largura `NNmm` sem a palavra LARGURA descartada, 20 famílias em risco/6 grupos de irmãs; unidade por extenso da IA não canonicalizada), nenhuma pega pela suíte (2400+ casos verdes o tempo todo) porque os testes que as pegariam foram removidos junto com o código do guard antigo — achadas por teste de mutação, por portar as asserções antigas antes de apagar os testes, por auditar a tabela de "onde cada garantia vive agora", e por rodar o experimento contra API/banco reais (as duas últimas, 5 e 6, só apareceriam com produtos reais do catálogo). Glossário ganhou os verbetes **slot de título** e **discriminador**.
- [x] **Fix miniatura sem foto na venda de produto do cadastro avulso** (2026-08-07) — Diego notou que a venda do GEL DE LIMPEZA FACIAL PRINCIPIA (código `00000023`, pedido 2000017810396302) mostrava o ícone de pacote em vez da foto, no Faturamento e no Detalhe do líquido. Causa: o **cadastro de produto avulso** (`familias.chave_cadastro` preenchido) grava a foto só em `familias.capa_storage_path` — a variação fica com `imagem_path=null` e `ml_picture_id=null` (confirmado no banco: a família `MLB5001755829` tem capa e `capa_ml_picture_id`, a variação não tem nada). O resolver `montarFotoResolver` (`src/lib/fotos-produto.ts`) só conhecia `variacoes.imagem_path` (cadeia variação → anúncio → GTIN → código), então caía no fallback `Package` de `ThumbProduto`. No ML o anúncio sempre teve foto — o furo era só na miniatura interna. Fix read-side: `buscarFotos` faz uma 2ª query (em `Promise.all` com a 1ª, porque a original filtra `imagem_path not null` e nunca traria essas linhas) montando `porItemCapa` (`ml_item_id → capa_storage_path`), consultado como **último** degrau do resolver — antes de `porCodigo` estragaria a miniatura de anúncio com variações por cor, mostrando a capa genérica no lugar da foto da cor vendida. Escala medida antes de mexer: 294 itens de venda distintos, 255 já com foto, **1 passa a exibir** (justo o do print), 38 seguem sem foto por não terem foto nem capa em lugar nenhum; a query nova traz 9 linhas (só 9 famílias têm capa + `ml_item_id`), custo desprezível. Write path do cadastro avulso **não** alterado de propósito — não consertaria a linha já gravada e é mudança que ninguém pediu. **Alcançabilidade verificada até o fim da cadeia** (a contagem acima veio da Management API, que roda como `postgres` e ignora RLS — a query nova roda client-side como o operador): a venda, a família e a variação são todas da org **DSA** (`a1fcd536…`, print tirado na conta `analistasistemas@icloud.com`, não na Avil); `familias` tem RLS por `org_id` (`familias: select org` → `current_org_id()`), não por `user_id`, então a família é legível; o objeto da capa existe no bucket (504 KB PNG) e a policy `imagens: select org` libera o path porque o 1º segmento (`bc1a125a…`) é o profile de um usuário da mesma org — o `user_id` diferente do prefixo das fotos de variação da Avil é irrelevante sob RLS org-scoped. TDD: 3 casos novos em `tests/lib/fotos-produto.test.ts`, sendo o discriminante "foto da própria variação vence a capa" (pega ordenação errada de degrau). Suíte inteira 315 arquivos/2712 testes verde (EXIT=0), lint 0 erros. Só frontend, sem migration.
- [x] **GPT-4.1-mini vira o modelo padrão de copy; DeepSeek sai da lista** (2026-08-02, [ADR-0098](decisions/0098-copy-ancorada-na-fonte-e-persuasiva.md) + [adendo ao ADR-0074](decisions/0074-selecao-de-modelo-ia-por-organizacao.md)) — comparação de 4 modelos sobre os mesmos 10 produtos, **rodada 3 vezes** porque com temperatura 0.4 e n=10 uma execução só não distingue sinal de ruído (os números do `gpt-4o-mini` oscilaram entre rodadas: bullets repetidos 0,109→0,083→0,075). Médias: bullets repetidos A 0,192 · B(4o-mini) 0,089 · C(4o) 0,136 · **D(4.1-mini) 0,066**; fórmulas proibidas 2 · 0,3 · 1,0 · **0**; medidas não ancoradas 1 · 1,3 · **0** · **0**; custo dos 10 produtos — · $0,0080 · $0,1257 · $0,0197. **`gpt-4.1-mini` venceu por consistência, não por uma rodada**: ancoragem perfeita nas TRÊS execuções (zero fórmula proibida e zero medida não ancorada, enquanto o `gpt-4o-mini` escorregou em ambas) e mais variedade que o `gpt-4o-mini` nas TRÊS. Ponto fraco declarado: entrega a seção de perguntas em 3/10 contra 5/10 do `gpt-4o-mini`, e de forma instável (3·6·1) — seção opcional por design (R6 manda omitir sem 3 dados), mas o mini é mais consistente nela. `gpt-4o` descartado: pior que os dois minis em variedade e 15,7× mais caro. **DeepSeek V4 Flash 0731 rejeitado** apesar de ser o mais barato ($0,09/$0,18, output 3,3× mais barato que o `gpt-4o-mini`): devolvia **JSON truncado** sob `json_schema` strict, falhando em 1 dos 3 primeiros produtos, enquanto os modelos OpenAI não falharam em nenhum dos 10 — eliminatório porque `gerarCopy` é a única etapa de IA sem fallback resiliente (ADR-0030) e falha ali derruba a família inteira. **Trocar a constante não bastaria**: a coluna `configuracoes.ai_model_texto` tem CHECK constraint com lista fechada e o valor gravado vence o default de `MODELO_COPY` — levantamento no banco mostrou DSA com `null` (herda o default) mas **Avil com `openai/gpt-4o-mini` explícito**, que ficaria presa ao modelo antigo; a migration `20260802220728_adr98_gpt41_mini_padrao.sql` troca a constraint e migra quem estava fixado no anterior (mesmo precedente da migration do DeepSeek). `gpt-4o-mini` continua selecionável por ser mais barato, só deixa de ser padrão. Confirmado via `supabase secrets list` que **não existe secret `AI_MODEL_COPY`** no projeto, então o default do código é o que vale em produção. 291 arquivos/2432 testes verdes, lint limpo, `deno check` limpo em `tokens.ts`, `npm run db:check` EXIT=0 (sem divergência de histórico). **Deployado em produção (2026-08-02):** migration aplicada via `supabase db push` (estado antes/depois conferido: Avil `openai/gpt-4o-mini` → `openai/gpt-4.1-mini`, DSA permanece `null` = herda o padrão do código, constraint agora `('openai/gpt-4.1-mini', 'openai/gpt-4o-mini')` com DeepSeek fora). Blast radius calculado por fecho transitivo dos imports locais a partir dos módulos alterados (`copywriter-prompt.ts`, `modelos.ts`, `tokens.ts`): **5 functions** — `process-familia` v128→v129, `regenerar-copy-familia` v42→v43, `definir-categoria-familia` v39→v40, `sugerir-resposta-pergunta` v15→v16, `publicar-split-ml` v50→v51. Todas com bump de exatamente +1, `verify_jwt` conferido função a função contra o `config.toml` (sem regressão) e status ACTIVE.
- [x] **Fix definitivo — miniatura some no Faturamento p/ venda via catálogo do ML (regressão do fix de 2026-08-07)** (2026-08-08) — Diego reportou 2 novos pedidos (`00000023`/`609963220755` e `00000025`/`609963220564`) sem foto, o mesmo sintoma do fix anterior, apesar dele já estar deployado (confirmado: deploy `dep-...` de `cff54c29` está `live` desde 07/08 23:40, então não é atraso de deploy). Causa raiz **diferente** da anterior: o item vendido (`ml_vendas_itens.ml_item_id`, ex. `MLB7343600804`) **não é** o MLB do anúncio dono (`familias.ml_item_id` = `MLB5001755829`) — confirmado via Management API (`supabase db query --linked`, bypassa RLS) que `anuncios_externos` nunca conheceu esses MLBs vendidos. É venda por **catálogo do Mercado Livre** (ADR-0021/ADR-0045): o pedido chega com o MLB do anúncio-âncora do catálogo, não o nosso; `variacoes.catalog_listing_id` já guardava exatamente esse vínculo (`MLB7343600804`/`MLB5016316823`, confirmado no banco) — o app já sabe canonicalizar isso desde 2026-08-06 (`src/lib/anuncio-canonico.ts`, usado por `detalhe-vendas.ts`/`resumo-vendas.ts`/`cockpit.ts`), mas **`montarFotoResolver` (`fotos-produto.ts`) nunca foi migrado pra esse 4º consumidor** — ficou batendo o `ml_item_id` cru do pedido contra `porItem`/`porItemCapa`, que só conhecem o MLB dono. O fix de 2026-08-07 (`porItemCapa`) era necessário mas não suficiente: resolve o cadastro avulso sem `imagem_path`, mas nunca alcança venda por catálogo porque a chave nem bate. Fix: `montarFotoResolver` ganha parâmetro opcional `canonico: MapaCanonico`, canonicaliza `item.ml_item_id` via `canonizarItem` **antes** dos dois lookups por item (`porItem` e `porItemCapa` — os únicos chaveados por MLB; `porVariacao`/`porGtin`/`porCodigo` não precisam, já são estáveis). `aba-vendas.tsx` e `DetalheFinanceiro.tsx` passam a chamar `useAnuncioCanonico()` (hook já existente, cache 30min) e repassar o mapa. 1 teste pré-existente quebrou (`aba-vendas-pedido.test.tsx` mocka hooks individualmente em vez de `QueryClientProvider` real — faltava mock de `useAnuncioCanonico`, adicionado). TDD: 2 casos novos em `tests/lib/fotos-produto.test.ts` reproduzindo o cenário exato (MLB de catálogo → MLB dono, no `porItem` e no fallback `porItemCapa`). Suíte inteira 316 arquivos/2724 testes verde, lint 0 erros. Só frontend, sem migration. **`calcularResumo` (KPIs/`topProdutos`) segue sem canonicalizar** — já documentado como gap conhecido na "Extensão client-side (2026-08-06)" do ADR-0045, fora do escopo deste fix (não é sobre foto). **Mergeado→deployado em produção (2026-08-08)** via CI verde + fast-forward (commit `c4f191ba`), Render confirmado `live`.
- [x] **Botão "Cadastrar" na Análise de viabilidade — abre o cadastro pré-preenchido** (2026-08-08, [spike 037](spikes/037-cadastrar-a-partir-da-viabilidade.md) + [plano](superpowers/plans/2026-08-08-botao-cadastrar-na-viabilidade.md)) — pedido do Diego: após consultar EANs, um botão ao lado do produto que já leva os dados para a tela de cadastro. O spike mediu o payload real de `GET /products/{id}` (chamada que a `analisar-viabilidade` **já fazia** e cujo retorno era descartado — só `buy_box_winner` era lido): `short_description` e `pictures` existem, mas **dimensões não** — os atributos da ficha são de especificação (`BRAND`, `SALE_FORMAT`, `UNITS_PER_PACK`…) e peso/medidas são `SELLER_PACKAGE_*`, do anúncio de cada vendedor. Pré-preenche nome, descrição da ficha, GTIN, custo, preço e as 4 dimensões digitadas no `FormDimensoes`; **origem nunca** (o tipo `CadastroInicial` não tem o campo — trava de compilação da ADR-0055/0107) e **foto nunca** (é o único artefato que iria verbatim ao anúncio; a descrição a IA reescreve em `process-familia`, então não sai como está). **Bug financeiro evitado antes de virar código:** a decisão original era pré-preencher `preco` com `etiquetaParaMinimo`, mas `variacoes.preco` é o **líquido mínimo** (ADR-0020) e `process-familia:419` aplica `grossUp` em cima dele — a etiqueta já é gross-up, então o anúncio sairia regrossado (mínimo R$ 70 → ~R$ 152). Corrigido para o mínimo **cru**, com três travas contra a regressão (comentário citando ADR-0020, teste que asserta as duas pontas com a aritmética pinada usando a função REAL via mock parcial, e a linha V-2-bug no spike); verificado por flip. Cache `gtin:v3`→`v4` centralizado em `chaveCacheGtin()` (o literal estava em 3 call sites; bump parcial rachava o cache). Cascata de deploy mapeada por `deno info`, não grep (ADR-0087): `analisar-viabilidade` (v48) e `process-familia` (v148), versões conferidas pós-deploy. **323 arquivos / 2786 testes verdes**, `pnpm lint` 0 erros, `deno lint`/`deno check` limpos, `pnpm build` OK. Validação visual em 4 cenários (botão presente; "Dar entrada" com `jaCadastrado` navegando p/ `/estoque`; sem botão quando não vende no ML; sem botão sem o módulo `estoque`) mais smoke end-to-end pós-deploy contra a edge real, com a descrição integral da ficha chegando ao formulário e o botão do diálogo desabilitado por falta de origem. Nada foi salvo em produção — o fluxo até a Revisão é validação do Diego.
