import { describe, expect, it, vi } from 'vitest';
import { executarStatus, MSG_FALHA_STATUS, type DepsStatus, type OperacaoStatusRow } from '../executar-status.ts';
import { MSG_BLOQUEADO_STATUS } from '../decidir-status.ts';
import { MSG_RECONECTAR } from '../falhas.ts';
import { SemAcessoStatusML } from '../ml-status.ts';
import type { ItemRow } from '../tipos.ts';
import type { StatusAnuncioCanal } from '../../canais/contrato.ts';

type Linha = ItemRow & { mensagem?: string | null };
const item = (id: string): Linha => ({
  ml_item_id: id, preco: null, status: 'pendente', conferencias: 0, semaforo: null, confirmado_risco: false,
  proxima_conferencia: null, saida_pedida_em: null,
});

function montar(itens: Linha[], status: Record<string, StatusAnuncioCanal | null>, opts: {
  pxv?: Record<string, string>; falhaCanal?: string[]; passoMs?: number;
} = {}) {
  let t = 0;
  const deps: DepsStatus = {
    agora: () => (t += opts.passoMs ?? 0),
    reivindicar: vi.fn(async (_o, id) => {
      const it = itens.find((i) => i.ml_item_id === id)!;
      if (it.status !== 'pendente') return false;
      it.status = 'enviando';
      return true;
    }),
    itensPendentes: vi.fn(async (_o, limite) => itens.filter((i) => i.status === 'pendente').slice(0, limite).map((i) => ({ ...i }))),
    temEnviando: vi.fn(async () => itens.some((i) => i.status === 'enviando')),
    itensAConferir: vi.fn(async () => []),
    gravarItem: vi.fn(async (_o, id, campos) => { Object.assign(itens.find((i) => i.ml_item_id === id)!, campos); }),
    continuar: vi.fn(async () => {}),
    agendarConferencia: vi.fn(async () => {}),
    concluir: vi.fn(async () => {}),
    lerStatus: vi.fn(async (id) => status[id] ?? null),
    migracaoPxv: vi.fn(async (id) => opts.pxv?.[id] ?? null),
    atualizarStatus: vi.fn(async (id) => (opts.falhaCanal?.includes(id)
      ? { ok: false, erro: { codigo: 'DESCONHECIDO', mensagemOperador: 'ML recusou', retentavel: false, status: 400 } }
      : { ok: true })) as DepsStatus['atualizarStatus'],
    encerrarRestantes: vi.fn(async (mensagem: string) => {
      for (const i of itens) if (i.status === 'pendente' || i.status === 'enviando') Object.assign(i, { status: 'erro', mensagem });
    }),
  };
  return deps;
}
const PAUSAR: OperacaoStatusRow = { id: 'op', org_id: 'o', acao: 'pausar' };
const OPTS = { limiteMs: 60_000, lote: 10, maxItens: 100 };

