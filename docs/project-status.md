# PubliAI — Status atual

> Documento vivo. Este e o retrato curto do estado atual do projeto. Historico detalhado fica em `project-history.md`.

**Ultima atualizacao:** 2026-08-02

## Snapshot

- Fase atual: Evolucao SaaS, Fase 1 concluida ate `E4`; **`E7` multi-tenancy + `E6` orquestracao multicanal EM PRODUCAO (2026-07-05/06)**
- Epicos validados em producao: `E1`, `E1b`, `E2`, `E3`, `E4`, `E7`, `E6`, `E6b` (Blocos A e B)
- **`E6b` Bloco A (estoque único cross-canal) EM PRODUÇÃO (2026-07-29)** — ver seção dedicada abaixo. **Bloco B (cadastro manual de produto + entrada de mercadoria pela UI, gated por módulo) EM PRODUÇÃO (2026-07-29)**, **redesenho da tela `/estoque` EM PRODUÇÃO (2026-08-02)** — nenhuma org enxerga o módulo até o super-admin ligar em `/admin` (`modulos_habilitados` nasce vazio). Spec: `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md` (Bloco B), `docs/superpowers/specs/2026-08-01-estoque-redesign-design.md` (redesenho). ADR: [0094](decisions/0094-estoque-unico-cadastro-manual.md). **Descartado na mesma sessão de design:** módulo de emissão de NF-e (commodity, passivo fiscal, manutenção perpétua da reforma tributária — racional na seção 11 da spec)
- Depois do E6b: `E5` Shopee (o worker genérico `publicar-anuncio` do E6 espera só o conector)

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

## Deploys operacionais mais recentes

- `process-familia` (re-ancora no piso-lider, ADR-0065, 2026-07-08; inclui `_shared/preco/sugerir.ts` e `_shared/preco/piso-lider.ts`) — versao pos-deploy (confirmar)
- `publish-familia-ml` v31
- `remover-publicado` v7

## Revisão pós-auditoria (2026-06-15)

- A1 refatorado: removido o fallback hard-coded `MLB189007` do resolver de categoria. A pista forte só corrige o top-1 do preditor quando há candidato compatível; sem candidato compatível, devolve `manual` (operador define a categoria na Revisão via `definir-categoria-familia`). Evita auto-atribuir categoria errada e não inventa categoria fixa.
- Item residual da auditoria `MLB6967261422` confirmado no ML como `status=closed` (encerrado, não vendável) — estado terminal, sem ação pendente.

## Riscos e ressalvas abertas

- Retry de foto transiente no `CREATE` foi reforçado e validado; o mesmo padrão ainda merece extensão consistente no `UPDATE` quando houver necessidade operacional
- **E4 — publicação real de vertical nova (furadeira) ainda não comprovada ponta a ponta no ML.** Foi validada até Revisão/banco (categoria `MLB189007` + `VOLTAGE` closed-set + publicabilidade); o único CREATE real de prova da reauditoria foi com a família de fita. Decisão (2026-06-15): não forçar um publish sintético; fechar esse fluxo quando uma furadeira real entrar num lote de produção normal.
- `ROADMAP.md` ficou para contexto estratégico; o estado operativo confiável está neste arquivo e em `TASKS.md`

## Proximo foco

`E6` — orquestracao multicanal (agora nasce tenant-aware, sobre o E7 ja em producao). `E5` (Shopee) depois; validacao real do E6 depende do E5.

- [Plano E7](superpowers/plans/2026-07-02-e7-multi-tenancy-org-id.md) — **CONCLUIDO em producao (2026-07-05)**; falta so a Task 17 (limpeza diferida: drop `ml_credentials` + docs de referencia + Graphify) apos ~1 semana estavel
- [Plano E6](superpowers/plans/2026-07-02-e6-orquestracao-multicanal.md) — worker generico `publicar-anuncio`, estado por canal em `anuncios_externos`, caminho ML intocado

## Fontes de verdade

- Checklist operacional: [TASKS.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/TASKS.md)
- Estrategia e fases: [ROADMAP.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/ROADMAP.md)
- Decisoes: [decisions](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/decisions)
- Historico: [project-history.md](/Users/diego/Desktop/IA/Anuncios%20MktPlace/docs/project-history.md)
