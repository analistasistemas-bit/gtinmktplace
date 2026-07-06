# PubliAI — Roadmap

> ⚠️ **Documento estratégico, não operativo.** O estado real e atual do produto está em
> [project-status.md](project-status.md) e [TASKS.md](TASKS.md). Itens marcados aqui como
> "não iniciado" / "em andamento" / "fora do MVP" podem **já estar em produção** (ex.: M4
> Integração ML, análise de vendas/Faturamento, Financeiro, IA respondendo perguntas no ML).
> Consulte `project-status.md` antes de usar este roadmap como fotografia do presente.

> Documento vivo. Reflete a visão estratégica das fases do projeto. Para checklist operacional do dia a dia, ver [TASKS.md](TASKS.md).

**Última atualização:** 2026-05-29 (M4 bloco OAuth ML entregue)
**Estado geral:** 🟢 M0+M1+M2+M3+M3.1 + trilho ML concluídos; M4 (Integração Mercado Livre) **em andamento** — bloco OAuth ✅ (conectar/desconectar validado em produção, ADR-0012); faltam concorrência, preço, categorias e publicação

---

## Visão de cronograma

```
Início estimado: ~2026-05-27
Entrega MVP:     ~2026-08-05 (10 semanas)
Folga até prazo: ~2026-08-25 (3 semanas de buffer)
Limite teto:     2026-08-25 (3 meses corridos)
```

```
2026-05  │ 2026-06         │ 2026-07         │ 2026-08
─────────┼─────────────────┼─────────────────┼─────────────
 M0 ████ │
 M1      │█████
 M2      │     ██████████
 M3      │              ██████████
 M4      │                       █████████████
 M5      │                                   █████
 M6      │                                        █████
─────────────────────────────────────────────────────────
 Trilho ML app: ████████████████ (paralelo, manual)
```

---

## 🏁 M0 — Setup inicial

**Status:** ✅ Concluído (2026-05-26, em 3 sessões)
**Duração real:** 3 sessões focadas (~1 dia útil acumulado, em vez de 1 semana estimada)
**Bloqueia:** nada — M1 pode iniciar

### Objetivo
Ter todas as contas, repositórios e ambientes configurados para começar a desenvolver.

### Critérios de saída
- [x] Repo Git criado e versionado — `analistasistemas-bit/gtinmktplace`
- [x] Projeto Supabase ativo — `gtin_mktplace_ia` (ref `txvncrgkoynoxwopfkbp`), Edge Function `hello` deployada e respondendo
- [x] Render conectado ao repo — Static Site `srv-d8at8arbc2fs73e5qcb0` em `https://ean2marketplace-frontend.onrender.com`, auto-deploy ativo
- [x] Upstash QStash + Redis criados via MCP — `mktplace-redis` (us-east-1) + QStash (eu-central-1)
- [x] Chave de IA provisionada — `OPENROUTER_API_KEY` (não OpenAI direto, ver ADR-0010)
- [x] App Mercado Livre Developers **criado** — `PubliAI`, Client ID 5907788004648058, credenciais em `.env.local` (2026-05-27)
- [x] Frontend Vite + React + TS + Tailwind 4 + shadcn instalado e rodando localmente — build OK 153 módulos
- [x] `.env.local` configurado — Supabase, Upstash, OpenRouter, QStash; *Supabase secrets via CLI ainda pendente, será feito ao primeiro Edge Function que precise (M2/M3)*

### Saída esperada
Ambiente "Hello World" funcional: frontend serve uma página em produção com tema shadcn; Edge Function `hello` retorna 200 com JSON.

