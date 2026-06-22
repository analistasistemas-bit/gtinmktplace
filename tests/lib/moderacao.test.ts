import { describe, it, expect } from 'vitest';
import { traduzirMotivoModeracao } from '@/lib/moderacao';

describe('traduzirMotivoModeracao', () => {
  it('traduz códigos conhecidos', () => {
    expect(traduzirMotivoModeracao('forbidden')).toBe('Proibido pelo ML');
    expect(traduzirMotivoModeracao('waiting_for_patch')).toBe('Aguardando correção');
    expect(traduzirMotivoModeracao('poor_quality_thumbnail')).toBe('Foto reprovada');
  });
  it('junta múltiplos sub_status', () => {
    expect(traduzirMotivoModeracao('forbidden, waiting_for_patch')).toBe('Proibido pelo ML · Aguardando correção');
  });
  it('código desconhecido cai no cru; null vira null', () => {
    expect(traduzirMotivoModeracao('outro_codigo')).toBe('outro_codigo');
    expect(traduzirMotivoModeracao(null)).toBeNull();
  });
});
