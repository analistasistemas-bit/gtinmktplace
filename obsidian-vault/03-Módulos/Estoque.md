---
tags: [modulo, estoque]
atualizado: 2026-08-11
---

# Estoque

Rota `/estoque`. Estoque único cross-canal: o saldo do PubliAI é a fonte da verdade e é
empurrado para todos os canais publicados. Em produção desde 2026-07-29 (ADR-0094).
Ver [[Produtos]], [[Publicação Mercado Livre]], [[Banco de Dados]], [[Edge Functions]],
[[Índice de ADRs]].

**Módulo pago, ligado por org.** `organizations.modulos_habilitados` nasce **vazio** — nenhuma
org enxerga o menu até o super-admin ligar em `/admin` (action `set_modulos_org` da edge
`usuarios`). As edges do módulo repetem o gate e respondem **403**.

## Ledger `estoque_movimentos`

Imutável e idempotente (migration `20260729084329_e6b_estoque_movimentos.sql`), com idempotência
por `(org_id, referencia_externa)`. Nada escreve `variacoes.estoque` direto: o trigger
`variacoes_bloquear_escrita_direta_estoque` só libera o `UPDATE` para o `current_user` =
`estoque_rpc_executor`. Toda mutação passa por RPC `security definer`, executável só por
`service_role`.

| Motivo | RPC | Origem |
|---|---|---|
| `venda` | `baixar_estoque` | venda paga (`pedido.status === 'paid'`) no `sync-venda` |
| `estorno_venda` | `estornar_estoque` | cancelamento pré-despacho (D-7) |
| `entrada` | `registrar_entrada` | entrada de mercadoria / cadastro manual |
| `ajuste` | `ajustar_estoque` | ajuste ou zeragem pelo admin (ADR-0110) |
| `venda_sku_nao_encontrado` | — | trilha informativa: venda paga sem SKU resolvido (`quantidade = 0`) |

Devolução **não** é tocada pelo ledger.

## Push para os canais

O push é **absoluto** (nunca delta), enfileirado na fila serial `estoque-{orgId}` para todos os
canais publicados **exceto o de origem** do movimento. Worker `sincronizar-estoque`
(`verify_jwt=false`).

Rede de segurança: `reconciliar-estoque` (schedule QStash `30 12 * * *`) re-empurra todo produto
com movimento nas últimas 24h. Ela re-empurra com `canal_origem: null`, então **editar estoque
direto no Mercado Livre é revertido em até 24h** — ver a regra operacional abaixo.

> **`DELIVERED 200` no QStash não prova que o canal foi atualizado.** `sincronizar-estoque`
> devolve 200 mesmo em falha definitiva do push (loga `estoque_push_definitivo` e segue). Para
> conferir de verdade, ler o estoque vivo (tela Publicados / `lerStatus`).

Anúncio **moderado** (`sub_status = forbidden`) recusa o push com 400 ("republique o produto"):
o ajuste local é aplicado do mesmo jeito e o canal fica para trás até a republicação.

## Ajuste e zeragem (ADR-0110)

Edge `ajustar-estoque`, diálogo por produto e variação na tela `/estoque`.

1. **Só reduz ou zera.** `novo_saldo > saldo_atual` é rejeitado — aumentar continua sendo Entrada
   de mercadoria, que exige custo válido e alimenta `variacoes.custo` (insumo de markup e preço,
   ADR-0055). Ajuste livre para cima seria entrada sem custo e sem documento, e mascararia um
   webhook de venda perdido.
2. **É admin**, por paridade com pausar/reativar anúncio (ADR-0060): zerar uma cor tira o produto
   de venda.
3. **Estorno repõe por cima do zero.** Pedido cancelado depois da zeragem **repõe** o saldo e pode
   fazer a cor voltar a vender — cancelamento significa mercadoria que voltou fisicamente. Quem
   quer tirar de venda de vez usa **Pausar**.

Ajuste com `quantidade = 0` (conferência que não mudou nada) é trilha deliberada e não afeta somas.

## Reposição reativa o anúncio pausado (ADR-0111)

O ML desfaz sozinho só a pausa que **ele mesmo** aplicou por falta de estoque; pausa do vendedor
fica de pé mesmo com o saldo já no canal. Desde 2026-08-11, um push de **reposição** com saldo > 0
lê o status ao vivo depois do push e devolve `pausado` → `ativo`.

- A intenção vem do **sinal da quantidade** no ledger: entrada e estorno reativam; venda e ajuste
  não. `ajustar-estoque` nunca reativa por construção (só reduz).
- **A reconciliação diária não reativa** — senão um anúncio pausado à mão voltaria ao ar sem
  ninguém ter reposto nada.
- **Só sai de `pausado`.** `moderado`, `encerrado`, `inativo` e `indisponivel` são intocados —
  forçar `active` num anúncio moderado é o tipo de escrita que já custou um anúncio cancelado
  (incidente 2026-08-06, ver [[Incidentes]]).
- Idempotente por leitura: anúncio já ativo não recebe PUT.

## Cadastro manual e entrada de mercadoria

