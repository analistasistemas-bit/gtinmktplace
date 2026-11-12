// ADR-0204: prévia da galeria da base (fotos 2 a 7) no preview do kit vinculado.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GaleriaBaseKit } from '../galeria-base-kit';
import type { EscolhaGaleria, GaleriaProposta } from '@/lib/kit-galeria';

afterEach(cleanup);

const PROPOSTA: GaleriaProposta = {
  fotos: [
    { id: 'p2', item: 'MLB1', url: 'https://x.test/2.jpg', cor: 'Base' },
    { id: 'p3', item: 'MLB1', url: 'https://x.test/3.jpg', cor: 'Base' },
  ],
  avisos: [], indisponivel: false,
};

function montar(over: Partial<React.ComponentProps<typeof GaleriaBaseKit>> = {}) {
  const onChange = vi.fn<(e: EscolhaGaleria) => void>();
  render(<GaleriaBaseKit proposta={PROPOSTA} escolha={undefined} onChange={onChange} {...over} />);
  return onChange;
}

describe('GaleriaBaseKit', () => {
  it('lista as fotos numeradas a partir da 2', () => {
    montar();
    expect(screen.getByText(/Fotos 2 a 7 do anúncio principal/)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('remover foto avisa a escolha sem o id', async () => {
    const onChange = montar();
    await userEvent.click(screen.getByRole('button', { name: /Remover foto 2/ }));
    expect(onChange).toHaveBeenCalledWith({ ligada: true, removidas: ['p2'] });
  });

  it('"Só a foto do kit" desliga a galeria', async () => {
    const onChange = montar();
    await userEvent.click(screen.getByRole('switch', { name: 'Só a foto do kit' }));
    expect(onChange).toHaveBeenCalledWith({ ligada: false, removidas: [] });
  });

  it('carregando mostra a leitura', () => {
    montar({ proposta: undefined, carregando: true });
    expect(screen.getByText(/Lendo as fotos/)).toBeInTheDocument();
  });

  it('falha de leitura segue só com a capa', () => {
    montar({ proposta: undefined, erro: true });
    expect(screen.getByText(/indisponíveis/)).toBeInTheDocument();
    expect(screen.getByText(/sai só com a capa/)).toBeInTheDocument();
  });

  it('base não publicada', () => {
    montar({ proposta: { fotos: [], avisos: ['base_nao_publicada'], indisponivel: false } });
    expect(screen.getByText('A base ainda não foi publicada: o kit sai só com a capa')).toBeInTheDocument();
  });

  it('base sem fotos extras', () => {
    montar({ proposta: { fotos: [], avisos: [], indisponivel: false } });
    expect(screen.getByText('A base não tem fotos além da capa')).toBeInTheDocument();
  });

  it('sem fotos mas com aviso: mostra o aviso, não "sem fotos além da capa"', () => {
    montar({ proposta: { fotos: [], avisos: ['Limite de fotos da categoria ilegível; kit sem galeria.'], indisponivel: false } });
    expect(screen.getByText('Limite de fotos da categoria ilegível; kit sem galeria.')).toBeInTheDocument();
    expect(screen.queryByText('A base não tem fotos além da capa')).not.toBeInTheDocument();
  });

  it('com n, os controles levam o tamanho no nome acessível', () => {
    montar({ n: 4 });
    expect(screen.getByRole('switch', { name: 'Só a foto do kit (kit de 4 unidades)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover foto 2 (Base) (kit de 4 unidades)' })).toBeInTheDocument();
  });
});
