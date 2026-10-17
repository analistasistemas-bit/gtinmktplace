import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { gerarRelatorioInventarioXlsx, COLUNAS_LIVRO, COLUNAS_CONFERENCIA_INV } from '../relatorio-inventario-xlsx';
import { montarRelatorioInventarioPdf, gerarRelatorioInventarioPdf } from '../relatorio-inventario-pdf';
import { AVISOS_INVENTARIO, type ItemInventario, type LeituraInventario } from '../tipos-inventario';

type L = Array<string | number>;
const item = (o: Partial<ItemInventario> & { codigo: string }): ItemInventario => ({
  codigo_pai: 'P1', descricao: `Produto ${o.codigo}`, ncm: '61091000', unidade: 'UN', cor: 'Azul', tamanho: 'M',
  quantidade_sistema: 0, qtd_valorizada: 0, qtd_sem_nota: 0, custo_medio: null, valor_total: 0, marcas: [], ...o,
});
const CAB = { data_base: '2026-12-31', gerado_em: '2027-01-01T02:59:00Z', cnpj: '11222333000181', inscricao_estadual: '123456', razao_social: 'EMPRESA TESTE LTDA' };
const ITENS = [
  item({ codigo: 'A1', quantidade_sistema: 10, qtd_valorizada: 10, qtd_sem_nota: 0, custo_medio: 10, valor_total: 100,
    qtd_final: 7, qtd_valorizada_final: 7, qtd_sem_nota_final: 0, valor_final: 70, quantidade_contada: 7, justificativa: 'extravio' }),
  item({ codigo: 'B2', quantidade_sistema: 4, qtd_valorizada: 0, qtd_sem_nota: 4, quantidade_contada: 0, justificativa: 'perda total',
    qtd_final: 0, qtd_valorizada_final: 0, qtd_sem_nota_final: 0, valor_final: 0 }),
  item({ codigo: 'C3', quantidade_sistema: -2, marcas: ['saldo_negativo'] }),
  item({ codigo: 'D4', quantidade_sistema: 3, qtd_sem_nota: 3, marcas: ['historico_incompleto'], qtd_final: 3, qtd_sem_nota_final: 3, qtd_valorizada_final: 0, valor_final: 0 }),
  item({ codigo: 'E5', quantidade_sistema: 5, qtd_valorizada: 5, custo_medio: 2.5, valor_total: 12.5, ncm: null, marcas: ['ncm_ausente'],
    qtd_final: 5, qtd_valorizada_final: 5, qtd_sem_nota_final: 0, valor_final: 12.5 }),
];
const leitura = (status: 'hoje' | 'aberto' | 'confirmado', extra = {}): LeituraInventario =>
  ({ cabecalho: { ...CAB, status, ...extra }, itens: ITENS });
const abrir = (b: Uint8Array) => XLSX.read(b, { type: 'array', cellNF: true });
const tab = (wb: XLSX.WorkBook, nome: string) => XLSX.utils.sheet_to_json<L>(wb.Sheets[nome], { header: 1, raw: true });
const textos = (wb: XLSX.WorkBook) => wb.SheetNames.flatMap((n) => tab(wb, n)).flat().join(' | ');

const CONFIRMADO = leitura('confirmado', { confirmado_em: '2027-01-05T15:00:00Z', confirmado_por_nome: 'Maria Teste' });

