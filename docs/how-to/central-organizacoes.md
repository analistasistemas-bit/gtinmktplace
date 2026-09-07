# Operar a Central de Organizações

> Estado em 2026-09-06: implementação validada na branch
> `codex/admin-control-20260906`, ainda não promovida para produção.

## Pré-requisitos

- Entrar com um perfil de super-admin ativo.
- Usar `/admin` para consultar a carteira sem iniciar uma sessão de suporte.
- Solicitar suporte e aguardar a aprovação do cliente antes de entrar na operação da organização.
- Conferir a competência selecionada; os cortes usam mês-calendário em
  `America/Fortaleza`.

## Consultar a carteira

1. Abra `/admin`.
2. Pesquise, ordene ou inclua organizações de teste quando necessário. Elas ficam fora dos totais
   comerciais por padrão.
3. Confira faturamento bruto, evolução, markup, cobertura de custos, consumo Sonar, previsão e
   pendências.
4. Abra **Ver organização** para acessar o detalhe sem trocar a organização ativa da operação.

O markup nunca deve ser interpretado como margem nem como base de cobrança. Ele segue a fórmula
operacional `(líquido após impostos − custo) ÷ custo`. Quando custos ou configuração tributária
não estão disponíveis, a central mostra o indicador como indisponível, em vez de assumir zero.

## Usar as cinco áreas do detalhe

1. **Resultados:** bruto, pedidos, ticket, markup com cobertura, comparação equivalente e série de
   seis meses. Contagens operacionais sem fonte confiável permanecem indisponíveis.
2. **Pulse:** unidades faturáveis do cliente, consultas Daludi isentas, falhas e reaberturas. Uma
   busca Sonar concluída por termo ou EAN vale uma unidade; retry, complemento e reabertura da mesma
   versão não geram outra unidade.
3. **Cobrança:** prévia da competência, composição, conciliações, fechamento e demonstrativos
   fechados exportáveis.
4. **Auditoria:** eventos administrativos, comerciais, Pulse e suporte, filtrados sem expor
   credenciais ou payloads completos de fornecedores.
5. **Configurações:** cadastro, modalidade, canais, módulos e condições comerciais negociadas.

## Entender bruto e base de cobrança

- **Faturamento bruto** é o indicador de vendas antes das taxas.
- **Base de cobrança** desconta cancelamentos e devoluções elegíveis sem deduzir a mesma venda duas
  vezes.
- Reembolso parcial sem valor de produtos conciliado gera uma pendência e impede o fechamento.
- O percentual Daludi é aplicado no servidor sobre a base conciliada. O navegador não calcula nem
  edita o total autoritativo.

## Cadastrar ou renegociar condições

1. Em **Configurações**, confira modalidade, infraestrutura mensal, percentual sobre a base bruta,
   preço por consulta e eventual implantação.
2. Informe a vigência e um motivo verificável.
3. Salve e confira a nova versão no histórico.

Valores zero são válidos. A modalidade 2 também pode ter infraestrutura mensal. A primeira
condição tem início explícito e não cria cobrança retroativa; renegociações passam a valer no
próximo mês. Demonstrativos já fechados conservam a condição e os valores originais.

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
- Markup fica indisponível quando não há cobertura de custos confiável.
- Custos internos do fornecedor aparecem apenas quando existe medição verificável.
- `delete_org` está desabilitado: a limpeza sequencial existente não garante exclusão atômica nem
  preservação segura de todo o histórico comercial.
- Locks compartilhados usados no fechamento podem atrasar brevemente operações de outros tenants.
- Migrações, Edge Functions e interface desta entrega ainda não foram promovidas para produção.
