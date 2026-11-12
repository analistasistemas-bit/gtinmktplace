// Referência da galeria (ADR-0201, Global Constraints): foto real da própria cor, copiada para caminho imutável
// `${orgId}/galeria-ia/${familiaId}/referencias/${corSlug}-${vista}-${sha256}.jpg`. Nunca apagada pela retenção.
// No ML só lê (GET); nunca escreve.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { createHash } from 'node:crypto';
import { resolverConexaoEstrita } from '../canais/conexao.ts';
import { getValidAccessTokenConexao } from '../ml/token.ts';
import { buscarItemML, type ItemMLAtual } from '../ml/atualizar-item.ts';
import { buscarSecureUrlFotoML } from '../ml/fotos.ts';
import { fotoDaOrg } from '../../criar-kit-variacao/processar.ts';
import { carregarAnuncio, coresDoAnuncio, skusDaCor, type AnuncioGaleria } from './anuncio.ts';
import { aplicarEtiqueta, hashFatos, montarFicha, type Fato, type FatoGravado } from './fatos.ts';
import { lerLeituraEtiqueta } from './etiqueta.ts';
import type { Vista } from './regras.ts';

export interface Referencia { id: string; path: string; sha256: string }
export type OrigemReferencia = 'storage' | 'ml' | 'upload_operador';

export const corSlug = (cor: string) =>
  cor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** O caminho imutável é `.jpg`: só JPEG (bytes FF D8 FF) vira referência; nunca converte. */
export const ehJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Todos os picture_id que a galeria aplicou neste anúncio (qualquer família), na org. */
export async function carregarFotosAplicadas(admin: SupabaseClient, orgId: string, anuncioId: string): Promise<Set<string>> {
  const { data, error } = await admin.from('galeria_imagem_itens').select('picture_id')
    .eq('org_id', orgId).eq('anuncio_externo_id', anuncioId).not('picture_id', 'is', null);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r: { picture_id: string }) => r.picture_id));
}

async function referenciaGravada(
  admin: SupabaseClient, orgId: string, anuncioId: string, cor: string, vista: Vista, sha?: string,
): Promise<Referencia | null> {
  let q = admin.from('galeria_referencias').select('id, path, sha256')
    .eq('org_id', orgId).eq('anuncio_externo_id', anuncioId).eq('cor', cor).eq('vista', vista);
  if (sha) q = q.eq('sha256', sha);
  const { data, error } = await q.order('criado_em', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: data.id, path: data.path, sha256: data.sha256 } : null;
}

/**
 * Copia os bytes (JPEG) para o caminho imutável (upsert:false) e grava a linha. Mesmo sha no anúncio → reusa
 * e renova `criado_em`: a referência vigente é a mais recente (enviar A, B e A de novo deixa A vigente).
 */
export async function gravarReferencia(
  admin: SupabaseClient, orgId: string, a: AnuncioGaleria, cor: string, vista: Vista,
  bytes: Uint8Array, origem: OrigemReferencia,
): Promise<Referencia> {
  if (!ehJpeg(bytes)) throw new Error('Referência não é JPEG');
  const contentType = 'image/jpeg';
  const sha = sha256Hex(bytes);
  const existente = await referenciaGravada(admin, orgId, a.anuncioId, cor, vista, sha);
  if (existente) {
    const { error } = await admin.from('galeria_referencias').update({ criado_em: new Date().toISOString() })
      .eq('id', existente.id).eq('org_id', orgId);
    if (error) throw new Error(error.message);
    return existente;
  }
  const path = `${orgId}/galeria-ia/${a.vigente.id}/referencias/${corSlug(cor)}-${vista}-${sha}.jpg`;
  const { error: eUp } = await admin.storage.from('imagens')
    .upload(path, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: contentType }), { upsert: false, contentType });
  // Mesmo caminho = mesmo conteúdo (o sha está no nome): "já existe" é sucesso.
  if (eUp && !/exist/i.test(eUp.message)) throw new Error(`Falha ao gravar a referência: ${eUp.message}`);
  const { error } = await admin.from('galeria_referencias').insert({
    org_id: orgId, anuncio_externo_id: a.anuncioId, familia_id: a.vigente.id, cor, vista, path, sha256: sha, origem,
  });
  if (error && error.code !== '23505') throw new Error(error.message);
  const gravada = await referenciaGravada(admin, orgId, a.anuncioId, cor, vista, sha);
  if (!gravada) throw new Error('Referência gravada não encontrada');
  return gravada;
}

/**
 * Ordem: (1) imagem_path da variação mais nova da cor; (2) referência real já gravada do anúncio, cor e vista;
 * (3) 1ª foto da variação no ML que não seja imagem aplicada pela galeria nem foto de outra cor (capa).
 * Costas/lateral: só (2) — a referência daquela vista que o operador enviou.
 */
