# EAN2Marketplace — Tasks

> Checklist operacional. Atualize o status conforme as tarefas avançam. Para visão estratégica das fases, ver [ROADMAP.md](ROADMAP.md).

**Última atualização:** 2026-05-26 (terceira sessão — M0 concluído via Plano 01)
**Próximo passo recomendado:** iniciar **Plano 02 (UI Mockup — M1)**. Backend e infra prontos; agora começa a UI das 6 telas (Dashboard, Novo Lote, Progresso, Revisão, Relatório, Configurações) com dados mockados.

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
| M1 — UI mockup com dados fake | ⬜ |
| M2 — Backend core | ⬜ |
| M3 — IA copywriting + Vision | ⬜ |
| M4 — Integração Mercado Livre | ⬜ |
| M5 — Polimento e testes | ⬜ |
| M6 — Lançamento | ⬜ |
| Trilho paralelo: app ML Developers | ⬜ |

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
- [ ] Escrita do design doc consolidado em `docs/superpowers/specs/2026-05-26-ean2marketplace-design.md`
- [ ] Revisão crítica do design doc (Diego ou agente revisor)
- [ ] Escrita do plano de implementação detalhado (`writing-plans`)

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
- [ ] Provisionar `OPENROUTER_API_KEY` + `UPSTASH_*` + `QSTASH_TOKEN` como Supabase secrets (`supabase secrets set ...`) — *adiar até o primeiro Edge Function que precise (M2/M3); placeholder Edge `hello` não precisa*

### Trilho paralelo: Mercado Livre Developers

