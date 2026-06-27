import type { Meta, StoryObj } from '@storybook/react';
import { Package } from 'lucide-react';
import { KpiCard } from '@/components/ui/kpi-card';

const meta: Meta<typeof KpiCard> = {
  title: 'UI/KpiCard',
  component: KpiCard,
  args: { label: 'Famílias publicadas', value: 42, icon: Package },
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj<typeof KpiCard>;

export const Padrao: Story = { args: { delta: '+5 hoje', deltaTrend: 'up', hint: 'vs. ontem' } };

export const Marca: Story = {
  args: { variant: 'brand', delta: '+12%', deltaTrend: 'up', hint: 'no mês' },
};

export const Carregando: Story = { args: { loading: true } };

export const Grade: Story = {
  render: () => (
    <div className="grid w-[640px] grid-cols-2 gap-4">
      <KpiCard label="Famílias publicadas" value={42} icon={Package} delta="+5" deltaTrend="up" hint="hoje" />
      <KpiCard label="Aguardando revisão" value={7} delta="-2" deltaTrend="down" hint="hoje" />
      <KpiCard label="Erros" value={1} deltaTrend="neutral" />
      <KpiCard label="Receita" value="R$ 18.430" variant="brand" icon={Package} delta="+12%" deltaTrend="up" />
    </div>
  ),
};
