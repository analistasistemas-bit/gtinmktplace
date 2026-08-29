# ADR-0134 — Alerta de estoque zerado e de volta ao ar

**Status:** Aceito
**Data:** 2026-08-25
**Relacionado:** [ADR-0094](0094-estoque-unico-cadastro-manual.md) (push absoluto),
[ADR-0111](0111-reativacao-automatica-ao-repor-estoque.md) (reativação na reposição),
[ADR-0068](0068-notificacoes-telegram-por-destinatario-e-categoria.md) (categorias),
[ADR-0085](0085-notificacao-in-app.md) (notificação in-app), [ADR-0035](0035-monitoramento-anuncios-moderados.md)

## Contexto

Quando o estoque de um produto acaba, o push absoluto manda `0` ao canal e o ML pausa o anúncio
(`paused` + `out_of_stock`). Hoje isso é **silencioso**: o operador só descobre abrindo Publicados
ou reparando que o produto sumiu da busca. A reposição também é silenciosa — o
`reativarSePausado` devolve o anúncio ao ar sem dizer nada.

O pedido (Diego, 25/08/2026) veio junto do incidente do alerta falso de moderação: o que ele quer
saber é justamente o que estava faltando — "o estoque acabou e o anúncio foi pausado".

## Decisão

Duas notificações novas, na categoria nova **`estoque`** (Telegram + in-app, mesma infra do
ADR-0068/0085), emitidas pelo worker `sincronizar-estoque`, que é onde o saldo chega ao canal.

### 1. Estoque zerado

Dispara por **variação** (decisão do operador: também quando uma cor/SKU acaba, não só quando o
produto inteiro zera). A mensagem agrupa as variações zeradas do mesmo produto e distingue os dois
casos:

- todas as variações em zero → "anúncio pausado no Mercado Livre";
- restam outras variações → "o anúncio segue no ar sem essa variação".

**Fonte da transição:** `estoque_movimentos` (`estoque_anterior > 0 AND estoque_resultante = 0`).
Estado atual não serve — `variacoes.estoque = 0` não diz *quando* zerou e re-alertaria a cada push.

**Dedup:** coluna nova `estoque_movimentos.alertado_em`, marcada com `UPDATE … WHERE alertado_em IS
NULL RETURNING id`. Só o que a marcação devolve é notificado, então a reentrega do QStash (o push é
idempotente e repete de propósito) não duplica o aviso.

**Ordem:** o alerta sai **depois** do push, e só quando nenhum alvo ficou retentável — avisar
"anúncio pausado" antes de o canal receber o zero seria mentira. Com retry pendente, o aviso sai na
retentativa.

**Produto sem anúncio publicado:** os movimentos são marcados como alertados **sem enviar nada**.
O critério é *existir anúncio publicado*, não *haver alvo neste push*: na venda o job carrega o
canal onde ela ocorreu e `resolverAlvosPush` o exclui (aquele canal já se decrementou sozinho), de
modo que com um único canal publicado — o caso de produção hoje — a lista de alvos fica vazia
exatamente quando o anúncio acabou de ser pausado por falta de estoque.
Sem isso, publicar um produto velho dispararia de uma vez a história inteira de zeradas antigas —
o mesmo erro que o alerta de cancelamento cometeu no primeiro run (ADR-0121).

### 2. Volta ao ar

Quando `reativarSePausado` de fato reativa (leu `pausado` e o `PUT status=active` deu certo),
avisa que o anúncio voltou. A transição é a própria dedup: na reentrega o anúncio já está `ativo`,
não há reativação e nada é enviado. Uma mensagem por produto, não por item — uma família user
products reativa N itens filhos no mesmo run. O aviso sai **antes** do eventual 500 por alvo
retentável: o `PUT` já aconteceu, e na retentativa não haveria mais nada a reativar.

### Assinatura

`estoque` entra em `CATEGORIAS_NOTIFICACAO` (Deno e front). Backfill: quem já assina `moderacao`
passa a assinar `estoque` — é o mesmo público que quer saber de anúncio fora do ar. Quem não
assinar não recebe, como em qualquer categoria.

## Alternativas descartadas

- **Alertar na baixa de estoque (`_shared/estoque/baixa.ts`)**: a baixa acontece antes de o canal
  saber; o anúncio ainda não está pausado nesse instante.
- **Polling de status (como o `monitorar-moderados`)**: 6h de latência para um evento que o próprio
  sistema causa e sabe na hora.
- **Sem coluna de dedup, comparando com a última notificação gravada**: casar por texto é frágil e
  quebra quando a mensagem muda.

## Consequências

- O operador passa a receber o aviso no momento em que o anúncio sai do ar por falta de estoque, e
  a confirmação de que voltou ao repor.
- Uma coluna a mais em `estoque_movimentos` (`alertado_em`), preenchida pelo worker.
- Volume: um alerta por variação zerada (agrupado por produto no mesmo push). Produto com muitas
  cores acabando junto gera uma mensagem só.
- `sincronizar-estoque` passa a ler `familias.nome_pai`/`ml_permalink` e `variacoes.nome/cor` para
  compor o texto — leitura a mais no caminho do push, sem escrita nova além da marca de alerta.
