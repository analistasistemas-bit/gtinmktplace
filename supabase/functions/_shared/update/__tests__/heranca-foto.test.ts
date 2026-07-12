import { describe, it, expect } from 'vitest';
import { herdarPictureId } from '../heranca-foto';

describe('herdarPictureId (re-ingest UPDATE — plano 031)', () => {
  it('capa/imagem nova neste re-ingest → zera o id herdado (força re-upload da foto atual)', () => {
    expect(herdarPictureId('user/lote-novo/CAPA_00123.jpg', 'PIC_ANTIGO')).toBe(null);
  });

  it('sem foto nova (reposição só com planilha) → preserva a publicada herdando o id', () => {
    expect(herdarPictureId(null, 'PIC_ANTIGO')).toBe('PIC_ANTIGO');
  });

  it('sem foto nova e sem id anterior → null', () => {
    expect(herdarPictureId(null, null)).toBe(null);
  });
});
