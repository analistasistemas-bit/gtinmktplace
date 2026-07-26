# ADR-0092: Identidade da plataforma separada das organizações clientes

**Status:** Aceito
**Data:** 2026-07-25
**Decisores:** Diego
**Refina:** ADR-0027 (multi-tenancy)

## Contexto

Daludi desenvolve e administra o PubliAI, mas não usa sua operação de marketplace.
Avil foi o primeiro cliente implantado. O usuário de Diego, criado durante essa
implantação, pertence à organização Avil e também tem `is_super_admin = true`.

O modelo atual exige `profiles.org_id not null` e a interface traduz
`profile.org_id === organization.id` como “sua empresa”. Isso confunde três relações:

1. Daludi é proprietária e administradora da plataforma;
2. Avil é uma organização cliente;
3. Diego administra a plataforma e também pode precisar prestar suporte à Avil.

Daludi não deve ser criada como organização cliente fictícia: não possui operação,
conexão de marketplace nem dados de tenant.

## Decisões confirmadas

1. **Daludi é a operadora da plataforma, não uma organização cliente.**
2. A lista de organizações do painel contém somente tenants/clientes. Daludi deve
   aparecer na identidade institucional do painel, não como uma linha nessa lista.
3. O papel de administração da plataforma não significa propriedade da organização
   à qual o usuário está associado.
4. `analistasistemas@gmail.com` permanece como usuário operacional da **Avil** e perde
   `is_super_admin`.
5. Será criada uma identidade exclusiva de administração da plataforma:
   **Diego Souza (`diego@daludi.com.br`)**.
6. A identidade Daludi não pertence permanentemente a nenhuma organização cliente e
   não tem acesso operacional por padrão. Acesso a cliente existe somente em contexto
   excepcional de suporte.
7. O acesso de suporte começa pela tela **Organizações**, escolhendo explicitamente o
   cliente.
8. **Nenhum acesso aos dados operacionais de uma organização cliente é permitido sem
   autorização prévia**, inclusive em modo somente leitura.
9. Ao solicitar entrada, o super-admin escolhe e declara um dos escopos:
   **somente leitura** ou **acesso total**, sempre informando o motivo.
10. Qualquer usuário `is_admin` ativo da organização pode aprovar ou rejeitar a
    solicitação. Antes da aprovação, o super-admin enxerga somente os metadados
    administrativos necessários no painel da plataforma, nunca a operação do cliente.
11. Sem autorização vigente, as proteções de backend bloqueiam leitura e escrita dos
    dados operacionais, independentemente do que a interface apresente.
12. Toda autorização, tanto somente leitura quanto acesso total, vale por no máximo
    **2 horas**.
13. A autorização termina antecipadamente quando o super-admin sai da operação e pode
    ser revogada a qualquer momento por qualquer admin ativo do cliente.
14. Toda solicitação de suporte gera notificação **in-app** e por **e-mail** para
    todos os admins ativos do cliente.
15. O primeiro admin que aprovar ou rejeitar resolve a solicitação para todos; decisões
    posteriores sobre a mesma solicitação são bloqueadas.
16. Faltando 15 minutos para expirar, o super-admin pode solicitar renovação por mais
    2 horas, informando o motivo. A renovação exige nova aprovação e nunca é automática.
17. Se a renovação não for aprovada a tempo, se o super-admin sair ou se um admin
    revogar, a sessão termina imediatamente. Operações já concluídas não são desfeitas;
    todo novo acesso operacional é bloqueado pelo backend.
18. Durante a vigência, os admins do cliente veem quem possui acesso, seu escopo, o
    horário de expiração e a ação **Revogar acesso**.
19. A organização **DSA** (`diego-souza`) não representa a Daludi. É um tenant de teste
    operacional conectado à conta particular de Diego no Mercado Livre.
20. Estado verificado em produção em 2026-07-25:
    - `analistasistemas@icloud.com` é admin ativo da DSA e não é super-admin;
    - `michael.ti@grupoavil.com.br` e `samuel.ti@grupoavil.com.br` são admins ativos da
      Avil;
    - portanto, Avil e DSA já possuem administração operacional independente da nova
      identidade Daludi.
21. A DSA será preservada permanentemente como ambiente de testes operacionais,
    administrada por `analistasistemas@icloud.com`, e deve ser identificada visualmente
    como **Teste** no painel da plataforma.
22. A auditoria registra:
    - início e fim da sessão de leitura e organização acessada;
    - motivo informado;
    - solicitação, aprovação, rejeição, renovação, expiração e revogação;
    - identidade dos envolvidos e horários;
    - durante acesso total, ação executada, tipo e ID do alvo, resultado ou erro.
23. O log não copia senhas, tokens, planilhas, payloads integrais nem outros segredos.
24. Admins ativos do cliente acessam o **Histórico de suporte** somente da própria
    organização.
25. O histórico tem retenção normal de **1 ano** e é excluído automaticamente depois
    desse prazo. Registros formalmente associados a uma investigação em andamento
    podem receber bloqueio de exclusão até o encerramento.
26. `profiles.org_id` passa a aceitar `null`, com restrição no banco garantindo dois
    estados mutuamente exclusivos:
    - super-admin ativo: `is_super_admin = true` e `org_id is null`;
    - membro de cliente: `is_super_admin = false` e `org_id is not null`.
27. O contexto temporário de suporte é registrado separadamente e nunca altera
    `profiles.org_id`.
28. Sem autorização de suporte vigente, `current_org_id()` permanece `null` para a
    identidade Daludi e as políticas de RLS negam naturalmente os dados operacionais.
