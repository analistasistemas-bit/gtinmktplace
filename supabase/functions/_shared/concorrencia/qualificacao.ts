export const MIN_TRANSACOES_RELEVANTE = 10;

export type MotivoQualificacao = 'QUALIFICADO' | 'DADOS_INSUFICIENTES' |
  'POUCAS_TRANSACOES' | 'SEM_VISITAS_30D' | 'REPUTACAO_BAIXA';
export type StatusQualificacao = 'relevante' | 'observacao' | 'fora_referencia';

export interface OfertaQualificavel {
  item_id: string; seller_id: number; preco: number;
  frete_gratis: boolean; full: boolean;
  transactions_total: number | null; visitas_30d: number | null; nivel: string | null;
}
export interface QualificacaoOferta { status: StatusQualificacao; motivos: MotivoQualificacao[] }
export interface OfertaClassificada extends OfertaQualificavel { qualificacao: QualificacaoOferta }
export interface MercadoQualificado {
  ofertas: OfertaClassificada[];
  menor_observado: number | null; menor_relevante: number | null; maior_relevante: number | null;
  total_observadas: number; total_relevantes: number;
  vendedores_observados: number; vendedores_relevantes: number;
  frete_gratis_relevantes: number; full_relevantes: number;
}

export function qualificarOferta(d: OfertaQualificavel): QualificacaoOferta {
  const motivos: MotivoQualificacao[] = [];
  if (d.transactions_total != null && d.transactions_total < MIN_TRANSACOES_RELEVANTE) motivos.push('POUCAS_TRANSACOES');
  if (d.visitas_30d === 0) motivos.push('SEM_VISITAS_30D');
  if (d.nivel === '1_red' || d.nivel === '2_orange') motivos.push('REPUTACAO_BAIXA');
  if (motivos.length) return { status: 'fora_referencia', motivos };
  if (d.transactions_total == null) return { status: 'observacao', motivos: ['DADOS_INSUFICIENTES'] };
  return { status: 'relevante', motivos: ['QUALIFICADO'] };
}

export function resumirMercadoQualificado(ofertas: OfertaQualificavel[]): MercadoQualificado {
  const classificadas = ofertas.map((oferta) => ({
    ...oferta,
    qualificacao: qualificarOferta(oferta),
  }));
  const relevantes = classificadas.filter(({ qualificacao }) => qualificacao.status === 'relevante');

  return {
    ofertas: classificadas,
    menor_observado: ofertas.length ? Math.min(...ofertas.map(({ preco }) => preco)) : null,
    menor_relevante: relevantes.length ? Math.min(...relevantes.map(({ preco }) => preco)) : null,
    maior_relevante: relevantes.length ? Math.max(...relevantes.map(({ preco }) => preco)) : null,
    total_observadas: ofertas.length,
    total_relevantes: relevantes.length,
    vendedores_observados: new Set(ofertas.map(({ seller_id }) => seller_id)).size,
    vendedores_relevantes: new Set(relevantes.map(({ seller_id }) => seller_id)).size,
    frete_gratis_relevantes: relevantes.filter(({ frete_gratis }) => frete_gratis).length,
    full_relevantes: relevantes.filter(({ full }) => full).length,
  };
}