Bloco B do E6b (ADR-0094): produto entra **sem planilha**. Edges `cadastrar-produto` e
`entrada-estoque` (`verify_jwt=true`). "Sessão de cadastro = um lote": `lotes.origem = 'manual'`
(chip Planilha/Cadastro manual no LoteCard) — `lote_id` é `NOT NULL` e sustenta `process-familia`,
`finalizarLote` e a unique `(lote_id, codigo_pai)`.

## Exclusão de produto (ADR-0113)

Menu `⋮` na linha do produto → **Excluir produto**. Edge `excluir-produto` (`verify_jwt=true`),
admin-only como o ajuste, body `{ codigo_pai }`. O menu só é renderizado a partir de `md`: medido
em 375px, um terceiro botão na coluna de ações derrubava o texto do nome do produto de 81px para
49px ("Crem…").

**Só alcança produto não publicado em canal nenhum.** Apagar família com `ml_item_id` cortaria o
vínculo de UPDATE do `ingest-lote` e a próxima planilha do mesmo código viraria **anúncio
duplicado** no ML — a restrição do [[Exclusão de lote|ADR-0019]]. Publicado sai por
`remover-publicado` (tela Publicados → Remover), que pausa no ML antes.

A trava olha **todas** as famílias do `codigo_pai`, não a linha que a tela mostra: a lista exibe só
a mais recente, e uma irmã publicada é invisível ali. Pela mesma razão o delete leva todas — deixar
irmã viva faria o produto reaparecer logo após a exclusão.

Saldo em estoque **não** bloqueia (produto de teste nasce com entrada); o freio é digitar o código
no diálogo. O histórico de movimentos vai junto, pela varredura do ADR-0097 — como só alcança
produto nunca publicado, esse histórico é de entrada/ajuste manual, não de venda. O ML nunca é
tocado por esta porta.

## Tela

Redesenhada em 2026-08-02 (PR #56): listagem e cadastro viraram **cards**, sem nenhuma `<table>`
no caminho — `<table>` dentro de `<TableCell>` forçava scroll horizontal estrutural (inclusive em
`/publicados`, que compartilha `MovimentosEstoque`).

- Saldo por produto, entrada, canais publicados e ledger paginado com filtros (tipo, período, SKU).
- Busca acha também GTIN e fornecedor; filtro "não publicado" deriva de `familias.ml_item_id`
  (fonte canônica), não de `anuncios_externos` (espelho que pode ficar furado sem erro).
- **Foto:** produto de planilha nasce sem capa própria (na AVIL, 1 de 147 famílias tem
  `capa_storage_path`), então a tela cai para a foto do anúncio no ML
  (`https://http2.mlstatic.com/D_{ml_picture_id}-V.jpg`), preferindo capa da família → variação
  principal → primeira variação com foto. Sem nenhuma foto, placeholder — é o caso dos 7 produtos
  em aberto ([[Bugs Conhecidos]]).
- **Preço (desde 2026-08-16):** a coluna mostra o preço VIVO do anúncio, lido de
  `status-publicados` (multiget `/items?attributes=...,price`, cobre 100% dos anúncios da org).
  `variacoes.preco` é o preço local da planilha/markup e nenhum job o reconcilia com o canal —
  mostrava R$ 28,99 num SKU anunciado a R$ 39,90. Quando os dois divergem, o local aparece como
  nota (`local R$ 28,99`) porque é ele que alimenta markup e o próximo push (ADR-0055); a tela
  **não** o sobrescreve. O casamento SKU → anúncio é `variacoes_estoque_produto.ml_item_id`
  (User Products → partição do split → família), senão todas as cores de um produto UP mostrariam
  o preço do mesmo anúncio. `pulse_produtos.meu_preco` não serve de base: só existe onde há ficha
  de catálogo (3 de 7 na DSA, 15 de 133 na Avil — Errata 2 do ADR-0119). Limitação: `/items` devolve o
  preço BASE, sem promoção ativa do vendedor.

## Regra operacional inegociável

**Nunca editar estoque direto no Mercado Livre.** O push é absoluto e a reconciliação diária
restaura o número local em até 24h. Confirmado em produção em 2026-08-11: três anúncios Helanca
Light com o SKU Vermelho zerado no ML voltaram a vender com o saldo antigo (2000/1990/2000).
Para tirar de venda, use **Ajustar/Zerar** (que se propaga a todos os canais) ou **Pausar**.

## Armadilha para a próxima RPC de estoque

Uma RPC nova precisa **pertencer ao role `estoque_rpc_executor`** (senão falha com `42501` na
primeira escrita real), e os `revoke`/`grant` precisam vir **antes** do `alter … owner to`. Fora
dessa ordem, os comandos viram **no-op com WARNING, não erro** — o `supabase db push` não envolve
a migration em transação. Foi assim que `ajustar_estoque` ficou publicada com `EXECUTE` para
`PUBLIC`/`anon`/`authenticated` até a migration `20260811203500` corrigir. Como toda RPC daqui é
`security definer` e recebe `p_org` por parâmetro, esse no-op equivale a expor escrita de estoque
de qualquer organização a qualquer usuário autenticado.
