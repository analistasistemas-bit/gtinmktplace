# Administração da plataforma

Vocabulário de negócio da central de controle dos clientes Daludi. O vocabulário operacional existente permanece em [docs/reference/glossario.md](docs/reference/glossario.md).

## Linguagem

**Organização**:
Empresa cliente atendida pela Daludi, cujos resultados, configurações e consumo são acompanhados separadamente.
_Evitar_: usuário como sinônimo de empresa cliente.

**Central de controle**:
Área exclusiva da administração da plataforma para acompanhar organizações, resultados, consumo, cobrança e auditoria.
_Evitar_: dashboard do cliente como sinônimo desta área.

**Modalidade comercial**:
Forma de contratação da operação Daludi que determina os componentes da remuneração e o acesso do cliente à inteligência de mercado.
_Evitar_: módulo como sinônimo de modalidade.

**Faturamento bruto**:
Valor bruto das vendas dos marketplaces administrados, antes da dedução das taxas do canal. No indicador atual da plataforma, vendas canceladas ficam fora e vendas reembolsadas permanecem no bruto, com estornos apresentados separadamente.
_Evitar_: faturamento líquido como base da remuneração.

**Base de cobrança Daludi**:
Faturamento bruto considerado para a remuneração percentual da Daludi, excluindo cancelamentos e valores devolvidos conforme regra acordada. O demonstrativo deve identificar os ajustes em relação ao indicador bruto, sem deduzir taxas do marketplace.
_Evitar_: tratar faturamento bruto exibido e base após ajustes como valores necessariamente idênticos.

**Consulta Sonar faturável**:
Uma busca por termo ou EAN iniciada pelo cliente e concluída com sucesso, incluindo suas análises complementares, independentemente da quantidade de anúncios retornados. O preço é negociado por organização, com referência inicial de R$ 1,20 na modalidade 2; falhas, reabertura de resultados já consultados e consultas da equipe Daludi não geram cobrança ao cliente.
_Evitar_: acesso ao Pulse como sinônimo de consulta faturável.

**Consumo operacional Daludi**:
Uso do Sonar pela equipe Daludi em benefício de uma organização, acompanhado separadamente do consumo faturável do cliente. Deve permanecer visível e auditável, com identificação de quem utilizou.
_Evitar_: consumo gratuito como sinônimo de consumo sem custo para a Daludi.

**Demonstrativo mensal**:
Documento que apresenta a base de faturamento, os componentes da remuneração e o consumo faturável de uma organização no mês, para conferência e cobrança manual pela Daludi.
_Evitar_: comprovante de pagamento ou cobrança automaticamente emitida.

**Relatório mensal do cliente**:
Prestação de contas comercial que a Daludi envia ao gestor da loja sobre um mês com demonstrativo mensal já fechado: resultados da loja no mês e, em página própria, o faturamento e a comissão a depositar, com os mesmos valores congelados do demonstrativo. Mês sem demonstrativo fechado não gera relatório. Sempre apresenta lucro, margem s/ venda e markup, mesmo quando a organização esconde o lucro do próprio dashboard: é a prestação de contas da Daludi, não a tela do cliente. O resultado é apresentado em cascata (faturamento → líquido → lucro → lucro após Ads da loja), com destaque no lucro após Ads; a remuneração Daludi fica fora da cascata, só na página de cobrança. As páginas de desempenho usam o faturamento da loja (já sem cupons do vendedor, como o dashboard); a página de cobrança parte dele e mostra a ponte até a base de cobrança (+ cupons do vendedor − devoluções abatidas), pois a cobrança não deduz cupom.
_Evitar_: demonstrativo mensal como sinônimo (o demonstrativo é a conferência interna da cobrança), prévia de cobrança.

