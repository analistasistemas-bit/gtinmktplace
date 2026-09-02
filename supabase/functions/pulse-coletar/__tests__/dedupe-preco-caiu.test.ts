import { describe, expect, it, vi } from 'vitest';

// Mesmo motivo do vizinho alertas-severidade.test.ts: ml/token.ts importa _shared/supabase.ts, que faz
// `import { createClient } from 'jsr:...'` (valor real) — sob vitest isso quebra a resolução do módulo.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import {
  alertasJaGravadosHoje, chaveDedupePrecoCaiu, filtrarAlertasJaGravados, inicioDoDiaUtc,
} from '../processar.ts';

const alerta = (de: number, para: number) => ({
  tipo: 'preco_caiu' as const,
  payload: { de, para, meu_preco: 90 },
  severidade: 'acao' as const,
});

describe('dedupe do preco_caiu no mesmo dia (ADR-0133 Errata 3)', () => {
  it('descarta a queda idêntica já gravada hoje para o mesmo produto', () => {
    const jaGravados = new Set([chaveDedupePrecoCaiu('p1', 71.99, 68.99)]);
    expect(filtrarAlertasJaGravados('p1', [alerta(71.99, 68.99)], jaGravados)).toEqual([]);
  });

  it('mantém a queda com OUTRO par de preços no mesmo produto', () => {
    const jaGravados = new Set([chaveDedupePrecoCaiu('p1', 71.99, 68.99)]);
    expect(filtrarAlertasJaGravados('p1', [alerta(70.19, 67.99)], jaGravados)).toHaveLength(1);
  });

  it('mantém a mesma queda em OUTRO produto', () => {
    const jaGravados = new Set([chaveDedupePrecoCaiu('p1', 71.99, 68.99)]);
    expect(filtrarAlertasJaGravados('p2', [alerta(71.99, 68.99)], jaGravados)).toHaveLength(1);
  });

  it('não toca em alerta de outro tipo — só preco_caiu tem par de preços', () => {
    const jaGravados = new Set([chaveDedupePrecoCaiu('p1', 71.99, 68.99)]);
    const novoConcorrente = { tipo: 'novo_concorrente' as const, payload: { preco: 68.99 }, severidade: 'acao' as const };
    expect(filtrarAlertasJaGravados('p1', [novoConcorrente], jaGravados)).toHaveLength(1);
  });

  it('conjunto vazio não descarta nada', () => {
    expect(filtrarAlertasJaGravados('p1', [alerta(71.99, 68.99)], new Set())).toHaveLength(1);
  });
});

// A janela do dedupe e a coluna gerada `dedupe_preco_caiu` (migration 20260901_pulse_alertas_dedupe)
// usam o MESMO dia: o dia civil em UTC. Os vizinhos `pulse_ofertas.dia`/`pulse_vendedores.dia` usam
// America/Sao_Paulo — a divergência é deliberada e estes testes são a trava contra "uniformizar".
describe('inicioDoDiaUtc: a janela do dedupe é o dia UTC, não o local', () => {
  it('23h e 01h do dia seguinte caem em janelas diferentes', () => {
    expect(inicioDoDiaUtc(new Date('2026-08-30T23:00:00.000Z'))).toBe('2026-08-30T00:00:00.000Z');
    expect(inicioDoDiaUtc(new Date('2026-08-31T01:00:00.000Z'))).toBe('2026-08-31T00:00:00.000Z');
  });

  it('usa o dia UTC mesmo quando o dia local (BRT) ainda é o anterior', () => {
    // 2026-08-31T02:00Z = 2026-08-30 23:00 em America/Sao_Paulo (TZ da suíte, vitest.config.ts).
    // Se alguém trocar o helper por dia local, esta linha volta '2026-08-30T00:00:00.000Z'.
    expect(inicioDoDiaUtc(new Date('2026-08-31T02:00:00.000Z'))).toBe('2026-08-31T00:00:00.000Z');
  });

  it('a virada UTC é às 00:00Z — o instante exato já pertence ao dia novo', () => {
    expect(inicioDoDiaUtc(new Date('2026-08-31T00:00:00.000Z'))).toBe('2026-08-31T00:00:00.000Z');
    expect(inicioDoDiaUtc(new Date('2026-08-30T23:59:59.999Z'))).toBe('2026-08-30T00:00:00.000Z');
  });
});

// Fake que REGISTRA os argumentos do `.in()` — o de `alertas-severidade.test.ts` descarta tudo e
// por isso não serviria aqui: o que está sob teste é justamente o tamanho do lote.
function fakeLeitura(porLote: (lote: string[]) => { data: unknown[]; error: null } | Error) {
  const lotes: string[][] = [];
  const admin = {
    from: () => {
      let capturado: string[] = [];
      // deno-lint-ignore no-explicit-any
      const api: any = {
        select: () => api,
        eq: () => api,
        in: (_coluna: string, lote: string[]) => { capturado = lote; lotes.push(lote); return api; },
        gte: () => {
          const r = porLote(capturado);
          if (r instanceof Error) throw r;
          return Promise.resolve(r);
        },
      };
      return api;
    },
  };
  // deno-lint-ignore no-explicit-any
  return { admin: admin as any, lotes };
}

describe('alertasJaGravadosHoje: lote de 50 ids (200 UUIDs num `.in()` = 414 no gateway)', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

  it('quebra o teto de 200 produtos do tier completo em lotes de no máximo 50', async () => {
    const { admin, lotes } = fakeLeitura(() => ({ data: [], error: null }));
    await alertasJaGravadosHoje(admin, 'org', ids(200));
    expect(lotes.map((l) => l.length)).toEqual([50, 50, 50, 50]);
  });

  it('não consulta nada quando não há produto', async () => {
    const { admin, lotes } = fakeLeitura(() => ({ data: [], error: null }));
    expect(await alertasJaGravadosHoje(admin, 'org', [])).toEqual(new Set());
    expect(lotes).toHaveLength(0);
  });

  it('lote que LANÇA não derruba o passo da org e preserva as chaves dos que deram certo', async () => {
    // O cliente pode lançar em vez de devolver `{ error }` — sem o try/catch por lote, a exceção
    // subiria por `gravarAlertasRelevantes` e mataria os alertas da org inteira.
    const { admin } = fakeLeitura((lote) => (
      lote.includes('p60')
        ? new Error('statement timeout')
        : { data: [{ produto_id: 'p1', payload: { de: 71.99, para: 68.99 } }], error: null }
    ));
    const chaves = await alertasJaGravadosHoje(admin, 'org', ids(120));
    expect(chaves.has(chaveDedupePrecoCaiu('p1', 71.99, 68.99))).toBe(true);
  });
});
