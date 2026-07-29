---
tags: [roadmap, sprint]
atualizado: 2026-07-29
---

# Sprint Atual

Fonte de verdade viva: `docs/TASKS.md` (marcador "📍 Passo atual" no topo) e
`docs/project-status.md`. Ver [[Próximas Features]], [[Backlog]].

## 📍 Passo atual (2026-07-29)

> **✅ E6b BLOCO A EM PRODUÇÃO (2026-07-29).** Ledger `estoque_movimentos`, baixa automática na
> venda paga, estorno no cancelamento pré-despacho, push absoluto cross-canal e reconciliação
> diária. Migration aplicada, `sincronizar-estoque` (v1) e `reconciliar-estoque` (v1) deployadas
> com `verify_jwt=false`, `sync-venda` redeployada (v50), schedule QStash `30 12 * * *` criado e
> **confirmado na listagem**. Suíte 2181 → 2215. Invariantes verificados ao vivo em produção:
> RLS ligada com uma única policy (SELECT/authenticated), trigger de bloqueio de escrita direta
> habilitado, e as 3 RPCs executáveis só por `service_role`.
>
> **Bug achado rodando, não pela revisão:** faltava `grant select ... to authenticated` na tabela.
> A policy de RLS existia, mas privilégio de tabela e RLS são checagens independentes — sem o
> grant, a tela de movimentos daria "permission denied". (Em produção os grants já vinham por
> default privileges; local não. Só apareceu ao assumir o papel `authenticated` de fato.)
>
> **Bloco A não tem mais pendência:** a UI de movimentos foi mergeada e está no ar (deploy
> `823843e9` no Render), e a suíte `verificar-isolamento-tenant.ts` rodou contra produção com
> 54 asserções passando.
>
> **✅ E6b BLOCO B EM PRODUÇÃO (2026-07-29).** Cadastro manual de produto
> (edge `cadastrar-produto`), entrada de mercadoria (edge `entrada-estoque`), tela `/estoque`,
> módulo pago ligado por org pelo super-admin (`organizations.modulos_habilitados` +
> `set_modulos_org` no `/admin`), chip Planilha/Cadastro manual no LoteCard. Migration
> `20260729124711_e6b_origem_lote_e_modulos.sql` aplicada, 6 edge functions deployadas
> (`cadastrar-produto` v1 e `entrada-estoque` v1 com `verify_jwt=true`), frontend `live` no
> Render (`2d94b4e9`) e CI verde. Suíte 2215 → 2255.
> **Nenhuma org enxerga o módulo ainda** — `modulos_habilitados` nasce vazio; ligar em `/admin`
> → botão "Módulos" na linha da empresa.
>
> **Corrigido de quebra (defeito pré-existente, valia também para planilha):**
> `talvezFinalizarLote` marcava o lote como `concluido` — status terminal — mesmo com família
> em `pendente`, e o trigger de transição só resgata lote em `processando`, então o lote ficava
> concluído com família publicável dentro. Eram TRÊS cópias idênticas; viraram uma em
> `_shared/lote/finalizar.ts`.
>
> **Ordem de deploy usada (e obrigatória em qualquer repetição):** `db push` →
> `functions deploy` → merge na main. O frontend chama `modulos_habilitados_da_org` dentro do
> MenuGuard e o Render auto-deploya no push — inverter deixaria toda org na tela de carregando.
>
> **E2E manual concluído 2026-07-29** (Playwright CLI, org DSA ao vivo, módulo ligado em
> `/admin`): cadastro real com 2 variações, IA rodando de verdade, D-1.1 (mesmo lote), 409 de
> duplicata, ledger — tudo confirmado. Parado antes do clique de publicar de verdade no ML
> (decisão do Diego). **4 bugs de UI achados e corrigidos no mesmo dia** (deploy `7efb89a`):
> dialog de cadastro cortando a tabela de variações (classe Tailwind sem prefixo `sm:`, `min-w-0`
> faltando, e largura insuficiente — `sm:max-w-4xl` → `sm:max-w-5xl`) e GTIN/dimensões/descrição
> ausentes na tela `/estoque` (dado já gravado, agora também exibido). Suíte 2255 → 2256.
> Produtos de teste (`99000001`/`99000002`) seguem na DSA — procedimento de limpeza em
> `docs/how-to/operacoes-rotineiras.md`.
>
> **Depois: E5 Shopee.**

