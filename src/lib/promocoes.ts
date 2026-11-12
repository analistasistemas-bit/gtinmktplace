// ADR-0170 — leitura da Central de Promoções (o sync grava; aqui só lemos) + regras de exibição puras.
import { supabase } from '@/lib/supabase';
import { buscarTodasPaginas } from '@/lib/paginacao-supabase';
import { formatarNomeProduto } from '@/lib/texto';
import { normGtin } from '@/lib/gtin';

export type SemaforoPromo = 'verde' | 'amarelo' | 'vermelho' | 'indisponivel';
export interface ContagemPromo {
  convidados: number; convidados_verde: number; participando: number; verde: number; amarelo: number;
  vermelho: number; indisponivel: number; participando_vermelho: number;
  /** Maior parte do desconto bancada pelo ML entre os anúncios (meli_percentage); `benefits` da promoção vem nulo (Task 0). */
  ml_pct_max: number | null;
  /** Semáforo só dos convidados; ausente em contagem gravada antes de 12/11 (até o próximo sync). */
  convidados_semaforo?: Record<SemaforoPromo, number>;
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
  comissao_pct: number | null; comissao_fixa: number | null; frete: number | null; aliquota_pct: number | null;
  liquido: number | null; ate_quanto: number | null; ate_quanto_motivo: 'qualquer' | 'nenhum' | null;
  semaforo: SemaforoPromo; motivo: string | null;
}
export type TipoPromocaoOperavel = 'DEAL' | 'SMART' | 'LIGHTNING' | 'SMART_LIGHTNING' | 'PRICE_MATCHING';
export const ehTipoOperavel = (t: string | null | undefined): t is TipoPromocaoOperavel =>
  t === 'DEAL' || t === 'SMART' || t === 'LIGHTNING' || t === 'SMART_LIGHTNING' || t === 'PRICE_MATCHING';
/** Oferta de preço fixo do ML: o preço exibido não se edita, mas vai no pedido (o backend o compara com o do ML). */
export const ehOfertaFixa = (t: string | null | undefined) => t === 'SMART_LIGHTNING' || t === 'PRICE_MATCHING';
/** Tipo que o ML trouxe e o PubliAI ainda não ativa (cupom é do vendedor, não é para aderir). */
export const ehTipoSoSellerCenter = (t: string | null | undefined) => !ehTipoOperavel(t) && t !== 'SELLER_COUPON_CAMPAIGN';

export interface ItemPromocao {
  ml_item_id: string; status: string;
  preco_original: number | null; preco_promo: number | null; preco_min: number | null; preco_max: number | null;
  preco_sugerido: number | null; preco_avaliado: number | null; ml_pct: number | null; estoque_min: number | null;
  titulo: string | null; thumbnail: string | null; permalink: string | null;
  projecao: CorProjetada[]; pior_semaforo: SemaforoPromo;
  /** Linha do catálogo exibida com a cara do normal do mesmo User Product (ADR-0174, emenda 2026-10-05). */
  anuncio_normal_id?: string | null;
  /** Tipo do anúncio no ML: gold_special (Clássico) ou gold_pro (Premium). */
  listing_type_id?: string | null;
  /** Relâmpago: participa num horário e tem convite aberto para outro (ADR-0174, emenda 2026-11-08 (2)). Aparece
   *  nas duas abas; preco_min/max/sugerido são os do convite. */
  convite_aberto?: boolean;
}
/** Item participando, com a campanha (aba "Em promoção"). */
export type Participacao = ItemPromocao & { promocao_id: string };
export interface GrupoParticipacao { promocao: Promocao; itens: Participacao[]; operavel: boolean }
export interface EstadoSyncPromo {
  estado: 'sincronizando' | 'ok' | 'sem_acesso' | 'sem_promocoes' | 'erro';
  iniciado_em: string | null; ultimo_ok_em: string | null; ultimo_erro_em: string | null; erro: string | null;
}
export type AbaPromo = 'ativas' | 'futuras' | 'encerradas';

/** Área de promoções do Seller Center (confirmada na Task 0 do plano). */
export const URL_PROMOCOES_ML = 'https://www.mercadolivre.com.br/anuncios/promocoes';

const TIPOS: Record<string, string> = {
  DEAL: 'Campanha', MARKETPLACE_CAMPAIGN: 'Campanha do ML', SMART: 'Co-participação', SMART_LIGHTNING: 'Relâmpago co-participação',
  LIGHTNING: 'Relâmpago', PRICE_MATCHING: 'Preço competitivo', PRICE_DISCOUNT: 'Desconto próprio',
  SELLER_COUPON_CAMPAIGN: 'Cupom', VOLUME: 'Desconto por volume',
};
const DIA = 86_400_000;

