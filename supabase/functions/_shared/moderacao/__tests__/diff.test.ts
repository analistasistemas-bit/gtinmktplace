import { describe, it, expect } from 'vitest';
import { diffModerados, resolvidosConfirmadosDe } from '../diff';

describe('diffModerados', () => {
  it('item moderado sem registro aberto → novo', () => {
    const r = diffModerados(
      [{ ml_item_id: 'MLB1', status: 'moderado', motivo: 'forbidden' }],
      [],
      new Set(),
    );
    expect(r.novos.map((n) => n.ml_item_id)).toEqual(['MLB1']);
    expect(r.resolvidos).toEqual([]);
  });
  it('registro aberto confirmado não-moderado → resolvido', () => {
    const r = diffModerados([], [{ ml_item_id: 'MLB1' }], new Set(['MLB1']));
    expect(r.resolvidos).toEqual(['MLB1']);
    expect(r.novos).toEqual([]);
  });
  it('registro aberto cujo status NÃO foi confirmado (bloco falhou → indisponivel) → NÃO resolvido', () => {
    // Regressão #5: leitura parcial não pode silenciar um alerta de moderação ativo.
    const r = diffModerados([], [{ ml_item_id: 'MLB1' }], new Set());
    expect(r.resolvidos).toEqual([]);
    expect(r.novos).toEqual([]);
  });
  it('item moderado que já tem registro aberto → nada', () => {
    const r = diffModerados(
      [{ ml_item_id: 'MLB1', status: 'moderado', motivo: 'forbidden' }],
      [{ ml_item_id: 'MLB1' }],
      new Set(),
    );
    expect(r.novos).toEqual([]);
    expect(r.resolvidos).toEqual([]);
  });
  it('mix: um novo, um resolvido (confirmado), um inalterado', () => {
    const r = diffModerados(
      [
        { ml_item_id: 'NOVO', status: 'moderado', motivo: 'forbidden' },
        { ml_item_id: 'IGUAL', status: 'moderado', motivo: 'forbidden' },
      ],
      [{ ml_item_id: 'IGUAL' }, { ml_item_id: 'SAIU' }],
      new Set(['SAIU']),
    );
    expect(r.novos.map((n) => n.ml_item_id)).toEqual(['NOVO']);
    expect(r.resolvidos).toEqual(['SAIU']);
  });
});

describe('resolvidosConfirmadosDe', () => {
  const st = (status: string) => ({ status, motivo: null });

  it('inclui os status definidos ≠ moderado (ativo/pausado/encerrado/inativo)', () => {
    const ids = ['A', 'P', 'E', 'I'];
    const status = { A: st('ativo'), P: st('pausado'), E: st('encerrado'), I: st('inativo') };
    const set = resolvidosConfirmadosDe(ids, status, []);
    expect([...set].sort()).toEqual(['A', 'E', 'I', 'P']);
  });

  it('exclui moderado e indisponivel (bloco de status que falhou)', () => {
    const ids = ['MOD', 'IND'];
    const status = { MOD: st('moderado'), IND: st('indisponivel') };
    expect(resolvidosConfirmadosDe(ids, status, []).size).toBe(0);
  });

  it('id sem status lido (ausente do statusPorId) não entra por (a)', () => {
    expect(resolvidosConfirmadosDe(['X'], {}, []).size).toBe(0);
  });

  it('órfão: aberto cuja família não existe mais na lista → incluído (fecha moderação órfã)', () => {
    // ORFAO está aberto mas não está em `ids` (item removido) → resolve; VIVO segue moderado → não.
    const set = resolvidosConfirmadosDe(['VIVO'], { VIVO: st('moderado') }, [{ ml_item_id: 'VIVO' }, { ml_item_id: 'ORFAO' }]);
    expect([...set]).toEqual(['ORFAO']);
  });
});
