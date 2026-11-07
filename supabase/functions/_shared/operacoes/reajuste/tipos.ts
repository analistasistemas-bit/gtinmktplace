// I5 — reajuste de preço em massa: tipos do núcleo puro (spec 2026-10-04, C1/C3/C4/C5).
export type TipoAjuste = 'pct' | 'reais' | 'definir';
/** Em `definir`, `valor` é o preço final e `sentido` é ignorado (ADR-0196). */
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
/** `preco` null = oferta sem preço comprovado: bloqueia a escrita. A Relâmpago pode ter várias na mesma campanha (ADR-0196). */
export interface OfertaVigente {
  chave: string; promocao_id: string; tipo: string; status: 'started' | 'pending'; preco: number | null;
  offer_id: string | null; inicio: string | null; fim: string | null;
}
export interface FaixaPreco { min_unidades: number; preco: number }
/** Item com passo em estado de volta nunca retoma a ida. */
export type EstadoPasso = 'pendente' | 'escrita_pedida' | 'confirmado' | 'volta_pendente' | 'volta_pedida' | 'compensado';
export type Passo =
  | { tipo: 'saida'; oferta: OfertaVigente; estado: EstadoPasso }
  | { tipo: 'oferta'; oferta: OfertaVigente; anterior: number; alvo: number; estado: EstadoPasso }
  | { tipo: 'faixas'; anterior: FaixaPreco[]; alvo: FaixaPreco[]; estado: EstadoPasso }
  | { tipo: 'base'; anterior: number; alvo: number; estado: EstadoPasso };
export interface VivoItem {
  preco: number | null; variacoes: { id: string; preco: number }[] | null; status: string;
  sub_status: string[]; catalog_listing: boolean; tem_relacoes: boolean;
}
