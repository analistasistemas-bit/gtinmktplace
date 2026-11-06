# ADR-0196 — Alterar preço em Publicados, com oferta e atacado na mesma tela

**Status:** Proposto (2026-11-06) — decisões de produto fechadas com o Diego; implementação não iniciada
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

**Não medido:** efeito depois de horas, Relâmpago `started`, Legacy com variações, duração da âncora de credibilidade,
sair antes de baixar o base, par de catálogo e Kit Virtual.

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