**Lucro após Ads da loja**:
Lucro da organização no mês menos todo o gasto de Ads do mês da conta, sem atribuição por produto. Dele derivam a **margem s/ venda após Ads** (÷ faturamento) e o **markup após Ads** (÷ custo dos produtos), sempre com "após Ads" no nome. Só existe quando todo o faturamento do mês tem lucro calculável e o gasto de Ads do mês é conhecido; caso contrário fica indisponível com o motivo.
_Evitar_: lucro após Ads por SKU/família (que exige gasto exclusivo e cobertura do período), lucro líquido.

**Dados de recebimento Daludi**:
Favorecido, documento, conta bancária e chave Pix da Daludi, únicos para todas as organizações, que o relatório mensal apresenta junto do valor a depositar e de um Pix com esse valor exato.
_Evitar_: dados de pagamento por organização, cobrança automática.

**Vencimento da remuneração**:
Dia do mês seguinte à competência em que o valor a depositar deve ser pago; faz parte das condições comerciais da organização, com padrão no dia 05. O demonstrativo da competência é fechado sempre no dia 01 do mês seguinte, de modo que o vencimento nunca antecede o fechamento.

**Fechamento automático**:
Fechamento do demonstrativo mensal que a plataforma executa sozinha no dia 01 para cada organização com condições comerciais e sem pendência, avisando a Daludi do resultado. Organização com pendência continua aberta até o fechamento manual. Fechar não envia nada ao cliente: o relatório mensal só sai após revisão da Daludi.
_Evitar_: envio automático, cobrança automática.

**Aviso de fechamento mensal**:
Mensagem da plataforma à Daludi, no dia 01, com o valor a receber de cada organização fechada e as organizações que ficaram com pendência. Só administradores da plataforma recebem; nenhum gestor de cliente vê valores de outras organizações.
_Evitar_: notificação gerencial (que é por organização e para o cliente).
_Evitar_: data de fechamento do demonstrativo como vencimento.

**Principais produtos do mês**:
Curva ABC por família de produto, ordenada por faturamento sobre todo o universo do mês, da qual o relatório mostra no máximo cinco famílias com unidades, faturamento, participação, lucro, margem s/ venda e markup (antes de Ads, pois o gasto de Ads não é atribuído por família) e a participação somada das cinco no faturamento.
_Evitar_: ranking por SKU/variação, top 5 por lucro.

**Visitas dos anúncios acompanhados**:
Soma das visitas do mês nos anúncios da organização que o PubliAI acompanha, sempre apresentada com a quantidade de anúncios cobertos. Pode diferir do total de visitas exibido no painel do Mercado Livre, que inclui anúncios fora do PubliAI e usa outra janela.
_Evitar_: visitas da loja, visitas totais.

**Conversão dos anúncios acompanhados**:
Pedidos desses mesmos anúncios ÷ suas visitas no mês. Nunca divide pedidos da loja inteira por visitas de parte dos anúncios.
_Evitar_: conversão da loja, taxa de conversão do ML.


**Condições comerciais da organização**:
Modalidade, valores e percentuais negociados com cada cliente, incluindo implantação, sustentação de infraestrutura, percentual sobre faturamento bruto e preço da consulta Sonar. A modalidade 1 não cobra consulta Sonar do cliente e a modalidade 2 não tem infraestrutura separada (ADR-0165); os valores da apresentação são referências iniciais.
_Evitar_: tabela de preços obrigatória como sinônimo de condições contratadas.

**Vigência comercial**:
Período em que determinadas condições negociadas se aplicam à organização. Por padrão, renegociações entram em vigor no próximo mês, preservando o período atual, o histórico e os demonstrativos dos meses já fechados.

**Markup do cliente no período**:
Retorno sobre o custo dos produtos nas vendas com custo considerado: (receita líquida após impostos − custo dos produtos) ÷ custo dos produtos, expresso em percentual. Deve ser acompanhado da cobertura de custos; sem custo disponível, o indicador é indisponível.
_Evitar_: margem sobre receita como sinônimo de markup.

## Extensão do navegador

**Extensão PubliAI**:
Ferramenta do navegador, exclusiva para usuários com conta PubliAI, que mostra análise sobre anúncios e buscas do Mercado Livre enquanto o operador navega. Usa a organização do usuário (ou a da sessão de suporte ativa, no caso da equipe Daludi).
_Evitar_: plugin, Avant/Pulse como sinônimo.

