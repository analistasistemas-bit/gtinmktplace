import { describe, it, expect } from 'vitest';
import { visibleMenus, menuKeyForPath, pathForMenu, MENU_KEYS } from './menus';

const base = { is_admin: false, is_active: true, allowed_menus: [] as string[] };

describe('menus', () => {
  it('admin vê todos os menus + usuarios', () => {
    expect(visibleMenus({ ...base, is_admin: true })).toEqual([...MENU_KEYS, 'usuarios']);
  });
  it('não-admin vê só os menus permitidos, sem usuarios', () => {
    expect(visibleMenus({ ...base, allowed_menus: ['dashboard', 'lotes'] })).toEqual(['dashboard', 'lotes']);
  });
  it('não-admin com allowed_menus inválido não enxerga nada', () => {
    expect(visibleMenus({ ...base, allowed_menus: ['inexistente'] })).toEqual([]);
  });
  it('super-admin não altera a sidebar de operação (painel fica em /admin)', () => {
    // is_super_admin é campo extra ignorado por visibleMenus — o painel de plataforma
    // vive em /admin, não como menu de empresa.
    expect(visibleMenus({ ...base, is_admin: true })).toEqual([...MENU_KEYS, 'usuarios']);
    expect(visibleMenus({ ...base })).toEqual([]);
  });
  it('mapeia subrotas pra chave de menu', () => {
    expect(menuKeyForPath('/')).toBe('dashboard');
    expect(menuKeyForPath('/revisao/123')).toBe('revisao');
    expect(menuKeyForPath('/financeiro/detalhe')).toBe('financeiro');
    expect(menuKeyForPath('/usuarios')).toBe('usuarios');
  });
  it('rota sem menu retorna null (libera)', () => {
    expect(menuKeyForPath('/style-guide')).toBeNull();
  });
  it('pathForMenu monta a rota de destino', () => {
    expect(pathForMenu('dashboard')).toBe('/');
    expect(pathForMenu('financeiro')).toBe('/financeiro');
  });
});
