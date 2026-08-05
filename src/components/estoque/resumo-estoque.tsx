// Faixa de agregados da tela Estoque. A tela abria direto na lista: dava para rolar tudo sem
// nunca saber quanto havia em estoque nem quantos SKUs estavam zerados.
import { Boxes, Layers, AlertTriangle, Wallet } from 'lucide-react';
import { KpiCard } from '@/components/ui/kpi-card';
import { fmtBRL } from '@/lib/formato';
import type { ResumoEstoque } from '@/lib/produtos-saldo-resumo';

export function ResumoEstoqueKpis({ resumo, carregando }: { resumo: ResumoEstoque; carregando?: boolean }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
      <KpiCard
        size="compact" loading={carregando} icon={Layers} tom="info"
        label="SKUs cadastrados" value={resumo.skus}
        hint={`${resumo.produtos} ${resumo.produtos === 1 ? 'produto' : 'produtos'}`}
      />
      <KpiCard
        size="compact" loading={carregando} icon={Boxes} tom="info"
        label="Unidades em estoque" value={resumo.unidades}
      />
      <KpiCard
        size="compact" loading={carregando} icon={AlertTriangle}
        tom={resumo.skusSemEstoque > 0 ? 'warning' : 'success'}
        label="SKUs sem estoque" value={resumo.skusSemEstoque}
        hint={resumo.skus > 0 ? `de ${resumo.skus}` : undefined}
      />
      <KpiCard
        size="compact" loading={carregando} icon={Wallet} tom="info"
        label="Valor em estoque" value={fmtBRL(resumo.valorEmEstoque)}
        // Custo é nullable (ADR-0094 D-9): sem este aviso o total apareceria subnotificado
        // sem nenhum sinal de que faltou dado — o mesmo silêncio do incidente de ORIGEM.
        hint={resumo.skusSemCusto > 0
          ? `${resumo.skusSemCusto} ${resumo.skusSemCusto === 1 ? 'SKU sem custo' : 'SKUs sem custo'} — fora do total`
          : undefined}
      />
    </div>
  );
}
