# ADR-0200 — Kit com variação: página única, estoque separado e escrita só com anúncio pausado

- **Status:** aceito, em implementação
- **Data:** 2026-11-07
- **Decisores:** Diego
- **Refina:** ADR-0151 (kit vinculado), ADR-0154 (Kit Virtual), ADR-0111 (reativação por reposição), ADR-0074 (modelo de IA por organização)
- **Spec:** `docs/superpowers/specs/2026-11-06-kit-com-variacao-design.md`
- **Plano:** `docs/superpowers/plans/2026-11-07-kit-com-variacao.md`

## Contexto

Diego quer vender kits de cores diferentes do mesmo produto: uma página no Mercado Livre em que o comprador escolhe
a combinação de cores e depois o tamanho. O kit nasce na tela Publicados, sem planilha.

### O quarto sentido de "kit"

| Termo | Limite |
|---|---|
| Kit | N unidades do mesmo produto num SKU |
| Kit vinculado (ADR-0151) | recusa base com várias cores (`base_multivariacao`); saldo derivado de um SKU só |
| Kit Virtual (ADR-0154) | produtos distintos agrupados pelo ML, uma composição por anúncio |
| **Kit com variação** (este ADR) | cores combinadas × tamanho numa família User Products, saldo próprio por combinação e tamanho |

Nenhum dos três primeiros cobre o caso. O kit com variação é o quarto sentido e não reaproveita o predicado
`kit_multiplicador`, que aciona `resolverOrigemEstoque` e o saldo derivado: precisa de identificação própria.

### Portão reprovado em 07/11

`PUT /user-products/{id}/stock/type/selling_address` com `x-version` correto devolveu
`400 "the site is blocked for modifications to the selling address"`, na conta DSA, em item pausado. Nada foi gravado
(versão e saldo iguais antes e depois). Pela documentação, essa escrita só existe na Argentina e no Chile. No Brasil
o caminho com `x-version` é `seller_warehouse`, que exige conta multi-origem com a tag `warehouse_management`; nenhuma
conta lida tem a tag. Em multi-origem, `available_quantity` em `/items` deixa de valer e o push atual quebraria na
conta inteira. O estoque do user product também é compartilhado com a cópia de catálogo (dois itens no mesmo UP).

## Decisão

Opção B do Diego (07/11): grade própria com página única e risco residual aceito.

1. **Estoque separado.** A peça fica oferecida em um anúncio só. O kit tem saldo próprio real. Venda de kit baixa só o
   SKU do kit. Montar e desmontar são transferências entre SKUs, no ledger, com todas as cores numa transação: nunca
   baixa parcial. Total em peças por SKU individual (individual + saldo do kit × composição + trânsito) só muda por
   venda, entrada, ajuste ou estorno.
2. **Escrita só com anúncio pausado.** Nos SKUs participantes (de kit e individuais usados em kit), todo `PUT`
   absoluto de quantidade exige todos os itens do UP pausados (inclusive a cópia de catálogo) e a conciliação
   abaixo, inclusive reduções. A pausa só vale com `paused_by_seller` em `sub_status`: `out_of_stock` religa sozinho
   quando o saldo sobe.
3. **Sequência única** para montar, desmontar, repor, cancelamento em kit e sair de Sobra, sobre origem e destino:
   ler e pausar e confirmar; esperar a quarentena T; importar pedidos e reservar os não pagos
   (`GET /orders/search/pending`, pagamento `pending`) e os pagos sem baixa conciliada; ler `/stock`; calcular o valor
   final uma única vez e gravar na saga; escrever, reler e confirmar; reativar só o que a operação pausou.
   T inicial de 5 minutos, configurável.
4. **Quarentena obrigatória.** Peça nunca sai de anúncio ativo; a automação só usa peça guardada.
5. **Reserva por `/orders/search/pending`.** Pedido não pago não aparece em `/orders/search` nem no saldo. Pedido pago
   segue reservado até a quantidade lida cair em relação à leitura do passo 1; `last_updated` não solta reserva.
   Na dúvida, bloqueia transferência e aumento.
