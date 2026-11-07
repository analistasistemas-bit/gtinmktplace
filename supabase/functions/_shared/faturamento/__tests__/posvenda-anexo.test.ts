import { describe, it, expect } from 'vitest';
import { validarArquivoAnexo, nomeDoAnexo, anexoDaConversa, motivoDownloadBloqueado } from '../posvenda';

describe('anexo por pack (mensagem_pack)', () => {
  const msg = 'Formato não aceito: use JPG, PNG ou PDF.';
  it('nomeDoAnexo lê id no upload de pack', () => {
    expect(nomeDoAnexo({ id: 'x.png' }, 'mensagem_pack')).toBe('x.png');
    expect(nomeDoAnexo({ filename: 'y' }, 'mensagem')).toBe('y');
    expect(nomeDoAnexo({ filename: 'y' }, 'mensagem_pack')).toBeNull();
  });
  it('validarArquivoAnexo: HEIC e tipo vazio recusados', () => {
    expect(validarArquivoAnexo('image/heic', 10, 'mensagem_pack')).toBe(msg);
    expect(validarArquivoAnexo('', 10, 'mensagem_pack')).toBe(msg);
    expect(validarArquivoAnexo('application/pdf', 10, 'mensagem_pack')).toBeNull();
  });
});

describe('anexoDaConversa', () => {
  it('acha o anexo pelo filename', () => {
    const a = anexoDaConversa([{ message_attachments: [{ filename: 'a', original_filename: 'o.png', type: 'image/png', size: 3 }] }], 'a');
    expect(a).toEqual({ filename: 'a', original_filename: 'o.png', type: 'image/png', size: 3, potential_security_threat: false });
  });
  it('null para outro nome, attachments null e raw nulo', () => {
    expect(anexoDaConversa([{ message_attachments: [{ filename: 'a' }] }], 'b')).toBeNull();
    expect(anexoDaConversa([{ message_attachments: null }], 'a')).toBeNull();
    expect(anexoDaConversa([null], 'a')).toBeNull();
  });
});

describe('motivoDownloadBloqueado', () => {
  const base = { filename: 'a', original_filename: null, size: 1, potential_security_threat: false };
  it('barra ameaça, svg e tipo ausente', () => {
    expect(motivoDownloadBloqueado({ ...base, type: 'image/png', potential_security_threat: true })).not.toBeNull();
    expect(motivoDownloadBloqueado({ ...base, type: 'image/svg+xml' })).not.toBeNull();
    expect(motivoDownloadBloqueado({ ...base, type: null })).not.toBeNull();
  });
  it('libera jpeg, png e pdf', () => {
    for (const type of ['image/jpeg', 'image/png', 'application/pdf']) {
      expect(motivoDownloadBloqueado({ ...base, type })).toBeNull();
    }
  });
});

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
