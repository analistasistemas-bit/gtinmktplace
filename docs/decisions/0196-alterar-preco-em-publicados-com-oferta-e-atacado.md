# ADR-0196 — Alterar preço em Publicados, com oferta e atacado na mesma tela

**Status:** Proposto (2026-11-06) — decisões de produto fechadas com o Diego; Fatia 1 em produção desde 2026-11-07 (main `47fe66f5`; `operacoes-massa` v42, `publish-familia-ml` v156, `update-familia-ml` v156, `reconciliar-convergencia-up` v84); 1ª operação real pendente
**Data:** 2026-11-06
**Decisor:** Diego
**Relacionado:** [ADR-0178](0178-reajuste-de-preco-em-massa.md) (emenda os itens 5 e "Alternativas descartadas"),
[ADR-0174](0174-operacoes-em-massa-promocoes-v2.md) (responde a pergunta do spike sobre preço base),
[ADR-0041](0041-preco-atacado-pxq-b2b.md) (atacado), [ADR-0154](0154-kits-virtuais-mercado-livre.md) (Kit Virtual),
[ADR-0020](0020-estrategia-de-preco-liquido-minimo.md) e [ADR-0055](0055-imposto-por-origem-nacional-importado.md) (trava financeira)

## Contexto

O Diego quer alterar o preço pelo PubliAI, escolhendo vários anúncios. O Reajustar (ADR-0178) já escreve preço fora do
UPDATE, mas o diálogo só aceita ±% ou ±R$ e bloqueia promoção, atacado, catálogo e Kit. Em 06/11, com campanhas
vigentes, estavam em promoção 173 de 199 anúncios da Zaven, 25 de 36 da Hairfly e 36 de 275 da Avil; a Avil tem 231
famílias com atacado aplicado. O Reajustar só rodou 2 vezes, ambas no dia da validação.

## Medição no Mercado Livre (2026-11-06, autorizada pelo Diego)

Escrita real só em `price`, cerca de 90 s de observação por passo.

| Caso | MLB | Resultado |
|---|---|---|
| DEAL `started`, User Product | MLB5473206975 | Base subiu e desceu; oferta intacta |
| SMART `started` | MLB7245326808 | Base ±R$ 1; oferta intacta, o ML não a recalcula |
| Relâmpago `pending` | MLB7244917852 | Base ±R$ 1; oferta intacta |
| DEAL `pending` e `started` | MLB5482548177 | Base ±R$ 1; ofertas intactas |
| DEAL `started`, fora de UP, com atacado | MLB7245026988 | Base ±R$ 1; oferta e faixas intactas |
| Base abaixo da oferta | MLB5473206895 | PUT 200; oferta removida em até ~90 s; item volta a `candidate` |

Outros fatos medidos:

- As faixas de atacado são absolutas e não acompanham o preço base.
- Restaurar o preço base não restaura a oferta removida.
- Readerir ao preço antigo foi recusado com `400 ERROR_CREDIBILITY_DISCOUNTED_PRICE`: a faixa do convite ficou ancorada
  no base baixo (máximo 37,83 sobre original 39), mesmo com o base de volta a 56,45.
- `GET /items/{id}/prices` com `show-all-prices: TRUE` traz base, faixas B2B e oferta numa chamada.
- A visão por item acompanha o novo base em até 30 s; a visão da campanha e o `regular_amount` de `sale_price` não
  acompanharam durante a observação. O preço riscado pode não mudar.

Segunda rodada (2026-11-06, autorizada pelo Diego):

- As ofertas dos anúncios testados seguiam ativas horas depois.
- Legacy com 12 variações (MLB4906994169): base ±R$ 1 em todas as variações, ofertas `started` e `pending` intactas.
- **Oferta DEAL não sobe:** `PUT deal_price` acima do valor atual em DEAL `pending` (MLB7906365028) devolveu
  `400 PRICE_GT_CURRENT`. Baixar uma oferta pode não ter volta sem sair e readerir. Em `started` não foi testado.
- SMART (MLB7245326808): `DELETE` com o `OFFER-…` devolve 200 com corpo vazio; a visão da campanha fica `null` e
  `sale_price` volta ao base em segundos. Depois de sair, o base aceitou ficar abaixo da oferta antiga.
- Oferta pode ter `top_deal_price`, um segundo preço menor (MLB7906365074). `/prices` lista os dois como `promotion`.

Terceira rodada (2026-11-07):

- **Relâmpago `started` (MLB7244917852, 07/11 00:20 BRT):** base +R$ 1 e restaurado; a oferta `started` seguiu
  intacta em 131,97.
- **SMART (MLB7245326808):** sem reconvite depois de 2 h.
- **Âncora de credibilidade (Zaven, MLB5473206895):** durou mais de 2 h.

**Não medido:** readesão depois de baixar o base, oferta DEAL `started` subindo, par de catálogo e Kit Virtual.

## Decisão

