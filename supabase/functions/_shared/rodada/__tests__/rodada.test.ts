import { describe, expect, it, vi } from 'vitest';
import {
  SemAcessoRodada, cicloDiaBrt, cicloHoraUtc, dedupMsg, ehMsgOrg, executarMensagem, gravarCursor, lerCursor,
  statusHttp, type Abertura, type Acumulado, type DepsRodada, type MsgOrg, type OpcoesMsg,
} from '../rodada.ts';

// Fake que reimplementa a semântica das RPCs da Task 1 (abrir/avancar/concluir/liberar/marcar_notificado
// de 20260927205804_worker_rodadas.sql) em memória, com relógio falso para lease_ate (150s, igual à RPC).
const LEASE_MS = 150_000;

interface Linha {
  ciclo: string;
  estado: 'rodando' | 'ok' | 'parcial' | 'sem_acesso';
  params: Record<string, unknown>;
  cursor: string | null;
  acumulado: Acumulado;
  leaseId: string | null;
  leaseAte: number | null;
  notificarPendente: boolean;
}

type Fake = DepsRodada & Record<keyof DepsRodada, ReturnType<typeof vi.fn>> & { linhas: Map<string, Linha> };

let seq = 0;
const chave = (job: string, org: string) => `${job}:${org}`;

function criarDeps(relogio: { t: number }): Fake {
  const linhas = new Map<string, Linha>();

  const abrir = vi.fn(async (m: MsgOrg): Promise<Abertura> => {
    const k = chave(m.job, m.org_id);
    let w = linhas.get(k);
    if (!w) {
      w = {
        ciclo: m.ciclo, estado: 'rodando', params: m.params, cursor: null, acumulado: {},
        leaseId: null, leaseAte: null, notificarPendente: false,
      };
      linhas.set(k, w);
    }
    if (w.ciclo > m.ciclo) {
      return {
        resultado: 'obsoleta', lease: null, estado: w.estado, ciclo: w.ciclo, cursor: w.cursor,
        acumulado: w.acumulado, params: w.params, notificarPendente: w.notificarPendente,
      };
    }
    if (w.leaseAte != null && w.leaseAte > relogio.t) {
      return {
        resultado: 'ocupada', lease: null, estado: w.estado, ciclo: w.ciclo, cursor: w.cursor,
        acumulado: w.acumulado, params: w.params, notificarPendente: w.notificarPendente,
      };
    }
    if (w.ciclo < m.ciclo && w.notificarPendente) {
      const lease = `lease-${++seq}`;
      w.leaseId = lease; w.leaseAte = relogio.t + LEASE_MS;
      return {
        resultado: 'notificar_anterior', lease, estado: w.estado, ciclo: w.ciclo, cursor: w.cursor,
        acumulado: w.acumulado, params: w.params, notificarPendente: true,
      };
    }
    if (w.ciclo < m.ciclo) {
      const lease = `lease-${++seq}`;
      w.ciclo = m.ciclo; w.estado = 'rodando'; w.params = m.params; w.cursor = null; w.acumulado = {};
      w.leaseId = lease; w.leaseAte = relogio.t + LEASE_MS; w.notificarPendente = false;
      return {
        resultado: 'executar', lease, estado: 'rodando', ciclo: m.ciclo, cursor: null,
        acumulado: {}, params: m.params, notificarPendente: false,
      };
    }
    // mesmo ciclo
    if (w.estado !== 'rodando' && !w.notificarPendente) {
      return {
        resultado: 'concluida', lease: null, estado: w.estado, ciclo: w.ciclo, cursor: w.cursor,
        acumulado: w.acumulado, params: w.params, notificarPendente: false,
      };
    }
    const lease = `lease-${++seq}`;
    w.leaseId = lease; w.leaseAte = relogio.t + LEASE_MS;
    return {
      resultado: 'executar', lease, estado: w.estado, ciclo: w.ciclo, cursor: w.cursor,
      acumulado: w.acumulado, params: w.params, notificarPendente: w.notificarPendente,
    };
  });

  const avancar = vi.fn(async (m: MsgOrg, lease: string, cursorNovo: string, acumulado: Acumulado) => {
    const w = linhas.get(chave(m.job, m.org_id));
    if (!w || w.leaseId !== lease || w.leaseAte == null || w.leaseAte <= relogio.t || w.estado !== 'rodando') return false;
    w.cursor = cursorNovo; w.acumulado = acumulado;
    return true;
  });

  const concluir = vi.fn(async (
    m: MsgOrg, lease: string, estado: 'ok' | 'parcial' | 'sem_acesso', _erro: string | null,
    acumulado: Acumulado | null, notificar: boolean,
  ) => {
    const w = linhas.get(chave(m.job, m.org_id));
    if (!w || w.leaseId !== lease || w.leaseAte == null || w.leaseAte <= relogio.t || w.estado !== 'rodando') return false;
    w.estado = estado;
    if (acumulado != null) w.acumulado = acumulado;
    w.notificarPendente = notificar;
    if (notificar) w.leaseAte = relogio.t + LEASE_MS;
    else { w.leaseId = null; w.leaseAte = null; }
    return true;
  });

  const liberar = vi.fn(async (m: MsgOrg, lease: string, _erro: string | null) => {
    const w = linhas.get(chave(m.job, m.org_id));
    if (w && w.leaseId === lease) { w.leaseId = null; w.leaseAte = null; }
  });

  const marcarNotificado = vi.fn(async (m: MsgOrg, lease: string) => {
    const w = linhas.get(chave(m.job, m.org_id));
    if (!w || w.leaseId !== lease) return false;
    w.notificarPendente = false; w.leaseId = null; w.leaseAte = null;
    return true;
  });

  const publicar = vi.fn(async (_m: MsgOrg, _cursor: string) => {});

  return { abrir, avancar, concluir, liberar, marcarNotificado, publicar, linhas } as Fake;
}

