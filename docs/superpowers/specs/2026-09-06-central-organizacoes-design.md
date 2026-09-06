# Central de controle das organizações

Data: 2026-09-06. Status: estrutura aprovada pelo usuário nesta conversa; plano em elaboração.

Requisitos confirmados e fontes: [descoberta](2026-09-06-central-organizacoes-discovery.md). Vocabulário: [CONTEXT.md](../../../CONTEXT.md).

## 1. Direção e experiência

Recomendação: construir a central dentro da plataforma existente, com uma visão da carteira e uma página de detalhe por organização. Aproveitar cadastro, canais, módulos, suporte, indicadores e componentes existentes. A central terá backend próprio para leitura administrativa, condições comerciais e fechamento; não dependerá de trocar a organização ativa no navegador.

Alternativas consideradas: acrescentar apenas indicadores à tabela atual é menor, mas não resolve apuração e auditoria; criar um sistema administrativo separado exige nova aplicação e sincronização sem necessidade demonstrada. A central integrada é a proposta escolhida para revisão.

Na carteira, apresentar faturamento, evolução, receita Daludi prevista e organizações com pendências. Lista pesquisável e ordenável com modalidade, faturamento, markup com cobertura, consumo faturável, valor previsto e última atualização. Organizações de teste ficam identificadas e excluídas por padrão dos totais comerciais, com filtro para incluí-las. Não calcular markup da carteira como média simples dos markups dos clientes.

No detalhe da organização, manter nome e período visíveis e organizar cinco áreas:

1. **Resultados:** faturamento bruto, markup com cobertura de custos, pedidos, ticket médio, comparação de períodos equivalentes e evolução mensal; operação com anúncios ativos, publicações e pendências.
2. **Pulse:** consultas faturáveis do cliente, uso operacional Daludi, falhas e reaberturas, com detalhamento por usuário, busca e data. Atividade do Radar permanece separada das unidades faturáveis do Sonar.
3. **Cobrança:** condições vigentes e futuras, prévia do mês, demonstrativos fechados, ajustes e exportação para conferência/cobrança manual.
4. **Auditoria:** filtros por ator, ação, resultado, período e organização; eventos administrativos, comerciais, Pulse e suporte, com detalhes relevantes e sem segredos.
5. **Configurações:** cadastro, modalidade, canais, módulos e condições negociadas. A solicitação de suporte permanece disponível com seu fluxo de aprovação atual.

Em celular, usar cartões e listas compactas com detalhamento, evitando a tabela extensa da tela atual. Estados de carregamento, falha, ausência de dados e ausência de custo devem ser distintos. A data de atualização acompanha os indicadores.

## 2. Resultados e autorização

Reutilizar as definições de `calcularResumo` e os mesmos resolvedores de custo/imposto do dashboard, com núcleo de cálculo puro compartilhado onde necessário. Consultas administrativas retornam agregados paginados e escopados; não transferir todas as vendas de todas as organizações para o navegador. Buscar o detalhe apenas da organização e período selecionados.

O faturamento bruto atual inclui vendas reembolsadas e segrega estornos. Preservar esse indicador e apresentar a base da cobrança com as deduções de cancelamentos/devoluções acordadas. Cancelamentos já excluídos não são deduzidos novamente. A composição de reembolsos parciais exige identificar o valor dos produtos devolvidos na fonte, sem subtrair frete/taxas reembolsados como se fossem receita de produto. Se a fonte não permitir apuração confiável, sinalizar a pendência e impedir fechamento definitivo até conciliação auditável.

Markup mantém a fórmula existente: (líquido após impostos − custo) ÷ custo, com agregação por pedido/pack e cobertura de custos visível. Sem custos conhecidos, mostrar indisponível; falhas de leitura não se tornam zero. Markup é indicador do cliente e não substitui a base bruta da remuneração Daludi.

Super-admin ativo pode consultar indicadores diretamente na central, com autorização no servidor. O acesso a esses agregados não concede sessão de suporte nem acesso operacional implícito. Entrar na operação continua exigindo aprovação do cliente. Toda seleção de organização e todo cache novo incluem identidade/escopo da organização; separar os caches da central dos hooks da operação. Não alargar as permissões das tabelas operacionais para habilitar a central.

## 3. Consumo do Sonar e auditoria

Uma busca por termo ou EAN é uma unidade comercial, mesmo que gere várias chamadas de vendas, visitas e análises. Cobrar apenas buscas iniciadas pelo cliente com resultado principal válido entregue, pelo preço vigente da organização. Falhas e consultas Daludi são registradas sem cobrança; erro em complemento não cria uma segunda unidade nem uma cobrança independente.

Proposta para repetição: manter identidade estável do resultado e registrar a primeira entrega faturável por organização/resultado. Reaberturas por qualquer usuário da mesma organização não cobram novamente. Uma nova versão de dados consultada explicitamente pelo cliente pode gerar nova unidade; atualizações automáticas e retries não. Cache compartilhado de dados públicos não compartilha o histórico comercial entre clientes: uma organização pode ter sua primeira consulta atendida pelo cache, e outra já ter pago pelo mesmo resultado. Consumo da equipe Daludi permanece isento e identificável, sem transformar a primeira consulta posterior do cliente em consumo da equipe.

