# Central de organizações — descoberta

Status: entrevista em andamento. Este documento não é um plano aprovado.

## Objetivo solicitado

Evoluir a administração da plataforma para uma central de controle com configurações, resultados por cliente, uso do Pulse, logs e auditoria, permitindo apurar a cobrança e acompanhar a evolução dos clientes.

## Fontes consultadas

- `src/pages/Organizacoes.tsx`: cadastro de organizações, canais, módulos, tipo de pessoa, exclusão e solicitação de acesso de suporte. A entrada na operação depende da aprovação de um administrador da organização.
- `apresentacao/src/principal.html`, linhas 629–721, na pasta local da apresentação (ausente no checkout Git): modelo comercial abaixo.
- `docs/decisions/0028-monetizacao-e-billing.md`: proposta antiga de planos por faixa e metering de anúncios/IA; diverge do modelo comercial atual. Não usar seus preços e eixos de cobrança como requisito desta central.

## Modelo descrito na apresentação

| Componente | Modalidade 1 | Modalidade 2 |
|---|---|---|
| Implantação e calibração | R$ 3.000 | R$ 3.000 |
| Infraestrutura mensal | R$ 600 | Incorporada |
| Percentual sobre faturamento bruto | 5% | 7% |
| Acesso do cliente ao Pulse/Radar/Sonar | Não incluído | Incluído |
| Consulta de produto no Sonar | Não se aplica | R$ 1,20 |
| Prazo contratual | 24 meses | 24 meses |

A apresentação define a base como faturamento bruto dos marketplaces administrados. As decisões posteriores abaixo detalham essa referência. “Uso do Pulse” não significa automaticamente que toda ação seja faturável: a apresentação cita especificamente consultas de produto no Sonar.

## Decisões da entrevista

Decisões confirmadas pelo usuário: usar o **faturamento bruto** como base de cobrança, antes das taxas do marketplace, **excluindo vendas canceladas e valores devolvidos**. A aprovação refere-se à recomendação sobre cancelamentos/devoluções; tratamento de frete, devoluções parciais e competência dos ajustes posteriores ainda precisam ser detalhados.

O usuário reiterou: “Faturamento bruto, essa será a base”. Não aprovou uma exclusão adicional de frete. A arquitetura deve identificar a definição e a fonte do faturamento bruto já utilizado pela plataforma antes de propor qualquer ajuste adicional. Encerrar a pergunta genérica sobre a base e avançar para a definição do consumo faturável.

- Consulta Sonar faturável: uma busca concluída por termo ou EAN vale uma consulta, incluindo suas análises complementares, independentemente da quantidade de anúncios retornados. Preço negociado por organização (referência R$ 1,20), iniciada pelo cliente; falhas e reabertura de resultados já consultados não geram cobrança. Detalhes de repetição/cache constam como proposta no desenho.
- Atribuição confirmada: consultas da equipe Daludi não são cobradas ao cliente, mas seu consumo operacional deve estar disponível no painel e na auditoria, separado do consumo faturável. Registrar organização beneficiária e identidade de quem utilizou; detalhamento proposto inclui data, consulta, resultado e motivo de não cobrança. O preço comercial de R$ 1,20 não representa o custo real do fornecedor; custos operacionais monetários dependem de uma fonte verificável e não devem ser inventados.
- Condições por organização confirmadas: modalidade, valores e percentuais podem ser negociados e renegociados. Implantação, infraestrutura mensal, percentual sobre faturamento e preço por consulta Sonar devem ser configuráveis. A modalidade 2 pode cobrar sustentação de infraestrutura; não impor isenção com base na modalidade. Os preços da apresentação são sugestões iniciais, não constantes obrigatórias. Manter vigência e histórico, preservando meses já fechados, conforme recomendação aceita. Padrão confirmado: renegociações entram em vigor no próximo mês, preservando o período atual e os fechamentos anteriores.
- Escopo de cobrança confirmado: primeira versão apura os valores mensais e gera demonstrativo para conferência e cobrança manual pela Daludi. Emissão automática de Pix/boleto e integração com gateway ficam fora desta versão.
- Indicadores: usuário acrescentou explicitamente o markup do cliente à visão proposta de resultados, operação, Pulse, cobrança e auditoria. Acesso confirmado: super-admin consulta os indicadores diretamente na central, sem aprovação individual de suporte; entrar na operação da organização continua exigindo aprovação do cliente pelo fluxo existente. O alcance detalhado dos logs ainda precisa ser definido.

## Painel e markup

Visão proposta: carteira de organizações e detalhe por organização com resultados (faturamento, pedidos, ticket médio, **markup** e evolução mensal), operação (anúncios ativos, publicações, pendências), Pulse (cliente/equipe separados), cobrança (condições, previsão, demonstrativos) e auditoria (ator, ação, data, organização).

O markup é requisito explícito do usuário. Reutilizar a definição existente em `src/lib/resumo-vendas.ts`, `calcularResumo`: `(liqComCusto - custoTotal) / custoTotal`, em que o líquido considerado já desconta impostos e a agregação é por pedido/pack com custo. `src/pages/Dashboard.tsx` já exibe esse indicador como percentual. Manter consistência com o dashboard do cliente, mostrar cobertura de custos e estado indisponível quando não houver custo; não converter ausência de dados em zero. A evolução deve usar períodos comparáveis e a mesma regra de agregação, sem média simples dos percentuais dos produtos.

## Evidências para a arquitetura

- `src/hooks/useResumoVendas.ts` usa `ml_vendas` e `calcularResumo`. Em `src/lib/resumo-vendas.ts`, `STATUS_FATURAVEL` inclui `paid`, `partially_refunded` e `refunded`; canceladas ficam fora e estornos são separados. Portanto, preservar o bruto do dashboard e apresentar explicitamente os ajustes da base de cobrança, conforme exclusão de devoluções já aceita. Não subtrair duas vezes um cancelamento já excluído, nem assumir que o estorno financeiro completo equivale ao valor devolvido dos produtos.
- `supabase/functions/usuarios/index.ts` já separa ações administrativas da plataforma e valida `is_super_admin`; o novo acesso de indicadores deve manter autorização no servidor, sem simular entrada via suporte.
- `supabase/functions/_shared/support-audit.ts` registra operações de suporte em `support_audit_events`, vinculando organização, ator e solicitação. Essa trilha não substitui o registro comercial de consumo.
- `src/pages/PulseSonar.tsx` dispara busca principal de vendas e complementos de visitas/análises. Uma intenção de busca do usuário pode gerar várias chamadas técnicas; contar chamadas como consultas comerciais duplicaria cobranças.
- `supabase/functions/pulse-sonar-vendas/index.ts` retorna resultados de cache compartilhado e registra histórico de mercado apenas em cache-miss. Esse histórico não mede consumo por organização/ator e não pode ser a fonte de cobrança.
- `supabase/functions/pulse-sonar-ean/index.ts` também possui cache e resultados parciais/indisponíveis. HTTP 200 isoladamente não comprova uma consulta faturável bem-sucedida.

## Roteamento solicitado

Astra conduz arquitetura e plano por instrução expressa do usuário, que prevalece sobre o planejamento no Sol descrito na skill. Após a definição do plano, Sol coordena e revisa a execução por Terra e Luna. Limite efetivo desta sessão: quatro agentes simultâneos, incluindo a raiz. Nenhum executor foi despachado nesta etapa.
