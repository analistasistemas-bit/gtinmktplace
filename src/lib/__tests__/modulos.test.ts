import { describe, it, expect } from 'vitest';
import { MODULOS, menusDeModulosDesabilitados } from '../modulos';
import { MENU_KEYS } from '../menus';

describe('MODULOS', () => {
  it('todo módulo com menu aponta para uma chave que existe', () => {
    for (const m of MODULOS) {
      if (m.menu != null) expect(MENU_KEYS).toContain(m.menu);
    }
  });
  it('ids são únicos', () => {
    expect(new Set(MODULOS.map((m) => m.id)).size).toBe(MODULOS.length);
  });
});

describe('menusDeModulosDesabilitados', () => {
  it('org sem nenhum módulo esconde o menu de todos eles', () => {
    const menusComModulo = MODULOS.map((m) => m.menu).filter((menu): menu is NonNullable<typeof menu> => menu != null);
    expect(menusDeModulosDesabilitados([])).toEqual(menusComModulo);
  });
  it('org com o módulo estoque não esconde o menu estoque', () => {
    expect(menusDeModulosDesabilitados(['estoque'])).not.toContain('estoque');
  });
  it('módulo desconhecido no banco é ignorado sem quebrar', () => {
    const menusComModulo = MODULOS.map((m) => m.menu).filter((menu): menu is NonNullable<typeof menu> => menu != null);
    expect(() => menusDeModulosDesabilitados(['modulo_que_nao_existe'])).not.toThrow();
    expect(menusDeModulosDesabilitados(['modulo_que_nao_existe'])).toEqual(menusComModulo);
  });
});
