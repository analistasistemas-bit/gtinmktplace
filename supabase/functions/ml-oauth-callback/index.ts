// Redirect do OAuth do ML. Público (config.toml, verify_jwt=false) — é o redirect_uri
// registrado no ML, então não há como exigir JWT aqui.
//
// ADR-0091: esta function NÃO grava mais a conexão e NÃO troca mais o `code` por token. O
// `state` sozinho nunca provou quem está completando o fluxo — um admin de qualquer org podia
// gerar a authUrl, mandar para um vendedor e receber os tokens DELE na org do atacante. Agora o
// callback só guarda o `code` (inerte sem o ML_CLIENT_SECRET) sob um id de uso único e devolve
// esse id para o front; quem grava é o `ml-oauth-claim`, autenticado, usando a org da SESSÃO.
import { redisGetDel, redisSet } from '../_shared/redis/client.ts';

const FRONTEND = 'https://ean2marketplace-frontend.onrender.com/#/configuracoes';

// 300s: folga para um login rápido no meio do caminho, e conservador o bastante para caber em
// qualquer prazo plausível do `code` do ML (não documentado publicamente — ver ADR-0091).
// Invariante: TTL do claim <= TTL do code do ML.
const CLAIM_TTL_S = 300;

function redirect(query: string): Response {
  return new Response(null, { status: 302, headers: { Location: `${FRONTEND}?${query}` } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) return redirect('ml_erro=state');

  // Consumo atômico: GET-depois-DEL deixaria duas requisições concorrentes lerem o mesmo state.
  const raw = await redisGetDel(`oauth:ml:state:${state}`);
  if (!raw) return redirect('ml_erro=state');

  let stateOrgId: string;
  try {
    const parsed = JSON.parse(raw) as { user_id: string; org_id: string };
    if (!parsed.user_id || !parsed.org_id) throw new Error('state incompleto');
    stateOrgId = parsed.org_id;
  } catch {
    return redirect('ml_erro=state');
  }

  try {
    const claimId = crypto.randomUUID();
    await redisSet(`oauth:ml:claim:${claimId}`, JSON.stringify({ code }), CLAIM_TTL_S);

    // Tripwire (ADR-0091): o org do state é só log — NÃO vai para o registro do claim, para que
    // um valor escolhido pelo atacante nunca fique a um `if` do caminho de escrita. Uma
    // investigação junta esta linha com a do claim pelo claim_id. Nunca logar o `code`.
    console.log(`ml-oauth-callback: claim emitido ${claimId} (state_org_id=${stateOrgId})`);

    return redirect(`ml_claim=${claimId}`);
  } catch (e) {
    console.error('ml-oauth-callback erro:', e instanceof Error ? e.message : String(e));
    return redirect('ml_erro=token');
  }
});
