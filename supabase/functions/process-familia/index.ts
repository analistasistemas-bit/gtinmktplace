import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { extrairCorDeVariacao, extrairCorECodigo } from '../_shared/cor/extrair.ts';
import { pool } from '../_shared/concorrencia/pool.ts';
import { cacheCorGet, cacheCorSet, type OrigemCor } from '../_shared/redis/cache-cor.ts';
import { extrairCorPorVision } from '../_shared/ai/vision.ts';
import { gerarCopy } from '../_shared/ai/copywriter.ts';
import { garantirMetragemTitulo, garantirCorTitulo, garantirTipoProdutoTitulo, removerMarketingNaoGrounded } from '../_shared/ai/titulo.ts';
import { buscarConcorrencia } from '../_shared/ml/concorrencia.ts';
import { sugerirPrecoVenda, grossUp, PRECO_REF_COMISSAO } from '../_shared/preco/sugerir.ts';
import { arredondar5Proximo } from '../_shared/preco/arredondar.ts';
import { calcularPrecoLiderMaisVendas } from '../_shared/preco/piso-lider.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { decidirRetryPorErro } from '../_shared/publicacao/retry.ts';
import { buscarListingPrice, comissaoDe } from '../_shared/ml/listing-prices.ts';
import { buscarFreteVendedor } from '../_shared/ml/frete.ts';
import { montarAtributosML, preencherUnitsPerPack, categoriaParaTipo, tipoParaCategoria, type AtributoML } from '../_shared/categoria/atributos.ts';
import { resolverAtributosGenericos } from '../_shared/categoria/resolver-atributos-genericos.ts';
import { resolverCategoria, ehCategoriaGenerica } from '../_shared/categoria/resolver.ts';
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
    .select('id, user_id, org_id, nome_pai, descricao_pai, lote_id, operacao, fornecedor, origem, unidade, categoria_ml_id, atributos_ml, atributos_faltantes, atributos_editados_pelo_operador')
    .maybeSingle();
  if (claimErr) {
    return new Response(`Claim: ${claimErr.message}`, { status: 500, headers: corsHeaders });
  }
  if (!claimed) {
    return new Response('Already processed', { status: 200, headers: corsHeaders });
  }

  const userId = claimed.user_id as string;
  const orgId = claimed.org_id as string;
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');

  try {
    // 2. Carregar variações
    const { data: variacoes, error: varErr } = await admin
      .from('variacoes')
      .select('id, codigo, gtin, cor, cor_origem, nome, preco, custo, preco_editado_pelo_operador, imagem_path, peso_gramas, altura_cm, largura_cm, comprimento_cm')
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
        const cached = await cacheCorGet(orgId, v.codigo);
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
          await cacheCorSet(orgId, v.codigo, { cor: visionResult.cor, origem: 'vision' });
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
    // Sem conexão ML: buscarConcorrencia lança internamente e cai no próprio catch → NENHUMA.
    const concorrencia = await buscarConcorrencia(conexao, {
      nome_pai: claimed.nome_pai,
      variacoes: resolvidas.map((v) => ({ gtin: v.gtin })),
    });

    // 5c. Categoria + atributos (ADR-0026 / E3). Resolução em camadas: override (aviamento)
    // → preditor nativo do ML → desempate LLM (ambíguo) → manual. Token içado 1x (resolver +
    // gross-up). Resiliente: falha de token/rede → cai p/ override-ou-'outro', nunca quebra.
    // Calculado ANTES do preço porque o gross-up usa categoriaMlId.
    let token: string | null = null;
    try { if (!conexao) throw new Error('Organização sem conexão com o Mercado Livre'); token = await getValidAccessTokenConexao(conexao); } catch (e) { console.error('token p/ categoria/preço falhou:', e); }

    const fornecedor = (claimed.fornecedor as string | null) ?? undefined;
    // Marca padrão por org (D-E7.3): fallback do BRAND/MANUFACTURER quando o produto não
    // traz marca própria. Default 'Avil' preservado dentro de montarAtributosML/Base.
    const { data: orgRow } = await admin.from('organizations').select('marca_padrao').eq('id', orgId).maybeSingle();
    const marcaPadrao = (orgRow?.marca_padrao as string | null) ?? undefined;
    const cat = await resolverCategoria(
      { nome: claimed.nome_pai, descricao: claimed.descricao_pai ?? undefined, tipoProdutoBusca: copy.tipo_produto_busca },
      {
        preditor: (q) => (token ? buscarCategoriaPreditor(token, q) : Promise.resolve([])),
        llm: desempatarCategoriaLLM,
      },
    );
    let tipo = cat.tipo;
    let categoriaMlId = cat.categoriaId;
    let categoriaNome = cat.categoriaNome;
    let categoriaOrigem = cat.origem;

    // Categoria via NOME de catálogo (lote #27): quando o preditor TEXTUAL cai em genérica
    // ("Outros") ou manual por nome ruidoso ("BARROCO MAXCOLOR BRILHO 200GR"), mas a concorrência
    // achou o produto no catálogo do ML, o NOME CANÔNICO do catálogo ("Fio Barroco Maxcolor Brilho
    // ... Crochê") resolve a categoria certa. Re-roda o preditor com ele e pega o 1º candidato
    // específico. Verificado: o nome de catálogo do BRILHO → MLB271471 "Lãs". O category_id do
    // produto de catálogo NÃO é exposto pela API (só domain_id), por isso vamos pelo nome.
    // Resiliente: falha/rede/só genérico → mantém o resultado do preditor textual.
    if ((cat.origem === 'generico' || cat.origem === 'manual') && concorrencia.product_name && token) {
      const candidatos = await buscarCategoriaPreditor(token, concorrencia.product_name).catch(() => []);
      const especifico = candidatos.find((c) => !ehCategoriaGenerica(c.categoriaNome));
      if (especifico) {
        categoriaMlId = especifico.categoriaId;
        categoriaNome = especifico.categoriaNome;
        tipo = tipoParaCategoria(especifico.categoriaId);
        categoriaOrigem = 'preditor'; // categoria vinda do nome canônico do catálogo, não do texto sujo
      }
    }

    let atributosMl: AtributoML[] = [];
    let faltantes: string[] = [];
    if (claimed.atributos_editados_pelo_operador && categoriaMlId === claimed.categoria_ml_id) {
      // Camada 2B (ADR-0052): o operador completou atributos manualmente na Revisão. Preserva a
      // edição contra o reprocessamento (espelha título/descrição) — SÓ se a categoria não mudou;
      // se o preditor recalcular outra categoria, a edição é de outro schema → deixa recalcular.
      atributosMl = (claimed.atributos_ml as AtributoML[] | null) ?? [];
      faltantes = (claimed.atributos_faltantes as string[] | null) ?? [];
    } else if (categoriaParaTipo(tipo) != null) {
      // Tipo de aviamento conhecido (via regex OU categoria do preditor mapeada de volta ao
      // tipo): obrigatórios curados (BRAND, MODEL, RIBBON_TYPE…) — determinísticos, têm
      // prioridade e não dependem do schema/IA (que podem falhar e deixar atributos vazios).
      atributosMl = montarAtributosML(tipo, claimed.nome_pai, fornecedor, claimed.descricao_pai ?? undefined, marcaPadrao);
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
    } else if (categoriaMlId) {
      // Categoria genérica (não-aviamento): _shared/categoria/resolver-atributos-genericos.ts
      // (mesmo fluxo reusado pelo seletor manual de categoria livre, ADR-0057).
      const r = await resolverAtributosGenericos(
        categoriaMlId,
        { nome: claimed.nome_pai, descricao: claimed.descricao_pai ?? undefined, fornecedor },
        {
          lerSchema: (id) => {
            if (!token) return Promise.reject(new Error('sem token p/ ler schema da categoria'));
            return lerSchemaAtributos(token, id);
          },
          llm: desempatarAtributosLLM,
        },
        marcaPadrao,
      );
      atributosMl = r.atributosMl;
      faltantes = r.faltantes;
    }
    // categoriaMlId null (origem 'manual') → faltantes fica [] aqui, mas o gate de publicação
    // bloqueia por categoria ausente até o operador escolhê-la na Revisão.

    // 5d. Estratégia de preço v2 (ADR-0020). PRECO = líquido mínimo desejado.
    // Com concorrente → mercado (× 0,95). Sem concorrente → gross-up (busca comissão 1x).
    const conc = { vendedores: concorrencia.vendedores, preco_min: concorrencia.preco_min };
    const precoMinFamilia = resolvidas.length
      ? Math.min(...resolvidas.map((v) => Number(v.preco)))
      : 0;
    const competitivo = conc.vendedores > 0 && conc.preco_min != null;

    // Imposto por origem (ADR-0055): entra no gross-up para o preço cobrir o imposto.
    const { data: cfgAliq } = await admin
      .from('configuracoes')
      .select('aliquota_nacional_pct, aliquota_importado_pct, desconto_concorrencia_pct, reancora_lider_ativa')
      .eq('user_id', userId)
      .maybeSingle();
    const aliquotaPct = claimed.origem === 'importado'
      ? Number(cfgAliq?.aliquota_importado_pct ?? 16)
      : Number(cfgAliq?.aliquota_nacional_pct ?? 8);
    // ADR-0059: desconto sobre o menor preço concorrente, configurável (default 5%).
    const descontoConcorrenciaPct = Number(cfgAliq?.desconto_concorrencia_pct ?? 5);
    // ADR-0065: toggle da re-âncora no preço do MercadoLíder com mais vendas.
    const reancoraAtiva = Boolean(cfgAliq?.reancora_lider_ativa);

    let comissao: { percentual: number; fixa: number } | null = null;
    let frete = 0;
    let precoAncoraLider: number | null = null;
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
        if (conexao?.contaExternaId && resolvidas.length) {
          const rep = resolvidas.reduce((m, v) => (Number(v.preco) < Number(m.preco) ? v : m), resolvidas[0]);
          const dimRep = {
            altura_cm: rep.altura_cm != null ? Number(rep.altura_cm) : null,
            largura_cm: rep.largura_cm != null ? Number(rep.largura_cm) : null,
            comprimento_cm: rep.comprimento_cm != null ? Number(rep.comprimento_cm) : null,
            peso_gramas: rep.peso_gramas != null ? Number(rep.peso_gramas) : null,
          };
          const precoPrimeiraPassada = grossUp(precoMinFamilia, comissao.percentual, comissao.fixa, 0, aliquotaPct);
          frete = await buscarFreteVendedor(token, conexao.contaExternaId, precoPrimeiraPassada, categoriaMlId, dimRep);
        }
      } catch (e) {
        // Resiliente: sem comissão o gross-up cai no piso; o semáforo mostra "indisponível".
        console.error('comissão/frete p/ gross-up falhou:', e);
      }
    }

    // ADR-0065: re-âncora no preço do MercadoLíder com mais vendas — só no ramo competitivo, gated pelo
    // toggle. O gatilho 🔴 avalia o líquido do PREÇO COMPETITIVO, então comissão e faixa de
    // frete são estimadas nesse preço (não no da âncora). Resiliente: falha → sem re-âncora.
    if (competitivo && reancoraAtiva && categoriaMlId && token) {
      try {
        const lp = await buscarListingPrice(token, PRECO_REF_COMISSAO, categoriaMlId, 'gold_special');
        comissao = comissaoDe(lp);
        precoAncoraLider = await calcularPrecoLiderMaisVendas(token, concorrencia.ofertas?.ofertas_detalhe ?? []);
        if (conexao?.contaExternaId && resolvidas.length) {
          const rep = resolvidas.reduce((m, v) => (Number(v.preco) < Number(m.preco) ? v : m), resolvidas[0]);
          const dimRep = {
            altura_cm: rep.altura_cm != null ? Number(rep.altura_cm) : null,
            largura_cm: rep.largura_cm != null ? Number(rep.largura_cm) : null,
            comprimento_cm: rep.comprimento_cm != null ? Number(rep.comprimento_cm) : null,
            peso_gramas: rep.peso_gramas != null ? Number(rep.peso_gramas) : null,
          };
          const precoEstimado = arredondar5Proximo(conc.preco_min! * (1 - descontoConcorrenciaPct / 100));
          frete = await buscarFreteVendedor(token, conexao.contaExternaId, precoEstimado, categoriaMlId, dimRep);
        }
      } catch (e) {
        console.error('comissão/piso-líder p/ re-âncora falhou:', e);
        precoAncoraLider = null;
      }
    }

    // Decisão FAMÍLIA-level (pior caso de custo): o mesmo precoAncoraLider/custo se aplica a
    // todas as cores, senão o preço competitivo divergiria entre variações da família.
    // Invariante: só é família-level-safe porque este worker roda no CREATE fresco — nenhuma
    // variação tem preco_editado_pelo_operador ainda. Se um dia repricar família já revisada,
    // a flag (família) poderia mentir sobre uma variação com preço manual (ver ADR-0065/e6dee14).
    const maiorCustoFamilia = resolvidas.length ? Math.max(...resolvidas.map((v) => Number(v.custo))) : 0;
    const reancora = { ativa: reancoraAtiva, precoAncoraLider, custo: maiorCustoFamilia, comissao };

    const updatesPreco = resolvidas
      .filter((v) => !v.preco_editado_pelo_operador)
      .map((v) => {
        const { preco } = sugerirPrecoVenda(Number(v.preco), conc, comissao, frete, aliquotaPct, descontoConcorrenciaPct, reancora);
        return admin.from('variacoes')
          .update({ preco_publicacao: preco })
          .eq('id', v.id);
      });
    await Promise.all(updatesPreco);

    const estrategiaFamilia = sugerirPrecoVenda(precoMinFamilia, conc, comissao, frete, aliquotaPct, descontoConcorrenciaPct, reancora);

    // 5e. Potencial de venda (ADR-0015) — só quando há produto de catálogo (origem gtin).
    const analiseMercado =
      concorrencia.origem === 'gtin' && concorrencia.product_id && concorrencia.ofertas
        ? await analisarMercado(conexao, concorrencia.product_id, categoriaMlId, concorrencia.ofertas)
        : null;

    // 6. Persistir título + descrição + custos + concorrência + estratégia + categoria + status final.
    // estrategia_preco já vem minúscula de sugerirPrecoVenda (bate com o enum); garante tipo_origem
    // válido (regex/ia/manual). Checa o erro do update para não marcar 'pronto' em silêncio.
    // Cor única → crava a cor no título (anti-duplicado do ML, ADR-0044): famílias-irmãs que
    // diferem só na cor (PAI separado) não podem ter título idêntico.
    const coresUnicas = [...new Set(resolvidas.map((v) => v.cor).filter((c): c is string => !!c))];
    const { error: persistErr } = await admin.from('familias').update({
      titulo_ml: garantirCorTitulo(
        garantirMetragemTitulo(garantirTipoProdutoTitulo(removerMarketingNaoGrounded(copy.titulo, claimed.nome_pai, claimed.descricao_pai ?? ''), copy.tipo_produto_busca), claimed.nome_pai),
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
      concorrencia_categoria_id: concorrencia.ofertas?.category_id ?? null,
      estrategia_preco: estrategiaFamilia.estrategia,
      estrategia_motivo: estrategiaFamilia.motivo,
      preco_reancorado_lider: estrategiaFamilia.reancorado,
      tipo_aviamento: tipo,
      tipo_origem: categoriaOrigem,
      categoria_ml_id: categoriaMlId,
      categoria_nome: categoriaNome,
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
