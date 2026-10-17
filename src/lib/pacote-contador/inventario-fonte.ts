// ADR-0181 Plano 2b-2 — fonte do inventário: chamadas à edge `inventario` (JWT do app). Reusa os erros de baixar.ts.
import { supabase } from '@/lib/supabase';
import { ErroOrgMudou, ErroPacote, ErroRede } from './baixar';
import type { ContagemItem, LeituraInventario } from './tipos-inventario';

const ehAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

async function chamar(corpo: Record<string, unknown>, orgEsperada: string | null, signal?: AbortSignal): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new ErroPacote('Sessão expirada — entre de novo.', 401);
  let r: Response;
  try {
    r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inventario`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(corpo),
    });
  } catch (e) {
    if (ehAbort(e)) throw e;
    throw new ErroRede();
  }
  let j: unknown = null;
  try { j = await r.json(); } catch (e) { if (ehAbort(e)) throw e; }
  if (!r.ok || !r.headers.get('X-Org-Id')) {
    throw new ErroPacote((j as { error?: string } | null)?.error ?? 'Não foi possível acessar o inventário.', r.status);
  }
  if (orgEsperada !== null && r.headers.get('X-Org-Id') !== orgEsperada) throw new ErroOrgMudou();
  return j;
}

export async function buscarInventarioHoje(orgEsperada: string, signal?: AbortSignal): Promise<LeituraInventario> {
  return await chamar({ acao: 'hoje' }, orgEsperada, signal) as LeituraInventario;
}

/** null = a org não tem foto nessa data (`{vazio:true}`); erro de leitura lança. */
export async function buscarFoto(dataBase: string, orgEsperada: string, signal?: AbortSignal): Promise<LeituraInventario | null> {
  const j = await chamar({ acao: 'foto', data_base: dataBase }, orgEsperada, signal);
  return (j as { vazio?: boolean } | null)?.vazio === true ? null : j as LeituraInventario;
}

export async function salvarContagem(id: string, versao: number, itens: ContagemItem[]): Promise<number> {
  const j = await chamar({ acao: 'salvar', inventario_id: id, versao, itens }, null) as { versao: number };
  return j.versao;
}

export async function confirmarInventario(id: string, versao: number): Promise<'ok' | 'pendente'> {
  const j = await chamar({ acao: 'confirmar', inventario_id: id, versao }, null) as { push: 'ok' | 'pendente' };
  return j.push;
}
