import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import { LISTA_CANAIS, canaisOperaveis, type CanalInfo } from '@/lib/canais';
import { LogoCanal } from '@/components/canal-badge';
import { useCanaisHabilitados } from '@/hooks/useCanaisHabilitados';
import { useMlConnection } from '@/hooks/useMlConnection';
import { QK, fetchConexoes } from '@/lib/queries';
import { iniciarConexaoML, desconectarML } from '@/lib/ml-oauth';

/** Vitrine + gestão de canais (D4): card por marketplace do registry. */
export default function Canais() {
  const { data: habilitados = ['mercado_livre'], isError: erroHabilitados } = useCanaisHabilitados();
  const {
    data: conexoes = [],
    isLoading: carregandoConexoes,
    isError: erroConexoes,
  } = useQuery({ queryKey: QK.conexoes, queryFn: fetchConexoes });
  const { data: conexaoML, isLoading: carregandoML } = useMlConnection();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  // Retorno do OAuth do ML (o callback redireciona com estes params — ver Configurações).
  const mlConectado = searchParams.get('ml_conectado') === 'true';
  const mlErro = searchParams.get('ml_erro');

  const operaveis = new Set(canaisOperaveis(habilitados).map((c) => c.id));
  const conectados = new Set(conexoes.map((c) => c.canal));

  async function handleConectar(canal: CanalInfo) {
    setErroAcao(null);
    try {
      if (canal.id === 'mercado_livre') await iniciarConexaoML();
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Falha ao conectar');
    }
  }

  async function handleDesconectarML() {
    setErroAcao(null);
    try {
      await desconectarML();
      await qc.invalidateQueries({ queryKey: ['ml-connection'] });
      await qc.invalidateQueries({ queryKey: QK.conexoes });
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Falha ao desconectar');
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Canais"
        subtitle="Marketplaces integrados ao PubliAI — conecte sua conta e publique da mesma planilha."
      />

      {!carregandoML && mlConectado && conexaoML?.conectado && (
        <p className="mb-4 rounded border border-success/30 bg-success/10 px-3 py-2 text-sm text-success motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">
          Conta do Mercado Livre conectada com sucesso.
        </p>
      )}
      {mlErro && (
        <p className="mb-4 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">
          {mlErro === 'state'
            ? 'Sessão de conexão expirou. Tente conectar de novo.'
            : 'Não foi possível conectar ao Mercado Livre. Tente de novo.'}
        </p>
      )}
      {erroAcao && (
        <p className="mb-4 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">{erroAcao}</p>
      )}
      {(erroHabilitados || erroConexoes) && (
        <p className="mb-4 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">
          Não foi possível carregar o status dos canais — os cards podem estar desatualizados. Recarregue a página.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LISTA_CANAIS.map((c) => {
          const operavel = operaveis.has(c.id);
          const conectado = c.id === 'mercado_livre' ? !!conexaoML?.conectado : conectados.has(c.id);
          return (
            <Card
              key={c.id}
              className={cn('flex flex-col gap-3 p-4', !operavel && 'opacity-70')}
              style={{ borderTop: `3px solid ${c.corMarca}` }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LogoCanal canal={c.id} className={cn('h-8 w-8 text-xs', !operavel && 'grayscale')} />
                  <span className="text-sm font-semibold">{c.nome}</span>
                </div>
                {!operavel ? (
                  <StatusPill tone="neutral">Em breve</StatusPill>
                ) : c.id !== 'mercado_livre' && carregandoConexoes ? (
                  <StatusPill tone="neutral">Carregando…</StatusPill>
                ) : conectado ? (
                  <StatusPill tone="success">Conectado</StatusPill>
                ) : (
                  <StatusPill tone="warning">Não conectado</StatusPill>
                )}
              </div>

              {!operavel ? (
                <p className="text-xs text-muted-foreground">
                  Integração em desenvolvimento — em breve no PubliAI.
                </p>
              ) : c.id === 'mercado_livre' ? (
                carregandoML ? (
                  <span className="text-sm text-muted-foreground">Carregando…</span>
                ) : conexaoML?.conectado ? (
                  <div className="flex flex-col gap-2 text-sm">
                    <span>como <strong>{conexaoML.nickname ?? conexaoML.mlUserId}</strong></span>
                    <span className="truncate text-xs text-muted-foreground" title={conexaoML.scope ?? 'não informado'}>
                      Escopo OAuth: {conexaoML.scope ?? 'não informado'}
                    </span>
                    <Button variant="outline" size="sm" className="self-start" onClick={handleDesconectarML}>
                      Desconectar
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Nenhuma conta conectada.</span>
                    <Button size="sm" onClick={() => handleConectar(c)}>Conectar</Button>
                  </div>
                )
              ) : (
                <p className="text-xs text-muted-foreground">Canal habilitado — conector chega no lançamento.</p>
              )}
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        As demais configurações do app continuam em <Link to="/configuracoes" className="underline">Configurações</Link>.
      </p>
    </div>
  );
}
