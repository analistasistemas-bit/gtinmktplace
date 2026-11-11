// ADR-0200: "Você recebe por venda" do kit com variação, antes de confirmar. Mesmo card de Promoções
// (`DetalheRecebe`), com a cotação oficial no preço, categoria, dimensões e peso do kit.
import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DetalheRecebe } from '@/components/promocoes/detalhe-recebe';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { useFamilia } from '@/hooks/useFamilia';
import { fmtBRL } from '@/lib/formato';
import {
  aliquotaDoKit, chaveDimensoes, simularKit, skuDoKit, type LinhaSimulada, type SimulacaoKit,
} from '@/lib/kit-variacao-simulacao';
import { calcularTarifaML, type Tarifa } from '@/lib/tarifa';
import { cn } from '@/lib/utils';

/** Mesma espera de digitação do preview de Promoções. */
const ESPERA_DIGITACAO_MS = 500;
const centavos = (n: number) => Math.round(n * 100);
const pctInt = (n: number) => `${Math.round(n * 100)}%`;

export function SimuladorKit({ familiaBaseId, cores, pecas, quantidades, preco, tipo = 'gold_special', onPodeSeguir }: {
  familiaBaseId: string;
  cores: string[];
  pecas: number;
  quantidades: { cores: string[]; tamanho: string; quantidade: number }[];
  preco: number;
  tipo?: 'gold_special' | 'gold_pro';
  /** Conta pronta e, se houver prejuízo, conta indisponível ou imposto fora, confirmada pelo operador. */
  onPodeSeguir?: (pode: boolean) => void;
}) {
  // Mesma fonte de custo da edge criar-kit-variacao: as variações da própria base (que precisa ser a
  // versão mais recente do PAI). Custo recente de outra família divergiria do que o kit grava.
  const familiaQ = useFamilia(familiaBaseId, true, false);
  const aliquotasQ = useAliquotas();
  const familia = familiaQ.data;
  const aliquotaPct = aliquotaDoKit(familia?.origem, aliquotasQ.data);

  // Comissão e frete mudam por faixa de preço: recota quando o operador para de digitar.
  const [precoCotado, setPrecoCotado] = useState(preco);
  useEffect(() => {
    const t = setTimeout(() => setPrecoCotado(preco), ESPERA_DIGITACAO_MS);
    return () => clearTimeout(t);
  }, [preco]);
  const precoEmDia = centavos(precoCotado) === centavos(preco);

  const variacoes = useMemo(() => familia?.variacoes ?? [], [familia]);
  const dims = useMemo(() => {
    const porChave = new Map<string, NonNullable<ReturnType<typeof skuDoKit>>['dim']>();
    for (const q of quantidades) {
      const sku = q.quantidade > 0 ? skuDoKit(variacoes, cores, q.cores, q.tamanho) : null;
      if (sku) porChave.set(chaveDimensoes(sku.dim), sku.dim);
    }
    return [...porChave.entries()];
  }, [variacoes, cores, quantidades]);

  const categoria = familia?.categoriaMlId ?? null;
  // Mesma queryKey de useTarifaML: deduplica com os outros cards da mesma tarifa.
  const tarifas = useQueries({
    queries: dims.map(([, dim]) => ({
      queryKey: ['tarifa', categoria, precoCotado, dim.alturaCm, dim.larguraCm, dim.comprimentoCm, dim.pesoGramas, aliquotaPct ?? 0],
      queryFn: () => calcularTarifaML(precoCotado, categoria as string, dim, aliquotaPct ?? 0),
      enabled: !!categoria && precoCotado > 0 && aliquotasQ.isFetched,
      staleTime: 6 * 60 * 60 * 1000,
      retry: false,
    })),
  });

  const sim: SimulacaoKit = useMemo(() => {
    const cotacoes = new Map<string, Tarifa | null | undefined>();
    dims.forEach(([chave], i) => {
      const q = tarifas[i];
      // Preço digitado e ainda não cotado: nunca mostra o lucro do preço anterior.
      cotacoes.set(chave, !precoEmDia ? undefined : q.isError ? null : q.isSuccess ? q.data : (categoria ? undefined : null));
    });
    return simularKit({ preco, pecas, cores, quantidades, variacoes, tipo, aliquotaPct, cotacoes });
  }, [dims, tarifas, precoEmDia, categoria, preco, pecas, cores, quantidades, variacoes, tipo, aliquotaPct]);

  const carregando = familiaQ.isLoading || aliquotasQ.isLoading;
  const erroLeitura = familiaQ.isError || aliquotasQ.isError;
  // Preço vazio, zero ou ilegível: nada a cotar (a query fica desligada); bloqueia em vez de "Calculando" eterno.
  const semPreco = !(preco > 0);
  const estado = erroLeitura ? 'indisponivel' : semPreco ? 'sem_preco' : carregando ? 'calculando' : sim.estado;
  const precisaConfirmar = erroLeitura || (!semPreco && sim.precisaConfirmar);

  // A confirmação vale só para a conta exibida: mudou preço, tipo, combinação ou lucro, vale de novo no
  // mesmo render (um effect de reset deixaria um onPodeSeguir(true) escapar com a conta nova).
  const chaveConta = [
    centavos(preco), tipo, estado, sim.semAliquota, erroLeitura,
    ...sim.linhas.map((l) => `${l.rotulo}#${l.tamanho}:${l.resumo ? centavos(l.resumo.lucro) : l.motivo}`),
  ].join('|');
  const [confirmadoEm, setConfirmadoEm] = useState<string | null>(null);
  // Preço editável na etapa 3: voltar ao preço já confirmado (70 → 75 → 70) refaria a mesma chave com a
  // tarifa em cache. Qualquer troca de conta descarta a confirmação, ajustada no render (sem frame liberado).
  const [chaveVista, setChaveVista] = useState(chaveConta);
  if (chaveVista !== chaveConta) { setChaveVista(chaveConta); setConfirmadoEm(null); }
  const confirmado = confirmadoEm === chaveConta;
  const bloqueado = estado === 'sem_custo' || estado === 'peca_inexistente' || estado === 'sem_preco';
  const pode = estado !== 'calculando' && !bloqueado && (!precisaConfirmar || confirmado);
  useEffect(() => { onPodeSeguir?.(pode); }, [pode, onPodeSeguir]);

  const [expandido, setExpandido] = useState(false);
  const varias = sim.linhas.length > 1;

  // Variação do lucro da pior combinação em relação ao último preço já calculado (mesma combinação).
  const contaAgora = (estado === 'ok' || estado === 'prejuizo') && sim.pior?.resumo
    ? { preco, combinacao: `${sim.pior.rotulo}#${sim.pior.tamanho}`, lucro: sim.pior.resumo.lucro } : null;
  const [contas, setContas] = useState<{ atual: typeof contaAgora; anterior: typeof contaAgora }>({ atual: null, anterior: null });
  if (contaAgora && (contas.atual?.preco !== contaAgora.preco || contas.atual.combinacao !== contaAgora.combinacao || contas.atual.lucro !== contaAgora.lucro)) {
    setContas({ atual: contaAgora, anterior: contas.atual && centavos(contas.atual.preco) !== centavos(contaAgora.preco) ? contas.atual : null });
  }
  const anterior = contaAgora && contas.anterior?.combinacao === contaAgora.combinacao ? contas.anterior : null;

  return (
    <section aria-label="Simulador de lucro do kit" className="flex flex-col gap-2">
      {estado === 'calculando' && <p className="text-xs text-muted-foreground">Calculando o que você recebe…</p>}

      {estado === 'sem_preco' && <p className="text-xs text-danger">Informe um preço maior que zero.</p>}

      {estado === 'sem_custo' && (
        <p className="text-xs text-danger">
          Há peça sem custo na base: cadastre o custo antes de criar o kit. O lucro não é calculado.
        </p>
      )}

      {estado === 'peca_inexistente' && (
        <p className="text-xs text-danger">
          A base não tem uma das peças de alguma combinação (inexistente ou excluída da publicação). Ajuste as combinações.
        </p>
      )}

      {estado === 'indisponivel' && (
        <p className="text-xs text-danger">
          {erroLeitura ? 'Não foi possível ler custos e alíquotas agora.' : 'Não foi possível calcular o lucro de todas as combinações.'}
          {' '}O resultado não é exibido como exato.
        </p>
      )}

      {estado !== 'calculando' && sim.semAliquota && !erroLeitura && (
        <p className="flex items-start gap-1 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>Imposto fora da conta: a alíquota por origem não está confirmada em Configurações. O lucro abaixo não desconta imposto.</span>
        </p>
      )}

      {sim.pior?.resumo && (estado === 'ok' || estado === 'prejuizo') && (
        <div className="flex flex-col gap-1">
          {varias && (
            <p className="text-xs font-medium text-muted-foreground">
              Pior combinação: <span className="text-foreground">{sim.pior.rotulo} · {sim.pior.tamanho}</span>
            </p>
          )}
          {anterior && contaAgora && (
            <p className="text-xs tabular-nums text-muted-foreground">
              {contaAgora.lucro < 0 ? 'prejuízo' : 'lucro'} {fmtBRL(contaAgora.lucro)} ({contaAgora.lucro >= anterior.lucro ? '+' : '−'}{fmtBRL(Math.abs(contaAgora.lucro - anterior.lucro))} em relação a {fmtBRL(anterior.preco)})
            </p>
          )}
          <DetalheRecebe r={sim.pior.resumo} preco={preco} original={null} listingType={tipo} variasCores={false} rotuloPreco="preço do kit" />
        </div>
      )}

      {/* Leitura falhou: o react-query conserva dados antigos; nenhum número nem a pior combinação. */}
      {varias && estado !== 'calculando' && !semPreco && !erroLeitura && (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setExpandido((e) => !e)} aria-expanded={expandido}>
            <ChevronDown className={cn('size-3.5 transition-transform', expandido && 'rotate-180')} aria-hidden />
            {expandido ? 'Ocultar combinações' : `Ver lucro de cada combinação (${sim.linhas.length})`}
          </Button>
          {expandido && (
            <ul className="mt-1 divide-y divide-border rounded-md border text-xs">
              {sim.linhas.map((l) => <LinhaCombinacao key={`${l.rotulo}#${l.tamanho}`} l={l} pior={l === sim.pior} />)}
            </ul>
          )}
        </div>
      )}

      {precisaConfirmar && estado !== 'calculando' && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
          <p className="font-medium text-danger">
            {estado === 'prejuizo' ? 'Este preço dá prejuízo em pelo menos uma combinação.'
              : estado === 'indisponivel' ? 'Lucro não calculado.'
              : 'Lucro calculado sem imposto.'}
          </p>
          {/* Sem `onPodeSeguir` (etapa 2, só leitura) não há o que liberar: a confirmação fica na etapa 3. */}
          {onPodeSeguir && (
            <label htmlFor="kit-seguir-mesmo-assim" className="mt-2 flex items-center gap-2">
              <Checkbox id="kit-seguir-mesmo-assim" checked={confirmado} onCheckedChange={(v) => setConfirmadoEm(v ? chaveConta : null)} />
              Seguir mesmo assim
            </label>
          )}
        </div>
      )}
    </section>
  );
}

function LinhaCombinacao({ l, pior }: { l: LinhaSimulada; pior: boolean }) {
  return (
    <li className={cn('flex items-center justify-between gap-2 px-2 py-1.5 tabular-nums', pior && 'bg-muted/50')}>
      <span className="min-w-0 truncate">{l.rotulo} · {l.tamanho}{pior && <span className="ml-1 text-muted-foreground">(pior)</span>}</span>
      {l.resumo ? (
        <span className={l.resumo.lucro < 0 ? 'text-destructive' : 'text-success'}>
          {l.resumo.lucro < 0 ? 'prejuízo ' : 'lucro '}{fmtBRL(l.resumo.lucro)}
          {l.resumo.margem != null && ` · margem ${pctInt(l.resumo.margem)}`}
        </span>
      ) : (
        <span className="text-muted-foreground">{l.motivo ?? 'Calculando…'}</span>
      )}
    </li>
  );
}
