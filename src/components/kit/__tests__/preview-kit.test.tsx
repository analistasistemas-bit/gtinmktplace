import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PreviewKit, valorInicialPreview, type KitPreviewValue } from '../preview-kit';
import { tituloDoKit, descricaoDoKit, type BaseParaKit } from '@/lib/kit';

const BASE: BaseParaKit = {
  codigoPai: '00000010',
  titulo: 'Fita Adesiva Transparente 45mm',
  descricao: 'Fita de boa qualidade.',
  preco: 19.9,
  custo: 5.5,
  pesoGramas: 120,
  alturaCm: 10,
  larguraCm: 8,
  comprimentoCm: 3,
  fotoPath: null, // sem network no teste: useImageUrl(null) fica `enabled: false`
  estoque: 30,
};

function Wrapper({ n, inicial }: { n: number; inicial: Partial<KitPreviewValue> }) {
  const [value, setValue] = useState<KitPreviewValue>({
    ...valorInicialPreview(BASE, tituloDoKit(BASE.titulo, n), descricaoDoKit(BASE.descricao, n, BASE.titulo), n),
    ...inicial,
  });
  return (
    <PreviewKit
      n={n}
      base={BASE}
      value={value}
      onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
    />
  );
}

function renderPreview(n: number, inicial: Partial<KitPreviewValue> = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <Wrapper n={n} inicial={inicial} />
    </QueryClientProvider>,
  );
}

describe('PreviewKit', () => {
  it('mostra custo e peso derivados = base × N, somente leitura (Decisão 4)', () => {
    renderPreview(3);
    expect(screen.getByText(/16,50/)).toBeInTheDocument(); // 5.5 × 3 = 16.5
    expect(screen.getByText('360 g')).toBeInTheDocument(); // 120 × 3
  });

  it('saldo virtual = floor(estoque_base / N)', () => {
    renderPreview(4); // floor(30/4) = 7
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('contador de título e aria-invalid respondem quando o título passa de 60 caracteres', () => {
    renderPreview(2);
    const input = screen.getByLabelText('Título do kit 2');
    expect(input).toHaveAttribute('aria-invalid', 'false');

    fireEvent.change(input, { target: { value: 'x'.repeat(61) } });

    expect(screen.getByText('(61/60)')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Título acima de 60 caracteres.')).toBeInTheDocument();
  });

  it('mostra aviso não-bloqueante quando alguma dimensão está zerada (ADR-0018, M-8)', () => {
    renderPreview(3, { alturaCm: 0 });
    expect(screen.getByText(/Dimensões incompletas/)).toBeInTheDocument();
  });

  it('não mostra aviso quando as dimensões estão completas', () => {
    renderPreview(3);
    expect(screen.queryByText(/Dimensões incompletas/)).not.toBeInTheDocument();
  });

  it('aviso some ao digitar uma altura válida', () => {
    renderPreview(3, { alturaCm: 0 });
    expect(screen.getByText(/Dimensões incompletas/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Altura do kit 3 (cm)'), { target: { value: '10' } });

    expect(screen.queryByText(/Dimensões incompletas/)).not.toBeInTheDocument();
  });

  it('rótulos de dimensões e preço reservam min-h uniforme (grid alinhado)', () => {
    renderPreview(2);
    expect(screen.getByText('Altura (cm)')).toHaveClass('min-h-10');
    expect(screen.getByText('Desconto sobre N× unitário (%)')).toHaveClass('min-h-10');
  });
});
