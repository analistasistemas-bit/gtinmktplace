import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { extrairCorDoTexto, extrairCorECodigo } from '../_shared/cor/extrair.ts';
import { pool } from '../_shared/concorrencia/pool.ts';
import { cacheCorGet, cacheCorSet, type OrigemCor } from '../_shared/redis/cache-cor.ts';
import { extrairCorPorVision } from '../_shared/ai/vision.ts';
import { gerarCopy } from '../_shared/ai/copywriter.ts';
import { garantirMetragemTitulo } from '../_shared/ai/titulo.ts';
import { buscarConcorrencia } from '../_shared/ml/concorrencia.ts';
import { sugerirPrecoVenda } from '../_shared/preco/sugerir.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { buscarListingPrice, comissaoDe } from '../_shared/ml/listing-prices.ts';
import { detectarTipoAviamento } from '../_shared/categoria/detectar.ts';
import { categoriaParaTipo, montarAtributosML } from '../_shared/categoria/atributos.ts';
import { analisarMercado } from '../_shared/ml/mercado.ts';

interface Job { familia_id: string; lote_id: string; }

const POOL_VISION = 5;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const body = await req.text();
  const ok = await verificarAssinatura(req, body);
  if (!ok) return new Response('Invalid signature', { status: 401, headers: corsHeaders });

  let job: Job;
  try {
    job = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
  }
  if (!job.familia_id || !job.lote_id) {
    return new Response('familia_id e lote_id obrigatórios', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();

  // 1. Claim atômico (UPDATE pendente -> processando, RETURNING)
  const { data: claimed, error: claimErr } = await admin
    .from('familias')
    .update({ status: 'processando' })
    .eq('id', job.familia_id)
    .eq('status', 'pendente')
    .select('id, user_id, nome_pai, descricao_pai, lote_id, operacao, fornecedor, unidade')
    .maybeSingle();
  if (claimErr) {
    return new Response(`Claim: ${claimErr.message}`, { status: 500, headers: corsHeaders });
  }
  if (!claimed) {
    return new Response('Already processed', { status: 200, headers: corsHeaders });
  }

  const userId = claimed.user_id as string;

  try {
    // 2. Carregar variações
    const { data: variacoes, error: varErr } = await admin
      .from('variacoes')
      .select('id, codigo, gtin, cor, cor_origem, nome, preco, preco_editado_pelo_operador, imagem_path')
      .eq('familia_id', job.familia_id);
    if (varErr) throw new Error(`Variacoes: ${varErr.message}`);

    type Variacao = NonNullable<typeof variacoes>[number];

    // 3. Resolver cor de cada variação (pool máx 5 paralelas)
    const resolvidas = await pool(POOL_VISION, variacoes ?? [], async (v: Variacao) => {
      if (v.cor) return v;

      // Camada 0 — código + nome literal da cor quando o NOME tem "{número} {cor}".
      const comCodigo = extrairCorECodigo(v.nome ?? '');
      if (comCodigo) {
        return { ...v, cor: `${comCodigo.cor} ${comCodigo.codigo}`, cor_origem: 'descricao' as OrigemCor };
      }

      // Camada 1 — dicionário
      const corTexto = extrairCorDoTexto([
        v.nome,
        claimed.nome_pai,
        claimed.descricao_pai,
      ]);
      if (corTexto) return { ...v, cor: corTexto, cor_origem: 'descricao' as OrigemCor };

      // Cache Redis
      try {
        const cached = await cacheCorGet(userId, v.codigo);
        if (cached) return { ...v, cor: cached.cor, cor_origem: cached.origem };
      } catch (e) {
        console.warn(`Cache miss (erro): ${(e as Error).message}`);
      }

      // Camada 2 — Vision (só se variação tem imagem)
      if (!v.imagem_path) return v;
      try {
        const { data: signed, error: signErr } = await admin.storage
          .from('imagens')
          .createSignedUrl(v.imagem_path, 3600);
        if (signErr || !signed?.signedUrl) return v;
        const visionResult = await extrairCorPorVision(signed.signedUrl);
        try {
          await cacheCorSet(userId, v.codigo, { cor: visionResult.cor, origem: 'vision' });
        } catch (e) {
          console.warn(`Cache set falhou: ${(e as Error).message}`);
        }
        return { ...v, cor: visionResult.cor, cor_origem: 'vision' as OrigemCor };
      } catch (e) {
        console.warn(`Vision falhou para ${v.codigo}: ${(e as Error).message}`);
        return v;
      }
    });

    // 4. Persistir cores (UPDATE em batch — só as que mudaram)
    const updatesVar = resolvidas
      .filter((v, i) => {
        const original = (variacoes ?? [])[i];
        return v.cor !== original?.cor || v.cor_origem !== original?.cor_origem;
      })
      .map((v) =>
        admin.from('variacoes')
          .update({ cor: v.cor, cor_origem: v.cor_origem })
          .eq('id', v.id)
      );
    await Promise.all(updatesVar);

    // UPDATE parcial: a família herdou título/descrição/categoria/concorrência do anúncio
    // anterior; aqui só precisávamos resolver a cor das cores novas (feito nos passos 3-4).
    // Não roda copy/concorrência/categoria/mercado. Marca pronto e encerra.
    if (claimed.operacao === 'UPDATE') {
      await admin.from('familias').update({ status: 'pronto' }).eq('id', job.familia_id);
      return new Response('OK (update parcial)', { status: 200, headers: corsHeaders });
    }

    // 5. Copywriter (1 chamada por família)
    const copy = await gerarCopy({
      nome: claimed.nome_pai,
      descricao_detalhado: claimed.descricao_pai ?? '',
      unidade: (claimed.unidade as string | null) ?? null,
      variacoes: resolvidas.map((v) => ({
        codigo: v.codigo,
        cor: v.cor,
        preco: Number(v.preco),
      })),
    });

    // 5b. Busca de concorrência (1x por família) — ADR-0014. Resiliente: erro → "nenhuma".
    const concorrencia = await buscarConcorrencia(userId, {
      nome_pai: claimed.nome_pai,
      variacoes: resolvidas.map((v) => ({ gtin: v.gtin })),
    });

    // 5c. Categoria + atributos determinísticos (ADR-0009). tipo='outro' deixa
    // categoria_ml_id null → operador escolhe na revisão (sem publicar às cegas).
    // Calculado ANTES do preço porque o gross-up usa categoriaMlId.
    const { tipo, origem: tipoOrigem } = detectarTipoAviamento(claimed.nome_pai);
    const categoriaMlId = categoriaParaTipo(tipo);
    const atributosMl = montarAtributosML(tipo, claimed.nome_pai, (claimed.fornecedor as string | null) ?? undefined, claimed.descricao_pai ?? undefined);

    // 5d. Estratégia de preço v2 (ADR-0020). PRECO = líquido mínimo desejado.
    // Com concorrente → mercado (× 0,95). Sem concorrente → gross-up (busca comissão 1x).
    const conc = { vendedores: concorrencia.vendedores, preco_min: concorrencia.preco_min };
    const precoMinFamilia = resolvidas.length
      ? Math.min(...resolvidas.map((v) => Number(v.preco)))
      : 0;
    const competitivo = conc.vendedores > 0 && conc.preco_min != null;

    let comissao: { percentual: number; fixa: number } | null = null;
    if (!competitivo && categoriaMlId) {
      try {
        const token = await getValidAccessToken(userId);
        const lp = await buscarListingPrice(token, precoMinFamilia, categoriaMlId, 'gold_special');
        comissao = comissaoDe(lp);
      } catch (e) {
        // Resiliente: sem comissão o gross-up cai no piso; o semáforo mostra "indisponível".
        console.error('comissão p/ gross-up falhou:', e);
      }
    }

    const updatesPreco = resolvidas
      .filter((v) => !v.preco_editado_pelo_operador)
      .map((v) => {
        const { preco } = sugerirPrecoVenda(Number(v.preco), conc, comissao);
        return admin.from('variacoes')
          .update({ preco_publicacao: preco })
          .eq('id', v.id);
      });
    await Promise.all(updatesPreco);

    const estrategiaFamilia = sugerirPrecoVenda(precoMinFamilia, conc, comissao);

    // 5e. Potencial de venda (ADR-0015) — só quando há produto de catálogo (origem gtin).
    const analiseMercado =
      concorrencia.origem === 'gtin' && concorrencia.product_id && concorrencia.ofertas
        ? await analisarMercado(userId, concorrencia.product_id, categoriaMlId, concorrencia.ofertas)
        : null;

    // 6. Persistir título + descrição + custos + concorrência + estratégia + categoria + status final.
    // estrategia_preco já vem minúscula de sugerirPrecoVenda (bate com o enum); garante tipo_origem
    // válido (regex/ia/manual). Checa o erro do update para não marcar 'pronto' em silêncio.
    const { error: persistErr } = await admin.from('familias').update({
      titulo_ml: garantirMetragemTitulo(copy.titulo, claimed.nome_pai),
      descricao_ml: copy.descricao,
      tokens_input: copy.tokens_input,
      tokens_output: copy.tokens_output,
      custo_centavos: copy.custo_centavos,
      concorrencia_vendedores: concorrencia.vendedores,
      concorrencia_preco_min: concorrencia.preco_min,
      concorrencia_origem: concorrencia.origem,
      concorrencia_classe: concorrencia.classe,
      estrategia_preco: estrategiaFamilia.estrategia,
      estrategia_motivo: estrategiaFamilia.motivo,
      tipo_aviamento: tipo,
      tipo_origem: tipoOrigem === 'ia' || tipoOrigem === 'manual' ? tipoOrigem : 'regex',
      categoria_ml_id: categoriaMlId,
      atributos_ml: atributosMl,
      analise_mercado: analiseMercado,
      status: 'pronto',
    }).eq('id', job.familia_id);
    if (persistErr) throw new Error(`Persist final: ${persistErr.message}`);

    return new Response('OK', { status: 200, headers: corsHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from('familias').update({
      status: 'erro',
      erro_mensagem: msg,
    }).eq('id', job.familia_id);
    // 5xx → QStash retenta. 4xx (já consumido com erro persistido) → 200.
    const retry = !/4\d\d/.test(msg);
    return new Response(`Erro: ${msg}`, {
      status: retry ? 500 : 200,
      headers: corsHeaders,
    });
  }
});
