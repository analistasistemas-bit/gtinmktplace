import { describe, expect, it } from 'vitest';
import {
  classificar, ordenarFila, subAbaDe, acaoLiberada, chaveRecurso, travada, type ItemFila,
} from '../posvenda-fila';

const AGORA = new Date('2026-10-28T12:00:00Z');
const item = (p: Partial<ItemFila> = {}): ItemFila => ({
  claim_id: 1, status: 'opened', type: 'returns', return_id: null, vez_de: null,
  revisao_pendente: false, prazo: null, acoes_pendentes: null, ...p,
});

describe('classificar', () => {
  it('revisao_pendente é urgente mesmo com claim closed', () => {
    expect(classificar(item({ status: 'closed', revisao_pendente: true }))).toBe('urgente');
  });
  it('opened na vez do vendedor é urgente', () => {
    expect(classificar(item({ vez_de: 'vendedor' }))).toBe('urgente');
  });
  it('opened com ação mandatory é urgente', () => {
    expect(classificar(item({ acoes_pendentes: [{ action: 'refund', due_date: null, mandatory: true }] }))).toBe('urgente');
  });
  it('opened restante é andamento', () => {
    expect(classificar(item({ vez_de: 'comprador', acoes_pendentes: [{ action: 'x', due_date: null, mandatory: false }] }))).toBe('andamento');
  });
  it('closed sem revisão é concluída', () => {
    expect(classificar(item({ status: 'closed', vez_de: 'vendedor' }))).toBe('concluida');
  });
});

describe('ordenarFila', () => {
  it('vencidas primeiro, prazo asc, sem prazo no fim; não muta a entrada', () => {
    const a = item({ claim_id: 1, prazo: null });
    const b = item({ claim_id: 2, prazo: '2026-10-30T00:00:00Z' });
    const c = item({ claim_id: 3, prazo: '2026-10-27T00:00:00Z' }); // vencida
    const d = item({ claim_id: 4, prazo: '2026-10-29T00:00:00Z' });
    const entrada = [a, b, c, d];
    expect(ordenarFila(entrada, AGORA).map((x) => x.claim_id)).toEqual([3, 4, 2, 1]);
    expect(entrada.map((x) => x.claim_id)).toEqual([1, 2, 3, 4]);
  });
});

describe('subAbaDe', () => {
  it('returns com return_id vai para devoluções; o resto para reclamações', () => {
    expect(subAbaDe(item({ type: 'returns', return_id: 9 }))).toBe('devolucoes');
    expect(subAbaDe(item({ type: 'returns', return_id: null }))).toBe('reclamacoes');
    expect(subAbaDe(item({ type: 'mediations' }))).toBe('reclamacoes');
    expect(subAbaDe(item({ type: 'cancel_purchase' }))).toBe('reclamacoes');
  });
});

describe('acaoLiberada / travada', () => {
  it('lê available_actions do ML; revisão também vale com pedido pending', () => {
    expect(acaoLiberada('reembolsar', { acoes: ['refund'], revisoes: [] })).toBe(true);
    expect(acaoLiberada('reembolsar', { acoes: [], revisoes: [] })).toBe(false);
    expect(acaoLiberada('responder', { acoes: ['send_message_to_mediator'], revisoes: [] })).toBe(true);
    expect(acaoLiberada('revisar_ok', { acoes: [], revisoes: [{ seller_status: 'pending' }] })).toBe(true);
    expect(acaoLiberada('revisar_ok', { acoes: [], revisoes: [{ seller_status: 'success' }] })).toBe(false);
  });
  it('trava por recurso: revisão por return_id, mensagem por claim, resto por resolução', () => {
    expect(chaveRecurso('revisar_falha', 5, 7)).toBe('return:7');
    expect(chaveRecurso('responder', 5, 7)).toBe('claim:5:msg');
    expect(chaveRecurso('reembolsar', 5, 7)).toBe('claim:5:resolucao');
    const ativas = [{ recurso: 'claim:5:resolucao', claim_id: 5, estado: 'enviada' }];
    expect(travada(ativas, 'abrir_disputa', 5, null)).toBe(true);
    expect(travada(ativas, 'responder', 5, null)).toBe(false);
  });
});
