// tipos.ts
import type { Comissao } from '../preco/sugerir.ts';
import type { DimensoesPacote } from '../ml/pacote.ts';

export type Semaforo = 'verde' | 'amarelo' | 'vermelho' | 'indisponivel';
export type Origem = 'nacional' | 'importado' | null;
export type MotivoSemLiquido = 'sem_cadastro' | 'sem_custo' | 'sem_origem' | 'sem_preco' | 'sem_categoria';

export interface Tarifa { comissao: Comissao; frete: number }
export interface Aliquotas { nacional: number; importado: number }

export interface PromocaoML {
  id: string; tipo: string; nome: string | null; status: string;
  inicio: string | null; fim: string | null; prazo_adesao: string | null;
  beneficios: Record<string, unknown> | null; bruto: unknown;
}
export interface ItemPromocaoML {
  ml_item_id: string; status: string;
  preco_original: number | null; preco_promo: number | null;
  preco_min: number | null; preco_max: number | null; preco_sugerido: number | null;
  ml_pct: number | null; vendedor_pct: number | null;
  estoque_min: number | null; estoque_max: number | null;
}
export interface VariacaoML { variation_id: number; cor: string | null; sku: string | null; gtin: string | null }
export interface ItemML {
  id: string; titulo: string | null; thumbnail: string | null; permalink: string | null;
  listing_type_id: string | null; categoria: string | null; sku: string | null; gtin: string | null;
  variacoes: VariacaoML[];
}
export interface CadastroVariacao {
  variacao_id: string; custo: number | null; piso: number | null; origem: Origem;
  cor: string | null; codigo: string | null; dim: DimensoesPacote | null;
}
export interface ProjecaoCor {
  variation_id: number | null; cor: string | null; sku: string | null;
  custo: number | null; piso: number | null; origem: Origem;
  comissao_pct: number | null; comissao_fixa: number | null; frete: number | null; aliquota_pct: number | null;
  liquido: number | null; ate_quanto: number | null; ate_quanto_motivo: 'qualquer' | 'nenhum' | null;
  semaforo: Semaforo; motivo: MotivoSemLiquido | null;
}
export interface LinhaItem extends ItemPromocaoML {
  titulo: string | null; thumbnail: string | null; permalink: string | null; listing_type_id: string | null;
  preco_avaliado: number | null; projecao: ProjecaoCor[]; pior_semaforo: Semaforo;
}
export interface Contagem {
  convidados: number; convidados_verde: number; participando: number; verde: number; amarelo: number;
  vermelho: number; indisponivel: number; participando_vermelho: number;
  /** Maior parte do desconto bancada pelo ML entre os anúncios (meli_percentage); `benefits` da promoção vem nulo (Task 0). */
  ml_pct_max: number | null;
}
