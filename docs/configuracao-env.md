# Configuração completa do ambiente

Este guia descreve todas as variáveis de ambiente usadas atualmente pelo backend da Tijucas Imobiliária e como obter cada credencial externa.

Auditoria de referência: **18 de agosto de 2026**.

O `.env.example` lista as variáveis necessárias sem conter segredos. Use este guia para configurar cada integração.

## Estado atual auditado

Sem reproduzir nenhum segredo, a auditoria encontrou:

- as 35 variáveis consumidas pelo código estão documentadas e presentes no `.env.example`;
- `NODE_ENV=development`, provider Asaas, URL e chave de Sandbox estão coerentes e a criação best-effort está habilitada;
- as quatro credenciais/configurações AWS existem e o SDK gera URLs assinadas localmente, mas somente um `PUT` e um `GET` reais comprovam IAM, região e CORS;
- `CORS_ORIGINS` não está preenchida no `.env` atual; em desenvolvimento valem somente os fallbacks locais `http://localhost:5173` e `http://127.0.0.1:5173`;
- as estruturas e o histórico das migrations 001 a 008 foram encontrados;
- os 15 arquivos de testes unitários e os 5 testes de integração passaram;
- `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_JWKS_URL` e `EMAIL_PASSWORD` existem no arquivo atual, mas não são lidas pelo backend.

Esse é um retrato de 18 de agosto de 2026 e deve ser revalidado depois de qualquer mudança.

## 1. Regras de segurança

1. Nunca envie o arquivo `.env` por chat, e-mail ou chamado.
2. Nunca publique o `.env` no Git. O arquivo já está listado no `.gitignore`.
3. Não coloque `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `JWT_SECRET`, `EMAIL_PASS`, `ASAAS_WEBHOOK_TOKEN`, chaves AWS ou chaves Asaas no frontend.
4. Variáveis Vite iniciadas por `VITE_` ficam visíveis no navegador e não podem conter segredos.
5. Use contas, projetos, buckets e bancos exclusivos de teste para a reunião.
6. Se algum segredo for exposto, revogue-o e gere outro; apenas apagar a mensagem ou o commit não resolve.

## 2. Criar o arquivo `.env`

Na raiz do backend:

```bash
test -e .env || cp .env.example .env
chmod 600 .env
```

O primeiro comando cria o arquivo somente quando ele ainda não existe. Não sobrescreva o `.env` atual: ele já contém uma configuração Sandbox funcional. Se precisar guardar segredos, use um gerenciador de senhas ou cofre externo ao repositório.

Use este modelo completo:

```dotenv
# Aplicação
PORT=3000
NODE_ENV=development
APP_TIMEZONE=America/Sao_Paulo

# PostgreSQL e Supabase
DATABASE_URL="postgresql://USUARIO:SENHA@HOST:5432/postgres"
DATABASE_CONNECTION_TIMEOUT_MS=10000
DATABASE_IDLE_TIMEOUT_MS=30000
SUPABASE_URL="https://ID_DO_PROJETO.supabase.co"
SUPABASE_SECRET_KEY="COLE_A_SECRET_KEY_DO_BACKEND"

# Autenticação da aplicação
JWT_SECRET="COLE_UM_SEGREDO_ALEATORIO_COM_PELO_MENOS_32_CARACTERES"
JWT_EXPIRES_IN=8h
JWT_ISSUER=tijucas-imobiliaria
JWT_AUDIENCE=tijucas-imobiliaria-app
AUTH_COOKIE_NAME=tijucas_session
AUTH_COOKIE_SAME_SITE=lax

# Origem do frontend e proxy HTTP
CORS_ORIGINS="http://localhost:5173"
APP_TRUST_PROXY=false

# Gmail SMTP
EMAIL_USER="conta@gmail.com"
EMAIL_PASS="COLE_A_SENHA_DE_APP_DO_GOOGLE"

# Amazon S3
AWS_REGION="REGIAO_DO_BUCKET"
AWS_ACCESS_KEY_ID="COLE_A_ACCESS_KEY_ID"
AWS_SECRET_ACCESS_KEY="COLE_A_SECRET_ACCESS_KEY"
AWS_S3_BUCKET="NOME_EXATO_DO_BUCKET"

# Gateway de pagamento: FAKE ou ASAAS
PAYMENT_GATEWAY_PROVIDER=FAKE

# Asaas
ASAAS_API_KEY="COLE_A_CHAVE_DO_AMBIENTE_ESCOLHIDO"
ASAAS_API_URL=https://api-sandbox.asaas.com/v3
ASAAS_WEBHOOK_TOKEN="COLE_O_TOKEN_DE_32_A_255_CARACTERES"
ASAAS_USER_AGENT=TijucasImobiliaria/1.0
ASAAS_REQUEST_TIMEOUT_MS=15000
ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION=false

# Reconciliação financeira
BILLING_CRON_SCHEDULE="0 6 * * *"
BILLING_LOCK_TIMEOUT_MS=10000

