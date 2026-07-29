// E6b (ADR-0094, D-1/D-1.1): cadastro manual de produto. Grava um LOTE normal
// (origem='manual') e cai na mesma Revisão de sempre — process-familia,
// publish-familia-ml, split e user products não mudam uma linha.
//
// Por que não há transação: as escritas passam por três caminhos diferentes (tabela, RPC
// security definer, QStash) e o supabase-js não expõe transação multi-statement. O desenho
// compensa com idempotência — re-executar o cadastro do mesmo produto para no guard 409, e
// re-executar o estoque inicial é no-op pela referência `cadastro:{familiaId}:{codigo}`.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { validarProdutoNovo, montarLinhasProduto, type ProdutoEntrada } from '../_shared/produto/validar.ts';
import { enfileirarFamilia } from '../_shared/queue.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

  // D-4: guard LOUD de duplicata. A unique do banco é (lote_id, codigo_pai), então dois lotes
  // diferentes aceitariam o mesmo produto e criariam duas linhas canônicas concorrentes —
  // e a âncora do estoque (ADR-0025: família mais recente de (org_id, codigo)) passaria a
  // apontar para a errada. Erro explícito, nunca merge silencioso.
  const codigoPai = produto.codigoPai.trim();
  const { data: jaExiste } = await admin.from('familias')
    .select('id, lote_id').eq('org_id', orgId).eq('codigo_pai', codigoPai)
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();
  if (jaExiste) {
    return json({
      error: `O produto ${codigoPai} já existe nesta organização. `
        + 'Para repor saldo, use Entrada de estoque.',
      // A tela usa isto para oferecer "abrir o produto" em vez de deixar o operador preso:
      // se um cadastro anterior falhou no meio, a família existe mas está incompleta.
      familiaId: jaExiste.id, loteId: jaExiste.lote_id,
    }, 409);
  }

  // Guard de SKU: a unique do banco é (familia_id, codigo) — NÃO existe unique por org. As RPCs
  // de estoque resolvem a variação por (org_id, codigo) pegando a família mais recente, então um
  // SKU repetido entre produtos diferentes faria uma venda baixar o estoque do produto ERRADO.
  // Aqui é o único lugar onde dá para impedir.
  const codigosNovos = produto.variacoes.map((v) => v.codigo.trim());
  const { data: skusEmUso } = await admin.from('variacoes')
    .select('codigo, familias!inner(codigo_pai)')
    .eq('org_id', orgId).in('codigo', codigosNovos);
  const conflitos = [...new Set(
    (skusEmUso ?? [])
      .filter((v) => (v.familias as unknown as { codigo_pai: string }).codigo_pai !== codigoPai)
      .map((v) => v.codigo as string),
  )];
  if (conflitos.length > 0) {
    return json({
      error: `Estes SKUs já pertencem a outro produto desta organização: ${conflitos.join(', ')}. `
        + 'Um SKU só pode existir em um produto — renomeie ou use o produto existente.',
      conflitos,
    }, 409);
  }

  // D-1.1: reusa o lote manual ABERTO da org; cria um novo se não houver.
  const { data: aberto } = await admin.from('lotes')
    .select('id').eq('org_id', orgId).eq('origem', 'manual')
    .in('status', ['importando', 'processando', 'revisao'])
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();

  let loteId: string;
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

  const { familia, variacoes } = montarLinhasProduto(produto, { loteId, userId, orgId });

  const { data: familiaCriada, error: famErr } = await admin.from('familias')
    .insert(familia).select('id').single();
  if (famErr || !familiaCriada) return json({ error: famErr?.message ?? 'Falha criando família.' }, 400);
  const familiaId = familiaCriada.id as string;

  // O `select` é obrigatório: a etapa de fotos vincula a imagem pelo id da variação, não pelo código.
  const { data: variacoesCriadas, error: varErr } = await admin.from('variacoes')
    .insert(variacoes.map((v) => ({ ...v, familia_id: familiaId })))
    .select('id, codigo');
  if (varErr) {
    // Família sem variação é lixo — remove para não deixar estado parcial na Revisão.
    await admin.from('familias').delete().eq('id', familiaId);
    return json({ error: varErr.message }, 400);
  }

  // AGORA sim: a família já existe, então talvezFinalizarLote passa a enxergá-la e o lote não
  // pode ser fechado por baixo.
  if (precisaMarcarProcessando) {
    await admin.from('lotes').update({ status: 'processando' }).eq('id', loteId);
  }

  // Estoque inicial entra pelo caminho ÚNICO de escrita de estoque (D-15), nunca por UPDATE
  // direto — assim o movimento aparece no ledger e o custo é validado no mesmo lugar. A
  // referência derivada da família torna o retry idempotente pela unique parcial do ledger.
  const falhasEstoque: string[] = [];
  for (const v of produto.variacoes) {
    if (!v.estoqueInicial || v.estoqueInicial <= 0) continue;
    const codigo = v.codigo.trim();
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
