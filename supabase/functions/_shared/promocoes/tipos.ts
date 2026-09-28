// tipos.ts
import type { Comissao } from '../preco/sugerir.ts';
import type { DimensoesPacote } from '../ml/pacote.ts';

export type Semaforo = 'verde' | 'amarelo' | 'vermelho' | 'indisponivel';
export type Origem = 'nacional' | 'importado' | null;
/** Kit (ADR-0151): unidades do anúncio ≠ cadastro, GTIN/SKU apontando cadastros diferentes, ou kit sem medidas. */
export type MotivoKit = 'kit_divergente' | 'kit_ambiguo' | 'kit_sem_dimensao';
export type MotivoSemLiquido = 'sem_cadastro' | 'sem_custo' | 'sem_origem' | 'sem_preco' | 'sem_categoria' | 'erro_tarifa' | MotivoKit;

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
export interface VariacaoML {
  variation_id: number; cor: string | null; sku: string | null; gtin: string | null;
  /** UNITS_PER_PACK da variação, quando a categoria permite por variação; senão vale o do item. */
  unidades?: number | null;
}
export interface ItemML {
  id: string; titulo: string | null; thumbnail: string | null; permalink: string | null;
  listing_type_id: string | null; categoria: string | null; sku: string | null; gtin: string | null;
  /** UNITS_PER_PACK do anúncio (kit); null = o ML não informa. */
  unidades: number | null;
  /** SALE_FORMAT=Kit: sinal de pack mesmo sem UNITS_PER_PACK (categoria que não o expõe, ADR-0151). */
  formato_kit: boolean;
  variacoes: VariacaoML[];
}
export interface CadastroVariacao {
  variacao_id: string; custo: number | null; piso: number | null; origem: Origem;
  cor: string | null; codigo: string | null; dim: DimensoesPacote | null;
  /** Unidades que custo/piso/dim representam: familias.kit_multiplicador do kit próprio, senão 1. */
  kit: number;
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
