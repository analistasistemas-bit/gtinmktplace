import { describe, it, expect } from 'vitest';
import { sanitizarDescricaoML } from '../criar-item';

describe('sanitizarDescricaoML', () => {
  it('remove emoji decorativo e o espaço órfão no início da linha', () => {
    expect(sanitizarDescricaoML('🧵 QUALIDADE PROFISSIONAL')).toBe('QUALIDADE PROFISSIONAL');
  });
  it('checkmark vira hífen de lista', () => {
    expect(sanitizarDescricaoML('✔ Alta resistência')).toBe('- Alta resistência');
  });
  it('mantém bullet • e acentos (aceitos pelo ML)', () => {
    expect(sanitizarDescricaoML('• Composição: 100% poliéster')).toBe('• Composição: 100% poliéster');
  });
  it('colapsa 3+ quebras de linha em parágrafo único', () => {
    expect(sanitizarDescricaoML('a\n\n\n\nb')).toBe('a\n\nb');
  });
  it('texto sem emoji passa intacto', () => {
    expect(sanitizarDescricaoML('Fita 10 metros, 15 mm.')).toBe('Fita 10 metros, 15 mm.');
  });
});