6. **Resultado incerto nunca reenvia.** Só a recusa definitiva do ML (4xx recebido) permite repetir. Em timeout ou
   erro de rede, leitura igual ao valor gravado na saga conclui; qualquer outro número, inclusive o anterior, trava a
   operação com alerta. A transferência é uma saga durável, idempotente, com intenção gravada antes do `PUT`.
7. **Vender só em kit** (restrito a admin, ADR-0060). Cada SKU individual usado fica em `normal`, `guardado` ou
   `sobra`. Guardado fica pausado e a reposição monta kits até a meta conforme vendem; Sobra reativa o individual e
   avisa no Telegram quando uma cor não forma combinação. Com individual ativo, só Montar mais manual: não existe
   piso, a automação nunca tira peça de individual ativo.
8. **Foto por módulo `imagem_ia`**, com `ai_model_imagem`. Modelo padrão `google/gemini-nano-banana-2.1`. Empresa sem
   o módulo envia a foto; sem foto em toda combinação publicada, publicar fica bloqueado. Foto gerada só publica
   depois de aprovada. Nunca usar foto de item moderado.
9. **Cobrança por imagem** gerada com sucesso (inclusive a descartada; falha não cobra), igual ao Sonar: preço por
   unidade na condição comercial da empresa, evento medido e custo real registrado. Modelos de imagem entram em
   `PRECOS` (`_shared/ai/tokens.ts`).
10. **Simulador** antes de publicar, com as mesmas peças do simulador de Promoções (`DetalheRecebe`,
    `calcularTarifaML`), tarifa e frete do kit e não da peça, pior combinação em destaque. Sem alíquota confirmada
    (ADR-0055) ou sem cotação, avisa e não presume número.
11. **Texto por IA em etapa própria** (`gerar-texto-kit`): título e descrição dizem que é kit e quantas peças. Não usa
    `process-familia`. Reprocessar não pode reescrever o kit.
12. **Escopo:** só user product, só `selling_address`, sem Full, sem Kit Virtual ou kit vinculado na base, peças por
    kit de 2 a 6, cores distintas. Tudo atrás do módulo `kit_variacao`: organização sem o módulo não muda de
    comportamento.

## Alternativas descartadas

- **Escrita condicional por `x-version` em `selling_address`:** reprovada em 07/11, `400` de site bloqueado no Brasil
  (ver Contexto).
- **Multi-origem (`seller_warehouse`):** exige a tag `warehouse_management`, ausente nas contas lidas, e quebra o push
  de `available_quantity` na conta inteira.
- **Kit Virtual para roupa:** a busca oficial de componentes devolveu `DISABLED_DOMAIN` em todos os itens de roupa da
  Daludi Shop (regatas e jaquetas), além de falta de estoque; itens de outros domínios com estoque vieram
  `available`. Blusa não foi medida. Componente também precisa estar ativo (`IS_NOT_ACTIVE_ERROR`).
- **Reserva de 1 unidade e saldo pelo mínimo das cores:** substituídas pelo estoque separado.
- **Reposição automática com individual ativo:** exigiria pausar a cada reposição um anúncio que vende.

## Risco residual aceito pelo Diego

Pedido que paga depois de T e não apareceu na conciliação (passo 5), ou baixa que o ML atrasa além do que a
conciliação detecta. A peça pode ficar comprometida duas vezes. O sistema detecta pela baixa, alerta no Telegram e o
operador resolve o pedido. Toda ocorrência é registrada para rever T com dado real. T reduz o risco; não o prova
inexistente.

## Resultados medidos em 07/11

- `PUT /items` com `available_quantity` 5 → 4 → 0 → 5 manteve os dois itens do UP pausados (DSA). Em zero,
  `sub_status` ficou `out_of_stock` + `paused_by_seller`; ao subir, voltou a só `paused_by_seller`. Uma escrita no item
  atualiza o UP e a cópia de catálogo.
- Item só com `out_of_stock` aceitou `PUT status=paused`; `status=active` removeu a pausa do vendedor. Guardar item
  exige `paused_by_seller` presente antes de qualquer escrita.
- Compra real com Pix sem pagar (Daludi): pedido não pago ausente de `/orders/search`, presente em
  `/orders/search/pending` como `payment_required` com pagamento `pending`, em menos de 1 minuto. O estoque não mudou
  (o ML não reserva peça para pedido não pago). O código Pix vale 15 minutos.
