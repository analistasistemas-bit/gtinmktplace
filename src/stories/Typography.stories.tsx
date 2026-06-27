import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta = {
  title: 'Design System/Tipografia',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

export const Escala: Story = {
  render: () => (
    <div className="bg-background p-8 text-foreground">
      <p className="text-display">Display — Geist Variable</p>
      <p className="text-h1">H1 — Título principal de página</p>
      <p className="text-h2">H2 — Subtítulo de seção</p>
      <p className="text-h3">H3 — Cabeçalho de card / grupo</p>
      <p className="mt-2">Corpo de texto padrão (text-sm/base do app).</p>
      <p className="text-caption">Caption — metadados, datas, labels auxiliares</p>
    </div>
  ),
};
