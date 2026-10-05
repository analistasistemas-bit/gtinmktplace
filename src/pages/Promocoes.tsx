import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BadgePercent } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CanalTabs } from '@/components/canal-tabs';
import { useCanalAtivo } from '@/hooks/useCanalAtivo';
import { useAtualizarPromocoes, useEstadoSyncPromocoes, usePromocoes } from '@/hooks/usePromocoes';
import { abaDa, avisoAtualizacao, emLeitura, sincronizandoAgora, type AbaPromo } from '@/lib/promocoes';
import { CardCampanha } from '@/components/promocoes/card-campanha';
import { PainelEstadoSync } from '@/components/promocoes/painel-estado-sync';
import { ListaOperacoes } from '@/components/operacoes/lista-operacoes';
import { ListaParticipando } from '@/components/promocoes/lista-participando';

type AbaTela = AbaPromo | 'participando' | 'operacoes';
const ABAS: readonly AbaTela[] = ['ativas', 'futuras', 'encerradas', 'participando', 'operacoes'];

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
  // Fix round 1 (achado 3 da revisão): a aba ativa vive na URL (?aba=operacoes), não num useState
  // que só lê o param na 1ª montagem — senão clicar numa aba não grava, e recarregar a página
  // depois de clicar volta pra Ativas.
  const [searchParams, setSearchParams] = useSearchParams();
  const abaParam = searchParams.get('aba');
  const aba: AbaTela = ABAS.includes(abaParam as AbaTela) ? (abaParam as AbaTela) : 'ativas';
  const setAba = (v: string) => setSearchParams((prev) => {
    const p = new URLSearchParams(prev);
    if (v === 'ativas') p.delete('aba'); else p.set('aba', v);
    return p;
  }, { replace: true });
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
    onSuccess: (r) => {
      const { tipo, texto } = avisoAtualizacao(r as { estado?: string } | null);
      if (tipo === 'sucesso') toast.success(texto); else if (tipo === 'erro') toast.error(texto); else toast.info(texto);
    },
    onError: (e) => toast.error(e.message),
  });
  const emCurso = sincronizandoAgora(estado.data ?? null, Date.now());
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
        <PainelEstadoSync estado={estado.data ?? null} temDados={temDados} onAtualizar={onAtualizar} atualizando={sincronizando} agoraMs={agora} />
      )}

      {promocoes.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[228px] rounded-xl" />)}
        </div>
      ) : temDados && (
        <Tabs value={aba} onValueChange={setAba}>
          <TabsList>
            <TabsTrigger value="ativas">Ativas{' '}<span className="tabular-nums text-muted-foreground">{porAba.ativas.length}</span></TabsTrigger>
            <TabsTrigger value="futuras">Futuras{' '}<span className="tabular-nums text-muted-foreground">{porAba.futuras.length}</span></TabsTrigger>
            <TabsTrigger value="encerradas">Encerradas</TabsTrigger>
            <TabsTrigger value="participando">Em promoção</TabsTrigger>
            <TabsTrigger value="operacoes">Operações</TabsTrigger>
          </TabsList>
          {aba === 'operacoes' ? (
            <ListaOperacoes filtro="promocao" />
          ) : aba === 'participando' ? (
            <ListaParticipando />
          ) : porAba[aba].length === 0 ? (
            <EmptyState icon={BadgePercent} title={VAZIO[aba]} className="mt-4" />
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