describe('executarStatus', () => {
  it('um desfecho por item e conclui', async () => {
    const itens = ['A', 'B', 'C', 'D', 'E', 'F'].map(item);
    const deps = montar(itens, { A: 'ativo', B: 'pausado', C: 'moderado', D: 'ativo', E: null, F: 'ativo' },
      { pxv: { D: 'Migração em curso' }, falhaCanal: ['F'] });
    const r = await executarStatus(PAUSAR, deps, OPTS);
    expect(r).toEqual({ processados: 6, continuou: false });
    expect(itens.map((i) => [i.ml_item_id, i.status, i.mensagem ?? null])).toEqual([
      ['A', 'aplicado', null],
      ['B', 'ja_estava', null],
      ['C', 'bloqueado', MSG_BLOQUEADO_STATUS],
      ['D', 'bloqueado', 'Migração em curso'],
      ['E', 'erro', 'O ML não devolveu o anúncio'],
      ['F', 'erro', 'ML recusou'],
    ]);
    expect(deps.atualizarStatus).toHaveBeenCalledTimes(2); // só A e F escrevem
    expect(deps.atualizarStatus).toHaveBeenCalledWith('A', 'pausado');
    expect(deps.concluir).toHaveBeenCalledTimes(1);
  });

  it('reativar escreve ativo', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: 'pausado' });
    await executarStatus({ ...PAUSAR, acao: 'reativar' }, deps, OPTS);
    expect(deps.atualizarStatus).toHaveBeenCalledWith('A', 'ativo');
    expect(itens[0].status).toBe('aplicado');
  });

  it('erro de canal sem mensagem usa a genérica', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: 'ativo' });
    deps.atualizarStatus = vi.fn(async () => ({ ok: false }));
    await executarStatus(PAUSAR, deps, OPTS);
    expect(itens[0]).toMatchObject({ status: 'erro', mensagem: MSG_FALHA_STATUS });
  });

  it('leitura que lança vira erro do item e o laço segue', async () => {
    const itens = [item('A'), item('B')];
    const deps = montar(itens, { B: 'ativo' });
    deps.lerStatus = vi.fn(async (id: string) => { if (id === 'A') throw new Error('ML 500'); return 'ativo' as const; });
    await executarStatus(PAUSAR, deps, OPTS);
    expect(itens.map((i) => i.status)).toEqual(['erro', 'aplicado']);
  });

  it('erro RETENTÁVEL (502 após pausar 1 relacionado): item segue enviando com a tentativa contada, os OUTROS itens seguem, continua em 150 s sem relançar', async () => {
    const itens = [item('A'), item('B')];
    const deps = montar(itens, { A: 'ativo', B: 'ativo' });
    deps.atualizarStatus = vi.fn(async (id: string) => (id === 'A'
      ? { ok: false, erro: { codigo: 'INDISPONIVEL', mensagemOperador: 'ML fora', retentavel: true, status: 502 } }
      : { ok: true }));
    const r = await executarStatus(PAUSAR, deps, OPTS);
    expect(r).toEqual({ processados: 2, continuou: true });
    expect(itens[0]).toMatchObject({ status: 'enviando', conferencias: 1, mensagem: 'ML fora' });
    expect(itens[0].saida_pedida_em).not.toBeNull(); // marca gravada antes do PUT
    expect(itens[1].status).toBe('aplicado');
    expect(deps.continuar).toHaveBeenCalledWith(150);
    expect(deps.concluir).not.toHaveBeenCalled();
  });

  it('falha de TRANSPORTE (erro sem status HTTP, conector diz não retentável) também é retentada', async () => {
    const itens = [item('A')];
    const deps = montar(itens, { A: 'ativo' });
    deps.atualizarStatus = vi.fn(async () => ({ ok: false, erro: { codigo: 'DESCONHECIDO', mensagemOperador: 'fetch failed', retentavel: false } }));
    await executarStatus(PAUSAR, deps, OPTS);
    expect(itens[0]).toMatchObject({ status: 'enviando', conferencias: 1 });
  });

  it('recuperação com gravação de aplicado falhando relança (item fica enviando, não vira erro)', async () => {
    const itens = [{ ...item('A'), saida_pedida_em: '2026-10-04T12:00:00Z' }];
    const deps = montar(itens, { A: 'pausado' });
    deps.gravarItem = vi.fn(async () => { throw new Error('db fora'); });
    await expect(executarStatus(PAUSAR, deps, OPTS)).rejects.toThrow('db fora');
    expect(itens[0].status).toBe('enviando');
  });

  it('retentável esgotado (3ª tentativa) → erro terminal', async () => {
    const itens = [{ ...item('A'), conferencias: 2 }];
    const deps = montar(itens, { A: 'ativo' });
    deps.atualizarStatus = vi.fn(async () => ({ ok: false, erro: { codigo: 'INDISPONIVEL', mensagemOperador: 'ML fora', retentavel: true, status: 502 } }));
    await executarStatus(PAUSAR, deps, OPTS);
    expect(itens[0]).toMatchObject({ status: 'erro', mensagem: 'ML fora' });
  });

  it('recuperação: escrita já pedida e anúncio no alvo → aplicado (não ja_estava), sem escrever de novo', async () => {
    const itens = [{ ...item('A'), saida_pedida_em: '2026-10-04T12:00:00Z' }];
    const deps = montar(itens, { A: 'pausado' });
    await executarStatus(PAUSAR, deps, OPTS);
    expect(itens[0].status).toBe('aplicado');
    expect(deps.atualizarStatus).not.toHaveBeenCalled();
  });

  it('AUTENTICACAO na escrita ou 401/403 na leitura → fatal: este e todos os restantes viram erro de reconexão', async () => {
    const itens = [item('A'), item('B')];
    const deps = montar(itens, { A: 'ativo', B: 'ativo' });
    deps.lerStatus = vi.fn(async () => { throw new SemAcessoStatusML('ML 403'); });
    await executarStatus(PAUSAR, deps, OPTS);
    expect(itens.map((i) => [i.status, i.mensagem])).toEqual([['erro', MSG_RECONECTAR], ['erro', MSG_RECONECTAR]]);
    expect(deps.concluir).toHaveBeenCalled();

    const itens2 = [item('C')];
    const deps2 = montar(itens2, { C: 'ativo' });
    deps2.atualizarStatus = vi.fn(async () => ({ ok: false, erro: { codigo: 'AUTENTICACAO', mensagemOperador: 'token', retentavel: false, status: 401 } }));
    await executarStatus(PAUSAR, deps2, OPTS);
    expect(itens2[0]).toMatchObject({ status: 'erro', mensagem: MSG_RECONECTAR });
  });

  it('A retentável e depois B fatal → A também vira erro de reconexão; conclui sem continuação', async () => {
    const itens = [item('A'), item('B')];
    const deps = montar(itens, { A: 'ativo', B: 'ativo' });
    deps.atualizarStatus = vi.fn(async (id: string) => (id === 'A'
      ? { ok: false, erro: { codigo: 'INDISPONIVEL', mensagemOperador: 'ML fora', retentavel: true, status: 502 } }
      : { ok: false, erro: { codigo: 'AUTENTICACAO', mensagemOperador: 'token', retentavel: false, status: 403 } }));
    const r = await executarStatus(PAUSAR, deps, OPTS);
    expect(r).toEqual({ processados: 2, continuou: false });
    expect(itens.map((i) => [i.status, i.mensagem])).toEqual([['erro', MSG_RECONECTAR], ['erro', MSG_RECONECTAR]]);
    expect(deps.continuar).not.toHaveBeenCalled();
    expect(deps.concluir).toHaveBeenCalledTimes(1);
  });

  it('teto por contagem: continua via QStash sem concluir', async () => {
    const itens = ['A', 'B', 'C'].map(item);
    const deps = montar(itens, { A: 'ativo', B: 'ativo', C: 'ativo' });
    const r = await executarStatus(PAUSAR, deps, { ...OPTS, maxItens: 2 });
    expect(r).toEqual({ processados: 2, continuou: true });
    expect(deps.continuar).toHaveBeenCalledTimes(1);
    expect(deps.concluir).not.toHaveBeenCalled();
  });
});
