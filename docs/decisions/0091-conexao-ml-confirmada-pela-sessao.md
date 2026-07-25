# ADR-0091: A conexão do Mercado Livre é gravada na org da SESSÃO, não na do `state`

**Status:** Aceito
**Data:** 2026-07-25
**Decisores:** Diego
**Refina:** ADR-0060 (conectar ML é ação de admin), ADR-0025 (multicanal), ADR-0027 (multi-tenancy)

## Contexto

A varredura de segurança (relatório `CLAUDE-SECURITY-20260724-125213`, achado F4, HIGH,
confirmado por 3 verificadores) mostrou que o fluxo OAuth do Mercado Livre permite que um
atacante receba, na organização **dele**, os tokens de um vendedor que ele não controla.

Fluxo atual:

1. `ml-oauth-start` (POST, exige admin) gera `state = randomUUID()` e grava no Redis
   `oauth:ml:state:<state> = {user_id, org_id}` com TTL de 10 min. Devolve a `authUrl`.
2. O front navega o browser para a `authUrl` do ML.
3. O vendedor autoriza; o ML redireciona (GET top-level) para `ml-oauth-callback`
   (`verify_jwt=false`, público — como todo redirect de OAuth precisa ser) com `code` e `state`.
4. O callback lê o `state` no Redis, troca o `code` por token e chama
   `upsert_marketplace_connection` com `p_org_id` **vindo do `state`**.

O `state` só é validado por existir no Redis. Nada o amarra a quem está completando o fluxo.
Um admin de qualquer org chama `ml-oauth-start`, recebe uma `authUrl` carregando um `state`
ligado à org dele, e manda essa URL para um vendedor ("conecte sua loja"). Quem autoriza é a
vítima; quem fica com o `access_token` e o `refresh_token` é o atacante. A partir daí todos os
workers operam a conta ML da vítima sob o tenant do atacante: leem pedidos, PII de comprador,
mensagens e reclamações, e pausam ou alteram anúncios ao vivo. O refresh token rotaciona, então
o acesso persiste depois que a vítima fecha o navegador.

### Por que a defesa clássica de CSRF não resolve

O primeiro desenho considerado foi o padrão de mercado: amarrar o `state` ao navegador com um
cookie `HttpOnly; SameSite=Lax` — setado num hop GET no domínio das functions (o app roda em
outro domínio, e o CORS é `Access-Control-Allow-Origin: *`, o que impede cookie credenciado via
XHR) — e exigir que o callback veja cookie e `state` batendo.

**Isso não fecha este ataque.** O cookie prova apenas "foi o mesmo navegador que passou pelo
hop". O atacante manda para a vítima a URL **do hop**, não a do ML: o navegador da vítima
recebe o cookie amarrado ao `state` do atacante, segue para o ML, autoriza, e cookie e `state`
batem no callback. Os tokens caem na org do atacante do mesmo jeito.

A proteção clássica pressupõe o ataque inverso — o atacante completando um fluxo dentro da
sessão da vítima. Aqui é *account linking*: o atacante quer a credencial da vítima na conta
dele. Amarrar ao navegador é a dimensão errada; o vínculo tem de ser com a **sessão
autenticada** no instante em que a conexão é gravada.

## Decisão

1. **O `ml-oauth-callback` deixa de gravar a conexão.** Ele troca o `code` por token e guarda o
   resultado no Redis sob um id aleatório de uso único (`oauth:ml:claim:<id>`), TTL de 120 s.
2. **Uma function nova, `ml-oauth-claim`, faz o `upsert`** — autenticada (`verify_jwt` padrão,
   `requireUserOrg` + admin, ADR-0060). O `p_org_id` vem do **chamador autenticado**, nunca do
   `state`.
3. O front, ao voltar do ML, chama `ml-oauth-claim` com o JWT da sessão e o id do claim.
4. O `state` continua existindo e continua sendo consumido pelo callback — segue útil contra
   replay de `code` e requisição forjada ao callback —, mas **deixa de ser fonte de
   autorização**.

Com isso, o link do atacante entregue à vítima leva a vítima ao app **logada na própria org**:
o claim grava a conta ML dela na org dela. Resultado correto e inofensivo. Se ninguém estiver
logado, nada é gravado e a entrada expira sozinha.

5. **Índice único parcial** em `marketplace_connections (canal, conta_externa_id)` onde
   `conta_externa_id is not null`. Hoje só existe `unique (org_id, canal)`, então a mesma conta
   ML pode acabar em duas orgs — e `resolverIdentidade`
   (`_shared/faturamento/io.ts:16`) usa `.maybeSingle()`, que **erra com 2 linhas e devolve
   `null`**: o `ml-webhook` trata como "vendedor desconhecido", dá ACK 200 e descarta. Ou seja,
   uma conta duplicada hoje derruba silenciosamente os webhooks das **duas** orgs. Verificado em
   produção em 2026-07-25: nenhuma duplicata, o índice aplica limpo.

## Consequências

**Positivas**
- Elimina a classe do bug em vez de tapar um caminho: a org de destino passa a vir de uma
  sessão autenticada, que o atacante não controla.
- O `resolverIdentidade` deixa de ter o modo de falha silencioso do `maybeSingle`.
- O parâmetro de retorno já viaja **dentro do fragmento** (`#/configuracoes?...`, ver
  `ml-oauth-callback/index.ts:5`), que o browser não envia a servidor nenhum nem em `Referer` —
  o id do claim não vaza por log ou referrer.

**Negativas / limites**
- O token do vendedor passa a ficar ~120 s no Redis. É um lugar novo guardando segredo, que
  hoje não existe. Mitigações: TTL curto, uso único (consumo atômico via `GETDEL`) e nada de
  gravar o token em log.
- Um vendedor que autorize no ML e feche o navegador antes de o front chamar o claim não
  conecta — precisa repetir. É regressão de conveniência aceitável frente ao risco fechado.
- O front ganha um passo. `iniciarConexaoML` continua igual; o que muda é o tratamento do
  retorno na tela de Configurações.

**Descartado**
- *Cookie amarrado ao navegador (hop GET)*: não fecha o ataque, pelo motivo detalhado acima.
- *Recusar o upsert quando a conta ML já pertence a outra org*: não cobre o caso principal, em
  que a conta da vítima ainda não está ligada a nenhuma org. Vira defesa em profundidade — e é
  justamente o que o índice único do item 5 passa a garantir no banco.