**Sessão da extensão**:
Login (e-mail e senha do PubliAI) feito no painel da Extensão PubliAI, que cria uma sessão própria, independente da do app web. Os tokens ficam só no service worker (`chrome.storage.local`, acesso restrito a contextos confiáveis) até o usuário clicar em "Sair"; a senha nunca é guardada. Sair na extensão não encerra a sessão do app, e vice-versa.
_Evitar_: conectar a extensão pelo app, token do app.

**Extensão ativa**:
Chave liga/desliga da Extensão PubliAI, guardada só no navegador e disponível logado. Desligada, a extensão não analisa, não desenha selos nem chama a edge; o ícone no cabeçalho do ML continua para religar.
_Evitar_: pausar a extensão, desinstalar.

**Anúncio próprio**:
Anúncio publicado por uma conta de marketplace conectada à organização. Na extensão, recebe atalho para o PubliAI em vez de análise duplicada.
_Evitar_: meu produto, item da loja.

**Anúncio de concorrente**:
Anúncio de qualquer vendedor que não seja conta conectada à organização. Seus números vêm só do que a página exibe ou de estimativa.
_Evitar_: anúncio de terceiro como termo de tela.

**Dado observado**:
Valor exibido pelo próprio Mercado Livre na página aberta ou devolvido pela API oficial à conta da organização.
_Evitar_: dado real, dado oficial quando for estimativa.

**Estimativa**:
Valor calculado pelo PubliAI a partir de dados observados, sempre apresentado com esse rótulo e com a fonte.
_Evitar_: venda, visita ou vencedor sem qualificação.

**Base de mercado**:
Acervo acumulado de dados de anúncios de concorrentes coletados por coleta ampla ou pela navegação de usuários. A extensão não cria nem alimenta base de mercado.
_Evitar_: histórico, como se fosse sinônimo.

**Acompanhamento de anúncio próprio**:
Registro diário dos números de um anúncio próprio escolhido pela organização, para ver a evolução e comparar mudanças. Não é base de mercado.
_Evitar_: monitorar concorrente, snapshot de mercado.

**Vínculo de produto**:
Associação guardada pela organização entre um produto de catálogo do Mercado Livre e um SKU do seu próprio catálogo, usada para trazer o custo real à análise de anúncios de concorrente. É dado da organização, não base de mercado.
_Evitar_: match, de-para.

**Minha margem**:
Lucro que a organização teria vendendo o produto analisado a um preço informado, com custo real do SKU vinculado, imposto por origem, comissão do tipo de anúncio e frete calculado para a conta da organização.
_Evitar_: margem do concorrente, recebe do vendedor.

**Simulação sem vínculo**:
Minha margem calculada para um anúncio de concorrente com custo e origem informados pelo operador (ou um SKU escolhido só para aquela conta), sem gravar vínculo de produto. Some ao sair da busca; gravar exige "Vincular".
_Evitar_: vínculo temporário.

**Mini-bloco da busca**:
Bloco curto que a Extensão PubliAI coloca dentro de cada card de uma busca do Mercado Livre, com poucos números do produto; a análise completa fica no painel lateral.
_Evitar_: selo (o selo é a etiqueta única de margem), card do PubliAI.

**Enriquecimento de catálogo**:
Consulta à API oficial do Mercado Livre, com a conta da organização, sobre um produto de catálogo visto numa busca, para trazer vendedor, medalha, UF, tipo da oferta, número de vendedores e data de criação do catálogo. Vale também para anúncio de concorrente; o resultado é transitório e não forma base de mercado.
_Evitar_: coleta, raspagem, monitoramento.

**Giro mínimo ao preço atual**:
Piso da faixa de vendidos exibida pelo Mercado Livre multiplicado pelo preço atual do card. Mostra a ordem de grandeza do produto; não é faturamento, porque as vendas ocorreram a outros preços.
_Evitar_: faturamento, receita, faturamento do catálogo, volume mínimo.

