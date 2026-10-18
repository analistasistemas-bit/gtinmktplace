import { describe, it, expect, vi } from 'vitest';

// Mesmo mock de copywriter-slots.test.ts: client.ts importa 'npm:openai@^4' (só Deno).
vi.mock('../client.ts', () => ({ openrouterClient: () => ({}) }));

import { diagnosticarTitulo } from '../titulo-pos';
import { SLOTS_VAZIOS, type TituloSlots } from '../titulo-slots';
import { coagirSlots, SCHEMA_COPY } from '../copywriter';

// ADR-0184 — fixtures reais: Short 00000010 (masculino, 8 cores), Jaqueta 00000140 (feminino),
// Conjunto 00000043 (meninas, 5 estampas).
const SHORT = {
  nomePai: 'Short Linho Mauricinho Masculino Bermuda Esporte Fino',
  descricaoPai: 'Short Masculino Mauricinho Casual com Cós Elástico e Cordão. Tecido de linho.',
  tipoProdutoBusca: '',
  cores: ['Amarelo', 'Cinza'],
  fornecedor: null,
  grade: true,
  genero: 'masculino',
};
const slots = (s: Partial<TituloSlots>): TituloSlots => ({ ...SLOTS_VAZIOS, ...s });
const titulo = (s: Partial<TituloSlots>, f: Partial<typeof SHORT> = {}) =>
  diagnosticarTitulo(slots(s), { ...SHORT, ...f }).titulo;

describe('título de grade — estrutura (ADR-0184)', () => {
  it('ordem: peça + público + característica + material', () => {
    expect(titulo({
      produto: 'Short Bermuda', publico: 'Masculino', caracteristica: 'Esporte Fino',
      caracteristica2: 'Cós Elástico', material: 'Linho',
    })).toBe('Short Bermuda Masculino Esporte Fino Cós Elástico Linho');
  });

  it('slots fora da estrutura (aplicacao, sinonimo, modelo, medida) não entram', () => {
    expect(titulo({ produto: 'Short', publico: 'Masculino', aplicacao: 'Para Praia', sinonimo: 'Bermuda', modelo: 'Casual' }))
      .toBe('Short Masculino');
  });

  it('acima de 60: sai a 2ª característica, depois o material; o resto fica', () => {
    const f = { descricaoPai: `${SHORT.descricaoPai} Cintura Alta Bolso Lateral Faca Algodão Penteado` };
    const r = diagnosticarTitulo(slots({
      produto: 'Short Bermuda Linho Mauricinho', publico: 'Masculino', caracteristica: 'Cós Elástico Cordão',
      caracteristica2: 'Bolso Lateral Faca', material: 'Algodão Penteado',
    }), { ...SHORT, ...f });
    expect(r.titulo.length).toBeLessThanOrEqual(60);
    expect(r.titulo).toBe('Short Bermuda Linho Mauricinho Masculino Cós Elástico Cordão');
    expect(r.descartes).toEqual(expect.arrayContaining([
      expect.objectContaining({ slot: 'caracteristica2', etapa: 'corte' }),
      expect.objectContaining({ slot: 'material', etapa: 'corte' }),
    ]));
  });
});

describe('público', () => {
  it('fora da lista do gênero → fallback concordando com a peça', () => {
    expect(titulo({ produto: 'Short', publico: 'Feminina' })).toBe('Short Masculino');
    expect(titulo({ produto: 'Jaqueta Corta Vento', publico: '' }, {
      nomePai: 'Jaqueta Corta Vento Feminino', descricaoPai: '', genero: 'feminino',
    })).toBe('Jaqueta Corta Vento Feminina');
  });

  it('infantil: Menina aceito para meninas; Masculino recusado vira Infantil', () => {
    const f = { nomePai: 'Conjunto Praia Proteção Solar UV', descricaoPai: '', genero: 'meninas' };
    expect(titulo({ produto: 'Conjunto Praia', publico: 'Menina' }, f)).toBe('Conjunto Praia Menina');
    expect(titulo({ produto: 'Conjunto Praia', publico: 'Masculino' }, f)).toBe('Conjunto Praia Infantil');
  });

  it('peça que já traz o gênero não ganha outro', () => {
    expect(titulo({ produto: 'Conjunto Infantil Proteção Solar UV', publico: 'Infantil' }, {
      nomePai: 'Conjunto Infantil Proteção Solar UV', descricaoPai: '', genero: 'meninas',
    })).toBe('Conjunto Infantil Proteção Solar UV');
    expect(titulo({ produto: 'Jaqueta Corta Vento Feminino', publico: '' }, {
      nomePai: 'Jaqueta Corta Vento Feminino', descricaoPai: '', genero: 'feminino',
    })).toBe('Jaqueta Corta Vento Feminino');
  });

  it('sem gênero cadastrado → sem público (nunca inventa)', () => {
    expect(titulo({ produto: 'Short', publico: 'Masculino' }, { genero: null as unknown as string })).toBe('Short');
  });

  it('Plus Size só com respaldo na fonte', () => {
    expect(titulo({ produto: 'Short', publico: 'Masculino Plus Size' })).toBe('Short Masculino');
    expect(titulo({ produto: 'Short', publico: 'Masculino Plus Size' }, { descricaoPai: 'Modelo plus size.' }))
      .toBe('Short Masculino Plus Size');
  });
});

