import { describe, it, expect } from 'vitest';
import { galeriaDasPecas, lerLimiteFotos, revalidarGaleria } from '../galeria-leitura.ts';

type Item = { id: string; status: string; sub_status?: string[]; pictures?: Array<{ id: string; secure_url?: string }> };
const item = (id: string, fotos: string[], status = 'active', sub: string[] = []): Item => ({
  id, status, sub_status: sub, pictures: fotos.map((p) => ({ id: p })),
});
/** `/items/bulk`: devolve os itens pedidos (404 sem body para o que não existe), registra as chamadas. */
function fakeBulk(itens: Item[], opts: { http?: number } = {}) {
  const chamadas: string[] = [];
  const f = (async (url: string) => {
    chamadas.push(String(url));
    if (opts.http) return new Response('erro', { status: opts.http });
    const ids = decodeURIComponent(new URL(String(url)).searchParams.get('ids') ?? '').split(',');
    return Response.json(ids.map((id) => {
      const i = itens.find((x) => x.id === id);
      return i ? { status_code: 200, body: i } : { status_code: 404 };
    }));
  }) as unknown as typeof fetch;
  return { f, chamadas };
}
const nove = (c: string) => Array.from({ length: 9 }, (_, i) => `${c}${i + 1}`);

describe('galeriaDasPecas', () => {
  it('monta a galeria intercalada com o item de origem e lê cada item uma vez', async () => {
    const { f, chamadas } = fakeBulk([item('MLB-P', nove('P')), item('MLB-C', nove('C'))]);
    const r = await galeriaDasPecas('tok', [{ cor: 'Preto', itemId: 'MLB-P' }, { cor: 'Caqui', itemId: 'MLB-C' }], 12, f);
    expect(r.fotos.map((x) => x.id)).toEqual(['P2', 'C3', 'P4', 'C5', 'P6', 'C7', 'P8', 'C9']);
    expect(r.fotos[0]).toEqual({ id: 'P2', item: 'MLB-P' });
    expect(r.avisos).toEqual([]);
    expect(chamadas).toHaveLength(1);
  });

  it('devolve a secure_url de cada foto escolhida (miniatura da prévia), sem pôr url na foto que será gravada', async () => {
    const comUrl = (id: string, fotos: string[]): Item => ({
      id, status: 'active', sub_status: [], pictures: fotos.map((p) => ({ id: p, secure_url: `https://x/${p}.jpg` })),
    } as Item);
    const { f } = fakeBulk([comUrl('MLB-P', nove('P')), comUrl('MLB-C', nove('C'))]);
    const r = await galeriaDasPecas('tok', [{ cor: 'Preto', itemId: 'MLB-P' }, { cor: 'Caqui', itemId: 'MLB-C' }], 12, f);
    expect(r.urls).toMatchObject({ P2: 'https://x/P2.jpg', C3: 'https://x/C3.jpg' });
    expect(Object.keys(r.urls)).toEqual(r.fotos.map((x) => x.id));
    expect(r.fotos[0]).toEqual({ id: 'P2', item: 'MLB-P' });
  });

  it('item moderado tira a cor da galeria (com aviso) e não quebra a outra', async () => {
    const { f } = fakeBulk([item('MLB-P', nove('P'), 'under_review'), item('MLB-C', nove('C'))]);
    const r = await galeriaDasPecas('tok', [{ cor: 'Preto', itemId: 'MLB-P' }, { cor: 'Caqui', itemId: 'MLB-C' }], 12, f);
    expect(r.fotos.every((x) => x.item === 'MLB-C')).toBe(true);
    expect(r.avisos.join(' ')).toMatch(/Preto/);
  });

  it('sub_status de moderação (forbidden, waiting_for_patch) também tira a cor', async () => {
    const { f } = fakeBulk([item('MLB-P', nove('P'), 'paused', ['waiting_for_patch']), item('MLB-C', nove('C'), 'active', ['forbidden'])]);
    const r = await galeriaDasPecas('tok', [{ cor: 'Preto', itemId: 'MLB-P' }, { cor: 'Caqui', itemId: 'MLB-C' }], 12, f);
    expect(r.fotos).toEqual([]);
    expect(r.avisos).toHaveLength(2);
  });

  it('item fechado ou não lido (404) tira a cor: nunca presume limpo', async () => {
    const { f } = fakeBulk([item('MLB-P', nove('P'), 'closed')]);
    const r = await galeriaDasPecas('tok', [{ cor: 'Preto', itemId: 'MLB-P' }, { cor: 'Caqui', itemId: 'MLB-C' }], 12, f);
    expect(r.fotos).toEqual([]);
    expect(r.avisos).toHaveLength(2);
  });

  it('leitura do ML falhou (HTTP 500) recusa a galeria inteira com aviso, sem lançar', async () => {
    const { f } = fakeBulk([], { http: 500 });
    const r = await galeriaDasPecas('tok', [{ cor: 'Preto', itemId: 'MLB-P' }, { cor: 'Caqui', itemId: 'MLB-C' }], 12, f);
    expect(r.fotos).toEqual([]);
    expect(r.indisponivel).toBe(true);
  });

  it('a mesma peça em duas cores do pedido não duplica id no lote (id repetido = 400 no ML)', async () => {
    const { f, chamadas } = fakeBulk([item('MLB-P', nove('P'))]);
    await galeriaDasPecas('tok', [{ cor: 'A', itemId: 'MLB-P' }, { cor: 'B', itemId: 'MLB-P' }], 12, f);
    const ids = decodeURIComponent(new URL(chamadas[0]).searchParams.get('ids')!).split(',');
    expect(ids).toEqual(['MLB-P']);
  });

  it('mais de 20 itens: lotes de no máximo 20', async () => {
    const itens = Array.from({ length: 25 }, (_, i) => item(`MLB${i}`, nove(`X${i}_`)));
    const { f, chamadas } = fakeBulk(itens);
    await galeriaDasPecas('tok', itens.map((i, k) => ({ cor: `c${k}`, itemId: i.id })), 12, f);
    expect(chamadas).toHaveLength(2);
  });
});

