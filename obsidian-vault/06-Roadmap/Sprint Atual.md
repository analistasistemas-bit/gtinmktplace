---
tags: [roadmap, sprint]
atualizado: 2026-07-23
---

# Sprint Atual

Fonte de verdade viva: `docs/TASKS.md` (marcador "📍 Passo atual" no topo) e
`docs/project-status.md`. Ver [[Próximas Features]], [[Backlog]].

## 📍 Passo atual (2026-07-15)

> **E7 (Multi-tenancy) e E6 (Orquestração multicanal) concluídos e em produção; UI multi-marketplace
> (menus/tabs/registry) também concluída e em produção (2026-07-15) — o app já mostra os 5
> marketplaces do roadmap (Mercado Livre ativo, Shopee/Magalu/Amazon/Casas Bahia vitrine "em
> breve"), faltando só os conectores reais.** Restam no épico do 2º canal o **E5 — Shopee**
> (conector real) e o **E6b** (estoque único cross-canal); a validação plena de E6/E6b com 2
> canais depende do E5. Próximo passo natural: **E5** — e, pela revisão de CTO do roadmap v2
> (2026-07-12), deve rodar **em paralelo** à Fase 1 comercial (billing mínimo), não mais adiado.
> Planos em `docs/superpowers/plans/2026-07-02-*` e `2026-07-14-menus-multicanal.md`; ADRs de
> referência ADR-0027 (multi-tenancy) e ADR-0061 (orquestração multicanal) — ver [[Índice de ADRs]].

## Entregas mais recentes já em produção (fonte: `docs/project-status.md`)

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
  reais intocadas) → remover cor com sucesso. As 4 pendências (reconciliador de convergência,
  reconciliador de backfill, sincronizar descrição no UPDATE UP, guarda completa de remoção)
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
