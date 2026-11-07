# ADR-0194 — Sugestões de promoção para girar o que vende pouco

**Status:** Aceito — desenho fechado em grilling (2026-11-03) com opinião do Codex `gpt-6.1-sol` high. Implementado pelo [plano](../superpowers/plans/2026-11-03-sugestoes-promocao.md).
**Data:** 2026-11-03
**Decisores:** Diego
**Estende:** [ADR-0170](0170-central-de-promocoes-ml.md) (Central), [ADR-0174](0174-operacoes-em-massa-promocoes-v2.md) (operações em massa)
**Relaciona:** [0172](0172-vendas-sku-analise-por-variacao.md) (Vendas SKU, Baixo giro), [0176](0176-vitrine-visitas-conversao.md) (visitas)
**Glossário:** `CONTEXT.md` — Quase vendendo, Invisível, Vende pouco, Oportunidade.

## Contexto

A Central lista campanhas e o operador escolhe anúncios dentro de cada uma. Nada aponta quais produtos parados valem uma promoção. Medido em 03/11 na Avil: 417 dos 497 anúncios ativos venderam menos de 5 unidades em 30 dias, e 378 deles têm convite de campanha sem participar. Vendas sozinhas misturam dois problemas: anúncio que recebe visita e não converte, e anúncio que quase ninguém vê.

## Decisão

**D-1. Duas faixas, por vendas e visitas.** **Vende pouco** = menos de 5 unidades faturáveis em 30 dias, incluindo zero (mesmo limite do Baixo giro). **Quase vendendo** = visitas suficientes para 3 ou mais vendas na conversão média da conta, com mínimo de 30 visitas, e vendas abaixo do esperado; **Invisível** = visitas abaixo desse corte. Produto com visitas suficientes que converte na média ou acima não é sugerido: desconto não é o que falta. O corte é relativo porque a conversão varia por conta (Avil 23,9 visitas por unidade; Hairfly 8,6). Conta sem venda no período: corte de 30 visitas. A conversão compara visitas e unidades nos mesmos pares MLB×dia com `estado='ok'`, em janela BRT (critério da Vitrine, ADR-0176): dia com coleta pendente não entra em nenhum dos lados. O corte de vende pouco usa todas as unidades da janela. Cobertura da coleta abaixo de 80% dos dias tira o produto da lista: falta de dado não vira Invisível.

**D-2. Só verde e amarelo.** Vermelho e indisponível nunca viram sugestão. Amarelo aparece com o selo "abaixo do piso", o lucro em reais e seleção manual no painel: vender abaixo do piso, mas com lucro, é aceito de propósito para girar. Lucro por venda precisa ser maior que zero (o semáforo aceita líquido igual ao custo). Só com verde, restariam 8 dos 59 Quase vendendo da Avil. Linha com alguma cor sem custo fica fora: lucro desconhecido não é sugerido.

**D-3. Universo: convidados que ainda não participam.** Campanha viva, tipo operado pelo app (`ehTipoOperavel`), preço da campanha abaixo do original, anúncio ativo e produto com saldo (estoque desconhecido não exclui). Campanha de qualquer tipo abaixo de R$ 19 fica fora (emenda ADR-0174 de 2026-11-07; antes só Relâmpago). Anúncio que participa de qualquer campanha viva sai. Desconto próprio do vendedor (`PRICE_DISCOUNT`) fica fora: serviria a 16 dos 417 da Avil.

**D-4. Unidade: produto, com plano B por anúncio.** Vendas e visitas somam todos os anúncios do produto. Vínculo anúncio → produto: `anuncios_externos(_itens)`, `familias.ml_item_id` e o código das vendas (398 dos 477 convidados da Avil). Sem vínculo, o anúncio vale sozinho. Cor lenta de produto que vende 5 ou mais fica fora; a análise por cor é de Vendas SKU.

**D-5. Ordem por Oportunidade.** Vendas perdidas = max(0, visitas ÷ visitas por unidade da conta − unidades), com visitas e unidades dos dias `ok`. Oportunidade = vendas perdidas × lucro por venda no preço da campanha recomendada, contando só os anúncios convidados a essa campanha. A tela mostra "~N vendas abaixo do esperado" e o lucro por venda, não um valor em R$/mês: a conta mede distância da média, não o que a promoção recupera. Dinheiro parado (custo × estoque) foi descartado: estoques cadastrados de até 49.999 por SKU distorcem a ordem, e anúncio sem produto não tem esse dado. Estoque é só informativo. É estimativa, rotulada assim.

**D-6. Campanha recomendada = maior desconto ao comprador com lucro.** Entre as campanhas válidas do produto. Diferença de até 2 pontos percentuais de desconto é empate; no empate ganha o maior lucro, depois mais anúncios cobertos. As demais ficam visíveis no card. Maior lucro puro seria quase sempre a SMART de 3% a 5%, que muda pouco para o comprador; desconto puro trocaria margem por diferença imperceptível.

