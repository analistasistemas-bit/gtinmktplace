# PubliAI — Status atual

> Documento vivo. Este e o retrato curto do estado atual do projeto. Historico detalhado fica em `project-history.md`.

**Ultima atualizacao:** 2026-08-26

## Snapshot

- Fase atual: Evolucao SaaS, Fase 1 concluida ate `E4`; **`E7` multi-tenancy + `E6` orquestracao multicanal EM PRODUCAO (2026-07-05/06)**
- Epicos validados em producao: `E1`, `E1b`, `E2`, `E3`, `E4`, `E7`, `E6`, `E6b` (Blocos A e B)
- **`E6b` Bloco A (estoque único cross-canal) EM PRODUÇÃO (2026-07-29)** — ver seção dedicada abaixo. **Bloco B (cadastro manual de produto + entrada de mercadoria pela UI, gated por módulo) EM PRODUÇÃO (2026-07-29)**, **redesenho da tela `/estoque` EM PRODUÇÃO (2026-08-02)** — nenhuma org enxerga o módulo até o super-admin ligar em `/admin` (`modulos_habilitados` nasce vazio). Spec: `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md` (Bloco B), `docs/superpowers/specs/2026-08-01-estoque-redesign-design.md` (redesenho). ADR: [0094](decisions/0094-estoque-unico-cadastro-manual.md). **Descartado na mesma sessão de design:** módulo de emissão de NF-e (commodity, passivo fiscal, manutenção perpétua da reforma tributária — racional na seção 11 da spec) — **reconsiderado no ADR-0114 (2026-08-12) e superado pelo ADR-0135 (2026-08-25/26, ver entrada em "Entregas de agosto de 2026" abaixo): o PubliAI não emite a nota, só cadastra e empurra dados para o Faturador grátis do próprio ML**
- Depois do E6b: `E5` Shopee (o worker genérico `publicar-anuncio` do E6 espera só o conector)
- **Agosto de 2026 (04 a 11/08), fora de épico numerado:** consolidação da apuração financeira e do
  módulo de estoque — **7 ADRs aceitos (0106 a 0112), todos em produção**. Um por linha na seção
  "Entregas de agosto de 2026" abaixo. Detalhe operacional em `TASKS.md` (seções por data)

### E6 — Orquestracao multicanal EM PRODUCAO (2026-07-06)

Fan-out por (familia, canal) (ADR-0061). O caminho ML que fatura fica **intocado** (dentro de
`if(incluiML)` em `publicar-familias`, byte-a-byte); canais ≠ ML entram pelo worker generico
**`publicar-anuncio`** (QStash, verify_jwt=false) — resolve conexao por org (E7), monta o
`AnuncioCanonico` (builder `montarAnuncioCanonico` extraido do publish-familia-ml, behavior-preserving),
publica via `ChannelConnector`, persiste em `anuncios_externos`. Estado por canal em
`anuncios_externos.status` (`pendente|publicando|publicado|erro`, check-constraint + `qstash_message_id`);
o roteador claima atomicamente, o worker so verifica `status='publicando'` (retry do QStash re-executa).
Fila serial por (canal, org). Isolamento D-E6.2: um job (familia,canal) nunca toca `familias.status` nem
outro canal. `status-publicados`/`remover-publicado` parametrizados por canal; UI (seletor de canais na
Revisao, chip em Publicados) aparece so com >1 canal — **com 1 canal a tela e identica ao pre-E6**.
Conector **fake** prova a infra ponta a ponta sem 2º canal real (D-E6.5). Validado: gate local (db reset
E7+E6, suite de isolamento 39 PASS, 1203 testes, tsc/lint/build/deno check); migration + 36 edges em
producao; `status-publicados` por canal ao vivo (66 anuncios, canal=mercado_livre); frontend no Render
validado com browser (Publicados/Revisao/Financeiro identicos, sem seletor/chip, zero erro de console);
isolamento E7 re-provado contra prod pos-E6 (39 PASS). **Diferido (D-E6.7):** "ML + Shopee simultaneos"
fecha com o E5; a regressao de publicacao ML REAL (criar 1 anuncio de teste) fica para o fluxo controlado
do Diego — a extracao e coberta por testes CREATE + caracterizacao + status-publicados ao vivo.

### E7 — Multi-tenancy por `org_id` (SaaS multi-empresa) EM PRODUCAO (2026-07-05)

