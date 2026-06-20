# Documentação de Bibliotecas do Projeto

Esta documentação detalha todas as bibliotecas e ferramentas de terceiros adicionadas ao projeto `TijucasImobiliariaBack` (encontradas no `package.json`), bem como a função que cada uma desempenha dentro da arquitetura da aplicação.

## Dependências Principais (Produção)

Essas bibliotecas são essenciais para o funcionamento em produção da aplicação e compõem o núcleo das funcionalidades da API.

| Biblioteca | Versão | Descrição e Propósito no Projeto |
| :--- | :--- | :--- |
| **`express`** | `^5.2.1` | **Framework Web**. É a base da aplicação, utilizado para gerenciar as rotas da API, receber requisições HTTP e enviar respostas para os clientes. Trata-se de um framework minimalista e altamente customizável. |
| **`@supabase/supabase-js`** | `^2.108.2` | **Client de Banco de Dados / BaaS**. Utilizamos o cliente nativo do Supabase para fazer toda a comunicação com nosso banco de dados PostgreSQL na nuvem (queries, inserts, updates, deletes). |
| **`argon2`** | `^0.44.0` | **Criptografia de Senhas**. Uma das bibliotecas mais seguras e modernas para a realização de *hashing* de senhas. É utilizada para armazenar senhas e códigos de verificação de maneira irreversível. |
| **`jsonwebtoken`** | `^9.0.3` | **Autenticação (JWT)**. Responsável por gerar e validar JSON Web Tokens. Esses tokens são usados em sessões de usuários para garantir que o usuário autenticado tenha acesso adequado e restrito. |
| **`zod`** | `^4.4.3` | **Validação de Dados**. Uma biblioteca orientada a tipos para criar esquemas de validação de dados de entrada. Na aplicação, ela assegura que os payloads enviados pelo usuário sejam estritamente válidos. |
| **`cors`** | `^2.8.6` | **Controle de Acesso Cross-Origin**. É um middleware de segurança para o Express. Ele permite configurar e gerenciar quais origens externas estão autorizadas a realizar requisições para a nossa API. |
| **`dotenv`** | `^17.4.2` | **Gerenciamento de Variáveis de Ambiente**. Responsável por ler o arquivo oculto `.env` na raiz do projeto e injetar seus valores em `process.env`. |
| **`nanoid`** | `^5.1.15` | **Gerador de IDs/Códigos únicos**. Utilizado para gerar códigos numéricos aleatórios rápidos e seguros (ex: Códigos de verificação de 6 dígitos) e chaves de objetos no S3. |
| **`nodemailer`** | `^9.0.1` | **Envio de E-mails (SMTP)**. Usado para conectar via SMTP e disparar e-mails transacionais (como verificação de conta ou redefinição de senha). |
| **`@aws-sdk/client-s3`** | `^3.1086` | **Armazenamento de Arquivos (S3)**. Cliente da AWS usado para documentos sensíveis (comprovante de renda do fiador, apólice do seguro fiança). O bucket é privado; o backend nunca recebe o arquivo. |
| **`@aws-sdk/s3-request-presigner`** | `^3.1086` | **URLs Pré-assinadas**. Gera URLs temporárias de upload (PUT) e download (GET) para o S3, permitindo que o front envie/leia o arquivo direto no bucket sem passar pela API. |

---

## Dependências de Desenvolvimento (Development)

Ferramentas que são utilizadas exclusivamente durante a fase de programação e desenvolvimento, não sendo necessárias para o aplicativo em produção.

| Biblioteca | Versão | Descrição e Propósito no Projeto |
| :--- | :--- | :--- |
| **`nodemon`** | `^3.1.14` | **Monitoramento e Reinicialização**. Uma ferramenta fundamental que escuta por alterações de arquivos dentro do projeto. Ao detectar alguma mudança, o Nodemon derruba o servidor e o reinicia automaticamente. |

---

## Como as Tecnologias Trabalham Juntas?

1. As requisições chegam via **`express`** e são logo interceptadas por **`cors`** (para controle de segurança de origens).
2. O corpo das requisições (dados do frontend) é validado utilizando esquemas definidos no **`zod`** dentro do Controller.
3. A camada de *Service* orquestra o fluxo de negócios, usando **`nanoid`** para gerar códigos e **`argon2`** para realizar hashes de proteção.
4. Qualquer e-mail necessário é disparado de forma assíncrona usando o **`nodemailer`**.
5. Finalmente, a comunicação com o banco de dados é feita de maneira direta via **`@supabase/supabase-js`** na camada de *Repository*. Tudo isso guiado pelas variáveis de proteção carregadas pelo **`dotenv`**.
