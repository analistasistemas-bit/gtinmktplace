import { describe, expect, it, vi } from 'vitest';
import { chaveValida, dispensarSugestao, lerSugestao, reativarSugestao } from '../sugestao.ts';

describe('lerSugestao', () => {
  const ok = { faixa: 'quase_vendendo', oportunidade: 12.5, chave: 'p:00000150' };
  it('válido passa; ausente é null', () => {
    expect(lerSugestao(ok)).toEqual({ ok: true, valor: ok });
    expect(lerSugestao(undefined)).toEqual({ ok: true, valor: null });
    expect(lerSugestao(null)).toEqual({ ok: true, valor: null });
  });
  it.each([
    ['faixa desconhecida', { ...ok, faixa: 'outra' }],
    ['oportunidade não numérica', { ...ok, oportunidade: '12' }],
    ['oportunidade infinita', { ...ok, oportunidade: Infinity }],
    ['oportunidade negativa', { ...ok, oportunidade: -1 }],
    ['chave fora do padrão', { ...ok, chave: 'x:1' }],
    ['não é objeto', 'quase_vendendo'],
  ])('%s falha', (_n, v) => {
    expect(lerSugestao(v).ok).toBe(false);
  });
  it('não leva campo extra para o banco', () => {
    expect(lerSugestao({ ...ok, extra: 'x' })).toEqual({ ok: true, valor: ok });
  });
});

describe('chaveValida', () => {
  it('aceita produto e anúncio; recusa o resto', () => {
    expect(chaveValida('p:00000150')).toBe(true);
    expect(chaveValida('a:MLB123')).toBe(true);
    expect(chaveValida('p:')).toBe(false);
    expect(chaveValida(`p:${'9'.repeat(81)}`)).toBe(false);
    expect(chaveValida(12)).toBe(false);
  });
});

describe('dispensa', () => {
  const agora = Date.parse('2026-11-04T12:00:00Z');
  it('dispensar grava org, autor e 30 dias', async () => {
    const gravar = vi.fn().mockResolvedValue(undefined);
    await dispensarSugestao({ gravar, remover: vi.fn(), agora: () => agora }, 'ORG', 'USER', 'p:1');
    expect(gravar).toHaveBeenCalledWith({
      org_id: 'ORG', chave: 'p:1', dispensado_por: 'USER',
      dispensado_em: '2026-11-04T12:00:00.000Z', expira_em: '2026-12-04T12:00:00.000Z',
    });
  });
  it('reativar remove só a chave da própria org', async () => {
    const remover = vi.fn().mockResolvedValue(undefined);
    await reativarSugestao({ gravar: vi.fn(), remover, agora: () => agora }, 'ORG', 'p:1');
    expect(remover).toHaveBeenCalledWith('ORG', 'p:1');
  });
});
