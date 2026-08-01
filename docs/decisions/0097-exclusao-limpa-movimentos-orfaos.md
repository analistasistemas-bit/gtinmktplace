# ADR-0097 — Exclusão de produto/lote limpa os movimentos de estoque órfãos

**Status:** Aceito
**Data:** 2026-08-01
**Contexto relacionado:** ADR-0094 (D-5, ledger de estoque), ADR-0019 (exclusão de lote), ADR-0096 (código automático)

## Contexto

`estoque_movimentos` não tem FK para `variacoes` nem para `familias`: a ligação é
`(org_id, codigo)` resolvida em tempo de escrita (`baixar_estoque`, `registrar_entrada`).
Isso é deliberado — uma venda de SKU inexistente precisa ser gravável
(`venda_sku_nao_encontrado`), o que uma FK impediria.

A consequência é que nenhuma das três portas de exclusão remove movimentos:

| Porta | O que apaga hoje |
|---|---|
| `excluir-lote` | famílias não publicadas + Storage (ADR-0019 D-1, D-5) |
| `remover-publicado` | famílias do `codigo_pai` + Storage + `anuncios_externos` |
| `cadastrar-produto` (rollback) | a família recém-criada |

As variações morrem por cascade, mas o ledger sobrevive. Em 2026-08-01 a org DSA tinha
**5 movimentos de famílias já excluídas** — saldo íntegro, porém histórico de produtos que
não existem mais. O operador (Diego) pediu explicitamente que a exclusão não deixe resíduo.

## Decisão

**D-1. A exclusão varre os órfãos por anti-join, não pelos códigos recém-apagados.**
Uma RPC `limpar_movimentos_orfaos(p_org uuid) returns integer` apaga os movimentos da org
cujo `codigo` **não corresponde a nenhuma `variacoes` viva daquela org**.

Deletar "os códigos que acabei de apagar" seria errado: `excluir-lote` preserva famílias
publicadas (ADR-0019 D-1) e o mesmo `codigo_pai` tem várias famílias por ciclo de UPDATE
(ADR-0019, adendo) — o SKU sobrevive em outra linha e seu histórico deve sobreviver junto.
O anti-join também é auto-curativo: absorve os órfãos que já existem, sem script avulso.

**D-2. A varredura roda DEPOIS do delete commitar, em cada porta.** As variações somem por
cascade; calcular o conjunto órfão antes do delete devolveria vazio. Chamadas em
`excluir-lote` e `remover-publicado`. O rollback do `cadastrar-produto` **não** chama: seus
dois pontos de delete (`index.ts:247,253`) disparam antes de qualquer `registrar_entrada`,
então não há movimento nem foto a limpar.

**D-3. Em SQL, não em TypeScript.** O PostgREST trunca em ~1000 linhas — a mesma razão do
`paginarTudo` obrigatório em `reconciliar-estoque`. Montar um `NOT IN` no cliente
sub-limparia em silêncio à medida que a org crescesse. A RPC segue o rodapé padrão do E6b:
`security definer`, `set search_path = ''`, revoke de `public/anon/authenticated`, grant só
para `service_role`.

**D-4. A migration limpa os órfãos existentes na aplicação.** O pedido é no presente; uma
mudança só de código deixaria o banco sujo até a próxima exclusão.

**D-5. Fotos já estavam limpas — nada a construir.** `pathsDaFamilia` cobre capas +
imagens de variação nas duas portas, com guard de posse por prefixo de dono. Auditoria do
Storage em 2026-08-01: **zero arquivos órfãos**. Registrado aqui para que a próxima
revisão não "conserte" um caminho que funciona.

## Consequências

- Exclusão de produto ou de lote não deixa mais resíduo no ledger.
- **Histórico de venda de produto excluído é perdido.** Aceito e pedido pelo operador. O
  caminho de risco é só `remover-publicado` — `excluir-lote` nunca toca família publicada,
  então produto com venda raramente chega lá.
- **A guarda de idempotência morre junto com a linha.** Apagar um movimento de `venda`
  libera sua `referencia_externa`: um webhook re-entregue do ML re-insere o movimento. Para
  a DSA é inofensivo (códigos são sequenciais e nunca se repetem — ADR-0096 — e a re-entrega
  cai em `venda_sku_nao_encontrado`). Para uma org de planilha que reimporte o **mesmo
  CODIGO** depois, uma re-entrega antiga decrementaria o produto NOVO. Risco conhecido,
  aceito: a janela de re-entrega do ML é curta e a reimportação do mesmo código após
  exclusão é operação rara e deliberada.
- O que a exclusão **preserva** não muda: ADR-0019 D-1 continua valendo — lote não remove
  família publicada. Este ADR muda apenas qual lixo sobrevive à remoção, nunca o que é removido.
- Inverte parcialmente **ADR-0094 D-5** ("todo movimento é auditável"): a trilha permanece
  imutável enquanto o produto existir; a exclusão do produto passa a levar a trilha junto.
