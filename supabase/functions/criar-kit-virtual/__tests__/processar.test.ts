// ADR-0154: CREATE do Kit Virtual. Vitest (não Deno test) — é o runner que o CI e o
// vitest.config.ts realmente executam.
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  criarKitVirtual, montarPayloadKitVirtual, validarKitVirtual, resolverListingTypeKit,
  type ComponenteKitVirtual, type CriarKitVirtualDeps, type CriarKitVirtualInput,
} from '../processar.ts';
import { criarKitVirtualML } from '../../_shared/ml/kit-virtual.ts';

const ORG = 'org-1';

function comp(up: string, over: Partial<ComponenteKitVirtual> = {}): ComponenteKitVirtual {
  return {
    userProductId: up, quantidade: 1, descontoPct: 0.3,
    itemExternoId: `MLB-${up}`, codigo: `C-${up}`, codigoPai: `P-${up}`, ...over,
  };
}

function inputPadrao(over: Partial<CriarKitVirtualInput> = {}): CriarKitVirtualInput {
  return {
    chaveCadastro: 'chave-1',
    titulo: 'Kit 2 itens: A + B',
    descricao: 'Descrição do kit',
    fotoStoragePath: 'org-1/kit.jpg',
    fotoMlPictureId: 'PIC-1',
    componentes: [comp('MLBU1'), comp('MLBU2')],
    ...over,
  };
}

// ── Fake de banco: dispatch por tabela/operação, com a MESMA trava do trigger
// `kits_virtuais_validar_componentes` da migration (conta 2..6 componentes ao gravar
// `status='publicado'`). É isso que faz o teste de ORDEM DE ESCRITA ser real: inverter os
// passos quebra aqui exatamente como quebraria no Postgres. ──────────────────────────────────

interface LinhaKitFake extends Record<string, unknown> {
  id: string; org_id: string; chave_cadastro: string; status: string;
  ml_item_id: string | null; ml_user_product_id: string | null; ml_permalink: string | null;
  foto_storage_path: string | null; foto_ml_picture_id: string | null; erro_mensagem: string | null;
  listing_type_id: string; atualizado_em: string;
}

interface EstadoFake {
  kits: LinhaKitFake[];
  componentes: Record<string, unknown>[];
  ops: string[];
  seq: number;
}

function novoEstado(kits: Partial<LinhaKitFake>[] = []): EstadoFake {
  return {
    kits: kits.map((k, i) => ({
      id: `kit-pre-${i}`, org_id: ORG, chave_cadastro: 'chave-1', status: 'publicando',
      ml_item_id: null, ml_user_product_id: null, ml_permalink: null,
      foto_storage_path: null, foto_ml_picture_id: null, erro_mensagem: null,
      listing_type_id: 'gold_pro', atualizado_em: new Date().toISOString(), ...k,
    })),
    componentes: [],
    ops: [],
    seq: 0,
  };
}

interface Consulta {
  tabela: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  payload?: unknown;
  filtros: { col: string; val: unknown }[];
}

function casa(linha: Record<string, unknown>, filtros: Consulta['filtros']): boolean {
  return filtros.every((f) => linha[f.col] === f.val);
}

