import { describe, expect, it } from 'vitest';
import { filtrarPublicados, type PublicadoItem } from '../publicados';

const item = (codigoPai: string, status: PublicadoItem['status'], titulo = 'Leite em Pó'): PublicadoItem => ({
  familiaId: codigoPai, codigoPai, gtin: null, titulo, fornecedor: 'F', tipo: 'outro', categoria: null,
  precoPublicacao: 10, precoPublicacaoMax: 10, descricao: null, mlItemId: `MLB${codigoPai}`, mlPermalink: null,
  publicadoEm: '2026-08-01', status,
});
const lista = [item('1', 'ativo'), item('2', 'encerrado'), item('3', 'pausado')];
const codigos = (r: PublicadoItem[]) => r.map((i) => i.codigoPai);

describe('filtrarPublicados — encerrados ocultos por padrão', () => {
  it('sem filtro de status e sem busca → esconde encerrado', () => {
    expect(codigos(filtrarPublicados(lista, {}))).toEqual(['1', '3']);
  });

  it('filtro Encerrado → mostra só encerrados', () => {
    expect(codigos(filtrarPublicados(lista, { status: 'encerrado' }))).toEqual(['2']);
  });

  it('com busca digitada → encerrado aparece (achar pelo código/pedido)', () => {
    expect(codigos(filtrarPublicados(lista, { busca: 'leite' }))).toEqual(['1', '2', '3']);
  });
});
