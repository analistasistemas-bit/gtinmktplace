import { describe, it, expect } from 'vitest';
import { decidirExclusaoFamilia, type EntradaDecisao } from '../decidir';

// Base: CREATE em revisão, sem irmã, sem espelho, sem kit — todas as leituras deram certo.
const base = (over: Partial<EntradaDecisao> = {}): EntradaDecisao => ({
  alvo: { status: 'pronto', publicado_em: null, ml_item_id: null, variacoes: [{ ml_variation_id: null }] },
  irmas: [],
  externos: [],
  kitsDependentes: 0,
  ...over,
});
const alvo = (over: Partial<EntradaDecisao['alvo']>) => ({ ...base().alvo, ...over });
const recusa = (motivo: string) => ({ ok: false, motivo });

describe('decidirExclusaoFamilia (ADR-0199)', () => {
  it('CREATE pronto sem externos → ok', () => {
    expect(decidirExclusaoFamilia(base())).toEqual({ ok: true });
  });

  it('publicado_em → publicada', () => {
    expect(decidirExclusaoFamilia(base({ alvo: alvo({ publicado_em: '2026-11-01T00:00:00Z' }) })))
      .toEqual(recusa('publicada'));
  });

  it.each(['pendente', 'processando', 'publicando'])('status %s → em_voo', (status) => {
    expect(decidirExclusaoFamilia(base({ alvo: alvo({ status }) }))).toEqual(recusa('em_voo'));
  });

  it.each(['pendente', 'publicando'])('externo %s → em_voo', (status) => {
    expect(decidirExclusaoFamilia(base({ externos: [{ status, item_externo_id: null }] })))
      .toEqual(recusa('em_voo'));
  });

  it.each(['criacao_incerta', 'pendente', 'compensacao_pendente', 'remocao_pendente'])(
    'filho em %s → em_voo', (status) => {
      // Com irmã presente: o em_voo vem antes da "representação" — a saga ainda escreve no ML.
      expect(decidirExclusaoFamilia(base({
        irmas: [{ ml_item_id: null, variacoes: [] }],
        externos: [{ status: 'erro', item_externo_id: null, anuncios_externos_itens: [{ status, item_externo_id: null }] }],
      }))).toEqual(recusa('em_voo'));
    },
  );

  it('UPDATE UP: filho com item_externo_id e irmã presente → ok', () => {
    expect(decidirExclusaoFamilia(base({
      alvo: alvo({ status: 'erro' }),
      irmas: [{ ml_item_id: null, variacoes: [{ ml_variation_id: null }] }],
      externos: [{ status: 'erro', item_externo_id: null, anuncios_externos_itens: [{ status: 'ativo', item_externo_id: 'MLB1' }] }],
    }))).toEqual({ ok: true });
  });

  it('filho com item_externo_id e sem irmã → vinculada', () => {
    expect(decidirExclusaoFamilia(base({
      externos: [{ status: 'erro', item_externo_id: null, anuncios_externos_itens: [{ status: 'ativo', item_externo_id: 'MLB1' }] }],
    }))).toEqual(recusa('vinculada'));
  });

  it('raiz com item_externo_id (split parcial) e sem irmã → vinculada', () => {
    expect(decidirExclusaoFamilia(base({
      alvo: alvo({ status: 'erro' }),
      externos: [{ status: 'erro', item_externo_id: 'MLB2' }],
    }))).toEqual(recusa('vinculada'));
  });

  it('raiz publicado sem id e sem irmã → vinculada (estado inconsistente trava fechado)', () => {
    expect(decidirExclusaoFamilia(base({ externos: [{ status: 'publicado', item_externo_id: null }] })))
      .toEqual(recusa('vinculada'));
  });

  it('ml_variation_id não coberto por irmã → vinculada', () => {
    // Incidente Xik 2026-08-13: a irmã existe, mas não carrega a cor que este UPDATE criou no ML.
    expect(decidirExclusaoFamilia(base({
      alvo: alvo({ ml_item_id: 'MLB3', variacoes: [{ ml_variation_id: '10' }, { ml_variation_id: '11' }] }),
      irmas: [{ ml_item_id: 'MLB3', variacoes: [{ ml_variation_id: '10' }] }],
    }))).toEqual(recusa('vinculada'));
  });

  it('ml_variation_id coberto por irmã → ok', () => {
    expect(decidirExclusaoFamilia(base({
      alvo: alvo({ ml_item_id: 'MLB3', variacoes: [{ ml_variation_id: '10' }] }),
      irmas: [{ ml_item_id: 'MLB3', variacoes: [{ ml_variation_id: '10' }] }],
    }))).toEqual({ ok: true });
  });

  it('sem irmã e kitsDependentes > 0 → kit', () => {
    expect(decidirExclusaoFamilia(base({ kitsDependentes: 2 }))).toEqual(recusa('kit'));
  });

  it('com irmã e kitsDependentes > 0 → ok (a base continua representada)', () => {
    expect(decidirExclusaoFamilia(base({ irmas: [{ ml_item_id: null, variacoes: [] }], kitsDependentes: 2 })))
      .toEqual({ ok: true });
  });

  it.each(['irmas', 'externos', 'kitsDependentes'] as const)('%s undefined → nao_conferido', (campo) => {
    expect(decidirExclusaoFamilia(base({ [campo]: undefined }))).toEqual(recusa('nao_conferido'));
  });
});