Determinar organização beneficiária, ator e contexto de suporte no servidor. Uma declaração do navegador não pode se autodeclarar uso Daludi para evitar cobrança. Separar tentativa técnica, resultado lógico e evento faturável, com identificadores de correlação e unicidade para impedir duplicação em concorrência/retry. A entrega de resultado faturável depende de registro comercial durável; falha de persistência não deve produzir cobrança oculta ou perder a capacidade de conciliar a entrega.

Registrar consulta normalizada, tipo termo/EAN, ator, organização, instante, resultado, origem cliente/Daludi, versão do resultado, motivo de isenção e valor/preço aplicado. Logs de complementos se correlacionam à mesma busca. Custo de fornecedor só aparece se medido de fonte verificável; preço cobrado ao cliente não é custo interno. Sem fonte de custo, exibir consumo e custo indisponível.

Auditoria comercial registra criação/renegociação das condições, fechamento e ajustes com ator e motivo. A trilha de suporte existente é reaproveitada como fonte de eventos de suporte. Segredos, credenciais e payloads completos de fornecedores não entram na interface de auditoria. A cobertura começa com a instrumentação: não reconstruir consultas históricas individuais usando cache global.

## 4. Condições e fechamento mensal

Cada organização possui condições comerciais versionadas: modalidade, implantação, infraestrutura mensal, percentual sobre faturamento bruto e preço por consulta Sonar. Os valores da apresentação são sugestões editáveis. Modalidade 2 pode cobrar infraestrutura. Condições zero são válidas; valores negativos e percentuais fora do intervalo permitido são rejeitados. Alterar modalidade não deve apagar preços negociados nem silenciosamente habilitar/desabilitar módulos.

Renegociações entram em vigor no próximo mês. Preservar condições anteriores e usar a versão aplicável ao período, nunca o preço atual para recalcular o passado. Registrar quem alterou, quando e a vigência. Proposta de período: mês-calendário no fuso comercial definido da plataforma, persistido nos demonstrativos para que o navegador não altere o corte.

Prévia mensal = infraestrutura contratada + remuneração percentual sobre a base apurada + consultas faturáveis ao preço vigente + implantação devida no período + ajustes identificados. Implantação é pontual, não mensal. Não assumir que o início da organização equivale a uma implantação devida: o contrato define sua competência. A ativação da cobrança requer condições comerciais cadastradas e início explícito; não gerar cobranças retroativas com preços presumidos.

Proposta de fechamento: o administrador confere a prévia e confirma um demonstrativo. O fechamento é atômico e único por organização/competência, preservando condições, valores, referências das fontes, data de corte e autor. Usar aritmética monetária decimal/centavos e arredondamento explícito, com um único cálculo autoritativo no servidor. Não permitir edição direta do total para esconder divergência.

Devoluções parciais reduzem somente o valor devolvido elegível. Para fatos tardios após um fechamento, proposta: lançar ajuste rastreável no próximo período, vinculado ao original e sem alterar o demonstrativo fechado; calcular sua remuneração pela condição original para não aplicar percentual renegociado a uma venda antiga. Créditos remanescentes são preservados, nunca descartados silenciosamente.

Exportação contém organização, competência, condições aplicadas, bruto, ajustes da base, percentual e valor correspondente, infraestrutura, implantação, quantidade/preço/total do Sonar, ajustes de períodos anteriores e total. Não emitir Pix, boleto ou comunicar cobrança automaticamente nesta versão. Exclusão de organização não pode apagar os registros comerciais/auditoria necessários para explicar demonstrativos; ajustar a política de exclusão na implementação sem executar exclusões de dados reais.

## 5. Implementação, validação e limites

Executar em etapas dependentes: contrato de dados e autorização; cálculo/resultados e condições; registro durável de consumo; fechamento/auditoria; interface integrada e validação. O plano detalhado será elaborado por Astra após a revisão deste desenho. Sol coordena Terra/Luna a partir desse plano, com escopos de escrita separados e testes por entrega. Máximo efetivo de quatro agentes simultâneos nesta sessão.

Critérios de aceite: indicadores iguais aos da operação para a mesma organização/período; markup com cobertura; isolamento entre organizações; usuário comum sem acesso administrativo; consumo cliente/Daludi separado; uma busca e seus retries/complementos sem duplicação; preços negociáveis com vigência correta; fechamento repetido sem duplicação; ajustes tardios rastreáveis; exportação conciliando com os totais; interface utilizável em celular.

Validar cálculos com casos de cancelamento, devolução total/parcial, crédito posterior, zero vendas, custos ausentes, mudança de mês e renegociação. Testar autenticação, tentativa de forjar ator/organização, concorrência de consumo e fechamento, dados paginados e falhas de persistência. Usar fixtures determinísticas; não alterar dados de produção para validar.

Limites: o consumo histórico anterior à instrumentação pode não ser recuperável; as fontes atuais podem exigir conciliação para reembolsos; custos internos dependem de medição disponível. Essas limitações devem aparecer no produto quando afetarem um indicador ou impedirem o fechamento, sem estimativas silenciosas. Deployment e migrações de produção não fazem parte da aprovação deste rascunho de arquitetura.
