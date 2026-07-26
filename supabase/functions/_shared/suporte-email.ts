type EmailInput = { to: string; subject: string; text: string; appUrl: string };

function env(name: string): string | undefined {
  return (typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined)
    ?? (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.[name]
    ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

export async function enviarEmailSuporte({ to, subject, text, appUrl }: EmailInput): Promise<void> {
  const apiKey = env('RESEND_API_KEY');
  const from = env('SUPPORT_EMAIL_FROM');
  if (!apiKey || !from) throw new Error('configuração de e-mail de suporte ausente');
  const url = `${appUrl.replace(/\/$/, '')}/#/admin/suporte`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text: `${text}\n\n${url}`, html: `<p>${text}</p><p><a href="${url}">Abrir suporte</a></p>` }),
  });
  if (!response.ok) throw new Error('falha ao enviar e-mail de suporte');
}
