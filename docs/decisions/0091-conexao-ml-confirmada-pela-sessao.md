# ADR-0091: A conexão do Mercado Livre é gravada na org da SESSÃO, não na do `state`

**Status:** Aceito
**Data:** 2026-07-25 (revisado no mesmo dia após revisão adversarial)
**Decisores:** Diego
**Refina:** ADR-0060 (conectar ML é ação de admin), ADR-0025 (multicanal), ADR-0027 (multi-tenancy)

## Contexto

A varredura de segurança (relatório `CLAUDE-SECURITY-20260724-125213`, achado F4, HIGH,
confirmado por 3 verificadores) mostrou que o fluxo OAuth do Mercado Livre permite que um
atacante receba, na organização **dele**, os tokens de um vendedor que ele não controla.

Fluxo atual:

1. `ml-oauth-start/index.ts:20` gera `state = crypto.randomUUID()` e grava no Redis
   `oauth:ml:state:<state> = {user_id, org_id}` com TTL de 600s (`:6`). Exige admin (`:18`).
2. O front navega o browser para a `authUrl` do ML.
3. O vendedor autoriza; o ML redireciona (GET top-level) para `ml-oauth-callback`
   (`config.toml:17-18`, `verify_jwt=false` — é o `redirect_uri` registrado no ML) com `code` e
   `state`.
4. O callback lê o `state` (`:31`), apaga (`:33`), troca o `code` por token (`:46`) e chama
   `upsert_marketplace_connection` com `p_org_id` **vindo do `state`** (`:50-51`).

O `state` só é validado por existir no Redis. Nada o amarra a quem está completando o fluxo.
Um admin de qualquer org chama `ml-oauth-start`, recebe uma `authUrl` carregando um `state`
ligado à org dele, e manda essa URL para um vendedor ("conecte sua loja"). Quem autoriza é a
vítima; quem fica com o `access_token` e o `refresh_token` é o atacante. A partir daí todos os
workers operam a conta ML da vítima sob o tenant do atacante: leem pedidos, PII de comprador,
mensagens e reclamações, e pausam ou alteram anúncios ao vivo. O refresh token rotaciona, então
o acesso persiste depois que a vítima fecha o navegador.

Não há caminho irmão que burle o fix: `upsert_marketplace_connection` tem exatamente dois
chamadores — o callback (`:50`, o buraco) e o refresh (`_shared/ml/token.ts:81`, que tira o
`p_org_id` da linha já existente).

### Por que a defesa clássica de CSRF não resolve

O primeiro desenho considerado foi o padrão de mercado: amarrar o `state` ao navegador com um
cookie `HttpOnly; SameSite=Lax` — setado num hop GET no domínio das functions (o app roda em
outro domínio, e `_shared/cors.ts:2` é `Access-Control-Allow-Origin: '*'`, o que impede cookie
credenciado via XHR) — e exigir que o callback veja cookie e `state` batendo.

**Isso não fecha este ataque.** O cookie prova apenas "foi o mesmo navegador que passou pelo
hop", e o atacante fica perfeitamente satisfeito que o navegador da vítima execute todos os
passos: basta mandar para a vítima a URL **do hop**, não a do ML. O navegador da vítima recebe o
cookie já amarrado ao `state` do atacante, segue para o ML, autoriza, e cookie e `state` batem no
callback.

A proteção clássica pressupõe o ataque inverso — o atacante completando um fluxo dentro da sessão
da vítima. Aqui é *account linking*: o atacante quer a credencial da vítima na conta dele.
Identidade de navegador não é a propriedade sob ataque. Enquadramento correto: isto **não é uma
defesa diferente**, é a mesma defesa com o vínculo movido para o instante da escrita — e o
"cookie" passa a ser o JWT do Supabase.

## Decisão

1. **O `ml-oauth-callback` deixa de gravar a conexão** e **deixa de trocar o `code` por token**.
   Ele valida/consome o `state`, guarda o **`code`** (não o token) no Redis em
   `oauth:ml:claim:<id>` — id aleatório, uso único, TTL 600s — e redireciona para o front com
   esse id.
2. **Uma function nova, `ml-oauth-claim`, faz a troca e o `upsert`.** O `p_org_id` vem do
   **chamador autenticado**, nunca do `state`. `trocarCodePorToken` (`token.ts:52`) e
   `buscarNickname` (`callback:11`, já best-effort) migram para cá.
