import { describe, expect, it, vi } from 'vitest';
import { tratarConexoes, type DepsConexoes } from '../conexoes-http.ts';

const ORG = 'org-A';
const USER = 'user-1';
const ID = '0b9d5a3e-1c2f-4a6b-9e8d-7f6a5b4c3d2e';
const CHAVE = 'pai_ab12cd34_' + 'x'.repeat(43);

function deps(over: Partial<{ isAdmin: boolean; support: unknown; modulo: boolean; ativas: number }> = {}) {
  const acoes = {
    contarAtivas: vi.fn(async () => over.ativas ?? 0),
    criar: vi.fn(async () => ({ id: ID, chave: CHAVE, prefixo: 'ab12cd34', expira_em: '2027-01-01T00:00:00.000Z', hash: 'h-criar' })),
    listar: vi.fn(async () => [{
      id: ID, nome: 'Claude', prefixo: 'ab12cd34', criada_em: 'c', expira_em: 'e', revogada_em: null, ultimo_uso_em: null,
      hash: 'h-listar', org_id: ORG, permissoes: ['catalogo'],
    }]),
    alterarPermissoes: vi.fn(async () => true),
    revogar: vi.fn(async () => true),
    chamadas: vi.fn(async () => [{ criado_em: 'c', ferramenta: 'publiai_loja', alvo: null, resultado: 'ok', hash: 'h-cham' }]),
  };
  const d: DepsConexoes = {
    identificar: vi.fn(async () => ({ userId: USER, orgId: ORG, isAdmin: over.isAdmin ?? true, support: over.support ?? null })),
    moduloLigado: vi.fn(async () => over.modulo ?? true),
    acoes,
  };
  return { d, acoes };
}
const post = (body: unknown) => new Request('http://x/agente-conexoes', { method: 'POST', body: JSON.stringify(body) });
const nenhumaAcao = (acoes: Record<string, ReturnType<typeof vi.fn>>) => {
  for (const f of Object.values(acoes)) expect(f).not.toHaveBeenCalled();
};

describe('tratarConexoes: portões', () => {
  it('sessão de suporte → 403, nem consulta o módulo, nenhuma ação', async () => {
    const { d, acoes } = deps({ support: { requestId: 'r', scope: 'full' } });
    expect((await tratarConexoes(post({ acao: 'listar' }), d)).status).toBe(403);
    expect(d.moduloLigado).not.toHaveBeenCalled();
    nenhumaAcao(acoes);
  });
  it('permissoes em sessão de suporte → 403 antes de ler o corpo', async () => {
    const { d, acoes } = deps({ support: { requestId: 'r', scope: 'full' } });
    const req = post({ acao: 'permissoes', id: ID, permissoes: ['margens'] });
    expect((await tratarConexoes(req, d)).status).toBe(403);
    expect(req.bodyUsed).toBe(false);
    nenhumaAcao(acoes);
  });
  it('não-admin → 403, nenhuma ação', async () => {
    const { d, acoes } = deps({ isAdmin: false });
    expect((await tratarConexoes(post({ acao: 'criar', nome: 'x', dias: 90 }), d)).status).toBe(403);
    nenhumaAcao(acoes);
  });
  it('módulo desligado → 403, nenhuma ação', async () => {
    const { d, acoes } = deps({ modulo: false });
    expect((await tratarConexoes(post({ acao: 'listar' }), d)).status).toBe(403);
    expect(d.moduloLigado).toHaveBeenCalledWith(ORG);
    nenhumaAcao(acoes);
  });
  it('identificar lançando Response 401 → devolvida como está', async () => {
    const { d, acoes } = deps();
    const r401 = new Response('{"error":"x"}', { status: 401 });
    d.identificar = vi.fn(async () => { throw r401; });
    expect(await tratarConexoes(post({ acao: 'listar' }), d)).toBe(r401);
    nenhumaAcao(acoes);
  });
  it('OPTIONS → CORS; GET → 405', async () => {
    const { d } = deps();
    expect((await tratarConexoes(new Request('http://x', { method: 'OPTIONS' }), d)).status).toBe(200);
    expect((await tratarConexoes(new Request('http://x', { method: 'GET' }), d)).status).toBe(405);
    expect(d.identificar).not.toHaveBeenCalled();
  });
});

