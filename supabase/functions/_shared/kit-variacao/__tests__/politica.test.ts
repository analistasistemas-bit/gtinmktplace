import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  prepararStatusOperador, MSG_KIT_EM_TRANSFERENCIA, MSG_KIT_POLITICA_MUDOU,
  skusParticipantes, podeEscreverQuantidade, podeReativar, adquirirExclusao, soltarExclusao, kitLigado, lerPoliticas,
  type PoliticaSku,
} from '../politica.ts';

interface Banco {
  modulos: string[] | null;
  kitSkus?: Array<{ org_id: string; codigo: string }>;
  componentes?: Array<{ org_id: string; codigo: string }>;
  politicas?: Array<Record<string, unknown>>;
  itens?: Array<Record<string, unknown>>;
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
      const linhas = (tabela === 'kit_variacao_skus' ? b.kitSkus
        : tabela === 'sku_politica_kit' ? b.politicas
        : tabela === 'anuncios_externos_itens' ? b.itens : b.componentes) ?? [];
      return { data: linhas.filter((r) => filtros.every((f) => f(r))), error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return api; },
      in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.includes(r[c])); return api; },
      // Só o formato `a.eq.X,b.eq.Y` que o código usa.
      or: (expr: string) => {
        const ou = expr.split(',').map((t) => t.split('.eq.'));
        filtros.push((r) => ou.some(([c, v]) => r[c] === v));
        return api;
      },
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

describe('kitLigado', () => {
  it('lê o módulo do embed de organizations na linha de família; sem embed, desligado', () => {
    expect(kitLigado({ organizations: { modulos_habilitados: ['kit_variacao'] } })).toBe(true);
    expect(kitLigado({ organizations: { modulos_habilitados: ['fiscal'] } })).toBe(false);
    expect(kitLigado({ organizations: null })).toBe(false);
    expect(kitLigado({})).toBe(false);
    expect(kitLigado(null)).toBe(false);
    expect(kitLigado({ organizations: [{ modulos_habilitados: ['kit_variacao'] }] })).toBe(true);
  });
});

describe('skusParticipantes', () => {
  it('módulo desligado: nenhuma consulta', async () => {
    const f = falso({ modulos: null, kitSkus: [{ org_id: 'O', codigo: 'A' }] });
    expect(await skusParticipantes(f.admin, 'O', ['A'], false)).toEqual(new Set());
    expect(f.consultas).toEqual([]);
  });

  it('lista vazia não consulta nada', async () => {
    const f = falso({ modulos: null });
    expect(await skusParticipantes(f.admin, 'O', [], true)).toEqual(new Set());
    expect(f.consultas).toEqual([]);
  });

  it('participa quem é SKU de kit ou componente de kit, só da própria org', async () => {
    const f = falso({
      modulos: null,
      kitSkus: [{ org_id: 'O', codigo: 'K1' }, { org_id: 'X', codigo: 'C' }],
      componentes: [{ org_id: 'O', codigo: 'P1' }, { org_id: 'O', codigo: 'P1' }, { org_id: 'X', codigo: 'B' }],
    });
    expect(await skusParticipantes(f.admin, 'O', ['K1', 'P1', 'B', 'C', 'Z'], true)).toEqual(new Set(['K1', 'P1']));
    expect(f.consultas).toEqual(['kit_variacao_skus', 'kit_variacao_componentes']);
  });

  it.each(['kit_variacao_skus', 'kit_variacao_componentes'])('falha ao ler %s lança', async (t) => {
    const f = falso({ modulos: null, falhar: t });
    await expect(skusParticipantes(f.admin, 'O', ['A'], true)).rejects.toThrow();
  });
});

