import { callPlatformAdmin, type MonthlyReport, type PaymentProfile } from '@/lib/platform-admin';
import { pixPayload, pixQrDataUrl } from '@/lib/pix';

/** Busca o relatório do mês, os dados de recebimento e baixa o PDF (ADR-0193 D-1: só mês fechado). */
export async function baixarRelatorioMensal(orgId: string, month: string): Promise<void> {
  const [report, perfil] = await Promise.all([
    callPlatformAdmin<MonthlyReport>('monthly_report', { org_id: orgId, month }),
    callPlatformAdmin<PaymentProfile | null>('payment_profile', {}),
  ]);
  if (report.statement.status !== 'closed') throw new Error('Este mês não tem demonstrativo fechado.');
  const snapshot = report.statement.snapshot;
  const payload = perfil && snapshot.total_cents > 0
    ? pixPayload({ chave: perfil.pix_key, valorCents: snapshot.total_cents, nome: perfil.beneficiary_name, cidade: perfil.city, txid: snapshot.id })
    : null;
  const qrDataUrl = payload ? await pixQrDataUrl(payload) : null;
  const { gerarRelatorioMensalPdf } = await import('./pdf-relatorio-mensal');
  gerarRelatorioMensalPdf({ report, statementSnapshot: snapshot, paymentProfile: perfil, qrDataUrl, pixPayload: payload })
    .save(`relatorio-${report.org.slug}-${month}.pdf`);
}