**Vendas mínimas da página**:
Soma do piso da faixa de vendidos exibida pelo Mercado Livre em cada produto da busca, contando cada produto uma vez. É um mínimo, não o total vendido.
_Evitar_: total de vendas, soma dos mínimos.

**Meu anúncio nesta busca**:
Anúncio próprio que aparece entre os cards carregados de uma busca, com a posição observada naquela página (orgânica ou patrocinada). Não é ranking geral, e SKU vinculado não é anúncio próprio.
_Evitar_: meu ranking, minha posição no ML.

## Preço do anúncio

**Preço base**:
Preço do anúncio sem promoção, definido pelo vendedor. É o preço pelo qual o anúncio volta a vender quando a oferta termina.
_Evitar_: preço do produto, preço cheio, preço original como termo de tela.

**Preço da oferta**:
Preço que o comprador paga enquanto o anúncio participa de uma promoção. Muda sem mexer no preço base, e vice-versa.
_Evitar_: preço promocional como sinônimo de preço base reduzido, desconto.

**Faixa de atacado**:
Preço para comprador empresa a partir de uma quantidade mínima, sempre abaixo do preço base. A organização define o percentual por família; o canal guarda o valor em reais, que não acompanha sozinho o preço base.
_Evitar_: desconto de atacado como sinônimo do valor em reais.

## Sugestões de promoção

**Quase vendendo**:
Produto que vende pouco e abaixo do esperado apesar de receber visitas, sinal de que o preço pode ser a barreira. É a faixa prioritária das sugestões de promoção.
_Evitar_: encalhado, parado (esses olham só as vendas).

**Invisível**:
Produto que vende pouco e recebe poucas visitas. Desconto sozinho tende a render pouco: a campanha ajuda pela exposição, ou o problema é outro.
_Evitar_: encalhado, parado.

**Vende pouco**:
Produto com menos de 5 unidades vendidas nos últimos 30 dias, somando todos os seus anúncios. Inclui quem vendeu zero. Anúncio sem produto cadastrado é avaliado sozinho.
_Evitar_: baixo giro (que olha duas janelas de 30 dias e exclui quem vendeu zero).

**Oportunidade**:
Estimativa do lucro das vendas que as visitas dos anúncios da campanha recomendada deveriam ter gerado na conversão média da conta e não geraram. Só ordena as sugestões: mede distância da média, não o que a promoção recupera, e por isso a tela mostra quanto vendeu e quanto seria esperado pela média da conta, não um valor em reais.
_Evitar_: dinheiro parado, potencial garantido.

## Imagens do anúncio por IA

**Galeria da cor**:
Conjunto de até sete imagens de anúncio geradas por IA para uma cor de uma família, cada uma com uma missão própria na jornada de compra (capa, contexto de uso, quebra de objeção, benefícios, especificações, como usar, detalhes). Cada variação daquela cor mostra a sua galeria no marketplace; cores diferentes têm galerias diferentes. O operador escolhe quais missões gerar, a mesma escolha para todas as cores da família. Aplicada, a galeria entra nas fotos daquela cor no anúncio, só com as imagens aprovadas e na ordem das missões, substituindo as fotos atuais (padrão) ou depois delas; cor sem galeria segue com as fotos de sempre. A galeria nasce para anúncios já publicados.
_Evitar_: fotos comuns da família (capa, capa2 e capa3, que são as mesmas para todas as cores).

**Imagem de galeria faturável**:
Imagem da galeria da cor gerada com sucesso e exibida ao operador, cobrada ao preço por imagem da organização, independentemente de ser aprovada ou publicada. Cada nova geração pedida pelo operador é outra imagem faturável; falha técnica do provedor, sem imagem entregue, não é cobrada.
_Evitar_: cobrança só da imagem aprovada (regra da foto do kit com variação, que tem verificação automática).

