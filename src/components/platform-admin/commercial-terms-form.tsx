import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { usePlatformTerms, useSavePlatformTerms, useSavePlatformUnitPrices } from '@/hooks/usePlatformAdmin';
import { effectiveTerm, todayInFortaleza, type CommercialTerms, type PlatformAdminError } from '@/lib/platform-admin';

type Props = {
  orgId: string;
  current: CommercialTerms | null;
  onSaved: () => void;
};

type FormState = {
  modality: '1' | '2';
  monthly: string;
  revenueT1: string;
  revenueT2: string;
  revenueT3: string;
  revenueT4: string;
  sonar: string;
  image: string;
  setup: string;
  setupDueMonth: string;
  dueDay: string;
  reason: string;
};

// ADR-0193 D-9: 1..28 para existir em todo mês (fevereiro incluso).
const DUE_DAYS = Array.from({ length: 28 }, (_, i) => String(i + 1));

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
  const modality = String(current?.modality ?? 1) as '1' | '2';
  return {
    modality,
    monthly: formatScaled(current?.monthly_fee_cents ?? (modality === '1' ? 60_000 : 0), 2),
    revenueT1: formatScaled(current?.revenue_bps_t1 ?? (modality === '2' ? 700 : 500), 2),
    revenueT2: formatScaled(current?.revenue_bps_t2 ?? (modality === '2' ? 600 : 400), 2),
    revenueT3: formatScaled(current?.revenue_bps_t3 ?? (modality === '2' ? 550 : 350), 2),
    revenueT4: formatScaled(current?.revenue_bps_t4 ?? (modality === '2' ? 500 : 300), 2),
    sonar: formatScaled(current?.sonar_unit_cents ?? (modality === '2' ? 120 : 0), 2),
    image: formatScaled(current?.image_unit_cents ?? 0, 2),
    setup: formatScaled(current?.setup_fee_cents ?? 300_000, 2),
    setupDueMonth: current?.setup_due_month ?? startsOn.slice(0, 7),
    dueDay: String(current?.due_day ?? 5),
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
  const isFirstContract = current === null;
  const [startsOn, setStartsOn] = useState(() => currentMonthStart());
  const effectiveStartsOn = isFirstContract ? startsOn : nextMonthStart();
  const today = useMemo(() => todayInFortaleza(), []);
  const [form, setForm] = useState<FormState>(() => initialState(current, effectiveStartsOn));
  const [error, setError] = useState<string | null>(null);
  const revenueTouched = useRef(false);
  const terms = usePlatformTerms(orgId);
  const save = useSavePlatformTerms();

  function syncMonthRollover(nowMonth: string) {
    setStartsOn(nowMonth);
    const minSetupMonth = nowMonth.slice(0, 7);
    setForm((previous) => ({
      ...previous,
      setupDueMonth: previous.setupDueMonth && previous.setupDueMonth < minSetupMonth
        ? minSetupMonth
        : previous.setupDueMonth,
    }));
    setError('A competência do mês virou enquanto o formulário estava aberto. A vigência foi ajustada para o mês atual. Revise e confirme o salvamento.');
  }

  useEffect(() => {
    const month = currentMonthStart();
    setStartsOn(month);
    setForm(initialState(current, month));
    revenueTouched.current = false;
    setError(null);
  }, [current, orgId]);

  useEffect(() => {
    function syncOnFocus() {
      const nowMonth = currentMonthStart();
      if (isFirstContract && startsOn < nowMonth) {
        syncMonthRollover(nowMonth);
      }
    }
    window.addEventListener('focus', syncOnFocus);
    return () => window.removeEventListener('focus', syncOnFocus);
  }, [isFirstContract, startsOn]);

  const set = (field: keyof FormState, value: string) =>
    setForm((previous) => ({ ...previous, [field]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const nowCurrentMonth = currentMonthStart();
    if (isFirstContract && startsOn < nowCurrentMonth) {
      syncMonthRollover(nowCurrentMonth);
      return;
    }

    const monthly = parseScaled(form.monthly, 2);
    const revenueT1 = parseScaled(form.revenueT1, 2);
    const revenueT2 = parseScaled(form.revenueT2, 2);
    const revenueT3 = parseScaled(form.revenueT3, 2);
    const revenueT4 = parseScaled(form.revenueT4, 2);
    const sonar = parseScaled(form.sonar, 2);
    const image = parseScaled(form.image, 2);
    const setup = parseScaled(form.setup, 2);
    if ([monthly, revenueT1, revenueT2, revenueT3, revenueT4, sonar, image, setup].some((value) => value === null)) {
      setError('Use valores positivos ou zero, com no máximo duas casas decimais.');
      return;
    }
    if (!form.reason.trim()) {
      setError('Informe o motivo da alteração.');
      return;
    }

    const hasEffectiveSetup = isFirstContract && setup! > 0;
    const effectiveSetupDue = hasEffectiveSetup
      ? (form.setupDueMonth && form.setupDueMonth < effectiveStartsOn.slice(0, 7)
          ? effectiveStartsOn.slice(0, 7)
          : form.setupDueMonth || null)
      : null;

    if (hasEffectiveSetup && !effectiveSetupDue) {
      setError('Informe o mês da implantação.');
      return;
    }

    setError(null);
    try {
      await save.mutateAsync({
        org_id: orgId,
        starts_on: effectiveStartsOn,
        modality: Number(form.modality) as 1 | 2,
        monthly_fee_cents: form.modality === '2' ? 0 : monthly!,
        revenue_bps_t1: revenueT1!,
        revenue_bps_t2: revenueT2!,
        revenue_bps_t3: revenueT3!,
        revenue_bps_t4: revenueT4!,
        sonar_unit_cents: form.modality === '1' ? 0 : sonar!,
        image_unit_cents: image!,
        setup_fee_cents: isFirstContract ? setup! : 0,
        setup_due_month: effectiveSetupDue,
        reason: form.reason.trim(),
        due_day: Number(form.dueDay),
      });
      set('reason', '');
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar as condições.');
    }
  }

  const history = terms.data?.rows ?? [];
  const parsedSetup = parseScaled(form.setup, 2);
  const hasSetupFee = isFirstContract && parsedSetup !== 0;

  return (
    <div className="space-y-4">
      <Card>
        <details open={isFirstContract} className="flex flex-col gap-4">
          <summary className="cursor-pointer list-none">
            <CardHeader>
              <CardTitle>Condições comerciais</CardTitle>
              {!isFirstContract && current && (
                <CardDescription>
                  Modalidade {current.modality} · {formatScaled(current.revenue_bps_t1, 2)}% a {formatScaled(current.revenue_bps_t4, 2)}% sobre receita
                  {' '}· {current.starts_on > today ? 'a partir de' : 'desde'} {current.starts_on}
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
            <label className="space-y-1 text-sm" htmlFor="terms-modality">
              <span className="font-medium">Modalidade</span>
              <Select
                value={form.modality}
                onValueChange={(value) => {
                  const modality = value as '1' | '2';
                  setForm((previous) => ({
                    ...previous,
                    modality,
                    ...(current === null && !revenueTouched.current
                      ? modality === '2'
                        ? { revenueT1: '7,00', revenueT2: '6,00', revenueT3: '5,50', revenueT4: '5,00' }
                        : { revenueT1: '5,00', revenueT2: '4,00', revenueT3: '3,50', revenueT4: '3,00' }
                      : {}),
                  }));
                }}
              >
                <SelectTrigger id="terms-modality" aria-label="Modalidade" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Modalidade 1 · Gestão Completa Daludi</SelectItem>
                  <SelectItem value="2">Modalidade 2 · Gestão Completa + Inteligência</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-sm" htmlFor="terms-monthly">
              <span className="font-medium">Infraestrutura mensal</span>
              <Input
                id="terms-monthly"
                aria-label="Infraestrutura mensal"
                inputMode="decimal"
                disabled={form.modality === '2'}
                value={form.modality === '2' ? '0,00' : form.monthly}
                onChange={(event) => set('monthly', event.target.value)}
              />
            </label>
            <div className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium">Percentual por faixa de faturamento</span>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <label className="space-y-1 text-sm" htmlFor="terms-revenue-t1">
                  <span className="text-xs text-muted-foreground">até R$100 mil</span>
                  <Input
                    id="terms-revenue-t1"
                    aria-label="Percentual até R$100 mil"
                    inputMode="decimal"
                    value={form.revenueT1}
                    onChange={(event) => {
                      revenueTouched.current = true;
                      set('revenueT1', event.target.value);
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm" htmlFor="terms-revenue-t2">
                  <span className="text-xs text-muted-foreground">R$100–300 mil</span>
                  <Input
                    id="terms-revenue-t2"
                    aria-label="Percentual R$100–300 mil"
                    inputMode="decimal"
                    value={form.revenueT2}
                    onChange={(event) => {
                      revenueTouched.current = true;
                      set('revenueT2', event.target.value);
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm" htmlFor="terms-revenue-t3">
                  <span className="text-xs text-muted-foreground">R$300–500 mil</span>
                  <Input
                    id="terms-revenue-t3"
                    aria-label="Percentual R$300–500 mil"
                    inputMode="decimal"
                    value={form.revenueT3}
                    onChange={(event) => {
                      revenueTouched.current = true;
                      set('revenueT3', event.target.value);
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm" htmlFor="terms-revenue-t4">
                  <span className="text-xs text-muted-foreground">acima de R$500 mil</span>
                  <Input
                    id="terms-revenue-t4"
                    aria-label="Percentual acima de R$500 mil"
                    inputMode="decimal"
                    value={form.revenueT4}
                    onChange={(event) => {
                      revenueTouched.current = true;
                      set('revenueT4', event.target.value);
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 md:col-span-2">
              <label className="space-y-1 text-sm" htmlFor="terms-sonar">
                <span className="font-medium">Sonar por consulta</span>
                <Input
                  id="terms-sonar"
                  aria-label="Sonar por consulta"
                  inputMode="decimal"
                  disabled={form.modality === '1'}
                  value={form.modality === '1' ? '0,00' : form.sonar}
                  onChange={(event) => set('sonar', event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm" htmlFor="terms-image">
                <span className="font-medium">Imagem IA por unidade</span>
                <Input
                  id="terms-image"
                  aria-label="Imagem IA por unidade"
                  inputMode="decimal"
                  value={form.image}
                  onChange={(event) => set('image', event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm" htmlFor="terms-setup">
                <span className="font-medium">Implantação</span>
                <Input
                  id="terms-setup"
                  aria-label="Implantação"
                  inputMode="decimal"
                  disabled={!isFirstContract}
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
                  disabled={!hasSetupFee}
                  value={hasSetupFee ? form.setupDueMonth : ''}
                  onChange={(event) => set('setupDueMonth', event.target.value)}
                />
              </label>
            </div>
            <label className="space-y-1 text-sm" htmlFor="terms-due-day">
              <span className="font-medium">Vencimento (dia)</span>
              <Select value={form.dueDay} onValueChange={(value) => set('dueDay', value)}>
                <SelectTrigger id="terms-due-day" aria-label="Vencimento (dia)" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DUE_DAYS.map((day) => (
                    <SelectItem key={day} value={day}>Dia {day.padStart(2, '0')} do mês seguinte</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-sm md:col-span-2" htmlFor="terms-reason">
              <span className="font-medium">Motivo</span>
              <Textarea
                id="terms-reason"
                aria-label="Motivo"
                className="min-h-20"
                value={form.reason}
                onChange={(event) => set('reason', event.target.value)}
              />
            </label>
            {isFirstContract ? (
              <label className="space-y-1 text-sm md:col-span-2" htmlFor="terms-starts-on">
                <span className="font-medium">Início da vigência</span>
                <Select
                  value={startsOn}
                  onValueChange={(newStartsOn) => {
                    setStartsOn(newStartsOn);
                    const minSetupMonth = newStartsOn.slice(0, 7);
                    setForm((previous) => {
                      if (previous.setupDueMonth && previous.setupDueMonth < minSetupMonth) {
                        return { ...previous, setupDueMonth: minSetupMonth };
                      }
                      return previous;
                    });
                  }}
                >
                  <SelectTrigger id="terms-starts-on" aria-label="Início da vigência" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={currentMonthStart()}>Este mês ({currentMonthStart()})</SelectItem>
                    <SelectItem value={nextMonthStart()}>Próximo mês ({nextMonthStart()})</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            ) : null}
            <p className="text-sm text-muted-foreground md:col-span-2">
              {isFirstContract ? (
                <>
                  Primeiro contrato inicia por padrão no mês corrente, sem cobrança retroativa.
                  {' '}Vigência selecionada: <strong>{effectiveStartsOn}</strong>.
                </>
              ) : (
                <>
                  Renegociação vale a partir do próximo mês (<strong>{effectiveStartsOn}</strong>).
                  {' '}A implantação já contratada não é cobrada de novo.
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
            <div className="space-y-2">
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
            </div>
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
                    modalidade {term.modality} · {formatScaled(term.revenue_bps_t1, 2)}% a {formatScaled(term.revenue_bps_t4, 2)}%
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

type UnitPricesProps = {
  orgId: string;
  rows: CommercialTerms[];
  onSaved: () => void;
};

/** Emenda 2026-11-08 ao ADR-0155: só os dois preços por unidade, valendo já na competência aberta.
 *  Cada entrega congela o próprio preço, então nada já apurado é reescrito. O resto do contrato
 *  continua mudando só pela renegociação (mês seguinte). */
export function UnitPricesForm({ orgId, rows, onSaved }: UnitPricesProps) {
  const today = todayInFortaleza();
  const vigente = effectiveTerm(rows, today);
  const agendada = [...rows]
    .filter((row) => row.starts_on > today)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || b.version - a.version)[0] ?? null;
  const [sonar, setSonar] = useState('');
  const [image, setImage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useSavePlatformUnitPrices();

  useEffect(() => {
    setSonar(formatScaled(vigente?.sonar_unit_cents ?? 0, 2));
    setImage(formatScaled(vigente?.image_unit_cents ?? 0, 2));
    setError(null);
  }, [vigente?.id, vigente?.sonar_unit_cents, vigente?.image_unit_cents]);

  if (!vigente) return null;
  const modalidade1 = vigente.modality === 1;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!vigente) return;
    const sonarCents = modalidade1 ? 0 : parseScaled(sonar, 2);
    const imageCents = parseScaled(image, 2);
    if (sonarCents === null || imageCents === null) {
      setError('Use valores positivos ou zero, com no máximo duas casas decimais.');
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({
        org_id: orgId,
        expected_terms_id: vigente.id,
        sonar_unit_cents: sonarCents,
        image_unit_cents: imageCents,
      });
      onSaved();
    } catch (caught) {
      const failure = caught as PlatformAdminError;
      setError(failure.code === 'conflict'
        ? 'A condição vigente mudou enquanto a tela estava aberta. Recarregue a página e confira os preços.'
        : failure instanceof Error ? failure.message : 'Não foi possível alterar os preços.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preços por unidade a partir de agora</CardTitle>
        <CardDescription>
          Vale para consultas e imagens a partir de agora, neste mês. O que já foi consumido mantém o preço da época;
          mensalidade, faixas, implantação e vencimento não mudam.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <label className="space-y-1 text-sm" htmlFor="unit-sonar">
            <span className="font-medium">Sonar por consulta</span>
            <Input
              id="unit-sonar"
              aria-label="Sonar por consulta a partir de agora"
              inputMode="decimal"
              disabled={modalidade1}
              value={modalidade1 ? '0,00' : sonar}
              onChange={(event) => setSonar(event.target.value)}
            />
            {modalidade1 && (
              <span className="text-xs text-muted-foreground">Modalidade 1: Sonar incluso, sem cobrança por consulta.</span>
            )}
          </label>
          <label className="space-y-1 text-sm" htmlFor="unit-image">
            <span className="font-medium">Imagem IA por unidade</span>
            <Input
              id="unit-image"
              aria-label="Imagem IA por unidade a partir de agora"
              inputMode="decimal"
              value={image}
              onChange={(event) => setImage(event.target.value)}
            />
          </label>
          {agendada && (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              A renegociação já agendada para <strong>{agendada.starts_on}</strong> mantém os preços dela
              {' '}(Sonar {formatScaled(agendada.sonar_unit_cents, 2)} · Imagem IA {formatScaled(agendada.image_unit_cents ?? 0, 2)}).
            </p>
          )}
          {error && <p className="text-sm text-destructive sm:col-span-2" role="alert">{error}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" variant="outline" disabled={save.isPending}>
              {save.isPending ? 'Aplicando…' : 'Aplicar a partir de agora'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
