// ADR-0174 emenda 2026-10-04 / ADR-0178 — tela global de operações em massa (promoções, pausar/reativar e reajuste).
import { PageHeader } from '@/components/ui/page-header';
import { ListaOperacoes } from '@/components/operacoes/lista-operacoes';

export default function Operacoes() {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <PageHeader title="Operações" subtitle="Operações em massa da organização: andamento, resultado por anúncio e Reverter." />
      <ListaOperacoes />
    </div>
  );
}
