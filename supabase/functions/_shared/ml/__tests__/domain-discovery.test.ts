import { describe, it, expect } from 'vitest';
import { parseDomainDiscovery } from '../domain-discovery';

// Shape real do probe 2026-06-14 (furadeira → 2 domains distintos).
const REAL = [
  { domain_id: 'MLB-ELECTRIC_DRILLS', domain_name: 'Furadeiras elétricas', category_id: 'MLB189007', category_name: 'De Mão' },
  { domain_id: 'MLB-HAMMER_DRILLS', domain_name: 'Furadeiras', category_id: 'MLB430376', category_name: 'Marteletes' },
];

describe('parseDomainDiscovery', () => {
  it('mapeia itens com category_id e preserva a ordem', () => {
    const r = parseDomainDiscovery(REAL);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({
      domainId: 'MLB-ELECTRIC_DRILLS', domainName: 'Furadeiras elétricas',
      categoriaId: 'MLB189007', categoriaNome: 'De Mão',
    });
    expect(r[1].categoriaId).toBe('MLB430376');
  });

  it('descarta item sem category_id', () => {
    expect(parseDomainDiscovery([{ domain_id: 'X', domain_name: 'Y' }])).toEqual([]);
  });

  it('lida com não-array / vazio', () => {
    expect(parseDomainDiscovery(null)).toEqual([]);
    expect(parseDomainDiscovery([])).toEqual([]);
    expect(parseDomainDiscovery({})).toEqual([]);
  });
});