> **Contexto da decisão (2026-07-28).** O E6b foi **ampliado** (deixou de ser só "estoque único"
> e passou a incluir cadastro de produto sem planilha e entrada de mercadoria) e **antecipado na
> frente do E5 Shopee**. Motivo: hoje um produto só entra por planilha (`ingest-lote`), o que exige
> que o cliente **já tenha um ERP** para usar o PubliAI — o funil ficava restrito exatamente ao
> público que menos precisa do produto.
>
> **Descartado na mesma sessão: módulo de emissão de NF-e.** Commodity (6 providers entregam igual),
> passivo e não ativo (nota errada vira chamado de suporte contábil), manutenção fiscal perpétua
> (reforma tributária em transição) e não multiplica nada do que o PubliAI já construiu. Racional
> completo e dados dos providers na seção 11 da spec.
>
> **Decisão de arquitetura do Bloco B:** cadastro manual **não** usa `lote_id` nulo — "sessão de
> cadastro = um lote" (`lotes.origem = 'manual'`). Verificado no código que `lote_id` é `NOT NULL`
> e sustenta `process-familia`, `finalizarLote` nos TRÊS workers de publicação, todo o roteamento
> da Revisão e a unique `(lote_id, codigo_pai)` — que ficaria furada com `NULL`.
>
> **Spec:** `docs/superpowers/specs/2026-07-28-cadastro-manual-e-estoque-design.md`
> **ADR:** [[Índice de ADRs|ADR-0094]] (o número 0054 do plano original já estava ocupado).
> Os planos passaram por 1 revisão do Fable + 7 rodadas adversariais com o Codex (`gpt-5.6-sol`),
> convergindo em APPROVED; 9 bloqueadores corrigidos. Log em `PLAN-REVIEW-LOG-E6B.md`.

## Entregas mais recentes já em produção (fonte: `docs/project-status.md`)

- **Atualização rápida de estoque** (ADR-0089) — em produção 2026-07-24: atalho de 1-clique em
  `Progresso.tsx` que publica automaticamente o estoque de famílias `UPDATE` sem nenhuma
  pendência (nunca `CREATE`, nunca cor nova mesmo completa, preço sempre ignorado) — elimina a
  seleção manual família a família na Revisão pra reposições puras de estoque. `/relatorio/{loteId}`
  ganhou seção de variações/famílias que zeraram estoque na rodada. 100% frontend (zero
  migration/edge nova), 24 testes novos. Plano revisado adversarialmente pelo Fable 5 antes de
  codar (achou e evitou 1 furo real: cor nova completa não podia entrar no atalho) e revisado
  com `/code-review-fable5` depois de pronto (88/100, 2 achados médios corrigidos no mesmo dia).
  Merge direto pra `main`, sem PR. Ver [[Índice de ADRs]].
- **Publicação em User Products com N itens por família (multi-cor)** (ADR-0088) — em produção
  2026-07-22/23: categorias do ML que exigem "item plano" (ADR-0084/0087) e têm >1 cor não aceitam
  o array `variations` — cada cor vira um item técnico separado, linkado por `family_id`, agregado
  pelo ML numa única página com seletor de cor. Fase 1 (saga `publicar-grupo.ts`, criar-pausado→
  confirmar→ativar, `agregarEstado` total dos 10 casos da ADR) validada com família real de 9 cores
  (PAI `03103331`). Fase 2: vinculação de catálogo por item + UPDATE por item filho com mini-saga de
  mudança de composição (add/retirar cor) — grava `skus_esperados`/`mudando_composicao` ANTES de
  mutar remoto, confirma sempre por `GET`; fix do gate de publicabilidade do frontend que travava
  qualquer UPDATE de família UP na Revisão. Validado end-to-end em produção real (Playwright):
  adicionar cor → caso real de `family_id` divergente isolado corretamente pela mini-saga (9 cores
  reais intocadas) → remover cor com sucesso. As 5 pendências (reconciliador de convergência,
  reconciliador de backfill, sincronizar descrição no UPDATE UP, guarda completa de remoção,
  fix de realtime na tela de Revisão)
  **implementadas, revisadas e deployadas em produção (2026-07-24)** — cada uma aprovada pelo
  Codex após 3-4 rodadas de revisão adversarial (achados reais corrigidos por rodada, ver
  `docs/TASKS.md`); suíte inteira verde, `deno check`/lint limpos; migrations aplicadas + 12
  functions redeployadas (blast radius recalculado via `deno info`); schedule QStash do
  reconciliador de convergência criado (`*/15 * * * *`). **Achado à parte, também corrigido:**
  `reconciliar-faturamento` (ADR-0037) nunca teve schedule QStash desde a criação — rodou zero
  vezes em ~1 mês; corrigido junto. Ver [[Índice de ADRs]].
