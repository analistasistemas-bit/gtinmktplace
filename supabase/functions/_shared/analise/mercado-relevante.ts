import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { resumirMercadoQualificado, type OfertaQualificavel } from '../concorrencia/qualificacao.ts';
import type { OfertaVendedor } from '../concorrencia/tipos.ts';
import type { PerfilVendedor } from '../ml/perfil-vendedor.ts';
import type { Mercado, MercadoObservado } from './tipos.ts';

const MAX_IDADE_MS = 24 * 60 * 60 * 1000;
const LIMITE_CONCORRENCIA = 6;

type PerfilPulse = {
  seller_id: number;
  transactions_total: number | null;
  nivel: string | null;
  perfil_coletado_em: string | null;
  dia: string;
};

type VisitasPulse = {
  item_id: string;
  visitas_30d: number | null;
  visitas_30d_em: string | null;
};

type OfertaCompleta = OfertaVendedor & {
  item_id: string;
  seller_id: number;
  preco: number;
};

type DadosPerfil = Pick<PerfilPulse, 'transactions_total' | 'nivel' | 'perfil_coletado_em'>;
type DadosVisitas = Pick<VisitasPulse, 'visitas_30d' | 'visitas_30d_em'>;

export interface ResolverMercadoRelevanteArgs {
  db: SupabaseClient;
  orgId: string;
  productId: string;
  ofertas: OfertaVendedor[];
  agora?: Date;
  buscas: BuscasMercadoRelevante;
}

export interface BuscasMercadoRelevante {
  buscarPerfil: (sellerId: number) => Promise<PerfilVendedor | null>;
  buscarVisitas: (itemId: string) => Promise<number | null>;
}

export interface CriarBuscasMercadoRelevanteArgs extends BuscasMercadoRelevante {
  limite?: number;
}

function criarLimitador(limite: number) {
  const maximo = Math.max(1, limite);
  let emVoo = 0;
  const fila: Array<() => void> = [];

  return async function limitar<T>(tarefa: () => Promise<T>): Promise<T> {
    let reservado = false;
    if (emVoo >= maximo) {
      await new Promise<void>((resolve) => fila.push(resolve));
      reservado = true;
    }
    if (!reservado) emVoo += 1;
    try {
      return await tarefa();
    } finally {
      const proximo = fila.shift();
      if (proximo) proximo();
      else emVoo -= 1;
    }
  };
}

/**
 * Coordena as buscas ML do lote inteiro: perfil e visitas dividem os mesmos seis slots,
 * e uma promessa por chave evita repetir a mesma consulta em itens paralelos.
 */
export function criarBuscasMercadoRelevante({
  buscarPerfil,
  buscarVisitas,
  limite = LIMITE_CONCORRENCIA,
}: CriarBuscasMercadoRelevanteArgs): BuscasMercadoRelevante {
  const limitar = criarLimitador(limite);
  const pendentes = new Map<string, Promise<unknown>>();
  const deduplicar = <T>(chave: string, buscar: () => Promise<T>): Promise<T> => {
    const existente = pendentes.get(chave);
    if (existente) return existente as Promise<T>;
    const promessa = limitar(buscar);
    pendentes.set(chave, promessa);
    return promessa;
  };
  return {
    buscarPerfil: (sellerId) => deduplicar(`perfil:${sellerId}`, () => buscarPerfil(sellerId)),
    buscarVisitas: (itemId) => deduplicar(`visitas:${itemId}`, () => buscarVisitas(itemId)),
  };
}

function estaFresco(valor: string | null, agoraMs: number): boolean {
  if (!valor) return false;
  const instante = Date.parse(valor);
  return Number.isFinite(instante) && instante >= agoraMs - MAX_IDADE_MS;
}

function eOfertaCompleta(oferta: OfertaVendedor): oferta is OfertaCompleta {
  return typeof oferta.item_id === 'string' && oferta.item_id.length > 0 &&
    typeof oferta.seller_id === 'number' && Number.isFinite(oferta.seller_id) &&
    typeof oferta.preco === 'number' && Number.isFinite(oferta.preco) && oferta.preco > 0;
}

function resumirObservado(ofertas: OfertaVendedor[]): MercadoObservado {
  const precos = ofertas
    .map((oferta) => oferta.preco)
    .filter((preco): preco is number => typeof preco === 'number' && Number.isFinite(preco) && preco > 0);
  const vendedores = new Set(
    ofertas
      .map((oferta) => oferta.seller_id)
      .filter((sellerId): sellerId is number => typeof sellerId === 'number' && Number.isFinite(sellerId)),
  );
  return {
    menor: precos.length > 0 ? Math.min(...precos) : null,
    maior: precos.length > 0 ? Math.max(...precos) : null,
    vendedores: vendedores.size,
    ofertas: ofertas.length,
  };
}

function perfilAproveitavel(perfil: DadosPerfil | undefined, agoraMs: number): boolean {
  return perfil?.transactions_total != null && estaFresco(perfil.perfil_coletado_em, agoraMs);
}

function visitasAproveitaveis(visitas: DadosVisitas | undefined, agoraMs: number): boolean {
  return visitas?.visitas_30d != null && estaFresco(visitas.visitas_30d_em, agoraMs);
}

