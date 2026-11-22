import { beforeEach, describe, expect, it, vi } from 'vitest';

type R = 'ok' | 'limite' | 'falha';
const falhasIp = new Map<string, number>();
let resIp: R | null = null; // null = conta de verdade (teto 20/min)
let resChamada: R = 'ok';

vi.mock('../limite.ts', () => ({
  reservarFalhaIp: vi.fn(async (ip: string) => {
    if (resIp) return resIp;
    falhasIp.set(ip, (falhasIp.get(ip) ?? 0) + 1);
    return falhasIp.get(ip)! <= 20 ? 'ok' : 'limite';
  }),
  reservarChamada: vi.fn(async () => resChamada),
}));

const { autenticarAgente } = await import('../auth-agente.ts');
const { gerarChave } = await import('../credencial.ts');
const { reservarChamada, reservarFalhaIp } = await import('../limite.ts');

const agora = new Date('2026-11-22T14:05:30.000Z');
const NAO_AUT = { ok: false, status: 401, codigo: 'nao_autorizado' };

const req = (auth?: string) =>
  new Request('https://x/agentes', { headers: auth ? { Authorization: auth } : {} });

let chave: string;
let hash: string;
let linha: { id: string; org_id: string; expira_em: string; revogada_em: string | null } | null;

function deps(over: Record<string, unknown> = {}) {
  return {
    buscarConexaoPorHash: vi.fn(async (h: string) => (h === hash ? linha : null)),
    orgAtivaComModulo: vi.fn(async () => true),
    marcarUso: vi.fn(async () => {}),
    agora,
    ip: '1.2.3.4',
    ...over,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  falhasIp.clear();
  resIp = null;
  resChamada = 'ok';
  ({ chave, hash } = await gerarChave());
  linha = { id: 'con-1', org_id: 'org-1', expira_em: '2027-01-01T00:00:00Z', revogada_em: null };
});

