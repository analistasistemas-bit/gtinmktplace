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
