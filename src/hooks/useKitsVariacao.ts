import { useQuery } from '@tanstack/react-query';
import { fetchDetalheKitVariacao, fetchGaleriasPecasKit, fetchKitsVariacao, fetchPrecoAvulsoKit } from '@/lib/kit-variacao-edge';

export const QK_KITS_VARIACAO = ['kits-variacao'] as const;

/** Kits com variação da org (ADR-0200). Só com o módulo ligado: sem ele as tabelas podem nem existir. Repete a
 *  leitura enquanto algum kit está sendo montado ou encerrado, para a linha mudar de estado sozinha, e enquanto há
 *  transferência ativa. */
export function useKitsVariacao(enabled: boolean) {
  return useQuery({
    queryKey: QK_KITS_VARIACAO,
    queryFn: fetchKitsVariacao,
    enabled,
    staleTime: 30_000,
    // Transferência ativa (montar, desmontar, repor, encerrar): 5 s para a etapa andar na tela; travada não muda sozinha.
    refetchInterval: (q) => ((q.state.data ?? []).some((k) => k.transferencia?.estado === 'ativa') ? 5_000
      : (q.state.data ?? []).some((k) => k.status === 'publicando' || k.status === 'encerrando') ? 10_000 : false),
  });
}

/** Preço avulso das peças da base (ADR-0200, adendo 08/11). Uma leitura nova por abertura do diálogo (`abertura`
 *  muda a cada vez): nunca mostra o preço de uma abertura anterior. */
export function usePrecoAvulsoKit(familiaBaseId: string | null, abertura: string | null) {
  return useQuery({
    queryKey: [...QK_KITS_VARIACAO, 'preco-avulso', familiaBaseId, abertura],
    queryFn: () => fetchPrecoAvulsoKit(familiaBaseId as string),
    enabled: !!familiaBaseId && !!abertura,
    staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false,
  });
}

/** Proposta de galeria com as fotos das peças (ADR-0200, adendo 12/11), lida do ML ao entrar na etapa 2. Uma leitura por
 *  abertura e por conjunto de combinações; falha não bloqueia (a tela segue só com a foto do kit). */
export function useGaleriaPecasKit(
  familiaBaseId: string | null, abertura: string | null, combinacoes: Array<{ rotulo: string; cores: string[] }>,
) {
  const chaveCombinacoes = combinacoes.map((c) => c.rotulo).join('|');
  return useQuery({
    queryKey: [...QK_KITS_VARIACAO, 'galeria-pecas', familiaBaseId, abertura, chaveCombinacoes],
    queryFn: () => fetchGaleriasPecasKit(familiaBaseId as string, combinacoes),
    enabled: !!familiaBaseId && !!abertura && combinacoes.length > 0,
    staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false,
  });
}

/** Saldo por combinação × tamanho e transferências abertas. Repete enquanto houver transferência em andamento. */
export function useDetalheKitVariacao(kitId: string | null, codigoPaiBase: string) {
  return useQuery({
    queryKey: [...QK_KITS_VARIACAO, 'detalhe', kitId],
    queryFn: () => fetchDetalheKitVariacao(kitId as string, codigoPaiBase),
    enabled: !!kitId,
    refetchInterval: (q) => ((q.state.data?.abertas ?? []).some((t) => t.estado === 'ativa') ? 5_000
      : (q.state.data?.abertas.length ?? 0) > 0 ? 10_000 : false),
  });
}
