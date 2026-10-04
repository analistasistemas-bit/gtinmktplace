import { describe, expect, it } from 'vitest';
import { reversaoValida, validarPedidoStatus } from '../validar-status.ts';
import { MAX_ITENS } from '../validar.ts';

const it1 = (id: string, titulo: string | null = 'T') => ({ ml_item_id: id, titulo });
const org = new Set(['MLB1', 'MLB2', 'MLBK']);
const kits = new Set(['MLBK']);

describe('validarPedidoStatus', () => {
  it('aceita anúncios da org; título cortado em 300', () => {
    const r = validarPedidoStatus([it1('MLB1', 'x'.repeat(400)), it1('MLB2', null)], org, kits);
    expect(r).toEqual({ ok: true, itens: [{ ml_item_id: 'MLB1', titulo: 'x'.repeat(300) }, { ml_item_id: 'MLB2', titulo: null }] });
  });
  it('recusa kit, repetido e de fora da org — tudo ou nada', () => {
    const r = validarPedidoStatus([it1('MLB1'), it1('MLB1'), it1('MLBK'), it1('MLB9')], org, kits);
    expect(r).toEqual({ ok: false, erro: 'Alguns anúncios não podem entrar na operação.', itens: [
      { ml_item_id: 'MLB1', motivo: 'Anúncio repetido no pedido' },
      { ml_item_id: 'MLBK', motivo: 'Kit Virtual não entra em pausar/reativar em massa' },
      { ml_item_id: 'MLB9', motivo: 'O anúncio não é desta organização' },
    ] });
  });
  it('vazio e acima do máximo', () => {
    expect(validarPedidoStatus([], org, kits)).toEqual({ ok: false, erro: 'Selecione ao menos um anúncio.' });
    const muitos = Array.from({ length: MAX_ITENS + 1 }, (_, i) => it1(`MLB${i}`));
    expect(validarPedidoStatus(muitos, org, kits)).toEqual({ ok: false, erro: `No máximo ${MAX_ITENS} anúncios por operação.` });
  });
});

describe('reversaoValida (Reverter não confia no front)', () => {
  const origem = { acao: 'pausar', promocao_id: null, status: 'concluida' };
  const aplicados = new Set(['MLB1', 'MLB2']);
  it('todos os pedidos aplicados numa pausa concluída → reativar vale', () => {
    expect(reversaoValida(origem, aplicados, { acao: 'reativar', ids: ['MLB1', 'MLB2'] })).toBe(true);
  });
  it('recusa: ação não inversa, origem de promoção, origem executando, origem ausente', () => {
    expect(reversaoValida(origem, aplicados, { acao: 'pausar', ids: ['MLB1'] })).toBe(false);
    expect(reversaoValida({ ...origem, promocao_id: 'P1' }, aplicados, { acao: 'reativar', ids: ['MLB1'] })).toBe(false);
    expect(reversaoValida({ ...origem, status: 'executando' }, aplicados, { acao: 'reativar', ids: ['MLB1'] })).toBe(false);
    expect(reversaoValida(null, aplicados, { acao: 'reativar', ids: ['MLB1'] })).toBe(false);
  });
  it('recusa id que não foi aplicado nesta origem (ja_estava, erro, de fora)', () => {
    expect(reversaoValida(origem, aplicados, { acao: 'reativar', ids: ['MLB1', 'MLB3'] })).toBe(false);
  });
});
