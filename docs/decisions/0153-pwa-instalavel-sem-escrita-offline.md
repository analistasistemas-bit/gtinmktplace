# ADR-0153: PWA instalável com leitura offline na sessão viva e nenhuma escrita offline

**Status:** Aceito (2026-09-05)
**Data:** 2026-09-05
**Decisores:** Diego
**Relacionado:** ADR-0005 (lifecycle publish/update), ADR-0006 (QStash), ADR-0027 (multi-tenancy), ADR-0060 (pausar/reativar restrito a admin), ADR-0086 (config org-scoped)

## Contexto

O app já tem `public/site.webmanifest` completo (nome, `display: standalone`, cores da marca,
ícones maskable de 192 e 512) linkado no `index.html`, mais `apple-touch-icon.png`. No iOS o
"adicionar à tela de início" já funciona.

Falta o service worker. Sem ele:

- o Chrome/Android **não oferece instalar** — a instalabilidade exige um service worker com
  handler de `fetch`;
- não existe nada offline: sem rede, o app não abre.

Ao levantar o terreno para o service worker, apareceram três fatos no código atual que mudam a
decisão:

**1. Já existe uma fila de escrita offline, implícita e não intencional.**
`src/lib/query-client.ts` não define `networkMode`. O padrão do react-query v5 é `'online'`:
sem rede, `useMutation` **não falha — fica pausada** e é **disparada automaticamente quando a
conexão volta**. São 47 `useMutation` em 18 arquivos, incluindo `usePausarReativarPublicado`,
`useRemoverPublicado`, `dialog-reprecificar`, `dialog-entrada`, `dialog-ajuste` e
`useFamiliaMutations`.

Hoje isso quase nunca dispara, porque ninguém opera o app sem rede num navegador de desktop.
**Um PWA instalado no celular torna esse cenário rotina.** O efeito é uma decisão comercial
tomada sobre dado de um momento e executada minutos depois, sobre um mercado que já mudou —
exatamente a classe de incidente que a regra de revisão humana antes de publicar existe para
impedir.

**2. Ficar sem rede hoje derruba o operador para "Sem acesso".**
`src/stores/auth-store.ts` lê `const { data } = ...` e ignora `error`. Uma falha de rede vira
`profile: null`, o `MenuGuard` interpreta como "usuário sem permissão" e redireciona para
`/sem-acesso`. `useModulosHabilitados` tem `retry: false` e some com os menus.

**3. HashRouter servido como estático pelo Render** (`render.yaml` reescreve `/* → /index.html`).
Só existe uma URL de navegação real, o que simplifica o service worker — mas o `render.yaml` não
define `Cache-Control`, e a validação pós-deploy por Playwright fica mais frágil: desligar o cache
do navegador via CDP não atravessa o precache do Workbox.

## Decisão

### D1 — `vite-plugin-pwa` em modo `generateSW`, reusando o manifest existente

O plugin gera o service worker a partir do output do Vite. A alternativa — service worker escrito
à mão — exigiria manter na mão a lista de assets com hash e a lógica de versionamento, que é
precisamente onde nasce "bundle velho servido depois do deploy". Custo: uma devDependency e
alguns segundos de build.

`manifest: false` no plugin: o `site.webmanifest` que já existe continua sendo a fonte única.
Deixar o plugin gerar um segundo manifest criaria duas verdades sobre nome, ícones e cores.

**Rejeitado:** `injectManifest` (levaria um `sw.ts` para dentro do `tsc -b` e do eslint, com lib
`WebWorker`, sem ganho para este escopo).

### D2 — Nenhuma escrita offline. `mutations.networkMode: 'always'`

Nenhuma mutação do app é segura para enfileirar, porque todas agem sobre estado que muda no
servidor sem o operador: estoque muda por venda no ML, preço muda por concorrência, status muda
por moderação. Executar depois uma decisão tomada antes é pior do que não executar.

Sem rede, a mutação **falha na hora, com aviso** — não fica pendurada. Não há exceção: o upload
de planilha também não vira rascunho local, porque o caminho é `ingest-lote` + QStash.

Esta regra vem antes do service worker na ordem de implementação. Ela conserta um risco que já
existe hoje, com ou sem PWA.

### D3 — O service worker nunca intercepta cross-origin

Zero `runtimeCaching`. O service worker cuida apenas do precache do próprio build (HTML, JS, CSS,
fontes, ícones). Toda chamada ao Supabase — REST, auth, storage, functions, realtime — passa
direto pela rede, sempre.

Motivo: resposta autenticada carrega dado de um `org_id`. Um cache que não entende RLS pode servir
para a conta errada. Não existe configuração de cache que seja mais segura do que não cachear.

Consequência assumida: **leitura offline vale só na sessão viva** — é o cache em memória do
react-query. Fechar e reabrir o app sem rede mostra a tela "Sem conexão", não os dados.