/** Status da campanha no ML (o cartão da Central e o dossiê do SKU). */
export const STATUS_CAMPANHA: Record<string, string> = { started: 'Ativa', pending: 'Futura', finished: 'Encerrada' };
export const STATUS_CAMPANHA_DOT: Record<string, string> = { started: 'bg-success', pending: 'bg-info', finished: 'bg-muted-foreground/50' };

export const ehCupom = (tipo: string) => tipo === 'SELLER_COUPON_CAMPAIGN';
export const rotuloTipo = (tipo: string) => TIPOS[tipo] ?? tipo;

/** `fim` no passado encerra a campanha mesmo que o status gravado ainda diga ativa/futura. */
export function abaDa(p: Pick<Promocao, 'status' | 'fim'>, agoraMs: number): AbaPromo | null {
  const fim = p.fim ? Date.parse(p.fim) : NaN;
  const acabou = p.status === 'finished' || (Number.isFinite(fim) && fim < agoraMs);
  if (!acabou) return p.status === 'started' ? 'ativas' : p.status === 'pending' ? 'futuras' : null;
  return Number.isFinite(fim) && fim >= agoraMs - 30 * DIA ? 'encerradas' : null;
}

/** MLB que a tela mostra: o normal quando a linha é do catálogo do mesmo User Product (a operação segue no catálogo). */
export const mlbExibido = (it: Pick<ItemPromocao, 'ml_item_id' | 'anuncio_normal_id'>) => it.anuncio_normal_id ?? it.ml_item_id;
export const rotuloMlb = (it: Pick<ItemPromocao, 'ml_item_id' | 'anuncio_normal_id'>) =>
  (it.anuncio_normal_id ? `${it.anuncio_normal_id} · promoção via catálogo ${it.ml_item_id}` : it.ml_item_id);

