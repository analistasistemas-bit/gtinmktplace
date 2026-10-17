// ADR-0181 Plano 2b-2 — modelo do inventário (JSON de inventario_hoje_json / inventario_foto_json).
// Aqui os valores vêm em REAIS (numeric do banco), não em centavos como vendas/compras.
export type StatusInventario = 'hoje' | 'aberto' | 'confirmado' | 'falhou';

export interface CabecalhoInventario {
  id?: string;                       // só na foto
  data_base: string;                 // AAAA-MM-DD
  gerado_em: string;                 // ISO — instante real da leitura do saldo
  status: StatusInventario;
  origem?: 'cron' | 'manual';
  erro?: string | null;
  versao?: number;
  cnpj: string | null; inscricao_estadual: string | null; razao_social: string | null;
  confirmado_em?: string | null; confirmado_por_nome?: string | null;
}

export interface ItemInventario {
  codigo: string; codigo_pai: string; descricao: string | null; ncm: string | null; unidade: string | null;
  cor: string | null; tamanho: string | null;
  quantidade_sistema: number; qtd_valorizada: number; qtd_sem_nota: number;
  custo_medio: number | null; valor_total: number; marcas: string[];
  // só na foto
  quantidade_contada?: number | null; justificativa?: string | null;
  qtd_final?: number | null; qtd_valorizada_final?: number | null; qtd_sem_nota_final?: number | null; valor_final?: number | null;
}

export interface LeituraInventario { cabecalho: CabecalhoInventario; itens: ItemInventario[] }

/** Corpo de `salvar` na edge `inventario`; contada null = igual ao sistema. */
export interface ContagemItem { codigo: string; quantidade_contada: number | null; justificativa: string | null }

export const AVISOS_INVENTARIO = [
  'Critério: custo médio ponderado móvel de aquisição, unidades sem nota saem primeiro.',
  'O saldo inclui o Full.',
  'Mercadoria de terceiros não é controlada.',
  'Devolução e escrita de planilha podem ser avaliadas para menos.',
  'É base para o Livro mod. 7, não a escrituração.',
] as const;
