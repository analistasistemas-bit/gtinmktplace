import { describe, it, expect } from 'vitest';
import {
  ACAO_ML, chaveRecurso, destinatarioResposta, efeitoConfirmado, mlAceitaAinda, montarRequisicao, validarAcao,
  type AcaoPosvenda, type DetalheReclamacao, type MensagemHistorico, type Resolucao,
} from '../posvenda';

const POST = '2026-10-28T12:00:00.000Z';
const DEPOIS_DO_POST = '2026-10-28T12:00:05.000Z';
const ANTES_DO_POST = '2026-10-28T11:00:00.000Z';

const det = (over: Partial<DetalheReclamacao> = {}): DetalheReclamacao => ({
  claim_id: 10, return_id: 77, stage: 'claim', status: 'opened',
  estado: { titulo: null, descricao: null, problema: null, prazo: null, vez_de: 'vendedor' },
  comprador_quer: null, resolucoes: [], resolucao_final: null, afeta_reputacao: null, custo_devolucao: null,
  historico: [], acoes: [], revisoes: [], pedidos_devolucao: [500], motivos_falha_revisao: [],
  reembolso_parcial: null, incompleto: [], ...over,
});
const MOTIVOS = [
  { id: 'SRF2', texto: 'avariado', exige_foto: true, aplica: ['order'] },
  { id: 'SRF5', texto: 'não está no pacote', exige_foto: false, aplica: ['order', 'package'] },
  { id: 'SRF7', texto: 'não chegou', exige_foto: false, aplica: ['package'] },
];
const tent = (payload: Record<string, unknown>, http_status: number | null = 200) => ({ payload, post_em: POST, http_status });
const msg = (over: Partial<MensagemHistorico>): MensagemHistorico => ({
  data: DEPOIS_DO_POST, autor: 'vendedor', destinatario: 'comprador', texto: 'Olá', anexos: [], status: 'available', moderacao: 'clean', ...over,
});
const res = (over: Partial<Resolucao>): Resolucao => ({
  papel: 'respondent', tipo: 'refund', status: 'accepted', detalhes: [], criada_em: DEPOIS_DO_POST, atualizada_em: DEPOIS_DO_POST, ...over,
});

describe('ACAO_ML / mlAceitaAinda', () => {
  it('mapa exato do brief', () => {
    expect(ACAO_ML).toEqual({
      revisar_ok: ['return_review_ok'], revisar_falha: ['return_review_fail'],
      responder: ['send_message_to_complainant', 'send_message_to_mediator'], reembolsar: ['refund'],
      reembolso_parcial: ['allow_partial_refund'], autorizar_devolucao: ['allow_return', 'allow_return_label'],
      abrir_disputa: ['open_dispute'],
    });
  });
  it('revisão: aceita enquanto houver pedido pending, mesmo fora de available_actions; closed sozinho não libera', () => {
    expect(mlAceitaAinda('revisar_ok', det({ status: 'closed', revisoes: [{ order_id: 500, seller_status: 'pending' }] }))).toBe(true);
    expect(mlAceitaAinda('revisar_ok', det({ status: 'closed', revisoes: [{ order_id: 500, seller_status: 'success' }] }))).toBe(false);
    expect(mlAceitaAinda('reembolsar', det({ status: 'closed', acoes: ['refund'] }))).toBe(true);
    expect(mlAceitaAinda('reembolsar', det({ acoes: ['open_dispute'] }))).toBe(false);
  });
});

describe('destinatarioResposta', () => {
  it('claim → complainant; dispute → mediator; só send_message_to_mediator → mediator', () => {
    expect(destinatarioResposta(['send_message_to_complainant', 'send_message_to_mediator'], 'claim')).toBe('complainant');
    expect(destinatarioResposta(['send_message_to_complainant', 'send_message_to_mediator'], 'dispute')).toBe('mediator');
    expect(destinatarioResposta(['send_message_to_mediator'], 'claim')).toBe('mediator');
  });
});

describe('chaveRecurso', () => {
  it('revisar_ok e revisar_falha do mesmo return → mesma chave; resoluções compartilham; responder separado', () => {
    expect(chaveRecurso('revisar_ok', 10, 77)).toBe('return:77');
    expect(chaveRecurso('revisar_falha', 10, 77)).toBe(chaveRecurso('revisar_ok', 10, 77));
    for (const a of ['reembolsar', 'reembolso_parcial', 'autorizar_devolucao', 'abrir_disputa'] as AcaoPosvenda[]) {
      expect(chaveRecurso(a, 10, 77)).toBe('claim:10:resolucao');
    }
    expect(chaveRecurso('responder', 10, 77)).toBe('claim:10:msg');
  });
});