# Processamento da inbox de webhooks
WEBHOOK_CRON_SCHEDULE="*/30 * * * * *"
WEBHOOK_BATCH_SIZE=50
WEBHOOK_MAX_ATTEMPTS=8
WEBHOOK_BACKOFF_BASE_SECONDS=30
```

Os valores `COLE_...`, `USUARIO`, `SENHA`, `HOST`, `REGIAO_DO_BUCKET` e `NOME_EXATO_DO_BUCKET` são marcadores e devem ser substituídos.

## 3. Configurações da aplicação

### `PORT`

Porta HTTP do Express. O padrão é `3000`.

```dotenv
PORT=3000
```

### `NODE_ENV`

Para desenvolvimento e reunião:

```dotenv
NODE_ENV=development
```

Em `production`, o startup exige provider Asaas, URL que não seja Sandbox, credenciais de e-mail/S3/Asaas, token de webhook válido e `CORS_ORIGINS`. O gateway `FAKE` é recusado. Não use `NODE_ENV=production` apenas para simular um ambiente local.

### `APP_TIMEZONE`

Controla a data civil e o fuso do cron financeiro:

```dotenv
APP_TIMEZONE=America/Sao_Paulo
```

### CORS, proxy e cookie de sessão

O navegador autentica usando um cookie `HttpOnly`; o frontend Axios já envia `withCredentials: true`. A API aceita somente origens exatas, separadas por vírgula:

```dotenv
CORS_ORIGINS="https://app.exemplo.com,https://app-homolog.exemplo.com"
AUTH_COOKIE_NAME=tijucas_session
AUTH_COOKIE_SAME_SITE=lax
APP_TRUST_PROXY=true
```

- não use `*` em `CORS_ORIGINS`, porque a API aceita credenciais;
- use `APP_TRUST_PROXY=true` somente quando o processo estiver atrás de um proxy reverso confiável com um salto;
- em produção o cookie recebe `Secure` automaticamente;
- `lax` é adequado para frontend e API no mesmo site, inclusive em subdomínios do mesmo domínio registrável;
- se frontend e API estiverem em sites diferentes, use `AUTH_COOKIE_SAME_SITE=none`, obrigatoriamente com HTTPS;
- `strict`, `lax` e `none` são os únicos valores aceitos.

Em desenvolvimento, quando `CORS_ORIGINS` estiver ausente, somente `localhost:5173` e `127.0.0.1:5173` são aceitos. Esse fallback não substitui a configuração de produção.

## 4. Configurar PostgreSQL e Supabase

O backend usa duas formas de acesso ao mesmo projeto:

- `SUPABASE_URL` e `SUPABASE_SECRET_KEY` para o cliente Supabase/Data API;
- `DATABASE_URL` para consultas SQL, transações, migrations e advisory locks pelo pacote `pg`.

As três variáveis devem apontar para o **mesmo projeto Supabase**.

Links oficiais:

- [Dashboard do Supabase](https://supabase.com/dashboard/projects)
- [Chaves de API do Supabase](https://supabase.com/docs/guides/getting-started/api-keys)
- [Connection strings do PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres)

### Passo a passo

1. Abra o projeto no dashboard do Supabase.
2. Abra `Settings` → `API Keys`, ou use o diálogo `Connect`.
3. Copie a URL do projeto para `SUPABASE_URL`.
4. Crie ou copie uma **Secret key** de backend, normalmente iniciada por `sb_secret_`, para `SUPABASE_SECRET_KEY`.
5. Se o projeto ainda usa chaves legadas, a `service_role` pode ser usada no backend. Não use a chave publishable/anon como substituta da secret/service-role.
6. Clique em `Connect` e copie uma connection string PostgreSQL.
7. Para este backend persistente, prefira:
   - conexão direta, quando a máquina suporta IPv6; ou
   - `Session pooler`, porta `5432`, em redes somente IPv4.
8. Evite o transaction pooler da porta `6543`: o sistema usa transações e locks associados à conexão.
9. Substitua o marcador da senha pela senha real do banco. Caracteres especiais precisam estar codificados corretamente na URL.
10. Guarde a connection string somente no backend.

Exemplo estrutural:

```dotenv
SUPABASE_URL="https://ID_DO_PROJETO.supabase.co"
SUPABASE_SECRET_KEY="sb_secret_EXEMPLO"
DATABASE_URL="postgresql://postgres.ID_DO_PROJETO:SENHA@HOST_DO_POOLER:5432/postgres"
DATABASE_CONNECTION_TIMEOUT_MS=10000
DATABASE_IDLE_TIMEOUT_MS=30000
```

`SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_JWKS_URL` não são lidas pelo backend atual.

## 5. Gerar o segredo JWT

O JWT autentica login, redefinição de senha e rotas protegidas. Todos os processos do mesmo ambiente precisam usar o mesmo valor.

Gere 32 bytes aleatórios, representados por 64 caracteres hexadecimais:

```bash
openssl rand -hex 32
```

Copie apenas o resultado para:

```dotenv
JWT_SECRET="RESULTADO_GERADO"
```

Mantenha também os identificadores e a duração recomendada:

```dotenv
JWT_EXPIRES_IN=8h
JWT_ISSUER=tijucas-imobiliaria
JWT_AUDIENCE=tijucas-imobiliaria-app
```

O JWT usa HS256, emissor e audiência explícitos. O cookie de sessão atual também dura oito horas; por isso, mantenha `JWT_EXPIRES_IN=8h`. Trocar o segredo, o emissor ou a audiência invalida todas as sessões emitidas anteriormente.

## 6. Configurar o Gmail

O código usa Gmail pelo Nodemailer para:

- verificação de e-mail;
- recuperação de senha;
- notificações de análise documental.

Links oficiais:

- [Ajuda do Google sobre senhas de app](https://support.google.com/accounts/answer/185833?hl=pt-BR)
- [Tela de senhas de app](https://myaccount.google.com/apppasswords)

### Passo a passo

1. Entre na conta Google que será a remetente.
2. Ative a verificação em duas etapas.
3. Abra a tela `Senhas de app`.
4. Crie uma senha com um nome identificável, por exemplo `Tijucas Backend Teste`.
5. Copie o código exibido. Ele é mostrado somente na criação.
6. Configure:

```dotenv
EMAIL_USER="conta@gmail.com"
EMAIL_PASS="SENHA_DE_APP"
```

O código lê `EMAIL_PASS`. A variável `EMAIL_PASSWORD` não é um alias e não é usada.

Contas corporativas podem esconder a opção de senha de app por política do administrador. O Google também revoga senhas de app quando a senha principal é alterada.

## 7. Configurar Amazon S3

O backend não recebe os arquivos. Ele gera URLs pré-assinadas de cinco minutos e o frontend envia ou baixa diretamente do bucket privado.

Links oficiais:

- [Console do Amazon S3](https://console.aws.amazon.com/s3/)
- [Criar um bucket](https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-overview.html)
- [Console do IAM](https://console.aws.amazon.com/iam/)
- [Criar uma credencial de workload no IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/getting-started-workloads.html)
- [Criar e administrar Access Keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-keys-admin-managed.html)
- [Permissões S3 por operação](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html)
- [URLs pré-assinadas](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [Configurar CORS no S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html)

### 7.1 Criar ou revisar o bucket

1. Abra o console S3.
2. Crie um bucket de uso geral ou selecione o bucket privado existente.
3. Copie somente o nome do bucket, sem `s3://`, URL ou ARN, para `AWS_S3_BUCKET`.
4. Copie a região real do bucket para `AWS_REGION`.
5. Mantenha `Object Ownership` como `Bucket owner enforced`.
6. Mantenha ACLs desabilitadas.
7. Mantenha as quatro opções de `Block Public Access` ligadas.
8. Para a reunião, a criptografia padrão SSE-S3 é suficiente.

