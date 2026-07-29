// E6b (ADR-0094, D-13): módulos pagos opcionais, habilitados por org pelo super-admin.
// Espelha o padrão de src/lib/canais.ts. Manter em sincronia com o MODULOS_VALIDOS da edge
// `usuarios` (não há geração automática — é uma lista curta e estável).
//
// Esconder o menu é NAVEGAÇÃO, não fronteira de segurança (ADR-0047): quem gate de verdade
// são as edges `cadastrar-produto` e `entrada-estoque`, que recusam org sem o módulo com 403.
import type { MenuKey } from './menus';

export type ModuloId = 'estoque';

export interface Modulo {
  id: ModuloId;
  nome: string;
  descricao: string;
  /** Menu que só aparece com o módulo habilitado. */
  menu: MenuKey;
}

export const MODULOS: Modulo[] = [
  {
    id: 'estoque',
    nome: 'Estoque',
    descricao: 'Cadastrar produto sem planilha, dar entrada de mercadoria e controlar saldo.',
    menu: 'estoque',
  },
];

/** Menus que devem sumir da navegação porque o módulo dono deles não está habilitado. */
export function menusDeModulosDesabilitados(habilitados: string[]): MenuKey[] {
  const ativos = new Set(habilitados);
  return MODULOS.filter((m) => !ativos.has(m.id)).map((m) => m.menu);
}
