// ADR-0197 (decisão 11): título e descrição do kit com variação por IA, chamados pela prévia da tela
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
  montarUserPromptKit, posProcessarDescricaoKit, posProcessarTituloKit, SYSTEM_KIT_VARIACAO,
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
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const pecas = body.pecas_por_kit;
  if (typeof body.familia_base_id !== 'string' || !body.familia_base_id) {
    return json({ error: 'familia_base_id é obrigatório.' }, 400);
  }
  if (typeof pecas !== 'number' || !Number.isInteger(pecas) || pecas < 2 || pecas > 6) {
    return json({ error: 'pecas_por_kit deve ser um inteiro de 2 a 6.' }, 400);
  }
  const cores = Array.isArray(body.cores)
    ? body.cores.filter((c): c is string => typeof c === 'string' && c.trim() !== '').slice(0, 30)
    : [];

  const target = { type: 'familia', id: body.familia_base_id };
  // Erro de leitura nunca vira 404.
  const { data: base, error } = await admin.from('familias')
    .select('nome_pai, titulo_ml, descricao_pai, descricao_ml')
    .eq('id', body.familia_base_id).eq('org_id', orgId).maybeSingle();
  if (error) return json({ error: 'Falha ao carregar a família base. Tente novamente.' }, 500);
  if (!base) return json({ error: 'Família base não encontrada.' }, 404);

  try {
    const modelo = await resolverModeloTexto(admin, orgId);
    const resp = await openrouterClient().chat.completions.create(
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
    const bruto = JSON.parse(resp.choices[0]?.message?.content ?? '') as { titulo?: unknown; descricao?: unknown };
    if (typeof bruto.titulo !== 'string' || typeof bruto.descricao !== 'string' || !bruto.titulo.trim() || !bruto.descricao.trim()) {
      throw new Error('resposta sem título ou descrição');
    }
    const usage = resp.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
    await auditarOperacaoSuporte(admin, context, target, 'succeeded');
    return json({
      titulo: posProcessarTituloKit(bruto.titulo, pecas),
      descricao: posProcessarDescricaoKit(bruto.descricao, pecas),
      tokens_input: usage.prompt_tokens,
      tokens_output: usage.completion_tokens,
      custo_centavos: custoCentavos(modelo, usage),
    });
  } catch (e) {
    console.error('gerar-texto-kit: IA falhou:', e);
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: 'Não foi possível gerar o texto do kit. Tente novamente.' }, 502);
  }
});