**Plano da galeria**:
Escrito pela IA a partir dos dados do anúncio: uma paleta e as sete imagens planejadas (cenário e textos de cada uma). Há um plano por anúncio, comum a todas as cores: cada galeria da cor sai dele, com a foto da própria cor como referência. Cada imagem sai inteira do gerador, texto incluído; o operador não edita o plano, só gera, regera e aprova as imagens. O plano não é cobrado do cliente.
_Evitar_: roteiro (nome do fluxo anterior, com texto editável e composto pelo sistema); prompt (termo do provedor de imagem, não do operador).

**Conferência de texto**:
Leitura por visão do texto de cada imagem gerada, comparado com os textos do plano. Texto faltando, errado ou a mais vira alerta no cartão da imagem; a aprovação continua humana.

**Aviso de imagens prontas**:
Notificação (app e, se cadastrado, Telegram) enviada só ao operador que pediu a geração, quando todas as imagens pedidas para um anúncio terminam.

**Aprovar imagem da galeria**:
Decisão do operador de que uma imagem gerada serve. Só guarda a imagem na galeria; não muda nada no marketplace.

**Aplicar galeria**:
Comando explícito de um administrador da organização que envia as imagens aprovadas de uma galeria da cor ao anúncio publicado, guardando as fotos anteriores para reverter. Tem dois modos: substituir (padrão; a capa gerada vira a primeira foto) ou adicionar depois das fotos atuais, recusado antes do envio quando passa do limite de fotos da categoria.
_Evitar_: publicar galeria (publicar é criar o anúncio).

## Reposição de estoque

**Reposição**:
Compra de mercadoria ao fornecedor para recompor o estoque da organização antes que um produto acabe. O sistema sugere o que e quanto comprar; quem decide e faz o pedido é o cliente.
_Evitar_: recompra (que é o cliente final comprando de novo, Vendas SKU), reabastecimento.

**Prazo de reposição**:
Dias entre fazer o pedido ao fornecedor e a mercadoria entrar no estoque. Um único valor por organização, valendo para todos os fornecedores.
_Evitar_: lead time como termo de tela, prazo de entrega do marketplace.

**Cobertura desejada**:
Quantos dias de venda a organização quer ter em estoque depois que a reposição chega. Um único valor por organização.
_Evitar_: estoque mínimo (que é quantidade, não dias).

**Dia disponível**:
Dia em que o produto tinha estoque e anúncio ativo no canal. Dia zerado, pausado, moderado ou antes da primeira publicação não conta.
_Evitar_: dia com estoque (estoque sem anúncio no ar não vende).

**Velocidade de venda**:
Unidades vendidas (menos cancelamentos) por dia disponível, nos últimos 60 dias ou no histórico que existir, incluindo as unidades que saíram dentro de kits vendidos. Devolução não desconta: se a peça volta vendável, entra no estoque. A ruptura não esconde a demanda, porque dias sem estoque ficam fora da conta.
_Evitar_: média diária (dividida por dias corridos), giro.

**Curva da família**:
Participação de cada cor e de cada tamanho na velocidade de venda da família, medida por dia disponível para quem esgotou não parecer vender pouco. O produto passa da curva para a própria velocidade aos poucos, conforme acumula vendas, e a soma dos produtos sempre bate com a venda da família. Produto sem variação é família de um item só.
_Evitar_: grade (que é o conjunto de tamanhos, não a participação nas vendas), mix.

**Pouco histórico**:
Situação do produto que ainda depende, ao menos em parte, da curva da família por ter poucas vendas próprias. Quando é boa parte da loja (organização nova), a tela mostra um aviso único com o percentual de produtos ainda estimados pela família.
_Evitar_: sem dados, inconclusivo, "confiável a partir de".

**Tendência de venda**:
Comparação, na família, entre a velocidade recente (últimos 14 dias disponíveis) e a de base (60 dias), sem os dias em oferta. Acelerando: a recente supera a base em 30% ou mais, com pelo menos 5 vendas recentes. Esfriando: a recente fica 30% ou mais abaixo, quando a base esperava ao menos 5 vendas no período. Nos dois casos a sugestão usa a média das duas velocidades, e a tela mostra o ajuste no pedido. Só existe com pelo menos 28 dias de histórico.
_Evitar_: sazonalidade (que exige comparar com o mesmo período do ano anterior).

