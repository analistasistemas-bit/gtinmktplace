import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mesmo padrão de useMensagens.test.ts: testa a função exportada, sem montar o hook.
// O que importa aqui é o cache em localStorage (ADR-0081) — é ele que evita rebaixar a foto
// a cada sessão, que era 70% do egress da conta.
const { mockCreateSignedUrl } = vi.hoisted(() => ({ mockCreateSignedUrl: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: mockCreateSignedUrl }) } },
}));

const { resolverUrlImagem, invalidarImagem, limparUrlsImagem } = await import('../useImageUrl');

const STORE_KEY = 'publiai:img-urls:v1';
const mockInvalidate = vi.fn();
const qcFake = { invalidateQueries: mockInvalidate } as never;

beforeEach(() => {
  localStorage.clear();
  mockCreateSignedUrl.mockReset();
  mockInvalidate.mockReset();
});

describe('resolverUrlImagem', () => {
  it('reaproveita a URL salva em vez de assinar de novo', async () => {
    mockCreateSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'u1' }, error: null });
    expect(await resolverUrlImagem('a/b.jpg')).toBe('u1');
    expect(await resolverUrlImagem('a/b.jpg')).toBe('u1');
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('assina de novo quando a entrada salva já venceu', async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ 'a/b.jpg': { url: 'velha', expira: Date.now() - 1 } }));
    mockCreateSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'nova' }, error: null });
    expect(await resolverUrlImagem('a/b.jpg')).toBe('nova');
  });

  it('descarta entradas vencidas de outros paths ao gravar', async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ 'velho.jpg': { url: 'x', expira: Date.now() - 1 } }));
    mockCreateSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'u1' }, error: null });
    await resolverUrlImagem('novo.jpg');
    expect(Object.keys(JSON.parse(localStorage.getItem(STORE_KEY)!))).toEqual(['novo.jpg']);
  });

  it('invalidarImagem força novo token — senão a foto trocada não aparece', async () => {
    mockCreateSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'u1' }, error: null });
    await resolverUrlImagem('a/b.jpg');
    invalidarImagem(qcFake, 'a/b.jpg');
    mockCreateSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'u2' }, error: null });
    expect(await resolverUrlImagem('a/b.jpg')).toBe('u2');
    // Sem re-render a foto nova não aparece: o descarte do store sozinho não basta.
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['img-url', 'a/b.jpg'] });
  });

  it('limparUrlsImagem apaga o store — URL assinada não sobrevive ao logout', async () => {
    mockCreateSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'u1' }, error: null });
    await resolverUrlImagem('a/b.jpg');
    limparUrlsImagem();
    expect(localStorage.getItem(STORE_KEY)).toBeNull();
  });

  // Regressão pega na validação em runtime: a tela carrega N fotos de uma vez, e a versão
  // anterior lia o store ANTES do await e gravava DEPOIS — todas liam vazio e cada uma
  // sobrescrevia o objeto inteiro, então só a última entrada sobrevivia e o cache nunca enchia
  // (8 fotos na tela → 3 entradas gravadas). Sem isso, a economia de egress não acontece.
  it('N resoluções concorrentes gravam TODAS as entradas', async () => {
    const paths = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'];
    paths.forEach((p) => mockCreateSignedUrl.mockResolvedValueOnce({ data: { signedUrl: `url-${p}` }, error: null }));
    await Promise.all(paths.map((p) => resolverUrlImagem(p)));
    expect(Object.keys(JSON.parse(localStorage.getItem(STORE_KEY)!)).sort()).toEqual(paths);
  });

  it('localStorage corrompido não derruba a tela', async () => {
    localStorage.setItem(STORE_KEY, 'não é json');
    mockCreateSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'u1' }, error: null });
    expect(await resolverUrlImagem('a/b.jpg')).toBe('u1');
  });
});
