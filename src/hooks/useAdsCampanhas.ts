import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buscarCampanhasAds } from '@/lib/ads-campanhas-dados';
import { montarCampanhas, type CampanhaVista, type RespostaCampanhas } from '@/lib/ads-campanhas';
import { buscarCodigosMlbs } from '@/lib/sku-dossie-dados';
import { useCatalogoVendasSku } from '@/hooks/useCatalogoVendasSku';
import { useOrgEfetivaId } from '@/hooks/useOrgEfetivaId';

const STALE = 5 * 60_000;

/** Aba Campanhas do /ads (emenda ADR-0179): leitura do ML + família do PubliAI. `atualizar()` fura o cache da edge. */
export function useAdsCampanhas(habilitado: boolean) {
  const qc = useQueryClient();
  // A org entra na chave: resposta de uma org nunca serve a outra (troca de org/suporte com Atualizar pendente).
  const orgId = useOrgEfetivaId();
  const orgAtual = useRef(orgId);
  useEffect(() => { orgAtual.current = orgId; }, [orgId]);
  const chave = useMemo(() => ['ads-campanhas', orgId] as const, [orgId]);
  const [atualizando, setAtualizando] = useState(false);
  const [erroAtualizar, setErroAtualizar] = useState<Error | null>(null);
  const respQ = useQuery({ queryKey: chave, queryFn: () => buscarCampanhasAds(false), staleTime: STALE, enabled: habilitado && orgId != null });
  const resposta: RespostaCampanhas | null = respQ.data ?? null;
  const ok = resposta?.estado === 'ok' ? resposta : null;

  const mlbs = useMemo(() => [...new Set((ok?.anuncios ?? []).map((a) => a.mlb))].sort(), [ok]);
  const codQ = useQuery({ queryKey: ['ads-campanhas-codigos', orgId, mlbs], queryFn: () => buscarCodigosMlbs(mlbs),
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

  /** Fura o cache da edge. Nunca rejeita: a falha vira `erroAtualizar` e os dados anteriores ficam. */
  const atualizar = async () => {
    const daOrg = orgId, chaveDaOrg = chave;
    setAtualizando(true);
    setErroAtualizar(null);
    try {
      const r = await buscarCampanhasAds(true);
      if (orgAtual.current === daOrg) qc.setQueryData(chaveDaOrg, r);
    } catch (e) {
      if (orgAtual.current === daOrg) setErroAtualizar(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setAtualizando(false);
    }
  };
  /** Erro de qualquer leitura: refaz as três (edge, códigos e catálogo). */
  const tentarDeNovo = () => {
    void respQ.refetch();
    if (codQ.isError) void codQ.refetch();
    if (catQ.isError) void catQ.refetch();
  };

  return {
    resposta, campanhas, isLoading: habilitado && !isError && campanhas === null, isError, erro,
    atualizando, atualizar, erroAtualizar, tentarDeNovo,
  };
}
