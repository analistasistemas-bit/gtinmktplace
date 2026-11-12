import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecebeKit } from '../recebe-kit';
import { valorInicialPreview, type KitPreviewValue } from '../preview-kit';
import type { BaseParaKit } from '@/lib/kit';
import { calcularTarifaML, type Tarifa } from '@/lib/tarifa';

vi.mock('@/lib/tarifa', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tarifa')>('@/lib/tarifa');
  return { ...actual, calcularTarifaML: vi.fn() };
});
const aliquotas = { data: { nacional: 8, importado: 16, confirmada: true }, isLoading: false, isError: false, isFetched: true };
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => aliquotas }));

const BASE: BaseParaKit = {
  codigoPai: '00000010', titulo: 'Fita', descricao: 'd', preco: 20, custo: 5, pesoGramas: 100,
  alturaCm: 4, larguraCm: 8, comprimentoCm: 3, fotoPath: null, estoque: 30,
  categoriaMlId: 'MLB1', categoriaNome: 'Fitas', origem: 'nacional',
};

function tarifa(preco: number, frete: number, aliquotaPct: number): Tarifa {
  const imposto = Math.round(preco * aliquotaPct) / 100;
  const tipo = (pct: number) => {
    const comissao = Math.round(preco * pct) / 100;
    return { comissao, percentual: pct, fixa: 0, imposto, recebe: Math.round((preco - comissao - frete - imposto) * 100) / 100 };
  };
  return { classico: tipo(12), premium: tipo(17), frete, proveniencia: 'official' };
}

const valor = (n: number, patch: Partial<KitPreviewValue> = {}): KitPreviewValue =>
  ({ ...valorInicialPreview(BASE, 't', 'd', n), preco: 100, ...patch });

function renderRecebe(n: number, value: KitPreviewValue, base: BaseParaKit = BASE, onPodeSeguir = vi.fn(), categoria: string | null = base.categoriaMlId) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (v: KitPreviewValue, cat: string | null = categoria) => (
    <QueryClientProvider client={qc}>
      <RecebeKit n={n} base={base} value={v} categoriaMlId={cat} onPodeSeguir={onPodeSeguir} />
    </QueryClientProvider>
  );
  const r = render(ui(value));
  return { ...r, mudar: (v: KitPreviewValue, cat?: string | null) => r.rerender(ui(v, cat)), onPodeSeguir };
}

