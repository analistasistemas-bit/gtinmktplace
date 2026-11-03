import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { gerarRelatorioMensalPdf, mesPorExtenso } from '../pdf-relatorio-mensal';
import { pixPayload, pixQrDataUrl } from '@/lib/pix';
import { kpisFixture, perfilFixture, relatorioFixture, snapshotFixture } from './relatorio-mensal-fixture';

function montar(
  o: Parameters<typeof relatorioFixture>[0] = {},
  snap = snapshotFixture(),
  perfil: ReturnType<typeof perfilFixture> | null = perfilFixture(),
  report = relatorioFixture(o),
) {
  const payload = perfil && snap.total_cents > 0
    ? pixPayload({ chave: perfil.pix_key, valorCents: snap.total_cents, nome: perfil.beneficiary_name, cidade: perfil.city, txid: 'T1' })
    : null;
  return { report, statementSnapshot: snap, paymentProfile: perfil, qrDataUrl: null as string | null, pixPayload: payload };
}
const pdfDe = (args: ReturnType<typeof montar>) => gerarRelatorioMensalPdf(args).output();

describe('mesPorExtenso', () => {
  it('escreve a competência', () => expect(mesPorExtenso('2026-10')).toBe('Outubro de 2026'));
});

describe('gerarRelatorioMensalPdf', () => {
  it('gera 3 páginas A4 retrato com 12 meses de evolução', () => {
    const doc = gerarRelatorioMensalPdf(montar());
    expect(doc.getNumberOfPages()).toBe(3);
    expect(doc.internal.pageSize.getWidth()).toBeLessThan(doc.internal.pageSize.getHeight());
    const pdf = doc.output();
    for (const t of ['Outubro de 2026', 'Evolução dos últimos meses', 'Principais produtos do mês', 'Top 5 = 65% do faturamento', 'Camiseta', 'Jaqueta', 'TOTAL A DEPOSITAR', 'LUCRO APÓS ADS']) expect(pdf).toContain(t);
    expect(pdf).toContain('Página 3/3');
  });

  it('limita a 5 produtos mesmo que o contrato traga mais', () => {
    const report = relatorioFixture();
    report.top_families!.rows = [...report.top_families!.rows, { ...report.top_families!.rows[0], key: 'P9', name: 'Produto Sexto' }];
    expect(pdfDe(montar({}, undefined, undefined, report))).not.toContain('Produto Sexto');
  });

  it('omite a evolução com 1 mês e lista sem-código / família desconhecida', () => {
    const pdf = pdfDe(montar({ meses: 1 }));
    expect(pdf).not.toContain('Evolução dos últimos meses');
    expect(pdf).toContain('sem código de produto');
    expect(pdf).toContain('Família desconhecida');
  });

  it('mostra o selo de atribuição em aberto e some quando final', () => {
    expect(pdfDe(montar())).toContain('Atribuição do ML em fechamento até 15/11');
    expect(pdfDe(montar({ atribuicaoAberta: false }))).not.toContain('Atribuição do ML em fechamento');
  });

  it('Ads indisponível: lucro antes de Ads rotulado e motivo', () => {
    const pdf = pdfDe(montar({ adsIndisponivel: true }));
    expect(pdf).toContain('LUCRO ANTES DE ADS');
    expect(pdf).toContain('Após Ads indisponível: dados de Ads indisponíveis');
    expect(pdf).toContain('Dados de Ads indisponíveis neste momento');
  });

  it('total <= 0: sem QR nem instruções de pagamento', () => {
    const pdf = pdfDe(montar({}, snapshotFixture({ total_cents: -5_000 })));
    expect(pdf).toContain('Sem valor a pagar nesta competência');
    expect(pdf).not.toContain('PIX COPIA E COLA');
    expect(pdf).not.toContain('TOTAL A DEPOSITAR');
  });

  it('sem dados de recebimento: aviso e sem QR', () => {
    const pdf = pdfDe(montar({}, undefined, null));
    expect(pdf).toContain('Dados de recebimento não cadastrados');
    expect(pdf).not.toContain('PIX COPIA E COLA');
  });

  it('exibe a diferença de reconciliação só quando existe', () => {
    expect(pdfDe(montar())).toContain('Diferença para o faturamento da loja das páginas anteriores: R$ 610,00');
    const report = relatorioFixture();
    report.summary.current = kpisFixture({ gross_cents: 18_513_390 });
    expect(pdfDe(montar({}, undefined, undefined, report))).not.toContain('Diferença para o faturamento');
  });

  it('vencimento usa due_day do snapshot, padrão 5', () => {
    expect(pdfDe(montar())).toContain('05/11/2026');
    expect(pdfDe(montar({}, snapshotFixture({ due_day: 12 })))).toContain('12/11/2026');
    expect(pdfDe(montar({}, snapshotFixture({ due_day: undefined })))).toContain('05/11/2026');
  });

  it('sem mês anterior não inventa variação', () => {
    expect(pdfDe(montar({ semAnterior: true }))).not.toContain('vs mês anterior');
  });

  it('opcional (RELATORIO_PDF_DIR): grava PDFs para revisão visual', async () => {
    const dir = process.env.RELATORIO_PDF_DIR;
    if (!dir) return;
    const cenarios: Array<[string, ReturnType<typeof montar>]> = [
      ['a-completo-12m', montar()],
      ['b-1mes-ads-indisponivel', montar({ meses: 1, semAnterior: true, adsIndisponivel: true })],
      ['c-total-zero', montar({}, snapshotFixture({ total_cents: -20_000 }))],
      ['d-parcial', (() => { const r = relatorioFixture({ meses: 3 }); r.summary.current = kpisFixture({ profit_partial: true, excluded_items: 41, covered_gross_cents: 15_100_000, profit_coverage: 0.82, profit_after_ads_cents: null, margin_after_ads: null, markup_after_ads: null, unavailable_reason: 'lucro_parcial' }); r.ads!.coverage = 'partial'; r.ads!.days_covered = 20; return montar({}, undefined, undefined, r); })()],
    ];
    for (const [nome, args] of cenarios) {
      if (args.pixPayload) args.qrDataUrl = await pixQrDataUrl(args.pixPayload);
      writeFileSync(`${dir}/${nome}.pdf`, Buffer.from(gerarRelatorioMensalPdf(args).output('arraybuffer')));
    }
  });
});
