import { describe, it, expect } from 'vitest';
import { reconciliarConvergencia, type PortasConvergencia, type ClaimResultado } from '../reconciliar-convergencia';

// ADR-0088 — Reconciliador de CONVERGÊNCIA. Escopo desta entrega: só mudando_composicao=true
// (reusa atualizarFamiliaUP inteiro). Claim atômico (RPC) fecha a corrida entre 2 execuções do
// reconciliador e entre o reconciliador e o worker normal do UPDATE — null = perdeu o claim,
// nunca processa. familiaId vem do claim (referência durável, nunca inferida por recência).

const CLAIM = (over: Partial<ClaimResultado> = {}): ClaimResultado => ({
  rootId: 'root-1', orgId: 'org-1', codigoPai: '00012345', titulo: 'Fam UP', criadoEm: '2026-01-01T00:00:00Z',
  skusEsperados: ['A', 'B'], familiaId: 'fam-1', tentativas: 3, ...over,
});

function fakePortas(over: Partial<PortasConvergencia> = {}): PortasConvergencia & { claimados: string[] } {
  const claimados: string[] = [];
  return {
    claimados,
    claim: async (rootId: string) => { claimados.push(rootId); return CLAIM(); },
    resumirComposicao: async () => ({ estado: 'ok' as const }),
    ...over,
  };
}

describe('reconciliarConvergencia — claim atômico', () => {
  it('perde o claim (null) → tipo perdeu_claim, NUNCA chama resumirComposicao', async () => {
    let chamouResumir = false;
    const portas = fakePortas({
      claim: async () => null,
      resumirComposicao: async () => { chamouResumir = true; return { estado: 'ok' }; },
    });
    const r = await reconciliarConvergencia(portas, ['root-1']);
    expect(r).toEqual([{ rootId: 'root-1', tipo: 'perdeu_claim' }]);
    expect(chamouResumir).toBe(false);
  });

  it('claim sem familiaId (episódio antigo, pré-migration) → sem_familia_referenciada, nunca adivinha por recência', async () => {
    let chamouResumir = false;
    const portas = fakePortas({
      claim: async () => CLAIM({ familiaId: null }),
      resumirComposicao: async () => { chamouResumir = true; return { estado: 'ok' }; },
    });
    const r = await reconciliarConvergencia(portas, ['root-1']);
    expect(r).toEqual([{ rootId: 'root-1', tipo: 'sem_familia_referenciada' }]);
    expect(chamouResumir).toBe(false);
  });
});

describe('reconciliarConvergencia — mudando_composicao=true (reusa atualizarFamiliaUP)', () => {
  it('converge (estado=ok) → tipo convergiu', async () => {
    const portas = fakePortas({ resumirComposicao: async () => ({ estado: 'ok' }) });
    const r = await reconciliarConvergencia(portas, ['root-1']);
    expect(r).toEqual([{ rootId: 'root-1', tipo: 'convergiu' }]);
    expect(portas.claimados).toEqual(['root-1']);
  });

  it('ainda incompleto mas com orçamento (estado=retry) → tipo retry', async () => {
    const portas = fakePortas({ resumirComposicao: async () => ({ estado: 'retry' }) });
    const r = await reconciliarConvergencia(portas, ['root-1']);
    expect(r).toEqual([{ rootId: 'root-1', tipo: 'retry' }]);
  });

  it('orçamento esgotado (estado=erro, atualizarFamiliaUP já limpou mudando_composicao internamente) → tipo erro', async () => {
    const portas = fakePortas({ resumirComposicao: async () => ({ estado: 'erro' }) });
    const r = await reconciliarConvergencia(portas, ['root-1']);
    expect(r).toEqual([{ rootId: 'root-1', tipo: 'erro', motivo: expect.any(String) }]);
  });

  it('resumirComposicao recebe o claim inteiro (família/tentativas/skusEsperados corretos)', async () => {
    let claimVisto: ClaimResultado | null = null;
    const portas = fakePortas({
      claim: async () => CLAIM({ familiaId: 'fam-especifica', tentativas: 7, skusEsperados: ['X', 'Y'] }),
      resumirComposicao: async (claim) => { claimVisto = claim; return { estado: 'ok' }; },
    });
    await reconciliarConvergencia(portas, ['root-1']);
    expect(claimVisto).toEqual(CLAIM({ familiaId: 'fam-especifica', tentativas: 7, skusEsperados: ['X', 'Y'] }));
  });
});

describe('reconciliarConvergencia — múltiplas raízes, best-effort', () => {
  it('erro numa raiz NÃO impede o processamento das demais', async () => {
    const portas = fakePortas({
      claim: async (rootId: string) => (rootId === 'root-1' ? null : CLAIM()), // perde claim só na 1ª
      resumirComposicao: async () => ({ estado: 'ok' }),
    });
    const r = await reconciliarConvergencia(portas, ['root-1', 'root-2']);
    expect(r).toEqual([
      { rootId: 'root-1', tipo: 'perdeu_claim' },
      { rootId: 'root-2', tipo: 'convergiu' },
    ]);
  });

  it('exceção numa raiz (rede/timeout) NÃO derruba as demais', async () => {
    const portas = fakePortas({
      claim: async (rootId: string) => {
        if (rootId === 'root-1') throw new Error('timeout');
        return CLAIM();
      },
    });
    const r = await reconciliarConvergencia(portas, ['root-1', 'root-2']);
    expect(r).toEqual([
      { rootId: 'root-1', tipo: 'erro', motivo: expect.any(String) },
      { rootId: 'root-2', tipo: 'convergiu' },
    ]);
  });
});
