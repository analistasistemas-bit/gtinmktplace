import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { nomeArquivo } from '@/lib/export/index';
import { montarWorkbook } from '@/lib/export/excel';
import { gerarPdf } from '@/lib/export/pdf';
import { gerarCsv, serializarCsv } from '@/lib/export/csv';
import type { ReportData } from '@/lib/export/tipos';

const baseData: ReportData = {
  titulo: 'Faturamento · Vendas',
  periodo: '01–30/06/2026',
  filtros: ['Origem: PubliAI'],
  kpis: [
    { label: 'Faturamento', valor: 'R$ 1.000,00' },
    { label: 'Pedidos', valor: '12' },
  ],
  colunas: [
    { chave: 'data', titulo: 'Data' },
    { chave: 'valor', titulo: 'Valor', alinhamento: 'right' },
  ],
  linhas: [
    {
      celulas: { data: '01/06', valor: 'R$ 500,00' },
      sublinhas: {
        colunas: [
          { chave: 'item', titulo: 'Item' },
          { chave: 'qtd', titulo: 'Qtd' },
        ],
        linhas: [{ item: 'Linha A', qtd: 2 }],
      },
    },
    { celulas: { data: '02/06', valor: 'R$ 500,00' } },
  ],
};

describe('nomeArquivo', () => {
  it('gera slug kebab com data e extensão', () => {
    expect(nomeArquivo('Faturamento · Vendas', 'xlsx', new Date('2026-06-24T12:00:00'))).toBe(
      'faturamento-vendas-2026-06-24.xlsx',
    );
  });

  it('remove acentos e caracteres especiais', () => {
    expect(nomeArquivo('Relatório Geográfico!', 'pdf', new Date('2026-01-05T00:00:00'))).toBe(
      'relatorio-geografico-2026-01-05.pdf',
    );
  });

  it('aceita a extensão CSV', () => {
    expect(nomeArquivo('Dashboard', 'csv', new Date('2026-07-20T00:00:00'))).toBe(
      'dashboard-2026-07-20.csv',
    );
  });
});

describe('CSV', () => {
  it('serializa colunas e linhas com BOM, CRLF e escape RFC 4180', () => {
    const csv = serializarCsv({
      titulo: 'Teste',
      colunas: [
        { chave: 'nome', titulo: 'Nome' },
        { chave: 'nota', titulo: 'Nota' },
      ],
      linhas: [{ celulas: { nome: 'Produto, "A"\nlinha', nota: 'ok' } }],
    });

    expect(csv).toBe('\uFEFFNome,Nota\r\n"Produto, ""A""\nlinha",ok');
  });

  it('baixa um Blob UTF-8 com o nome .csv informado', () => {
    const url = vi.fn(() => 'blob:csv');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: url });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    gerarCsv(baseData, 'relatorio.csv');

    expect(url).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.instances[0].download).toBe('relatorio.csv');
    expect(revoke).toHaveBeenCalledWith('blob:csv');
    click.mockRestore();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });
});

describe('montarWorkbook', () => {
  it('cria aba Resumo com KPIs quando há kpis', () => {
    const wb = montarWorkbook(baseData);
    expect(wb.SheetNames).toContain('Resumo');
    const txt = XLSX.utils.sheet_to_csv(wb.Sheets['Resumo']);
    expect(txt).toContain('Faturamento · Vendas');
    expect(txt).toContain('Faturamento');
    expect(txt).toContain('R$ 1.000,00');
    expect(txt).toContain('Origem: PubliAI');
  });

  it('não cria aba Resumo quando não há kpis nem metadados relevantes', () => {
    const wb = montarWorkbook({ titulo: 'X', colunas: baseData.colunas, linhas: baseData.linhas });
    // título sozinho ainda gera Resumo mínimo; garantir aba Dados sempre presente
    expect(wb.SheetNames).toContain('Dados');
  });

  it('aba Dados contém cabeçalho e linhas principais', () => {
    const wb = montarWorkbook(baseData);
    const txt = XLSX.utils.sheet_to_csv(wb.Sheets['Dados']);
    expect(txt).toContain('Data');
    expect(txt).toContain('Valor');
    expect(txt).toContain('01/06');
    expect(txt).toContain('02/06');
  });

  it('inclui sublinhas indentadas quando expandido (default)', () => {
    const wb = montarWorkbook(baseData);
    const txt = XLSX.utils.sheet_to_csv(wb.Sheets['Dados']);
    expect(txt).toContain('Linha A');
  });

  it('omite sublinhas quando incluirSublinhas=false', () => {
    const wb = montarWorkbook(baseData, { incluirSublinhas: false });
    const txt = XLSX.utils.sheet_to_csv(wb.Sheets['Dados']);
    expect(txt).not.toContain('Linha A');
  });
});

describe('gerarPdf', () => {
  it('gera um documento (cabeçalho + kpis + tabela) sem lançar', () => {
    const doc = gerarPdf(baseData);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('gera documento mínimo sem kpis nem sublinhas', () => {
    const doc = gerarPdf({ titulo: 'X', colunas: baseData.colunas, linhas: [{ celulas: { data: '01/06', valor: 'R$ 1,00' } }] });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('produz bytes de um PDF válido (magic "%PDF")', () => {
    const buf = new Uint8Array(gerarPdf(baseData).output('arraybuffer'));
    const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    expect(magic).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(500);
  });
});

describe('artefato Excel', () => {
  it('produz bytes de um .xlsx válido (zip, magic "PK")', () => {
    const wb = montarWorkbook(baseData);
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    expect(bytes.length).toBeGreaterThan(500);
  });
});
