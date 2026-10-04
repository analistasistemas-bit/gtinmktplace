# Reajuste de preço em massa — 3º tipo do motor de operações (I5)

**Data:** 2026-10-04 · **ADR:** [0178](../../decisions/0178-reajuste-de-preco-em-massa.md) · base: [0174](../../decisions/0174-operacoes-em-massa-promocoes-v2.md) (motor + emenda 2026-10-04), [0020](../../decisions/0020-estrategia-de-preco-liquido-minimo.md), [0055](../../decisions/0055-imposto-por-origem-nacional-importado.md), [0078](../../decisions/0078-preco-por-variacao-split-por-faixa-e-controle-de-preco-no-update.md), [0160](../../decisions/0160-preco-por-variacao-sob-user-products.md)
**Origem:** discovery 2026-10-04 (Avil repete em lote: preço, pausar/reativar, estoque). Decisões de produto tomadas pelo **GPT-6 Astra como representante do Diego** (delegação explícita: "o gpt 6 astra irá responder por mim; siga sempre o recomendado").

## Problema

Repasse de custo do fornecedor e ajustes de catálogo hoje exigem editar família a família na Revisão e republicar (UPDATE completo). Um reajuste feito direto no Seller Center diverge do banco e é revertido no próximo UPDATE.

## Decisões (Astra, 2026-10-04)

| # | Decisão |
|---|---|
| D1 | **Durável:** grava `variacoes.preco_publicacao` = novo preço e `preco_editado_pelo_operador = true`; `preco_publicado_ml` só com o preço confirmado no ML. O preview avisa: "o re-ingest deixa de recalcular o preço destas cores por custo". |
| D2 | **Base = preço vivo de cada MLB**, relido na execução. Diferente do preview → item `mudou` ("refaça o preview"), sem escrita. |
| D3 | Aumentar/diminuir **por % ou por R$**; preço final editável por item no preview; sem arredondamento comercial; valores em centavos (normalizados uma vez). |
| D4 | **User Products:** a linha da família alcança todos os seus MLBs elegíveis (1 por SKU), cada um da sua base; o preview lista cada MLB. |
| D5 | **Legacy:** 1 preço por MLB (todas as variações daquele MLB), partições de split preservadas — PUT `{variations:[{id, price}]}` com TODOS os ids de variação vindos de GET fresco, sem quantidade/fotos (doc oficial do ML). Item plano: PUT `{price}`. UP: PUT `{price}` por MLB. |
| D6 | **Fora do MVP** (motivo visível no preview, revalidado na execução; falha ao verificar = inelegível): participando de promoção (pending/started, leitura fresca), Kit Virtual, anúncio de catálogo ou com par de catálogo (`item_relations`), migração PxV em curso, família publicando/UPDATE em andamento, moderado/encerrado/inativo, **anúncio com atacado PxQ** (D8). |
| D7 | **Trava financeira** = a das promoções: semáforo por cor no preço novo com **tarifa exata** e imposto pela origem; 🔴 (líquido < custo) e ⚪ (sem custo/origem/tarifa) entram desmarcados e só com confirmação separada gravada no item; 🟡 (abaixo do piso) entra marcado com aviso; sem limite arbitrário de redução. **Origem ausente → ⚪, nunca nacional.** Resumo do item mostra 🔴 e ⚪ separadamente (um não esconde o outro); expandir por cor. |
| D8 | **Atacado PxQ excluído do MVP** (faixas são valores absolutos; reaplicar com falha deixaria base nova com faixas velhas). |
| D9 | Sucesso = GET confirma o preço pedido **e** banco persistido. Leitura falhou → "confirmação pendente" (re-confere); preço diferente → `erro` "preço não aplicado pelo ML", banco intocado. Ordem: ML → banco, com marca de escrita. |
| D10 | **Reverter** restaura por MLB o preço vivo anterior e, por variação, `preco_publicacao` + `preco_editado_pelo_operador` anteriores — só se ML **e** banco continuam como a operação deixou (senão "não revertível: preço mudou depois"); preview mostra quando o preço restaurado reabre divergência banco×ML e que `editado=false` volta a permitir recálculo no re-ingest. |
| D11 | Até **500 MLBs únicos** após expandir famílias (sem corte silencioso); só admin/suporte full executa; servidor confere org e pertencimento. |
| D12 | Botão **"Reajustar preço"** na barra de seleção de Publicados → diálogo (tipo, %, R$) → preview. |
| D13 | ADR novo (0178) + esta spec. |
| D14 | Validação de campo pelo app na DSA, +1% e Reverter. (Astra marcou a escolha dos MLBs concretos como do Diego; ver Validação.) |

Acréscimos do Astra incorporados: revalidar custo/origem/imposto/piso/tarifa antes da escrita (mudou → `mudou`); concorrência com UPDATE (D6: família publicando fica fora; a execução revalida); recuperação sem reaplicar % (o item guarda o **alvo absoluto**); contrato monetário em centavos; editar o preço no preview invalida a confirmação de risco daquele item.

