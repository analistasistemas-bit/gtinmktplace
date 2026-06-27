import type { Meta, StoryObj } from '@storybook/react';
import { Input } from '@/components/ui/input';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  args: { placeholder: 'Digite aqui…' },
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj<typeof Input>;

export const Padrao: Story = { render: (args) => <div className="w-[320px]"><Input {...args} /></div> };

export const Desabilitado: Story = {
  render: (args) => <div className="w-[320px]"><Input {...args} disabled /></div>,
};

export const Invalido: Story = {
  render: (args) => <div className="w-[320px]"><Input {...args} aria-invalid /></div>,
};
