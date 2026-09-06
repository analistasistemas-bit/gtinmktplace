// ADR-0154 D-8: "Refazer kit" pré-preenche o diálogo com os componentes/título/descrição/
// desconto/listing type/foto do kit encerrado — a alternativa rejeitada era reabrir em branco.
// Cobre as duas peças puras/DI que sustentam isso: `carregarKitVirtualParaRefazer` (casa os
// componentes armazenados com o candidato ATUAL do buscador do ML) e
// `prefillAposEncerrarKitVirtual` (nunca carrega/pré-preenche quando o encerrar não teve sucesso
// — "cuide da ordem": o kit velho precisa estar encerrado antes do novo ser publicado).
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockInvoke } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockInvoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom, functions: { invoke: mockInvoke } },
}));

afterEach(() => vi.clearAllMocks());

const {
  carregarKitVirtualParaRefazer, prefillAposEncerrarKitVirtual,
} = await import('../kit-virtual');
import type { ResultadoEncerrarKitVirtual, ResultadoCarregarKitVirtualParaRefazer } from '../kit-virtual';

function fakeChainSingle(resultado: unknown) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve(resultado),
  };
  return chain;
}
function fakeChainList(resultado: unknown) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve(resultado),
  };
  return chain;
}

const KIT_ROW = {
  titulo: 'Kit Aventura: 1 Motosserra + 1 Canivete',
  descricao: 'Descrição antiga.',
  desconto_pct: 0.15,
  listing_type_id: 'gold_special',
  foto_storage_path: 'org-1/kit-virtual-antigo/foto.jpg',
  foto_ml_picture_id: 'PIC-ANTIGO',
};

const COMPONENTE_WIRE_A = {
  user_product_id: 'UP-A', item_id: 'MLB1', title: 'Motosserra Elétrica', type: 'available',
  thumbnail_url: null, category_name: 'Ferramentas', estoque: 20, reasons: [],
  codigo: '00000001', codigo_pai: '00000001', custo: 40, origem: 'nacional',
  kit_multiplicador: null, preco_atual_ml: 100, categoria_ml_id: 'MLB1234',
};
const COMPONENTE_WIRE_B = {
  user_product_id: 'UP-B', item_id: 'MLB2', title: 'Canivete Retrátil', type: 'available',
  thumbnail_url: null, category_name: 'Ferramentas', estoque: 5, reasons: [],
  codigo: '00000002', codigo_pai: '00000002', custo: 10, origem: 'nacional',
  kit_multiplicador: null, preco_atual_ml: 50, categoria_ml_id: 'MLB5678',
};

function mockTabelas({
  kit = KIT_ROW as unknown, componentes = [{ user_product_id: 'UP-A', quantidade: 1 }, { user_product_id: 'UP-B', quantidade: 2 }],
} = {}) {
  mockFrom.mockImplementation((tabela: string) => {
    if (tabela === 'kits_virtuais') return fakeChainSingle({ data: kit, error: null });
    if (tabela === 'kits_virtuais_componentes') return fakeChainList({ data: componentes, error: null });
    throw new Error(`tabela inesperada: ${tabela}`);
  });
}

function mockBuscador(elegiveis: unknown[] = [COMPONENTE_WIRE_A, COMPONENTE_WIRE_B], inelegiveis: unknown[] = []) {
  mockInvoke.mockResolvedValue({ data: { elegiveis, inelegiveis }, error: null });
}

