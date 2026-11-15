import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OrgIdentidade } from '../org-identidade';

type Ident = { nome: string; logo_claro_url: string | null; logo_escuro_url: string | null } | null;
const identMock = vi.fn((): { data: Ident } => ({ data: null }));
vi.mock('@/hooks/useOrgIdentidade', () => ({ useOrgIdentidade: () => identMock() }));
const temaMock = vi.fn(() => 'dark');
vi.mock('@/components/theme-provider', () => ({ useTheme: () => ({ theme: temaMock(), toggle: vi.fn() }) }));

afterEach(cleanup);

describe('OrgIdentidade', () => {
  it('sem dado ainda: não renderiza nada', () => {
    identMock.mockReturnValue({ data: null });
    const { container } = render(<OrgIdentidade />);
    expect(container.firstChild).toBeNull();
  });

  it('sem logo: iniciais + nome', () => {
    identMock.mockReturnValue({ data: { nome: 'Avil Moda', logo_claro_url: null, logo_escuro_url: null } });
    render(<OrgIdentidade />);
    expect(screen.getByText('AM')).toBeTruthy();
    expect(screen.getByText('Avil Moda')).toBeTruthy();
  });

  it('com logo: imagem do tema ativo com alt = nome, sem o nome em texto (wordmark)', () => {
    identMock.mockReturnValue({ data: { nome: 'Avil Moda', logo_claro_url: 'https://x/c.png', logo_escuro_url: 'https://x/e.png' } });
    render(<OrgIdentidade />);
    const img = screen.getByAltText('Avil Moda') as HTMLImageElement;
    expect(img.src).toBe('https://x/e.png');
    Object.defineProperty(img, 'naturalWidth', { value: 300 });
    Object.defineProperty(img, 'naturalHeight', { value: 80 });
    fireEvent.load(img);
    expect(screen.queryByText('Avil Moda')).toBeNull();
  });

  it('logo quase quadrada (símbolo): mostra o nome ao lado', () => {
    identMock.mockReturnValue({ data: { nome: 'Avil Moda', logo_claro_url: 'https://x/c.png', logo_escuro_url: null } });
    render(<OrgIdentidade />);
    const img = screen.getByAltText('Avil Moda');
    Object.defineProperty(img, 'naturalWidth', { value: 100 });
    Object.defineProperty(img, 'naturalHeight', { value: 100 });
    fireEvent.load(img);
    expect(screen.getByText('Avil Moda')).toBeTruthy();
  });

  it('URL quebrada: cai para iniciais + nome', () => {
    identMock.mockReturnValue({ data: { nome: 'Avil Moda', logo_claro_url: 'https://x/c.png', logo_escuro_url: null } });
    render(<OrgIdentidade />);
    fireEvent.error(screen.getByAltText('Avil Moda'));
    expect(screen.queryByAltText('Avil Moda')).toBeNull();
    expect(screen.getByText('AM')).toBeTruthy();
    expect(screen.getByText('Avil Moda')).toBeTruthy();
  });
});