Isolamento total por organizacao (ADR-0027). Rollout autonomo validado ponta a ponta:
migracao *expand→migrate→contract* em 6 migrations (org `organizations` + `org_id` aditivo
nas 12 tabelas → backfill Avil → NOT NULL + uniques por org → **swap de RLS** de
`is_membro_operacao()` para `org_id = current_org_id()` → `marketplace_connections` (credencial
por org, RPCs Vault, cutover do token por conexao) → config/telegram/marca/cache/MP e numeracao
de lote por org). Frontend org-aware + pagina `/organizacoes` (super-admin). Ensaiado do zero em
Supabase local (`db reset`) antes de producao; **suite executavel de isolamento cross-tenant**
(`scripts/verificar-isolamento-tenant.ts`) provou 39 assercoes PASS **contra producao** (2 orgs
sinteticas, zero visibilidade cruzada, calibrada com vazamento injetado). `get_advisors` sem
achado de RLS; 36 edge functions redeployadas (token cutover validado ao vivo via
`status-publicados`); frontend deployado no Render e validado com browser (Dashboard/Publicados/
Financeiro/Organizacoes, zero regressao para a Avil, zero erro de console). Backup logico pre-rollout
guardado. Pendencia diferida (Task 17, apos ~1 semana estavel): `drop table ml_credentials` + RPCs
antigas + docs de referencia completas (modelo-de-dados, edge-functions, arquitetura) + Graphify.
- Trilho de UX (preparacao para SaaS comercial): repaginacao visual premium + Tarefa 2/Onda 1 (workflow operacional) concluidas e em producao (2026-06-21)
- Marketplace ativo em producao: Mercado Livre
- Split de produto em N anuncios em producao (ADR-0048, 2026-06-29): produto com >100 cores publica em N anuncios ML (limites do ML: 100 variacoes + 99999 de estoque somado por anuncio). Worker isolado `publicar-split-ml`, particao alfabetica por cor com ancoragem (cor publicada nao migra de anuncio), titulo distinto por IA, cap de estoque no conector. Relatorio e Publicados mostram os N anuncios. Validado em producao: `02835002` (120 cores) em 2 anuncios (`MLB6914358210` 100 cores + `MLB4828349403` 18 cores). Tambem nesta entrega: cor nova com foto+estoque entra MARCADA por padrao no UPDATE (opt-out, ADR-0016 adendo). Follow-up: catalogo (opt-in) por-particao cobre so a particao 0.
- Multiusuario com permissao de menu em producao (ADR-0047, 2026-06-29): operacao compartilhada (RLS via `is_membro_operacao()`, sem `org_id` ainda), tabela `profiles`, edge `usuarios` (admin-only) e tela Usuarios (convite por e-mail + checklist de menu + toggle Admin). E-mail transacional saiu do servico interno do Supabase para SMTP proprio via Resend (`publiai@daludi.com.br`); convite/reset validados (entrega + link `/#/definir-senha`). Antecipa parte do `E7`; isolamento real por empresa continua no E7.
- Modulo Financeiro impecavel (ADR-0040, 2026-06-23) EM PRODUCAO (validado 2026-07-02): caixa (liberado/a liberar), lucro+margem, breakdown de taxas, evolucao temporal, comparativo de periodo, periodo personalizado, export CSV e notificacao Telegram de liberacao. Migration aplicada, edge `notificar-liberacao` deployada e schedule QStash diario ativo.
- Marca manual de saque no Financeiro (ADR-0053, 2026-07-02) EM PRODUCAO: terceiro estado `sacado` no `Financeiro > Detalhe do liquido`, marcado pelo operador via selecao (checkbox) + acoes `Registrar saque`/`Desfazer saque` e filtro `Sacados`. Campos `sacado_em`/`sacado_por` em `ml_vendas`, escrita so via RPCs `security definer` estreitas (elegibilidade tambem no UPDATE). Migration `20260702162832_ml_vendas_saque` aplicada, front deployado (Render). Sem tabela nova, sem historico de saque (YAGNI).
- Modulo Faturamento (ADR-0037, 2026-06-22) EM PRODUCAO (validado 2026-07-02): menu Faturamento (Vendas + Devolucoes + Perguntas c/ IA), webhooks ML (`ml-webhook` + topicos orders_v2/questions/claims/shipments no DevCenter) e schedule QStash horario para `reconciliar-faturamento` ativos.
- Lote #49 barbante (ADR-0051, 2026-07-01) resolvido em producao (validado 2026-07-02): 3 familias reprocessadas apos deploy do fix de tipo/categoria.
- **Financeiro do Mercado Pago pela conexao OAuth do ML (ADR-0093, EM PRODUCAO 2026-07-26):** o ADR-0031 afirmava que a API do MP exigia token proprio, distinto do OAuth do ML — afirmacao sem spike registrado. Testado na conta real (AVILBV): o access_token da conexao `mercado_livre` responde 200 em `/users/me` e `/v1/payments/search`, com visao completa da conta. Logo nao ha "conexao do Mercado Pago": o financeiro passa a usar a conexao que cada org ja tem, com refresh automatico. Morreram o fallback global `MP_ACCESS_TOKEN`/`MP_FALLBACK_ORG_ID` (que estava a um `if` de vazar a conta da Avil entre tenants), a RPC `get_mp_token`, a coluna `configuracoes.mp_access_token_secret_id` e o caminho morto do MP ao vivo (edge `resumo-financeiro`, que seguia deployada v14 sem call site, `src/lib/financeiro.ts`, `useResumoFinanceiro`). Dois bugs financeiros silenciosos corrigidos junto: (a) `upsertVenda` regravava a linha inteira, entao falha de leitura do MP apagava `estorno`/`money_release_date` ja corretos (guard `preservarDadosMP`); (b) o try/catch interno engolia o erro e o `sync-devolucao` respondia 200, matando o retry do QStash num worker que existe para capturar estorno que chega semanas depois (agora `Map | null` + 502). Performance: workers de evento buscam os pagamentos por id em vez de varrer 120 dias — de ate 40 requisicoes ao MP por pedido para 1-2. Validado 3x em producao com sync real (QStash DELIVERED 200) e 1:1 na tela com browser-use: todos os numeros identicos antes/depois. Revisao adversarial em 4 rodadas (plano reprovado 2x); score final independente 92/100.
- Liquido economico correto em producao (ADR-0042, 2026-06-25): o `net_received_amount` do MP era inconsistente (cross-docking desconta frete cheio e ignora comissao; pack desconta comissao e ignora frete), gerando markup falso. Liquido passa a ser `bruto - comissao - frete real` de fontes autoritativas (`sale_fee` + `senders[].cost`), com rateio de pack net-independente. Faturamento e Financeiro batem (fonte unica `ml_vendas`). DB reconciliado (46 pedidos), 4 edges + front deployados, validado com browser-use. O caminho do MP ao vivo (`lib/financeiro.ts`, `useResumoFinanceiro`, edge `resumo-financeiro`) ficou OBSOLETO nesse momento, mas so foi removido em 2026-07-26 pelo ADR-0093 — ate la seguiu no repo (e a edge seguiu deployada, ACTIVE v14) como codigo morto sem call site no frontend (a tela usa `ml_vendas`).
- Re-ancora de preco no piso dos MercadoLideres (ADR-0065, 2026-07-08) EM PRODUCAO: no CREATE, quando o preco competitivo (`menor_preco × (1 − desconto%)`) da prejuizo (liquido Classico < custo), a base do preco troca para o preco do MercadoLider com mais vendas entre as ofertas (desempate: menor preco entre os empatados) — nunca sobe acima desse concorrente real, nunca faz gross-up, 🔴 continua 🔴 quando mesmo a ancora da prejuizo. Decisao familia-level (pior caso), sinalizada por `familias.preco_reancorado_lider` + selo "COMPETITIVO · ancora lider" na Revisao. Gated por toggle `reancora_lider_ativa` por org (default false, reversivel sem deploy).
- Fix fiscal no Financeiro > Detalhe do liquido (ADR-0066, 2026-07-09) EM PRODUCAO: "Liquido" nessa tela deixa de descontar imposto (soma o imposto de volta antes de exibir, bate 1:1 com o banner "Liquido total" e com o valor recebido no Mercado Pago); "Markup" continua liquido de imposto, igual as demais telas. Escopo restrito a essa tela (Faturamento → Vendas e Publicados nao mudam). Follow-up no mesmo par de dias: fix do markup do Faturamento que divergia do Dashboard/Publicados/Financeiro (commit `b5ecbc4`, 2026-07-09).
- **Menus multi-marketplace** (spec 2026-07-14, EM PRODUCAO 2026-07-15): UI pronta para os 5 marketplaces do roadmap (Mercado Livre ativo; Shopee/Magalu/Amazon/Casas Bahia vitrine "em breve"). Registry unico no frontend (`src/lib/canais.ts`) + habilitacao por org no banco (`organizations.canais_habilitados`, migration `20260715014055_menus_multicanal`); canal ativo global (`?canal=` + sessao) com `CanalTabs`/`CanalBadge` em Dashboard/Publicados/Faturamento/Financeiro; menu e tela `/canais` (OAuth do ML migrado de Configuracoes); Revisao com seletor registry-driven + pre-validacao de titulo por canal; editor de canais por org no `/admin` (edge `usuarios`, action `set_canais_org`); chips de liquido por canal no Dashboard (mesmo rateio de frete do headline, ADR-0042). Com 1 canal, **nenhum numero de nenhuma tela muda** — so aparecem as tabs e a vitrine. Validado local (browser contra prod + banco `db reset`) e aprovado pelo Diego; migration + edge `usuarios` em producao; deploy do frontend confirmado `live` no Render (commit `6c15257`). Achado no proprio deploy: 1o redeploy da `usuarios` usou por engano `--no-verify-jwt` (destrancava o endpoint admin-only) — corrigido no ato, confirmado `401` sem token. Follow-ups nao-bloqueantes (ficam para o E5): `canal` no `select` de `buscarVendas`; titulo do dialog de publicacao ainda fixo em "Mercado Livre"; sub-abas do Faturamento sem parametro canal.
- **Notificacao in-app** (ADR-0085, EM PRODUCAO 2026-07-21): espelho no app de todo alerta que ja sai por Telegram — nova tabela `notificacoes` escrita pelo mesmo ponto unico `notificarCategoria` (`_shared/notificacoes/config.ts`), zero mudanca nos 8 call-sites existentes (`vincular-catalogo`, `monitorar-moderados`, `notificar-liberacao`, `reconciliar-faturamento`, `sync-devolucao`, `sync-mensagem`, `sync-pergunta`, `sync-venda`). Sino no topbar (`useNotificacoes`, `staleTime` 60s, sem realtime) com badge de nao lidas; RPC `marcar_notificacoes_lidas`. RLS `select own`; escrita so via service role (best-effort, nao derruba o envio por Telegram). Migration `20260721094323_notificacoes_in_app` aplicada, as 8 edge functions redeployadas e frontend confirmado `live` no Render.
- **Preco por variacao + split por faixa** (ADR-0078, 2026-07-17) EM PRODUCAO: o ML passou a rejeitar publicacao de familias com preco divergente entre variacoes (`Found different prices in variations`) — incidente real em producao (PAI 02841240/02841290). Fase 1 (badge "preco alterado" + escolha "Atualizar tudo x Somente estoque" no UPDATE) e Fase 2 (motor de split por faixa de preco + UI) entregues via subagent-driven-development. Backend: `particionarPorPreco`/`decidirSplit` roteiam familia com preco divergente pro worker `publicar-split-ml` (reescrito pra particionar por faixa de preco, ancoragem preservada — cor ja publicada nunca migra de anuncio em silencio); guards LOUD de uniformidade em `publish-familia-ml`/`update-familia-ml` bloqueiam preco divergente sem split (nunca silencioso). UI: editar preco de 1 cor abre prompt "aplicar as demais?" (Sim replica classico, Nao cria divergencia de proposito); `ConfigGruposPreco` substitui o bloqueio antigo por config de desconto/atacado por faixa (grava `false`/`[]` explicito, nunca `null`); badge "preco alterado" passou a ser por variacao; aviso LOUD no dialogo de publicacao quando a selecao exigiria dividir um anuncio ja publicado. Validado com dados reais em producao: as 2 familias do incidente reincluidas e republicadas de fato (PAI 02841240 -> 3 anuncios, PAI 02841290 -> 2 anuncios, ancoragem preservada, sem erro) e UI validada pelo Diego (dev server, passo a passo guiado). Follow-up corrigido no mesmo dia: `update-familia-ml` tinha o mesmo bug de "limpar atacado bloqueado sem preco-base conhecido" ja corrigido no `publicar-split-ml` — mesmo padrao aplicado, revisado, mergeado e deployado.
- **Publicacao em User Products com N itens por familia (multi-cor)** (ADR-0088, 2026-07-22/23) EM PRODUCAO: categorias do ML que exigem "item plano" (ADR-0084/0087) e tem >1 cor nao aceitam o array `variations` — cada cor vira um item tecnico separado, linkado por `family_id`/`family_name`, que o ML agrega numa unica pagina com seletor de cor. **Fase 1** (2026-07-22): saga `user-products/publicar-grupo.ts` (reserva por `(anuncio_externo_id, sku)`, busca de item orfao real via `GET /users/{seller}/items/search?sku=`, criar-pausado -> confirmar -> ativar, funcao total `agregarEstado` dos 10 casos da ADR) + integracao em `publish-familia-ml`; 3 consumidores adaptados (`metricas-vendas`, `monitorar-moderados`, `status-publicados`); guarda minima em `remover-publicado`. Validado com familia real de 9 cores (PAI `03103331`, `MLB419782`) — 9 itens ML criados, mesmo `family_id`, confirmados na pagina real do produto. **Fase 2** (2026-07-23): vinculacao de catalogo (ADR-0021) por item; UPDATE por item filho + mini-saga de mudanca de composicao (`atualizar-composicao.ts`/`atualizar-familia-up.ts`) para adicionar/retirar cor de familia ja publicada (grava `skus_esperados`+`mudando_composicao=true` ANTES de mutar remoto, confirma sempre por `GET`); fix do gate de publicabilidade do frontend (`casadaNoMl`), achado travando qualquer UPDATE de familia UP na tela de Revisao. Todas as fases passaram por revisao adversarial (Codex, multiplas rodadas) antes do deploy. Validado end-to-end em producao real (Playwright): adicionar cor de teste -> bateu um caso real de `family_id` divergente, isolado corretamente pela mini-saga (9 cores reais intocadas) -> remover cor de teste com sucesso. **5 pendencias resolvidas e deployadas em producao (2026-07-24):** reconciliador de convergencia automatizado (`reconciliar-convergencia-up`, schedule QStash `*/15 * * * *` + claim atomico), reconciliador de backfill (`reconciliar-user-products`, itens planos pre-ADR-0088), sincronizacao de descricao no UPDATE UP recalculando lista de cores (`descricao_status`/`descricao_erro`), guarda completa de remocao UP (pausar N filhos + confirmar GET antes de deletar), fix de realtime na tela de Revisao. Cada item de backend aprovado pelo Codex apos 3-4 rodadas de revisao adversarial; suite inteira (241 arquivos/2017 testes) verde, `deno check`/lint limpos; migrations aplicadas + 12 functions redeployadas (blast radius recalculado via `deno info`, versoes confirmadas +1). **Achado a parte, tambem corrigido:** `reconciliar-faturamento` (ADR-0037) nunca teve schedule QStash desde a criacao (~1 mes rodando zero vezes) — schedule `0 * * * *` criado junto. Ver `docs/decisions/0088-publicacao-user-products-multi-item.md` e `docs/TASKS.md`.
- **UPDATE de familia migrada pelo ML para User Products** (ADR-0104, EM PRODUCAO 2026-08-04/05): o ML migra categorias para UP **sozinho e gradualmente**, em anuncios ja publicados. Duas lacunas fechadas antes de a migracao alcancar as familias multi-cor. **(1) Bug latente ja existente:** no caminho UP, `somente estoque` **mudava a composicao do anuncio** — a composicao vinha da planilha, entao cor ausente virava "retirada" e o item era **pausado no ML** numa reposicao pura; o Legacy nunca fez isso (`montarVariacoesUpdate` mapeia sobre as variacoes VIVAS do `GET`, `novo ?? a.available_quantity`, preservando a cor omitida) e isso contradizia o texto do ADR-0089 ("nao pausa nada automaticamente no ML"); guard dentro de `atualizarComposicao` (`somenteEstoque` -> `paraRetirar`/`paraAdicionar` vazios, sem reescrever `skus_esperados`, sem ligar `mudando_composicao`), cobrindo qualquer caller futuro. Composicao virou exclusiva de "Atualizar tudo". **(2) A ponte que faltava:** o roteamento UP do UPDATE lia estado LOCAL (linhas em `anuncios_externos_itens`), que uma familia migrada nunca teve -> caia no Legacy -> o conector lancava 400 "Reponha manualmente no painel", por familia, em cada lote; agora o conector detecta pelo `GET` ao vivo (`variations: []` + `family_name`) e devolve **`MIGRADO_PARA_UP`** tipado (simetrico ao `FORMATO_INCOMPATIVEL` do CREATE, ADR-0088 §3; **zero `GET` extra** — reusa o que ja fazia), e `update-familia-ml` roda `adotar-familia-migrada.ts`: busca cada SKU **ja publicado** por `seller_custom_field`, valida por multiget (seller, `family_id`, `user_product_id`, nao-Legacy, status conhecido) e exige **todos sob um unico `family_id`** — qualquer desvio aborta a adocao INTEIRA com as contagens observadas (400 definitivo). **So leitura remota** (o contrato `PortasAdocao` nao expoe escrita no ML); a gravacao e a RPC `adotar_familia_migrada_up` (raiz + N filhos + `variacoes.ml_variation_id` nulado + `familias.ml_item_id` re-apontado por regra deterministica, 1 transacao). Efeito colateral bem-vindo: "cor nova em item plano" (fora de escopo do ADR-0084) passa a funcionar. **A forma exata da migracao era hipotese validada em RUNTIME**, nao em desenho — e a hipotese estava ERRADA; ver ADR-0105 abaixo. **Limite conhecido (ADR-0104 §2):** a adocao captura as cores DA PLANILHA do lote; irmaos fora dela ficam sem linha filha e suas vendas nao sao atribuidas a familia ate um lote futuro incluir a cor (unico ponto em que o UP fica atras do Legacy). 29 testes novos (principais em RED-GREEN), 2498 testes verdes, `supabase db lint` sem erros de schema, migration aplicada + 15 functions redeployadas (blast radius via `deno info`, +1 confirmado, `verify_jwt` preservado).
- **Re-vinculo de familia DISSOLVIDA pelo ML em User Products** (ADR-0105, EM PRODUCAO 2026-08-06): a primeira migracao real chegou (lote #45, `PAI 02186551`, anuncio fechado em 21/07) e **a forma nao e a que o ADR-0104 supos**. O ML **nao converte** o item: ele **fecha** o anuncio Legacy (`status: closed`, `sub_status: []` VAZIO, sem `family_id`/`family_name`/`user_product_id`/`parent_item_id`) e cria N itens novos sob um `family_id`, **todos sem `seller_custom_field`** — e **nenhum ponteiro** liga o velho ao novo. Consequencia dupla no codigo de entao: o guard de anuncio morto disparava ANTES de qualquer deteccao de UP (o operador via "republique o produto") e, mesmo se nao disparasse, a busca por SKU do ADR-0104 acharia **0 de 17** irmaos. **Correcao:** `status` terminal **sem** `sub_status` de remocao passa a virar `MIGRADO_PARA_UP` carregando titulo, categoria e o mapa `SKU -> COR` lido das variacoes do item morto (`deleted`/`forbidden` continuam falhando na hora, sem gastar busca); `_shared/ml/descobrir-familia-up.ts` localiza a familia por `?q=<titulo>` (fail-closed: um unico `family_id` entre candidatos do mesmo seller/categoria, sem `variations`; paginacao nao coberta aborta) e a enumera pela fonte autoritativa `?family_id=`; o casamento e por **`COLOR.value_name`**, com os DOIS lados vindo de dados autorais do ML — `variacoes.cor` do nosso banco **nunca** entra (o ML nao normaliza: `'Rosa Bebe - 510'` ao lado de `'Cru 100'`). A adocao do ADR-0104 e **reusada inteira** (tudo-ou-nada, validacoes, RPC): so a porta `buscarPorSku` muda. A RPC passou a receber `p_ml_item_id_antigo` e re-aponta **todas** as familias do `codigo_pai` que apontavam para o item dissolvido (ha uma familia por lote) — **e o `ml_permalink` junto com o `ml_item_id`** (§5.1, achado em producao: todo link "ver anuncio" da UI sai desses campos, entao re-apontar so o id levava o operador ao anuncio finalizado; migration com backfill generico e idempotente). `atualizarEstoque` (push rapido) ganhou o guard de anuncio morto que nunca teve. **Validado ponta a ponta em producao:** 17 filhos sob o `family_id` unico, `skus_esperados` de 17, `ml_variation_id` nulado nas duas familias, estoque conferido 1:1 contra a API do ML nos 17 SKUs. **Limites conhecidos:** o push rapido de estoque **nao** re-vincula sozinho (exige uma passada de UPDATE, §6); familia **dividida** (split, ADR-0048) **nao** e re-vinculada — o conector e compartilhado, entao `publicar-split-ml` recebe o mesmo sinal mas nao sabe adotar, e devolve a mensagem original do guard mais a ressalva (`mensagemDissolvidoSemRevinculo`, §7); nao sabemos a forma que o ML da a um produto dividido ao dissolve-lo, e este ADR decidiu nao supor (3 familias divididas em producao hoje). Ver `docs/decisions/0105-revinculo-de-familia-dissolvida-pelo-ml-em-user-products.md`.
- **Atualizacao rapida de estoque** (ADR-0089, EM PRODUCAO 2026-07-24): atalho de 1-clique em
  `Progresso.tsx` que publica automaticamente o estoque de familias `UPDATE` sem nenhuma
  pendencia (nunca `CREATE`, nunca cor nova mesmo completa, preco sempre ignorado via
  `somenteEstoqueGlobal`) — elimina a selecao manual familia a familia na Revisao pra reposicoes
  puras de estoque. `/relatorio/{loteId}` ganhou secao de variacoes/familias que zeraram estoque
  na rodada. 100% frontend (zero migration/edge nova), 24 testes novos (`src/lib/estoque-rapido.ts`).
  Plano revisado adversarialmente pelo Fable 5 antes de codar (achou e evitou 1 furo real: cor
  nova completa nao podia entrar no atalho) e revisado com `/code-review-fable5` depois de pronto
  (88/100, 2 achados medios corrigidos no mesmo dia). Merge direto pra `main` (`3906a2a`), sem PR.
- **E6b Bloco A — Estoque unico cross-canal** (ADR-0094, EM PRODUCAO 2026-07-29): ate aqui o
  estoque so fluia numa direcao (PubliAI -> ML na publicacao) — venda no ML nao baixava o saldo
  local, risco de oversell assim que um produto vive em mais de um canal. Ledger imutavel e
  idempotente `estoque_movimentos` (migration `20260729084329_e6b_estoque_movimentos.sql`) +
  3 RPCs `security definer` (`baixar_estoque`/`estornar_estoque`/`registrar_entrada`,
  service_role-only) + trigger que bloqueia escrita direta em `variacoes.estoque`. Toda venda paga
  (`pedido.status === 'paid'`, nao o gancho one-shot `novaPaga`) baixa o estoque atomicamente e
  enfileira push **absoluto** (nunca delta) na fila serial `estoque-{orgId}` para todos os canais
  publicados exceto o de origem; cancelamento pre-despacho repoe (D-7); devolucao **nao e tocada**.
  Reconciliacao diaria (`reconciliar-estoque`, schedule QStash `30 12 * * *`,
  `scd_5WETvRdUHQr7pzKqgv4Pg4QrFNgA`) e rede de seguranca do push, nao do webhook — so re-empurra
  produto com movimento no ledger. 2 edge functions novas (`sincronizar-estoque` v1,
  `reconciliar-estoque` v1, ambas `verify_jwt=false`) + `sync-venda` redeployada v50. Suite de
  testes 2181 -> 2215. Frontend (secao "Movimentos de estoque" no expandir de Publicados)
  mergeado e no ar (deploy `823843e9` no Render); suite `verificar-isolamento-tenant.ts` rodada
  contra producao com 54 assercoes passando.
- **E6b Bloco B — Cadastro manual + entrada de mercadoria** (ADR-0094, EM PRODUCAO 2026-07-29): modulo pago `estoque` ligado por org pelo super-admin
  (`organizations.modulos_habilitados` + action `set_modulos_org` no `/admin`), edges
  `cadastrar-produto` e `entrada-estoque` (`verify_jwt=true`, gate de modulo com 403), tela
  `/estoque` (saldo por produto, entrada, ledger, canais publicados), formulario de cadastro
  multi-variacao com fotos, `lotes.origem` + chip Planilha/Cadastro manual no LoteCard.
  Migration `20260729124711_e6b_origem_lote_e_modulos.sql` aplicada em producao (todos os lotes
  historicos ficaram `origem='planilha'`; as 2 orgs com `modulos_habilitados` vazio = impacto
  zero). 6 edge functions deployadas: `cadastrar-produto` v1 e `entrada-estoque` v1 (ambas
  `verify_jwt=true`), `usuarios` v22, `publish-familia-ml` v82, `update-familia-ml` v69,
  `publicar-split-ml` v47. Frontend `live` no Render (deploy `2d94b4e9`), CI verde. Suite
  2215 -> 2255. Corrigido de quebra um defeito **pre-existente que valia tambem para planilha**:
  `talvezFinalizarLote` fechava o lote como `concluido` com familia ainda `pendente` (as TRES
  copias viraram uma em `_shared/lote/finalizar.ts`).
  **Ordem de deploy usada (obrigatoria):** `db push` -> `functions deploy` -> merge na main. O
  frontend chama `modulos_habilitados_da_org` dentro do MenuGuard e o Render auto-deploya no
  push, entao inverter a ordem deixaria toda org na tela de carregando.
  **E2E manual concluido 2026-07-29** (via Playwright CLI, org DSA ao vivo): cadastro, IA rodando,
  D-1.1 (mesmo lote), 409 de duplicata e ledger todos confirmados; parado antes do publish real no
  ML (decisao do Diego). Achou e corrigiu **4 bugs de UI** (2 rodadas, deploy `7efb89a`): dialog de
  cadastro cortado por classe Tailwind sem prefixo `sm:` + `min-w-0` faltando no grid + largura
  insuficiente pra tabela de 10 colunas (`sm:max-w-4xl` -> `sm:max-w-5xl`); e GTIN/dimensoes/
  descricao capturados no cadastro mas ausentes da tela `/estoque` (adicionados). Suite 2255 -> 2256.
  Ver `docs/TASKS.md` para o detalhe tecnico completo.
- **Redesenho da tela `/estoque` EM PRODUCAO (2026-08-02, PR #56):** o `sm:max-w-5xl` acima
  aliviou o corte da tabela de variacoes, mas nao eliminou a causa — `<table>` aninhada dentro
  de `<TableCell>` continuava forcando scroll horizontal estrutural em telas estreitas, tanto no
  cadastro quanto na listagem (e em `/publicados`, que compartilha `MovimentosEstoque`). Listagem
  e cadastro viraram cards (nenhuma `<table>` no caminho); busca passou a achar GTIN/fornecedor;
  filtro "nao publicado" corrigido para derivar de `familias.ml_item_id` (fonte canonica) em vez
  de so `anuncios_externos` (espelho que pode ficar furado sem erro). Duas rodadas de revisao
  (12 tasks TDD + `code-review-fable5` independente) corrigiram 1 bug financeiro real herdado
  desta mesma tela: parsing de milhar pt-BR (`"1.234"` gravava `R$ 1,23`) em campo de
  preco/custo — `parseNumeroPtBr` em `src/lib/formato.ts`, o mesmo bug segue aberto em
  `src/components/variacao-card.tsx` (`/publicados`), fora do escopo desta entrega. 10/10
  checagens reais de scroll horizontal via Playwright. Ver `docs/TASKS.md`.

## Entregas de agosto de 2026 (04 a 11/08) — todas em produção

Sem épico numerado: correções e decisões que consolidaram a apuração financeira e tornaram o
módulo de estoque operável. Ordem cronológica.

- **Produto gravado na organização errada — corrigido e blindado (2026-08-04).** Não foi vazamento
  de leitura por RLS: uma **gravação SQL administrativa direta** criou na DSA uma segunda árvore de
  lote/família/variações baseada num produto da Avil, contornando o fluxo oficial e o ledger. A
  árvore indevida foi removida com assertions transacionais e readback cruzado (a família legítima
  da Avil preservada), o PAT usado na intervenção foi rotacionado e revogado, e a migration
  `20260804113000_guard_manual_product_direct_writes.sql` passou a tornar `lotes.org_id`/`origem`
  imutáveis, validar a cadeia de `org_id`, recusar cadastro manual sem código de 8 dígitos e
  bloquear escrita de estoque fora das RPCs auditadas (que pertencem ao role `estoque_rpc_executor`,
  `NOLOGIN`, sem `BYPASSRLS`).
- **Viabilidade usava preço padrão em vez da promoção vigente (2026-08-04).** Reproduzido com o GTIN
  `4005800220012`: a API interna mostrava R$ 65,61 enquanto o ML vendia por R$ 45,19.
  `_shared/ml/concorrencia.ts` consumia o campo legado `price` de `/products/{id}/items`; cada
  oferta passa a consultar `/items/{id}/sale_price?context=channel_marketplace`, com o preço
  anterior como fallback e cache de GTIN versionado para `v2`.
- **Devolução conta no período em que o dinheiro saiu** (ADR-0106, 2026-08-06). O filtro usava
  `aberto_em` (abertura do claim): o claim 5552400113 abriu em 31/07 e só foi reembolsado em 03/08,
  então contava em julho e agosto — o mês que perdeu o dinheiro — não via nada. Passa a usar
  `claim.resolution.date_created`, na coluna nova `ml_devolucoes.fechado_em` (migration
  `20260806151323`, com backfill a partir do `raw` já guardado), conferida contra
  `ml_vendas.raw->payments[].date_last_modified` em 5 devoluções reais (Δ de 2 a 64 segundos).
  Junto: devolução **fechada** deixou de ser contada como aberta no card "Precisa de atenção" — o ML
  continua devolvendo `available_actions` em claim já finalizado e reembolsado. O critério de
  "concluída" (`type = 'returns'` **e** `return_status_money = 'refunded'`) não mudou.
- **Catálogo do ML: item plano destravado, e um anúncio cancelado por moderação (2026-08-06).**
  Item plano nunca vinculava ao catálogo (pendente eterno); a causa real do 400 do opt-in passou a
  ser registrada em `catalog_erro`, e `CATALOG_PRODUCT_ID_NULL`/`PRODUCT_INACTIVE` e kit legítimo
  passaram a ser aceitos. **Incidente na mesma frente:** mirar a ficha de outro domínio levou o ML a
  re-moderar e **cancelar o anúncio do Aquaphor por propriedade intelectual** — o guard agora nunca
  mira ficha de outro domínio. Reforça a regra: nenhuma escrita direta em anúncio publicado fora do
  fluxo do app, nem em diagnóstico.
- **Perguntas e Dashboard (2026-08-06).** Resposta dada no ML volta para o app por **webhook**, não
  só na reconciliação; a notificação do Telegram passou a linkar a caixa de perguntas (não o
  anúncio) e a mostrar quem perguntou; o rótulo do comparativo "Hoje" virou "vs. ontem até agora"; e
  o cabeçalho de seção da descrição ganhou linha em branco no envio ao ML (saía "tudo junto").
- **`ORIGEM` obrigatória e explícita na planilha** (ADR-0107, 2026-08-07). Parâmetro fiscal nunca
  defaulta em silêncio: vazio ou typo **aborta o lote**. Case-insensitive no caminho todo, com
  espelho no cliente; as 9 famílias com origem errada foram corrigidas e a query de export ajustada
  para os próximos lotes.
- **Com variação duplicada, vence o custo mais recente** (ADR-0108, 2026-08-07). O desempate era
  pelo **maior** custo desde 2026-06-23 (sem ADR), então uma redução de custo nunca aparecia
  enquanto a linha antiga existisse. Caso real: COLA EM BASTÃO (`02841037`) existia em 3 famílias
  com **todas as chaves idênticas**, exibindo R$ 34,24 no lugar de R$ 31,71. Passa a vencer a linha
  mais recente por `atualizado_em`. Varredura na org: **309 códigos** com custo inflado, todos com
  markup subestimado.
- **Custo congelado no instante da venda** (ADR-0109, 2026-08-07). O markup de uma venda passada
  mudava sozinho — 307 dos 1164 itens vendidos exibiam custo diferente do que vigorava na data da
  própria venda. O custo passa a ser copiado para a satélite `venda_item_custo` no primeiro sync
  (insert-once, `unique nulls not distinct`), com trigger `BEFORE UPDATE` que faz qualquer alteração
  de `custo_unitario` **falhar**. Satélite e não coluna porque `_shared/faturamento/io.ts` **apaga e
  reinsere** os itens a cada sync do pedido. O congelamento mora dentro de `upsertVenda`, com o
  resolver como campo **obrigatório** de `opts` — o TypeScript quebra a compilação de qualquer um
  dos 4 callers que esqueça. Backfill pelo lote mais recente anterior à venda (`fonte = 'backfill'`,
  aproximação assumida). **Comissão, frete e imposto continuam dinâmicos.**
- **Faturamento — paginação, alíquota exibida e Viabilidade acionável (2026-08-08).** Perguntas e
  Mensagens ganharam abas de status e busca paginada (paginação clampada, erro tratado); o
  percentual do imposto passou a aparecer ao lado do valor no detalhe do pedido (só no desktop) e vem
  do **resolver**, não do imposto arredondado; e a tela de Viabilidade ganhou botão **Cadastrar** na
  linha, com o cadastro pré-preenchido pela descrição do catálogo do ML — a foto fica de fora e o
  preço **não** é pré-preenchido (causaria gross-up duplo). A Viabilidade vira porta de entrada do
  pipeline.
- **Ajustar/zerar estoque pelo PubliAI** (ADR-0110, 2026-08-11). Não existia como reduzir saldo fora
  de uma venda, e o operador zerava a cor direto no ML — onde não funciona: o push é absoluto e
  `reconciliar-estoque` (`30 12 * * *`) restaura o número local em até 24h (confirmado com três
  anúncios Helanca Light voltando a vender). Motivo `ajuste` no ledger (migration `20260811201026`),
  RPC `ajustar_estoque` e edge `ajustar-estoque` **admin-only**, com `ref` por item
  (`ajuste:{ref}:{codigo}` — ref compartilhada faria o "Zerar tudo" aplicar só a primeira cor
  devolvendo sucesso). **Só reduz ou zera:** aumentar continua sendo Entrada, que exige custo e
  alimenta markup/preço. Vira regra operacional: **nunca editar estoque direto no canal**.
  - **Falha de segurança encontrada e fechada no próprio deploy (migration `20260811203500`).** O
    `revoke`/`grant` rodava **depois** do `alter owner`, então o executor não era grantor válido e
    ambos viraram **no-op com WARNING, não erro** (o `db push` não abre transação). A função ficou
    com `EXECUTE` para `PUBLIC`, `anon` e `authenticated`; como é `security definer` e recebe
    `p_org` por parâmetro, qualquer usuário autenticado poderia zerar estoque de **qualquer
    organização** via PostgREST. Verificado após o fix: `POST /rest/v1/rpc/ajustar_estoque` com JWT
    de usuário devolve `42501 permission denied`.
  - **Propagação ao ML provada ponta a ponta**, e com uma lição: a primeira tentativa deu
    `DELIVERED 200` no QStash sem o ML mudar — o anúncio estava moderado/forbidden e recusou o PUT
    com 400. `sincronizar-estoque` devolve 200 mesmo em falha definitiva, então **fila entregue não
    é prova de canal atualizado**. Repetido no `MLB5040504553` (saudável): 0 → 11 no ML.
- **Repor estoque reativa o anúncio pausado** (ADR-0111, 2026-08-11). O ML só desfaz sozinho a pausa
  que **ele mesmo** aplicou por falta de estoque; pausa do vendedor fica de pé mesmo com o saldo já
  no canal. Um push de **reposição** com saldo > 0 passa a ler o status ao vivo depois do push e
  devolver `pausado` → `ativo`. A intenção vem do **sinal da quantidade** no ledger (entrada e
  estorno reativam; venda e ajuste não), a reconciliação diária **não** reativa (senão um anúncio
  pausado à mão voltaria ao ar sem reposição), e `moderado`/`encerrado`/`inativo`/`indisponivel` são
  intocados. Idempotente por leitura. 10 testes novos, RED confirmado.
- **Alíquota interna por UF da empresa** (ADR-0112, 2026-08-11). A AVIL é de PE e paga **1%** ao
  vender para cliente do próprio estado; com só as alíquotas por origem (8%/16%), toda venda
  intraestadual saía com imposto 8×/16× maior, derrubando líquido, lucro e markup.
  `configuracoes.uf_empresa` + `aliquota_interna_pct` (migration `20260812004735`, nullable, sem
  default, CHECK de coerência), com **trava LOUD de meia-configuração** e `AliquotaResolver`
  recebendo a UF em parâmetro **obrigatório** (opcional deixaria um call site esquecido devolvendo a
  alíquota por origem em silêncio, num caminho financeiro). Recálculo retroativo sai de graça —
  imposto e markup são derivados na leitura, não persistidos; só **1 pedido em 1389** está sem
  `ml_vendas.uf`. Validado no pedido `2000017819569754` (entrega em PE): imposto R$ 0,85 e markup
  +40%, contra R$ 6,78 e +26% com o parâmetro desligado. Ligado na org **Avil** (72 pedidos
  históricos em PE); DSA segue sem o parâmetro. **Escopo: só apuração pós-venda** — preço sugerido e
  gross-up continuam na origem, porque o anúncio tem preço único para o país.
- **Venda não baixava estoque de produto cadastrado por outro membro da org (2026-08-11).**
  12 unidades do NIVEA (org DSA) venderam em 10 pedidos pagos e o saldo continuou 12.
  `carregarCatalogo` filtrava `familias`/`variacoes` por **`user_id`** — o `criado_por` da conexão
  do canal, resíduo pré-multi-tenancy —, então o produto ficava fora do catálogo com
  `is_publiai = false` e sem código; e `selecionarBaixas` descartava item sem código **em silêncio**
  (o motivo `venda_sku_nao_encontrado` já existia no ledger e tinha **0 linhas em todo o banco** — a
  tabela vazia era o sintoma). Agora filtra por `org_id` (com fallback para `user_id` só sem conexão
  para resolver a org), venda paga sem SKU vira movimento informativo mais notificação, e o
  `seller_custom_field` entra como último recurso — **sem** promover o item a `is_publiai`. Alcance
  medido: Avil **0 de 297** famílias, DSA **2 de 6**. Os 10 pedidos foram re-enfileirados e a baixa
  rodou de verdade (12 → 0, o ML pausou o anúncio sozinho): nenhum ajuste manual, histórico com a
  causa certa. 8 functions redeployadas.
- **Cor, foto e código do item vendido (2026-08-11).** Três correções do mesmo padrão — chave
  disputada por valores diferentes é **anulada** em vez de chutar: a coluna "Cor" estava vazia em
  184 de 1350 itens (item plano vende sem variação, e o ML só manda `variation_attributes` quando há
  variação — corrigido na **leitura**, sem re-sync); a miniatura mostrava a foto de outra cor (mapa
  por anúncio era first-wins); e o filho User Products gravava código/EAN de outra cor. O SKU do
  filho UP sobrepõe o chute da família nos três casos.
- **MLB do anúncio de catálogo entra no catálogo do faturamento** (ADR-0021, 2026-08-11).
  `carregarCatalogo` só conhecia `familias.ml_item_id`, mas o vínculo de catálogo cria um anúncio
  **separado** (`variacoes.catalog_listing_id`): a venda dele só era reconhecida pelo fallback de
  GTIN, e produto sem EAN ficaria sem código — logo, sem baixa de estoque. Sem dado errado hoje
  (nenhum SKU vinculado está sem GTIN: 288 na Avil, 4 na DSA).
- **Estoque — lista de movimentos e tela (2026-08-05 a 2026-08-11).** Ledger paginado com filtros
  (tipo, período, SKU) — antes mostrava só as vendas recentes, não as entradas; layout de operação
  revisado; botão "Ajustar" deixou de vazar para fora da tela (a coluna media `6.5rem` e os dois
  botões pediam `w-full` cada um); e o produto pai passou a exibir a foto do anúncio no ML quando
  não tem capa própria — na AVIL só **1 de 147** famílias tem `capa_storage_path`, mas **140 de
  147** têm `ml_picture_id`.

## Pulse v1 — radar de concorrência (ADR-0119, 2026-08-16) — EM PRODUÇÃO (org DSA)

Fora de épico numerado. Menu "Pulse" org-gated (mesmo padrão do módulo Estoque): coletor
server-side dual-mode (`pulse-coletar`, QStash schedule ou botão "Atualizar agora" escopado à org),
adicionar manualmente por link de catálogo/GTIN (`pulse-adicionar`), 4 tabelas novas
(`pulse_produtos`/`pulse_ofertas`/`pulse_vendedores`/`pulse_alertas`, migration
`20260816125057_pulse_v1.sql`) e UI (radar, detalhe com margem estimada + simulador de preço,
alertas com sino na categoria `pulse`, reprecificar que grava o preço e leva à Revisão — nenhuma
escrita nova no ML). Suíte verde 365 arquivos / 3218 testes, `pnpm lint` 0 erros. **Em produção desde 2026-08-16:**
migration aplicada, as 2 edge functions deployadas e os 2 schedules QStash criados (tier completo
`0 9 * * *`, tier quente `0 */6 * * *`). Módulo habilitado só na org **DSA**; a Avil ainda não vê o
menu, mas **já é coletada** — o histórico dela acumula desde o dia 1, como planejado. Primeira
coleta real: 222 produtos no radar, 267 vendedores, 31 com price-to-win, 0 ofertas da própria loja.
Code review em `.code-review-fable5/code-review-v1.md` (91/100, 3 achados corrigidos — o principal:
a lista de ofertas do catálogo inclui o nosso próprio anúncio e precisa ser filtrada por
`conta_externa_id`, senão o radar alerta contra si mesmo). Ver
`docs/decisions/0119-pulse-inteligencia-de-mercado-dirigida.md` (inclui errata: vendas por anúncio
de terceiro é 403 sempre na API do ML, ficou para o v2 via extensão) e `docs/TASKS.md`.

**Segunda revisão (2026-08-17, `.code-review-fable5/code-review-pulse-modulo-2026-08-17.md`,
72/100):** revisão integral
do módulo depois das Erratas 3–6. Nenhum achado crítico; 1 ALTA e 4 MÉDIA corrigidos e em produção.
O achado principal era uma contradição entre as próprias erratas do ADR — a Errata 6 mandava ler a
comissão "no preço praticado" mas usava o preço base do multiget, que a Errata 4 já havia
desqualificado; com promoção ativa a sobra exibida superestimava, e o rótulo "estimativa" não
disparava porque ancorava no campo errado. Resolvido pela **Errata 7**: consulta no preço efetivo,
coluna `comissao_preco` registrando o preço da leitura, e a âncora do rótulo corrigida nos dois
dialogs. Um achado do relatório foi **refutado** por medição — o PostgREST devolve `numeric` como
número JSON, não string, então não havia comparação lexicográfica de preço; o que sobrou foi um
comentário errado no código, corrigido. Suíte 367 arquivos / 3292 testes.

### Concorrentes relevantes no Pulse e na Viabilidade (spec `2026-08-20-concorrentes-relevantes-pulse-viabilidade-design.md`, ADR-0130) — EM PRODUÇÃO (org DSA, 2026-08-21)

Motivado pelo GTIN `7891025111825` (Aptamil Premium 1 800 g): 90 ofertas observadas, menor R$ 36,00
de um vendedor sem força comercial, alimentando Pulse e Viabilidade (comissão, imposto, frete,
líquido, semáforo). Nova camada de qualificação — mercado observado (tudo, sempre preservado para
auditoria) vs. mercado relevante (≥10 transações, visitas 30d ≠ 0 medido, reputação fora de
`1_red`/`2_orange`) — via classificador único compartilhado
(`_shared/concorrencia/qualificacao.ts`) consumido pelo Pulse **e** pela Viabilidade, sem cópia da
regra. Só o mercado relevante alimenta menor concorrente, posição, alertas (`gravarAlertasRelevantes`)
e o cálculo financeiro; o menor observado nunca é fallback. Viabilidade reaproveita snapshot do Pulse
(≤24h, mesma org/produto) ou busca reputação/visitas sob demanda com pool compartilhado de
concorrência 6 e dedupe por chave (retry-safe após rejeição). Sem relevante, a UI mostra
"Sem concorrente relevante" e travessão nos campos financeiros — nunca R$ 0,00. Cenário de
referência (Aptamil): R$ 36,00 observado, R$ 70,19 relevante, 28/90 ofertas relevantes.

Estado: 7 tarefas do plano concluídas e revisadas na branch `codex/brainstorm-pulse-qualificado`
(worktree `.worktrees/codex-brainstorm-pulse-qualificado`). Revisão final adversarial (diff completo
desde o merge-base com main) e QA visual em runtime real concluídas sem achado bloqueante — 1 fix de
hardening aplicado (`viabilidade-linha.tsx` tolera payload de mercado sem `observado` durante skew de
deploy). ADR própria: [ADR-0130](decisions/0130-concorrentes-relevantes-pulse-viabilidade.md).
`code-review-fable5` pré-deploy achou e corrigiu um segundo real: `full_relevantes` do Pulse era
hard-coded `false` — `_shared/pulse/parse.ts` nunca lia `shipping.logistic_type`, campo que o parser
da Viabilidade já lia do mesmo endpoint; migration adicional
`20260821151141_pulse_ofertas_full_logistica.sql` + parser/diff/margem corrigidos. Suíte focada
700/700, `tsc -b --force`, `deno check`/`check:functions`, `pnpm lint` (0 erros) e `git diff --check`
verdes.

**Deploy (2026-08-21):** migrations `20260821110914`/`20260821151141` aplicadas (`supabase db push`,
`db:check` alinhado), `pulse-coletar` (v21) e `analisar-viabilidade` (v53) deployadas com versão
conferida, branch mergeada fast-forward na `main` (CI verde `frontend`+`backend-lint`), branch e
worktree removidos, `main` local sincronizada.

**Validação em produção (2026-08-21, org DSA):** coleta Pulse real disparada via QStash publish
(`{"tier":"completo"}`) pós-deploy; `pulse_produtos.ultimo_snapshot_em` do Aptamil
(`MLB10512495`) atualizou ~40s depois. Query read-only na mesma qualificação
(`qualificarOferta`) contra os dados reais confirmou: **90 ofertas observadas, menor observado
R$ 36,00 (exato), menor relevante R$ 70,19 (exato)** — os dois números que motivaram a feature.
26/90 relevantes (spec original media 28/90 em 2026-08-20; drift de 1 dia em transações/visitas
reais de vendedores, não uma divergência de lógica — todos os snapshots de vendedor são do mesmo
dia da coleta). `full_ml` confirmado populando dado real (3 de 90 ofertas com FULL), provando o
fix do `code-review-fable5` em produção. Chamada autenticada ao `analisar-viabilidade` como
usuário real da org DSA não foi feita (sem credencial de login disponível para a sessão) — a
validação via SQL read-only sobre o mesmo snapshot fresco (<24h) que `resolverMercadoRelevante`
reaproveitaria é equivalente para o que importa (o número financeiro correto chega à Viabilidade),
mas não é literalmente clicar na tela. Ver
`docs/superpowers/plans/2026-08-20-concorrentes-relevantes-pulse-viabilidade.md`.

### Entregas pós 11/08 (até 24/08) — em produção, salvo onde indicado

- **Pulse — frete na margem via shipping_options/free (ADR-0119 Errata 11, 2026-08-22).** `pulse-coletar/processar.ts` passo 5b: coleta frete com `buscarFreteVendedor` paralelo à comissão, grava `ptw_custos.frete`; passo 5 não sobrescreve mais com null do PTW esparso. Teste `frete=0` válido. Docs: Errata 11 ADR-0119, `docs/how-to/usar-o-pulse.md`.
- **Sonar — busca por EAN/GTIN (ADR-0127 Errata 1, 2026-08-22).** Edge nova `pulse-sonar-ean` + parsers `_shared/pulse/sonar-ean.ts` (validação EAN, interseção por `item_id` restringindo "vendidos" da Apify ao produto do EAN). UI em `PulseSonar.tsx` (escolha grátis/com vendidos, `autoFocus` para leitor físico). Deploy `pulse-sonar-ean` versão 1 ativa em produção. Fix pós-Fable: falha transitória ML não vira tombstone "EAN sem ficha" cacheado — devolve 502 explícito.
- **Apify — fallback multi-conta por saldo (ADR-0122 adendo 2026-08-22).** `_shared/apify/client.ts` tenta até 4 tokens (`APIFY_TOKEN` a `_4`) em ordem, checa saldo mensal (`GET /v2/users/me/limits`), pula se < US$ 0,15. Fallback reativo em HTTP 402, 401, 403 com `console.warn`. 4 contas Apify criadas, tokens confirmados válidos com saldo, `APIFY_TOKEN_2/_3/_4` subidos em produção. `pulse-sonar-vendas` já roda com fallback (sem redeploy extra).
- **Revisão — resync pós-IA no cadastro manual (lote #21, 2026-08-22).** Fix em `familia-expanded.tsx`: campo não-sujo ressincroniza com servidor quando `titulo`/`descricao`/`preco_publicacao` mudam; blur só salva campo realmente digitado. Remediação pendente: família `00000044` (Eucerin Aquaphor) ficou com texto do catálogo — "Regenerar" restaura copy da IA antes de publicar.
- **Sugestão de categoria pela ficha de catálogo, pré-publicação (ADR-0131, 2026-08-22).** Migration `20260822201053_sugestao_categoria_catalogo.sql` (3 colunas aditivas em `familias`: `catalogo_categoria_sugerida_id`/`_nome`/`_vendedores`); funções puras em `_shared/ml/catalogo.ts` (`montarEsperadoPrePublicacao`, `deveSugerirCategoriaPorFicha`, `buscarCategoriaFicha`); `buscarDominioCategoria` em `_shared/ml/domain-discovery.ts` (`settings.catalog_domain`, cache Redis 30d); `process-familia/sugestao-catalogo.ts` calcula e persiste **só no fluxo CREATE**, best-effort; `vincular-catalogo` cita a categoria sugerida no alerta Telegram de `ficha_divergente`; card `SugestaoCatalogo` em `card-categoria.tsx`, renderizado direto da row, com dedupe contra a sugestão do concorrente. Estende o padrão não-vinculante do ADR-0057 — **nunca aplicada automaticamente** (ADR-0054 Fase 2). Motivador: lote 21, Eucerin Aquaphor 55ml publicado em Bebês enquanto a única ficha do GTIN vive em `MLB-BODY_SKIN_CARE_PRODUCTS`. Follow-up `d309619c`: timeout de rede em `buscarDominioCategoria`/`buscarNomeCategoria` e log de erro no select do `vincular-catalogo`.
- **Security scan `supabase/functions` (CLAUDE-SECURITY-20260822-113640): 6 de 9 achados corrigidos (2026-08-23).** F5 (token Telegram em texto puro) aplicado em produção — migration `20260822131053` revoga SELECT de `telegram_bot_token` para `authenticated`. F1/F3 registrados como risco aceito. F2 (IDOR cross-org storage), F4 (SSRF confinado), F6 (XLSX bomb), F7/F8/F9 (bypass entitlement Pulse) corrigidos no código.
- **ADR-0140: Análise PubliAI — JoomPulse no Radar e no Sonar (2026-08-28).** **Desenho fechado, não implementado.** Revisão da D-3 da ADR-0132 concluída em entrevista: 27 decisões. **Liberado para implementação** — a revisão adversarial ([Spike 040](spikes/040-revisao-adversarial-adr-0140.md), 2026-08-28) levantou o bloqueio jurídico B-1, e Diego confirmou no mesmo dia ter a autorização necessária para usar a licença. Radar ganha a coluna "Análise PubliAI" no lugar da "Referência do ML" (problema já documentado na Errata 10 do ADR-0119), com prévia do ganhador do buy-box em 1 consulta por página e painel + 1 frase de IA. Sonar ganha botão que gera relatório de 7 seções — 6 de mercado na hora, DRE sob demanda pedindo custo/origem/peso/dimensões. **Apify permanece** (nem toda org terá JoomPulse). Três camadas com fronteira rígida: MCP traz dado, código do PubliAI calcula todo valor financeiro, IA só redige e é proibida de citar número que não recebeu. DRE **estende** `calcularSimulacaoML()`, sem motor novo. Nicho = `item_id` da amostra do Sonar (ADR-0127). Relatório salvo por produto/dia; custo de IA registrado sem teto. **Pendências do Spike 040 que sobrevivem à liberação:** (a) decisão de produto sobre a **D-9**, que reintroduz o preço médio absoluto no Sonar — exatamente o que a ADR-0138 proibiu no mesmo dia, porque a busca por termo mistura kits de 50/500/1000; (b) comissão e frete **convertem falha em zero** no código atual (`listing-prices.ts:17`, `tarifa.ts:24`, `frete.ts:21`) e dimensões ausentes caem num pacote default silencioso — a DRE não pode subir assim; (c) `calcularSensibilidade()` extrapola comissão linearmente e preserva taxa fixa e frete, errando ao cruzar os degraus de R$ 79 e R$ 150 (os 5 cenários exigem 5 cotações); (d) a cobertura do universo do **Sonar** nunca foi medida (os 82% são do Radar) e a consulta em lote da D-4 não foi testada no tamanho real — o Radar não pagina, 229 catálogos contra limite de 100 do CubeJS. **Cobertura medida ([Spike 039](spikes/039-joompulse-cobertura-medida.md), 2026-08-28):** catálogos 90%, anúncios de concorrentes 82%, anúncios próprios ≈4% — a JoomPulse cobre bem o mercado estabelecido e mal o vendedor novo. A coluna do Radar se sustenta (~67% das linhas com prévia útil), mas a D-4 foi emendada: identificar o ganhador do buy-box por `buyBoxShopId` × `seller_id` da org, **nunca pelo anúncio**. E 89% dos anúncios de concorrentes retornam venda igual a zero — o zero é a regra, não a exceção.
- **ADR-0132: Análise Avançada com JoomPulse (2026-08-23; spike parcial em 2026-08-28).** **Não implementado — D-3 superseded pela ADR-0140; o resto em vigor.** [Spike 038](spikes/038-joompulse-parcial-correlacao-e-semantica.md) rodou contra o MCP real e fechou as questões #1–#3: **não existe GTIN na JoomPulse** (as chaves são `id`/`ml_item_id` e `productId`/`catalog_product_id`, ambas já persistidas — nenhum mecanismo novo de correlação é preciso); allowlist do v1 é uma única ferramenta (`query_cubejs_meli`, que recebe JSON CubeJS cru, então o Gateway monta a query); estimativas com janela móvel sobre snapshot D-1. **Achado que trava a D-3:** `orderCount1m` concentra no ganhador do buy-box e os outros 14–17 concorrentes do catálogo devolvem `0` — que significa "não atribuído", não "não vendeu". O v1 possível é *demanda do catálogo + quem detém o buy-box + estimativa do ganhador*, não "vendas do rival"; decisão volta ao Diego conforme D-17. Questões #4–#15 (OAuth, credenciais, cache, quotas, ciclo de vida) seguem bloqueando, mais a nova #16 (a parceria cobre uso server-to-server desta superfície?). Cobertura real não medida. Direção arquitetural aprovada; questões "A definir" (D-5, D-9, D-10, D-11). Gateway próprio no Render como único cliente MCP/OAuth; módulo `analise_avancada` desligado por padrão; enriquece Radar (vendas/renda rival) e Viabilidade (demanda ao lado do semáforo). Sem fallback inventado, sem contaminação de margem/piso/semáforo/reprecificação. Credenciais ficam só no Gateway. Cache segregado por org+credencial. Chave canônica de correlação e TTLs A definir.
- **Viabilidade — mercado relevante e tabela de frete (2026-08-20/22).** Mercado relevante integrado (edge `buscar-mercado-relevante`); tabela compacta de frete Mercado Envios movida para fim da página; tolera payload sem observado durante skew de deploy.
- **ADR-0135: Cadastro fiscal e emissão via Faturador do Mercado Livre (2026-08-25/26) — 15 tasks concluídas na branch `worktree-fiscal-cadastro-nfe`, aguardando merge (CI verde) e deploy.** Supersede parcialmente o ADR-0114: o PubliAI não transmite NF-e — quem emite é o Faturador grátis do próprio ML — e passa a cadastrar empresa (`empresa_fiscal`) e produto (colunas fiscais em `familias`), empurrar por SKU via a porta `DadosFiscaisCanal` (adaptador único ML) e mostrar a prontidão real (`can_invoice`) como semáforo em Publicados. `organizations.tipo_pessoa` com constraint no banco impede PF de ligar o módulo `fiscal`. 3 edges novas (`sincronizar-fiscal-ml`, `atualizar-fiscal-familia`, `sugerir-ncm`); `usuarios`, `cadastrar-produto`, `ingest-lote`, `publish-familia-ml`, `update-familia-ml` e `monitorar-moderados` afetadas por `_shared/fiscal/*` — nenhum schedule QStash novo. Migrations aplicadas em produção (schema aditivo); dialog de cadastro em 3 etapas + fila "fiscal pendente" no `/estoque` (D-9); NCM sugerido por IA, só grava com confirmação ativa. V1 Simples Nacional apenas. **Limitação conhecida:** anúncio externo sem família ainda não aparece com o aviso "sem cadastro fiscal" em Publicados (gap pré-existente da tela, não desta entrega — ver `modelo-de-dados.md#fiscal-adr-0135`). Deploy das edges e validação em runtime real ficam para depois do merge — checklist em `docs/how-to/deploy-e-migrations.md`.

## Trilho de UX/design (2026-06-21, em producao)

Preparacao do app para virar SaaS comercial. Tudo light+dark, TDD na logica, sem tocar backend/lifecycle. Detalhe em `TASKS.md`.

- **Tarefa 1 + 1.5 — Repaginacao visual premium:** tokens de marca (gradiente roxo->indigo, sombras, elevacao por cor no dark), regra hibrida vitrine/dados, hero cards, hover padronizado; refinamento pos-review (hierarquia do Dashboard, OAuth colapsado, timestamp no Financeiro, acento por status na Revisao, dropzone da Viabilidade).
- **Tarefa 2 / Onda 1 — Workflow operacional (4 fatias):** jornada do lote visivel + "continuar de onde parei"; painel "Precisa da sua atencao"; Revisao por excecao (problemas-primeiro); pre-validacao das colunas da planilha no cliente. 772 testes, deploy live (commit `3ef0de9`).
- **Tarefa 2 / Onda 2 — Tirar atrito (2 fatias):** estado da Publicados (filtros/ordenacao/pagina) na URL + chips removiveis + "Limpar tudo"; paginacao default 10; estado vazio acionavel. 780 testes, validado light+dark.
- **Tarefa 2 / Onda 3 — Navegacao & orientacao (2 fatias) — fecha a Tarefa 2:** breadcrumbs nas telas profundas; KPIs navegaveis no Dashboard (drill-down, "Ativos"->Publicados filtrado por status). 783 testes, validado light+dark. **Tarefa 2 concluida.**
- **Backlog pos-Tarefa 2 (adiado):** busca global, acoes em massa na Revisao (gate de publicacao), a11y aprofundada, periodo sincronizado Publicados<->Financeiro, links cruzados, scroll restoration, aviso global do worker.

## O que ja esta funcionando

- Upload e ingestao real de planilha + imagens
- Pipeline de copy com IA
- Resolucao de cor
- Concorrencia, precificacao e semaforo de viabilidade
- Publicacao `CREATE` e `UPDATE`
- Camada de abstracao de canais (`ChannelConnector`)
- Modelo multicanal `anuncios_externos`
- Categoria generica por preditor/LLM closed-set
- Atributos obrigatorios por IA closed-set
- Catalogo do ML integrado no fluxo atual
- Multiusuario com acesso por menu (operacao compartilhada, ADR-0047) + e-mail transacional via Resend

## Revalidacoes mais recentes

- Reauditoria browser-use de `E1` a `E4` registrada em [auditoria-e1-e4-browser-use.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/auditoria-e1-e4-browser-use.md)
- Publicacao real de prova apos fix final de retry de foto: `MLB6967261422`
- Espelho em `anuncios_externos` validado e cleanup confirmado
- `remover-publicado` ajustado para limpar tambem o espelho multicanal

## Versoes das edge functions

Nao sao rastreadas aqui: mudam a cada deploy e este arquivo envelhecia sozinho (a lista antiga
dizia `publish-familia-ml` v31 enquanto o proprio E6b ja registrava v82). A verdade viva esta em
`supabase functions list`; o inventario por funcao fica em
[reference/edge-functions.md](reference/edge-functions.md).

## Revisão pós-auditoria (2026-06-15)

- A1 refatorado: removido o fallback hard-coded `MLB189007` do resolver de categoria. A pista forte só corrige o top-1 do preditor quando há candidato compatível; sem candidato compatível, devolve `manual` (operador define a categoria na Revisão via `definir-categoria-familia`). Evita auto-atribuir categoria errada e não inventa categoria fixa.
- Item residual da auditoria `MLB6967261422` confirmado no ML como `status=closed` (encerrado, não vendável) — estado terminal, sem ação pendente.

## Riscos e ressalvas abertas

- **7 de 147 produtos sem foto na tela Estoque — decisão pendente do Diego (2026-08-11).** O lote
  #45 subiu **sem nenhuma imagem** e recriou 135 famílias; como a tela adota a família mais recente
  de cada `codigo_pai` (âncora ADR-0025), essas viraram as canônicas. Em `ingest-lote`,
  `imagem_path` vem só do lote atual e **nunca é herdado** da família anterior (só o
  `ml_picture_id` é), então escaparam justamente os 128 publicados. Dos 7, **2 têm o arquivo no
  Storage** (lote #33). Não é fix de uma linha: `herdarPictureId` zera o id do ML ao enxergar
  imagem nova, então passar o caminho herdado ali **derrubaria a foto de produto publicado**.
  Alternativas: (a) religar por SQL as 29 variações dos 2 produtos; (b) reenviar as fotos no lote
  #45; (c) herdar `imagem_path` com flag que não invalide o `ml_picture_id`
- **Parsing de milhar pt-BR ainda aberto em `/publicados`.** `src/components/variacao-card.tsx` tem
  o mesmo bug corrigido em `src/lib/formato.ts` (`parseNumeroPtBr`): `"1.234"` grava `R$ 1,23`.
  Ficou explicitamente fora do escopo do PR #56
- **`postgres` ficou membro de `estoque_rpc_executor` (baixa severidade, 2026-08-11).** O `grant`
  exigido pelo `alter owner` foi gravado com `grantor = supabase_admin`, e nem a Management API nem
  o `db push` (ambos rodam como `postgres`) conseguem revogá-lo — `no possible grantors`. **O guard
  essencial segue intacto:** `service_role`, `authenticated` e `anon` continuam sem poder assumir o
  role (verificado por `pg_has_role`), então nenhuma via da aplicação escreve saldo direto. Resolver
  exige sessão com `supabase_admin` (suporte Supabase)
- **"Unidades vendidas" lento no Publicados — causa medida, fix adiado por decisão (2026-08-08).**
  O banco **não** é o gargalo (query de vendas 20–35 ms; `ml_vendas` tem ~4,4 MB): `Publicados.tsx`
  usa janela `preset` de 30 dias resolvida como "agora − 30d", timestamp com milissegundos que muda
  a cada montagem, então a `queryKey` do React Query é nova a cada abertura — nunca há cache hit,
  baixa 1155 kB inteiros toda vez e o poll incremental do ADR-0082 nunca entra em ação. Custo por
  visita: 1ª abertura ≈ 2,4 MB, cada reabertura ≈ 1,1 MB. Diego optou por não implementar agora; as
  opções (alinhar a janela ao dia, exigindo adendo ao ADR-0082, ou só cortar payload) estão em
  `TASKS.md`. **Registro de método:** a primeira tentativa criou um índice em `org_id` com
  diagnóstico errado (já existia um desde 05/07) e sem nenhuma medição prévia — o índice é placebo,
  não nocivo, e candidato a drop futuro
- Retry de foto transiente no `CREATE` foi reforçado e validado; o mesmo padrão ainda merece extensão consistente no `UPDATE` quando houver necessidade operacional
- **E4 — publicação real de vertical nova (furadeira) ainda não comprovada ponta a ponta no ML.** Foi validada até Revisão/banco (categoria `MLB189007` + `VOLTAGE` closed-set + publicabilidade); o único CREATE real de prova da reauditoria foi com a família de fita. Decisão (2026-06-15): não forçar um publish sintético; fechar esse fluxo quando uma furadeira real entrar num lote de produção normal.
- `ROADMAP.md` ficou para contexto estratégico; o estado operativo confiável está neste arquivo e em `TASKS.md`

## Proximo foco

**`E5` — Shopee.** O `E6` (orquestração multicanal) e o `E6b` (estoque) já estão em produção, e a
UI multi-marketplace também (2026-07-15, ADR-0077): o worker genérico `publicar-anuncio`, o registry
de canais e o rollout por org já existem, então o E5 é hoje **"preencher o conector"**. A validação
real do E6 ("ML + Shopee simultâneos", D-E6.7) fecha junto com ele.

- [Plano E7](superpowers/plans/2026-07-02-e7-multi-tenancy-org-id.md) — **CONCLUIDO em producao (2026-07-05)**; falta so a Task 17 (limpeza diferida: drop `ml_credentials` + docs de referencia + Graphify) apos ~1 semana estavel
- [Plano E6](superpowers/plans/2026-07-02-e6-orquestracao-multicanal.md) — worker generico `publicar-anuncio`, estado por canal em `anuncios_externos`, caminho ML intocado

## Fontes de verdade

- Checklist operacional: [TASKS.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/TASKS.md)
- Estrategia e fases: [ROADMAP.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/ROADMAP.md)
- Decisoes: [decisions](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/decisions)
- Historico: [project-history.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/project-history.md)
