import { describe, expect, it, vi } from 'vitest';
import { classificarIdentificador, resolverAlvo, type Vinculo } from '../alvo.ts';

const vin = (mlb: string, o: Partial<Vinculo> = {}): Vinculo =>
  ({ mlb, mlbu: null, familia_ml: null, sku: 'X', codigo_pai: 'P', ...o });

function deps(vs: Vinculo[] = [], titulos: { codigo_pai: string; titulo: string; mlbs: string[] }[] = []) {
  return {
    vinculos: vi.fn(async (f: { mlb?: string; mlbu?: string; familia_ml?: string; sku?: string }) =>
      vs.filter((v) => (f.mlb ? v.mlb === f.mlb : f.mlbu ? v.mlbu === f.mlbu
        : f.familia_ml ? v.familia_ml === f.familia_ml : v.sku === f.sku))),
    buscarPorTitulo: vi.fn(async () => titulos),
  };
}

describe('classificarIdentificador', () => {
  it('os quatro tipos', () => {
    expect(classificarIdentificador('MLB123')).toBe('mlb');
    expect(classificarIdentificador('MLBU456')).toBe('mlbu');
    expect(classificarIdentificador('#8632963637759506')).toBe('familia_ml');
    expect(classificarIdentificador('8632963637759506')).toBe('familia_ml');
    expect(classificarIdentificador('00123')).toBe('sku_ou_titulo');
    expect(classificarIdentificador('camiseta azul')).toBe('sku_ou_titulo');
  });
});

describe('resolverAlvo', () => {
  it('MLB com vínculo', async () => {
    const d = deps([vin('MLB1')]);
    expect(await resolverAlvo('MLB1', d)).toEqual({ tipo: 'anuncios', mlbs: ['MLB1'], familia_ml: null });
    expect(d.vinculos).toHaveBeenCalledWith({ mlb: 'MLB1' });
  });

  it('MLB sem vínculo → nao_encontrado, sem cair para título', async () => {
    const d = deps([], [{ codigo_pai: 'P', titulo: 't', mlbs: ['MLB9'] }]);
    expect(await resolverAlvo('MLB1', d)).toEqual({ tipo: 'nao_encontrado' });
    expect(d.buscarPorTitulo).not.toHaveBeenCalled();
  });

  it('MLBU', async () => {
    const d = deps([vin('MLB1', { mlbu: 'MLBU7' }), vin('MLB2', { mlbu: 'MLBU7' })]);
    expect(await resolverAlvo('MLBU7', d)).toEqual({ tipo: 'anuncios', mlbs: ['MLB1', 'MLB2'], familia_ml: null });
  });

  it('família do ML com # → consulta sem o #', async () => {
    const d = deps([vin('MLB1', { familia_ml: '8632963637759506' }), vin('MLB2', { familia_ml: '8632963637759506' })]);
    expect(await resolverAlvo(' #8632963637759506 ', d))
      .toEqual({ tipo: 'anuncios', mlbs: ['MLB1', 'MLB2'], familia_ml: '8632963637759506' });
    expect(d.vinculos).toHaveBeenCalledWith({ familia_ml: '8632963637759506' });
  });

  it('SKU que casa 2 vínculos → os 2 MLBs (sem repetir)', async () => {
    const d = deps([vin('MLB1', { sku: 'S1' }), vin('MLB2', { sku: 'S1' }), vin('MLB2', { sku: 'S1' }), vin('MLB3', { sku: 'S2' })]);
    expect(await resolverAlvo('S1', d)).toEqual({ tipo: 'anuncios', mlbs: ['MLB1', 'MLB2'], familia_ml: null });
    expect(d.buscarPorTitulo).not.toHaveBeenCalled();
  });

  it('título de 2 caracteres → nao_encontrado sem buscar título', async () => {
    const d = deps([], [{ codigo_pai: 'P', titulo: 'ab', mlbs: ['MLB1'] }]);
    expect(await resolverAlvo('ab', d)).toEqual({ tipo: 'nao_encontrado' });
    expect(d.buscarPorTitulo).not.toHaveBeenCalled();
  });

  it('título com 15 resultados → 10 candidatos, nunca resolve sozinho', async () => {
    const quinze = Array.from({ length: 15 }, (_, i) => ({ codigo_pai: `P${i}`, titulo: `Camiseta ${i}`, mlbs: [`MLB${i}`] }));
    const r = await resolverAlvo('camiseta', deps([], quinze));
    expect(r.tipo).toBe('candidatos');
    if (r.tipo === 'candidatos') expect(r.candidatos).toHaveLength(10);
    const um = await resolverAlvo('camiseta', deps([], quinze.slice(0, 1)));
    expect(um.tipo).toBe('candidatos');
  });

  it('título sem resultado → nao_encontrado', async () => {
    expect(await resolverAlvo('camiseta', deps())).toEqual({ tipo: 'nao_encontrado' });
  });

  it('vazio, só espaços, > 200 caracteres ou não-string → nao_encontrado sem deps', async () => {
    const d = deps([vin('MLB1')]);
    for (const s of ['', '   ', 'a'.repeat(201), 123 as unknown as string]) {
      expect(await resolverAlvo(s, d)).toEqual({ tipo: 'nao_encontrado' });
    }
    expect(d.vinculos).not.toHaveBeenCalled();
    expect(d.buscarPorTitulo).not.toHaveBeenCalled();
  });
});
