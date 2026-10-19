import { describe, expect, it } from 'vitest';
import { extrairSugestaoNcm, filtrarSugestaoNcm, montarPromptNcm, SEM_SUGESTAO } from '../prompt.ts';

describe('sugerir-ncm — parser defensivo (a IA sugere, nunca decide)', () => {
  it('NCM de 8 dígitos passa', () => {
    expect(extrairSugestaoNcm('{"ncm":"39269090","justificativa":"artigo de plástico"}'))
      .toEqual({ ncm: '39269090', justificativa: 'artigo de plástico' });
  });
  it('NCM fora do formato vira null (nunca um chute mascarado de certeza)', () => {
    expect(extrairSugestaoNcm('{"ncm":"3926.90","justificativa":"x"}').ncm).toBeNull();
    expect(extrairSugestaoNcm('nao é json').ncm).toBeNull();
  });
  it('NCM com pontuação (6109.10.00) é normalizado para 8 dígitos', () => {
    expect(extrairSugestaoNcm('{"ncm":"6109.10.00","justificativa":"camiseta"}').ncm).toBe('61091000');
    expect(extrairSugestaoNcm('{"ncm":"6109 10 00","justificativa":"x"}').ncm).toBe('61091000');
    expect(extrairSugestaoNcm('{"ncm":"6109-10-00","justificativa":"x"}').ncm).toBe('61091000');
  });
  it('só pontuação é removida — letras continuam reprovando', () => {
    expect(extrairSugestaoNcm('{"ncm":"NCM 61091000","justificativa":"x"}').ncm).toBeNull();
  });
  it('prompt inclui nome, descrição e categoria', () => {
    const p = montarPromptNcm({ nome: 'Zíper 20cm', descricao: 'Zíper de nylon', categoria: 'Aviamentos' });
    expect(p).toContain('Zíper 20cm');
    expect(p).toContain('Aviamentos');
  });
});

// ADR-0187 — a IA nunca propõe NCM fora da tabela oficial.
describe('filtrarSugestaoNcm', () => {
  const adminCom = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) }) as never;
  const sug = (ncm: string | null) => ({ ncm, justificativa: 'artigo' });
  it('NCM inexistente → ncm null + aviso de tabela oficial', async () => {
    expect(await filtrarSugestaoNcm(adminCom([]), sug('75937727'))).toEqual({
      ncm: null, justificativa: 'A IA sugeriu um NCM fora da tabela oficial — preencha manualmente.',
    });
  });
  it('NCM vencido → ncm null', async () => {
    const r = await filtrarSugestaoNcm(adminCom([{ codigo: '75937727', vigente: false }]), sug('75937727'));
    expect(r.ncm).toBeNull();
  });
  it('NCM vigente → mantém a sugestão', async () => {
    const s = sug('62034900');
    expect(await filtrarSugestaoNcm(adminCom([{ codigo: '62034900', vigente: true }]), s)).toEqual(s);
  });
  it('erro de leitura → SEM_SUGESTAO (nunca repassa sem conferir)', async () => {
    expect(await filtrarSugestaoNcm(adminCom(null, { message: 'x' }), sug('62034900'))).toEqual(SEM_SUGESTAO);
  });
  it('ncm null → intacto, sem rpc', async () => {
    const admin = { rpc: () => { throw new Error('não deveria chamar'); } } as never;
    expect(await filtrarSugestaoNcm(admin, sug(null))).toEqual(sug(null));
  });
});
