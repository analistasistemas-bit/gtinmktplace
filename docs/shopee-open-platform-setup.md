# Trilho — Abertura da conta Shopee Open Platform (E5)

> Checklist operacional para o Diego abrir a conta/app da Shopee, no formato que o conector do E5 vai consumir. Espelha o "Trilho App Mercado Livre Developers" (ADR-0011 redirect via edge function, ADR-0012 refresh com lock Redis).

**Status:** ⬜ Não iniciado
**Responsável:** Diego (manual, fora do ambiente de dev)
**Bloqueia:** apenas o teste real de OAuth/publicação do E5 (ver "Quando isto vira bloqueante"). Design, ADR, spec, plano e o código do conector (com mocks/sandbox) andam sem isto.

---

## 1. Conta de vendedor (seller) na Shopee Brasil

- [ ] Ter/confirmar a **loja de vendedor** que receberá os anúncios (Daludi/AVIL). É ela que será *autorizada* no app — o app publica nos anúncios dessa loja, igual ao ML.

## 2. Conta de desenvolvedor + App na Open Platform

- [ ] Registrar-se no **Shopee Open Platform Console** → https://open.shopee.com
- [ ] Criar um **App** e obter os dois segredos que são o coração da integração:
  - **`partner_id`** — equivalente ao Client ID do ML
  - **`partner_key`** — equivalente ao Client Secret; usado para **assinar toda request** com HMAC-SHA256
- [ ] Atenção ao tipo de app:
  - **Test App** → ambiente sandbox (destrava nosso desenvolvimento sem loja real)
  - **Live App** → produção; pode exigir **submissão/aprovação** (item com possível *lead time* — começar cedo)

## 3. Configuração do App

- [ ] **Redirect/Callback URL** apontando para uma edge function nossa (mesma decisão do ADR-0011 para o ML). Usar exatamente:

  ```
  https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/shopee-oauth-callback
  ```

  *(a função `shopee-oauth-callback` ainda não existe; faz parte da implementação do E5 — mas o app precisa já apontar para essa URL)*

- [ ] **Permissões/escopos** a marcar (mínimo para publicar):
  - **Product/Item** (leitura + escrita)
  - **Media Space** (upload de imagem)
  - **Logistics** (canais de envio — a Shopee exige no item)
  - **Public** (categorias/atributos)
  - **Shop** (info da loja)
  - *(sem pedidos/financeiro — o PubliAI não toca nisso)*

- [ ] **Região: Brasil.**
  - Host de produção: `partner.shopeemobile.com`
  - Host sandbox: `partner.test-stable.shopeemobile.com`

## 4. Guardar credenciais (como no ML)

- [ ] Salvar em `.env.local` (gitignored), nomes padronizados para o conector:
  - `SHOPEE_PARTNER_ID`
  - `SHOPEE_PARTNER_KEY`
  - `SHOPEE_REDIRECT_URI` (= a callback acima)
  - `SHOPEE_HOST` (prod ou sandbox)
  - *(depois vão para o Supabase Vault, como `ML_CLIENT_ID/SECRET`)*

## 5. O que NÃO precisa fazer agora (é implementação — o dev cuida)

- Autorizar a loja (fluxo `auth_partner` → devolve `shop_id` + `code`), trocar `code` por `access_token`/`refresh_token`, e o refresh.
- **Para o design:** `access_token` dura **4h**; `refresh_token` dura **~1 mês** → o conector vai reaproveitar o padrão de refresh proativo com lock Redis do ADR-0012.

---

## Resumo: o que destrava o quê

| Item | Necessário para |
|---|---|
| `partner_id` + `partner_key` | assinar qualquer chamada (sandbox ou prod) |
| App Test | desenvolver/testar o conector contra **sandbox** sem loja real |
| App Live + loja autorizada | publicar **de verdade** na loja Shopee BR |

## Quando isto vira bloqueante

O E5 avança em paralelo sem a conta até o ponto de **integração real**:

1. **Não bloqueia:** brainstorming, ADR-0029, spec, plano, e o código do conector (`shopeeConnector`) com testes unitários por mocks/fixtures.
2. **Bloqueia (precisa pelo menos do Test App + `partner_id/partner_key`):** primeiro teste de assinatura/host contra o sandbox da Shopee.
3. **Bloqueia (precisa do Live App + loja autorizada):** OAuth real, publicação de anúncio de verdade e leitura de status na loja BR.

> O dev avisa quando o desenvolvimento chegar no item 2/3 e a conta passar a ser pré-requisito.

---

## Notas técnicas (referência rápida da API)

- **Assinatura (HMAC-SHA256 com `partner_key`)**, base string por tipo de API:
  - **Public:** `partner_id + path + timestamp`
  - **Shop:** `partner_id + path + timestamp + access_token + shop_id`
  - **Merchant:** `partner_id + path + timestamp + access_token + merchant_id`
- Toda request precisa de `timestamp` válido (janela de **5 min**).
- URL de autorização da loja: `GET /api/v2/shop/auth_partner?partner_id=...&timestamp=...&sign=...&redirect=<callback>` → redireciona para o callback com `?code=...&shop_id=...` (link válido por 5 min).

**Fontes:** [Shopee Open Platform — Developer Guide (sign/HMAC, parâmetros comuns)](https://open.shopee.com/developer-guide/16) · [Shopee OpenAPI auth flow (shop_id, access_token 4h / refresh 1 mês)](https://wendeehsu.medium.com/shopee-openapi-handsup-e0daca280f75)
