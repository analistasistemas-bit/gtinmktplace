import { Link } from 'react-router-dom';
import { LogOut, Bell } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { signOut } from '@/lib/auth';
import { usePerguntasNaoRespondidas } from '@/hooks/usePerguntas';
import { useMensagensAguardando } from '@/hooks/useMensagens';

function iniciais(email: string | undefined): string {
  if (!email) return '?';
  return email.split('@')[0].slice(0, 2).toUpperCase();
}

export function UserMenu() {
  const { user } = useAuth();
  // Aguardando resposta = perguntas sem resposta + conversas cuja última mensagem é do comprador
  // (ADR-0067). Fica aceso no avatar em qualquer tela até você responder (no PubliAI ou no ML).
  const { data: perguntas } = usePerguntasNaoRespondidas();
  const mensagens = useMensagensAguardando();
  const pendentes = (perguntas ?? 0) + mensagens;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-full" aria-label={pendentes > 0 ? `Menu do usuário (${pendentes} aguardando resposta)` : 'Menu do usuário'}>
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-xs">{iniciais(user?.email)}</AvatarFallback>
          </Avatar>
          {pendentes > 0 && (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {pendentes > 9 ? '9+' : pendentes}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {user?.email ?? 'Sessão'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {pendentes > 0 && (
          <>
            <DropdownMenuItem asChild>
              <Link to={(perguntas ?? 0) > 0 ? '/faturamento?aba=perguntas' : '/faturamento?aba=mensagens'}>
                <Bell className="mr-2 h-4 w-4 text-warning" />
                {pendentes} aguardando resposta
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => signOut()}>
          <LogOut className="mr-2 h-4 w-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