describe('validarAcao', () => {
  const revisao = det({ acoes: ['return_review_ok', 'return_review_fail'], motivos_falha_revisao: MOTIVOS, revisoes: [{ order_id: 500, seller_status: 'pending' }] });
  it('ação não liberada pelo ML → recusa', () => {
    expect(validarAcao('reembolsar', {}, det({ acoes: ['open_dispute'] }))).toMatch(/não está liberada/);
    expect(validarAcao('revisar_ok', {}, revisao)).toBeNull();
  });
  it('SRF5 sem foto ok; SRF2 sem foto recusa; texto obrigatório; motivo desconhecido recusa', () => {
    expect(validarAcao('revisar_falha', { revisoes: [{ motivo_id: 'SRF5', texto: 'faltou', anexos: [] }] }, revisao)).toBeNull();
    expect(validarAcao('revisar_falha', { revisoes: [{ motivo_id: 'SRF2', texto: 'quebrado', anexos: [] }] }, revisao)).toMatch(/foto/);
    expect(validarAcao('revisar_falha', { revisoes: [{ motivo_id: 'SRF2', texto: 'quebrado', anexos: ['f.jpg'] }] }, revisao)).toBeNull();
    expect(validarAcao('revisar_falha', { revisoes: [{ motivo_id: 'SRF5', texto: '  ', anexos: [] }] }, revisao)).toMatch(/descri/);
    expect(validarAcao('revisar_falha', { revisoes: [{ motivo_id: 'SRF9', texto: 'x', anexos: [] }] }, revisao)).toMatch(/[Mm]otivo/);
    expect(validarAcao('revisar_falha', { revisoes: [] }, revisao)).toMatch(/motivo/);
  });
  it('não-carrinho: aplica:[order] vale sem order_id', () => {
    expect(validarAcao('revisar_falha', { revisoes: [{ motivo_id: 'SRF2', texto: 'x', anexos: ['a.jpg'] }] }, revisao)).toBeNull();
  });
  it('carrinho: order_id fora da devolução recusa; pacote exige aplica package; pedido exige aplica order', () => {
    const cart = det({ ...revisao, pedidos_devolucao: [500, 501] });
    expect(validarAcao('revisar_falha', { revisoes: [{ order_id: 999, motivo_id: 'SRF5', texto: 'x', anexos: [] }] }, cart)).toMatch(/pedido/);
    expect(validarAcao('revisar_falha', { revisoes: [{ order_id: 501, motivo_id: 'SRF5', texto: 'x', anexos: [] }] }, cart)).toBeNull();
    expect(validarAcao('revisar_falha', { revisoes: [{ order_id: 501, motivo_id: 'SRF7', texto: 'x', anexos: [] }] }, cart)).toMatch(/pedido/);
    expect(validarAcao('revisar_falha', { revisoes: [{ motivo_id: 'SRF7', texto: 'x', anexos: [] }] }, cart)).toBeNull();
    expect(validarAcao('revisar_falha', { revisoes: [{ motivo_id: 'SRF2', texto: 'x', anexos: ['a.jpg'] }] }, cart)).toMatch(/pacote/);
  });
  it('responder: 1..2000 caracteres e o send_message do destinatário liberado', () => {
    const d = det({ acoes: ['send_message_to_complainant', 'send_message_to_mediator'] });
    expect(validarAcao('responder', { texto: 'oi' }, d)).toBeNull();
    expect(validarAcao('responder', { texto: '   ' }, d)).toMatch(/2000/);
    expect(validarAcao('responder', { texto: 'x'.repeat(2001) }, d)).toMatch(/2000/);
    expect(validarAcao('responder', { texto: 'oi' }, det({ stage: 'dispute', acoes: ['send_message_to_complainant'] }))).toMatch(/não está liberada/);
  });
  it('reembolso_parcial: percentual precisa estar nas ofertas', () => {
    const d = det({ acoes: ['allow_partial_refund'], reembolso_parcial: { ofertas: [{ percentual: 50, valor: 25 }], minimo: 50 } });
    expect(validarAcao('reembolso_parcial', { percentual: 50 }, d)).toBeNull();
    expect(validarAcao('reembolso_parcial', { percentual: 35 }, d)).toMatch(/percentual/i);
    expect(validarAcao('reembolso_parcial', {}, d)).toMatch(/percentual/i);
  });
});

