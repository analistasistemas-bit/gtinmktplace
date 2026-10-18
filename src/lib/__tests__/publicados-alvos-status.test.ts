import { describe, expect, it } from 'vitest';
import { alvosStatus } from '../publicados';

// Zaven 18/10: Pausar no short UP (32 SKUs, 1 MLB cada) mandava só `mlItemId` — pausava 1 SKU e a
// linha seguia "Ativo" (agregarStatusUP: qualquer filho ativo → ativo).
describe('alvosStatus', () => {
  it('UP: todos os SKUs da família (inclui o principal)', () => {
    expect(alvosStatus({ mlItemId: 'MLB1', mlItemIdsUP: ['MLB1', 'MLB2', 'MLB3'] })).toEqual(['MLB1', 'MLB2', 'MLB3']);
  });

  it('Legacy: só o próprio anúncio', () => {
    expect(alvosStatus({ mlItemId: 'MLB9', mlItemIdsUP: undefined })).toEqual(['MLB9']);
    expect(alvosStatus({ mlItemId: 'MLB9', mlItemIdsUP: [] })).toEqual(['MLB9']);
  });
});
