import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { LISTA_CANAIS } from '@/lib/canais';
import { MODULOS } from '@/lib/modulos';
import { supabase } from '@/lib/supabase';

type OrgRow = {
  id: string;
  nome: string;
  slug: string;
  canais_habilitados: string[];
  modulos_habilitados: string[];
  tipo_pessoa: 'pf' | 'pj' | null;
};

async function callUsuarios(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('usuarios', { body });
  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json();
        if (typeof payload?.error === 'string') message = payload.error;
      } catch {
        // Mantém a mensagem original quando o corpo não é JSON.
      }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Sucesso e erro nunca dividem o mesmo slot: cada card guarda o próprio estado, "✓ Salvo" some
// sozinho em 3s, erro fica preso no card que falhou até a próxima tentativa.
export function OrgSettings({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [channels, setChannels] = useState<Set<string>>(new Set(['mercado_livre']));
  const [modules, setModules] = useState<Set<string>>(new Set());
  const [personType, setPersonType] = useState<'pf' | 'pj'>('pf');
  const [saving, setSaving] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const organizations = useQuery({
    queryKey: ['organizacoes'],
    queryFn: async (): Promise<OrgRow[]> => {
      const data = await callUsuarios({ action: 'list_orgs' });
      return (data?.orgs ?? []) as OrgRow[];
    },
  });
  const org = organizations.data?.find((item) => item.id === orgId) ?? null;

  useEffect(() => {
    if (!org) return;
    setChannels(new Set(org.canais_habilitados ?? ['mercado_livre']));
    setModules(new Set(org.modulos_habilitados ?? []));
    setPersonType(org.tipo_pessoa ?? 'pf');
  }, [org]);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  async function run(key: string, action: () => Promise<unknown>, successMessage: string) {
    setSaving(key);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['organizacoes'] });
      toast.success(`✓ ${successMessage}`);
      setSavedKey(key);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedKey(null), 3000);
    } catch (caught) {
      setError({ key, message: caught instanceof Error ? caught.message : 'Não foi possível salvar a configuração.' });
    } finally {
      setSaving(null);
    }
  }

  function cardFooter(key: string) {
    return (
      <div className="flex items-center gap-3">
        {savedKey === key && <span role="status" className="text-xs text-success">✓ Salvo</span>}
      </div>
    );
  }

  if (organizations.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }
  if (organizations.isError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
        Não foi possível carregar as configurações.{' '}
        <Button variant="outline" size="sm" onClick={() => organizations.refetch()}>Tentar novamente</Button>
      </div>
    );
  }
  if (!org) {
    return <p className="text-sm text-destructive" role="alert">Organização não encontrada.</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Cadastro</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1 text-sm">
            <span id="org-person-type-label" className="font-medium">Tipo de pessoa</span>
            <Select value={personType} onValueChange={(value) => setPersonType(value as 'pf' | 'pj')}>
              <SelectTrigger aria-labelledby="org-person-type-label" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pf">Pessoa física</SelectItem>
                <SelectItem value="pj">Pessoa jurídica</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error?.key === 'person' && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error.message}</p>
          )}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => run(
                'person',
                () => callUsuarios({ action: 'set_tipo_pessoa_org', org_id: orgId, tipo_pessoa: personType }),
                'Tipo de pessoa atualizado.',
              )}
              disabled={saving === 'person'}
            >
              Salvar cadastro
            </Button>
            {cardFooter('person')}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Canais</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {LISTA_CANAIS.map((channel) => (
              <label key={channel.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={channels.has(channel.id)}
                  disabled={channel.id === 'mercado_livre'}
                  onCheckedChange={(checked) => setChannels((previous) => {
                    const next = new Set(previous);
                    if (checked === true) next.add(channel.id); else next.delete(channel.id);
                    return next;
                  })}
                />
                {channel.nome}
              </label>
            ))}
          </div>
          {error?.key === 'channels' && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error.message}</p>
          )}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => run(
                'channels',
                () => callUsuarios({ action: 'set_canais_org', org_id: orgId, canais: [...channels] }),
                'Canais atualizados.',
              )}
              disabled={saving === 'channels'}
            >
              Salvar canais
            </Button>
            {cardFooter('channels')}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Módulos</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {MODULOS.map((module) => (
              <label key={module.id} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={modules.has(module.id)}
                  onCheckedChange={(checked) => setModules((previous) => {
                    const next = new Set(previous);
                    if (checked === true) next.add(module.id); else next.delete(module.id);
                    return next;
                  })}
                />
                <span>{module.nome}<span className="block text-xs text-muted-foreground">{module.descricao}</span></span>
              </label>
            ))}
          </div>
          {error?.key === 'modules' && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error.message}</p>
          )}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => run(
                'modules',
                () => callUsuarios({ action: 'set_modulos_org', org_id: orgId, modulos: [...modules] }),
                'Módulos atualizados.',
              )}
              disabled={saving === 'modules'}
            >
              Salvar módulos
            </Button>
            {cardFooter('modules')}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
