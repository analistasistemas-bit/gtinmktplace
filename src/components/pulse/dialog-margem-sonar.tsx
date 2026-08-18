// Sonar (ADR-0120): simulador de margem por ficha, antes de o produto existir no catálogo.
// Custo hipotético + origem são obrigatórios e SEM default (regra LOUD: imposto nunca presume).
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { calcularTarifaML } from '@/lib/tarifa';
import { margemSimulada } from '@/lib/sonar';
import { fmtBRL, parseNumeroPtBr } from '@/lib/formato';

type Origem = 'NACIONAL' | 'IMPORTADO';

interface FichaSimulavel {
  product_id: string;
  nome: string;
  category_id: string | null;
  preco: { min: number; mediana: number; max: number } | null;
}

function LinhaRegime({ label, comissao, frete, freteMedido, margem }: {
  label: string;
  comissao: number;
  frete: number;
  /** false = produto hipotético, sem dimensões — frete 0 é "não estimado", não "grátis". */
  freteMedido: boolean;
  margem: ReturnType<typeof margemSimulada>;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          comissão {fmtBRL(comissao)} + frete {freteMedido ? fmtBRL(frete) : 'não estimado'}
        </span>
      </div>
      <div className="text-sm">
        Você recebe <span className="font-medium tabular-nums">{fmtBRL(margem.recebe)}</span>
      </div>
      <div className="text-sm">
        Margem sobre o custo (markup) <span className="font-medium tabular-nums">{fmtBRL(margem.liquido)}</span>{' '}
        <span className={margem.margemPct >= 0 ? 'text-success' : 'text-destructive'}>
          ({margem.margemPct.toFixed(1)}%)
        </span>
      </div>
      {!freteMedido && (
        <p className="mt-1 text-xs text-muted-foreground">
          Produto ainda sem dimensões cadastradas — margem otimista (sem custo de frete).
        </p>
      )}
    </div>
  );
}