29. Cada super-admin pode manter no máximo **uma sessão de suporte ativa**. Pedidos
    pendentes podem existir para organizações diferentes, mas entrar em outra operação
    exige encerrar explicitamente a sessão atual.
30. Durante a sessão, o cabeçalho mostra permanentemente organização, escopo e tempo
    restante, reduzindo o risco de agir no tenant errado.
31. **Acesso total** equivale às permissões operacionais de um admin do cliente, mas
    não autoriza o suporte a:
    - excluir a organização;
    - criar, excluir, ativar ou desativar usuários;
    - promover ou remover administradores;
    - aprovar a própria solicitação;
    - alterar cobrança ou titularidade;
    - transferir conexões de marketplace entre organizações.
32. As proibições são verificadas no backend. Ações operacionais destrutivas que forem
    permitidas continuam sujeitas às confirmações normais da interface.
33. Migração da identidade principal:
    1. aplicar o novo modelo e o fluxo de suporte;
    2. criar `diego@daludi.com.br` como super-admin sem organização;
    3. concluir convite, senha e verificação do e-mail;
    4. validar login no painel e solicitação de suporte;
    5. somente então remover `is_super_admin` de `analistasistemas@gmail.com`, mantendo
       essa conta como admin operacional da Avil.
34. A janela temporária com dois super-admins é permitida apenas durante essa migração
    e deve ficar registrada na auditoria da plataforma.
35. O link enviado por e-mail não aprova nem rejeita diretamente. Ele abre a
    solicitação no PubliAI e exige login.
36. No momento da decisão, o backend confirma que o usuário continua ativo, é admin e
    pertence à organização solicitada. A tela exibe solicitante, motivo, escopo e
    duração e exige confirmação explícita.
37. Link de solicitação respondida, cancelada ou expirada é inválido.
38. Solicitação pendente expira após **24 horas** e pode ser cancelada pelo solicitante.
39. Pode existir no máximo uma solicitação pendente por super-admin e organização.
    Alterar motivo ou escopo exige cancelar a anterior e criar outra.
40. A janela de 2 horas começa no início efetivo da sessão autorizada, não na criação
    da solicitação.
41. Uma aprovação ainda não utilizada expira após **1 hora**. Se a sessão começar
    dentro dessa janela, recebe suas próprias 2 horas completas; caso contrário, uma
    nova solicitação é necessária.
42. Ao autenticar, uma identidade sem `org_id` abre diretamente o **Admin da
    plataforma**, sem menus operacionais.
43. Na tela Organizações, cada cliente exibe **Solicitar acesso**, estado e escopo do
    pedido e, após aprovação, **Entrar na operação**.
44. Durante a sessão, **Encerrar suporte** retorna ao Admin da plataforma e encerra
    imediatamente a autorização em uso.

## Direção do modelo

O modelo atual (`profiles.org_id not null`) não representa a decisão acima. O desenho
deve admitir dois tipos mutuamente exclusivos de identidade:

- **membro de organização:** possui `org_id`, opera somente aquele tenant e pode ser
  admin da organização;
- **administrador da plataforma:** possui `is_super_admin = true`, não possui `org_id`
  permanente e acessa o painel institucional da Daludi.

Não basta transferir `is_super_admin` entre os usuários: isso deixaria a nova conta
Daludi artificialmente vinculada a Avil ou a outro cliente.

## Alternativas descartadas

- **Criar uma organização Daludi:** modelaria a proprietária como cliente sem operação.
- **Manter o super-admin associado à Avil:** perpetuaria a confusão com o primeiro cliente.
- **Permitir leitura sem autorização:** daria acesso unilateral aos dados do cliente.
- **Criar outra estrutura completa de usuários:** duplicaria autenticação e perfil sem
  necessidade atual; a restrição de estados em `profiles` entrega o isolamento.

## Fluxo de suporte — rascunho

1. Super-admin abre **Organizações**, escolhe **Solicitar acesso** e informa motivo e
   escopo: somente leitura ou acesso total.
2. Todos os admins ativos recebem notificação in-app e e-mail; o primeiro a responder
   aprova ou rejeita para todos.
3. Antes da aprovação, nenhum dado operacional da organização é liberado.
4. Após aprovação, o sistema cria uma sessão auditável no escopo concedido e exibe um
   aviso persistente dentro da operação.
5. No escopo somente leitura, o backend bloqueia toda mutação. No acesso total, aceita
   mutações durante a vigência concedida. Ambos expiram em até 2 horas.
6. Saída da operação, expiração ou revogação por qualquer admin encerra a sessão;
   autorização e auditoria permanecem registradas.
7. Se necessário, o super-admin solicita renovação nos 15 minutos finais. A renovação
   exige nova aprovação e nunca acontece automaticamente.

## Critérios de aceite

1. `diego@daludi.com.br` autentica sem `org_id` e abre somente o Admin da plataforma.
2. `analistasistemas@gmail.com` permanece admin da Avil e deixa de ser super-admin.
3. DSA permanece operacional com `analistasistemas@icloud.com` e aparece como Teste.
4. Super-admin não lê nem altera dados operacionais sem autorização vigente.
5. Solicitações distinguem leitura e acesso total, notificam os admins e expiram em 24h.
6. Aprovação exige admin autenticado da organização, deve ser usada em 1h e abre sessão
   de até 2h.
7. Leitura bloqueia mutações; acesso total respeita as exclusões administrativas.
8. Saída, expiração ou revogação encerram o acesso imediatamente.
9. Auditoria registra ciclo e mutações, fica visível ao cliente e tem retenção de 1 ano.
10. Testes automatizados comprovam isolamento, transições e bloqueios de escopo.
