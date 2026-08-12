# Excluir produto no módulo Estoque — design

**Data:** 2026-08-12
**Contexto relacionado:** ADR-0019 (exclusão de lote preserva publicados), ADR-0094 (estoque único / cadastro manual), ADR-0097 (exclusão limpa movimentos órfãos), ADR-0110 (ajuste só reduz, admin-only), ADR-0060 (pausar é admin)
**ADR resultante:** ADR-0113

## Problema

A tela Estoque cadastra produto (ADR-0094) mas não desfaz o cadastro. Produto criado errado, duplicado ou de teste fica na lista para sempre — inflando os KPIs ("SKUs cadastrados", "Valor em estoque") e o filtro "Não publicado".

Hoje existem três portas de exclusão, nenhuma serve:

| Porta | Alvo | Por que não serve |
|---|---|---|
| `excluir-lote` | lote inteiro | produto do Estoque nasce sem planilha; e apaga o lote todo |
| `remover-publicado` | família publicada | **recusa** o não publicado: `processar.ts:51` devolve `nao_publicada` → 400 |
| `cadastrar-produto` (rollback) | família recém-criada | só no caminho de erro do próprio cadastro |

## Decisões

**D-1. O botão exclui apenas produto NÃO publicado em canal nenhum.**

Apagar família com `ml_item_id != null` destrói o vínculo CREATE-vs-UPDATE: o `ingest-lote`
casa por `codigo_pai` buscando famílias com `ml_item_id not null`, então a próxima planilha do
mesmo código viraria CREATE → **anúncio duplicado no ML**. É exatamente o risco que o ADR-0019
existe para conter. Produto publicado continua saindo só pela tela Publicados → "Remover",
que pausa no ML antes de apagar.

**D-2. Edge nova `excluir-produto`, não uma flag em `remover-publicado`.**

`removerPublicado()` tem 236 linhas cuja maior parte é a mini-saga de User Products do ADR-0088
(pausar cada filho no ML, guarda de `mudando_composicao`, re-checagem TOCTOU). Nada disso se
aplica a um produto que nunca foi ao ar. O que é reaproveitável já vive em `_shared` e será
importado igual: `pathsDaFamilia` / `filtrarPathsDeDonos` (`_shared/lote/exclusao.ts`),
`recontarOuRemoverLote` (`_shared/lote/recontar.ts`), `limparMovimentosOrfaos`
(`_shared/estoque/limpeza.ts`).

**D-3. A trava de "publicado" olha o `codigo_pai` inteiro, não a linha clicada.**

Ciclos de UPDATE deixam várias famílias com o mesmo `codigo_pai` (ADR-0019, adendo). Checar só
`alvo.ml_item_id` deixaria excluir a linha não publicada de um produto que TEM anúncio vivo em
outra linha — cortando o vínculo pela porta dos fundos. A trava recusa se **qualquer** família
do `codigo_pai` na org tiver `ml_item_id != null`.

**D-4. O delete apaga todas as famílias do `codigo_pai` na org.** Mesma razão simétrica: deixar
irmãs vivas faria o produto reaparecer na lista do Estoque logo após a exclusão. As `variacoes`
somem por cascade.

**D-5. `limparMovimentosOrfaos` roda DEPOIS do delete commitar (ADR-0097 D-2).** Antes do delete
o anti-join devolveria conjunto vazio. Não se apaga movimento por código: os quatro motivos de
D-1.1 do ADR-0097 — em especial o tombstone `cancelamento_sem_baixa` — precisam sobreviver, sob
pena de reabrir a baixa silenciosa de pedido cancelado.

**D-6. Admin-only, 403 na edge.** Ajustar/zerar já é admin (ADR-0110) porque tira o produto de
venda; excluir é estritamente mais pesado. Mesmo padrão de `ajustar-estoque/index.ts:29`.
Esconder o item no menu é coerência de navegação — a trava real é a edge.

**D-7. Saldo > 0 não bloqueia; a confirmação é digitada.** Produto de teste nasce com entrada,
então bloquear viraria um passo extra de "zerar via Ajustar" em todo caso legítimo. O diálogo
mostra o saldo e exige digitar o código do produto — o atrito impede o clique errado sem impedir
o caso normal.

