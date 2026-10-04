// ADR-0174 emenda 2026-10-04 — tela global de operações em massa (promoções e pausar/reativar).
import { PageHeader } from '@/components/ui/page-header';
import { ListaOperacoes } from '@/components/operacoes/lista-operacoes';

export default function Operacoes() {
  return (
    <div className="space-y-4">
      <PageHeader title="Operações" subtitle="Operações em massa da organização: andamento, resultado por anúncio e Reverter." />
      <ListaOperacoes />
    </div>
  );
}
