// Spec 2026-11-16-reposicao §3.5: texto do pedido para o WhatsApp, agrupado por produto e cor em grade.
import { describe, expect, it } from 'vitest';
import { textoWhatsApp } from '../texto-whatsapp';
import type { FamiliaTela, PedidoDTO, PedidoItemDTO, SkuTela } from '../../../../supabase/functions/_shared/reposicao/tipos';

const sku = (codigo: string, codigoPai: string, cor: string | null, tamanho: string | null): SkuTela =>
  ({ codigo, codigoPai, cor, corHex: null, tamanho, custo: 10, preco: 50, naoReporId: null });
const item = (codigo: string, codigoPai: string, quantidade: number, codigoFornecedor: string | null = null): PedidoItemDTO =>
  ({ codigo, codigoPai, quantidade, sugerida: quantidade, recebida: 0, encerrado: false, codigoFornecedor });

const skus = [
  sku('A42', 'CALCA', 'Marrom Escuro', '42'), sku('A38', 'CALCA', 'Marrom Escuro', '38'), sku('A40', 'CALCA', 'Marrom Escuro', '40'),
  sku('B40', 'CALCA', 'Cáqui', '40'), sku('CI', 'CINTO', null, null), sku('SG', 'SHORT', 'Preto', 'G'), sku('SP', 'SHORT', 'Preto', 'P'),
];
const familias: FamiliaTela[] = [
  { codigoPai: 'CALCA', nome: 'Calça Sarja', fornecedor: { id: 'f1', nome: 'Fornecedor A' }, multiplo: 1 },
  { codigoPai: 'CINTO', nome: 'Cinto Couro', fornecedor: { id: 'f1', nome: 'Fornecedor A' }, multiplo: 1 },
  { codigoPai: 'SHORT', nome: 'Short Bermuda', fornecedor: { id: 'f1', nome: 'Fornecedor A' }, multiplo: 1 },
];
const pedido = (itens: PedidoItemDTO[]): PedidoDTO => ({
  id: 'p1', fornecedor: { id: 'f1', nome: 'Fornecedor A', cnpj: null }, status: 'aprovado', previstoPara: '2026-12-01', atrasado: false,
  salvoPor: null, salvoEm: null, aprovadoPor: 'Diego', enviadoEm: null, alteradoPor: null, alteradoEm: null, itens,
});

describe('textoWhatsApp', () => {
  it('nome do produto uma vez; uma linha por cor com os tamanhos na ordem da grade', () => {
    const t = textoWhatsApp(pedido([item('A42', 'CALCA', 6), item('A38', 'CALCA', 2), item('A40', 'CALCA', 1)]), skus, familias);
    expect(t).toContain('Calça Sarja\nMarrom Escuro: 38×2 · 40×1 · 42×6');
  });

  it('cabeçalho com fornecedor e data, cores A→Z, produto sem grade e total', () => {
    const t = textoWhatsApp(pedido([
      item('SG', 'SHORT', 3), item('SP', 'SHORT', 4), item('A40', 'CALCA', 1), item('B40', 'CALCA', 5), item('CI', 'CINTO', 2),
    ]), skus, familias);
    expect(t.split('\n')).toEqual([
      'Pedido de compra · Fornecedor A',
      'Entrega prevista: 01/12/2026',
      '',
      'Calça Sarja',
      'Cáqui: 40×5',
      'Marrom Escuro: 40×1',
      '',
      'Cinto Couro: 2',
      '',
      'Short Bermuda',
      'Preto: P×4 · G×3',
      '',
      'Total: 15 unidades',
    ]);
  });

  it('agrupa por produto (codigoPai), não pelo nome: duas famílias de mesmo nome ficam separadas', () => {
    const fams = [...familias, { codigoPai: 'CALCA2', nome: 'Calça Sarja', fornecedor: { id: 'f1', nome: 'Fornecedor A' }, multiplo: 1 }];
    const t = textoWhatsApp(pedido([item('A38', 'CALCA', 2, 'RS-1'), item('Z38', 'CALCA2', 5, 'RS-2')]),
      [...skus, sku('Z38', 'CALCA2', 'Marrom Escuro', '38')], fams);
    expect(t).toContain('Calça Sarja (cód. RS-1)\nMarrom Escuro: 38×2');
    expect(t).toContain('Calça Sarja (cód. RS-2)\nMarrom Escuro: 38×5');
  });

  it('inclui o código do fornecedor quando houver', () => {
    const t = textoWhatsApp(pedido([item('A38', 'CALCA', 2, 'RS-169')]), skus, familias);
    expect(t).toContain('Calça Sarja (cód. RS-169)\nMarrom Escuro: 38×2');
  });

  it('produto com tamanho e sem cor: tudo na linha do produto', () => {
    const t = textoWhatsApp(pedido([item('M', 'MEIA', 2), item('G', 'MEIA', 1)]),
      [sku('M', 'MEIA', null, 'M'), sku('G', 'MEIA', null, 'G')],
      [{ codigoPai: 'MEIA', nome: 'Meia', fornecedor: { id: 'f1', nome: 'Fornecedor A' }, multiplo: 1 }]);
    expect(t).toContain('\nMeia: M×2 · G×1\n');
  });
});