- Nas 9 amostras comparáveis (DSA e Daludi, só leitura), o estoque mudou de 0 a 6 s depois do pagamento, não na
  criação do pedido; o pagamento mais lento levou 128 s.
- `POST /items/validate` (37 chamadas, Daludi, nada criado): `COLOR` em texto só com `value_name` passa em Blusas,
  Jaquetas e Regatas, com ou sem `MAIN_COLOR`, até 255 caracteres. `SIZE` sem guia reprova (`2610`) e guia de outro
  vendedor também (`2617`): a base precisa de guia própria.
- Publicação real, 4 itens, Daludi: a primeira tentativa foi para `under_review` / `waiting_for_patch` (fotos de item
  `forbidden`, título com "Teste"; inconclusiva). A repetição, com fotos fora de itens moderados e título normal,
  ficou ativa, e a página `/up` mostrou as 2 combinações e os tamanhos, com foto e rótulo próprios, tamanho separado e
  Guia de tamanhos. O seletor levou minutos para juntar os itens. Itens excluídos, sem venda. Daí a regra de nunca
  usar foto de item moderado.
- Imagem por IA (Jaqueta Daludi): `gemini-2.5-flash-image`, cerca de US$ 0,039 por imagem, cor e fundo corretos mas
  modelagem não fiel. `gemini-nano-banana-2.1` (US$ 0,041, 896×1200) e `gemini-3-pro-image` (US$ 0,143, 848×1264)
  mantiveram barra, punhos e gola; `gpt-5.4-image-2` falhou no provedor. Amostra de 1 por modelo. O ML oferece
  "Gerar fotos com IA" e pede que o vendedor confira que o produto não foi alterado; não foi achada proibição, com
  leitura limitada por 403.

## Consequências

- Cancelamento antes do despacho volta ao saldo do kit pela regra do ADR-0121; pós-despacho e devolução seguem o
  aviso existente.
- Cada reposição automática tira do ar, por T, os itens do kit que recebem saldo; a reposição é agrupada em lotes.
- SKU Guardado não reativa por entrada de estoque (emenda ao ADR-0111) e o estado não usa `status = pausado` no
  vínculo local, para não sair da reconciliação.
- Texto por IA no kit difere da Decisão 3 do ADR-0151 (emenda).
- A imagem deixa de ser dormente no ADR-0074 quando a Fase 4 for entregue (emenda).
- Ainda a medir: tempo de quarentena e efeito das pausas no ranking do ML; individual pausado em campanha de
  promoção.

## Adendo 1 (08/11) — foto por IA fiel à peça, com verificação automática

**Por quê.** Falha real em 08/11 (Zaven, "Short Bermuda Linho Mauricinho", kit Bege Cru + Cinza Escuro): detalhes
fiéis, mas a peça saiu longa (bermuda no joelho; o original é short no meio da coxa) e o Cinza Escuro saiu mais
escuro. A descrição livre por visão não captou comprimento nem proporção. Regra do Diego: zero falha de fidelidade
(comprimento, modelagem, cor, textura, detalhes).

**Decisão.**

1. **Ficha estruturada antes de gerar**, por visão, com todas as fotos de cada cor (variações da cor, fora de item
   moderado, até 3 por cor): tipo e comprimento relativo ao corpo, proporção altura/largura, modelagem e caimento,
   cós, cordão, bolsos, etiquetas, barra, textura e cor por cor do kit. Fotos repetidas por conteúdo (o mesmo
   arquivo em um caminho por tamanho) contam uma vez. **Sem hex amostrado em código**: medido em 08/11 em 7 kits
   reais, a foto vestida e o cenário contaminam a média mesmo dentro da caixa da peça apontada pelo modelo e com
   filtro de pele (o preto saiu marrom), e o hex errado no pedido puxou a geração para o marrom (falso positivo no
   kit Preto Mesclado). A cor fica com as fotos, o nome do tom e o inspetor; voltar ao hex só com segmentação da
   peça. As capas da família ficam fora: não têm cor declarada.
2. **Geração ancorada**: fotos de cada cor + a ficha (como dado, separado das instruções); o pedido proíbe alongar,
   encurtar, trocar modelagem ou inventar detalhe. Enquadramento do kit: N peças lado a lado, mesma escala, numa
   linha, fundo claro neutro, quadrada.
