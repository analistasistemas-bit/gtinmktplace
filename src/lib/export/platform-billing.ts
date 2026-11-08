import { fmtBRL } from '@/lib/formato';
import type { BillingStatement } from '@/lib/platform-admin';
import type { BlocoResumo, ReportData } from '@/lib/export/tipos';

function formatPercent(revenueBps: number | null): string {
  if (revenueBps === null) return 'Não definido';
  return `${(revenueBps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

function buildSnapshotBlocks(statement: BillingStatement): BlocoResumo[] {
  const terms = statement.terms;
  const sonarLine = statement.lines.find((line) => line.key === 'sonar');
  const blocks: BlocoResumo[] = [
    {
      titulo: 'Condições aplicadas',
      itens: [
        { label: 'Base de cobrança', valor: fmtBRL(statement.base_cents / 100) },
        {
          label: 'Percentual sobre receita',
          valor: formatPercent(statement.applied_bps ?? (statement.terms as { revenue_bps?: number } | null)?.revenue_bps ?? null),
        },
        { label: 'Consultas Sonar', valor: String(statement.sonar_units) },
        {
          label: 'Preço unitário Sonar',
          // Preço da linha (o praticado no mês); null = mudou no meio do mês. Sem linha, o do termo.
          valor: sonarLine
            ? (sonarLine.unit_cents === null ? 'variável no mês' : fmtBRL(sonarLine.unit_cents / 100))
            : terms ? fmtBRL(terms.sonar_unit_cents / 100) : 'Não definido',
        },
      ],
    },
  ];

  // Linha só existe com preço > 0 ou uso no mês; snapshot anterior à cobrança de imagem não a traz.
  const image = statement.lines.find((line) => line.key === 'image_ia');
  if (image) {
    blocks[0].itens.push(
      { label: 'Imagens IA', valor: String(image.quantity ?? 0) },
      // null = o preço mudou no meio do mês (emenda 2026-11-08 ao ADR-0155); o valor da linha segue exato.
      { label: 'Preço unitário imagem IA', valor: image.unit_cents === null ? 'variável no mês' : fmtBRL(image.unit_cents / 100) },
    );
  }

  if (statement.sources.length > 0) {
    blocks.push({
      titulo: 'Fontes conciliadas',
      itens: statement.sources.map((source) => ({
        label: source.sale_id,
        valor: [
          `Bruto ${fmtBRL(source.gross_cents / 100)}`,
          `Devolvido ${fmtBRL(source.refunded_product_cents / 100)}`,
          `Base ${fmtBRL(source.recognized_base_cents / 100)}`,
          source.source_updated_at,
        ].join(' · '),
      })),
    });
  }

  return blocks;
}

export function buildBillingReport(statement: BillingStatement): ReportData {
  return {
    titulo: `Demonstrativo Daludi · ${statement.org_name}`,
    periodo: statement.month,
    filtros: [
      `Fuso: ${statement.timezone}`,
      `Fechado em: ${statement.closed_at}`,
    ],
    kpis: [{ label: 'Total', valor: fmtBRL(statement.total_cents / 100) }],
    blocos: buildSnapshotBlocks(statement),
    colunas: [
      { chave: 'descricao', titulo: 'Componente' },
      { chave: 'valor', titulo: 'Valor', alinhamento: 'right' },
    ],
    linhas: statement.lines.map((line) => ({
      celulas: {
        descricao: line.label,
        valor: line.amount_cents / 100,
      },
    })),
  };
}
