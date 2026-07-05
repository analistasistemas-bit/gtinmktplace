import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface OrgRow {
  id: string;
  nome: string;
  slug: string;
  membros: number;
  criado_em: string;
}

async function callUsuarios(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('usuarios', { body });
  if (error) {
    // Em respostas não-2xx o invoke não popula `data`; a mensagem real está no corpo (error.context).
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      } catch {
        /* mantém error.message */
      }
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function Organizacoes() {
  const qc = useQueryClient();
  const [novaOpen, setNovaOpen] = useState(false);

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['organizacoes'],
    queryFn: async (): Promise<OrgRow[]> => {
      const data = await callUsuarios({ action: 'list_orgs' });
      return (data?.orgs ?? []) as OrgRow[];
    },
  });

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <PageHeader
        title="Organizações"
        subtitle="Empresas que usam o PubliAI (visão exclusiva de super-admin)."
        actions={<Button onClick={() => setNovaOpen(true)}>Nova empresa</Button>}
      />

      <Card className="mt-4 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Membros</TableHead>
              <TableHead>Criada em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
            ) : orgs.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.nome}</TableCell>
                <TableCell className="text-muted-foreground">{o.slug}</TableCell>
                <TableCell>{o.membros}</TableCell>
                <TableCell>{new Date(o.criado_em).toLocaleDateString('pt-BR')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <NovaOrgDialog
        open={novaOpen}
        onOpenChange={setNovaOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ['organizacoes'] })}
      />
    </div>
  );
}

function NovaOrgDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [marcaPadrao, setMarcaPadrao] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminNome, setAdminNome] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function criar() {
    setEnviando(true);
    try {
      await callUsuarios({
        action: 'create_org',
        nome,
        slug,
        marca_padrao: marcaPadrao,
        admin_email: adminEmail,
        admin_nome: adminNome,
      });
      toast.success('✓ Empresa criada');
      setNome(''); setSlug(''); setMarcaPadrao(''); setAdminEmail(''); setAdminNome('');
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar empresa');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova empresa</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Input placeholder="Nome da empresa" value={nome} onChange={(e) => setNome(e.target.value)} />
          <Input placeholder="Slug (ex.: minha-empresa)" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <Input placeholder="Marca padrão (ex.: MinhaMarca)" value={marcaPadrao} onChange={(e) => setMarcaPadrao(e.target.value)} />
          <Input type="email" placeholder="E-mail do primeiro admin" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
          <Input placeholder="Nome do primeiro admin" value={adminNome} onChange={(e) => setAdminNome(e.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={criar} disabled={!nome || !slug || !adminEmail || enviando}>
            {enviando ? 'Criando…' : 'Criar empresa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