```dotenv
AWS_REGION="sa-east-1"
AWS_S3_BUCKET="NOME_EXATO_DO_BUCKET"
```

`sa-east-1` é apenas um exemplo. Use obrigatoriamente a região exibida no bucket.

### 7.2 Entender as sete pastas atuais

Não é necessário criar pastas manualmente no console. O S3 não possui pastas reais; esses prefixos surgem automaticamente no primeiro upload:

| Tipo enviado pela API | Prefixo no S3 |
|---|---|
| `COMPROVANTE_RENDA` | `fiadores/comprovantes-renda` |
| `APOLICE_SEGURO` | `seguros/apolices` |
| `COMPROVANTE_PAGAMENTO` | `pagamentos/comprovantes` |
| `DOCUMENTO_CLIENTE` | `clientes/documentos` |
| `COMPROVANTE_RESIDENCIA_ANTERIOR` | `clientes/residencia-anterior` |
| `CERTIDAO_IMOVEL_FIADOR` | `fiadores/certidoes-imovel` |
| `COMPROVANTE_CAUCAO` | `caucoes/comprovantes` |

As quatro últimas entradas são as novas configurações que não existiam na política antiga.

Cada objeto novo segue aproximadamente:

```text
<prefixo>/users/<id-do-usuario>/<id-aleatorio>.<pdf|jpg|png>
```

### 7.3 Criar a política IAM correta

