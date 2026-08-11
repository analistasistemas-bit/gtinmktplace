# ADR-0111: Reativação automática do anúncio ao repor estoque

**Status:** Aceito
**Data:** 2026-08-11
**Decisores:** Diego

## Contexto

O push de estoque (`sincronizar-estoque`, ADR-0094) escreve **só a quantidade** no canal. Status é
um eixo separado, com ação explícita e restrita a admin na tela Publicados (ADR-0060).

O Mercado Livre reativa sozinho o anúncio que **ele mesmo** pausou por falta de estoque
(`sub_status: out_of_stock`) quando a quantidade volta a ser maior que zero — observado em produção
em 2026-08-11, no `MLB5040504553`, que voltou de `paused` para `active` sem nenhum PUT de status.
Pausa feita pelo **vendedor** ele não desfaz: o mesmo anúncio, pausado explicitamente e depois
reabastecido com 70 unidades, continuou pausado com o estoque correto no canal.

Do ponto de vista do operador isso é indistinguível: repôs estoque, o anúncio segue invisível na
busca, e não há sinal na tela dizendo por quê. O caminho de volta hoje é lembrar de abrir Publicados
e reativar à mão.

## Decisão

**Repor estoque reativa o anúncio pausado.** Qualquer pausa, não só a de falta de estoque.

Regras:

1. **Só push de reposição reativa.** O job de sincronização passa a carregar `reativar`. É `true`
   quando o push nasce de um movimento que **aumenta** saldo (entrada de mercadoria, estorno de
   venda cancelada) e ausente no resto. Em especial, a reconciliação diária (`reconciliar-estoque`,
   passo 2) re-empurra o saldo de produtos com movimento recente **sem** a flag: sem isso, um
   anúncio pausado de propósito voltaria ao ar sozinho, sem ninguém ter reposto nada.
2. **Só reativa com saldo maior que zero** no anúncio alvo, depois de o push de estoque ter dado
   certo. Push falhou, não reativa — não faz sentido publicar com o canal defasado.
3. **Só sai de `pausado`.** O status é lido ao vivo antes de agir. `moderado`, `encerrado`,
   `inativo` e `indisponivel` são intocados: são estados que exigem decisão humana, e forçar
   `active` num anúncio moderado é o tipo de escrita que já custou um anúncio cancelado
   (incidente 2026-08-06).
4. **Idempotente por leitura.** Anúncio já `ativo` não recebe PUT nenhum. O push é reentregue pelo
   QStash e a reconciliação repete o job: agir sem ler o status faria N escritas para o mesmo fim.
5. **Falha de reativação não perde o push de estoque.** Erro retentável entra na mesma lista que
   faz o QStash repetir o job; erro definitivo é logado (`estoque_reativar_definitivo`) e o push é
   considerado bem-sucedido — o saldo é a verdade e já chegou.

`ajustar-estoque` (ADR-0110) só reduz, então nunca reativa por construção.

## Consequências

**Aceitas.** Um anúncio pausado de propósito volta ao ar quando alguém dá entrada de estoque nele.
Foi a escolha explícita do Diego, com a alternativa "só reposição manual reativa" na mesa: o critério
é a intenção do gesto (repor estoque é para vender), não a origem da pausa.

Estorno de venda cancelada também reativa. É um aumento de saldo como qualquer outro; separar
"reposição humana" de "reposição automática" criaria um caso especial sem regra clara.

**Custo.** Um `lerStatus` a mais por anúncio alvo, só em push de reposição. Push de venda não
alcança o ML (`canal_origem` exclui o canal que originou o movimento), então o volume é baixo.

**Como reverter.** Remover `reativar` do job e o bloco de reativação em
`sincronizar-estoque/processar.ts`. Nada é persistido: o status nunca é gravado localmente
(ADR-0060), então não há dado a migrar.

## Alternativas descartadas

- **Reativar só a pausa por falta de estoque** (`sub_status: out_of_stock`): é exatamente o que o
  ML já faz sozinho. Não resolveria o caso que originou a decisão.
- **Reativar em qualquer push:** a reconciliação diária re-empurra saldo de produtos com movimento
  recente. Um anúncio pausado à mão voltaria ao ar sem reposição nenhuma — mais do que foi pedido.
- **Botão "repor e reativar" na tela:** mantém o passo manual que a decisão existe para eliminar.
