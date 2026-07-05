export const MENU_KEYS = ['dashboard', 'lotes', 'revisao', 'publicados', 'faturamento', 'financeiro', 'viabilidade', 'configuracoes'] as const;
export type MenuKey = (typeof MENU_KEYS)[number] | 'usuarios' | 'organizacoes';

export interface MenuProfile {
  is_admin: boolean;
  is_active: boolean;
  allowed_menus: string[];
  is_super_admin?: boolean;
}

// Menus visíveis para o perfil. Admin vê tudo + o menu exclusivo 'usuarios'.
// Super-admin (só Diego, D-E7.8) vê 'organizacoes' independente de is_admin.
export function visibleMenus(p: MenuProfile): MenuKey[] {
  const menus: MenuKey[] = p.is_admin ? [...MENU_KEYS, 'usuarios'] : MENU_KEYS.filter((k) => p.allowed_menus.includes(k));
  return p.is_super_admin ? [...menus, 'organizacoes'] : menus;
}

// Primeiro segmento da rota → chave de menu. '/' = dashboard. null = rota sem menu (libera).
const PREFIX: Record<string, MenuKey> = {
  '': 'dashboard',
  lotes: 'lotes',
  'novo-lote': 'lotes',
  progresso: 'lotes',
  revisao: 'revisao',
  relatorio: 'revisao',
  publicados: 'publicados',
  faturamento: 'faturamento',
  financeiro: 'financeiro',
  viabilidade: 'viabilidade',
  configuracoes: 'configuracoes',
  usuarios: 'usuarios',
  organizacoes: 'organizacoes',
};

export function menuKeyForPath(pathname: string): MenuKey | null {
  const seg = pathname.replace(/^\//, '').split('/')[0];
  return PREFIX[seg] ?? null;
}

// Chave de menu → rota de destino (p/ redirecionar ao primeiro menu permitido).
export function pathForMenu(key: MenuKey): string {
  return key === 'dashboard' ? '/' : `/${key}`;
}
