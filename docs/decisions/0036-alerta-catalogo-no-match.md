# ADR-0036 — Alerta proativo de variação sem ficha de catálogo (no-match)

**Status:** Aceito
**Data:** 2026-06-22
**Relacionado:** [ADR-0021](0021-vinculacao-automatica-ao-catalogo-ml.md) (opt-in de catálogo), `project_incidente_catalogo_kit`, `reference_ml_catalogo_nao_encontro_variacao`, `vincular-catalogo`, `_shared/ml/catalogo.ts`, `_shared/notificacoes/telegram.ts`, `monitorar-moderados`

## Contexto

O ML passou a exigir, em algumas categorias, que o anúncio seja **associado ao catálogo** para continuar vendendo. Num anúncio multi-variação, se UMA variação não tem ficha de catálogo equivalente (ex.: linha Xik Preto, cujo GTIN só existe numa ficha de **kit de 10 cones**), e ela fica sem associação, o ML **pausa o anúncio inteiro** depois (`under_review`/`waiting_for_patch`, "Inativo para revisar").

A forma de manter o anúncio ativo é declarar **"Não encontro minha variação"** para a variação sem ficha (a variação não compete, mas o anúncio sobrevive). Investigação (2026-06-22, captura DevTools): essa ação é um endpoint **interno do site web** (`PATCH .../produzir/catalogo/api/optin-up/<item>/multivariation_matcher_confirm`), autenticado por **cookie de sessão + CSRF** — **não há equivalente na API pública OAuth** que o worker usa. O mecanismo é enviar `catalog_product_id: null` para a variação, mas só por aquele endpoint web.

Conclusão: o backend **não consegue executar** o "não encontro" automaticamente. A trava `fichaEquivalente` (ADR-0021 pós-incidente) já evita corretamente vincular à ficha-kit, mas deixa a variação como `ficha_divergente`/`sem_produto` — e aí o anúncio pausa dias depois, pegando o operador de surpresa.

## Decisão

Como não dá para automatizar o clique, **alertar o operador proativamente** no momento da publicação — antes de o ML pausar.

No worker `vincular-catalogo` (que roda minutos após o CREATE, quando a elegibilidade do ML já computou), após o opt-in:
- `deveAlertarCatalogoNoMatch(resumo)` (função pura em `_shared/ml/catalogo.ts`): retorna `true` quando `pendente === 0` (estado final) e há `ficha_divergente > 0` ou `sem_produto > 0`. Esperar `pendente === 0` evita alerta prematuro/repetido nos retries.
- Se sim e o Telegram do usuário estiver ativo (mesma config de `monitorar-moderados`), envia `montarMensagemCatalogoNoMatch` (função pura em `_shared/notificacoes/telegram.ts`): título do anúncio, cores afetadas, consequência (pode pausar) e o passo manual, com **link direto** para `mercadolivre.com.br/produzir/catalogo/<item>`.
- Best-effort: falha de Telegram não derruba o opt-in (que já assentou).

## Consequências

- O operador é avisado **no momento da publicação**, com 1 clique para resolver, em vez de descobrir o anúncio pausado dias depois.
- Não automatiza o "não encontro" (impossível via OAuth) — é semi-automático por necessidade técnica.
- Idempotência por estado final (`pendente === 0`): 1 alerta por publicação; republicação (UPDATE) realerta, o que é desejável.
- Reusa a infra de Telegram existente; sem alerta se o usuário não configurou (no-op).
- **Follow-up:** investigar se a API pública de **User Products** (OAuth) expõe um equivalente ao no-match; se sim, trocar o alerta por automação real.
- Deploy: `vincular-catalogo`.

## Nota de revisão (2026-08-12) — o gate `pendente === 0` sai

O alerta desenhado aqui **nunca disparava** nos casos que mais importavam. `deveAlertarCatalogoNoMatch`
exigia `pendente === 0`, e a rodada com `pendente > 0` devolvia 500 para o retry curto do QStash;
esgotado o retry, a família ficava congelada em `pendente` e o estado final nunca chegava. Silêncio
duplo: nem vinculava, nem avisava. Foi assim que os anúncios apareceram no painel do ML como
"Próximos a serem pausados" sem nenhum aviso do PubliAI (93 famílias / 296 variações, 2026-08-12).

**Mudanças:**
- `deveAlertarCatalogoNoMatch` deixa de exigir `pendente === 0` e passa a contar `pendente` residual.
- A garantia de "1 alerta por publicação" **não some** — ela deixa de morar nessa função e passa a
  ser o gate de finalização no worker: o alerta só é avaliado quando a rodada finaliza, e rodadas
  intermediárias reagendam sem alertar. O que mudou foi o critério de finalizar (ADR-0021, revisão
  2026-08-12), não a regra de alertar uma vez.
- Novo motivo `elegibilidade_nao_resolvida` em `decidirMotivoAlertaCatalogo` e em
  `montarMensagemCatalogoNoMatch`, para o caso de `pendente` sobreviver até a última tentativa.
- `pendente` entra nos filtros de cores do worker (Legacy e UP) — sem isso o alerta novo sairia com
  a lista de cores vazia.
- O worker passa a honrar `alertar: false` no body do job, para o backfill das famílias congeladas
  rodar sem disparar dezenas de mensagens. O campo é propagado nos reagendamentos e morre com a
  cadeia — sem estado em tabela e sem flag para esquecer ligada.

Segue valendo o essencial: não há endpoint OAuth para o "Não encontro minha variação"
(reverificado em 2026-08-12 — o PATCH interno responde `403 EBADCSRFTOKEN` mesmo com Bearer válido),
então o alerta continua sendo semi-automático por necessidade técnica. O follow-up de trocar o
alerta por automação real virou a Fase 3 da spec (extensão de navegador).

Spec: `docs/superpowers/specs/2026-08-12-catalogo-em-risco-design.md`.

## Nota de revisão (2026-07-15)

O alerta também cobre `nao_elegivel` esgotado e `sem_variation_id`. Para `nao_elegivel`, ele só
dispara após a última tentativa do retry limitado. `sem_variation_id` é estrutural e não entra em
retry: na ausência de `pendente`, alerta na finalização imediata da primeira rodada. A mensagem
diferencia a elegibilidade esgotada dos demais casos pelo campo `motivo`.
