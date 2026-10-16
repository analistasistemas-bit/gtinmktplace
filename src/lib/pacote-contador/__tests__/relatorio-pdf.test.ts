import { describe, it, expect } from 'vitest';
import { montarRelatorioPdf, gerarRelatorioPdf } from '../relatorio-pdf';
import { lerPacote } from '../ler';
import { nfe, zip } from './fixtures';

const CAB = { org: 'EMPRESA TESTE LTDA', cnpj: '11444777000161', contaMl: '98765', geradoEm: new Date('2026-10-16T12:00:00-03:00') };
const AG = new Date('2026-10-16T12:00:00-03:00');

describe('relatório PDF', () => {
  it('300 notas: várias páginas, cabeçalho, totais e Conferência', () => {
    const arquivos: Record<string, string> = {};
    for (let i = 1; i <= 300; i++) arquivos[`n${i}.xml`] = nfe({ n: i, dhEmi: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:00:00-03:00` });
    const doc = montarRelatorioPdf(lerPacote(zip(arquivos), '2026-09', AG), CAB);
    expect(doc.getNumberOfPages()).toBeGreaterThan(5);
    const texto = doc.output();
    expect(texto).toContain('Data de emiss');
    expect(texto).toContain('Vendas autorizadas');
    expect(texto).toContain('Confer');
  });
  it('parcial: selo, motivo, CNPJ e conta ML continuam na Conferência; bytes %PDF', () => {
    const l = lerPacote(zip({ 'quebrado.xml': '<x' }), '2026-09', AG);
    const texto = montarRelatorioPdf(l, CAB).output();
    expect(texto).toContain('PACOTE PARCIAL');
    expect(texto).toContain('11444777000161');
    expect(texto).toContain('98765');
    expect(texto).toContain('quebrado.xml');
    expect(new TextDecoder().decode(gerarRelatorioPdf(l, CAB).slice(0, 4))).toBe('%PDF');
  });
});
