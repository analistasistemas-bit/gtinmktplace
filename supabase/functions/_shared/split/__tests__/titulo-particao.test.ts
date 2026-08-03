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
// Shape do mock segue OutputCopy pós-ADR-0099: titulo_slots, não mais titulo pronto (Task 8).
vi.mock('../../ai/copywriter.ts', () => ({
  gerarCopy: vi.fn(async () => ({
    titulo_slots: {
      produto: 'Euroroma', marca: '', modelo: '4/6', medida: '', quantidade: '',
      material: '', variacao: '', compatibilidade: '', aplicacao: '', sinonimo: '',
    },
    descricao: 'x',
    tipo_produto_busca: 'barbante',
    tokens_input: 0,
    tokens_output: 0,
    custo_centavos: 0,
  })),
}));

describe('gerarTituloParticao — conecta posProcessarTitulo (ADR-0099)', () => {
  it('prefixa o tipo de produto ausente do slot `produto` (ADR-0054, via aplicarGuardsTitulo)', async () => {
    const { gerarTituloParticao } = await import('../titulo-particao');
    const titulo = await gerarTituloParticao({
      nome: 'EUROROMA 4/6 CORES 600G 610MT',
      descricao_detalhado: 'BARBANTE 4/6...',
      cores: [{ codigo: '1', cor: 'Cru', preco: 10 }],
      tituloBase: 'EUROROMA 4/6 600G 610MT | OUTRA COR',
      particao: 1,
    });
    expect(titulo.startsWith('Barbante ')).toBe(true);
    expect(titulo.length).toBeLessThanOrEqual(60);
  });
});

describe('tituloParticaoDeterministico sem pipe (ADR-0099)', () => {
  it('acrescenta a cor representativa ao título-base', () => {
    const t = tituloParticaoDeterministico('Fita de Cetim Búfalo N.3 10m', [{ cor: 'Vermelho' }], 1);
    expect(t).toBe('Fita de Cetim Búfalo N.3 10m Vermelho');
    expect(t).not.toContain('|');
  });

  it('escolhe a primeira cor em ordem alfabética', () => {
    const t = tituloParticaoDeterministico('Fita 10m', [{ cor: 'Verde' }, { cor: 'Azul' }], 1);
    expect(t).toContain('Azul');
    expect(t).not.toContain('Verde');
  });

  it('derruba palavras inteiras do base para caber, nunca corta token', () => {
    const base = 'Bordado Inglês Búfalo Referência Cores Passa Fita Especial 13,71m';
    const t = tituloParticaoDeterministico(base, [{ cor: 'Branco' }], 1);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).toContain('Branco');
    for (const token of t.split(' ')) expect(`${base} Branco`.split(' ')).toContain(token);
  });

  it('sem cor nomeada usa ordinal da partição', () => {
    const t = tituloParticaoDeterministico('Fita 10m', [{ cor: null }], 2);
    expect(t).toContain('Opcao 3');
  });

  it('remove pipe de título-base legado (familias.titulo_ml pré-ADR-0099)', () => {
    const t = tituloParticaoDeterministico('LINHA COSTURA 1500M | 100% POLIÉSTER | RESISTENTE', [{ cor: 'Azul' }], 1);
    expect(t).not.toContain('|');
    expect(t).toContain('Azul');
  });

  it('cor indefinida nunca vira discriminador de partição (lote #31)', () => {
    expect(tituloParticaoDeterministico('Fita Cetim 10m', [{ cor: 'Outra' }], 1)).not.toContain('Outra');
  });

  it('cor real vence Outra, mesmo Outra vindo antes no alfabeto', () => {
    const t = tituloParticaoDeterministico('Fita Cetim 10m', [{ cor: 'Outra' }, { cor: 'Vermelho' }], 1);
    expect(t).toContain('Vermelho');
    expect(t).not.toContain('Outra');
  });

  it('corta por caractere no caso degenerado: uma palavra só, ainda estoura 60', () => {
    const umaPalavraLonga = 'A'.repeat(58); // + discriminador curto passa de 60 mesmo com 1 palavra
    const t = tituloParticaoDeterministico(umaPalavraLonga, [{ cor: 'Azul' }], 1);
    expect(t.length).toBeLessThanOrEqual(60);
  });
});