1. **Local:** Publicados, por anúncio, com seleção múltipla. O diálogo do Reajustar ganha "Definir preço R$", com o
   mesmo valor para os selecionados e ajuste por anúncio no preview. Mesmo motor, preview, trava financeira e Reverter.
2. **Base acima da maior oferta do anúncio, em qualquer tipo de oferta:** altera o preço base sem sair da promoção.
   A sequência "sair, aplicar, voltar" não é usada neste caso.
3. **Trava dura:** o app nunca envia um base igual ou abaixo de uma oferta vigente ou agendada. Deixar o ML eliminar a
   oferta pode impedir a volta ao preço antigo.
4. **Base igual ou abaixo da oferta:**
   - **DEAL:** o preview pede a nova oferta, sugerindo o mesmo % de desconto. O app baixa a oferta (`alterar_preco`) e
     depois o base, sem sair da campanha.
   - **SMART e Relâmpago:** sair, confirmar a saída, aplicar o base e oferecer recolocar dentro da faixa nova, se o ML
     reconvidar. A operação é em etapas e mostra o estado por anúncio; a volta não é garantida e o preview avisa.
5. **Mais de uma campanha:** a regra vale para todas as ofertas do anúncio; o preview lista cada uma. É o caso comum
   (32 dos 36 da Avil, 25 dos 25 da Hairfly).
6. **Atacado na mesma tela:** sugere o % atual da família e mostra os novos valores em R$. O % é editável e vale para a
   família inteira.
7. **Invariante do atacado:** nenhuma faixa fica igual ou acima do preço base em momento algum. Ao descer o base,
   grava as faixas antes; ao subir, depois. Falha ao gravar faixas antes de descer interrompe o item sem tocar no base.
8. **Catálogo, par de catálogo e Kit Virtual entram no escopo**, condicionados aos testes abaixo. No Kit, o preço é
   `automatic_price`, então o operador edita o desconto %, não um valor em R$.
9. **Sem mudança:** executar e Reverter só para admin e suporte com acesso total; `preco_editado_pelo_operador`
   continua fixando o preço (ADR-0178, decisão 3); revisão humana no preview antes de qualquer escrita.

## Pré-requisitos da implementação

Testes reais, cada um com o MLB aprovado pelo Diego antes:

1. Par de catálogo: base no item normal e no de catálogo, com e sem oferta.
2. Kit Virtual: mudar o desconto com e sem oferta, e efeito de mudar o base de um componente.
3. Legacy com variações em promoção: `PUT {variations:[{id, price}]}`.
4. Relâmpago `started`.
5. Sair de SMART e de Relâmpago, baixar o base e reconvidar: faixa nova e âncora de credibilidade.
6. Releitura dos anúncios testados depois de horas, para confirmar que as ofertas seguem ativas.

Se um teste contrariar uma decisão, o caso volta para decisão do Diego antes de ser implementado.

## Consequências

- Muda o ADR-0178: promoção, atacado, catálogo e Kit deixam de ser exclusões do MVP. A objeção a "reaplicar atacado
  depois do preço" (base nova com faixas velhas) é resolvida pela ordem de escrita da decisão 7.
- Responde à pergunta do spike do ADR-0174: mudar o base com DEAL ativa não é recusado nem remove a oferta, desde que
  o base fique acima dela.
- O aviso da Revisão ("mudar o preço pode tirar da promoção", ADR-0174) precisa refletir a regra medida.
- Editar o % do atacado afeta outros anúncios da família; o preview precisa mostrar isso.

## Alternativas descartadas

- **Card do Produto em Estoque:** um SKU pode estar em vários anúncios e exigiria regra de propagação.
- **Sair sempre da promoção:** lento, desnecessário acima da oferta e com risco de não voltar à campanha.
- **Deixar o ML remover a oferta:** a volta ao preço antigo foi recusada por credibilidade.
- **Atacado em R$ por anúncio:** diverge do % da família e o próximo UPDATE sobrescreveria.

## Implementação da Fatia 1 (2026-11-07)

**Fatia 1 em produção desde 2026-11-07 (main `47fe66f5`; `operacoes-massa` v42, `publish-familia-ml` v156, `update-familia-ml` v156, `reconciliar-convergencia-up` v84); 1ª operação real pendente.** Tela conferida com dados injetados em 1440 e 390 px. Plano:
`docs/superpowers/plans/2026-11-06-alterar-preco-publicados.md`.

**O que entrou**

- Definir preço R$ no preview do Reajustar (`TipoAjuste 'definir'`) e tela de alterar preço em Publicados, com ofertas
  vigentes, editor de atacado e faixas.
- Trava de oferta: o base nunca é enviado igual ou abaixo de uma oferta vigente ou agendada, em qualquer tipo.
  Promoção deixou de excluir o anúncio. Relâmpago `started` também entra (medido em 07/11).
- Execução por passos duráveis (`operacoes_massa_itens.passos`), com posse por `lease_token` e `lease_ate`; sem o
  token nada grava. Escrita que o ML aceita e não aplica, depois de 3 tentativas provadas, falha o passo e compensa.
