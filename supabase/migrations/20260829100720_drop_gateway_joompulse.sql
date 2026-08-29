-- Desfaz o Gateway JoomPulse (ADR-0132, substituído).
--
-- Motivo: a JoomPulse passou a cobrar pelo `client_id` OAuth, e sem ele nenhum login é possível
-- (medido: o provedor recusa o cliente antes de resolver o Client ID Metadata Document —
-- Errata 5 da ADR-0132). O épico foi abortado e a inteligência de mercado passa a ser própria,
-- sobre Apify + API do ML (Spikes 043 e 044).
--
-- Segurança do drop: as duas tabelas foram criadas em 29/08 e **nenhum login jamais completou**.
-- Contagem verificada imediatamente antes desta migration: 0 linhas em cada uma. Não há dado de
-- organização a preservar, e nenhuma credencial cifrada foi gravada.
--
-- `pulse_vendedores`, `sonar_snapshots` e `pulse_ofertas` NÃO são tocadas: são fonte própria
-- (Apify e API do ML), nunca dependeram da JoomPulse, e sustentam o caminho que substitui o dela.

drop table if exists public.joompulse_oauth_estados;
drop table if exists public.joompulse_credenciais;
