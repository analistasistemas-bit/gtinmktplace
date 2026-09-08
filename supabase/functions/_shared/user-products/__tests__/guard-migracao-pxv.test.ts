import { describe, it, expect } from 'vitest';
import { motivoMigracaoPxvEmCurso, motivoMigracaoPxvPorItem, MENSAGEM_MIGRACAO_EM_CURSO } from '../guard-migracao-pxv';

/** Fake admin mínimo: devolve `linha` no maybeSingle e `linhas` na consulta por item. */
function fakeAdmin(resposta: { linha?: Record<string, unknown> | null; linhas?: unknown[]; erro?: boolean }) {
  const api: Record<string, unknown> = {
    select: () => api, eq: () => api, or: () => api, in: () => api, limit: () => api,
    maybeSingle: async () => ({ data: resposta.linha ?? null, error: resposta.erro ? { message: 'boom' } : null }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: resposta.linhas ?? [], error: resposta.erro ? { message: 'boom' } : null }).then(resolve),
  };
  return { from: () => api } as never;
}

describe('motivoMigracaoPxvEmCurso', () => {
  it('sem migração → libera', async () => {
    expect(await motivoMigracaoPxvEmCurso(fakeAdmin({ linha: { migracao_pxv_status: null } }), 'org', '000')).toBeNull();
  });

  it('solicitada e em_andamento bloqueiam', async () => {
    for (const st of ['solicitada', 'em_andamento']) {
      const r = await motivoMigracaoPxvEmCurso(fakeAdmin({ linha: { migracao_pxv_status: st } }), 'org', '000');
      expect(r).toBe(MENSAGEM_MIGRACAO_EM_CURSO);
    }
  });

  // `erro` significa que a migração PAROU. Bloquear aqui prenderia o produto: o operador precisa
  // poder republicar justamente para o app reconciliar pelo caminho do ADR-0105.
  it('erro NÃO bloqueia — o operador precisa poder agir', async () => {
    expect(await motivoMigracaoPxvEmCurso(fakeAdmin({ linha: { migracao_pxv_status: 'erro' } }), 'org', '000')).toBeNull();
  });

  it('produto sem raiz → libera', async () => {
    expect(await motivoMigracaoPxvEmCurso(fakeAdmin({ linha: null }), 'org', '000')).toBeNull();
  });

  // Fail-OPEN deliberado: o guard remoto do conector (ADR-0160) ainda segura o caso real. Bloquear
  // por falha de leitura transformaria uma indisponibilidade momentânea do banco em recusa de
  // trabalho legítimo, em toda publicação da org.
  it('erro de consulta libera (fail-open), porque o guard remoto ainda cobre', async () => {
    expect(await motivoMigracaoPxvEmCurso(fakeAdmin({ erro: true }), 'org', '000')).toBeNull();
  });
});

describe('motivoMigracaoPxvPorItem', () => {
  it('item em migração bloqueia', async () => {
    expect(await motivoMigracaoPxvPorItem(fakeAdmin({ linhas: [{ migracao_pxv_status: 'em_andamento' }] }), 'org', 'MLB1'))
      .toBe(MENSAGEM_MIGRACAO_EM_CURSO);
  });

  it('nenhuma linha → libera', async () => {
    expect(await motivoMigracaoPxvPorItem(fakeAdmin({ linhas: [] }), 'org', 'MLB1')).toBeNull();
  });

  it('erro de consulta libera (fail-open)', async () => {
    expect(await motivoMigracaoPxvPorItem(fakeAdmin({ erro: true }), 'org', 'MLB1')).toBeNull();
  });
});
