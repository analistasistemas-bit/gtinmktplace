// Orquestração da sugestão de categoria pela ficha (spec 2026-08-22). O que estes testes travam:
//  - o caso Aquaphor (lote 21) produz a sugestão completa;
//  - domínio igual curto-circuita SEM buscar itens (economia de chamada);
//  - best-effort de verdade: qualquer dep lançando → null, nunca exception.
import { describe, expect, it, vi } from 'vitest';
import { calcularSugestaoCatalogo, type DepsSugestaoCatalogo } from '../sugestao-catalogo';

const ficha = {
  id: 'MLB19462147', saleFormat: null, unitsPerPack: null, lengthM: null,
  domainId: 'MLB-BODY_SKIN_CARE_PRODUCTS',
};
const args = { gtin: '4005800223136', categoriaMlId: 'MLB277750', atributosMl: [] };

function deps(overrides: Partial<DepsSugestaoCatalogo> = {}): DepsSugestaoCatalogo {
  return {
    buscarFicha: async () => ficha,
    buscarDominio: async () => 'MLB-BABY_CREAMS_AND_OINTMENTS',
    buscarItensFicha: async () => ({ categoriaId: 'MLB1262', vendedores: 7 }),
    buscarNome: async () => 'Cuidado do Corpo',
    ...overrides,
  };
}

describe('calcularSugestaoCatalogo', () => {
  it('caso Aquaphor: divergência de domínio gera a sugestão completa', async () => {
    await expect(calcularSugestaoCatalogo(deps(), args))
      .resolves.toEqual({ id: 'MLB1262', nome: 'Cuidado do Corpo', vendedores: 7 });
  });

  it('domínio igual → null, sem buscar os itens da ficha', async () => {
    const buscarItensFicha = vi.fn();
    const r = await calcularSugestaoCatalogo(
      deps({ buscarDominio: async () => 'MLB-BODY_SKIN_CARE_PRODUCTS', buscarItensFicha }), args);
    expect(r).toBeNull();
    expect(buscarItensFicha).not.toHaveBeenCalled();
  });

  it('sem ficha para o GTIN → null', async () => {
    await expect(calcularSugestaoCatalogo(deps({ buscarFicha: async () => null }), args)).resolves.toBeNull();
  });

  it('ficha sem itens competindo → null', async () => {
    await expect(calcularSugestaoCatalogo(deps({ buscarItensFicha: async () => ({ categoriaId: null, vendedores: 0 }) }), args)).resolves.toBeNull();
  });

  it('categoria dos itens igual à escolhida → null (defensivo)', async () => {
    await expect(calcularSugestaoCatalogo(deps({ buscarItensFicha: async () => ({ categoriaId: 'MLB277750', vendedores: 3 }) }), args)).resolves.toBeNull();
  });

  it('nome indisponível não derruba a sugestão — persiste nome null (o card só renderiza com nome; o alerta idem)', async () => {
    await expect(calcularSugestaoCatalogo(deps({ buscarNome: async () => null }), args))
      .resolves.toEqual({ id: 'MLB1262', nome: null, vendedores: 7 });
  });

  it('qualquer dep lançando → null, sem exception propagada', async () => {
    await expect(calcularSugestaoCatalogo(deps({ buscarFicha: async () => { throw new Error('boom'); } }), args)).resolves.toBeNull();
    await expect(calcularSugestaoCatalogo(deps({ buscarDominio: async () => { throw new Error('boom'); } }), args)).resolves.toBeNull();
  });
});
