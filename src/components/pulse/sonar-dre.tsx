// Seção 6 do relatório da Análise PubliAI — a DRE (ADR-0148, fatia 1).
//
// Nenhum número nasce aqui: a decomposição vem de `montarDreSonar`, que por sua vez delega a
// aritmética a `calcularSimulacaoML()` (D-15 da ADR-0141). Este arquivo é formulário e texto.
//
// A seção calcula UM preço: o do anúncio-âncora. Sem cenários, sem sensibilidade, sem ROI — os
// cinco cenários nunca foram enumerados e o ROI não tem definição (Spike 040).
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { fetchAliquotas } from '@/lib/queries';
import { calcularTarifaML } from '@/lib/tarifa';
import { montarDreSonar, type OrigemProduto } from '@/lib/dre-sonar';
import { fmtBRL, parseNumeroPtBr } from '@/lib/formato';

/** Âncora da DRE: o anúncio cujo preço é a receita da conta. Mesma forma que o simulador de
 *  margem do Sonar já usa, para não existirem duas ideias de "produto de referência". */
export interface AncoraDre {
  id: string;
  nome: string;
  category_id: string | null;
  preco_referencia: number | null;
}

function Linha({ rotulo, valor, negativo }: { rotulo: string; valor: string; negativo?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="tabular-nums">{negativo ? `−${valor}` : valor}</span>
    </div>
  );
}

function Indisponivel({ motivo }: { motivo: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <p>
        <span className="font-medium">DRE indisponível</span> — {motivo}. Não calculamos com estimativa.
      </p>
    </div>
  );
}

export function SonarDre({ ancora }: { ancora: AncoraDre | null }) {
  const [custoTexto, setCustoTexto] = useState('');
  const [origem, setOrigem] = useState<OrigemProduto | null>(null);

  const preco = ancora?.preco_referencia ?? null;
  const categoria = ancora?.category_id ?? null;

  const { data: aliquotas } = useQuery({
    queryKey: ['aliquotas'],
    queryFn: fetchAliquotas,
  });

  const { data: tarifa, isLoading: cotando } = useQuery({
    queryKey: ['sonar', 'dre', 'tarifa', ancora?.id, preco, categoria],
    queryFn: () => calcularTarifaML(preco!, categoria!),
    enabled: preco != null && categoria != null,
  });

  if (ancora == null || preco == null) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          Sem anúncio de referência com preço, não há receita para montar a DRE.
        </p>
      </Card>
    );
  }
  if (categoria == null) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          Este anúncio veio sem categoria do Mercado Livre, e a comissão depende dela — não dá para cotar.
        </p>
      </Card>
    );
  }

  const custoProduto = custoTexto.trim() === '' ? null : parseNumeroPtBr(custoTexto);
  const dre = montarDreSonar({
    precoAnuncio: preco,
    custoProduto,
    origem,
    aliquotas: aliquotas ? { nacional: aliquotas.nacional, importado: aliquotas.importado } : null,
    tarifa: tarifa ?? null,
  });

  return (
    <Card className="space-y-4 p-4">
      <div>
        <p className="text-sm font-medium">6. Dá lucro?</p>
        <p className="text-xs text-muted-foreground">
          No preço deste anúncio: {fmtBRL(preco)} · {ancora.nome}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="dre-custo" className="text-xs text-muted-foreground">Custo do produto</label>
          <Input
            id="dre-custo"
            inputMode="decimal"
            placeholder="quanto você paga por unidade"
            value={custoTexto}
            onChange={(e) => setCustoTexto(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          {/* Origem não tem default: a alíquota depende dela e imposto não se presume (ADR-0055). */}
          <span className="text-xs text-muted-foreground">Origem</span>
          <RadioGroup
            className="flex gap-4 pt-1"
            value={origem ?? ''}
            onValueChange={(v) => setOrigem(v as OrigemProduto)}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="nacional" id="dre-nacional" />
              <label htmlFor="dre-nacional" className="text-sm">Nacional</label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="importado" id="dre-importado" />
              <label htmlFor="dre-importado" className="text-sm">Importado</label>
            </div>
          </RadioGroup>
        </div>
      </div>

      {/* O que falta digitar aparece na hora: fazer o operador esperar a cotação para descobrir
          que precisa informar o custo seria esperar por nada. */}
      {cotando && custoProduto != null && origem != null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> cotando comissão e frete no Mercado Livre…
        </p>
      ) : dre.estado === 'indisponivel' ? (
        <Indisponivel motivo={dre.motivo} />
      ) : (
        <div className="space-y-1 text-sm">
          <Linha rotulo="receita" valor={fmtBRL(dre.receita)} />
          <Linha rotulo="comissão (Clássico)" valor={fmtBRL(dre.comissao)} negativo />
          <Linha rotulo="frete que você absorve" valor={fmtBRL(dre.frete)} negativo />
          <Linha rotulo={`imposto (${dre.aliquotaPct}%)`} valor={fmtBRL(dre.imposto)} negativo />
          <Linha rotulo="custo do produto" valor={fmtBRL(dre.custoProduto)} negativo />
          <div className="mt-2 flex items-baseline justify-between gap-4 border-t pt-2 font-medium">
            <span>lucro</span>
            <span className="tabular-nums">
              {fmtBRL(dre.lucro)} <span className="text-muted-foreground">({dre.margemPct.toFixed(1)}%)</span>
            </span>
          </div>
          {/* Zeros declarados, não silenciosos (ADR-0148 D-5). */}
          <p className="pt-2 text-xs text-muted-foreground">
            Não inclui: {dre.forasDoCalculo.join(', ')}.
          </p>
        </div>
      )}
    </Card>
  );
}
