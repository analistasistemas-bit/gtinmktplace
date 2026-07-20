# PDF visual do Dashboard

**Data:** 2026-07-20

## Objetivo

Substituir o PDF tabular genérico do Dashboard por um relatório visual em tema
claro que preserve a hierarquia e a experiência da tela: cards, gráfico,
produtos, liberações e geografia. O PDF terá duas páginas A4 em orientação
paisagem para manter legibilidade.

## Causa raiz

O Dashboard atualmente é convertido para `ReportData`, um contrato genérico
limitado a KPIs, listas e tabela. `src/lib/export/pdf.ts` renderiza esse contrato
com cards cinza, blocos textuais e `jspdf-autotable`. O contrato não representa
o gráfico, o mapa, as liberações ou a hierarquia dos dois cards principais.

Os dados exportados estão corretos; a perda visual ocorre na representação e no
renderer genéricos. Alterar apenas cores e espaçamentos do renderer existente
não resolveria a ausência dos elementos visuais e ainda afetaria Faturamento,
Financeiro e outras telas.

## Abordagem escolhida

Criar um renderer de PDF dedicado ao Dashboard usando o `jsPDF` já instalado.
O dispatcher de exportação selecionará esse renderer apenas quando receber os
dados visuais do Dashboard. O renderer genérico continuará inalterado para os
demais relatórios.

O documento será desenhado com primitivas vetoriais do `jsPDF`: texto, cards,
linhas, áreas, barras e geometria do mapa. Não haverá captura raster da tela nem
nova dependência.

## Contrato de dados

O adaptador do Dashboard continuará preenchendo os campos genéricos usados por
Excel, CSV e impressão e adicionará uma carga visual exclusiva do PDF contendo:

- período, canal e data de referência;
- dois KPIs principais e seis KPIs secundários;
- alertas ativos com rótulo;
- série temporal de faturamento, líquido e pedidos;
- top produtos com posição, unidades e faturamento;
- próximas liberações com data e valor;
- agregação geográfica por UF, incluindo pedidos e participação;
- quantidade de pedidos sem localização.

O Dashboard fornecerá apenas valores que já calcula ou carrega. A exportação não
criará consulta, polling ou estado de negócio adicional.

## Layout

### Página 1 - Visão executiva

- Cabeçalho com título, período, canal e data de emissão.
- Dois cards principais em destaque: Faturamento bruto e Líquido das vendas.
- Grade com seis cards: Líquido no faturamento, Markup no período,
  Compradores, Pedidos, Ticket médio e A receber.
- Faixa "Precisa de atenção" somente quando houver ocorrências.
- Card de evolução das vendas com linha/área, eixos e legenda.
- Card de Top produtos com ranking, título truncado de forma legível, unidades e
  faturamento.

### Página 2 - Operação e geografia

- Cabeçalho compacto que mantém período e canal.
- Card de Liberações próximas; quando vazio, mensagem explícita.
- Card de Vendas por estado ocupando a maior área.
- Mapa do Brasil em tema claro, reaproveitando a geometria de UFs existente.
- Escala de intensidade e ranking lateral com barras, pedidos e percentuais.
- Rodapé com "Página 2 de 2", período e data de emissão.

## Sistema visual

- Fundo branco e superfícies em cinza muito claro.
- Azul-violeta da marca nos destaques, gráfico, mapa e cabeçalhos.
- Verde apenas para valores financeiros positivos.
- Amarelo/âmbar para a faixa de atenção.
- Texto principal quase preto e texto secundário cinza com contraste legível.
- Cantos, espaçamentos e proporções equivalentes aos cards do Dashboard.
- Texto permanece selecionável; gráfico, barras e mapa permanecem vetoriais.

## Paginação e estados limites

- Formato fixo: A4 paisagem, exatamente duas páginas.
- Rótulos longos de produtos serão truncados com reticências, sem sobreposição.
- Séries vazias exibem "Sem vendas no período".
- Liberações vazias exibem "Nada a liberar no horizonte".
- Geografia vazia exibe "Sem vendas com destino no período".
- Uma série com um único ponto recebe escala segura e marcador visível.
- Valores negativos ou nulos não quebram a escala do gráfico.
- Conteúdo nunca deve ultrapassar margens, rodapé ou limites dos cards.

## Escopo

### Incluído

- PDF visual exclusivo do Dashboard.
- Dados necessários para alertas e liberações já presentes na página.
- Reuso da geometria do mapa por código compartilhado quando necessário.
- Testes de seleção do renderer, layout lógico e estados vazios.
- Geração e inspeção visual das duas páginas renderizadas em PNG.

### Não incluído

- Mudanças visuais no Dashboard web.
- Mudanças no PDF de Faturamento, Financeiro ou outras telas.
- Mudanças em Excel, CSV ou impressão.
- Novos filtros, métricas ou consultas.
- Reprodução pixel a pixel do tema escuro.

## Tratamento de erros

- Se os dados visuais do Dashboard estiverem ausentes, o fluxo mantém o renderer
  genérico em vez de falhar.
- Valores e coleções opcionais produzem estados vazios explícitos.
- A exportação continua usando o tratamento de erro e feedback do
  `BotaoExportar`.

## Validação e critérios de aceite

- O botão PDF do Dashboard gera exatamente duas páginas A4 paisagem.
- Página 1 contém cabeçalho, oito KPIs, atenção quando aplicável, evolução e top
  produtos.
- Página 2 contém liberações, mapa e ranking geográfico.
- O período e o canal ativos aparecem no documento.
- O mapa e o gráfico são vetoriais e permanecem nítidos.
- PDF das demais telas continua usando o renderer genérico sem alteração visual.
- Excel, CSV e impressão do Dashboard mantêm o comportamento atual.
- Testes direcionados, TypeScript e lint passam.
- O PDF de referência é renderizado em PNG com Poppler e a inspeção visual não
  encontra cortes, sobreposições, texto ilegível ou páginas extras.

## Alternativas rejeitadas

1. **Captura da tela como imagem:** aproxima o visual rapidamente, mas perde
   texto selecionável, nitidez e paginação confiável.
2. **Página HTML de impressão:** permite layout rico, porém muda o download para
   um diálogo dependente do navegador.
3. **Modificar o renderer genérico:** não representa gráfico/mapa e criaria
   regressão visual nas outras telas.
