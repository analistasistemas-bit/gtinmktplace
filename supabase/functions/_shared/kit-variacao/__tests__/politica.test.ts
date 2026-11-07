import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  skusParticipantes, podeEscreverQuantidade, podeReativar, adquirirExclusao, soltarExclusao, type PoliticaSku,
} from '../politica.ts';

interface Banco {
  modulos: string[] | null;
  kitSkus?: Array<{ org_id: string; codigo: string }>;
  componentes?: Array<{ org_id: string; codigo: string }>;
  falhar?: string;
  rpc?: Record<string, unknown>;
}

/** Banco falso: `consultas` registra cada tabela lida e `rpcs` cada RPC, para provar o que não foi consultado. */
function falso(b: Banco) {
  const consultas: string[] = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const from = (tabela: string) => {
    consultas.push(tabela);
    const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
    const ler = () => {
      if (b.falhar === tabela) return { data: null, error: { message: 'boom' } };
      if (tabela === 'organizations') return { data: b.modulos === null ? null : { modulos_habilitados: b.modulos }, error: null };
      const linhas = (tabela === 'kit_variacao_skus' ? b.kitSkus : b.componentes) ?? [];
      return { data: linhas.filter((r) => filtros.every((f) => f(r))), error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return api; },
      in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.includes(r[c])); return api; },
      maybeSingle: async () => ler(),
      then: (res: (v: unknown) => unknown) => Promise.resolve(ler()).then(res),
    };
    return api;
  };
  const rpc = async (nome: string, args: Record<string, unknown>) => {
    rpcs.push({ nome, args });
    if (b.falhar === nome) return { data: null, error: { message: 'boom' } };
    return { data: b.rpc?.[nome] ?? null, error: null };
  };
  return { admin: { from, rpc } as unknown as SupabaseClient, consultas, rpcs };
}

describe('skusParticipantes', () => {
  it('org sem o módulo: só lê o módulo, nenhuma tabela de kit', async () => {
    const f = falso({ modulos: ['fiscal'], kitSkus: [{ org_id: 'O', codigo: 'A' }] });
    expect(await skusParticipantes(f.admin, 'O', ['A'])).toEqual(new Set());
    expect(f.consultas).toEqual(['organizations']);
  });

  it('lista vazia não consulta nada', async () => {
    const f = falso({ modulos: ['kit_variacao'] });
    expect(await skusParticipantes(f.admin, 'O', [])).toEqual(new Set());
    expect(f.consultas).toEqual([]);
  });

  it('participa quem é SKU de kit ou componente de kit, só da própria org', async () => {
    const f = falso({
      modulos: ['kit_variacao'],
      kitSkus: [{ org_id: 'O', codigo: 'K1' }, { org_id: 'X', codigo: 'C' }],
      componentes: [{ org_id: 'O', codigo: 'P1' }, { org_id: 'O', codigo: 'P1' }, { org_id: 'X', codigo: 'B' }],
    });
    expect(await skusParticipantes(f.admin, 'O', ['K1', 'P1', 'B', 'C', 'Z'])).toEqual(new Set(['K1', 'P1']));
  });

  it.each(['organizations', 'kit_variacao_skus', 'kit_variacao_componentes'])('falha ao ler %s lança', async (t) => {
    const f = falso({ modulos: ['kit_variacao'], falhar: t });
    await expect(skusParticipantes(f.admin, 'O', ['A'])).rejects.toThrow();
  });
});

describe('exclusão', () => {
  it('adquire com o dono e devolve o código ocupado', async () => {
    const f = falso({ modulos: null, rpc: { kit_adquirir_exclusao: { ok: false, codigo: 'P1' } } });
    expect(await adquirirExclusao(f.admin, 'O', ['P1'], 'publicacao', 'R1')).toEqual({ ok: false, codigo: 'P1' });
    expect(f.rpcs[0]).toEqual({
      nome: 'kit_adquirir_exclusao',
      args: { p_org: 'O', p_codigos: ['P1'], p_dono_tipo: 'publicacao', p_dono_id: 'R1' },
    });
  });

  it('erro de RPC lança', async () => {
    const f = falso({ modulos: null, falhar: 'kit_soltar_exclusao' });
    await expect(soltarExclusao(f.admin, 'O', 'R1')).rejects.toThrow();
  });
});

describe('podeEscreverQuantidade', () => {
  it('só a saga escreve em participante; o resto escreve à vontade', () => {
    expect(podeEscreverQuantidade({ participa: false, origem: 'outro' })).toBe(true);
    expect(podeEscreverQuantidade({ participa: true, origem: 'outro' })).toBe(false);
    expect(podeEscreverQuantidade({ participa: true, origem: 'saga' })).toBe(true);
  });
});

describe('podeReativar', () => {
  const p = (x: Partial<PoliticaSku>): PoliticaSku => ({
    estado: 'normal', versao: 1, bloqueio_operador: false, bloqueio_moderacao: false, bloqueio_retirada: false, ...x,
  });

  it('sem política (SKU comum) reativa', () => {
    expect(podeReativar({ politica: null, origem: 'automatico' }).pode).toBe(true);
  });
  it('moderado e retirado nunca reativam', () => {
    for (const origem of ['saga', 'operador', 'automatico'] as const) {
      expect(podeReativar({ politica: p({ bloqueio_moderacao: true }), origem }).pode).toBe(false);
      expect(podeReativar({ politica: p({ bloqueio_retirada: true }), origem }).pode).toBe(false);
    }
  });
  it('guardado não reativa por ninguém; o operador recebe o motivo', () => {
    expect(podeReativar({ politica: p({ estado: 'guardado' }), origem: 'automatico' }).pode).toBe(false);
    expect(podeReativar({ politica: p({ estado: 'guardado' }), origem: 'saga' }).pode).toBe(false);
    const d = podeReativar({ politica: p({ estado: 'guardado' }), origem: 'operador' });
    expect(d).toEqual({ pode: false, motivo: expect.stringContaining('Vender só em kit') });
  });
  it('pausa do operador só o operador desfaz', () => {
    expect(podeReativar({ politica: p({ bloqueio_operador: true }), origem: 'automatico' }).pode).toBe(false);
    expect(podeReativar({ politica: p({ bloqueio_operador: true }), origem: 'saga' }).pode).toBe(false);
    expect(podeReativar({ politica: p({ bloqueio_operador: true }), origem: 'operador' }).pode).toBe(true);
  });
  it('normal e sobra reativam', () => {
    expect(podeReativar({ politica: p({}), origem: 'automatico' }).pode).toBe(true);
    expect(podeReativar({ politica: p({ estado: 'sobra' }), origem: 'automatico' }).pode).toBe(true);
  });
});
