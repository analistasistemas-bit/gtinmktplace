import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { LISTA_CANAIS } from '@/lib/canais';
import { MODULOS } from '@/lib/modulos';
import { supabase } from '@/lib/supabase';
import {
  cancelSupport,
  listSupportRequests,
  requestSupport,
  type SupportRequest,
  type SupportScope,
} from '@/lib/suporte';
import { useSupportStore } from '@/stores/support-store';

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

const supportStatus = (status: SupportRequest['status']) => ({
  pending: 'Aguardando aprovação',
  approved: 'Aprovada',
  active: 'Acesso ativo',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
  expired: 'Expirada',
  revoked: 'Revogada',
  ended: 'Encerrada',
})[status];

export function OrgSettings({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const startSupport = useSupportStore((state) => state.start);
  const [channels, setChannels] = useState<Set<string>>(new Set(['mercado_livre']));
  const [modules, setModules] = useState<Set<string>>(new Set());
  const [personType, setPersonType] = useState<'pf' | 'pj'>('pf');
  const [scope, setScope] = useState<SupportScope>('read');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const organizations = useQuery({
    queryKey: ['organizacoes'],
    queryFn: async (): Promise<OrgRow[]> => {
      const data = await callUsuarios({ action: 'list_orgs' });
      return (data?.orgs ?? []) as OrgRow[];
    },
  });
  const org = organizations.data?.find((item) => item.id === orgId) ?? null;

  const support = useQuery({
    queryKey: ['support-requests', orgId],
    queryFn: () => listSupportRequests({ orgId, page: 1, pageSize: 50, status: 'actionable' }),
    enabled: Boolean(orgId),
  });
  const request = support.data?.requests[0] ?? null;

  useEffect(() => {
    if (!org) return;
    setChannels(new Set(org.canais_habilitados ?? ['mercado_livre']));
    setModules(new Set(org.modulos_habilitados ?? []));
    setPersonType(org.tipo_pessoa ?? 'pf');
  }, [org]);

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setSaving(key);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['organizacoes'] });
      setError(success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar a configuração.');
    } finally {
      setSaving(null);
    }
  }

  async function sendSupportRequest() {
    if (!reason.trim()) {
      setError('Informe o motivo do acesso.');
      return;
    }
    await run(
      'support',
      () => requestSupport({ orgId, scope, reason: reason.trim() }),
      'Solicitação de suporte enviada.',
    );
    setReason('');
    await queryClient.invalidateQueries({ queryKey: ['support-requests', orgId] });
  }

  async function cancelRequest() {
    if (!request) return;
    await run('support', () => cancelSupport(request.id), 'Solicitação cancelada.');
    await queryClient.invalidateQueries({ queryKey: ['support-requests', orgId] });
  }

  async function enterOperation() {
    if (!request) return;
    setSaving('support');
    setError(null);
    try {
      await startSupport(request.id);
      navigate('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível iniciar o suporte.');
      await queryClient.invalidateQueries({ queryKey: ['support-requests', orgId] });
    } finally {
      setSaving(null);
    }
  }

  if (organizations.isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando configurações…</p>;
  }
  if (!org) {
    return <p className="text-sm text-destructive" role="alert">Organização não encontrada.</p>;
  }

  const canStart = request?.status === 'approved'
    && Boolean(request.approval_expires_at)
    && new Date(request.approval_expires_at!).getTime() > Date.now();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Cadastro</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Tipo de pessoa</span>
            <select
              aria-label="Tipo de pessoa"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3"
              value={personType}
              onChange={(event) => setPersonType(event.target.value as 'pf' | 'pj')}
            >
              <option value="pf">Pessoa física</option>
              <option value="pj">Pessoa jurídica</option>
            </select>
          </label>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Suporte operacional</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {request && <p className="text-sm">{supportStatus(request.status)} · {request.scope === 'read' ? 'Somente leitura' : 'Acesso total'}</p>}
          {request?.status === 'pending' ? (
            <Button variant="outline" onClick={cancelRequest} disabled={saving === 'support'}>
              Cancelar solicitação
            </Button>
          ) : canStart ? (
            <Button onClick={enterOperation} disabled={saving === 'support'}>Entrar na operação</Button>
          ) : !request || !['pending', 'active'].includes(request.status) ? (
            <>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Escopo do acesso</span>
                <select
                  aria-label="Escopo do acesso"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3"
                  value={scope}
                  onChange={(event) => setScope(event.target.value as SupportScope)}
                >
                  <option value="read">Somente leitura</option>
                  <option value="full">Acesso total</option>
                </select>
              </label>
              <label className="block space-y-1 text-sm" htmlFor="support-reason">
                <span className="font-medium">Motivo do acesso</span>
                <Input id="support-reason" aria-label="Motivo do acesso" value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <Button onClick={sendSupportRequest} disabled={saving === 'support'}>Solicitar acesso</Button>
            </>
          ) : null}
        </CardContent>
      </Card>

      {error && <p role="status" className="text-sm lg:col-span-2">{error}</p>}
    </div>
  );
}
