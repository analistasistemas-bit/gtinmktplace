// ADR-0205 (Task 4): botão, candidata e aprovação da capa com N unidades. O estado vive no hook do dialog; o harness
// reproduz isso (o filho desmonta, o hook não).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GerarCapaUnidades, useCapasUnidades } from '../gerar-capa-unidades';

vi.mock('@/lib/capa-unidades-edge', () => ({ gerarCapaUnidadesEdge: vi.fn() }));
import { gerarCapaUnidadesEdge } from '@/lib/capa-unidades-edge';

let modulos: string[] | undefined = ['imagem_ia'];
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => ({ data: modulos }) }));

const edge = vi.mocked(gerarCapaUnidadesEdge);
const aprovada = (id: string) => ({
  ok: true as const, tentativa: 1, aprovado: true, proxima: false, path: `ORG/kit-variacao-ia/${id}.png`,
  url: `https://x/${id}.png`, verificacao: { aprovado: true, itens: [], motivos: [] },
});
const reprovada = (id: string, tentativa: number) => ({
  ok: true as const, tentativa, aprovado: false, proxima: tentativa < 3,
  verificacao: { aprovado: false, itens: [], motivos: ['Quantidade: 4 produtos em vez de 3'] },
  motivos: ['Quantidade: 4 produtos em vez de 3'], previa_url: `https://x/${id}-t${tentativa}.png`,
});
const falha = (motivo: string, mensagem: string) => ({ ok: false as const, motivo, mensagem });
const ids = () => edge.mock.calls.map((c) => c[0].requestId);

function Harness({ tamanhos = [3], temCapa = true, onUsar = vi.fn(), mostrar = true, aberto = true }: {
  tamanhos?: number[]; temCapa?: boolean; onUsar?: (n: number, p: string) => void; mostrar?: boolean; aberto?: boolean;
}) {
  const capas = useCapasUnidades('FAM', aberto);
  return (
    <div>
      {mostrar && tamanhos.map((n) => (
        <GerarCapaUnidades
          key={n} n={n} temCapa={temCapa} estado={capas.estados[n]}
          onGerar={() => void capas.gerar(n)} onUsar={(p) => { onUsar(n, p); capas.descartar(n); }}
        />
      ))}
      <button onClick={() => capas.descartar(tamanhos[0])}>descartar</button>
    </div>
  );
}
const botao = (n = 3) => screen.queryByRole('button', { name: `Gerar capa com ${n} unidades` });
const carregarImagem = () => fireEvent.load(screen.getByRole('img'));

