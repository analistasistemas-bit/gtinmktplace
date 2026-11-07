import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fronteiras = vi.hoisted(() => ({
  serve: vi.fn(),
  token: vi.fn(),
  meta: vi.fn(),
  comprador: vi.fn(),
  enviar: vi.fn(),
  verificar: vi.fn(),
  liberar: vi.fn(),
  deps: vi.fn(() => ({ fake: true })),
  buscarPack: vi.fn(),
  upsert: vi.fn(),
  auditar: vi.fn().mockResolvedValue(undefined),
  marcarCancelada: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn().mockResolvedValue({ userId: 'user-1', orgId: 'org-1', isAdmin: false, support: null }),
}));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        update: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: { criado_por: 'owner-1' }, error: null }),
      };
      return query;
    },
  }),
}));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: fronteiras.auditar }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: fronteiras.token }));
vi.mock('../../_shared/canais/conexao.ts', () => ({
  mapearConexao: () => ({ contaExternaId: 'seller-1' }),
}));
vi.mock('../../_shared/faturamento/mensagem-fluxo.ts', () => ({
  enviarMensagem: fronteiras.enviar,
  verificarEnvio: fronteiras.verificar,
  liberarEnvio: fronteiras.liberar,
}));
vi.mock('../../_shared/faturamento/mensagem-fluxo-io.ts', () => ({ depsMensagemReal: fronteiras.deps }));
vi.mock('../../_shared/faturamento/mensagens-io.ts', () => ({
  buscarMensagensPack: fronteiras.buscarPack,
  pedidoCancelado: (status: string | null | undefined) => status === 'cancelled',
  resolverMetaPack: fronteiras.meta,
  resolverCompradorId: fronteiras.comprador,
  upsertMensagens: fronteiras.upsert,
  marcarConversaCancelada: (...args: unknown[]) => fronteiras.marcarCancelada(...args),
  ERRO_PEDIDO_CANCELADO: 'Não é possível responder porque o pedido foi cancelado.',
  CODIGO_PEDIDO_CANCELADO: 'pedido_cancelado',
  ERRO_EM_MEDIACAO: 'Reclamação em mediação.',
}));

const OP = '11111111-2222-4333-8444-555555555555';
const recusa = (erro: string) => ({
  http: 422, ok: false, estado: 'recusada', operacao_id: OP, pendenteConfirmacao: false, erro, codigo: 'reconectar',
});
const sucesso = (estado: string, extra: Record<string, unknown> = {}) => ({
  http: 200, ok: true, estado, operacao_id: OP, pendenteConfirmacao: false, ...extra,
});
const chamar = (corpo: unknown) => handler(new Request('http://localhost', { method: 'POST', body: JSON.stringify(corpo) }));

let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: fronteiras.serve });
  await import('../index.ts');
  handler = fronteiras.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

beforeEach(() => {
  for (const f of [fronteiras.token, fronteiras.comprador, fronteiras.enviar, fronteiras.verificar, fronteiras.liberar,
    fronteiras.deps, fronteiras.buscarPack, fronteiras.upsert, fronteiras.auditar, fronteiras.marcarCancelada]) f.mockClear();
  fronteiras.meta.mockReset();
  fronteiras.meta.mockResolvedValue({ orderStatus: 'paid' });
  fronteiras.token.mockResolvedValue('token-ml');
  fronteiras.comprador.mockResolvedValue('buyer-1');
  fronteiras.buscarPack.mockResolvedValue([]);
});

