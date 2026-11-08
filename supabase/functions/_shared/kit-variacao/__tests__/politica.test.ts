import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { SemAcessoStatusML } from '../../operacoes/ml-status.ts';
import {
  prepararStatusOperador, donoAtivacao, MSG_KIT_EM_TRANSFERENCIA, MSG_KIT_POLITICA_MUDOU, MSG_KIT_SEM_LEITURA,
  MSG_KIT_MODERADO, MSG_KIT_ATIVACAO_EM_CURSO, type OpcoesStatusOperador,
  skusParticipantes, podeEscreverQuantidade, podeReativar, adquirirExclusao, soltarExclusao, kitLigado, lerPoliticas,
  type PoliticaSku,
} from '../politica.ts';
import { reativarPausaAutomatica } from '../reposicao.ts';

interface Banco {
  modulos: string[] | null;
  kitSkus?: Array<{ org_id: string; codigo: string }>;
  componentes?: Array<{ org_id: string; codigo: string }>;
  politicas?: Array<Record<string, unknown>>;
  itens?: Array<Record<string, unknown>>;
  ativacoes?: Array<Record<string, unknown>>;
  pausas?: Array<Record<string, unknown>>;
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
      if (tabela === 'kit_pausas_automaticas') {
        const achadas = (b.pausas ?? []).filter((r) => filtros.every((f) => f(r)));
        if (apagar) {
          eventos.push('delete:kit_pausas_automaticas');
          b.pausas = (b.pausas ?? []).filter((r) => !achadas.includes(r));
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
    rpc: {
      kit_adquirir_exclusao: { ok: true }, kit_politica_operador: { ok: true },
      kit_ativacao_reivindicar: { ok: true, anterior: false }, kit_ativacao_liberar: true,
    }, ...x,
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

  const RPC = {
    kit_adquirir_exclusao: { ok: true }, kit_politica_operador: { ok: true },
    kit_ativacao_reivindicar: { ok: true, anterior: false }, kit_ativacao_liberar: true,
  };
  const args = (f: ReturnType<typeof falso>, nome: string) => f.rpcs.filter((x) => x.nome === nome).map((x) => x.args);

  it('Task 14: reativação automática nunca desfaz a pausa do operador (nem pega a exclusão)', async () => {
    const f = falso(banco({ politicas: [pol({ bloqueio_operador: true })] }));
    expect(await preparar(f, { automatico: true }).r).toEqual({ recusa: 'Pausado pelo operador.' });
    expect(f.rpcs).toEqual([]);
    // Sem bloqueio, a automática segue o mesmo caminho da manual.
    const g = falso(banco({ politicas: [pol()] }));
    expect('concluir' in await preparar(g, { automatico: true }).r).toBe(true);
  });

  it('Fix 1 (P1-3): reativação automática faz PUT só no item registrado; o catálogo pausado à mão fica pausado', async () => {
    const f = falso(banco({ politicas: [pol({ estado: 'sobra' })] }));
    const puts: string[] = [];
    const lidos: string[] = [];
    const r = await reativarPausaAutomatica(f.admin, {
      orgId: 'O', codigo: 'P1', itemId: 'MLB1',
      lerStatus: async (id) => { lidos.push(id); return 'pausado'; },
      putAtivo: async (id) => { puts.push(id); return { ok: true }; },
      alertar: async () => {},
    });
    expect(r).toBe('reativado');
    expect(puts).toEqual(['MLB1']);
    expect(f.eventos).toContain('rpc:kit_adquirir_exclusao');           // exclusão e CAS da política mantidos
    expect(f.eventos).toContain('rpc:kit_ativacao_liberar');            // confirmado pela leitura
    expect(lidos).toEqual(['MLB1', 'MLB1', 'MLB1', 'MLB1C']);           // + a leitura do registro (Fix 1b)
  });

  it('Fix 1b: reativação confirmada do operador apaga o registro da pausa da automação daquele item', async () => {
    const f = falso(banco({ politicas: [pol()], pausas: [{ org_id: 'O', item_id: 'MLB1', codigo: 'P1' }, { org_id: 'O', item_id: 'MLB9', codigo: 'X' }] }));
    const p = await preparar(f).r;
    if (!('concluir' in p)) throw new Error('recusou');
    expect(f.banco.pausas).toHaveLength(2);           // antes do PUT confirmado, nada sai
    expect(await p.concluir({ ok: true })).toBe(true);
    expect(f.banco.pausas).toEqual([{ org_id: 'O', item_id: 'MLB9', codigo: 'X' }]);
  });

  it('Fix 1b: item visto ativo ou inexistente na leitura: sem PUT, sem exclusão', async () => {
    const opcoes = (puts: string[], st: 'ativo' | 'encerrado' | null) => ({
      orgId: 'O', codigo: 'P1', itemId: 'MLB1', lerStatus: async () => st,
      putAtivo: async (id: string) => { puts.push(id); return { ok: true }; }, alertar: async () => {},
    });
    const puts: string[] = [];
    const f = falso(banco({ politicas: [pol({ estado: 'sobra' })] }));
    expect(await reativarPausaAutomatica(f.admin, opcoes(puts, 'ativo'))).toBe('ja_ativo');
    expect(await reativarPausaAutomatica(f.admin, opcoes(puts, null))).toBe('inexistente');
    expect(await reativarPausaAutomatica(f.admin, opcoes(puts, 'encerrado'))).toBe('inexistente');
    expect(puts).toEqual([]);
    expect(f.rpcs).toEqual([]);
  });

  it('Fix 1 (P1-3): pausa do operador abandona sem PUT; Guardado mantém', async () => {
    const opcoes = (puts: string[]) => ({
      orgId: 'O', codigo: 'P1', itemId: 'MLB1', lerStatus: async () => 'pausado' as const,
      putAtivo: async (id: string) => { puts.push(id); return { ok: true }; }, alertar: async () => {},
    });
    const puts: string[] = [];
    expect(await reativarPausaAutomatica(falso(banco({ politicas: [pol({ bloqueio_operador: true })] })).admin, opcoes(puts))).toBe('abandonar');
    expect(await reativarPausaAutomatica(falso(banco({ politicas: [pol({ estado: 'guardado' })] })).admin, opcoes(puts))).toBe('manter');
    expect(puts).toEqual([]);
  });

  it('reativa a pausa do operador: reivindica a geração, exclusão com dono estável, limpa o bloqueio; confirmado, libera a geração', async () => {
    const f = falso(banco({ politicas: [pol({ bloqueio_operador: true })] }));
    const { r, lidos } = preparar(f);
    const p = await r;
    if (!('concluir' in p)) throw new Error('recusou');
    const dono = await donoAtivacao('O', 'MLB1');
    expect(f.eventos).toEqual(['rpc:kit_ativacao_reivindicar', 'rpc:kit_adquirir_exclusao', 'rpc:kit_politica_operador']);
    const [reiv] = args(f, 'kit_ativacao_reivindicar');
    expect(reiv).toMatchObject({ p_org: 'O', p_dono: dono, p_item: 'MLB1', p_alvos: ['MLB1', 'MLB1C'], p_codigos: ['P1'], p_prazo_s: 600 });
    expect(args(f, 'kit_adquirir_exclusao')[0]).toMatchObject({ p_codigos: ['P1'], p_dono_tipo: 'ativacao', p_dono_id: dono });
    expect(args(f, 'kit_politica_operador')[0]).toEqual({ p_org: 'O', p_codigos: ['P1'], p_bloquear: false, p_versoes: { P1: 4 } });
    expect(await p.concluir({ ok: true })).toBe(true);
    expect(lidos).toEqual(['MLB1', 'MLB1', 'MLB1C']);   // pré-checagem + os dois alvos
    expect(args(f, 'kit_ativacao_liberar')).toEqual([{ p_org: 'O', p_dono: dono, p_geracao: reiv.p_geracao, p_apagar: true }]);
    expect(f.eventos).not.toContain('rpc:kit_soltar_exclusao');
  });

  it('fix 2 (P1-1): mesmo dono com outra execução viva: recusa sem exclusão nem PUT', async () => {
    const f = falso(banco({ rpc: { ...RPC, kit_ativacao_reivindicar: { ok: false } } }));
    // Fix round 3: geração ocupada é espera, não bloqueio definitivo.
    expect(await preparar(f).r).toEqual({ recusa: MSG_KIT_ATIVACAO_EM_CURSO, retentar: true });
    expect(f.eventos).toEqual(['rpc:kit_ativacao_reivindicar']);
  });

  it('fix 2 (P1-1): cada execução tem geração própria; geração que perdeu a vez não libera', async () => {
    const f = falso(banco({ rpc: { ...RPC, kit_ativacao_liberar: false } }));
    const p1 = await preparar(f).r;
    const p2 = await preparar(f).r;
    if (!('concluir' in p1) || !('concluir' in p2)) throw new Error('recusou');
    const [a, b] = args(f, 'kit_ativacao_reivindicar');
    expect(a.p_dono).toBe(b.p_dono);
    expect(a.p_geracao).not.toBe(b.p_geracao);
    expect(await p1.concluir({ ok: true })).toBe(false);
    expect(args(f, 'kit_ativacao_liberar')[0].p_geracao).toBe(a.p_geracao);
  });

  it('achado 1: recusa 4xx definitiva também confirma pela leitura antes de liberar', async () => {
    const f = falso(banco());
    const p = await preparar(f).r;
    if (!('concluir' in p)) throw new Error('recusou');
    expect(await p.concluir({ ok: false, erro: { status: 400 } })).toBe(true);
    expect(args(f, 'kit_ativacao_liberar')[0]).toMatchObject({ p_apagar: true });
  });

  it.each([
    ['sem resposta HTTP (timeout/rede)', { ok: false, erro: {} }],
    ['408', { ok: false, erro: { status: 408 } }],
    ['429', { ok: false, erro: { status: 429 } }],
    ['502', { ok: false, erro: { status: 502 } }],
  ])('achado 1: resultado ambíguo (%s) mantém a geração viva (sem liberar) e alerta', async (_n, put) => {
    const f = falso(banco());
    const { r, alertas } = preparar(f);
    const p = await r;
    if (!('concluir' in p)) throw new Error('recusou');
    expect(await p.concluir(put)).toBe(false);
    expect(args(f, 'kit_ativacao_liberar')).toEqual([]);
    expect(alertas).toEqual([expect.stringContaining('não foi confirmada')]);
  });

  it('achado 1: PUT ok mas leitura de um alvo falha: mantém e alerta', async () => {
    const f = falso(banco());
    let n = 0;
    const { r, alertas } = preparar(f, { lerStatus: async () => { if (++n === 3) throw new Error('ML 500'); return 'pausado'; } });
    const p = await r;
    if (!('concluir' in p)) throw new Error('recusou');
    expect(await p.concluir({ ok: true })).toBe(false);
    expect(args(f, 'kit_ativacao_liberar')).toEqual([]);
    expect(alertas).toHaveLength(1);
  });

  it('achado 1: retomada com intenção anterior incerta: recusa nesta tentativa só encerra a geração (não apaga)', async () => {
    const f = falso(banco({ rpc: { ...RPC, kit_ativacao_reivindicar: { ok: true, anterior: true }, kit_politica_operador: { ok: false } } }));
    expect(await preparar(f).r).toEqual({ recusa: MSG_KIT_POLITICA_MUDOU });
    expect(args(f, 'kit_ativacao_liberar')).toEqual([expect.objectContaining({ p_apagar: false })]);
  });

  it('SKU em transferência (exclusão ocupada): recusa, sem mexer na política, apaga a intenção desta tentativa', async () => {
    const f = falso(banco({ rpc: { ...RPC, kit_adquirir_exclusao: { ok: false, codigo: 'P1' } } }));
    expect(await preparar(f).r).toEqual({ recusa: MSG_KIT_EM_TRANSFERENCIA });
    expect(f.eventos).toEqual(['rpc:kit_ativacao_reivindicar', 'rpc:kit_adquirir_exclusao', 'rpc:kit_ativacao_liberar']);
    expect(args(f, 'kit_ativacao_liberar')[0]).toMatchObject({ p_apagar: true });
  });

  it('política mudou entre a leitura e a escrita: recusa e libera a geração (apaga intenção e exclusão)', async () => {
    const f = falso(banco({ rpc: { ...RPC, kit_politica_operador: { ok: false, codigo: 'P1' } } }));
    expect(await preparar(f).r).toEqual({ recusa: MSG_KIT_POLITICA_MUDOU });
    expect(f.eventos.at(-1)).toBe('rpc:kit_ativacao_liberar');
    expect(args(f, 'kit_ativacao_liberar')[0]).toMatchObject({ p_apagar: true });
  });

  it('falha de leitura do banco lança (não ativa)', async () => {
    const f = falso(banco({ falhar: 'anuncios_externos_itens' }));
    await expect(preparar(f).r).rejects.toThrow();
  });
});
