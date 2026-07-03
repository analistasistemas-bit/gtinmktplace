import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { userClient } from '../_shared/supabase.ts';
import { categoriaParaTipo, montarAtributosML, rotuloParaTipo } from '../_shared/categoria/atributos.ts';
import type { TipoAviamento } from '../_shared/categoria/detectar.ts';

// Seletor manual de categoria (escape hatch do ADR-0009): o operador escolhe a
// categoria de uma família que a detecção por regex deixou em 'outro'. Reusa o
// código canônico de _shared para montar os atributos obrigatórios (sem duplicar
// a lógica no frontend e arriscar drift). Só tipos com categoria-folha mapeada.
const TIPOS_VALIDOS: TipoAviamento[] = ['linha', 'fita', 'botao', 'cola'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return new Response('Missing auth', { status: 401, headers: corsHeaders });
  }

  const sb = userClient(auth.slice(7));
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response('Invalid token', { status: 401, headers: corsHeaders });

  let body: { familia_id?: string; tipo?: string };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }

  const tipo = body.tipo as TipoAviamento;
  if (!body.familia_id || !TIPOS_VALIDOS.includes(tipo)) {
    return new Response('familia_id e tipo (linha/fita/botao/cola) obrigatórios', { status: 400, headers: corsHeaders });
  }

  // Operação compartilhada (ADR-0047/0056): a RLS is_membro_operacao já restringe à
  // operação; qualquer membro define a categoria. Sem filtro por user.id.
  const { data: familia, error } = await sb
    .from('familias')
    .select('id, nome_pai, descricao_pai, fornecedor')
    .eq('id', body.familia_id)
    .maybeSingle();

  if (error || !familia) {
    return new Response(`Família não encontrada: ${error?.message ?? ''}`, { status: 404, headers: corsHeaders });
  }

  const categoria_ml_id = categoriaParaTipo(tipo);
  const atributos_ml = montarAtributosML(
    tipo,
    familia.nome_pai,
    familia.fornecedor ?? undefined,
    familia.descricao_pai ?? undefined,
  );

  const { error: upErr } = await sb
    .from('familias')
    .update({
      categoria_ml_id,
      categoria_nome: rotuloParaTipo(tipo),
      tipo_aviamento: tipo,
      tipo_origem: 'manual',
      atributos_ml,
      atributos_faltantes: [], // aviamento manual: montarAtributosML preenche todos os obrigatórios
    })
    .eq('id', body.familia_id);

  if (upErr) {
    return new Response(`Erro ao atualizar: ${upErr.message}`, { status: 500, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({ categoria_ml_id, tipo_aviamento: tipo }),
    { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } },
  );
});
