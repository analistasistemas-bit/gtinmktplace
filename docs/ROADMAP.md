# PubliAI — Roadmap

> Documento vivo. Reflete a visão estratégica das fases do projeto. Para checklist operacional do dia a dia, ver [TASKS.md](TASKS.md).

**Última atualização:** 2026-05-27 (M2 técnico concluído via Plano 03)
**Estado geral:** 🟢 M2 técnico concluído (2026-05-27); secrets QStash + bug bash pendentes; pronto pra iniciar M3 em paralelo

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
- [x] Render conectado ao repo — Static Site `srv-d8at8arbc2fs73e5qcb0` em `https://publiai-frontend.onrender.com`, auto-deploy ativo
- [x] Upstash QStash + Redis criados via MCP — `mktplace-redis` (us-east-1) + QStash (eu-central-1)
- [x] Chave de IA provisionada — `OPENROUTER_API_KEY` (não OpenAI direto, ver ADR-0010)
- [ ] App Mercado Livre Developers **criado** — *trilho paralelo, Diego inicia separadamente*
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
Site navegável em produção (https://publiai-frontend.onrender.com) com tema Nova/neutral, 50 famílias mockadas no Lote #42, 45 testes passando.

### Desvios do plano original
- **Tema Slate/Zinc → Nova/neutral**: mantido do M0 por pragmatismo
- **`FamiliaCard` → `FamiliaRow`**: design final é tabela densa (decisão brainstorming), não card grande
- **Atalhos de teclado (J/K/A/R)**: deferidos para M5 (polimento)
- **Validação CSV**: removida (só `.xlsx`); CSV entra no M2 quando parser real chegar
- **Sidebar `/revisao` hardcoded**: aponta para `lote-42` (placeholder até existir conceito de "lote atual")
- **Header da Revisão**: badge `X selecionada(s)` removido; info vive só no footer pra evitar duplicação

---

## 🏁 M2 — Backend core

**Status:** 🟡 Concluído tecnicamente (2026-05-27); validação ponta-a-ponta com planilha real pendente (depende de secrets do Diego)
**Duração real:** 1 sessão via Plano 03 (16 tasks Subagent-Driven Development) vs 2 semanas estimadas
**Bloqueia:** M4 publicação real (M3 IA copywriting pode rodar em paralelo)

### Objetivo
Sistema aceita upload real de planilha + imagens, persiste no Supabase com schema e RLS corretos, autentica o usuário.

### Critérios de saída
- [x] Schema do banco implementado (4 tabelas + enums + RLS) — [ADR-0007](decisions/0007-modelo-de-dados-4-tabelas.md)
- [x] Supabase Auth funcionando (cadastro + login)
- [x] Upload de planilha e imagens diretos pro Storage
- [x] Edge function `ingest-lote` parseia .xlsx, agrupa por PAI, faz match imagens, persiste no banco
- [x] Detecção CREATE vs UPDATE funciona ([ADR-0005](decisions/0005-lifecycle-publish-and-update.md))
- [x] Tela de Progresso reflete atualizações reais via Realtime
- [ ] Lote de teste real (planilha do Diego) é importado sem erros — *bloqueado por secrets do Edge runtime*

### Saída esperada
Diego sobe planilha real → vê famílias e variações corretas no banco → tela mostra progresso ao vivo.

### Desvios documentados ao concluir
- **pgsodium removido das migrations** — extensão descontinuada pelo Supabase em 2024; supabase_vault 0.3.1 funciona standalone
- **xlsx@^0.20 → ^0.18.5** — SheetJS moveu versões novas só pro CDN próprio; npm registry só vai até 0.18.5 (mesma API)
- **Migrations `rls_initplan_fix` + `secure_trigger_and_indexes`** — ajustes pós-review (auth.uid() wrap em policies pra cachear no initplan, revoke execute em triggers, drop índices redundantes)

### Pendências do operador para validação ponta-a-ponta
1. `supabase login` + `supabase secrets set` para QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, OPENROUTER_API_KEY (todas estão em `.env.local`)
2. Criar 1 usuário via tela de cadastro (https://publiai-frontend.onrender.com/#/cadastro) + confirmar e-mail
3. Bug bash com planilha real (5-15 famílias, 30-80 variações)

---

## 🏁 M3 — IA copywriting + Vision

**Status:** ⬜ Não iniciado
**Duração estimada:** 2 semanas
**Bloqueia:** M4 (precisa de copy gerada pra publicar)

### Objetivo
Sistema gera título, descrição, atributos e infere cor das variações usando OpenAI GPT-4o-mini + Vision.

### Critérios de saída
- [ ] Edge function `process-familia` operacional, com idempotência ([ADR-0006](decisions/0006-qstash-em-vez-de-postgres-queue.md))
- [ ] Parser de cor da descrição funciona em PT-BR (regex + dicionário)
- [ ] Vision identifica cor das variações quando texto não tem (>90% precisão em testes) — [ADR-0004](decisions/0004-atribuicao-de-cor.md)
- [ ] Prompt do copywriter de aviamentos validado com Diego em 10 famílias reais
- [ ] Cache Redis (`cache:cor:*`) funcionando
- [ ] Tela de Revisão consome dados reais (substitui mocks do M1)
- [ ] Edição inline funcional para título, descrição, cor, preço

### Saída esperada
Diego importa lote de 5 famílias → 5 minutos depois vê copy gerada na tela de revisão → consegue editar inline e flag de "editado pelo operador" é registrada.

---

## 🏁 M4 — Integração Mercado Livre

**Status:** ⬜ Não iniciado
**Duração estimada:** 2 semanas
**Bloqueia:** M5 (precisa publicar antes de polir)
**Dependência crítica:** app ML Developers aprovado (trilho paralelo)

### Objetivo
Sistema publica anúncios reais no Mercado Livre, com variações, fotos, atributos e estratégia de preço condicional.

### Critérios de saída
- [ ] OAuth Mercado Livre funcional (autorizar + refresh)
- [ ] Tokens criptografados via Supabase Vault
- [ ] Busca de concorrência funciona (por GTIN e por título)
- [ ] Cache Redis (`cache:concorrencia:*`) funcionando
- [ ] Lógica de preço condicional implementada ([ADR-0008](decisions/0008-estrategia-de-preco-condicional.md))
- [ ] Sinalização visual da estratégia (PRÓPRIO/COMPETITIVO) na tela de revisão
- [ ] Mapeamento de atributos para categorias ML (Linhas, Botões, Fitas)
- [ ] Publicação CREATE funciona (1 anúncio com N variações) — [ADR-0003](decisions/0003-variacoes-agrupadas-por-pai.md)
- [ ] Publicação UPDATE atualiza estoque + preço — [ADR-0005](decisions/0005-lifecycle-publish-and-update.md)
- [ ] Tratamento de erros ML (4xx, 5xx, rate limit, token expirado)
- [ ] Tela de Relatório mostra links reais para anúncios publicados

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

## Trilho paralelo — Aprovação do app Mercado Livre

**Status:** ⬜ Não iniciado
**Responsável:** Diego (manual, fora do ambiente de dev)
**Quando iniciar:** **imediatamente** (esta semana)
**Quando finalizar:** antes do início do M4 (semana 6)

### Tarefas (sequenciais)
1. ⬜ Criar conta no [Mercado Livre Developers](https://developers.mercadolibre.com.br/)
2. ⬜ Criar app com nome "PubliAI" e descrição
3. ⬜ Configurar redirect URI (provisório: `http://localhost:5173/ml-callback`; depois: URL do Render)
4. ⬜ Anotar `client_id` e `client_secret` em local seguro
5. ⬜ Validar fluxo OAuth em sandbox (após M0)
6. ⬜ Submeter app para aprovação em produção
7. ⬜ Aguardar aprovação (pode levar de dias a semanas)
8. ⬜ Confirmar que limites de rate estão adequados

### Riscos
- Aprovação pode ser lenta — começar cedo
- Categoria do app pode exigir documentação extra (CNPJ, comprovante de vendedor)
- Mudanças de política da Meli durante o processo

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

Itens explicitamente para versões futuras:

- ❌ Outros marketplaces (Shopee, Magalu, Amazon) — v2
- ❌ Tecidos — v2 ([ADR-0002](decisions/0002-mvp-aviamentos-primeiro.md))
- ❌ Sincronização contínua sem re-importar planilha — v3
- ❌ Multi-usuário com permissões diferentes — v3
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
| Aprovação ML > 2 semanas | Média | Alto | Começar trilho paralelo HOJE; dev em sandbox até liberar | Pendente |
| Prompt IA exige muitas iterações | Alta | Médio | Iterar com lotes pequenos no M3; benchmark de "ground truth" | Pendente |
| Edge cases da planilha real | Alta | Médio | Bug bash dedicado no fim do M2 | Pendente |
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
