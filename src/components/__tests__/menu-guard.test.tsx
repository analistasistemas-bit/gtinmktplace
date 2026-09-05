// ADR-0153 D5: RPC de módulos falhando na 1ª carga da sessão deixa `useModulosHabilitados`
// com `data: undefined` sem estar carregando. Isso é "não sei" — diferente de `[]`, que é
// "sei que a org não contratou nenhum módulo". O MenuGuard não pode tratar os dois casos
// igual: "não sei" não pode virar redirect para /sem-acesso nem sumir com o resto do app.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MenuGuard } from '../menu-guard';

const PROFILE_PADRAO = {
  profile: { is_admin: false, is_active: true, allowed_menus: ['dashboard', 'lotes', 'estoque', 'pulse'] },
  profileLoading: false,
};
const profileMock = vi.fn(() => PROFILE_PADRAO);
vi.mock('@/hooks/useProfile', () => ({ useProfile: () => profileMock() }));

const modulosMock = vi.fn(() => ({ data: ['estoque', 'pulse'] as string[] | undefined, isLoading: false }));
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => modulosMock() }));

beforeEach(() => {
  profileMock.mockReturnValue(PROFILE_PADRAO);
});
afterEach(cleanup);

function renderEm(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<MenuGuard />}>
          <Route path="/" element={<div>DASHBOARD</div>} />
          <Route path="/lotes" element={<div>LOTES</div>} />
          <Route path="/estoque" element={<div>ESTOQUE</div>} />
          <Route path="/pulse" element={<div>PULSE</div>} />
        </Route>
        <Route path="/sem-acesso" element={<div>SEM ACESSO</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MenuGuard — módulos undefined na 1ª carga (ADR-0153 D5)', () => {
  it('RPC falhou (modulos undefined): NÃO manda /estoque para /sem-acesso', () => {
    modulosMock.mockReturnValue({ data: undefined, isLoading: false });
    renderEm('/estoque');
    expect(screen.queryByText('SEM ACESSO')).toBeNull();
    expect(screen.queryByText('ESTOQUE')).toBeNull();
  });

  it('RPC falhou (modulos undefined): rota sem módulo (Dashboard) continua funcionando', () => {
    modulosMock.mockReturnValue({ data: undefined, isLoading: false });
    renderEm('/');
    expect(screen.getByText('DASHBOARD')).toBeTruthy();
  });

  it('RPC falhou (modulos undefined): rota sem módulo (Lotes) continua funcionando', () => {
    modulosMock.mockReturnValue({ data: undefined, isLoading: false });
    renderEm('/lotes');
    expect(screen.getByText('LOTES')).toBeTruthy();
  });

  it('[] de verdade (org sem módulos contratados) CONTINUA escondendo /estoque → /sem-acesso', () => {
    // Só 'estoque' no allowed_menus: sem ele, não sobra nenhum menu → cai em /sem-acesso
    // em vez de redirecionar para outro menu permitido.
    profileMock.mockReturnValue({
      profile: { is_admin: false, is_active: true, allowed_menus: ['estoque'] },
      profileLoading: false,
    });
    modulosMock.mockReturnValue({ data: [], isLoading: false });
    renderEm('/estoque');
    expect(screen.getByText('SEM ACESSO')).toBeTruthy();
  });

  it('RPC falhou (modulos undefined), mas o PERFIL já não dá acesso a /estoque → motivo é permissão, redireciona normalmente', () => {
    profileMock.mockReturnValue({
      profile: { is_admin: false, is_active: true, allowed_menus: ['dashboard'] },
      profileLoading: false,
    });
    modulosMock.mockReturnValue({ data: undefined, isLoading: false });
    renderEm('/estoque');
    expect(screen.getByText('DASHBOARD')).toBeTruthy();
    expect(screen.queryByText('Módulos indisponíveis')).toBeNull();
  });

  it('ainda carregando (modulos undefined, isLoading true) mostra "Carregando…" e não redireciona', () => {
    modulosMock.mockReturnValue({ data: undefined, isLoading: true });
    renderEm('/estoque');
    expect(screen.getByText('Carregando…')).toBeTruthy();
    expect(screen.queryByText('SEM ACESSO')).toBeNull();
  });
});
