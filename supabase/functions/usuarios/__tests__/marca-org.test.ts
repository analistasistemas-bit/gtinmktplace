import { describe, it, expect, vi } from 'vitest';
import { executarMarcaOrg } from '../marca-org.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const base = (over = {}) => ({
  ehSuperAdmin: true, orgAlvo: ORG, marcaPropria: true as unknown, marcaPadrao: 'Zaven' as unknown,
  atualizar: vi.fn().mockResolvedValue(null),
  auditar: vi.fn().mockResolvedValue(null),
  ...over,
});

describe('executarMarcaOrg (ADR-0188)', () => {
  it('403 para quem não é super-admin, sem gravar', async () => {
    const d = base({ ehSuperAdmin: false });
    expect((await executarMarcaOrg(d)).status).toBe(403);
    expect(d.atualizar).not.toHaveBeenCalled();
  });
  it('400 org_id inválido ou marca_propria não booleana', async () => {
    expect((await executarMarcaOrg(base({ orgAlvo: 'x' }))).status).toBe(400);
    expect((await executarMarcaOrg(base({ marcaPropria: 'sim' }))).status).toBe(400);
  });
  it('400 ao ligar sem nome da marca', async () => {
    const d = base({ marcaPadrao: '   ' });
    const r = await executarMarcaOrg(d);
    expect(r).toEqual({ status: 400, body: { error: 'Informe o nome da marca.' } });
    expect(d.atualizar).not.toHaveBeenCalled();
  });
  it('400 nome com mais de 60 caracteres', async () => {
    expect((await executarMarcaOrg(base({ marcaPadrao: 'x'.repeat(61) }))).status).toBe(400);
  });
  it('liga com nome aparado: intent → atualizar → success', async () => {
    const d = base({ marcaPadrao: ' Zaven ' });
    expect(await executarMarcaOrg(d)).toEqual({ status: 200, body: { ok: true } });
    expect(d.atualizar).toHaveBeenCalledWith(ORG, { marca_propria: true, marca_padrao: 'Zaven' });
    expect(d.auditar.mock.calls.map((c) => c[1])).toEqual(['intent', 'success']);
  });
  it('desligar sem nome mantém o nome atual (não apaga marca_padrao)', async () => {
    const d = base({ marcaPropria: false, marcaPadrao: '' });
    await executarMarcaOrg(d);
    expect(d.atualizar).toHaveBeenCalledWith(ORG, { marca_propria: false });
  });
  it('erro ao gravar → 400 com auditoria failure', async () => {
    const d = base({ atualizar: vi.fn().mockResolvedValue('violação') });
    const r = await executarMarcaOrg(d);
    expect(r.status).toBe(400);
    expect(d.auditar.mock.calls.map((c) => c[1])).toEqual(['intent', 'failure']);
  });
  it('500 se a auditoria de intenção não grava', async () => {
    const d = base({ auditar: vi.fn().mockResolvedValue('boom') });
    expect((await executarMarcaOrg(d)).status).toBe(500);
    expect(d.atualizar).not.toHaveBeenCalled();
  });
});