**D-7. Anúncio novo fica fora.** Produto cujo anúncio mais antigo tem menos de 30 dias. Fonte: `date_created` do ML, gravado pelo sync em `ml_promocao_itens.anuncio_criado_em`, e `publicado_em` de `anuncios_externos`/`familias` para anúncios do produto sem linha na Central (ex.: normal consolidado no catálogo). Vale a menor data conhecida do produto. Sem nenhuma data, o produto entra.

**D-8. Dispensar por 30 dias.** Por produto, vale para a org toda, com autor e data, sem motivo obrigatório. Filtro "Dispensados" reativa. Escrita só pela edge `operacoes-massa` (admin ou suporte com acesso total), leitura por RLS de org.

**D-9. Marcação de origem, sem tela de resultado na V1.** Operação nascida de sugestão grava `operacoes_massa.sugestao` (faixa, oportunidade, chave). A tela de antes e depois vem numa segunda etapa, com dados de pelo menos 30 dias.

**D-10. Tela.** Aba Sugestões da Central (`?aba=sugestoes`), 20 por página em cada faixa, Quase vendendo primeiro. Cálculo ao abrir, no front, a partir de leituras do banco: sem chamada ao ML, sem job. Aderir é por card e abre o painel existente com os anúncios daquele produto naquela campanha; sem adesão em massa entre produtos. Preço e lucro são recalculados no painel e o servidor relê o ML ao executar, então dado de até 24 h não vira adesão errada.

## Medição (Avil, 04/11, dados reais)

85 sugestões: 6 Quase vendendo e 79 Invisível. RPC em ~130 ms, lista na tela em ~830 ms. Por produto o número cai muito frente aos 59 anúncios medidos no grilling, porque somar visitas e vendas do produto e exigir vendas abaixo do esperado separa o que antes parecia fraco anúncio a anúncio. Filtros de cobertura, idade, estoque e ativo tiram no máximo 4.

## Emenda 2026-11-04: clareza do card e do painel Aderir

Pedido do Diego: "~3 vendas abaixo do esperado" ao lado de "0 vendas" confundia. O card passa a mostrar "Vendeu 0 · esperado ~3, pela média da conta" (`vendasEsperadas` = visitas do produto nos dias `ok` ÷ visitas por unidade da conta; as vendas usam a mesma base de dias `ok`). A ordem por Oportunidade (D-5) não muda: `vendasAbaixo` segue só ordenando. O card mostra o preço atual (`preco_original`). O painel de adesão mostra o preço atual e o "Você recebe por venda" com comissão, imposto, frete, lucro, margem e markup, no tipo real do anúncio (Clássico ou Premium, de `ml_promocao_itens.listing_type_id`). A conta sai da projeção do servidor, sem chamada nova ao ML; com várias cores, vale a cor de menor líquido.

## Emenda 2026-11-04 (2): várias campanhas no Aderir

Produto com duas ou mais campanhas DEAL abre uma escolha com caixas de marcação (a recomendada vem marcada). Cada campanha marcada é confirmada no painel de sempre, em sequência e por ordem de data ("Campanha 1 de 2"), e vira uma operação própria com a mesma marca `sugestao`. Na tela de resultado (D-9), contar por `chave` e não por operação. Decisão a partir da revisão do Codex: só DEAL, porque o preço vai no pedido e não há reserva de estoque. SMART pode aderir por oferta mudada e Relâmpago não coordena reserva entre campanhas, então seguem uma por vez. A confirmação em sequência dispensa coordenação no servidor; envio simultâneo do mesmo anúncio não foi testado no ML. Campanhas com período cruzado no mesmo anúncio mostram aviso: o ML aplica o menor preço (ADR-0170), e data desconhecida conta como cruzamento. Depois da primeira adesão o produto sai da lista (D-3), então a campanha não marcada só volta pela Central.

## Alternativas descartadas

- **Só vendas:** mistura problema de preço com problema de exposição.
- **Corte fixo de visitas:** erra para um lado ou outro entre contas.
- **Só verde:** deixa a área quase vazia.
- **Grava o resultado num job diário:** mais peças sem necessidade medida. Vira plano B se o cálculo ao abrir ficar lento; muda onde roda, não o que a tela mostra.

## Consequências

- Tabela nova `promocao_sugestoes_dispensadas`, colunas novas `ml_promocao_itens.anuncio_criado_em` e `operacoes_massa.sugestao`, RPC nova `sugestoes_promocao_sinais`.
- Deploy de `sincronizar-promocoes` e `operacoes-massa`. A data de criação só aparece depois do sync seguinte; até lá os anúncios entram (D-7).
- Limite: antes e depois não prova causa. Sazonalidade e a campanha também mexem nas vendas.
- Limite: com poucas vendas, a conversão da conta é pouco confiável (Zaven: 1 unidade em 30 dias).
