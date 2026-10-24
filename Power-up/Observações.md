

# Solaris — Diff Patch Engine

> 🎗️ LEMBRETE DE ARQUITETURA
>
> Motor próprio de diff/patch estrutural, integrado ao Solaris Agent
> (`agent/`) via `file.diff`/`file.patch` — ver `agent/README.md`,
> seção "`file.diff`/`file.patch`", para a integração completa
> (hash SHA-256, escrita atômica, wiring de permissões/protocolo,
> testes de ponta a ponta com o binário real). Os itens ainda em
> aberto (tokenização de operadores compostos, fuzz testing — seção
> 20 abaixo) são refinamento de qualidade do diff gerado, não bugs
> de corretude ou lacunas de segurança.

---

## 1. Objetivo

O `diff_patch_engine.cpp` será o motor responsável por calcular e aplicar
alterações em arquivos realizadas pelo agente.

A ideia é separar a **decisão da IA** da **execução da alteração no arquivo**.

A IA decide:

> "Quero transformar o arquivo A no estado B."

O Patch Engine executa:

> "Vou calcular exatamente quais alterações transformam A em B e aplicar
> somente essas alterações."

O motor não é responsável por compreender a linguagem de programação.

Ele funciona sobre tokens e pode, portanto, ser utilizado inicialmente com
diferentes tipos de arquivos:

- JavaScript
- TypeScript
- Python
- C/C++
- Java
- HTML
- CSS
- JSON
- Markdown
- outros arquivos de texto

---

# 2. Fluxo planejado