3. O front, ao voltar do ML, chama `ml-oauth-claim` com o JWT da sessão e invalida
   `useMlConnection()`.
4. O `state` continua existindo e sendo consumido pelo callback (anti-replay do `code`), mas
   **deixa de ser fonte de autorização**.
5. **Índice único parcial** em `marketplace_connections (canal, conta_externa_id)` onde
   `conta_externa_id is not null`. Hoje só existe `unique (org_id, canal)`
   (migration `20260705171224:23`), então a mesma conta ML pode acabar em duas orgs — e
   `resolverIdentidade` (`_shared/faturamento/io.ts:16`) usa `.maybeSingle()`, que **erra com 2
   linhas e devolve `null`**: o `ml-webhook` trata como "vendedor desconhecido", dá ACK 200 e
   descarta. Uma conta duplicada hoje derruba silenciosamente os webhooks das **duas** orgs.
   Verificado em produção em 2026-07-25: nenhuma duplicata, o índice aplica limpo.

### Guardar o `code`, não o token (revisão)

A primeira versão deste ADR guardava o **token** no Redis por 120s e listava isso como custo
aceito. Guardar o `code` **elimina** esse custo em vez de mitigá-lo: um `code` é inerte sem o
`ML_CLIENT_SECRET` (`token.ts:37-38`), que vive só no ambiente das functions, enquanto
`access_token`/`refresh_token` são credencial viva. Com isso os tokens só existem na memória da
function que os grava no Vault.

O ganho colateral é o que conserta o pior modo de falha (sessão expirada, abaixo): com apenas um
`code` em repouso, esticar o TTL do claim para 600s — igual ao `STATE_TTL_S` — custa quase nada.

O invariante — não a constante — é o que fica registrado: **`TTL do claim ≤ TTL do code do ML`**.
600s é o valor atual, e a fonte que o estabelecer deve ser citada aqui.

