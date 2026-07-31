// E6b (ADR-0094, D-1/D-1.1): cadastro manual de produto. Grava um LOTE normal
// (origem='manual') e cai na mesma Revisão de sempre — process-familia,
// publish-familia-ml, split e user products não mudam uma linha.
//
// Por que não há transação: as escritas passam por três caminhos diferentes (tabela, RPC
// security definer, QStash) e o supabase-js não expõe transação multi-statement. O desenho
// compensa com idempotência — os códigos (PAI e SKUs) são gerados pelo sistema
// (proximo_codigo_produto + derivarCodigos), não mais digitados pelo operador, então o retry
// idempotente depende de `chave_cadastro`: uma checagem prévia devolve o cadastro já criado, e
// a unique parcial (org_id, chave_cadastro) cobre a corrida entre duas submissões simultâneas —
// a perdedora também devolve o cadastro da vencedora em vez de um 23505 cru. Reexecutar o
// estoque inicial já é no-op pela referência `cadastro:{familiaId}:{codigo}`.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { validarProdutoNovo, montarLinhasProduto, type ProdutoEntrada } from '../_shared/produto/validar.ts';
import { enfileirarFamilia } from '../_shared/queue.ts';
import { type CodigosGerados, derivarCodigos } from '../_shared/produto/codigos.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/**
 * Confere os códigos GERADOS contra as duas tabelas (D-6).
 *
 * Cruzado de propósito: o guard antigo de PAI só olhava `familias` e o de SKU só olhava
 * `variacoes`. Com a sequência dessincronizada, um PAI gerado igual a um SKU já existente
 * passava pelos dois — e a resolução de estoque por (org_id, codigo) não distingue os dois
 * campos, então a venda baixaria o produto errado.
 */
