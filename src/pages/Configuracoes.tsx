import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useMlConnection } from '@/hooks/useMlConnection';
import { useDescontoPct, useSalvarDescontoPct } from '@/hooks/useConfiguracoes';
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
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Configurações</h1>

      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Mercado Livre</h2>

          {!carregandoConexao && mlConectado && conexao?.conectado && (
            <p className="mb-2 rounded bg-green-50 px-2 py-1 text-xs text-green-700">
              Conta conectada com sucesso.
            </p>
          )}
          {mlErro && (
            <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
              {mlErro === 'state'
                ? 'Sessão de conexão expirou. Tente conectar de novo.'
                : 'Não foi possível conectar ao Mercado Livre. Tente de novo.'}
            </p>
          )}
          {erroAcao && (
            <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{erroAcao}</p>
          )}

          {carregandoConexao ? (
            <span className="text-sm text-muted-foreground">Carregando…</span>
          ) : conexao?.conectado ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Conectado</Badge>
                <span className="text-sm">como {conexao.nickname ?? conexao.mlUserId}</span>
              </div>
              <Button variant="outline" size="sm" onClick={handleDesconectar}>
                Desconectar
              </Button>
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

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Estratégia de preço</h2>
          <RadioGroup defaultValue="condicional" className="flex flex-col gap-2">
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="proprio" id="r1" />
              <div>
                <div className="font-medium">Próprio sempre</div>
                <div className="text-xs text-muted-foreground">Manter o preço da planilha em todos os casos</div>
              </div>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="competitivo" id="r2" />
              <div>
                <div className="font-medium">Competitivo sempre</div>
                <div className="text-xs text-muted-foreground">Alinhar com mediana do mercado em todos os casos</div>
              </div>
            </label>
            <label className="flex items-start gap-2 text-sm">
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
            <input
              type="number"
              min={0}
              max={99}
              step={1}
              className="w-20 rounded border px-2 py-1 text-sm"
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
              <span className="text-xs text-green-700">✓ Salvo</span>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Categorias padrão</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span>Linhas (Fios e Cadarços de Armarinho)</span>
              <code className="text-xs">MLB270273</code>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span>Botões</span>
              <code className="text-xs">MLB270272</code>
            </div>
            <div className="flex justify-between">
              <span>Fitas de Cetim</span>
              <code className="text-xs">MLB255054</code>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Categorias-folha reais do ML (lookup determinístico por tipo, ADR-0009)
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
