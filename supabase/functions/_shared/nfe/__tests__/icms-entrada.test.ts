import { describe, it, expect } from 'vitest';
import { classificarIcmsEntrada, csosnSaidaSugerido } from '../icms-entrada';

describe('icms-entrada', () => {
  it.each([
    [{ icmsGrupo: 'ICMSSN500', csosn: '500', cstIcms: null }, 'st'],
    [{ icmsGrupo: 'ICMSSN201', csosn: '201', cstIcms: null }, 'st'],
    [{ icmsGrupo: 'ICMS60', csosn: null, cstIcms: '60' }, 'st'],
    [{ icmsGrupo: 'ICMS30', csosn: null, cstIcms: '30' }, 'st'],
    [{ icmsGrupo: 'ICMSST', csosn: null, cstIcms: '41' }, 'st'],
    [{ icmsGrupo: 'ICMSSN102', csosn: '102', cstIcms: null }, 'sem_st'],
    [{ icmsGrupo: 'ICMS00', csosn: null, cstIcms: '00' }, 'sem_st'],
    [{ icmsGrupo: 'ICMSSN103', csosn: '103', cstIcms: null }, 'excecao'],
    [{ icmsGrupo: 'ICMS40', csosn: null, cstIcms: '40' }, 'excecao'],
    [{ icmsGrupo: 'ICMSSN900', csosn: '900', cstIcms: null }, 'excecao'],
    [{ icmsGrupo: null, csosn: null, cstIcms: null }, 'excecao'],
  ])('classifica %o → %s', (i, esperado) => expect(classificarIcmsEntrada(i)).toBe(esperado));
  it('sugere CSOSN', () => {
    expect(csosnSaidaSugerido('st', '102')).toBe('500');
    expect(csosnSaidaSugerido('sem_st', '102')).toBe('102');
    expect(csosnSaidaSugerido('sem_st', null)).toBeNull();
    expect(csosnSaidaSugerido('sem_st', '999')).toBeNull();
    expect(csosnSaidaSugerido('excecao', '102')).toBeNull();
  });
});
