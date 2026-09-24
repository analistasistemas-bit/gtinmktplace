import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CanalTabs } from '@/components/canal-tabs';
import { useCanalAtivo } from '@/hooks/useCanalAtivo';
import { useAtualizarPromocoes, useEstadoSyncPromocoes, usePromocoes } from '@/hooks/usePromocoes';
import { abaDa, emLeitura, type AbaPromo } from '@/lib/promocoes';
import { CardCampanha } from '@/components/promocoes/card-campanha';
import { PainelEstadoSync } from '@/components/promocoes/painel-estado-sync';

const VAZIO: Record<AbaPromo, string> = {
  ativas: 'Nenhuma campanha ativa.', futuras: 'Nenhuma campanha futura.', encerradas: 'Nenhuma campanha encerrada nos últimos 30 dias.',
};

function atualizadoHa(iso: string | null | undefined): string {
  if (!iso) return 'Nunca atualizado';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'Atualizado agora';
  if (min < 60) return `Atualizado há ${min} min`;
  return `Atualizado há ${Math.round(min / 60)} h`;
}

export default function Promocoes() {
  const { canal, setCanal, habilitados } = useCanalAtivo();
  const promocoes = usePromocoes();
  const estado = useEstadoSyncPromocoes();
  const atualizar = useAtualizarPromocoes();
  const [aba, setAba] = useState<AbaPromo>('ativas');
  const agora = Date.now();

  const porAba = useMemo(() => {
    const m: Record<AbaPromo, NonNullable<typeof promocoes.data>> = { ativas: [], futuras: [], encerradas: [] };
    for (const p of promocoes.data ?? []) {
      const a = abaDa(p, agora);
      if (a) m[a].push(p);
    }
    return m;
  }, [promocoes.data, agora]);

  const onAtualizar = () => atualizar.mutate(undefined, {
    onSuccess: () => toast.success('Campanhas atualizadas. Buscando os anúncios de cada uma…'),
    onError: (e) => toast.error(e.message),
  });
  // Execução que caiu no meio deixa 'sincronizando' para trás: só vale se começou há < 5 min.
  const emCurso = estado.data?.estado === 'sincronizando'
    && Date.now() - Date.parse(estado.data.iniciado_em ?? '') < 5 * 60_000;
  const lendo = (promocoes.data ?? []).some((p) => emLeitura(p, Date.now()));
  // "Atualizado há" = última leitura de anúncios concluída (a lista sozinha não atualiza números).
  const ultimaLeitura = (promocoes.data ?? []).map((p) => p.itens_sincronizados_em)
    .filter((x): x is string => x != null).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null;
  const sincronizando = atualizar.isPending || emCurso || lendo;
  const temDados = (promocoes.data?.length ?? 0) > 0;

  const carregando = promocoes.isLoading || estado.isLoading;

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title="Promoções"
        subtitle="Campanhas do Mercado Livre com o líquido de cada anúncio no preço da promoção."
        actions={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{atualizadoHa(ultimaLeitura)}</span>
            <Button onClick={onAtualizar} disabled={sincronizando}>{sincronizando ? 'Atualizando…' : 'Atualizar agora'}</Button>
          </div>
        }
      />
      <CanalTabs canal={canal} onCanal={setCanal} habilitados={habilitados} />
      {!carregando && (
        <PainelEstadoSync estado={estado.data ?? null} temDados={temDados} onAtualizar={onAtualizar} atualizando={sincronizando} />
      )}

      {promocoes.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : temDados && (
        <Tabs value={aba} onValueChange={(v) => setAba(v as AbaPromo)}>
          <TabsList>
            <TabsTrigger value="ativas">Ativas ({porAba.ativas.length})</TabsTrigger>
            <TabsTrigger value="futuras">Futuras ({porAba.futuras.length})</TabsTrigger>
            <TabsTrigger value="encerradas">Encerradas</TabsTrigger>
          </TabsList>
          {porAba[aba].length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">{VAZIO[aba]}</p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {porAba[aba].map((p) => <CardCampanha key={p.promocao_id} promocao={p} agoraMs={agora} />)}
            </div>
          )}
        </Tabs>
      )}
    </div>
  );
}
