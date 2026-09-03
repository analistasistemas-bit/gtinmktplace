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
    ...valorInicialPreview(BASE, tituloDoKit(BASE.titulo, n), descricaoDoKit(BASE.descricao, n), n),
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
});
