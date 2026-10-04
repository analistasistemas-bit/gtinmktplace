import { describe, expect, it } from 'vitest';
import { lerConfirmar, lerPreview, linhasDoRascunho, MSG_CONFIRMAR_RISCO, MSG_EXPIRADO, respostaConfirmar } from '../pedido.ts';
import type { ItemPreview } from '../preview.ts';

const U = '11111111-2222-4333-8444-555555555555';

describe('lerPreview', () => {
  it('aceita ajuste, preços editados e Reverter; deduplica ids', () => {
    expect(lerPreview({ etapa: 'preview', acao: 'reajustar', ml_item_ids: ['MLB1', 'MLB1'], ajuste: { tipo: 'pct', sentido: '+', valor: 5 }, precos: { MLB1: 10.5 } }))
      .toEqual({ familias: [], ml_item_ids: ['MLB1'], ajuste: { tipo: 'pct', sentido: '+', valor: 5 }, precos: { MLB1: 10.5 }, origem_id: null });
    expect(lerPreview({ acao: 'reajustar', origem_id: U })).toMatchObject({ origem_id: U, familias: [], ml_item_ids: [], ajuste: null });
  });

  it.each([
    ['ação errada', { acao: 'pausar', ml_item_ids: ['MLB1'] }],
    ['família não uuid', { acao: 'reajustar', familias: ['x'] }],
    ['origem não uuid', { acao: 'reajustar', origem_id: 'x' }],
    ['ajuste inválido', { acao: 'reajustar', ml_item_ids: ['MLB1'], ajuste: { tipo: 'pct', sentido: '*', valor: 5 } }],
    ['valor não numérico', { acao: 'reajustar', ml_item_ids: ['MLB1'], ajuste: { tipo: 'reais', sentido: '+', valor: '5' } }],
    ['preço não numérico', { acao: 'reajustar', ml_item_ids: ['MLB1'], precos: { MLB1: 'x' } }],
    ['seleção vazia', { acao: 'reajustar', ml_item_ids: [] }],
    ['acima do teto', { acao: 'reajustar', ml_item_ids: Array.from({ length: 501 }, (_, i) => `MLB${i}`) }],
  ])('recusa: %s', (_n, corpo) => {
    expect(lerPreview(corpo)).toBeNull();
  });
});

describe('lerConfirmar', () => {
  it('normaliza confirmações e preserva incluir omitido (a RPC usa o incluido do rascunho)', () => {
    expect(lerConfirmar({ operacao_id: U, confirmacoes: [{ ml_item_id: 'MLB1', risco: true }, { ml_item_id: 'MLB2', incluir: false }] })).toEqual({
      operacao_id: U,
      confirmacoes: [{ ml_item_id: 'MLB1', risco: true, sem_dado: false }, { ml_item_id: 'MLB2', risco: false, sem_dado: false, incluir: false }],
    });
  });
  it('recusa id inválido e flag não booleana', () => {
    expect(lerConfirmar({ operacao_id: 'x', confirmacoes: [] })).toBeNull();
    expect(lerConfirmar({ operacao_id: U, confirmacoes: [{ ml_item_id: 'MLB1', risco: 'sim' }] })).toBeNull();
  });
});

describe('respostaConfirmar', () => {
  it('ok e ja_confirmada publicam (repetir é seguro)', () => {
    expect(respostaConfirmar('ok')).toEqual({ publicar: true });
    expect(respostaConfirmar('ja_confirmada')).toEqual({ publicar: true });
  });
  it('mapeia recusas', () => {
    expect(respostaConfirmar('expirado')).toMatchObject({ status: 400, corpo: { erro: MSG_EXPIRADO } });
    expect(respostaConfirmar('confirmacao_faltando:MLB9')).toMatchObject({
      status: 400, corpo: { itens: [{ ml_item_id: 'MLB9', motivo: MSG_CONFIRMAR_RISCO }] },
    });
    expect(respostaConfirmar('ocupado:MLB3')).toMatchObject({ status: 409, corpo: { itens: [{ ml_item_id: 'MLB3' }] } });
    expect(respostaConfirmar('sem_produto:MLB4')).toMatchObject({ status: 400, corpo: { itens: [{ ml_item_id: 'MLB4' }] } });
    expect(respostaConfirmar('nenhum')).toMatchObject({ publicar: false, status: 400 });
  });
});

describe('linhasDoRascunho', () => {
  const base: ItemPreview = {
    ml_item_id: 'MLB1', codigo_pai: 'P1', variacao_ids: ['v1'], titulo: 'T', sku: null, preco_anterior: 100, preco: 110,
    avaliacao: { cores: [], pior: 'vermelho', tem_vermelho: true, tem_sem_dado: false },
    restaurar: [{ variacao_id: 'v1', esperado: { preco_publicacao: 100, preco_editado_pelo_operador: false }, novo: { preco_publicacao: 110, preco_editado_pelo_operador: true } }],
    variacoes_ml: ['1'], situacao: 'elegivel', motivo: null, incluido: false, aviso: null,
  };
  it('status por situação; estado_anterior = restaurar; codigo_pai sempre gravado', () => {
    const [el, fora, igual] = linhasDoRascunho([
      base,
      { ...base, ml_item_id: 'MLB2', situacao: 'fora', motivo: 'Kit', preco: 0, preco_anterior: 0, avaliacao: null, restaurar: null },
      { ...base, ml_item_id: 'MLB3', situacao: 'sem_alteracao', preco: 100, avaliacao: null, restaurar: null },
    ]);
    expect(el).toMatchObject({ status: 'rascunho', estado_anterior: base.restaurar, codigo_pai: 'P1', semaforo: 'vermelho', incluido: false, preco: 110, preco_anterior: 100, variacao_ids: ['v1'] });
    expect(fora).toMatchObject({ status: 'bloqueado', mensagem: 'Kit', preco: null, codigo_pai: 'P1', semaforo: null });
    expect(igual).toMatchObject({ status: 'ja_estava', codigo_pai: 'P1' });
  });
});
