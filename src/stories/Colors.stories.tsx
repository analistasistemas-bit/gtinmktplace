import type { Meta, StoryObj } from '@storybook/react';

// Showcase dos tokens de cor do design system (fonte da verdade: src/index.css).
// Renderiza via classes Tailwind que apontam para as CSS variables — então
// alternar o tema (toolbar) reflete os valores light/dark reais.

const meta: Meta = {
  title: 'Design System/Cores',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

function Swatch({ name, className, fg }: { name: string; className: string; fg?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className={`h-16 w-full rounded-lg border border-border ${className} ${fg ?? ''}`} />
      <span className="text-caption">{name}</span>
    </div>
  );
}

export const Superficies: Story = {
  render: () => (
    <div className="bg-background p-8">
      <h2 className="text-h1 mb-4">Superfícies & texto</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Swatch name="background" className="bg-background" />
        <Swatch name="foreground" className="bg-foreground" />
        <Swatch name="card" className="bg-card" />
        <Swatch name="muted" className="bg-muted" />
        <Swatch name="border" className="bg-border" />
        <Swatch name="popover" className="bg-popover" />
      </div>
    </div>
  ),
};

export const Marca: Story = {
  render: () => (
    <div className="bg-background p-8">
      <h2 className="text-h1 mb-4">Marca (indigo ~277 + violeta ~300)</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Swatch name="primary" className="bg-primary" />
        <Swatch name="secondary" className="bg-secondary" />
        <Swatch name="accent" className="bg-accent" />
        <Swatch name="ring" className="bg-ring" />
      </div>
      <h3 className="text-h3 mt-6 mb-2">Gradiente de marca</h3>
      <div className="flex gap-4">
        <div className="h-24 w-48 rounded-xl bg-[image:var(--brand-gradient)] shadow-brand" />
        <div className="h-24 w-48 rounded-xl bg-[image:var(--brand-gradient-soft)]" />
      </div>
    </div>
  ),
};

export const Estados: Story = {
  render: () => (
    <div className="bg-background p-8">
      <h2 className="text-h1 mb-4">Tokens semânticos (feedback)</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Swatch name="success" className="bg-success" />
        <Swatch name="warning" className="bg-warning" />
        <Swatch name="info" className="bg-info" />
        <Swatch name="destructive / danger" className="bg-destructive" />
      </div>
    </div>
  ),
};

export const Charts: Story = {
  render: () => (
    <div className="bg-background p-8">
      <h2 className="text-h1 mb-4">Paleta de gráficos</h2>
      <div className="grid grid-cols-5 gap-4">
        <Swatch name="chart-1" className="bg-chart-1" />
        <Swatch name="chart-2" className="bg-chart-2" />
        <Swatch name="chart-3" className="bg-chart-3" />
        <Swatch name="chart-4" className="bg-chart-4" />
        <Swatch name="chart-5" className="bg-chart-5" />
      </div>
    </div>
  ),
};
