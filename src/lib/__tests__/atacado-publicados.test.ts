import { describe, expect, it } from 'vitest';
import { planejarAtacado, selosAtacado } from '../atacado-publicados';
import { filtrarPublicados, type PublicadoItem } from '../publicados';
import { estadoParaParams, paramsParaEstado } from '../publicados-url';

const item = (p: Partial<PublicadoItem>): PublicadoItem => ({
  familiaId: 'f1', codigoPai: 'P1', gtin: null, titulo: 'Produto', fornecedor: null, tipo: null, categoria: null,
  precoPublicacao: 10, precoPublicacaoMax: 10, descricao: null, mlItemId: 'MLB1', mlPermalink: null, publicadoEm: null,
  status: 'ativo', ...p,
});
const F3 = [{ min_unidades: 3, desconto_pct: 5 }];
const F6 = [{ min_unidades: 6, desconto_pct: 10 }];

describe('selosAtacado', () => {
  it('config única entre lotes vira faixas; lote sem config (null) não esconde', () => {
    const s = selosAtacado([{ codigo_pai: 'P1', atacado: null }, { codigo_pai: 'P1', atacado: F3 }], []);
    expect(s.get('P1')).toEqual({ tipo: 'faixas', faixas: F3 });
  });
  it('[] = sem atacado: nenhum selo', () => {
    expect(selosAtacado([{ codigo_pai: 'P1', atacado: [] }], []).has('P1')).toBe(false);
  });
  it('lotes com configs diferentes → entre_lotes', () => {
    expect(selosAtacado([{ codigo_pai: 'P1', atacado: F3 }, { codigo_pai: 'P1', atacado: F6 }], []).get('P1')).toEqual({ tipo: 'entre_lotes' });
  });
  it('cor com config própria prevalece', () => {
    expect(selosAtacado([{ codigo_pai: 'P1', atacado: F3 }], ['P1']).get('P1')).toEqual({ tipo: 'por_cor' });
  });
  it('faixas saem ordenadas por quantidade', () => {
    const s = selosAtacado([{ codigo_pai: 'P1', atacado: [...F6, ...F3] }], []);
    expect(s.get('P1')).toEqual({ tipo: 'faixas', faixas: [...F3, ...F6] });
  });
});

describe('planejarAtacado', () => {
  it('deduplica por produto (split) e usa as faixas comuns como ponto de partida', () => {
    const a = item({ atacado: { tipo: 'faixas', faixas: F3 } });
    const b = item({ mlItemId: 'MLB2', particaoSplit: true, atacado: { tipo: 'faixas', faixas: F3 } });
    const c = item({ familiaId: 'f2', codigoPai: 'P2', mlItemId: 'MLB3', atacado: { tipo: 'faixas', faixas: F3 } });
    const p = planejarAtacado([a, b, c], [a, b, c]);
    expect(p.familias).toEqual(['f1', 'f2']);
    expect(p.produtos).toHaveLength(2);
    expect(p.faixasIniciais).toEqual(F3);
  });
  it('configs diferentes ou ausentes → começa vazio', () => {
    const a = item({ atacado: { tipo: 'faixas', faixas: F3 } });
    const c = item({ familiaId: 'f2', codigoPai: 'P2', mlItemId: 'MLB3' });
    expect(planejarAtacado([a, c], [a, c]).faixasIniciais).toEqual([]);
  });
  it('fora: kit virtual, inativo, por cor, entre lotes e produto misto UP + partição Legacy', () => {
    const kv = item({ familiaId: '', codigoPai: 'kit-virtual:1', mlItemId: 'K', ehKitVirtual: true });
    const enc = item({ codigoPai: 'P2', familiaId: 'f2', mlItemId: 'E', status: 'encerrado' });
    const cor = item({ codigoPai: 'P3', familiaId: 'f3', mlItemId: 'C', atacado: { tipo: 'por_cor' } });
    const lotes = item({ codigoPai: 'P4', familiaId: 'f4', mlItemId: 'L', atacado: { tipo: 'entre_lotes' } });
    const up = item({ codigoPai: 'P5', familiaId: 'f5', mlItemId: 'U', userProducts: true });
    const leg = item({ codigoPai: 'P5', familiaId: 'f5', mlItemId: 'U2', particaoSplit: true });
    const p = planejarAtacado([kv, enc, cor, lotes, up], [kv, enc, cor, lotes, up, leg]);
    expect(p.produtos).toEqual([]);
    expect(p.fora.map((f) => f.codigoPai)).toEqual(['kit-virtual:1', 'P2', 'P3', 'P4', 'P5']);
  });
  it('publicação incompleta fica fora mesmo ativa (o selo só informa)', () => {
    const p = planejarAtacado([item({ publicacaoIncompleta: true, atacado: { tipo: 'faixas', faixas: F3 } })], []);
    expect(p.produtos).toEqual([]);
    expect(p.fora[0].motivo).toMatch(/incompleta/);
  });
  it('produto pausado entra', () => {
    expect(planejarAtacado([item({ status: 'pausado' })], []).produtos).toHaveLength(1);
  });
});

describe('filtro de atacado na URL', () => {
  it('ida e volta; lixo é ignorado', () => {
    const p = estadoParaParams({ filtro: { atacado: 'com' }, ord: null, pagina: 1, tamanho: 10 });
    expect(p.get('atacado')).toBe('com');
    expect(paramsParaEstado(p).filtro.atacado).toBe('com');
    expect(paramsParaEstado(new URLSearchParams('atacado=x')).filtro.atacado).toBeUndefined();
  });
});

describe('filtro de atacado', () => {
  const com = item({ atacado: { tipo: 'faixas', faixas: F3 } });
  const cor = item({ mlItemId: 'MLB2', atacado: { tipo: 'por_cor' } });
  const sem = item({ mlItemId: 'MLB3' });
  it('com = qualquer selo; sem = nenhum', () => {
    expect(filtrarPublicados([com, cor, sem], { atacado: 'com' }).map((i) => i.mlItemId)).toEqual(['MLB1', 'MLB2']);
    expect(filtrarPublicados([com, cor, sem], { atacado: 'sem' }).map((i) => i.mlItemId)).toEqual(['MLB3']);
  });
});
