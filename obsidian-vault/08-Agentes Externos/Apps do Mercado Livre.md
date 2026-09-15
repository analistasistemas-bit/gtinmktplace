---
tags: [agentes-externos, oauth, mercado-livre]
atualizado: 2026-09-14
---

# Apps do Mercado Livre

Registro das aplicações OAuth criadas no portal `developers.mercadolivre.com.br`, todas
autorizadas na mesma conta de vendedor (**AVILBV**). Ver [[Agentes Externos]].

> **Credenciais não vivem aqui.** Este repositório é público. `client_id` e `client_secret` do
> PubliAI ficam em `.env.local` (gitignored) e nos secrets do Supabase. Os dos agentes externos
> ficam no próprio agente.

## Aplicações

| App | Dono | Escrita? | Observação |
|---|---|---|---|
| PubliAI | o produto | sim | `ML_CLIENT_ID` / `ML_CLIENT_SECRET`; tokens em `marketplace_connections` |
| Muse — atendimento | agente externo | sim | ver [[Muse (AVILBV)]] |

## Por que apps separados

Autorizar um app **não** invalida o token de outro: cada aplicação tem sua própria cadeia de
tokens, mesmo na mesma conta de vendedor. Foi verificado antes de criar o app do Muse — o
PubliAI não sofreu interrupção.

O inverso é o que quebra: **duas cópias do mesmo `refresh_token`**. O ML rotaciona a credencial
a cada renovação e invalida a anterior no mesmo instante. Dois processos renovando com o mesmo
refresh → `invalid_grant` e volta a exigir autorização manual.

## Configuração de um app novo

**Fluxos OAuth**

- ✅ Authorization Code
- ✅ **Refresh Token** — sem isso o access_token morre em 6h e o agente reautoriza para sempre
- ⬜ Client Credentials — o PubliAI não usa
- ⬜ PKCE — obriga o cliente a implementar `code_challenge`

**Negócios:** marcar **Mercado Livre**. `VIS` não.

**URI de redirect:** o ML **rejeita** o próprio domínio (`mercadolivre.com.br`).
`https://www.google.com/` com barra no fim funciona para captura manual do `code`.

**Notificações:** deixar a URL de callback vazia e não assinar tópico algum, salvo se o agente
tiver de fato um endpoint HTTP. Tópicos são por app — não assinar aqui não afeta os webhooks
que o PubliAI já recebe.

## Permissões por perfil de agente

O ML não separa por operação: "Publicação e sincronização → Leitura e escrita" é a **mesma**
permissão que cria, exclui, pausa e altera estoque e preço. Logo, a granularidade real vem de
criar apps diferentes.

| Perfil | Publicação | Comunicações | Métricas / Publicidade | Vendas e envios |
|---|---|---|---|---|
| Relatórios | Sem acesso | Sem acesso | Leitura | Leitura |
| Atendimento | Sem acesso | Leitura e escrita | Sem acesso | Leitura |
| Fotos | Leitura e escrita | Sem acesso | Sem acesso | Sem acesso |

"Usuários" fica em Leitura e escrita em qualquer perfil (é o acesso básico à conta).

## Autorização manual

```
https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=<APP_ID>&redirect_uri=https://www.google.com/&state=x
```

O `code` aparece na URL de retorno, vale ~10 minutos e é de **uso único**. Trocar por token:

```bash
curl -X POST https://api.mercadolibre.com/oauth/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=authorization_code' \
  -d 'client_id=<APP_ID>' -d 'client_secret=<SECRET>' \
  -d 'code=<CODE>' -d 'redirect_uri=https://www.google.com/'
```

**Confira o `client_id` do link antes de autorizar.** Autorizar com o `client_id` do PubliAI
derruba o token de produção.

## Cortar o acesso de um agente

1. `mercadolivre.com.br` → Configurações da conta → **Aplicações autorizadas** → remover.
2. Ou resetar a Secret Key do app no portal — mata só aquele app.

Nenhuma das duas afeta o PubliAI, que é uma aplicação distinta.
