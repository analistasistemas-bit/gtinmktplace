import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buscarCampanhasAds } from '@/lib/ads-campanhas-dados';
import { montarCampanhas, type CampanhaVista, type RespostaCampanhas } from '@/lib/ads-campanhas';
import { buscarCodigosMlbs } from '@/lib/sku-dossie-dados';
import { useCatalogoVendasSku } from '@/hooks/useCatalogoVendasSku';

const CHAVE = ['ads-campanhas'] as const;
const STALE = 5 * 60_000;

/** Aba Campanhas do /ads (emenda ADR-0179): leitura do ML + família do PubliAI. `atualizar()` fura o cache da edge. */
export function useAdsCampanhas(habilitado: boolean) {
  const qc = useQueryClient();
  const [atualizando, setAtualizando] = useState(false);
  const respQ = useQuery({ queryKey: CHAVE, queryFn: () => buscarCampanhasAds(false), staleTime: STALE, enabled: habilitado });
  const resposta: RespostaCampanhas | null = respQ.data ?? null;
  const ok = resposta?.estado === 'ok' ? resposta : null;

  const mlbs = useMemo(() => [...new Set((ok?.anuncios ?? []).map((a) => a.mlb))].sort(), [ok]);
  const codQ = useQuery({ queryKey: ['ads-campanhas-codigos', mlbs], queryFn: () => buscarCodigosMlbs(mlbs),
    enabled: habilitado && ok !== null, staleTime: STALE });
  const catQ = useCatalogoVendasSku();

  const campanhas = useMemo<CampanhaVista[] | null>(() => {
    if (!resposta) return null;
    if (!ok) return [];
    if (!codQ.data || !catQ.data) return null;
    return montarCampanhas({
      resposta: ok, codigosPorMlb: codQ.data,
      familiaDoCodigo: new Map(catQ.data.filter((c) => c.codigoPai).map((c) => [c.codigo, c.codigoPai!])),
      nomeDaFamilia: new Map(catQ.data.filter((c) => c.codigoPai && c.nomeFamilia).map((c) => [c.codigoPai!, c.nomeFamilia!])),
    });
  }, [resposta, ok, codQ.data, catQ.data]);

  const erro = (respQ.error ?? codQ.error ?? catQ.error ?? null) as Error | null;
  const isError = respQ.isError || codQ.isError || catQ.isError;

  const atualizar = async () => {
    setAtualizando(true);
    try { qc.setQueryData(CHAVE, await buscarCampanhasAds(true)); } finally { setAtualizando(false); }
  };

  return { resposta, campanhas, isLoading: habilitado && !isError && campanhas === null, isError, erro, atualizando, atualizar };
}