**Dia atípico**:
Dia em que uma família vendeu mais de 3 vezes a mediana dos seus dias com venda, e pelo menos 4 unidades. Entra na velocidade de venda limitado a esse teto, e a tela informa o pico limitado.
_Evitar_: venda em promoção.

**Venda em oferta**:
Venda feita a um preço pelo menos 15% abaixo do preço alto habitual daquele produto na janela (o percentil 75 dos seus preços de venda). Conta na velocidade, mas não na tendência, para uma campanha longa (Black Friday) não parecer aceleração.
_Evitar_: promoção (o critério é o preço da venda, não a participação numa campanha), venda desconsiderada.

**Estoque de segurança**:
Folga acima da venda média da família, para o produto não faltar quando a venda do período sair acima da média. Calculada para a família inteira e repartida entre os produtos que precisam de compra; não é um número que a organização digita.
_Evitar_: estoque mínimo.

**Sugestão de reposição**:
O que o sistema propõe comprar, produto a produto: o necessário para a cobertura desejada depois que o pedido chega, mais o estoque de segurança, menos o estoque que vai sobrar até lá e o que chega depois. A projeção é dia a dia: venda perdida enquanto o produto está zerado não consome a mercadoria a caminho. A organização aprova como veio ou altera; a sugestão sozinha não compra nada.
_Evitar_: pedido (a sugestão vira pedido só depois de aprovada).

**Fora de linha**:
Marca da organização, feita no Estoque, num produto inteiro ou numa cor de um produto que não será mais comprado. Sai da sugestão, da curva da família, dos cards e do resumo diário da reposição; as outras cores são recalculadas. Os itens afetados saem dos rascunhos de pedido, e voltar à linha não os devolve. O estoque que sobra continua à venda e o anúncio no ML não muda. A cor vale só para aquele produto.
_Evitar_: descontinuado, excluir, desativar (o produto continua vendendo o que tem).

**Não repor**:
Marca da organização num SKU (um tamanho de uma cor) que não será mais comprado; é a marca de escopo menor, feita no popover da célula da Reposição. Sai da sugestão e da curva da família, mas a linha continua na grade, riscada. Cor ou produto inteiro é **Fora de linha**.
_Evitar_: excluir, desativar (o produto continua vendendo o que tem).

**Pedido de compra**:
Sugestão de reposição aprovada por um administrador da organização, com fornecedor, itens, quantidades e data prevista de chegada (hoje mais o prazo de reposição, editável). Passa por rascunho (compartilhado entre os membros), aprovado, enviado ao fornecedor, parcial e recebido, ou saldo encerrado. Pode ser editado até o primeiro recebimento. O sistema não envia ao fornecedor; a organização copia o texto.
_Evitar_: nota de compra (documento fiscal do fornecedor, que registra a entrada).

**A caminho**:
Quantidade de um produto em pedidos de compra ainda não recebidos. É descontada da sugestão de reposição para o mesmo item não ser pedido duas vezes.
_Evitar_: em trânsito, pendente.

**Recebimento do pedido**:
Baixa de um pedido de compra escolhido na entrada de compra no estoque. A nota de compra já sugere o pedido aberto do fornecedor que a emitiu; a entrada manual pergunta de qual pedido veio, ou nenhum. Na entrega parcial, a organização diz se o restante ainda vem. Ajuste e estorno de venda não baixam pedido; desfazer a nota desfaz a baixa.
_Evitar_: conferência.

**Pedido atrasado**:
Pedido de compra com saldo a receber depois da data prevista de chegada. Gera alerta, mas o saldo continua a caminho.

**Encerrar saldo**:
Decisão da organização de que o restante de um pedido não vai chegar. O saldo deixa de estar a caminho e o produto volta a entrar na sugestão de reposição.
_Evitar_: cancelar pedido (que desfaria também o que já chegou).

