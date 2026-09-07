# ADR-0155: Central integrada com consumo e fechamento auditáveis

**Status:** Aceito no desenho da central, 2026-09-06. Implementação acompanhada pelo [plano](../superpowers/plans/2026-09-06-central-organizacoes.md).

A central administrativa permanece no PubliAI, com indicadores acessíveis ao super-admin sem criar uma sessão de suporte; a entrada na operação continua dependendo da aprovação do cliente. A cobrança usa condições comerciais versionadas por organização e um registro durável de consumo do Sonar, porque cache global de mercado e logs técnicos não representam entregas faturáveis por cliente.

Uma busca concluída por termo ou EAN corresponde a uma unidade comercial, incluindo complementos; reaberturas, falhas e consultas da equipe Daludi não são cobradas, mas são auditáveis. Os demonstrativos mensais congelam fontes, preços e ajustes, evitando que renegociações ou fatos tardios reescrevam cobranças anteriores. Manter esse histórico exige armazenamento próprio; a alternativa de recalcular tudo pelo contrato e cache atuais foi rejeitada por não permitir explicar valores já cobrados.

Os preços da apresentação são referências negociáveis, inclusive infraestrutura na modalidade 2. Esta decisão substitui, para a central, a direção comercial por faixas de anúncios da proposta ADR-0028; integração com gateway não pertence à primeira versão.
