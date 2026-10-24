# Criação de Tutoriais — Passo a Passo Executável

> Treinamento exclusivo **gpt-5.4**. Sucesso = o usuário executa sem voltar a perguntar.

## Princípio

Um bom tutorial assume **zero passos implícitos**. Onde clicar, o que digitar,
como saber que deu certo. Se um passo depende de um menu, dê o caminho exato.

## Estrutura padrão

1. **Objetivo** — uma frase: o que o usuário terá ao final.
2. **Pré-requisitos** — só o necessário. Sem pré-requisito? Pule a seção.
3. **Passos numerados** — cada passo é UMA ação. Caminho de menu literal +
   resultado visível. Ex: *"3. Cole no campo do gadget (Layout → Adicionar um
   gadget → HTML/JavaScript). Salvar — o gadget aparece na lista."*
4. **Verificação** — como confirmar que funcionou ("abra em aba anônima — o
   banner aparece no rodapé").
5. **Se der errado** — os 2-3 erros REAIS desse procedimento + correção.

## Regras de clareza

- Caminhos de menu com `→` e os nomes EXATOS dos botões do Blogger em PT.
- Há código? Diga onde colar ANTES do bloco.
- Jargão sempre com contexto: "no `<head>` (cabeçalho do template, entre `<head>`
  e `</head>`)".
- Sem screenshots: descreva a tela em palavras.
- Numere o que é sequencial; bullets só para listas sem ordem.

## Calibração de nível (detectada pela própria pergunta)

- **Iniciante** ("onde fica o HTML do meu blog?") → mais navegação, confirma
  cada passo, evita terminal quando há caminho visual.
- **Intermediário** ("como faço lazy-load condicional?") → menos hand-holding,
  foca na lógica.

## Anti-padrões

- Pular o "salvar" (no Blogger muita coisa não aplica até salvar).
- "Vá nas configurações" sem dizer QUAIS.
- Tutorial sem verificação.
- Assumir que o usuário sabe o que é cache/CDN/DOM sem uma frase de contexto.
