import { describe, it, expect } from 'vitest';
import { decidirStatusLote, contarFamilias, talvezFinalizarLote } from '../finalizar';

describe('decidirStatusLote', () => {
  it('há família publicando → não mexe', () => {
    expect(decidirStatusLote({ publicando: 1, pronto: 0, emPreparo: 0 })).toBeNull();
  });
  it('há família pronta → revisao', () => {
    expect(decidirStatusLote({ publicando: 0, pronto: 2, emPreparo: 0 })).toBe('revisao');
  });
  it('nada pronto mas há família pendente/processando → processando, NÃO concluido', () => {
    expect(decidirStatusLote({ publicando: 0, pronto: 0, emPreparo: 1 })).toBe('processando');
  });
  it('pronto E pendente ao mesmo tempo → revisao (há o que revisar agora)', () => {
    expect(decidirStatusLote({ publicando: 0, pronto: 1, emPreparo: 1 })).toBe('revisao');
  });
  it('nada em curso → concluido', () => {
    expect(decidirStatusLote({ publicando: 0, pronto: 0, emPreparo: 0 })).toBe('concluido');
  });
});

// O mapeamento status→balde é onde o defeito vivia; decidirStatusLote sozinho não o cobre.
describe('contarFamilias', () => {
  it('mapeia cada status para o balde certo', () => {
    expect(contarFamilias([
      { status: 'publicando' },
      { status: 'pronto' }, { status: 'pronto' },
      { status: 'pendente' }, { status: 'processando' },
    ])).toEqual({ publicando: 1, pronto: 2, emPreparo: 2 });
  });
  it('status terminais e nulos não contam como trabalho em curso', () => {
    expect(contarFamilias([
      { status: 'publicado' }, { status: 'erro' }, { status: null },
    ])).toEqual({ publicando: 0, pronto: 0, emPreparo: 0 });
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
