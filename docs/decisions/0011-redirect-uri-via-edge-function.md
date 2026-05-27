# ADR-0011: Redirect URI do OAuth Mercado Livre via Supabase Edge Function

**Status:** Aceito
**Data:** 2026-05-27
**Decisores:** Diego (em sessão de configuração da app no portal ML)
**Relacionado:** [ADR-0005 (lifecycle publish/update)](0005-lifecycle-publish-and-update.md), [ADR-0001 (stack)](0001-stack-tecnologico.md)

## Contexto

Ao registrar a app PubliAI no portal Mercado Livre Developers (https://developers.mercadolibre.com.br/), foi necessário definir uma **redirect URI** — endereço para onde o ML redireciona o usuário (com `?code=...&state=...` na querystring) depois que ele autoriza o app.

Três opções foram consideradas. A escolha não é óbvia porque o frontend usa **HashRouter** (decisão M0), o que afeta como query params se comportam após o redirect OAuth.

### Constraint relevante: HashRouter no frontend

O Render Static Site (M0) tinha problema com a regra de rewrite `/* → /index.html`: ela retornava 200 com body vazio em rotas profundas como `/cadastro`. A solução adotada foi usar `HashRouter` (URLs ficam `/#/rota`), que não depende de rewrite do servidor. Isso é documentado como aceitável para uma ferramenta interna.

**Consequência indesejada:** OAuth providers redirecionam para `<redirect_uri>?code=...`. Se a redirect URI for `https://ean2marketplace-frontend.onrender.com/#/ml-callback`, o ML provavelmente vai concatenar a querystring **depois do hash**, resultando em URLs do tipo `https://ean2marketplace-frontend.onrender.com/#/ml-callback?code=...`. Browsers tratam o que vem depois do `#` como **fragment**, não como path — então o code chegaria como parte do fragmento e não como query param padrão. O React Router conseguiria ler via `useLocation().hash`, mas é frágil e foge do contrato OAuth típico.

## Decisão

A redirect URI registrada na app PubliAI é uma **Supabase Edge Function** estática, não a URL do frontend:

```
https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/ml-oauth-callback
```

A função `ml-oauth-callback` será implementada no **M4** e fará:

1. Recebe `?code=...&state=...` do redirect do ML (sem problemas de hash router)
2. Valida o `state` contra o que foi armazenado quando o fluxo começou (proteção CSRF)
3. Troca o `code` por `access_token` + `refresh_token` chamando `POST https://api.mercadolibre.com/oauth/token` (com `client_secret`, que **só existe no servidor**)
4. Armazena os tokens criptografados no Supabase Vault (associados ao `user_id`)
5. Redireciona o navegador para o frontend em uma rota como `https://ean2marketplace-frontend.onrender.com/#/configuracoes?ml_conectado=true`

A app no portal ML é registrada agora (2026-05-27) mesmo que a função ainda não exista — o portal aceita a URL pela sintaxe, sem fazer health check.

## Alternativas consideradas

### A. URL do frontend com HashRouter — `https://...onrender.com/#/ml-callback`
- **Pros:** Sem código backend extra
- **Cons:**
  - Querystring depois do `#` vira fragment, comportamento não-padrão
  - `client_secret` precisaria ser exposto no JavaScript do browser (inviável para confidential client) OU exigiria um endpoint backend mesmo assim para a troca de token → não simplifica de verdade
  - PKCE seria necessário se quiséssemos público client puro, e a app foi registrada como confidential
- **Rejeitada** principalmente por causa do problema do client_secret

### B. URL do frontend com BrowserRouter — `https://...onrender.com/ml-callback`
- **Pros:** Querystring funciona normal
- **Cons:**
  - Render Static Site não consegue servir rotas profundas corretamente (motivo histórico da escolha de HashRouter); reverter implicaria rever a estratégia de hosting do M0
  - Mesma questão do `client_secret`: o frontend não pode chamar `/oauth/token` com secret sem expor → sempre precisaria de backend mesmo
- **Rejeitada**

### C. Edge Function do Supabase como callback (escolhida)
- **Pros:**
  - URL estática, simples, não depende do roteamento do frontend
  - `client_secret` fica no servidor (Supabase secrets) durante a troca de token
  - Tokens já gravam direto no Supabase Vault na mesma função (sem viagem desnecessária pelo navegador)
  - Mesmo padrão que outros provedores recomendam para SPAs (auth via backend, sessão criptografada do lado servidor)
  - Funciona idêntico em dev local e prod — não precisa de URL diferente por ambiente
- **Cons:**
  - Mais uma Edge Function pra escrever (~80 linhas no M4)
  - Latência extra de 1 hop (browser → edge function → frontend), mas usuário só sente uma vez no momento da conexão inicial
- **Aceita**

## Consequências

**Boas:**
- M4 implementa `ml-oauth-callback` como Edge Function com `verify_jwt: false` (chamada vem do redirect público do ML, não de user)
- Token storage usa o helper Vault já existente (`storeMlTokens(user_id, access, refresh)`)
- Sessão do usuário no app não muda — ele só vê "conectado ao ML" como um booleano em Configurações
- Não há `client_secret` no bundle JavaScript do frontend (segurança)

**Tradeoffs aceitos:**
- Acoplamento entre fluxo OAuth e infraestrutura Supabase. Se um dia trocarmos de BaaS, a URL muda e exige reconfigurar a app no portal ML
- Diego não pode testar OAuth contra a app de produção em `localhost:5173` sem expor o callback via tunnel (ngrok, cloudflared). Para dev local, criar uma segunda redirect URI seria possível — mas ML só permite uma URI por app. Solução: usar a função de prod mesmo para teste local; o redirect final do callback pode mandar pra `localhost` quando o `state` indicar dev

## Implementação no M4

Esboço da Edge Function (será detalhado no plano do M4):

```ts
// supabase/functions/ml-oauth-callback/index.ts
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // 1. validar state contra Redis/DB
  // 2. POST https://api.mercadolibre.com/oauth/token
  //    body: grant_type, client_id, client_secret, code, redirect_uri
  // 3. salvar access_token + refresh_token no Vault (com user_id do state)
  // 4. redirect 302 → https://ean2marketplace-frontend.onrender.com/#/configuracoes?ml_conectado=true
});
```

## Como reverter

Se um dia for desejável ter o callback no frontend (ex: depois de migrar para BrowserRouter):

1. Mudar a redirect URI no portal ML para `https://...onrender.com/ml-callback`
2. Criar rota React `/ml-callback` que extrai o code da querystring
3. Chamar uma Edge Function `/exchange-ml-code` (que continua precisando existir, só pra trocar code por token com o secret)
4. Apagar a função `ml-oauth-callback`

O esforço é de poucas horas. Por hora, manter o padrão atual.
