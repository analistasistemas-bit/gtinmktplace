import { describe, it, expect } from 'vitest';
import { MODULOS, menusDeModulosDesabilitados } from '../modulos';
import { MENU_KEYS } from '../menus';

describe('MODULOS', () => {
  it('todo módulo aponta para uma chave de menu que existe', () => {
    for (const m of MODULOS) {
      expect(MENU_KEYS).toContain(m.menu);
    }
  });
  it('ids são únicos', () => {
    expect(new Set(MODULOS.map((m) => m.id)).size).toBe(MODULOS.length);
  });
});

describe('menusDeModulosDesabilitados', () => {
  it('org sem nenhum módulo esconde o menu de todos eles', () => {
    expect(menusDeModulosDesabilitados([])).toEqual(MODULOS.map((m) => m.menu));
  });
  it('org com o módulo estoque não esconde o menu estoque', () => {
    expect(menusDeModulosDesabilitados(['estoque'])).not.toContain('estoque');
  });
  it('módulo desconhecido no banco é ignorado sem quebrar', () => {
    expect(() => menusDeModulosDesabilitados(['modulo_que_nao_existe'])).not.toThrow();
    expect(menusDeModulosDesabilitados(['modulo_que_nao_existe'])).toEqual(MODULOS.map((m) => m.menu));
  });
});
