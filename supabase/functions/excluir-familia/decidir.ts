// ADR-0199 — pode tirar esta família da Revisão? Pura: as leituras chegam prontas, `undefined` = falhou.
import { chaveVinculo } from '../_shared/lote/exclusao.ts';

export type MotivoRecusa = 'publicada' | 'em_voo' | 'vinculada' | 'kit' | 'nao_conferido';
type Variacoes = { ml_variation_id: string | null }[];
export interface EntradaDecisao {
  alvo: { status: string | null; publicado_em: string | null; ml_item_id: string | null; variacoes: Variacoes };
  /** Outras famílias da org com o mesmo `codigo_pai` ou o mesmo `ml_item_id`. */
  irmas: { ml_item_id: string | null; variacoes: Variacoes }[] | undefined;
  /** `anuncios_externos` da org com o `codigo_pai`, com os filhos (User Products). */
  externos: {
    status: string | null;
    item_externo_id: string | null;
    anuncios_externos_itens?: { status: string | null; item_externo_id: string | null }[];
  }[] | undefined;
  /** Famílias que usam o `codigo_pai` como base de kit vinculado. */
  kitsDependentes: number | undefined;
}

const RAIZ_EM_VOO = ['pendente', 'publicando'];
// ADR-0088: saga UP interrompida e a janela `criacao_incerta` (POST saiu, id ainda não voltou).
const FILHO_EM_VOO = ['pendente', 'criacao_incerta', 'compensacao_pendente', 'remocao_pendente'];

export function decidirExclusaoFamilia(e: EntradaDecisao): { ok: true } | { ok: false; motivo: MotivoRecusa } {
  const recusa = (motivo: MotivoRecusa) => ({ ok: false as const, motivo });
  const { alvo, irmas, externos, kitsDependentes } = e;
  if (alvo.publicado_em != null) return recusa('publicada');
  if (alvo.status !== 'pronto' && alvo.status !== 'erro') return recusa('em_voo');
  // Trava fechada: sem saber se há anúncio vivo, apagar pode deixar um órfão vendendo sem baixar estoque.
  if (irmas === undefined || externos === undefined || kitsDependentes === undefined) return recusa('nao_conferido');

  const filhos = externos.flatMap((x) => x.anuncios_externos_itens ?? []);
  if (externos.some((x) => RAIZ_EM_VOO.includes(x.status ?? ''))
    || filhos.some((i) => FILHO_EM_VOO.includes(i.status ?? ''))) return recusa('em_voo');

  const representada = irmas.length > 0;
  // `publicado` sem id é inconsistente: conta como evidência remota (excluir-produto faz igual).
  const remoto = externos.some((x) => x.item_externo_id != null || x.status === 'publicado')
    || filhos.some((i) => i.item_externo_id != null);
  if (remoto && !representada) return recusa('vinculada');

  // Incidente Xik 2026-08-13: o UPDATE criou a cor no ML sem marcar `publicado_em`. Se nenhuma
  // irmã carrega esse vínculo, apagar esta linha deixa a variação viva sem representante.
  const cobertos = new Set(irmas.flatMap((i) => i.variacoes.map((v) => chaveVinculo(i.ml_item_id, v.ml_variation_id))));
  if (alvo.variacoes.some((v) => {
    const k = chaveVinculo(alvo.ml_item_id, v.ml_variation_id);
    return k !== null && !cobertos.has(k);
  })) return recusa('vinculada');

  if (!representada && kitsDependentes > 0) return recusa('kit');
  return { ok: true };
}
