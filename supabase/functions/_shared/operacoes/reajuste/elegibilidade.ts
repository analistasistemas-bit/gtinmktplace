// I5 — elegibilidade do item ao reajuste (preview e execução). Verificação inconclusiva = inelegível.
import { centavos } from './alvo.ts';
import { maiorOferta } from './ofertas.ts';
import type { OfertaVigente, VivoItem } from './tipos.ts';

export interface FatosElegibilidade {
  vivo: VivoItem; ehKit: boolean; temAtacado: boolean;
  ofertas: OfertaVigente[] | null;   // ML ao vivo unido ao banco (null = inconclusiva)
  familiaPublicando: boolean; migracaoPxv: boolean;
}

const STATUS_OK = new Set(['active', 'paused']);
const SUB_STATUS_BLOQUEIA = new Set(['forbidden', 'waiting_for_patch', 'poor_quality_thumbnail', 'poor_quality_picture']);
const RELAMPAGO = new Set(['LIGHTNING', 'SMART_LIGHTNING']);
const MSG_INCONCLUSIVA = 'Não foi possível conferir promoções — tente de novo';

export function motivoInelegivel(f: FatosElegibilidade): string | null {
  if (!STATUS_OK.has(f.vivo.status) || f.vivo.sub_status.some((s) => SUB_STATUS_BLOQUEIA.has(s))) {
    return 'Anúncio moderado, encerrado ou inativo';
  }
  if (f.ehKit) return 'Kit Virtual não entra no reajuste';
  if (f.vivo.catalog_listing || f.vivo.tem_relacoes) return 'Anúncio de catálogo (ou com par de catálogo) fica fora do reajuste';
  if (f.temAtacado) return 'Anúncio com preço de atacado fica fora do reajuste';
  if (f.ofertas === null) return MSG_INCONCLUSIVA;
  // Sai quando o Teste 2 passar: mudar o base com Relâmpago `started` ainda não foi medido (ADR-0196).
  if (f.ofertas.some((o) => o.status === 'started' && RELAMPAGO.has(o.tipo))) return 'Relâmpago em andamento fica fora do reajuste';
  if (f.familiaPublicando) return 'Família em publicação/atualização';
  if (f.migracaoPxv) return 'Migração para preço por variação em curso';
  return null;
}

/** ADR-0196: baixar o base até a oferta a remove, e restaurar o base não a traz de volta. */
export function motivoTravaOferta(alvo: number, ofertas: OfertaVigente[]): string | null {
  if (!ofertas.length) return null;
  const maior = maiorOferta(ofertas);
  if (maior === null) return MSG_INCONCLUSIVA;
  if (centavos(alvo) > centavos(maior)) return null;
  return `Preço igual ou abaixo da oferta de R$ ${maior.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} — ajuste a oferta antes`;
}
