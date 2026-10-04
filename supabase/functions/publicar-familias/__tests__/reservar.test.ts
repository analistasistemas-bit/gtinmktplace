import { describe, it, expect, vi } from 'vitest';
import { reservarFamilias, mensagemTudoRecusado } from '../reservar';

const MOTIVO = 'Há reajuste de preço em massa em andamento no anúncio MLB1';

function fakeAdmin(rows: unknown[] | null, error: { message: string } | null = null) {
  const rpc = vi.fn(async () => ({ data: rows, error }));
  return { admin: { rpc } as never, rpc };
}

describe('reservarFamilias (claim via familia_reservar_publicacao)', () => {
  it('sem reajuste: repassa as mesmas colunas de antes (id, lote_id, user_id, codigo_pai)', async () => {
    const { admin, rpc } = fakeAdmin([
      { id: 'f1', lote_id: 'l1', user_id: 'u1', codigo_pai: 'P1', motivo: null },
      { id: 'f2', lote_id: 'l1', user_id: 'u2', codigo_pai: 'P2', motivo: null },
    ]);
    const r = await reservarFamilias(admin, 'org-1', ['f1', 'f2'], 'UPDATE');
    expect(rpc).toHaveBeenCalledWith('familia_reservar_publicacao', {
      p_org: 'org-1', p_familia_ids: ['f1', 'f2'], p_operacao: 'UPDATE',
    });
    expect(r).toStrictEqual({
      reservadas: [
        { id: 'f1', lote_id: 'l1', user_id: 'u1', codigo_pai: 'P1' },
        { id: 'f2', lote_id: 'l1', user_id: 'u2', codigo_pai: 'P2' },
      ],
      recusadas: [],
      error: null,
    });
  });

  it('com reajuste ativo: família vai para recusadas, não para a fila', async () => {
    const { admin } = fakeAdmin([
      { id: 'f1', lote_id: 'l1', user_id: 'u1', codigo_pai: 'P1', motivo: MOTIVO },
      { id: 'f2', lote_id: 'l1', user_id: 'u1', codigo_pai: 'P2', motivo: null },
    ]);
    const r = await reservarFamilias(admin, 'org-1', ['f1', 'f2'], 'CREATE');
    expect(r.reservadas.map((f) => f.id)).toEqual(['f2']);
    expect(r.recusadas).toEqual([{ familia_id: 'f1', motivo: MOTIVO }]);
  });

  it('erro da RPC é devolvido (vira 500, como o claim antigo)', async () => {
    const { admin } = fakeAdmin(null, { message: 'boom' });
    const r = await reservarFamilias(admin, 'org-1', ['f1'], 'CREATE');
    expect(r.error).toEqual({ message: 'boom' });
    expect(r.reservadas).toEqual([]);
  });
});

describe('mensagemTudoRecusado', () => {
  it('nada enfileirado e tudo recusado → 409 com o motivo', () => {
    expect(mensagemTudoRecusado(0, [{ familia_id: 'f1', motivo: MOTIVO }, { familia_id: 'f2', motivo: MOTIVO }]))
      .toBe(MOTIVO);
  });
  it('recusa parcial → resposta normal', () => {
    expect(mensagemTudoRecusado(1, [{ familia_id: 'f1', motivo: MOTIVO }])).toBeNull();
  });
  it('sem recusa → comportamento de hoje (inclusive 0 enfileiradas)', () => {
    expect(mensagemTudoRecusado(0, [])).toBeNull();
  });
});