1. Abra `IAM` → `Policies` → `Create policy`.
2. Selecione o editor JSON.
3. Cole a política abaixo.
4. Substitua todas as ocorrências de `NOME_EXATO_DO_BUCKET`.
5. Salve como `TijucasBackendS3Presigned`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TijucasDocumentUploadDownload",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::NOME_EXATO_DO_BUCKET/fiadores/comprovantes-renda/*",
        "arn:aws:s3:::NOME_EXATO_DO_BUCKET/seguros/apolices/*",
        "arn:aws:s3:::NOME_EXATO_DO_BUCKET/pagamentos/comprovantes/*",
        "arn:aws:s3:::NOME_EXATO_DO_BUCKET/clientes/documentos/*",
        "arn:aws:s3:::NOME_EXATO_DO_BUCKET/clientes/residencia-anterior/*",
        "arn:aws:s3:::NOME_EXATO_DO_BUCKET/fiadores/certidoes-imovel/*",
        "arn:aws:s3:::NOME_EXATO_DO_BUCKET/caucoes/comprovantes/*"
      ]
    }
  ]
}
```

O aplicativo não precisa de `s3:ListBucket`, `s3:DeleteObject`, `s3:PutObjectAcl` nem acesso público. Um `403` ao listar o bucket pode ser esperado com essa política mínima; valide com um upload e um download reais pelas URLs pré-assinadas.

O uso de `<prefixo>/*` é intencional para continuar aceitando eventuais objetos legados sem o segmento `users/`. Em um bucket totalmente novo, cada ARN pode ser restringido para `<prefixo>/users/*`.

A política acima pressupõe que o usuário IAM e o bucket pertencem à mesma conta AWS. Acesso entre contas exige também uma bucket policy para o principal externo; com KMS, a key policy precisa autorizar a outra conta.

### 7.4 Criar ou ajustar o usuário IAM

1. Abra `IAM` → `Users`.
2. Use um usuário dedicado para o backend, nunca a conta root.
3. Anexe a política `TijucasBackendS3Presigned` ao usuário.
4. Abra `Security credentials` → `Access keys` → `Create access key`.
5. Revise as alternativas e, se a aplicação continuar rodando fora da AWS, escolha o caso correspondente a workload externa ou `Other`.
6. Copie os dois valores no momento da criação:

```dotenv
AWS_ACCESS_KEY_ID="ACCESS_KEY_ID"
AWS_SECRET_ACCESS_KEY="SECRET_ACCESS_KEY"
```

A AWS não permite recuperar a Secret Access Key depois. Se ela for perdida, crie uma nova chave e desative a anterior.

O código atual não lê `AWS_SESSION_TOKEN` e força o par Access Key/Secret Key. Credenciais temporárias STS e IAM Role exigem uma alteração no código antes de serem usadas.

### 7.5 Configurar o CORS do bucket

1. Abra `S3` → bucket → `Permissions`.
2. Em `Cross-origin resource sharing (CORS)`, clique em editar.
3. Use as origens exatas do frontend, incluindo protocolo e porta, mas sem caminho.

```json
[
  {
    "AllowedHeaders": [
      "Content-Type",
      "Range",
      "If-Range",
      "x-amz-*"
    ],
    "AllowedMethods": [
      "GET",
      "PUT"
    ],
    "AllowedOrigins": [
      "http://localhost:5173"
    ],
    "ExposeHeaders": [
      "ETag",
      "Accept-Ranges",
      "Content-Range"
    ],
    "MaxAgeSeconds": 3000
  }
]
```

O JSON acima cobre o Vite local. Para a aplicação hospedada, acrescente a origem real, por exemplo `https://app-teste.seudominio.com`, antes de salvar.

Não use `"*"` em `AllowedOrigins` quando documentos pessoais estiverem envolvidos. CORS não torna o bucket público; as permissões IAM continuam valendo.

O frontend deve repetir no `PUT` o `Content-Type` e enviar exatamente o tamanho informados ao solicitar a URL. Antes de vincular qualquer arquivo a um registro, o backend consulta o objeto no S3 e valida tamanho, MIME e assinatura binária. Os tipos aceitos são:

```text
application/pdf
image/jpeg
image/png
```

As URLs de upload e download duram cinco minutos e o limite aceito pela aplicação é 10 MB. Configure também uma regra de ciclo de vida no bucket para remover uploads órfãos que nunca forem associados a um registro.

### 7.6 Se o bucket usa KMS

Para a reunião, prefira SSE-S3. Consulte também a [documentação oficial sobre SSE-KMS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html).

Se o bucket estiver configurado com uma chave KMS gerenciada pelo cliente:

1. use uma chave simétrica na mesma região do bucket;
2. configure-a como criptografia padrão do bucket;
3. autorize o usuário IAM na key policy;
4. acrescente ao IAM o statement abaixo com o ARN exato da chave:

```json
{
  "Sid": "UseTijucasKmsKey",
  "Effect": "Allow",
  "Action": [
    "kms:GenerateDataKey",
    "kms:Decrypt"
  ],
  "Resource": "arn:aws:kms:REGIAO:CONTA:key/ID_DA_CHAVE"
}
```

Não crie uma bucket policy que exija os headers `x-amz-server-side-encryption` ou `x-amz-server-side-encryption-aws-kms-key-id`. O `PutObjectCommand` atual não envia esses headers e essa exigência faria o upload retornar `403`; use a criptografia padrão do bucket.

O backend não lê `AWS_KMS_KEY_ID`; adicionar essa variável ao `.env` não altera o comportamento.

## 8. Escolher o gateway de pagamento

Existem dois perfis válidos para teste.

Não alterne entre `ASAAS` e `FAKE` usando o mesmo banco durante um lote incompleto. Isso pode deixar competências do mesmo contrato associadas a providers diferentes. Use outro banco exclusivo para testes com `FAKE`.

O provider define novas emissões, mas não apaga a origem de cobranças existentes. Mesmo com `PAYMENT_GATEWAY_PROVIDER=FAKE`, o cancelamento de uma cobrança persistida como Asaas ainda pode precisar de `ASAAS_API_KEY` e `ASAAS_API_URL`. O webhook Asaas também continua independente do provider atual.

O repasse bancário automático ao proprietário continua bloqueado para o adapter Asaas porque o projeto ainda não homologou idempotência segura para transferências. Essa limitação não impede cobrança ou recebimento de boletos, mas o repasse deve continuar manual até a integração ser homologada.

### Perfil A: demonstração isolada com `FAKE`

Use quando não for necessário abrir um boleto real do Sandbox:

```dotenv
NODE_ENV=development
PAYMENT_GATEWAY_PROVIDER=FAKE
ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION=false
```

Nesse perfil, `ASAAS_API_KEY` e `ASAAS_API_URL` não são usadas para novas emissões. Elas ainda podem ser necessárias para operar cobranças Asaas preexistentes. O gateway `FAKE` grava parcelas e cobranças simuladas no banco, por isso deve usar um banco exclusivo de teste e sem cobranças Asaas pendentes.

As URLs `fake-gateway.local` são demonstrativas e não abrem boletos reais no navegador.

### Perfil B: demonstração completa no Asaas Sandbox

Links oficiais:

- [Criar conta no Asaas Sandbox](https://sandbox.asaas.com/)
- [Guia oficial do Sandbox](https://docs.asaas.com/docs/sandbox)
- [Autenticação e ambientes da API](https://docs.asaas.com/docs/autentica%C3%A7%C3%A3o-1)
- [Criar webhook pelo painel](https://docs.asaas.com/docs/criar-novo-webhook-pela-aplicacao-web)
- [Receber eventos no endpoint](https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook)
- [Obrigatoriedade do token de webhook](https://docs.asaas.com/changelog/obrigatoriedade-e-auto-gera%C3%A7%C3%A3o-de-tokens-para-webhooks)

### Passo a passo

1. Crie ou acesse uma conta separada em `sandbox.asaas.com`.
2. Entre pela interface web com um administrador.
3. Abra `Integrações` → `Chave de API`.
4. Gere uma chave de Sandbox e copie-a no momento da criação.
5. Confirme que a chave Sandbox começa com `$aact_hmlg_`.
6. Use essa chave somente com `https://api-sandbox.asaas.com/v3`.
7. Configure:

```dotenv
NODE_ENV=development
PAYMENT_GATEWAY_PROVIDER=ASAAS
ASAAS_API_KEY="$aact_hmlg_COLE_A_CHAVE_COMPLETA"
ASAAS_API_URL=https://api-sandbox.asaas.com/v3
ASAAS_USER_AGENT=TijucasImobiliaria/1.0
ASAAS_REQUEST_TIMEOUT_MS=15000
ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION=true
```

O `true` é necessário para este projeto criar cobranças Asaas, pois a deduplicação pelo `externalReference` é best-effort e não uma idempotência nativa documentada pelo gateway. Habilite-o primeiro apenas no Sandbox.

Nunca misture:

- chave `$aact_hmlg_` com URL de produção;
- chave `$aact_prod_` com URL de Sandbox.

### 8.1 Configurar o webhook Asaas

1. Disponibilize o backend em uma URL pública HTTPS. `localhost` não pode receber chamadas do Asaas.
2. Gere um token aleatório entre 32 e 255 caracteres. Por exemplo:

```bash
openssl rand -hex 32
```

3. Salve o resultado no backend:

```dotenv
ASAAS_WEBHOOK_TOKEN="TOKEN_GERADO"
```

4. No painel Asaas Sandbox, abra `Integrações` → `Webhooks`.
5. Cadastre:

```text
https://URL-PUBLICA-DO-BACKEND/webhooks/asaas
```

6. Informe no campo de autenticação exatamente o mesmo token do `.env`.
7. Se o painel gerar o token, copie-o imediatamente e substitua o valor do `.env`.
8. Ative ao menos os eventos processados pelo backend:

```text
PAYMENT_CONFIRMED
PAYMENT_RECEIVED
PAYMENT_REFUNDED
PAYMENT_PARTIALLY_REFUNDED
PAYMENT_CHARGEBACK_REQUESTED
PAYMENT_DELETED
PAYMENT_BANK_SLIP_CANCELLED
```

Token ausente, menor que 32 ou maior que 255 caracteres faz o endpoint retornar `503`. Token diferente retorna `401`; a validação nunca é desligada automaticamente pelo modo `FAKE`.

### 8.2 Produção

Produção exige outra API key e outra URL:

```dotenv
NODE_ENV=production
PAYMENT_GATEWAY_PROVIDER=ASAAS
ASAAS_API_KEY="$aact_prod_COLE_A_CHAVE_COMPLETA"
ASAAS_API_URL=https://api.asaas.com/v3
ASAAS_WEBHOOK_TOKEN="TOKEN_EXCLUSIVO_DE_PRODUCAO"
ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION=false
```

Com `ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION=false`, novas cobranças continuam bloqueadas. Somente depois da homologação e do aceite formal do risco residual esse valor pode ser alterado para `true` em produção.

O startup recusa uma URL contendo `sandbox` quando `NODE_ENV=production`. Confirme também que a URL é exatamente `https://api.asaas.com/v3` e que a chave começa com `$aact_prod_`; a validação remota definitiva ocorre na primeira chamada ao Asaas.

Não reutilize o token de webhook do Sandbox em produção. Não troque para esse perfil durante a reunião. Antes do go-live, homologue cobrança, timeout, retry, webhook, estorno, cancelamento e conciliação no Sandbox.

## 9. Configurar crons e timeouts

Os valores recomendados para o ambiente atual são:

| Variável | Valor recomendado | Comportamento |
|---|---:|---|
| `APP_TIMEZONE` | `America/Sao_Paulo` | Fuso da data civil e do cron financeiro |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `10000` | Tempo máximo para conectar ao PostgreSQL |
| `DATABASE_IDLE_TIMEOUT_MS` | `30000` | Tempo para liberar conexões ociosas |
| `ASAAS_REQUEST_TIMEOUT_MS` | `15000` | Timeout de cada chamada HTTP ao Asaas |
| `BILLING_CRON_SCHEDULE` | `0 6 * * *` | Reconciliação diária às 06:00 |
| `BILLING_LOCK_TIMEOUT_MS` | `10000` | Espera por lock; o código limita entre 1 e 60 segundos |
| `WEBHOOK_CRON_SCHEDULE` | `*/30 * * * * *` | Processa a inbox a cada 30 segundos |
| `WEBHOOK_BATCH_SIZE` | `50` | Itens por lote; o código limita a 500 |
| `WEBHOOK_MAX_ATTEMPTS` | `8` | Tentativas antes do descarte operacional |
| `WEBHOOK_BACKOFF_BASE_SECONDS` | `30` | Base do backoff exponencial, limitado internamente a uma hora |

Use aspas nas expressões cron para evitar interpretação incorreta em painéis de hospedagem:

```dotenv
BILLING_CRON_SCHEDULE="0 6 * * *"
WEBHOOK_CRON_SCHEDULE="*/30 * * * * *"
```

### Efeito importante do startup

Alterar o horário do cron não impede a primeira execução. Ao iniciar, [server.js](../src/server.js) chama imediatamente:

- reconciliação de cobranças;
- processamento de webhooks pendentes.

Não existe atualmente `DISABLE_CRON` ou `SKIP_RECONCILIATION`. Cada inicialização, por `pnpm dev` ou `pnpm start`, executa a reconciliação imediatamente. Cobranças já existentes são reutilizadas pelo fluxo idempotente, mas competências pendentes podem ser emitidas no provider configurado e gravadas no banco.

Antes de iniciar, confirme sempre `DATABASE_URL`, `NODE_ENV`, `PAYMENT_GATEWAY_PROVIDER`, `ASAAS_API_URL` e o ambiente da `ASAAS_API_KEY`.

## 10. Migrations do banco

No ambiente auditado em 18 de agosto de 2026, as estruturas e o histórico das migrations 001 a 008 estão presentes.

Audite antes de executar qualquer migration:

```bash
pnpm migrations:audit
```

Se todas as propriedades `migration_001` a `migration_008` forem `true` e o histórico/checksum estiver coerente, o banco está atualizado. `pnpm migrate:all` é idempotente e ignora migrations já aplicadas.

O audit é um detector estrutural, não uma prova integral de cada coluna, constraint, função e trigger. Se o histórico disser que uma migration foi aplicada, mas a estrutura correspondente aparecer como `false`, pare e investigue drift; não tente reaplicá-la automaticamente.

Em outro banco existente, faça backup e execute `pnpm migrate:all`. O script reconhece estruturas legadas 001–004, registra seus checksums e aplica em ordem somente o que estiver ausente. Em seguida, execute `pnpm migrations:audit`.

A migration 006 falha intencionalmente se existir contrato sem exatamente um inquilino principal.

Não execute `docs/database_schema.sql` no banco atual. O arquivo começa com `DROP ... CASCADE` e apaga dados; ele é um snapshot para banco completamente vazio, não uma migration incremental.

## 11. Instalar, testar e iniciar

### Conferir o runtime

```bash
node --version
pnpm --version
```

Use Node `22` ou superior e pnpm `>=11.8.0` e `<12`. Consulte a [matriz oficial de compatibilidade do pnpm](https://pnpm.io/installation#compatibility).

### Instalação reproduzível

```bash
pnpm install --frozen-lockfile
```

O projeto declara a linha principal 11 do pnpm, a partir da versão 11.8.0.

### Testes unitários

```bash
pnpm test
```

Na auditoria deste documento, os 15 arquivos de teste passaram sem falhas. Esses testes usam mocks ou valores de teste e não comprovam credenciais reais do Gmail, AWS, Supabase ou Asaas.

### Testes de integração

```bash
pnpm test:integration
```

Execute testes de integração somente em um Supabase de teste dedicado. Eles usam `DATABASE_URL`, criam estruturas temporárias e não devem apontar para produção nem para o banco compartilhado da reunião.

Eles não são pré-requisito para iniciar a reunião quando os testes unitários e os smoke tests reais já foram concluídos.

### Reiniciar depois de mudar o `.env`

Encerre o processo Node e inicie-o novamente depois de alterar provider, chaves, URLs, região, bucket, crons ou timeouts. Parte da configuração é carregada durante o import dos módulos e o cliente S3 fica em cache; não presuma que o Nodemon reiniciará somente porque o `.env` mudou.

### Iniciar em desenvolvimento

```bash
pnpm dev
```

### Iniciar sem Nodemon

```bash
pnpm start
```

Logs esperados no startup:

```text
Servidor rodando na porta ...
[billingCron] agendado (...)
[webhookCron] agendado (...)
```

Essas três linhas comprovam apenas que o processo HTTP e os agendamentos subiram. Aguarde também o resumo do billing e confirme que ele não reporta falhas. Em produção, o startup valida a presença das variáveis de Gmail, S3 e Asaas, mas não testa conectividade nem validade remota das credenciais; faça smoke tests reais.

O projeto ainda não possui endpoint `/health`. Um `404` em uma rota inexistente prova apenas que a porta respondeu, não que banco e autenticação funcionam.

Faça login com uma conta de demonstração real e guarde o cookie HttpOnly temporariamente:

```bash
curl --cookie-jar /tmp/tijucas-cookie.txt --request POST http://localhost:3000/login \
  --header 'Content-Type: application/json' \
  --data '{"email":"EMAIL_DEMO","password":"SENHA_DEMO"}'
