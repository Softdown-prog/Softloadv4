# Contas e arquivos

Firebase Authentication, banco Firestore existente e bucket de compilações permanecem os mesmos. Sessões ficam em `sessions`; contas mantêm seus IDs atuais em `clientes_premium`. Nenhuma coleção, arquivo, recibo ou volume é excluído pela limpeza do código.

A área de arquivos aplica a política existente de 5 MB gratuitos e 50 MB no Essencial, incluindo vencimento e aceite. Downloads e exclusões validam o prefixo `users/<uid>/` e usam a identidade da sessão. O histórico lista arquivos próprios, inclusive ZIPs de compilações antigas. Campos e documentos de versões anteriores podem permanecer armazenados sem exigir seus serviços antigos.

Segredos são configurados fora da imagem e do repositório. A exclusão de conta continua sendo uma ação explícita do cliente autenticado, com os controles existentes.
