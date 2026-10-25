# Extensão PubliAI — login próprio, ligar/desligar e ícone no cabeçalho — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a extensão funciona sem o PubliAI web aberto: login próprio (e-mail/senha no painel lateral), logada até "Sair",
chave "Extensão ativa" e ícone do PubliAI com menu no cabeçalho do Mercado Livre.

**Architecture:** o service worker vira dono de uma sessão Supabase própria (credenciais em `chrome.storage.local`
restrito a contextos confiáveis, renovação serializada sob demanda). A edge `extensao` ganha o protocolo 2 (envelope
`{ identidade, dados }`, `identidadeEsperada` validada antes de executar, ação `sessao`, erro `sem_acesso`) sem mudar o
contrato da 0.2.1. Content scripts obedecem a uma preferência "ativa" recebida do SW; um content script novo injeta o
ícone/menu no cabeçalho.

**Tech Stack:** Chrome MV3 (TypeScript, React 18, Vite, vitest + jsdom), Supabase Auth REST (`/auth/v1/token`,
`/auth/v1/logout`), Edge Function Deno (`supabase/functions/extensao`), app React (`src/`).

**Spec:** `docs/superpowers/specs/2026-10-24-extensao-login-e-cabecalho-design.md` (ler inteiro, inclusive "Requisitos da
revisão Codex"). Contexto: `docs/decisions/0189-extensao-publiai-navegador.md`.

## Global Constraints

- Nenhuma permissão nova no manifest (`sidePanel`, `storage`, `alarms`, `https://*.mercadolivre.com.br/*` bastam).
- Senha nunca persistida; credenciais só no SW, em `chrome.storage.local` com `setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`
  chamado no boot do SW antes de qualquer gravação.
- Sair = `POST {SUPABASE_URL}/auth/v1/logout?scope=local`; limpeza local imediata, sem esperar a rede.
- Identidade = `` `${userId}:${orgId}:${support?.requestId ?? ''}` `` (mesmo formato da ponte atual).
- Protocolo 2 só quando o corpo traz `protocolo: 2`; sem isso a edge responde exatamente como hoje (0.2.1).
- Edge: ação `sessao` não consome a cota de 30/min nem registra uso.
- Senha digitada só no painel lateral (página da extensão), nunca na página do ML.
- Ícone só em `www.`, `lista.` e `produto.mercadolivre.com.br`, fora de `/checkout*`, `/gz/*`, `/jms/*`, `/captcha/*`.
- Textos visíveis em pt-BR; dropdown/select não se aplica (painel usa os componentes próprios da extensão).
- Versão final da extensão: `0.3.0`.

## Review Focus

1. **Duas abas/painel disparando chamadas com o token perto de vencer** → uma única renovação; as duas chamadas usam o
   par novo. (teste em Task 3)
2. **Supabase fora do ar (rede/5xx/429) durante a renovação** → continua logado; a chamada falha com `interno`, a próxima
   tenta de novo. (teste em Task 3)
3. **Sessão de suporte começa enquanto o painel mostra a org A e o operador clica "Trocar SKU"** → nada é removido; a
   extensão mostra a org nova. (teste em Task 2 e Task 4)
4. **Desligar com análise em voo e religar sem recarregar** → nenhum selo aparece desligado; ao religar o selo volta.
   (teste em Task 6)
5. **Cabeçalho do ML sem o ponto de encaixe (layout mudou / página de bloqueio)** → nada é injetado, sem erro visível,
   painel continua com entrar/sair/ativa. (teste em Task 8)

---

### Task 1: Emenda da ADR-0189

**Files:**
- Modify: `docs/decisions/0189-extensao-publiai-navegador.md` (nova seção no fim + status)
- Modify: `docs/decisions/README.md` (linha da 0189, se listar emendas)

- [ ] **Step 1:** Acrescentar "## Emenda 2026-10-24 — login próprio, ligar/desligar e ícone no cabeçalho (D-4, D-14,
  D-16, D-18, D-19)" resumindo o design: D-4 (sessão própria do SW, credenciais em storage.local TRUSTED_CONTEXTS, renovação
  serializada, Sair `scope=local`, geração), D-14 (`externally_connectable` só para `publiai:ping`; ícone em `www/lista/produto`),
  D-16 (ícone/menu no cabeçalho, sem dado financeiro no menu, degradação para o painel), D-18 (`identidade_mudou`,
  `sem_acesso`, protocolo 2), D-19 (`sessao` não conta como análise). Citar a revisão Codex de 24/10 (REVISE, 10 achados
  incorporados) e as verificações de `auth.sessions`.
