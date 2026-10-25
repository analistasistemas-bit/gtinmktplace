# Extensão PubliAI — login próprio, ligar/desligar e ícone no cabeçalho do ML

**Data:** 2026-10-24 · **Decisor:** Diego · **Relaciona:** ADR-0189 (emenda D-4, D-14, D-16)

## Intenção

Hoje a extensão só funciona com o PubliAI web aberto numa aba: o app é o único dono da sessão e empurra o access token
para a extensão (ADR-0189 D-4). Diego não quer depender disso. Quer usar a extensão como usa o Avant Pro: entrar uma
vez pela própria extensão, ficar logado, e ter no cabeçalho do Mercado Livre um ícone do PubliAI com um menu para ligar,
desligar e sair.

Sucesso = Diego abre o Chrome, vai ao ML e vê os selos sem ter aberto o PubliAI; desliga pelo ícone e tudo some.

## Decisões do Diego (24/10)

1. **Login direto na extensão**, com o mesmo e-mail e senha do app (o app só tem `signInWithPassword`, `src/lib/auth.ts`).
2. **Fica logada até clicar em "Sair"**, mesmo fechando e reabrindo o Chrome.
3. **Chave "Extensão ativa"**: desligada, somem selos (anúncio e busca) e o contorno das fotos; o ícone do cabeçalho
   continua, cinza, para religar. Vale para o Chrome inteiro e persiste.
4. **Ícone do PubliAI no cabeçalho do ML**, ao lado do carrinho (como o "A" do Avant), com menu (mockups aprovados):
   - Logado: nome e organização no topo; chave "Extensão ativa"; "Abrir painel de análise"; "Abrir o PubliAI" (nova aba);
     "Sair" (vermelho); versão no rodapé. Ponto verde no ícone.
   - Deslogado: "Entrar no PubliAI · use o mesmo e-mail e senha do app" e botão "Entrar", que **abre o painel lateral**
     com os campos E-mail e Senha (decisão do Diego, 24/10: senha nunca é digitada na página do ML, onde os scripts dela
     capturariam as teclas). Ponto laranja.
   - Desativada: ícone cinza; chave desligada; "Selos e análises pausados"; "Sair".

## Não-objetivos

- Outros métodos de login (Google, magic link, MFA): o app não tem.
- Itens do Avant sem equivalente aqui (conteúdo, atualizações, suporte por WhatsApp, sobre nós).
- Mudar a análise em si (margem, catálogo, busca, radar seguem como estão).

## Anti-objetivos (falha mesmo funcionando)

- Senha ou refresh token legíveis por scripts do Mercado Livre ou de outras extensões.
- Sessão da extensão derrubar a sessão do app (ou vice-versa).
- Dado de uma organização aparecer depois de trocar de organização/suporte ou de sair.
- Ícone quebrar ou empurrar o layout do cabeçalho do ML.

## Restrições

- MV3: o service worker morre ocioso; não há timer confiável para renovar a sessão em segundo plano.
- Refresh token do Supabase é rotativo: renovações concorrentes com o mesmo token arriscam derrubar a sessão (o Supabase
  tolera alguma reutilização e o token pai, mas o design não conta com isso).
- Permissões atuais bastam (`storage`, `alarms`, `sidePanel`, `https://*.mercadolivre.com.br/*`); nenhuma permissão
  nova (evita novo aviso na Web Store).
- Nada de `<all_urls>`, iframe, interceptação de fetch (D-14 continua).

## Como (partes decididas)

- **Sessão própria da extensão.** Login cria uma sessão Supabase independente (refresh token próprio). App e extensão
  deixam de compartilhar sessão; a ponte app → extensão (`externally_connectable`, `publiai:sessao`) deixa de ser fonte
  de sessão. Persistência em `chrome.storage.local` (sobrevive ao fechar o Chrome), acessível só a contextos da extensão.
- **Renovação sob demanda e serializada.** Antes de cada chamada à edge, se o access token vence em ≤ 30 s, o SW renova
  com o refresh token, numa fila única (já existe `naFila` em `sessao.ts`); falha definitiva da renovação = deslogado.
