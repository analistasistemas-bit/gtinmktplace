import { describe, it, expect } from 'vitest';
import { capaMlDoBulk, ehUrlFotoMl } from '../capa-ml.ts';

const FOTO = 'https://http2.mlstatic.com/D_672106-MLB114489001149_072026-O.jpg';
const item = (id: string, extra: Record<string, unknown> = {}) =>
  ({ code: 200, body: { id, status: 'active', sub_status: [], pictures: [{ secure_url: FOTO }], ...extra } });

describe('capaMlDoBulk', () => {
  it('base ativa: devolve a foto 1 do anúncio da base', () => {
    expect(capaMlDoBulk('MLB1', ['MLB1', 'MLB2'], [item('MLB1'), item('MLB2', { pictures: [] })])).toBe(FOTO);
  });

  it('base ou cópia moderada: null (nunca gera de foto de item moderado)', () => {
    expect(capaMlDoBulk('MLB1', ['MLB1'], [item('MLB1', { status: 'under_review' })])).toBeNull();
    expect(capaMlDoBulk('MLB1', ['MLB1', 'MLB2'], [item('MLB1'), item('MLB2', { status: 'under_review' })])).toBeNull();
  });

  it('sem foto ou URL fora do CDN do ML: null', () => {
    expect(capaMlDoBulk('MLB1', ['MLB1'], [item('MLB1', { pictures: [] })])).toBeNull();
    expect(capaMlDoBulk('MLB1', ['MLB1'], [item('MLB1', { pictures: [{ secure_url: 'https://evil.com/D_1-O.jpg' }] })])).toBeNull();
  });

  it('item não lido no bulk: lança (quem chama recusa)', () => {
    expect(() => capaMlDoBulk('MLB1', ['MLB1', 'MLB2'], [item('MLB1')])).toThrow();
  });
});

describe('ehUrlFotoMl', () => {
  it('só https no http2.mlstatic.com com nome D_*', () => {
    expect(ehUrlFotoMl(FOTO)).toBe(true);
    expect(ehUrlFotoMl('http://http2.mlstatic.com/D_1-O.jpg')).toBe(false);
    expect(ehUrlFotoMl('https://http2.mlstatic.com.evil.com/D_1-O.jpg')).toBe(false);
    expect(ehUrlFotoMl('https://http2.mlstatic.com/../x/D_1-O.jpg')).toBe(false);
  });
});