describe('montarRequisicao', () => {
  const R = '/post-purchase/v1';
  it('as 7 ações', () => {
    expect(montarRequisicao('revisar_ok', 10, 77, {}, 'complainant')).toEqual({ path: `${R}/returns/77/return-review`, corpo: {} });
    expect(montarRequisicao('revisar_falha', 10, 77, { revisoes: [{ motivo_id: 'SRF2', texto: 'quebrado', anexos: ['a.jpg'] }] }, 'complainant'))
      .toEqual({ path: `${R}/returns/77/return-review`, corpo: [{ reason: 'SRF2', message: 'quebrado', attachments: ['a.jpg'] }] });
    expect(montarRequisicao('responder', 10, 77, { texto: ' Olá ', anexos: ['b.pdf'] }, 'mediator'))
      .toEqual({ path: `${R}/claims/10/actions/send-message`, corpo: { receiver_role: 'mediator', message: 'Olá', attachments: ['b.pdf'] } });
    expect(montarRequisicao('responder', 10, 77, { texto: 'oi' }, 'complainant').corpo)
      .toEqual({ receiver_role: 'complainant', message: 'oi', attachments: [] });
    expect(montarRequisicao('reembolsar', 10, 77, {}, 'complainant')).toEqual({ path: `${R}/claims/10/expected-resolutions/refund`, corpo: {} });
    expect(montarRequisicao('reembolso_parcial', 10, 77, { percentual: 50 }, 'complainant'))
      .toEqual({ path: `${R}/claims/10/expected-resolutions/partial-refund`, corpo: { percentage: 50 } });
    expect(montarRequisicao('autorizar_devolucao', 10, 77, {}, 'complainant')).toEqual({ path: `${R}/claims/10/expected-resolutions/allow-return`, corpo: {} });
    expect(montarRequisicao('abrir_disputa', 10, 77, {}, 'complainant')).toEqual({ path: `${R}/claims/10/actions/open-dispute`, corpo: {} });
  });
  it('carrinho com 2 pedidos: order_id em cada item', () => {
    const { corpo } = montarRequisicao('revisar_falha', 10, 77, { revisoes: [
      { order_id: 500, motivo_id: 'SRF5', texto: 'faltou', anexos: [] },
      { order_id: 501, motivo_id: 'SRF2', texto: 'quebrou', anexos: ['x.png'] },
    ] }, 'complainant');
    expect(corpo).toEqual([
      { reason: 'SRF5', message: 'faltou', attachments: [], order_id: 500 },
      { reason: 'SRF2', message: 'quebrou', attachments: ['x.png'], order_id: 501 },
    ]);
  });
});

