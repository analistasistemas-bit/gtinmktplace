// ADR-0207 — Reposição: GET serve a tela (sugestão + pedidos), POST grava as ações (acoes.ts).
// JWT do app; gate pelo módulo `reposicao`. Leitura: membro (ou suporte); escrita: membro, e
// `aprovar`, `salvar_config`, `definir_multiplo` e editar pedido já aprovado só admin (ou suporte com escopo full). Escrita com service role: as tabelas não têm
// policy de escrita para `authenticated`.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { diaBrt } from '../_shared/notificacoes/gerencial/janelas.ts';
import { calcularReposicao } from '../_shared/reposicao/calculo.ts';
import { lerDados } from '../_shared/reposicao/dados.ts';
import type { RespostaReposicao } from '../_shared/reposicao/tipos.ts';
import { processarAcao } from './acoes.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const SEM_MODULO = 'Módulo de reposição não habilitado para esta organização.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  let ctx: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ctx = await requireUserOrg(req, { access: req.method === 'GET' ? 'read' : 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  const hoje = diaBrt(new Date());

  try {
    if (req.method === 'GET') {
      if (!(await exigirModulo(admin, ctx.orgId, 'reposicao'))) return json({ error: SEM_MODULO }, 403);
      const d = await lerDados(admin, ctx.orgId, hoje);
      if ('semConfig' in d) {
        const vazio: RespostaReposicao = { config: null, resultado: null, skus: [], familias: [], naoRepor: [], rascunhos: [], pedidos: [] };
        return json(vazio);
      }
      // Quem salvou/aprovou/alterou aparece pelo nome.
      const ids = [...new Set(d.pedidos.flatMap((p) => [p.salvoPor, p.aprovadoPor, p.alteradoPor]).filter((x): x is string => !!x))];
      const nomes = new Map<string, string>();
      if (ids.length) {
        const { data, error } = await admin.from('profiles').select('id, nome, email').in('id', ids);
        if (error) throw new Error(`reposicao: profiles: ${error.message}`);
        for (const p of (data ?? []) as { id: string; nome: string | null; email: string | null }[]) nomes.set(p.id, p.nome || p.email || '');
      }
      const nome = (id: string | null) => (id ? nomes.get(id) ?? null : null);
      const pedidos = d.pedidos.map((p) => ({ ...p, salvoPor: nome(p.salvoPor), aprovadoPor: nome(p.aprovadoPor), alteradoPor: nome(p.alteradoPor) }));
      const resposta: RespostaReposicao = {
        config: d.config,
        resultado: calcularReposicao(d.entrada),
        skus: d.skus,
        familias: d.familias,
        naoRepor: d.naoRepor,
        rascunhos: pedidos.filter((p) => p.status === 'rascunho'),
        pedidos: pedidos.filter((p) => p.status !== 'rascunho'),
      };
      return json(resposta);
    }

    const corpo: unknown = await req.json().catch(() => null);
    const r = await processarAcao(
      { db: admin, moduloHabilitado: () => exigirModulo(admin, ctx.orgId, 'reposicao') },
      { ...ctx, hoje, agora: new Date().toISOString() },
      corpo,
    );
    const acao = (corpo as { action?: unknown } | null)?.action;
    await auditarOperacaoSuporte(admin, ctx, { type: 'reposicao', id: String(acao ?? '') }, r.status < 400 ? 'succeeded' : 'failed');
    return json(r.body, r.status);
  } catch (e) {
    console.error('reposicao_falhou', String(e));
    return json({ error: 'Falha interna na reposição.' }, 500);
  }
});
