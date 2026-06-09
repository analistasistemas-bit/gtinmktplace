import { describe, it, expect } from 'vitest';
import { comissaoDe } from '../listing-prices';

describe('comissaoDe', () => {
  it('extrai percentual e fixa do listing_prices', () => {
    expect(comissaoDe({
      sale_fee_amount: 8.5,
      sale_fee_details: { percentage_fee: 13, fixed_fee: 6 },
    })).toEqual({ percentual: 13, fixa: 6 });
  });
  it('sem detalhes → zeros', () => {
    expect(comissaoDe({ sale_fee_amount: 0 })).toEqual({ percentual: 0, fixa: 0 });
  });
});
