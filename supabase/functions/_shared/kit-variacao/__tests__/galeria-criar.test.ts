import { describe, it, expect, vi } from 'vitest';
import { comGaleria, erroDeFoto, prepararGaleria, tratarRecusaDeFoto } from '../galeria-criar.ts';

const F = (id: string, item = 'MLB1') => ({ id, item });

describe('comGaleria', () => {
  it('acrescenta os ids depois das fotos que o payload já tem, sem repetir', () => {
    const p = { title: 'x', pictures: [{ id: 'KIT' }, { id: 'P2' }] };
    expect(comGaleria(p, [F('P2'), F('C3'), F('P4')]).pictures).toEqual([{ id: 'KIT' }, { id: 'P2' }, { id: 'C3' }, { id: 'P4' }]);
  });
  it('não altera o payload original nem os outros campos', () => {
    const p = { title: 'x', price: 10, pictures: [{ id: 'KIT' }] };
    const r = comGaleria(p, [F('P2')]);
    expect(p.pictures).toEqual([{ id: 'KIT' }]);
    expect(r).toMatchObject({ title: 'x', price: 10 });
  });
  it('sem galeria devolve o mesmo payload', () => {
    const p = { pictures: [{ id: 'KIT' }] };
    expect(comGaleria(p, [])).toBe(p);
  });
  it('payload sem pictures vira só a galeria', () => {
    expect(comGaleria({ title: 'x' }, [F('P2')]).pictures).toEqual([{ id: 'P2' }]);
  });
});

describe('prepararGaleria (antes do POST)', () => {
  it('mantém só o que a revalidação confirmou e devolve o motivo do que saiu', async () => {
    const r = await prepararGaleria([F('P2'), F('C3')], async () => ({ fotos: [F('C3')], motivo: 'MLB1 está moderado' }));
    expect(r).toEqual({ fotos: [F('C3')], aviso: 'Galeria das peças reduzida: MLB1 está moderado.' });
  });
  it('sem galeria não revalida', async () => {
    const revalidar = vi.fn();
    expect(await prepararGaleria([], revalidar)).toEqual({ fotos: [], aviso: null });
    expect(revalidar).not.toHaveBeenCalled();
  });
  it('revalidação lançando nunca trava a criação: foto 1 só, com aviso', async () => {
    const r = await prepararGaleria([F('P2')], async () => { throw new Error('rede'); });
    expect(r.fotos).toEqual([]);
    expect(r.aviso).toMatch(/rede/);
  });
  it('tudo confirmado: sem aviso', async () => {
    expect(await prepararGaleria([F('P2')], async () => ({ fotos: [F('P2')], motivo: null }))).toEqual({ fotos: [F('P2')], aviso: null });
  });
});

describe('erroDeFoto', () => {
  const corpo = (...codes: string[]) => ({ cause: codes.map((c) => ({ code: c, message: 'x' })) });
  it('400 com causa de foto', () => {
    expect(erroDeFoto(400, corpo('item.pictures.max'))).toBe(true);
    expect(erroDeFoto(400, corpo('item.pictures.picture_not_found'))).toBe(true);
    expect(erroDeFoto(400, corpo('item.attributes.invalid', 'item.pictures.invalid'))).toBe(true);
  });
  it('outra causa, outro status ou corpo ilegível não é erro de foto', () => {
    expect(erroDeFoto(400, corpo('item.attributes.invalid'))).toBe(false);
    expect(erroDeFoto(500, corpo('item.pictures.max'))).toBe(false);
    expect(erroDeFoto(429, corpo('item.pictures.max'))).toBe(false);
    expect(erroDeFoto(400, null)).toBe(false);
    expect(erroDeFoto(400, { cause: 'x' })).toBe(false);
  });
});

describe('tratarRecusaDeFoto (4xx do CREATE com galeria)', () => {
  const portas = () => ({ zerar: vi.fn(async () => {}), avisar: vi.fn(async () => {}) });
  const corpoFoto = { cause: [{ code: 'item.pictures.picture_not_found', message: 'x' }] };

  it('galeria usada + erro de foto: zera a lista, avisa uma vez e sinaliza para relançar o 4xx', async () => {
    const p = portas();
    expect(await tratarRecusaDeFoto({ status: 400, corpo: corpoFoto, galeriaUsada: true }, p)).toBe(true);
    expect(p.zerar).toHaveBeenCalledTimes(1);
    expect(p.avisar).toHaveBeenCalledTimes(1);
  });
  it('sem galeria no payload não mexe em nada', async () => {
    const p = portas();
    expect(await tratarRecusaDeFoto({ status: 400, corpo: corpoFoto, galeriaUsada: false }, p)).toBe(false);
    expect(p.zerar).not.toHaveBeenCalled();
  });
  it('erro que não é de foto não zera a galeria', async () => {
    const p = portas();
    expect(await tratarRecusaDeFoto({ status: 400, corpo: { cause: [{ code: 'item.attributes.invalid' }] }, galeriaUsada: true }, p)).toBe(false);
    expect(p.zerar).not.toHaveBeenCalled();
  });
  it('falha ao zerar ou avisar não esconde o 4xx original', async () => {
    const p = { zerar: vi.fn(async () => { throw new Error('db'); }), avisar: vi.fn(async () => { throw new Error('tg'); }) };
    await expect(tratarRecusaDeFoto({ status: 400, corpo: corpoFoto, galeriaUsada: true }, p)).resolves.toBe(true);
  });
});
