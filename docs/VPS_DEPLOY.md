# Deploy Blogger — Angular e API na mesma VPS

O workflow `Deploy Softload VPS` valida o Angular, os tipos, scripts de navegador, compilador XML, contratos de sessão, testes e pagamentos. O build ocorre no GitHub, mas **frontend Angular e backend Express são implantados juntos na VPS**, dentro da imagem `softload-app:<commit>`. Não há outra imagem obrigatória nem deploy em Cloudflare Pages.

O artefato é criptografado e autenticado, vinculado a repositório, execução, SHA e serviço. O runner sem Docker/sudo o recebe por HTTPS, autentica antes de descriptografar e transfere pelo SSH local restrito. O receptor valida checksum e serializa transferência/ativação por lock. A retomada rsync usa checksum para reparar arquivos antigos do mesmo tamanho.

Contrato do receptor: `contract:v3` → `softload-deploy:v3:app`. `finish:app:<sha>:<sha256>` importa somente um arquivo regular verificado; `deploy:<sha>` atualiza somente o serviço App, valida saúde e reverte para a imagem anterior se falhar. O workflow confirma também o SHA servido em `/health`, as páginas Angular e um download real de XML.

O Caddy compartilhado na VPS continua como entrada HTTPS e reverse proxy do Softload. O mesmo container expõe frontend Angular compilado e APIs Express pela mesma origem; nenhuma porta ou origem pública adicional é necessária. Cloudflare, se usado, permanece como DNS/proxy e não hospeda o frontend.

Na VPS, os identificadores legados de Compose, rede, caminhos e volumes continuam preservados. A aplicação não administra o Painel VPS, o Caddy compartilhado nem outros projetos. A conta SSH de deploy continua limitada pelo forced-command; a API Docker não é publicada.

## Migração coordenada

O receptor híbrido já instalado aceita v3 antes do merge. A nova main deve passar em todos os checks, inclusive build/boot Docker e testes Linux do receptor. Após o deploy saudável e a confirmação do SHA público, substituir o receptor pelo v3 exclusivo, sob o mesmo lock, usando instalação atômica e checksum. Não instalar um receptor exclusivo antes de verificar o fim dos jobs v2 em andamento.

Não apagar dados, segredos ou volumes. Durante a ativação, manter a imagem anterior funcional para rollback. A limpeza posterior fica limitada a referências App não usadas, respeitando containers de outros projetos.
