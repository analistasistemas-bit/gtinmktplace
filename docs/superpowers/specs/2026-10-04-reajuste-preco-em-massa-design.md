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
| D14 | Validação de campo pelo app na DSA, +1% e Reverter; MLBs escolhidos pelo agente (ver Validação). |

### Contratos de integridade (revisão do Astra, 2026-10-04)

- **C1 Revalidação financeira e vínculo ao preview.** O preview é calculado **no servidor** e gravado como operação em status `rascunho` (expira em 30 min): por item, preço vivo (`preco_anterior`), alvo, `avaliacao` (snapshot por cor: custo, origem, alíquota, piso, tarifa no alvo, líquido, semáforo), `variacoes_ml` e `estado_anterior`. A tela mostra exatamente o rascunho. **Executar** = confirmar aquele `operacao_id` com as confirmações por item (C5) — o servidor só aceita confirmação para o semáforo gravado no rascunho; editar o preço de um item gera novo rascunho (novo preview). Na execução o servidor recalcula; **qualquer diferença** (custo/origem/alíquota/piso/tarifa/composição) → `mudou` ("refaça o preview"), mesmo com risco confirmado.
- **C2 Serialização atômica entre escritores de preço.** A **reserva** de um MLB pelo reajuste é o próprio item em `pendente`/`enviando`/`conferindo` (já protegido pelo índice único sem promoção). As trocas de estado que importam acontecem em RPCs Postgres que travam a mesma coisa, então não há janela entre "consultar" e "começar":
  - **`reajuste_reivindicar(p_org, p_operacao, p_ml_item)`** (substitui o claim genérico para `reajustar`): numa transação, `select ... for update` nas linhas de `familias` do MLB (Legacy: famílias com aquele `ml_item_id`; UP: a família do SKU via `anuncios_externos`) + `pg_advisory_xact_lock(org, ml_item)`; recusa (devolve motivo) se alguma família está `publicando`, se há migração PxV `solicitada/em_andamento`, ou se há item de promoção do MLB em `pendente`/`enviando`/`saida_solicitada`; senão claim `pendente`→`enviando`. No Reverter, também confere — antes do PUT, dentro da mesma transação — que o banco das variações é o que a origem gravou.
  - **`familia_reservar_publicacao(p_org, p_familia_ids uuid[])`** (substitui o `update ... set status='publicando'` de `publicar-familias`, CREATE e UPDATE): `for update` nas famílias; recusa se algum MLB delas tem item de reajuste em `pendente`/`enviando`/`conferindo` ("Há reajuste de preço em massa em andamento no anúncio X — aguarde ou confira em Operações"); senão seta `publicando` como hoje (mesmo filtro `pronto`/`erro`). O worker `update-familia-ml` repete a checagem ao lado do guard de PxV (`processar.ts:151`), por defesa.
  - **Adesão a promoção:** o claim existente (`operacoes_massa_reivindicar`) passa a, para `aderir`, tomar o mesmo `pg_advisory_xact_lock(org, ml_item)` e recusar (item → `mudou`, "reajuste de preço em andamento") se houver item de reajuste ativo no MLB.
  - **Migração PxV:** a entrada na migração passa por **`familia_reservar_migracao_pxv(p_org, p_codigo_pai) returns text`** — numa transação: `for update` nas famílias do `codigo_pai`, recusa se algum MLB delas tem item de reajuste em `pendente`/`enviando`/`conferindo`, e só então grava `anuncios_externos.migracao_pxv_status = 'solicitada'` (substitui a escrita direta desse status em `migrar-preco-por-variacao`). O reajuste recusa migração em curso (acima), sob o mesmo lock de família.
  - Não há reconciliador de preço hoje (sincronização de estoque só escreve quantidade).
