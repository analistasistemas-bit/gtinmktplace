import { useState, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { useMlConnection } from '@/hooks/useMlConnection';
import {
  useDescontoPct, useSalvarDescontoPct,
  useDescontoConcorrenciaPct, useSalvarDescontoConcorrenciaPct,
  useAliquotas, useSalvarAliquotas,
  useReancoraLiderAtiva, useSalvarReancoraLiderAtiva,
} from '@/hooks/useConfiguracoes';
import { ConfigTelegram } from '@/components/config-telegram';
import { iniciarConexaoML, desconectarML } from '@/lib/ml-oauth';

export default function Configuracoes() {
  const { data: conexao, isLoading: carregandoConexao } = useMlConnection();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const { data: descontoPct } = useDescontoPct();
  const salvar = useSalvarDescontoPct();
  const [pctInput, setPctInput] = useState('15');

  useEffect(() => {
    if (descontoPct != null) setPctInput(String(descontoPct));
  }, [descontoPct]);

  const { data: descontoConcorrenciaPct } = useDescontoConcorrenciaPct();
  const salvarDescontoConcorrencia = useSalvarDescontoConcorrenciaPct();
  const [descontoConcInput, setDescontoConcInput] = useState('5');

  useEffect(() => {
    if (descontoConcorrenciaPct != null) setDescontoConcInput(String(descontoConcorrenciaPct));
  }, [descontoConcorrenciaPct]);

  const { data: reancoraLiderAtiva } = useReancoraLiderAtiva();
  const salvarReancoraLiderAtiva = useSalvarReancoraLiderAtiva();

  const { data: aliquotas } = useAliquotas();
  const salvarAliquotas = useSalvarAliquotas();
  const [nacionalInput, setNacionalInput] = useState('8');
  const [importadoInput, setImportadoInput] = useState('16');

  useEffect(() => {
    if (aliquotas != null) {
      setNacionalInput(String(aliquotas.nacional));
      setImportadoInput(String(aliquotas.importado));
    }
  }, [aliquotas]);

  const mlConectado = searchParams.get('ml_conectado') === 'true';
  const mlErro = searchParams.get('ml_erro');

  async function handleConectar() {
    setErroAcao(null);
    try {
      await iniciarConexaoML();
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Falha ao conectar');
    }
  }

  async function handleDesconectar() {
    setErroAcao(null);
    try {
      await desconectarML();
      await queryClient.invalidateQueries({ queryKey: ['ml-connection'] });
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Falha ao desconectar');
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Configurações" />

      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Mercado Livre</h2>

          {!carregandoConexao && mlConectado && conexao?.conectado && (
            <p className="mb-2 rounded border border-success/30 bg-success/10 px-2 py-1 text-xs text-success">
              Conta conectada com sucesso.
            </p>
          )}
          {mlErro && (
            <p className="mb-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive">
              {mlErro === 'state'
                ? 'Sessão de conexão expirou. Tente conectar de novo.'
                : 'Não foi possível conectar ao Mercado Livre. Tente de novo.'}
            </p>
          )}
          {erroAcao && (
            <p className="mb-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive">{erroAcao}</p>
          )}

          {carregandoConexao ? (
            <span className="text-sm text-muted-foreground">Carregando…</span>
          ) : conexao?.conectado ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusPill tone="success">Conectado</StatusPill>
                  <span className="text-sm">como {conexao.nickname ?? conexao.mlUserId}</span>
                  <span className="text-xs text-muted-foreground">· Permissões salvas</span>
                </div>
                <Button variant="outline" size="sm" onClick={handleDesconectar}>
                  Desconectar
                </Button>
              </div>
              <details className="group/details rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
                <summary className="-mx-1 flex cursor-pointer list-none items-center gap-1 px-1 text-muted-foreground transition-colors hover:text-foreground">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-open/details:rotate-90" />
                  Detalhes técnicos
                </summary>
                <div className="mt-2 space-y-2">
                  <p className="text-muted-foreground">
                    Escopo OAuth salvo:{' '}
                    <code className="block truncate rounded bg-background/60 px-1.5 py-0.5 font-mono text-[11px]" title={conexao.scope ?? 'não informado'}>
                      {conexao.scope ?? 'não informado'}
                    </code>
                  </p>
                  <p className="text-muted-foreground">
                    Para exibir vendas no dashboard, o app do Mercado Livre também precisa ter a
                    permissão de Pedidos habilitada no Dev Center. Se você acabou de ajustar isso,
                    desconecte e conecte a conta novamente.
                  </p>
                </div>
              </details>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Nenhuma conta conectada.</span>
              <Button size="sm" onClick={handleConectar}>
                Conectar Mercado Livre
              </Button>
            </div>
          )}
        </Card>

        <ConfigTelegram />

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Desconto sobre concorrência</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Quando há concorrente, o preço sugerido fica esse percentual abaixo do menor preço encontrado (ADR-0059). Padrão 5%.
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={99}
              step={1}
              className="h-8 w-20 text-sm"
              value={descontoConcInput}
              onChange={(e) => setDescontoConcInput(e.target.value)}
              onBlur={() => {
                const n = Number(descontoConcInput);
                if (n >= 0 && n < 100) salvarDescontoConcorrencia.mutate(n);
              }}
            />
            <span className="text-sm">%</span>
            {salvarDescontoConcorrencia.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
            {salvarDescontoConcorrencia.isSuccess && !salvarDescontoConcorrencia.isPending && (
              <span className="text-xs text-success">✓ Salvo</span>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Ancorar preço no piso dos MercadoLíderes quando der prejuízo</h2>
            <Switch
              checked={reancoraLiderAtiva ?? false}
              onCheckedChange={(v) => salvarReancoraLiderAtiva.mutate(v)}
              aria-label="Ancorar preço no piso dos MercadoLíderes quando der prejuízo"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Quando um produto dá prejuízo no import, usa o menor preço entre os concorrentes
            MercadoLíder em vez do menor preço global (ADR-0065).
          </p>
          {salvarReancoraLiderAtiva.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
          {salvarReancoraLiderAtiva.isSuccess && !salvarReancoraLiderAtiva.isPending && (
            <span className="text-xs text-success">✓ Salvo</span>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Estratégia de preço</h2>
          <RadioGroup defaultValue="condicional" className="flex flex-col gap-2">
            <label htmlFor="r1" className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="proprio" id="r1" />
              <div>
                <div className="font-medium">Próprio sempre</div>
                <div className="text-xs text-muted-foreground">Manter o preço da planilha em todos os casos</div>
              </div>
            </label>
            <label htmlFor="r2" className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="competitivo" id="r2" />
              <div>
                <div className="font-medium">Competitivo sempre</div>
                <div className="text-xs text-muted-foreground">Alinhar com mediana do mercado em todos os casos</div>
              </div>
            </label>
            <label htmlFor="r3" className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="condicional" id="r3" />
              <div>
                <div className="font-medium">Condicional (recomendado)</div>
                <div className="text-xs text-muted-foreground">
                  PRÓPRIO quando sem concorrência; COMPETITIVO quando há concorrência (ADR-0008)
                </div>
              </div>
            </label>
          </RadioGroup>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Desconto de marketing</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Preço cheio riscado (selo "% OFF"). Sugestão 15%. O liga/desliga é por produto, na Revisão.
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={99}
              step={1}
              className="h-8 w-20 text-sm"
              value={pctInput}
              onChange={(e) => setPctInput(e.target.value)}
              onBlur={() => {
                const n = Number(pctInput);
                if (n >= 0 && n < 100) salvar.mutate(n);
              }}
            />
            <span className="text-sm">%</span>
            {salvar.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
            {salvar.isSuccess && !salvar.isPending && (
              <span className="text-xs text-success">✓ Salvo</span>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Imposto por origem</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Alíquota aplicada conforme a origem do produto (nacional ou importado).
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm">Nacional</span>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                className="h-8 w-20 text-sm"
                value={nacionalInput}
                onChange={(e) => setNacionalInput(e.target.value)}
                onBlur={() => {
                  const n = Number(nacionalInput);
                  if (n >= 0 && n <= 100) salvarAliquotas.mutate({ nacional: n, importado: Number(importadoInput) });
                }}
              />
              <span className="text-sm">%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Importado</span>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                className="h-8 w-20 text-sm"
                value={importadoInput}
                onChange={(e) => setImportadoInput(e.target.value)}
                onBlur={() => {
                  const n = Number(importadoInput);
                  if (n >= 0 && n <= 100) salvarAliquotas.mutate({ nacional: Number(nacionalInput), importado: n });
                }}
              />
              <span className="text-sm">%</span>
            </div>
            {salvarAliquotas.isPending && <span className="text-xs text-muted-foreground">Salvando…</span>}
            {salvarAliquotas.isSuccess && !salvarAliquotas.isPending && (
              <span className="text-xs text-success">✓ Salvo</span>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
