# Exportação do Dashboard

## Design aprovado

Adicionar ao cabeçalho do Dashboard o mesmo fluxo de exportação disponível em
Faturamento. O relatório representa o próprio Dashboard, respeita período e
canal ativos e usa somente os dados já carregados. Inclui KPIs, evolução das
vendas, top produtos e distribuição geográfica nas modalidades PDF, Excel, CSV
e impressão.

## Restrições globais

- Correctness.
- Smallest scope.
- Smallest working diff.
- Lowest context usage.
- Lowest maintenance cost.
- Reuse beats rewriting.
- No unnecessary dependencies.
- No unrelated refactors or formatting.
- Run the smallest validation that proves the change.
- Preserve accessibility basics.
- Development happens in the isolated branch `feat/dashboard-export`.

## Estrutura de arquivos

- Modificar `src/lib/export/adapters.ts`: montar `ReportData` puro para o
  Dashboard, reutilizando tipos, formatadores e estrutura de relatório atuais.
- Modificar `tests/lib/export/adapters.test.ts`: provar conteúdo, filtros,
  ausência opcional de KPIs e comportamento com coleções vazias.
- Modificar `src/pages/Dashboard.tsx`: ligar o adaptador aos dados e filtros já
  calculados e renderizar `BotaoExportar` no cabeçalho.
- Modificar `tests/pages/Dashboard.test.tsx`: provar que a ação Exportar fica
  disponível no Dashboard.
- Adicionar `src/lib/export/csv.ts` e modificar `src/lib/export/index.ts` e
  `src/lib/export/tipos.ts`: serializar a tabela principal conforme RFC 4180,
  baixar com BOM UTF-8 e extensão `.csv`, e registrar o formato no fluxo
  compartilhado.
- Modificar `src/components/export/botao-exportar.tsx`: oferecer CSV no mesmo
  menu de PDF, Excel e impressão.
- Modificar `tests/lib/export/export.test.ts` e
  `tests/components/botao-exportar.test.tsx`: provar serialização, download e
  encaminhamento do formato CSV.

## Tarefa 1 — Relatório e ação de exportação do Dashboard

**Responsável:** executor Terra, por envolver contrato de dados, integração de
UI e cobertura de regressão.

**Dependências:** nenhuma mudança anterior; reutilizar `BotaoExportar`,
`ReportData`, `ExportConfig`, `rotuloPeriodo`, `fmtBRL`, `fmtInt`,
`fmtMarkup`, `infoCanal` e os agregados já calculados em `Dashboard.tsx`.

**Interface produzida em `src/lib/export/adapters.ts`:**

```ts
interface DashboardReportArgs {
  resumo: ResumoVendas;
  kpisPedidos: KpisPedidos;
  serie: PontoSerie[];
  top: ProdutoTop[];
  geografia: GeografiaVendas;
  periodo: Periodo;
  canal: CanalAtivo;
  config: ExportConfig;
}

export function buildDashboardReport(args: DashboardReportArgs): ReportData;
```

O retorno terá:

- `titulo: "Dashboard"`;
- `periodo` produzido por `rotuloPeriodo`;
- filtro `Canal: Todos` ou o nome retornado por `infoCanal`;
- KPIs, quando `config.incluirKpis` for verdadeiro: Faturamento bruto, Líquido
  das vendas, Líquido no faturamento, Markup no período, Compradores, Pedidos,
  Ticket médio e A receber;
- tabela de evolução com colunas Período, Faturamento, Líquido e Pedidos;
- bloco Top produtos do período com valor e unidades;
- bloco Distribuição geográfica com pedidos e participação das UFs;
- arrays vazios válidos quando não houver série, produtos ou geografia.

**Ciclo de teste:**

1. Acrescentar em `tests/lib/export/adapters.test.ts` um teste que chama
   `buildDashboardReport` com valores distintos e afirma título, período,
   canal legível, valores exatos dos oito KPIs, linha da evolução, primeiro
   produto e primeira UF. Executar
   `rtk pnpm vitest run tests/lib/export/adapters.test.ts`; o teste deve falhar
   porque a função ainda não existe.
2. Acrescentar um teste com `incluirKpis: false`, top e geografia preenchidos,
   afirmando `kpis === undefined`, zero linhas e `blocos === undefined`.
3. Implementar a função pura em `src/lib/export/adapters.ts` com o contrato
   acima, sem I/O e sem nova dependência. Executar novamente
   `rtk pnpm vitest run tests/lib/export/adapters.test.ts`; todos os testes
   desse arquivo devem passar.
4. Em `tests/pages/Dashboard.test.tsx`, simular
   `@/components/export/botao-exportar` com um botão nativo rotulado
   `Exportar` e acrescentar um teste que renderiza o Dashboard e encontra esse
   botão por role e nome. Executar
   `rtk pnpm vitest run tests/pages/Dashboard.test.tsx`; o novo teste deve
   falhar antes da integração.
5. Em `src/pages/Dashboard.tsx`, importar `BotaoExportar` e
   `buildDashboardReport`; adicioná-lo às ações do `PageHeader`, antes de
   `Novo lote`, com `temKpis`. A função `montarReport` passará `r`,
   `kpisPedidos`, `serie`, `top`, `geoUf`, `periodo`, `canalAtivo` e `config`
   diretamente ao adaptador. Não criar consulta, estado ou componente novo na
   página.
6. Estender a infraestrutura compartilhada com CSV usando apenas APIs nativas
   do navegador: tabela principal, escape RFC 4180, CRLF, BOM UTF-8 e download
   `.csv`; provar a opção e o encaminhamento no `BotaoExportar`.
7. Executar
   `rtk pnpm vitest run tests/lib/export/adapters.test.ts tests/lib/export/export.test.ts tests/components/botao-exportar.test.tsx tests/pages/Dashboard.test.tsx`;
   todos os testes direcionados devem passar.
8. Executar `rtk tsc -b --pretty false`; resultado esperado: zero erros.
9. Executar
   `rtk pnpm exec eslint src/pages/Dashboard.tsx src/lib/export/adapters.ts src/lib/export/csv.ts src/lib/export/index.ts src/lib/export/tipos.ts src/components/export/botao-exportar.tsx tests/pages/Dashboard.test.tsx tests/lib/export/adapters.test.ts tests/lib/export/export.test.ts tests/components/botao-exportar.test.tsx`;
   resultado esperado: zero erros.
10. Confirmar por inspeção que o controle permanece um botão nativo, com nome
   acessível visível, operação por teclado fornecida pelo componente existente
   e sem perda de foco no diálogo.
11. Criar commits separados para a implementação inicial e as correções
    pós-review, sempre incluindo código, testes e atualização deste plano.

## Auto-revisão do plano

- Cobertura do design: botão no cabeçalho, período, canal, KPIs, evolução, top
  produtos, geografia e quatro formatos estão cobertos pela Tarefa 1. Os
  formatos são fornecidos pelo `BotaoExportar`; CSV amplia a infraestrutura
  compartilhada sem caso especial do Dashboard.
- Lacunas encontradas e corrigidas: o canal inicialmente não tinha regra de
  apresentação; foi definida a resolução por `infoCanal`, com `Todos` para o
  agregado.
- Varredura de marcadores incompletos: nenhum marcador pendente.
- Consistência de tipos: todos os argumentos são tipos existentes; a página já
  possui cada valor solicitado e `BotaoExportar.montarReport` aceita retorno
  síncrono `ReportData`.
- Estado testável e commitável: a tarefa termina com testes direcionados,
  typecheck, lint direcionado, inspeção de acessibilidade e commits revisáveis.
