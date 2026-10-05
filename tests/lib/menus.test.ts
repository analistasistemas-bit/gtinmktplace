import { describe, expect, it } from 'vitest';
import { menuKeyForPath } from '@/lib/menus';
import { menusDeModulosDesabilitados } from '@/lib/modulos';

describe('menu ads', () => {
  it('rota /ads → chave ads', () => expect(menuKeyForPath('/ads')).toBe('ads'));
  it('some sem o módulo e aparece com ele', () => {
    expect(menusDeModulosDesabilitados([])).toContain('ads');
    expect(menusDeModulosDesabilitados(['ads'])).not.toContain('ads');
  });
});
