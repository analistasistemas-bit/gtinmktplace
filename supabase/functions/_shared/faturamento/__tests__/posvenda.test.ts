import { describe, it, expect } from 'vitest';
import { autorDoPapel, montarHistorico, motivosRevisao, ofertasReembolso } from '../posvenda';

// Medido em 28/10 (Avil), claim não-carrinho: todos os motivos aplicam ao pedido.
const REAL = [
  { id: 'SRF2', name: 'product_damaged', detail: 'O produto chegou avariado', position: 1, apply: ['order'] },
  { id: 'SRF3', name: 'incomplete', detail: 'A devolução está incompleta', position: 2, apply: ['order'] },
  { id: 'SRF4', name: 'different', detail: 'O produto devolvido é diferente do que eu enviei', position: 3, apply: ['order'] },
  { id: 'SRF5', name: 'not_in_package', detail: 'O produto não está no pacote', position: 4, apply: ['order'] },
  { id: 'SRF6', name: 'other_defect', detail: 'Reportar outro defeito no produto', position: 5, apply: ['order'] },
  { id: 'SRF7', name: 'not_arrived', detail: 'Ainda não chegou', position: 6, apply: ['order'] },
];
// Doc (carrinho): apply distingue pedido e pacote.
const CARRINHO = [
  { id: 'SRF5', detail: 'O produto não está no pacote', apply: ['order', 'package'] },
  { id: 'SRF7', detail: 'Ainda não chegou', apply: ['package'] },
];

describe('autorDoPapel', () => {
  it('mediator → ml; papel da conta → vendedor; resto → comprador', () => {
    expect(autorDoPapel('mediator', 'respondent')).toBe('ml');
    expect(autorDoPapel('respondent', 'respondent')).toBe('vendedor');
    expect(autorDoPapel('complainant', 'respondent')).toBe('comprador');
    expect(autorDoPapel('complainant', null)).toBe('comprador');
  });
});

describe('montarHistorico', () => {
  it('ordena por data, mapeia autor/destinatário/anexos/moderação', () => {
    const h = montarHistorico([
      { sender_role: 'mediator', receiver_role: 'respondent', message: 'ML', date_created: '2026-10-02T10:00:00Z', attachments: [], status: 'available', message_moderation: { status: 'clean' } },
      { sender_role: 'complainant', receiver_role: 'respondent', message: 'oi', date_created: '2026-10-01T10:00:00Z', attachments: [{ filename: 'a_x.jpg', original_filename: 'foto.jpg' }], message_moderation: { status: 'rejected' } },
    ], 'respondent');
    expect(h.map((m) => m.autor)).toEqual(['comprador', 'ml']);
    expect(h[0]).toMatchObject({ destinatario: 'vendedor', anexos: ['foto.jpg'], moderacao: 'rejected', status: null });
    expect(h[1]).toMatchObject({ texto: 'ML', status: 'available', moderacao: 'clean' });
  });
  it('resposta inválida → []', () => {
    expect(montarHistorico(null, 'respondent')).toEqual([]);
  });
});

describe('motivosRevisao', () => {
  it('real: 6 SRF, exige foto só SRF2 e SRF4, aplica = apply', () => {
    const m = motivosRevisao(REAL);
    expect(m).toHaveLength(6);
    expect(m.filter((x) => x.exige_foto).map((x) => x.id)).toEqual(['SRF2', 'SRF4']);
    expect(m.every((x) => x.aplica.length === 1 && x.aplica[0] === 'order')).toBe(true);
    expect(m[0].texto).toBe('O produto chegou avariado');
  });
  it('carrinho (doc): preserva apply', () => {
    const m = motivosRevisao(CARRINHO);
    expect(m.find((x) => x.id === 'SRF7')?.aplica).toEqual(['package']);
    expect(m.find((x) => x.id === 'SRF5')?.aplica).toEqual(['order', 'package']);
  });
  it('lixo → []', () => { expect(motivosRevisao({})).toEqual([]); });
});

describe('ofertasReembolso', () => {
  it('exclui 100% e lê o mínimo', () => {
    const r = ofertasReembolso({
      available_offers: [{ amount: 855, percentage: 90 }, { amount: 950, percentage: 100 }],
      restrictions: [{ percentage: 10, reason: 'x', type: 'minimum' }],
    });
    expect(r).toEqual({ ofertas: [{ percentual: 90, valor: 855 }], minimo: 10 });
  });
  it('sem restrição → minimo null; resposta inválida → null', () => {
    expect(ofertasReembolso({ available_offers: [{ amount: 1, percentage: 50 }] })?.minimo).toBeNull();
    expect(ofertasReembolso(null)).toBeNull();
  });
});
