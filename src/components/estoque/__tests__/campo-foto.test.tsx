// Regressão achada via Playwright ao vivo (dono do produto): a miniatura de "✓ enviada" na
// etapa 2 renderizava como imagem QUEBRADA. Causa: `useMemo(() => URL.createObjectURL(file),
// [file])` + `useEffect(() => () => URL.revokeObjectURL(url), [url])` quebra sob React 18
// StrictMode em dev — mount → unmount (revoga) → remount, e o useMemo não recalcula porque
// `file` não mudou. Este teste força esse ciclo com <StrictMode> (o mesmo que ReactDOM.render
// usa em dev) e prova que a URL atualmente no <img> nunca foi revogada.
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MiniaturaFoto } from '../campo-foto';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('MiniaturaFoto — blob URL sobrevive ao StrictMode', () => {
  it('a URL atualmente renderizada no <img> nunca foi passada para revokeObjectURL', () => {
    // Mock com URL ÚNICA por chamada (não por nome de arquivo) — é o que permite distinguir
    // "a primeira URL criada, já revogada pelo unmount fantasma" da "segunda, ainda válida".
    let contador = 0;
    const revocadas: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => `blob:capa-${contador++}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn((u: string) => { revocadas.push(u); }),
    });

    const arquivo = new File(['x'], 'capa.png', { type: 'image/png' });
    render(
      <StrictMode>
        <MiniaturaFoto file={arquivo} alt="Prévia da Capa" />
      </StrictMode>,
    );

    const img = screen.getByAltText('Prévia da Capa') as HTMLImageElement;
    const srcAtual = img.getAttribute('src');
    expect(srcAtual).toMatch(/^blob:/);
    // A trava real: a URL que está NO DOM agora não pode estar na lista de revogadas.
    expect(revocadas).not.toContain(srcAtual);
  });
});
