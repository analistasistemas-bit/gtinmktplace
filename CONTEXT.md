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
