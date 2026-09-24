import { describe, expect, it } from 'vitest';
import { MENU_KEYS, menuKeyForPath, visibleMenus } from '../menus';

describe('menus de suporte', () => {
  it('sessão autorizada libera a operação, mas nunca usuários', () => {
    expect(visibleMenus({ is_admin: false, is_active: true, allowed_menus: [] }, true)).toEqual([...MENU_KEYS]);
  });
});

describe('rota de promoções', () => {
  it('detalhe da campanha pertence ao menu promocoes', () => {
    expect(menuKeyForPath('/promocoes/P-MLB1')).toBe('promocoes');
  });
});
