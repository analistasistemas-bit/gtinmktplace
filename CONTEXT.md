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

**Condições comerciais da organização**:
Modalidade, valores e percentuais negociados com cada cliente, incluindo implantação, sustentação de infraestrutura, percentual sobre faturamento bruto e preço da consulta Sonar. A modalidade 2 também pode incluir cobrança de infraestrutura; os valores da apresentação são referências iniciais.
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
