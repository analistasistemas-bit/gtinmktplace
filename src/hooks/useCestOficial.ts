import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// ADR-0197: sugestão de CEST pela tabela do Convênio ICMS 142/2018 quando o XML não trouxe o campo.
export type CestCandidato = { cest: string; ncm_prefixo: string; descricao: string; exato: boolean };
export type CestStatus = 'inativo' | 'carregando' | 'erro' | 'sem' | 'unico_exato' | 'varios';
export type CestOficial = { status: CestStatus; candidatos: CestCandidato[] };

/** Só `unico_exato` autopreenche: um CEST em TODAS as correspondências, e por NCM completo. Prefixo
 *  não prova enquadramento (D-3). */
export function classificarCest(candidatos: CestCandidato[]): 'sem' | 'unico_exato' | 'varios' {
  if (candidatos.length === 0) return 'sem';
  return new Set(candidatos.map((c) => c.cest)).size === 1 && candidatos.some((c) => c.exato) ? 'unico_exato' : 'varios';
}

export function useCestOficial(ncm: string, ativo: boolean): CestOficial {
  const habilitado = ativo && /^\d{8}$/.test(ncm);
  const q = useQuery({
    queryKey: ['cest-oficial', ncm],
    enabled: habilitado,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cest_candidatos', { p_ncm: ncm });
      if (error) throw error;
      return (data ?? []) as CestCandidato[];
    },
  });
  if (!habilitado) return { status: 'inativo', candidatos: [] };
  if (q.isError) return { status: 'erro', candidatos: [] };
  if (q.isPending || q.isFetching) return { status: 'carregando', candidatos: [] };
  const vistos = new Set<string>();
  const candidatos = q.data.filter((c) => !vistos.has(c.cest) && vistos.add(c.cest));
  return { status: classificarCest(q.data), candidatos };
}

/** Emenda D-7 do ADR-0197: CEST precisa existir em `cest_oficial` (o ML recusa com 10088). Espelho da
 *  edge (`_shared/fiscal/cest-oficial.ts`), que segue sendo a autoridade. */
export type CestExisteStatus = 'vazio' | 'carregando' | 'ok' | 'inexistente' | 'erro';

export function useCestExiste(cest: string): CestExisteStatus {
  const habilitado = /^\d{7}$/.test(cest);
  const q = useQuery({
    queryKey: ['cest-existe', cest],
    enabled: habilitado,
    queryFn: async () => {
      const { data, error } = await supabase.from('cest_oficial').select('cest').eq('cest', cest).limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  });
  if (!habilitado) return 'vazio';
  if (q.isError) return 'erro';
  if (q.isPending) return 'carregando';
  return q.data ? 'ok' : 'inexistente';
}

/** Aplica o candidato único uma vez por NCM e por abertura. `mudar` deve ser o `mudarFiscal` do dialog,
 *  que derruba o "Conferi". Apagar o valor não o devolve; digitação nunca é sobrescrita; trocar o NCM
 *  limpa o valor que a tabela preencheu (D-5). */
export function useSugestaoCest({ ativo, ncm, cest, mudar }: {
  ativo: boolean; ncm: string; cest: string; mudar: (patch: { cest: string }) => void;
}): CestOficial {
  const oficial = useCestOficial(ncm, ativo);
  const avaliado = useRef<string | null>(null);
  const automatico = useRef<{ ncm: string; cest: string } | null>(null);
  const candidato = oficial.candidatos[0]?.cest;

  useEffect(() => {
    if (!ativo) {
      avaliado.current = null;
      automatico.current = null;
      return;
    }
    const anterior = automatico.current;
    if (anterior && anterior.ncm !== ncm) {
      automatico.current = null;
      if (cest === anterior.cest) {
        mudar({ cest: '' });
        return;
      }
    }
    if (oficial.status === 'inativo') avaliado.current = null;
    if (oficial.status === 'inativo' || oficial.status === 'carregando' || oficial.status === 'erro') return;
    if (avaliado.current === ncm) return;
    avaliado.current = ncm;
    if (oficial.status === 'unico_exato' && !cest && candidato) {
      automatico.current = { ncm, cest: candidato };
      mudar({ cest: candidato });
    }
    // `mudar` muda a cada render do dialog; o efeito sempre roda com o da render em que as deps mudaram.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, ncm, cest, oficial.status, candidato]);

  return oficial;
}
