import type { Meta, StoryObj } from '@storybook/react';
import { StatusPill } from '@/components/ui/status-pill';

const meta: Meta<typeof StatusPill> = {
  title: 'UI/StatusPill',
  component: StatusPill,
  args: { children: 'Status', tone: 'neutral' },
  argTypes: {
    tone: { control: 'select', options: ['success', 'warning', 'danger', 'info', 'neutral'] },
  },
};
export default meta;
type Story = StoryObj<typeof StatusPill>;

export const Tons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <StatusPill tone="success">Publicado</StatusPill>
      <StatusPill tone="warning">Incompleto</StatusPill>
      <StatusPill tone="danger">Erro</StatusPill>
      <StatusPill tone="info">Processando</StatusPill>
      <StatusPill tone="neutral">Rascunho</StatusPill>
    </div>
  ),
};