## Dados (migration)

- `operacoes_massa.acao` aceita `'reajustar'`. CHECK de coerência: `reajustar` exige `promocao_id`/`promocao_tipo` nulos (mesma família de `pausar/reativar`). Reverter de reajuste = nova operação `reajustar` com `origem_id`.
- `operacoes_massa_itens`: + `preco_anterior numeric` (preço vivo lido no preview), + `estado_anterior jsonb` (por variação: `{variacao_id, preco_publicacao, preco_editado_pelo_operador, preco_publicado_ml}`), reaproveitando `preco` = **alvo absoluto** e `semaforo`/`confirmado_risco`. Índice anti-duplicidade de status já cobre (`promocao_id is null`).
- Gravação no banco das variações: RPC `reajuste_aplicar_variacoes(p_org, p_operacao, p_ml_item, p_variacoes jsonb)` (security definer, filtra org, idempotente) — grava as 3 colunas de cada variação do MLB numa transação.

## Motor (handler `reajustar`)

Criação (edge `operacoes-massa`, ramo novo):
1. Pedido: `{acao:'reajustar', origem_id?, itens:[{ml_item_id, preco_anterior, preco, confirmado_risco}]}` — o front já expandiu UP em MLBs e calculou o alvo; o servidor **recalcula e confere**: pertence à org, não é kit, elegibilidade (D6), semáforo com tarifa exata no `preco` (🔴/⚪ só com `confirmado_risco`), preço > 0, ≠ `preco_anterior`.
2. Grava `estado_anterior` das variações do MLB (Legacy: `variacoes` da família por `ml_item_id`; UP: a variação do SKU).
3. Reverter (`origem_id`): origem `reajustar` concluída da org; cada id `aplicado` na origem; `preco` pedido = `preco_anterior` da origem.

Execução por item (laço comum, claim, teto 100/mensagem):
1. GET fresco do item (`price`, `status`, `variations[].id`, `catalog_listing`, `item_relations`, tags de migração) + elegibilidade (D6) com leitura fresca de promoção do item.
2. Preço vivo ≠ `preco_anterior` → `mudou` (recuperação: se vivo = alvo e a marca de escrita existe → segue para persistir no banco).
3. Semáforo atual no alvo pior que o do preview e sem `confirmado_risco` → `mudou`.
4. Marca de escrita (`saida_pedida_em`) → PUT só-preço (D5) → GET confirma `price == alvo` (D9).
5. Banco: RPC grava `preco_publicacao`/`editado`/`preco_publicado_ml` das variações → `aplicado`. Falha de banco após ML confirmado → item segue `enviando` (retomada persiste sem novo PUT).
6. Erros: retentável (5xx/429/transporte) → tentativa contada, até 3; AUTENTICACAO/401/403 → fatal (encerra e pede reconexão); `not_modifiable` / preço não aplicado → `erro`.

Reverter na execução: o mesmo handler com alvo = `preco_anterior` da origem; antes de escrever, exige ML vivo == alvo da origem e banco == estado gravado pela origem; restaura `estado_anterior` no banco.

## Telas

- **Publicados:** botão "Reajustar preço (N)" na barra de seleção (vale para ativos e pausados selecionáveis). Diálogo: Aumentar/Diminuir × %/R$ + valor.
- **Preview:** linhas por MLB (UP: uma por SKU) — preço atual → novo (editável), líquido/markup da pior cor, semáforo, expandir por cor; seções "fora do lote" com motivo (D6); avisos: fixação do preço (D1), 🟡 abaixo do piso, confirmação separada para 🔴 e ⚪; "Executar" só admin.
- **Operações (`/operacoes`):** título "Reajustar preço de N anúncios"; detalhe por item mostra anterior → novo; Reverter com preview próprio (D10).

## Fora do escopo

Arredondamento comercial, "definir preço exato" para todos, preço por cor diferente dentro do mesmo MLB Legacy, atacado, promoção, catálogo, kits, agendamento.

## Testes

- Puras: cálculo do alvo em centavos (%/R$, aumento/diminuição, mínimo > 0, sem alteração), elegibilidade (cada motivo D6), decisão por item (mudou/recuperação/escrever/semáforo pior), montagem do PUT (Legacy todas as variações, plano, UP).
- Executor: sucesso, preço não aplicado, leitura de confirmação falha, retentável, fatal, falha de banco após ML, recuperação, Reverter (restaura e "não revertível").
- SQL (Postgres real): CHECK com `reajustar`, RPC idempotente e escopada por org, índice anti-duplicidade.
- Front: diálogo e cálculo, preview (semáforo pior cor + 🔴/⚪ separados, confirmação, edição invalida confirmação), lista de operações (título e Reverter).
- Não-regressão: suítes de promoção e de status intactas.

## Validação de campo

Pelo app, na DSA: 2–3 anúncios elegíveis (Legacy com variações, item plano, UP se houver), +1%, conferir no ML (GET) e no banco, Reverter, conferir que voltou (ML + banco). Prints 1440/360. A Avil não é tocada.
