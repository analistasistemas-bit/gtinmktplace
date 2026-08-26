// E6b (ADR-0094, D-13): módulos pagos opcionais, habilitados por org pelo super-admin.
// Espelha o padrão de src/lib/canais.ts. Manter em sincronia com o MODULOS_VALIDOS da edge
// `usuarios` (não há geração automática — é uma lista curta e estável).
//
// Esconder o menu é NAVEGAÇÃO, não fronteira de segurança (ADR-0047): quem gate de verdade
// são as edges `cadastrar-produto` e `entrada-estoque`, que recusam org sem o módulo com 403.
import type { MenuKey } from './menus';

export type ModuloId = 'estoque' | 'pulse' | 'fiscal';

export interface Modulo {
  id: ModuloId;
  nome: string;
  descricao: string;
  /** Menu que só aparece com o módulo habilitado. O módulo fiscal não tem menu próprio. */
  menu?: MenuKey;
}

export const MODULOS: Modulo[] = [
  {
    id: 'estoque',
    nome: 'Estoque',
    descricao: 'Cadastrar produto sem planilha, dar entrada de mercadoria e controlar saldo.',
    menu: 'estoque',
  },
  {
    id: 'pulse',
    nome: 'Pulse',
    descricao: 'Inteligência de mercado: concorrência, alertas e price-to-win (ADR-0119).',
    menu: 'pulse',
  },
  {
    id: 'fiscal',
    nome: 'Fiscal',
    descricao: 'Cadastro fiscal de empresa e produtos + prontidão de nota no Faturador do ML (ADR-0135). Exige organização PJ.',
  },
];

/** Menus que devem sumir da navegação porque o módulo dono deles não está habilitado. */
export function menusDeModulosDesabilitados(habilitados: string[]): MenuKey[] {
  const ativos = new Set(habilitados);
  return MODULOS.filter((m) => m.menu != null && !ativos.has(m.id)).map((m) => m.menu!);
}