3. **Verificação automática**: 2ª chamada de visão compara a gerada com as originais item a item da ficha e devolve
   JSON estruturado; o veredito é calculado em código (nunca um "aprovado" do modelo). Comprimento comparado direto
   com a original (mais longa, igual, mais curta) e proporção altura/largura da original e da gerada lidas na mesma
   resposta, com tolerância de 15% (a categoria absoluta lida numa foto estendida contra uma vestida deu ruído na
   medição de 08/11); cor por matiz e escurecimento contra as originais da cor (cinza que puxa para o marrom é
   divergência).
   Erro ou resposta ilegível na verificação reprova (fail-closed). Foto gerada horizontal ou pequena também reprova
   a tentativa.
4. **Até 3 tentativas por `request_id`** (1 + 2 automáticas), cada uma numa linha de `kit_variacao_imagens`
   (`tentativa` 1..3). A reprovada vira `recusada` com o custo real e os motivos (`verificacao`) e não é cobrada; a
   seguinte recebe os motivos no pedido. Uma linha viva por pedido (índice único parcial fora de `recusada`) e uma
   `gerada` no máximo: a cobrança continua uma por `(org, request_id)`. **Emenda a decisão 9**: só a imagem
   aprovada pela verificação é cobrada (a descartada pelo operador depois de aprovada continua cobrada).
5. **Prazo de 145 s: uma tentativa por chamada.** Cada chamada faz no máximo uma geração + verificação; a ficha é
   calculada na 1ª e guardada na linha. A tela repete o mesmo `request_id` enquanto a resposta trouxer
   `proxima: true`. A repetição de uma tentativa já decidida devolve o estado gravado, sem IA. 3 reprovações: a tela
   mostra "A IA não conseguiu uma foto fiel" com os motivos, sugere enviar foto própria e não oferece
   "Usar esta foto" (resposta reprovada nunca traz `path`).

**Ainda a medir:** taxa de aprovação na 1ª tentativa, falso positivo (aprovada não fiel na conferência humana) e
tolerância de proporção (15%) com produtos reais (`scripts/medir-foto-kit-fiel.ts`). A base tem só 9 roupas com
2+ cores fotografadas (2 lojas; a "Camisa" é uma camiseta gola careca), e em todas o dedupe deixou 1 foto distinta
por cor (o mesmo arquivo em cada tamanho): frente/costas separadas não ocorreram nesta base.

**Medição de 08/11 (12 kits, 6 de 2 cores e 6 de 3; Nano Banana 2.1 + gpt-4o; ~US$ 0,05–0,06 por tentativa).**
A verificação aprovou os 12 em até 3 tentativas (7 na 1ª). Na conferência humana das 12 aprovadas: 3 fiéis
(inclusive o caso Zaven), 7 em dúvida (etiqueta de gola inventada em 6; tom de Cáqui/Caramelo) e 2 não fiéis
(etiqueta inventada no cós; decote quadrado no lugar do arredondado). A verificação reduz a falha, não a elimina:
a aprovação humana ("Usar esta foto", depois de ampliar e comparar com as originais) continua sendo a trava.
Reteste de 6 desses kits já com a proibição de etiqueta inventada no pedido e no inspetor: 4 aprovados (1 na 1ª);
o inspetor passou a cobrar etiqueta "ausente" quando a ficha descreve etiqueta não visível (ponto a ajustar na
ficha). Ficha levou até 29 s, verificação até 36 s e geração de 9 a 82 s: fatias de ficha e verificação de 35 s; uma
geração acima de ~60 s na 1ª tentativa estoura o prazo e a chamada falha sem cobrança (o mesmo pedido repete).

**Modelo mais forte (08/11):** `openai/gpt-5.4-image-2` (catálogo: imagem na entrada e na saída) não gerou imagem
pelo OpenRouter em nenhuma qualidade (low, medium, high): `Complexity '…' is not supported for this image model`
(`provider_unavailable`), como em 07/11. `google/gemini-3-pro-image` ficou fora por decisão do Diego (~3× o custo).
Fica o Nano Banana 2.1; o script de medição aceita `--modelo` e `--qualidade` para repetir a comparação.