### Desvios documentados ao concluir
- **HashRouter em vez de BrowserRouter** — rule de rewrite `/* → /index.html` do Render retorna 200 com body vazio (bug investigado, doc context7 confere sintaxe). HashRouter contorna sem depender da config do servidor. URLs ficam `/#/rota` — aceitável para ferramenta interna.
- **Supabase CLI não instalada** — MCP `deploy_edge_function` cobre deploy sem precisar de password do banco. Instalar só se um dia precisar de dev local com Docker.
- **Secrets Supabase ainda não setados** — `OPENROUTER_API_KEY`/`UPSTASH_*`/`QSTASH_*` estão em `.env.local` (frontend), mas falta `supabase secrets set` para o backend. Adiar até o primeiro Edge Function que use IA/Redis (M2/M3).

---

## 🏁 M1 — UI mockup com dados fake

**Status:** ✅ Implementado (2026-05-26, em 1 sessão via Plano 02 — Subagent-Driven Development)
**Duração real:** ~1 dia útil (vs 1 semana estimada)
**Walkthrough Diego:** pendente

### Objetivo
Diego percorre todas as telas do produto com dados mockados, valida a UX e identifica ajustes antes da gente investir no backend.

### Critérios de saída
- [x] Todas as 6 telas navegáveis (Dashboard, Novo Lote, Progresso, Revisão, Relatório, Configurações) — em produção
- [x] Tela de Revisão completa com mock de 50 famílias + variações + concorrência + estratégia de preço
- [ ] Diego aprova o fluxo de revisão em walkthrough ao vivo — *pendente*
- [ ] Ajustes identificados na validação são listados como itens em [TASKS.md](TASKS.md) — *pós-walkthrough*

