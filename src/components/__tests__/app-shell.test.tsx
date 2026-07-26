import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useSupportStore } from '@/stores/support-store';

vi.mock('@/components/sidebar', () => ({ Sidebar: () => <aside />, SidebarNav: () => <nav />, BrandMark: () => <span /> }));
vi.mock('@/components/topbar', () => ({ Topbar: () => <header /> }));
vi.mock('@/components/support-banner', () => ({ SupportBanner: () => null }));
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));
vi.mock('@/components/ui/sheet', () => ({ Sheet: ({ children }: { children: React.ReactNode }) => <>{children}</>, SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import { AppShell } from '../app-shell';

function renderShell(scope: 'read' | 'full' | null) {
  useSupportStore.setState({ context: scope ? { requestId: 'r1', orgId: 'org-1', orgName: 'Avil', scope, expiresAt: '2030-01-01T12:00:00.000Z' } : null });
  render(<MemoryRouter initialEntries={['/']}><Routes><Route element={<AppShell />}><Route path="/" element={<><button>Salvar</button><input aria-label="Nome" /></>} /></Route></Routes></MemoryRouter>);
}

describe('AppShell em suporte leitura', () => {
  it.each(['read', 'full', null] as const)('aplica disabled apenas em %s', (scope) => {
    renderShell(scope);

    const button = screen.getByRole('button', { name: 'Salvar' });
    const input = screen.getByRole('textbox', { name: 'Nome' });
    if (scope === 'read') {
      expect(button).toBeDisabled();
      expect(input).toBeDisabled();
    } else {
      expect(button).not.toBeDisabled();
      expect(input).not.toBeDisabled();
    }
  });
});