const msg = (over: Partial<MsgOrg> = {}): MsgOrg =>
  ({ modo: 'org', job: 'pulse-completo', org_id: 'org-1', ciclo: '2026-09-27', params: {}, ...over });

describe('executarMensagem', () => {
  it('mensagem nova: passo recebe cursor null e os params da abertura; avança, publica e libera → continua', async () => {
    const d = criarDeps({ t: 0 });
    const m = msg({ params: { tier: 'completo' } });
    const passo = vi.fn(async (e) => {
      expect(e.cursor).toBeNull();
      expect(e.params).toEqual({ tier: 'completo' });
      return { proximo: 'vendas|p1', acumulado: { processados: 3 } };
    });
    const r = await executarMensagem(d, m, passo);
    expect(r).toBe('continua');
    expect(passo).toHaveBeenCalledTimes(1);
    expect(d.avancar).toHaveBeenCalledWith(m, expect.any(String), 'vendas|p1', { processados: 3 });
    expect(d.publicar).toHaveBeenCalledWith(m, 'vendas|p1');
    expect(d.liberar).toHaveBeenCalledWith(m, expect.any(String), null);
  });

  it('ocupada: passo nunca é chamado; status 500', async () => {
    const d = criarDeps({ t: 0 });
    const m = msg();
    await d.abrir(m); // outra cadeia já tem a posse
    const passo = vi.fn();
    const r = await executarMensagem(d, m, passo);
    expect(r).toBe('ocupada');
    expect(passo).not.toHaveBeenCalled();
    expect(statusHttp(r)).toBe(500);
  });

  it('queda por CPU: 1ª execução não libera; retry +12s → ocupada; +160s → passo com o mesmo cursor', async () => {
    const relogio = { t: 0 };
    const d = criarDeps(relogio);
    const m = msg();
    await d.abrir(m); // simula a execução que abriu a posse e morreu por CPU antes de avançar/liberar

    relogio.t += 12_000;
    const r1 = await executarMensagem(d, m, vi.fn());
    expect(r1).toBe('ocupada');

    relogio.t += 160_000; // total 172s desde a abertura original, > lease de 150s
    const passo = vi.fn(async (e) => { expect(e.cursor).toBeNull(); return { proximo: null, acumulado: {} }; });
    const r2 = await executarMensagem(d, m, passo);
    expect(passo).toHaveBeenCalledTimes(1);
    expect(r2).toBe('executado');
  });

  it('queda por CPU com cursor não-nulo: o cursor sobrevive à queda e chega intacto no retry', async () => {
    const relogio = { t: 0 };
    const d = criarDeps(relogio);
    const m = msg();
    // avança o cursor pra 'vendas|p1' num ciclo normal, sem queda
    await executarMensagem(d, m, vi.fn(async () => ({ proximo: 'vendas|p1', acumulado: {} })));

    await d.abrir(m); // a execução seguinte abre a posse (cursor já em 'vendas|p1') e morre por CPU
    relogio.t += 160_000; // > lease de 150s desde essa abertura
    const passo = vi.fn(async (e) => { expect(e.cursor).toBe('vendas|p1'); return { proximo: null, acumulado: {} }; });
    const r = await executarMensagem(d, m, passo);
    expect(passo).toHaveBeenCalledTimes(1);
    expect(r).toBe('executado');
  });

  it('posse vence durante o lote (avancar → false) → erro, nunca obsoleta; retry refaz o lote', async () => {
    const relogio = { t: 0 };
    const d = criarDeps(relogio);
    const m = msg();
    const passo1 = vi.fn(async () => {
      relogio.t += 200_000; // ultrapassa a lease de 150s durante o "lote"
      return { proximo: 'a|1', acumulado: {} };
    });
    const r1 = await executarMensagem(d, m, passo1);
    expect(r1).toBe('erro');
    expect(d.publicar).not.toHaveBeenCalled();
    expect(passo1).toHaveBeenCalledWith({ cursor: null, acumulado: {}, params: {} });

    // retry: a linha nunca avançou (avancar falhou) → o lote é refeito com o MESMO cursor
    const passo2 = vi.fn(async (e) => { expect(e.cursor).toBeNull(); return { proximo: 'a|1', acumulado: {} }; });
    const r2 = await executarMensagem(d, m, passo2);
    expect(passo2).toHaveBeenCalledTimes(1);
    expect(r2).toBe('continua');
  });

  it('posse vence durante o lote (concluir → false) → erro, nunca obsoleta; não notifica nem marca', async () => {
    const relogio = { t: 0 };
    const d = criarDeps(relogio);
    const m = msg();
    const notificar = vi.fn();
    const passo = vi.fn(async () => {
      relogio.t += 200_000;
      return { proximo: null, acumulado: { total: 1 } };
    });
    const r = await executarMensagem(d, m, passo, { precisaNotificar: () => true, notificar });
    expect(r).toBe('erro');
    expect(notificar).not.toHaveBeenCalled();
    expect(d.marcarNotificado).not.toHaveBeenCalled();
  });

  it('passo lança Error → libera e retorna erro', async () => {
    const d = criarDeps({ t: 0 });
    const m = msg();
    const passo = vi.fn(async () => { throw new Error('boom'); });
    const r = await executarMensagem(d, m, passo);
    expect(r).toBe('erro');
    expect(d.liberar).toHaveBeenCalledWith(m, expect.any(String), 'boom');
    expect(d.concluir).not.toHaveBeenCalled();
  });

  it('passo lança SemAcessoRodada → conclui sem_acesso, status 200', async () => {
    const d = criarDeps({ t: 0 });
    const m = msg();
    const passo = vi.fn(async () => { throw new SemAcessoRodada('token inválido'); });
    const r = await executarMensagem(d, m, passo);
    expect(r).toBe('sem_acesso');
    expect(statusHttp(r)).toBe(200);
    expect(d.concluir).toHaveBeenCalledWith(m, expect.any(String), 'sem_acesso', 'token inválido', null, false);
    expect(d.liberar).not.toHaveBeenCalled();
  });

  it('passo lança SemAcessoRodada com a posse já vencida (concluir → false) → erro, 500, linha continua rodando', async () => {
    const relogio = { t: 0 };
    const d = criarDeps(relogio);
    const m = msg();
    const passo = vi.fn(async () => {
      relogio.t += 200_000; // ultrapassa a lease de 150s antes do concluir('sem_acesso')
      throw new SemAcessoRodada('token inválido');
    });
    const r = await executarMensagem(d, m, passo);
    expect(r).toBe('erro'); // NÃO 'sem_acesso': o commit não aconteceu, a linha não mudou
    expect(statusHttp(r)).toBe(500);
    expect(d.linhas.get('pulse-completo:org-1')?.estado).toBe('rodando');
  });

  it('publicar lança após o avancar → erro; retry recebe o cursor novo e segue; cursor nunca volta', async () => {
    const d = criarDeps({ t: 0 });
    const m = msg();
    d.publicar.mockRejectedValueOnce(new Error('qstash indisponível'));
    const r1 = await executarMensagem(d, m, vi.fn(async () => ({ proximo: 'a|1', acumulado: { n: 1 } })));
    expect(r1).toBe('erro');
    expect(d.linhas.get('pulse-completo:org-1')?.cursor).toBe('a|1'); // já avançou no banco

    const passo2 = vi.fn(async (e) => { expect(e.cursor).toBe('a|1'); return { proximo: null, acumulado: {} }; });
    const r2 = await executarMensagem(d, m, passo2);
    expect(r2).toBe('executado');
    expect(passo2).toHaveBeenCalledTimes(1);
    expect(d.linhas.get('pulse-completo:org-1')?.cursor).toBe('a|1'); // nunca volta
  });

  it('entrega duplicada da mesma mensagem → a 2ª processa o lote seguinte, nunca repete cursor', async () => {
    const d = criarDeps({ t: 0 });
    const m = msg();
    await executarMensagem(d, m, vi.fn(async () => ({ proximo: 'a|1', acumulado: {} })));

    const cursoresVistos: (string | null)[] = [];
    const passo2 = vi.fn(async (e) => { cursoresVistos.push(e.cursor); return { proximo: 'a|2', acumulado: {} }; });
    await executarMensagem(d, m, passo2); // "duplicata": mesma mensagem, nada muda do lado do chamador
    expect(cursoresVistos).toEqual(['a|1']);
  });

  it('proximo null sem parcial → conclui ok', async () => {
    const d = criarDeps({ t: 0 });
    const m = msg();
    const r = await executarMensagem(d, m, vi.fn(async () => ({ proximo: null, acumulado: { total: 5 } })));
    expect(r).toBe('executado');
    expect(d.concluir).toHaveBeenCalledWith(m, expect.any(String), 'ok', null, { total: 5 }, false);
  });

  it('proximo null com parcial → conclui parcial com o motivo', async () => {
    const d = criarDeps({ t: 0 });
    const m = msg();
    const passo = vi.fn(async () => ({ proximo: null, acumulado: {}, parcial: '2 pedido(s) pendente(s)' }));
    const r = await executarMensagem(d, m, passo);
    expect(r).toBe('executado');
    expect(d.concluir).toHaveBeenCalledWith(m, expect.any(String), 'parcial', '2 pedido(s) pendente(s)', {}, false);
  });

  it('precisaNotificar: notifica e marca; falha ao notificar → erro; retry notifica de novo → executado; entrega seguinte → concluida', async () => {
    const d = criarDeps({ t: 0 });
    const m = msg();
    const passo = vi.fn(async () => ({ proximo: null, acumulado: { total: 9 } }));
    const notificar = vi.fn().mockRejectedValueOnce(new Error('telegram fora')).mockResolvedValueOnce(undefined);
    const op: OpcoesMsg = { precisaNotificar: () => true, notificar };

    const r1 = await executarMensagem(d, m, passo, op);
    expect(r1).toBe('erro');
    expect(d.concluir).toHaveBeenCalledWith(m, expect.any(String), 'ok', null, { total: 9 }, true);
    expect(notificar).toHaveBeenCalledWith({ total: 9 }, '2026-09-27');
    expect(d.marcarNotificado).not.toHaveBeenCalled();

    const passo2 = vi.fn(); // não roda de novo: este ciclo só está pendente de notificação
    const r2 = await executarMensagem(d, m, passo2, op);
    expect(r2).toBe('executado');
    expect(passo2).not.toHaveBeenCalled();
    expect(notificar).toHaveBeenCalledTimes(2);
    expect(d.marcarNotificado).toHaveBeenCalledTimes(1);

    const r3 = await executarMensagem(d, m, vi.fn(), op);
    expect(r3).toBe('concluida');
  });

  it('notificar_anterior: notifica o ciclo antigo e repete; retry abre o ciclo novo e roda o passo', async () => {
    const d = criarDeps({ t: 0 });
    const antigo = msg({ ciclo: '2026-09-26' });
    // fecha o ciclo antigo com notificação pendente (o próprio notificar falha, mas o concluir(ok) já commitou)
    await executarMensagem(
      d, antigo, vi.fn(async () => ({ proximo: null, acumulado: { total: 4 } })),
      { precisaNotificar: () => true, notificar: vi.fn().mockRejectedValueOnce(new Error('fora')) },
    );

    const novo = msg({ ciclo: '2026-09-27' });
    const notificarNovo = vi.fn().mockResolvedValue(undefined);
    const passo = vi.fn(async () => ({ proximo: null, acumulado: {} }));
    const r1 = await executarMensagem(d, novo, passo, { notificar: notificarNovo });
    expect(r1).toBe('repetir');
    expect(statusHttp(r1)).toBe(500);
    expect(notificarNovo).toHaveBeenCalledWith({ total: 4 }, '2026-09-26'); // ciclo antigo
    expect(passo).not.toHaveBeenCalled();

    const r2 = await executarMensagem(d, novo, passo, { notificar: notificarNovo });
    expect(r2).toBe('executado');
    expect(passo).toHaveBeenCalledTimes(1);
    expect(passo).toHaveBeenCalledWith({ cursor: null, acumulado: {}, params: {} });
  });
});

