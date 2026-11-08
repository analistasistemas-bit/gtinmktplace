import { describe, expect, it, vi } from 'vitest';

vi.mock('../client.ts', () => ({ openrouterClient: () => { throw new Error('IA real proibida em teste'); } }));
import {
  adequadaAoML, custoImagemUsd, dimensoesImagem, extrairImagem, montarPedidoImagem, MODELO_IMAGEM_PADRAO,
} from '../imagem.ts';
import { PRECOS } from '../tokens.ts';
import { MODELOS_IMAGEM } from '../../../../../src/lib/ai-modelos.ts';

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
/** Cabeçalho PNG mínimo: assinatura + IHDR com largura e altura (big-endian). */
function png(largura: number, altura: number): number[] {
  const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be(largura), ...be(altura), 8, 6, 0, 0, 0];
}
/** JPEG mínimo: SOI + APP0 curto + SOF0 com altura e largura. */
function jpeg(largura: number, altura: number): number[] {
  return [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, altura >> 8, altura & 255, largura >> 8, largura & 255, 3, 0, 0, 0];
}

describe('montarPedidoImagem', () => {
  it('leva a descrição da peça, a quantidade e cada cor, sem pessoa e sem texto', () => {
    const p = montarPedidoImagem({ cores: ['Preto', 'Azul Royal', 'Caramelo'], descricao: 'cropped jacket, elastic hem and cuffs' });
    expect(p).toContain('cropped jacket, elastic hem and cuffs');
    expect(p).toContain('3-piece kit');
    for (const c of ['Preto', 'Azul Royal', 'Caramelo']) expect(p).toContain(c);
    expect(p).toMatch(/no person/i);
    expect(p).toMatch(/no text/i);
    expect(p).toMatch(/white background/i);
  });
});

describe('extrairImagem', () => {
  it('lê o data URL da resposta do OpenRouter', () => {
    const r = extrairImagem({ choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${b64(png(896, 1200))}` } }] } }] });
    expect(r.mime).toBe('image/png');
    expect(r.ext).toBe('png');
    expect(dimensoesImagem(r.bytes)).toEqual({ largura: 896, altura: 1200 });
  });
  it('resposta sem imagem lança', () => {
    expect(() => extrairImagem({ choices: [{ message: { content: 'não consegui' } }] })).toThrow();
    expect(() => extrairImagem({})).toThrow();
  });
});

describe('dimensões e adequação ao ML', () => {
  it('PNG e JPEG', () => {
    expect(dimensoesImagem(new Uint8Array(png(1200, 1200)))).toEqual({ largura: 1200, altura: 1200 });
    expect(dimensoesImagem(new Uint8Array(jpeg(900, 1200)))).toEqual({ largura: 900, altura: 1200 });
    expect(dimensoesImagem(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it('vertical ou quadrada, lado menor ≥ 500', () => {
    expect(adequadaAoML({ largura: 896, altura: 1200 })).toBe(true);
    expect(adequadaAoML({ largura: 1024, altura: 1024 })).toBe(true);
    expect(adequadaAoML({ largura: 1200, altura: 896 })).toBe(false);
    expect(adequadaAoML({ largura: 400, altura: 600 })).toBe(false);
    expect(adequadaAoML(null)).toBe(false);
  });
});

describe('custo da imagem', () => {
  it('usa o custo real do provedor quando vem', () => {
    expect(custoImagemUsd(MODELO_IMAGEM_PADRAO, { cost: 0.041, prompt_tokens: 1, completion_tokens: 1 })).toBe(0.041);
  });
  it('sem custo do provedor, estima por PRECOS e nunca dá zero', () => {
    expect(custoImagemUsd(MODELO_IMAGEM_PADRAO, { prompt_tokens: 3000, completion_tokens: 1290 })).toBeGreaterThan(0);
  });
  it('todo modelo de imagem da tela tem preço (senão o custo vira zero)', () => {
    expect(MODELOS_IMAGEM[0].slug).toBe(MODELO_IMAGEM_PADRAO);
    for (const m of MODELOS_IMAGEM) expect(PRECOS[m.slug], m.slug).toBeDefined();
  });
});
