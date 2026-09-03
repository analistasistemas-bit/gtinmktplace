import { describe, it, expect } from 'vitest';
import { decidirStatusLote, contarFamilias, talvezFinalizarLote } from '../finalizar';

const ZEROS = { publicando: 0, pronto: 0, emPreparo: 0, publicado: 0, erro: 0 };

describe('decidirStatusLote', () => {
  it('há família publicando → não mexe', () => {
    expect(decidirStatusLote({ ...ZEROS, publicando: 1 })).toBeNull();
  });
  it('há família pronta → revisao', () => {
    expect(decidirStatusLote({ ...ZEROS, pronto: 2 })).toBe('revisao');
  });
  it('nada pronto mas há família pendente/processando → processando, NÃO concluido', () => {
    expect(decidirStatusLote({ ...ZEROS, emPreparo: 1 })).toBe('processando');
  });
  it('pronto E pendente ao mesmo tempo → revisao (há o que revisar agora)', () => {
    expect(decidirStatusLote({ ...ZEROS, pronto: 1, emPreparo: 1 })).toBe('revisao');
  });
  it('só erros, nenhum publicado → revisao (operador pode Reenviar)', () => {
    expect(decidirStatusLote({ ...ZEROS, erro: 1 })).toBe('revisao');
  });
  // ADR-0151 I-1: documenta o ramo de falha PARCIAL de uma submissão multi-kit (1 publica, 1
  // erro) — o lote técnico do kit vai para 'concluido' (não 'revisao'), então NÃO ganha o card
  // "Reenviar N com erro" da Revisão. Comportamento intencional desta função compartilhada, não
  // mudado por I-1 — a recuperação desse caso é o botão "Reenviar" no DialogCriarKit.
  it('publicado + erro misturados → concluido (kit: falha parcial cai em /relatorio, não /revisao)', () => {
    expect(decidirStatusLote({ ...ZEROS, publicado: 1, erro: 1 })).toBe('concluido');
  });
  it('nada em curso → concluido', () => {
    expect(decidirStatusLote(ZEROS)).toBe('concluido');
  });
});

// O mapeamento status→balde é onde o defeito vivia; decidirStatusLote sozinho não o cobre.
describe('contarFamilias', () => {
  it('mapeia cada status para o balde certo', () => {
    expect(contarFamilias([
      { status: 'publicando' },
      { status: 'pronto' }, { status: 'pronto' },
      { status: 'pendente' }, { status: 'processando' },
    ])).toEqual({ publicando: 1, pronto: 2, emPreparo: 2, publicado: 0, erro: 0 });
  });
  it('status terminais e nulos não contam como trabalho em curso', () => {
    expect(contarFamilias([
      { status: 'publicado' }, { status: 'erro' }, { status: null },
    ])).toEqual({ publicando: 0, pronto: 0, emPreparo: 0, publicado: 1, erro: 1 });
  });
});

interface Update { tabela: string; payload: Record<string, unknown> }

/** Fake mínimo do SupabaseClient: só o select de familias e o update de lotes. */
function fakeAdmin(familias: Array<{ status: string | null }> | null, erro = false) {
  const updates: Update[] = [];
  function chain(tabela: string) {
    // deno-lint-ignore no-explicit-any
    const api: any = {
      select: () => api,
      eq: () => api,
      update: (payload: Record<string, unknown>) => {
        updates.push({ tabela, payload });
        return api;
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
        resolve({ data: familias, error: erro ? { message: 'boom' } : null }),
    };
    return api;
  }
  // deno-lint-ignore no-explicit-any
  return { admin: { from: (t: string) => chain(t) } as any, updates };
}

describe('talvezFinalizarLote', () => {
  it('família pendente no lote → grava processando, não concluido', async () => {
    const { admin, updates } = fakeAdmin([{ status: 'publicado' }, { status: 'pendente' }]);
    await talvezFinalizarLote(admin, 'lote-1');
    expect(updates).toEqual([{ tabela: 'lotes', payload: { status: 'processando' } }]);
  });

  it('lote sem nada em curso → concluido', async () => {
    const { admin, updates } = fakeAdmin([{ status: 'publicado' }, { status: 'erro' }]);
    await talvezFinalizarLote(admin, 'lote-1');
    expect(updates).toEqual([{ tabela: 'lotes', payload: { status: 'concluido' } }]);
  });

  it('lote só com erros → revisao', async () => {
    const { admin, updates } = fakeAdmin([{ status: 'erro' }, { status: 'erro' }]);
    await talvezFinalizarLote(admin, 'lote-1');
    expect(updates).toEqual([{ tabela: 'lotes', payload: { status: 'revisao' } }]);
  });

  it('ainda há família publicando → nenhum update', async () => {
    const { admin, updates } = fakeAdmin([{ status: 'publicando' }, { status: 'pronto' }]);
    await talvezFinalizarLote(admin, 'lote-1');
    expect(updates).toEqual([]);
  });

  // Sem este guard, a leitura falha vira contagem vazia → 'concluido' terminal num lote vivo.
  it('erro na leitura → não escreve nada', async () => {
    const { admin, updates } = fakeAdmin(null, true);
    await talvezFinalizarLote(admin, 'lote-1');
    expect(updates).toEqual([]);
  });
});
