import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { extrairCorDeVariacao, extrairCorECodigo } from '../_shared/cor/extrair.ts';
import { pool } from '../_shared/concorrencia/pool.ts';
import { cacheCorGet, cacheCorSet, type OrigemCor } from '../_shared/redis/cache-cor.ts';
import { extrairCorPorVision } from '../_shared/ai/vision.ts';
import { gerarCopy } from '../_shared/ai/copywriter.ts';
import { garantirMetragemTitulo, garantirCorTitulo } from '../_shared/ai/titulo.ts';
import { buscarConcorrencia } from '../_shared/ml/concorrencia.ts';
import { sugerirPrecoVenda, grossUp, PRECO_REF_COMISSAO } from '../_shared/preco/sugerir.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { decidirRetryPorErro } from '../_shared/publicacao/retry.ts';
import { buscarListingPrice, comissaoDe } from '../_shared/ml/listing-prices.ts';
import { buscarFreteVendedor } from '../_shared/ml/frete.ts';
import { montarAtributosML, montarAtributosBase, atributosFaltantesGenerico, preencherUnitsPerPack, type AtributoML } from '../_shared/categoria/atributos.ts';
import { resolverCategoria } from '../_shared/categoria/resolver.ts';
import { buscarCategoriaPreditor } from '../_shared/ml/domain-discovery.ts';
import { lerSchemaAtributos } from '../_shared/categoria/schema.ts';
import { desempatarCategoriaLLM } from '../_shared/ai/categoria-llm.ts';
import { preencherAtributosClosedSet, desempatarAtributosLLM } from '../_shared/ai/atributos-llm.ts';
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
      .select('id, codigo, gtin, cor, cor_origem, nome, preco, preco_editado_pelo_operador, imagem_path, peso_gramas, altura_cm, largura_cm, comprimento_cm')
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

      // Camada 1 — dicionário (só nome da variação + nome do pai; a descrição é prosa
      // de marketing com cores incidentais → falso positivo, ver extrairCorDeVariacao)
      const corTexto = extrairCorDeVariacao(v.nome, claimed.nome_pai);
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

    // 5c. Categoria + atributos (ADR-0026 / E3). Resolução em camadas: override (aviamento)
    // → preditor nativo do ML → desempate LLM (ambíguo) → manual. Token içado 1x (resolver +
    // gross-up). Resiliente: falha de token/rede → cai p/ override-ou-'outro', nunca quebra.
    // Calculado ANTES do preço porque o gross-up usa categoriaMlId.
    let token: string | null = null;
    try { token = await getValidAccessToken(userId); } catch (e) { console.error('token p/ categoria/preço falhou:', e); }

    const fornecedor = (claimed.fornecedor as string | null) ?? undefined;
    const cat = await resolverCategoria(
      { nome: claimed.nome_pai, descricao: claimed.descricao_pai ?? undefined },
      {
        preditor: (q) => (token ? buscarCategoriaPreditor(token, q) : Promise.resolve([])),
        llm: desempatarCategoriaLLM,
      },
    );
    const tipo = cat.tipo;
    const categoriaMlId = cat.categoriaId;

    let atributosMl: AtributoML[] = [];
    let faltantes: string[] = [];
    if (cat.origem === 'regex') {
      // Obrigatórios curados (BRAND, RIBBON_TYPE, MATERIAL…) — determinísticos, têm prioridade.
      atributosMl = montarAtributosML(tipo, claimed.nome_pai, fornecedor, claimed.descricao_pai ?? undefined);
      // Enriquece com os demais atributos da categoria p/ melhorar a nota de qualidade do anúncio:
      // closed-set opcionais (ex.: Formato da fita) + numéricos (ex.: Comprimento) via IA, validados
      // contra o schema (nunca inventa) e sem sobrescrever os curados. Resiliente: falha → só os curados.
      if (token && categoriaMlId) {
        try {
          const schema = await lerSchemaAtributos(token, categoriaMlId);
          atributosMl = await preencherAtributosClosedSet(
            schema, atributosMl,
            { nome: claimed.nome_pai, descricao: claimed.descricao_pai ?? undefined },
            desempatarAtributosLLM,
          );
          atributosMl = preencherUnitsPerPack(schema, atributosMl, claimed.nome_pai, claimed.descricao_pai ?? undefined);
        } catch (e) { console.error('enriquecimento de atributos (regex) falhou:', e); }
      }
    } else if (categoriaMlId && token) {
      try {
        const schema = await lerSchemaAtributos(token, categoriaMlId);
        const base = montarAtributosBase(schema, claimed.nome_pai, fornecedor);
        // E4: IA preenche os obrigatórios closed-set (ex.: VOLTAGE) escolhendo dentro de values[].
        atributosMl = await preencherAtributosClosedSet(
          schema, base,
          { nome: claimed.nome_pai, descricao: claimed.descricao_pai ?? undefined },
          desempatarAtributosLLM,
        );
        // UNITS_PER_PACK é numérico (sem closed-set) → a IA não cobre; extrai do nome/descrição.
        atributosMl = preencherUnitsPerPack(schema, atributosMl, claimed.nome_pai, claimed.descricao_pai ?? undefined);
        faltantes = atributosFaltantesGenerico(atributosMl, schema);
      } catch (e) { console.error('schema/atributos falhou:', e); }
    }

    // 5d. Estratégia de preço v2 (ADR-0020). PRECO = líquido mínimo desejado.
    // Com concorrente → mercado (× 0,95). Sem concorrente → gross-up (busca comissão 1x).
    const conc = { vendedores: concorrencia.vendedores, preco_min: concorrencia.preco_min };
    const precoMinFamilia = resolvidas.length
      ? Math.min(...resolvidas.map((v) => Number(v.preco)))
      : 0;
    const competitivo = conc.vendedores > 0 && conc.preco_min != null;

    let comissao: { percentual: number; fixa: number } | null = null;
    let frete = 0;
    if (!competitivo && categoriaMlId && token) {
      try {
        // ADR-0023: lê a comissão ACIMA do abismo de R$ 12,50; no piso (precoMinFamilia)
        // pegaríamos a tarifa fixa de 50% e o gross-up subestimaria o preço.
        const lp = await buscarListingPrice(token, PRECO_REF_COMISSAO, categoriaMlId, 'gold_special');
        comissao = comissaoDe(lp);
        // Frete grátis que o vendedor absorve também entra no gross-up: o líquido tem que
        // cobrir o piso depois de comissão E frete (ADR-0020). Avaliado no preço de 1ª passada
        // (só comissão) — que já cai na faixa de frete grátis, dando o list_cost representativo.
        // Dimensões da variação de menor preço (a "representativa" do painel de análise).
        // Resiliente: sem credencial/dimensões/rede → frete 0 (comportamento anterior).
        const { data: cred } = await admin
          .from('ml_credentials').select('ml_user_id').eq('user_id', userId).maybeSingle();
        if (cred?.ml_user_id && resolvidas.length) {
          const rep = resolvidas.reduce((m, v) => (Number(v.preco) < Number(m.preco) ? v : m), resolvidas[0]);
          const dimRep = {
            altura_cm: rep.altura_cm != null ? Number(rep.altura_cm) : null,
            largura_cm: rep.largura_cm != null ? Number(rep.largura_cm) : null,
            comprimento_cm: rep.comprimento_cm != null ? Number(rep.comprimento_cm) : null,
            peso_gramas: rep.peso_gramas != null ? Number(rep.peso_gramas) : null,
          };
          const precoPrimeiraPassada = grossUp(precoMinFamilia, comissao.percentual, comissao.fixa);
          frete = await buscarFreteVendedor(token, String(cred.ml_user_id), precoPrimeiraPassada, categoriaMlId, dimRep);
        }
      } catch (e) {
        // Resiliente: sem comissão o gross-up cai no piso; o semáforo mostra "indisponível".
        console.error('comissão/frete p/ gross-up falhou:', e);
      }
    }

    const updatesPreco = resolvidas
      .filter((v) => !v.preco_editado_pelo_operador)
      .map((v) => {
        const { preco } = sugerirPrecoVenda(Number(v.preco), conc, comissao, frete);
        return admin.from('variacoes')
          .update({ preco_publicacao: preco })
          .eq('id', v.id);
      });
    await Promise.all(updatesPreco);

    const estrategiaFamilia = sugerirPrecoVenda(precoMinFamilia, conc, comissao, frete);

    // 5e. Potencial de venda (ADR-0015) — só quando há produto de catálogo (origem gtin).
    const analiseMercado =
      concorrencia.origem === 'gtin' && concorrencia.product_id && concorrencia.ofertas
        ? await analisarMercado(userId, concorrencia.product_id, categoriaMlId, concorrencia.ofertas)
        : null;

    // 6. Persistir título + descrição + custos + concorrência + estratégia + categoria + status final.
    // estrategia_preco já vem minúscula de sugerirPrecoVenda (bate com o enum); garante tipo_origem
    // válido (regex/ia/manual). Checa o erro do update para não marcar 'pronto' em silêncio.
    // Cor única → crava a cor no título (anti-duplicado do ML, ADR-0044): famílias-irmãs que
    // diferem só na cor (PAI separado) não podem ter título idêntico.
    const coresUnicas = [...new Set(resolvidas.map((v) => v.cor).filter((c): c is string => !!c))];
    const { error: persistErr } = await admin.from('familias').update({
      titulo_ml: garantirCorTitulo(
        garantirMetragemTitulo(copy.titulo, claimed.nome_pai),
        coresUnicas.length === 1 ? coresUnicas[0] : null,
        coresUnicas.length,
      ),
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
      tipo_origem: cat.origem,
      categoria_ml_id: categoriaMlId,
      categoria_nome: cat.categoriaNome,
      atributos_ml: atributosMl,
      atributos_faltantes: faltantes,
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
    // Retenta transitórios (5xx/429/retentável); 4xx conhecido → 200 (já persistido). Ver plans/005.
    const retry = decidirRetryPorErro(err);
    return new Response(`Erro: ${msg}`, {
      status: retry ? 500 : 200,
      headers: corsHeaders,
    });
  }
});