**Rejeitado:** persistir o cache do react-query em IndexedDB. Grava dado da organização no disco
do aparelho e exige invalidação por `org_id` e limpeza no logout — mais código e mais superfície
de vazamento entre organizações do que o ganho justifica hoje. Decisão do dono do produto em
2026-09-05.

### D4 — Atualização por aviso, não automática

`registerType: 'prompt'`. Quando há versão nova, um toast oferece atualizar; quem clica recarrega.
`registration.update()` a cada 60 minutos e ao voltar o foco da aba. `clientsClaim: true`,
`cleanupOutdatedCaches: true`, `skipWaiting: false`.

**Rejeitado:** atualização automática. Recarregaria a página no meio de uma revisão de lote, e o
par "service worker novo + página velha" quebra `lazy()` ao pedir um chunk que não existe mais.

`render.yaml` passa a enviar `Cache-Control: no-cache` para `/sw.js`, `/index.html` e
`/site.webmanifest`. O navegador já limita o script do service worker a 24 h; o header derruba para
zero.

**Kill switch:** um deploy com `selfDestroying: true` no plugin desregistra o service worker de
todos os clientes e limpa os caches.

### D5 — Offline não é falta de permissão

`loadProfile` passa a distinguir erro de rede de "não há perfil": em erro, mantém o perfil
anterior e marca estado offline, em vez de zerar.

`ProtectedRoute` passa a mostrar "Sem conexão" quando não há perfil **por falha de rede** — o
corte acontece antes do `MenuGuard`, que é quem redireciona para `/sem-acesso`. Sem usuário
nenhum, o comportamento continua sendo ir para `/login`.

`useModulosHabilitados` **não precisou de mudança**: o react-query v5 já retém o `data` da última
busca bem-sucedida quando um refetch falha (verificado lendo o estado cru da query). O caso que
sobra é a **primeira** carga da sessão falhando: `modulos` fica `undefined`, e os três call sites
(`menu-guard.tsx`, `sidebar.tsx`, `viabilidade-linha.tsx`) fazem `modulos ?? []`. Uma lista vazia
significa "nenhum módulo contratado" e esconde todos os menus pagos (Estoque, Pulse) — de novo,
falha de rede se disfarçando de falta de permissão. O tratamento correto é distinguir "ainda não
sei" (`undefined`) de "sei que não tem" (`[]`) nesses call sites.

Em `menu-guard.tsx` e `sidebar.tsx`, "não sei" **não** esconde: o menu-guard mostra "Módulos
indisponíveis" com opção de tentar de novo, em vez de mandar para `/sem-acesso`. Quando o perfil
já não daria acesso à rota, o motivo é permissão e o fluxo antigo decide normalmente.

**Exceção deliberada em `viabilidade-linha.tsx`** (decisão do Diego, 2026-09-05): ali "não sei"
esconde o botão "Cadastrar". A diferença é o que está em jogo — é um atalho, não o acesso a uma
tela. Oferecer uma ação que a edge `cadastrar-produto` vai recusar com 403 (ADR-0047) é pior
experiência do que não oferecer, e nenhuma tela fica inacessível por causa disso.

### D6 — Valor de dinheiro offline aparece, com aviso visível

Faixa global no `AppShell`: "Sem conexão desde HH:MM — valores podem estar desatualizados".

**Rejeitado:** mascarar os valores. É mais código e tira do operador justamente a informação que
ele já tinha visto. O risco a controlar é ele *achar* que o número é de agora — e isso o aviso
resolve.

## Regras invioláveis

- O service worker **nunca** cacheia resposta cross-origin, em especial Supabase.
- `mutations.networkMode: 'always'` — nenhuma escrita pendurada esperando rede.
- Nenhum dado de organização gravado em disco no aparelho.
- Atualização de versão passa por decisão do usuário.

## Consequências

- O app fica instalável no Android/Chrome e ganha ícone próprio, tela cheia e splash.
- Offline: o app abre e navega, mostrando o que já foi carregado **na sessão atual**. Cold start
  sem rede mostra "Sem conexão".
- Toda ação de escrita fica indisponível offline, com aviso imediato — inclusive as que hoje
  ficariam pausadas e disparariam sozinhas.
- A validação pós-deploy muda: o service worker serve o bundle antigo mesmo com o cache do
  navegador desligado via CDP. Passa a exigir contexto novo ou aceitar o prompt de atualização.
- Cada deploy custa um download completo do bundle por dispositivo (precache). Irrelevante no
  desktop, perceptível em 4G.

## Verificação

- Teste automatizado de que a configuração do service worker não casa com nenhuma URL do Supabase
  e que `runtimeCaching` está vazio.
- Teste de que uma mutação sem rede **rejeita** em vez de ficar pausada.
- Teste de que erro de rede no `loadProfile` não leva a `/sem-acesso`.
- Checklist de runtime real (fora do CI, em `docs/how-to/deploy-e-migrations.md`): instalabilidade,
  navegação offline entre telas visitadas, mutação offline que falha e **não executa ao reconectar**,
  cold start offline e fluxo de atualização de versão.