describe('RecebeKit', () => {
  beforeEach(() => {
    vi.mocked(calcularTarifaML).mockReset();
    vi.mocked(calcularTarifaML).mockImplementation(async (preco, _c, _d, aliq = 0) => tarifa(preco, 10, aliq));
    aliquotas.data = { nacional: 8, importado: 16, confirmada: true };
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('(a) mostra "Você recebe por venda" com o recebe cotado e libera', async () => {
    const { onPodeSeguir } = renderRecebe(2, valor(2));
    expect(await screen.findByText('Você recebe por venda')).toBeInTheDocument();
    // 100 - 12 - 10 - 8 = 70
    expect(screen.getByText('R$ 70,00')).toBeInTheDocument();
    await waitFor(() => expect(onPodeSeguir).toHaveBeenLastCalledWith(2, true));
  });

  it('(b) mudar o preço mostra Calculando e só cota após 500 ms, sem o valor antigo', async () => {
    const { mudar } = renderRecebe(2, valor(2));
    await screen.findByText('R$ 70,00');
    vi.useFakeTimers();
    mudar(valor(2, { preco: 200 }));
    expect(screen.getByText(/Calculando/)).toBeInTheDocument();
    expect(screen.queryByText('R$ 70,00')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(vi.mocked(calcularTarifaML).mock.calls.some((c) => c[0] === 200)).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(vi.mocked(calcularTarifaML).mock.calls.some((c) => c[0] === 200)).toBe(true);
    // 200 - 24 - 10 - 16 = 150
    expect(screen.getByText('R$ 150,00')).toBeInTheDocument();
  });

  it('(c) cota com as dimensões editadas e peso = base × N', async () => {
    renderRecebe(3, valor(3, { alturaCm: 15 }));
    await screen.findByText('Você recebe por venda');
    expect(calcularTarifaML).toHaveBeenCalledWith(
      100, 'MLB1', { alturaCm: 15, larguraCm: 8, comprimentoCm: 3, pesoGramas: 300 }, 8,
    );
  });

  it('(d) prejuízo exige "Seguir mesmo assim"; mudar o preço (após 500 ms) desmarca', async () => {
    // custo 5×2 = 10; preço 20: 20-2.4-10-1.6 = 6 -> prejuízo
    const { onPodeSeguir, mudar } = renderRecebe(2, valor(2, { preco: 20 }));
    const check = await screen.findByLabelText('Seguir mesmo assim, kit de 2 unidades');
    expect(onPodeSeguir).toHaveBeenLastCalledWith(2, false);
    await userEvent.click(check);
    await waitFor(() => expect(onPodeSeguir).toHaveBeenLastCalledWith(2, true));
    vi.useFakeTimers();
    mudar(valor(2, { preco: 21 }));
    expect(onPodeSeguir).toHaveBeenLastCalledWith(2, false);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(onPodeSeguir).toHaveBeenLastCalledWith(2, false);
    expect(screen.getByLabelText('Seguir mesmo assim, kit de 2 unidades')).not.toBeChecked();
  });

  it('(d3) mudar dimensão ou categoria invalida a confirmação', async () => {
    const { onPodeSeguir, mudar } = renderRecebe(2, valor(2, { preco: 20 }));
    const marcar = async () => {
      await userEvent.click(await screen.findByLabelText('Seguir mesmo assim, kit de 2 unidades'));
      await waitFor(() => expect(onPodeSeguir).toHaveBeenLastCalledWith(2, true));
    };
    await marcar();
    mudar(valor(2, { preco: 20, alturaCm: 30 }));
    await waitFor(() => expect(onPodeSeguir).toHaveBeenLastCalledWith(2, false));
    await waitFor(() => expect(screen.getByLabelText('Seguir mesmo assim, kit de 2 unidades')).not.toBeChecked());
    await marcar();
    mudar(valor(2, { preco: 20, alturaCm: 30 }), 'MLB2');
    await waitFor(() => expect(onPodeSeguir).toHaveBeenLastCalledWith(2, false));
    await waitFor(() => expect(screen.getByLabelText('Seguir mesmo assim, kit de 2 unidades')).not.toBeChecked());
  });

  it('(e2) custo 0, peso 0 e base sem categoria bloqueiam sem checkbox e sem cotar', async () => {
    const casos: [Partial<BaseParaKit>, RegExp][] = [
      [{ custo: 0 }, /cadastre custo\/peso na base/],
      [{ pesoGramas: 0 }, /cadastre custo\/peso na base/],
      [{ categoriaMlId: null }, /não tem categoria/],
    ];
    for (const [patch, texto] of casos) {
      const r = renderRecebe(2, valor(2), { ...BASE, ...patch });
      expect(await screen.findByText(texto)).toBeInTheDocument();
      expect(screen.queryByLabelText(/Seguir mesmo assim/)).toBeNull();
      expect(r.onPodeSeguir).toHaveBeenLastCalledWith(2, false);
      cleanup();
    }
    // override de categoria não destrava base sem categoria
    const r = renderRecebe(2, valor(2), { ...BASE, categoriaMlId: null }, vi.fn(), 'MLB9');
    expect(await screen.findByText(/não tem categoria/)).toBeInTheDocument();
    expect(r.onPodeSeguir).toHaveBeenLastCalledWith(2, false);
    expect(calcularTarifaML).not.toHaveBeenCalled();
  });

  it('(d2) sem alíquota confirmada exige confirmação e avisa', async () => {
    aliquotas.data = { nacional: 8, importado: 16, confirmada: false };
    const { onPodeSeguir } = renderRecebe(2, valor(2));
    expect(await screen.findByText(/Imposto fora da conta/)).toBeInTheDocument();
    expect(screen.getByLabelText('Seguir mesmo assim, kit de 2 unidades')).toBeInTheDocument();
    expect(onPodeSeguir).toHaveBeenLastCalledWith(2, false);
  });

  it('(e) sem custo ou sem peso na base: bloqueia sem checkbox', async () => {
    const r1 = renderRecebe(2, valor(2), { ...BASE, custo: null });
    expect(await screen.findByText(/cadastre custo\/peso na base/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Seguir mesmo assim/)).toBeNull();
    expect(r1.onPodeSeguir).toHaveBeenLastCalledWith(2, false);
    expect(screen.queryByText(/Imposto fora da conta/)).toBeNull();
    cleanup();
    const r2 = renderRecebe(2, valor(2), { ...BASE, pesoGramas: null });
    expect(await screen.findByText(/cadastre custo\/peso na base/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Seguir mesmo assim/)).toBeNull();
    expect(r2.onPodeSeguir).toHaveBeenLastCalledWith(2, false);
    expect(calcularTarifaML).not.toHaveBeenCalled();
  });

  it('(f) com 2 kits cada checkbox tem id kit-N-seguir', async () => {
    aliquotas.data = { nacional: 8, importado: 16, confirmada: false };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <RecebeKit n={2} base={BASE} value={valor(2)} categoriaMlId="MLB1" onPodeSeguir={vi.fn()} />
        <RecebeKit n={3} base={BASE} value={valor(3)} categoriaMlId="MLB1" onPodeSeguir={vi.fn()} />
      </QueryClientProvider>,
    );
    const a = await screen.findByLabelText('Seguir mesmo assim, kit de 2 unidades');
    const b = await screen.findByLabelText('Seguir mesmo assim, kit de 3 unidades');
    expect(a.id).toBe('kit-2-seguir');
    expect(b.id).toBe('kit-3-seguir');
  });

  it('(g) dimensões editadas só cotam após 500 ms; medida zerada fica indisponível sem cotar', async () => {
    const { mudar } = renderRecebe(2, valor(2));
    await screen.findByText('R$ 70,00');
    vi.mocked(calcularTarifaML).mockClear();
    vi.useFakeTimers();
    mudar(valor(2, { alturaCm: 20 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(calcularTarifaML).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(calcularTarifaML).toHaveBeenCalledTimes(1);
    vi.mocked(calcularTarifaML).mockClear();
    mudar(valor(2, { alturaCm: 0 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(calcularTarifaML).not.toHaveBeenCalled();
    expect(screen.getByText(/Não foi possível calcular/)).toBeInTheDocument();
    expect(screen.queryByText('Você recebe por venda')).toBeNull();
  });
});