- **Sair** revoga a sessão no Supabase, apaga o armazenamento e limpa as abas (`limparEstadosDasAbas`).
- **Troca de organização / suporte** passa a ser descoberta pelo servidor: a edge devolve a identidade efetiva
  (usuário:org:suporte) em cada resposta; o SW compara com a guardada e, se mudou, limpa as abas antes de aceitar.
- **Ligar/desligar** é uma preferência em `chrome.storage.local` (padrão: ativa). Content scripts escutam a mudança:
  desligada → removem selos e contornos e não pedem análise; SW recusa análise; painel mostra "Extensão desativada"
  com botão para religar.
- **Ícone no cabeçalho**: content script novo nas páginas listadas em "Páginas do ícone" (abaixo), elemento em shadow DOM
  fechado ao lado do carrinho; sem lugar seguro no cabeçalho, não injeta (e registra erro de leitura deduplicado).
  "Abrir painel de análise" usa o mesmo caminho do selo (`publiai:abrir-painel`, gesto do usuário).
- **ADR-0189**: emenda antes do código (D-4 sessão própria, D-14 externally_connectable, D-16 ícone no cabeçalho).
- **Versão 0.3.0** + nova submissão à Web Store.

## Decisões do arquiteto (revisão do construtor, 24/10)

- **Política de sessão verificada:** produção não tem sessão única nem limite de tempo (`auth.sessions`: mesmo usuário com
  sessões simultâneas Windows/Android, uma criada em 03/07 e renovada até 23/10; nenhuma com `not_after`). Sessão própria
  da extensão não derruba a do app.
- **Quem sou eu:** ação nova `sessao` na edge `extensao` devolve `{ nome: profiles.nome, email, orgNome:
  organizations.nome da org efetiva, identidade: 'usuário:org:suporte' }`; o SW chama após o login e a cada abertura do
  menu/painel. Toda resposta da edge (inclusive erro) leva `identidade`; o SW limpa as abas se ela mudar antes de aceitar
  o dado. Exige deploy da edge `extensao`.
- **Páginas do ícone:** `www.mercadolivre.com.br`, `lista.mercadolivre.com.br` e `produto.mercadolivre.com.br`, exceto
  caminhos de checkout, login e verificação (`/checkout`, `/gz/`, `/jms/`, `/captcha/`); fora: `myaccount.`, `vendedores.`.
- **Ponte do app:** deixa de enviar sessão e `publiai:desconectar` (sessões independentes; sair do app não sai da
  extensão). `externally_connectable` fica só para um `publiai:ping` que alimenta "Instalada" em Configurações; a tela
  troca "Conectada/Reconectar" por "Entre pela extensão com o seu e-mail e senha". `VITE_EXTENSAO_ID` continua.
- **Chave ativa sem login:** só existe logado. Deslogado não há selo (não há análise) e o menu mostra apenas "Entrar".

## Requisitos da revisão Codex (gpt-6.1-sol high, 24/10 — REVISE, 10 achados, todos incorporados por decisão do Diego)

1. **Credenciais isoladas.** `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` no boot do SW,
   antes de gravar qualquer token; só o SW lê/grava credenciais. A preferência "ativa" chega aos content scripts por
   mensagem do SW (não por leitura direta do storage). Senha nunca é persistida (só trafega painel → SW → Supabase).
   Risco residual documentado: quem tem acesso ao perfil/disco do Chrome lê o refresh token.
2. **Renovação com dono único.** Só o SW renova (o painel nunca instancia cliente com auto-refresh). Par
   access/refresh/expiração gravado num único `set`, relido dentro da fila antes de decidir. Rede, 429 e 5xx preservam
   as credenciais (nova tentativa na próxima chamada); só erro definitivo do Supabase (refresh inválido/revogado) desloga.
   Cobrir "SW morre entre receber o par novo e gravar": na próxima chamada, refresh antigo rejeitado → deslogado com
   aviso claro (aceito; nunca loop).
3. **Sair = só esta sessão.** `POST /auth/v1/logout?scope=local`. Limpeza local (credenciais, abas, selos, geração) é
   imediata e não espera a rede; offline, sai localmente e não promete revogação confirmada. Teste: o JWT anterior,
   após o logout, é recusado pela edge (`getUser`). Logout do app não manda nada à extensão (independência nos dois sentidos).