describe('lerPoliticas', () => {
  it('mapa por código; erro lança', async () => {
    const f = falso({ modulos: null, politicas: [{ org_id: 'O', codigo: 'A', estado: 'guardado', versao: 3 }] });
    expect((await lerPoliticas(f.admin, 'O', ['A', 'B'])).get('A')?.estado).toBe('guardado');
    const g = falso({ modulos: null, falhar: 'sku_politica_kit' });
    await expect(lerPoliticas(g.admin, 'O', ['A'])).rejects.toThrow();
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

describe('prepararStatusOperador (Task 6: pausar/reativar pelo operador)', () => {
  const ITENS = [
    { org_id: 'O', sku: 'P1', item_externo_id: 'MLB1', catalog_listing_id: 'MLB1C' },
    { org_id: 'O', sku: 'C1', item_externo_id: 'MLB2', catalog_listing_id: null },
  ];
  const banco = (x: Partial<Banco> = {}): Banco => ({
    modulos: ['kit_variacao'], itens: ITENS, componentes: [{ org_id: 'O', codigo: 'P1' }],
    rpc: { kit_adquirir_exclusao: { ok: true }, kit_politica_operador: { ok: true } }, ...x,
  });
  const pol = (x: Record<string, unknown> = {}) => ({
    org_id: 'O', codigo: 'P1', estado: 'normal', versao: 4, bloqueio_operador: false,
    bloqueio_moderacao: false, bloqueio_retirada: false, ...x,
  });

  it('org sem o módulo: nenhuma consulta nem RPC', async () => {
    const f = falso(banco({ modulos: null }));
    const r = await prepararStatusOperador(f.admin, 'O', 'MLB1', 'ativo', false);
    expect('soltar' in r).toBe(true);
    expect(f.consultas).toEqual([]);
    expect(f.rpcs).toEqual([]);
  });

  it('SKU comum em org com o módulo: lê o vínculo e a participação, sem RPC', async () => {
    const f = falso(banco());
    const r = await prepararStatusOperador(f.admin, 'O', 'MLB2', 'ativo', true);
    expect('soltar' in r).toBe(true);
    expect(f.rpcs).toEqual([]);
  });

  it('pausa manual grava bloqueio_operador (incrementa a versão) antes do PUT, sem exclusão', async () => {
    const f = falso(banco());
    const r = await prepararStatusOperador(f.admin, 'O', 'MLB1', 'pausado', true);
    expect('soltar' in r).toBe(true);
    expect(f.rpcs).toEqual([{ nome: 'kit_politica_operador', args: { p_org: 'O', p_codigos: ['P1'], p_bloquear: true } }]);
  });

  it('a cópia de catálogo também acha o SKU', async () => {
    const f = falso(banco());
    await prepararStatusOperador(f.admin, 'O', 'MLB1C', 'pausado', true);
    expect(f.rpcs.map((x) => x.args.p_codigos)).toEqual([['P1']]);
  });

  it('Guardado: recusa com o motivo de "Vender só em kit", sem exclusão nem escrita', async () => {
    const f = falso(banco({ politicas: [pol({ estado: 'guardado' })] }));
    const r = await prepararStatusOperador(f.admin, 'O', 'MLB1', 'ativo', true);
    expect(r).toEqual({ recusa: expect.stringContaining('Vender só em kit') });
    expect(f.rpcs).toEqual([]);
  });

  it('moderado (política) nunca reativa', async () => {
    const f = falso(banco({ politicas: [pol({ bloqueio_moderacao: true })] }));
    expect(await prepararStatusOperador(f.admin, 'O', 'MLB1', 'ativo', true)).toEqual({ recusa: expect.stringContaining('moderado') });
    expect(f.rpcs).toEqual([]);
  });

  it('moderado lido no ML nunca reativa, mesmo sem bloqueio na política', async () => {
    const f = falso(banco());
    const r = await prepararStatusOperador(f.admin, 'O', 'MLB1', 'ativo', true, async () => 'moderado');
    expect(r).toEqual({ recusa: expect.stringContaining('moderado') });
    expect(f.rpcs).toEqual([]);
  });

  it('pausa do operador: o operador reativa; exclusão ativacao, limpa o bloqueio com a versão lida e solta no fim', async () => {
    const f = falso(banco({ politicas: [pol({ bloqueio_operador: true })] }));
    const r = await prepararStatusOperador(f.admin, 'O', 'MLB1', 'ativo', true, async () => 'pausado');
    if (!('soltar' in r)) throw new Error('recusou');
    expect(f.rpcs.map((x) => x.nome)).toEqual(['kit_adquirir_exclusao', 'kit_politica_operador']);
    const dono = f.rpcs[0].args.p_dono_id;
    expect(f.rpcs[0].args).toMatchObject({ p_codigos: ['P1'], p_dono_tipo: 'ativacao' });
    expect(f.rpcs[1].args).toEqual({ p_org: 'O', p_codigos: ['P1'], p_bloquear: false, p_versoes: { P1: 4 } });
    await r.soltar();
    expect(f.rpcs[2]).toEqual({ nome: 'kit_soltar_exclusao', args: { p_org: 'O', p_dono_id: dono } });
  });

  it('SKU em transferência (exclusão ocupada): recusa sem mexer na política', async () => {
    const f = falso(banco({ rpc: { kit_adquirir_exclusao: { ok: false, codigo: 'P1' } } }));
    expect(await prepararStatusOperador(f.admin, 'O', 'MLB1', 'ativo', true)).toEqual({ recusa: MSG_KIT_EM_TRANSFERENCIA });
    expect(f.rpcs.map((x) => x.nome)).toEqual(['kit_adquirir_exclusao']);
  });

  it('política mudou entre a leitura e a escrita: recusa e solta a exclusão', async () => {
    const f = falso(banco({ rpc: { kit_adquirir_exclusao: { ok: true }, kit_politica_operador: { ok: false, codigo: 'P1' } } }));
    expect(await prepararStatusOperador(f.admin, 'O', 'MLB1', 'ativo', true)).toEqual({ recusa: MSG_KIT_POLITICA_MUDOU });
    expect(f.rpcs.map((x) => x.nome)).toEqual(['kit_adquirir_exclusao', 'kit_politica_operador', 'kit_soltar_exclusao']);
  });

  it('falha de leitura lança (não ativa)', async () => {
    const f = falso(banco({ falhar: 'anuncios_externos_itens' }));
    await expect(prepararStatusOperador(f.admin, 'O', 'MLB1', 'ativo', true)).rejects.toThrow();
  });
});
