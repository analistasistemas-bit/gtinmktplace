# Clientes, links e pedidos cancelados em Perguntas e Mensagens

## Objetivo

Melhorar as abas **Perguntas** e **Mensagens** do Faturamento do Mercado Livre para:

1. identificar o cliente pelo nome completo, com apelido/login como fallback;
2. oferecer em Mensagens o mesmo atalho externo do anúncio existente em Perguntas;
3. tratar conversas de pedidos cancelados como histórico, nunca como pendência respondível.

Essas mudanças precisam existir porque a interface atual oculta a identidade do cliente, não oferece o atalho na conversa pós-venda e tenta responder pedidos que a API do Mercado Livre bloqueia.

## Abordagem escolhida

Persistir metadados normalizados durante a sincronização e consumi-los diretamente na interface.

Alternativas rejeitadas:

- Ler nomes diretamente do JSON bruto no React: acopla a interface ao formato externo.
- Fazer combinações adicionais no navegador: aumenta consultas e complexidade a cada abertura.
- Apenas traduzir o erro de pedido cancelado: mantém uma pendência impossível de resolver.
- Ocultar conversas canceladas: elimina histórico útil para o operador.

## Dados e sincronização

### Perguntas

- Persistir o apelido/login disponível em `question.from.nickname`.
- Manter o identificador atual do comprador.
- Expor à interface uma identificação com a ordem:
  `nome completo → apelido/login → "Comprador"`.
- Como perguntas públicas normalmente não fornecem nome completo, o apelido/login será o valor esperado nesse fluxo.

### Mensagens

- Reaproveitar os dados já sincronizados em `ml_vendas` para associar à conversa:
  nome completo, apelido/login, item do anúncio e status atual do pedido.
- Persistir os metadados necessários junto das mensagens, evitando novas consultas no navegador.
- Atualizar registros existentes por migração a partir das vendas e do JSON bruto quando possível.

## Interface

### Perguntas

- Mostrar a identificação do cliente na linha de metadados da pergunta.
- Preservar título, data, status, resposta e atalho do anúncio existentes.

### Mensagens

- Mostrar a identificação real no lugar do rótulo genérico `Comprador`.
- Adicionar o ícone de link externo ao lado do título do produto, usando o mesmo gerador de URL da aba Perguntas.
- Em pedidos cancelados:
  - manter a conversa visível;
  - mostrar o status `Pedido cancelado`;
  - não mostrar `Aguardando resposta`;
  - não incluir a conversa no badge de pendências;
  - desabilitar textarea, sugestão por IA e envio.

O link externo deve abrir em nova aba, com `rel="noreferrer"` e nome acessível para leitores de tela.

## Regra de pendência

Uma conversa só aguarda resposta quando:

1. o pedido não está cancelado; e
2. a última mensagem cronológica foi recebida do comprador.

Essa mesma regra deve alimentar a lista e o contador do menu, evitando divergência visual.

## Envio e erros

- O servidor deve consultar o status atual da venda antes de chamar a API de mensagens.
- Pedido cancelado deve retornar um erro de domínio claro, sem chamar o Mercado Livre.
- Se houver cancelamento entre a checagem e o envio, o erro
  `blocked_by_cancelled_order` deve ser traduzido para uma mensagem amigável.
- As validações existentes de sessão, organização, pacote, comprador e limite de 350 caracteres permanecem.
- Não haverá retry: o bloqueio por cancelamento é definitivo.

## Testes e critérios de sucesso

- Teste do mapeamento/persistência do apelido da pergunta.
- Teste da composição dos metadados da conversa a partir da venda.
- Teste de conversa cancelada com última mensagem recebida resultar em `aguardando = false`.
- Teste do contador excluir conversas canceladas.
- Teste do servidor recusar pedido cancelado antes do envio externo.
- Teste da tradução de `blocked_by_cancelled_order`.
- Teste de interface ou helper verificando identificação e URL do anúncio.
- Typecheck e testes direcionados devem terminar com código de saída zero.
- Verificação visual deve confirmar nome, link e estado cancelado nas duas abas afetadas.

## Fora de escopo

- Alterar regras do Mercado Livre.
- Responder ou reabrir pedidos cancelados.
- Ocultar o histórico de conversas canceladas.
- Redesenhar os cards ou outras abas do Faturamento.
