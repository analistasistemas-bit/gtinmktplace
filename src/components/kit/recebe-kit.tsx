// Kit vinculado: "Você recebe por venda" do preço digitado, com a tarifa oficial da categoria, das
// dimensões editadas e do peso (base × N). Espelha o SimuladorKit do kit com variação.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { DetalheRecebe } from '@/components/promocoes/detalhe-recebe';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import type { KitPreviewValue } from '@/components/kit/preview-kit';
import type { BaseParaKit } from '@/lib/kit';
import { aliquotaDoKit } from '@/lib/kit-variacao-simulacao';
import { simularRecebe } from '@/lib/kit-recebe';
import { calcularTarifaML } from '@/lib/tarifa';

/** Mesma espera de digitação do preview de Promoções. */
const ESPERA_DIGITACAO_MS = 500;
const TIPO = 'gold_special' as const;
const centavos = (n: number) => Math.round(n * 100);
const medidaOk = (x: number) => x > 0;

export function RecebeKit({ n, base, value, categoriaMlId, onPodeSeguir }: {
  n: number;
  base: BaseParaKit;
  value: KitPreviewValue;
  categoriaMlId: string | null;
  /** Conta pronta e, se houver prejuízo, conta indisponível ou imposto fora, confirmada pelo operador. */
  onPodeSeguir: (n: number, pode: boolean) => void;
}) {
  const aliquotasQ = useAliquotas();
  const aliquotaPct = aliquotaDoKit(base.origem, aliquotasQ.data);

  // Comissão e frete mudam por faixa de preço e dimensão: recota quando o operador para de digitar.
  const { preco, alturaCm, larguraCm, comprimentoCm } = value;
  const [cotado, setCotado] = useState({ preco, alturaCm, larguraCm, comprimentoCm });
  useEffect(() => {
    const t = setTimeout(() => setCotado({ preco, alturaCm, larguraCm, comprimentoCm }), ESPERA_DIGITACAO_MS);
    return () => clearTimeout(t);
  }, [preco, alturaCm, larguraCm, comprimentoCm]);
  const emDia = centavos(cotado.preco) === centavos(preco) && cotado.alturaCm === alturaCm
    && cotado.larguraCm === larguraCm && cotado.comprimentoCm === comprimentoCm;

  const semBase = base.custo == null || base.pesoGramas == null;
  const custo = semBase ? null : base.custo! * n;
  const peso = base.pesoGramas != null ? base.pesoGramas * n : null;
  const dimsOk = [alturaCm, larguraCm, comprimentoCm].every(medidaOk);
  const dimsCotadasOk = [cotado.alturaCm, cotado.larguraCm, cotado.comprimentoCm].every(medidaOk);
  const categoria = categoriaMlId;

  // Mesma queryKey de useTarifaML: deduplica com os outros cards da mesma tarifa.
  const q = useQuery({
    queryKey: ['tarifa', categoria, cotado.preco, cotado.alturaCm, cotado.larguraCm, cotado.comprimentoCm, peso, aliquotaPct ?? 0],
    queryFn: () => calcularTarifaML(
      cotado.preco, categoria as string,
      { alturaCm: cotado.alturaCm, larguraCm: cotado.larguraCm, comprimentoCm: cotado.comprimentoCm, pesoGramas: peso },
      aliquotaPct ?? 0,
    ),
    enabled: !!categoria && cotado.preco > 0 && dimsCotadasOk && !semBase && aliquotasQ.isFetched,
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });

  // Medida vazia/0 ou categoria ausente: não há o que cotar (indisponível, nunca "Calculando" eterno).
  const naoCotavel = !categoria || !dimsOk;
  const tarifa = naoCotavel ? null : q.isError ? null : q.isSuccess ? q.data : undefined;
  const sim = simularRecebe({
    preco, precoEmDia: naoCotavel || emDia, custo, tipo: TIPO, aliquotaPct, tarifa,
  });

  const erroLeitura = aliquotasQ.isError;
  const estado = erroLeitura && sim.estado !== 'sem_preco' && sim.estado !== 'sem_custo' ? 'indisponivel'
    : aliquotasQ.isLoading && sim.estado !== 'sem_preco' && sim.estado !== 'sem_custo' ? 'calculando' : sim.estado;
  const precisaConfirmar = (erroLeitura && estado === 'indisponivel') || sim.precisaConfirmar;
  const semAliquota = sim.semAliquota && (estado === 'ok' || estado === 'prejuizo' || estado === 'indisponivel') && !erroLeitura;

  // A confirmação vale só para a conta exibida: mudou preço, medidas, estado ou lucro, vale de novo no
  // mesmo render (um effect de reset deixaria um onPodeSeguir(true) escapar com a conta nova).
  const chaveConta = [
    centavos(preco), alturaCm, larguraCm, comprimentoCm, estado, sim.semAliquota, erroLeitura,
    sim.resumo ? centavos(sim.resumo.lucro) : '-',
  ].join('|');
  const [confirmadoEm, setConfirmadoEm] = useState<string | null>(null);
  const [chaveVista, setChaveVista] = useState(chaveConta);
  if (chaveVista !== chaveConta) { setChaveVista(chaveConta); setConfirmadoEm(null); }
  const confirmado = confirmadoEm === chaveConta;
  const bloqueado = estado === 'sem_custo' || estado === 'sem_preco';
  const pode = estado !== 'calculando' && !bloqueado && (!precisaConfirmar || confirmado);
  useEffect(() => { onPodeSeguir(n, pode); }, [n, pode, onPodeSeguir]);

  const idSeguir = `kit-${n}-seguir`;
  return (
    <section aria-label={`Você recebe do kit de ${n} unidades`} className="flex flex-col gap-2">
      {estado === 'calculando' && <p className="text-xs text-muted-foreground">Calculando o que você recebe…</p>}
      {estado === 'sem_preco' && <p className="text-xs text-danger">Informe um preço maior que zero.</p>}
      {estado === 'sem_custo' && (
        <p className="text-xs text-danger">
          Falta custo ou peso no produto-base: cadastre custo/peso na base antes de criar o kit. O lucro não é calculado.
        </p>
      )}
      {estado === 'indisponivel' && (
        <p className="text-xs text-danger">
          {erroLeitura ? 'Não foi possível ler as alíquotas agora.' : 'Não foi possível calcular o que você recebe.'}
          {' '}O resultado não é exibido como exato.
        </p>
      )}
      {semAliquota && (
        <p className="flex items-start gap-1 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>Imposto fora da conta: a alíquota por origem não está confirmada em Configurações. O lucro abaixo não desconta imposto.</span>
        </p>
      )}
      {sim.resumo && (estado === 'ok' || estado === 'prejuizo') && (
        <DetalheRecebe r={sim.resumo} preco={preco} original={null} listingType={TIPO} variasCores={false} rotuloPreco="preço do kit" />
      )}
      {precisaConfirmar && estado !== 'calculando' && !bloqueado && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
          <p className="font-medium text-danger">
            {estado === 'prejuizo' ? 'Este preço dá prejuízo.'
              : estado === 'indisponivel' ? 'Lucro não calculado.'
              : 'Lucro calculado sem imposto.'}
          </p>
          <label htmlFor={idSeguir} className="mt-2 flex items-center gap-2">
            <Checkbox
              id={idSeguir} aria-label={`Seguir mesmo assim, kit de ${n} unidades`}
              checked={confirmado} onCheckedChange={(v) => setConfirmadoEm(v ? chaveConta : null)}
            />
            Seguir mesmo assim
          </label>
        </div>
      )}
    </section>
  );
}
