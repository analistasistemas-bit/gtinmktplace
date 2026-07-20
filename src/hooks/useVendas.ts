import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buscarVendas, marcaDagua, mesclarVendas, type Venda, type OrigemVenda } from '@/lib/faturamento';
import type { Janela } from '@/lib/metricas';
import type { CanalAtivo } from '@/lib/canal-ativo';

/** Chave de cache da janela: `desde` inteiro, `ate` só na data.
 *
 *  `resolverJanela` chama `new Date()`, então o `ate` de 'hoje'/'mes_atual'/'preset' é sempre
 *  "agora". Com o ISO cheio na chave, duas montagens do mesmo período viravam caches distintos —
 *  e como as abas do Faturamento desmontam ao trocar (Radix `TabsContent`), cada ida e volta
 *  refazia o fetch completo da janela e descartava o cache de que o delta do ADR-0082 depende.
 *
 *  Truncar o `ate` na data é seguro: não existe venda com `date_closed` no futuro, então duas
 *  janelas que terminam no mesmo dia cobrem o mesmo conjunto pelo lado de cima.
 *
 *  O `desde` NÃO pode ser truncado, e isso custa caro: um preset resolvido às 15:00 começa às
 *  15:00 de N dias atrás, enquanto um range que escolha aquele mesmo dia começa às 00:00. Pela
 *  data os dois colidiriam, o segundo herdaria o cache do primeiro e o refetch — em modo delta —
 *  nunca traria as vendas da madrugada que faltam: KPI menor que o real, sem aviso. Preferimos
 *  perder o compartilhamento de cache entre presets a arriscar número financeiro errado.
 *  Consequência aceita: telas com período 'preset' ('preset' tem `desde` móvel) continuam
 *  refazendo o fetch completo a cada remontagem; 'hoje', 'mes_atual' e 'range' têm `desde` fixo
 *  e passam a reaproveitar o cache. */
export function chaveJanela(janela: Janela): [string, string] {
  return [janela.desde, janela.ate.slice(0, 10)];
}

export function useVendas(janela: Janela, origem: OrigemVenda, canal: CanalAtivo = 'todos') {
  const qc = useQueryClient();
  const [desdeDia, ateDia] = chaveJanela(janela);
  const queryKey = ['vendas', desdeDia, ateDia, origem, canal] as const;
  return useQuery<Venda[]>({
    queryKey,
    // Tempo real "leve": re-busca enquanto a aba está aberta e ao voltar o foco, para a venda
    // incorporada pelo webhook (ADR-0037) aparecer sozinha, sem clicar Sincronizar.
    // refetchIntervalInBackground fica off (default) → não consome quando a aba não está visível.
    // 3min (era 45s): o payload é a janela inteira de vendas com itens (~centenas de KB) e o
    // poll respondia por ~30% do egress da conta (ADR-0081). refetchOnWindowFocus cobre o
    // caso "voltei para a aba e quero ver agora".
    //
    // Poll incremental (ADR-0082): a partir do 2º tick, busca só o delta desde a marca d'água
    // (maior atualizado_em do cache atual) e mescla no que já tinha, em vez de rebaixar a janela
    // inteira a cada 3min. A marca vem sempre dos DADOS, nunca do relógio do cliente (clock skew
    // perderia updates em silêncio). Um tick sem mudança responde `[]` (~2 bytes) em vez de
    // ~120 KB. `prev.length > 0` garante que cache vazio (janela sem vendas) sempre faz fetch
    // completo, nunca fica preso em delta permanente.
    queryFn: async () => {
      const prev = qc.getQueryData<Venda[]>(queryKey);
      const marca = prev && prev.length > 0 ? marcaDagua(prev) : null;
      if (!marca) return buscarVendas(janela, origem, canal);
      const delta = await buscarVendas(janela, origem, canal, marca);
      return mesclarVendas(prev!, delta);
    },
    staleTime: 5 * 60_000,
    refetchInterval: 180_000,
    refetchOnWindowFocus: true,
  });
}

// ponytail: venda que SAI do filtro corrente (ex.: is_publiai flipando com filtro `origem`
// ativo) fica stale até o próximo fetch completo (troca de janela/canal/origem, ou cache vazio).
// O delta só enxerga updates de linhas que ainda casam o filtro atual — aceito, é o mesmo tipo de
// staleness que qualquer poll incremental tem, e o caso é raro (webhook não deveria re-matchear
// is_publiai depois de fechado).