4. **Identidade esperada antes da operação.** Toda chamada à edge leva `identidadeEsperada` (a da sessão guardada); a
   edge resolve a identidade efetiva (`requireUserOrg`) e, se divergir, responde `identidade_mudou` **sem executar nada**
   (inclusive `salvar_vinculo`/`remover_vinculo`/`adicionar_radar`). O SW então busca `sessao`, limpa as abas, sobe a
   geração e mostra a org nova. Dado exibido vence: estado de aba com mais de 10 min é revalidado ao abrir o painel.
5. **Geração da sessão.** Contador persistido que sobe em login, logout, troca de identidade e pausa; toda requisição
   leva a geração de quando começou, e resposta, gravação ou mensagem com geração antiga é descartada (inclusive estado
   React do painel e simulações em voo). Reaproveita `GERACAO_SESSAO` de `abas.ts`.
6. **Contrato da edge.** Respostas ganham `identidade` quando a autenticação passou; antes dela (401 do gateway, sessão
   expirada) não há identidade e o SW trata como "deslogado" (conservador). Corpos atuais mantidos para a 0.2.1 (campos
   só acrescentados; `identidadeEsperada` opcional na entrada). Ação `sessao`: validada no `validarPedido`, não consome a
   cota de 30/min, não registra uso; perfil inativo ou sem organização passa a ter código próprio `sem_acesso`. Emenda
   ajusta D-18 (erros `identidade_mudou`, `sem_acesso`) e D-19 (ação `sessao` não conta como análise).
7. **Migração em duas etapas.** (a) Deploy da edge compatível com 0.2.1 e 0.3.0. (b) Extensão 0.3.0: ignora
   `publiai:sessao`/`publiai:desconectar`; o token empurrado pelo app nunca vira sessão própria nem é revogado (é do app);
   ao atualizar, pede login. (c) App: `publiai:ping` responde `{ versao, protocolo }`; o app só empurra sessão para
   extensões que não respondem protocolo ≥ 2 (0.2.x), até a 0.2.x sumir.
8. **Religar sem recarregar.** Content scripts do anúncio e da busca reagem à mensagem de ativação: anúncio refaz a
   leitura/análise e recoloca selo e contornos (sem a trava `__publiaiAnuncio` impedir); busca reenvia os cards e só
   analisa com o painel aberto (regra atual). Pausa cancela/descarta respostas em voo (geração). Testes de
   pausa/retomada com requisição em andamento.
9. **Cabeçalho com degradação.** Inserção idempotente (um ícone por documento), `MutationObserver` limitado ao
   cabeçalho e desligado após inserir, reinserção em navegação sem recarga, teclado (Enter/Espaço abre, Escape fecha,
   foco volta ao ícone), zoom e convivência com o ícone do Avant. Sem encaixe seguro ou página de bloqueio: não insere e
   não insiste; login, ligar/desligar e sair continuam pelo ícone da barra do Chrome (painel). "Abrir painel" chama
   `sidePanel.open` no próprio gesto, antes de qualquer chamada à edge. Shadow fechado não protege de outras extensões:
   o menu não exibe dado financeiro.
10. **Web Store.** Antes de enviar a 0.3.0: atualizar a política em `publiai.daludi.com.br/privacidade-extensao/`
    (login, sessão persistida no navegador, dados financeiros exibidos) e as declarações de privacidade do item; conferir
    no pacote final os `matches` dos content scripts e se a loja pede nova justificativa.

## Deixado ao construtor

- Seletor exato do cabeçalho do ML (medir ao vivo em anúncio, busca e home).
- Tela de Configurações → Extensão no app: passa a orientar "entre pela extensão" (sem empurrar sessão); manter só a
  detecção de "Instalada" se for barata.
- Mensagens de erro do login (senha errada, usuário inativo, sem organização, sem módulo).
- Testes: renovação concorrente, sair, troca de identidade, chave desligada removendo selos, ícone sem cabeçalho.
