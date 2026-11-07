import { describe, expect, it } from 'vitest';
import {
  decidirRetomar, idRetomada, lerConfirmar, lerPreview, lerRetomar, linhasDoRascunho, MSG_CONFIRMAR_RISCO, MSG_EXPIRADO, MSG_FAMILIA_PARCIAL, respostaConfirmar,
} from '../pedido.ts';
import type { ItemPreview } from '../preview.ts';

const U = '11111111-2222-4333-8444-555555555555';

describe('lerPreview', () => {
  it('aceita ajuste, preços editados e Reverter; deduplica ids', () => {
    expect(lerPreview({ etapa: 'preview', acao: 'reajustar', ml_item_ids: ['MLB1', 'MLB1'], ajuste: { tipo: 'pct', sentido: '+', valor: 5 }, precos: { MLB1: 10.5 } }))
      .toEqual({ familias: [], ml_item_ids: ['MLB1'], ajuste: { tipo: 'pct', sentido: '+', valor: 5 }, precos: { MLB1: 10.5 }, origem_id: null });
    expect(lerPreview({ acao: 'reajustar', origem_id: U })).toMatchObject({ origem_id: U, familias: [], ml_item_ids: [], ajuste: null });
  });

  it('aceita o tipo definir', () => {
    expect(lerPreview({ acao: 'reajustar', ml_item_ids: ['MLB1'], ajuste: { tipo: 'definir', sentido: '+', valor: 10 } })?.ajuste?.tipo).toBe('definir');
  });

  it.each([
    ['ação errada', { acao: 'pausar', ml_item_ids: ['MLB1'] }],
    ['família não uuid', { acao: 'reajustar', familias: ['x'] }],
    ['origem não uuid', { acao: 'reajustar', origem_id: 'x' }],
    ['ajuste inválido', { acao: 'reajustar', ml_item_ids: ['MLB1'], ajuste: { tipo: 'pct', sentido: '*', valor: 5 } }],
    ['tipo desconhecido', { acao: 'reajustar', ml_item_ids: ['MLB1'], ajuste: { tipo: 'outro', sentido: '+', valor: 5 } }],
    ['valor não numérico', { acao: 'reajustar', ml_item_ids: ['MLB1'], ajuste: { tipo: 'reais', sentido: '+', valor: '5' } }],
    ['preço não numérico', { acao: 'reajustar', ml_item_ids: ['MLB1'], precos: { MLB1: 'x' } }],
    ['seleção vazia', { acao: 'reajustar', ml_item_ids: [] }],
    ['acima do teto', { acao: 'reajustar', ml_item_ids: Array.from({ length: 501 }, (_, i) => `MLB${i}`) }],
  ])('recusa: %s', (_n, corpo) => {
    expect(lerPreview(corpo)).toBeNull();
  });
});

describe('lerPreview — atacado por família', () => {
  const p = { acao: 'reajustar', ml_item_ids: ['MLB1'] };
  const faixa = (min_unidades: unknown, desconto_pct: unknown) => ({ min_unidades, desconto_pct });

  it('aceita até 5 faixas crescentes, sem carregar campo estranho', () => {
    const fs = [2, 3, 4, 5, 6].map((q) => faixa(q, 5));
    expect(lerPreview({ ...p, atacado: { [U]: fs.map((f) => ({ ...f, x: 1 })) } })?.atacado).toEqual({ [U]: fs });
  });
  it('só o atacado basta como pedido', () => {
    expect(lerPreview({ acao: 'reajustar', atacado: { [U]: [faixa(2, 5)] } })?.atacado).toEqual({ [U]: [faixa(2, 5)] });
  });
  it('sem atacado a chave não aparece', () => {
    expect(lerPreview(p)).not.toHaveProperty('atacado');
    expect(lerPreview({ ...p, atacado: {} })).not.toHaveProperty('atacado');
  });
  it.each([
    ['1 unidade', { [U]: [faixa(1, 5)] }],
    ['quantidade fracionada', { [U]: [faixa(2.5, 5)] }],
    ['fora de ordem', { [U]: [faixa(3, 5), faixa(2, 5)] }],
    ['quantidade repetida', { [U]: [faixa(2, 5), faixa(2, 6)] }],
    ['6 faixas', { [U]: [2, 3, 4, 5, 6, 7].map((q) => faixa(q, 5)) }],
    ['sem faixas', { [U]: [] }],
    ['desconto 0', { [U]: [faixa(2, 0)] }],
    ['desconto 100', { [U]: [faixa(2, 100)] }],
    ['desconto não numérico', { [U]: [faixa(2, '5')] }],
    ['família não uuid', { x: [faixa(2, 5)] }],
    ['não é objeto', [faixa(2, 5)]],
  ])('recusa: %s', (_n, atacado) => {
    expect(lerPreview({ ...p, atacado })).toBeNull();
  });
  it('recusa só atacado vazio', () => {
    expect(lerPreview({ acao: 'reajustar', atacado: {} })).toBeNull();
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
    expect(respostaConfirmar(`familia_parcial:${U}`)).toEqual({ publicar: false, status: 400, corpo: { erro: MSG_FAMILIA_PARCIAL, familia_id: U } });
  });
});

