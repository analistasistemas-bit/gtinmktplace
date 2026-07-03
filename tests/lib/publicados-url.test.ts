import { describe, it, expect } from 'vitest';
import { estadoParaParams, paramsParaEstado, TAMANHO_PADRAO, type EstadoPublicados } from '@/lib/publicados-url';

const vazio: EstadoPublicados = {
  filtro: { busca: undefined, fornecedor: null, status: null, tipo: null },
  ord: null,
  pagina: 1,
  tamanho: TAMANHO_PADRAO,
};

describe('paramsParaEstado', () => {
  it('params vazios → estado default', () => {
    expect(paramsParaEstado(new URLSearchParams())).toEqual(vazio);
  });

  it('lê filtro, ordenação, página e tamanho', () => {
    const p = new URLSearchParams('q=linha&fornecedor=DETALLIA&status=ativo&tipo=fita&ord=estoque&dir=desc&pg=3&ts=20');
    const e = paramsParaEstado(p);
    expect(e.filtro).toEqual({ busca: 'linha', fornecedor: 'DETALLIA', status: 'ativo', tipo: 'fita' });
    expect(e.ord).toEqual({ coluna: 'estoque', dir: 'desc' });
    expect(e.pagina).toBe(3);
    expect(e.tamanho).toBe(20);
  });

  it('status/coluna inválidos caem para null', () => {
    const e = paramsParaEstado(new URLSearchParams('status=xpto&ord=naoexiste&dir=asc'));
    expect(e.filtro.status).toBeNull();
    expect(e.ord).toBeNull();
  });

  it('tipo aceita texto livre (categoria real do ML), não só o enum antigo', () => {
    const e = paramsParaEstado(new URLSearchParams('tipo=Alfinetes de Seguran%C3%A7a'));
    expect(e.filtro.tipo).toBe('Alfinetes de Segurança');
  });

  it('tamanho fora da lista cai para o padrão; página mínima 1', () => {
    expect(paramsParaEstado(new URLSearchParams('ts=999')).tamanho).toBe(TAMANHO_PADRAO);
    expect(paramsParaEstado(new URLSearchParams('pg=0')).pagina).toBe(1);
    expect(paramsParaEstado(new URLSearchParams('pg=-5')).pagina).toBe(1);
  });
});

describe('estadoParaParams', () => {
  it('omite defaults (página 1, tamanho padrão, filtros vazios)', () => {
    expect(estadoParaParams(vazio).toString()).toBe('');
  });

  it('serializa só o que está setado', () => {
    const p = estadoParaParams({
      filtro: { busca: 'x', fornecedor: 'F', status: 'pausado', tipo: 'botao' },
      ord: { coluna: 'titulo', dir: 'asc' },
      pagina: 2,
      tamanho: 50,
    });
    expect(p.get('q')).toBe('x');
    expect(p.get('fornecedor')).toBe('F');
    expect(p.get('status')).toBe('pausado');
    expect(p.get('tipo')).toBe('botao');
    expect(p.get('ord')).toBe('titulo');
    expect(p.get('dir')).toBe('asc');
    expect(p.get('pg')).toBe('2');
    expect(p.get('ts')).toBe('50');
  });

  it('round-trip preserva o estado', () => {
    const e: EstadoPublicados = {
      filtro: { busca: 'fita cetim', fornecedor: 'DETALLIA', status: 'moderado', tipo: 'fita' },
      ord: { coluna: 'valorVendido', dir: 'desc' },
      pagina: 4,
      tamanho: 20,
    };
    expect(paramsParaEstado(estadoParaParams(e))).toEqual(e);
  });

  it('busca em branco não vira param', () => {
    expect(estadoParaParams({ ...vazio, filtro: { ...vazio.filtro, busca: '   ' } }).has('q')).toBe(false);
  });

  it('preserva espaço à direita (senão o round-trip pela URL corta o espaço a cada tecla e trava a digitação de frases)', () => {
    const p = estadoParaParams({ ...vazio, filtro: { ...vazio.filtro, busca: 'fita ' } });
    expect(p.get('q')).toBe('fita ');
  });

  it('serializa e lê o filtro de encalhados (encalhados=1)', () => {
    const p = estadoParaParams({ ...vazio, filtro: { ...vazio.filtro, somenteEncalhados: true } });
    expect(p.get('encalhados')).toBe('1');
    expect(paramsParaEstado(new URLSearchParams('encalhados=1')).filtro.somenteEncalhados).toBe(true);
  });

  it('sem encalhados na URL → filtro sem a chave (não quebra defaults)', () => {
    expect(estadoParaParams(vazio).has('encalhados')).toBe(false);
    expect(paramsParaEstado(new URLSearchParams()).filtro.somenteEncalhados).toBeUndefined();
  });
});
