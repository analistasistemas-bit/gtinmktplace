import { describe, it, expect } from 'vitest';
import { acumularImagens, filtrarImagens } from '@/lib/acumular-imagens';

function arquivo(nome: string): File {
  return new File(['x'], nome, { type: 'image/jpeg' });
}

describe('filtrarImagens', () => {
  it('mantém só jpg/jpeg/png e descarta o lixo da pasta', () => {
    const files = [
      arquivo('00000001.jpeg'),
      arquivo('00000002.JPG'),
      arquivo('00000003.png'),
      arquivo('.DS_Store'),
      arquivo('planilha.xlsx'),
    ];
    expect(filtrarImagens(files).map((f) => f.name)).toEqual([
      '00000001.jpeg',
      '00000002.JPG',
      '00000003.png',
    ]);
  });
});

describe('acumularImagens', () => {
  it('acumula as fotos de pastas diferentes em vez de substituir', () => {
    const pastaA = [arquivo('00000001.jpeg'), arquivo('00000002.jpeg')];
    const pastaB = [arquivo('00000003.jpeg'), arquivo('00000004.jpeg')];

    const r = acumularImagens(pastaA, pastaB);

    expect(r.map((f) => f.name)).toEqual([
      '00000001.jpeg',
      '00000002.jpeg',
      '00000003.jpeg',
      '00000004.jpeg',
    ]);
  });

  it('deduplica por nome: o novo drop substitui o arquivo de mesmo nome', () => {
    const antigo = arquivo('00000001.jpeg');
    const novo = arquivo('00000001.jpeg');
    const atuais = [antigo, arquivo('00000002.jpeg')];

    const r = acumularImagens(atuais, [novo]);

    expect(r).toHaveLength(2);
    expect(r.find((f) => f.name === '00000001.jpeg')).toBe(novo);
  });

  it('parte de um conjunto vazio', () => {
    const r = acumularImagens([], [arquivo('00000001.jpeg')]);
    expect(r.map((f) => f.name)).toEqual(['00000001.jpeg']);
  });
});
