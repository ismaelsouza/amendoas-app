# Casa das Amêndoas · App do vendedor

O primeiro módulo da APP #3 confere as quantidades, aplica o preço negociado ou o preço padrão, calcula subtotais em centavos e identifica alterações de preço no rascunho. Os testes usam três pacotes e uma venda de 0,750 kg a R$ 29,88/kg.

Com Node.js 24, execute `npm ci`, `npm run build` e `npm test`.

## Fila local e envio offline · APP #2

[`PedidosOffline`](src/order-sync.ts) é independente da interface móvel. Mantém rascunhos separados por vendedor, com nome do cliente e data da alteração. Um rascunho sem cadastro vinculado pode ser retomado offline, mas só pode ser fechado após vincular o cliente e conferir quantidades e preços.

- Durante a edição, use `criarRascunho` e `salvarRascunho`; `listar` recupera o estado após reabrir o app.
- No toque em **Enviar pedido**, chame `prepararEnvio` com os preços que o vendedor conferiu. A operação grava o conteúdo fechado com um UUID estável antes de qualquer chamada de rede. O pedido fica em **Aguardando confirmação**, sem edição.
- Chame `sincronizar` após preparar o envio e, com a sessão do mesmo vendedor, ao reabrir o app e recuperar a conexão. Use o ID e o token retornados pelo login do administrativo. `criarEnvioPedidos` monta a requisição para `POST /api/v1/pedidos/campo` e só aceita confirmação `200` ou `201` com o mesmo UUID e um número válido.
- Se a confirmação se perder, o pedido continua consultável e o próximo envio usa o conteúdo já gravado, mesmo que o preço tenha mudado. Falhas HTTP são retornadas ao chamador sem regenerar o UUID nem alterar o pedido.

Na PWA, o envio usa uma sessão do vendedor em memória, HTTPS e timeout. Sem sessão, o pedido fechado fica no aparelho até o mesmo vendedor entrar novamente.

## APK de demonstração

