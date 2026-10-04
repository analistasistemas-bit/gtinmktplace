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

### Contratos de integridade (revisão do Astra, 2026-10-04)

- **C1 Revalidação financeira.** A criação grava um snapshot por cor (`avaliacao`: custo, origem, alíquota, piso, tarifa no alvo, líquido, semáforo). Na execução, o servidor recalcula; **qualquer diferença** (custo/origem/alíquota/piso/tarifa) → `mudou` ("refaça o preview"), mesmo com risco confirmado. A confirmação vale para o preço e a avaliação apresentados.
- **C2 Serialização entre escritores de preço** (verificação cruzada, os dois lados):
  - reajuste recusa MLB cuja família está `publicando` (UPDATE/CREATE em andamento) ou com migração PxV;
  - **UPDATE/publicação da família recusa** (erro claro: "Há reajuste de preço em massa em andamento/pendente no anúncio X") enquanto algum MLB da família tiver item de reajuste `pendente`/`enviando` ou com `etapa = ml_confirmado` não persistida;
  - **aderir a promoção** (handler existente) recusa o MLB nas mesmas condições;
  - não há reconciliador de preço hoje (sincronização de estoque só escreve quantidade).
- **C3 Recuperação por etapa.** Item guarda o **alvo absoluto** (`preco`) e `etapa`: `null` → `escrita_pedida` (gravada ANTES do PUT) → `ml_confirmado` (GET confirmou) → `aplicado` (banco persistido). Retomada: `escrita_pedida` → primeiro GET; vivo = alvo → `ml_confirmado` sem novo PUT; vivo = anterior → reescreve o mesmo alvo; outro valor → `mudou`. `ml_confirmado` → só persiste o banco. Resposta incerta do PUT = conferir antes de reescrever. **Falha de banco após `ml_confirmado` não expira** (retenta a cada 60 min, item segue bloqueando o UPDATE pela C2) — o preço antigo nunca é republicado em silêncio. Erros do ML seguem o motor (retentável até 3 tentativas; fatal encerra).
- **C4 Contrato monetário.** Alvo = `round_half_up(base × (1 ± p%))` ou `base ± R$`, em centavos, calculado uma vez (função pura compartilhada front/servidor) e usado igual no preview, no semáforo e no PUT. Alvo ≤ 0 → recusado. **Alvo = preço vivo → "sem alteração"** (lista à parte, sem PUT nem fixação); se todos ficarem sem alteração, não cria operação.
- **C5 Confirmações separadas.** 🔴 e ⚪ têm confirmações independentes (`confirmado_risco` e `confirmado_sem_dado`); editar o preço de um item zera as dele. Reverter reavalia com dados frescos e exige as mesmas confirmações para o preço restaurado.

## Dados (migration)

- `operacoes_massa.acao` aceita `'reajustar'`; CHECK de coerência: `reajustar` exige `promocao_id`/`promocao_tipo` nulos. Reverter = nova operação `reajustar` com `origem_id`.
- `operacoes_massa_itens`: + `preco_anterior numeric` (vivo no preview), + `etapa text` check (`escrita_pedida`,`ml_confirmado`), + `confirmado_sem_dado boolean not null default false`, + `avaliacao jsonb` (snapshot C1 por cor), + `estado_anterior jsonb` (por variação: `{variacao_id, preco_publicacao, preco_editado_pelo_operador}`), + `variacoes_ml jsonb` (Legacy: ids de variação do MLB no preview; mudança de composição → `mudou`). `preco` = alvo absoluto. O índice anti-duplicidade sem promoção já impede dois reajustes no mesmo MLB.
- RPC `reajuste_persistir(p_org, p_operacao, p_ml_item, p_preco_confirmado, p_variacoes jsonb, p_esperado jsonb)` — security definer, filtra org, numa transação: confere o estado esperado das variações (comparação atômica; diferente → recusa), grava `preco_publicacao`, `preco_editado_pelo_operador` e `preco_publicado_ml = p_preco_confirmado`; idempotente.
- Função SQL `reajuste_bloqueia_familia(p_org, p_familia_id) returns text` (motivo ou null) usada pela C2 nos fluxos de UPDATE/publicação.

## Motor (handler `reajustar`)

Elegibilidade (preview e execução; verificação inconclusiva = inelegível):
- status `active` ou `paused` sem `sub_status` de moderação (`parseStatusML` ∈ {ativo, pausado}); demais → fora;
- não Kit Virtual; sem `catalog_listing` nem `item_relations`;
- sem atacado: `familias.atacado` ou `variacoes.atacado` das variações do MLB não vazios → fora;
- promoção: `ml_promocao_itens` com status `pending/started` **ou** leitura fresca do item em `/seller-promotions/items/{id}` com participação → fora (candidata não bloqueia);
- família não `publicando`, sem migração PxV em curso.