describe('revalidarGaleria (worker, antes do CREATE)', () => {
  const fotos = [{ id: 'P2', item: 'MLB-P' }, { id: 'C3', item: 'MLB-C' }];

  it('mantém só o id ainda presente em pictures de item limpo', async () => {
    const { f } = fakeBulk([item('MLB-P', ['P1']), item('MLB-C', ['C1', 'C3'])]);
    const r = await revalidarGaleria('tok', fotos, f);
    expect(r.fotos).toEqual([{ id: 'C3', item: 'MLB-C' }]);
  });

  it('item moderado entre o cadastro e o CREATE: a foto dele sai', async () => {
    const { f } = fakeBulk([item('MLB-P', ['P2'], 'under_review'), item('MLB-C', ['C3'])]);
    const r = await revalidarGaleria('tok', fotos, f);
    expect(r.fotos).toEqual([{ id: 'C3', item: 'MLB-C' }]);
    expect(r.motivo).toMatch(/MLB-P/);
  });

  it('leitura falhou: nenhuma foto e motivo (CREATE sai só com a foto do kit)', async () => {
    const { f } = fakeBulk([], { http: 503 });
    const r = await revalidarGaleria('tok', fotos, f);
    expect(r.fotos).toEqual([]);
    expect(r.motivo).toBeTruthy();
  });

  it('lista vazia não chama o ML', async () => {
    const { f, chamadas } = fakeBulk([]);
    expect(await revalidarGaleria('tok', [], f)).toEqual({ fotos: [], motivo: null });
    expect(chamadas).toHaveLength(0);
  });
});

describe('lerLimiteFotos', () => {
  const resp = (corpo: unknown, status = 200) => (async () => Response.json(corpo, { status })) as unknown as typeof fetch;
  it('lê max_pictures_per_item da categoria', async () => {
    expect(await lerLimiteFotos('MLB188064', resp({ settings: { max_pictures_per_item: 12 } }))).toBe(12);
  });
  it('ilegível devolve null (nunca presume 12)', async () => {
    expect(await lerLimiteFotos('MLB1', resp({ settings: {} }))).toBeNull();
    expect(await lerLimiteFotos('MLB1', resp({}, 500))).toBeNull();
    expect(await lerLimiteFotos('MLB1', (async () => { throw new Error('rede'); }) as unknown as typeof fetch)).toBeNull();
  });
});