[Baixar o APK assinado para Android](https://homologacao-app.com.br/amendoas-piloto-0.1.0.apk).

O aplicativo de teste usa WebView Android com a interface embarcada e armazenamento local por vendedor. O APK funciona com Android 8 ou superior e Android System WebView atualizado. Nesta versão há apenas um vendedor fictício e o simulador de servidor roda no aparelho. Não há login real nem envio ao administrativo.

1. Abra **Amêndoas · Piloto**, marque **Simular sem conexão** e crie um rascunho de 10 pacotes para o Supermercado Ipê.
2. Feche e reabra o app. Abra o rascunho e confira a quantidade. Envie o pedido ainda offline. Ele fica **Aguardando confirmação**.
3. Marque **Simular perda da próxima resposta** e desmarque **Simular sem conexão**. O servidor fictício grava a venda, mas o app ainda não sabe o número.
4. Reabra o app ou toque em **Sincronizar agora**. Confira que apareceu um único pedido confirmado. Uma segunda venda igual recebe outro número.

Para compilar, use Node.js 24, JDK 17, Android SDK 35 e Build Tools 35.0.0. Depois de `npm ci`, configure `ANDROID_SDK_ROOT`, `PILOT_KEYSTORE` e `PILOT_STORE_PASS` e execute `npm run build:apk`. O arquivo fica em `dist/amendoas-piloto.apk`. Use a mesma chave e um código de versão maior para publicar uma atualização do mesmo pacote. Mantenha a chave e a senha fora do Git.

## APK integrado de homologação

[Baixar Amêndoas · Homologação `0.2.0` para Android](https://homologacao-app.com.br/amendoas-homologacao.apk).

**Amêndoas · Homologação** é um pacote separado, `br.com.casadasamendoas.vendedor.homologacao`. Pode ser instalado ao lado do demonstrativo. Usa uma conta de vendedor da homologação e envia pela API em `https://homologacao-app.com.br/api-amendoas-adm`. A interface já vem no APK, e os dados locais não são compartilhados com a PWA ou com o demonstrativo. Use só dados fictícios.

Com os mesmos pré-requisitos de compilação, configure `ANDROID_SDK_ROOT`, `HOMOLOG_APK_KEYSTORE` e `HOMOLOG_APK_STORE_PASS`, e execute `npm run build:apk:homologacao`. O arquivo fica em `dist/amendoas-homologacao.apk`. Preserve a chave de homologação para as atualizações desse pacote.

Para testar em Android físico, instale o APK e entre com um vendedor de teste. Consulte um supermercado fictício, monte um pedido de 2 pacotes e toque em **Enviar pedido** sem rede. Reabra o app offline com **Abrir pedidos no aparelho**, se tiver permitido o acesso offline, e confira o envio pendente. Reconecte, entre novamente e confira que o mesmo número aparece uma vez no ADM. Pelo APK, solicite a correção para 3 pacotes e aprove no painel antes da primeira saída. Atualize as correções no APK e confira que a quantidade vigente mudou, com o mesmo número e sem movimentar estoque.

## PWA para celular

[Abrir ou instalar a PWA de homologação](https://homologacao-app.com.br/app-amendoas/).

`npm run build:web` gera a PWA em `dist/acompanhamento-web/`. Ela usa a mesma origem para o app e a base de API `/api-amendoas-adm`. A PWA autentica o vendedor na API real e não grava a senha nem o token. O [fluxo de publicação](https://github.com/prpaulocesarneves-crypto/amendoas--adm/issues/11) está no repositório do ADM.

- **APP #2:** salve e retome rascunhos, consulte pedidos aguardando confirmação e sincronize sem duplicar a venda. O app tenta novamente quando a rede volta ou quando o vendedor entra após reabrir.
- **APP #3:** busque um supermercado por nome ou CNPJ ao registrar o pedido na PWA ou no APK integrado. A lista mostra sugestões enquanto você digita. Se houver um rascunho compatível aberto, selecionar o cliente preserva as quantidades. A consulta pelo CNPJ completo continua disponível para verificar um cadastro novo.
- **APP #4:** acompanhe seus pedidos e consulte o que saiu, chegou, foi recusado ou cancelado e o que ainda falta receber.

Para ajustar a quantidade ou o preço de um item de um pedido confirmado, abra **Correções** no pedido, informe o motivo e envie a proposta com rede. Enquanto aguarda autorização, consulte os valores vigentes no mesmo painel. O administrativo aplica a mudança ao mesmo número só se gerente ou administrador aprovar antes da primeira saída. Se a venda já saiu parcialmente e o cliente quer mais unidades, registre o acréscimo num novo pedido.

### Cadastro de supermercado

O app baixa a lista de clientes ao entrar com internet. Com a opção de acesso offline ativa, também é possível pesquisar depois de reabrir o app sem rede. Se o rascunho ainda não tiver cotação salva, selecione o cliente e monte os itens, mas consulte os preços com internet antes de enviar.

Se o CNPJ consultado ainda não estiver no Essentials, a PWA abre o cadastro com o CNPJ preenchido. Informe o nome, o telefone com DDD, o CEP, o logradouro, o número ou **Sem número**, o bairro, o município e a UF. O complemento é opcional. Escolha um rascunho existente ou crie outro. O cadastro precisa de conexão.

Depois de cadastrar, confira o preço padrão e as quantidades antes de enviar a venda. Não é preciso esperar a conferência do administrador para enviar um pedido com preços definidos. Se alguém já tiver cadastrado o mesmo CNPJ, a PWA oferece reutilizar o cadastro, sem substituir os dados já gravados.

### Roteiro no aparelho

1. No iPhone, abra o endereço HTTPS no Safari, toque em **Compartilhar** e escolha **Adicionar à Tela de Início**. Abra o ícone com rede, entre como vendedor de teste e marque **Permitir acesso offline neste aparelho**. No Android, o mesmo endereço funciona pelo navegador; instalar o APK de demonstração é um teste separado.
2. Consulte um cliente fictício cadastrado e monte a venda de 10 pacotes. Desligue a rede e toque em **Enviar pedido**. Ele deve aparecer como **Aguardando confirmação**. Mantenha apenas uma janela do app aberta.
3. Feche e reabra a PWA ainda sem rede e toque em **Abrir pedidos no aparelho**. Confira os itens salvos. Volte à rede e entre com a mesma conta. Confira o número confirmado e uma única entrada na fila administrativa.

A abertura offline depende de um primeiro acesso com rede na instalação usada no teste. Ative a opção apenas num aparelho pessoal: ela permite consultar dados locais sem senha, mas não autoriza chamadas à API. **Sair** desativa a abertura offline. Limpar os dados desse site no navegador pode apagar rascunhos e envios não confirmados.