async function codigosJaUsados(
  admin: ReturnType<typeof adminClient>,
  orgId: string,
  codigos: string[],
): Promise<string[]> {
  const [{ data: pais, error: ePais }, { data: vars, error: eVars }] = await Promise.all([
    admin.from('familias').select('codigo_pai').eq('org_id', orgId).in('codigo_pai', codigos),
    admin.from('variacoes').select('codigo').eq('org_id', orgId).in('codigo', codigos),
  ]);
  // Nenhuma unique é org-wide hoje ((lote_id, codigo_pai) e (familia_id, codigo) só). Erro de
  // consulta tratado como "sem colisão" deixaria passar um código duplicado sem rede de
  // segurança no banco — falha alto em vez de assumir. Não trocar por `?? []` de novo.
  if (ePais || eVars) throw new Error(`Falha conferindo códigos: ${(ePais ?? eVars)!.message}`);
  return [...new Set([
    ...(pais ?? []).map((f) => f.codigo_pai as string),
    ...(vars ?? []).map((v) => v.codigo as string),
  ])];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let userId: string;
  let orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ({ userId, orgId } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  if (!(await exigirModulo(admin, orgId, 'estoque'))) {
    return json({ error: 'Módulo de estoque não habilitado para esta organização.' }, 403);
  }

  let produto: ProdutoEntrada;
  try { produto = await req.json() as ProdutoEntrada; }
  catch { return json({ error: 'JSON inválido' }, 400); }

  const erros = validarProdutoNovo(produto);
  if (erros.length > 0) return json({ erros }, 400);

  // D-9: idempotência da submissão. Com código gerado, um retry produz códigos NOVOS e os
  // guards de duplicata não disparam — sem esta checagem, um timeout depois do insert
  // seguido de um segundo clique criaria uma segunda família e aplicaria o estoque inicial
  // duas vezes (a ref `cadastro:{familiaId}:{codigo}` muda junto com a família).
  //
  // `error` descartado de propósito: a unique parcial (org_id, chave_cadastro) no banco é a
  // rede de segurança de verdade. Um select que falhar aqui não duplica nada — cai no insert
  // normal, que se colidir é pego pelo ramo 23505 mais abaixo.
  const { data: jaCadastrado } = await admin.from('familias')
    .select('id, lote_id').eq('org_id', orgId).eq('chave_cadastro', produto.chaveCadastro)
    .maybeSingle();

  let familiaId: string;
  let loteId: string;
  let variacoesCriadas: { id: string; codigo: string }[];

  if (jaCadastrado) {
    const { data: vars } = await admin.from('variacoes')
      .select('id, codigo').eq('familia_id', jaCadastrado.id).order('codigo');
    // Família e variações são dois inserts, dois commits: existe uma janela em que a família
    // já existe com zero variações. Sem este guard o operador chegaria à tela de fotos com
    // zero slots e toast de sucesso (cobre também erro de select engolido — mesmo teste).
    if (!vars || vars.length === 0) {
      return json({ error: 'Cadastro em andamento. Tente novamente.' }, 409);
    }
    // A chave só muda depois de sucesso: se a contagem divergir, o operador editou o
    // formulário entre as tentativas. Casar por índice aqui aplicaria estoque na variação
    // errada — caminho financeiro, não arrisca.
    if (vars.length !== produto.variacoes.length) {
      return json({ error: 'Cadastro em andamento diverge do que foi enviado. Tente novamente.' }, 409);
    }
    familiaId = jaCadastrado.id as string;
    loteId = jaCadastrado.lote_id as string;
    variacoesCriadas = vars;
  } else {
    // A reserva vem ANTES de qualquer insert: assim o estouro de oito dígitos (D-5) e a
    // colisão falham sem deixar lote/família pela metade.
    const qtd = produto.variacoes.length + 1;
    let gerados: CodigosGerados;
    try {
      const { data: ultimo, error } = await admin.rpc('proximo_codigo_produto', {
        p_org: orgId, p_qtd: qtd,
      });
      if (error || ultimo == null) throw new Error(error?.message ?? 'sequência indisponível');
      gerados = derivarCodigos(Number(ultimo), qtd);

      // Colisão sobre código gerado: a sequência está atrás do que existe na org (planilha em
      // paralelo, ou módulo habilitado depois). Ressincroniza e tenta UMA vez (D-4.1).
      let usados = await codigosJaUsados(admin, orgId, [gerados.codigoPai, ...gerados.codigos]);
      if (usados.length > 0) {
        console.warn('cadastrar_produto_resync_sequencia', { orgId, usados });
        const { data: reUltimo, error: reErro } = await admin.rpc('proximo_codigo_produto', {
          p_org: orgId, p_qtd: qtd, p_resync: true,
        });
        if (reErro || reUltimo == null) throw new Error(reErro?.message ?? 'sequência indisponível');
        gerados = derivarCodigos(Number(reUltimo), qtd);
        usados = await codigosJaUsados(admin, orgId, [gerados.codigoPai, ...gerados.codigos]);
        if (usados.length > 0) {
          // D-10: erro de sistema. O operador não escolheu código nenhum — mandá-lo "renomear"
          // seria instrução impossível.
          console.error('cadastrar_produto_colisao_pos_resync', { orgId, usados });
          return json({ error: 'Falha na numeração automática. Tente novamente.' }, 500);
        }
      }
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'Falha na numeração automática.' }, 500);
    }

    // D-1.1: reusa o lote manual ABERTO da org; cria um novo se não houver.
    const { data: aberto } = await admin.from('lotes')
      .select('id').eq('org_id', orgId).eq('origem', 'manual')
      .in('status', ['importando', 'processando', 'revisao'])
      .order('criado_em', { ascending: false }).limit(1).maybeSingle();

    let precisaMarcarProcessando = false;
    if (aberto) {
      loteId = aberto.id as string;
      // NÃO marcar 'processando' agora. Entre o UPDATE e o INSERT da família existe uma janela
      // em que um worker de publicação pode rodar talvezFinalizarLote, não enxergar a família
      // (que ainda não existe) e fechar o lote — a família nasceria dentro de um lote fechado.
      precisaMarcarProcessando = true;
    } else {
      const { data: novo, error: loteErr } = await admin.from('lotes')
        .insert({ user_id: userId, org_id: orgId, status: 'processando', origem: 'manual' })
        .select('id').single();
      if (loteErr || !novo) return json({ error: 'Falha criando lote de cadastro.' }, 500);
      loteId = novo.id as string;
      const { data: numeroOrg } = await admin.rpc('proximo_numero_lote', { p_org: orgId });
      if (numeroOrg != null) await admin.from('lotes').update({ numero_org: numeroOrg }).eq('id', loteId);
    }

    const { familia, variacoes } = montarLinhasProduto(produto, {
      loteId, userId, orgId,
      codigoPai: gerados.codigoPai,
      codigos: gerados.codigos,
      chaveCadastro: produto.chaveCadastro,
    });

    const { data: familiaCriada, error: famErr } = await admin.from('familias')
      .insert(familia).select('id').single();
    if (famErr) {
      // Corrida com outra submissão da MESMA chave: a unique parcial decidiu quem grava. Quem
      // decide se é "corrida na mesma chave" é o DADO (o select abaixo, escopado por org_id +
      // chave_cadastro), não o texto da mensagem do Postgres — um 23505 de outra constraint
      // simplesmente não acha linha e cai no erro normal.
      if (famErr.code === '23505') {
        const { data: vencedora } = await admin.from('familias')
          .select('id, lote_id').eq('org_id', orgId).eq('chave_cadastro', produto.chaveCadastro)
          .maybeSingle();
        if (vencedora) {
          const { data: vars } = await admin.from('variacoes')
            .select('id, codigo').eq('familia_id', vencedora.id).order('codigo');
          // Mesmo guard de cima: a vencedora pode ainda não ter commitado as variações. Aqui
          // devolvemos erro em vez de seguir para o estoque — a outra requisição está viva e
          // cuidando disso; duas execuções concorrentes do mesmo laço não ajudariam.
          if (!vars || vars.length === 0) {
            return json({ error: 'Cadastro em andamento. Tente novamente.' }, 409);
          }
          return json({
            loteId: vencedora.lote_id, familiaId: vencedora.id,
            filaOk: true, falhasEstoque: [],
            variacoes: vars.map((v) => ({ id: v.id, codigo: v.codigo })),
          });
        }
      }
      return json({ error: famErr.message }, 400);
    }
    if (!familiaCriada) return json({ error: 'Falha criando família.' }, 400);
    familiaId = familiaCriada.id as string;

    // O `select` é obrigatório: a etapa de fotos vincula a imagem pelo id da variação, não pelo código.
    const { data: novasVariacoes, error: varErr } = await admin.from('variacoes')
      .insert(variacoes.map((v) => ({ ...v, familia_id: familiaId })))
      .select('id, codigo');
    if (varErr) {
      // Família sem variação é lixo — remove para não deixar estado parcial na Revisão.
      await admin.from('familias').delete().eq('id', familiaId);
      return json({ error: varErr.message }, 400);
    }
    variacoesCriadas = novasVariacoes ?? [];

    // AGORA sim: a família já existe, então talvezFinalizarLote passa a enxergá-la e o lote não
    // pode ser fechado por baixo.
    if (precisaMarcarProcessando) {
      await admin.from('lotes').update({ status: 'processando' }).eq('id', loteId);
    }
  }

  // Estoque inicial entra pelo caminho ÚNICO de escrita de estoque (D-15), nunca por UPDATE
  // direto — assim o movimento aparece no ledger e o custo é validado no mesmo lugar. A
  // referência derivada da família torna o retry idempotente pela unique parcial do ledger:
  // aplica se faltou, no-op se já aplicou — inclusive quando a primeira tentativa morreu entre
  // o insert das variações e este laço, e a segunda caiu no ramo `jaCadastrado` acima.
  const falhasEstoque: string[] = [];
  for (const [i, v] of produto.variacoes.entries()) {
    if (!v.estoqueInicial || v.estoqueInicial <= 0) continue;
    const codigo = variacoesCriadas[i].codigo;
    const { error } = await admin.rpc('registrar_entrada', {
      p_org: orgId, p_codigo: codigo, p_qtd: v.estoqueInicial,
      p_custo: v.custo ?? null, p_doc: 'Cadastro inicial', p_obs: null,
      p_criado_por: userId, p_ref: `cadastro:${familiaId}:${codigo}`,
    });
    if (error) falhasEstoque.push(`${codigo}: ${error.message}`);
  }

  // Mesmo enriquecimento por IA da planilha — process-familia exige familia_id E lote_id, e os
  // dois existem aqui justamente porque o cadastro cria um lote de verdade (D-1). Falha de
  // enfileiramento NÃO derruba o cadastro: a família fica 'pendente' e o operador reprocessa
  // pelo caminho que já existe (ADR-0030).
  let filaOk = true;
  try {
    const messageId = await enfileirarFamilia({ familia_id: familiaId, lote_id: loteId });
    await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', familiaId);
  } catch (e) {
    filaOk = false;
    console.error('cadastrar_produto_enfileirar_falhou', { familiaId, erro: String(e) });
  }

  await auditarOperacaoSuporte(admin, context, { type: 'familia', id: familiaId }, 'succeeded');

  // Estado parcial é devolvido explicitamente, nunca escondido — a tela avisa o operador em vez
  // de deixá-lo achar que deu tudo certo.
  return json({
    loteId, familiaId, filaOk, falhasEstoque,
    variacoes: (variacoesCriadas ?? []).map((v) => ({ id: v.id, codigo: v.codigo })),
  });
});
