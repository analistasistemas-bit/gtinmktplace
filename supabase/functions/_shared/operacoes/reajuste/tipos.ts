// I5 — reajuste de preço em massa: tipos do núcleo puro (spec 2026-10-04, C1/C3/C4/C5).
export type TipoAjuste = 'pct' | 'reais';
export interface Ajuste { tipo: TipoAjuste; sentido: '+' | '-'; valor: number }
export type Semaforo = 'verde' | 'amarelo' | 'vermelho' | 'indisponivel';
export interface CorAvaliada {
  variation_id: string | null; sku: string | null; custo: number | null; piso: number | null;
  origem: 'nacional' | 'importado' | null; aliquota_pct: number | null; comissao_pct: number | null; comissao_fixa: number | null;
  frete: number | null; liquido: number | null; semaforo: Semaforo; motivo: string | null;
}
export interface Avaliacao { cores: CorAvaliada[]; pior: Semaforo; tem_vermelho: boolean; tem_sem_dado: boolean }
export interface EstadoVariacao { preco_publicacao: number | null; preco_editado_pelo_operador: boolean }
/** Tipo ÚNICO usado no preview, executor e RPC. */
export interface EntradaRestauracao { variacao_id: string; esperado: EstadoVariacao; novo: EstadoVariacao }
export type Etapa = 'escrita_pedida' | 'ml_confirmado' | null;
export interface VivoItem {
  preco: number | null; variacoes: { id: string; preco: number }[] | null; status: string;
  sub_status: string[]; catalog_listing: boolean; tem_relacoes: boolean;
}
