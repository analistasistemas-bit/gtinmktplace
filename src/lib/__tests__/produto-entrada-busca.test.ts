import { describe, expect, it } from 'vitest';
import {
  filtrarOpcoesSku,
  montarOpcoesSku,
  type OpcaoSku,
} from '../dialog-entrada-busca';

const mockOpcoes: OpcaoSku[] = [
  { codigo: '001', rotulo: '001 · Botão de Pressão (Azul Bebê)', codigoPai: 'PAI01', estoque: 10 },
  { codigo: '002', rotulo: '002 · Linha Poliéster (Branco)', codigoPai: 'PAI02', estoque: 5 },
];

describe('filtrarOpcoesSku', () => {
  it('acha opção com acento buscando sem acento', () => {
    const r = filtrarOpcoesSku(mockOpcoes, 'botao');
    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe('001');
  });

  it('acha opção por cor com acento buscando sem acento', () => {
    const r = filtrarOpcoesSku(mockOpcoes, 'bebe');
    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe('001');
  });

  it('acha opção buscando com acento quando o rótulo tem acento', () => {
    const r = filtrarOpcoesSku(mockOpcoes, 'Poliéster');
    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe('002');
  });

  it('acha opção pelo codigoPai', () => {
    const r = filtrarOpcoesSku(mockOpcoes, 'pai02');
    expect(r).toHaveLength(1);
    expect(r[0].codigo).toBe('002');
  });

  it('respeita o limite máximo de resultados', () => {
    const muitasOpcoes = Array.from({ length: 100 }, (_, i) => ({
      codigo: `SKU-${i}`,
      rotulo: `SKU-${i} · Produto Teste`,
      codigoPai: 'PAI-X',
      estoque: 1,
    }));
    const r = filtrarOpcoesSku(muitasOpcoes, 'teste', 10);
    expect(r).toHaveLength(10);
  });

  it('montarOpcoesSku pré-indexa o texto para busca rápida', () => {
    const skus = [
      { codigo: '10', nome: 'Macarrão Instantâneo', cor: 'Padrão', codigoPai: 'PAI10', estoque: 2 },
    ];
    const preparadas = montarOpcoesSku(skus);
    expect(preparadas[0].textoBusca).toContain('macarrao');
    expect(preparadas[0].textoBusca).toContain('padrao');
    expect(preparadas[0].rotulo).toBe('10 · Macarrão Instantâneo (Padrão)');

    const filtradas = filtrarOpcoesSku(preparadas, 'instantaneo');
    expect(filtradas).toHaveLength(1);
    expect(filtradas[0].codigo).toBe('10');
  });
});