describe('efeitoConfirmado', () => {
  const ACOES_MSG = ['send_message_to_complainant', 'send_message_to_mediator'];
  it('responder: publicada (clean) com a ação ainda liberada → confirmado', () => {
    const antes = det({ acoes: ACOES_MSG });
    const depois = det({ acoes: ACOES_MSG, historico: [msg({ anexos: [{ id: 'a.jpg', nome: 'foto.jpg' }] })] });
    expect(efeitoConfirmado('responder', antes, depois, tent({ texto: 'Olá', anexos: ['a.jpg'] }))).toBe('confirmado');
  });
  it('responder: moderação pendente → inconclusivo; rejeitada → nao; texto/anexo/destinatário diferentes ou antiga → inconclusivo', () => {
    const antes = det({ acoes: ACOES_MSG });
    const t = tent({ texto: 'Olá', anexos: [] });
    expect(efeitoConfirmado('responder', antes, det({ historico: [msg({ moderacao: 'pending' })] }), t)).toBe('inconclusivo');
    expect(efeitoConfirmado('responder', antes, det({ historico: [msg({ moderacao: 'rejected' })] }), t)).toBe('nao');
    expect(efeitoConfirmado('responder', antes, det({ historico: [msg({ texto: 'Outro' })] }), t)).toBe('inconclusivo');
    expect(efeitoConfirmado('responder', antes, det({ historico: [msg({ anexos: [{ id: 'z.jpg', nome: 'z' }] })] }), t)).toBe('inconclusivo');
    expect(efeitoConfirmado('responder', antes, det({ historico: [msg({ destinatario: 'ml' })] }), t)).toBe('inconclusivo');
    expect(efeitoConfirmado('responder', antes, det({ historico: [msg({ data: ANTES_DO_POST })] }), t)).toBe('inconclusivo');
  });
  it('responder: mesma mensagem já existia antes (data posterior por coincidência) não conta', () => {
    const m = msg({});
    expect(efeitoConfirmado('responder', det({ acoes: ACOES_MSG, historico: [m] }), det({ historico: [m] }), tent({ texto: 'Olá' }))).toBe('inconclusivo');
  });
  it('revisar_ok: pending → success com 2xx → confirmado; após timeout → inconclusivo; failed → nao', () => {
    const antes = det({ revisoes: [{ order_id: 500, seller_status: 'pending' }] });
    const depois = det({ revisoes: [{ order_id: 500, seller_status: 'success' }] });
    expect(efeitoConfirmado('revisar_ok', antes, depois, tent({}, 200))).toBe('confirmado');
    expect(efeitoConfirmado('revisar_ok', antes, depois, tent({}, null))).toBe('inconclusivo');
    expect(efeitoConfirmado('revisar_ok', antes, depois, tent({}, 503))).toBe('inconclusivo');
    expect(efeitoConfirmado('revisar_ok', antes, det({ revisoes: [{ order_id: 500, seller_status: 'failed' }] }), tent({}, 200))).toBe('nao');
    expect(efeitoConfirmado('revisar_ok', det({ revisoes: [{ order_id: 500, seller_status: 'success' }] }), depois, tent({}, 200))).toBe('nao');
  });
  it('revisar_falha: pending → claimed/failed → confirmado (mesmo sem 2xx); success sem 2xx → inconclusivo', () => {
    const antes = det({ revisoes: [{ order_id: 500, seller_status: 'pending' }, { order_id: 501, seller_status: 'pending' }] });
    const p = { revisoes: [{ order_id: 500, motivo_id: 'SRF5', texto: 'x', anexos: [] }] };
    expect(efeitoConfirmado('revisar_falha', antes, det({ revisoes: [{ order_id: 500, seller_status: 'claimed' }, { order_id: 501, seller_status: 'pending' }] }), tent(p, null))).toBe('confirmado');
    expect(efeitoConfirmado('revisar_falha', antes, det({ revisoes: [{ order_id: 500, seller_status: 'failed' }] }), tent(p, 200))).toBe('confirmado');
    expect(efeitoConfirmado('revisar_falha', antes, det({ revisoes: [{ order_id: 500, seller_status: 'success' }] }), tent(p, null))).toBe('inconclusivo');
    expect(efeitoConfirmado('revisar_falha', antes, det({ revisoes: [{ order_id: 500, seller_status: 'pending' }] }), tent(p, 200))).toBe('nao');
  });
  it('reembolsar: resolução refund aceita do vendedor criada após o POST → confirmado; closed por reembolso → confirmado', () => {
    expect(efeitoConfirmado('reembolsar', det(), det({ resolucoes: [res({})] }), tent({}))).toBe('confirmado');
    expect(efeitoConfirmado('reembolsar', det(), det({ status: 'closed', resolucao_final: { motivo: 'payment_refunded', data: DEPOIS_DO_POST } }), tent({}))).toBe('confirmado');
  });
  it('reembolsar: refund pendente do comprador após o POST → nao; mudança externa de stage → nao; resolução antiga → nao', () => {
    expect(efeitoConfirmado('reembolsar', det(), det({ resolucoes: [res({ papel: 'complainant', status: 'pending' })] }), tent({}))).toBe('nao');
    expect(efeitoConfirmado('reembolsar', det({ stage: 'claim' }), det({ stage: 'dispute' }), tent({}))).toBe('nao');
    const velha = res({ criada_em: ANTES_DO_POST });
    expect(efeitoConfirmado('reembolsar', det({ resolucoes: [velha] }), det({ resolucoes: [velha] }), tent({}))).toBe('nao');
    expect(efeitoConfirmado('reembolsar', det(), det({ status: 'closed', resolucao_final: { motivo: 'partial_refunded', data: DEPOIS_DO_POST } }), tent({}))).toBe('nao');
    expect(efeitoConfirmado('reembolsar', det(), det({ status: 'closed', resolucao_final: { motivo: 'payment_refunded', data: ANTES_DO_POST } }), tent({}))).toBe('nao');
  });
  it('reembolso_parcial: oferta nova com o percentual pedido → confirmado; percentual diferente → nao', () => {
    const oferta = (v: string) => res({ tipo: 'partial_refund', status: 'pending', detalhes: [{ chave: 'percentage', valor: v }] });
    expect(efeitoConfirmado('reembolso_parcial', det(), det({ resolucoes: [oferta('50.0')] }), tent({ percentual: 50 }))).toBe('confirmado');
    expect(efeitoConfirmado('reembolso_parcial', det(), det({ resolucoes: [oferta('35.0')] }), tent({ percentual: 50 }))).toBe('nao');
    expect(efeitoConfirmado('reembolso_parcial', det(), det(), tent({ percentual: 50 }))).toBe('nao');
  });
  it('autorizar_devolucao: return_id passou a existir; abrir_disputa: claim → dispute', () => {
    expect(efeitoConfirmado('autorizar_devolucao', det({ return_id: null }), det({ return_id: 88 }), tent({}))).toBe('confirmado');
    expect(efeitoConfirmado('autorizar_devolucao', det({ return_id: 77 }), det({ return_id: 77 }), tent({}))).toBe('nao');
    expect(efeitoConfirmado('abrir_disputa', det({ stage: 'claim' }), det({ stage: 'dispute' }), tent({}))).toBe('confirmado');
    expect(efeitoConfirmado('abrir_disputa', det({ stage: 'claim' }), det({ stage: 'claim' }), tent({}))).toBe('nao');
  });
});
