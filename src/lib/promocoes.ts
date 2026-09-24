// ADR-0170 — leitura da Central de Promoções (o sync grava; aqui só lemos) + regras de exibição puras.
import { supabase } from '@/lib/supabase';
import { buscarTodasPaginas } from '@/lib/paginacao-supabase';

export type SemaforoPromo = 'verde' | 'amarelo' | 'vermelho' | 'indisponivel';
export interface ContagemPromo {
  convidados: number; convidados_verde: number; participando: number; verde: number; amarelo: number;
  vermelho: number; indisponivel: number; participando_vermelho: number;
  /** Maior parte do desconto bancada pelo ML entre os anúncios (meli_percentage); `benefits` da promoção vem nulo (Task 0). */
  ml_pct_max: number | null;
}
export interface Promocao {
  promocao_id: string; tipo: string; nome: string | null; status: string;
  inicio: string | null; fim: string | null; prazo_adesao: string | null;
  beneficios: Record<string, unknown> | null; contagem: ContagemPromo | null;
  erro: string | null; itens_sincronizados_em: string | null; rodada_em_curso: string | null;
}
export interface CorProjetada {
  variation_id: number | null; cor: string | null; sku: string | null;
  custo: number | null; piso: number | null; origem: string | null;
  liquido: number | null; ate_quanto: number | null; ate_quanto_motivo: 'qualquer' | 'nenhum' | null;
  semaforo: SemaforoPromo; motivo: string | null;
}
export interface ItemPromocao {
  ml_item_id: string; status: string;
  preco_original: number | null; preco_promo: number | null; preco_min: number | null; preco_max: number | null;
  preco_sugerido: number | null; preco_avaliado: number | null; ml_pct: number | null; estoque_min: number | null;
  titulo: string | null; thumbnail: string | null; permalink: string | null;
  projecao: CorProjetada[]; pior_semaforo: SemaforoPromo;
}
export interface EstadoSyncPromo {
  estado: 'sincronizando' | 'ok' | 'sem_acesso' | 'sem_promocoes' | 'erro';
  iniciado_em: string | null; ultimo_ok_em: string | null; ultimo_erro_em: string | null; erro: string | null;
}
export type AbaPromo = 'ativas' | 'futuras' | 'encerradas';

/** Área de promoções do Seller Center (confirmada na Task 0 do plano). */
export const URL_PROMOCOES_ML = 'https://www.mercadolivre.com.br/anuncios/promocoes';

const TIPOS: Record<string, string> = {
  DEAL: 'Campanha', MARKETPLACE_CAMPAIGN: 'Campanha do ML', SMART: 'Co-participação',
  LIGHTNING: 'Relâmpago', PRICE_MATCHING: 'Preço competitivo', PRICE_DISCOUNT: 'Desconto próprio',
  SELLER_COUPON_CAMPAIGN: 'Cupom', VOLUME: 'Desconto por volume',
};
const DIA = 86_400_000;

export const ehCupom = (tipo: string) => tipo === 'SELLER_COUPON_CAMPAIGN';
export const rotuloTipo = (tipo: string) => TIPOS[tipo] ?? tipo;

/** `fim` no passado encerra a campanha mesmo que o status gravado ainda diga ativa/futura. */
export function abaDa(p: Pick<Promocao, 'status' | 'fim'>, agoraMs: number): AbaPromo | null {
  const fim = p.fim ? Date.parse(p.fim) : NaN;
  const acabou = p.status === 'finished' || (Number.isFinite(fim) && fim < agoraMs);
  if (!acabou) return p.status === 'started' ? 'ativas' : p.status === 'pending' ? 'futuras' : null;
  return Number.isFinite(fim) && fim >= agoraMs - 30 * DIA ? 'encerradas' : null;
}

/** A leitura dos anúncios de uma campanha está em curso (reserva de 30 min, igual a RESERVA_MIN do worker). */
export function emLeitura(p: Pick<Promocao, 'rodada_em_curso'>, agoraMs: number): boolean {
  const t = p.rodada_em_curso ? Date.parse(p.rodada_em_curso) : NaN;
  return Number.isFinite(t) && agoraMs - t < 30 * 60_000;
}

/** A etapa de lista está rodando: execução que caiu no meio deixa 'sincronizando' para trás, só vale se começou há < 5 min
 *  (TRAVA_LISTA_MS do worker). */
