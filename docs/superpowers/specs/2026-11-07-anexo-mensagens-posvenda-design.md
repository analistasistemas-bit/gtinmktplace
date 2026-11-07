# Anexo nas mensagens pós-venda do ML — desenho

**Data:** 2026-11-07
**Decisores:** Diego; decisões de escopo delegadas por ele ao Codex (gpt-6.1-sol, high)
**Relacionados:** ADR-0067 (mensagens pós-venda), ADR-0192 (ações de pós-venda)

## Por que

Comprador pede foto do produto na conversa da venda, e o operador só consegue responder com
anexo saindo do PubliAI para o site do ML. A tela Faturamento › Pós-venda › Mensagens só envia
texto (ADR-0067, v1 sem anexos). Também não mostra arquivos que o comprador manda: mensagem só
com anexo aparece como balão vazio.

**Sucesso:** o operador responde com foto ou PDF sem sair do PubliAI e vê no histórico os
arquivos enviados e recebidos.

**Fracasso, mesmo funcionando:** mensagem duplicada para o comprador; token do ML no navegador;
arquivo de uma org acessível por outra; arquivo de comprador guardado em storage próprio.

## Contrato medido no ML (07/11/2026, pedido real, envio aprovado pelo Diego)

| Passo | Chamada | Resultado |
|---|---|---|
| Upload | `POST /messages/attachments?tag=post_sale&site_id=MLB`, multipart campo `file` | 201 `{"id":"<seller>_<uuid>.png"}` |
| Envio | `POST /messages/packs/{pack}/sellers/{seller}?tag=post_sale` com `{from,to,text,attachments:[id]}` | 201, `available`, moderação `clean` |
| Leitura | `message_attachments[]` | `{filename, original_filename, type, size, potential_security_threat, creation_date, tag}` |
| Download | `GET /messages/attachments/{filename}?tag=post_sale&site_id=MLB` | 200, bytes idênticos ao original |

`filename` é o `id` do upload. No banco, em 401 mensagens: 5 recebidas com anexo (6 arquivos,
JPEG e PNG, mesmas chaves do envio), 5 enviadas com anexo, até 2 arquivos por mensagem, nenhum
com `potential_security_threat`; 4 recebidas sem texto.

**Não medido:** anexo sem texto, PDF, download de anexo enviado pelo comprador, resposta 202
`pending_review` citada na documentação do ML.

## Decisões

1. **Envio:** um arquivo por mensagem, JPG, PNG ou PDF, até 5 MB. Texto obrigatório, até 350
   caracteres, como hoje.
2. **Upload:** `posvenda-anexo` ganha o destino `mensagem_pack`, que recebe `pack_id` em vez de
   `claim_id`, confere que o pack pertence à org em `ml_mensagens` e devolve o `id` do ML. O
   destino `mensagem` de reclamação segue igual, e continua lendo `filename`.
3. **Envio ao ML:** segue JSON em `responder-mensagem`, com `anexo` opcional, em um único POST.
   `montarReqMsgML` só inclui `attachments` quando há anexo.
4. **Exibição:** a lista passa a trazer `anexos:raw->message_attachments`, sem coluna nova. O
   balão mostra miniatura de imagem ou cartão de PDF com nome e tamanho, para os dois lados.
5. **Download:** `POST` autenticado com JSON em `posvenda-anexo`, com `pack_id` e `filename`
   (POST porque o CORS compartilhado só libera `POST, OPTIONS`; mudá-lo exigiria redeployar todas
   as edges). A edge só
   busca o arquivo se `filename` constar em `raw->message_attachments` de uma mensagem desse pack
   na org do usuário, e devolve o `type` gravado. Nunca aceita URL. Bytes não são guardados
   (ADR-0192, decisão 7). O front busca com JWT, cria um blob URL e só carrega a miniatura com a
   conversa aberta.
6. **Arquivo sinalizado:** `potential_security_threat = true` mostra o cartão sem abrir nem baixar.
   Só `image/jpeg`, `image/png` e `application/pdf` são servidos; outro tipo mostra só o nome.
