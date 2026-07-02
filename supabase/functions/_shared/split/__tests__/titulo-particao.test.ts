import { describe, it, expect, vi } from 'vitest';
import { tituloParticaoDeterministico } from '../titulo-particao';

// Cobre só a parte determinística/pura (fallback). A chamada de IA não é testada.
const base = 'LINHA COSTURA 1500M | 100% POLIÉSTER | RESISTENTE';

describe('tituloParticaoDeterministico', () => {
  it('crava uma cor da partição: ≤60, não vazio e diferente do título base', () => {
    const t = tituloParticaoDeterministico(base, [{ cor: 'Vermelho' }, { cor: 'Azul' }], 1);
    expect(t.length).toBeGreaterThan(0);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).not.toBe(base);
  });

  it('distingue partições com conjuntos de cor diferentes', () => {
    const p1 = tituloParticaoDeterministico(base, [{ cor: 'Amarelo' }], 1);
    const p2 = tituloParticaoDeterministico(base, [{ cor: 'Verde' }], 2);
    expect(p1).not.toBe(p2);
  });

  it('mantém ≤60 quando o título base já é longo', () => {
    const longo = 'FITA CETIM PROGRESSO N.1 100MT | 100% POLIÉSTER | SUPER RESISTENTE';
    const t = tituloParticaoDeterministico(longo, [{ cor: 'Marrom' }], 1);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).not.toBe(longo);
  });

  it('usa ordinal quando a partição não tem cor nomeada (não vazio, distinto)', () => {
    const p1 = tituloParticaoDeterministico(base, [{ cor: null }], 1);
    const p2 = tituloParticaoDeterministico(base, [{ cor: null }], 2);
    expect(p1.length).toBeGreaterThan(0);
    expect(p1.length).toBeLessThanOrEqual(60);
    expect(p1).not.toBe(base);
    expect(p1).not.toBe(p2);
  });
});

// gerarCopy é importado dinamicamente dentro de gerarTituloParticao (ver comentário no módulo)
// justamente pra permitir mockar aqui sem puxar o grafo real do cliente OpenRouter (Deno npm:).
vi.mock('../../ai/copywriter.ts', () => ({
  gerarCopy: vi.fn(async () => ({
    titulo: 'EUROROMA 4/6 600G 610MT | 85% ALGODÃO',
    descricao: 'x',
    tipo_produto_busca: 'barbante',
    tokens_input: 0,
    tokens_output: 0,
    custo_centavos: 0,
  })),
}));

describe('gerarTituloParticao — conecta garantirTipoProdutoTitulo (ADR-0054)', () => {
  it('prefixa o tipo de produto ausente do título gerado pela IA', async () => {
    const { gerarTituloParticao } = await import('../titulo-particao');
    const titulo = await gerarTituloParticao({
      nome: 'EUROROMA 4/6 CORES 600G 610MT',
      descricao_detalhado: 'BARBANTE 4/6...',
      cores: [{ codigo: '1', cor: 'Cru', preco: 10 }],
      tituloBase: 'EUROROMA 4/6 600G 610MT | OUTRA COR',
      particao: 1,
    });
    expect(titulo.startsWith('BARBANTE ')).toBe(true);
    expect(titulo.length).toBeLessThanOrEqual(60);
  });
});