> **Resultado da pesquisa (2026-07-25):** a documentação pública do ML **não informa** o tempo de
> vida do `code`. Confirmado o que ela informa: `access_token` vale 6h, `refresh_token` 6 meses, e
> o `code` é de **uso único**, com `invalid_grant` ("Error validating grant. Your refresh token or
> authorization code may be expired or has already been used"). Os domínios de documentação
> (`developers.mercadolivre.com.br`, `developers.mercadolibre.com.ar`, `global-selling`) bloqueiam
> fetch automatizado (403), então a leitura veio de busca — se alguém tiver acesso ao portal
> logado, vale reconferir.
>
> **Consequência sobre o trade-off:** guardar o `code` troca um custo conhecido (segredo vivo em
> repouso) por uma dependência **desconhecida**. No caminho feliz isso é irrelevante — o claim
> dispara segundos após o redirect. O caminho onde pesa é exatamente o que motivou o TTL de 600s:
> sessão expirada → login → redenção. Ver "Decisão pendente" no fim deste ADR.

> **Ação obrigatória e bloqueante:** confirmar o tempo de vida do `code` de autorização do ML.
> Não é verificável pelo repositório nem pela documentação pública. Isso deixou de ser diligência
> e virou dependência dura:
> no desenho antigo a troca acontecia milissegundos depois de o ML emitir o code
> (`callback:46`), então a vida dele nunca importou; mover a troca para depois de uma ação
> humana torna esse prazo carregado. Ordem de custo para descobrir sem produção: (a) a
> documentação oficial de autenticação server-side do ML; (b) uma segunda aplicação ML com
> **test users** (`/users/test_user`), rodando o fluxo sem vendedor real; (c) uma sonda que não
> exige espera — trocar o mesmo `code` duas vezes: a segunda tentativa devolve `invalid_grant`,
> confirmando de uma vez a semântica de uso único e o formato exato do erro que o front terá de
> renderizar.

**Comportamento com `code` expirado, escrito de propósito:** o claim faz `GETDEL` **antes** da
troca, então o id já foi destruído quando o ML recusa. `postToken` (`token.ts:42-46`) lança
`MLApiError` com `oauthError` (`invalid_grant` para expirado/usado). A falha é **irrecuperável no
lugar**: o usuário precisa refazer o consentimento inteiro. O front tem de renderizar "reinicie a
conexão" com o botão Conectar ativo — nunca um erro genérico sem saída.

### `verify_jwt` acompanha os irmãos

`ml-oauth-start`, `ml-oauth-callback` e `ml-oauth-disconnect` são todas `verify_jwt = false`
(`config.toml:13-18`) e fazem a checagem **dentro** da function. O topo do arquivo diz: "espelha
exatamente o que está deployado e funcionando. NÃO normalizar valores." O `ml-oauth-claim` segue
o mesmo padrão: `verify_jwt = false` + `requireUserOrg` + exigência de admin (ADR-0060) — que é
onde o portão real vive. Evita ser o único caminho com preflight de JWT da plataforma num fluxo
que manda header `Authorization` (não-safelisted, logo com preflight CORS).

### Tripwire de observabilidade — por junção de log, sem campo novo

A versão anterior copiava o `org_id` do `state` para o registro do claim, "sem poder de
autorização". Isso é frágil pelo motivo errado: deixa o valor controlado pelo atacante a **um
`if` de distância** do caminho de escrita — exatamente o bug que este ADR fecha. Um campo que não
existe não pode virar condição.

Então o `org_id` **não** entra no registro do claim. A correlação é por log:
o callback registra `{claim_id, state_org_id}`, o claim registra
`{claim_id, caller_org_id, ml_user_id}`, e uma investigação junta pelo `claim_id`. Divergência é
o ataque aterrissando inofensivamente ou um id repassado. **Nunca** logar o token nem o `code`.

O invariante que um revisor futuro consegue checar em uma linha:
**`ml-oauth-claim` não lê org de lugar nenhum além de `requireUserOrg`.**

Claims emitidos e não redimidos saem da mesma junção — `GETDEL` mais TTL **não gera evento de
expiração** (expiração no Redis é silenciosa sem keyspace notifications, e
`_shared/redis/client.ts` não tem nada disso), então "contar expirados" como métrica direta não é
construível. Emitidos menos redimidos numa janela dá o mesmo número, a partir de linhas de log que
o tripwire já produz.

## Consequências

**Positivas**
- Elimina a classe do bug: a org de destino passa a vir de uma sessão autenticada, que o atacante
  não controla.
- Nenhum segredo vivo passa a residir em lugar novo (só o `code`, inerte).
- O `resolverIdentidade` deixa de ter o modo de falha silencioso do `maybeSingle`.
- O parâmetro de retorno viaja **dentro do fragmento** (`callback:5`), que o browser não envia a
  servidor nenhum nem em `Referer`.

**Negativas / limites**
- Quem autorizar no ML e fechar o navegador antes do claim não conecta e precisa repetir. Na
  segunda tentativa o ML pula o consentimento e emite `code` novo.
- **A janela do claim-id.** Se um terceiro autenticado obtiver o id dentro do TTL, conecta a conta
  da vítima na org dele. Exige engenharia social ativa (a vítima colando a URL de retorno) ou
  máquina compartilhada. Ainda assim é estritamente melhor que hoje, onde o ataque não precisa de
  nenhuma cooperação além de clicar em autorizar. **Descartado** amarrar o claim ao
  `state.user_id`: no vetor que importa, quem recebe a URL colada É o iniciador do fluxo, então a
  amarra seria transparente para ele — e reintroduziria o `state` como autoridade, que é o bug
  original.
- **O índice único decide um produto:** um mesmo vendedor ML deixa de poder estar conectado a duas
  orgs. Hoje isso é tecnicamente permitido e destrói os webhooks das duas em silêncio, então é
  melhoria — mas converte quebra silenciosa em falha explícita de conexão para um par
  agência/marca. Decisão tomada de propósito.
- `p_criado_por` muda de significado: passa a ser "quem confirmou", não "quem iniciou". Alimenta
  `resolverOrgPorUserId` (`io.ts:22`), seguro apenas porque `profiles.org_id` é de valor único
  (`auth-org.ts:6-8`). **Não quebrar esse invariante.** Como efeito colateral, o `user_id` gravado
  no `state` (`start:21`) fica morto para autorização — sobrevive só como campo de log.
- **Muda o onboarding, e isso é intenção, não bug:** um vendedor que **não** seja admin de uma
  org do PubliAI deixa de conseguir concluir a conexão sozinho. O fluxo correto passa a ser: um
  admin da org completa a conexão **na própria sessão**. Com duas orgs hoje isso é inerte, mas é
  o outro lado da garantia — está escrito aqui para ninguém redescobrir como regressão.

## O que precisa estar no mesmo commit

- `redisGetDel` em `_shared/redis/client.ts` — **não existe hoje** (o módulo só exporta
  GET/SET/DEL/INCR+TTL/SETNX, `:19-50`). O consumo do claim tem de ser atômico; não copiar o
  GET-depois-DEL do callback (`:31,33`).
- `src/pages/Configuracoes.tsx:75` — o guard só reage a `ml_conectado || ml_erro`. Sem incluir o
  param novo, o retorno renderiza Configurações e **nunca** chega ao `Canais.tsx:32`: fluxo morto,
  sem erro visível.
- `src/pages/Login.tsx:18` — lê `from.pathname` e **descarta o `search`**. Com sessão expirada
  durante a autorização, o `ProtectedRoute` (`protected-route.tsx:26`) manda para o login e o id
  do claim evapora. Precisa preservar `pathname + search`. **Cobertura honesta:** mesmo com o
  fix, `loc.state` vive em memória — recarregar a página de login ou abri-la em outra aba perde o
  `from` inteiro, com ou sem `search`. É recuperação best-effort, não garantia.
- **Limpar o param depois de redimir** — `setSearchParams({}, { replace: true })` em
  `Canais.tsx` (hoje só o getter é desestruturado, `:28`). Isto substitui a heurística que a
  versão anterior propunha ("claim não encontrado mas conexão presente = sucesso"), que era
  **racy e erraria em produção**: entre o `GETDEL` da primeira chamada e a linha existir, o claim
  ainda faz a ida ao ML (`token.ts:29-41`, até 15s de `AbortSignal.timeout`), o `buscarNickname`
  e a escrita no Vault — a segunda chamada olharia no meio disso, não veria conexão e mostraria
  erro sobre uma conexão que está dando certo. Além disso, o duplo-disparo do `StrictMode` é
  **só de desenvolvimento**; a versão em produção do problema é o param sobreviver na URL (F5,
  botão voltar, URL de retorno compartilhada ou favoritada), que re-dispara o claim e encontra
  nada. Limpar o param cobre os três casos com uma linha, e permite **apagar** a heurística em
  vez de implementá-la.
- `src/pages/Canais.tsx:65` — o banner de sucesso é condicionado a `mlConectado`
  (`ml_conectado === 'true'`, `:32`). Com o retorno novo ele nunca renderiza: o card vira
  "Conectado" pela invalidação, mas a confirmação explícita some no caminho feliz.
- `src/pages/Canais.tsx:70-75` — o mapa de erro só trata `ml_erro === 'state'`; todo o resto vira
  mensagem genérica. A tradução do 23505, o 403 de não-admin concluindo o fluxo e o
  `invalid_grant` não têm onde aparecer a menos que o erro do claim passe por `erroAcao` (`:29`).
- **Invalidar `QK.conexoes` também**, não só `useMlConnection()`: o `handleDesconectarML`
  invalida as duas (`:51-52`) porque `conectados` (`:36`) alimenta os cards dos outros canais.
  Espelhar o handler de desconexão.
- `chamarEdge` (`src/lib/ml-oauth.ts:3`) não manda corpo; o claim precisa de um, com
  `Content-Type: application/json` (já permitido em `cors.ts:4`).
- Tradução do **23505**: conta ML já pertencente a outra org estoura erro cru do Postgres.
  Acontece nos **dois** caminhos do `upsert_marketplace_connection` — INSERT
  (`migration:68-69,74`, org sem conexão) e UPDATE (`migration:84-89`, que também grava
  `conta_externa_id`, quando uma org que já tem conexão conecta uma conta de outra org. Capturar
  o SQLSTATE da RPC, **não** por caminho, e mapear para "esta conta ML já está conectada em outra
  organização".
- `ml_erro=token` deixa de ser caminho do callback (`callback:66`) e vira resposta do claim — o
  front precisa renderizar.
- Docs (regra do CLAUDE.md): `docs/reference/edge-functions.md` (function nova + config),
  `docs/reference/modelo-de-dados.md` (índice), `obsidian-vault/04-Decisões/Índice de ADRs.md`.

## Ordem de deploy e rollback

Merge **não** deploya Edge Function. Ordem obrigatória:

0. a **migration do índice único** — aditiva e independente das outras etapas; pode ir primeiro.
   Pior caso de chegar cedo: o callback antigo transformaria uma colisão em `ml_erro=token` cru,
   numa colisão que a produção hoje não tem (verificado);
1. `ml-oauth-claim` (a function nova, que ainda ninguém chama);
2. o frontend, tolerando **os dois** retornos (`ml_conectado` antigo e o param novo) — o callback
   antigo ainda grava e devolve `ml_conectado=true`, que o front tolerante trata;
3. `ml-oauth-callback` por último, virando o formato de retorno para um front já preparado.

**O F4 continua totalmente explorável até a etapa 3 entrar.** Não existe estado parcialmente
mitigado — dizer isso aqui evita que alguém pare no meio achando que já protegeu algo.

Usuário em voo que começou sob o callback antigo volta no novo com `state` válido e recebe um id
de claim: funciona. **Rollback** é o espelho, e o "**só** o callback" é carregado: reverter também
o front deixaria ids de claim em voo órfãos.

Como `_shared/redis/client.ts` muda, todas as functions que o importam entram no redeploy. Isso é
mais conservador do que o estritamente necessário (a export é aditiva e cada function empacota a
própria cópia), mas é a regra do projeto e o custo é baixo.

## Verificação

Não há teste destas functions hoje (`io.ts:2` registra que código de edge não roda sob vitest, e
`tests/` não tem cobertura de oauth). **Não inventar harness.** O que fica é checklist de staging,
executado com duas orgs:

1. Atacante (org A) gera a `authUrl`, manda para a vítima (org B, logada): a conexão tem de
   aparecer em **B**, e o tripwire tem de logar a divergência.
2. Conexão legítima ponta a ponta na própria org.
3. Sessão expirada no retorno: login e conclusão do claim sem perder o id.
4. Reconectar conta já conectada na mesma org (deve funcionar — `delete_marketplace_connection`,
   `migration:130-132`, faz hard delete) e de outra org (deve dar a mensagem do 23505).
5. Voltar do ML e dar F5 / usar o botão voltar: **não** pode exibir erro sobre uma conexão que
   deu certo (é o que o passo de limpar o param garante).
6. Sonda de `code`: trocar o mesmo `code` duas vezes e confirmar `invalid_grant` na segunda —
   valida a semântica de uso único e o formato do erro que o front renderiza.

## Decisão pendente: `code` ou token no Redis

A pesquisa de 2026-07-25 não achou o prazo do `code` na documentação pública, e isso reabre —
sem invalidar — a escolha entre guardar o `code` ou o token. As duas alternativas têm a **mesma
propriedade de segurança** (a org vem da sessão autenticada); mudam só o custo e o modo de falha.

| | Guardar o `code` (plano atual) | Trocar no callback e guardar o token |
|---|---|---|
| Segredo em repouso | nenhum vivo (o `code` é inerte sem o `ML_CLIENT_SECRET`) | `access_token` + `refresh_token` por ~TTL |
| Dependência do prazo do `code` | **sim** — desconhecida | não (a troca ocorre em milissegundos) |
| Caminho feliz | idêntico | idêntico |
| Sessão expirada → login → redenção | falha se o `code` vencer; exige refazer o consentimento | funciona |

Encaminhamento recomendado, em ordem de custo: (1) sonda com **test users** do ML
(`/users/test_user`) medindo o prazo real, sem vendedor de verdade — resolve a incógnita e mantém
o plano atual; (2) se a sonda não for viável, guardar o token com TTL curto (120s), aceitando o
custo conhecido em vez da dependência desconhecida. **Não** implementar antes de escolher: os dois
caminhos mudam o que o callback e o claim fazem.

## Fora de escopo (registrado, não corrigido)

- Achado F6 (supressão de webhook por origem não autenticada).
- O caminho de UPDATE (`migration:84-89`) sobrescreve em silêncio o `conta_externa_id` da org:
  conectar uma segunda conta ML substitui a primeira sem aviso. Pré-existente.
