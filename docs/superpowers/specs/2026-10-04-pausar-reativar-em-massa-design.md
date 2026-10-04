# Pausar/reativar em massa — 2º tipo do motor de operações (I5)

**Data:** 2026-10-04 · **ADR:** [0174](../../decisions/0174-operacoes-em-massa-promocoes-v2.md) (emenda 2026-10-04) · [0060](../../decisions/0060-pausar-reativar-anuncio-ml.md) · [0111](../../decisions/0111-reativacao-automatica-ao-repor-estoque.md) · [0161](../../decisions/0161-botao-migrar-preco-por-variacao.md)
**Origem:** roadmap de melhorias, I5 — discovery de 2026-10-04 (Diego)

## Problema

A Avil faz em lote, no Seller Center ou anúncio a anúncio no app, três operações: reajuste de preço,
pausar/reativar e estoque. O motor de operações em massa (ADR-0174) existe, mas só sabe aderir/sair de
promoção. Pausar/reativar já existe por anúncio (ADR-0060, só admin), sem lote.

## Decisões do Diego (2026-10-04, brainstorming)

1. **Ordem:** pausar/reativar primeiro, depois preço, depois estoque — cada um com spec própria.
2. **Seleção na tela Publicados**, com os filtros que já existem (fornecedor, status, categoria, busca,
   encalhados), não num wizard separado.
3. **ADR-0111 mantido:** pausa em lote = N pausas individuais. Repor estoque reativa como hoje; o preview avisa.
4. **Abordagem A:** generalizar o motor — um laço, um handler por ação. Nada de edge/tabelas paralelas nem
   `parametros jsonb` especulativo.

## Dados (migration)

- `operacoes_massa.acao`: check passa a `('aderir','sair','pausar','reativar')`.
- `operacoes_massa.promocao_id` e `promocao_tipo`: viram nullable, com check de coerência:
  `(acao in ('aderir','sair') and promocao_id is not null and promocao_tipo is not null) or
   (acao in ('pausar','reativar') and promocao_id is null and promocao_tipo is null)`.
- `operacoes_massa_itens.promocao_id`: vira nullable.
- **Anti-duplicidade novo:** índice único parcial em `operacoes_massa_itens (org_id, ml_item_id)`
  `where promocao_id is null and status in ('pendente','enviando')`. O índice atual
  `(org_id, promocao_id, ml_item_id)` não barra duplicata com NULL (NULLs são distintos) — por isso o índice próprio.
- Status de item: os existentes bastam (`aplicado`, `ja_estava`, `mudou`, `bloqueado`, `erro`).
  `saida_solicitada`/conferência não se aplicam (o PUT de status é síncrono).
- RLS: sem mudança (tabelas já são por org).

## Motor

### Criação (`POST` na edge `operacoes-massa`)

Novo ramo de validação para `pausar|reativar` (o de promoção não muda):

- Corpo: `{ acao, itens: [{ ml_item_id }] }`, sem promoção.
- Servidor confere que cada `ml_item_id` é anúncio publicado da org (mesma fonte da tela Publicados).
- Recusa por item: **kit** (status em kit nunca foi testado — `Publicados.tsx`), repetido no pedido,
  não pertence à org. Pedido vazio ou > `MAX_ITENS` (500) → erro.
- Sem trava financeira: `semaforo = null`, `confirmado_risco = false`.
- Permissão: igual à de promoção — admin ou suporte com acesso total; membro comum recebe 403.
  Auditoria de suporte igual a `atualizar-status-publicado`.

### Execução (handler de status)

`processarItem` despacha por `acao`; o handler de promoção fica intacto. Handler de status, por item:

