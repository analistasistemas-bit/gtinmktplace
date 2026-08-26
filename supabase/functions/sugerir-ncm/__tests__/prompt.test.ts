import { describe, expect, it } from 'vitest';
import { extrairSugestaoNcm, montarPromptNcm } from '../prompt.ts';

describe('sugerir-ncm — parser defensivo (a IA sugere, nunca decide)', () => {
  it('NCM de 8 dígitos passa', () => {
    expect(extrairSugestaoNcm('{"ncm":"39269090","justificativa":"artigo de plástico"}'))
      .toEqual({ ncm: '39269090', justificativa: 'artigo de plástico' });
  });
  it('NCM fora do formato vira null (nunca um chute mascarado de certeza)', () => {
    expect(extrairSugestaoNcm('{"ncm":"3926.90","justificativa":"x"}').ncm).toBeNull();
    expect(extrairSugestaoNcm('nao é json').ncm).toBeNull();
  });
  it('prompt inclui nome, descrição e categoria', () => {
    const p = montarPromptNcm({ nome: 'Zíper 20cm', descricao: 'Zíper de nylon', categoria: 'Aviamentos' });
    expect(p).toContain('Zíper 20cm');
    expect(p).toContain('Aviamentos');
  });
});
