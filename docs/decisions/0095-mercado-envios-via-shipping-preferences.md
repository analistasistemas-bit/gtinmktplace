# ADR-0095 — Mercado Envios (me2) detectado via shipping_preferences, não status.mercadoenvios

**Data:** 2026-07-30
**Status:** aceito, implementado (PRs #37, #38, #39)
**Relacionado:** [ADR-0050](0050-frete-no-gross-up-preco-proprio.md) (frete best-effort no gross-up),
[ADR-0027](0027-multi-tenancy-organizations.md) (`marketplace_connections` por org)

## Contexto

Investigando por que o frete (vendedor) na Viabilidade saía R$0 pra conta DSA ($ANALISTA$,
`ml_user_id` 9757132) mesmo com o preço na faixa de frete grátis do ML: `buscarFreteVendedor`
(`_shared/ml/frete.ts`) é best-effort (ADR-0050) e devolve 0 em qualquer falha, silenciosamente.
`GET /users/9757132/shipping_options/free` respondia **400 "does Not have me2 enabled"** — a conta
nunca tinha aderido ao Mercado Envios.

O campo óbvio pra checar isso seria `GET /users/{id}` → `status.mercadoenvios`. Ao vivo, esse campo
continuou `"not_accepted"` **minutos depois** de Diego ativar o Mercado Envios pelo painel do
vendedor, enquanto `GET /users/{id}/shipping_options/free` já respondia 200 com `list_cost` normal —
confirmado por um subagente de verificação dedicado. Ou seja, `status.mercadoenvios` fica
desatualizado por um tempo após a adesão real; não é fonte confiável em tempo real.
`GET /users/{id}/shipping_preferences` → `"me2"` presente em `modes` refletiu a mudança
imediatamente, no mesmo instante em que o frete voltou a funcionar.

## Decisão

Detectar "a conta tem Mercado Envios habilitado" por `shipping_preferences.modes.includes('me2')`,
**nunca** por `status.mercadoenvios`. `ml-oauth-claim` chama esse endpoint no momento da conexão
(OAuth) e grava `marketplace_connections.me2_habilitado` (boolean; `null` = não checado/best-effort
— migration `20260730185835_marketplace_connections_mercadoenvios.sql`).

Quando `false`:
- Tela **Canais** avisa junto do card da conexão ML.
- Cada análise da **Viabilidade** (`analisar-viabilidade` devolve `me2Habilitado` na resposta)
  mostra um banner explicando que o frete de todos os itens da análise saiu R$0 por falta de
  adesão — não porque o frete real é zero.

## Alternativas consideradas

- **Checar `status.mercadoenvios` de `GET /users/{id}`** — descartado: confirmado ao vivo que fica
  desatualizado por um tempo após a adesão real, geraria falso-negativo (aviso persistindo depois
  de resolvido).
- **Chamar `buscarFreteVendedor` de verdade (com preço/categoria de teste) pra inferir o estado** —
  descartado: exige um preço/categoria plausíveis sem contexto de produto real no momento da
  conexão; `shipping_preferences` não precisa de nenhum desses parâmetros.
- **Tentar aderir ao Mercado Envios programaticamente em nome do vendedor** — descartado: é aceite
  de termos de uso do Mercado Livre, decisão do dono da conta. Não existe endpoint público de
  "aceitar"; mesmo que existisse, automatizar aceite de ToS sem revisão humana é o tipo de atalho
  que este projeto evita (mesmo racional do achado de
  [[reference_ml_catalogo_nao_encontro_variacao]] no ADR-0021: achar o caminho técnico não é
  licença pra automatizar uma ação sensível de conta).

## Escopo e guardas

- Só grava no momento da **conexão** (OAuth claim); conexões já existentes ficam `null` até
  reconectar. Backfill manual feito uma vez pras 2 conexões vigentes no momento (Avil e DSA, ambas
  `true` confirmadas ao vivo direto na API).
- Best-effort: falha na chamada de `shipping_preferences` → `null`, nunca bloqueia a conexão.

## Consequências

- Aviso visível em vez de frete R$0 mudo — o operador entende a causa sem precisar debugar.
- Conexões antigas (`me2_habilitado = null`) não mostram aviso nenhum até reconectar — não é
  falso-negativo pior que o comportamento anterior a este ADR (frete R$0 sem explicação nenhuma),
  mas também não é um positivo confirmado.

## Como reverter

Remover as leituras de `me2Habilitado`/`me2_habilitado` em `Canais.tsx`, `Viabilidade.tsx` e
`analisar-viabilidade/index.ts`, e a chamada a `buscarMe2Habilitado` em `ml-oauth-claim`. A coluna
pode ficar (nullable, não quebra nada) ou ser dropada numa migration própria.

## Adendo 2026-07-31 — refresh de token zerava `me2_habilitado` a cada ~6h

Investigando "Viabilidade da DSA não recalcula o frete" (a mecânica de recálculo estava correta —
`buscarFreteVendedor` usa mesmo as dimensões informadas, confirmado ao vivo com o token real da
conta 9757132: `list_cost` variou com dimensão maior, e ficou igual pro item testado só porque
84,99/50ml cai na mesma faixa da tabela do ML pro pacote genérico e pro real, até ~2kg), achado um
bug de verdade: `gravarRotacaoConexao` (`_shared/ml/token.ts`), chamada a **cada refresh de token**
(o access token do ML dura ~6h), reescreve a conexão via `upsert_marketplace_connection` sem passar
`p_me2_habilitado`. A função SQL usa `default null` e o branch de UPDATE grava
`me2_habilitado = p_me2_habilitado` incondicionalmente — ou seja, todo refresh apagava de volta pra
`null` o valor gravado na conexão (pelo claim OAuth ou por um backfill manual), silenciosamente.
Achado ao vivo: a conexão da DSA foi backfillada `true` em 2026-07-30, tinha `atualizado_em` de
2026-07-31 (refresh de token do dia) e `me2_habilitado` já estava `null` de novo — mesmo com
`shipping_preferences.modes` incluindo `me2` e o frete real funcionando (`GET
.../shipping_options/free` 200, `list_cost` coerente).

**Fix:** `gravarRotacaoConexao` agora relê `me2_habilitado` junto com os outros campos preservados
(`conta_externa_id`/`conta_label`/`scope`/`criado_por`) e repassa pro upsert. Regressão coberta em
`_shared/ml/__tests__/token-refresh-me2.test.ts`.

Efeito prático do bug: o aviso "sua conta não aderiu ao Mercado Envios" (quando `me2_habilitado`
está `false`) tende a nunca aparecer de forma estável — vira `null` de novo no próximo refresh,
mascarando o "false" real. Não chega a ser pior que o comportamento pré-ADR-0095 (nunca dava aviso
nenhum), mas esvaziava o objetivo do ADR de forma silenciosa e periódica, não só nas conexões antigas
que nunca reconectaram.
