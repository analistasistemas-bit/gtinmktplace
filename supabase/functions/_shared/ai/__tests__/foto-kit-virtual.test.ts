import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
vi.mock('../client.ts', () => ({ openrouterClient: () => ({ chat: { completions: { create } } }) }));
vi.mock('../imagem.ts', () => ({ custoImagemUsd: () => 0.0123 }));
import {
  avaliarComposicao, chaveComposicao, MAX_UNIDADES_CAPA, modoCapa, montarPedidoComposicao, quantidadesNaCapa, SISTEMA_VERIFICACAO_COMPOSICAO, verificarComposicao,
} from '../foto-kit-virtual.ts';

const A = (q: number) => ({ rotulo: 'A', quantidade: q });
const okV = { contagem: [2, 1], itens_extras: false, texto_novo: false, fundo_neutro: true, produtos_fieis: true, observacao: 'ok' };

describe('modoCapa / quantidadesNaCapa / chaveComposicao', () => {
  it('Σ ≤ 6 mostra todas; acima, uma de cada', () => {
    expect(MAX_UNIDADES_CAPA).toBe(6);
    expect(modoCapa([A(2), { rotulo: 'B', quantidade: 1 }])).toBe('todas');
    expect(modoCapa([A(3), { rotulo: 'B', quantidade: 3 }])).toBe('todas');
    expect(modoCapa([A(3), { rotulo: 'B', quantidade: 3 }, { rotulo: 'C', quantidade: 1 }])).toBe('uma_de_cada');
    expect(quantidadesNaCapa([A(2), A(1)])).toEqual([2, 1]);
    expect(quantidadesNaCapa([A(4), A(3)])).toEqual([1, 1]);
  });
  it('chave: únicos, ordenados, sem quantidades', () => {
    expect(chaveComposicao(['MLBU2', 'MLBU1', 'MLBU2'])).toBe('MLBU1|MLBU2');
  });
});

describe('avaliarComposicao (fail-closed)', () => {
  it('aprova só com tudo certo', () => {
    expect(avaliarComposicao(okV, [2, 1])).toEqual({ aprovado: true, motivos: [] });
  });
  it('contagem de tamanho diferente ou valor errado reprova, com motivo por produto', () => {
    expect(avaliarComposicao({ ...okV, contagem: [2] }, [2, 1]).aprovado).toBe(false);
    expect(avaliarComposicao({ contagem: [1, 1] }, [2, 1]).motivos).toContain('produto 1: contei 1, esperava 2');
    expect(avaliarComposicao({ ...okV, contagem: [3, 1] }, [2, 1]).aprovado).toBe(false);
  });
  it('cada flag reprova isoladamente', () => {
    for (const v of [{ ...okV, itens_extras: true }, { ...okV, texto_novo: true }, { ...okV, fundo_neutro: false }, { ...okV, produtos_fieis: false }]) {
      expect(avaliarComposicao(v, [2, 1]).aprovado).toBe(false);
    }
  });
  it('nulo, malformado ou campo faltando reprova', () => {
    for (const r of [null, undefined, 'x', 42, {}, { ...okV, contagem: ['2', '1'] }, { ...okV, fundo_neutro: 'true' }]) {
      expect(avaliarComposicao(r, [2, 1]).aprovado).toBe(false);
    }
    expect(avaliarComposicao(null, [1, 1]).motivos.length).toBeGreaterThan(0);
  });
  it('observação entra limpa e curta', () => {
    const v = avaliarComposicao({ ...okV, produtos_fieis: false, observacao: 'X\u0000\ny'.repeat(100) }, [2, 1]);
    expect(v.motivos.join(' ')).not.toMatch(/[\u0000-\u001f]/);
    expect(v.motivos.join(' ').length).toBeLessThanOrEqual(320);
  });
});

describe('produto que é conjunto (ex.: kit shampoo + condicionador)', () => {
  // Bug 16/11 (Hairfly): referência 1 com 2 frascos virou 1 frasco na capa e a visão aprovou.
  it('gerador: 1 unidade = conjunto inteiro da referência, com todas as peças', () => {
    const [instr] = montarPedidoComposicao({ itens: [A(1), { rotulo: 'B', quantidade: 1 }] }).textos;
    expect(instr).toMatch(/ONE unit of product i is EVERYTHING shown in reference image i/);
    expect(instr).toMatch(/never drop a piece/);
    expect(instr).toMatch(/several DIFFERENT items/);
    expect(instr).toMatch(/same item more than once .* one unit is a single item/);
  });
  it('verificador: unidade sem alguma peça da original não conta e não é fiel', () => {
    expect(SISTEMA_VERIFICACAO_COMPOSICAO).toMatch(/ONE complete unit of product i is the WHOLE set of items shown in its original photo/);
    expect(SISTEMA_VERIFICACAO_COMPOSICAO).toMatch(/missing any piece .* does not count/);
    expect(SISTEMA_VERIFICACAO_COMPOSICAO).toMatch(/Pieces of a set belong to product i and are never itens_extras/);
    expect(SISTEMA_VERIFICACAO_COMPOSICAO).toMatch(/same item from several angles, one unit is one item/);
  });
});

describe('montarPedidoComposicao', () => {
  it('instrução cita índices e quantidades; dado vai no DATA', () => {
    const [instr, data] = montarPedidoComposicao({ itens: [A(2), { rotulo: 'B', quantidade: 1 }] }).textos;
    expect(instr).toMatch(/reference image i/);
    expect(instr).toMatch(/EXACTLY/);
    expect(instr).toMatch(/same scale/);
    expect(instr).toMatch(/light/);
    expect(data).toContain('"produtos":[{"indice":1,"quantidade":2},{"indice":2,"quantidade":1}]');
    expect(data).not.toContain('"corrigir"');
  });
  it('motivos anteriores entram limpos no DATA, nunca nas instruções', () => {
    const { textos } = montarPedidoComposicao({ itens: [A(2), A(1)], motivosAnteriores: ['x\u0000y'] });
    expect(textos[1]).toContain('"corrigir"');
    expect(textos[1]).not.toMatch(/\\u0000/);
    expect(textos[0]).not.toContain('x y');
    expect(textos[0]).toContain('DATA.corrigir');
  });
});

describe('verificarComposicao', () => {
  beforeEach(() => create.mockReset());
  it('manda originais na ordem + gerada por último e devolve cru + custo', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(okV) } }], usage: {} });
    const r = await verificarComposicao({ originais: ['o1', 'o2'], gerada: 'g', quantidades: [2, 1], timeoutMs: 1000 });
    expect(r).toEqual({ verificacao: okV, custoUsd: 0.0123 });
    const urls = create.mock.calls[0][0].messages[1].content.filter((c: { type: string }) => c.type === 'image_url').map((c: { image_url: { url: string } }) => c.image_url.url);
    expect(urls).toEqual(['o1', 'o2', 'g']);
  });
});
