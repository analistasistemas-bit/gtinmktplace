import * as XLSX from 'npm:xlsx@^0.18';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { buscarConcorrencia } from '../_shared/ml/concorrencia.ts';
import { buscarCategoriaProduto } from '../_shared/ml/produto-categoria.ts';
import { buscarListingPrice, comissaoDe } from '../_shared/ml/listing-prices.ts';
import { extrairItensAnalise } from '../_shared/analise/extrair-itens.ts';
import type { ItemAnalise, ItemAnalisado } from '../_shared/analise/tipos.ts';

const LOTE = 5; // concorrência limitada p/ não estourar a API do ML

async function analisarItem(userId: string, item: ItemAnalise): Promise<ItemAnalisado> {
  const base: ItemAnalisado = {
    gtin: item.gtin, nome: item.nome, unidade: item.unidade,
    minimo: item.minimo, custo: item.custo, existeNoML: false,
  };
  try {
    const conc = await buscarConcorrencia(userId, {
      nome_pai: item.nome, variacoes: [{ gtin: item.gtin }],
    });
    const menor = conc.ofertas?.preco_min ?? conc.preco_min;
    if (!conc.product_id || conc.vendedores === 0 || menor == null) return base;

    const token = await getValidAccessToken(userId);
    const categoria = await buscarCategoriaProduto(token, conc.product_id);
    if (!categoria) return base;

    const [classicoML, premiumML] = await Promise.all([
      buscarListingPrice(token, menor, categoria, 'gold_special'),
      buscarListingPrice(token, menor, categoria, 'gold_pro'),
    ]);

    return {
      ...base,
      existeNoML: true,
      mercado: {
        menor,
        maior: conc.ofertas?.preco_max ?? null,
        vendedores: conc.vendedores,
        freteGratis: conc.ofertas?.frete_gratis ?? 0,
        full: conc.ofertas?.full ?? 0,
      },
      classico: { saleFeeAmount: classicoML.sale_fee_amount ?? 0, ...comissaoDe(classicoML) },
      premium: { saleFeeAmount: premiumML.sale_fee_amount ?? 0, ...comissaoDe(premiumML) },
    };
  } catch (e) {
    console.warn(`analisarItem ${item.gtin} falhou: ${(e as Error).message}`);
    return { ...base, erro: true };
  }
}

async function emLotes(userId: string, itens: ItemAnalise[]): Promise<ItemAnalisado[]> {
  const out: ItemAnalisado[] = [];
  for (let i = 0; i < itens.length; i += LOTE) {
    const fatia = itens.slice(i, i + LOTE);
    out.push(...(await Promise.all(fatia.map((it) => analisarItem(userId, it)))));
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let user;
  try { user = await requireUser(req); }
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
        .map((x: { gtin: string; minimo?: number; custo?: number; nome?: string }) => ({
          gtin: x.gtin.trim(),
          nome: x.nome ?? x.gtin.trim(),
          unidade: null,
          minimo: typeof x.minimo === 'number' ? x.minimo : null,
          custo: typeof x.custo === 'number' ? x.custo : null,
        }));
    } else {
      return json({ erro: 'modo inválido (use "planilha" com arquivoBase64 ou "gtins" com itens)' }, 400);
    }
  } catch (e) {
    return json({ erro: (e as Error).message }, 400);
  }

  if (itens.length === 0) return json({ itens: [], ignorados });

  console.log(`analisar-viabilidade: ${itens.length} itens, ${ignorados} ignorados`);
  const analisados = await emLotes(user.id, itens);
  return json({ itens: analisados, ignorados });
});
