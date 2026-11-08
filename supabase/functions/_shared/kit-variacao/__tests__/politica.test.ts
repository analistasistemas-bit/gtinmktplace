import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { SemAcessoStatusML } from '../../operacoes/ml-status.ts';
import {
  prepararStatusOperador, donoAtivacao, MSG_KIT_EM_TRANSFERENCIA, MSG_KIT_POLITICA_MUDOU, MSG_KIT_SEM_LEITURA,
  MSG_KIT_MODERADO, type OpcoesStatusOperador,
  skusParticipantes, podeEscreverQuantidade, podeReativar, adquirirExclusao, soltarExclusao, kitLigado, lerPoliticas,
  type PoliticaSku,
} from '../politica.ts';

interface Banco {
  modulos: string[] | null;
  kitSkus?: Array<{ org_id: string; codigo: string }>;
  componentes?: Array<{ org_id: string; codigo: string }>;
  politicas?: Array<Record<string, unknown>>;
  itens?: Array<Record<string, unknown>>;
  ativacoes?: Array<Record<string, unknown>>;
  falhar?: string;
  rpc?: Record<string, unknown>;
}

/** Banco falso: `consultas` registra cada tabela lida e `rpcs` cada RPC, para provar o que não foi consultado. */
function falso(b: Banco) {
  const consultas: string[] = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  /** Escritas e RPCs na ordem em que aconteceram. */
  const eventos: string[] = [];
  b.ativacoes ??= [];
  const from = (tabela: string) => {
    consultas.push(tabela);
    const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
    let apagar = false;
    const ler = () => {
      if (b.falhar === tabela) return { data: null, error: { message: 'boom' } };
      if (tabela === 'kit_ativacoes') {
        const achadas = b.ativacoes!.filter((r) => filtros.every((f) => f(r)));
        if (apagar) {
          eventos.push('delete:kit_ativacoes');
          b.ativacoes = b.ativacoes!.filter((r) => !achadas.includes(r));
        }
        return { data: achadas, error: null };
      }
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
      delete: () => { apagar = true; return api; },
      upsert: async (linha: Record<string, unknown>) => {
        eventos.push(`upsert:${tabela}`);
        b.ativacoes = [...b.ativacoes!.filter((r) => r.dono_id !== linha.dono_id), linha];
        return { error: null };
      },
      maybeSingle: async () => {
        const r = ler();
        return Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r;
      },
      then: (res: (v: unknown) => unknown) => Promise.resolve(ler()).then(res),
    };
    return api;
  };
  const rpc = async (nome: string, args: Record<string, unknown>) => {
    rpcs.push({ nome, args });
    eventos.push(`rpc:${nome}`);
    if (b.falhar === nome) return { data: null, error: { message: 'boom' } };
    return { data: b.rpc?.[nome] ?? null, error: null };
  };
  return { admin: { from, rpc } as unknown as SupabaseClient, consultas, rpcs, eventos, banco: b };
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
  const preparar = (f: ReturnType<typeof falso>, x: Partial<OpcoesStatusOperador> = {}) => {
    const lidos: string[] = [];
    const alertas: string[] = [];
    const o: OpcoesStatusOperador = {
      orgId: 'O', mlItemId: 'MLB1', alvo: 'ativo', ligado: true,
      lerStatus: async (id) => { lidos.push(id); return 'pausado'; },
      alertar: async (t) => { alertas.push(t); },
      ...x,
    };
    return { r: prepararStatusOperador(f.admin, o), lidos, alertas };
  };

  it('org sem o módulo: nenhuma consulta nem RPC', async () => {
    const f = falso(banco({ modulos: null }));
    const { r, lidos } = preparar(f, { ligado: false });
    expect('concluir' in await r).toBe(true);
    expect(f.consultas).toEqual([]);
    expect(f.rpcs).toEqual([]);
    expect(lidos).toEqual([]);
  });

  it('SKU comum em org com o módulo: lê o vínculo e a participação, sem RPC', async () => {
    const f = falso(banco());
    expect('concluir' in await preparar(f, { mlItemId: 'MLB2' }).r).toBe(true);
    expect(f.rpcs).toEqual([]);
  });

  it('pausa manual grava bloqueio_operador (incrementa a versão) antes do PUT, sem exclusão', async () => {
    const f = falso(banco());
    expect(await preparar(f, { alvo: 'pausado' }).r).toMatchObject({ criouBloqueio: false });
    expect(f.rpcs).toEqual([{ nome: 'kit_politica_operador', args: { p_org: 'O', p_codigos: ['P1'], p_bloquear: true } }]);
  });

  it('achado 3: pausa em massa passa a origem e devolve se criou o bloqueio', async () => {
    const f = falso(banco({ rpc: { kit_politica_operador: { ok: true, criou: true } } }));
    expect(await preparar(f, { alvo: 'pausado', origem: 'OP1' }).r).toMatchObject({ criouBloqueio: true });
    expect(f.rpcs[0].args).toMatchObject({ p_bloquear: true, p_origem: 'OP1' });
  });

  it('a cópia de catálogo também acha o SKU', async () => {
    const f = falso(banco());
    await preparar(f, { mlItemId: 'MLB1C', alvo: 'pausado' }).r;
    expect(f.rpcs.map((x) => x.args.p_codigos)).toEqual([['P1']]);
  });

  it('Guardado: recusa com o motivo de "Vender só em kit", sem exclusão nem escrita', async () => {
    const f = falso(banco({ politicas: [pol({ estado: 'guardado' })] }));
    expect(await preparar(f).r).toEqual({ recusa: expect.stringContaining('Vender só em kit') });
    expect(f.eventos).toEqual([]);
  });

  it('moderado (política) nunca reativa', async () => {
    const f = falso(banco({ politicas: [pol({ bloqueio_moderacao: true })] }));
    expect(await preparar(f).r).toEqual({ recusa: expect.stringContaining('moderado') });
    expect(f.eventos).toEqual([]);
  });

  it('moderado lido no ML nunca reativa, mesmo sem bloqueio na política', async () => {
    const f = falso(banco());
    expect(await preparar(f, { lerStatus: async () => 'moderado' }).r).toEqual({ recusa: MSG_KIT_MODERADO });
    expect(f.eventos).toEqual([]);
  });

  it('achado 4: leitura que falha não vira "moderado" — 401/403 pede reconexão, o resto "não foi possível consultar"', async () => {
    const f = falso(banco());
    const auth = await preparar(f, { lerStatus: async () => { throw new SemAcessoStatusML('ML 403'); } }).r;
    expect(auth).toEqual({ recusa: expect.stringContaining('Reconecte') });
    expect(await preparar(f, { lerStatus: async () => { throw new Error('ML 500'); } }).r).toEqual({ recusa: MSG_KIT_SEM_LEITURA });
    expect(await preparar(f, { lerStatus: async () => null }).r).toEqual({ recusa: MSG_KIT_SEM_LEITURA });
    expect(f.eventos).toEqual([]);
  });

  it('reativa a pausa do operador: intenção, exclusão com dono estável, limpa o bloqueio; confirmado, libera', async () => {
    const f = falso(banco({ politicas: [pol({ bloqueio_operador: true })] }));
    const { r, lidos } = preparar(f);
    const p = await r;
    if (!('concluir' in p)) throw new Error('recusou');
    const dono = await donoAtivacao('O', 'MLB1');
    expect(f.eventos).toEqual(['upsert:kit_ativacoes', 'rpc:kit_adquirir_exclusao', 'rpc:kit_politica_operador']);
    expect(f.banco.ativacoes).toEqual([expect.objectContaining({ dono_id: dono, alvos: ['MLB1', 'MLB1C'], codigos: ['P1'] })]);
    expect(f.rpcs[0].args).toMatchObject({ p_codigos: ['P1'], p_dono_tipo: 'ativacao', p_dono_id: dono });
    expect(f.rpcs[1].args).toEqual({ p_org: 'O', p_codigos: ['P1'], p_bloquear: false, p_versoes: { P1: 4 } });
    expect(await p.concluir({ ok: true })).toBe(true);
    expect(lidos).toEqual(['MLB1', 'MLB1', 'MLB1C']);   // pré-checagem + os dois alvos
    expect(f.eventos.slice(3)).toEqual(['rpc:kit_soltar_exclusao', 'delete:kit_ativacoes']);
    expect(f.banco.ativacoes).toEqual([]);
  });

  it('achado 1: recusa 4xx definitiva também confirma pela leitura antes de liberar', async () => {
    const f = falso(banco());
    const p = await preparar(f).r;
    if (!('concluir' in p)) throw new Error('recusou');
    expect(await p.concluir({ ok: false, erro: { status: 400 } })).toBe(true);
    expect(f.banco.ativacoes).toEqual([]);
  });

  it.each([
    ['sem resposta HTTP (timeout/rede)', { ok: false, erro: {} }],
    ['408', { ok: false, erro: { status: 408 } }],
    ['429', { ok: false, erro: { status: 429 } }],
    ['502', { ok: false, erro: { status: 502 } }],
  ])('achado 1: resultado ambíguo (%s) mantém exclusão e intenção, e alerta', async (_n, put) => {
    const f = falso(banco());
    const { r, alertas } = preparar(f);
    const p = await r;
    if (!('concluir' in p)) throw new Error('recusou');
    expect(await p.concluir(put)).toBe(false);
    expect(f.eventos).not.toContain('rpc:kit_soltar_exclusao');
    expect(f.banco.ativacoes).toHaveLength(1);
    expect(alertas).toEqual([expect.stringContaining('não foi confirmada')]);
  });

  it('achado 1: PUT ok mas leitura de um alvo falha: mantém e alerta', async () => {
    const f = falso(banco());
    let n = 0;
    const { r, alertas } = preparar(f, { lerStatus: async () => { if (++n === 3) throw new Error('ML 500'); return 'pausado'; } });
    const p = await r;
    if (!('concluir' in p)) throw new Error('recusou');
    expect(await p.concluir({ ok: true })).toBe(false);
    expect(f.banco.ativacoes).toHaveLength(1);
    expect(alertas).toHaveLength(1);
  });

  it('achado 1: retomada reconhece o mesmo dono; recusa nesta tentativa não apaga a intenção anterior incerta', async () => {
    const dono = await donoAtivacao('O', 'MLB1');
    const f = falso(banco({
      ativacoes: [{ org_id: 'O', dono_id: dono, ml_item_id: 'MLB1', alvos: ['MLB1'], codigos: ['P1'] }],
      rpc: { kit_adquirir_exclusao: { ok: true }, kit_politica_operador: { ok: false, codigo: 'P1' } },
    }));
    expect(await preparar(f).r).toEqual({ recusa: MSG_KIT_POLITICA_MUDOU });
    expect(f.rpcs[0].args.p_dono_id).toBe(dono);
    expect(f.eventos).not.toContain('rpc:kit_soltar_exclusao');
    expect(f.banco.ativacoes).toHaveLength(1);
  });

  it('SKU em transferência (exclusão ocupada): recusa, sem mexer na política e sem deixar intenção', async () => {
    const f = falso(banco({ rpc: { kit_adquirir_exclusao: { ok: false, codigo: 'P1' } } }));
    expect(await preparar(f).r).toEqual({ recusa: MSG_KIT_EM_TRANSFERENCIA });
    expect(f.rpcs.map((x) => x.nome)).toEqual(['kit_adquirir_exclusao', 'kit_soltar_exclusao']);
    expect(f.banco.ativacoes).toEqual([]);
  });

  it('política mudou entre a leitura e a escrita: recusa, solta a exclusão e apaga a intenção', async () => {
    const f = falso(banco({ rpc: { kit_adquirir_exclusao: { ok: true }, kit_politica_operador: { ok: false, codigo: 'P1' } } }));
    expect(await preparar(f).r).toEqual({ recusa: MSG_KIT_POLITICA_MUDOU });
    expect(f.rpcs.map((x) => x.nome)).toEqual(['kit_adquirir_exclusao', 'kit_politica_operador', 'kit_soltar_exclusao']);
    expect(f.banco.ativacoes).toEqual([]);
  });

  it('falha de leitura do banco lança (não ativa)', async () => {
    const f = falso(banco({ falhar: 'anuncios_externos_itens' }));
    await expect(preparar(f).r).rejects.toThrow();
  });
});