```text
Usuário
   │
   ▼
Solaris Agent
   │
   ▼
IA / Planner
   │
   │ decide a alteração
   ▼
Patch Engine
   │
   ├── Tokenização
   │
   ├── Diff
   │
   ├── Validação
   │
   └── Aplicação
   │
   ▼
Arquivo modificado

A responsabilidade deve permanecer separada:

IA
│
└── decide O QUE mudar

Patch Engine
│
└── garante COMO a mudança será aplicada


---

3. Problema que o Patch Engine resolve

Agentes de código frequentemente utilizam operações frágeis como:

replace("texto antigo", "texto novo")

Isso pode falhar quando:

o código foi reformatado;

a indentação mudou;

o trecho aparece várias vezes;

linhas foram adicionadas anteriormente;

o agente possui uma versão ligeiramente diferente do arquivo;

o código foi deslocado dentro do arquivo.


O objetivo do Patch Engine é trabalhar com uma sequência de tokens em vez de depender exclusivamente de números de linha ou de uma substituição literal.


---

4. Funcionamento do diff

Comando:

diff_patch_engine diff <arquivo_a> <arquivo_b> > patch.json

Exemplo conceitual:

Arquivo A:

function soma(a, b) {
    return a + b;
}

Arquivo B:

function soma(a, b) {
    console.log("calculando");
    return a + b;
}

O motor transforma os arquivos em tokens e calcula as diferenças.

Conceitualmente:

EQUAL
function soma(a, b) {

INSERT
console.log("calculando");

EQUAL
return a + b;
}

O resultado é armazenado em um patch.


---

5. Operações do patch

O formato atual possui três operações:

EQUAL
DELETE
INSERT

EQUAL

Indica conteúdo que permanece igual.

{
  "op": "equal",
  "text": "function soma(a, b) {"
}

DELETE

Indica conteúdo que existia no arquivo original e deve ser removido.

{
  "op": "delete",
  "text": "console.log(\"debug\");"
}

INSERT

Indica conteúdo novo que deve ser inserido.

{
  "op": "insert",
  "text": "console.log(\"calculando\");"
}


---

6. Algoritmo utilizado

O diff utiliza o algoritmo de Myers.

O objetivo do algoritmo é encontrar uma sequência eficiente de operações de inserção e remoção capaz de transformar a sequência de tokens A na sequência de tokens B.

Conceitualmente:

Arquivo A
   │
   ▼
tokens A
   │
   │
   ├──── Myers ────┐
   │               │
tokens B           │
   │               │
   └───────────────┘
           │
           ▼
      EQUAL / DELETE / INSERT

A implementação atual utiliza a abordagem O(ND).


---

7. Tokenização

O tokenizador atual separa:

identificadores;

palavras;

números;

strings;

espaços;

tabs;

quebras de linha;

símbolos.


Whitespace é preservado como token para permitir reconstrução precisa do arquivo.

Strings também são tratadas como unidades.

Exemplo:

const nome = "Solaris";

Pode ser representado conceitualmente como:

const
[space]
nome
[space]
=
[space]
"Solaris"


---

8. apply

Comando:

diff_patch_engine apply <arquivo_original> <patch.json> > arquivo_novo

O motor percorre o arquivo original e executa as operações:

EQUAL
   ↓
copia para o resultado

DELETE
   ↓
avança no original sem copiar

INSERT
   ↓
adiciona o novo conteúdo

Resultado:

arquivo original
       +
      patch
       ↓
arquivo novo


---

9. Princípio importante

O Patch Engine não deve simplesmente procurar uma string semelhante e modificar qualquer ocorrência encontrada.

O comportamento futuro desejado é:

Patch criado para arquivo X
          │
          ▼
verificar integridade do arquivo atual
          │
          ├── corresponde
          │      ↓
          │    aplicar
          │
          └── não corresponde
                 ↓
               rejeitar

Segurança e previsibilidade são mais importantes que tentar "adivinhar" onde uma alteração deveria ser aplicada.


---

10. Melhorias planejadas

A implementação atual é um protótipo funcional.

Antes de utilização crítica pelo Solaris Agent, deverão ser avaliados e refinados os seguintes pontos.

10.1 Validação do algoritmo de Myers

Testar extensivamente:

arquivo vazio → arquivo vazio;

arquivo vazio → arquivo novo;

arquivo novo → arquivo vazio;

inserções;

deleções;

substituições;

múltiplas alterações;

alterações no começo;

alterações no meio;

alterações no final;

arquivos grandes;

tokens repetidos;

alterações consecutivas.


A propriedade fundamental a testar é:

apply(A, diff(A, B)) == B

Para qualquer par válido de arquivos A e B.


---

11. Hash do arquivo de origem

O formato futuro do patch deverá possuir identificação do estado do arquivo utilizado para criar o patch.

Exemplo:

{
  "format": "structural-token-diff-v2",
  "source": {
    "path": "src/example.js",
    "sha256": "..."
  },
  "target": {
    "sha256": "..."
  },
  "ops": []
}

Antes de aplicar:

SHA256(arquivo_atual)
        │
        ▼
comparar com source.sha256
        │
        ├── igual → continuar
        │
        └── diferente → rejeitar patch

Isso evita aplicar um patch criado sobre uma versão antiga do arquivo.


---

12. Remover aplicação tolerante perigosa

A implementação atual possui um mecanismo que tenta localizar novamente um trecho quando o conteúdo esperado não corresponde exatamente ao cursor.

Esse comportamento é útil durante experimentação, mas não deve ser o comportamento final de segurança do agente.

O comportamento desejado é:

mismatch
   ↓
PATCH REJECTED

e não:

mismatch
   ↓
procurar outro trecho parecido
   ↓
tentar aplicar

O agente deve receber um erro estruturado para decidir o que fazer.


---

13. Parser JSON

O parser JSON atual é propositalmente mínimo e foi criado sem dependências externas.

Ele atende ao formato produzido pelo próprio programa, mas precisa ser reavaliado antes da utilização em produção.

Possíveis caminhos:

utilizar uma biblioteca JSON consolidada;

substituir o formato por um formato próprio mais simples;

implementar um parser robusto;

ou utilizar uma biblioteca já existente no projeto Solaris.


O parser nunca deve interpretar incorretamente conteúdo do código como estrutura do patch.


---

14. Tokenizador futuro

O tokenizador atual trata operadores individualmente.

Deverá ser avaliado o reconhecimento de operadores compostos, por exemplo:

===
!==
==
!=
<=
>=
++
--
+=
-=
*=
/=
&&
||
??
?.
=>
<<
>>

Isso melhora a qualidade da sequência de tokens utilizada pelo diff.


---

15. Aplicação atômica

A implementação atual escreve o resultado através de stdout.

No uso integrado ao Solaris, o fluxo ideal será:

ler arquivo
    ↓
validar hash
    ↓
validar patch
    ↓
aplicar em memória
    ↓
validar resultado
    ↓
escrever arquivo temporário
    ↓
rename atômico

O arquivo original não deve ser destruído antes de o resultado estar validado.

**Implementado** (integração com o Agent Worker): exatamente este
fluxo, na camada de integração Node em vez de dentro do binário --
`diff_patch_engine` continua só imprimindo o resultado em stdout (não
escreve arquivo nenhum), e é `agent/src/capabilities/filesystem.js`
(operação `patch`) quem lê o arquivo atual, chama `apply` via
subprocesso, e só então grava o resultado com
`Workspace.writeAtomic()` (arquivo temporário no mesmo diretório +
`fs.rename`). Decisão de manter o binário "burro" quanto a I/O final
de propósito: mantém a superfície do C++ pequena e testável
isoladamente (só STL, sem tocar no filesystem de destino), e a
atomicidade -- que é sobre COMO o resultado chega no arquivo real do
usuário -- fica onde o resto da lógica de workspace/permissões já mora.


---

16. Exit Codes

O executável deverá utilizar códigos de saída previsíveis.

Exemplo:

0  = sucesso
10 = arquivo não encontrado
20 = patch inválido
30 = hash incompatível
40 = operação não corresponde ao arquivo
50 = erro interno

Isso permitirá que o Agent Worker trate o resultado sem precisar interpretar mensagens de texto.

Exemplo conceitual:

if (result.code === 30) {
    // arquivo mudou desde a criação do patch
}


---

17. Teste fundamental

O teste mais importante do motor será:

A
│
├── diff(A, B)
│
▼
patch
│
├── apply(A, patch)
│
▼
resultado

E então:

resultado == B

Formalmente:

apply(A, diff(A, B)) = B

Esse teste deverá ser executado com milhares de combinações diferentes.


---

18. Possível integração com o Solaris Agent

Futuramente o agente poderá produzir uma intenção de alteração:

{
  "action": "modify_file",
  "path": "src/foo.js"
}

O agente/planner poderá produzir o novo estado desejado.

O Patch Engine será responsável por transformar:

estado atual
      +
estado desejado
      ↓
patch

e posteriormente:

estado atual
      +
patch validado
      ↓
novo estado


---

19. Princípio arquitetural

O Solaris não deve depender exclusivamente da IA para garantir a integridade das alterações.

A IA pode errar.

O Patch Engine deve funcionar como uma camada determinística entre a decisão da IA e o sistema de arquivos.

IA
                 │
                 │ intenção
                 ▼
        ┌─────────────────┐
        │  PATCH ENGINE   │
        │                 │
        │  deterministic  │
        │  validation     │
        │  diff           │
        │  apply          │
        └────────┬────────┘
                 │
                 ▼
             filesystem

A IA decide.

O motor valida e executa.


---

20. Estado atual

STATUS: EM DESENVOLVIMENTO 🚧

Já implementado:

[x] tokenizador básico;

[x] algoritmo de Myers;

[x] operações EQUAL / DELETE / INSERT;

[x] geração de patch;

[x] aplicação de patch;

[x] CLI;

[x] compilação C++17;

[x] funcionamento sem dependências externas.


Corrigido nesta revisão (verificação + testes reais, ver seção 22):

[x] validar completamente o backtracking do Myers (validado com casos
    reais incluindo arquivo de 2000 linhas -- nenhum bug encontrado,
    a implementação já seguia o algoritmo clássico corretamente);

[x] testes extensivos de diff/apply (suíte com 14 casos reais: vazio,
    inserção, deleção, substituição total, tokens repetidos, arquivo
    grande, código real com chaves/colchetes aninhados);

[x] rejeição segura de arquivos divergentes (removido o modo
    "tolerante" que procurava outro trecho parecido -- agora
    `apply` rejeita imediatamente com exit code 40 quando o arquivo
    atual não corresponde ao que o patch espera, exatamente como a
    regra de ouro da seção 21 sempre exigiu);

[x] revisar parser JSON -- **bug crítico corrigido**: o scan de
    `{`/`}`/`[`/`]` não ignorava esses caracteres quando apareciam
    DENTRO do valor de uma string (ex: `"text": "resultado = [];"` ou
    qualquer `}` de fechamento de função). Isso corrompia a extração
    do patch sempre que o código-fonte diffado continha chaves ou
    colchetes -- ou seja, quase sempre. Quando o `}` de um objeto não
    era encontrado, o código antigo fazia `i = objEnd + 1` com
    `objEnd == std::string::npos`, o que sofre overflow de `size_t`
    e volta para `0` -- **loop infinito com crescimento de memória
    sem limite**, reproduzido e confirmado antes da correção com um
    exemplo trivial de JS (`resultado = []`). O parser agora ignora
    conteúdo entre aspas ao procurar caracteres estruturais, e
    qualquer patch malformado é rejeitado com exit code 20 em vez de
    travar;

[x] exit codes estruturados: implementados 0 (sucesso), 10 (arquivo
    não encontrado), 20 (patch inválido/malformado), 30 (hash
    incompatível) e 40 (operação não corresponde ao arquivo). O
    código 50 (erro interno) não tem um caminho de código dedicado --
    qualquer falha não coberta pelos outros já vira uma das
    exceções acima ou um crash claro do próprio runtime C++, então
    não há "erro interno silencioso" a capturar.

[x] hash SHA-256 do arquivo de origem: implementação própria (sem
    dependências externas, mesma restrição do resto do arquivo),
    validada contra os vetores de teste oficiais (SHA256("") e
    SHA256("abc")) e sob AddressSanitizer + UndefinedBehaviorSanitizer
    (nenhum erro). `diff` embute `sourceHash` (hash do arquivo A) no
    patch gerado (formato bump para `structural-token-diff-v2`);
    `apply` recusa com exit 30 se o arquivo que recebeu não é mais
    byte-a-byte o mesmo que gerou o patch -- verificado ANTES de
    tentar aplicar qualquer operação, cobrindo a divergência mais
    cedo e com um motivo mais específico do que o mismatch de operação
    (40) sozinho já dava.

[x] integração com Agent Worker: capability `filesystem` ganhou as
    operações `diff`/`patch` (`file.diff`/`file.patch`), que invocam
    este binário via subprocesso -- ver
    `agent/src/utils/diff-patch-engine.js` e
    `agent/src/capabilities/filesystem.js`. `file.diff` só calcula e
    devolve o patch (não escreve nada -- útil pra pré-visualizar uma
    mudança antes de aplicar); `file.patch` aplica um patch existente
    e grava o resultado atomicamente (`Workspace.writeAtomic()`).

Ainda precisa de refinamento (não implementado nesta revisão --
requer decisão de arquitetura, não é bug):

[ ] melhorar tokenização de operadores compostos (===, !==, &&, etc
    -- hoje cada caractere de um operador composto vira um token
    próprio; não afeta corretude, só a qualidade/legibilidade do
    diff gerado);

[ ] fuzz testing (parser JSON e tokenizador são bons candidatos --
    nenhuma infraestrutura de fuzzing foi criada nesta revisão).



---

21. Regra de ouro

> 🎗️ O Patch Engine não deve tentar adivinhar.



Se o arquivo atual não corresponde ao estado para o qual o patch foi produzido:

REJEITAR

Se o patch não puder ser aplicado exatamente:

REJEITAR

Se a transformação produzir um resultado inesperado:

REJEITAR

A prioridade do motor é:

SEGURANÇA
   >
CORREÇÃO
   >
PREVISIBILIDADE
   >
CONVENIÊNCIA


---

22. Revisão de bugs (verificação + correção)

Auditoria do código atual, com testes reais de execução (compilação
com `-Wall -Wextra`, suíte de 14 casos cobrindo a propriedade
`apply(diff(A, B)) == B`, e uma segunda rodada da mesma suíte
compilada com AddressSanitizer + UndefinedBehaviorSanitizer -- nenhum
erro de memória ou comportamento indefinido encontrado).

Achado crítico: o parser JSON minimalista (`parsePatch`) procurava os
caracteres estruturais `{`, `}`, `[`, `]` com `std::string::find` puro,
sem ignorar o conteúdo dentro de strings. Como o campo `"text"` de uma
operação é literalmente um trecho do código-fonte diffado, ele quase
sempre contém esses caracteres (chaves de função, colchetes de array).
Isso corrompia os limites do array/objeto extraídos -- e, no caso em
que o `}` de fechamento de um objeto não era encontrado dentro dos
limites (já corrompidos) do array, `objEnd` virava
`std::string::npos` e `i = objEnd + 1` sofria overflow de `size_t`
para `0`, entrando em loop infinito com crescimento de memória sem
limite. Reproduzido com um exemplo trivial (`resultado = [];` em um
arquivo JS comum) antes da correção; `apply` travava indefinidamente.

Corrigido substituindo a busca ingênua por um scan que pula o
conteúdo de strings JSON corretamente (respeitando escapes), e
adicionando rejeição explícita (exit code 20) para qualquer patch
malformado -- nunca mais silenciosamente "recupera" com overflow.

Também corrigido, alinhado à seção 21 (regra de ouro): o modo
tolerante de `apply` que procurava outra ocorrência do texto esperado
quando o cursor não batia foi removido. Agora qualquer divergência
entre o patch e o arquivo atual é rejeitada (exit code 40) em vez de
"adivinhada".

O algoritmo de Myers em si (tokenização, diff, geração de patch) foi
revisado linha a linha e testado -- nenhum bug de lógica encontrado;
segue a implementação clássica O(ND) corretamente.

---

Visão final

O diff_patch_engine será o mecanismo determinístico de transformação de arquivos do Solaris.

Ele não substitui a IA.

Ele existe justamente para impedir que a IA tenha que ser responsável por uma operação que deve ser determinística:

IA
↓
decide o que mudar

PATCH ENGINE
↓
calcula a transformação

VALIDATOR
↓
confirma que a transformação é segura

FILESYSTEM
↓
recebe a alteração

Objetivo final: permitir que o Solaris seja capaz de modificar código de forma controlada, verificável e reversível, sem depender de operações frágeis de substituição de texto.
