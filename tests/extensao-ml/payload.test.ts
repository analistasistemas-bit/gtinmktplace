import { describe, it, expect } from 'vitest';
import {
  extrairEstadoOptin, montarPlanoAnuncio, montarUrlOptinUp, interpretarRespostaMatcher,
} from '../../extensao-ml/lib/payload.js';

const attrs = [
  { id: 'COLOR', name: 'Cor', value_id: '52049', value_name: 'Preto', extra_chave: 'DEVE_SUMIR' },
];

const grupo = (variations: unknown[]) => ({
  type: 'SIMPLE',
  match_product: { attributes: attrs },
  variations,
});

const estadoBase = (groups: unknown[]) => ({
  stepData: { groups, parent_catalog_product: { id: 'MLB28848109' } },
  contextData: { flow: 'REPRODUCTIZE', entity_id: 'MLB4888109497' },
  step: 'MULTI_VARIATION_MATCHER',
});

describe('extrairEstadoOptin', () => {
  it('acha {step, step_data} em qualquer profundidade do ctx SSR', () => {
    const ctx = { a: { b: [{ step: 'X', step_data: { groups: [] }, flow: 'REPRODUCTIZE' }] } };
    const e = extrairEstadoOptin(ctx);
    expect(e?.step).toBe('X');
    expect(e?.stepData).toEqual({ groups: [] });
    expect(e?.contextData.flow).toBe('REPRODUCTIZE');
  });
  it('devolve null quando não há initialOptinData', () => {
    expect(extrairEstadoOptin({ qualquer: 'coisa' })).toBeNull();
    expect(extrairEstadoOptin(null)).toBeNull();
  });
  it('não entra em loop com referência circular', () => {
    const ctx: any = {}; ctx.eu = ctx;
    expect(extrairEstadoOptin(ctx)).toBeNull();
  });
});