describe('responder-mensagem — pedido cancelado', () => {
  it('retorna 409 estruturado e persiste cancelamento sem renovar token, resolver comprador ou enviar', async () => {
    fronteiras.meta.mockResolvedValue({ orderStatus: 'cancelled' });

    const response = await chamar({ pack_id: '123', text: 'Olá' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      erro: 'Não é possível responder porque o pedido foi cancelado.',
      codigo: 'pedido_cancelado',
    });
    expect(fronteiras.marcarCancelada).toHaveBeenCalledWith(expect.anything(), 'org-1', '123', 'owner-1');
    expect(fronteiras.token).not.toHaveBeenCalled();
    expect(fronteiras.comprador).not.toHaveBeenCalled();
    expect(fronteiras.enviar).not.toHaveBeenCalled();
  });

  it('quando envio falha com ERRO_PEDIDO_CANCELADO (403 ML), persiste cancelamento e responde 409 estruturado', async () => {
    fronteiras.enviar.mockResolvedValue(recusa('Não é possível responder porque o pedido foi cancelado.'));

    const response = await chamar({ pack_id: '456', text: 'Olá' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      erro: 'Não é possível responder porque o pedido foi cancelado.',
      codigo: 'pedido_cancelado',
    });
    expect(fronteiras.marcarCancelada).toHaveBeenCalledWith(expect.anything(), 'org-1', '456', 'owner-1');
  });

  it('403 blocked_by_claim do ML → 409 reclamacao_aberta, sem marcar cancelada', async () => {
    fronteiras.enviar.mockResolvedValue(recusa('ML /messages 403: {"code":"forbidden","message":"blocked_by_claim","stacktrace":null,"status_code":403}'));

    const response = await chamar({ pack_id: '789', text: 'Olá' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      erro: 'Este pedido tem reclamação aberta no Mercado Livre: responda pela reclamação.',
      codigo: 'reclamacao_aberta',
    });
    expect(fronteiras.marcarCancelada).not.toHaveBeenCalled();
    expect(fronteiras.auditar).toHaveBeenCalledWith(expect.anything(), expect.anything(), { type: 'pack', id: '789' }, 'failed');
  });

  it('403 blocked_by_mediation (ERRO_EM_MEDIACAO) → mesmo 409 reclamacao_aberta', async () => {
    fronteiras.enviar.mockResolvedValue(recusa('Reclamação em mediação.'));
    const response = await chamar({ pack_id: '790', text: 'Olá' });
    expect(response.status).toBe(409);
    expect((await response.json()).codigo).toBe('reclamacao_aberta');
  });
});

describe('responder-mensagem — validação do corpo', () => {
  it.each([
    ['operacao_id inválido', { pack_id: '1', text: 'Olá', operacao_id: 'abc' }, 'operacao_id inválido'],
    ['operacao_id que não é texto', { pack_id: '1', text: 'Olá', operacao_id: 7 }, 'operacao_id inválido'],
    ['anexo com barra', { pack_id: '1', text: 'Olá', anexo: '../a.png' }, 'anexo inválido'],
    ['anexo vazio', { pack_id: '1', text: 'Olá', anexo: '' }, 'anexo inválido'],
    ['anexo que não é texto', { pack_id: '1', text: 'Olá', anexo: ['a.png'] }, 'anexo inválido'],
    ['anexo longo demais', { pack_id: '1', text: 'Olá', anexo: 'a'.repeat(201) }, 'anexo inválido'],
    ['envio sem texto', { pack_id: '1', operacao_id: OP }, 'pack_id e text obrigatórios'],
    ['verificar sem operacao_id', { pack_id: '1', verificar: true }, 'operacao_id obrigatório'],
    ['liberar sem operacao_id', { pack_id: '1', liberar: true }, 'operacao_id obrigatório'],
    ['verificar e liberar juntos', { pack_id: '1', operacao_id: OP, verificar: true, liberar: true }, 'Use verificar ou liberar, não os dois.'],
  ])('%s → 400 sem tocar no fluxo', async (_nome, corpo, mensagem) => {
    const response = await chamar(corpo);
    expect(response.status).toBe(400);
    expect((await response.json()).erro).toBe(mensagem);
    expect(fronteiras.enviar).not.toHaveBeenCalled();
    expect(fronteiras.verificar).not.toHaveBeenCalled();
    expect(fronteiras.liberar).not.toHaveBeenCalled();
  });
});

