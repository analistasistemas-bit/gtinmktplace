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
type DepsAuthAgente = import('../auth-agente.ts').DepsAuthAgente;
const { gerarChave } = await import('../credencial.ts');
const { reservarChamada, reservarFalhaIp } = await import('../limite.ts');

const agora = new Date('2026-11-22T14:05:30.000Z');
const NAO_AUT = { ok: false, status: 401, codigo: 'nao_autorizado' };

const req = (auth?: string) =>
  new Request('https://x/agentes', { headers: auth ? { Authorization: auth } : {} });

let chave: string;
let hash: string;
let linha: { id: string; org_id: string; expira_em: string; revogada_em: string | null; permissoes: unknown } | null;

function deps(over: Partial<DepsAuthAgente> = {}) {
  return {
    buscarConexaoPorHash: vi.fn(async (h: string) => (h === hash ? linha : null)),
    orgAtivaComModulo: vi.fn(async () => true),
    marcarUso: vi.fn(async () => {}),
    agora,
    ip: '1.2.3.4',
    ...over,
  } as DepsAuthAgente & Record<'buscarConexaoPorHash' | 'orgAtivaComModulo' | 'marcarUso', ReturnType<typeof vi.fn>>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  falhasIp.clear();
  resIp = null;
  resChamada = 'ok';
  ({ chave, hash } = await gerarChave());
  linha = {
    id: 'con-1', org_id: 'org-1', expira_em: '2027-01-01T00:00:00Z', revogada_em: null,
    permissoes: ['margens', 'catalogo'],
  };
});