describe('relatório de inventário (xlsx)', () => {
  it('Livro: cabeçalho exato, sem quantidade ≤ 0, valores *_final na foto confirmada, totais', () => {
    const wb = abrir(gerarRelatorioInventarioXlsx(CONFIRMADO));
    expect(wb.SheetNames).toEqual(['Livro', 'Conferência']);
    const rows = tab(wb, 'Livro');
    const i = rows.findIndex((r) => r[0] === 'Código');
    expect(rows[i]).toEqual(COLUNAS_LIVRO);
    const codigos = rows.slice(i + 1).map((r) => r[0]).filter((c) => ['A1', 'B2', 'C3', 'D4', 'E5'].includes(String(c)));
    expect(codigos).toEqual(['A1', 'D4', 'E5']);   // B2 (final 0) e C3 (−2) fora
    const a1 = rows[i + 1];
    expect(a1[6]).toBe(7);          // Quantidade = qtd_final, não 10
    expect(a1[9]).toBe(70);         // Valor total = valor_final
    expect(a1[8]).toBe(10);
    expect(rows.find((r) => r[0] === 'Valor total avaliado')?.[1]).toBe(82.5);
    expect(rows.find((r) => r[0] === 'Unidades avaliadas')?.[1]).toBe(12);
    expect(rows.find((r) => r[0] === 'Unidades sem nota de compra')?.[1]).toBe(3);
    const ws = wb.Sheets.Livro;
    expect(ws[XLSX.utils.encode_cell({ r: i + 1, c: 9 })].z).toBe('#,##0.00');
    expect(ws[XLSX.utils.encode_cell({ r: i + 1, c: 8 })].z).toBe('#,##0.000000');
    expect(ws[XLSX.utils.encode_cell({ r: i + 3, c: 2 })]?.t ?? 's').toBe('s');   // NCM como texto
  });
  it('foto aberta: Livro mostra a foto (10 / R$ 100,00) e a contagem 10 → 7 só na Conferência', () => {
    const wb = abrir(gerarRelatorioInventarioXlsx(leitura('aberto', { id: 'inv-1', versao: 2 })));
    const livro = tab(wb, 'Livro');
    const a1 = livro[livro.findIndex((r) => r[0] === 'Código') + 1];
    expect(a1.slice(0, 1).concat(a1[6], a1[7], a1[9])).toEqual(['A1', 10, 10, 100]);
    const conf = tab(wb, 'Conferência');
    expect(conf[0]).toEqual(COLUNAS_CONFERENCIA_INV);
    expect(conf.find((r) => r[0] === 'A1')).toEqual(['A1', 'Produto A1', 10, 7, -3, 'extravio', '']);
  });
  it('Conferência: divergência que termina em zero com justificativa e as 3 marcas', () => {
    const conf = tab(abrir(gerarRelatorioInventarioXlsx(CONFIRMADO)), 'Conferência');
    expect(conf.find((r) => r[0] === 'B2')).toEqual(['B2', 'Produto B2', 4, 0, -4, 'perda total', '']);
    expect(conf.find((r) => r[0] === 'C3')?.[6]).toBe('saldo_negativo');
    expect(conf.find((r) => r[0] === 'D4')?.[6]).toBe('historico_incompleto');
    expect(conf.find((r) => r[0] === 'E5')?.[6]).toBe('ncm_ausente');
  });
  it('avisos fixos, CNPJ e os 3 textos de status', () => {
    expect(AVISOS_INVENTARIO).toHaveLength(5);
    const hoje = textos(abrir(gerarRelatorioInventarioXlsx(leitura('hoje'))));
    for (const a of AVISOS_INVENTARIO) expect(hoje).toContain(a);
    expect(hoje).toContain('11222333000181');
    expect(hoje).toContain('Inventário de hoje — não é foto, não confirmado');
    expect(hoje).toContain('Saldo lido em');
    expect(textos(abrir(gerarRelatorioInventarioXlsx(leitura('aberto'))))).toContain('Foto de 31/12 — aguardando contagem');
    const conf = textos(abrir(gerarRelatorioInventarioXlsx(CONFIRMADO)));
    expect(conf).toMatch(/Confirmado em .+ por Maria Teste/);
  });
});

describe('relatório de inventário (PDF)', () => {
  it('colunas, totais, divergência, marcas, avisos, status e CNPJ', () => {
    const t = montarRelatorioInventarioPdf(CONFIRMADO).output();
    for (const s of [...COLUNAS_LIVRO.slice(0, 3), 'Qtd. avaliada', 'Conferência', 'perda total', 'saldo_negativo', 'historico_incompleto', 'ncm_ausente',
      'Totais', '11222333000181', 'por Maria Teste', ...AVISOS_INVENTARIO]) expect(t).toContain(s);
    for (const c of COLUNAS_LIVRO) expect(t).toContain(c);
    const vezes = (s: string) => t.split(s).length - 1;
    expect(vezes('Produto A1')).toBe(2);   // Livro + Conferência
    expect(vezes('Produto B2')).toBe(1);   // final 0: só na Conferência
    expect(vezes('Produto C3')).toBe(1);   // −2: só na Conferência
    // O travessão vai em WinAnsi no PDF: não depender do caractere Unicode no output().
    const hoje = montarRelatorioInventarioPdf(leitura('hoje')).output();
    expect(hoje).toContain('Inventário de hoje');
    expect(hoje).toContain('não é foto, não confirmado');
    const aberto = montarRelatorioInventarioPdf(leitura('aberto')).output();
    expect(aberto).toContain('Foto de 31/12');
    expect(aberto).toContain('aguardando contagem');
    expect(t).toMatch(/Confirmado em .+ por Maria Teste/);
  });
  it('foto aberta: Livro 10 / 100,00 e Conferência sistema 10 → contada 7', () => {
    const t = montarRelatorioInventarioPdf(leitura('aberto')).output();
    const cel = Array.from(t.matchAll(/\((.*)\) Tj/g), (m) => m[1]);   // uma entrada por célula, na ordem do PDF
    const seq = (...c: string[]) => cel.findIndex((_, i) => c.every((x, k) => cel[i + k] === x));
    expect(seq('A1', 'Produto A1', '61091000', 'UN', 'Azul', 'M', '10', '10', '10,000000', '100,00', '0')).toBeGreaterThanOrEqual(0);   // Livro
    expect(seq('A1', 'Produto A1', '10', '7', '-3', 'extravio')).toBeGreaterThanOrEqual(0);   // Conferência
    expect(t).not.toContain('70,00');
  });
  it('bytes começam com %PDF', () => {
    expect(new TextDecoder().decode(gerarRelatorioInventarioPdf(leitura('hoje')).slice(0, 4))).toBe('%PDF');
  });
});
