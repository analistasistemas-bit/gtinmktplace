# Reposição — Fora de linha (fatia 3) — plano

ADR: `docs/decisions/0207-reposicao-de-estoque-e-pedido-de-compra.md` (emenda 23–24) · Classificação: moderada (sem migration; ação nova na edge `reposicao`).

## Decisões (Diego, 17/11)
- "Fora de linha" é marcado **só no Estoque** (produto inteiro ou uma cor); a Reposição só obedece. Cor vale **só para aquele produto**.
- Qualquer membro marca (reversível, operacional). Estoque restante continua à venda; anúncio no ML não muda.
- Marcar tira do **rascunho** os itens afetados, com confirmação. Pedido já aprovado/enviado não é tocado.
- O menu "Não repor ▾" da Reposição sai. Tamanho avulso continua no popover da célula ("Não repor este tamanho").
- Reaproveita `reposicao_nao_repor` (escopo `familia`/`cor`). Sem migration, sem mudança em `_shared/` (nada de redeploy em massa; só a edge `reposicao`).

## Contrato da edge (Task A)
`POST reposicao` ação `fora_de_linha` `{ escopo: 'familia' | 'cor', codigoPai, cor? }` → `{ id, removidos: { rascunhos: number, unidades: number } }`.
Insere a marca (idempotente, mesmo caminho de `nao_repor`) e depois, para cada rascunho da org com itens afetados, chama `reposicao_salvar_rascunho` com `quantidade: 0` só nos SKUs afetados (a RPC remove sob lock e apaga o rascunho vazio). Cor casa por texto exato da variação, dentro do produto. Falha no meio: a marca já existe e o retry é idempotente. Voltar à linha = `remover_nao_repor` existente (não mexe em rascunho).

## Tasks
- **A (Opus + revisão Codex):** ação `fora_de_linha` em `supabase/functions/reposicao/acoes.ts` + testes (marca; idempotência; rascunho com itens da cor/produto some ou perde só os afetados; rascunho vazio apagado; pedido aprovado intocado; org alheia isolada; cor de outro produto intocada).
- **B (Sonnet):** Estoque — item "Fora de linha…" no menu ⋯ do produto abre `DialogForaDeLinha` (produto inteiro + cada cor, Marcar/Voltar à linha, confirmação com unidades no rascunho e aviso de recálculo) e selo "Fora de linha" no card. Usa `useReposicao` já carregado no Estoque (`naoRepor`, `rascunhos`).
- **C (Sonnet):** Reposição — remover o `DropdownMenu` "Não repor ▾"; esconder por padrão família marcada e linha de cor toda marcada; filtro "Mostrar fora de linha" (esmaecido, com "Abrir no Estoque"); hook `foraDeLinha`.
- **D:** ADR (emenda 23–24), `CONTEXT.md` (glossário), spec, `docs/reference/edge-functions.md`, vault (skill `docs-update-checklist`).

## Aceite
1. Marcar o Preto no Estoque: some da Reposição; cards, lista e resumo diário sem ele; rascunho sem o Preto (confirmação mostra as unidades).
2. Voltar à linha: reaparece na Reposição, sem alterar rascunho.
3. Produto marcado inteiro: some da lista; filtro "Mostrar fora de linha" o mostra esmaecido.
4. Nenhuma cor de outro produto é afetada. Pedido aprovado não muda.
5. `pnpm preflight` verde; deploy só da edge `reposicao` e versão pós-deploy conferida.
