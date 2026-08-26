// ADR-0135 D-9 — a IA SUGERE o NCM; a gravação é sempre ato do operador. Esta edge nunca
// escreve no banco. Chamada pelo APP com JWT, casca no padrão de atualizar-fiscal-familia/index.ts.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { openrouterClient } from '../_shared/ai/client.ts';
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';
import { extrairSugestaoNcm, montarPromptNcm } from './prompt.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const SEM_SUGESTAO = { ncm: null, justificativa: 'sugestão indisponível agora — preencha manualmente' };

interface EntradaFamilia { familiaId: string }
interface EntradaProduto { nome: string; descricao?: string; categoria?: string }
type Entrada = EntradaFamilia | EntradaProduto;

// Fronteira de confiança: shape mínimo antes de tocar `entrada.*` — mesmo padrão de
// atualizar-fiscal-familia/processar.ts:validarShapeEntrada.
function validarShapeEntrada(body: unknown): string | null {
  const b = body as Partial<EntradaFamilia & EntradaProduto> | null;
  if (!b) return 'body inválido';
  if (typeof b.familiaId === 'string' && b.familiaId.length > 0) return null;
  if (typeof b.nome === 'string' && b.nome.length > 0) return null;
  return 'familiaId (string) ou nome (string) são obrigatórios';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  if (!(await exigirModulo(admin, orgId, 'fiscal'))) {
    return json({ error: 'Módulo fiscal não habilitado para esta organização.' }, 403);
  }

  let entrada: Entrada;
  try { entrada = await req.json() as Entrada; }
  catch { return json({ error: 'JSON inválido' }, 400); }

  const erroShape = validarShapeEntrada(entrada);
  if (erroShape) return json({ erros: [{ campo: 'body', mensagem: erroShape }] }, 400);

  let produto: { nome: string; descricao: string | null; categoria: string | null };
  if ('familiaId' in entrada && entrada.familiaId) {
    const { data: familia, error } = await admin.from('familias')
      .select('nome_pai, descricao_pai, categoria_nome')
      .eq('id', entrada.familiaId).eq('org_id', orgId).maybeSingle();
    // Erro de leitura NUNCA vira 404: falha transitória do select não pode virar "não encontrada".
    if (error) return json({ error: 'Falha ao carregar a família. Tente novamente.' }, 500);
    if (!familia) return json({ error: 'Família não encontrada.' }, 404);
    produto = { nome: familia.nome_pai, descricao: familia.descricao_pai, categoria: familia.categoria_nome };
  } else {
    const p = entrada as EntradaProduto;
    produto = { nome: p.nome, descricao: p.descricao?.trim() || null, categoria: p.categoria?.trim() || null };
  }

  try {
    const modelo = await resolverModeloTexto(admin, orgId);
    const client = openrouterClient();
    const resp = await client.chat.completions.create(
      {
        model: modelo,
        messages: [{ role: 'user', content: montarPromptNcm(produto) }],
        response_format: { type: 'json_object' },
        temperature: 0,
      },
      { signal: AbortSignal.timeout(30_000) },
    );
    const raw = resp.choices[0]?.message?.content ?? '{}';
    return json(extrairSugestaoNcm(raw));
  } catch (e) {
    console.error('sugerir-ncm: OpenRouter falhou:', e);
    return json(SEM_SUGESTAO);
  }
});