- Atacado: faixas gravadas antes de descer o base e depois de subir (invariante da decisão 7). Edição do % por
  família em `operacoes_massa.atacado_familias`, concluída por `reajuste_atacado_concluir`.
- UP UPDATE e CREATE aplicam as faixas sobre o preço de cada item.
- Migrations: `20261107001726`, `20261107014545`, `20261107020152`, `20261107021935`.

**Decisões da execução**

- **Config efetiva do produto:** a única não nula entre as linhas do mesmo `codigo_pai` (em 93 de 104 produtos com
  atacado a linha canônica é NULL). A edição grava em todas as linhas, inclusive NULL; linha com outro valor recusa.
  Custo se errado: o próximo UPDATE passa a aplicar atacado em produto cuja linha mais recente era NULL.
- **`[]` com faixa viva não limpa; config sem faixa viva não cria.** Alterar preço nunca apaga nem inventa faixa. O
  recálculo só ocorre com as mesmas quantidades entre config e faixas vivas.
- **Faixas sobre o preço do item** no UPDATE e no CREATE de UP, para a cor barata não ficar com faixa acima do base.
- **Compensação:** recusa definitiva depois de 3 tentativas termina `erro` e libera a reserva; as faixas seguem abaixo
  do base. Faixas desistidas depois do base persistem direto, sem `ml_confirmado`. O passo `faixas` guarda a `config`
  efetiva para o Reverter comparar.
- **`temAtacado`** saiu de `motivoInelegivel` junto com a gravação de faixas pelo executor, sem commit intermediário
  que liberasse atacado sem faixas.

**Lacuna conhecida:** o UPDATE de publicação baixa o base antes das faixas, então a faixa pode ficar igual ou acima do
base por segundos (mais, se falhar). É fluxo preexistente, fora do escopo desta operação; decisão do Diego pendente.

**Fatias**

- Fatia 2 (DEAL baixa a oferta antes do base): **suspensa**. O ML recusa subir oferta (`400 PRICE_GT_CURRENT`), então
  a volta prometida ao operador não seria possível.
- Fatias 3 (SMART e Relâmpago em etapas) e 4 (catálogo, Kit Virtual, Legacy com variações): não feitas.
- Deploy pendente: `db push` das 4 migrations antes das edges; redeployar `operacoes-massa`, `publish-familia-ml`,
  `update-familia-ml` e as funções que usam `user-products`. Medir custo do preview e da escrita antes.

## Emenda 2026-11-07 — Trava da oferta no UPDATE

**Status:** implementada na branch `worktree-trava-oferta-update`; não deployada, não mergeada. Plano:
`docs/superpowers/plans/2026-11-07-trava-oferta-update.md`.

**Decisão (Diego, 2026-11-07):** o UPDATE de publicação recusa, com motivo, o produto que levaria o preço base a igual
ou abaixo de uma oferta vigente ou agendada. Só esse produto: os demais do lote seguem. "Somente estoque" continua
disponível. Emenda o item 9 do ADR-0174, que só avisava.

**Como funciona**

- `publicar-familias` confere antes de reservar (`_shared/publicacao/trava-oferta.ts`). Lê o preço vivo em lote
  (`/items/bulk`) e só lê as ofertas dos MLB cujo preço novo fica abaixo do vivo, porque o UPDATE herda o preço no ar
  (ADR-0016, adendo 2026-10-16). Produto recusado não é reservado nem enfileirado e volta em `recusadas`.
- Motivo: `Preço igual ou abaixo da oferta de R$ X — ajuste a oferta antes`. Leitura inconclusiva recusa com
  `Não foi possível conferir promoções — tente de novo`. Orçamento de 20 s por requisição; o que não foi conferido
  recusa. MLB encerrado sai dos alvos, sem recusa.
- Não confere: CREATE, "somente estoque" (global ou por família) e Adicionar variação, que preserva os preços publicados.
- Reconciliador (`reconciliar-convergencia-up`): o SKU reprovado entra em `semPrecoPara`, a composição converge sem
  enviar o preço dele e o operador é avisado. O preço retido não volta sozinho: só sobe num próximo UPDATE.
- Revisão: o aviso passou a dizer `Preço igual ou abaixo da oferta será recusado.`

**Limite aceito:** oferta nova, ou preço editado inline, entre o clique e o worker normal não é detectado.

**Descartado:** trava dentro dos workers. Eles têm várias formas de escrever preço, recusar dentro deles prende
retomadas de saga e a migração para User Products (`MIGRADO_PARA_UP`) só é descoberta no meio.

**Item restante:** o UPDATE ainda grava o base antes das faixas (lacuna acima, pendente de decisão).

**Deploy pendente:** `publicar-familias`, `reconciliar-convergencia-up`, `update-familia-ml` (usa `atualizar-familia-up.ts`)
e as demais funções que importam `conexao.ts`; conferir o grafo de imports e as versões pós-deploy.
