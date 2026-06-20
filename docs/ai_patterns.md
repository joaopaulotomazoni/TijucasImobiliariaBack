# Padrões Arquiteturais e Diretrizes para IAs

Este documento contém as instruções que devem ser seguidas por qualquer Inteligência Artificial (ou novo desenvolvedor) ao escrever ou dar manutenção no código do projeto **TijucasImobiliariaBack**. O objetivo é manter o código 100% padronizado.

## 1. Arquitetura (Camadas)

A aplicação segue uma arquitetura em camadas clássica (MVC/Layered Pattern). Nenhuma responsabilidade deve ser misturada entre as camadas.

- **Routes (`src/routes`)**: Apenas mapeiam os endpoints HTTP para os métodos do Controller. Nenhuma lógica de negócio ou validação acontece aqui.
- **Controllers (`src/controllers`)**:
  - Recebem o `request`, `response` e `next`.
  - São os ÚNICOS responsáveis por utilizar o **Zod** para validar o corpo da requisição (`req.body`).
  - Passam os dados validados para os *Services*.
  - Retornam a resposta final para o cliente em formato JSON padrão: `{ status: 'success', message: '...', data: {} }`.
  - Devem SEMPRE ser envolvidos em blocos `try/catch`, repassando qualquer erro capturado usando `next(error)`.
- **Services (`src/services`)**:
  - Contêm toda a **Lógica de Negócio** (regras, geração de hashes, fluxos de envio de e-mail).
  - Nunca devem conhecer objetos do Express (`req`, `res`).
  - Devem disparar (throw) o `AppError` quando algo violar a regra de negócio (ex: "E-mail já cadastrado").
  - Consomem um ou mais *Repositories* ou integrações externas (como o *EmailService*).
- **Repositories (`src/repositories`)**:
  - Os únicos arquivos autorizados a importar e usar o `supabase`.
  - Devem se limitar estritamente a queries no banco de dados (Insert, Update, Select, Delete).
  - Se der erro na query do banco, devem dar `throw new Error(error.message)`.

## 2. Padrões de Código e Tratamento de Erros

- **Erros de Negócio**: Sempre lance a classe customizada `AppError`.
  - Exemplo: `throw new AppError('Usuário não encontrado', 404);`
- **Erros do Controller**: O Controller sempre usará `next(error)` no `catch`, delegando para o Middleware central (`errorHandler.js`), que formata o erro adequadamente para o Frontend.
- **Retornos de API (JSON)**:
  - Sucesso: `return response.status(200).json({ status: 'success', message: '...', data: {} })`
  - A resposta final NÃO devolve dados sensíveis (nunca devolver hashes de senhas).

## 3. Serviços e Utilitários (Clean Code)

- **Serviços de E-mail (`EmailService`)**: Devem ser tratados como integrações. Possuem um disparador base (`sendMail`) que isola o Nodemailer, e métodos em "template" que preenchem o assunto e HTML.
- **Funções Utilitárias (`src/utils`)**: Qualquer algoritmo independente (ex: geração de códigos aleatórios com `nanoid`) deve ser extraído para a pasta `utils` para promover reaproveitamento.
- **Criptografia (`argon2`)**:
  - Deve ser feita SOMENTE na camada de *Service*.
  - Utiliza `argon2.hash()` para salvar no banco.
  - Utiliza `argon2.verify()` para checar senhas ou códigos.

## 4. Banco de Dados (Supabase)

- **Estrutura atual**: A fonte da verdade do schema (tabelas, constraints, índices, triggers) está em [`docs/database_schema.sql`](./database_schema.sql). Esse arquivo é atualizado conforme o projeto evolui — sempre consulte-o antes de escrever queries novas ou assumir nomes de coluna, e atualize-o quando uma migration alterar o banco.
- **Instância**: Utilize a instância única exportada por `src/config/database.js`.
- **Selects Otimizados**: Sempre utilize `.select('coluna1, coluna2')` explicitando os campos em vez de trazer o registro inteiro, a menos que necessário.
- **Desestruturação**: Cuidado com o retorno do Supabase. Um `.insert()` ou `.update()` seguido de um `.select()` retorna um `Array`. Extraia o objeto primário: `const user = data[0]`. Métodos combinados com `.maybeSingle()` já retornam o objeto limpo.

*IA, ao ser questionada sobre a arquitetura ou solicitada a implementar novas *features*, LEIA este documento obrigatoriamente antes de gerar código.*
