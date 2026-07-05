import { describe, expect, it } from 'vitest';
import { decidirOperacaoCanal } from '../estado.ts';

describe('decidirOperacaoCanal', () => {
  it('sem item externo -> CREATE', () =>
    expect(decidirOperacaoCanal({ item_externo_id: null })).toBe('CREATE'));
  it('com item externo -> UPDATE', () =>
    expect(decidirOperacaoCanal({ item_externo_id: 'MLB123' })).toBe('UPDATE'));
});
