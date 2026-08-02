# Salvamento explícito da configuração do Telegram

## Objetivo

Impedir alterações acidentais no Chat ID e no Bot token. Editar ou sair desses campos não deve persistir dados.

## Comportamento

- Um único botão **Salvar configurações** grava juntos o Chat ID atual e o Bot token, quando preenchido.
- O botão fica desabilitado enquanto não houver alterações e durante o salvamento.
- O interruptor **Ativo** continua sendo salvo imediatamente e de forma independente.
- Em caso de sucesso, o token digitado é limpo e os dados exibidos passam a representar o estado salvo.
- Em caso de erro, os valores editados permanecem disponíveis para nova tentativa e a mensagem de erro existente é exibida.
- **Enviar teste** e **Verificar agora** mantêm o comportamento atual.

## Implementação

Remover os eventos `onBlur` dos dois campos e chamar a mutação de configuração somente pelo novo botão. O estado sujo será derivado comparando o Chat ID com a configuração carregada e verificando se há um token não vazio.

## Validação

Um teste do componente deve provar que desfocar os campos não chama a mutação, que o botão é habilitado após edição e que clicar nele envia os valores atuais. Será executado também o teste direcionado e a checagem TypeScript/build apropriada ao arquivo alterado.
