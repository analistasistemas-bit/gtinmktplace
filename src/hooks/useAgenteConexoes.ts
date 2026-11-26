// ADR-0210 (fatia 1): conexões de agente. O front nunca lê as tabelas (sem policy): tudo pela edge `agente-conexoes`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { lerErroEdge } from '@/hooks/useOperacoes';

/** Mesmos valores de `Permissao` em `_shared/agentes/credencial.ts` (o front não importa de supabase/functions). */
export type PermissaoAgente = 'margens' | 'catalogo';
export interface ConexaoAgente {
  id: string; nome: string; prefixo: string; criada_em: string; expira_em: string | null;
  revogada_em: string | null; ultimo_uso_em: string | null; permissoes: PermissaoAgente[];
}
export interface ConexaoCriada { id: string; chave: string; prefixo: string; expira_em: string | null }
export interface ChamadaAgente { criado_em: string; ferramenta: string; alvo: string | null; resultado: string }
/** `null` = até revogar (ADR-0210, Emenda 1). */
export type Validade = 30 | 90 | 365 | null;

const QK = ['agentes', 'conexoes'] as const;

async function chamar<T>(body: Record<string, unknown>, falha: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('agente-conexoes', { body });
  if (error) throw await lerErroEdge(error, falha);
  return data as T;
}

const URL_SUPABASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agentes`;
// ponytail: o domínio com a marca (Worker da Cloudflare, Emenda 1) só repassa para o projeto de produção; outro
// projeto (dev local) usa o endereço direto do Supabase.
export const MCP_URL = URL_SUPABASE.includes('txvncrgkoynoxwopfkbp') ? 'https://mcp.publiai.daludi.com.br' : URL_SUPABASE;

export function useAgenteConexoes() {
  return useQuery({
    queryKey: QK,
    queryFn: () => chamar<ConexaoAgente[]>({ acao: 'listar' }, 'Não foi possível carregar as conexões.'),
  });
}

/** Sem useMutation de propósito: a chave não pode ficar no cache do React Query. Quem chama guarda o resultado
 *  em estado local e descarta ao fechar o diálogo. */
export function criarConexaoAgente(nome: string, dias: Validade, permissoes: PermissaoAgente[]): Promise<ConexaoCriada> {
  return chamar<ConexaoCriada>({ acao: 'criar', nome, dias, permissoes }, 'Não foi possível criar a conexão.');
}

export function alterarPermissoesAgente(id: string, permissoes: PermissaoAgente[]): Promise<{ ok: true }> {
  return chamar<{ ok: true }>({ acao: 'permissoes', id, permissoes }, 'Não foi possível alterar as permissões.');
}

export function useInvalidarConexoes() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: QK });
}

export function useRevogarConexao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => chamar<{ ok: true }>({ acao: 'revogar', id }, 'Não foi possível revogar a conexão.'),
    onSettled: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useChamadasConexao(id: string | null) {
  return useQuery({
    queryKey: ['agentes', 'chamadas', id],
    queryFn: () => chamar<ChamadaAgente[]>({ acao: 'chamadas', id }, 'Não foi possível carregar as chamadas.'),
    enabled: !!id,
  });
}
