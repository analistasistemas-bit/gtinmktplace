export const MENU_KEYS = ['dashboard', 'lotes', 'revisao', 'publicados', 'faturamento', 'financeiro', 'viabilidade', 'canais', 'configuracoes'] as const;
export type MenuKey = (typeof MENU_KEYS)[number] | 'usuarios';

export interface MenuProfile {
  is_admin: boolean;
  is_active: boolean;
  allowed_menus: string[];
}

// Menus visíveis para o perfil. Admin vê tudo + o menu exclusivo 'usuarios'.
// O painel de plataforma do super-admin (D-E7.8) fica em /admin, fora da sidebar
// de operação — não é menu de empresa. Ver components/super-admin-route.tsx.
export function visibleMenus(p: MenuProfile): MenuKey[] {
  return p.is_admin ? [...MENU_KEYS, 'usuarios'] : MENU_KEYS.filter((k) => p.allowed_menus.includes(k));
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
  canais: 'canais',
  configuracoes: 'configuracoes',
  usuarios: 'usuarios',
};

export function menuKeyForPath(pathname: string): MenuKey | null {
  const seg = pathname.replace(/^\//, '').split('/')[0];
  return PREFIX[seg] ?? null;
}

// Chave de menu → rota de destino (p/ redirecionar ao primeiro menu permitido).
export function pathForMenu(key: MenuKey): string {
  return key === 'dashboard' ? '/' : `/${key}`;
}
