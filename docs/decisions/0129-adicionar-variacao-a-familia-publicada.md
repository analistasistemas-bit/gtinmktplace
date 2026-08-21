# ADR-0129 — Adicionar variação a família publicada, direto da tela Estoque

**Status:** Aceito
**Data:** 2026-08-20 (aceite: 2026-08-20)
**Decisores:** Diego
**Relaciona:** reaproveita o pipeline de UPDATE do [ADR-0016](0016-publicacao-update-reposicao-estoque.md)
(cor nova nasce em opt-out, publicável com foto + estoque > 0); herda o padrão "sessão de
cadastro = lote" do [ADR-0094](0094-estoque-unico-cadastro-manual.md) D-1, mas para UPDATE de
família existente em vez de CREATE; sujeita-se ao invariante de composição do
[ADR-0104](0104-update-de-familia-migrada-para-user-products.md) §4 (mudança de composição só
roda pelo caminho "Atualizar tudo"); mesma trava admin-only do
[ADR-0060](0060-pausar-reativar-anuncio-ml.md); ORIGEM herdado da linha PAI por
[ADR-0107](0107-origem-obrigatoria-na-planilha.md); esconder o gatilho na UI não substitui o gate
na edge (ADR-0047).

## Contexto

Hoje, adicionar uma cor nova a uma família **já publicada** exige achar a planilha original do
lote, editar a linha e resubmeter pelo fluxo de Lotes inteiro. Não existe atalho — a tela Estoque
(onde o operador efetivamente olha o produto e percebe que falta uma variação) só tem "Entrada"
e "Ajustar" (estoque de SKU existente) e um cadastro que cria família **nova do zero**
(`dialog-cadastro-produto.tsx` → edge `cadastrar-produto`, ADR-0094).

Investigação do domínio (grilling 2026-08-20) confirmou que o gap é **de UI, não de backend**: o
UPDATE do ADR-0016 já trata "cor nova" corretamente — casa por `CODIGO`, nasce em opt-out
(publicável só com foto + estoque > 0), e o worker (`process-familia` /
`update-familia-ml/processar.ts`) já sabe decidir entre payload Legacy (PUT incremental,
`variations[]`) e User Products (N itens por SKU sob `family_id`), inclusive adotando famílias
que o ML migrou sozinho (ADR-0104). Construir uma integração nova com o ML para esta feature
duplicaria essa lógica já validada em produção.

## Decisão

| # | Decisão | Racional |
|---|---|---|
| **D-1** | A UI monta um **Lote real de UPDATE**: variações vivas da família (copiadas do banco) + N linhas novas digitadas no formulário. Cai no mesmo `process-familia`/`update-familia-ml` que qualquer UPDATE de estoque roda hoje. | Zero lógica nova de payload ML. Reaproveita casamento por `CODIGO`, opt-out de cor nova e detecção Legacy↔UP do ADR-0016/0104. |
| **D-2** | Lote grava no banco e enfileira via QStash (mesmo helper `enfileirarFamilias` usado por `reprocessar-familia`) — **nunca síncrono**. Aparece na tela Lotes como qualquer outro. | O pipeline de UPDATE já é assíncrono; forçar síncrono duplicaria orquestração e perderia o rastro de auditoria (retry, erro) que os outros lotes já têm. |
| **D-3** | `lotes.origem = 'manual'` (valor já existente, `check (origem in ('planilha','manual'))` de 20260729124711) — não cria valor novo de enum/check. A diferença para o cadastro do ADR-0094 fica em `familias.operacao = 'UPDATE'` (a família **já existe**), não em `origem`. | Zero migration de schema para o lote. `origem='manual'` já significa "não veio de planilha ingest", que é exatamente o caso. |
| **D-4** | Foto obrigatória no mesmo formulário — sem foto não salva. Reaproveita `campo-foto.tsx`. | O ADR-0016 só publica cor nova com foto + estoque > 0; foto opcional criaria variação "zumbi" (no banco, nunca no ML) que o operador esquece de completar — mesmo risco de dado incompleto do ADR-0107. |
| **D-5** | `CODIGO` digitado manualmente pelo admin, com validação de unicidade por org (mesmo guard do ADR-0094 §"Guard de SKU entre produtos" — busca por `(org_id, codigo)`, 409 com os SKUs em conflito). | CODIGO vem do ERP/planilha do operador, não é gerado pelo PubliAI. A unicidade por org (não só por família) é obrigatória porque as RPCs de estoque resolvem `(org_id, codigo)` — SKU repetido baixaria o estoque do produto errado. |
| **D-6** | Campos físicos/compartilhados (UNIDADE, PESO_GRAMAS, ALTURA/LARGURA/COMPRIMENTO_CM, FORNECEDOR) pré-preenchidos com os valores de uma variação irmã existente, editável. ORIGEM **não é pedido** — herdado da linha PAI (`familias.origem`), não da variação. | Cor diferente do mesmo produto quase nunca muda peso/dimensões/fornecedor. ORIGEM já é campo de família (ADR-0107), não de variação — pedir de novo seria redundante e arriscaria divergência. |
| **D-7** | Ação **admin-only**: mesmo gate do ADR-0060 (`is_super_admin`/role admin da org), aplicado **no menu E na edge** (esconder botão é navegação, não fronteira de segurança — ADR-0047). | Adicionar variação muda composição de anúncio publicado — mesma classe de risco do pausar/reativar, que já é admin-only. |
| **D-8** | A edge recusa (409) se já existe lote **não-terminal** para a mesma família (`familias.status not in ('publicado','erro')` / lote ainda em `importando`/`processando`/`revisao`). | O pipeline de UPDATE reconcilia contra o `GET` ao vivo do ML antes de decidir o payload — dois lotes da mesma família em voo é a receita para o race condition que o ADR-0104 já trata como risco de composição. |
| **D-9** | Formulário permite **N linhas repetíveis** (reaproveita `linha-variacao-form.tsx`, já usado em `dialog-cadastro-produto.tsx`) — um lote só, mesmo com várias cores novas de uma vez. | Caso comum: várias cores novas chegam juntas. Sem repetição, o bloqueio de lote concorrente (D-8) forçaria N rodadas de fila para uma operação só. |
| **D-10** | O lote **não passa pela tela Revisão** — vai direto para o pipeline de UPDATE. | Revisão existe para checar conteúdo **gerado por IA** (título, descrição, atributos) antes da primeira publicação. Aqui não há geração de IA: é dado que o admin já conhece e digitou — igual ao UPDATE de estoque comum, que também nunca passa por Revisão. Difere do cadastro CREATE do ADR-0094 (que tem IA de atributos rodando e por isso vai para Revisão). |
| **D-11** | Feedback: sino de notificação no evento final (sucesso/erro) + status inline no card do produto (reaproveita o mesmo mecanismo de status que `LoteCard`/tela Progresso já mostram para outros lotes). | Nada disso é canal novo — é o mesmo mecanismo que qualquer outro lote já usa. |