**Dias de estoque**:
Quantos dias até o estoque do produto zerar na projeção, contando as chegadas dos pedidos a caminho.
_Evitar_: cobertura (que é a meta da organização, não a situação do produto).

**Urgência de reposição**:
Faixa de cada produto tirada da mesma projeção da sugestão. Ruptura: estoque zerado de produto que já teve estoque e vende. Vai faltar: zera antes de o pedido feito hoje chegar. Pedir agora: há quantidade a comprar. Em dia: nada a comprar.
_Evitar_: estoque baixo, estoque crítico, excesso (fora da primeira versão).

**Completar grade**:
Quantidade estimada para um tamanho ou cor publicado que nunca teve estoque nem movimento (estoque hoje zero e nenhum movimento de estoque, em data nenhuma). Com estoque vindo da planilha, mesmo sem movimento, segue a conta normal. A estimativa vale sempre, exceto quando a cor ou o tamanho já é encalhe comprovado (14+ dias disponíveis sem venda). Sai só da curva da família, sem mexer na conta dos produtos que vendem: o produto fica Em dia, fora do pedido, dos cards e do resumo diário, e a quantidade aparece à parte no mapa da grade até a organização incluí-la no pedido.
_Evitar_: ruptura (que exige ter tido estoque).

**Resumo de reposição**:
Aviso diário (app e Telegram) só com o que entrou em Ruptura, Vai faltar ou Pedir agora desde o aviso anterior, mais pedidos atrasados e rascunho esperando aprovação. Produto já avisado não se repete; sem novidade, não há aviso.

**Fornecedor**:
Quem vende a mercadoria para a organização, com CNPJ opcional (que liga as notas de compra aos pedidos). Agrupa um ou mais nomes da coluna FORNECEDOR da planilha (que às vezes traz a marca, com grafias diferentes). Cada pedido de compra é de um fornecedor só.
_Evitar_: marca (o fornecedor pode vender várias marcas), emitente (termo da nota fiscal).

**Múltiplo de compra**:
Quantidade em que o fornecedor vende um produto (caixa de 12, por exemplo); padrão 1. O total da família é arredondado para cima até o múltiplo e repartido entre os produtos; a tela mostra a quantidade antes do arredondamento.
_Evitar_: pedido mínimo (valor ou quantidade mínima do pedido inteiro, que não é controlado).

**Módulo Reposição**:
Recurso ligado por organização na Central de controle, pensado para quem não tem ERP. Todo membro vê a reposição e monta rascunhos; só administrador da organização aprova o pedido de compra.

## Acesso de agentes

**Agente**:
Programa autônomo (Claude, ChatGPT, Grok, Hermes e afins) que opera o PubliAI em nome de uma organização, sem usuário humano na frente. Tem identidade própria, distinta de qualquer usuário.
_Evitar_: usuário, integração.

**Conexão de agente**:
Vínculo entre um agente e uma única organização, criado e revogado por administrador dela, com validade ou até ser revogado. Nasce de duas formas, com o mesmo comportamento: por chave de agente ou por autorização (o administrador aprova o agente numa tela do app). Toda ação é registrada no nome da conexão, não da pessoa que a criou.
_Evitar_: sessão, login do agente.

**Chave de agente**:
Segredo que o administrador gera no app e cola no agente para criar uma conexão de agente. É exibida uma única vez.
_Evitar_: token (já designa o acesso ao Mercado Livre), chave de API.

**Módulo Acesso de agentes**:
Recurso ligado por organização na Central de controle, desligado por padrão, que permite ao administrador da loja criar conexões de agente.
_Evitar_: módulo Ads como pré-requisito.

**Pedido de publicação**:
Solicitação feita por um agente para publicar ou alterar um anúncio no marketplace (inclusive preço, pausa e promoção). Nunca chega ao canal sozinho: espera aprovação de um humano na fila de revisão do app.
_Evitar_: publicação (que só existe após a aprovação).
