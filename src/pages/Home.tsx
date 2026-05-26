import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold tracking-tight">EAN2Marketplace</h1>
      <p className="text-muted-foreground">Foundation OK</p>
      <Button>Funciona</Button>
    </div>
  );
}
