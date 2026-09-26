# ADR-0171 — Renovação proativa do token ML fora da virada da hora

**Status:** Aceito
**Data:** 2026-09-26
**Relacionado:** [ADR-0012](0012-refresh-token-oauth-ml-com-lock-redis.md) (refresh com lock Redis — continua valendo),
[ADR-0006](0006-qstash-em-vez-de-postgres-queue.md) (QStash),
[ADR-0170](0170-central-de-promocoes-ml.md) (Central de Promoções, onde o problema apareceu)

## Contexto

Em 2026-09-26 a Central de Promoções da DSA falhou três rodadas seguidas (00:00, 06:00 e 12:00 UTC) com
`ML /oauth/token 429: Rate limiter grant_type refresh_token was exceeded`. O último sync bom foi às 18:00 UTC
da véspera.

O mecanismo, medido no QStash e em `marketplace_connections`:

1. O refresh do ADR-0012 é **preguiçoso**: só acontece quando algum worker encontra o token a menos de 5 min
   de vencer.
2. Os crons se concentram na virada da hora: `sincronizar-promocoes`, `pulse-coletar` e `monitorar-moderados`
   em `0 */6`, `reconciliar-faturamento` em `0 *` e `reconciliar-convergencia-up` em `*/15`.
3. Então quem renova é sempre um worker da virada, e o token (6h de vida) passa a vencer de novo na virada.
   Às 12:00:02 a Daludi Shop renovou, às 12:00:04 o ML devolveu 429 para a DSA, e às 12:00:06 outro worker
   renovou a DSA com sucesso. O ciclo se repete a cada 6h, e qualquer org nova cai nele.
4. `sincronizar-promocoes` gravava `erro` e respondia 200, então o QStash não tentava de novo, e a tela ficava
   6h sem dados.

Mudar o horário de um cron (feito à mão em 26/09: promoções passou para `10 */6`) só tira aquele worker da
corrida. Não resolve para os outros workers nem para orgs novas.

## Decisão

1. **Worker novo `renovar-tokens-ml`** (QStash, `verify_jwt = false`, só aceita assinatura QStash), schedule
   **`40 * * * *`**, o único minuto livre de `*/15`, `30 6`, `30 12` e `10 */6`. Ele renova as conexões
   `mercado_livre` com token **ainda válido** e `expires_at` a menos de **165 min**, ordenadas por `expires_at` asc,
   **uma por vez e com 2 s de pausa entre elas**. Com token de 6h, cada conexão é renovada a cada ~4h, sempre
   perto de :40. Os workers da virada encontram o token com folga e não renovam. Se uma renovação falhar, ainda
   há outra tentativa antes de o token vencer. O limite de 165 min, e não 150, evita empate exato com a grade
   :00/:30.
2. **O rate limit de refresh do ML é por app (`client_id`), não por conta**: às 12:00:02 a Daludi renovou e às
   12:00:04 a DSA levou 429. Por isso a pausa entre conexões, e **um 429 encerra a rodada**. As demais conexões
   ficam para a hora seguinte.
3. **Token já vencido ou `expires_at` nulo fica fora** do renovador. Isso inclui conexão morta (`invalid_grant`),
   que é assunto do caminho preguiçoso e da reconexão em Canais. Assim uma conexão morta não gasta cota do app
   de hora em hora.
4. **`renovarTokenConexao(conexao, limiteMs)` em `_shared/ml/token.ts` é só adicionada**, com o mesmo lock
   `lock:token:refresh:{id}` do ADR-0012. Sem o lock, pula a conexão. Com o lock, **relê o token** e só renova se
   ainda estiver dentro do limite. `getValidAccessTokenConexao` e as constantes existentes **ficam byte-idênticas**:
   continuam sendo a rede de segurança preguiçosa (conexão recém-criada, renovador fora do ar). Por isso as
   funções já deployadas não precisam de redeploy.
5. **Na etapa `lista` de `sincronizar-promocoes`, uma falha de conexão devolve 500 só no ramo QStash.** O fan-out
   tem `retries: 1`, então o QStash tenta mais uma vez uns 12 s depois. Isso cobre um tropeço de rede, não um 429
   longo: quem resolve o 429 é o item 1. O estado `erro` continua sendo gravado. O caminho "Atualizar agora" não
   muda.
6. **O renovador trata cada conexão com try/catch (inclusive Redis) e sempre responde 200.** Um 500 no top-level
   faria o QStash repetir a rodada inteira contra `/oauth/token`.

### Operação (fora do git)

Schedules do QStash não são versionados:
- `renovar-tokens-ml`: `40 * * * *`, body `{}`, criado no deploy deste ADR.
- `sincronizar-promocoes`: mudou de `0 */6` para `10 */6 * * *` à mão em 2026-09-26
  (schedule `scd_5FKHhPTKCNtqp31W8nruJdVCLCRm`).

## Consequências

- Refresh sai da virada da hora para todas as orgs, inclusive as futuras, sem configuração por org.
- Uma renovação a cada ~4h por conexão, em vez de ~6h: é pouca chamada a mais e fica bem abaixo do rate limit
  do ML.
- Mais um schedule QStash para manter (`renovar-tokens-ml`, `40 * * * *`).
- Se o renovador parar, o sistema volta ao comportamento anterior (refresh preguiçoso do ADR-0012). Degrada,
  mas não quebra.
