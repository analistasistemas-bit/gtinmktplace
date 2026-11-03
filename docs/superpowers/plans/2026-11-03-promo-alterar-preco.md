# Promoções: "Alterar preço" de itens já participando (DEAL) — plano

**Pedido (Diego, 03/11/2026):** na aba Em promoção (e no detalhe da campanha, aba Participando), além de "Sair",
poder **alterar o preço/desconto** da promoção, **em massa**, com **campo de busca**, parecido com a primeira
adesão (Desconto % / Preço R$ → Aplicar a todos, com recebe·lucro·margem exatos).

**Spike (autorizado, 03/11, Zaven MLB5441057075, P-MLB17909028):** `PUT /seller-promotions/items/{id}?app_version=v2`
`{promotion_id, promotion_type:'DEAL', deal_price}` → 200 `{price, original_price}`; continua `started`; visão da
campanha e por item mostram o preço novo em ≤15 s. Participando, `min/max_discounted_price` vêm nulos (e a Central
também guarda `preco_min/max` nulos). Doc ML: LIGHTNING/PRICE_DISCOUNT exigem remover e reaplicar; SMART = preço do ML.

## Decisões

1. **Só DEAL.** Relâmpago/SMART não mostram o botão (backend recusa com motivo).
2. **Nova ação `alterar_preco`** no motor (ADR-0174): migration amplia `operacoes_massa_acao_check` e
   `operacoes_massa_acao_promocao_check` (promocao_id/tipo obrigatórios, como aderir/sair). `preco_anterior`
   (coluna já existente, do reajuste) guarda o preço antes (Central `preco_promo ?? preco_avaliado`) → Reverter.
3. **Leitura:** `lerNaCampanha` passa a devolver `preco` (`price` da visão da campanha — o spike mostra o preço
   promocional do participante). **Escrita:** `ClienteML.put(itemId, body)` (200; 401/403 → SemEscritaPromocoes).
4. **`decidir('alterar_preco')`:** tipo ≠ DEAL → `bloqueado`; item não participando na leitura fresca → `mudou`
   ("não está mais participando"); `fresco.preco` = pedido (centavos) → `ja_estava` (idempotência pós-crash);
   senão `{ tipo: 'put', body: { promotion_id, promotion_type: 'DEAL', deal_price } }`.
5. **Executor:** mesmo fluxo do `post`: trava de semáforo (`semaforoAtual`, `piorou`, risco confirmado) **antes** de
   escrever → `ml.put` → `aplicado` → `espelharPreco` (já existe: preço + projeção exata; recusa com sync em curso).
   `ja_estava` em alterar **espelha o preço** (aqui o preço foi confirmado na leitura do ML). Recontagem não muda
   (status igual), mas a chamada existente é inofensiva.
6. **Validação na criação (`validarPedido`):** `alterar_preco` exige DEAL, item participando na Central, preço
   numérico > 0 e < `preco_original` quando conhecido (senão não é desconto); faixa não existe para participante —
   o ML valida (400 vira `erro` com a mensagem do ML). Trava financeira idêntica ao aderir (`semaforoReal`: exato
   quando o preço difere do avaliado; vermelho/indisponível só com risco confirmado).
7. **Reverter:** `inversa('alterar_preco') = 'alterar_preco'`; revertíveis = `aplicado`; o preview abre com
   `preco_anterior` de cada item (via `simulados`). Na criação, `origem_id` de alterar exige origem `alterar_preco`
   da mesma promoção (hoje a regra exige ação diferente — exceção só para esta ação).
8. **Simulação (`etapa 'simular'`)** passa a aceitar item participando (sem exigir faixa); convidado continua
   exigindo faixa.