describe('linhasDoRascunho', () => {
  const base: ItemPreview = {
    ml_item_id: 'MLB1', codigo_pai: 'P1', variacao_ids: ['v1'], titulo: 'T', sku: null, preco_anterior: 100, preco: 110,
    avaliacao: { cores: [], pior: 'vermelho', tem_vermelho: true, tem_sem_dado: false },
    restaurar: [{ variacao_id: 'v1', esperado: { preco_publicacao: 100, preco_editado_pelo_operador: false }, novo: { preco_publicacao: 110, preco_editado_pelo_operador: true } }],
    variacoes_ml: ['1'], situacao: 'elegivel', motivo: null, incluido: false, aviso: null, ofertas: [],
    passos: [{ tipo: 'base', anterior: 100, alvo: 110, estado: 'pendente' }],
  };
  it('avaliacoes = preços avaliados; avaliacao segue o agregado que reajuste_confirmar lê', () => {
    const precos_avaliados = [{ tipo: 'faixa' as const, chave: '2', preco: 85.5, avaliacao: base.avaliacao! }];
    const [l] = linhasDoRascunho([{ ...base, precos_avaliados }]);
    expect(l).toMatchObject({ avaliacoes: precos_avaliados, avaliacao: base.avaliacao });
    expect(l).not.toHaveProperty('precos_avaliados');
  });

  it('status por situação; estado_anterior = restaurar; codigo_pai sempre gravado', () => {
    const [el, fora, igual] = linhasDoRascunho([
      base,
      { ...base, ml_item_id: 'MLB2', situacao: 'fora', motivo: 'Kit', preco: 0, preco_anterior: 0, avaliacao: null, restaurar: null, passos: null },
      { ...base, ml_item_id: 'MLB3', situacao: 'sem_alteracao', preco: 100, avaliacao: null, restaurar: null, passos: null },
    ]);
    expect(el).toMatchObject({ status: 'rascunho', estado_anterior: base.restaurar, codigo_pai: 'P1', semaforo: 'vermelho', incluido: false, preco: 110, preco_anterior: 100, variacao_ids: ['v1'], passos: base.passos });
    expect(el).not.toHaveProperty('ofertas');
    expect(fora).toMatchObject({ status: 'bloqueado', mensagem: 'Kit', preco: null, codigo_pai: 'P1', semaforo: null, passos: null });
    expect(igual).toMatchObject({ status: 'ja_estava', codigo_pai: 'P1', passos: null });
  });
});

describe('retomar', () => {
  it('lê só operacao_id uuid', () => {
    expect(lerRetomar({ etapa: 'retomar', operacao_id: U })).toEqual({ operacao_id: U });
    expect(lerRetomar({ etapa: 'retomar', operacao_id: 'x' })).toBeNull();
    expect(lerRetomar(null)).toBeNull();
  });

  it('só reajuste executando da org', () => {
    expect(decidirRetomar({ acao: 'reajustar', status: 'executando' })).toEqual({ ok: true });
    expect(decidirRetomar(null)).toMatchObject({ ok: false, status: 404 });
    expect(decidirRetomar({ acao: 'reajustar', status: 'concluida' })).toMatchObject({ ok: false, status: 400 });
    expect(decidirRetomar({ acao: 'reajustar', status: 'rascunho' })).toMatchObject({ ok: false, status: 400 });
    expect(decidirRetomar({ acao: 'pausar', status: 'executando' })).toMatchObject({ ok: false, status: 400 });
  });

  it('dedup novo por minuto, nunca o executar_<op>_0', () => {
    const t = Date.UTC(2026, 9, 4, 12, 0, 10);
    expect(idRetomada(U, t)).toBe(idRetomada(U, t + 40_000));
    expect(idRetomada(U, t)).not.toBe(idRetomada(U, t + 60_000));
    expect(idRetomada(U, t)).toMatch(/^retomar_/);
  });
});
