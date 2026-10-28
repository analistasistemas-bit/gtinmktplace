import { describe, it, expect } from 'vitest';
import { validarArquivoAnexo, nomeDoAnexo } from '../posvenda';

describe('validarArquivoAnexo', () => {
  it('aceita png em revisão e pdf em mensagem', () => {
    expect(validarArquivoAnexo('image/png', 100, 'revisao')).toBeNull();
    expect(validarArquivoAnexo('application/pdf', 100, 'mensagem')).toBeNull();
  });
  it('recusa HEIC, PDF em revisão e > 5 MB', () => {
    expect(validarArquivoAnexo('image/heic', 100, 'mensagem')).not.toBeNull();
    expect(validarArquivoAnexo('application/pdf', 100, 'revisao')).not.toBeNull();
    expect(validarArquivoAnexo('image/jpeg', 6 * 1024 * 1024, 'mensagem')).not.toBeNull();
  });
  it('recusa arquivo vazio', () => {
    expect(validarArquivoAnexo('image/png', 0, 'revisao')).not.toBeNull();
  });
});

describe('nomeDoAnexo', () => {
  it('lê o campo certo por destino', () => {
    expect(nomeDoAnexo({ file_name: 'a.png' }, 'revisao')).toBe('a.png');
    expect(nomeDoAnexo({ filename: 'b.jpg' }, 'mensagem')).toBe('b.jpg');
  });
  it('sem nome → null', () => {
    expect(nomeDoAnexo({}, 'revisao')).toBeNull();
    expect(nomeDoAnexo(null, 'mensagem')).toBeNull();
    expect(nomeDoAnexo({ filename: 'b.jpg' }, 'revisao')).toBeNull();
  });
});
