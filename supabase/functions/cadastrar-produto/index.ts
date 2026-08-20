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
// a perdedora devolve 409 "tente novamente" em vez de um 23505 cru (nada é observável da
// vencedora enquanto ela ainda está em voo); um 23505 de OUTRA constraint devolve o erro real.
// Reexecutar o estoque inicial já é no-op pela referência `cadastro:{familiaId}:{codigo}`.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { validarProdutoNovo, montarLinhasProduto, type ProdutoEntrada } from '../_shared/produto/validar.ts';
import { enfileirarFamilia } from '../_shared/queue.ts';
import { type CodigosGerados, codigosJaUsados, derivarCodigos } from '../_shared/produto/codigos.ts';
import { estoqueInicialDiverge, variacoesDivergem } from './processar.ts';

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

  // D-9: idempotência da submissão. Com código gerado, um retry produz códigos NOVOS e os
  // guards de duplicata não disparam — sem esta checagem, um timeout depois do insert
  // seguido de um segundo clique criaria uma segunda família e aplicaria o estoque inicial
  // duas vezes (a ref `cadastro:{familiaId}:{codigo}` muda junto com a família).
  //
  // `error` descartado de propósito: a unique parcial (org_id, chave_cadastro) no banco é a
  // rede de segurança de verdade. Um select que falhar aqui não duplica nada — cai no insert
  // normal, que se colidir é pego pelo ramo 23505 mais abaixo.
  const { data: jaCadastrado } = await admin.from('familias')
    .select('id, lote_id, qstash_message_id').eq('org_id', orgId).eq('chave_cadastro', produto.chaveCadastro)
    .maybeSingle();

  let familiaId: string;
  let loteId: string;
  let variacoesCriadas: { id: string; codigo: string }[];
  // Enfileirar de novo dispara o enriquecimento por IA (OpenRouter, pago) e pode sobrescrever
  // título/descrição que o operador já tenha editado — "idempotente" precisa valer para esse
  // efeito colateral caro, não só para o estado no banco. `false` para o caminho de criação
  // (a família é nova, nunca foi enfileirada).
  let jaEnfileirado = false;

  if (jaCadastrado) {
    // `.order('codigo')` NÃO é cosmético: o laço do estoque casa `variacoesCriadas[i]` com
    // `produto.variacoes[i]` por índice. Ver o comentário do laço — sem esta ordenação o
    // estoque inicial entra no SKU errado.
    const { data: vars } = await admin.from('variacoes')
      .select('id, codigo, nome, gtin, preco, custo, peso_gramas, altura_cm, largura_cm, comprimento_cm')
      .eq('familia_id', jaCadastrado.id).order('codigo');
    // Família e variações são dois inserts, dois commits: existe uma janela em que a família
    // já existe com zero variações. Sem este guard o operador chegaria à tela de fotos com
    // zero slots e toast de sucesso (cobre também erro de select engolido — mesmo teste).
    if (!vars || vars.length === 0) {
      return json({ error: 'Cadastro em andamento. Tente novamente.' }, 409);
    }
    // O formulário mudou entre as tentativas (a chave só é trocada quando o diálogo fecha).
    // Casar por índice aqui aplicaria estoque na variação errada — valor financeiro não se
    // assume, falha alto. Decisão extraída para `variacoesDivergem` (processar.ts) e coberta por
    // teste — nenhum outro teste do projeto executa este handler.
    //
    // Ao contrário do guard de lista vazia acima, aqui a família É verificável: está gravada e
    // completa, então "tente novamente" seria falso (nenhum retry com esta chave passa) e
    // deixaria o operador em loop — a saída seria fechar/reabrir o diálogo, gerando chave nova e
    // um SEGUNDO produto. Devolve `familiaId`/`loteId` para `src/lib/produtos-saldo.ts` virar
    // `ProdutoJaExisteError` e a tela oferecer "Abrir na Revisão".
    const divergiu = () => json({
      error: 'Este cadastro já foi gravado e o que foi enviado agora diverge do que está salvo. Abra na Revisão para conferir.',
      familiaId: jaCadastrado.id as string,
      loteId: jaCadastrado.lote_id as string,
    }, 409);
    if (variacoesDivergem(produto.variacoes, vars)) return divergiu();

    // Estoque inicial tem contrapartida no LEDGER, não em `variacoes.estoque` (que nasce 0 e
    // continua 0 se a primeira tentativa morreu antes do laço). Sem esta conferência, mudar o
    // Estoque entre as tentativas era descartado em silêncio: o laço lá embaixo reusa a mesma
    // referência, `registrar_entrada` faz `return null` no unique_violation, `falhasEstoque` fica
    // vazio e a tela mostra sucesso com o número novo enquanto o banco guarda o antigo.
    // Filtrar por `referencia_externa` (e não por `codigo`) é o que mantém venda/ajuste fora da
    // conta. Só roda depois de `variacoesDivergem`: é ela que descarta reordenação, sem a qual o
    // casamento por índice abaixo não valeria.
    const { data: movs, error: movErr } = await admin.from('estoque_movimentos')
      .select('codigo, quantidade').eq('org_id', orgId)
      .in('referencia_externa', vars.map((v) => `cadastro:${jaCadastrado.id}:${v.codigo}`));
    // Erro (ou retorno vazio sem erro) tratado como "nada aplicado" reabriria o defeito inteiro —
    // seguiria para o laço, que é no-op silencioso. Falha alto. Não trocar por `?? []`.
    if (movErr || !movs) {
      return json({ error: 'Falha conferindo o estoque já aplicado neste cadastro. Tente novamente.' }, 500);
    }
    if (estoqueInicialDiverge(produto.variacoes, vars.map((v) => v.codigo as string), movs)) return divergiu();
    familiaId = jaCadastrado.id as string;
    loteId = jaCadastrado.lote_id as string;
    variacoesCriadas = vars;
    jaEnfileirado = jaCadastrado.qstash_message_id != null;
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
      // Corrida com outra submissão da MESMA chave: a vencedora ainda está em voo — ainda vai
      // aplicar o estoque e enfileirar. Qualquer resposta de sucesso aqui seria previsão do que
      // a outra requisição vai fazer, não observação: o dado não existe ainda no instante desta
      // leitura, então não tem como montar. Devolvemos 409 e mandamos tentar de novo — o retry
      // passa pela pré-checagem (`jaCadastrado`) acima, que já tem a lógica certa: confere
      // variações, reaplica estoque de forma idempotente e decide `filaOk` pelo
      // `qstash_message_id` real. Preferir "tente novamente" a inventar um sucesso não
      // verificável.
      //
      // Discrimina por DADO, não pelo texto da mensagem: `familias` tem outra unique alcançável
      // por este mesmo insert (`familias_lote_id_codigo_pai_key`), e com o reuso do lote manual
      // aberto uma colisão de `codigo_pai` chegaria aqui como 23505 também — reportá-la como
      // "cadastro em andamento" seria mentira no erro e no log. Se existe família com esta
      // chave, foi a corrida de idempotência; se não existe, o 23505 veio de outra constraint.
      // `error` do select descartado de propósito: sem linha, cai no erro real logo abaixo.
      if (famErr.code === '23505') {
        const { data: mesmaChave } = await admin.from('familias')
          .select('id').eq('org_id', orgId).eq('chave_cadastro', produto.chaveCadastro).maybeSingle();
        if (mesmaChave) return json({ error: 'Cadastro em andamento. Tente novamente.' }, 409);
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
    // RETURNING incompleto sem erro: o laço do estoque indexaria `undefined` e estouraria com
    // TypeError. Mesmo tratamento do `varErr` — família sem variação é lixo.
    if (!novasVariacoes || novasVariacoes.length !== variacoes.length) {
      await admin.from('familias').delete().eq('id', familiaId);
      return json({ error: 'Falha criando variações.' }, 400);
    }
    // O Postgres NÃO garante que a ordem do RETURNING seja a ordem do array inserido. Ordenar
    // por `codigo` aqui dá ao caminho de criação o MESMO invariante que o `.order('codigo')` do
    // caminho de retry. Ver o comentário do laço do estoque — não remover por parecer supérfluo.
    variacoesCriadas = [...novasVariacoes].sort((a, b) => (a.codigo as string).localeCompare(b.codigo as string));

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
  //
  // INVARIANTE (obrigatório, os dois caminhos): `variacoesCriadas` chega aqui ORDENADA por
  // `codigo` — `.order('codigo')` no retry, `.sort` depois do insert na criação. Os códigos são
  // gerados sequencialmente na ordem do payload e formatados com oito dígitos (largura fixa),
  // então ordem lexicográfica = ordem numérica = ordem de `produto.variacoes`. É isso que torna
  // o casamento por índice abaixo correto; sem a ordenação, o estoque inicial entra no SKU
  // errado, em silêncio, e alimenta markup e preço.
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
  //
  // `jaEnfileirado` pula esta chamada no retry idempotente: reenfileirar rodaria o
  // enriquecimento por IA de novo (custo de tokens) e poderia sobrescrever título/descrição
  // já editados pelo operador. `filaOk: true` aqui é verdade — foi enfileirado na tentativa
  // anterior — não um valor fabricado.
  let filaOk = true;
  if (!jaEnfileirado) {
    try {
      const messageId = await enfileirarFamilia({ familia_id: familiaId, lote_id: loteId });
      await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', familiaId);
    } catch (e) {
      filaOk = false;
      console.error('cadastrar_produto_enfileirar_falhou', { familiaId, erro: String(e) });
    }
  }

  await auditarOperacaoSuporte(admin, context, { type: 'familia', id: familiaId }, 'succeeded');

  // Estado parcial é devolvido explicitamente, nunca escondido — a tela avisa o operador em vez
  // de deixá-lo achar que deu tudo certo.
  return json({
    loteId, familiaId, filaOk, falhasEstoque,
    variacoes: variacoesCriadas.map((v) => ({ id: v.id, codigo: v.codigo })),
  });
});
