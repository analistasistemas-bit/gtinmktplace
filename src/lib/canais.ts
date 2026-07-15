// Registry dos marketplaces (spec 2026-07-14-menus-multicanal). Fonte única que desenha
// tabs, cards e badges em toda a UI. Marketplace novo = 1 entrada aqui.
// Visibilidade POR ORG vem de organizations.canais_habilitados (D5): operável = habilitado E ativo.

export type CanalId = 'mercado_livre' | 'shopee' | 'magalu' | 'amazon' | 'casas_bahia';

export interface CapabilitiesCanal {
  /** Limite de caracteres do título no canal. */
  tituloMax: number;
}

export interface CanalInfo {
  id: CanalId;
  nome: string;
  /** Cor oficial da marca (hex) — badges, tabs e gráficos. */
  corMarca: string;
  /** Monograma exibido enquanto não houver logo SVG oficial (asset a adicionar depois). */
  monograma: string;
  status: 'ativo' | 'em_breve';
  /** Só canais implementados têm capabilities — não inventamos limites de canal futuro. */
  capabilities?: CapabilitiesCanal;
}

export const CANAIS: Record<CanalId, CanalInfo> = {
  mercado_livre: {
    id: 'mercado_livre', nome: 'Mercado Livre', corMarca: '#FFE600', monograma: 'ML',
    status: 'ativo', capabilities: { tituloMax: 60 },
  },
  shopee: { id: 'shopee', nome: 'Shopee', corMarca: '#EE4D2D', monograma: 'SH', status: 'em_breve' },
  magalu: { id: 'magalu', nome: 'Magazine Luiza', corMarca: '#0086FF', monograma: 'MG', status: 'em_breve' },
  amazon: { id: 'amazon', nome: 'Amazon', corMarca: '#FF9900', monograma: 'AZ', status: 'em_breve' },
  casas_bahia: { id: 'casas_bahia', nome: 'Casas Bahia', corMarca: '#0F38A8', monograma: 'CB', status: 'em_breve' },
};

export const LISTA_CANAIS: CanalInfo[] = Object.values(CANAIS);

export function infoCanal(id: string): CanalInfo | null {
  return (CANAIS as Record<string, CanalInfo>)[id] ?? null;
}

/** Canais que a org pode operar hoje: habilitados para ela E ativos no registry. */
export function canaisOperaveis(habilitados: string[]): CanalInfo[] {
  return LISTA_CANAIS.filter((c) => c.status === 'ativo' && habilitados.includes(c.id));
}

/** Vitrine "Em breve" da org: em_breve no registry OU ativo-mas-não-habilitado (D5). */
export function canaisEmBreve(habilitados: string[]): CanalInfo[] {
  return LISTA_CANAIS.filter((c) => c.status !== 'ativo' || !habilitados.includes(c.id));
}

/** Preto ou branco conforme a luminância da cor de fundo (WCAG aproximado). */
export function contrasteTexto(hex: string): '#000000' | '#ffffff' {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 150 ? '#000000' : '#ffffff';
}