describe('limpeza', () => {
  it('proibidos por palavra; "Top" sobrevive como peça', () => {
    expect(titulo({ produto: 'Short', publico: 'Masculino', caracteristica: 'Premium Esporte Fino', caracteristica2: 'Frete Grátis' }))
      .toBe('Short Masculino Esporte Fino');
    expect(titulo({ produto: 'Top Fitness', publico: 'Feminino', material: 'Linho Top' }, {
      nomePai: 'Top Fitness Feminino', genero: 'feminino',
    })).toBe('Top Fitness Feminino Linho');
  });

  it('característica e material precisam estar na fonte', () => {
    expect(titulo({ produto: 'Short', publico: 'Masculino', caracteristica: 'Dry Fit', material: 'Seda' }))
      .toBe('Short Masculino');
  });

  it('pontuação decorativa sai; toda palavra com maiúscula; UV em caixa alta', () => {
    expect(titulo({ produto: 'Short', publico: 'Masculino', caracteristica: 'com Cordão!!!' })).toBe('Short Masculino Com Cordão');
    expect(titulo({ produto: 'Conjunto Infantil Proteção Solar Uv' }, {
      nomePai: 'Conjunto Infantil Proteção Solar UV', descricaoPai: '', genero: 'meninas',
    })).toBe('Conjunto Infantil Proteção Solar UV');
  });

  it('palavra repetida entre slots sai do slot posterior', () => {
    expect(titulo({ produto: 'Short Linho', publico: 'Masculino', material: '100% Linho' })).toBe('Short Linho Masculino');
  });
});

describe('cor e kit', () => {
  it('cor única entra depois do material; várias cores não; tamanho nunca', () => {
    expect(titulo({ produto: 'Short', publico: 'Masculino', material: 'Linho' }, { cores: ['Preto'] }))
      .toBe('Short Masculino Linho Preto');
    expect(titulo({ produto: 'Short', publico: 'Masculino', variacao: 'GG' })).toBe('Short Masculino');
    expect(titulo({ produto: 'Short', publico: 'Masculino', variacao: 'GG' }, { cores: [] })).toBe('Short Masculino');
  });

  it('kit da fonte vira "Kit N" e fica', () => {
    expect(titulo({ produto: 'Cueca Boxer', publico: 'Masculina' }, {
      nomePai: 'Cueca Boxer Masculina', descricaoPai: 'Kit com 3 unidades.',
    })).toBe('Cueca Boxer Masculina Kit 3');
  });
});

describe('achados Codex r2', () => {
  it('cor única repetida numa característica: a característica perde a palavra, a cor fica', () => {
    expect(titulo({ produto: 'Short', publico: 'Masculino', caracteristica2: 'Preto Fosco' }, {
      cores: ['Preto'], descricaoPai: 'Short preto fosco.',
    })).toBe('Short Masculino Fosco Preto');
  });

  it('obrigatórios (com kit) acima de 60 → TituloInviavelError, nunca corta o kit', () => {
    const longo = 'Cueca Boxer Microfibra Sem Costura Cós Largo Respirável Antialérgica';
    expect(() => diagnosticarTitulo(slots({ produto: longo, publico: 'Masculina' }), {
      ...SHORT, nomePai: longo, descricaoPai: 'Kit com 3 unidades.',
    })).toThrow(/excede 60/);
  });
});

describe('não-grade inalterado', () => {
  it('slots novos zerados e fora do título', () => {
    const r = diagnosticarTitulo(slots({ produto: 'Linha', medida: '10000m', publico: 'Masculino', caracteristica: 'Forte' }), {
      nomePai: 'LINHA 10000M', descricaoPai: '', tipoProdutoBusca: '', cores: [], fornecedor: null,
    });
    expect(r.titulo).toBe('Linha 10000m');
  });
});

describe('schema com 13 slots', () => {
  it('required e coerção incluem publico/caracteristica/caracteristica2', () => {
    const s = SCHEMA_COPY.schema.properties.titulo_slots as { required: string[] };
    expect(s.required).toEqual(expect.arrayContaining(['publico', 'caracteristica', 'caracteristica2']));
    expect(coagirSlots({ publico: 'Masculino' } as never).caracteristica2).toBe('');
    expect(coagirSlots({ publico: 'Masculino' } as never).publico).toBe('Masculino');
  });
});
