// ADR-0201 (Galeria da cor por IA), Task 16: retenção do Storage da galeria. Só QStash (agendamento 1×/dia,
// verify_jwt = false + assinatura). Lista `<org>/galeria-ia/` com mais de 1 dia em lotes de 100 pelo cursor de
// `galeria_cursores` (RPC `galeria_retencao_listar`) e apaga, pela API do Storage, SÓ arquivos que nenhuma linha cita:
// - cena órfã de posse perdida: `<org>/galeria-ia/<fam>/<cor>/<missao>-<geracao>-<imagem>-<posse>.<ext>` ≠ `cena_path`;
// - final não citado: `<org>/galeria-ia/<fam>/finais/<imagem>-<nonce>.jpg` ≠ `final_path` e ≠ `final_upload_path`.
// Nunca apaga: `referencias/`, arquivo citado, nada de imagem com `aprovado_em` ou `status = 'aprovada'` (o manifesto
// de aplicação só leva aprovadas e `aprovado_em` nunca é zerado). Recorte não tem arquivo próprio. Na dúvida (formato
// fora do padrão, linha ausente, org/família divergente, consulta com erro) não apaga: falha fechada.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';

const CHAVE = 'galeria-retencao';
const LOTE = 100;
const MAX_LOTES = 20; // ponytail: teto de 2.000 objetos por execução diária; o cursor continua no dia seguinte.
const UM_DIA_MS = 86_400_000;
const U = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RE_UUID = new RegExp(`^${U}$`);
const RE_FINAL = new RegExp(`^(${U})-${U}\\.jpg$`);
const RE_CENA = new RegExp(`^\\d+-\\d+-(${U})-${U}\\.[a-z0-9]+$`);

type Objeto = { id: string; name: string; created_at: string };
type Linha = { id: string; org_id: string; familia_id: string; status: string; aprovado_em: string | null;
  cena_path: string | null; final_path: string | null; final_upload_path: string | null };
// deno-lint-ignore no-explicit-any
type Admin = any;

/** Cena ou final da galeria com o id da imagem; null = fora do formato conhecido (mantém). */
export function classificar(name: string): { tipo: 'cena' | 'final'; org: string; familia: string; imagemId: string } | null {
  const s = name.split('/');
  if (s.length !== 5 || !RE_UUID.test(s[0]) || s[1] !== 'galeria-ia' || s[3] === 'referencias') return null;
  const tipo = s[3] === 'finais' ? 'final' : 'cena';
  const m = (tipo === 'final' ? RE_FINAL : RE_CENA).exec(s[4]);
  return m ? { tipo, org: s[0], familia: s[2], imagemId: m[1] } : null;
}

/** Caminhos apagáveis do lote. Erro de consulta lança (nada é apagado). */
async function apagaveis(admin: Admin, objetos: Objeto[], agora: number): Promise<string[]> {
  const cands = objetos.map((o) => ({ o, c: classificar(o.name) }));
  const ids = [...new Set(cands.flatMap(({ c }) => (c ? [c.imagemId] : [])))];
  if (ids.length === 0) return [];
  // ponytail: citação conferida pela própria linha — os caminhos embutem o id da imagem e só ela os grava
  // (worker-estado.ts para a cena, galeria-aprovar para o final).
  const { data, error } = await admin.from('galeria_imagens')
    .select('id, org_id, familia_id, status, aprovado_em, cena_path, final_path, final_upload_path').in('id', ids);
  if (error) throw new Error(`galeria_imagens: ${error.message}`);
  const linhas = new Map((data as Linha[]).map((l) => [l.id, l]));
  return cands.filter(({ o, c }) => {
    if (!c || !(Date.parse(o.created_at) < agora - UM_DIA_MS)) return false;
    const l = linhas.get(c.imagemId);
    if (!l || l.org_id !== c.org || l.familia_id !== c.familia) return false;
    if (l.aprovado_em != null || l.status === 'aprovada') return false;
    return ![l.cena_path, l.final_path, l.final_upload_path].includes(o.name);
  }).map(({ o }) => o.name);
}

export async function reter(admin: Admin, agora: number) {
  const { data: cur, error: eC } = await admin.from('galeria_cursores').select('cursor_em, cursor_id').eq('chave', CHAVE).maybeSingle();
  if (eC) throw new Error(`cursor: ${eC.message}`);
  let cursor = { em: (cur?.cursor_em as string | null) ?? null, id: (cur?.cursor_id as string | null) ?? null };
  let lotes = 0, apagados = 0, listados = 0;
  while (lotes < MAX_LOTES) {
    const { data, error } = await admin.rpc('galeria_retencao_listar', { p_cursor_em: cursor.em, p_cursor_id: cursor.id, p_limite: LOTE });
    if (error) throw new Error(`listar: ${error.message}`);
    const objetos = (data ?? []) as Objeto[];
    lotes++;
    listados += objetos.length;
    const alvo = await apagaveis(admin, objetos, agora);
    if (alvo.length > 0) {
      const { error: eR } = await admin.storage.from('imagens').remove(alvo);
      if (eR) throw new Error(`remove: ${eR.message}`); // cursor não avança: o lote é refeito na próxima execução
      apagados += alvo.length;
    }
    const fim = objetos.length < LOTE;
    const ult = objetos[objetos.length - 1];
    cursor = fim ? { em: null, id: null } : { em: ult.created_at, id: ult.id };
    const { error: eU } = await admin.from('galeria_cursores')
      .upsert({ chave: CHAVE, cursor_em: cursor.em, cursor_id: cursor.id, atualizado_em: new Date(agora).toISOString() }, { onConflict: 'chave' });
    if (eU) throw new Error(`cursor: ${eU.message}`);
    if (fim) break;
  }
  return { lotes, listados, apagados, mantidos: listados - apagados };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  try {
    const r = await reter(adminClient(), Date.now());
    console.log('[galeria-retencao]', JSON.stringify(r));
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[galeria-retencao]', (e as Error).message);
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