describe('carregarKitVirtualParaRefazer', () => {
  it('casa os componentes armazenados com o candidato atual e converte desconto 0-1 → 0-99', async () => {
    mockTabelas();
    mockBuscador();

    const r = await carregarKitVirtualParaRefazer('kit-1');

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperava ok:true');
    expect(r.componentesNaoRecuperados).toBe(0);
    expect(r.dados.titulo).toBe('Kit Aventura: 1 Motosserra + 1 Canivete');
    expect(r.dados.descricao).toBe('Descrição antiga.');
    expect(r.dados.descontoPct).toBe(15);
    expect(r.dados.fotoStoragePath).toBe('org-1/kit-virtual-antigo/foto.jpg');
    expect(r.dados.fotoMlPictureId).toBe('PIC-ANTIGO');
    expect(r.dados.componentes).toHaveLength(2);
    expect(r.dados.componentes[0].candidato.userProductId).toBe('UP-A');
    expect(r.dados.componentes[0].quantidade).toBe(1);
    expect(r.dados.componentes[0].precoAtualML).toBe(100); // preço vem do candidato AO VIVO, não persistido
    expect(r.dados.componentes[1].candidato.userProductId).toBe('UP-B');
    expect(r.dados.componentes[1].quantidade).toBe(2);
  });

  it('componente que sumiu do buscador é descartado e contado em componentesNaoRecuperados', async () => {
    mockTabelas({
      componentes: [
        { user_product_id: 'UP-A', quantidade: 1 },
        { user_product_id: 'UP-B', quantidade: 1 },
        { user_product_id: 'UP-REMOVIDO', quantidade: 1 },
      ],
    });
    mockBuscador(); // buscador só devolve UP-A e UP-B — UP-REMOVIDO não existe mais

    const r = await carregarKitVirtualParaRefazer('kit-1');

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperava ok:true');
    expect(r.componentesNaoRecuperados).toBe(1);
    expect(r.dados.componentes).toHaveLength(2);
    expect(r.dados.componentes.map((c) => c.candidato.userProductId)).toEqual(['UP-A', 'UP-B']);
  });

  it('menos de 2 componentes reconstruíveis: ok:false sem_componentes_suficientes', async () => {
    mockTabelas({
      componentes: [
        { user_product_id: 'UP-A', quantidade: 1 },
        { user_product_id: 'UP-SUMIU', quantidade: 1 },
      ],
    });
    mockBuscador([COMPONENTE_WIRE_A], []); // só UP-A sobrevive

    const r = await carregarKitVirtualParaRefazer('kit-1');

    expect(r).toEqual({ ok: false, motivo: 'sem_componentes_suficientes' });
  });

  it('kit não encontrado (já apagado/id errado): ok:false nao_encontrado, sem chamar o buscador', async () => {
    mockTabelas({ kit: null });
    mockBuscador();

    const r = await carregarKitVirtualParaRefazer('kit-inexistente');

    expect(r).toEqual({ ok: false, motivo: 'nao_encontrado' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('candidato sem preço (null) vira 0 editável — nunca derruba a reconstrução', async () => {
    mockTabelas({ componentes: [{ user_product_id: 'UP-A', quantidade: 1 }, { user_product_id: 'UP-B', quantidade: 1 }] });
    mockBuscador([{ ...COMPONENTE_WIRE_A, preco_atual_ml: null }, COMPONENTE_WIRE_B], []);

    const r = await carregarKitVirtualParaRefazer('kit-1');

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperava ok:true');
    expect(r.dados.componentes[0].precoAtualML).toBe(0);
  });
});

describe('prefillAposEncerrarKitVirtual', () => {
  const ENCERRAR_OK: ResultadoEncerrarKitVirtual = { ok: true, kitId: 'kit-1', jaEncerrado: false };
  const ENCERRAR_FALHOU: ResultadoEncerrarKitVirtual = { ok: false, motivo: 'ml_recusou', mensagem: 'ML recusou' };
  const CARREGADO_OK: ResultadoCarregarKitVirtualParaRefazer = {
    ok: true, componentesNaoRecuperados: 0,
    dados: {
      componentes: [], titulo: 'Kit', descricao: null, descontoPct: 10,
      fotoStoragePath: 'x', fotoMlPictureId: 'y',
    },
  };

  it('encerrar sem sucesso: NUNCA chama carregarParaRefazer — kit velho ainda no ar não pode virar prefill', async () => {
    const carregarParaRefazer = vi.fn();

    const r = await prefillAposEncerrarKitVirtual('kit-1', ENCERRAR_FALHOU, carregarParaRefazer);

    expect(r).toBeNull();
    expect(carregarParaRefazer).not.toHaveBeenCalled();
  });

  it('encerrar com sucesso: carrega e repassa os dados de prefill', async () => {
    const carregarParaRefazer = vi.fn().mockResolvedValue(CARREGADO_OK);

    const r = await prefillAposEncerrarKitVirtual('kit-1', ENCERRAR_OK, carregarParaRefazer);

    expect(carregarParaRefazer).toHaveBeenCalledWith('kit-1');
    expect(r).toEqual({ dadosParaPrefill: CARREGADO_OK.dados, componentesNaoRecuperados: 0 });
  });

  it('encerrar com sucesso mas carregar falha: dadosParaPrefill null com a mensagem', async () => {
    const carregarParaRefazer = vi.fn().mockResolvedValue({ ok: false, motivo: 'nao_encontrado' });

    const r = await prefillAposEncerrarKitVirtual('kit-1', ENCERRAR_OK, carregarParaRefazer);

    expect(r).toEqual({ dadosParaPrefill: null, componentesNaoRecuperados: 0, mensagemCarregarFalhou: 'nao_encontrado' });
  });
});
