# ADR-0168 — Remover publicado: encerra no ML só sem venda; com venda bloqueia os dois lados

- **Status:** aceito
- **Data:** 2026-09-19
- **Emenda:** [ADR-0019](0019-exclusao-lote-preserva-publicados.md) §7 (“Remover do sistema” = só local, ML intocado)
- **Emenda:** [ADR-0088](0088-publicacao-user-products-multi-item.md) (remoção UP = pausar filhos, nunca deletar no ML)
- **Relaciona:** ADR-0060 (status ML), ADR-0154 D-8 (`closed` em Kit Virtual), ADR-0113 (exclusão Estoque)

## Contexto

O botão **Remover** em Publicados (edge `remover-publicado`, `preservar_familia=false`) apagava o vínculo no PubliAI e, no melhor caso UP, só **pausava** os itens no Mercado Livre. O diálogo avisava: “O anúncio no ML continua ativo.”

O operador pediu o contrário operacional: o **mesmo botão** deve remover de verdade nos dois lados quando o anúncio **não tem movimentação no ML**; se tem, **não remove em nenhum dos dois**.

## Decisão

### D-1. Critério de “movimentação” = `sold_quantity > 0` no ML

Fonte: `GET /items/{id}` (atributo `sold_quantity`), ao vivo, antes de qualquer escrita.

Escopo dos ids a consultar:

| Formato | Ids |
|---|---|
| Legacy | `familias.ml_item_id` |
| User Products | `familias.ml_item_id` (se houver) + **todos** os `anuncios_externos_itens.item_externo_id` não nulos do `codigo_pai` no canal |

Se **qualquer** id tiver `sold_quantity > 0` → resultado `tem_movimentacao` → **zero** mutação no ML e **zero** delete local.

404/410 no GET = item já inexistente → trata como “sem venda” para aquele id (não bloqueia; não precisa fechar).

Erro de rede/5xx/token no GET → aborta **antes** de escrever (fail-closed); operador tenta de novo.

### D-2. Sem venda: encerra + apaga no ML, depois limpa PubliAI

Para cada id vivo (`active` / `paused` / outros não-terminais):

1. `PUT /items/{id}` `{ "status": "closed" }` (primitiva já existente: `atualizarStatusML(..., 'closed')`).
2. `PUT /items/{id}` `{ "deleted": "true" }` (novo helper; doc oficial ML — delete permanente após close).
3. Confirmar por GET: 404/410, ou `sub_status` deleted/forbidden, ou status `closed` (terminal — o ML às vezes atrasa o sub_status `deleted`).
4. 409 optimistic locking no 2º PUT → retry curto (1–2×) e, se falhar, **não** deleta local.

Só depois de **todos** os ids confirmados encerrados/sumidos: roda o delete local atual (Storage, `familias`, `anuncios_externos`, `limparMovimentosOrfaos`, recontar lotes).

Substitui a mini-saga UP de **só pausar** no caminho Remover (`preservar_familia=false`). Pausar deixa o anúncio recuperável; o pedido é excluir.

### D-3. Com venda: bloqueio duro, mensagem clara

HTTP 409, corpo `{ erro, tipo: 'tem_movimentacao' }`. Texto ao operador: o anúncio teve venda no Mercado Livre — não pode ser removido pelo PubliAI nem encerrado por este botão. Nada foi alterado.

### D-4. `preservar_familia=true` (Republicar) **não muda** neste ADR

Republicar continua pausando (quando `active`) e zerando vínculo local — é outro fluxo (reCREATE). Só o Remover destrutivo entra na regra D-1/D-2/D-3.

### D-5. Token ML obrigatório no Remover

Antes, Legacy podia apagar só local sem token. Agora o Remover **sempre** precisa de conexão/token vivo (GET + close/delete). Sem conexão → erro explícito, sem delete local.

Guards existentes permanecem: `em_voo`, kit vinculado, kit virtual, migração P×V (ADR-0161).

### D-6. UI

Diálogo deixa de dizer “O anúncio no ML continua ativo.” Passa a declarar:

- sem venda → remove no PubliAI **e** encerra/apaga no Mercado Livre;
- com venda → a ação será recusada nos dois lados.

Toast de erro já propaga `json.erro` via `chamarEdge`.

## Consequências

- Escape hatch ADR-0019 (“limpar registro morto com venda no histórico”) **fecha** para Remover: produto com `sold_quantity > 0` fica no inventário PubliAI até haver outro fluxo (fora de escopo).
- Tombstone no ML deixa de ser “pausado órfão”; vira `closed`/`deleted` quando a remoção é permitida.
- Testes obrigatórios: Legacy `sold_quantity=0` fecha+apaga+local; Legacy `>0` nada; UP misto bloqueia; falha ML no meio não apaga local; Republicar regressão intacta.

## Alternativas rejeitadas

- **Só pausar sem venda** — não atende “excluir no ML”.
- **Encerrar (`closed`) mesmo com venda** — operador pediu bloqueio total quando há movimentação.
- **Dois botões** — pedido explícito: permanecer o mesmo botão.
- **Usar `estoque_movimentos` local** — “movimentação no ML”; critério remoto é `sold_quantity`.