## Alternativas consideradas

- **Endpoint dedicado falando direto com o ML, sem lote**: rejeitada — duplicaria a lógica de
  payload Legacy vs User Products (ADR-0016/0104) e reabriria o risco de composição fora do
  fluxo `somente estoque` que o ADR-0104 §4 fechou.
- **Processamento síncrono** (resposta imediata na tela, sem fila): rejeitada — o pipeline de
  UPDATE já é assíncrono; sincronizar essa entrada específica criaria um segundo caminho de
  execução para o mesmo `process-familia`.
- **Foto opcional, completável depois**: rejeitada — cria variação "zumbi" nunca publicada, sem
  sinalização de pendência.
- **Operador comum poder usar (não só admin)**: rejeitada — mesma classe de risco do
  pausar/reativar (ADR-0060), que já é admin-only.
- **1 variação por vez**: rejeitada — com o bloqueio de lote concorrente (D-8), forçaria o admin
  a esperar N rodadas de fila para adicionar N cores chegadas juntas.
- **Rotear pela tela Revisão** (paralelo ao cadastro CREATE do ADR-0094): rejeitada — Revisão
  existe para validar saída de IA; aqui o dado é 100% manual, tratá-lo como saída de IA
  adicionaria uma etapa sem função.

## Consequências

- **Boas:** fecha o gap identificado (hoje só dá para adicionar cor a família publicada
  reprocessando a planilha inteira do lote original) reaproveitando 100% do pipeline de UPDATE já
  validado em produção — nenhuma superfície nova de risco com o ML.
- **Riscos/tradeoffs aceitos:**
  - Se a família estiver em User Products migrada pelo ML, a adoção por SKU do ADR-0104 §2 roda
    na primeira chamada (custo de N buscas, não recorrente) — comportamento **herdado**, não
    introduzido por este ADR.
  - O bloqueio de lote concorrente (D-8) é checado na edge antes de gravar — ainda existe uma
    janela teórica de race entre a checagem e o `insert` sob duplo clique rápido. Aceito no mesmo
    nível de robustez que o resto do sistema (ex.: guard idempotente por família de
    `reprocessar-familia`); se motivar bug real, endurecer com lock de linha depois.
- **Como reverter:** remover o item de menu e a edge nova; nenhuma migration destrutiva —
  `lotes.origem='manual'` e `familias.operacao='UPDATE'` já existiam antes deste ADR.

## Implementação prevista