export async function prepararReferencia(
  admin: SupabaseClient, orgId: string, anuncioId: string, cor: string, vista: Vista,
  fotosAplicadas: Set<string>, ctx?: AnuncioGaleria,
): Promise<Referencia | { erro: 'sem_referencia' }> {
  const carregado = ctx ?? await carregarAnuncio(admin, orgId, anuncioId);
  if ('erro' in carregado) return { erro: 'sem_referencia' };
  const a = carregado;
  const skus = skusDaCor(a, cor);

  if (vista === 'frente') {
    // Variação mais nova primeiro (publicado_em da família de origem); empate pelo SKU.
    const paths = [...new Set(skus.map((s) => ({ ...a.porSku[s], sku: s }))
      .sort((x, y) => (x.publicado_em !== y.publicado_em ? (x.publicado_em < y.publicado_em ? 1 : -1) : (x.sku < y.sku ? -1 : 1)))
      .map((v) => v.imagem_path).filter((p): p is string => !!p))];
    if (paths.length > 0) {
      const { data: perfis, error } = await admin.from('profiles').select('id').eq('org_id', orgId);
      if (error) throw new Error(error.message);
      const usuarios = new Set((perfis ?? []).map((p: { id: string }) => p.id));
      for (const p of paths.filter((x) => fotoDaOrg(x, orgId, usuarios))) {
        const { data: blob } = await admin.storage.from('imagens').download(p);
        if (!blob) continue; // arquivo sumiu: segue para a referência já gravada
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!ehJpeg(bytes)) continue; // PNG/WebP nunca vai para um caminho .jpg
        return await gravarReferencia(admin, orgId, a, cor, vista, bytes, 'storage');
      }
    }
  }

  const gravada = await referenciaGravada(admin, orgId, a.anuncioId, cor, vista);
  if (gravada || vista !== 'frente' || skus.length === 0) return gravada ?? { erro: 'sem_referencia' };

  const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
  if (!cx) throw new Error('Organização sem conexão com o Mercado Livre');
  const token = await getValidAccessTokenConexao(cx);
  const itens = new Map<string, Promise<ItemMLAtual>>();
  const item = (id: string) => {
    if (!itens.has(id)) itens.set(id, buscarItemML(token, id));
    return itens.get(id)!;
  };
  const fotosDoSku = async (sku: string): Promise<string[]> => {
    if (!a.itemPorSku[sku]) return []; // filho UP sem MLB
    const it = await item(a.itemPorSku[sku]);
    return it.variations.length > 0
      ? it.variations.find((v) => v.seller_custom_field === sku)?.picture_ids ?? []
      : it.pictures;
  };
  // Foto presente em SKU de outra cor não é da cor (capa multicolor): fica fora.
  // ponytail: no UP isso lê o item de cada SKU das outras cores; só roda quando (1) e (2) faltam.
  const deOutraCor = new Set((await Promise.all(a.skus.filter((s) => !skus.includes(s)).map(fotosDoSku))).flat());
  for (const sku of skus) {
    for (const pid of (await fotosDoSku(sku)).filter((p) => !fotosAplicadas.has(p) && !deOutraCor.has(p))) {
      const url = await buscarSecureUrlFotoML(token, pid);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Falha ao baixar a foto ${pid} do Mercado Livre (${resp.status})`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      if (!ehJpeg(bytes)) continue; // não-JPEG: tenta a próxima foto
      return await gravarReferencia(admin, orgId, a, cor, vista, bytes, 'ml');
    }
  }
  return { erro: 'sem_referencia' };
}

const MEDIDAS = ['peso_gramas', 'altura_cm', 'largura_cm', 'comprimento_cm'] as const;
const VISTAS: Vista[] = ['frente', 'costas', 'lateral'];

/**
 * Ficha Verdade da família vigente do anúncio, com as decisões do operador (`galeria_fatos`) e a conferência
 * da etiqueta persistida (se houver; sem leitura, a ficha sai sem conferência).
 */
export async function lerFicha(admin: SupabaseClient, orgId: string, a: AnuncioGaleria): Promise<Fato[]> {
  const leitura = await lerLeituraEtiqueta(admin, orgId, a);
  const { data, error } = await admin.from('galeria_fatos').select('campo, valor, origem, evidencia, descartado')
    .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).eq('familia_id', a.vigente.id);
  if (error) throw new Error(error.message);
  const f = a.vigente;
  const gravados = (data ?? []) as FatoGravado[];
  return aplicarEtiqueta(montarFicha({
    planilha: { nome: f.nome_pai, descricao_fornecedor: f.descricao_pai, marca: f.marca, origem: f.origem },
    // R1.5 sobre todos os SKUs vivos do anúncio (o roteiro é um só para todas as cores).
    medidasPorSku: Object.fromEntries(a.skus.filter((s) => a.porSku[s]).map((s) => [s, Object.fromEntries(
      MEDIDAS.filter((m) => a.porSku[s][m] != null).map((m) => [m, String(a.porSku[s][m])]),
    )])),
    atributosML: f.atributos_ml ?? [],
    textosIA: { titulo_ml: f.titulo_ml, descricao_ml: f.descricao_ml },
    confirmados: gravados,
  }), leitura, new Set(gravados.filter((g) => g.descartado).map((g) => g.campo)));
}

/**
 * Vigência do anúncio: ficha + referências (todas as cores × frente/costas/lateral) + `fatos_hash`.
 * Única fonte do hash: quem grava `galeria_roteiros.fatos_hash` (aprovar, Task 7) usa esta mesma função.
 */
export async function calcularVigencia(admin: SupabaseClient, orgId: string, a: AnuncioGaleria) {
  const aplicadas = await carregarFotosAplicadas(admin, orgId, a.anuncioId);
  const referencias: Record<string, Record<string, Referencia | { erro: 'sem_referencia' }>> = {};
  const shas: Record<string, string> = {};
  for (const cor of coresDoAnuncio(a)) {
    referencias[cor] = {};
    for (const vista of VISTAS) {
      const r = await prepararReferencia(admin, orgId, a.anuncioId, cor, vista, aplicadas, a);
      referencias[cor][vista] = r;
      if (!('erro' in r)) shas[`${cor}:${vista}`] = r.sha256;
    }
  }
  const fatos = await lerFicha(admin, orgId, a);
  return { fatos, referencias, fatos_hash: hashFatos(fatos, shas) };
}
