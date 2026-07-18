import { useState } from 'react';
import { Boxes, Inbox, Package, TrendingUp } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { durationMs, easingCss, useReducedMotion } from '@/motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { KpiCard } from '@/components/ui/kpi-card';
import { DataTable, type Column } from '@/components/ui/data-table';

// Correção a: classes literais completas (JIT do Tailwind v4 não detecta bg-${token})
const SURFACES = [
  { name: 'background', cls: 'bg-background' },
  { name: 'card', cls: 'bg-card' },
  { name: 'primary', cls: 'bg-primary' },
  { name: 'secondary', cls: 'bg-secondary' },
  { name: 'muted', cls: 'bg-muted' },
  { name: 'accent', cls: 'bg-accent' },
  { name: 'border', cls: 'bg-border' },
] as const;

const SEMANTIC = [
  { name: 'success', cls: 'bg-success text-success-foreground' },
  { name: 'warning', cls: 'bg-warning text-warning-foreground' },
  { name: 'info', cls: 'bg-info text-info-foreground' },
  { name: 'danger', cls: 'bg-danger text-danger-foreground' },
] as const;

const TONES: StatusTone[] = ['success', 'warning', 'danger', 'info', 'neutral'];

interface Row { id: string; nome: string; status: StatusTone }
const ROWS: Row[] = [
  { id: '1', nome: 'Fita Cetim N.3', status: 'success' },
  { id: '2', nome: 'Linha Setta XIK', status: 'warning' },
];
const COLS: Column<Row>[] = [
  { key: 'nome', header: 'Produto', cell: (r) => r.nome },
  { key: 'status', header: 'Status', cell: (r) => <StatusPill tone={r.status}>{r.status}</StatusPill> },
];

export default function StyleGuide() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="space-y-8 p-6">
      <PageHeader
        title="Design System — PubliAI"
        // Correção b: template string JS interpolando {theme} de verdade
        subtitle={`Tokens, primitivos e componentes. Tema atual: ${theme}.`}
        actions={
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Dark</span>
            <Switch checked={theme === 'light'} onCheckedChange={(v) => setTheme(v ? 'light' : 'dark')} />
            <span className="text-muted-foreground">Light</span>
          </div>
        }
      />

      <Section title="Cores — superfícies">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {SURFACES.map((s) => (
            <div key={s.name} className="space-y-1">
              <div className={`h-14 rounded-md border ${s.cls}`} />
              <p className="text-caption">{s.name}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Cores — semânticas">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SEMANTIC.map((s) => (
            <div key={s.name} className="space-y-1">
              <div className={`flex h-14 items-center justify-center rounded-md text-sm font-medium ${s.cls}`}>{s.name}</div>
              <p className="text-caption">{s.name}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tipografia">
        <div className="space-y-1">
          <p className="text-display">Display 2.25rem</p>
          <p className="text-h1">Heading 1</p>
          <p className="text-h2">Heading 2</p>
          <p className="text-h3">Heading 3</p>
          <p className="text-sm">Body — texto corrido padrão.</p>
          <p className="text-caption">Caption — informação secundária.</p>
        </div>
      </Section>

      <Section title="KPIs">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Processados" value={128} icon={Boxes} />
          <KpiCard label="Publicados" value={42} icon={Package} delta="+3" deltaTrend="up" hint="vs. ontem" />
          <KpiCard label="Aguardando" value={9} icon={Inbox} />
          <KpiCard label="Receita potencial" value="R$ 12.430" icon={TrendingUp} loading />
        </div>
      </Section>

      <Section title="Botões & inputs">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primário</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destrutivo</Button>
          <Button disabled>Desabilitado</Button>
          <Input placeholder="Input…" className="w-48" />
          <Badge>Badge</Badge>
        </div>
      </Section>

      <Section title="Status pills">
        <div className="flex flex-wrap gap-2">
          {TONES.map((tone) => (
            <StatusPill key={tone} tone={tone}>{tone}</StatusPill>
          ))}
        </div>
      </Section>

      <Section title="Tabela (DataTable)">
        <DataTable columns={COLS} rows={ROWS} rowKey={(r) => r.id} />
      </Section>

      <Section title="DataTable — loading & empty">
        <div className="grid gap-4 lg:grid-cols-2">
          <DataTable columns={COLS} rows={[]} rowKey={(r) => r.id} loading skeletonRows={3} />
          <DataTable columns={COLS} rows={[]} rowKey={(r) => r.id} empty={<EmptyState icon={Inbox} title="Nada por aqui" description="Quando houver dados, eles aparecem nesta tabela." />} />
        </div>
      </Section>

      <Section title="Elevação">
        <div className="flex flex-wrap gap-4">
          {(['shadow-xs', 'shadow-sm', 'shadow-md', 'shadow-lg'] as const).map((s) => (
            <Card key={s} className={`flex h-20 w-32 items-center justify-center ${s}`}>{s}</Card>
          ))}
        </div>
      </Section>

      <Section title="Gradiente de marca">
        <div className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <div className="h-20 w-40 rounded-xl bg-[image:var(--brand-gradient)] shadow-brand" />
            <p className="text-caption">--brand-gradient</p>
          </div>
          <div className="space-y-1">
            <div className="h-20 w-40 rounded-xl bg-[image:var(--brand-gradient-soft)]" />
            <p className="text-caption">--brand-gradient-soft</p>
          </div>
        </div>
        <p className="text-caption mt-2 text-muted-foreground">Uso: só vitrine (hero, KPI destaque, logo, empty-state).</p>
      </Section>

      <Section title="Skeleton">
        <div className="space-y-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      </Section>

      <Section title="Motion">
        <MotionDemo />
      </Section>
    </div>
  );
}

/** Demonstração da camada motion/ — fonte única em src/motion/tokens.ts (Fase 2, sem uso em telas reais). */
function MotionDemo() {
  const [replay, setReplay] = useState(0);
  const reduced = useReducedMotion();
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-caption mb-1">Durações — src/motion/tokens.ts → --motion-duration-*</p>
          {Object.entries(durationMs).map(([nome, ms]) => (
            <p key={nome} className="font-mono text-sm">{nome}: {ms}ms</p>
          ))}
        </div>
        <div>
          <p className="text-caption mb-1">Easings — src/motion/easings.ts → --motion-ease-*</p>
          {Object.entries(easingCss).map(([nome, curva]) => (
            <p key={nome} className="font-mono text-sm">{nome}: {curva}</p>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => setReplay((n) => n + 1)}>Reproduzir entrada</Button>
        {/* slide-in-from-bottom-2 = 8px = distance.enterY; duração/curva vêm das CSS vars geradas */}
        <div
          key={replay}
          className="animate-in fade-in-0 slide-in-from-bottom-2 duration-(--motion-duration-enter) ease-enter rounded-md border bg-card px-4 py-2 text-sm shadow-sm"
        >
          entrada: enter · {durationMs.enter}ms · ease-enter
        </div>
        <Button className="duration-(--motion-duration-micro) active:scale-(--motion-press-scale)">
          press: micro · {durationMs.micro}ms
        </Button>
      </div>
      <p className="text-caption">
        prefers-reduced-motion: {reduced ? 'reduce — durações zeradas pela rede de segurança global' : 'no-preference'}
      </p>
    </div>
  );
}
