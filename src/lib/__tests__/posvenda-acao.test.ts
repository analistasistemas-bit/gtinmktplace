import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}));

import { ehAcaoPendente, executarAcaoPosvenda } from '../posvenda';

const OP = '11111111-1111-4111-8111-111111111111';

afterEach(() => vi.unstubAllGlobals());

describe('ehAcaoPendente', () => {
  it('409 em_andamento do posvenda-acao → pendente preservado pelo postEdge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false, erro: 'Outra ação está em andamento ou aguardando confirmação neste item', codigo: 'em_andamento',
      pendente: { operacao_id: OP, acao: 'reembolsar', estado: 'desconhecido' },
    }), { status: 409 })));
    const e = await executarAcaoPosvenda({ operacao_id: OP, claim_id: '10', acao: 'abrir_disputa' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(ehAcaoPendente(e)).toEqual({ operacao_id: OP, acao: 'reembolsar', estado: 'desconhecido' });
  });

  it('erro sem pendente (ou não-Error, ou pendente malformado) → null', () => {
    expect(ehAcaoPendente(new Error('x'))).toBeNull();
    expect(ehAcaoPendente('x')).toBeNull();
    expect(ehAcaoPendente(Object.assign(new Error('x'), { pendente: { acao: 'reembolsar' } }))).toBeNull();
  });
});
