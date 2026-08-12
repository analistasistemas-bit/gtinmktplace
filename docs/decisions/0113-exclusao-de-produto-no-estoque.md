# ADR-0113 — Exclusão de produto pelo Estoque: só o que não está publicado

- **Status:** aceito
- **Data:** 2026-08-12
- **Refina:** [ADR-0094](0094-estoque-unico-cadastro-manual.md) (cadastro manual de produto),
  [ADR-0019](0019-exclusao-lote-preserva-publicados.md) (exclusão nunca remove família publicada)
- **Contexto relacionado:** ADR-0097 (varredura de movimentos órfãos), ADR-0110 (ajuste é admin),
  ADR-0060 (pausar/reativar é admin), ADR-0096 (código automático)
- **Spec:** `docs/superpowers/specs/2026-08-12-excluir-produto-estoque-design.md`

## Contexto

O ADR-0094 deu ao Estoque a porta de **entrada** de produto (cadastro manual) sem dar a de saída.
Produto criado errado, duplicado ou de teste ficava na lista para sempre, inflando os KPIs da tela
("SKUs cadastrados", "Valor em estoque") e o filtro "Não publicado".

Nenhuma das três portas de exclusão existentes serve:

| Porta | Alvo | Por que não serve |
|---|---|---|
| `excluir-lote` | lote inteiro | produto do Estoque nasce sem planilha |
| `remover-publicado` | família publicada | **recusa** o não publicado (`processar.ts:51` → 400) |
| `cadastrar-produto` (rollback) | família recém-criada | só no caminho de erro do próprio cadastro |

## Decisão

**D-1. A exclusão pelo Estoque só alcança produto NÃO publicado em canal nenhum.**

O `ingest-lote` decide CREATE vs UPDATE buscando família anterior com `ml_item_id is not null`
casada por `codigo_pai`. Apagar essa linha faria a próxima planilha do mesmo produto virar CREATE
→ **anúncio duplicado no ML**. É a restrição central do ADR-0019, e ela não muda por causa de uma
porta nova. Produto publicado continua saindo só pela tela Publicados → "Remover"
(`remover-publicado`), que pausa no ML antes de apagar.

**D-2. Edge nova `excluir-produto`, não uma flag em `remover-publicado`.**

`removerPublicado()` é, na maior parte, a mini-saga de User Products do ADR-0088 — pausar cada
filho no ML, guarda de `mudando_composicao`, re-checagem TOCTOU. Nada disso se aplica a um produto
que nunca foi ao ar, e enfiar um desvio no topo dela deixaria a saga inteira a um `if` de distância
de rodar sobre o caso errado. O que é genuinamente compartilhado já vive em `_shared` e é importado
igual: `pathsDaFamilia` / `filtrarPathsDeDonos`, `recontarOuRemoverLote`, `limparMovimentosOrfaos`.

**D-3. A trava de "publicado" varre o `codigo_pai` inteiro, não a linha da tela.**

Ciclos de UPDATE deixam várias famílias com o mesmo `codigo_pai` (ADR-0019, adendo), e a tela
Estoque mostra só a **mais recente** (`agruparProdutosComSaldo`). Checar apenas ela deixaria excluir
a linha crua de um produto com anúncio vivo em outra — cortando o vínculo pela porta dos fundos. A
edge recusa (409) se **qualquer** família do `codigo_pai` na org tiver `ml_item_id != null`.

O predicado é `ml_item_id not null`, não `publicado_em not null` (o sinal que `particionarExclusao`
usa): aqui o que importa é exatamente o que o `ingest-lote` consulta para decidir UPDATE — inclusive
a linha de reposição que herdou o id sem publicar nada.

**D-3.1. Qualquer linha em `anuncios_externos` para o `codigo_pai` também recusa.**

`ml_item_id is null` sozinho não prova "nunca foi ao ar": na janela `criacao_incerta` do ADR-0088 o
POST já saiu para o ML e o id ainda não voltou para a família — anúncio vivo lá fora, coluna nula
aqui, e o status pode ter caído em `erro` (que o guard de em-voo, restrito a
`publicando`/`processando`, não pega). O espelho `anuncios_externos` é best-effort para dizer "está
publicado", mas a **presença** de uma linha é sinal confiável de que este código já teve vida em
canal. Fail-closed: uma query a mais troca uma suposição por uma checagem.

**D-4. O delete apaga todas as famílias do `codigo_pai` na org.** Simétrico ao D-3: deixar irmãs
vivas faria o produto reaparecer na lista logo após a exclusão. As `variacoes` somem por cascade.
Por isso a edge recebe `codigo_pai`, não `familia_id` — resolver o id para varrer o código de volta
seria indireção sem função.

**D-5. `limparMovimentosOrfaos` roda DEPOIS do delete commitar (ADR-0097 D-2).** Antes dele o
anti-join sai vazio, porque o cascade ainda não rodou. A varredura é por anti-join e nunca por
"os códigos que acabei de apagar": os quatro motivos do ADR-0097 D-1.1 — em especial o tombstone
`cancelamento_sem_baixa` — precisam sobreviver, sob pena de reabrir a baixa silenciosa de pedido
cancelado.

**D-6. Admin-only, com 403 na edge.** Ajustar/zerar já é admin (ADR-0110) porque tira o produto de
venda; excluir é estritamente mais pesado. Esconder o menu para não-admin é coerência de navegação
— a trava real é o 403.

**D-7. Saldo em estoque não bloqueia; o freio é digitar o código.** Produto de teste nasce com
entrada de mercadoria, então exigir saldo zero viraria um passo obrigatório de "zerar via Ajustar"
em todo caso legítimo. O diálogo mostra o saldo e só habilita o botão quando o operador digita o
`codigo_pai` — atrito suficiente contra o clique errado, sem custo no caminho normal.

**D-8. O botão não depende da query de canais.** `fetchCanaisPorProduto` é uma query separada que
falha **aberta** (quando não carrega, `Estoque.tsx` assume o produto publicado). O item do menu é
desabilitado por `produto.mlItemId`, a fonte canônica que já vem com a lista; e mesmo essa checagem
é só para poupar a ida — quem recusa de fato é a edge, que enxerga as irmãs que a tela não mostra.

## Consequências

- Nova edge `excluir-produto` (`verify_jwt = true`), body `{ codigo_pai }`, respostas 404
  (inexistente), 409 (publicado / em voo), 403 (não-admin ou módulo desabilitado). A auditoria de
  suporte grava `target_type = 'produto'` (não `familia`): o alvo é um `codigo_pai`, e as outras
  portas gravam UUID de família no mesmo campo `text`.
- A coluna de ações da linha de produto passa a ter um menu `⋮` (12.5rem → 15rem no desktop,
  5.5rem → 7.5rem no mobile).
- A exclusão leva o histórico de movimentos do produto junto, pela varredura do ADR-0097. Como só
  alcança produto nunca publicado, esse histórico é de entrada/ajuste manual — não de venda.
- O ML nunca é tocado, em nenhum caminho desta porta.