describe('montarPlanoAnuncio — matriz de decisão por variação', () => {
  it('variação em risco vai com catalog_product_id null (o "não encontro")', () => {
    const estado = estadoBase([grupo([{ id: 205157946311, match: null }])]);
    const p = montarPlanoAnuncio(estado, ['205157946311'], {});
    expect(p.tipo).toBe('ok');
    if (p.tipo !== 'ok') return;
    expect(p.confirmedProductMatches[0].matches).toEqual([
      { entity_id: 205157946311, catalog_product_id: null },
    ]);
    expect(p.resumo.null_enviados).toEqual(['205157946311']);
  });

  it('variação em risco COM sugestão do ML ainda vai null (nunca aceitar sugestão)', () => {
    const estado = estadoBase([grupo([{ id: 111, match: { product: { id: 'MLB_SUGESTAO' } } }])]);
    const p = montarPlanoAnuncio(estado, ['111'], {});
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.confirmedProductMatches[0].matches[0].catalog_product_id).toBeNull();
  });

  it('variação vinculada no PubliAI é preservada com o MESMO product id', () => {
    const estado = estadoBase([grupo([
      { id: 111, match: null },
      { id: 333, match: { product: { id: 'MLB999' } } },
    ])]);
    const p = montarPlanoAnuncio(estado, ['111'], { '333': 'MLB999' });
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.confirmedProductMatches[0].matches).toEqual([
      { entity_id: 111, catalog_product_id: null },
      { entity_id: 333, catalog_product_id: 'MLB999' },
    ]);
    expect(p.resumo.preservados).toEqual(['333']);
  });

  it('match na página DIVERGENTE do vínculo do PubliAI → manual (não sobrescrever nem confiar)', () => {
    const estado = estadoBase([grupo([
      { id: 111, match: null },
      { id: 333, match: { product: { id: 'MLB_OUTRA' } } },
    ])]);
    const p = montarPlanoAnuncio(estado, ['111'], { '333': 'MLB999' });
    expect(p).toMatchObject({ tipo: 'manual', motivo: 'vinculo_divergente:333' });
  });

  it('match presente mas SEM vínculo no PubliAI (ex.: sugestão para family_diff) → manual', () => {
    const estado = estadoBase([grupo([
      { id: 111, match: null },
      { id: 444, match: { product: { id: 'MLB_SUGESTAO' } } },
    ])]);
    const p = montarPlanoAnuncio(estado, ['111'], {});
    expect(p).toMatchObject({ tipo: 'manual', motivo: 'match_nao_confirmado:444' });
  });

  it('variação fora da lista, sem status e sem match → manual (payload ficaria incompleto)', () => {
    const estado = estadoBase([grupo([
      { id: 111, match: null },
      { id: 555, match: null },
    ])]);
    const p = montarPlanoAnuncio(estado, ['111'], {});
    expect(p).toMatchObject({ tipo: 'manual', motivo: 'variacao_sem_decisao:555' });
  });

  it('variação com status (hidden/disabled) sai do payload — MESMO filtro do getMappedGroups', () => {
    const estado = estadoBase([grupo([
      { id: 111, match: null },
      { id: 666, status: 'hidden', match: { product: { id: 'MLB1' } } },
      { id: 777, status: 'disabled', match: null },
    ])]);
    const p = montarPlanoAnuncio(estado, ['111'], {});
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.confirmedProductMatches[0].matches).toHaveLength(1);
    expect(p.resumo.excluidos_por_status.sort()).toEqual(['666', '777']);
  });

  it('variação em risco que só existe com status entra em risco_ausente (banco defasado), sem bloquear', () => {
    const estado = estadoBase([grupo([
      { id: 111, match: null },
      { id: 666, status: 'hidden' },
    ])]);
    const p = montarPlanoAnuncio(estado, ['111', '666'], {});
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.resumo.risco_ausente).toEqual(['666']);
  });

  it('nenhuma variação em risco presente e ativa → manual (nada a fazer aqui)', () => {
    const estado = estadoBase([grupo([{ id: 333, match: { product: { id: 'MLB999' } } }])]);
    const p = montarPlanoAnuncio(estado, ['666'], { '333': 'MLB999' });
    expect(p).toMatchObject({ tipo: 'manual', motivo: 'nenhuma_variacao_risco_no_matcher' });
  });

  it('group_attributes: só {id,name,value_id,value_name}, chaves extras caem', () => {
    const estado = estadoBase([grupo([{ id: 111, match: null }])]);
    const p = montarPlanoAnuncio(estado, ['111'], {});
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.confirmedProductMatches[0].group_attributes).toEqual([
      { id: 'COLOR', name: 'Cor', value_id: '52049', value_name: 'Preto' },
    ]);
  });

  it('múltiplos grupos preservam a ordem e a separação', () => {
    const estado = estadoBase([
      grupo([{ id: 111, match: null }]),
      grupo([{ id: 222, match: null }]),
    ]);
    const p = montarPlanoAnuncio(estado, ['111', '222'], {});
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.confirmedProductMatches).toHaveLength(2);
    expect(p.confirmedProductMatches[0].matches[0].entity_id).toBe(111);
    expect(p.confirmedProductMatches[1].matches[0].entity_id).toBe(222);
  });

  it('productId: parent_catalog_product.id; fallback original_catalog_product_id do contexto', () => {
    const semParent = {
      stepData: { groups: [grupo([{ id: 111, match: null }])] },
      contextData: { flow: 'REPRODUCTIZE', original_catalog_product_id: 'MLB_FALLBACK' },
      step: 'X',
    };
    const p = montarPlanoAnuncio(semParent, ['111'], {});
    if (p.tipo !== 'ok') throw new Error(p.motivo);
    expect(p.productId).toBe('MLB_FALLBACK');
  });

  it.each([
    ['estado nulo', null, ['111'], 'estado_nao_encontrado'],
    ['sem groups', { stepData: {}, contextData: { flow: 'R' }, step: 'X' }, ['111'], 'sem_groups_no_estado'],
    ['groups vazio', estadoBase([]), ['111'], 'sem_groups_no_estado'],
  ])('%s → manual', (_nome, estado, risco, motivo) => {
    expect(montarPlanoAnuncio(estado as any, risco as string[], {})).toMatchObject({ tipo: 'manual', motivo });
  });

  it('sem productId → manual; sem flow → manual; variação sem id → manual', () => {
    const semPid = { stepData: { groups: [grupo([{ id: 111, match: null }])] }, contextData: { flow: 'R' }, step: 'X' };
    expect(montarPlanoAnuncio(semPid as any, ['111'], {})).toMatchObject({ tipo: 'manual', motivo: 'sem_parent_product_id' });
    const semFlow = { stepData: { groups: [grupo([{ id: 111, match: null }])], parent_catalog_product: { id: 'P' } }, contextData: {}, step: 'X' };
    expect(montarPlanoAnuncio(semFlow as any, ['111'], {})).toMatchObject({ tipo: 'manual', motivo: 'sem_flow' });
    const semId = estadoBase([grupo([{ match: null }])]);
    expect(montarPlanoAnuncio(semId, ['111'], {})).toMatchObject({ tipo: 'manual', motivo: 'variacao_sem_id' });
  });
});