- **C3 Recuperação por etapa e envio incerto.** Item guarda o **alvo absoluto** (`preco`) e `etapa` (`escrita_pedida` gravada ANTES do PUT; `ml_confirmado` após o GET confirmar). Estados do item (coluna `status`): `pendente` → `enviando` → `aplicado` | `ja_estava` | `mudou` | `bloqueado` | `erro`, mais **`conferindo`** (novo, não terminal): resultado do ML desconhecido ou banco a persistir.
  - PUT com resposta 4xx de validação (o ML respondeu e recusou) = **sem escrita comprovada** → `erro` (retentável 429 conta tentativa até 3).
  - PUT sem resposta, 5xx, timeout, ou qualquer falha no GET de confirmação = **resultado desconhecido** → `conferindo` (conferência agendada 5/10/20/40/60 min, **sem limite de tentativas e sem expirar**). **Conferência ≠ reenvio:** a conferência faz só GET — todas as variações esperadas = alvo → `ml_confirmado` e persiste (**sem checar elegibilidade**: a escrita já aconteceu); = anterior (comprovadamente não aplicou) → volta a `pendente` com `etapa` limpa, e o reenvio passa pelo fluxo normal (claim, elegibilidade, C1) antes de qualquer novo PUT; outro valor → `erro` "preço alterado por terceiros"; leitura inconclusiva → continua `conferindo`.
  - **Claim exclusivo das retomadas:** `reajuste_reivindicar` também reivindica `conferindo` vencido (`proxima_conferencia <= now()`) e `enviando` parado (> 2 min), trocando para `enviando` e **preservando `etapa`** e a reserva; dois workers nunca pegam o mesmo item (update condicional na mesma transação).
  - `ml_confirmado` e falha transitória do banco → segue `conferindo` até persistir (não expira).
  - 401/403 ou AUTENTICACAO: itens **sem escrita** viram `erro` "reconecte"; itens com `etapa` preenchida ficam `conferindo` (a reserva se mantém) e retomam após reconectar.
  - Conflito permanente na persistência (estado local diferente do esperado — outra pessoa editou o preço da cor no meio) → `erro` "conflito: preço da cor alterado por outro fluxo durante o reajuste; ML = alvo, banco = valor do outro fluxo — o próximo UPDATE publicará o banco", visível em Operações; libera a reserva (a edição concorrente é deliberada e prevalece).
  - **Persistência e conclusão são atômicas:** a RPC grava as variações **e** marca o item `aplicado` na mesma transação. A reserva termina quando o item sai de `pendente`/`enviando`/`conferindo`.
- **C4 Contrato monetário.** Alvo = `round_half_up(base × (1 ± p%))` ou `base ± R$`, em centavos, calculado uma vez (função pura compartilhada front/servidor) e usado igual no preview, no semáforo e no PUT. Alvo ≤ 0 → recusado. **Alvo = preço vivo → "sem alteração"** (lista à parte, sem PUT nem fixação); se todos ficarem sem alteração, não cria operação.
- **C5 Confirmações separadas.** 🔴 e ⚪ têm confirmações independentes (`confirmado_risco` e `confirmado_sem_dado`); editar o preço de um item zera as dele. Reverter reavalia com dados frescos e exige as mesmas confirmações para o preço restaurado.

## Dados (migration)

- `operacoes_massa.acao` aceita `'reajustar'`; CHECK de coerência: `reajustar` exige `promocao_id`/`promocao_tipo` nulos. `operacoes_massa.status` aceita `'rascunho'` (+ `expira_em timestamptz`, só para rascunho). Reverter = nova operação `reajustar` com `origem_id`.
- `operacoes_massa_itens.status` aceita `'conferindo'` (não terminal). Novas colunas: `preco_anterior numeric` (vivo no preview), `etapa text` check (`escrita_pedida`,`ml_confirmado`), `confirmado_sem_dado boolean not null default false`, `incluido boolean not null default true` (desmarcado no preview), `avaliacao jsonb` (snapshot C1 por cor), `estado_anterior jsonb` (por variação: `{variacao_id, preco_publicacao, preco_editado_pelo_operador}`), `variacoes_ml jsonb` (Legacy: ids de variação do MLB). `preco` = alvo absoluto.
- Itens de rascunho usam o status novo `rascunho` (fora de qualquer reserva) e viram `pendente` em `confirmar`. O índice anti-duplicidade sem promoção passa a cobrir `pendente`, `enviando` e `conferindo` (a reserva da C2); colisão no `confirmar` → 409 "algum destes anúncios já está numa operação em andamento".
- RPCs (security definer, filtram org, testadas em Postgres real):
  - `reajuste_reivindicar(p_org, p_operacao, p_ml_item) returns text` — trava + checagens da C2 + claim; devolve `'ok'` ou o motivo.
  - `familia_reservar_publicacao(p_org, p_familia_ids uuid[], p_status_de text[]) returns text` — substitui o claim de `publicando` em `publicar-familias`.
  - `operacoes_massa_reivindicar` (existente) — para `aderir`, advisory lock por MLB + recusa com reajuste ativo.
  - `familia_reservar_migracao_pxv(p_org, p_codigo_pai) returns text` — substitui a escrita direta de `migracao_pxv_status='solicitada'` em `migrar-preco-por-variacao`.
  - `reajuste_persistir(p_org, p_operacao, p_ml_item, p_preco_confirmado, p_variacoes jsonb, p_esperado jsonb) returns text` — confere o estado esperado (atômico), grava `preco_publicacao`, `preco_editado_pelo_operador`, `preco_publicado_ml = p_preco_confirmado` **e** o item `aplicado` na mesma transação; idempotente; devolve `'ok'`, `'conflito'`.

