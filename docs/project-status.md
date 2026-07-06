# PubliAI — Status atual

> Documento vivo. Este e o retrato curto do estado atual do projeto. Historico detalhado fica em `project-history.md`.

**Ultima atualizacao:** 2026-07-02

## Snapshot

- Fase atual: Evolucao SaaS, Fase 1 concluida ate `E4`; **`E7` multi-tenancy + `E6` orquestracao multicanal EM PRODUCAO (2026-07-05/06)**
- Epicos validados em producao: `E1`, `E1b`, `E2`, `E3`, `E4`, `E7`, `E6`
- Proximo epico: `E5` Shopee (agora o worker generico `publicar-anuncio` do E6 espera so o conector); depois E6b (estoque unico)

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
- Liquido economico correto em producao (ADR-0042, 2026-06-25): o `net_received_amount` do MP era inconsistente (cross-docking desconta frete cheio e ignora comissao; pack desconta comissao e ignora frete), gerando markup falso. Liquido passa a ser `bruto - comissao - frete real` de fontes autoritativas (`sale_fee` + `senders[].cost`), com rateio de pack net-independente. Faturamento e Financeiro batem (fonte unica `ml_vendas`). DB reconciliado (46 pedidos), 4 edges + front deployados, validado com browser-use. O caminho do MP ao vivo (`lib/financeiro.ts`, `useResumoFinanceiro`, edge `resumo-financeiro`) ficou OBSOLETO, mas os arquivos NAO foram deletados — seguem como codigo morto sem call site no frontend (a tela usa `ml_vendas`), a limpar num passe futuro.

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

- `process-familia` v41 (refactor A1: resolver de categoria sem fallback hard-coded)
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
