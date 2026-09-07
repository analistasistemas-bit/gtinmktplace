import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { usePlatformTerms, useSavePlatformTerms } from '@/hooks/usePlatformAdmin';
import { effectiveTerm, todayInFortaleza, type CommercialTerms } from '@/lib/platform-admin';

type Props = {
  orgId: string;
  current: CommercialTerms | null;
  onSaved: () => void;
};

type FormState = {
  modality: '1' | '2';
  monthly: string;
  revenue: string;
  sonar: string;
  setup: string;
  setupDueMonth: string;
  reason: string;
};

function formatScaled(value: number, scale: number): string {
  const divisor = 10 ** scale;
  const whole = Math.trunc(value / divisor);
  const fraction = String(Math.abs(value % divisor)).padStart(scale, '0');
  return scale === 0 ? String(whole) : `${whole},${fraction}`;
}

function parseScaled(value: string, scale: number): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{3})*(?:,\d{1,2})?$/.test(normalized)) return null;
  const [wholePart, decimalPart = ''] = normalized.split('.').join('').split(',');
  if (decimalPart.length > scale) return null;
  const scaled = Number(`${wholePart}${decimalPart.padEnd(scale, '0')}`);
  return Number.isSafeInteger(scaled) ? scaled : null;
}

function fortalezaDateParts(now = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function nextMonthStart(now = new Date()): string {
  const { year, month } = fortalezaDateParts(now);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

function currentMonthStart(now = new Date()): string {
  const { year, month } = fortalezaDateParts(now);
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function initialState(current: CommercialTerms | null, startsOn: string): FormState {
  return {
    modality: String(current?.modality ?? 1) as '1' | '2',
    monthly: formatScaled(current?.monthly_fee_cents ?? 60_000, 2),
    revenue: formatScaled(current?.revenue_bps ?? 500, 2),
    sonar: formatScaled(current?.sonar_unit_cents ?? 120, 2),
    setup: formatScaled(current?.setup_fee_cents ?? 300_000, 2),
    setupDueMonth: current?.setup_due_month ?? startsOn.slice(0, 7),
    reason: '',
  };
}

function historyStatus(
  term: CommercialTerms,
  rows: CommercialTerms[],
  today: string,
): 'Vigente' | 'Futura' | 'Anterior' {
  if (term.starts_on > today) return 'Futura';
  const effective = effectiveTerm(rows, today);
  return effective?.id === term.id ? 'Vigente' : 'Anterior';
}

function toneForStatus(status: 'Vigente' | 'Futura' | 'Anterior'): StatusTone {
  return status === 'Vigente' ? 'success' : status === 'Futura' ? 'info' : 'neutral';
}

export function CommercialTermsForm({ orgId, current, onSaved }: Props) {
  const nextMonth = useMemo(() => nextMonthStart(), []);
  const currentMonth = useMemo(() => currentMonthStart(), []);
  const isFirstContract = current === null;
  const [startsOn, setStartsOn] = useState(nextMonth);
  const effectiveStartsOn = isFirstContract ? startsOn : nextMonth;
  const today = useMemo(() => todayInFortaleza(), []);
  const [form, setForm] = useState<FormState>(() => initialState(current, effectiveStartsOn));
  const [error, setError] = useState<string | null>(null);
  const revenueTouched = useRef(false);
  const terms = usePlatformTerms(orgId);
  const save = useSavePlatformTerms();

  useEffect(() => {
    setStartsOn(nextMonth);
    setForm(initialState(current, nextMonth));
    revenueTouched.current = false;
    setError(null);
  }, [current, orgId, nextMonth]);

  const set = (field: keyof FormState, value: string) =>
    setForm((previous) => ({ ...previous, [field]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const monthly = parseScaled(form.monthly, 2);
    const revenue = parseScaled(form.revenue, 2);
    const sonar = parseScaled(form.sonar, 2);
    const setup = parseScaled(form.setup, 2);
    if ([monthly, revenue, sonar, setup].some((value) => value === null)) {
      setError('Use valores positivos ou zero, com no máximo duas casas decimais.');
      return;
    }
    if (!form.reason.trim()) {
      setError('Informe o motivo da alteração.');
      return;
    }

    setError(null);
    try {
      await save.mutateAsync({
        org_id: orgId,
        starts_on: effectiveStartsOn,
        modality: Number(form.modality) as 1 | 2,
        monthly_fee_cents: monthly!,
        revenue_bps: revenue!,
        sonar_unit_cents: sonar!,
        setup_fee_cents: setup!,
        setup_due_month: form.setupDueMonth || null,
        reason: form.reason.trim(),
      });
      set('reason', '');
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar as condições.');
    }
  }

  const history = terms.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <details open={isFirstContract}>
          <summary className="cursor-pointer list-none">
            <CardHeader>
              <CardTitle>Condições comerciais</CardTitle>
              {!isFirstContract && current && (
                <CardDescription>
                  Modalidade {current.modality} · {formatScaled(current.revenue_bps, 2)}% sobre receita
                  {' '}· desde {current.starts_on}
                </CardDescription>
              )}
              {!isFirstContract && (
                <CardAction>
                  <span className="text-sm font-medium text-primary">Renegociar</span>
                </CardAction>
              )}
            </CardHeader>
          </summary>
          <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Modalidade</span>
              <select
                aria-label="Modalidade"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3"
                value={form.modality}
                onChange={(event) => {
                  const modality = event.target.value as '1' | '2';
                  setForm((previous) => ({
                    ...previous,
                    modality,
                    revenue: current === null && !revenueTouched.current
                      ? modality === '2' ? '7,00' : '5,00'
                      : previous.revenue,
                  }));
                }}
              >
                <option value="1">1 · mensalidade + percentual</option>
                <option value="2">2 · percentual com infraestrutura</option>
              </select>
            </label>
            <label className="space-y-1 text-sm" htmlFor="terms-monthly">
              <span className="font-medium">Infraestrutura mensal</span>
              <Input
                id="terms-monthly"
                aria-label="Infraestrutura mensal"
                inputMode="decimal"
                value={form.monthly}
                onChange={(event) => set('monthly', event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm" htmlFor="terms-revenue">
              <span className="font-medium">Percentual sobre receita</span>
              <Input
                id="terms-revenue"
                aria-label="Percentual sobre receita"
                inputMode="decimal"
                value={form.revenue}
                onChange={(event) => {
                  revenueTouched.current = true;
                  set('revenue', event.target.value);
                }}
              />
            </label>
            <label className="space-y-1 text-sm" htmlFor="terms-sonar">
              <span className="font-medium">Sonar por consulta</span>
              <Input
                id="terms-sonar"
                aria-label="Sonar por consulta"
                inputMode="decimal"
                value={form.sonar}
                onChange={(event) => set('sonar', event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm" htmlFor="terms-setup">
              <span className="font-medium">Implantação</span>
              <Input
                id="terms-setup"
                aria-label="Implantação"
                inputMode="decimal"
                value={form.setup}
                onChange={(event) => set('setup', event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm" htmlFor="terms-setup-month">
              <span className="font-medium">Mês da implantação</span>
              <Input
                id="terms-setup-month"
                aria-label="Mês da implantação"
                type="month"
                value={form.setupDueMonth}
                onChange={(event) => set('setupDueMonth', event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="font-medium">Motivo</span>
              <textarea
                aria-label="Motivo"
                className="min-h-20 w-full rounded-md border border-input bg-background p-2"
                value={form.reason}
                onChange={(event) => set('reason', event.target.value)}
              />
            </label>
            {isFirstContract ? (
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="font-medium">Início da vigência</span>
                <select
                  aria-label="Início da vigência"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3"
                  value={startsOn}
                  onChange={(event) => setStartsOn(event.target.value)}
                >
                  <option value={nextMonth}>Próximo mês ({nextMonth})</option>
                  <option value={currentMonth}>Este mês ({currentMonth})</option>
                </select>
              </label>
            ) : null}
            <p className="text-sm text-muted-foreground md:col-span-2">
              {isFirstContract ? (
                <>
                  Primeiro contrato pode iniciar neste mês, sem cobrança retroativa. Padrão: próximo mês.
                  {' '}Vigência selecionada: <strong>{effectiveStartsOn}</strong>.
                </>
              ) : (
                <>
                  Renegociação vale a partir do próximo mês (<strong>{effectiveStartsOn}</strong>).
                </>
              )}
            </p>
            {error && <p className="text-sm text-destructive md:col-span-2" role="alert">{error}</p>}
            <div className="md:col-span-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? 'Salvando…' : 'Salvar condições'}
              </Button>
            </div>
          </form>
          </CardContent>
        </details>
      </Card>

      <Card>
        <CardHeader><CardTitle>Histórico de condições</CardTitle></CardHeader>
        <CardContent>
          {terms.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando histórico…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma condição registrada.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((term) => (
                <li key={term.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                  <span className="flex items-center gap-2">
                    <StatusPill tone={toneForStatus(historyStatus(term, history, today))}>
                      {historyStatus(term, history, today)}
                    </StatusPill>
                    modalidade {term.modality} · {formatScaled(term.revenue_bps, 2)}%
                  </span>
                  <span className="text-muted-foreground">
                    desde {term.starts_on} · versão {term.version}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