describe('GerarCapaUnidades', () => {
  beforeEach(() => { edge.mockReset(); modulos = ['imagem_ia']; });
  afterEach(cleanup);

  it('botão some sem capa e sem o módulo imagem_ia', () => {
    const { rerender } = render(<Harness temCapa={false} />);
    expect(botao()).toBeNull();
    rerender(<Harness temCapa />);
    expect(botao()).toBeInTheDocument();
    modulos = [];
    rerender(<Harness temCapa key="outro" />);
    expect(botao()).toBeNull();
  });

  it('gera e mostra a candidata sem aplicar a foto; "Usar esta foto" entrega o path só com a prévia carregada', async () => {
    edge.mockResolvedValue(aprovada('r'));
    const onUsar = vi.fn();
    render(<Harness onUsar={onUsar} />);
    await userEvent.click(botao()!);
    const usar = await screen.findByRole('button', { name: 'Usar capa com 3 unidades' });
    expect(onUsar).not.toHaveBeenCalled();
    expect(usar).toBeDisabled();
    expect(screen.getByText('Quantidade: 3 produtos')).toBeInTheDocument();
    carregarImagem();
    expect(usar).toBeEnabled();
    await userEvent.click(usar);
    expect(onUsar).toHaveBeenCalledWith(3, expect.stringMatching(/\.png$/));
    expect(botao()).toBeInTheDocument();
  });

  it('reprovada nas 3 tentativas: motivos, sem "Usar", e "Gerar de novo" usa pedido novo', async () => {
    edge.mockResolvedValueOnce(reprovada('r', 1)).mockResolvedValueOnce(reprovada('r', 2)).mockResolvedValueOnce(reprovada('r', 3));
    render(<Harness />);
    await userEvent.click(botao()!);
    expect(await screen.findByText(/não conseguiu uma capa fiel com 3 unidades/)).toBeInTheDocument();
    expect(screen.getByText('Quantidade: 4 produtos em vez de 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Usar capa/ })).toBeNull();
    expect(edge).toHaveBeenCalledTimes(3);
    expect(new Set(ids()).size).toBe(1);

    edge.mockResolvedValueOnce(aprovada('n'));
    await userEvent.click(screen.getByRole('button', { name: 'Gerar de novo a capa com 3 unidades' }));
    await screen.findByRole('button', { name: 'Usar capa com 3 unidades' });
    expect(new Set(ids()).size).toBe(2);
  });

  it('botão fica travado durante a geração', async () => {
    let fim!: (v: ReturnType<typeof aprovada>) => void;
    edge.mockReturnValue(new Promise((r) => { fim = r; }) as never);
    render(<Harness />);
    await userEvent.click(botao()!);
    expect(botao()).toBeDisabled();
    await userEvent.click(botao()!);
    expect(edge).toHaveBeenCalledTimes(1);
    await act(async () => { fim(aprovada('r')); });
    await screen.findByRole('button', { name: 'Usar capa com 3 unidades' });
  });

  it('dois tamanhos são independentes (pedido e candidata próprios)', async () => {
    edge.mockImplementation(async (p) => aprovada(p.requestId));
    render(<Harness tamanhos={[2, 4]} />);
    await userEvent.click(botao(2)!);
    await screen.findByRole('button', { name: 'Usar capa com 2 unidades' });
    expect(botao(4)).toBeInTheDocument();
    await userEvent.click(botao(4)!);
    await screen.findByRole('button', { name: 'Usar capa com 4 unidades' });
    expect(edge.mock.calls.map((c) => c[0].n)).toEqual([2, 4]);
    expect(new Set(ids()).size).toBe(2);
  });

  it('429 teto_diario mostra o aviso para enviar a foto manualmente', async () => {
    edge.mockResolvedValue(falha('teto_diario', 'Limite do servidor'));
    render(<Harness />);
    await userEvent.click(botao()!);
    expect(await screen.findByText('Limite diário de gerações atingido: envie a foto manualmente.')).toBeInTheDocument();
  });

  it.each([['modulo_desligado', 'Geração de foto por IA não habilitada.'], ['prazo', 'A geração passou do tempo.'], ['em_andamento', 'Esta foto ainda está sendo gerada.']])(
    'falha %s mostra a mensagem e o botão continua disponível', async (motivo, msg) => {
      edge.mockResolvedValue(falha(motivo, msg));
      render(<Harness />);
      await userEvent.click(botao()!);
      expect(await screen.findByText(msg)).toBeInTheDocument();
      expect(botao()).toBeEnabled();
    },
  );

  it('falha incerta repete o mesmo request_id; após aprovada o próximo pedido é novo', async () => {
    edge.mockResolvedValueOnce(falha('estado_incerto', 'incerto')).mockResolvedValueOnce(aprovada('a')).mockResolvedValueOnce(aprovada('b'));
    render(<Harness />);
    await userEvent.click(botao()!);
    await screen.findByText('incerto');
    await userEvent.click(botao()!);
    await screen.findByRole('button', { name: 'Usar capa com 3 unidades' });
    expect(ids()[0]).toBe(ids()[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Gerar de novo a capa com 3 unidades' }));
    await waitFor(() => expect(edge).toHaveBeenCalledTimes(3));
    expect(ids()[2]).not.toBe(ids()[1]);
  });

  it('desmontar durante a geração não perde o resultado', async () => {
    let fim!: (v: ReturnType<typeof aprovada>) => void;
    edge.mockReturnValue(new Promise((r) => { fim = r; }) as never);
    const { rerender } = render(<Harness />);
    await userEvent.click(botao()!);
    rerender(<Harness mostrar={false} />);
    await act(async () => { fim(aprovada('r')); });
    rerender(<Harness mostrar />);
    expect(await screen.findByRole('button', { name: 'Usar capa com 3 unidades' })).toBeInTheDocument();
  });

  it('descartar (arquivo manual) apaga a candidata e ignora geração em voo', async () => {
    let fim!: (v: ReturnType<typeof aprovada>) => void;
    edge.mockReturnValue(new Promise((r) => { fim = r; }) as never);
    render(<Harness />);
    await userEvent.click(botao()!);
    await userEvent.click(screen.getByText('descartar'));
    await act(async () => { fim(aprovada('r')); });
    expect(screen.queryByRole('button', { name: /Usar capa/ })).toBeNull();
    expect(botao()).toBeEnabled();
  });

  it.each(['imagem_inadequada', 'falha_storage', 'pedido_diferente'])('502/409 definitivo %s gira o request_id', async (motivo) => {
    edge.mockResolvedValueOnce(falha(motivo, 'definitiva')).mockResolvedValueOnce(aprovada('b'));
    render(<Harness />);
    await userEvent.click(botao()!);
    await screen.findByText('definitiva');
    await userEvent.click(botao()!);
    await screen.findByRole('button', { name: 'Usar capa com 3 unidades' });
    expect(ids()[0]).not.toBe(ids()[1]);
  });

  it('descartar no meio da geração: não chama a edge de novo e não solta o cadeado da geração vigente', async () => {
    let fimA!: (v: unknown) => void;
    let fimB!: (v: unknown) => void;
    edge.mockReturnValueOnce(new Promise((r) => { fimA = r; }) as never).mockReturnValueOnce(new Promise((r) => { fimB = r; }) as never);
    render(<Harness />);
    await userEvent.click(botao()!);
    await userEvent.click(screen.getByText('descartar'));
    await userEvent.click(botao()!);
    expect(edge).toHaveBeenCalledTimes(2);
    await act(async () => { fimA(reprovada('a', 1)); });
    expect(edge).toHaveBeenCalledTimes(2); // a geração abandonada não repete
    expect(botao()).toBeDisabled();
    await userEvent.click(botao()!);
    expect(edge).toHaveBeenCalledTimes(2); // o cadeado da vigente segue
    await act(async () => { fimB(aprovada('b')); });
    expect(await screen.findByRole('button', { name: 'Usar capa com 3 unidades' })).toBeInTheDocument();
  });

  it('fechar o dialog no meio da geração: a 1ª tentativa reprovada com próxima não chama a edge de novo', async () => {
    let fimA!: (v: unknown) => void;
    edge.mockReturnValueOnce(new Promise((r) => { fimA = r; }) as never).mockResolvedValue(aprovada('x'));
    const { rerender } = render(<Harness />);
    await userEvent.click(botao()!);
    rerender(<Harness aberto={false} />);
    await act(async () => { fimA(reprovada('a', 1)); });
    expect(edge).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['reprovada final', reprovada('a', 3)],
    ['falha definitiva', falha('imagem_inadequada', 'velha')],
    ['aprovada', aprovada('a')],
    ['falha incerta', falha('estado_incerto', 'velha')],
  ])('descartar + nova geração: a abandonada voltando com %s não mexe no request_id nem no estado da vigente', async (_, resposta) => {
    let fimA!: (v: unknown) => void;
    let fimB!: (v: unknown) => void;
    edge.mockReturnValueOnce(new Promise((r) => { fimA = r; }) as never).mockReturnValueOnce(new Promise((r) => { fimB = r; }) as never);
    render(<Harness />);
    await userEvent.click(botao()!);
    await userEvent.click(screen.getByText('descartar'));
    await userEvent.click(botao()!);
    await act(async () => { fimA(resposta); });
    expect(botao()).toBeDisabled(); // a vigente segue gerando
    expect(screen.queryByText('velha')).toBeNull();
    await act(async () => { fimB(falha('estado_incerto', 'incerto')); });
    await screen.findByText('incerto');
    edge.mockResolvedValueOnce(aprovada('c'));
    await userEvent.click(botao()!);
    await waitFor(() => expect(edge).toHaveBeenCalledTimes(3));
    expect(ids()[2]).toBe(ids()[1]); // a vigente recupera a linha já gravada
    expect(ids()[1]).not.toBe(ids()[0]);
  });

  it('reabrir o dialog no meio da geração: a velha não repete nem solta o cadeado da nova', async () => {
    let fimA!: (v: unknown) => void;
    let fimB!: (v: unknown) => void;
    edge.mockReturnValueOnce(new Promise((r) => { fimA = r; }) as never).mockReturnValueOnce(new Promise((r) => { fimB = r; }) as never);
    const { rerender } = render(<Harness />);
    await userEvent.click(botao()!);
    rerender(<Harness aberto={false} />);
    rerender(<Harness aberto />);
    await userEvent.click(botao()!);
    expect(edge).toHaveBeenCalledTimes(2);
    await act(async () => { fimA(reprovada('a', 1)); });
    expect(edge).toHaveBeenCalledTimes(2);
    expect(botao()).toBeDisabled();
    await act(async () => { fimB(aprovada('b')); });
    expect(await screen.findByRole('button', { name: 'Usar capa com 3 unidades' })).toBeInTheDocument();
  });
});
