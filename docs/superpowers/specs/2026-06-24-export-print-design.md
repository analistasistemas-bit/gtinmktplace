# Spec — Exportação (PDF / Excel / Imprimir) — PubliAI

**Data:** 2026-06-24
**Status:** Aprovado para implementação
**Telas-alvo:** Publicados, Faturamento (Vendas, Devoluções, Perguntas, Geografia), Financeiro (principal + Detalhe)

## Objetivo

Permitir exportar os dados das telas Publicados, Faturamento e Financeiro (e seus sublinks)
em **PDF** e **Excel (.xlsx)**, além de **Imprimir**. A impressão **nunca** usa `window.print()`
da tela: gera o mesmo PDF profissional e abre num visualizador limpo para o usuário imprimir.

Onde a tela tiver linhas expansíveis, o usuário escolhe **expandidas ou recolhidas**.
Onde a tela tiver KPIs + lista, o usuário escolhe **KPIs + dados** ou **somente dados**.

## Decisões

- **PDF:** `jsPDF` + `jspdf-autotable` (leve, programático, tabelas + cards de KPI).
- **Excel:** lib `xlsx` (v0.18.5, já instalada).
- **Imprimir:** gera o PDF (jsPDF) e abre o blob (`URL.createObjectURL`) em nova aba (visualizador
  de PDF do SO/navegador). Sem `window.print()` da DOM da aplicação.
- **Escopo de dados:** exporta o **estado atual da tela** — respeita filtros, ordenação e período
  aplicados. O cabeçalho do relatório registra período + filtros ativos para rastreabilidade.
- **CSV legado:** o export CSV do Financeiro/Detalhe (`lib/csv.ts`) é absorvido pelo novo botão
  unificado (Excel substitui o CSV). `lib/csv.ts` pode ser removido se não houver outro consumidor.

## Arquitetura

Módulo central agnóstico de tela em `src/lib/export/`:

### `lib/export/tipos.ts`
```ts
type ExportFormato = 'pdf' | 'excel' | 'imprimir';

interface ExportConfig {
  formato: ExportFormato;
  expandido: boolean;     // ignorado se a tela não tem expansão
  incluirKpis: boolean;   // ignorado se a tela não tem KPIs
}

interface Kpi { label: string; valor: string; }      // valor já formatado (texto)
interface Coluna { chave: string; titulo: string; alinhamento?: 'left' | 'right'; }
interface Celula { [chave: string]: string | number | null; }
interface Linha {
  celulas: Celula;
  sublinhas?: { colunas: Coluna[]; linhas: Celula[] };  // o conteúdo "expandido"
}

interface ReportData {
  titulo: string;          // "Faturamento · Vendas"
  periodo?: string;        // "01–30/06/2026"
  filtros?: string[];      // ["Status: ativo", "Fornecedor: X"]
  kpis?: Kpi[];            // preenchido só quando incluirKpis
  colunas: Coluna[];
  linhas: Linha[];
}
```

### `lib/export/pdf.ts`
`gerarPdf(data: ReportData): jsPDF` — monta:
1. Cabeçalho: título, período, filtros, data de emissão.
2. Bloco de KPIs em cards (se `data.kpis`).
3. Tabela principal via `autoTable`. Sublinhas (quando presentes) renderizadas como
   sub-tabela/linhas agrupadas e recuadas sob cada linha-pai.

### `lib/export/excel.ts`
`gerarExcel(data: ReportData): void` — gera workbook `xlsx`:
- Aba **"Resumo"**: título, período, filtros e KPIs (se houver).
- Aba **"Dados"**: tabela principal. Quando expandido, as sublinhas viram linhas extras
  indentadas logo abaixo da linha-pai (coluna marcadora para distinguir pai/filho).

### `lib/export/index.ts`
`exportar(data: ReportData, config: ExportConfig): void`
- `pdf` → `gerarPdf(data).save(nomeArquivo)`.
- `excel` → `gerarExcel(data)`.
- `imprimir` → `const blob = gerarPdf(data).output('blob'); window.open(URL.createObjectURL(blob))`.