- **Config org-scoped + imposto LOUD + token MP por org** (ADR-0086) — em produção 2026-07-22:
  `configuracoes` virou 1 linha por org (`org_id` PK, `user_id` = auditoria); o imposto por origem
  **falha LOUD** se a org não confirmou as alíquotas (`aliquotas_confirmadas_em`) em vez de aplicar
  8/16 em silêncio (Configurações tem banner + botão "Confirmar alíquotas"); e o token do Mercado
  Pago é por org — fechando um vazamento cross-tenant que ficou **vivo** ao surgir a 2ª org
  (DSA/diego-souza), que lia a conta MP da Avil. Ver `docs/decisions/0086-configuracao-org-scoped.md`.
- **Preço por variação + split por faixa** (ADR-0078) — em produção 2026-07-17: o ML passou a
  rejeitar publicação de famílias com preço divergente entre variações (`Found different prices in
  variations`, incidente real — PAI 02841240/02841290). Fase 2 entrega o motor de split por faixa
  de preço (`particionarPorPreco`/`decidirSplit` roteiam pro worker `publicar-split-ml`, ancoragem
  preservada) + guards LOUD de uniformidade + UI de configuração por faixa (`ConfigGruposPreco`,
  prompt "aplicar às demais?", badge por variação, aviso LOUD no diálogo de publicação). Validado
  com dados reais: as 2 famílias do incidente republicadas de verdade (split funcionando, 3 e 2
  anúncios) e UI validada pelo Diego. Ver [[Índice de ADRs]].
- **Notificação in-app** (ADR-0085) — em produção 2026-07-21: espelho no app de todo alerta já
  enviado por Telegram, com tabela `notificacoes`, sino no topbar e badge de não lidas; a RPC
  `marcar_notificacoes_lidas` marca as notificações do usuário. Migration aplicada, 8 edge
  functions redeployadas e frontend confirmado `live` no Render.
- **UI multi-marketplace (menus/tabs/registry)** — spec 2026-07-14, em produção 2026-07-15:
  registry único no frontend (`src/lib/canais.ts`, 5 marketplaces) + `organizations.canais_habilitados`
  por org (rollout piloto sem deploy); canal ativo global (`?canal=` + sessão) com tabs em
  Dashboard/Publicados/Faturamento/Financeiro; menu+tela `/canais` (OAuth do ML migrado de
  Configurações); Revisão registry-driven; editor de canais no `/admin`. Com 1 canal, nenhum
  número de nenhuma tela muda. **E5 (Shopee) vira só "preencher o conector"** — a UI e o
  rollout por org já existem.
- **E6 — Orquestração multicanal** (ADR-0061) — em produção 2026-07-06: fan-out por
  `(família, canal)`; caminho ML **intocado** (roda dentro de `if(incluiML)`); worker genérico
  `publicar-anuncio`; estado por canal em `anuncios_externos` (claim atômico); UI de seleção de
  canal aparece só com >1 canal. Default `['mercado_livre']` → chamadas atuais 100% compatíveis.
- **E7 — Multi-tenancy** (ADR-0027) — em produção 2026-07-05/06: isolamento por `org_id`
  (`current_org_id()`) substitui `is_membro_operacao()` em toda tabela de domínio; estratégia
  `expand → migrate → contract`; suíte hermética de isolamento (39 asserções) validada contra
  produção; zero regressão na conta Avil.

- **Marca manual de saque no Financeiro** (ADR-0053) — deployada 2026-07-02: estado `sacado` no
  Detalhe do líquido (checkbox + `Registrar`/`Desfazer saque` + filtro `Sacados`); campos
  `sacado_em`/`sacado_por` em `ml_vendas` via RPCs `security definer`. Migration aplicada via MCP
  (CLI bloqueado por IPv6 nesta rede).
- **Módulo Financeiro impecável** (ADR-0040) — validado e deployado 2026-07-02 (migration +
  `notificar-liberacao` + schedule QStash diário)
- **Módulo Faturamento** (ADR-0037) — webhooks ML no DevCenter + schedule QStash horário
  ativos (2026-07-02)
- **Lote #49 barbante** (ADR-0051) — fix deployado e 3 famílias reprocessadas (2026-07-02)
- Camadas 2A + 2B de atributos por IA com fallback do operador (ADR-0052, 2026-07-01)
- Split de produto em N anúncios para produtos com >100 cores (ADR-0048, 2026-06-29)
- Multiusuário com permissão de menu (ADR-0047, 2026-06-29) — antecipa parte do `E7`

## Ver também

- [[Backlog]] — os épicos da evolução SaaS (agora com E6b)
- [[Publicação Shopee]] — pesquisa do épico `E5`, agora antecipado (roadmap v2, 2026-07-12)
