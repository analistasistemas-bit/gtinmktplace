import { describe, expect, it } from 'vitest';
import { filtrarPublicados, type PublicadoItem } from '../publicados';

function item(over: Partial<PublicadoItem> = {}): PublicadoItem {
  return {
    familiaId: 'fam-1',
    codigoPai: '00001',
    gtin: '7891234567890',
    titulo: 'Botão de Pressão Inox',
    fornecedor: 'Metalúrgica São Paulo',
    tipo: 'outro',
    categoria: 'Botões',
    precoPublicacao: 19.9,
    precoPublicacaoMax: 19.9,
    descricao: null,
    mlItemId: 'MLB123',
    mlPermalink: null,
    publicadoEm: '2026-08-01',
    status: 'ativo',
    ...over,
  };
}

describe('filtrarPublicados — busca com acentos', () => {
  it('encontra produto com acento pesquisando sem acento', () => {
    const lista = [item({ titulo: 'Linha de Costura Poliéster' })];
    const r = filtrarPublicados(lista, { busca: 'poliester' });
    expect(r).toHaveLength(1);
  });

  it('encontra produto sem acento pesquisando com acento', () => {
    const lista = [item({ titulo: 'Linha de Costura Poliester' })];
    const r = filtrarPublicados(lista, { busca: 'poliéster' });
    expect(r).toHaveLength(1);
  });

  it('encontra fornecedor com acento pesquisando sem acento', () => {
    const lista = [item({ fornecedor: 'Metalúrgica São Paulo' })];
    const r = filtrarPublicados(lista, { busca: 'sao paulo' });
    expect(r).toHaveLength(1);
  });

  it('encontra múltiplos termos misturando acentos', () => {
    const lista = [item({ titulo: 'Botão de Pressão', fornecedor: 'São Paulo' })];
    const r = filtrarPublicados(lista, { busca: 'botao sao' });
    expect(r).toHaveLength(1);
  });
});
