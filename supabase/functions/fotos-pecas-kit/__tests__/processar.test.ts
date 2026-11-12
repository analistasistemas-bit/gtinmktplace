import { describe, it, expect, vi } from 'vitest';
import { propostaDeGalerias } from '../processar.ts';

const variacoes = [
  { codigo: '141', cor: 'Preto' }, { codigo: '142', cor: 'Preto' }, { codigo: '147', cor: 'Caqui' }, { codigo: '150', cor: 'Azul' },
];
const vinculos = [
  { sku: '141', item_externo_id: 'MLB-P' }, { sku: '142', item_externo_id: 'MLB-P2' }, { sku: '147', item_externo_id: 'MLB-C' },
  { sku: '150', item_externo_id: null },
];
const F = (id: string, item: string) => ({ id, item });

function deps(over: Partial<Parameters<typeof propostaDeGalerias>[0]> = {}) {
  const galeria = vi.fn(async (pecas: Array<{ cor: string; itemId: string }>, limite: number) => ({
    fotos: [F('P2', 'MLB-P'), F('C3', 'MLB-C')], avisos: [] as string[], indisponivel: false, urls: { P2: 'u/P2', C3: 'u/C3' }, _pecas: pecas, _limite: limite,
  }));
  return { galeria, d: { variacoes, vinculos, categoriaId: 'MLB188064', lerLimite: async () => 12, galeria, ...over } };
}

describe('propostaDeGalerias', () => {
  it('uma peça por cor (menor código com item), limite da categoria, e devolve foto + url + cor de origem', async () => {
    const { galeria, d } = deps();
    const r = await propostaDeGalerias(d, [{ rotulo: 'Preto e Caqui', cores: ['Preto', 'Caqui'] }]);
    expect(galeria).toHaveBeenCalledWith([{ cor: 'Preto', itemId: 'MLB-P' }, { cor: 'Caqui', itemId: 'MLB-C' }], 12);
    expect(r['Preto e Caqui']).toEqual({
      fotos: [{ id: 'P2', item: 'MLB-P', url: 'u/P2', cor: 'Preto' }, { id: 'C3', item: 'MLB-C', url: 'u/C3', cor: 'Caqui' }],
      avisos: [], indisponivel: false,
    });
  });

  it('limite da categoria ilegível: todas as combinações indisponíveis, sem ler as fotos', async () => {
    const { galeria, d } = deps({ lerLimite: async () => null });
    const r = await propostaDeGalerias(d, [{ rotulo: 'Preto e Caqui', cores: ['Preto', 'Caqui'] }]);
    expect(galeria).not.toHaveBeenCalled();
    expect(r['Preto e Caqui']).toMatchObject({ fotos: [], indisponivel: true });
    expect(r['Preto e Caqui'].avisos[0]).toMatch(/limite/);
  });

  it('cor sem peça com anúncio no ML: só aquela combinação fica indisponível', async () => {
    const { d } = deps();
    const r = await propostaDeGalerias(d, [
      { rotulo: 'Preto e Azul', cores: ['Preto', 'Azul'] }, { rotulo: 'Preto e Caqui', cores: ['Preto', 'Caqui'] },
    ]);
    expect(r['Preto e Azul']).toMatchObject({ fotos: [], indisponivel: true });
    expect(r['Preto e Azul'].avisos.join(' ')).toMatch(/Azul/);
    expect(r['Preto e Caqui'].indisponivel).toBe(false);
  });

  it('leitura lançando vira indisponível, nunca erro', async () => {
    const { d } = deps({ galeria: async () => { throw new Error('boom'); } });
    const r = await propostaDeGalerias(d, [{ rotulo: 'Preto e Caqui', cores: ['Preto', 'Caqui'] }]);
    expect(r['Preto e Caqui']).toMatchObject({ fotos: [], indisponivel: true });
  });

  it('foto sem url conhecida vem com url null', async () => {
    const { d } = deps({ galeria: async () => ({ fotos: [F('P2', 'MLB-P')], avisos: [], indisponivel: false, urls: {} }) });
    const r = await propostaDeGalerias(d, [{ rotulo: 'Preto e Caqui', cores: ['Preto', 'Caqui'] }]);
    expect(r['Preto e Caqui'].fotos[0].url).toBeNull();
  });
});
