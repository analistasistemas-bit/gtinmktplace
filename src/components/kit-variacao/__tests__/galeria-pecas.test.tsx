import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GaleriaPecas } from '../galeria-pecas';
import type { GaleriaProposta } from '@/lib/kit-galeria';

const proposta = (extra: Partial<GaleriaProposta> = {}): GaleriaProposta => ({
  fotos: [
    { id: 'P2', item: 'MLB-P', url: 'https://x/P2.jpg', cor: 'Preto' },
    { id: 'C3', item: 'MLB-C', url: 'https://x/C3.jpg', cor: 'Caqui' },
    { id: 'P4', item: 'MLB-P', url: null, cor: 'Preto' },
  ],
  avisos: [], indisponivel: false, ...extra,
});

describe('GaleriaPecas', () => {
  it('mostra as fotos numeradas a partir da 2 (a 1 é a do kit), com a cor de origem', () => {
    render(<GaleriaPecas proposta={proposta()} escolha={undefined} onChange={() => {}} />);
    const itens = screen.getAllByRole('listitem');
    expect(itens).toHaveLength(3);
    expect(itens[0]).toHaveTextContent('2');
    expect(itens[1]).toHaveTextContent('3');
    expect(itens[1]).toHaveTextContent('Caqui');
    expect(itens[2]).toHaveTextContent('4');
  });

  it('remover uma foto avisa a escolha; as seguintes renumeram', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<GaleriaPecas proposta={proposta()} escolha={undefined} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remover foto 3 (Caqui)' }));
    expect(onChange).toHaveBeenCalledWith({ ligada: true, removidas: ['C3'] });
    rerender(<GaleriaPecas proposta={proposta()} escolha={{ ligada: true, removidas: ['C3'] }} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Restaurar foto de Caqui' })).toBeInTheDocument();
    expect(screen.getByText('no anúncio: 2 fotos das peças', { exact: false })).toBeInTheDocument();
  });

  it('"Só a foto do kit" liga e desliga a galeria sem perder as remoções', async () => {
    const onChange = vi.fn();
    render(<GaleriaPecas proposta={proposta()} escolha={{ ligada: true, removidas: ['C3'] }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Só a foto do kit' }));
    expect(onChange).toHaveBeenCalledWith({ ligada: false, removidas: ['C3'] });
  });

  it('galeria desligada: mostra o aviso e não lista fotos', () => {
    render(<GaleriaPecas proposta={proposta()} escolha={{ ligada: false, removidas: [] }} onChange={() => {}} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText(/só a foto do kit/i, { selector: 'p' })).toBeInTheDocument();
  });

  it('carregando: estado de leitura, sem fotos nem chave', () => {
    render(<GaleriaPecas carregando proposta={undefined} escolha={undefined} onChange={() => {}} />);
    expect(screen.getByText(/lendo as fotos das peças/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('leitura falhou: "fotos das peças indisponíveis" e o anúncio segue só com a foto do kit', () => {
    render(<GaleriaPecas erro proposta={undefined} escolha={undefined} onChange={() => {}} />);
    expect(screen.getByText(/fotos das peças indisponíveis/i)).toBeInTheDocument();
    expect(screen.getByText(/só com a foto do kit/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('proposta indisponível mostra o motivo vindo do servidor', () => {
    render(<GaleriaPecas proposta={proposta({ fotos: [], indisponivel: true, avisos: ['Azul: sem anúncio da peça no Mercado Livre.'] })}
      escolha={undefined} onChange={() => {}} />);
    expect(screen.getByText(/Azul: sem anúncio da peça/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('sem fotos de peças: estado vazio explicado', () => {
    render(<GaleriaPecas proposta={proposta({ fotos: [] })} escolha={undefined} onChange={() => {}} />);
    expect(screen.getByText(/nenhuma foto de peça/i)).toBeInTheDocument();
  });

  it('avisos parciais (uma cor fora) aparecem junto das fotos', () => {
    render(<GaleriaPecas proposta={proposta({ avisos: ['Preto: B está moderado.'] })} escolha={undefined} onChange={() => {}} />);
    expect(screen.getByText(/Preto: B está moderado/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('desabilitada (criando) trava remover e a chave', () => {
    render(<GaleriaPecas proposta={proposta()} escolha={undefined} onChange={() => {}} desabilitado />);
    expect(screen.getByRole('switch', { name: 'Só a foto do kit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover foto 2 (Preto)' })).toBeDisabled();
  });
});
