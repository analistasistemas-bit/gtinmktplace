# Marca própria configurável e marca por produto — design

Data: 2026-10-20 · Pedido: Diego · Emenda/substitui parte do ADR-0186 · ADR a escrever antes do código: **0188**
(conferir com `git fetch` — numeração paralela)

## Intenção

Hoje (ADR-0186) a marca própria é uma flag ligada **por SQL** só na Zaven e vale para **todo** produto da org:
BRAND = `marca_padrao` sempre. Diego quer:

1. Ligar/desligar marca própria e definir o nome da marca **pela tela Organizações**.
2. Que ela valha para produtos cadastrados pelo **menu Estoque**; na **planilha** vale a coluna FORNECEDOR, como
   antes (decisão do Diego, 20/10).
3. Poder usar **outra marca num produto específico** — caso real: camisa Lacoste revendida original → Marca = Lacoste.
4. Trocar a marca **depois**, inclusive com o anúncio **publicado**, e a troca ir para o ML **na hora** que salvar.

## Situação medida

- Cadastro pelo Estoque: `src/components/estoque/dialog-cadastro-produto.tsx` + `use-cadastro-produto.ts` →
  edge `cadastrar-produto` → `familias` (lote `origem='manual'`) → `process-familia` (mesma pipeline da planilha).
  O formulário só tem **Fornecedor**; não existe coluna de marca em `familias`/`variacoes`. O mesmo diálogo é aberto
  pela Viabilidade e pela importação de nota.
- `marca_padrao` só é definida ao **criar** a org (`Organizacoes.tsx` `NovaOrgDialog` → edge `usuarios`
  `create_org`, super-admin). Não há edição depois; `marca_propria` só existe por SQL.
- Estoque não tem "editar cadastro"; o card tem entrada, ajuste, excluir, fiscal, adicionar variação.
- Política atual: `_shared/categoria/marca-org.ts` (`lerMarcaOrg`, `marcaDoProduto`, `forcarMarcaPropria`),
  aplicada em process-familia, definir-categoria-familia, atributos-familia, criar-kit-vinculado, update-familia-ml,
  publicar-split-ml, atualizar-familia-up, reconciliar-convergencia-up. Worker `sincronizar-marca-ml` corrige BRAND
  de anúncios UP publicados (PUT só de `attributes`, tolera a transição 1 família antiga → 1 nova, grava o
  `family_id` local).
- Zaven: 10 PAIs, **todos** cadastrados pelo Estoque (`origem='manual'`), todos com BRAND=Zaven no ML.
- Medido 18/10: PUT de BRAND num item UP faz o ML mover o SKU para um `family_id` novo em segundos; MLBU, fotos e
  status não mudam.

## Objetivos

1. Super-admin liga/desliga marca própria e edita o nome da marca da org na tela Organizações.
2. Cadastro pelo Estoque numa org com marca própria: campo **Marca** pré-preenchido com a marca da org, editável.
3. "Editar marca" de um produto já cadastrado (publicado ou não), com opção "usar a marca da org"; salvar em produto
   publicado leva a marca ao ML na hora.
4. Planilha: BRAND = FORNECEDOR (como antes do ADR-0186), mesmo na org com marca própria.
5. Avil e demais orgs sem marca própria: comportamento idêntico ao atual.

## Não-objetivos

- Coluna MARCA na planilha.
- Campo Marca para orgs sem marca própria.
- Republicar anúncio (proibido); trocar título/descrição quando a marca muda.
- Outros canais além do ML.

## Anti-objetivos

- Fornecedor aparecer como marca em produto da Zaven cadastrado pelo Estoque.
- Um "Atualizar" posterior reverter a marca escolhida (o delta UP lê `familias.atributos_ml`).
- Desagrupar família UP; escrever no ML fora do fluxo do app.

## Decisões do Diego

- Opção e nome da marca na tela da org; marca por produto no cadastro e depois, mesmo publicado; envio na hora.
- Planilha usa a coluna FORNECEDOR.

## Decisões minhas (Diego pode corrigir)

