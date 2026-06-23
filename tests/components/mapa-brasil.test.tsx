import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MapaBrasil } from '@/components/faturamento/mapa-brasil';

// O GeoJSON é importado normalmente — não precisa de mock (dados estáticos)

describe('MapaBrasil', () => {
  it('renderiza 27 paths de estado (data-uf)', () => {
    const { container } = render(
      <MapaBrasil valores={{ SP: 10, PE: 5 }} />,
    );
    const paths = container.querySelectorAll('[data-uf]');
    expect(paths.length).toBe(27);
  });

  it('o path de SP tem data-uf="SP"', () => {
    const { container } = render(
      <MapaBrasil valores={{ SP: 10, PE: 5 }} />,
    );
    const spPath = container.querySelector('[data-uf="SP"]');
    expect(spPath).not.toBeNull();
  });

  it('UFs sem valor recebem valor 0 no title', () => {
    const { container } = render(
      <MapaBrasil valores={{ SP: 10 }} unidade="pedidos" />,
    );
    // AM não foi informado → deve aparecer com 0
    const amPath = container.querySelector('[data-uf="AM"]');
    expect(amPath).not.toBeNull();
    const title = amPath!.querySelector('title');
    expect(title?.textContent).toContain('0 pedidos');
  });

  it('chama onSelecionar com a UF ao clicar', () => {
    const onSelecionar = vi.fn();
    const { container } = render(
      <MapaBrasil valores={{ SP: 10 }} onSelecionar={onSelecionar} />,
    );
    const spPath = container.querySelector('[data-uf="SP"]') as HTMLElement;
    fireEvent.click(spPath);
    expect(onSelecionar).toHaveBeenCalledWith('SP');
  });

  it('selecionada destaca o stroke do path correto', () => {
    const { container } = render(
      <MapaBrasil valores={{ SP: 10 }} selecionada="SP" />,
    );
    const spPath = container.querySelector('[data-uf="SP"]');
    expect(spPath?.getAttribute('stroke')).toBe('var(--primary)');
  });
});
