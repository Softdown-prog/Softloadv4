# Softload V4 — revisão de experiência SaaS (28/10/2026)

## Objetivo
Apresentar a Softload como um serviço online compreensível para pessoas sem experiência em programação, com comunicação simples, cobrança transparente e caminhos claros para criar e administrar projetos. Manter os nomes próprios das ferramentas (Solaris Code e Especialista Blogger), as rotas atuais e os contratos com o backend.

## Lote 1 — PR de linguagem e onboarding
- Cadastro: título e CTA simples, campos legíveis, avisos de senha claros e links para Termos e Privacidade. Preserva POST nativo, validação de senha, rate limiting e redirecionamento do backend.
- Landing: explicação do que é possível fazer, seção **Como começar** em três passos e acesso ao cadastro. Nenhuma promessa nova de funcionalidade foi acrescentada.
- Painel: "Projetos e modelos" para o Workspace, "Modelos gerados" para o histórico XML e estatística de tentativas de geração descrita como tentativa, não como entrega concluída.
- Conta: descrição dos recursos do plano sem sugerir que qualquer assinatura ativa dá acesso a **todos** os recursos.
- Navegação pública: primeiro uso destacado, sem alterar rotas privadas.
- Teste de regressão protege cópias essenciais do cadastro e os links de onboarding.

## Pendências priorizadas — não implementadas neste lote

### P0 — Confiabilidade da operação
1. Confirmar que a revisão ativa na VPS corresponde ao commit aprovado pela CI, não apenas ao workflow bem-sucedido.
2. Conciliar as issues antigas de deploy #20 e #21 com o mecanismo de entrega atual e fechar somente se a causa estiver resolvida.
3. Verificar contratos reais de créditos, cobrança, checkout Mercado Pago e webhook antes de mudar valores ou promessas comerciais. Evitar débito duplicado entre as ferramentas.
4. Conferir a segurança da sessão, reset de senha e validação do cadastro em ambiente de homologação.

### P1 — Fluxo comercial completo
1. Criar uma página pública de **Planos e preços**: gratuita + Starter, Pro e Studio, usando a mesma fonte de dados da página de upgrade e do backend. Evitar tabelas duplicadas e preços divergentes.
2. Exibir de forma compreensível o que cada plano habilita: Solaris, Blogger, projetos/modelos, limites de créditos e armazenamento. Apresentar regras de ciclo e expiração antes de comprar.
3. Criar um fluxo pós-cadastro que ajude a escolher a primeira ferramenta. Preservar três áreas distintas: Solaris Code, Especialista Blogger e Editor/Workspace.
4. Exibir checkout pendente/confirmado e estado real da assinatura, sem afirmar ativação antes do webhook ou confirmação do servidor.

### P2 — Qualidade visual, acessibilidade e manutenção
1. Normalizar estilo e escala de textos (labels devem ter tamanho legível; reduzir caixa alta e jargão técnico).
2. Revisar estados vazios, carregamento, erro e mensagens de ajuda no dashboard, no histórico e nos três chats.
3. Uniformizar contato, termos, privacidade, 404 e páginas React/EJS ainda coexistentes.
4. Auditar responsividade, teclado, foco, contraste e comportamento mobile.
5. Centralizar a terminologia da interface num glossário de UX, mantendo nomes técnicos só onde necessários.

## Critérios para considerar a experiência pronta para lançamento
- Um visitante entende em poucos segundos o que a Softload faz e como se cadastrar.
- Uma pessoa sem conhecimento técnico consegue entrar, abrir a primeira ferramenta e compreender seus limites.
- Preço, recursos, assinatura ativa e créditos exibidos conferem com o backend.
- Login, cadastro, recuperação, logout, pagamentos e criação de projetos passam em testes.
- Build, gate TypeScript, testes e deploy de homologação aprovados; versão publicada conferida visualmente.
- Nenhuma alteração de texto mascara recurso indisponível, erro de cobrança ou estado de publicação.

> Este documento é uma trilha de evolução, não uma afirmação de que os itens P0/P1/P2 já foram concluídos.
