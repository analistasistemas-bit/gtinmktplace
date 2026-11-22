import { describe, expect, it } from 'vitest';
import { extrairChave, gerarChave, hashChave, situacaoDaConexao, type LinhaConexao } from '../credencial.ts';

const FORMATO = /^pai_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;
const req = (auth?: string) => new Request('https://x.test', { headers: auth ? { Authorization: auth } : {} });

describe('gerarChave', () => {
  it('casa o formato; prefixo = 8 hex; hash = sha256 da chave; duas gerações diferem', async () => {
    const a = await gerarChave();
    const b = await gerarChave();
    expect(a.chave).toMatch(FORMATO);
    expect(a.prefixo).toBe(a.chave.slice(4, 12));
    expect(a.hash).toBe(await hashChave(a.chave));
    expect(a.chave).not.toBe(b.chave);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('hashChave', () => {
  it('SHA-256 em hex', async () => {
    expect(await hashChave('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('extrairChave', () => {
  it('devolve a chave de um Bearer válido', async () => {
    const { chave } = await gerarChave();
    expect(extrairChave(req(`Bearer ${chave}`))).toBe(chave);
  });

  it('null sem header, com JWT, com 1 caractere a menos ou sem Bearer', async () => {
    const { chave } = await gerarChave();
    expect(extrairChave(req())).toBeNull();
    expect(extrairChave(req('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln'))).toBeNull();
    expect(extrairChave(req(`Bearer ${chave.slice(0, -1)}`))).toBeNull();
    expect(extrairChave(req(chave))).toBeNull();
    expect(extrairChave(req(`Bearer ${chave}x`))).toBeNull();
  });
});

describe('situacaoDaConexao', () => {
  const agora = new Date('2026-11-22T12:00:00.000Z');
  const base: LinhaConexao = { id: 'c1', org_id: 'o1', expira_em: '2026-12-22T12:00:00.000Z', revogada_em: null };

  it('ok, revogada, expirada (expira exatamente agora = expirada)', () => {
    expect(situacaoDaConexao(base, agora)).toBe('ok');
    expect(situacaoDaConexao({ ...base, revogada_em: '2026-11-21T00:00:00Z' }, agora)).toBe('revogada');
    expect(situacaoDaConexao({ ...base, expira_em: agora.toISOString() }, agora)).toBe('expirada');
    expect(situacaoDaConexao({ ...base, expira_em: '2026-11-22T11:59:59.999Z' }, agora)).toBe('expirada');
  });

  it('fecha em dado inválido', () => {
    expect(situacaoDaConexao({ ...base, expira_em: 'lixo' }, agora)).toBe('expirada');
    expect(situacaoDaConexao(base, new Date('lixo'))).toBe('expirada');
    expect(situacaoDaConexao({ ...base, revogada_em: 'lixo' }, agora)).toBe('revogada');
    expect(situacaoDaConexao({ ...base, revogada_em: '' }, agora)).toBe('revogada');
  });
});