/** Aba "Em promoção": só campanhas ativas/futuras (não cupom), pelo fim mais próximo; DEAL/SMART saem pelo motor. */
export function agruparParticipacoes(itens: Participacao[], promocoes: Promocao[], agoraMs: number): GrupoParticipacao[] {
  const vivas = new Map(promocoes.filter((p) => !ehCupom(p.tipo) && (abaDa(p, agoraMs) === 'ativas' || abaDa(p, agoraMs) === 'futuras'))
    .map((p) => [p.promocao_id, p]));
  const grupos = new Map<string, GrupoParticipacao>();
  for (const it of itens) {
    const promocao = vivas.get(it.promocao_id);
    if (!promocao) continue;
    const g = grupos.get(it.promocao_id) ?? { promocao, itens: [], operavel: ehTipoOperavel(promocao.tipo) };
    g.itens.push(it);
    grupos.set(it.promocao_id, g);
  }
  // Dentro da campanha: ordem de descrição (o que aparece na linha), desempate pelo MLB — pedido do Diego, 03/11.
  const desc = (i: Participacao) => formatarNomeProduto(i.titulo) || i.ml_item_id;
  for (const g of grupos.values()) {
    g.itens.sort((a, b) => desc(a).localeCompare(desc(b), 'pt-BR', { sensitivity: 'base', numeric: true })
      || a.ml_item_id.localeCompare(b.ml_item_id));
  }
  const fim = (g: GrupoParticipacao) => (g.promocao.fim ? Date.parse(g.promocao.fim) : Infinity);
  return [...grupos.values()].sort((a, b) => fim(a) - fim(b));
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

/** Toast do "Atualizar agora": a edge responde 200 com o estado da etapa de lista, inclusive em falha. */
export function avisoAtualizacao(r: { estado?: string } | null | undefined): { tipo: 'sucesso' | 'erro' | 'info'; texto: string } {
  switch (r?.estado) {
    case 'ok': return { tipo: 'sucesso', texto: 'Campanhas atualizadas. Buscando os anúncios de cada uma…' };
    case 'sem_promocoes': return { tipo: 'sucesso', texto: 'Atualizado: nenhuma promoção disponível agora no Mercado Livre.' };
    case 'sem_acesso': return { tipo: 'erro', texto: 'Sem acesso às promoções do Mercado Livre nesta conta. Confira a conexão em Canais.' };
    case 'erro': return { tipo: 'erro', texto: 'Não foi possível atualizar as promoções. Tente de novo em alguns minutos.' };
    case 'sincronizando': return { tipo: 'info', texto: 'Já existe uma atualização em andamento.' };
    default: return { tipo: 'info', texto: 'Atualização solicitada.' };
  }
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
/** Uma cor com kit a conferir (`kit_*`) trava a linha inteira: nada de líquido, markup nem "até quanto". */
const temKitAConferir = (it: ItemPromocao) => it.projecao.some((c) => c.motivo?.startsWith('kit_'));

export function corDeReferencia(it: ItemPromocao): CorProjetada | null {
  if (temKitAConferir(it)) return null;
  const comLiquido = it.projecao.filter((c) => c.liquido != null && c.semaforo === it.pior_semaforo);
  return comLiquido.sort((a, b) => a.liquido! - b.liquido!)[0] ?? null;
}

/** ⚪: "Sem custo no PubliAI" só quando nenhuma cor tem cadastro/custo; senão o motivo é outro (tarifa, categoria…). */
export function rotuloSemLiquido(it: ItemPromocao): 'Sem custo no PubliAI' | 'Sem líquido' | 'Kit a conferir' {
  const motivos = it.projecao.map((c) => c.motivo);
  if (temKitAConferir(it)) return 'Kit a conferir';
  return motivos.length > 0 && motivos.every((m) => m === 'sem_cadastro' || m === 'sem_custo') ? 'Sem custo no PubliAI' : 'Sem líquido';
}

/** O preço tem de servir a todas as cores: vale o maior "até quanto"; uma cor sem saída trava o anúncio. */
export function ateQuantoDaLinha(it: ItemPromocao): { valor: number | null; motivo: 'qualquer' | 'nenhum' | null } {
  if (temKitAConferir(it)) return { valor: null, motivo: null };
  const cores = it.projecao.filter((c) => c.liquido != null);
  if (cores.some((c) => c.ate_quanto_motivo === 'nenhum')) return { valor: null, motivo: 'nenhum' };
  const valores = cores.map((c) => c.ate_quanto).filter((v): v is number => v != null);
  if (valores.length) return { valor: Math.max(...valores), motivo: null };
  if (cores.length && cores.every((c) => c.ate_quanto_motivo === 'qualquer')) return { valor: null, motivo: 'qualquer' };
  return { valor: null, motivo: null };
}

/** Abaixo disto o comprador perde o frete grátis (regra do Diego), em qualquer tipo de campanha. */
export const PRECO_MIN_PROMOCAO = 19;
/** Convidado com preço de campanha abaixo do piso não aparece; participante fica, para poder sair. */
export const convidadoAbaixoDoPiso = (i: Pick<ItemPromocao, 'status' | 'preco_avaliado'>) =>
  i.status === 'candidate' && i.preco_avaliado != null && i.preco_avaliado < PRECO_MIN_PROMOCAO;

/** DEAL inscrito com a campanha já ativa: o ML ainda não ativou (adesão depois do início fica horas assim, 12/11).
 *  Relâmpago e afins têm janela própria: `pending` em campanha ativa é o horário agendado ("começa depois"). */
export const aguardandoMl = (i: Pick<ItemPromocao, 'status'>, p: Pick<Promocao, 'status' | 'tipo'>) =>
  i.status === 'pending' && p.status === 'started' && p.tipo === 'DEAL';

/** Convidado = `candidate` (ou participando com convite de outro horário); participando = `started` ou `pending`
 *  (inscrito em campanha futura); outro status não aparece. */
export function filtrarItens(itens: ItemPromocao[], f: { semaforo: SemaforoPromo | null; participando: boolean }): ItemPromocao[] {
  return itens.filter((i) => (f.participando ? i.status === 'started' || i.status === 'pending' : i.status === 'candidate' || i.convite_aberto)
    && (f.semaforo == null || i.pior_semaforo === f.semaforo));
}

const COLS_PROMO = 'promocao_id, tipo, nome, status, inicio, fim, prazo_adesao, beneficios, contagem, erro, itens_sincronizados_em, rodada_em_curso';
const COLS_ITEM = 'ml_item_id, status, preco_original, preco_promo, preco_min, preco_max, preco_sugerido, preco_avaliado, ml_pct, estoque_min, titulo, thumbnail, permalink, projecao, pior_semaforo, anuncio_normal_id, listing_type_id, convite_aberto';

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

export interface PaiDoItem { codigo_pai: string; nome: string }
/** Chave do SKU no mapa de PAIs: sem zeros à esquerda, como `resolverCor` no servidor. */
export const chaveSku = (sku: string) => `sku:${normGtin(sku.trim())}`;

/** `MLB -> produto PAI` de todos os anúncios ML da org: anúncio (Legacy/partição) e cada SKU UP (ADR-0174 filtro por PAI). */
export async function fetchPaisPorItem(): Promise<Map<string, PaiDoItem>> {
  const [anuncios, itensUp, familias, variacoes] = await Promise.all([
    buscarTodasPaginas<{ item_externo_id: string; codigo_pai: string }>((de, ate) =>
      supabase.from('anuncios_externos').select('item_externo_id, codigo_pai').eq('canal', 'mercado_livre')
        .not('item_externo_id', 'is', null).order('id').range(de, ate) as never),
    buscarTodasPaginas<{ item_externo_id: string; anuncios_externos: { codigo_pai: string; canal: string } | null }>((de, ate) =>
      supabase.from('anuncios_externos_itens').select('item_externo_id, anuncios_externos!anuncios_externos_itens_pai_fk(codigo_pai, canal)')
        .eq('retirado', false).not('item_externo_id', 'is', null).order('id').range(de, ate) as never),
    buscarTodasPaginas<{ codigo_pai: string; nome_pai: string; ml_item_id: string | null }>((de, ate) =>
      supabase.from('familias').select('codigo_pai, nome_pai, ml_item_id').not('ml_item_id', 'is', null)
        .order('publicado_em', { ascending: false }).order('id').range(de, ate) as never),
    buscarTodasPaginas<{ codigo: string; familias: { codigo_pai: string } | null }>((de, ate) =>
      // Mais antigo primeiro: SKU repetido em PAIs diferentes fica com o cadastro mais recente.
      supabase.from('variacoes').select('codigo, familias(codigo_pai)').order('criado_em').order('id').range(de, ate) as never),
  ]);
  const nomes = new Map<string, string>();
  for (const f of familias) if (!nomes.has(f.codigo_pai)) nomes.set(f.codigo_pai, formatarNomeProduto(f.nome_pai) || f.codigo_pai);
  const pai = (codigo: string): PaiDoItem => ({ codigo_pai: codigo, nome: nomes.get(codigo) ?? codigo });
  const mapa = new Map<string, PaiDoItem>();
  for (const f of familias) if (f.ml_item_id) mapa.set(f.ml_item_id, pai(f.codigo_pai));
  for (const a of anuncios) mapa.set(a.item_externo_id, pai(a.codigo_pai));
  for (const i of itensUp) if (i.anuncios_externos?.canal === 'mercado_livre') mapa.set(i.item_externo_id, pai(i.anuncios_externos.codigo_pai));
  // Fallback por SKU (mesma ordem do servidor em `resolverCor`): chave prefixada para não colidir com MLB.
  for (const v of variacoes) if (v.familias) mapa.set(chaveSku(v.codigo), pai(v.familias.codigo_pai));
  return mapa;
}

export async function fetchParticipacoes(): Promise<Participacao[]> {
  return buscarTodasPaginas<Participacao>((de, ate) =>
    supabase.from('ml_promocao_itens').select(`promocao_id, ${COLS_ITEM}`).in('status', ['started', 'pending'])
      .order('promocao_id').order('ml_item_id').range(de, ate) as never);
}

/** Convites das campanhas vivas (ADR-0194): itens históricos ficam gravados, por isso o filtro por campanha no banco. */
export async function fetchConvites(promocaoIds: string[]): Promise<(ItemPromocao & { promocao_id: string })[]> {
  if (promocaoIds.length === 0) return [];
  return buscarTodasPaginas<ItemPromocao & { promocao_id: string }>((de, ate) =>
    supabase.from('ml_promocao_itens').select(`promocao_id, ${COLS_ITEM}`).eq('status', 'candidate').in('promocao_id', promocaoIds)
      .order('promocao_id').order('ml_item_id').range(de, ate) as never);
}

export async function fetchEstadoSyncPromocoes(): Promise<EstadoSyncPromo | null> {
  const { data, error } = await supabase.from('ml_promocoes_sync')
    .select('estado, iniciado_em, ultimo_ok_em, ultimo_erro_em, erro').maybeSingle();
  if (error) throw error;
  return (data as EstadoSyncPromo | null) ?? null;
}

/** Motivo de cor sem líquido (projeção da Central e avaliação do reajuste I5) → texto da tela. */
export const MOTIVO_COR: Record<string, string> = {
  sem_cadastro: 'Sem custo no PubliAI', sem_custo: 'Sem custo no PubliAI', sem_origem: 'Sem origem no cadastro',
  sem_preco: 'Sem preço na promoção', sem_categoria: 'Anúncio não lido no Mercado Livre', erro_tarifa: 'Tarifa do Mercado Livre indisponível',
  kit_divergente: 'Kit: unidades do anúncio diferentes do cadastro', kit_ambiguo: 'Kit: GTIN e SKU apontam cadastros diferentes',
  kit_sem_dimensao: 'Kit sem medidas no cadastro (frete incerto)',
};
