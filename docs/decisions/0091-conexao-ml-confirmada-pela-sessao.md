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

> **Ação obrigatória antes de implementar:** confirmar que o tempo de vida do `code` de
> autorização do ML supera 600s. Não é verificável pelo repositório. Se for menor, o TTL do claim
> desce para o valor real do ML.

### `verify_jwt` acompanha os irmãos

`ml-oauth-start`, `ml-oauth-callback` e `ml-oauth-disconnect` são todas `verify_jwt = false`
(`config.toml:13-18`) e fazem a checagem **dentro** da function. O topo do arquivo diz: "espelha
exatamente o que está deployado e funcionando. NÃO normalizar valores." O `ml-oauth-claim` segue
o mesmo padrão: `verify_jwt = false` + `requireUserOrg` + exigência de admin (ADR-0060) — que é
onde o portão real vive. Evita ser o único caminho com preflight de JWT da plataforma num fluxo
que manda header `Authorization` (não-safelisted, logo com preflight CORS).

### Tripwire de observabilidade

O `org_id` continua no `state` e é copiado para o registro do claim — **sem nenhum poder de
autorização**. Na redenção, compara-se com o `org_id` do chamador: fluxo legítimo sempre bate;
divergência é o ataque aterrissando inofensivamente ou um id repassado. `console.warn` com
`{state_org_id, caller_org_id, ml_user_id}` e **nunca** o token ou o `code`. Contar também claims
que expiram sem redenção.

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
  (`auth-org.ts:6-8`). **Não quebrar esse invariante.**

## O que precisa estar no mesmo commit

- `redisGetDel` em `_shared/redis/client.ts` — **não existe hoje** (o módulo só exporta
  GET/SET/DEL/INCR+TTL/SETNX, `:19-50`). O consumo do claim tem de ser atômico; não copiar o
  GET-depois-DEL do callback (`:31,33`).
- `src/pages/Configuracoes.tsx:75` — o guard só reage a `ml_conectado || ml_erro`. Sem incluir o
  param novo, o retorno renderiza Configurações e **nunca** chega ao `Canais.tsx:32`: fluxo morto,
  sem erro visível.
- `src/pages/Login.tsx:18` — lê `from.pathname` e **descarta o `search`**. Com sessão expirada
  durante a autorização, o `ProtectedRoute` (`protected-route.tsx:26`) manda para o login e o id
  do claim evapora. Precisa preservar `pathname + search`.
- Guarda contra `StrictMode` (`main.tsx:13`): `useEffect` ingênuo dispara o claim duas vezes e a
  segunda falha após o `GETDEL`. Tratar "claim não encontrado mas conexão presente" como sucesso.
- `chamarEdge` (`src/lib/ml-oauth.ts:3`) não manda corpo; o claim precisa de um, com
  `Content-Type: application/json` (já permitido em `cors.ts:4`).
- Tradução do **23505**: conta ML já pertencente a outra org cai no INSERT
  (`migration:68-69,74`) e estoura erro cru do Postgres. Mapear para "esta conta ML já está
  conectada em outra organização".
- `ml_erro=token` deixa de ser caminho do callback (`callback:66`) e vira resposta do claim — o
  front precisa renderizar.
- Docs (regra do CLAUDE.md): `docs/reference/edge-functions.md` (function nova + config),
  `docs/reference/modelo-de-dados.md` (índice), `obsidian-vault/04-Decisões/Índice de ADRs.md`.

## Ordem de deploy e rollback

Merge **não** deploya Edge Function. Ordem obrigatória:

1. `ml-oauth-claim` (a function nova, que ainda ninguém chama);
2. o frontend, tolerando **os dois** retornos (`ml_conectado` antigo e o param novo);
3. `ml-oauth-callback` por último.

Invertido, o callback grava claims que nada consome e conectar loja morre. **Rollback** é o
espelho: reverter só o callback para a versão anterior e as conexões voltam a funcionar. Como
`_shared/redis/client.ts` muda, todas as functions que o importam precisam de redeploy.

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

## Fora de escopo (registrado, não corrigido)

- Achado F6 (supressão de webhook por origem não autenticada).
- O caminho de UPDATE (`migration:84-89`) sobrescreve em silêncio o `conta_externa_id` da org:
  conectar uma segunda conta ML substitui a primeira sem aviso. Pré-existente.