### Saída entregue
Site navegável em produção (https://ean2marketplace-frontend.onrender.com) com tema Nova/neutral, 50 famílias mockadas no Lote #42, 45 testes passando.

### Desvios do plano original
- **Tema Slate/Zinc → Nova/neutral**: mantido do M0 por pragmatismo
- **`FamiliaCard` → `FamiliaRow`**: design final é tabela densa (decisão brainstorming), não card grande
- **Atalhos de teclado (J/K/A/R)**: deferidos para M5 (polimento)
- **Validação CSV**: removida (só `.xlsx`); CSV entra no M2 quando parser real chegar
- **Sidebar `/revisao` hardcoded**: aponta para `lote-42` (placeholder até existir conceito de "lote atual")
- **Header da Revisão**: badge `X selecionada(s)` removido; info vive só no footer pra evitar duplicação

---

## 🏁 M2 — Backend core

**Status:** ✅ Completo (2026-05-27) — técnico + bug bash com planilha real
**Duração real:** 1 sessão via Plano 03 (16 tasks Subagent-Driven Development) + correções do bug bash no mesmo dia, vs 2 semanas estimadas
**Bloqueia:** nada — M3 (IA copywriting) liberado

### Objetivo
Sistema aceita upload real de planilha + imagens, persiste no Supabase com schema e RLS corretos, autentica o usuário.

### Critérios de saída
- [x] Schema do banco implementado (4 tabelas + enums + RLS) — [ADR-0007](decisions/0007-modelo-de-dados-4-tabelas.md)
- [x] Supabase Auth funcionando (cadastro + login)
- [x] Upload de planilha e imagens diretos pro Storage
- [x] Edge function `ingest-lote` parseia .xlsx, agrupa por PAI, faz match imagens, persiste no banco
- [x] Detecção CREATE vs UPDATE funciona ([ADR-0005](decisions/0005-lifecycle-publish-and-update.md))
- [x] Tela de Progresso reflete atualizações reais via Realtime + polling fallback
- [x] Lote de teste real importado sem erros — planilha LINHA P/COST.XIK 120 (1 família, 290 variações, 2 imagens)

### Saída entregue
Diego subiu 2 lotes da planilha real, viu 290 variações persistidas corretamente, edita inline com persistência no banco, busca por código de filho funciona, imagens das variações renderizam. 61 testes passando.

### Desvios documentados ao concluir
- **pgsodium removido das migrations** — extensão descontinuada pelo Supabase em 2024; supabase_vault 0.3.1 funciona standalone
- **xlsx@^0.20 → ^0.18.5** — SheetJS moveu versões novas só pro CDN próprio; npm registry só vai até 0.18.5 (mesma API)
- **Migrations `rls_initplan_fix` + `secure_trigger_and_indexes`** — ajustes pós-review (auth.uid() wrap em policies pra cachear no initplan, revoke execute em triggers, drop índices redundantes)
- **TEMP: bypass de assinatura QStash em `process-familia`** — `Receiver.verify()` rejeitava com 401 (provável incompatibilidade entre chaves no Supabase Vault e console Upstash). Restaurar em M3 quando reconfirmar as chaves
- **Correções de UX descobertas no bug bash, aplicadas no mesmo dia:** sidebar Revisão → lote mais recente; exibição de estoque (label + thousand separator); imagens das variações via signed URL; persistência da edição inline com feedback `Salvando…` / `✓ Salvo`; busca achando filho pelo código; polling fallback 2.5s no Progresso (race condition do realtime quando process-familia termina antes da subscription estabilizar)

### Adiado para M3 (decisão do bug bash)
- Upload posterior de imagens em lote existente (drop zone + ícone por variação) — entra natural junto da IA Vision do M3

---

## 🏁 M3 — IA copywriting + Vision

**Status:** ✅ Concluído (2026-05-28, em 1 sessão via Plano 04 — 20 tasks Subagent-Driven Development)
**Duração real:** 1 sessão (~6h corridas) vs 2 semanas estimadas
**Bloqueia:** nada — M4 (Integração ML) liberado

### Objetivo
Sistema gera título, descrição, e infere cor das variações usando OpenAI GPT-4o-mini + Vision via OpenRouter.

### Critérios de saída
- [x] Edge function `process-familia` operacional, com idempotência ([ADR-0006](decisions/0006-qstash-em-vez-de-postgres-queue.md)) — deploy v11 ACTIVE
- [x] Parser de cor da descrição funciona em PT-BR (regex + dicionário, 42 cores canônicas) — 7 testes
- [x] Vision (gpt-4o) identifica cor das variações quando texto não tem — [ADR-0004](decisions/0004-atribuicao-de-cor.md). Prompt v3 conservador (preto vs azul marinho, dúvida → "Outra")
- [x] Prompt do copywriter de aviamentos validado com Diego — 5 ajustes via bug bash; Diego validou "ficou ótimo agora"
- [x] Cache Redis (`cache:cor:*`) funcionando, TTL 90d + invalidação ao editar manualmente
- [x] Tela de Revisão consome dados reais (substitui mocks do M1)
- [x] Edição inline funcional para título, descrição, cor, preço — com flags `*_editado_pelo_operador`
- [x] Upload posterior de imagens (drop zone + ícone câmera) — antecipado do bug bash do M2
- [x] Assinatura QStash restaurada (bypass do M2 removido); signing keys rotacionadas

### Saída entregue
Diego importou lote real de 4 famílias (linhas + fitas) → ~30s depois viu copy gerada na Revisão → iterou prompt 2x → output aprovado. 86 testes passando (61 baseline + 25 novos).

### Desvios documentados ao concluir
- **Dicionário sem acentos** — alguns sinônimos no dicionário deployado vieram sem acentos (`bordo` vs `bordô`, `Lilas` vs `Lilás`). Necessário pra escapar limitação do payload do MCP `deploy_edge_function`. Funciona pra a maioria dos casos (planilha real raramente tem acento nos sinônimos), mas trivial de corrigir depois.
- **Schema M2 já tinha vários campos do M3** — `titulo_ml`, `descricao_ml`, `nome_pai`, `codigo_pai`, `descricao_pai`, e flags `*_editado_pelo_operador` para título/descrição/preço já estavam criados. Migration 0007 ficou reduzida: só adicionou `tokens_input/output/custo_centavos` e `cor_editada_pelo_operador`.
- **MCP qstash_publish_message tem bug de double-encoding** — usado só pra smoke test; produção usa SDK QStash via `enfileirarFamilia` (sem o bug).
- **Vitest config estendido** — `./supabase/functions/**/__tests__/` adicionado ao `include` pra testar funções puras dos shared modules sem montar runtime Deno.
- **Edge functions deployadas via MCP:** process-familia v11, upload-imagens-lote v1, invalidar-cache-cor v1.

---

## 🟢 M3.1 — Foto-capa + polimento UX (2026-05-28)

**Status:** ✅ entregue, em produção.

- Foto-capa por família como `pictures[0]` futuro (drag-drop com prefixo `CAPA_`, thumb no card, botões Trocar/Remover)
- Barra de progresso real no drop em lote (chunks de 5)
- Template novo de descrição com seções emoji (🧵 ✅ 📌 🎯 🎨 📦 🚚) — Process-familia v12
- Botão "Regenerar descrição" por família — Regenerar-copy-familia v1
- Badge `cor_origem` compacto com tooltip
- GTIN/EAN editável por variação
- Spec: `docs/superpowers/specs/2026-05-28-foto-capa-familia-design.md`
- Plano: `docs/superpowers/plans/2026-05-28-plan-05-foto-capa.md`

### Histórico de commits
Commits do M3.1: `bffc775` (spec), `1d81d93` (plano), `d57e10a`, `7f0344e`, `fcb4cca`, `c69d926`, `3dfc479`, `6735f5b`, `48448a2`, `5fe6183`, `47e1ddc`, `b2be2d9`.
Ajustes pós-M3.1: `de1f034`, `b6fd20f`, `f2340a5`, `20c8fdf`, `7b5d2ae`, `8865dad`, `dcf23a1`, `7f40f87`.

---

## 🏁 M4 — Integração Mercado Livre

**Status:** ⬜ Não iniciado
**Duração estimada:** 2 semanas
**Bloqueia:** M5 (precisa publicar antes de polir)
**Dependência crítica:** ✅ app ML Developers já criada (trilho paralelo concluído em 2026-05-27)

### Objetivo
Sistema publica anúncios reais no Mercado Livre, com variações, fotos, atributos e estratégia de preço condicional.

### Critérios de saída
- [x] OAuth Mercado Livre funcional (autorizar + refresh) — bloco OAuth ✅ 2026-05-29 (ADR-0012)
- [x] Tokens criptografados via Supabase Vault — reaproveitado do M2 + `delete_ml_credentials`
- [x] Busca de concorrência funciona (por GTIN via catálogo) — `process-familia` v15 ✅ 2026-06-01 (ADR-0014 + Adendo); bug bash do lote #5 validou ponta a ponta com token real. Ramo título sinaliza baixa confiança sem quantificar.
- [x] Cache Redis (`cache:concorrencia:*`) funcionando — `cache-concorrencia.ts` TTL 6h, chave `gtin:{gtin}`
- [x] Lógica de preço condicional implementada ([ADR-0008](decisions/0008-estrategia-de-preco-condicional.md)) — `process-familia` v16 ✅ 2026-06-01 (função pura TDD + persistência)
- [x] Sinalização visual da estratégia (PRÓPRIO/COMPETITIVO) na tela de revisão — badge + linha "publica:" + detalhe de concorrência + alerta de preço perigoso
- [x] Mapeamento de atributos para categorias ML (Linhas, Botões, Fitas) — `process-familia` v17 ✅ 2026-06-01 (IDs reais validados via API: MLB270273/MLB255054/MLB270272; ADR-0009 Adendo)
- [x] Pré-condição da publicação: edge cases da planilha não-bloqueantes ([ADR-0013](decisions/0013-edge-cases-da-planilha-no-ingest.md)) — `agruparPorPai` retorna `{ grupos, anomalias }` (dedup + coleta de órfãos/PAI-sem-filho), `ingest-lote` persiste `anomalias_planilha`, Progresso exibe descartados ✅ 2026-06-03 (deploy MCP pendente)
- [~] Publicação CREATE funciona (1 anúncio com N variações) — [ADR-0003](decisions/0003-variacoes-agrupadas-por-pai.md) — **implementado** (plano-10, edges `publicar-familias` v1 + `publish-familia-ml` v2, seleção do que publicar na Revisão); **falta bug bash com token real** (GTIN/listing_type/foto)
- [ ] Publicação UPDATE atualiza estoque + preço — [ADR-0005](decisions/0005-lifecycle-publish-and-update.md) — bloco seguinte
- [x] Tratamento de erros ML (4xx persiste / 5xx+429 retenta via QStash / token via refresh proativo) — no worker
- [x] Tela de Relatório mostra links reais para anúncios publicados — `Relatorio.tsx` real (links + erro + tentar de novo)

### Saída esperada
Diego publica 1 família real (5 variações) → anúncio aparece no ML com fotos, descrição, variações e preço corretos.

### Plano de contingência (se app ML não estiver aprovado)
Desenvolver contra **sandbox do ML** (auth e endpoints idênticos, dados de teste); migrar para produção em 1 hora quando aprovação sair.

---

## 🏁 M5 — Polimento e testes

**Status:** ⬜ Não iniciado
**Duração estimada:** 1 semana
**Bloqueia:** M6

### Objetivo
Sistema robusto, com tratamento de edge cases do mundo real.

### Critérios de saída
- [ ] Reprocessar família com erro (1 clique)
- [ ] Substituir foto de variação na tela de revisão
- [ ] Atalhos de teclado funcionais (A/R/J/K/Espaço/Ctrl+A)
- [ ] Filtros na tela de revisão
- [ ] Notificações no browser quando processamento termina
- [ ] Export de relatório em PDF
- [ ] Bug bash dedicado com lote real de 50+ famílias
- [ ] Todos os bugs encontrados no bug bash resolvidos ou explicitamente diferidos para v2

### Saída esperada
Sistema "feature complete" e pronto pra uso real.

---

## 🏁 M6 — Lançamento controlado

**Status:** ⬜ Não iniciado
**Duração estimada:** 1 semana
**Bloqueia:** —

### Objetivo
Operador usa o sistema em produção, com você (Diego) acompanhando os primeiros lotes.

### Critérios de saída
- [ ] Deploy de produção (Render + Supabase) com domínio definitivo
- [ ] Guia rápido do operador (1 página em PDF ou markdown)
- [ ] Treinamento informal: operador faz 1 lote real assistido
- [ ] 3 lotes reais publicados sem incidente bloqueante
- [ ] Custo operacional medido e dentro do orçamento (< $50/mês)

### Saída esperada
Sistema em uso recorrente; operador é autônomo no fluxo principal.

---

## 🚀 Evolução v2 — SaaS multicanal (pós-MVP)

**Status:** 📋 Planejado (documento mestre aprovado 2026-06-13)
**Documento:** [superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md](superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md)

Transformar o PubliAI de ferramenta interna (ML-only, single-operador, aviamentos) em **SaaS
multi-tenant, multi-marketplace, para qualquer produto** — comercializável. Abordagem *strangler fig*
(evoluir in-place, sem big-bang), em 4 fases / 9 épicos:

| Fase | Épicos | Entrega |
|---|---|---|
| **0 — Fundação** | E1 Camada de abstração de canais · E2 Modelo de dados multicanal (`anuncios_externos`) | ML atrás de uma interface; catálogo agnóstico (sem mudança visível) |
| **1 — Qualquer produto** | E3 Taxonomia canônica + categoria por IA · E4 Atributos por IA (closed-set) | Sai do regex por nicho; aceita qualquer segmento |
| **2 — 2º canal** | E5 Conector **Shopee** · E6 Orquestração multicanal · E6b Estoque único cross-canal | Publica em ML + Shopee de uma fonte única, com baixa de estoque sincronizada |
| **3 — Virar SaaS** | E7 Multi-tenancy · E8 Billing (Asaas) + LGPD · E9 Operação SaaS | Multi-cliente, cobrável, escalável |

**Decisões-chave:** strangler in-place (D1) · Shopee como 2º canal (D2) · assinatura por planos + metering
de IA (D3) · IA híbrida + regras por vertical (D4). ADR stubs: 0024 (abstração), 0025 (dados multicanal),
0026 (IA genérica), 0027 (multi-tenancy), 0028 (billing). Cada épico vira seu próprio `spec → plano →
subagent-driven` quando iniciado.

---

## 🚀 Fase 4 — Features complementares do SaaS (pós-fundação)

**Status:** 📋 Proposto (2026-07-05, gerado via `improve` — não substitui E1–E9, constrói em cima deles)
**Documento:** [../plans/direction-features-saas-2026-07-05.md](../plans/direction-features-saas-2026-07-05.md)

Recursos de valor comercial acima da fundação multicanal/multi-tenant. Cada um vira seu próprio
`spec → ADR → plano` quando priorizado; nenhum tem data ou compromisso ainda.

| Épico | Feature | Valor | Esforço |
|---|---|---|---|
| **E10** | Onboarding reverso — importar anúncios já publicados | Aquisição — condição de lançamento comercial | L |
| **E11** | Repricing contínuo com guard-rails (Smart Pricing como serviço) | Diferencial pago (plano Pro/Scale) | M–L |
| **E12** | Saúde do anúncio — Listing Health Score + correção 1-clique por IA | Retenção + upsell | M |
| **E13** | Central de perguntas multicanal com auto-resposta governada | Retenção (reputação do seller) | M |
| **E14** | Copiloto de vendas — insights de IA sobre Financeiro/Faturamento | Retenção + marketing | M |
| **E15** | Estúdio de fotos IA (fundo branco, padronização de capa) | Aquisição (dor universal de PME) | M |
| **E16** | Central de notificações de eventos (Telegram/e-mail) | Quick win de percepção de valor | S–M |

**Sequência recomendada:** E10 (condição de lançamento) e E16 (quick win) primeiro; E11/E12 como
features pagas do plano Pro; E13/E14/E15 conforme tração. Detalhe, evidência e trade-offs de cada
item no documento de direção linkado acima.

---

## Trilho paralelo — App Mercado Livre Developers

**Status:** ✅ Pronto pra M4 (2026-05-27)
**Responsável:** Diego (manual, fora do ambiente de dev)
**Tempo real:** 1 sessão (~15 min) vs "1-4 semanas" temidos
**Observação:** Certificação formal ML não é necessária — uso interno (PubliAI publica nos anúncios da própria Daludi)

### Tarefas
1. ✅ Conta no [Mercado Livre Developers](https://developers.mercadolibre.com.br/) — já existia da operação como vendedor
2. ✅ App criada — `PubliAI` (curto: `publiaidaludi`), Client ID `5907788004648058`
3. ✅ Redirect URI configurada — `https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/ml-oauth-callback` (ver [ADR-0011](decisions/0011-redirect-uri-via-edge-function.md))
4. ✅ `ML_CLIENT_ID` + `ML_CLIENT_SECRET` salvos em `.env.local` (gitignored; vão para Supabase Vault no M4)
5. ⬜ Validar fluxo OAuth com flow real — **acontece naturalmente no M4** quando a Edge Function for implementada
6. ⏭ Submeter app para certificação — **pulado** (uso interno; certificação só é exigida pra integrações de terceiros)
7. ⏭ Aguardar aprovação — N/A
8. ⬜ Confirmar limites de rate — **acontece naturalmente no M4** após primeiros testes de publicação

### Permissões concedidas no portal ML
- **Authorization Code** + **Refresh Token** (OAuth flows)
- **Publicação e sincronização**: leitura e escrita
- **Usuários**: leitura e escrita
- (sem outras permissões — PubliAI não toca em pedidos, envios, faturamento, etc.)

### Pendente para M5/futuro
- Configurar URL de webhook de notificações (campo `URL de retornos de chamada de notificação` no portal — só importante se quisermos detectar edições externas dos anúncios)

---

## Definição objetiva de "MVP entregue"

Repetido do design para enfatizar:

- [ ] Operador faz login + conecta ML do zero
- [ ] Operador importa planilha + imagens sem erro de validação
- [ ] Lote de 50 famílias processado em < 10 min
- [ ] Operador revisa e aprova lote de 50 famílias em < 30 min (≥ 5× ganho vs manual)
- [ ] ≥ 95% das famílias aprovadas publicam com sucesso na primeira tentativa
- [ ] Reprocessar família com erro funciona em 1 clique
- [ ] UPDATE vs CREATE detectados corretamente
- [ ] Relatório final tem links clicáveis pros anúncios
- [ ] Documentação `docs/` atualizada com ADRs de novas decisões
- [ ] Custo operacional < $50/mês

---

## Escopo fora do MVP

Itens explicitamente para versões futuras (vários agora **planejados** na [Evolução v2 — SaaS multicanal](#-evolução-v2--saas-multicanal-pós-mvp)):

- 📋 Outros marketplaces (Shopee, Magalu, Amazon) — **Evolução v2, Fase 2** (E5/E6)
- ❌ Tecidos — v2 ([ADR-0002](decisions/0002-mvp-aviamentos-primeiro.md)); coberto pela generalização por IA (Fase 1)
- ❌ Sincronização contínua sem re-importar planilha — v3
- 📋 Multi-usuário com permissões diferentes — **Evolução v2, Fase 3** (E7 multi-tenancy)
- ❌ Análise de performance pós-publicação (vendas, visualizações)
- ❌ Bot/IA respondendo perguntas no ML
- ❌ Sincronização de estoque em tempo real
- ❌ Tabela "de-para" fornecedor → cor ([ADR-0004](decisions/0004-atribuicao-de-cor.md))
- ❌ Estratégias de preço configuráveis por lote ([ADR-0008](decisions/0008-estrategia-de-preco-condicional.md))
- ❌ Dashboard analítico

---

## Riscos do cronograma

| Risco | Probabilidade | Impacto | Mitigação | Status |
|---|---|---|---|---|
| ~~Aprovação ML > 2 semanas~~ | ~~Média~~ | ~~Alto~~ | App criada em 15 min (2026-05-27); certificação dispensada (uso interno) | ✅ Resolvido |
| Prompt IA exige muitas iterações | Alta | Médio | Iterar com lotes pequenos no M3; benchmark de "ground truth" | Pendente |
| ~~Edge cases da planilha real~~ | ~~Alta~~ | ~~Médio~~ | Bug bash com 290 variações reais feito no fechamento do M2 | ✅ Resolvido |
| Limites de free tier | Baixa | Baixo | Upgrade para Pro tranquilo | Pendente |
| ML rejeita atributos obrigatórios | Alta | Médio | Mapear atributos por categoria no M4 | Pendente |
| Diego sem tempo (outras prioridades) | Média | Alto | Buffer 3-4 semanas; entregas incrementais | Pendente |

---

## Histórico de mudanças deste roadmap

| Data | O quê | Por quê |
|---|---|---|
| 2026-05-26 | Criação inicial após brainstorming | Conclusão das 6 seções do design |
| 2026-05-26 | M0 marcado ✅; estado geral → 🟢 | Plano 01 concluído em 3 sessões: Supabase URL/key + Upstash + Redis via MCP; `@supabase/supabase-js` + `src/lib/supabase.ts` (TDD); Edge Function `hello` deploy via MCP; Render Static Site com auto-deploy. Desvios documentados no card do M0. |
| 2026-05-26 | M1 implementado ✅ (walkthrough pendente) | Plano 02 executado em 1 sessão via Subagent-Driven Development: 14 tasks de código + 1 task de docs. 50 famílias mock, 6 telas em produção, 45 testes passando. Desvios documentados no card do M1. |
| 2026-05-27 | M2 técnico ✅ via Plano 03 (16 tasks Subagent-Driven Development) | Schema (4 tabelas + Vault), auth, upload real, edge functions ingest-lote + process-familia stub, TanStack Query + adapters, Realtime. 59 testes passando. Pendências: secrets QStash no Edge runtime + bug bash com planilha real (depende de ação manual do Diego). Desvios: pgsodium → supabase_vault standalone; xlsx 0.18.5. |
| 2026-05-27 | M2 completo ✅ (bug bash com planilha real no mesmo dia) | Secrets QStash configurados via dashboard, usuário criado, planilha LINHA P/COST.XIK 120 (290 variações) importada com sucesso. Bugs descobertos e corrigidos no mesmo dia: sidebar Revisão hardcoded, exibição estoque/imagens, persistência da edição inline com feedback visual, busca por código de filho, race condition do realtime (polling fallback). 61 testes passando. M3 liberado pra começar. |
| 2026-05-27 | Trilho paralelo ML ✅ | App PubliAI criada no portal ML Developers em ~15 min (vs 1-4 semanas temidas). Client ID `5907788004648058`, fluxos Authorization Code + Refresh Token, permissões "Publicação e sincronização" + "Usuários" (leitura e escrita). Redirect URI aponta para Edge Function `ml-oauth-callback` (a criar em M4) — decisão registrada em ADR-0011. Certificação dispensada (uso interno). M4 sem mais dependências externas. |
| 2026-05-28 | M3 ✅ via Plano 04 (20 tasks Subagent-Driven Development) | Pipeline IA real: parser cor PT-BR (dicionário 42 cores), Vision (gpt-4o) com prompt conservador, Copywriter (gpt-4o-mini) com structured output JSON Schema, cache Redis TTL 90d, custos capturados por família. UI: badges cor_origem, drop zone para upload posterior de imagens, ícone câmera por variação, alerta sem cor. Edge functions deployadas: process-familia v11, upload-imagens-lote v1, invalidar-cache-cor v1. Assinatura QStash restaurada (rotacionada via console Upstash, secrets atualizados no Supabase). Bug bash com 4 famílias reais → 5 ajustes no prompt → Diego aprovou. 86 testes passando. M4 (Integração ML) liberado. |
| 2026-05-28 | M3.1 ✅ (foto-capa + polimento UX, mesmo dia) | 12 tasks subagent-driven: migration `capa_storage_path`, helper `classificarArquivo` (6 testes), upload-imagens-lote v5 (CAPA_), componente FotoCapaFamilia (3 testes), card Trocar/Remover, contadores capas_ok/sem_match. Ajustes adicionais: barra de progresso real em chunks de 5, template de descrição com seções emoji (process-familia v12), botão regenerar por família (regenerar-copy-familia v1), badge cor_origem compacto com tooltip CSS-only, GTIN/EAN editável por variação. 101/101 testes passando. |
| 2026-06-13 | 🚀 Evolução v2 — SaaS multicanal **planejada** | Documento mestre aprovado: north-star + arquitetura-alvo (3 camadas: produto canônico → listing por canal → conector) + roadmap de 4 fases / 9 épicos (strangler fig), embasado em pesquisa multi-agente de fundações. 4 decisões estratégicas travadas (in-place, Shopee, planos+metering, IA híbrida). 5 ADR stubs criados (0024–0028). Spec: `superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md`. |
