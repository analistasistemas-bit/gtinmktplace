// @deno-types="../_shared/vendor/xlsx.d.ts"
import * as XLSX from '../_shared/vendor/xlsx.mjs';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao, type ConexaoCanal } from '../_shared/canais/conexao.ts';
import { buscarConcorrencia } from '../_shared/ml/concorrencia.ts';
import { buscarListingPrice, comissaoDe } from '../_shared/ml/listing-prices.ts';
import { buscarFreteVendedor } from '../_shared/ml/frete.ts';
import { buscarPerfilVendedor } from '../_shared/ml/perfil-vendedor.ts';
import { buscarVisitas30d } from '../_shared/ml/visitas-item.ts';
import { dimensoesValidas, type DimensoesPacote } from '../_shared/ml/pacote.ts';
import { extrairItensAnalise } from '../_shared/analise/extrair-itens.ts';
import { resolverMercadoRelevante } from '../_shared/analise/mercado-relevante.ts';
import { resumirVariacoesSalvas, type VariacaoSalvaResumo } from '../_shared/analise/variacao-salva.ts';
import type { ItemAnalise, ItemAnalisado } from '../_shared/analise/tipos.ts';

const LOTE = 5; // concorrência limitada p/ não estourar a API do ML

/**
 * Variação já cadastrada (produto já publicado antes) para o GTIN, dentro da org. Best-effort.
 * Select mais largo e SEMPRE chamado no ramo existeNoML (T4): além das dimensões, devolve se já
 * existe variação com esse GTIN na org — mesmo round-trip de antes, só deixou de ser condicional.
 */
async function buscarVariacaoSalva(
  db: SupabaseClient, orgId: string, gtin: string,
): Promise<VariacaoSalvaResumo> {
  const { data } = await db
    .from('variacoes')
    .select('id, peso_gramas, altura_cm, largura_cm, comprimento_cm')
    .eq('org_id', orgId)
    .eq('gtin', gtin)
    .limit(5);
  return resumirVariacoesSalvas(data ?? []);
}

async function analisarItem(
  db: SupabaseClient, orgId: string, conexao: ConexaoCanal | null, item: ItemAnalise,
): Promise<ItemAnalisado> {
  const base: ItemAnalisado = {
    gtin: item.gtin, nome: item.nome, unidade: item.unidade,
    minimo: item.minimo, custo: item.custo, origem: item.origem, existeNoML: false,
  };
  try {
    const conc = await buscarConcorrencia(conexao, {
      nome_pai: item.nome, variacoes: [{ gtin: item.gtin }],
    });
    if (!conc.product_id) return base;

    // A categoria vem das próprias ofertas (GET /products/{id} não retorna category_id).
    const categoria = conc.ofertas?.category_id ?? null;

    // Select sempre chamado (T4): jaCadastrado precisa dele mesmo quando o caller já informou
    // dimensões (senão o recálculo do FormDimensoes apagaria o sinal). Dimensão informada pelo
    // caller (modo GTIN colado, recálculo) tem precedência sobre a salva; sem ela, tenta achar no
    // produto já cadastrado antes de cair no pacote genérico (16x11x6cm/300g) do frete.ts.
    const dimensoesInformadas = item.dimensoes && dimensoesValidas(item.dimensoes);
    const salva = await buscarVariacaoSalva(db, orgId, item.gtin);
    let token: string | null = null;
    if (conexao) token = await getValidAccessTokenConexao(conexao).catch(() => null);
    const mercado = await resolverMercadoRelevante({
      db,
      orgId,
      productId: conc.product_id,
      ofertas: conc.ofertas?.ofertas_detalhe ?? [],
      buscarPerfil: token
        ? (sellerId) => buscarPerfilVendedor(token, sellerId)
        : () => Promise.resolve(null),
      buscarVisitas: token
        ? (itemId) => buscarVisitas30d(token, itemId)
        : () => Promise.resolve(null),
    });
    const resultado: ItemAnalisado = {
      ...base,
      // Modo GTIN não tem nome (vem = gtin); usa o nome do produto de catálogo do ML.
      nome: item.nome && item.nome !== item.gtin ? item.nome : (conc.product_name ?? item.gtin),
      existeNoML: true,
      mercado,
      descricaoCatalogo: conc.descricao_catalogo ?? null,
      categoriaMlId: categoria,
      // Heurística de UX (casa por GTIN) — não é o guard; o 409 de cadastrar-produto continua autoritativo.
      jaCadastrado: salva.jaCadastrado,
    };
    if (mercado.menor == null || !categoria || !token) return resultado;

    const dimensoes = dimensoesInformadas ? item.dimensoes! : salva.dimensoes;
    const mlUserId = conexao?.contaExternaId || 'me';
    const [classicoML, premiumML, frete] = await Promise.all([
      buscarListingPrice(token, mercado.menor, categoria, 'gold_special'),
      buscarListingPrice(token, mercado.menor, categoria, 'gold_pro'),
      buscarFreteVendedor(token, mlUserId, mercado.menor, categoria, dimensoes),
    ]);
    return {
      ...resultado,
      classico: { saleFeeAmount: classicoML.sale_fee_amount ?? 0, ...comissaoDe(classicoML) },
      premium: { saleFeeAmount: premiumML.sale_fee_amount ?? 0, ...comissaoDe(premiumML) },
      frete,
      dimensoesEncontradas: dimensoes != null,
    };
  } catch (e) {
    console.warn(`analisarItem ${item.gtin} falhou: ${(e as Error).message}`);
    return { ...base, erro: true };
  }
}

