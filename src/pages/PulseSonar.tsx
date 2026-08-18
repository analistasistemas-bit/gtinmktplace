// Sonar (ADR-0120): garimpo on-demand de um nicho do Mercado Livre, par do Radar (Pulse.tsx),
// que vigia o que já vendemos. O Sonar varre ANTES de cadastrar o produto.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Check, ChevronDown, ChevronRight, Circle, Eye, Loader2, Package, Search, TrendingUp, Truck, Users,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { DialogMargemSonar } from '@/components/pulse/dialog-margem-sonar';
import {
  fetchPainelSonar, fichasAtivas, fichasSemVendedor, passosProgresso,
  type PainelSonar, type EtapaProgresso,
} from '@/lib/sonar';
import { fmtBRL, fmtInt } from '@/lib/formato';

function SonarProgresso({ passos }: { passos: EtapaProgresso[] }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border p-4">
      {passos.map((p) => (
        <div key={p.label} className="flex items-center gap-2 text-sm">
          {p.status === 'concluida' ? (
            <Check className="h-4 w-4 shrink-0 text-success" />
          ) : p.status === 'ativa' ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          ) : (
            <Circle className="h-4 w-4 shrink-0 text-muted-foreground/30" />
          )}
          <span className={p.status === 'pendente' ? 'text-muted-foreground' : ''}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function PulseSonar() {
  const [termo, setTermo] = useState('');
  const [termoBuscado, setTermoBuscado] = useState<string | null>(null);
  const [, forcarRender] = useState(0);
  const iniciadoEmRef = useRef(0);
  const [semVendedorAberto, setSemVendedorAberto] = useState(false);
  const [fichaSimulando, setFichaSimulando] = useState<PainelSonar['fichas'][number] | null>(null);
  // Mantém o stepper visível um instante depois da resposta chegar, para mostrar as 4 etapas
  // concluídas antes de trocar pelo resultado (em vez de sumir direto na 3ª, travada).
  const [mostrarProgresso, setMostrarProgresso] = useState(false);

  const { data: painel, isFetching, isError, error } = useQuery({
    queryKey: ['pulse', 'sonar', termoBuscado],
    queryFn: () => fetchPainelSonar(termoBuscado!),
    enabled: !!termoBuscado,
    staleTime: Infinity, // cache real é o Redis (24h) — o front nunca refaz a mesma busca sozinho
  });

  // Avanço do stepper temporizado no cliente: a edge responde numa chamada única.
  useEffect(() => {
    if (isFetching) {
      iniciadoEmRef.current = Date.now();
      setMostrarProgresso(true);
      forcarRender((n) => n + 1);
      const id = setInterval(() => forcarRender((n) => n + 1), 250);
      return () => clearInterval(id);
    }
    const t = setTimeout(() => setMostrarProgresso(false), 400);
    return () => clearTimeout(t);
  }, [isFetching]);

  const buscar = (e: FormEvent) => {
    e.preventDefault();
    const t = termo.trim();
    if (t.length < 3) { toast.error('Digite ao menos 3 caracteres para garimpar.'); return; }
    setTermoBuscado(t);
  };

  const ativas = painel ? fichasAtivas(painel) : [];
  const vazias = painel ? fichasSemVendedor(painel) : [];
  const elapsedMs = iniciadoEmRef.current ? Date.now() - iniciadoEmRef.current : 0;

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Garimpa um nicho do Mercado Livre antes de você cadastrar o produto — o par do Radar, que
        vigia o que você já vende.
      </p>

      <form onSubmit={buscar} className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Ex.: tecido oxford 10 metros"
            aria-label="Termo de busca no Sonar"
            className="h-9 pl-8"
          />
        </div>
        <Button type="submit" disabled={isFetching}>
          <Search className="mr-2 h-4 w-4" />
          Garimpar
        </Button>
      </form>

      {!termoBuscado ? (
        <EmptyState
          icon={Search}
          title="O que o Sonar faz"
          description={
            'Varre um nicho do Mercado Livre antes de você cadastrar o produto: fichas de '
            + 'catálogo, concorrência, preço e demanda do nicho. Limites do dado: só cobre '
            + 'produtos com ficha de catálogo, e a demanda é medida por visitas e ranking — o '
            + 'Mercado Livre não expõe vendas exatas de terceiros.'
          }
        />
      ) : mostrarProgresso ? (
        <SonarProgresso passos={passosProgresso(elapsedMs, !isFetching)} />
      ) : isError ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">Não foi possível garimpar este termo.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro desconhecido.'}
          </p>
        </div>
      ) : painel ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <KpiCard size="compact" label="Visitas (30d)" value={fmtInt(painel.agregado.visitas_30d_total)} icon={Eye} tom="info" />
            <KpiCard
              size="compact"
              label="Fichas no catálogo"
              value={painel.total_catalogo}
              hint={`${ativas.length + vazias.length} analisadas`}
              icon={Package}
              tom="info"
            />
            <KpiCard size="compact" label="Ofertas" value={fmtInt(painel.agregado.ofertas_total)} icon={TrendingUp} tom="info" />
            <KpiCard size="compact" label="Vendedores distintos" value={painel.agregado.vendedores_distintos} icon={Users} tom="info" />
            <KpiCard size="compact" label="Frete grátis" value={`${painel.agregado.frete_gratis_pct}%`} icon={Truck} tom="info" />
          </div>

          {painel.agregado.visitas_por_dia.length > 0 && (
            <Card className="mb-4 p-4">
              <div className="mb-2 text-sm font-medium">Visitas por dia</div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={painel.agregado.visitas_por_dia} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grad-sonar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="data" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={40} tickFormatter={(v) => fmtInt(Number(v))} />
                    <RTooltip formatter={(v) => [fmtInt(Number(v)), 'Visitas']} labelClassName="text-foreground" contentStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="total" stroke="var(--primary)" strokeWidth={2} fill="url(#grad-sonar)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {ativas.length === 0 ? (
            <EmptyState icon={Package} title="Nenhuma ficha com vendedor ativo para este termo." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Ofertas</TableHead>
                    <TableHead>Faixa de preço</TableHead>
                    <TableHead>Visitas (30d)</TableHead>
                    <TableHead>Vendedores / UF</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ativas.map((f) => {
                    const ufs = [...new Set(f.vendedores.map((v) => v.uf).filter((uf): uf is string => !!uf))];
                    return (
                      <TableRow key={f.product_id}>
                        <TableCell className="max-w-xs truncate" title={f.nome}>{f.nome}</TableCell>
                        <TableCell className="tabular-nums">{f.ofertas}</TableCell>
                        <TableCell className="tabular-nums">
                          {f.preco ? `${fmtBRL(f.preco.min)} – ${fmtBRL(f.preco.max)}` : '—'}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {f.visitas_30d == null
                            ? <span title="Não medido">—</span>
                            : fmtInt(f.visitas_30d)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {f.vendedores.length} {ufs.length > 0 && `(${ufs.join(', ')})`}
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" onClick={() => setFichaSimulando(f)}>
                            Simular margem
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {painel.palavras_chave.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-sm font-medium">Palavras-chave do nicho</div>
              <div className="flex flex-wrap gap-1.5">
                {painel.palavras_chave.map((p) => (
                  <Badge key={p.termo} variant="secondary">{p.termo} ({p.contagem})</Badge>
                ))}
              </div>
            </div>
          )}

          {vazias.length > 0 && (
            <div className="mt-6">
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setSemVendedorAberto((o) => !o)}
              >
                {semVendedorAberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Fichas de catálogo sem vendedor ativo ({vazias.length})
              </button>
              {semVendedorAberto && (
                <div className="mt-2 rounded-lg border p-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Essas fichas já existem no catálogo do Mercado Livre, mas ninguém está vendendo
                    agora — pode ser oportunidade: a ficha está pronta e sem concorrência ativa.
                  </p>
                  <ul className="flex flex-col gap-1 text-sm">
                    {vazias.map((f) => <li key={f.product_id}>{f.nome}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      )}

      <DialogMargemSonar ficha={fichaSimulando} onFechar={() => setFichaSimulando(null)} />
    </div>
  );
}