Criação (edge `operacoes-massa`, ramo novo; admin/suporte full; também para Reverter):
1. Pedido: `{acao:'reajustar', origem_id?, ajuste?:{tipo:'pct'|'reais', sentido:'+'|'-', valor}, itens:[{ml_item_id, preco, confirmado_risco, confirmado_sem_dado}]}`. O front expande famílias UP em MLBs; o servidor **valida a expansão** (pertence à org, dedup), **rejeita > 500 MLBs** (sem truncar), lê o preço vivo de cada MLB (= `preco_anterior`), aplica a elegibilidade, monta o snapshot C1 com tarifa exata no `preco` e exige as confirmações C5. Item cujo preço vivo ≠ o mostrado no preview volta como recusa ("preço mudou, refaça o preview").
2. Grava por item: `preco_anterior`, `preco` (alvo), `avaliacao`, `estado_anterior` (Legacy: variações da família do MLB; UP: a variação do SKU), `variacoes_ml` (Legacy).
3. Reverter (`origem_id`): origem `reajustar` **concluída** da org; cada id pedido `aplicado` na origem; alvo = `preco_anterior` da origem; reavaliação fresca (C5); itens não revertíveis aparecem com motivo; os demais seguem.

Execução por item (laço comum, claim, teto 100/mensagem), pela `etapa` (C3):
1. `etapa = ml_confirmado` → só `reajuste_persistir` → `aplicado`.
2. GET fresco (`price`, `status`, `sub_status`, `variations[].{id,price}`, `catalog_listing`, `item_relations`) + elegibilidade + C2.
3. Composição Legacy ≠ `variacoes_ml` → `mudou`. Vivo = alvo e `etapa = escrita_pedida` → `ml_confirmado`. Vivo ≠ `preco_anterior` → `mudou`.
4. C1: recalcula a avaliação; diferente → `mudou`.
5. `etapa = escrita_pedida` (gravada antes) → PUT só-preço (D5) → GET confirma (Legacy: **todas** as variações com o alvo; plano/UP: `price`) → `ml_confirmado`. Preço divergente → `erro` "preço não aplicado pelo ML" (sem atribuir causa), banco intocado.
6. `reajuste_persistir` com o preço confirmado e o estado esperado → `aplicado`.
7. Erros do ML: retentável (5xx/429/transporte) até 3 tentativas; AUTENTICACAO/401/403 → fatal (encerra e pede reconexão).

Reverter na execução: o mesmo handler com alvo = `preco_anterior` da origem e `estado_anterior` como estado a restaurar; antes de escrever exige ML vivo == alvo da origem e banco == o que a origem gravou (comparação atômica na RPC); `preco_publicado_ml` recebe o preço confirmado na reversão.

## Telas

- **Publicados:** botão "Reajustar preço (N)" na barra de seleção (vale para ativos e pausados selecionáveis). Diálogo: Aumentar/Diminuir × %/R$ + valor.
- **Preview:** linhas por MLB (UP: uma por SKU) — preço atual → novo (editável), líquido/markup da pior cor, semáforo, expandir por cor; seções "fora do lote" com motivo (D6); avisos: fixação do preço (D1), 🟡 abaixo do piso, confirmação separada para 🔴 e ⚪; "Executar" só admin.
- **Operações (`/operacoes`):** título "Reajustar preço de N anúncios"; detalhe por item mostra anterior → novo; Reverter com preview próprio (D10).

## Fora do escopo

Arredondamento comercial, "definir preço exato" para todos, preço por cor diferente dentro do mesmo MLB Legacy, atacado, promoção, catálogo, kits, agendamento.

## Testes

- Puras: alvo em centavos half-up (%/R$, ±, ≤ 0 recusado, sem alteração), elegibilidade (cada motivo), decisão por etapa (C3: todas as transições), comparação de avaliação (C1), confirmações (C5), montagem do PUT (Legacy todas as variações, plano, UP) e conferência (Legacy todas as variações).
- Executor: sucesso, preço não aplicado, leitura de confirmação falha, retentável, fatal, falha de banco após `ml_confirmado` (não expira), resposta incerta do PUT, recuperação de cada etapa, Reverter (restaura, "não revertível", `preco_publicado_ml` = confirmado).
- SQL (Postgres real): CHECK com `reajustar`, `reajuste_persistir` (comparação atômica, idempotente, escopo por org), `reajuste_bloqueia_familia`, índice anti-duplicidade.
- C2: UPDATE/publicação e aderir a promoção recusam família/MLB com reajuste pendente (testes nesses fluxos).
- Front: diálogo e cálculo, preview (semáforo pior cor + 🔴/⚪ separados, confirmação, edição invalida confirmação), lista de operações (título e Reverter).
- Não-regressão: suítes de promoção e de status intactas.

## Validação de campo

Pelo app, na DSA (escolha dos MLBs delegada ao agente pelo Astra, com o precedente do Diego "escolhe você os MLBs da DSA"): antes, registrar organização, `org_id`, MLBs e preço anterior/alvo; 2–3 anúncios elegíveis cobrindo os modelos disponíveis (Legacy com variações, item plano, UP); +1%; conferir no ML (GET) e no banco; Reverter; conferir ML + banco restaurados. Modelo indisponível = registrado como não validado. Prints 1440/360. A Avil não é tocada.