**D-8. O botão nunca é gateado pelo estado da query de canais.** `fetchCanaisPorProduto` é uma
query separada que falha **aberta** (`Estoque.tsx` documenta: quando os canais não carregam, o
produto é assumido publicado). Gatear o clique nela esconderia o botão numa falha transitória.
O item abre o diálogo; quem recusa é a edge, com 409 legível.

## Arquitetura

### Backend — `supabase/functions/excluir-produto/`

`index.ts` (gate + tradução de resultado → HTTP) e `processar.ts` (lógica pura, testável),
seguindo o desenho de `remover-publicado`.

Entrada: `{ familia_id: string }`.

```
requireUserOrg(req, { access: 'write' })        → 401/403
isAdmin                                          → 403 "Somente administradores…"
exigirModulo(admin, orgId, 'estoque')            → 403

1. familias.select(id, lote_id, codigo_pai, org_id, user_id) por id+org   → nao_encontrada (404)
2. familias por (codigo_pai, org) com ml_item_id not null, limit 1        → publicado (409)
3. familias por (codigo_pai, org) com status in (publicando, processando) → em_voo (409)
4. familias por (codigo_pai, org): capas + variacoes(imagem_path)
   → pathsDaFamilia + filtrarPathsDeDonos → storage.remove (erro só warn, segue)
5. familias.delete().in(id, alvos)                                        → cascade em variacoes
6. limparMovimentosOrfaos(admin, orgId)
7. recontarOuRemoverLote(loteId, false) por lote afetado
8. auditarOperacaoSuporte(...)
→ { ok: true, familias_removidas, lotes_removidos, movimentos_removidos }
```

`anuncios_externos` não é tocada: sem publicação não há linha. A ordem "storage antes do banco"
copia `remover-publicado` — a foto órfã é resíduo barato, a família órfã sem foto não é.

Erros de consulta são fail-closed (`throw`), nunca degradam para lista vazia: um erro no passo 2
virando "nenhuma publicada" apagaria o vínculo de UPDATE em silêncio.

### Front

`src/lib/excluir.ts` — ganha `excluirProduto(familiaId)` usando o `chamarEdge` que já existe.

`src/components/estoque/produto-card.tsx` — a coluna de ações passa de dois botões para
`[Entrada] [Ajustar] [⋯]`. O `DropdownMenu` só é renderizado para admin (mesma condição do
`onAjustar`). Item "Excluir produto", variante destrutiva, desabilitado com tooltip
"Publicado — remova pela tela Publicados primeiro" quando o produto tem canal conhecido.
A largura da coluna de ações (comentário em `produto-card.tsx:31`) é reajustada para três slots.

`src/components/estoque/dialog-excluir-produto.tsx` (novo) — mostra nome, código, nº de SKUs e
saldo total; input de confirmação que exige o `codigo_pai` exato (trim, case-insensitive); botão
"Excluir produto" desabilitado até bater. Sucesso: toast + `invalidateQueries` de
`['produtos-saldo']` e `['canais-por-produto']`. Erro: toast com a mensagem da edge.

`src/pages/Estoque.tsx` — estado `produtoExcluir` espelhando `produtoAjuste`, passado ao card.

## Testes

Backend (`supabase/functions/excluir-produto/__tests__/processar.test.ts`), com o mesmo mock de
client usado nos testes de `remover-publicado`:

1. família inexistente → `nao_encontrada`
2. qualquer irmã do `codigo_pai` publicada → `publicado`, **nada apagado** (nem storage)
3. irmã em `publicando` → `em_voo`, nada apagado
4. caminho feliz: apaga as N famílias do `codigo_pai`, chama storage.remove com os paths do dono,
   chama `limparMovimentosOrfaos` **depois** do delete, reconta os lotes
5. erro na consulta do passo 2 propaga (não vira "não publicado")

Front (`src/components/estoque/__tests__/dialog-excluir-produto.test.tsx`):

6. botão desabilitado até o código digitado bater
7. sucesso invalida as duas queries e fecha o diálogo

## Documentação

- `docs/decisions/0113-exclusao-de-produto-no-estoque.md` (novo)
- `docs/reference/edge-functions.md` — entrada da `excluir-produto`
- `obsidian-vault/03-Módulos/Estoque.md` + `obsidian-vault/04-Decisões/Índice de ADRs.md`
- `docs/TASKS.md`

## Fora de escopo

- Excluir produto publicado pelo Estoque (D-1)
- Soft delete / lixeira: nenhuma outra porta de exclusão tem, e não foi pedido
- Exclusão em massa