describe('montarUrlOptinUp', () => {
  it('normaliza a barra final do basePath', () => {
    expect(montarUrlOptinUp('/produzir/catalogo/', 'MLB1', 'multivariation_matcher_confirm'))
      .toBe('/produzir/catalogo/api/optin-up/MLB1/multivariation_matcher_confirm');
    expect(montarUrlOptinUp('/produzir/catalogo', 'MLB1', 'massive_summary_confirm'))
      .toBe('/produzir/catalogo/api/optin-up/MLB1/massive_summary_confirm');
  });
});

describe('interpretarRespostaMatcher — guard de eco antes do summary', () => {
  const planoOk = {
    tipo: 'ok' as const, productId: 'P', flow: 'REPRODUCTIZE',
    confirmedProductMatches: [], resumo: { null_enviados: ['111'], preservados: ['333'], excluidos_por_status: [], risco_ausente: [] },
  };
  const respostaOk = {
    step: 'MULTI_VARIATION_SUMMARY',
    step_data: {
      parent_catalog_product: { id: 'P' },
      product_associations: [
        { entity_id: 111, catalog_product_id: null },
        { entity_id: 333, catalog_product_id: 'MLB999' },
      ],
    },
  };

  it('prossegue quando o eco bate com o plano', () => {
    expect(interpretarRespostaMatcher(respostaOk, planoOk)).toEqual({
      acao: 'summary', parentProductId: 'P',
      productAssociations: respostaOk.step_data.product_associations,
    });
  });

  it('associação null fora do plano → manual (o servidor entendeu outra coisa)', () => {
    const resposta = { ...respostaOk, step_data: { ...respostaOk.step_data, product_associations: [
      { entity_id: 111, catalog_product_id: null },
      { entity_id: 333, catalog_product_id: null }, // preservada virou null!
    ] } };
    expect(interpretarRespostaMatcher(resposta, planoOk)).toMatchObject({ acao: 'manual', motivo: 'eco_divergente' });
  });

  it('add_invoice → manual; anatel_data → manual', () => {
    expect(interpretarRespostaMatcher({ step_data: { ...respostaOk.step_data, add_invoice: true } }, planoOk))
      .toMatchObject({ acao: 'manual', motivo: 'exige_invoice' });
    expect(interpretarRespostaMatcher({ step_data: { ...respostaOk.step_data, anatel_data: { value_name: 'X' } } }, planoOk))
      .toMatchObject({ acao: 'manual', motivo: 'exige_anatel' });
  });

  it('sem product_associations ou sem parent product → manual', () => {
    expect(interpretarRespostaMatcher({ step_data: {} }, planoOk)).toMatchObject({ acao: 'manual', motivo: 'resposta_sem_product_associations' });
    expect(interpretarRespostaMatcher({ step_data: { product_associations: [] } }, planoOk)).toMatchObject({ acao: 'manual', motivo: 'resposta_sem_parent_product' });
    expect(interpretarRespostaMatcher(null, planoOk)).toMatchObject({ acao: 'manual', motivo: 'resposta_sem_product_associations' });
  });
});

