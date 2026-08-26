// ADR-0135 D-9 — edição fiscal de família existente (o "modo edição" que faltava). Chamada
// pelo APP com JWT (não é worker QStash), casca no padrão de cadastrar-produto/index.ts.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { enfileirarSincronizacaoFiscal } from '../_shared/queue.ts';
import { processarAtualizacaoFiscal, validarShapeEntrada, type EntradaFiscal } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  if (!(await exigirModulo(admin, orgId, 'fiscal'))) {
    return json({ error: 'Módulo fiscal não habilitado para esta organização.' }, 403);
  }

  let entrada: EntradaFiscal;
  try { entrada = await req.json() as EntradaFiscal; }
  catch { return json({ error: 'JSON inválido' }, 400); }

  const erroShape = validarShapeEntrada(entrada);
  if (erroShape) return json({ erros: [{ campo: 'body', mensagem: erroShape }] }, 400);

  const resultado = await processarAtualizacaoFiscal(
    { admin, orgId, enfileirarPush: enfileirarSincronizacaoFiscal }, entrada,
  );

  if (resultado.tipo === 'nao_encontrada') return json({ error: 'Família não encontrada.' }, 404);
  if (resultado.tipo === 'falha') {
    console.error('atualizar-fiscal-familia falhou:', resultado.mensagem);
    return json({ error: 'Falha ao salvar os dados fiscais. Tente novamente.' }, 500);
  }
  if (resultado.tipo === 'invalido') {
    return json({ erros: resultado.erros.map((mensagem) => ({ campo: 'fiscal', mensagem })) }, 400);
  }
  return json({ ok: true, pushEnfileirado: resultado.pushEnfileirado });
});
