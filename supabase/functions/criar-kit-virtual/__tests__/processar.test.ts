// ADR-0154: CREATE do Kit Virtual. Vitest (não Deno test) — é o runner que o CI e o
// vitest.config.ts realmente executam.
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  criarKitVirtual, montarPayloadKitVirtual, validarKitVirtual,
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
    listingTypeId: 'gold_pro',
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
      foto_storage_path: null, foto_ml_picture_id: null, erro_mensagem: null, ...k,
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
      thumbnail: { id: 'PIC-1' },
      currency_id: 'BRL',
      listing_type_id: 'gold_pro',
      official_store_id: null,
    });
    expect(p.bundle.type).toEqual('kit');
  });

  it('preserva a ordem do input — o primeiro componente é o principal', () => {
    const p = montarPayloadKitVirtual(inputPadrao({ componentes: [comp('MLBU9'), comp('MLBU1')] }), 'PIC-1');
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
    expect(criarKitML.mock.calls[0][0].thumbnail).toEqual({ id: 'PIC-NOVA' });
    expect(stSemPic.kits[0].foto_ml_picture_id).toEqual('PIC-NOVA');
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
});
