// I5 — elegibilidade do item ao reajuste (preview e execução). Verificação inconclusiva = inelegível.
import type { VivoItem } from './tipos.ts';

export interface FatosElegibilidade {
  vivo: VivoItem; ehKit: boolean; temAtacado: boolean;
  promocaoBanco: boolean;            // ml_promocao_itens pending/started
  promocaoML: boolean | null;        // leitura fresca (null = inconclusiva)
  familiaPublicando: boolean; migracaoPxv: boolean;
}

const STATUS_OK = new Set(['active', 'paused']);
const SUB_STATUS_BLOQUEIA = new Set(['forbidden', 'waiting_for_patch', 'poor_quality_thumbnail', 'poor_quality_picture']);

export function motivoInelegivel(f: FatosElegibilidade): string | null {
  if (!STATUS_OK.has(f.vivo.status) || f.vivo.sub_status.some((s) => SUB_STATUS_BLOQUEIA.has(s))) {
    return 'Anúncio moderado, encerrado ou inativo';
  }
  if (f.ehKit) return 'Kit Virtual não entra no reajuste';
  if (f.vivo.catalog_listing || f.vivo.tem_relacoes) return 'Anúncio de catálogo (ou com par de catálogo) fica fora do reajuste';
  if (f.temAtacado) return 'Anúncio com preço de atacado fica fora do reajuste';
  if (f.promocaoBanco || f.promocaoML === true) return 'Participando de promoção';
  if (f.promocaoML === null) return 'Não foi possível conferir promoções — tente de novo';
  if (f.familiaPublicando) return 'Família em publicação/atualização';
  if (f.migracaoPxv) return 'Migração para preço por variação em curso';
  return null;
}
