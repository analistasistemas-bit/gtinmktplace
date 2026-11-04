// ADR-0194 — dados da aba Sugestões: junta as leituras do banco e aplica a regra pura. Nenhuma chamada ao ML.
import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buscarTodasPaginas } from '@/lib/paginacao-supabase';
import { abaDa, ehCupom, ehTipoOperavel, fetchConvites } from '@/lib/promocoes';
import { montarSugestoes, type Dispensa, type SinalAnuncio } from '@/lib/sugestoes-promocao';
import { lerErroEdge } from '@/hooks/useOperacoes';
import { useParticipacoes, usePromocoes } from '@/hooks/usePromocoes';

const QK_DISPENSAS = ['promocoes', 'sugestoes-dispensas'] as const;
const QK_SINAIS = ['promocoes', 'sugestoes-sinais'] as const;

/** Paginado por GET: RPC por POST ignora o header Range (teto de 1.000 linhas do PostgREST). */
function fetchSinais(): Promise<SinalAnuncio[]> {
  return buscarTodasPaginas<SinalAnuncio>((de, ate) =>
    supabase.rpc('sugestoes_promocao_sinais', undefined, { get: true }).range(de, ate) as never);
}

async function fetchDispensas(): Promise<Dispensa[]> {
  const { data, error } = await supabase.from('promocao_sugestoes_dispensadas').select('chave, expira_em, dispensado_em, dispensado_por');
  if (error) throw error;
  return data ?? [];
}

export function useSugestoesPromocao() {
  const promocoes = usePromocoes();
  const participacoes = useParticipacoes();
  const ids = useMemo(() => {
    const agora = Date.now();
    return (promocoes.data ?? [])
      .filter((p) => !ehCupom(p.tipo) && ehTipoOperavel(p.tipo) && ['ativas', 'futuras'].includes(abaDa(p, agora) ?? ''))
      .map((p) => p.promocao_id).sort();
  }, [promocoes.data]);
  // "Atualizar agora" termina depois da invalidação: a marca do sync é o que avisa que há dados novos.
  const marcaSync = useMemo(() => (promocoes.data ?? []).reduce((m, p) => ((p.itens_sincronizados_em ?? '') > m ? p.itens_sincronizados_em! : m), ''), [promocoes.data]);
  const qc = useQueryClient();
  const marcaAnterior = useRef(marcaSync);
  useEffect(() => {
    if (marcaAnterior.current === marcaSync) return;
    marcaAnterior.current = marcaSync;
    void qc.invalidateQueries({ queryKey: ['promocoes', 'participacoes-todas'] });
    void qc.invalidateQueries({ queryKey: QK_SINAIS });
  }, [marcaSync, qc]);
  const convites = useQuery({ queryKey: ['promocoes', 'convites', ids, marcaSync], queryFn: () => fetchConvites(ids), enabled: !!promocoes.data, staleTime: 60_000, placeholderData: (anterior) => anterior });
  const sinais = useQuery({ queryKey: QK_SINAIS, queryFn: fetchSinais, staleTime: 60_000 });
  const dispensas = useQuery({ queryKey: QK_DISPENSAS, queryFn: fetchDispensas, staleTime: 60_000 });

  const fontes = [promocoes, participacoes, convites, sinais, dispensas];
  const data = useMemo(() => {
    if (!promocoes.data || !participacoes.data || !convites.data || !sinais.data || !dispensas.data) return undefined;
    return montarSugestoes({
      convites: convites.data, participacoes: participacoes.data, promocoes: promocoes.data,
      sinais: sinais.data, dispensas: dispensas.data, agoraMs: Date.now(),
    });
  }, [promocoes.data, participacoes.data, convites.data, sinais.data, dispensas.data]);

  return {
    data,
    isLoading: fontes.some((f) => f.isLoading),
    // Falha em qualquer fonte não pode virar lista vazia.
    isError: fontes.some((f) => f.isError),
    refetch: () => { for (const f of fontes) if (f.isError) void f.refetch(); },
  };
}

function useMudarDispensa(etapa: 'dispensar_sugestao' | 'reativar_sugestao') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chave: string) => {
      const { error } = await supabase.functions.invoke('operacoes-massa', { body: { etapa, chave } });
      if (error) throw await lerErroEdge(error, 'Não foi possível salvar agora.');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK_DISPENSAS }),
  });
}
export const useDispensarSugestao = () => useMudarDispensa('dispensar_sugestao');
export const useReativarSugestao = () => useMudarDispensa('reativar_sugestao');
