import { describe, expect, it } from 'vitest';
import { CEP_FRETE_OFERTA, freteDaRespostaShipping } from '../../../extensao/roteamento.ts';

const INDISPONIVEL = { estado: 'indisponivel', motivo: 'frete da oferta indisponível' };

describe('freteDaRespostaShipping (auditoria × Avant, 25/10)', () => {
  it('list_cost da opção "recommended"; sem ela, a primeira', () => {
    expect(freteDaRespostaShipping({ options: [{ list_cost: 40, display: 'always' }, { list_cost: 32.45, display: 'recommended' }] }))
      .toEqual({ estado: 'ok', valor: 32.45 });
    expect(freteDaRespostaShipping({ options: [{ list_cost: 32.45 }, { list_cost: 50 }] })).toEqual({ estado: 'ok', valor: 32.45 });
    expect(freteDaRespostaShipping({ options: [{ list_cost: 0, display: 'recommended' }] })).toEqual({ estado: 'ok', valor: 0 });
  });

  it('falha de leitura ou list_cost ausente/não numérico → indisponível (nunca zero)', () => {
    for (const r of [null, {}, { options: [] }, { options: [{ cost: 10 }] }, { options: [{ list_cost: '32.45' }] }, { options: [{ list_cost: -1 }] }, { options: [{ list_cost: NaN }] }]) {
      expect(freteDaRespostaShipping(r)).toEqual(INDISPONIVEL);
    }
  });

  it('CEP da cotação é o de referência (São Paulo, Av. Paulista)', () => {
    expect(CEP_FRETE_OFERTA).toBe('01310100');
  });
});
