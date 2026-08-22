// @deno-types="../_shared/vendor/xlsx.d.ts"
import * as XLSX from '../_shared/vendor/xlsx.mjs';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao, type ConexaoCanal } from '../_shared/canais/conexao.ts';
import { buscarConcorrencia } from '../_shared/ml/concorrencia.ts';
import { buscarListingPrice } from '../_shared/ml/listing-prices.ts';
import { buscarFreteVendedor } from '../_shared/ml/frete.ts';
import { buscarPerfilVendedor } from '../_shared/ml/perfil-vendedor.ts';
import { buscarVisitas30d } from '../_shared/ml/visitas-item.ts';
import type { DimensoesPacote } from '../_shared/ml/pacote.ts';
import { extrairItensAnalise } from '../_shared/analise/extrair-itens.ts';
import { criarBuscasMercadoRelevante, resolverMercadoRelevante } from '../_shared/analise/mercado-relevante.ts';
import {
  analisarItemViabilidade,
  type AnalisarItemViabilidadeDependencias,
} from '../_shared/analise/analisar-item-viabilidade.ts';
import { resumirVariacoesSalvas, type VariacaoSalvaResumo } from '../_shared/analise/variacao-salva.ts';
import type { ItemAnalise, ItemAnalisado } from '../_shared/analise/tipos.ts';
import { excedeLimiteBase64 } from '../_shared/analise/limite-upload.ts';

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

function criarDependencias(
  db: SupabaseClient,
  orgId: string,
  conexao: ConexaoCanal | null,
): AnalisarItemViabilidadeDependencias {
  let tokenPromise: Promise<string | null> | undefined;
  const obterToken = () => {
    tokenPromise ??= conexao
      ? getValidAccessTokenConexao(conexao).catch(() => null)
      : Promise.resolve(null);
    return tokenPromise;
  };
  const buscas = criarBuscasMercadoRelevante({
    buscarPerfil: async (sellerId) => {
      const token = await obterToken();
      return token ? buscarPerfilVendedor(token, sellerId) : null;
    },
    buscarVisitas: async (itemId) => {
      const token = await obterToken();
      return token ? buscarVisitas30d(token, itemId) : null;
    },
  });
  return {
    buscarConcorrencia: (familia) => buscarConcorrencia(conexao, familia),
    buscarVariacaoSalva: (gtin) => buscarVariacaoSalva(db, orgId, gtin),
    obterToken,
    resolverMercado: (productId, ofertas) => resolverMercadoRelevante({
      db,
      orgId,
      productId,
      ofertas,
      buscas,
    }),
    buscarListingPrice,
    buscarFreteVendedor,
  };
}

async function emLotes(
  db: SupabaseClient, orgId: string, conexao: ConexaoCanal | null, itens: ItemAnalise[],
): Promise<ItemAnalisado[]> {
  const deps = criarDependencias(db, orgId, conexao);
  const contaExternaId = conexao?.contaExternaId ?? null;
  const out: ItemAnalisado[] = [];
  for (let i = 0; i < itens.length; i += LOTE) {
    const fatia = itens.slice(i, i + LOTE);
    const analisados = await Promise.all(fatia.map((item) => analisarItemViabilidade({
      item,
      contaExternaId,
      deps,
    })));
    out.push(...analisados);
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
      if (excedeLimiteBase64(body.arquivoBase64)) {
        return json({ erro: 'Planilha excede o tamanho máximo permitido' }, 413);
      }
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
