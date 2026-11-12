import { describe, it, expect } from 'vitest';
import { montarGaleriaKit, pecaDaCor, type CorFotos } from '../galeria-pecas.ts';

describe('pecaDaCor', () => {
  const vs = [{ codigo: '00000143', cor: 'Preto' }, { codigo: '00000141', cor: 'Preto' }, { codigo: '00000147', cor: 'Caqui' }];
  const vinc = [
    { sku: '00000143', item_externo_id: 'MLB-G' }, { sku: '00000141', item_externo_id: 'MLB-P' }, { sku: '00000147', item_externo_id: 'MLB-C' },
  ];
  it('escolhe o menor código da cor que tenha item no ML (só depende da base, não do tamanho pedido)', () => {
    expect(pecaDaCor(vs, vinc, 'Preto')).toBe('MLB-P');
    expect(pecaDaCor(vs, vinc, 'Caqui')).toBe('MLB-C');
  });
  it('pula SKU sem item e devolve null se nenhum tem', () => {
    expect(pecaDaCor(vs, [{ sku: '00000143', item_externo_id: 'MLB-G' }, { sku: '00000141', item_externo_id: null }], 'Preto')).toBe('MLB-G');
    expect(pecaDaCor(vs, [], 'Preto')).toBeNull();
    expect(pecaDaCor(vs, vinc, 'Azul')).toBeNull();
  });
});

// Peça com n fotos: `<cor><i>` do item `MLB-<cor>`; a posição 0 é a capa da peça.
const peca = (cor: string, n: number): CorFotos => ({
  cor, fotos: Array.from({ length: n }, (_, i) => ({ id: `${cor}${i + 1}`, item: `MLB-${cor}` })),
});
const ids = (g: Array<{ id: string }>) => g.map((f) => f.id);

describe('montarGaleriaKit', () => {
  it('2 cores: foto 2 = imagem 2 da 1ª cor, foto 3 = imagem 3 da 2ª, foto 4 = imagem 4 da 1ª…', () => {
    const g = montarGaleriaKit({ cores: [peca('P', 9), peca('C', 9)], limite: 12 });
    expect(ids(g)).toEqual(['P2', 'C3', 'P4', 'C5', 'P6', 'C7', 'P8', 'C9']);
  });

  it('3 cores: a vez roda P, C, A e a imagem avança uma a cada foto', () => {
    const g = montarGaleriaKit({ cores: [peca('P', 9), peca('C', 9), peca('A', 9)], limite: 12 });
    expect(ids(g)).toEqual(['P2', 'C3', 'A4', 'P5', 'C6', 'A7', 'P8', 'C9']);
  });

  it('nunca inclui a imagem 1 (capa) da peça', () => {
    const g = montarGaleriaKit({ cores: [peca('P', 4), peca('C', 4)], limite: 12 });
    expect(ids(g)).not.toContain('P1');
    expect(ids(g)).not.toContain('C1');
  });

  it('peça com menos fotos pula a vez dela sem quebrar a intercalação', () => {
    // C só tem 3 fotos: no slot 3 (C, imagem 5) não há foto e o slot é pulado; P segue na sua vez.
    const g = montarGaleriaKit({ cores: [peca('P', 9), peca('C', 3)], limite: 12 });
    expect(ids(g)).toEqual(['P2', 'C3', 'P4', 'P6', 'P8']);
  });

  it('para quando todas as cores esgotam as fotos', () => {
    const g = montarGaleriaKit({ cores: [peca('P', 2), peca('C', 2)], limite: 12 });
    expect(ids(g)).toEqual(['P2']);
  });

  it('respeita o limite do anúncio contando a foto do kit (limite - 1 fotos de peças)', () => {
    const g = montarGaleriaKit({ cores: [peca('P', 9), peca('C', 9)], limite: 5 });
    expect(ids(g)).toEqual(['P2', 'C3', 'P4', 'C5']);
  });

  it('limite menor que 2 não deixa espaço para galeria', () => {
    expect(montarGaleriaKit({ cores: [peca('P', 9)], limite: 1 })).toEqual([]);
    expect(montarGaleriaKit({ cores: [peca('P', 9)], limite: 0 })).toEqual([]);
    expect(montarGaleriaKit({ cores: [peca('P', 9)], limite: Number.NaN })).toEqual([]);
  });

  it('sem foto repetida: id já usado (capa comum em duas cores) ou igual à foto do kit sai', () => {
    const comum = { id: 'COMUM', item: 'MLB-x' };
    const p: CorFotos = { cor: 'P', fotos: [{ id: 'P1', item: 'MLB-P' }, { id: 'COMUM', item: 'MLB-P' }, { id: 'P3', item: 'MLB-P' }] };
    const c: CorFotos = { cor: 'C', fotos: [{ id: 'C1', item: 'MLB-C' }, { id: 'C2', item: 'MLB-C' }, comum, { id: 'KIT', item: 'MLB-C' }] };
    const g = montarGaleriaKit({ fotoKit: 'KIT', cores: [p, c], limite: 12 });
    // slot0 P2=COMUM; slot1 C3=COMUM (repetida, pula); slot2 P4 não existe; slot3 C5 não existe… KIT nunca entra
    expect(ids(g)).toEqual(['COMUM']);
    expect(ids(g)).not.toContain('KIT');
  });

  it('guarda o item de origem de cada foto', () => {
    const g = montarGaleriaKit({ cores: [peca('P', 3), peca('C', 3)], limite: 12 });
    expect(g).toEqual([{ id: 'P2', item: 'MLB-P' }, { id: 'C3', item: 'MLB-C' }]);
  });

  it('é determinística e não altera a entrada', () => {
    const cores = [peca('P', 6), peca('C', 6)];
    const copia = JSON.parse(JSON.stringify(cores));
    expect(montarGaleriaKit({ cores, limite: 12 })).toEqual(montarGaleriaKit({ cores, limite: 12 }));
    expect(cores).toEqual(copia);
  });

  it('sem cores ou cor sem fotos devolve vazio', () => {
    expect(montarGaleriaKit({ cores: [], limite: 12 })).toEqual([]);
    expect(montarGaleriaKit({ cores: [{ cor: 'P', fotos: [] }], limite: 12 })).toEqual([]);
  });
});