## Motor (handler `reajustar`)

Elegibilidade (preview e execução; verificação inconclusiva = inelegível):
- status `active` ou `paused` sem `sub_status` de moderação (`parseStatusML` ∈ {ativo, pausado}); demais → fora;
- não Kit Virtual; sem `catalog_listing` nem `item_relations`;
- sem atacado: `familias.atacado` ou `variacoes.atacado` das variações do MLB não vazios → fora;
- promoção: `ml_promocao_itens` com status `pending/started`, **ou** leitura fresca do item em `/seller-promotions/items/{id}` com participação, **ou** — para cada promoção em que o item aparece como `candidate` na visão por item — a visão da campanha (`lerNaCampanha`) mostra `pending/started` (a visão por item atrasa, ADR-0174) → fora; leitura falhou → fora;
- família não `publicando`, sem migração PxV em curso.

Preview / rascunho (edge `operacoes-massa`, ramo novo; qualquer membro pode gerar e ver; executar/reverter só admin ou suporte full, validado no servidor):
1. `POST {etapa:'preview', acao:'reajustar', origem_id?, familias?:[familia_id], ml_item_ids?:[...], ajuste:{tipo:'pct'|'reais', sentido:'+'|'-', valor}, precos?:{[ml_item_id]: preco}}`. O servidor **expande** famílias UP em MLBs (todos os SKUs não retirados), confere pertencimento à org, deduplica, **rejeita > 500 MLBs** (sem truncar), lê o preço vivo de cada MLB, aplica a elegibilidade, calcula o alvo (C4; `precos` sobrescreve o alvo de itens editados), monta `avaliacao` (C1) com `carregarCadastro`/`lerAliquotas`/`buscarItensML` uma vez + `projetarItem` por MLB, e grava a operação `rascunho` com os itens (elegíveis, fora do lote com motivo, sem alteração). Devolve o rascunho.
2. `POST {etapa:'confirmar', operacao_id, confirmacoes:[{ml_item_id, risco?, sem_dado?, incluir}]}` (admin/suporte full): rascunho da org, não expirado (30 min); cada 🔴 incluído exige `risco`, cada ⚪ exige `sem_dado`; itens desmarcados saem; nenhum item → recusa; muda `rascunho`→`executando` e publica no QStash.
3. Reverter: preview com `origem_id` → alvo de cada item = `preco_anterior` da origem, só itens `aplicado` na origem (independente de a origem estar concluída), reavaliação fresca; não revertíveis (preço vivo ≠ alvo da origem, ou banco ≠ o que a origem gravou) aparecem com motivo; os demais seguem o mesmo `confirmar`.

