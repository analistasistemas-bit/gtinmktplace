export const MENU_KEYS = ['dashboard', 'lotes', 'revisao', 'publicados', 'promocoes', 'estoque', 'pulse', 'vitrine', 'ads', 'faturamento', 'financeiro', 'viabilidade', 'canais', 'configuracoes'] as const;
export type MenuKey = (typeof MENU_KEYS)[number] | 'usuarios';

export interface MenuProfile {
  is_admin: boolean;
  is_active: boolean;
  allowed_menus: string[];
}

// Menus visíveis para o perfil. Admin vê tudo + o menu exclusivo 'usuarios'.
// O painel de plataforma do super-admin (D-E7.8) fica em /admin, fora da sidebar
// de operação — não é menu de empresa. Ver components/super-admin-route.tsx.
export function visibleMenus(p: MenuProfile, hasSupportSession = false): MenuKey[] {
  if (hasSupportSession) return [...MENU_KEYS];
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
  promocoes: 'promocoes',
  operacoes: 'publicados',
  estoque: 'estoque',
  pulse: 'pulse',
  vitrine: 'vitrine',
  ads: 'ads',
  faturamento: 'faturamento',
  financeiro: 'financeiro',
  viabilidade: 'viabilidade',
  canais: 'canais',
  configuracoes: 'configuracoes',
  usuarios: 'usuarios',
};

export function menuKeyForPath(pathname: string): MenuKey | null {
  // Canais é seção de Configurações, mas mantém a própria permissão (quem só tem 'canais' entra).
  if (pathname === '/configuracoes/canais' || pathname.startsWith('/configuracoes/canais/')) return 'canais';
  const seg = pathname.replace(/^\//, '').split('/')[0];
  return PREFIX[seg] ?? null;
}

// Chave de menu → rota de destino (p/ redirecionar ao primeiro menu permitido).
export function pathForMenu(key: MenuKey): string {
  if (key === 'canais') return '/configuracoes/canais';
  return key === 'dashboard' ? '/' : `/${key}`;
}