describe('autenticarAgente', () => {
  it('chave válida → ok com conexão e org da linha; marca uso', async () => {
    const d = deps();
    expect(await autenticarAgente(req(`Bearer ${chave}`), d)).toEqual({ ok: true, conexaoId: 'con-1', orgId: 'org-1' });
    expect(d.buscarConexaoPorHash).toHaveBeenCalledWith(hash);
    expect(d.orgAtivaComModulo).toHaveBeenCalledWith('org-1');
    expect(reservarChamada).toHaveBeenCalledWith('con-1', agora);
    expect(d.marcarUso).toHaveBeenCalledWith('con-1');
    expect(reservarFalhaIp).not.toHaveBeenCalled();
  });

  it('ausente, malformada, não encontrada, revogada e expirada → 401 idêntico, debitando o IP', async () => {
    const { chave: outra } = await gerarChave();
    const casos: Array<[string | undefined, typeof linha]> = [
      [undefined, linha],
      ['Bearer eyJhbGciOiJIUzI1NiJ9.x.y', linha],
      [`Bearer ${outra}`, linha],
      [`Bearer ${chave}`, { ...linha!, revogada_em: '2026-11-01T00:00:00Z' }],
      [`Bearer ${chave}`, { ...linha!, expira_em: agora.toISOString() }],
    ];
    for (const [auth, l] of casos) {
      linha = l;
      expect(await autenticarAgente(req(auth), deps())).toEqual(NAO_AUT);
    }
    expect(reservarFalhaIp).toHaveBeenCalledTimes(5);
    expect(reservarFalhaIp).toHaveBeenCalledWith('1.2.3.4', agora);
    expect(reservarChamada).not.toHaveBeenCalled();
  });

  it('ausente ou malformada não consulta o banco', async () => {
    const d = deps();
    await autenticarAgente(req(), d);
    await autenticarAgente(req('Bearer pai_xyz'), d);
    expect(d.buscarConexaoPorHash).not.toHaveBeenCalled();
  });

  it('revogada não chama orgAtivaComModulo nem marcarUso', async () => {
    linha = { ...linha!, revogada_em: '2026-11-01T00:00:00Z' };
    const d = deps();
    expect(await autenticarAgente(req(`Bearer ${chave}`), d)).toEqual(NAO_AUT);
    expect(d.orgAtivaComModulo).not.toHaveBeenCalled();
    expect(d.marcarUso).not.toHaveBeenCalled();
  });

  it('IP com 21 falhas no minuto recebe 429 antes de consultar o banco', async () => {
    const d = deps();
    for (let i = 0; i < 20; i++) expect(await autenticarAgente(req(), d)).toEqual(NAO_AUT);
    expect(await autenticarAgente(req(), d)).toEqual({ ok: false, status: 429, codigo: 'limite' });
    expect(d.buscarConexaoPorHash).not.toHaveBeenCalled();
  });

  it('credencial válida não sofre pré-checagem de IP', async () => {
    resIp = 'limite';
    expect(await autenticarAgente(req(`Bearer ${chave}`), deps())).toMatchObject({ ok: true });
    expect(reservarFalhaIp).not.toHaveBeenCalled();
  });

  it('Redis falhando ao debitar falha de IP → 503', async () => {
    resIp = 'falha';
    expect(await autenticarAgente(req(), deps())).toEqual({ ok: false, status: 503, codigo: 'indisponivel' });
  });

  it('Review Focus 1: módulo desligado → 403, sem reservar chamada nem marcar uso', async () => {
    const d = deps({ orgAtivaComModulo: vi.fn(async () => false) });
    expect(await autenticarAgente(req(`Bearer ${chave}`), d)).toEqual({ ok: false, status: 403, codigo: 'acesso_desligado' });
    expect(reservarChamada).not.toHaveBeenCalled();
    expect(d.marcarUso).not.toHaveBeenCalled();
  });

  it('reservarChamada limite → 429; falha → 503; nenhum marca uso', async () => {
    resChamada = 'limite';
    const d1 = deps();
    expect(await autenticarAgente(req(`Bearer ${chave}`), d1)).toEqual({ ok: false, status: 429, codigo: 'limite' });
    resChamada = 'falha';
    const d2 = deps();
    expect(await autenticarAgente(req(`Bearer ${chave}`), d2)).toEqual({ ok: false, status: 503, codigo: 'indisponivel' });
    expect(d1.marcarUso).not.toHaveBeenCalled();
    expect(d2.marcarUso).not.toHaveBeenCalled();
  });

  it('falha de marcarUso não derruba a chamada', async () => {
    const d = deps({ marcarUso: vi.fn(async () => { throw new Error('db'); }) });
    expect(await autenticarAgente(req(`Bearer ${chave}`), d)).toMatchObject({ ok: true });
  });

  it('exceção no banco → 503 sem vazar mensagem (busca e org)', async () => {
    const segredo = 'detalhe interno';
    const d1 = deps({ buscarConexaoPorHash: vi.fn(async () => { throw new Error(segredo); }) });
    const r1 = await autenticarAgente(req(`Bearer ${chave}`), d1);
    expect(r1).toEqual({ ok: false, status: 503, codigo: 'indisponivel' });
    const d2 = deps({ orgAtivaComModulo: vi.fn(async () => { throw new Error(segredo); }) });
    const r2 = await autenticarAgente(req(`Bearer ${chave}`), d2);
    expect(r2).toEqual({ ok: false, status: 503, codigo: 'indisponivel' });
    expect(reservarFalhaIp).not.toHaveBeenCalled();
  });

  it('nunca loga a chave nem o hash', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    linha = { ...linha!, revogada_em: '2026-11-01T00:00:00Z' };
    await autenticarAgente(req(`Bearer ${chave}`), deps());
    await autenticarAgente(req('Bearer lixo'), deps());
    const logado = JSON.stringify(warn.mock.calls);
    expect(logado).not.toContain(chave);
    expect(logado).not.toContain(hash);
    warn.mockRestore();
  });
});