- [ ] **Step 2: Commit** — `docs(extensao): emenda ADR-0189 — login próprio, ligar/desligar e ícone no cabeçalho` (inclui o spec).

### Task 2: Edge `extensao` — protocolo 2, identidade e ação `sessao`

**Files:**
- Modify: `supabase/functions/extensao/roteamento.ts` (`Pedido`, `validarPedido`)
- Modify: `supabase/functions/extensao/index.ts` (handler `Deno.serve`, `executar`)
- Modify: `supabase/functions/_shared/extensao/erros.ts` (`CodigoErro`, `normalizarErro`)
- Test: `supabase/functions/extensao/__tests__/index.test.ts`, `supabase/functions/extensao/__tests__/roteamento.test.ts`,
  `supabase/functions/_shared/extensao/__tests__/erros.test.ts`

**Interfaces:**
- Produces (contrato do protocolo 2, usado pela Task 4):
  - Entrada: corpo atual + `protocolo?: 2` + `identidadeEsperada?: string`.
  - Sucesso: `200 { identidade: string, dados: <corpo atual> }`.
  - Erro após autenticação: `{ erro: CodigoErro, identidade: string, mensagem? }`; antes da autenticação (401): corpo atual, sem identidade.
  - `CodigoErro` ganha `'identidade_mudou' | 'sem_acesso'`.
  - Ação `{ acao: 'sessao' }` → `dados: { nome: string | null, email: string | null, orgNome: string | null }`.

- [ ] **Step 1: Testes que falham** em `index.test.ts`:
  - `protocolo 2: sucesso vem em { identidade, dados }` (identidade = `user:org:` sem suporte; `user:org:req` com suporte).
  - `sem protocolo: corpo idêntico ao atual` (snapshot de uma resposta `analisar_anuncio`).
  - `identidadeEsperada divergente → 409 { erro: 'identidade_mudou', identidade } e nada executado` (spy em
    `extensao_vinculos.delete` não chamado para `remover_vinculo`).
  - `sessao: devolve nome/email de profiles e orgNome de organizations da org efetiva; não incrementa a cota nem chama extensao_registrar_uso`.
  - `módulo desligado com protocolo 2 → { erro: 'modulo_desligado', identidade }`.
  - Em `erros.test.ts`: `403 de requireUserOrg sem x-motivo → sem_acesso`.
- [ ] **Step 2:** `cd supabase/functions && deno test --allow-all extensao/ _shared/extensao/` → FAIL nos novos.
- [ ] **Step 3: Implementar.** Ordem no handler: `requireUserOrg` → montar identidade → se `protocolo === 2` e
  `identidadeEsperada` presente e diferente → `ErroExtensao('identidade_mudou', 409)` → módulo → `validarPedido` → executar.
  Envelope aplicado no `json(...)` final e no `catch` (só quando a identidade já é conhecida e `protocolo === 2`). `sessao`
  lê `profiles(nome, email)` por `userId` e `organizations(nome)` por `orgId` com o adminClient, sem cota.
  `validarPedido` aceita `sessao` e ignora `protocolo`/`identidadeEsperada` (validados à parte: `identidadeEsperada` casa
  `/^[\w-]{1,64}:[\w-]{0,64}:[\w-]{0,64}$/`, senão `payload_invalido`).
- [ ] **Step 4:** testes passam; `deno lint --config supabase/functions/deno.json supabase/functions/extensao supabase/functions/_shared/extensao`.
- [ ] **Step 5: Commit** — `feat(extensao-edge): protocolo 2 com identidade, ação sessao e sem_acesso`.

