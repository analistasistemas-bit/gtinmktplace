// ADR-0200 (decisão 11): título e descrição do kit com variação por IA, chamados pela prévia da tela
// antes de criar o kit. Etapa própria: não passa por process-familia (que reescreveria o kit) e não
// grava nada — devolve o texto e o custo de tokens; quem grava é criar-kit-variacao, com o texto que
// o operador viu e aprovou.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { openrouterClient } from '../_shared/ai/client.ts';
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';
import { custoCentavos } from '../_shared/ai/tokens.ts';
import {
  MAX_CORES, montarUserPromptKit, posProcessarDescricaoKit, posProcessarTituloKit, SYSTEM_KIT_VARIACAO,
} from '../_shared/ai/copywriter-kit-prompt.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ({ orgId } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();

  // Mesmo gate de criar-kit-variacao: o texto só serve a quem pode criar o kit (ADR-0060).
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, context, { type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }
  if (!(await exigirModulo(admin, orgId, 'kit_variacao'))) {
    return json({ error: 'Módulo de kit com variação não habilitado para esta organização.' }, 403);
  }

  let body: { familia_base_id?: unknown; pecas_por_kit?: unknown; cores?: unknown };
  try {
    const bruto: unknown = await req.json();
    if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return json({ error: 'Corpo inválido.' }, 400);
    body = bruto as typeof body;
  } catch { return json({ error: 'JSON inválido' }, 400); }
  const pecas = body.pecas_por_kit;
  if (typeof body.familia_base_id !== 'string' || !body.familia_base_id) {
    return json({ error: 'familia_base_id é obrigatório.' }, 400);
  }
  if (typeof pecas !== 'number' || !Number.isInteger(pecas) || pecas < 2 || pecas > 6) {
    return json({ error: 'pecas_por_kit deve ser um inteiro de 2 a 6.' }, 400);
  }
  if (body.cores !== undefined && (!Array.isArray(body.cores) || body.cores.some((c) => typeof c !== 'string'))) {
    return json({ error: 'cores deve ser uma lista de textos.' }, 400);
  }

  const target = { type: 'familia', id: body.familia_base_id };
  // Erro de leitura nunca vira 404.
  const { data: base, error } = await admin.from('familias')
    .select('nome_pai, titulo_ml, descricao_pai, descricao_ml, variacoes(cor, excluida_da_publicacao)')
    .eq('id', body.familia_base_id).eq('org_id', orgId).maybeSingle();
  if (error) return json({ error: 'Falha ao carregar a família base. Tente novamente.' }, 500);
  if (!base) return json({ error: 'Família base não encontrada.' }, 404);

  // Cores: só as da própria base (nunca texto livre do cliente dentro do prompt).
  const coresBase = [...new Set(((base.variacoes ?? []) as Array<{ cor: string | null; excluida_da_publicacao?: boolean }>)
    .filter((v) => !v.excluida_da_publicacao).map((v) => String(v.cor ?? '').trim()).filter(Boolean))];
  const pedidas = (body.cores as string[] | undefined)?.map((c) => c.trim()) ?? [];
  const foraDaBase = pedidas.find((c) => !coresBase.includes(c));
  if (foraDaBase !== undefined) return json({ error: 'Cor fora da base.' }, 400);
  const cores = (pedidas.length > 0 ? pedidas : coresBase).slice(0, MAX_CORES);

  let modelo: string;
  let resp: {
    choices: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  try {
    modelo = await resolverModeloTexto(admin, orgId);
    resp = await openrouterClient().chat.completions.create(
      {
        model: modelo,
        messages: [
          { role: 'system', content: SYSTEM_KIT_VARIACAO },
          {
            role: 'user',
            content: montarUserPromptKit({
              nome: String(base.titulo_ml ?? base.nome_pai ?? ''),
              descricao: String(base.descricao_ml ?? base.descricao_pai ?? ''),
              pecas,
              cores,
            }),
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
      },
      { signal: AbortSignal.timeout(30_000) },
    );
  } catch (e) {
    console.error('gerar-texto-kit: IA falhou:', e);
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: 'Não foi possível gerar o texto do kit. Tente novamente.' }, 502);
  }

  // Consumo gravado ANTES de interpretar a resposta: JSON inválido e prévia descartada também custaram
  // tokens. Tokens e custo vêm do backend, nunca do cliente. Sem o registro não há texto (fail-closed).
  const usage = resp.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const custo = custoCentavos(modelo, usage);
  const { data: previa, error: errPrevia } = await admin.from('kit_variacao_previas').insert({
    org_id: orgId, familia_base_id: body.familia_base_id, pecas, modelo,
    tokens_input: usage.prompt_tokens, tokens_output: usage.completion_tokens, custo_centavos: custo,
  }).select('id').single();
  if (errPrevia || !previa) {
    console.error('gerar-texto-kit: registro de consumo falhou:', errPrevia);
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: 'Falha ao registrar o consumo de IA. Tente novamente.' }, 500);
  }

  try {
    const bruto = JSON.parse(resp.choices[0]?.message?.content ?? '') as { titulo?: unknown; descricao?: unknown };
    if (typeof bruto.titulo !== 'string' || typeof bruto.descricao !== 'string' || !bruto.titulo.trim() || !bruto.descricao.trim()) {
      throw new Error('resposta sem título ou descrição');
    }
    await auditarOperacaoSuporte(admin, context, target, 'succeeded');
    return json({
      previa_id: previa.id,
      titulo: posProcessarTituloKit(bruto.titulo, pecas, String(base.nome_pai ?? '')),
      descricao: posProcessarDescricaoKit(bruto.descricao, pecas),
      custo_centavos: custo,
    });
  } catch (e) {
    console.error('gerar-texto-kit: resposta da IA inválida:', e);
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: 'Não foi possível gerar o texto do kit. Tente novamente.' }, 502);
  }
});