1. GET fresco do item no ML; status via `parseStatusML` (com `sub_status`).
2. Decide:
   - já no status alvo → `ja_estava`;
   - moderado, encerrado, inativo ou `paused` com sub_status de moderação → `bloqueado`
     ("Anúncio moderado/encerrado — não dá para alternar");
   - em migração "preço por variação" (`motivoMigracaoPxvPorItem`, ADR-0161) → `bloqueado` com a
     mesma mensagem da pausa individual;
   - ML não devolveu o anúncio (`indisponivel`) → `erro` ("O ML não devolveu o anúncio");
   - sobrou só ativo/pausado: é o status de origem da ação → escreve. (`mudou` não ocorre nesta ação.)
3. Senão → `conn.atualizarStatus(ctx, id, alvo)` (propaga ao catálogo relacionado, aditivo ADR-0060)
   → `aplicado`; erro do canal → `erro` com `mensagemOperador`. 401/403 de token → `erro` "Reconecte a conta".
4. Mantém claim (`operacoes_massa_reivindicar`), dedup QStash por message-id e o teto por mensagem já
   em produção (`maxItens: 100`, ADR-0173 §4). Sem etapa `conferir`: sem pendentes → conclui.

### Reverter

Operação inversa (pausar ↔ reativar) só sobre itens `aplicado`, com preview e confirmação
(decisão 2 do ADR-0174). O handler revalida no ML; item que mudou de status no meio cai em `ja_estava`/`bloqueado`.

## Telas

### Publicados — seleção

- Checkbox por linha; desabilitado (tooltip) em kit e em status ≠ ativo/pausado.
- Checkbox no cabeçalho = "todos do filtro (N)" — a lista filtrada inteira (paginação é no cliente),
  não só a página. Mudar filtro limpa a seleção.
- Barra fixa: "N selecionados · Pausar X · Reativar Y" (X = ativos, Y = pausados da seleção; 0 → desabilitado).
- Membro comum seleciona e abre o preview; Executar só para admin/suporte total (`usePodeExecutarOperacao`).

### Preview (diálogo)

- Lista do que muda (miniatura, título, MLB) + contagem do que fica de fora e por quê.
- Avisos fixos: "anúncios de catálogo ligados a estes também mudam"; na pausa, "repor estoque reativa
  estes anúncios".
- Executar → toast com link "Ver em Operações".

### Operações — tela global

- Rota `/operacoes`, item de menu sem gate de módulo (pausar/reativar não depende de Promoções).
- `ListaOperacoes` sai de `components/promocoes/` para `components/operacoes/`, ganha filtro por tipo e
  despacha título e Reverter por `acao`:
  - status: "Pausar 47 anúncios" / "Reativar 12 anúncios"; Reverter abre o preview de status;
  - promoção: título e Reverter atuais (preview de promoção, cache da Central).
- A aba Operações dentro de Promoções continua: mesma lista filtrada em aderir/sair.
- Operação de status concluída invalida `QK.statusPublicados`.

## Fora do escopo

Agendar pausa com data de volta (Módulo Férias), pausa por regra automática, reajuste de preço e estoque
em lote (próximos handlers, specs próprias), pausar kit.

## Testes

- **Não-regressão:** a suíte atual `_shared/operacoes/__tests__` passa sem alteração.
- Handler de status: um teste por desfecho (`ja_estava`, `bloqueado` moderado, `bloqueado` PxV,
  `erro` sem leitura, `aplicado`, `erro` do canal).
- Validação: kit recusado, repetido recusado, item de outra org recusado, > 500 recusado.
- Migration contra Postgres real: check de coerência (aderir sem promoção falha; pausar com promoção
  falha) e índice anti-duplicidade (2º `pendente` do mesmo anúncio sem promoção falha; promoção não afetada).
- Front: barra de seleção (contagens X/Y, todos do filtro, kit desabilitado) e título por tipo na lista.

## Validação de campo

Na DSA, 2–3 anúncios aprovados pelo Diego antes: pausar em lote → conferir no ML (item + catálogo
relacionado) → Reverter → conferir reativados. Prints em 1440 e 360 px. A Avil não é tocada.
