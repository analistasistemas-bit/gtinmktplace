import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/components/org-identidade', () => ({
  OrgIdentidade: ({ className }: { className?: string }) => <div data-testid="org" className={className} />,
}));
vi.mock('@/components/notificacoes-bell', () => ({ NotificacoesBell: () => null }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/user-menu', () => ({ UserMenu: () => null }));
vi.mock('@/components/sidebar', () => ({ BrandMark: () => <span /> }));
vi.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ profile: null }) }));

import { Topbar } from '../topbar';

describe('Topbar — marca da org', () => {
  it('mostra a identidade da org à esquerda só no desktop', () => {
    render(<MemoryRouter><Topbar onOpenMobile={() => {}} /></MemoryRouter>);
    const org = screen.getByTestId('org');
    expect(org.className).toMatch(/\bhidden\b/);
    expect(org.className).toMatch(/\blg:flex\b/);
  });
});
