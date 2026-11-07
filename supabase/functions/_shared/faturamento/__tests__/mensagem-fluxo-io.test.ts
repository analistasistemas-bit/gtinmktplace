import { afterEach, describe, expect, it, vi } from 'vitest';
import { depsMensagemReal } from '../mensagem-fluxo-io';

const CTX = { orgId: 'org-1', packId: '123', sellerId: '999', buyerId: '111', token: 'tk' };

/** Query encadeável que grava as chamadas e resolve com `resultado`, com ou sem `.single()`. */
function adminFalso(resultado: { data: unknown; error: { code?: string; message: string } | null }) {
  const chamadas: Array<[string, unknown[]]> = [];
  const query: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resultado).then(ok, ko),
  };
  for (const m of ['select', 'insert', 'update', 'eq', 'is', 'in', 'single', 'maybeSingle']) {
    query[m] = (...args: unknown[]) => { chamadas.push([m, args]); return query; };
  }
  const admin = { from: () => query } as unknown as Parameters<typeof depsMensagemReal>[0];
  return { admin, chamadas };
}

const semBanco = adminFalso({ data: null, error: null }).admin;
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status });

afterEach(() => { vi.unstubAllGlobals(); });

describe('depsMensagemReal.lerConversa', () => {
  it('mapeia a mensagem do ML sem marcar como lida', async () => {
    const f = vi.fn().mockResolvedValue(resposta(200, {
      paging: { total: 2 },
      messages: [
        { id: 'a', from: { user_id: 999 }, text: 'oi', message_attachments: [{ filename: '999_x.png' }], message_moderation: { status: 'clean' } },
        { id: 'b', from: { user_id: 111 }, text: null },
      ],
    }));
    vi.stubGlobal('fetch', f);

    await expect(depsMensagemReal(semBanco, CTX).lerConversa()).resolves.toEqual([
      { id: 'a', deVendedor: true, texto: 'oi', anexos: ['999_x.png'], moderacao: 'clean' },
      { id: 'b', deVendedor: false, texto: '', anexos: [], moderacao: null },
    ]);
    expect(f.mock.calls[0][0]).toContain('/messages/packs/123/sellers/999?tag=post_sale&mark_as_read=false');
  });

  it('lê todas as páginas: o snapshot não pode parar na primeira', async () => {
    const pagina = (de: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${de + i}`, from: { user_id: 111 }, text: 'x' }));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(resposta(200, { paging: { total: 12 }, messages: pagina(0, 10) }))
      .mockResolvedValueOnce(resposta(200, { paging: { total: 12 }, messages: pagina(10, 2) })));

    await expect(depsMensagemReal(semBanco, CTX).lerConversa()).resolves.toHaveLength(12);
  });

  it.each([403, 404, 500])('HTTP %i lança em vez de devolver conversa vazia', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta(status, {})));
    await expect(depsMensagemReal(semBanco, CTX).lerConversa()).rejects.toThrow();
  });

  it('falha de rede lança', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('rede')));
    await expect(depsMensagemReal(semBanco, CTX).lerConversa()).rejects.toThrow('rede');
  });
});

describe('depsMensagemReal.postML', () => {
  it('envia texto e anexo e devolve status e corpo', async () => {
    const f = vi.fn().mockResolvedValue(resposta(201, { id: 'm1' }));
    vi.stubGlobal('fetch', f);

    await expect(depsMensagemReal(semBanco, CTX).postML({ texto: 'Olá', anexo: 'a.png' }))
      .resolves.toEqual({ status: 201, body: { id: 'm1' } });
    expect(f.mock.calls[0][0]).toBe('https://api.mercadolibre.com/messages/packs/123/sellers/999?tag=post_sale');
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({
      from: { user_id: '999' }, to: { user_id: '111' }, text: 'Olá', attachments: ['a.png'],
    });
  });

  it('corpo que não é JSON vira { texto }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })));
    await expect(depsMensagemReal(semBanco, CTX).postML({ texto: 'Olá', anexo: null }))
      .resolves.toEqual({ status: 502, body: { texto: 'Bad Gateway' } });
  });

  it('rede ou timeout devolve status null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(depsMensagemReal(semBanco, CTX).postML({ texto: 'Olá', anexo: null }))
      .resolves.toEqual({ status: null, body: null });
  });
});

describe('depsMensagemReal.erroRecusa', () => {
  const erroRecusa = depsMensagemReal(semBanco, CTX).erroRecusa;

  it('traduz o bloqueio e preserva blocked_by_claim para a edge', () => {
    expect(erroRecusa(403, { message: 'blocked_by_cancelled_order' })).toBe('Não é possível responder porque o pedido foi cancelado.');
    expect(erroRecusa(403, { message: 'blocked_by_claim' })).toContain('blocked_by_claim');
  });

  it('sem corpo mantém o status', () => {
    expect(erroRecusa(400, null)).toMatch(/^ML \/messages 400/);
  });
});

describe('depsMensagemReal.inserir', () => {
  const nova = {
    org_id: 'org-1', user_id: 'u', operacao_id: 'op', pack_id: '123', recurso: 'mensagem:123', acao: 'responder_mensagem' as const,
    payload: { texto: 'Olá', anexo: null }, payload_hash: 'h',
  };

  it('grava como reservada', async () => {
    const { admin, chamadas } = adminFalso({ data: { id: 't1', pack_id: '123' }, error: null });
    await expect(depsMensagemReal(admin, CTX).inserir(nova)).resolves.toEqual({ id: 't1', pack_id: '123' });
    expect(chamadas[0]).toEqual(['insert', [{ ...nova, estado: 'reservada' }]]);
  });

  it.each([
    ['ml_posvenda_acoes_operacao_uniq', 'conflito_operacao'],
    ['ml_posvenda_acoes_trava_uniq', 'conflito_recurso'],
  ])('23505 em %s vira %s', async (indice, literal) => {
    const { admin } = adminFalso({ data: null, error: { code: '23505', message: `duplicate key violates "${indice}"` } });
    await expect(depsMensagemReal(admin, CTX).inserir(nova)).resolves.toBe(literal);
  });

  it('outro erro lança', async () => {
    const { admin } = adminFalso({ data: null, error: { code: '23514', message: 'check' } });
    await expect(depsMensagemReal(admin, CTX).inserir(nova)).rejects.toThrow('check');
  });
});

describe('depsMensagemReal.atualizar', () => {
  it('filtra por org e estado; postEmNulo exige post_em nulo', async () => {
    const { admin, chamadas } = adminFalso({ data: [{ id: 't1' }], error: null });
    await expect(depsMensagemReal(admin, CTX).atualizar('t1', { estado: 'reservada', postEmNulo: true }, { estado: 'enviada' }))
      .resolves.toEqual({ id: 't1' });
    expect(chamadas).toEqual(expect.arrayContaining([
      ['eq', ['id', 't1']], ['eq', ['org_id', 'org-1']], ['eq', ['estado', 'reservada']], ['is', ['post_em', null]],
    ]));
  });

  it('0 linhas devolve null', async () => {
    const { admin } = adminFalso({ data: [], error: null });
    await expect(depsMensagemReal(admin, CTX).atualizar('t1', { estado: 'reservada' }, {})).resolves.toBeNull();
  });
});