// Conflito REAL de dados, encontrado no dry-run da Linha Liza (MLB7159179348, 2026-08-13) ANTES
// de qualquer envio: o mesmo ml_variation_id aparece em DUAS famílias (CREATE + UPDATE do mesmo
// anúncio) com status contraditórios — a variação 197583285254 (Acqua 2500) é 'vinculado' numa
// linha e 'nao_elegivel' na outra. A página do ML confirma que ela ESTÁ casada com MLB31005551.
// Se o risco tivesse precedência, ela iria como null e o vínculo bom seria desfeito.
describe('montarPlanoAnuncio — vínculo confirmado tem precedência sobre linha de risco resíduo', () => {
  const VINCULADA = '197583285254';
  const CPID = 'MLB31005551';
  const estadoLiza = {
    stepData: {
      parent_catalog_product: { id: 'MLB28760822' },
      groups: [
        { match_product: null, variations: [{ id: '197583285260', attributes: [], match: null }] },
        { match_product: null, variations: [{ id: '197583285258', attributes: [], match: null }] },
        { match_product: null, variations: [{ id: '197583285256', attributes: [], match: null }] },
        { match_product: null, variations: [{ id: VINCULADA, attributes: [], match: { product: { id: CPID } } }] },
      ],
    },
    contextData: { flow: 'REPRODUCTIZE' },
  };
  // a lista de risco vem contaminada com a variação vinculada (linha resíduo da outra família)
  const riscoContaminado = ['197583285260', '197583285258', '197583285256', VINCULADA];
  const vinculos = { [VINCULADA]: CPID };

  it('preserva a vinculada mesmo estando na lista de risco, e manda null só nas outras', () => {
    const p = montarPlanoAnuncio(estadoLiza, riscoContaminado, vinculos);
    expect(p.tipo).toBe('ok');
    expect(p.resumo.preservados).toEqual([VINCULADA]);
    expect(p.resumo.null_enviados.sort()).toEqual(['197583285256', '197583285258', '197583285260']);
    const daVinculada = p.confirmedProductMatches
      .flatMap((g) => g.matches).find((m) => String(m.entity_id) === VINCULADA);
    expect(daVinculada.catalog_product_id).toBe(CPID); // NUNCA null
  });

  it('vínculo do banco que NÃO bate com o match da página → manual (não reescreve o ML)', () => {
    const p = montarPlanoAnuncio(estadoLiza, riscoContaminado, { [VINCULADA]: 'MLB_OUTRO' });
    expect(p).toMatchObject({ tipo: 'manual', motivo: `vinculo_divergente:${VINCULADA}` });
  });

  it('vínculo no banco mas SEM match na página → manual (banco desatualizado)', () => {
    const semMatch = {
      ...estadoLiza,
      stepData: {
        ...estadoLiza.stepData,
        groups: estadoLiza.stepData.groups.map((g) => ({
          ...g,
          variations: g.variations.map((v) => (v.id === VINCULADA ? { ...v, match: null } : v)),
        })),
      },
    };
    expect(montarPlanoAnuncio(semMatch, riscoContaminado, vinculos))
      .toMatchObject({ tipo: 'manual', motivo: `vinculo_sem_match_na_pagina:${VINCULADA}` });
  });
});

