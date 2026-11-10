import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { comporImagemFinal, motivosDeTexto, type TextosComposicao } from '../compor';

// Task 12: composição no navegador com canvas mockado (o jsdom não tem canvas). A prova visual real é o Step 5.
interface Carga { src: string; crossOrigin: string | null }
let cargas: Carga[];
let dims: Record<string, [number, number]>;
let ctx: Record<string, ReturnType<typeof vi.fn>> & { font: string };
let pesoPorQualidade: (q: number) => number;
let qualidades: number[];
let fontes: string[];
let fonteOk: boolean;

class FakeImage {
  crossOrigin: string | null = null;
  naturalWidth = 0; naturalHeight = 0; width = 0; height = 0;
  onload: (() => void) | null = null; onerror: ((e: unknown) => void) | null = null;
  set src(v: string) {
    cargas.push({ src: v, crossOrigin: this.crossOrigin });
    const d = dims[v] ?? [864, 1152];
    this.naturalWidth = this.width = d[0]; this.naturalHeight = this.height = d[1];
    setTimeout(() => this.onload?.(), 0);
  }
}

beforeEach(() => {
  cargas = []; qualidades = []; fontes = []; fonteOk = true;
  dims = { cena: [864, 1152], ref: [500, 500], quadrada: [1024, 1024] };
  pesoPorQualidade = () => 400_000;
  const fn = () => vi.fn();
  ctx = {
    font: '10px x',
    fillRect: fn(), fillText: fn(), drawImage: fn(), save: fn(), restore: fn(), beginPath: fn(), arc: fn(),
    clip: fn(), stroke: fn(), fill: fn(), roundRect: fn(), rect: fn(),
    // Largura simulada: 0,55 em por caractere (Inter real fica em ~0,52–0,58).
    measureText: vi.fn((t: string) => ({ width: t.length * Number(/(\d+)px/.exec(ctx.font)![1]) * 0.55 })),
  } as never;
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string, q?: number) {
    qualidades.push(q!);
    setTimeout(() => cb(new Blob([new Uint8Array(pesoPorQualidade(q!))], { type })), 0);
  };
  Object.defineProperty(document, 'fonts', {
    configurable: true, value: { load: vi.fn(async (f: string) => { fontes.push(f); return []; }), check: vi.fn(() => fonteOk) },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const T: TextosComposicao = {
  headline: 'Prende firme', subheadline: 'Sem costura e sem cola', beneficios: ['Lava na máquina', 'Não desfia'],
  specs: [{ rotulo: 'Largura', valor: '25 mm' }], etapas: ['Corte o tamanho', 'Cole na borda'], legendas: ['Trama fechada', 'Borda firme'],
};
const compor = (missao: number, extra: Partial<Parameters<typeof comporImagemFinal>[0]> = {}) =>
  comporImagemFinal({ cenaUrl: 'cena', refUrl: 'ref', missao, textos: T, corProduto: null, moda: false, ...extra });
const textosDesenhados = () => ctx.fillText.mock.calls.map((c) => c[0] as string);

describe('comporImagemFinal', () => {
  it('missão 2: canvas 1200×1540, cena com crossOrigin anonymous, fonte Inter carregada, texto do roteiro, JPEG', async () => {
    const b = await compor(2);
    expect(b.type).toBe('image/jpeg');
    expect(cargas).toEqual([{ src: 'cena', crossOrigin: 'anonymous' }]);
    expect(fontes).toContain('600 60px Inter');
    expect(textosDesenhados()).toEqual(expect.arrayContaining(['Prende firme', 'Sem costura e sem cola']));
    // Corte ao centro, nunca esticar: origem 864×1102 (perda ≈4%) escalada para 1200×1540.
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = ctx.drawImage.mock.calls[0];
    expect([dx, dy, dw, dh]).toEqual([0, 0, 1200, 1540]);
    expect(sw / sh).toBeCloseTo(1200 / 1540, 2);
    expect(sx).toBe(0); expect(sy).toBeGreaterThan(0);
  });

  it('Inter não carregou (woff2 falhou): recusa com motivo, sem desenhar texto', async () => {
    fonteOk = false;
    await expect(compor(2)).rejects.toThrow(/fonte Inter/);
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(qualidades).toEqual([]);
    // Capa não precisa de fonte.
    await expect(compor(1)).resolves.toBeInstanceOf(Blob);
  });

  it('missão 1 (capa) e Moda: nenhum fillText', async () => {
    await compor(1);
    expect(ctx.fillText).not.toHaveBeenCalled();
    await compor(2, { moda: true });
    await compor(4, { moda: true });
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('capa quadrada: preenchimento branco, sem corte e sem esticar', async () => {
    await compor(1, { cenaUrl: 'quadrada' });
    const [, dx, dy, dw, dh] = ctx.drawImage.mock.calls[0];
    expect([dx, dw, dh]).toEqual([0, 1200, 1200]);
    expect(dy).toBe(170);
  });

  it('cena quadrada fora da capa: corte acima de 15% bloqueia', async () => {
    await expect(compor(2, { cenaUrl: 'quadrada' })).rejects.toThrow(/15%/);
  });

  it('missão 7 não carrega cenaUrl: duas lupas da referência e as legendas', async () => {
    await compor(7);
    expect(cargas.map((c) => c.src)).toEqual(['ref']);
    expect(cargas[0].crossOrigin).toBe('anonymous');
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    expect(textosDesenhados()).toEqual(expect.arrayContaining(['Prende firme', 'Trama fechada', 'Borda firme']));
  });

  it('Moda 5 e 7 (recortes) não carregam cenaUrl nem desenham texto', async () => {
    await compor(5, { moda: true });
    await compor(7, { moda: true });
    expect(cargas.map((c) => c.src)).toEqual(['ref', 'ref']);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('missão 3: lupa recortada da referência (além da cena)', async () => {
    await compor(3);
    expect(cargas.map((c) => c.src)).toEqual(['cena', 'ref']);
    expect(ctx.arc).toHaveBeenCalled();
  });

  it('laço de qualidade 0,92 → 0,70 até ≤1 MB', async () => {
    pesoPorQualidade = (q) => (q > 0.8 ? 1_200_000 : 900_000);
    const b = await compor(2);
    expect(qualidades[0]).toBe(0.92);
    expect(qualidades.at(-1)).toBeLessThanOrEqual(0.8);
    expect(b.size).toBe(900_000);
  });

  it('acima de 1 MB mesmo a 0,70 → recusa', async () => {
    pesoPorQualidade = () => 1_100_000;
    await expect(compor(2)).rejects.toThrow(/1 MB/);
    expect(Math.min(...qualidades)).toBeCloseTo(0.7, 5);
  });

  it('acento: cor do produto só onde passa 4,5:1 sobre a placa; senão texto escuro', async () => {
    await compor(6, { corProduto: '#139aa0' });
    await compor(6, { corProduto: '#1f2a52' });
    const cores = new Set<string>();
    ctx.fillText.mockImplementation(() => cores.add((ctx as unknown as { fillStyle: string }).fillStyle));
    await compor(6, { corProduto: '#139aa0' });
    expect(cores.has('#139aa0')).toBe(false);
    cores.clear();
    await compor(6, { corProduto: '#1f2a52' });
    expect(cores.has('#1f2a52')).toBe(true);
  });
});

describe('estouro de texto (adendo T11): recusa com motivo, nunca corta', () => {
  const ETAPA_LONGA = 'Desenrole cuidadosamente instruções complicadíssimas antes aquecimento extraordinário';
  const HEADLINE_LONGA = 'Aplicação extraordinária instantânea profissionalíssima garantida';

  it('etapa de 7 palavras longas (>52 caracteres) → motivo e composição recusada sem carregar nada', async () => {
    expect(ETAPA_LONGA.split(' ')).toHaveLength(7);
    expect(ETAPA_LONGA.length).toBeGreaterThan(52);
    const t = { ...T, etapas: [ETAPA_LONGA] };
    expect(motivosDeTexto(6, t, false)).toEqual([expect.stringMatching(/Etapa 1/)]);
    await expect(compor(6, { textos: t })).rejects.toThrow(/Etapa 1/);
    expect(cargas).toEqual([]);
  });

  it('headline de 5 palavras longas (>40 caracteres) → motivo', () => {
    expect(HEADLINE_LONGA.split(' ')).toHaveLength(5);
    expect(HEADLINE_LONGA.length).toBeGreaterThan(40);
    for (const m of [2, 3, 4, 5, 6, 7]) expect(motivosDeTexto(m, { ...T, headline: HEADLINE_LONGA }, false)).toEqual([expect.stringMatching(/Título/)]);
  });

  it('mais itens do que o layout comporta → motivo (nunca some em silêncio)', () => {
    expect(motivosDeTexto(4, { ...T, beneficios: ['a', 'b', 'c', 'd'] }, false)).toEqual([expect.stringMatching(/comporta/)]);
  });

  it('textos normais, capa e Moda → sem motivo', () => {
    for (const m of [2, 3, 4, 5, 6, 7]) expect(motivosDeTexto(m, T, false)).toEqual([]);
    expect(motivosDeTexto(1, { ...T, headline: HEADLINE_LONGA }, false)).toEqual([]);
    expect(motivosDeTexto(2, { ...T, headline: HEADLINE_LONGA }, true)).toEqual([]);
  });
});