9. **Front:**
   - `lib/operacoes`: `AcaoPromocao` += `'alterar_preco'`; `montarPreview('alterar_preco')`: preço inicial =
     simulado ?? `preco_promo ?? preco_avaliado`; **todos marcados** (o operador escolheu); risco como aderir;
     `tituloOperacao` "Alterar preço em {campanha}"; `itensRevertiveis`.
   - `PreviewOperacao`: `podeEditarPreco` vale para alterar (DEAL); título "Alterar preço em X"; preço ≥ original
     inválido; mesma barra "Desconto % / Preço R$ → Aplicar a todos" + recebe·lucro·margem do servidor.
   - **Em promoção** (`lista-participando`): campo de **busca** (título/MLB/SKU, `filtrarPorBusca`) filtrando todos
     os blocos; "Selecionar todos" do bloco marca só o filtrado; botão **Alterar preço N** (DEAL) ao lado de Sair N.
   - **Detalhe da campanha, aba Participando:** `BarraSelecao` ganha **Alterar preço N** (DEAL); simulação da tela
     (Desconto %/Preço R$ + Simular) também na aba Participando (DEAL), alimentando o preview de alterar.
   - `lista-operacoes`: Reverter de alterar abre o preview com os preços anteriores.
10. **Docs:** emenda ADR-0174 (item 7), obsidian Promoções, `docs/reference/edge-functions.md`, `docs/TASKS.md`.

## Revisão Codex do plano (REVISE: 3×P1, 2×P2) — substitui os itens acima onde conflitar

- **P1 Reverter/preço anterior:** `preco_anterior` = preço da **leitura fresca do ML** gravado logo antes do PUT
  (só se ainda nulo — retry não sobrescreve), junto com `etapa='escrita_pedida'`. Reverter validado no servidor:
  itens têm de ser `aplicado` da origem e o preço pedido = `preco_anterior` dela; o item do Reverter guarda em
  `estado_anterior` `{preco_esperado: <preço que a origem deixou>}` e o executor marca `mudou` se o preço vivo for
  outro (não sobrescreve alteração posterior).
- **P1 PUT incerto:** erro não-fatal no PUT → relê no ML: preço = pedido → `aplicado`; releitura falha →
  `FalhaPosEscrita` (item fica `enviando`, retomado em 2 min). Retry com `etapa='escrita_pedida'` e preço = pedido →
  **`aplicado`** (escrita recuperada, revertível); sem etapa e preço igual → `ja_estava`.
- **P1 Aba Operações:** `useOperacoes('promocao')` inclui `alterar_preco`; conclusão de operação de promoção
  invalida `['promocoes']`.
- **P2 Espelho:** reprojeção falhou → grava `preco_promo`/`preco_avaliado` = preço confirmado com projeção
  **indisponível** (liquido null, `erro_tarifa`) — nunca preço novo com líquido velho (vale para aderir também).
  O preview calcula o lucro no servidor automaticamente ao abrir quando há linha marcada sem cálculo válido.
- **P2 Contratos:** `preco_original` em `COLS_CENTRAL`/`LinhaCentral`; preço normalizado a centavos na validação e
  na escrita. Simulação da tela vale para participantes (aba Participando, DEAL); com simulação, participante não
  simulado vem desmarcado. Seleção fora do filtro da busca **continua valendo** (barra mostra o total) — decisão.
- **RPCs:** `operacoes_massa_reivindicar` (barreira contra reajuste em andamento) e a barreira do reajuste passam a
  incluir `alterar_preco` — migration copia a definição viva e troca só a lista de ações.

## Ordem / validação
1. Migration (`supabase migration new` + `db push`, `db:check`) → conferir constraints.
2. Backend TDD: decidir, ml (put/preço), executar, validar, simular, index (lerPedido/origem/preco_anterior).
3. Front TDD: operacoes lib, preview, lista-participando, PromocaoDetalhe, lista-operacoes.
4. preflight:static; Codex no diff; deploy `operacoes-massa`; validação visual (DSA, sem escrever no ML);
   CI → merge. Primeira alteração real fica com o Diego.
