import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PreviewKit, valorInicialPreview, type KitPreviewValue } from '../preview-kit';
import { tituloDoKit, descricaoDoKit, type BaseParaKit } from '@/lib/kit';

vi.mock('@/lib/tarifa', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tarifa')>('@/lib/tarifa');
  const tipo = (preco: number, pct: number) => {
    const comissao = Math.round(preco * pct) / 100;
    return { comissao, percentual: pct, fixa: 0, imposto: 0, recebe: Math.round((preco - comissao - 10) * 100) / 100 };
  };
  return {
    ...actual,
    calcularTarifaML: vi.fn(async (preco: number) => ({ classico: tipo(preco, 12), premium: tipo(preco, 17), frete: 10, proveniencia: 'official' })),
  };
});
vi.mock('@/hooks/useImageUrl', () => ({
  useImageUrl: (path: string | null) => ({ data: path ? `https://img.test/${path}` : undefined }),
}));
vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: { nacional: 8, importado: 16, confirmada: true }, isLoading: false, isError: false, isFetched: true }),
}));

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
  categoriaMlId: 'MLB1000',
  origem: 'nacional',
  categoriaNome: 'Fitas Adesivas',
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
      categoriaMlId={BASE.categoriaMlId}
      onPodeSeguir={() => {}}
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

describe('campos decimais aceitam vírgula (bug 13/11: preço zerava ao digitar "38,")', () => {
  it('preço digitado com vírgula não zera e vale o número', () => {
    renderPreview(3);
    const preco = screen.getByLabelText('Preço do kit 3') as HTMLInputElement;
    fireEvent.change(preco, { target: { value: '38,' } });
    expect(preco.value).toBe('38,');
    fireEvent.change(preco, { target: { value: '38,5' } });
    expect(preco.value).toBe('38,5');
    expect(preco).toHaveAttribute('aria-invalid', 'false');
  });

  it('apagar o preço deixa o campo vazio (não volta o zero) e o foco seleciona tudo', () => {
    renderPreview(3);
    const preco = screen.getByLabelText('Preço do kit 3') as HTMLInputElement;
    fireEvent.change(preco, { target: { value: '' } });
    expect(preco.value).toBe('');
    expect(preco).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(preco, { target: { value: '45' } });
    fireEvent.focus(preco);
    expect([preco.selectionStart, preco.selectionEnd]).toEqual([0, 2]);
    const desconto = screen.getByLabelText('Desconto do kit 3 (%)') as HTMLInputElement;
    const sel = vi.spyOn(desconto, 'select');
    fireEvent.focus(desconto);
    expect(sel).toHaveBeenCalled();
  });

  it('milhar pt-BR no meio da digitação ("1.234,") não apaga o texto nem zera o preço (achado Grok)', () => {
    renderPreview(3);
    const preco = screen.getByLabelText('Preço do kit 3') as HTMLInputElement;
    fireEvent.change(preco, { target: { value: '1.234' } });
    fireEvent.change(preco, { target: { value: '1.234,' } });
    expect(preco.value).toBe('1.234,');
    fireEvent.change(preco, { target: { value: '1.234,56' } });
    expect(preco.value).toBe('1.234,56');
    expect(preco).toHaveAttribute('aria-invalid', 'false');
    fireEvent.change(preco, { target: { value: '38,5a' } });
    expect(preco.value).toBe('38,5a');
    expect(preco).toHaveAttribute('aria-invalid', 'true');
  });

  it('altura digitada com vírgula não zera', () => {
    renderPreview(3);
    const altura = screen.getByLabelText('Altura do kit 3 (cm)') as HTMLInputElement;
    fireEvent.change(altura, { target: { value: '60,' } });
    expect(altura.value).toBe('60,');
  });

  it('desconto recalcula e o campo de preço mostra o novo valor com vírgula', () => {
    renderPreview(3);
    fireEvent.change(screen.getByLabelText('Desconto do kit 3 (%)'), { target: { value: '10' } });
    expect((screen.getByLabelText('Preço do kit 3') as HTMLInputElement).value).toBe('53,73');
  });
});

it('altura do kit sem ruído de ponto flutuante', () => {
  expect(valorInicialPreview({ ...BASE, alturaCm: 9.8 }, 't', 'd', 6).alturaCm).toBe(58.8);
});

describe('valorInicialPreview', () => {
  it('pré-preenche só a altura × N — largura/comprimento seguem a base (Diego, 2026-09-08: bug '
    + 'MLB7585283770; multiplicar as 3 dimensões multiplicaria o volume por N³, não por N — '
    + 'revisão Fable)', () => {
    const v = valorInicialPreview(BASE, 'Kit', 'desc', 3);
    expect(v.alturaCm).toBe(30); // 10 × 3 — eixo do empilhamento
    expect(v.larguraCm).toBe(8); // igual à base
    expect(v.comprimentoCm).toBe(3); // igual à base
  });
});

describe('miniatura da capa', () => {
  it('clicar na miniatura abre a foto grande num dialog', () => {
    renderPreview(3, { imagemPath: 'kit/capa.jpg' });
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar foto de capa do kit 3' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByAltText('Foto de capa do kit 3, ampliada')).toHaveAttribute('src', 'https://img.test/kit/capa.jpg');
  });

  it('sem foto não há botão de ampliar', () => {
    renderPreview(3);
    expect(screen.queryByRole('button', { name: 'Ampliar foto de capa do kit 3' })).toBeNull();
  });
});

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