export function sincronizandoAgora(e: Pick<EstadoSyncPromo, 'estado' | 'iniciado_em'> | null, agoraMs: number): boolean {
  return e?.estado === 'sincronizando' && agoraMs - Date.parse(e.iniciado_em ?? '') < 5 * 60_000;
}

export function descontoPct(original: number | null, promo: number | null): number | null {
  if (original == null || promo == null || original <= 0) return null;
  return Math.round((1 - promo / original) * 100);
}

export function prazoUrgente(prazo: string | null, agoraMs: number): boolean {
  const t = prazo ? Date.parse(prazo) : NaN;
  return Number.isFinite(t) && t > agoraMs && t - agoraMs <= 2 * DIA;
}

/** A cor que dá o semáforo do anúncio (a pior com líquido; menor líquido no empate). */
export function corDeReferencia(it: ItemPromocao): CorProjetada | null {
  const comLiquido = it.projecao.filter((c) => c.liquido != null && c.semaforo === it.pior_semaforo);
  return comLiquido.sort((a, b) => a.liquido! - b.liquido!)[0] ?? null;
}

/** ⚪: "Sem custo no PubliAI" só quando nenhuma cor tem cadastro/custo; senão o motivo é outro (tarifa, categoria…). */
export function rotuloSemLiquido(it: ItemPromocao): 'Sem custo no PubliAI' | 'Sem líquido' {
  const motivos = it.projecao.map((c) => c.motivo);
  return motivos.length > 0 && motivos.every((m) => m === 'sem_cadastro' || m === 'sem_custo') ? 'Sem custo no PubliAI' : 'Sem líquido';
}

/** O preço tem de servir a todas as cores: vale o maior "até quanto"; uma cor sem saída trava o anúncio. */
export function ateQuantoDaLinha(it: ItemPromocao): { valor: number | null; motivo: 'qualquer' | 'nenhum' | null } {
  const cores = it.projecao.filter((c) => c.liquido != null);
  if (cores.some((c) => c.ate_quanto_motivo === 'nenhum')) return { valor: null, motivo: 'nenhum' };
  const valores = cores.map((c) => c.ate_quanto).filter((v): v is number => v != null);
  if (valores.length) return { valor: Math.max(...valores), motivo: null };
  if (cores.length && cores.every((c) => c.ate_quanto_motivo === 'qualquer')) return { valor: null, motivo: 'qualquer' };
  return { valor: null, motivo: null };
}

/** Convidado = `candidate`; participando = `started` ou `pending` (inscrito em campanha futura); outro status não aparece. */
export function filtrarItens(itens: ItemPromocao[], f: { semaforo: SemaforoPromo | null; participando: boolean }): ItemPromocao[] {
  return itens.filter((i) => (f.participando ? i.status === 'started' || i.status === 'pending' : i.status === 'candidate')
    && (f.semaforo == null || i.pior_semaforo === f.semaforo));
}

const COLS_PROMO = 'promocao_id, tipo, nome, status, inicio, fim, prazo_adesao, beneficios, contagem, erro, itens_sincronizados_em, rodada_em_curso';
const COLS_ITEM = 'ml_item_id, status, preco_original, preco_promo, preco_min, preco_max, preco_sugerido, preco_avaliado, ml_pct, estoque_min, titulo, thumbnail, permalink, projecao, pior_semaforo';

export async function fetchPromocoes(): Promise<Promocao[]> {
  const { data, error } = await supabase.from('ml_promocoes').select(COLS_PROMO)
    .order('prazo_adesao', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Promocao[];
}

export async function fetchItensPromocao(promocaoId: string): Promise<ItemPromocao[]> {
  return buscarTodasPaginas<ItemPromocao>((de, ate) =>
    supabase.from('ml_promocao_itens').select(COLS_ITEM).eq('promocao_id', promocaoId)
      .order('ml_item_id').range(de, ate) as never);
}

export async function fetchEstadoSyncPromocoes(): Promise<EstadoSyncPromo | null> {
  const { data, error } = await supabase.from('ml_promocoes_sync')
    .select('estado, iniciado_em, ultimo_ok_em, ultimo_erro_em, erro').maybeSingle();
  if (error) throw error;
  return (data as EstadoSyncPromo | null) ?? null;
}
