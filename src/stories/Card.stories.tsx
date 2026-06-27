import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj<typeof Card>;

export const Completo: Story = {
  render: () => (
    <Card className="w-[360px]">
      <CardHeader>
        <CardTitle>Lote #1042</CardTitle>
        <CardDescription>12 famílias prontas para publicação.</CardDescription>
        <CardAction>
          <Button size="sm" variant="ghost">Ver</Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">Conteúdo do card — resumo do lote, métricas, etc.</p>
      </CardContent>
      <CardFooter>
        <Button>Publicar</Button>
      </CardFooter>
    </Card>
  ),
};