describe('autenticarAgente', () => {
  it('chave válida → ok com conexão e org da linha; marca uso', async () => {
    const d = deps();
    expect(await autenticarAgente(req(`Bearer ${chave}`), d)).toEqual({
      ok: true, conexaoId: 'con-1', orgId: 'org-1', permissoes: ['margens', 'catalogo'],
    });
    expect(d.buscarConexaoPorHash).toHaveBeenCalledWith(hash);
    expect(d.orgAtivaComModulo).toHaveBeenCalledWith('org-1');
    expect(reservarChamada).toHaveBeenCalledWith('con-1', agora);
    expect(d.marcarUso).toHaveBeenCalledWith('con-1', 'org-1');
    expect(reservarFalhaIp).not.toHaveBeenCalled();
  });

  it('permissões vêm da linha; null ou lixo → nenhuma (nunca libera por padrão)', async () => {
    linha = { ...linha!, permissoes: ['catalogo'] };
    expect(await autenticarAgente(req(`Bearer ${chave}`), deps())).toEqual({
      ok: true, conexaoId: 'con-1', orgId: 'org-1', permissoes: ['catalogo'],
    });
    linha = { ...linha!, permissoes: null };
    expect(await autenticarAgente(req(`Bearer ${chave}`), deps())).toEqual({
      ok: true, conexaoId: 'con-1', orgId: 'org-1', permissoes: [],
    });
    linha = { ...linha!, permissoes: ['catalogo', 'valor_desconhecido'] };
    expect(await autenticarAgente(req(`Bearer ${chave}`), deps())).toEqual({
      ok: true, conexaoId: 'con-1', orgId: 'org-1', permissoes: [],
    });
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

  it('chave ausente: 21ª falha no minuto → 429 e o banco nunca é consultado', async () => {
    const d = deps();
    for (let i = 0; i < 20; i++) expect(await autenticarAgente(req(), d)).toEqual(NAO_AUT);
    expect(await autenticarAgente(req(), d)).toEqual({ ok: false, status: 429, codigo: 'limite' });
    expect(d.buscarConexaoPorHash).not.toHaveBeenCalled();
  });

  it('chave bem formada e inexistente com IP saturado: consulta o banco 1 vez e responde 429', async () => {
    // Intencional: sem bloqueio por IP antes do lookup — clientes de chat compartilham IP de saída e uma chave
    // válida não pode ser barrada por falhas de terceiros.
    const { chave: outra } = await gerarChave();
    const d = deps();
    for (let i = 0; i < 20; i++) await autenticarAgente(req(), d);
    expect(await autenticarAgente(req(`Bearer ${outra}`), d)).toEqual({ ok: false, status: 429, codigo: 'limite' });
    expect(d.buscarConexaoPorHash).toHaveBeenCalledTimes(1);
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

  it('orgAtivaComModulo só libera com true estrito', async () => {
    for (const v of [{}, 'false', 1, 'true']) {
      const d = deps({ orgAtivaComModulo: vi.fn(async () => v as unknown as boolean) });
      expect(await autenticarAgente(req(`Bearer ${chave}`), d)).toEqual({ ok: false, status: 403, codigo: 'acesso_desligado' });
    }
  });

  it('linha sem id/org_id string não vazia → 503 linha_invalida', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const invalidas = [{ id: '' }, { org_id: '' }, { id: 7 }, { org_id: null }];
    for (const x of invalidas) {
      linha = { ...linha!, ...x } as typeof linha;
      expect(await autenticarAgente(req(`Bearer ${chave}`), deps())).toEqual({ ok: false, status: 503, codigo: 'indisponivel' });
    }
    expect(warn.mock.calls).toEqual(invalidas.map(() => ['[agentes] auth: linha_invalida']));
    expect(reservarFalhaIp).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('exceções de dependência: só código fixo no log; sentinela, chave e hash nunca aparecem', async () => {
    const SENTINELA = 'SENTINELA-9f3c';
    const espioes = (['warn', 'error', 'log'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const boom = vi.fn(async () => { throw new Error(`${SENTINELA} ${hash}`); });
    const r1 = await autenticarAgente(req(`Bearer ${chave}`), deps({ buscarConexaoPorHash: boom }));
    const r2 = await autenticarAgente(req(`Bearer ${chave}`), deps({ orgAtivaComModulo: boom }));
    const r3 = await autenticarAgente(req(`Bearer ${chave}`), deps({ marcarUso: boom }));
    expect(r1).toEqual({ ok: false, status: 503, codigo: 'indisponivel' });
    expect(r2).toEqual({ ok: false, status: 503, codigo: 'indisponivel' });
    expect(r3).toEqual({ ok: true, conexaoId: 'con-1', orgId: 'org-1', permissoes: ['margens', 'catalogo'] });
    expect(espioes[0].mock.calls).toEqual([
      ['[agentes] auth: banco_indisponivel'],
      ['[agentes] auth: modulo_indisponivel'],
      ['[agentes] auth: marcar_uso_falhou'],
    ]);
    const tudo = JSON.stringify([espioes.map((e) => e.mock.calls), r1, r2, r3]);
    for (const proibido of [SENTINELA, chave, hash]) expect(tudo).not.toContain(proibido);
    expect(reservarFalhaIp).not.toHaveBeenCalled();
    espioes.forEach((e) => e.mockRestore());
  });

  it('os 5 casos de 401 produzem a mesma chamada de log; IP saturado não loga', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { chave: outra } = await gerarChave();
    const casos: Array<[string | undefined, typeof linha]> = [
      [undefined, linha],
      ['Bearer lixo', linha],
      [`Bearer ${outra}`, linha],
      [`Bearer ${chave}`, { ...linha!, revogada_em: '2026-11-01T00:00:00Z' }],
      [`Bearer ${chave}`, { ...linha!, expira_em: agora.toISOString() }],
    ];
    for (const [auth, l] of casos) {
      linha = l;
      await autenticarAgente(req(auth), deps());
    }
    expect(warn.mock.calls).toEqual(casos.map(() => ['[agentes] credencial recusada']));
    warn.mockClear();
    resIp = 'limite';
    await autenticarAgente(req(), deps());
    expect(warn).not.toHaveBeenCalled();
    const tudo = JSON.stringify(warn.mock.calls);
    expect(tudo).not.toContain(chave);
    warn.mockRestore();
  });
});