// Caminho REAL observado em produção no 1º envio (MLB7066697288, 2026-08-13): quando TODAS as
// variações vão como null, o ML não roteia para MULTI_VARIATION_SUMMARY — devolve
// INVALIDATION_SUMMARY e a 2ª chamada passa a ser POST invalidate_summary_confirm com
// {productId, flow, variationId, invalidateVariations}. Resultado verificado: a tag
// catalog_forewarning saiu do item e a busca por ela caiu de 3 para 2 anúncios.
// Formato REAL do MASSIVE_SUMMARY, observado na Linha Liza (MLB7159179348, 2026-08-13): em
// product_associations o `entity_id` é o ITEM (repetido em todas as linhas) e a variação vem em
// `variation_id`. O guard comparava por entity_id e rejeitaria a resposta correta como divergente.
describe('interpretarRespostaMatcher — MASSIVE_SUMMARY identifica a variação por variation_id', () => {
  const plano = {
    tipo: 'ok' as const, productId: 'MLB28760822', flow: 'REPRODUCTIZE', confirmedProductMatches: [],
    resumo: {
      null_enviados: ['197583285260', '197583285258', '197583285256'],
      preservados: ['197583285254'], excluidos_por_status: [], risco_ausente: [],
    },
  };
  const resposta = {
    step: 'MASSIVE_SUMMARY',
    step_data: {
      add_invoice: false,
      confirm_card: 'CATALOGREQUIRED_MASSIVE_ITEM_PRODUCTCHANGE',
      parent_catalog_product: { id: 'MLB28760822' },
      product_associations: [
        { entity_id: 'MLB7159179348', variation_id: '197583285260', catalog_product_id: null },
        { entity_id: 'MLB7159179348', variation_id: '197583285258', catalog_product_id: null },
        { entity_id: 'MLB7159179348', variation_id: '197583285256', catalog_product_id: null },
        { entity_id: 'MLB7159179348', variation_id: '197583285254', catalog_product_id: 'MLB31005551' },
      ],
    },
  };

  it('aceita o eco real (compara por variation_id, não por entity_id)', () => {
    expect(interpretarRespostaMatcher(resposta, plano)).toMatchObject({
      acao: 'summary', parentProductId: 'MLB28760822',
    });
  });

  it('se o servidor anular a preservada, o guard barra', () => {
    const ruim = { ...resposta, step_data: { ...resposta.step_data, product_associations:
      resposta.step_data.product_associations.map((a) => ({ ...a, catalog_product_id: null })) } };
    expect(interpretarRespostaMatcher(ruim, plano)).toMatchObject({ acao: 'manual', motivo: 'eco_divergente' });
  });
});

describe('interpretarRespostaMatcher — INVALIDATION_SUMMARY (todas as variações sem ficha)', () => {
  const plano = {
    tipo: 'ok' as const, productId: 'MLB53418360', flow: 'REPRODUCTIZE',
    confirmedProductMatches: [],
    resumo: { null_enviados: ['204693165357', '204693165381'], preservados: [], excluidos_por_status: [], risco_ausente: [] },
  };
  const resposta = {
    step: 'INVALIDATION_SUMMARY',
    step_data: {
      product_association: { entity_id: 'MLB7066697288', variation_id: null, catalog_product_id: 'MLB53418360' },
      confirm_card: 'MASSIVE_USERPRODUCT_INVALIDATE',
      invalidate_variations: ['204693165357', '204693165381'],
    },
  };

  it('roteia para invalidate com o payload da 2ª chamada montado do eco', () => {
    expect(interpretarRespostaMatcher(resposta, plano)).toEqual({
      acao: 'invalidate',
      productId: 'MLB53418360',
      variationId: null,
      invalidateVariations: ['204693165357', '204693165381'],
    });
  });

  it('guard de eco também vale aqui: lista divergente → manual', () => {
    const divergente = { ...resposta, step_data: { ...resposta.step_data, invalidate_variations: ['204693165357'] } };
    expect(interpretarRespostaMatcher(divergente, plano)).toMatchObject({ acao: 'manual', motivo: 'eco_divergente' });
  });

  it('ordem diferente no eco não é divergência', () => {
    const trocado = { ...resposta, step_data: { ...resposta.step_data, invalidate_variations: ['204693165381', '204693165357'] } };
    expect(interpretarRespostaMatcher(trocado, plano)).toMatchObject({ acao: 'invalidate' });
  });

  it('sem catalog_product_id na associação → manual', () => {
    const semId = { ...resposta, step_data: { ...resposta.step_data, product_association: { entity_id: 'X', variation_id: null, catalog_product_id: null } } };
    expect(interpretarRespostaMatcher(semId, plano)).toMatchObject({ acao: 'manual', motivo: 'resposta_sem_parent_product' });
  });
});