```

Depois, use o cookie em uma consulta autenticada de funcionário:

```bash
curl --cookie /tmp/tijucas-cookie.txt http://localhost:3000/properties
```

Não salve senha nem o arquivo temporário de cookie em local compartilhado. Apague-o ao terminar o teste.

### Ordem recomendada no dia da reunião

1. Confirme `DATABASE_URL`, `NODE_ENV`, provider e ambiente Asaas.
2. Execute `pnpm migrations:audit`; não migre o banco atual se tudo estiver coerente.
3. Execute `pnpm test`.
4. Reinicie o processo depois da última alteração no `.env`.
5. Prefira `pnpm start` durante a apresentação para evitar reinícios do Nodemon.
6. Aguarde a reconciliação e revise qualquer falha reportada.
7. Teste login, consulta autenticada, envio de e-mail, upload/download e, no perfil Asaas, criação e atualização por webhook.

## 12. Configuração correspondente do frontend

O frontend irmão usa somente esta variável para localizar o backend:

```dotenv
VITE_BACKEND_URL=http://localhost:3000
```

Em ambiente hospedado:

```dotenv
VITE_BACKEND_URL=https://URL-PUBLICA-DO-BACKEND
```

A origem real do frontend também precisa estar em `AllowedOrigins` no CORS do bucket S3.

Nunca copie variáveis secretas do backend para o `.env` do Vite.

O Express aceita credenciais somente das origens exatas listadas em `CORS_ORIGINS`. O CORS do bucket S3 é separado e também deve conter as origens reais do frontend.

## 13. Matriz de variáveis

| Variável | Necessidade | Default no código |
|---|---|---|
| `PORT` | Opcional | `3000` |
| `NODE_ENV` | Recomendada e obrigatória operacionalmente | Sem default; `production` bloqueia `FAKE` |
| `APP_TIMEZONE` | Opcional | `America/Sao_Paulo` |
| `DATABASE_URL` | Obrigatória | Nenhum |
| `DATABASE_CONNECTION_TIMEOUT_MS` | Opcional | `10000` |
| `DATABASE_IDLE_TIMEOUT_MS` | Opcional | `30000` |
| `SUPABASE_URL` | Obrigatória | Nenhum |
| `SUPABASE_SECRET_KEY` | Obrigatória | Nenhum |
| `JWT_SECRET` | Obrigatória | Nenhum |
| `JWT_EXPIRES_IN` | Opcional | `8h` |
| `JWT_ISSUER` | Opcional | `tijucas-imobiliaria` |
| `JWT_AUDIENCE` | Opcional | `tijucas-imobiliaria-app` |
| `AUTH_COOKIE_NAME` | Opcional | `tijucas_session` |
| `AUTH_COOKIE_SAME_SITE` | Opcional | `lax` |
| `CORS_ORIGINS` | Obrigatória em produção | Origens locais em desenvolvimento |
| `APP_TRUST_PROXY` | Necessária atrás de proxy confiável | `false` |
| `EMAIL_USER` | Obrigatória para e-mails | Nenhum |
| `EMAIL_PASS` | Obrigatória para e-mails | Nenhum |
| `AWS_REGION` | Obrigatória para arquivos | Nenhum |
| `AWS_ACCESS_KEY_ID` | Obrigatória para arquivos | Nenhum |
| `AWS_SECRET_ACCESS_KEY` | Obrigatória para arquivos | Nenhum |
| `AWS_S3_BUCKET` | Obrigatória para arquivos | Nenhum |
| `PAYMENT_GATEWAY_PROVIDER` | Obrigatória em produção | `FAKE` em desenvolvimento |
| `ASAAS_API_KEY` | Obrigatória com `ASAAS` | Nenhum |
| `ASAAS_API_URL` | Obrigatória em produção | Sandbox em desenvolvimento |
| `ASAAS_WEBHOOK_TOKEN` | Obrigatória para webhook Asaas | Nenhum; precisa ter 32–255 caracteres |
| `ASAAS_USER_AGENT` | Opcional | `TijucasImobiliaria/1.0` |
| `ASAAS_REQUEST_TIMEOUT_MS` | Opcional | `15000` |
| `ASAAS_ALLOW_BEST_EFFORT_CHARGE_CREATION` | Precisa ser `true` para criar cobranças Asaas | `false` efetivo |
| `BILLING_CRON_SCHEDULE` | Opcional | `0 6 * * *` |
| `BILLING_LOCK_TIMEOUT_MS` | Opcional | `10000` |
| `WEBHOOK_CRON_SCHEDULE` | Opcional | `*/30 * * * * *` |
| `WEBHOOK_BATCH_SIZE` | Opcional | `50`, máximo 500 |
| `WEBHOOK_MAX_ATTEMPTS` | Opcional | `8` |
| `WEBHOOK_BACKOFF_BASE_SECONDS` | Opcional | `30` |

## 14. Variáveis que não são usadas

Estas variáveis podem existir em arquivos antigos, mas não são consumidas pelo backend atual:

```text
SUPABASE_PUBLISHABLE_KEY
SUPABASE_JWKS_URL
EMAIL_PASSWORD
AWS_SESSION_TOKEN
AWS_KMS_KEY_ID
```

Observações:

- `EMAIL_PASSWORD` não substitui `EMAIL_PASS`.
- `AWS_SESSION_TOKEN` exigiria suporte a credenciais temporárias no cliente S3.
- `AWS_KMS_KEY_ID` exigiria alteração no `PutObjectCommand`; a criptografia padrão do bucket não depende dessa variável.

## 15. Checklist final para a reunião

- [ ] `.env` está fora do Git e com permissão restrita.
- [ ] Supabase URL, Secret key e `DATABASE_URL` pertencem ao mesmo projeto de teste.
- [ ] `pnpm migrations:audit` retorna migrations 001–008 como `true` e o histórico rastreado está coerente.
- [ ] `JWT_SECRET` foi gerado aleatoriamente.
- [ ] `CORS_ORIGINS` contém as origens exatas do frontend e não usa `*`.
- [ ] `AUTH_COOKIE_SAME_SITE` corresponde à topologia dos domínios.
- [ ] Gmail usa `EMAIL_PASS` com senha de app.
- [ ] Um e-mail real de teste foi recebido.
- [ ] Bucket S3 continua privado.
- [ ] A política IAM cobre os sete prefixos.
- [ ] CORS do S3 inclui a origem exata do frontend.
- [ ] Um upload e um download reais foram testados.
- [ ] `PAYMENT_GATEWAY_PROVIDER` corresponde ao tipo de demonstração.
- [ ] O provider não foi trocado no meio de um lote existente no mesmo banco.
- [ ] Chave e URL Asaas pertencem ao mesmo ambiente.
- [ ] Repasse ao proprietário continua manual enquanto transferências Asaas não estiverem homologadas.
- [ ] Webhook usa URL pública HTTPS e o mesmo token do `.env`.
- [ ] O backend foi reiniciado depois da última alteração no `.env`.
- [ ] O efeito da reconciliação imediata no startup foi revisado.
- [ ] `pnpm test` passa antes da reunião.
- [ ] Existe um usuário de demonstração com senha conhecida.
- [ ] O frontend aponta para a URL correta em `VITE_BACKEND_URL`.

## Referências no código

- Banco/Supabase: [`src/config/database.js`](../src/config/database.js)
- S3: [`src/config/storage.js`](../src/config/storage.js)
- Prefixos e URLs pré-assinadas: [`src/services/storage.service.js`](../src/services/storage.service.js)
- E-mail: [`src/services/email.service.js`](../src/services/email.service.js)
- JWT: [`src/utils/generateAuthToken.js`](../src/utils/generateAuthToken.js)
- Gateway: [`src/gateways/gatewayFactory.js`](../src/gateways/gatewayFactory.js)
- Asaas: [`src/gateways/asaasGateway.js`](../src/gateways/asaasGateway.js)
- Webhook Asaas: [`src/controllers/webhooks.controller.js`](../src/controllers/webhooks.controller.js)
- Crons: [`src/jobs/billingCron.js`](../src/jobs/billingCron.js) e [`src/jobs/webhookCron.js`](../src/jobs/webhookCron.js)
- Scripts: [`package.json`](../package.json)