7. **Idempotência:** o envio passa pela trava de `ml_posvenda_acoes` (ADR-0192, decisões 2 a 4),
   com ou sem anexo. `recurso = mensagem:{pack_id}`, `acao = responder_mensagem`, `payload_hash`
   sobre texto e anexo. O front gera `operacao_id` ao iniciar o envio e guarda `operacao_id` e o
   id do upload durante a tentativa: nova tentativa técnica reaproveita os dois, sem novo upload.
   `operacao_id` repetido com o mesmo conteúdo devolve o resultado gravado, sem novo POST; com
   conteúdo diferente, é recusado, como no fluxo atual. Depois de recusa definitiva ou cancelamento
   anterior ao POST, nova tentativa recebe outro `operacao_id`. Ao abrir a conversa, a tela consulta
   a operação em aberto do pack antes de liberar o envio, o que cobre recarga da página.
8. **Estado incerto:** timeout ou erro de rede depois do POST grava `desconhecido`, e a edge nunca
   repete sozinha. A confirmação segue o rigor do fluxo atual (`posvenda.ts`, conferência de
   mensagem): usa o id devolvido pelo POST quando houver; sem id, exige mensagem nova em relação ao
   snapshot `antes`, com texto e anexos correspondentes. Moderação `clean` confirma; `rejected`
   comprovada vira `recusada` e permite nova tentativa; moderação pendente ou evidência ambígua
   mantém a trava. Falha no sync posterior ao POST bem-sucedido não reabre o envio.
   **Saída da trava:** a condição de reclamações (ação fora de `available_actions`) não existe em
   pack. Com a trava mantida, a tela mostra "Conferir no Mercado Livre" e o botão "Já conferi,
   liberar envio", com confirmação, que grava `inconclusiva`. É decisão humana registrada na
   auditoria; a edge nunca libera sozinha.
9. **Banco:** uma migration em `ml_posvenda_acoes`: `claim_id` passa a aceitar null, entra
   `pack_id text`, e um check exige exatamente um dos dois. Índices e RLS seguem iguais.
   **Leitores a adaptar:** `posvenda-acao-io.ts` converte `claim_id` com `Number` (null vira 0) e
   lista as abertas sem distinguir alvo; a recuperação em `posvenda-fluxo.ts` relê reclamação por
   esse id; `src/lib/posvenda.ts` tipa `claim_id: number`. Os fluxos de reclamação passam a ler só
   linhas com `claim_id`, e os de pack só linhas com `pack_id`.
10. **Docs:** emenda nos ADR-0067 e ADR-0192. Sem ADR novo.

## Tela

No campo de resposta, um botão de clipe entre a sugestão de IA e o texto. Escolhido o arquivo, um
chip acima do campo mostra nome, tamanho e botão de remover. O upload acontece ao clicar em enviar,
não ao escolher, para não criar anexo órfão no ML (expira em 48 h). Validação de tipo e tamanho no
front e de novo na edge. O botão de enviar segue exigindo texto. Erro de upload mantém texto e
arquivo na tela.

## Fora de escopo

Vários arquivos por mensagem, anexo sem texto, galeria, arrastar e colar, anexo em perguntas de
pré-venda, storage próprio.

## Validação

- Testes unitários: `montarReqMsgML`, `nomeDoAnexo`, validação, conferência de `filename` por org e
  pack, trava com `operacao_id` repetido e estado `desconhecido`.
- Teste SQL: check de alvo único e grants de `ml_posvenda_acoes`.
- Isolamento: usuário de outra org recebe 404 ao baixar anexo.
- Tela em runtime real: miniatura, PDF, chip, erro de upload.
- Primeiro envio real pelo app feito pelo Diego. Nenhum teste automatizado escreve para comprador.

## Deixado para quem constrói

Nome dos componentes, formato do erro de `posvenda-anexo` no GET, cache dos blobs na sessão.