describe('utilitários', () => {
  it('lerCursor lê "etapa|pos"; null passa direto', () => {
    expect(lerCursor('vendas|123')).toEqual({ etapa: 'vendas', pos: '123' });
    expect(lerCursor('radar|')).toEqual({ etapa: 'radar', pos: '' });
    expect(lerCursor(null)).toBeNull();
    expect(lerCursor(undefined)).toBeNull();
  });

  it('lerCursor lança em cursor malformado (string não-nula sem "|") em vez de reiniciar o ciclo em silêncio', () => {
    expect(() => lerCursor('vendas')).toThrow(/cursor inválido/);
    expect(() => lerCursor('')).toThrow(/cursor inválido/);
  });

  it('gravarCursor é o inverso de lerCursor', () => {
    expect(gravarCursor({ etapa: 'vendas', pos: '123' })).toBe('vendas|123');
  });

  it('cicloDiaBrt converte pro dia BRT (UTC-3)', () => {
    expect(cicloDiaBrt(new Date('2026-09-28T02:30:00Z'))).toBe('2026-09-27');
  });

  it('cicloHoraUtc trunca na hora UTC', () => {
    expect(cicloHoraUtc(new Date('2026-09-28T02:30:00Z'))).toBe('2026-09-28T02');
  });

  it('dedupMsg só usa [A-Za-z0-9_-]', () => {
    const id = dedupMsg('worker-x', { job: 'pulse-completo', org_id: 'org:1', ciclo: '2026-09-27' }, 'vendas|123');
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(id).toBe('worker-x_pulse-completo_org_1_2026-09-27_vendas_123');
  });

  it('ehMsgOrg reconhece o formato e rejeita mensagens de outro formato', () => {
    expect(ehMsgOrg({ modo: 'org', job: 'pulse-completo', org_id: 'org-1', ciclo: '2026-09-27', params: {} })).toBe(true);
    expect(ehMsgOrg({ tier: 'completo' })).toBe(false);
    expect(ehMsgOrg({ dias: 7 })).toBe(false);
  });
});