describe('responder-mensagem — envio pelo fluxo', () => {
  it('monta { texto, anexo } nessa ordem, com texto aparado e anexo null quando ausente', async () => {
    fronteiras.enviar.mockResolvedValue(sucesso('confirmada'));
    await chamar({ pack_id: '10', text: '  Olá  ', operacao_id: OP });

    const entrada = fronteiras.enviar.mock.calls[0][1];
    expect(entrada).toMatchObject({ orgId: 'org-1', userId: 'user-1', packId: '10', operacaoId: OP });
    expect(JSON.stringify(entrada.payload)).toBe('{"texto":"Olá","anexo":null}');
    expect(fronteiras.deps).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org-1', packId: '10', sellerId: 'seller-1', buyerId: 'buyer-1', token: 'token-ml',
    });
  });

  it('repassa o anexo; operacao_id ausente vira um uuid novo', async () => {
    fronteiras.enviar.mockResolvedValue(sucesso('confirmada'));
    await chamar({ pack_id: '10', text: 'Olá', anexo: '123_abc-d.png' });

    const entrada = fronteiras.enviar.mock.calls[0][1];
    expect(JSON.stringify(entrada.payload)).toBe('{"texto":"Olá","anexo":"123_abc-d.png"}');
    expect(entrada.operacaoId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('confirmada: re-sincroniza e responde o contrato novo', async () => {
    fronteiras.enviar.mockResolvedValue(sucesso('confirmada'));
    fronteiras.buscarPack.mockResolvedValue([{ id: 'm1' }]);

    const response = await chamar({ pack_id: '10', text: 'Olá', operacao_id: OP });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, estado: 'confirmada', operacao_id: OP, pendenteConfirmacao: false });
    expect(fronteiras.upsert).toHaveBeenCalled();
    expect(fronteiras.auditar).toHaveBeenCalledWith(expect.anything(), expect.anything(), { type: 'pack', id: '10' }, 'succeeded');
  });

  it('falha no re-sync depois de confirmada não vira erro', async () => {
    fronteiras.enviar.mockResolvedValue(sucesso('confirmada'));
    fronteiras.buscarPack.mockRejectedValue(new Error('rede caiu'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await chamar({ pack_id: '10', text: 'Olá', operacao_id: OP });

    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('falha de auditoria depois do envio não vira erro', async () => {
    fronteiras.enviar.mockResolvedValue(sucesso('confirmada'));
    fronteiras.auditar.mockRejectedValueOnce(new Error('auditoria fora'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await chamar({ pack_id: '10', text: 'Olá', operacao_id: OP });

    expect(response.status).toBe(200);
    log.mockRestore();
  });

  it('pendente de confirmação: 200 sem re-sync', async () => {
    fronteiras.enviar.mockResolvedValue(sucesso('desconhecido', { pendenteConfirmacao: true }));

    const response = await chamar({ pack_id: '10', text: 'Olá', operacao_id: OP });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, estado: 'desconhecido', operacao_id: OP, pendenteConfirmacao: true });
    expect(fronteiras.buscarPack).not.toHaveBeenCalled();
  });

  it('trava: 409 em_andamento devolve codigo e pendente', async () => {
    const pendente = { operacao_id: OP, estado: 'desconhecido' };
    fronteiras.enviar.mockResolvedValue({
      http: 409, ok: false, estado: null, pendenteConfirmacao: false, erro: 'Em andamento.', codigo: 'em_andamento', pendente,
    });

    const response = await chamar({ pack_id: '10', text: 'Olá' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, erro: 'Em andamento.', codigo: 'em_andamento', pendente });
    expect(fronteiras.auditar).toHaveBeenCalledWith(expect.anything(), expect.anything(), { type: 'pack', id: '10' }, 'failed');
  });

  it('erro de banco no meio do fluxo → 500 sem vazar a mensagem', async () => {
    fronteiras.enviar.mockRejectedValue(new Error('ml_posvenda_acoes atualizar: segredo'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await chamar({ pack_id: '10', text: 'Olá', operacao_id: OP });

    expect(response.status).toBe(500);
    expect((await response.json()).erro).not.toContain('segredo');
    log.mockRestore();
  });
});

describe('responder-mensagem — verificar e liberar', () => {
  it('verificar não exige text, não envia e não audita', async () => {
    fronteiras.verificar.mockResolvedValue(sucesso('enviada', { pendenteConfirmacao: true }));

    const response = await chamar({ pack_id: '10', operacao_id: OP, verificar: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, estado: 'enviada', operacao_id: OP, pendenteConfirmacao: true });
    expect(fronteiras.verificar).toHaveBeenCalledWith(expect.anything(), '10', OP);
    expect(fronteiras.enviar).not.toHaveBeenCalled();
    expect(fronteiras.auditar).not.toHaveBeenCalled();
  });

  it('verificar que chega em confirmada re-sincroniza', async () => {
    fronteiras.verificar.mockResolvedValue(sucesso('confirmada'));
    fronteiras.buscarPack.mockResolvedValue([{ id: 'm1' }]);

    await chamar({ pack_id: '10', operacao_id: OP, verificar: true });

    expect(fronteiras.upsert).toHaveBeenCalled();
  });

  it('liberar decide por ok/estado: erro preenchido segue sucesso, audita e não re-sincroniza', async () => {
    fronteiras.liberar.mockResolvedValue(sucesso('inconclusiva', { erro: 'Liberado pelo operador.' }));

    const response = await chamar({ pack_id: '10', operacao_id: OP, liberar: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, estado: 'inconclusiva', operacao_id: OP, pendenteConfirmacao: false });
    expect(fronteiras.liberar).toHaveBeenCalledWith(expect.anything(), '10', OP);
    expect(fronteiras.auditar).toHaveBeenCalledWith(expect.anything(), expect.anything(), { type: 'pack', id: '10' }, 'succeeded');
    expect(fronteiras.buscarPack).not.toHaveBeenCalled();
  });

  it('pedido cancelado segue barrando antes do fluxo', async () => {
    fronteiras.meta.mockResolvedValue({ orderStatus: 'cancelled' });

    const response = await chamar({ pack_id: '10', operacao_id: OP, verificar: true });

    expect(response.status).toBe(409);
    expect(fronteiras.verificar).not.toHaveBeenCalled();
  });
});