### Task 3: Credenciais próprias no SW (login, renovação, sair)

**Files:**
- Create: `extensao/src/credenciais.ts`
- Modify: `extensao/src/sessao.ts` (passa a ler de `credenciais.ts`; remove o caminho `publiai:sessao`/`publiai:desconectar` como fonte)
- Modify: `extensao/src/sw.ts` (boot: `setAccessLevel` antes de tudo)
- Test: `extensao/src/__tests__/credenciais.test.ts`, ajustar `extensao/src/__tests__/sessao.test.ts`, `extensao/src/__tests__/chrome-falso.ts` (storage.local + setAccessLevel)

**Interfaces:**
- Produces:
  - `interface Credenciais { accessToken: string; refreshToken: string; expiresAt: number /* s */; userId: string }`
  - `entrar(email: string, senha: string): Promise<{ ok: true } | { ok: false; erro: 'credenciais_invalidas' | 'rede' }>`
  - `tokenValido(): Promise<{ accessToken: string } | null>` — renova se faltam ≤ 30 s; null = deslogado.
  - `sair(): Promise<void>` — limpeza local imediata + logout `scope=local` sem aguardar.
  - `estaLogado(): Promise<boolean>`
  - `sessao.ts` mantém `obterSessaoValida()`, `identidadeAtual()`, `seAindaIdentidade()`, `limparSessao()` com a mesma
    assinatura; a identidade passa a vir de `definirIdentidade(identidade, perfil)` (chamada pela Task 4 após `sessao`).
  - `perfilAtual(): Promise<{ nome: string | null; email: string | null; orgNome: string | null } | null>`

- [ ] **Step 1: Testes que falham** (`credenciais.test.ts`, fetch falso):
  - `entrar grava o par num único set e nunca grava a senha` (inspeciona `storage.local`).
  - `entrar com 400 invalid_grant → credenciais_invalidas, nada gravado`.
  - `tokenValido com token vencendo: duas chamadas simultâneas → um único POST grant_type=refresh_token, ambas recebem o access novo`.
  - `refresh com rede/429/5xx → mantém credenciais e devolve null só nesta chamada; próxima tenta de novo`.
  - `refresh 400 (refresh_token_not_found / already_used) → deslogado (storage limpo)`.
  - `sair limpa storage e abas antes do fetch de logout resolver; fetch usa ?scope=local`.
  - `sw boot chama setAccessLevel TRUSTED_CONTEXTS antes de qualquer set` (ordem das chamadas no chrome falso).
  - `sessão legada da 0.2.1 (chave 'sessao' em storage.session, token do app) é apagada no boot e nunca vira credencial
    nem é revogada` (nenhum fetch de logout para ela).
