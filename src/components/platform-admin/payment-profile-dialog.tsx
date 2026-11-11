import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { usePaymentProfile, useSavePaymentProfile } from '@/hooks/usePlatformAdmin';
import type { PixKeyType } from '@/lib/platform-admin';
import { validatePaymentProfile } from '../../../supabase/functions/_shared/platform-admin/validation';

type FormState = {
  beneficiary_name: string; document: string; bank_name: string; branch: string; account: string;
  pix_key_type: PixKeyType; pix_key: string; city: string;
};

const VAZIO: FormState = {
  beneficiary_name: '', document: '', bank_name: '', branch: '', account: '', pix_key_type: 'cnpj', pix_key: '', city: '',
};

const TIPOS_CHAVE: Array<[PixKeyType, string]> = [
  ['cnpj', 'CNPJ'], ['cpf', 'CPF'], ['email', 'E-mail'], ['phone', 'Celular'], ['random', 'Chave aleatória'],
];

const ROTULOS: Record<keyof FormState, string> = {
  beneficiary_name: 'Favorecido', document: 'Documento', bank_name: 'Banco', branch: 'Agência', account: 'Conta',
  pix_key_type: 'Tipo da chave', pix_key: 'Chave Pix', city: 'Cidade',
};

/** A validação do backend lança `TypeError('<campo> ...')`; o primeiro token diz qual campo falhou. */
function erroPorCampo(caught: unknown): { campo: keyof FormState | null; mensagem: string } {
  const bruto = caught instanceof Error ? caught.message : 'Dados inválidos';
  const campo = bruto.split(' ')[0] as keyof FormState;
  if (!(campo in ROTULOS)) return { campo: null, mensagem: bruto };
  return { campo, mensagem: bruto.replace(campo, ROTULOS[campo]) };
}

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

/** Dados de recebimento da Daludi (ADR-0193 D-9): únicos para todas as organizações. */
export function PaymentProfileDialog({ open, onOpenChange }: Props) {
  const profile = usePaymentProfile();
  const save = useSavePaymentProfile();
  const [form, setForm] = useState<FormState>(VAZIO);
  const [erro, setErro] = useState<{ campo: keyof FormState | null; mensagem: string } | null>(null);

  useEffect(() => {
    if (!open || profile.isLoading) return;
    const p = profile.data;
    setForm(p ? {
      beneficiary_name: p.beneficiary_name, document: p.document, bank_name: p.bank_name, branch: p.branch,
      account: p.account, pix_key_type: p.pix_key_type, pix_key: p.pix_key, city: p.city,
    } : VAZIO);
    setErro(null);
  }, [open, profile.isLoading, profile.data]);

  const set = (campo: keyof FormState) => (valor: string) => setForm((prev) => ({ ...prev, [campo]: valor }));

  async function salvar() {
    let validado;
    try {
      validado = validatePaymentProfile(form);
    } catch (caught) {
      setErro(erroPorCampo(caught));
      return;
    }
    setErro(null);
    try {
      await save.mutateAsync(validado);
      toast.success('Dados de recebimento salvos.');
      onOpenChange(false);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Não foi possível salvar os dados de recebimento.');
    }
  }

  function campo(chave: Exclude<keyof FormState, 'pix_key_type'>, opcoes: { inputMode?: 'numeric' | 'email' | 'tel'; dica?: string } = {}) {
    const invalido = erro?.campo === chave;
    return (
      <div className="space-y-1 text-sm">
        <label className="font-medium" htmlFor={`pay-${chave}`}>{ROTULOS[chave]}</label>
        <Input
          id={`pay-${chave}`}
          value={form[chave]}
          inputMode={opcoes.inputMode}
          autoComplete="off"
          aria-invalid={invalido || undefined}
          aria-describedby={invalido ? `pay-${chave}-erro` : undefined}
          onChange={(e) => set(chave)(e.target.value)}
        />
        {invalido
          ? <p id={`pay-${chave}-erro`} role="alert" className="text-xs text-destructive">{erro!.mensagem}</p>
          : opcoes.dica && <p className="text-xs text-muted-foreground">{opcoes.dica}</p>}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Dados de recebimento</DialogTitle>
          <DialogDescription>
            Aparecem em todos os relatórios mensais, junto do Pix com o valor exato. Vale para todas as organizações.
          </DialogDescription>
        </DialogHeader>
        {profile.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-10 rounded-md" /><Skeleton className="h-10 rounded-md" /><Skeleton className="h-10 rounded-md" /></div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">{campo('beneficiary_name', { dica: 'Até 25 caracteres sem acento (limite do Pix).' })}</div>
            {campo('document', { inputMode: 'numeric', dica: 'CPF ou CNPJ do favorecido.' })}
            {campo('city', { dica: 'Até 15 caracteres sem acento.' })}
            {campo('bank_name')}
            <div className="grid grid-cols-2 gap-3">{campo('branch', { inputMode: 'numeric' })}{campo('account')}</div>
            <div className="space-y-1 text-sm">
              <label className="font-medium" htmlFor="pay-pix_key_type">{ROTULOS.pix_key_type}</label>
              <Select value={form.pix_key_type} onValueChange={(v) => set('pix_key_type')(v)}>
                <SelectTrigger id="pay-pix_key_type" aria-label="Tipo da chave Pix" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_CHAVE.map(([valor, rotulo]) => <SelectItem key={valor} value={valor}>{rotulo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {campo('pix_key')}
          </div>
        )}
        {erro && erro.campo === null && <p role="alert" className="text-sm text-destructive">{erro.mensagem}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={save.isPending || profile.isLoading}>
            {save.isPending ? 'Salvando…' : 'Salvar dados'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