- **Edge nova** (nome a definir no plano, ex. `adicionar-variacoes-familia`): POST, admin-only
  (`requireUserOrg` + checagem de role, padrão ADR-0060/0094 D-15), recebe `familia_id` + array de
  variações novas (com foto já enviada para storage). Lê as variações vivas da família, valida
  D-5/D-8, cria/reusa lote `origem='manual'`, insere as variações novas (`familias.operacao`
  permanece `UPDATE`, é a família existente), enfileira via `enfileirarFamilias` (mesmo helper de
  `reprocessar-familia/index.ts`).
- **Componente novo** `dialog-adicionar-variacao.tsx` em `src/components/estoque/`, reaproveitando
  `linha-variacao-form.tsx` (linhas repetíveis) e `campo-foto.tsx` (upload obrigatório).
- **Gatilho**: item novo no menu "⋮" de `produto-card.tsx`, visível só para admin; desabilitado
  se já existe lote pendente para a família (D-8, checado antes de abrir o dialog e revalidado na
  edge).
- **Sem migration de schema esperada** — a confirmar no plano se algum campo auxiliar de
  auditoria (ex. rastrear que o lote nasceu desta tela, análogo ao `origem='manual'`) precisa de
  coluna nova ou se `origem` já é suficiente.

## Validação (critérios de aceite)

- Família publicada (Legacy) + 1 cor nova com foto e estoque > 0 → lote de UPDATE criado, cor
  nasce publicável, aparece no ML após o processamento.
- Mesma família, N cores novas na mesma submissão → 1 lote só, N variações novas.
- Tentativa sem foto em qualquer linha → formulário não salva, erro claro por linha.
- CODIGO duplicado em outra família da org → 409 com o SKU em conflito, nada gravado.
- Família com lote não-terminal em andamento → botão bloqueado/edge recusa com 409.
- Operador não-admin → ação não aparece no menu e a edge recusa mesmo com chamada direta.
- Família migrada para User Products pelo ML → adoção por SKU do ADR-0104 roda normalmente na
  primeira chamada; variação nova é criada como item irmão.
- Lote criado por esta tela **não** aparece na fila de Revisão.
- Sucesso e erro do processamento disparam notificação no sino e refletem no status do card do
  produto na tela Estoque.
- `pnpm lint` + `pnpm test` passando; blast radius de deploy recalculado se `_shared/` for
  tocado (ADR-0088 §1).

## Implementação (2026-08-20)

O plano de execução (`docs/superpowers/plans/2026-08-20-adicionar-variacao-familia-publicada.md`)
registrou 5 desvios conscientes do texto acima — decididos no planejamento, não uma reabertura
das decisões D-1…D-11:

1. **Encadeia `publicar-familias`, não `enfileirarFamilias`.** O sketch em "Implementação
   prevista" leva a `process-familia`, que para UPDATE só resolve cor e marca `'pronto'` — o lote
   ficaria parado esperando clique manual na Revisão, violando D-10. `publicar-familias` já faz
   claim, decide split vs. update (ADR-0034/0104) e enfileira o worker.
2. **Lote dedicado por submissão**, não o lote manual aberto do ADR-0094 D-1.1: a unique
   `familias_lote_id_codigo_pai_key` colidiria com a família CREATE original quando o produto
   nasceu por cadastro manual.
3. **Migration nova** (`20260820143736_guard_estoque_update_manual.sql`), apesar de "sem migration
   esperada" acima: o guard de estoque de `validar_variacao_no_tenant` (20260804113000) proibia
   INSERT de variação com `estoque <> 0` em lote manual; as cópias das variações vivas precisam
   nascer com o estoque vivo, senão a família nova vira canônica na tela Estoque com saldo 0 e o
   worker zeraria o estoque no ML. Relaxado para só valer quando `familias.operacao = 'CREATE'`.
4. **UNIDADE/FORNECEDOR fora do formulário**, embora D-6 os liste: são colunas de `familias`, não
   de `variacoes` — não existe onde gravar por variação. Clonados inalterados da família
   publicada.
5. **`estoqueInicial > 0` obrigatório** no formulário e na edge: cor nova com estoque 0 nasceria
   `excluida_da_publicacao` (ADR-0016) e o UPDATE rodaria sem ela — submissão inútil e confusa
   (mesmo racional anti-zumbi do D-4).
6. **D-6 estendido para CUSTO e PRECO (2026-08-21, pedido do Diego).** Os dois também nascem
   pré-preenchidos da mesma variação irmã, editáveis — mesmo racional do D-6 original: cor
   diferente do mesmo produto quase nunca muda custo nem preço mínimo. Reaproveita a mesma query
   de prefill (`fetchFamiliaCanonicaPrefill`); nenhuma chamada nova.