describe('tratarConexoes: ações', () => {
  it('org_id e criada_por forjados no corpo são ignorados', async () => {
    const { d, acoes } = deps();
    await tratarConexoes(post({ acao: 'criar', nome: 'x', dias: 90, org_id: 'org-B', orgId: 'org-B', criada_por: 'u-B', userId: 'u-B' }), d);
    expect(acoes.contarAtivas).toHaveBeenCalledWith(ORG);
    expect(acoes.criar).toHaveBeenCalledWith(ORG, USER, { nome: 'x', dias: 90, permissoes: ['margens', 'catalogo'] });
    await tratarConexoes(post({ acao: 'listar', org_id: 'org-B' }), d);
    expect(acoes.listar).toHaveBeenCalledWith(ORG);
    await tratarConexoes(post({ acao: 'revogar', id: ID, org_id: 'org-B' }), d);
    expect(acoes.revogar).toHaveBeenCalledWith(ORG, ID);
    await tratarConexoes(post({ acao: 'chamadas', id: ID, org_id: 'org-B' }), d);
    expect(acoes.chamadas).toHaveBeenCalledWith(ORG, ID);
    await tratarConexoes(post({ acao: 'permissoes', id: ID, permissoes: ['margens'], org_id: 'org-B' }), d);
    expect(acoes.alterarPermissoes).toHaveBeenCalledWith(ORG, ID, ['margens']);
  });

  it('listar projeta permissoes (lidas por permissoesDaLinha) e nunca hash', async () => {
    const { d } = deps();
    const txt = await (await tratarConexoes(post({ acao: 'listar' }), d)).text();
    expect(JSON.parse(txt)[0].permissoes).toEqual(['catalogo']);
    expect(txt).not.toContain('hash');
  });

  it('criar com permissões escolhidas repassa; inválidas → 400 sem contar nem criar', async () => {
    const { d, acoes } = deps();
    expect((await tratarConexoes(post({ acao: 'criar', nome: 'x', dias: 90, permissoes: ['catalogo'] }), d)).status).toBe(200);
    expect(acoes.criar).toHaveBeenCalledWith(ORG, USER, { nome: 'x', dias: 90, permissoes: ['catalogo'] });
    acoes.criar.mockClear();
    const r = await tratarConexoes(post({ acao: 'criar', nome: 'x', dias: 90, permissoes: ['vendas'] }), d);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erro: 'Escolha ao menos uma permissão válida.' });
    expect(acoes.contarAtivas).toHaveBeenCalledTimes(1);
    expect(acoes.criar).not.toHaveBeenCalled();
  });

  it('permissoes: ok → { ok: true }', async () => {
    const { d } = deps();
    const r = await tratarConexoes(post({ acao: 'permissoes', id: ID, permissoes: ['margens', 'catalogo'] }), d);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('permissoes: ação devolvendo false ou id inválido → 404 com o mesmo corpo da revogação', async () => {
    const { d, acoes } = deps();
    acoes.alterarPermissoes.mockResolvedValue(false);
    const a = await tratarConexoes(post({ acao: 'permissoes', id: ID, permissoes: ['margens'] }), d);
    const b = await tratarConexoes(post({ acao: 'permissoes', id: 'abc', permissoes: ['margens'] }), d);
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(await a.json()).toEqual({ erro: 'Conexão não encontrada.' });
    expect(await b.json()).toEqual({ erro: 'Conexão não encontrada.' });
    expect(acoes.alterarPermissoes).toHaveBeenCalledTimes(1);
  });

  it('permissoes: lista vazia ou inválida → 400 sem chamar a ação', async () => {
    const { d, acoes } = deps();
    for (const permissoes of [[], ['vendas'], 'margens', ['margens', 'margens'], undefined]) {
      const r = await tratarConexoes(post({ acao: 'permissoes', id: ID, permissoes }), d);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ erro: 'Escolha ao menos uma permissão válida.' });
    }
    expect(acoes.alterarPermissoes).not.toHaveBeenCalled();
  });

  it('só criar devolve chave; nenhuma resposta tem hash', async () => {
    const { d } = deps();
    const corpos: Record<string, string> = {};
    for (const b of [{ acao: 'criar', nome: 'x', dias: 30 }, { acao: 'listar' }, { acao: 'revogar', id: ID }, { acao: 'chamadas', id: ID }]) {
      const r = await tratarConexoes(post(b), d);
      expect(r.status).toBe(200);
      corpos[b.acao] = await r.text();
    }
    expect(JSON.parse(corpos.criar)).toEqual({ id: ID, chave: CHAVE, prefixo: 'ab12cd34', expira_em: '2027-01-01T00:00:00.000Z' });
    for (const [acao, txt] of Object.entries(corpos)) {
      expect(txt).not.toContain('hash');
      expect(txt).not.toContain('h-');
      if (acao !== 'criar') {
        expect(txt).not.toContain('chave');
        expect(txt).not.toContain(CHAVE);
      }
    }
    expect(JSON.parse(corpos.listar)[0]).not.toHaveProperty('org_id');
  });

  it('revogar: inexistente, de outra org e id inválido → 404 com o mesmo corpo', async () => {
    const { d, acoes } = deps();
    acoes.revogar.mockResolvedValue(false);
    const a = await tratarConexoes(post({ acao: 'revogar', id: ID }), d);
    const b = await tratarConexoes(post({ acao: 'revogar', id: '1c2f0b9d-1c2f-4a6b-9e8d-7f6a5b4c3d2e' }), d);
    const c = await tratarConexoes(post({ acao: 'revogar', id: 'abc' }), d);
    expect([a.status, b.status, c.status]).toEqual([404, 404, 404]);
    const [ta, tb, tc] = await Promise.all([a.text(), b.text(), c.text()]);
    expect(tb).toBe(ta);
    expect(tc).toBe(ta);
    expect(acoes.revogar).toHaveBeenCalledTimes(2); // id inválido nem chega ao banco
  });

  it('11ª conexão ativa → 409 sem criar', async () => {
    const { d, acoes } = deps({ ativas: 10 });
    expect((await tratarConexoes(post({ acao: 'criar', nome: 'x', dias: 90 }), d)).status).toBe(409);
    expect(acoes.criar).not.toHaveBeenCalled();
  });

  it('entrada inválida → 400 sem contar nem criar', async () => {
    const { d, acoes } = deps();
    expect((await tratarConexoes(post({ acao: 'criar', nome: '', dias: 90 }), d)).status).toBe(400);
    expect((await tratarConexoes(post({ acao: 'criar', nome: 'x', dias: 45 }), d)).status).toBe(400);
    nenhumaAcao(acoes);
  });

  it('ação desconhecida ou corpo inválido → 400', async () => {
    const { d } = deps();
    expect((await tratarConexoes(post({ acao: 'apagar_tudo' }), d)).status).toBe(400);
    expect((await tratarConexoes(new Request('http://x', { method: 'POST', body: 'não é json' }), d)).status).toBe(400);
  });

  it('exceção de uma ação → 500 sem a mensagem', async () => {
    const { d, acoes } = deps();
    acoes.listar.mockRejectedValue(new Error('duplicate key hash=segredo'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await tratarConexoes(post({ acao: 'listar' }), d);
    expect(r.status).toBe(500);
    const txt = await r.text();
    expect(txt).not.toContain('segredo');
    expect(txt).not.toContain('duplicate');
    expect(JSON.stringify(err.mock.calls)).not.toContain('segredo');
    err.mockRestore();
  });
});
