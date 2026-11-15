// Task 6 (capa IA do kit virtual): botão, candidata, reprovada, mudança de composição e teto diário.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GerarCapaKitVirtual, useCapaKitVirtual } from '../gerar-capa-kit-virtual';

vi.mock('@/lib/capa-kit-virtual-edge', () => ({ gerarCapaKitVirtualEdge: vi.fn() }));
import { gerarCapaKitVirtualEdge } from '@/lib/capa-kit-virtual-edge';

let modulos: string[] | undefined = ['imagem_ia'];
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => ({ data: modulos }) }));

const edge = vi.mocked(gerarCapaKitVirtualEdge);
const aprovada = { ok: true as const, tentativa: 1, aprovado: true, proxima: false, path: 'ORG/capa.png', url: 'https://x/capa.png' };
const reprovada = {
  ok: true as const, tentativa: 3, aprovado: false, proxima: false,
  motivos: ['Faltou a máscara'], previa_url: 'https://x/rep.png',
};
const comp = (qtd: number) => [
  { userProductId: 'UP1', itemId: 'MLB1', quantidade: qtd, rotulo: 'Shampoo' },
  { userProductId: 'UP2', itemId: 'MLB2', quantidade: 1, rotulo: 'Máscara' },
];

function Harness({ qtd = 2, habilitado = true, onUsar = vi.fn() }: { qtd?: number; habilitado?: boolean; onUsar?: (p: string) => void }) {
  const capa = useCapaKitVirtual(comp(qtd), true);
  return (
    <GerarCapaKitVirtual
      estado={capa.estado} itens={comp(qtd).map(({ rotulo, quantidade }) => ({ rotulo, quantidade }))}
      onGerar={capa.gerar} onUsar={onUsar} onDescartar={capa.descartar} habilitado={habilitado}
    />
  );
}
const botao = () => screen.queryByRole('button', { name: 'Gerar capa do kit' });

describe('GerarCapaKitVirtual', () => {
  beforeEach(() => { edge.mockReset(); modulos = ['imagem_ia']; });
  afterEach(cleanup);

  it('botão some sem o módulo imagem_ia e com componente sem itemId', () => {
    const { rerender } = render(<Harness />);
    expect(botao()).toBeInTheDocument();
    rerender(<Harness habilitado={false} />);
    expect(botao()).toBeNull();
    modulos = [];
    rerender(<Harness />);
    expect(botao()).toBeNull();
  });

  it('candidata: legenda com quantidades e "Usar esta foto" entrega o path só com a prévia carregada', async () => {
    edge.mockResolvedValue(aprovada);
    const onUsar = vi.fn();
    render(<Harness onUsar={onUsar} />);
    await userEvent.click(botao()!);
    await screen.findByText('2× Shampoo · 1× Máscara');
    const usar = screen.getByRole('button', { name: 'Usar capa gerada do kit' });
    expect(usar).toBeDisabled();
    fireEvent.load(screen.getByRole('img'));
    await userEvent.click(usar);
    expect(onUsar).toHaveBeenCalledWith('ORG/capa.png');
    expect(edge.mock.calls[0][0].componentes).toHaveLength(2);
  });

  it('mais de 6 unidades: legenda do modo uma de cada', () => {
    render(<Harness qtd={6} />);
    expect(screen.getByText('Mais de 6 unidades: uma de cada produto')).toBeInTheDocument();
  });

  it('reprovada: mostra os motivos e nunca oferece "Usar esta foto"', async () => {
    edge.mockResolvedValue(reprovada);
    const onUsar = vi.fn();
    render(<Harness onUsar={onUsar} />);
    await userEvent.click(botao()!);
    expect(await screen.findByText('Faltou a máscara')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usar capa gerada do kit' })).toBeNull();
    expect(onUsar).not.toHaveBeenCalled();
  });

  it('geração em voo de composição anterior é descartada ao mudar a quantidade', async () => {
    let resolver!: (r: typeof aprovada) => void;
    edge.mockReturnValueOnce(new Promise((res) => { resolver = res; }));
    const { rerender } = render(<Harness qtd={2} />);
    await userEvent.click(botao()!);
    await waitFor(() => expect(edge).toHaveBeenCalledTimes(1));
    rerender(<Harness qtd={3} />);
    await act(async () => { resolver(aprovada); });
    expect(botao()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usar capa gerada do kit' })).toBeNull();
    expect(edge).toHaveBeenCalledTimes(1);
  });

  it('laço de "proxima": composição mudada durante a 1ª tentativa não chama a edge de novo', async () => {
    let resolver!: (r: typeof reprovada) => void;
    edge.mockReturnValueOnce(new Promise((res) => { resolver = res; }));
    const { rerender } = render(<Harness qtd={2} />);
    await userEvent.click(botao()!);
    await waitFor(() => expect(edge).toHaveBeenCalledTimes(1));
    rerender(<Harness qtd={3} />);
    await act(async () => { resolver({ ...reprovada, tentativa: 1, proxima: true }); });
    expect(edge).toHaveBeenCalledTimes(1);
    expect(botao()).toBeInTheDocument();
  });

  it('mudar a quantidade com geração pendente: novo clique usa request_id diferente do primeiro', async () => {
    let resolver!: (r: typeof aprovada) => void;
    edge.mockReturnValueOnce(new Promise((res) => { resolver = res; }));
    edge.mockResolvedValueOnce(aprovada);
    const { rerender } = render(<Harness qtd={2} />);
    await userEvent.click(botao()!);
    await waitFor(() => expect(edge).toHaveBeenCalledTimes(1));
    rerender(<Harness qtd={3} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar capa do kit' }));
    await waitFor(() => expect(edge).toHaveBeenCalledTimes(2));
    expect(edge.mock.calls[1][0].requestId).not.toBe(edge.mock.calls[0][0].requestId);
    await act(async () => { resolver(aprovada); });
  });

  it('429 teto_diario: mensagem de teto', async () => {
    edge.mockResolvedValue({ ok: false, motivo: 'teto_diario', mensagem: 'x' });
    render(<Harness />);
    await userEvent.click(botao()!);
    expect(await screen.findByText('Limite diário de gerações atingido: envie a foto manualmente.')).toBeInTheDocument();
  });
});