Execução por item (laço comum, teto 100/mensagem; claim = `reajuste_reivindicar`, C2). **Recuperação vem antes de qualquer trava de novo envio:**
1. `etapa = ml_confirmado` → só `reajuste_persistir` → `aplicado` (`conferindo` em falha transitória; `erro` em conflito).
2. `etapa = escrita_pedida` → **conferência** (C3, só GET; sem elegibilidade): alvo → `ml_confirmado` → passo 1; anterior → `pendente` com `etapa` limpa (reenvio na próxima volta, pelo fluxo normal); outro → `erro`; inconclusivo → `conferindo`.
3. Sem `etapa` (envio novo): GET fresco (`price`, `status`, `sub_status`, `variations[].{id,price}`, `catalog_listing`, `item_relations`) + elegibilidade (falha → `erro` retentável até 3, nunca escreve). "Vivo" = Legacy: **todas** as variações de `variacoes_ml` com o mesmo preço; plano/UP: `price`. Composição ≠ `variacoes_ml` → `mudou`. Vivo ≠ `preco_anterior` → `mudou`.
4. C1: recalcula a avaliação; diferente → `mudou`.
5. Grava `etapa = escrita_pedida` → PUT só-preço (D5) → classificação C3 do resultado → GET confirma → `ml_confirmado`. Preço divergente após resposta OK → `erro` "preço não aplicado pelo ML" (sem atribuir causa), banco intocado.
6. `reajuste_persistir(preço confirmado, estado esperado)` → grava variações + item `aplicado` atomicamente.

Reverter na execução: o mesmo handler; alvo = `preco_anterior` da origem; estado a restaurar = `estado_anterior` da origem; `reajuste_reivindicar` confere o banco antes do PUT e `reajuste_persistir` confere de novo (atômico); `preco_publicado_ml` = preço confirmado na reversão.

## Telas

- **Publicados:** botão "Reajustar preço (N)" na barra de seleção (vale para ativos e pausados selecionáveis). Diálogo: Aumentar/Diminuir × %/R$ + valor.
- **Preview:** linhas por MLB (UP: uma por SKU) — preço atual → novo (editável), líquido/markup da pior cor, semáforo, expandir por cor; seções "fora do lote" com motivo (D6); avisos: fixação do preço (D1), 🟡 abaixo do piso, confirmação separada para 🔴 e ⚪; "Executar" só para admin ou suporte com acesso total (validado no servidor); rascunho expira em 30 min.
- **Operações (`/operacoes`):** título "Reajustar preço de N anúncios"; detalhe por item mostra anterior → novo; Reverter com preview próprio (D10).

## Fora do escopo

Arredondamento comercial, "definir preço exato" para todos, preço por cor diferente dentro do mesmo MLB Legacy, atacado, promoção, catálogo, kits, agendamento.

## Testes

- Puras: alvo em centavos half-up (%/R$, ±, ≤ 0 recusado, sem alteração), elegibilidade (cada motivo), decisão por etapa (C3: todas as transições), comparação de avaliação (C1), confirmações (C5), montagem do PUT (Legacy todas as variações, plano, UP) e conferência (Legacy todas as variações).
- Executor: sucesso, preço não aplicado, leitura de confirmação falha, retentável, fatal, falha de banco após `ml_confirmado` (não expira), resposta incerta do PUT, recuperação de cada etapa, Reverter (restaura, "não revertível", `preco_publicado_ml` = confirmado).
- SQL (Postgres real): CHECK com `reajustar`, `reajuste_persistir` (comparação atômica, idempotente, escopo por org), `reajuste_bloqueia_familia`, índice anti-duplicidade.
- C2: UPDATE/publicação, aderir a promoção e entrada em PxV recusam família/MLB com reajuste ativo; **testes concorrentes em Postgres** (duas sessões) para cada par de claims: reajuste × publicação, reajuste × aderir, reajuste × PxV, reajuste × reajuste (retomada de `conferindo`/`enviando` parado).
- Recuperação: PUT aplicado + falha na consulta de promoção → item ainda conclui `aplicado` (conferência não checa elegibilidade).
- Front: diálogo e cálculo, preview (semáforo pior cor + 🔴/⚪ separados, confirmação, edição invalida confirmação), lista de operações (título e Reverter).
- Não-regressão: suítes de promoção e de status intactas.

## Validação de campo

Pelo app, na DSA (escolha dos MLBs delegada ao agente pelo Astra, com o precedente do Diego "escolhe você os MLBs da DSA"): antes, registrar organização, `org_id`, MLBs e preço anterior/alvo; 2–3 anúncios elegíveis cobrindo os modelos disponíveis (Legacy com variações, item plano, UP); +1%; conferir no ML (GET) e no banco; Reverter; conferir ML + banco restaurados. Modelo indisponível = registrado como não validado. Prints 1440/360. A Avil não é tocada.