1. **Marca gravada no produto:** coluna nova `familias.marca text null`.
   - Estoque (`cadastrar-produto`): grava o valor do campo Marca (default = `marca_padrao` da org com marca
     própria). Org sem marca própria: não grava (null).
   - Planilha (`ingest-lote`): CREATE grava null; UPDATE **copia** `marca` da família anterior (como `atributos_ml`).
   - **Regra única de BRAND/MANUFACTURER:** `familias.marca` → fornecedor → `marca_padrao` → `'Avil'`.
     `marca_propria` deixa de forçar a marca na montagem; passa a controlar só o campo no cadastro/edição.
   - Por quê: tira a dedução "veio do Estoque ou da planilha?" do pipeline; o produto carrega a decisão.
2. **Backfill (migration):** `familias.marca = 'Zaven'` em todas as famílias da Zaven (todas são do Estoque) —
   senão a nova regra cairia no fornecedor.
3. **`forcarMarcaPropria` → `forcarMarcaDoProduto`:** impõe `familias.marca` (quando preenchida) nos caminhos que
   preservam/copiam/mesclam atributos (edição do operador, kit, herança do irmão UP, reconciliação), mantendo o
   `value_id` quando o nome já é a marca (lição do lote 54). Sem `marca` → nada é imposto.
4. **Org — edge `usuarios` ação nova `set_marca_org`** (super-admin, molde `set_tipo_pessoa_org`):
   `{ org_id, marca_propria, marca_padrao }`; ligar exige `marca_padrao` não vazia. UI: seção na Central de
   Organizações (`Organizacoes.tsx`), Switch + Input. Mudar o nome **não** altera produtos já cadastrados (a marca
   está gravada neles).
5. **Editar marca — edge nova `atualizar-marca-familia`** (JWT, admin da org — mesma regra do Pausar, ADR-0060):
   `{ codigo_pai, marca: string | null }` (`null` = "usar a marca da org" → grava `marca_padrao` atual).
   - Grava `familias.marca` e reescreve BRAND/MANUFACTURER em `familias.atributos_ml` em **todas** as linhas do
     `codigo_pai` na org (snapshots de UPDATE), numa transação (RPC).
   - Publicado: enfileira `sincronizar-marca-ml` (QStash) para aquele `codigo_pai`.
   - UI: item "Editar marca" no card do produto (`produto-card.tsx`), diálogo com Input + "Usar a marca da org".
   - Só aparece em org com marca própria.
6. **`sincronizar-marca-ml` passa a usar a marca do produto:** alvo = `familias.marca` da família vigente do
   `codigo_pai` (`publicado_em desc`), não mais `marca_padrao`. Deixa de exigir `marca_propria` (exige marca
   resolvida não vazia).
   - **Legacy (item único com variações):** hoje o worker só cobre UP. Para Legacy: PUT `{attributes:[BRAND]}` no
     `item_externo_id` da raiz (todas as partições), relendo a marca. Zaven hoje é 100% UP; Legacy entra para não
     falhar em silêncio.
7. **Cadastro — campo Marca** em `dialog-cadastro-produto.tsx`, junto do Fornecedor, só em org com marca própria;
   pré-preenchido; obrigatório não vazio. Vale também quando aberto pela Viabilidade e pela nota.

## Verificação

- Testes de unidade da regra (marca do produto > fornecedor > padrão), do `forcarMarcaDoProduto`, do
  `set_marca_org`, da edge `atualizar-marca-familia` (todas as linhas, atributos_ml reescrito, enfileira só se
  publicado), do worker com marca do produto e com Legacy.
- Teste SQL da migration (coluna + backfill só na Zaven; Avil intacta) pelo padrão sem Docker.
- Teste de componente do campo Marca e do diálogo Editar marca.
- Validação de runtime: produto de teste na Zaven com marca "Lacoste" → BRAND=Lacoste no ML; voltar para a marca da
  org → BRAND=Zaven; `family_id` único; status inalterado; nenhum republish.

## Deixado para quem implementar

- Nome exato da RPC de gravação; layout fino dos componentes (seguir padrões existentes, `ui/select`/Switch).
- Se a edge de edição reutiliza `qpub`/`enfileirar*` existente para o worker.
