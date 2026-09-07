# Operar a Central de Organizações

> Em produção desde 2026-09-07. Regras de negócio: [ADR-0155](../decisions/0155-central-organizacoes-cobranca-auditavel.md)
> e [ADR-0158](../decisions/0158-central-carteira-agregada-e-pendencias.md).

## Pré-requisitos

- Entrar com um perfil de super-admin ativo.
- Usar `/admin` para consultar a carteira sem iniciar uma sessão de suporte.
- Solicitar suporte e aguardar a aprovação do cliente antes de entrar na operação da organização.
- Conferir a competência selecionada; os cortes usam mês-calendário em
  `America/Fortaleza`.

## Consultar a carteira

1. Abra `/admin`.
2. Pesquise por nome/slug, filtre **Com pendências** ou inclua organizações de teste quando
   necessário. Testes ficam fora dos totais comerciais por padrão.
3. No topo, confira os agregados da carteira: faturamento bruto, previsão de cobrança, pendências e
   número de organizações. Na tabela, cada organização mostra faturamento, markup, cobertura de
   custos, consultas Pulse, previsão e pendências.
4. Quando houver algo a resolver, a faixa **Precisa da sua atenção** lista organizações sem condição
   comercial, organizações com pendência de cobrança e acessos de suporte aprovados aguardando
   entrada — cada item já leva direto para a ação.
5. Abra **Ver organização** para acessar o detalhe sem trocar a organização ativa da operação.

**Pendência** é bloqueio do demonstrativo do mês selecionado: condição comercial ausente, devolução
sem conciliação ou venda alterada após o fechamento. Uma busca Sonar em andamento não conta como
pendência.

O markup nunca deve ser interpretado como margem nem como base de cobrança. Ele segue a fórmula
operacional `(líquido após impostos − custo) ÷ custo`, exibido como percentual (por exemplo `+43%`).
Quando faltam custos, ou a organização ainda não confirmou a própria alíquota tributária na tela
Configurações do app do cliente, a central mostra `—` no lugar do número, em vez de presumir um
valor (nunca 8 %/16 % por padrão).

## Usar as cinco áreas do detalhe

1. **Resultados:** bruto, pedidos, ticket, markup com cobertura, comparação equivalente e série de
   seis meses. Contagens operacionais (anúncios ativos, publicações) não são exibidas nesta versão —
   ver Limitações.
2. **Pulse:** unidades faturáveis do cliente, consultas Daludi isentas, falhas e reaberturas. Uma
   busca Sonar concluída vale uma unidade **tanto por termo quanto por EAN** — desde o
   [ADR-0140](../decisions/0140-sonar-ean-analise-completa-pela-busca.md) o código de barras deixou
   de ter caminho próprio e percorre o mesmo pipeline da busca por descrição, entrando no ledger
   com `query_type = 'ean'`; a coluna do tipo aparece na lista de consultas. Retry, complemento
   (visitas, análise de seções) e reabertura da mesma versão não geram outra unidade. Custo medido
   do fornecedor não é exibido nesta versão, por falta de medição confiável.
3. **Cobrança:** cadastro e renegociação das condições comerciais, prévia da competência,
   composição, conciliações, fechamento e demonstrativos fechados exportáveis.
4. **Auditoria:** eventos administrativos, comerciais, Pulse e suporte, filtrados sem expor
   credenciais ou payloads completos de fornecedores.
5. **Configurações:** cadastro (tipo de pessoa), canais e módulos habilitados para a organização.

## Entender bruto e base de cobrança

- **Faturamento bruto** é o indicador de vendas antes das taxas.
- **Base de cobrança** desconta cancelamentos e devoluções elegíveis sem deduzir a mesma venda duas
  vezes.
- Reembolso parcial, ou venda `paid` com devolução (`tem_devolucao`) ou estorno positivo sem valor
  de produtos conciliado, gera uma pendência e impede o fechamento.
- Conciliações vigentes casam a revisão comercial da venda (`status` + bruto em centavos), não só o
  carimbo `atualizado_em`; um novo sync ML que só atualiza o timestamp não invalida a conciliação.
- O percentual Daludi é aplicado no servidor sobre a base conciliada. O navegador não calcula nem
  edita o total autoritativo.

## Cadastrar ou renegociar condições

1. Em **Cobrança**, abra o card **Condições comerciais** (aberto por padrão no primeiro contrato;
   colapsado, com a condição vigente resumida, quando já existe uma) e confira modalidade,
   infraestrutura mensal, percentual sobre a base bruta, preço por consulta Sonar e eventual
   implantação.
2. Informe a vigência (só no primeiro contrato — renegociação sempre vale a partir do próximo mês) e
   um motivo verificável.
3. Salve e confira a nova versão no card **Histórico de condições**, logo abaixo.

Valores zero são válidos. A modalidade 2 também pode ter infraestrutura mensal. No **primeiro
cadastro**, a vigência pode começar neste mês ou no próximo, sem cobrança retroativa; nas
**renegociações**, a nova condição passa a valer no próximo mês. Demonstrativos já fechados
conservam a condição e os valores originais.

## Conciliar e fechar uma competência

1. Em **Cobrança**, abra um mês anterior; o mês corrente não pode ser fechado.
2. Resolva as pendências de devolução com o valor devolvido dos produtos, revisão da fonte e motivo.
3. Confira bruto, ajustes da base, percentual, infraestrutura, consultas, implantação, créditos e
   total.
4. Confirme **Fechar demonstrativo**. Se a revisão tiver mudado, atualize a prévia e confira os
   novos números antes de tentar novamente.
5. Repita a consulta para confirmar o mesmo snapshot; o fechamento é único por
   organização/competência.
6. Exporte o demonstrativo fechado para a cobrança manual.

Sem condição comercial vigente, ou com pendências em aberto, o botão **Fechar demonstrativo** fica
desabilitado e mostra o motivo (por exemplo "Sem condições comerciais" ou "Bloqueada · N
pendências"); o servidor também recusa o fechamento sem condição comercial, mesmo que o botão seja
acionado por fora do fluxo normal.

Fatos tardios entram como ajustes rastreáveis em período posterior e usam a condição original.
Créditos são transportados; um total negativo deve ser tratado como crédito, não como pagamento.

## Central e suporte são acessos diferentes

A central entrega agregados administrativos ao super-admin. Ela não concede acesso implícito a
pedidos, anúncios ou demais dados operacionais. Para operar em nome do cliente, use a solicitação
de suporte e respeite o escopo, a aprovação e a validade existentes.

## Limitações desta versão

- Não há gateway, Pix, boleto, envio de cobrança ou comunicação automática. O primeiro lançamento
  é um demonstrativo para cobrança manual.
- Não há cobrança retroativa: consumo anterior à instrumentação ou ocorrido sem contrato permanece
  sem preço presumido.
- Markup aparece como `—` quando não há cobertura de custos confiável ou a organização não confirmou
  a própria alíquota tributária.
- Contagens operacionais (anúncios ativos, publicações) e custo medido do fornecedor não são
  exibidos nesta versão: nunca foram implementados e exigem definir a fonte de dados.
- `delete_org` está desabilitado: a limpeza sequencial existente não garante exclusão atômica nem
  preservação segura de todo o histórico comercial.
- Locks compartilhados usados no fechamento podem atrasar brevemente operações de outros tenants.