- [ ] **Step 2:** `cd extensao && npx vitest run src/__tests__/credenciais.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Endpoints: `POST {VITE_SUPABASE_URL}/auth/v1/token?grant_type=password` (`{ email, password }`)
  e `?grant_type=refresh_token` (`{ refresh_token }`), header `apikey: VITE_SUPABASE_ANON_KEY`. Toda leitura-decisão-escrita
  na fila `naFila` existente de `sessao.ts` (exportar uma versão interna se preciso). `sair()` chama
  `limparEstadosDasAbas()` (que sobe a geração) e remove as chaves antes do fetch.
- [ ] **Step 4:** `npx vitest run` (extensão inteira) → PASS.
- [ ] **Step 5: Commit** — `feat(extensao): sessão própria no service worker (login, renovação serializada, sair local)`.

### Task 4: Cliente da edge no protocolo 2

**Files:**
- Modify: `extensao/src/api.ts`
- Test: `extensao/src/__tests__/api.test.ts`

**Interfaces:**
- Consumes: Task 2 (contrato), Task 3 (`tokenValido`, `identidadeAtual`, `definirIdentidade`, `sair`).
- Produces: `chamarExtensao<T>(corpo)` com a mesma assinatura e `RespostaExtensao<T>` com erros novos
  `'identidade_mudou' | 'sem_acesso'`; `atualizarSessao(): Promise<boolean>` (chama `sessao`, grava identidade/perfil,
  limpa abas se a identidade mudou).

- [ ] **Step 1: Testes que falham:**
  - `envia protocolo 2 e identidadeEsperada; desembrulha dados`.
  - `resposta com identidade diferente da guardada → limpa abas, atualiza identidade, devolve { ok:false, erro:'identidade_mudou' }`.
  - `409 identidade_mudou → chama sessao uma vez e limpa abas; não reexecuta a ação`.
  - `resposta que chega depois de sair/entrar (geração mudou) é descartada` (geração lida antes e depois).
  - `401 → deslogado (sair local) e erro sessao_expirada`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (geração via `lerAba`/`GERACAO_SESSAO` já existente em `abas.ts`).
- [ ] **Step 4:** `npx vitest run` → PASS. **Step 5: Commit** — `feat(extensao): cliente da edge no protocolo 2 com identidade esperada`.

### Task 5: Preferência "ativa" e mensagens do SW

**Files:**
- Create: `extensao/src/preferencias.ts`
- Modify: `extensao/src/roteador.ts`
- Test: `extensao/src/__tests__/preferencias.test.ts`, `extensao/src/__tests__/roteador.test.ts`

**Interfaces:**
- Produces:
  - `estaAtiva(): Promise<boolean>` (padrão `true`), `definirAtiva(ativa: boolean): Promise<void>` — grava em
    `storage.local`, chama `limparEstadosDasAbas()` ao desligar, e transmite `{ tipo: 'publiai:ativacao', ativa, logado }`
    a todas as abas do ML (`chrome.tabs.query({ url: 'https://*.mercadolivre.com.br/*' })`) e ao painel.
  - Mensagens novas no roteador:
    - qualquer remetente da extensão: `publiai:estado-extensao` → `{ ativa, logado, perfil: { nome, orgNome } | null, versao }`.
    - só páginas da extensão (painel): `publiai:entrar { email, senha }` → resultado de `entrar` + `atualizarSessao`;
      `publiai:sair`; `publiai:definir-ativa { ativa }`.
    - content script do cabeçalho: `publiai:definir-ativa`, `publiai:sair`, `publiai:abrir-painel` (já existe), `publiai:abrir-app`
      (abre `URL_APP` em nova aba via `chrome.tabs.create`). **Nunca** `publiai:entrar` vindo de content script.
  - Desligada ou deslogado: `publiai:chamar`, `publiai:analisar-busca` e `publiai:reanalisar-aba` respondem `{ ok:false, erro:'inativa' }`
    ou `sem_sessao` sem chamar a edge.
  - `EstadoGuardado` (abas.ts) ganha `gravadoEm: number` (ms); `publiai:estado-da-aba` com estado de anúncio gravado há
    mais de 10 min reanalisa (mesmo caminho de `publiai:reanalisar-aba`) antes de devolver.
- [ ] **Step 1: Testes que falham:** `estado da aba com mais de 10 min é reanalisado antes de chegar ao painel`;
  `entrar recusado quando o remetente é content script`; `desligada → chamar não toca a
  edge`; `definirAtiva(false) limpa abas e transmite a todas as abas do ML`; `estado-extensao sem login → logado:false, perfil:null`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5: Commit** — `feat(extensao): chave ativa e mensagens de conta no SW`.

### Task 6: Content scripts do anúncio e da busca obedecem à chave

**Files:**
- Modify: `extensao/src/conteudo/anuncio.ts`, `extensao/src/conteudo/busca.ts`, `extensao/src/conteudo/selo.ts`
- Test: `extensao/src/conteudo/__tests__/selo.test.ts`, `extensao/src/conteudo/__tests__/busca-conteudo.test.ts`, novo `extensao/src/conteudo/__tests__/anuncio-ativacao.test.ts`

**Interfaces:**
- Consumes: Task 5 (`publiai:estado-extensao`, `publiai:ativacao`).
- Produces: `anuncio.ts` exporta `rodar(): Promise<void>` reentrante (trava por geração local em vez de `__publiaiAnuncio`
  permanente) e `pausar(): void` (remove selo e contornos, invalida a execução em voo).
- [ ] **Step 1: Testes que falham:**
  - `boot desligado → nenhuma análise pedida e nenhum selo`.
  - `ativacao false com análise em voo → resposta descartada, selo e contornos removidos`.
  - `ativacao true → rodar de novo e recolocar selo, sem duplicar (um #publiai-selo)`.
  - `deslogado → sem selo (o selo "conecte a extensão" sai)`.
  - busca: `ativacao false remove selos dos cards; true reenvia os cards (enviados zerado) sem analisar sozinha`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5: Commit** — `feat(extensao): selos obedecem à chave ativa e voltam sem recarregar`.

### Task 7: Painel — entrar, desativada e rodapé da conta

**Files:**
- Create: `extensao/src/painel/Entrar.tsx`, `extensao/src/painel/Conta.tsx`
- Modify: `extensao/src/painel/App.tsx`, `extensao/src/painel/formato.ts` (mensagens `identidade_mudou`, `sem_acesso`, `inativa`), `extensao/src/painel/painel.css`
- Test: `extensao/src/painel/__tests__/Entrar.test.tsx`, `extensao/src/painel/__tests__/Conta.test.tsx`, ajustar `App.test.tsx`

**Interfaces:**
- Consumes: Task 5 mensagens.
- Produces: `App` decide pela ordem: deslogado → `<Entrar/>`; desativada → cartão "Extensão desativada · Selos e análises
  pausados" com botão "Ativar"; senão o painel atual. `<Conta/>` no rodapé sempre que logado: nome, org, chave "Extensão
  ativa", "Abrir o PubliAI", "Sair".
- Copy fixa: título "Entrar no PubliAI", subtítulo "Use o mesmo e-mail e senha do app", campos "E-mail"/"Senha", botão
  "Entrar"; erro `credenciais_invalidas` → "E-mail ou senha incorretos."; `rede` → "Sem conexão. Tente de novo.";
  `sem_acesso` → "Seu usuário está inativo ou sem empresa no PubliAI."; `modulo_desligado` → texto atual.
- [ ] **Step 1: Testes que falham:** `Entrar envia publiai:entrar e limpa o campo senha após a resposta`; `senha nunca vai
  para storage/props globais` (campo `type=password`, `autocomplete=current-password`); `Conta: desligar envia definir-ativa false`;
  `App deslogado mostra Entrar; desativada mostra Ativar`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5: Commit** — `feat(extensao): painel com entrar, conta e chave ativa`.

### Task 8: Ícone e menu no cabeçalho do ML

**Files:**
- Create: `extensao/src/conteudo/cabecalho.ts`, `extensao/src/conteudo/menu-cabecalho.ts` (HTML/CSS do menu em shadow DOM fechado)
- Modify: `extensao/manifest.json` (content script novo com `matches` e `exclude_matches` da Global Constraints), `extensao/scripts/build-conteudo.mjs` (novo bundle `cabecalho.js`), `extensao/scripts/checar-dist.mjs` se valida a lista de bundles
- Test: `extensao/src/conteudo/__tests__/cabecalho.test.ts`

**Interfaces:**
- Consumes: Task 5 mensagens; `MARCA` de `conteudo/aparencia.ts`.
- Produces: `inserirIcone(doc: Document): HTMLElement | null` (idempotente; null sem encaixe), `localizarEncaixe(doc): Element | null`.
- [ ] **Step 0: Medir o encaixe ao vivo** (skill `playwright-cli`, sessão isolada, nunca o Chrome do Diego): home, busca
  `lista.mercadolivre.com.br/sabonete-liquido-melu-carinho-cuidado`, anúncio `/p/MLB53180253`; registrar no topo de
  `cabecalho.ts` o seletor do carrinho/área de ações (ex.: candidato `.nav-header-cart`/`.nav-cart`) com a data da medição.
  Salvar fixture HTML mínima do cabeçalho em `extensao/src/conteudo/__fixtures__/cabecalho-ml.html`.
- [ ] **Step 1: Testes que falham:**
  - `insere um ícone ao lado do carrinho na fixture; segunda chamada não duplica`.
  - `sem encaixe → null e nenhum nó criado` (fixture sem cabeçalho e página `/captcha/`).
  - `menu: logado mostra nome/org, chave, Abrir painel, Abrir o PubliAI, Sair, versão; deslogado mostra só "Entrar no PubliAI" + Entrar`.
  - `Entrar e Abrir painel enviam publiai:abrir-painel no próprio clique`; `Escape fecha e devolve o foco ao ícone`.
  - `ponto: verde logado e ativa, laranja deslogado, ícone cinza desativada` (classe/atributo).
  - `navegação sem recarga (cabeçalho reconstruído) → reinsere uma vez`.
  - `com o ícone do Avant presente (fixture com .avantpro-*) → insere o nosso sem mover nem esconder o dele`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (observer só até inserir + reobserva no `popstate`/troca do nó do cabeçalho;
  menu sem dado financeiro; `aria-haspopup="menu"`, `aria-expanded`).
- [ ] **Step 4:** PASS; `pnpm build` em `extensao/` (inclui `checar-dist`).
- [ ] **Step 5: Commit** — `feat(extensao): ícone e menu do PubliAI no cabeçalho do Mercado Livre`.

### Task 9: App web — ponte com ping e Configurações

**Files:**
- Modify: `src/lib/extensao-ponte.ts`, `src/stores/auth-store.ts`, `src/components/configuracoes/extensao-navegador.tsx`
- Modify (extensão): `extensao/src/sessao.ts` (`receberMensagemExterna`: `publiai:ping` → `{ ok:true, versao, protocolo: 2 }`;
  `publiai:sessao`/`publiai:desconectar` → `{ ok:false }`)
- Test: `src/lib/__tests__/extensao-ponte.test.ts`, `src/components/configuracoes/__tests__/extensao-navegador.test.tsx`,
  `src/stores/__tests__/auth-store-extensao.test.ts`, `extensao/src/__tests__/sessao.test.ts`

**Interfaces:**
- Produces: `pingExtensao(): Promise<{ versao: string; protocolo: number } | null>`; `enviarSessaoParaExtensao` só envia
  quando o ping responde sem `protocolo` ou `protocolo < 2` (0.2.x).
- Copy em Configurações (protocolo ≥ 2): linha "Instalação · Instalada neste Chrome (versão X)" e linha "Conta" com
  "Entre pela extensão, no ícone do PubliAI no Mercado Livre, com o seu e-mail e senha." (sem botão Reconectar).
- [ ] **Step 1: Testes que falham:** `protocolo 2 → não envia sessão nem desconectar`; `0.2.x (sem protocolo) → comportamento atual`;
  `Configurações com protocolo 2 mostra Instalada + texto de login pela extensão`; extensão: `ping responde versão e protocolo`,
  `publiai:sessao ignorado`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test -- extensao` na raiz + `npx vitest run` em `extensao/` → PASS.
- [ ] **Step 5: Commit** — `feat(app): ponte com ping de protocolo; extensão 0.3 entra sozinha`.

### Task 10: Versão, política de privacidade, docs e portões

**Files:**
- Modify: `extensao/manifest.json` (`0.3.0`), `docs/brand/landing/privacidade-extensao/index.html` (login, sessão
  persistida no navegador, dados financeiros exibidos; nada de senha guardada), `docs/TASKS.md`, `docs/project-status.md`,
  `docs/how-to/deploy-e-migrations.md` (ordem: edge → app → extensão), `CONTEXT.md` (verbetes "Sessão da extensão", "Extensão ativa")
- [ ] **Step 1:** atualizar arquivos; `pnpm preflight:static` na raiz → exit 0; `deno lint --config supabase/functions/deno.json`.
- [ ] **Step 2: Commit** — `chore(extensao): 0.3.0, política de privacidade e docs`.
- [ ] **Step 3 (pós-revisão, com OK do Diego):** deploy `supabase functions deploy extensao` (conferir versão ativa) →
  merge na main (Render publica o app) → `pnpm build` em `extensao/` e zip de `dist` → Diego atualiza declarações de
  privacidade do item e envia a 0.3.0.
