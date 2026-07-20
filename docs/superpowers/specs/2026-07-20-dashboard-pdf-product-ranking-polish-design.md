# Ajustes visuais do PDF do Dashboard

## Objetivo

Corrigir dois problemas visuais observados no PDF do Dashboard sem alterar o
payload, a quantidade de páginas ou os demais formatos de exportação.

## Top produtos

Cada item mantém duas linhas:

- linha principal: posição e título à esquerda, faturamento alinhado à direita;
- linha auxiliar: quantidade de unidades abaixo do título.

O faturamento terá uma faixa reservada de largura fixa. O título será truncado
antes dessa faixa, impedindo colisão e mantendo todos os valores na mesma
coluna. Serão mantidos cinco produtos e o estado vazio atual.

## Ranking por UF

Mapa e barras usarão a mesma função de cor baseada em
`pedidos / maiorQuantidadeDePedidos`:

- maior volume usa o violeta mais forte;
- volumes menores usam tons proporcionalmente mais claros;
- o comprimento das barras continua proporcional ao volume.

A função cromática será local e reutilizada apenas pelo renderer geográfico,
sem nova dependência ou abstração genérica.

## Validação

- teste estrutural prova que títulos não invadem a faixa do faturamento;
- teste prova que UFs com volumes diferentes recebem cores diferentes e
  ordenadas por intensidade;
- PDFs representativo e vazio continuam com duas páginas A4 paisagem;
- as páginas afetadas serão renderizadas em PNG e inspecionadas visualmente;
- TypeScript, ESLint dirigido e testes do exportador devem passar.

## Fora de escopo

- alterar dados, métricas ou limites do relatório;
- modificar a tela do Dashboard;
- modificar Excel, CSV, impressão ou PDFs de outras telas;
- introduzir dependências ou rasterização.