async function emLotes(
  db: SupabaseClient, orgId: string, conexao: ConexaoCanal | null, itens: ItemAnalise[],
): Promise<ItemAnalisado[]> {
  const out: ItemAnalisado[] = [];
  for (let i = 0; i < itens.length; i += LOTE) {
    const fatia = itens.slice(i, i + LOTE);
    out.push(...(await Promise.all(fatia.map((it) => analisarItem(db, orgId, conexao, it)))));
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const body = await req.json().catch(() => ({}));

  let itens: ItemAnalise[];
  let ignorados = 0;
  try {
    if (body.modo === 'planilha' && typeof body.arquivoBase64 === 'string') {
      const buffer = Uint8Array.from(atob(body.arquivoBase64), (c) => c.charCodeAt(0));
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      const r = extrairItensAnalise(rows);
      itens = r.itens;
      ignorados = r.ignorados;
    } else if (body.modo === 'gtins' && Array.isArray(body.itens)) {
      itens = body.itens
        .filter((x: { gtin?: unknown }) => typeof x?.gtin === 'string' && x.gtin.trim().length > 0)
        .map((x: {
          gtin: string; minimo?: number; custo?: number; nome?: string; dimensoes?: DimensoesPacote | null;
        }) => ({
          gtin: x.gtin.trim(),
          nome: x.nome ?? x.gtin.trim(),
          unidade: null,
          minimo: typeof x.minimo === 'number' ? x.minimo : null,
          custo: typeof x.custo === 'number' ? x.custo : null,
          origem: 'nacional',
          dimensoes: x.dimensoes ?? null,
        }));
    } else {
      return json({ erro: 'modo inválido (use "planilha" com arquivoBase64 ou "gtins" com itens)' }, 400);
    }
  } catch (e) {
    return json({ erro: (e as Error).message }, 400);
  }

  if (itens.length === 0) return json({ itens: [], ignorados });

  console.log(`analisar-viabilidade: ${itens.length} itens, ${ignorados} ignorados`);
  const db = adminClient();
  const [conexao, mc] = await Promise.all([
    resolverConexao(db, orgId, 'mercado_livre'),
    db.from('marketplace_connections').select('me2_habilitado')
      .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle(),
  ]);
  const analisados = await emLotes(db, orgId, conexao, itens);
  return json({ itens: analisados, ignorados, me2Habilitado: mc.data?.me2_habilitado ?? null });
});
