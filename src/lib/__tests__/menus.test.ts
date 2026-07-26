import { describe, expect, it } from 'vitest';
import { MENU_KEYS, visibleMenus } from '../menus';

describe('menus de suporte', () => {
  it('sessão autorizada libera a operação, mas nunca usuários', () => {
    expect(visibleMenus({ is_admin: false, is_active: true, allowed_menus: [] }, true)).toEqual([...MENU_KEYS]);
  });
});
