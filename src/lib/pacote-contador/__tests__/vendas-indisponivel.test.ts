import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { lerPacoteIndisponivel, lerPacoteVazio } from '../ler';
import { gerarRelatorioXlsx } from '../relatorio-xlsx';
import { montarRelatorioPdf } from '../relatorio-pdf';
import { falhaVendas, ErroPacote, ErroOrgMudou, ErroAuditoria, ErroRede } from '../baixar';
import { ErroDownloadIncompleto } from '../tipos';

const CAB = { org: 'EMPRESA TESTE LTDA', cnpj: null, contaMl: '', geradoEm: new Date('2026-11-02T12:00:00-03:00') };
const MOT = 'O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5).';
const MSG = `Vendas indisponíveis: ${MOT} — gere o pacote de novo depois.`;

describe('vendas indisponíveis', () => {
  it('estado distinto de vazio, PARCIAL, sem totais nem cabeçalho de notas', () => {
    const l = lerPacoteIndisponivel('2026-10', MOT);
    expect(l.conferencia).toMatchObject({ vazio: false, parcial: true, indisponivel: MSG, motivosParcial: ['vendas indisponíveis'] });
    expect(lerPacoteVazio('2026-10').conferencia.indisponivel).toBeNull();
    const wb = XLSX.read(gerarRelatorioXlsx(l, CAB), { type: 'array' });
    const vendas = XLSX.utils.sheet_to_json<Array<string | number>>(wb.Sheets.Vendas, { header: 1 }).flat().join(' | ');
    expect(vendas).toContain(MSG);
    expect(vendas).not.toContain('Vendas autorizadas');
    expect(vendas).not.toContain('Data de emissão');
    expect(XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Conferência'], { header: 1 }).flat().join(' ')).toContain(MSG);
    const pdf = montarRelatorioPdf(l, CAB).output();
    expect(pdf).toContain('Vendas indispon');
    expect(pdf).not.toContain('Vendas autorizadas');
  });
});

describe('falhaVendas', () => {
  const tipo = (e: unknown, s = false) => falhaVendas(e, s).tipo;
  it('classifica', () => {
    for (const st of [429, 409, 502, 503, 504, 200]) expect(tipo(new ErroPacote('x', st))).toBe('indisponivel');
    expect(tipo(new ErroDownloadIncompleto())).toBe('indisponivel');
    expect(falhaVendas(new ErroRede(), false)).toEqual({ tipo: 'indisponivel', motivo: 'falha de rede ao falar com o servidor' });
    for (const e of [new ErroPacote('x', 401), new ErroPacote('x', 403), new ErroOrgMudou(), new ErroAuditoria('a'),
      new DOMException('c', 'AbortError'), new Error('bug'), new TypeError("Cannot read properties of undefined (reading 'x')")]) {
      expect(tipo(e)).toBe('fatal');
    }
    expect(tipo(new ErroPacote('x', 429), true)).toBe('fatal');   // suporte: sem fallback
  });
});