function executar(q: Consulta, st: EstadoFake): { data: unknown; error: unknown } {
  if (q.tabela === 'kits_virtuais') {
    if (q.op === 'insert') {
      const p = q.payload as Record<string, unknown>;
      st.ops.push('kits.insert');
      if (st.kits.some((k) => k.org_id === p.org_id && k.chave_cadastro === p.chave_cadastro)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      const linha = {
        id: `kit-${++st.seq}`, ml_item_id: null, ml_user_product_id: null, ml_permalink: null,
        erro_mensagem: null, ...p,
      } as LinhaKitFake;
      st.kits.push(linha);
      return { data: { ...linha }, error: null };
    }
    if (q.op === 'update') {
      const p = q.payload as Record<string, unknown>;
      st.ops.push(`kits.update:${p.status ?? Object.keys(p).join('+')}`);
      const alvos = st.kits.filter((k) => casa(k, q.filtros));
      if (p.status === 'publicado') {
        for (const alvo of alvos) {
          const n = st.componentes.filter((c) => c.kit_id === alvo.id).length;
          if (n < 2 || n > 6) {
            return { data: null, error: { code: '23514', message: `Kit Virtual precisa de 2 a 6 componentes para ficar publicado (tem ${n}).` } };
          }
        }
      }
      for (const alvo of alvos) Object.assign(alvo, p);
      return { data: alvos[0] ? { ...alvos[0] } : null, error: null };
    }
    const achados = st.kits.filter((k) => casa(k, q.filtros)).map((k) => ({ ...k }));
    return { data: achados[0] ?? null, error: null };
  }

  if (q.tabela === 'kits_virtuais_componentes') {
    if (q.op === 'insert') {
      st.ops.push('componentes.insert');
      const linhas = q.payload as Record<string, unknown>[];
      for (const l of linhas) {
        if (st.componentes.some((c) => c.kit_id === l.kit_id && c.user_product_id === l.user_product_id)) {
          return { data: null, error: { code: '23505', message: 'componente duplicado no kit' } };
        }
        st.componentes.push({ ...l });
      }
      return { data: null, error: null };
    }
    if (q.op === 'delete') {
      st.ops.push('componentes.delete');
      st.componentes = st.componentes.filter((c) => !casa(c, q.filtros));
      return { data: null, error: null };
    }
    return { data: st.componentes.filter((c) => casa(c, q.filtros)), error: null };
  }

  throw new Error(`tabela inesperada no fake: ${q.tabela}`);
}

function fakeAdmin(st: EstadoFake): SupabaseClient {
  const from = (tabela: string) => {
    const q: Consulta = { tabela, op: 'select', filtros: [] };
    const resolver = () => Promise.resolve(executar(q, st));
    const chain: Record<string, unknown> = {
      insert: (p: unknown) => { q.op = 'insert'; q.payload = p; return chain; },
      update: (p: unknown) => { q.op = 'update'; q.payload = p; return chain; },
      delete: () => { q.op = 'delete'; return chain; },
      select: () => chain,
      eq: (col: string, val: unknown) => { q.filtros.push({ col, val }); return chain; },
      single: resolver,
      maybeSingle: resolver,
      then: (ok: unknown, err: unknown) => resolver().then(ok as never, err as never),
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

function deps(st: EstadoFake, over: Partial<CriarKitVirtualDeps> = {}): CriarKitVirtualDeps {
  return {
    admin: fakeAdmin(st),
    orgId: ORG,
    userId: 'user-1',
    urlAssinadaFoto: async (path) => `https://signed/${path}`,
    subirFoto: async () => 'PIC-NOVA',
    buscarSecureUrlFoto: async (pictureId) => `https://secure/${pictureId}`,
    buscarListingTypeComponentes: async (ids: string[]) => new Map(ids.map((id) => [id, 'gold_special'])),
    criarKitML: async () => ({ id: 'MLB999', userProductId: 'MLBU999', permalink: 'https://ml/kit', titulo: 'Kit expandido' }),
    garantirDescricao: async () => {},
    ...over,
  };
}

// ── Payload ───────────────────────────────────────────────────────────────────────────────

describe('montarPayloadKitVirtual', () => {
  it('põe automatic_price em TODOS os componentes e NUNCA envia price (D-3)', () => {
    const p = montarPayloadKitVirtual(
      inputPadrao({ componentes: [comp('MLBU1'), comp('MLBU2', { quantidade: 3 }), comp('MLBU3')] }),
      'PIC-1',
      'https://secure/PIC-1',
      'gold_pro',
    );
    expect(p.bundle.components).toHaveLength(3);
    for (const c of p.bundle.components) {
      expect(c.type).toEqual('user_product');
      expect(c.automatic_price).toEqual({ discount: 0.3 });
    }
    expect(p.bundle.components[1].quantity).toEqual(3);
    // `price` ausente da RAIZ do payload — checado na serialização real, não só na propriedade.
    expect(Object.prototype.hasOwnProperty.call(p, 'price')).toBe(false);
    expect(JSON.parse(JSON.stringify(p)).price).toBeUndefined();
    expect(p).toMatchObject({
      family_name: 'Kit 2 itens: A + B',
      channels: ['marketplace'],
      // Bug real 2026-09-06: `secure_url` é obrigatório, `id` sozinho o ML recusa.
      thumbnail: { id: 'PIC-1', secure_url: 'https://secure/PIC-1' },
      currency_id: 'BRL',
      listing_type_id: 'gold_pro',
      official_store_id: null,
    });
    expect(p.bundle.type).toEqual('kit');
  });

  it('preserva a ordem do input — o primeiro componente é o principal', () => {
    const p = montarPayloadKitVirtual(
      inputPadrao({ componentes: [comp('MLBU9'), comp('MLBU1')] }), 'PIC-1', 'https://secure/PIC-1', 'gold_pro',
    );
    expect(p.bundle.components.map((c) => c.user_product_id)).toEqual(['MLBU9', 'MLBU1']);
  });
});

// ── Validação (antes de qualquer rede) ────────────────────────────────────────────────────

describe('validarKitVirtual', () => {
  it('recusa desconto DIFERENTE entre componentes (D-3)', () => {
    expect(validarKitVirtual(inputPadrao({
      componentes: [comp('MLBU1', { descontoPct: 0.3 }), comp('MLBU2', { descontoPct: 0.2 })],
    }))).toEqual('desconto_divergente');
  });

  it('recusa desconto fora de 0-1 (escala de fração, não 0-100)', () => {
    expect(validarKitVirtual(inputPadrao({
      componentes: [comp('MLBU1', { descontoPct: 30 }), comp('MLBU2', { descontoPct: 30 })],
    }))).toEqual('desconto_invalido');
    expect(validarKitVirtual(inputPadrao({
      componentes: [comp('MLBU1', { descontoPct: 1 }), comp('MLBU2', { descontoPct: 1 })],
    }))).toEqual('desconto_invalido');
  });

  it('recusa fora de 2..6 componentes e quantidade fora de 1..10', () => {
    expect(validarKitVirtual(inputPadrao({ componentes: [comp('MLBU1')] }))).toEqual('componentes_invalidos');
    const sete = Array.from({ length: 7 }, (_, i) => comp(`MLBU${i}`));
    expect(validarKitVirtual(inputPadrao({ componentes: sete }))).toEqual('componentes_invalidos');
    expect(validarKitVirtual(inputPadrao({
      componentes: [comp('MLBU1', { quantidade: 11 }), comp('MLBU2')],
    }))).toEqual('quantidade_invalida');
  });

  it('recusa o mesmo produto duas vezes (isso é quantidade, não linha repetida)', () => {
    expect(validarKitVirtual(inputPadrao({ componentes: [comp('MLBU1'), comp('MLBU1')] })))
      .toEqual('componente_duplicado');
  });

  it('aceita a composição válida', () => {
    expect(validarKitVirtual(inputPadrao())).toBeNull();
  });
});

// ── resolverListingTypeKit (bug real 2026-09-06: default gold_pro não bate com o componente) ──

describe('resolverListingTypeKit', () => {
  it('deriva o único listing type encontrado entre os componentes', () => {
    const mapa = new Map([['MLB-MLBU1', 'gold_special'], ['MLB-MLBU2', 'gold_special']]);
    expect(resolverListingTypeKit([comp('MLBU1'), comp('MLBU2')], mapa))
      .toEqual({ listingTypeId: 'gold_special' });
  });

  it('componentes com listing type diferentes → erro ANTES de qualquer chamada ao ML', () => {
    const mapa = new Map([['MLB-MLBU1', 'gold_special'], ['MLB-MLBU2', 'gold_pro']]);
    expect(resolverListingTypeKit([comp('MLBU1'), comp('MLBU2')], mapa))
      .toEqual({ erro: 'listing_type_divergente' });
  });

  it('nenhum componente resolvido (sem itemExternoId ou sem match no mapa) → erro, nunca um default silencioso', () => {
    expect(resolverListingTypeKit([comp('MLBU1', { itemExternoId: null }), comp('MLBU2', { itemExternoId: null })], new Map()))
      .toEqual({ erro: 'listing_type_indisponivel' });
    expect(resolverListingTypeKit([comp('MLBU1'), comp('MLBU2')], new Map()))
      .toEqual({ erro: 'listing_type_indisponivel' });
  });

  it('sinal parcial (só alguns componentes têm itemExternoId/match) usa o que resolveu', () => {
    const mapa = new Map([['MLB-MLBU1', 'gold_special']]);
    expect(resolverListingTypeKit([comp('MLBU1'), comp('MLBU2', { itemExternoId: null })], mapa))
      .toEqual({ listingTypeId: 'gold_special' });
  });
});

// ── criarKitVirtual ───────────────────────────────────────────────────────────────────────

describe('criarKitVirtual', () => {
  it('publica: grava componentes ANTES de status=publicado (ordem imposta pelo trigger)', async () => {
    const st = novoEstado();
    const r = await criarKitVirtual(deps(st), inputPadrao());

    expect(r).toMatchObject({ ok: true, mlItemId: 'MLB999', mlUserProductId: 'MLBU999', jaExistia: false });
    const iComp = st.ops.indexOf('componentes.insert');
    const iPub = st.ops.indexOf('kits.update:publicado');
    expect(iComp).toBeGreaterThanOrEqual(0);
    expect(iPub).toBeGreaterThan(iComp);
    // E a linha do kit nasce ANTES dos componentes (a FK composta exige).
    expect(st.ops.indexOf('kits.insert')).toBeLessThan(iComp);

    expect(st.kits[0].status).toEqual('publicado');
    expect(st.kits[0].ml_permalink).toEqual('https://ml/kit');
    expect(st.componentes.map((c) => [c.ordem, c.user_product_id])).toEqual([[0, 'MLBU1'], [1, 'MLBU2']]);
  });

  it('desconto divergente é recusado ANTES de tocar no ML e no banco', async () => {
    const st = novoEstado();
    const criarKitML = vi.fn();
    const r = await criarKitVirtual(
      deps(st, { criarKitML }),
      inputPadrao({ componentes: [comp('MLBU1', { descontoPct: 0.3 }), comp('MLBU2', { descontoPct: 0.1 })] }),
    );
    expect(r).toEqual({ ok: false, motivo: 'desconto_divergente' });
    expect(criarKitML).not.toHaveBeenCalled();
    expect(st.ops).toEqual([]);
    expect(st.kits).toEqual([]);
  });

  it('IDEMPOTÊNCIA: 2ª chamada com a mesma chave_cadastro NÃO faz 2º POST', async () => {
    const st = novoEstado();
    const criarKitML = vi.fn(async () => ({
      id: 'MLB999', userProductId: 'MLBU999', permalink: 'https://ml/kit', titulo: 'Kit',
    }));
    const d = deps(st, { criarKitML });

    const primeira = await criarKitVirtual(d, inputPadrao());
    const segunda = await criarKitVirtual(d, inputPadrao());

    expect(criarKitML).toHaveBeenCalledTimes(1);
    expect(primeira.ok && segunda.ok).toBe(true);
    if (!primeira.ok || !segunda.ok) throw new Error('ambas deveriam ter dado ok');
    expect(segunda.kitId).toEqual(primeira.kitId);
    expect(segunda.mlItemId).toEqual(primeira.mlItemId);
    expect(segunda.jaExistia).toBe(true);
    expect(st.kits).toHaveLength(1);
    expect(st.componentes).toHaveLength(2);
  });

  it('reaproveita linha órfã em erro (mesma chave, sem ml_item_id) sem duplicar componentes', async () => {
    const st = novoEstado([{ id: 'kit-orfao', status: 'erro', erro_mensagem: 'antes deu ruim', foto_ml_picture_id: 'PIC-1' }]);
    st.componentes.push({ kit_id: 'kit-orfao', org_id: ORG, ordem: 0, user_product_id: 'MLBU1' });

    const r = await criarKitVirtual(deps(st), inputPadrao());

    expect(r).toMatchObject({ ok: true, kitId: 'kit-orfao', jaExistia: false });
    expect(st.kits).toHaveLength(1);
    expect(st.componentes).toHaveLength(2);
    expect(st.ops).toContain('componentes.delete');
    expect(st.kits[0].erro_mensagem).toBeNull();
  });

  it('foto: só sobe ao ML quando foto_ml_picture_id ainda é null (D-5/ADR-0033)', async () => {
    const stComPic = novoEstado();
    const subirComPic = vi.fn(async () => 'PIC-NOVA');
    await criarKitVirtual(deps(stComPic, { subirFoto: subirComPic }), inputPadrao());
    expect(subirComPic).not.toHaveBeenCalled();

    const stSemPic = novoEstado();
    const subirSemPic = vi.fn(async () => 'PIC-NOVA');
    const criarKitML = vi.fn(async () => ({ id: 'MLB999', userProductId: null, permalink: null, titulo: null }));
    await criarKitVirtual(
      deps(stSemPic, { subirFoto: subirSemPic, criarKitML }),
      inputPadrao({ fotoMlPictureId: null }),
    );
    expect(subirSemPic).toHaveBeenCalledWith('https://signed/org-1/kit.jpg');
    // `secure_url` vem de `buscarSecureUrlFoto`, buscado sempre — nunca reaproveitado do upload.
    expect(criarKitML.mock.calls[0][0].thumbnail).toEqual({ id: 'PIC-NOVA', secure_url: 'https://secure/PIC-NOVA' });
    expect(stSemPic.kits[0].foto_ml_picture_id).toEqual('PIC-NOVA');
  });

  it('secure_url também é buscado quando o picture_id JÁ estava salvo (upload anterior, D-5) — sem upload nesta chamada', async () => {
    const st = novoEstado();
    const buscarSecureUrlFoto = vi.fn(async (pictureId: string) => `https://secure/${pictureId}`);
    const subirFoto = vi.fn(async () => 'NUNCA-CHAMADO');
    const criarKitML = vi.fn(async () => ({ id: 'MLB999', userProductId: 'MLBU999', permalink: 'https://ml/kit', titulo: 'Kit' }));
    await criarKitVirtual(deps(st, { buscarSecureUrlFoto, subirFoto, criarKitML }), inputPadrao({ fotoMlPictureId: 'PIC-1' }));

    expect(subirFoto).not.toHaveBeenCalled();
    expect(buscarSecureUrlFoto).toHaveBeenCalledWith('PIC-1');
    expect(criarKitML.mock.calls[0][0].thumbnail).toEqual({ id: 'PIC-1', secure_url: 'https://secure/PIC-1' });
  });

  it('falha ao buscar secure_url da foto: recusa como falha_foto, sem chamar o ML', async () => {
    const st = novoEstado();
    const criarKitML = vi.fn();
    const r = await criarKitVirtual(
      deps(st, { buscarSecureUrlFoto: async () => { throw new Error('ML fora do ar'); }, criarKitML }),
      inputPadrao(),
    );
    expect(r).toMatchObject({ ok: false, motivo: 'falha_foto' });
    expect(criarKitML).not.toHaveBeenCalled();
    expect(st.kits[0].status).toEqual('erro');
  });

  it('sem picture_id e sem foto no storage: recusa (foto própria é obrigatória, D-5)', async () => {
    const st = novoEstado();
    const criarKitML = vi.fn();
    const r = await criarKitVirtual(
      deps(st, { criarKitML }),
      inputPadrao({ fotoMlPictureId: null, fotoStoragePath: null }),
    );
    expect(r).toMatchObject({ ok: false, motivo: 'foto_obrigatoria' });
    expect(criarKitML).not.toHaveBeenCalled();
    expect(st.kits[0].status).toEqual('erro');
  });

  it('recusa do ML vira status=erro com mensagem HUMANIZADA e NÃO lança (ADR-0087)', async () => {
    const st = novoEstado();
    // `criarKitVirtualML` real contra um fetch stubado — é o caminho que humaniza o `cause`.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        message: 'Validation failed for one or more fields',
        error: 'bad_request',
        cause: [{ code: 'body.thumbnail', message: 'thumbnail must not be null', type: 'error' }],
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )));

    let lancou = false;
    let r;
    try {
      r = await criarKitVirtual(deps(st, { criarKitML: (p) => criarKitVirtualML('tok', p) }), inputPadrao());
    } catch { lancou = true; }
    vi.unstubAllGlobals();

    expect(lancou).toBe(false);
    expect(r).toMatchObject({ ok: false, motivo: 'ml_recusou' });
    expect(st.kits[0].status).toEqual('erro');
    // humanizarErroML traduz o code `thumbnail` para a mensagem de foto em PT-BR.
    expect(st.kits[0].erro_mensagem).toContain('fotos do anúncio');
    expect(st.kits[0].erro_mensagem).toContain('thumbnail must not be null');
    expect(st.kits[0].ml_item_id).toBeNull();
  });

  it('descrição que falha DEPOIS do CREATE não derruba a publicação (o kit já existe no ML)', async () => {
    const st = novoEstado();
    const r = await criarKitVirtual(
      deps(st, { garantirDescricao: async () => { throw new Error('ML fora do ar'); } }),
      inputPadrao(),
    );
    expect(r).toMatchObject({ ok: true, mlItemId: 'MLB999' });
    expect(st.kits[0].status).toEqual('publicado');
  });

  // Task 8 (Parte B): `listing_type_id` é gravado na linha como REGISTRO do que foi publicado
  // (o payload do ML exige o campo). Nunca como entrada vinda do request — ver Defeito A abaixo.
  it('grava na linha o listing_type_id derivado dos componentes', async () => {
    const st = novoEstado();
    const r = await criarKitVirtual(deps(st), inputPadrao());
    expect(r.ok).toBe(true);
    expect(st.kits[0].listing_type_id).toEqual('gold_special');
  });

  // Bug real 2026-09-06: `gold_pro` fixo não bate com o listing type publicado dos componentes
  // e o ML recusa o kit inteiro (`listing_type_mismatch`). O listing type vem dos componentes.
  it('sem listing_type_id explícito: deriva do listing type real dos componentes', async () => {
    const st = novoEstado();
    const buscarListingTypeComponentes = vi.fn(async () => new Map([
      ['MLB-MLBU1', 'gold_special'], ['MLB-MLBU2', 'gold_special'],
    ]));
    const r = await criarKitVirtual(
      deps(st, { buscarListingTypeComponentes }),
      inputPadrao(),
    );
    expect(r.ok).toBe(true);
    expect(st.kits[0].listing_type_id).toEqual('gold_special');
    expect(buscarListingTypeComponentes).toHaveBeenCalledWith(['MLB-MLBU1', 'MLB-MLBU2']);
  });

  it('componentes com listing type divergente entre si: recusa ANTES de chamar o ML', async () => {
    const st = novoEstado();
    const criarKitML = vi.fn();
    const buscarListingTypeComponentes = vi.fn(async () => new Map([
      ['MLB-MLBU1', 'gold_special'], ['MLB-MLBU2', 'gold_pro'],
    ]));
    const r = await criarKitVirtual(
      deps(st, { buscarListingTypeComponentes, criarKitML }),
      inputPadrao(),
    );
    expect(r).toMatchObject({ ok: false, motivo: 'listing_type_divergente' });
    expect(criarKitML).not.toHaveBeenCalled();
    expect(st.ops).toEqual([]);
  });

  it('falha ao CONSULTAR o listing type dos componentes (rede/5xx): recusa como falha_listing_type (502), não como listing_type_indisponivel (400)', async () => {
    const st = novoEstado();
    const criarKitML = vi.fn();
    const buscarListingTypeComponentes = vi.fn(async () => { throw new Error('ML timeout'); });
    const r = await criarKitVirtual(
      deps(st, { buscarListingTypeComponentes, criarKitML }),
      inputPadrao(),
    );
    expect(r).toMatchObject({ ok: false, motivo: 'falha_listing_type' });
    expect(criarKitML).not.toHaveBeenCalled();
    expect(st.ops).toEqual([]);
  });

  it('nenhum componente com listing type resolvido: recusa (não defaulta silenciosamente)', async () => {
    const st = novoEstado();
    const criarKitML = vi.fn();
    const r = await criarKitVirtual(
      deps(st, { criarKitML }), // buscarListingTypeComponentes default devolve Map vazio
      inputPadrao({ componentes: [comp('MLBU1', { itemExternoId: null }), comp('MLBU2', { itemExternoId: null })] }),
    );
    expect(r).toMatchObject({ ok: false, motivo: 'listing_type_indisponivel' });
    expect(criarKitML).not.toHaveBeenCalled();
    expect(st.ops).toEqual([]);
  });

  it('reaproveita linha órfã: também atualiza o listing_type_id com o derivado agora, não o antigo', async () => {
    const st = novoEstado([{ id: 'kit-orfao', status: 'erro', erro_mensagem: 'antes deu ruim', foto_ml_picture_id: 'PIC-1', listing_type_id: 'gold_pro' }]);
    st.componentes.push({ kit_id: 'kit-orfao', org_id: ORG, ordem: 0, user_product_id: 'MLBU1' });

    const r = await criarKitVirtual(deps(st), inputPadrao());

    expect(r).toMatchObject({ ok: true, kitId: 'kit-orfao' });
    expect(st.kits[0].listing_type_id).toEqual('gold_special');
  });

  // ── Defeito A (revisão final): o Refazer NÃO pode reusar o listing type do kit antigo ──────
  // "Refazer kit" (D-8) existe para TROCAR componente. Reusar o `listing_type_id` do kit
  // encerrado reintroduz o `listing_type_mismatch` de 2026-09-06 assim que o componente novo
  // for de outro tipo. Não existe mais entrada explícita: a edge sempre deriva.
  it('Refazer com componente de listing type diferente do kit antigo: usa o DERIVADO, não o antigo', async () => {
    // Linha do kit antigo persistida com 'gold_pro' (o valor que o Refazer reusava antes).
    const st = novoEstado([{ id: 'kit-refeito', status: 'erro', foto_ml_picture_id: 'PIC-1', listing_type_id: 'gold_pro' }]);
    const criarKitML = vi.fn(async () => ({ id: 'MLB999', userProductId: 'MLBU999', permalink: null, titulo: null }));
    const buscarListingTypeComponentes = vi.fn(async () => new Map([
      ['MLB-MLBU1', 'gold_special'], ['MLB-MLBU9', 'gold_special'],
    ]));

    const r = await criarKitVirtual(
      deps(st, { criarKitML, buscarListingTypeComponentes }),
      inputPadrao({ componentes: [comp('MLBU1'), comp('MLBU9')] }), // MLBU9 entrou no lugar de MLBU2
    );

    expect(r.ok).toBe(true);
    expect(st.kits[0].listing_type_id).toEqual('gold_special');
    expect(criarKitML.mock.calls[0][0].listing_type_id).toEqual('gold_special');
  });

  // ── Defeito B (revisão final): kit vivo no ML que sumia da UI ───────────────────────────
  // Passo 6 falhou → linha em `publicando` COM `ml_item_id`. Publicados só lista `publicado`,
  // então o anúncio ficava no ar, vendendo, sem Encerrar nem Refazer alcançáveis. O reenvio
  // precisa REFAZER a transição, não devolver ok/jaExistia por cima do estado quebrado.
  it('linha em publicando COM ml_item_id: o reenvio completa a transição para publicado, sem 2º POST', async () => {
    const st = novoEstado([{
      id: 'kit-meio', status: 'publicando', ml_item_id: 'MLB777', ml_user_product_id: 'MLBU777',
      ml_permalink: 'https://ml/kit-777', erro_mensagem: 'timeout no update anterior',
    }]);
    st.componentes.push(
      { kit_id: 'kit-meio', org_id: ORG, ordem: 0, user_product_id: 'MLBU1' },
      { kit_id: 'kit-meio', org_id: ORG, ordem: 1, user_product_id: 'MLBU2' },
    );
    const criarKitML = vi.fn();

    const r = await criarKitVirtual(deps(st, { criarKitML }), inputPadrao());

    expect(r).toMatchObject({ ok: true, kitId: 'kit-meio', mlItemId: 'MLB777', jaExistia: true });
    expect(criarKitML).not.toHaveBeenCalled();
    expect(st.kits[0].status).toEqual('publicado');
    expect(st.kits[0].erro_mensagem).toBeNull();
    expect(st.kits[0].ml_user_product_id).toEqual('MLBU777');
  });

  it('kit ENCERRADO com ml_item_id não é ressuscitado pelo reenvio', async () => {
    const st = novoEstado([{ id: 'kit-morto', status: 'encerrado', ml_item_id: 'MLB666' }]);
    const r = await criarKitVirtual(deps(st), inputPadrao());
    expect(r).toMatchObject({ ok: true, jaExistia: true });
    expect(st.kits[0].status).toEqual('encerrado');
  });

  // ── Defeito C (revisão final): idempotência x concorrência ──────────────────────────────
  // A perdedora do 23505 relia a linha, via `ml_item_id` null (a vencedora está no meio do
  // POST) e seguia: 2 kits no ML — e o `delete` de componentes apagava os da vencedora,
  // derrubando o passo 6 dela no trigger de 2..6.
  it('2ª chamada concorrente (publicando recente, sem ml_item_id): em_andamento, sem publicar de novo', async () => {
    const st = novoEstado([{ id: 'kit-em-voo', status: 'publicando', ml_item_id: null }]);
    st.componentes.push(
      { kit_id: 'kit-em-voo', org_id: ORG, ordem: 0, user_product_id: 'MLBU1' },
      { kit_id: 'kit-em-voo', org_id: ORG, ordem: 1, user_product_id: 'MLBU2' },
    );
    const criarKitML = vi.fn();

    const r = await criarKitVirtual(deps(st, { criarKitML }), inputPadrao());

    expect(r).toMatchObject({ ok: false, motivo: 'em_andamento' });
    expect(criarKitML).not.toHaveBeenCalled();
    // Os componentes da VENCEDORA continuam de pé — sem isso o passo 6 dela estouraria 23514.
    expect(st.ops).not.toContain('componentes.delete');
    expect(st.componentes).toHaveLength(2);
    expect(st.kits[0].status).toEqual('publicando');
  });

  it('linha publicando com o lease VENCIDO (tentativa morta) volta a ser reaproveitada', async () => {
    const st = novoEstado([{
      id: 'kit-velho', status: 'publicando', ml_item_id: null, foto_ml_picture_id: 'PIC-1',
      atualizado_em: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    }]);

    const r = await criarKitVirtual(deps(st), inputPadrao());

    expect(r).toMatchObject({ ok: true, kitId: 'kit-velho', jaExistia: false });
    expect(st.kits[0].status).toEqual('publicado');
    expect(st.ops).toContain('componentes.delete');
  });

  // O lease não pode virar uma trava PERMANENTE: sem timestamp legível não há o que respeitar,
  // e recusar para sempre deixaria o operador sem caminho de recuperação nenhum.
  it('atualizado_em ilegível conta como lease vencido, não como 409 eterno', async () => {
    const st = novoEstado([{
      id: 'kit-sem-ts', status: 'publicando', ml_item_id: null,
      foto_ml_picture_id: 'PIC-1', atualizado_em: '',
    }]);

    const r = await criarKitVirtual(deps(st), inputPadrao());

    expect(r).toMatchObject({ ok: true, kitId: 'kit-sem-ts' });
    expect(st.kits[0].status).toEqual('publicado');
  });
});
