import type { Meta, StoryObj } from '@storybook/react';
import { Logo, LogoSymbol } from '@/components/ui/logo';

const meta: Meta<typeof Logo> = {
  title: 'Design System/Marca',
  component: Logo,
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj<typeof Logo>;

export const Horizontal: Story = {};

export const SomenteSimbolo: Story = {
  render: () => <LogoSymbol className="h-16 w-16" />,
};

export const Tamanhos: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <Logo symbolClassName="h-6 w-6" />
      <Logo symbolClassName="h-8 w-8" />
      <Logo symbolClassName="h-12 w-12" />
    </div>
  ),
};

export const Favicon: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      {[16, 24, 32, 48].map((s) => (
        <div key={s} className="flex flex-col items-center gap-1">
          <LogoSymbol style={{ width: s, height: s }} />
          <span className="text-caption">{s}px</span>
        </div>
      ))}
    </div>
  ),
};
