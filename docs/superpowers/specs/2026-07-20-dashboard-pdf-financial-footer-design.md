# Resumo financeiro na página geográfica do PDF

## Objetivo

Reorganizar somente a segunda página do PDF do Dashboard para priorizar o mapa
e apresentar as liberações como um resumo explícito do financeiro a receber.

## Restrição principal

O PDF permanece com exatamente duas páginas A4 paisagem. Nenhuma condição de
dados pode criar uma terceira página.

## Payload

`DashboardPdfVisual` receberá `totalAReceber: number`, preenchido com o mesmo
valor bruto usado no KPI `A receber` do Dashboard. O total não será derivado
das seis liberações visíveis, pois elas representam apenas uma lista limitada.

## Layout da página 2

Ordem vertical:

1. cabeçalho `Dashboard · Geografia`;
2. mapa do Brasil e ranking por UF, movidos para cima;
3. bloco inferior `Financeiro · Liberações próximas`;
4. rodapé da página.

O bloco financeiro exibirá no máximo seis datas e valores à esquerda. À direita,
uma área reservada mostrará:

- rótulo `Total a receber`;
- valor formatado em BRL e com destaque visual.

O estado vazio mantém a mensagem de ausência de liberações, mas continua
mostrando o total a receber.

## Validação

- teste prova que o payload recebe o total bruto correto;
- teste prova os textos `Financeiro · Liberações próximas` e
  `Total a receber`;
- teste confirma exatamente duas páginas com dados completos e vazios;
- as duas variações da página 2 serão renderizadas e inspecionadas;
- TypeScript, ESLint dirigido e testes do exportador devem passar.

## Fora de escopo

- alterar cálculos financeiros;
- alterar limites de seis liberações e cinco UFs;
- alterar a primeira página, outros formatos ou outras telas;
- adicionar dependências ou rasterização.
