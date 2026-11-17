import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mapas = vi.hoisted(() => ({ porCodigo: new Map<string, string>(), porCodigoCapa: new Map<string, string>(), carregando: false }));
vi.mock('@/hooks/useFotosProduto', () => ({ useFotosProduto: () => ({ data: mapas }) }));
vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: (p: string | null | undefined) => ({ data: p && !mapas.carregando ? `https://img.test/${p}` : undefined }) }));

import { BotaoCor } from '../botao-cor';

afterEach(() => { cleanup(); mapas.porCodigo.clear(); mapas.porCodigoCapa.clear(); mapas.carregando = false; });

describe('BotaoCor', () => {
  it('cor com foto: miniatura e diálogo com a imagem grande e link do original', async () => {
    mapas.porCodigo.set('43001', 'zaven/estampa1.jpg');
    render(<BotaoCor cor="Estampa 1" corHex={null} codigos={['00000043001', '00000043002']} />);
    const user = userEvent.setup();
    const botao = screen.getByRole('button', { name: 'Ver detalhes da cor Estampa 1' });
    expect(botao.querySelector('img')).toHaveAttribute('src', 'https://img.test/zaven/estampa1.jpg');
    await user.click(botao);
    const grande = await screen.findByRole('img', { name: 'Foto da cor Estampa 1' });
    expect(grande).toHaveAttribute('src', 'https://img.test/zaven/estampa1.jpg');
    expect(screen.getByRole('link', { name: /Abrir original/ })).toHaveAttribute('href', 'https://img.test/zaven/estampa1.jpg');
  });

  it('usa o primeiro tamanho da cor que tiver foto', () => {
    mapas.porCodigo.set('43002', 'zaven/estampa1-b.jpg');
    render(<BotaoCor cor="Estampa 1" corHex={null} codigos={['00000043001', '00000043002']} />);
    expect(screen.getByRole('button', { name: /Estampa 1/ }).querySelector('img')).toHaveAttribute('src', 'https://img.test/zaven/estampa1-b.jpg');
  });

  it('sem foto: nunca cai na capa da família; diálogo avisa', async () => {
    mapas.porCodigoCapa.set('64001', 'zaven/capa.jpg');
    render(<BotaoCor cor="Estampa 2" corHex="#112233" codigos={['00000064001']} />);
    const user = userEvent.setup();
    const botao = screen.getByRole('button', { name: 'Ver detalhes da cor Estampa 2' });
    expect(botao.querySelector('img')).toBeNull();
    await user.click(botao);
    expect(await screen.findByText('Sem foto cadastrada para esta cor.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Foto da cor/ })).toBeNull();
  });

  it('foto existe mas a URL ainda carrega: diz "Carregando", nunca "Sem foto"', async () => {
    mapas.porCodigo.set('43001', 'zaven/estampa1.jpg');
    mapas.carregando = true;
    render(<BotaoCor cor="Estampa 1" corHex={null} codigos={['00000043001']} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ver detalhes da cor Estampa 1' }));
    expect(await screen.findByText('Carregando foto…')).toBeInTheDocument();
    expect(screen.queryByText(/Sem foto cadastrada/)).toBeNull();
  });

  it('cor vazia aparece como "Sem cor"', () => {
    render(<BotaoCor cor="" corHex={null} codigos={['x']} />);
    expect(screen.getByRole('button', { name: 'Ver detalhes da cor Sem cor' })).toBeInTheDocument();
  });
});
