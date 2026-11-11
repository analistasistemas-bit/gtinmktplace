// B1: tarifa `estimated` (falha do ML) não pode ficar 6 h no Redis.
import { describe, expect, it } from 'vitest';
import { ttlTarifa } from '../ttl';

describe('ttlTarifa', () => {
  it('estimated fica só 300 s', () => {
    expect(ttlTarifa('estimated')).toBe(300);
  });

  it.each(['official', 'partial'] as const)('%s mantém 6 h', (proveniencia) => {
    expect(ttlTarifa(proveniencia)).toBe(6 * 60 * 60);
  });
});