- [ ] Acessar [Mercado Livre Developers](https://developers.mercadolibre.com.br/) — `~15 min`
- [ ] Criar app "EAN2Marketplace" — `~30 min`
- [ ] Configurar redirect URI provisório (`http://localhost:5173/ml-callback`) — `~15 min`
- [ ] Anotar `client_id` e `client_secret` em local seguro (1Password ou similar) — `~10 min`
- [ ] Submeter app para aprovação — `~30 min`
- [ ] ⏸️ Aguardar aprovação (1-4 semanas) — *bloqueia M4 produção, mas sandbox funciona desde já*

### Setup do projeto frontend

- [x] Criar projeto Vite + React + TypeScript (`pnpm create vite`) — *Plano 01 Task 4 (sessão 1)*
- [x] Instalar Tailwind + setup conforme docs do Tailwind 4 — *commit `e103dc3`; Tailwind 4 CSS-only via `@import` + `@theme`*
- [x] Instalar shadcn/ui via CLI e inicializar — *commit `e103dc3`; preset Nova/neutral em vez de Slate (4.8 mudou default)*
- [ ] Adicionar componentes shadcn iniciais (Button, Card, Badge, Dialog, Input, Sheet, Table) — *só Button feito; resto sob demanda no M1*
- [ ] Instalar TanStack Query, Zustand — *react-router-dom já instalado; TanStack/Zustand quando precisar no M1/M2*
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

- [ ] Layout geral com sidebar + topbar + tema shadcn (Slate ou Zinc) — `~4h`
- [ ] Criar mock data em `src/lib/mocks/` (lotes, famílias, variações realistas) — `~2h`
- [ ] Criar rota wrapper de autenticação simulada — `~1h`

### Tela Dashboard (lista de lotes)

- [ ] Componente `LoteCard` (status, contadores, ações) — `~2h`
- [ ] Lista de lotes consumindo mock — `~1h`
- [ ] Botão "Novo lote" navegando — `~30 min`

### Tela Novo Lote (upload)

- [ ] Componente `Dropzone` para planilha + imagens (react-dropzone) — `~3h`
- [ ] Validação de tipo de arquivo (`.xlsx`/`.csv` e `.jpg`/`.jpeg`/`.png`) — `~1h`
- [ ] Preview de quantidade de arquivos — `~1h`
- [ ] Botão "Processar" navegando para tela de progresso — `~30 min`

### Tela Progresso

- [ ] Layout de etapas com checkpoints visuais — `~2h`
- [ ] Barra de progresso geral — `~30 min`
- [ ] Resumo do lote (mockado) — `~1h`
- [ ] Simulação de progresso via timeout (avança a cada 2s) — `~1h`

### Tela Revisão em Lote (a mais complexa)

- [ ] Componente `FamiliaCard` expansível (collapsed por padrão) — `~4h`
- [ ] Cabeçalho do card: badge CREATE/UPDATE, nome, foto capa, copy preview — `~3h`
- [ ] Visualização da estratégia de preço (PRÓPRIO/COMPETITIVO com motivo) — `~2h`
- [ ] Visualização de concorrência (níveis com cores) — `~1h`
- [ ] Expansão para mostrar variações (tabela densa) — `~3h`
- [ ] Edição inline de título, descrição, cor, preço (com `<Input>` controlado) — `~4h`
- [ ] Seleção em massa (checkbox por família + "Selecionar tudo") — `~2h`
- [ ] Ações em massa (Aprovar/Rejeitar selecionadas) — `~2h`
- [ ] Filtros (dropdown: CREATE/UPDATE, concorrência, avisos) — `~2h`
- [ ] Busca por código ou nome — `~1h`
- [ ] Atalhos de teclado (J/K/A/R/Espaço) — `~2h`
- [ ] Footer com contadores e botão "Publicar aprovadas" — `~1h`

### Tela Relatório Final

- [ ] Cards de resumo (publicados, com erro) — `~1h`
- [ ] Lista de famílias com link clicável simulado — `~2h`
- [ ] Botão "Editar e tentar de novo" para erros — `~1h`
- [ ] Botão "Exportar PDF" (placeholder, implementa em M5) — `~30 min`

### Tela Configurações

- [ ] Seção de conexão ML (estado mockado "Conectado") — `~1h`
- [ ] Seção de estratégia de preço (radio buttons informacionais) — `~1h`
- [ ] Seção de categorias padrão — `~1h`

### Validação com Diego

- [ ] Deploy de mockup em URL pública (Render) — `~30 min`
- [ ] Walkthrough ao vivo: Diego percorre todas as telas — `~1h`
- [ ] Lista de ajustes identificados na validação (acrescenta em TASKS) — *variável*

---

## 🏁 M2 — Backend core

### Schema do banco

- [ ] Criar migration inicial com enums (status, operacao, cor_origem, estrategia_preco) — `~2h`
- [ ] Criar tabelas `lotes`, `familias`, `variacoes`, `ml_credentials` — `~3h`
- [ ] Criar políticas RLS por user_id em todas as tabelas — `~2h`
- [ ] Configurar Supabase Vault para tokens criptografados — `~1h`
- [ ] Gerar tipos TypeScript do schema (`supabase gen types`) — `~30 min`
- [ ] Validar políticas RLS com testes manuais — `~2h`

### Autenticação

- [ ] Tela de Login (email/senha) com Supabase Auth — `~3h`
- [ ] Tela de Cadastro (email/senha) — `~2h`
- [ ] Tela de Reset de senha — `~2h`
- [ ] Middleware de rota protegida — `~1h`
- [ ] Hook `useAuth` com Zustand — `~1h`

### Storage

- [ ] Criar bucket `imagens` privado no Supabase Storage — `~30 min`
- [ ] Políticas RLS de Storage por user_id — `~1h`
- [ ] Função helper para upload com retry — `~2h`
- [ ] Função helper para gerar signed URL — `~30 min`

### Upload direto do frontend

- [ ] Upload de planilha + imagens diretos pro Storage (chunks paralelos) — `~4h`
- [ ] Barra de progresso real (não simulada) — `~2h`
- [ ] Tratamento de erros de upload (rede, tamanho, tipo) — `~2h`

### Edge function `ingest-lote`

- [ ] Setup base da edge function + tipos compartilhados — `~1h`
- [ ] Parse de .xlsx usando SheetJS — `~2h`
- [ ] Validação de colunas obrigatórias — `~2h`
- [ ] Agrupamento por PAI (detecção do PAI=0) — `~2h`
- [ ] Match de imagens por nome de arquivo (`00CODIGO.jpeg`) — `~2h`
- [ ] Detecção de famílias já publicadas (query em `familias.ml_item_id`) — `~2h`
- [ ] Persistência em `lotes` + `familias` + `variacoes` — `~3h`
- [ ] Enfileiramento de jobs no QStash (via lib `lib/queue.ts`) — `~2h`
- [ ] Retorno de `lote_id` para o frontend — `~30 min`
- [ ] Tratamento de erros: planilha inválida, imagens órfãs, etc. — `~3h`

### Realtime no frontend

- [ ] Hook `useLoteRealtime(loteId)` com Supabase channels — `~3h`
- [ ] Atualização ao vivo da tela de Progresso — `~2h`
- [ ] Reconexão automática se canal cai — `~1h`

### Bug bash do M2

- [ ] Importar planilha real do Diego (exportada do sistema interno) — `~30 min`
- [ ] Identificar edge cases e fixar — *variável*
- [ ] Atualizar TASKS.md marcando M2 como completo

---

## 🏁 M3 — IA copywriting + Vision

### Edge function `process-familia`

- [ ] Esqueleto da edge function com idempotência (UPDATE atômico) — `~2h`
- [ ] Configurar QStash para chamar `process-familia` — `~1h`
- [ ] Validar idempotência com dispatch duplicado intencional — `~1h`

### OpenAI client + helpers

- [ ] Setup do OpenAI SDK na edge function — `~1h`
- [ ] Error handling (rate limit, timeout, payload inválido) — `~2h`
- [ ] Retry com backoff em erros transientes — `~1h`

### Atribuição de cor

- [ ] Função `extrairCorDoTexto(texto)` com regex + dicionário PT-BR — `~3h`
- [ ] Dicionário de cores comuns para aviamentos (Preto, Branco, Vermelho, Azul Royal, Verde Bandeira, Cru, Bege, Neon, etc.) — `~2h`
- [ ] Chamada de Vision para fallback — `~2h`
- [ ] Prompt de Vision iterado e validado em 20 imagens reais — `~3h`
- [ ] Cache `cache:cor:{codigo}` no Upstash Redis (TTL 30d) — `~2h`
- [ ] Salvar `cor_origem` (descricao/vision) na variação — `~1h`

### Geração de copy

- [ ] Prompt base do copywriter de aviamentos (rascunho v1) — `~2h`
- [ ] Validação com 5 famílias reais — `~3h`
- [ ] Iteração do prompt baseado em feedback do Diego — *variável (provavelmente 1-2 ciclos)*
- [ ] Função `callOpenAICopywriter(familia, variacoes)` retornando JSON estruturado — `~3h`
- [ ] Parser do JSON com fallback de erro — `~1h`

### Tela de Revisão consome dados reais

- [ ] Substituir mocks por hooks `useFamiliaList(loteId)` consumindo banco — `~3h`
- [ ] Realtime update da tela conforme famílias ficam ready — `~2h`
- [ ] Edição inline persistindo no banco — `~3h`
- [ ] Flags `editado_pelo_operador` marcadas corretamente — `~1h`

### Bug bash do M3

- [ ] Lote real com 10+ famílias processado completamente — `~30 min`
- [ ] Diego revisa qualidade da IA e indica ajustes — *variável*
- [ ] Atualizar TASKS.md marcando M3 como completo

---

## 🏁 M4 — Integração Mercado Livre

### OAuth Mercado Livre

- [ ] Tela "Conectar Mercado Livre" em Configurações — `~2h`
- [ ] Botão que abre URL de autorização (com state CSRF) — `~1h`
- [ ] Página de callback (`/ml-callback`) — `~1h`
- [ ] Edge function `ml-oauth-callback` (troca code por tokens) — `~3h`
- [ ] Criptografia dos tokens via Supabase Vault — `~2h`
- [ ] Edge function helper `ml-token-refresh` (refresh proativo) — `~3h`
- [ ] Validação manual do fluxo OAuth de ponta a ponta — `~1h`

### Busca de concorrência

- [ ] Função `buscarConcorrenciaPorGTIN(gtin)` — `~2h`
- [ ] Função `buscarConcorrenciaPorTitulo(titulo)` (fallback) — `~2h`
- [ ] Classificação (sem/moderada/alta) — `~1h`
- [ ] Cache `cache:concorrencia:{gtin}` no Redis (TTL 6h) — `~2h`
- [ ] Integração na edge function `process-familia` — `~1h`

### Estratégia de preço condicional

- [ ] Função `calcularPrecoSugerido({preco_planilha, concorrencia})` conforme ADR-0008 — `~2h`
- [ ] Persistência dos campos `estrategia_preco`, `estrategia_motivo` em `familias` — `~1h`
- [ ] Sinalização visual na tela de revisão (badge PRÓPRIO/COMPETITIVO) — `~2h`

### Mapeamento de categorias e atributos

- [ ] Mapear categoria ML para Linhas de Costura (MLB1132) — `~2h`
- [ ] Mapear categoria ML para Botões (MLB1430 ou similar) — `~2h`
- [ ] Mapear categoria ML para Fitas (MLB1429 ou similar) — `~2h`
- [ ] Mapear atributos obrigatórios por categoria — `~3h`
- [ ] Função `montarAtributosML(familia, categoria)` — `~3h`
- [ ] Validação de campos obrigatórios antes de publicar — `~2h`

### Publicação CREATE

- [ ] Edge function `publish-familia-ml` (esqueleto) — `~2h`
- [ ] Configurar QStash para chamar publish — `~1h`
- [ ] Montar payload com variações nativas — `~4h`
- [ ] Upload das fotos para o ML (URLs públicas signed do Storage) — `~3h`
- [ ] POST `/items` com tratamento de resposta — `~2h`
- [ ] Salvar `ml_item_id`, `ml_permalink`, `ml_variation_id`s — `~2h`
- [ ] Tratamento de erros 4xx vs 5xx (retry vs fail) — `~3h`

### Publicação UPDATE

- [ ] Montar payload de atualização (variações com estoque/preço novos) — `~3h`
- [ ] PUT `/items/{ml_item_id}` — `~2h`
- [ ] Verificar se UPDATE detecta variações novas ou removidas — `~2h`
- [ ] Atualizar `publicado_em` no banco — `~30 min`

### Tela de Relatório Final

- [ ] Consumir dados reais (sucesso/erro por família) — `~2h`
- [ ] Links clicáveis para anúncios publicados — `~1h`
- [ ] Botão "Editar e tentar de novo" para erros — `~3h`
- [ ] Custo de IA somado do lote — `~2h`

### Bug bash do M4

- [ ] Publicar 5 famílias reais (1 com erro proposital pra validar fluxo) — `~1h`
- [ ] Validar fluxo UPDATE em uma família já publicada — `~1h`
- [ ] Atualizar TASKS.md marcando M4 como completo

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

## Backlog (v2 e além)

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
- [ ] **OAuth refresh com lock no Redis** — duas Edge Functions chamando refresh em paralelo invalidam token uma da outra (ML invalida refresh_token antigo após uso). Implementar lock via `SET NX` no Upstash Redis com TTL. Documentar em novo ADR (ADR-0010) antes de implementar a função `getValidAccessToken`.
- [ ] **Alerta visual de preço perigoso** — se o preço sugerido pela estratégia COMPETITIVO ficar abaixo de 20% do preço da planilha, exibir badge vermelho "⚠ ATENÇÃO: preço X% abaixo do seu preço" na tela de revisão. Não bloqueia publicação, só sinaliza. Aditar [ADR-0008](decisions/0008-estrategia-de-preco-condicional.md).
- [ ] **Reavaliar duração de M4 para 3 semanas** — escopo real (~20 tarefas substanciais) parece pedir 3 semanas. Decidir ao iniciar M4: ou estender M4, ou mover busca de concorrência + estratégia de preço para M3 (são independentes do OAuth).

### 🟡 Tratar durante M2 (parsing de planilha) e M4

- [ ] **Edge cases da planilha** — CODIGO duplicado, filho com PAI inexistente no lote, PAI sem nenhum filho. Definir regras claras (rejeitar ou warn) antes de implementar `ingest-lote`.
- [ ] **Signed URL com TTL longo para foto no ML** — API ML faz download assíncrono; signed URL precisa de TTL > tempo de processamento ML (≥1h) ou usar upload direto via `POST /pictures`.
- [ ] **Critérios de classificação de concorrência** — definir explicitamente: sem=0 vendedores com mesmo GTIN; moderada=1-5; alta=6+. Documentar como regra na implementação de `buscarConcorrencia`.
- [ ] **Invalidar cache de cor** — quando operador corrigir cor manualmente, deletar `cache:cor:{codigo}` do Redis.

### 🟢 Lembretes pequenos

- [ ] **CORS** — frontend em Render chamando Edge Functions Supabase precisa de CORS configurado. Lembrete em M2.
- [ ] **Zustand vs TanStack Query** — esclarecer divisão na primeira semana de código: Zustand para UI state (filtros, seleção); TanStack Query para server state.

---

## Notas livres

Espaço para observações, decisões pendentes pequenas, ideias durante a implementação:

> _(adicione aqui conforme o projeto avança — exemplos: "operador prefere foto na esquerda", "categoria de fitas precisa de atributo X", etc.)_