export function DialogMargemSonar({ ficha, onFechar }: { ficha: FichaSimulavel | null; onFechar: () => void }) {
  const aberto = ficha != null;
  const [custoStr, setCustoStr] = useState('');
  const [origem, setOrigem] = useState<Origem | null>(null);
  const [precoStr, setPrecoStr] = useState('');

  const { data: aliquotas, isLoading: aliquotasCarregando, isError: aliquotasErro } = useAliquotas();

  const custo = parseNumeroPtBr(custoStr);
  const precoAlvo = parseNumeroPtBr(precoStr);
  // Sem confirmação, fetchAliquotas devolve 8/16 de FALLBACK — usar isso calado simularia imposto
  // presumido (regra LOUD). Mesma trava de fetchContextoMargem em pulse.ts.
  const aliquotaPct = !aliquotas?.confirmada ? null
    : origem === 'NACIONAL' ? aliquotas.nacional
    : origem === 'IMPORTADO' ? aliquotas.importado : null;

  // A comissão do ML muda por faixa de preço (Errata 6/ADR-0119): guarda o preço/categoria em que
  // ela foi lida junto do resultado, para nunca aplicar a comissão de UM preço à margem de outro.
  const simular = useMutation({
    mutationFn: async () => ({
      tarifa: await calcularTarifaML(precoAlvo!, ficha!.category_id!, null),
      preco: precoAlvo!,
      categoria: ficha!.category_id!,
    }),
    onError: () => toast.error('Falha ao calcular a tarifa do Mercado Livre.'),
  });

  // Reabrir com outra ficha reseta a simulação — mediana pré-preenchida, resto exige o operador.
  useEffect(() => {
    // Mesmo padrão de numParaInput (viabilidade-linha.tsx): vírgula decimal, lido por
    // parseNumeroPtBr. String(10.995) direto vira "10.995", e o regex de milhar do parser lê
    // isso como 10995 — a vírgula tira a ambiguidade. toFixed(2) evita cauda de float da mediana
    // ((10.1+10.2)/2 = 10.149999999999999) vazando pro input.
    setPrecoStr(ficha?.preco?.mediana != null ? ficha.preco.mediana.toFixed(2).replace('.', ',') : '');
    setCustoStr('');
    setOrigem(null);
    simular.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reseta ao trocar de ficha
  }, [ficha?.product_id, ficha?.preco?.mediana]);

  const podeSimular = !!ficha?.category_id && custo != null && custo > 0
    && precoAlvo != null && precoAlvo > 0 && aliquotaPct != null;

  const hint = !ficha?.category_id ? null
    : aliquotasErro ? 'Não foi possível carregar as alíquotas da organização.'
    : aliquotasCarregando ? 'Carregando alíquotas…'
    : !aliquotas?.confirmada ? 'Confirme as alíquotas da organização em Configurações antes de simular.'
    : custo == null || custo <= 0 ? 'Informe o custo hipotético do produto.'
    : origem == null ? 'Selecione a origem do produto.'
    : precoAlvo == null || precoAlvo <= 0 ? 'Informe um preço alvo válido.' : null;

  // Simulação só vale para o preço/categoria em que foi calculada — editar o preço depois de
  // simular não pode reaproveitar a comissão antiga (mesmo defeito da Errata 6). Independente de
  // ter dado certo ou falhado (resultado null): "desatualizada" é sobre o INPUT ter mudado, não
  // sobre o resultado da chamada.
  const simulacaoAtual = simular.data != null && simular.data.preco === precoAlvo
    && simular.data.categoria === ficha?.category_id;
  const simulacaoDesatualizada = simular.isSuccess && !simulacaoAtual;
  const resultado = simulacaoAtual ? simular.data!.tarifa : null;
  const simulacaoFalhou = simulacaoAtual && resultado === null;

  const t = resultado;
  const margemClassico = t && custo != null && precoAlvo != null && aliquotaPct != null
    ? margemSimulada({ precoAlvo, custo, aliquotaPct, tarifa: { comissao: t.classico.comissao, frete: t.frete } })
    : null;
  const margemPremium = t && custo != null && precoAlvo != null && aliquotaPct != null
    ? margemSimulada({ precoAlvo, custo, aliquotaPct, tarifa: { comissao: t.premium.comissao, frete: t.frete } })
    : null;

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Simular margem</DialogTitle>
          <DialogDescription>{ficha?.nome}</DialogDescription>
        </DialogHeader>

        {!ficha?.category_id ? (
          <Badge variant="destructive">Categoria indisponível para esta ficha — não é possível simular.</Badge>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 text-sm">
                <span>Custo hipotético (R$)</span>
                <Input
                  inputMode="decimal"
                  aria-label="Custo hipotético"
                  value={custoStr}
                  onChange={(e) => setCustoStr(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="flex flex-col gap-1 text-sm">
                <span>Origem</span>
                <Select value={origem ?? undefined} onValueChange={(v) => setOrigem(v as Origem)}>
                  <SelectTrigger aria-label="Origem do produto">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NACIONAL">Nacional ({aliquotas?.confirmada ? `${aliquotas.nacional}%` : '—'})</SelectItem>
                    <SelectItem value="IMPORTADO">Importado ({aliquotas?.confirmada ? `${aliquotas.importado}%` : '—'})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1 text-sm">
              <span>Preço alvo (R$)</span>
              <Input
                inputMode="decimal"
                aria-label="Preço alvo"
                className="w-40"
                value={precoStr}
                onChange={(e) => setPrecoStr(e.target.value)}
              />
            </div>

            {simular.isPending ? (
              <span className="text-sm text-muted-foreground">Calculando tarifa…</span>
            ) : margemClassico && margemPremium ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <LinhaRegime label="Clássico" comissao={t!.classico.comissao} frete={t!.frete} freteMedido={t!.frete > 0} margem={margemClassico} />
                <LinhaRegime label="Premium" comissao={t!.premium.comissao} frete={t!.frete} freteMedido={t!.frete > 0} margem={margemPremium} />
              </div>
            ) : simulacaoDesatualizada ? (
              // Preço/categoria mudaram depois do cálculo — a comissão antiga não vale mais aqui.
              <span className="text-xs text-muted-foreground">Preço alterado — simule de novo.</span>
            ) : simular.isError || simulacaoFalhou ? (
              <Badge variant="destructive">Não foi possível calcular a tarifa para este preço/categoria.</Badge>
            ) : hint ? (
              <span className="text-xs text-muted-foreground">{hint}</span>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
          {ficha?.category_id && (
            <Button onClick={() => simular.mutate()} disabled={!podeSimular || simular.isPending}>
              Simular
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
