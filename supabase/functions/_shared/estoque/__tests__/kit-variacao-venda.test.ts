import { describe, it, expect } from 'vitest';
import { estornarVendaCancelada, refBaixa, registrarBaixaVenda } from '../baixa.ts';
import { avisarKitsZerados, classificarItensKit } from '../../kit-variacao/venda.ts';
import { agendarCancelamentoKit } from '../cancelamento.ts';

// ADR-0197 (Task 8): venda e cancelamento de SKU de kit com variação. O kit tem saldo próprio, então a
// venda baixa o próprio SKU (o predicado do ADR-0151 é `kit_multiplicador`, nulo aqui).

interface Chamada { tabela: string; op: string; filtros: Array<[string, string, unknown]>; patch?: unknown }

/** Builder encadeável: `dados[tabela]` responde a leitura; toda chamada fica registrada. */
function fakeAdmin(dados: Record<string, unknown[]>, rpcs: Record<string, (args: Record<string, unknown>) => unknown>) {
  const chamadas: Chamada[] = [];
  const rpcChamadas: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const from = (tabela: string) => {
    const c: Chamada = { tabela, op: 'select', filtros: [] };
    chamadas.push(c);
    const resposta = () => ({ data: dados[tabela] ?? [], error: null });
    // deno-lint-ignore no-explicit-any
    const q: any = {
      select: () => q,
      update: (patch: unknown) => { c.op = 'update'; c.patch = patch; return q; },
      insert: () => Promise.resolve({ error: null }),
      eq: (k: string, v: unknown) => { c.filtros.push(['eq', k, v]); return q; },
      neq: (k: string, v: unknown) => { c.filtros.push(['neq', k, v]); return q; },
      in: (k: string, v: unknown) => { c.filtros.push(['in', k, v]); return q; },
      is: (k: string, v: unknown) => { c.filtros.push(['is', k, v]); return q; },
      not: () => q,
      lt: () => q,
      gt: () => q,
      gte: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: () => Promise.resolve({ data: (dados[tabela] ?? [])[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve(resposta()).then(res),
    };
    return q;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    rpcChamadas.push({ fn, args });
    return Promise.resolve({ data: rpcs[fn]?.(args) ?? null, error: null });
  };
  // deno-lint-ignore no-explicit-any
  return { admin: { from, rpc } as any, chamadas, rpcChamadas };
}

describe('venda de kit com variação', () => {
  it('baixa só o SKU do kit, ×1', async () => {
    const { admin, rpcChamadas } = fakeAdmin(
      { variacoes: [{ familias: { codigo_pai: 'KITPAI', kit_base_codigo_pai: null, kit_multiplicador: null } }] },
      {
        baixar_estoque: (a) => ({
          aplicado: true, motivo: 'venda', movimento_id: 'm1', estoque_anterior: 2,
          quantidade_pedida: a.p_qtd, quantidade_aplicada: a.p_qtd,
        }),
      },
    );
    await registrarBaixaVenda(admin, {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 55, itens: [{ codigo: 'KIT-PB-M', quantity: 2 }],
    });
    const baixas = rpcChamadas.filter((c) => c.fn === 'baixar_estoque');
    expect(baixas).toHaveLength(1);
    expect(baixas[0].args).toMatchObject({ p_codigo: 'KIT-PB-M', p_qtd: 2, p_ref: refBaixa('mercado_livre', 55, 'KIT-PB-M') });
  });
});

/**
 * Banco em memória para o portão: identidade gravada de verdade (PK = primeira vence), vínculos e participantes
 * fixos, e o ledger de referências de baixa. Filtros `eq`/`in` são aplicados.
 */
function bancoKit(o: { vinculos?: Array<{ sku: string; item_externo_id: string }>; participantes?: string[] }) {
  const identidade: Array<Record<string, string>> = [];
  const refs = new Set<string>();
  const tabelas: Record<string, Array<Record<string, unknown>>> = {
    anuncios_externos_itens: (o.vinculos ?? []).map((v) => ({ ...v, org_id: 'org-1', catalog_listing_id: null })),
    familias: [],
    kit_variacao_skus: (o.participantes ?? []).map((codigo) => ({ codigo, org_id: 'org-1' })),
    kit_variacao_componentes: [],
    estoque_movimentos: [],
  };
  const from = (tabela: string) => {
    const filtros: Array<[string, string, unknown]> = [];
    const linhas = () => (tabela === 'kit_venda_identidade' ? identidade : tabelas[tabela] ?? [])
      .filter((r) => filtros.every(([op, k, v]) => (op === 'eq' ? r[k] === v : op === 'in' ? (v as unknown[]).includes(r[k]) : true)));
    // deno-lint-ignore no-explicit-any
    const q: any = {
      select: () => q, order: () => q, limit: () => q, neq: () => q, is: () => q, not: () => q, lt: () => q,
      eq: (k: string, v: unknown) => { filtros.push(['eq', k, v]); return q; },
      in: (k: string, v: unknown) => { filtros.push(['in', k, v]); return q; },
      insert: () => Promise.resolve({ error: null }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      upsert: (rows: Array<Record<string, string>>) => {
        for (const r of rows) {
          const k = (x: Record<string, string>) => [x.org_id, x.canal, x.order_id, x.ml_item_id, x.variation_id].join('|');
          if (!identidade.some((x) => k(x) === k(r))) identidade.push(r);
        }
        return Promise.resolve({ error: null });
      },
      maybeSingle: () => Promise.resolve({
        data: { familias: { codigo_pai: 'P', kit_base_codigo_pai: null, kit_multiplicador: null } }, error: null,
      }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: linhas(), error: null }).then(res),
    };
    return q;
  };
  const rpc = (fn: string, a: Record<string, unknown>) => {
    if (fn !== 'baixar_estoque') return Promise.resolve({ data: null, error: null });
    const nova = !refs.has(a.p_ref as string);
    refs.add(a.p_ref as string);
    return Promise.resolve({
      data: nova
        ? { aplicado: true, motivo: 'venda', estoque_anterior: 5, quantidade_pedida: a.p_qtd, quantidade_aplicada: a.p_qtd }
        : { aplicado: false, motivo: 'duplicata' },
      error: null,
    });
  };
  // deno-lint-ignore no-explicit-any
  return { admin: { from, rpc } as any, refs, identidade };
}

describe('portão da Task 3: identidade estável por item (módulo ligado)', () => {
  const P = { orgId: 'org-1', canal: 'mercado_livre', orderId: 91 };

  it('GTIN falha + fallback comum, depois GTIN resolve participante: um único débito', async () => {
    const b = bancoKit({ participantes: ['COMP-P'] });
    // 1ª execução: GTIN falhou, o código caiu no seller_custom_field (um SKU comum). Sem vínculo: não prova "comum".
    const r1 = await registrarBaixaVenda(b.admin, { ...P, itens: [{ codigo: 'COMUM-9', quantity: 1, ml_item_id: 'MLB-CAT' }] },
      { kit: { incerto: true } });
    expect(r1.adiados).toHaveLength(1);
    expect([...b.refs]).toEqual([]);
    // 2ª: GTIN resolve o participante. Grava a identidade e baixa.
    await registrarBaixaVenda(b.admin, { ...P, itens: [{ codigo: 'COMP-P', quantity: 1, ml_item_id: 'MLB-CAT' }] },
      { kit: { incerto: false } });
    // 3ª: outra resolução divergente (fallback de novo, leitura "completa"). Segue a identidade, sem débito novo.
    const r3 = await registrarBaixaVenda(b.admin, { ...P, itens: [{ codigo: 'COMUM-9', quantity: 1, ml_item_id: 'MLB-CAT' }] },
      { kit: { incerto: false } });
    expect([...b.refs]).toEqual([refBaixa('mercado_livre', 91, 'COMP-P')]);
    expect(r3.divergentes).toEqual([{ mlItemId: 'MLB-CAT', resolvido: 'COMUM-9', identidade: 'COMP-P' }]);
  });

  it('leitura incerta: item comum comprovado por vínculo baixa já; o participante fica para depois', async () => {
    const b = bancoKit({
      vinculos: [{ sku: '00000029', item_externo_id: 'MLB-COMUM' }, { sku: 'KIT-PB-M', item_externo_id: 'MLB-KIT' }],
      participantes: ['KIT-PB-M'],
    });
    const r = await registrarBaixaVenda(b.admin, {
      ...P, itens: [{ codigo: '00000029', quantity: 1, ml_item_id: 'MLB-COMUM' }, { codigo: 'VELHO', quantity: 1, ml_item_id: 'MLB-KIT' }],
    }, { kit: { incerto: true } });
    expect([...b.refs]).toEqual([refBaixa('mercado_livre', 91, '00000029')]);
    expect(r.adiados.map((i) => i.ml_item_id)).toEqual(['MLB-KIT']);
    expect(b.identidade.map((i) => i.codigo)).toEqual(['00000029']);
  });

  it('identidade ilegível: nada baixa nesta execução', async () => {
    const b = bancoKit({});
    b.admin.from = () => { throw new Error('fora'); };
    const r = await registrarBaixaVenda(b.admin, { ...P, itens: [{ codigo: 'A', quantity: 1, ml_item_id: 'MLB1' }] },
      { kit: { incerto: false } });
    expect(r.adiados).toHaveLength(1);
    expect([...b.refs]).toEqual([]);
  });

  it('sem o módulo (sem opção kit): caminho de hoje, nenhuma leitura de identidade', async () => {
    const b = bancoKit({});
    const lidas: string[] = [];
    const from = b.admin.from;
    b.admin.from = (t: string) => { lidas.push(t); return from(t); };
    await registrarBaixaVenda(b.admin, { ...P, itens: [{ codigo: 'A', quantity: 1, ml_item_id: 'MLB1' }] });
    expect([...b.refs]).toEqual([refBaixa('mercado_livre', 91, 'A')]);
    expect(lidas).not.toContain('kit_venda_identidade');
  });
});

describe('classificarItensKit (cancelamento)', () => {
  it('usa o SKU da identidade da baixa, não o resolvido agora', async () => {
    const b = bancoKit({});
    b.identidade.push({ org_id: 'org-1', canal: 'mercado_livre', order_id: '5', ml_item_id: 'MLB1', variation_id: '', codigo: 'COMP-P' });
    const c = await classificarItensKit(b.admin, {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 5, itens: [{ codigo: 'OUTRO', quantity: 1, ml_item_id: 'MLB1' }], incerto: true,
    });
    expect(c.certos.map((i) => i.codigo)).toEqual(['COMP-P']);
    expect(c.incertos).toEqual([]);
  });
});

describe('avisarKitsZerados', () => {
  function admin(movs: Array<Record<string, unknown>>) {
    const { admin: a } = fakeAdmin({
      kit_variacao_skus: [
        { codigo: 'KIT-DESLIGADA', kits_variacao: { reposicao_auto: false, so_em_kit: true } },
        { codigo: 'KIT-INDIVIDUAL', kits_variacao: { reposicao_auto: true, so_em_kit: false } },
        { codigo: 'KIT-AUTO', kits_variacao: { reposicao_auto: true, so_em_kit: true } },
      ],
      estoque_movimentos: movs,
    }, {});
    return a;
  }

  it('avisa uma vez por movimento de zeragem, nos kits em modo manual', async () => {
    const reservados = new Set<string>();
    const textos: string[] = [];
    const deps = {
      reservar: (_a: unknown, _o: string, _u: string | null, ent: string, chave: string) => {
        const k = `${ent}:${chave}`;
        if (reservados.has(k)) return Promise.resolve(false);
        reservados.add(k);
        return Promise.resolve(true);
      },
      notificar: (_a: unknown, _o: string, _c: string, t: string) => { textos.push(t); return Promise.resolve(); },
    };
    const a = admin([{ id: 'mov-1', codigo: 'KIT-DESLIGADA', referencia_externa: 'mercado_livre:123:KIT-DESLIGADA' }]);
    // Dois caminhos (webhook e importação da saga) chamam o mesmo despacho: um aviso só.
    expect(await avisarKitsZerados(a, deps as never, 'org-1', null)).toBe(1);
    expect(await avisarKitsZerados(a, deps as never, 'org-1', null)).toBe(0);
    expect(textos).toHaveLength(1);
    expect(textos[0]).toContain('KIT-DESLIGADA');
    expect(textos[0]).toContain('pedido 123');
  });

  it('consulta o ledger só pelos kits manuais', async () => {
    const { admin: a, chamadas } = fakeAdmin({
      kit_variacao_skus: [
        { codigo: 'KIT-INDIVIDUAL', kits_variacao: { reposicao_auto: true, so_em_kit: false } },
        { codigo: 'KIT-AUTO', kits_variacao: { reposicao_auto: true, so_em_kit: true } },
      ],
    }, {});
    await avisarKitsZerados(a, { reservar: () => Promise.resolve(true), notificar: () => Promise.resolve() }, 'org-1', null);
    const mov = chamadas.find((c) => c.tabela === 'estoque_movimentos');
    expect(mov?.filtros).toContainEqual(['in', 'codigo', ['KIT-INDIVIDUAL']]);
  });
});

describe('estornarVendaCancelada', () => {
  it('devolve os SKUs creditados nesta execução', async () => {
    const { admin } = fakeAdmin({}, {
      estornar_estoque: (a) => (a.p_codigo === 'A'
        ? { aplicado: true, motivo: 'estorno_venda' }
        : { aplicado: false, motivo: 'duplicata' }),
    });
    const r = await estornarVendaCancelada(admin, {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 9,
      itens: [{ codigo: 'A', quantity: 1 }, { codigo: 'B', quantity: 1 }],
    });
    expect(r.aplicados).toEqual(['A']);
  });
});

describe('agendarCancelamentoKit', () => {
  const ITENS = [
    { sku: 'KIT-PB-M', item_externo_id: 'MLB1', user_product_id: 'UP1', catalog_listing_id: 'MLB9' },
  ];

  it('cria transferência cancelamento por kit, enfileira e tira o estorno do push', async () => {
    const enfileirados: string[] = [];
    const { admin, rpcChamadas, chamadas } = fakeAdmin({
      kit_variacao_skus: [{ codigo: 'KIT-PB-M', kit_id: 'kit-1' }],
      anuncios_externos_itens: ITENS,
      estoque_movimentos: [{ id: 'est-1' }],
    }, { kit_criar_transferencia: () => ({ ok: true, id: 't-1' }) });
    const ids = await agendarCancelamentoKit(admin, (id) => { enfileirados.push(id); return Promise.resolve(); }, {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 77, codigos: ['KIT-PB-M', 'COMP-P'],
    });
    expect(rpcChamadas[0]).toEqual({
      fn: 'kit_criar_transferencia',
      args: {
        p_org: 'org-1', p_kit: 'kit-1', p_tipo: 'cancelamento',
        p_itens: [{ codigo: 'KIT-PB-M', quantidade: 0 }],
        p_alvos: [{ codigo: 'KIT-PB-M', up_id: 'UP1', item_ids: ['MLB1', 'MLB9'] }],
      },
    });
    expect(enfileirados).toEqual(['t-1']);
    expect(ids).toEqual(['est-1']);
    const marca = chamadas.find((c) => c.tabela === 'estoque_movimentos' && c.op === 'update');
    expect(marca?.filtros).toContainEqual(['in', 'referencia_externa', [`estorno:${refBaixa('mercado_livre', 77, 'KIT-PB-M')}`]]);
    // Item retirado não é alvo.
    const leitura = chamadas.find((c) => c.tabela === 'anuncios_externos_itens');
    expect(leitura?.filtros).toContainEqual(['eq', 'retirado', false]);
  });

  it('SKU retirado (sem item vivo): sem transferência, o estorno fica no push', async () => {
    const { admin, rpcChamadas } = fakeAdmin({
      kit_variacao_skus: [{ codigo: 'KIT-PB-M', kit_id: 'kit-1' }],
      anuncios_externos_itens: [],
    }, {});
    expect(await agendarCancelamentoKit(admin, () => Promise.resolve(), {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 77, codigos: ['KIT-PB-M'],
    })).toEqual([]);
    expect(rpcChamadas).toEqual([]);
  });

  it('transferência recusada (up_ocupado): nada marcado, o outbox segue', async () => {
    const { admin, chamadas } = fakeAdmin({
      kit_variacao_skus: [{ codigo: 'KIT-PB-M', kit_id: 'kit-1' }],
      anuncios_externos_itens: ITENS,
    }, { kit_criar_transferencia: () => ({ ok: false, motivo: 'up_ocupado' }) });
    expect(await agendarCancelamentoKit(admin, () => Promise.resolve(), {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 77, codigos: ['KIT-PB-M'],
    })).toEqual([]);
    expect(chamadas.some((c) => c.op === 'update')).toBe(false);
  });

  it('componente individual (não é SKU de kit) não vira transferência cancelamento', async () => {
    const { admin, rpcChamadas } = fakeAdmin({ kit_variacao_skus: [] }, {});
    expect(await agendarCancelamentoKit(admin, () => Promise.resolve(), {
      orgId: 'org-1', canal: 'mercado_livre', orderId: 77, codigos: ['COMP-P'],
    })).toEqual([]);
    expect(rpcChamadas).toEqual([]);
  });
});