async function carregarDadosPulse(
  db: SupabaseClient,
  orgId: string,
  productId: string,
  ofertas: OfertaCompleta[],
  agoraMs: number,
): Promise<{ perfis: Map<number, DadosPerfil>; visitas: Map<string, DadosVisitas> }> {
  const vazio = { perfis: new Map<number, DadosPerfil>(), visitas: new Map<string, DadosVisitas>() };
  try {
    const { data: produtoData } = await db.from('pulse_produtos')
      .select('id, ultimo_snapshot_em')
      .eq('org_id', orgId)
      .eq('catalog_product_id', productId)
      .maybeSingle();
    const produto = produtoData as { id: string; ultimo_snapshot_em: string | null } | null;
    if (!produto || !estaFresco(produto.ultimo_snapshot_em, agoraMs) || ofertas.length === 0) return vazio;

    const itemIds = [...new Set(ofertas.map(({ item_id }) => item_id))];
    const sellerIds = [...new Set(ofertas.map(({ seller_id }) => seller_id))];
    const { data: ofertasData } = await db.from('pulse_ofertas_atual')
      .select('item_id, seller_id, visitas_30d, visitas_30d_em')
      .eq('org_id', orgId)
      .eq('produto_id', produto.id)
      .eq('ativo', true)
      .in('item_id', itemIds);
    const { data: vendedoresData } = await db.from('pulse_vendedores')
      .select('seller_id, transactions_total, nivel, perfil_coletado_em, dia')
      .eq('org_id', orgId)
      .in('seller_id', sellerIds)
      .order('seller_id', { ascending: true })
      .order('perfil_coletado_em', { ascending: false, nullsFirst: false })
      .order('dia', { ascending: false });

    const visitas = new Map<string, DadosVisitas>();
    for (const oferta of (ofertasData ?? []) as VisitasPulse[]) {
      const atual = visitas.get(oferta.item_id);
      if (!atual || (oferta.visitas_30d_em ?? '') > (atual.visitas_30d_em ?? '')) {
        visitas.set(oferta.item_id, oferta);
      }
    }

    const perfis = new Map<number, DadosPerfil>();
    for (const vendedor of (vendedoresData ?? []) as PerfilPulse[]) {
      // A query ordena cada vendedor por perfil coletado e depois por dia, ambos descendentes.
      // Manter a primeira linha evita que um snapshot legado posterior descarte um perfil fresco.
      if (!perfis.has(vendedor.seller_id)) perfis.set(vendedor.seller_id, vendedor);
    }
    return { perfis, visitas };
  } catch {
    return vazio;
  }
}

/**
 * Qualifica as ofertas atuais usando, quando seguro, somente metadados frescos do Pulse.
 * O menor observado é preservado para auditoria, mas nunca entra no mercado competitivo.
 */
export async function resolverMercadoRelevante({
  db,
  orgId,
  productId,
  ofertas,
  agora = new Date(),
  buscas,
}: ResolverMercadoRelevanteArgs): Promise<Mercado> {
  const agoraMs = agora.getTime();
  const observado = resumirObservado(ofertas);
  const completas = ofertas.filter(eOfertaCompleta);
  const { perfis, visitas } = await carregarDadosPulse(db, orgId, productId, completas, agoraMs);

  const sellerIdsPendentes = [...new Set(
    completas
      .map(({ seller_id }) => seller_id)
      .filter((sellerId) => !perfilAproveitavel(perfis.get(sellerId), agoraMs)),
  )];
  await Promise.all(sellerIdsPendentes.map(async (sellerId) => {
    const perfil = await buscas.buscarPerfil(sellerId);
    perfis.set(sellerId, {
      transactions_total: perfil?.transactions_total ?? null,
      nivel: perfil?.nivel ?? null,
      perfil_coletado_em: agora.toISOString(),
    });
  }));

  const itemIdsPendentes = [...new Set(
    completas
      .map(({ item_id }) => item_id)
      .filter((itemId) => !visitasAproveitaveis(visitas.get(itemId), agoraMs)),
  )];
  await Promise.all(itemIdsPendentes.map(async (itemId) => {
    visitas.set(itemId, {
      visitas_30d: await buscas.buscarVisitas(itemId),
      visitas_30d_em: agora.toISOString(),
    });
  }));

  const qualificaveis: OfertaQualificavel[] = completas.map((oferta) => {
    const perfil = perfis.get(oferta.seller_id);
    const visita = visitas.get(oferta.item_id);
    return {
      ...oferta,
      transactions_total: perfil?.transactions_total ?? null,
      visitas_30d: visita?.visitas_30d ?? null,
      nivel: perfil?.nivel ?? null,
    };
  });
  const resumo = resumirMercadoQualificado(qualificaveis);
  return {
    menor: resumo.menor_relevante,
    maior: resumo.maior_relevante,
    vendedores: resumo.vendedores_relevantes,
    freteGratis: resumo.frete_gratis_relevantes,
    full: resumo.full_relevantes,
    ofertas: resumo.total_relevantes,
    observado,
  };
}