Nome de arquivo: `<titulo-kebab>-<AAAA-MM-DD>.{pdf,xlsx}`.

### UI — `src/components/export/`
- `ExportButton.tsx`: botão "Exportar" (dropdown PDF · Excel · Imprimir) para o cabeçalho das telas.
- `ExportDialog.tsx`: ao escolher formato, abre diálogo que pergunta **condicionalmente**:
  - **Linhas:** Expandidas / Recolhidas — apenas se a tela passar `temExpansao`.
  - **Conteúdo:** KPIs + dados / Somente dados — apenas se a tela passar `temKpis`.
  - Sem nenhuma das duas → exporta direto (sem diálogo).
- Props: `{ titulo, temExpansao, temKpis, montarReport: (config) => ReportData }`.

### Adapters por tela (estado → ReportData)
Cada tela escreve uma função pura que recebe seu estado (dados filtrados/ordenados + config)
e devolve `ReportData`. Ficam junto da tela (ex. `src/lib/export/adapters/` ou colocados no
arquivo da página). Exemplos:
- `buildPublicadosReport(itens, kpis, filtros, config)`
- `buildVendasReport(pedidos, kpis, filtros, config)`
- `buildDevolucoesReport(...)`, `buildPerguntasReport(...)`, `buildGeografiaReport(...)`
- `buildFinanceiroReport(...)`, `buildFinanceiroDetalheReport(...)`

## Cobertura por tela

| Tela | Expandido inclui | Pergunta expandir? | Pergunta KPIs? |
|---|---|---|---|
| Publicados | resumo de viabilidade em campos (preço pub., custo, markup, concorrência nº/menor preço, faixa mercado) | ✅ | ✅ |
| Faturamento/Vendas | sub-itens do pedido (Item, Cor, Código, EAN, Qtd, Preço un., Custo, Líquido, Markup) | ✅ | ✅ |
| Faturamento/Devoluções | — | ❌ | ❌ |
| Faturamento/Perguntas | — | ❌ | ❌ |
| Faturamento/Geografia | — | ❌ | ✅ (top UFs/cidades) |
| Financeiro (principal) | — (exporta KPIs + série do gráfico como tabela) | ❌ | ✅ |
| Financeiro/Detalhe | — (migra do CSV p/ botão unificado) | ❌ | ✅ |

## Notas de implementação

- **Publicados expandido:** o resumo de viabilidade vem de `Familia` (não está no
  `PublicadoItem`). Ao exportar expandido, a página busca as famílias dos itens exibidos
  via `fetchFamiliaPublicada` (em paralelo) e calcula `resumoViabilidade()` — a mesma
  função pura agora usada pelo `PainelAnalise`, garantindo número idêntico ao da tela.
  O `montarReport` do `BotaoExportar` é assíncrono para suportar esse prefetch.
- **Geografia:** sem toggle de expansão; o relatório aninha as cidades sob cada UF como
  sublinhas (uma representação tabular única do que a tela mostra em duas tabelas).
- **Markup de viabilidade (Publicados):** markup bruto sobre o custo `(preço − custo) ÷ custo`
  — não usa o cálculo de líquido por taxas do ML do card "Você recebe".

## Testes

- **Adapters:** unitários com fixtures pequenas — estado → `ReportData` (colunas certas,
  sublinhas presentes só quando `expandido`, kpis só quando `incluirKpis`, filtros refletidos).
- **Geradores:** `gerarExcel` produz abas/linhas esperadas (inspecionar workbook em memória);
  `gerarPdf` chamado sem lançar e com as seções esperadas (mock/spy de `autoTable`).
- Sem render real de PDF nos testes.

## Não-objetivos (YAGNI)

- Sem agendamento/envio por e-mail de relatórios.
- Sem exportação server-side / Edge Function (tudo client-side).
- Sem personalização de colunas pelo usuário.
- Sem branding pesado/temas de PDF além do cabeçalho profissional padrão.
