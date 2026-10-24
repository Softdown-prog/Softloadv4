// diff_patch_engine.cpp
//
// Motor de diff/patch ESTRUTURAL (baseado em tokens, não em linhas).
// Usa o algoritmo de Myers (O(ND)) sobre uma sequência de tokens do arquivo,
// o que dá muito mais precisão que diff linha-a-linha para patches gerados
// por um agente de código (evita o clássico erro de "string não encontrada"
// quando o agente reformata ou desloca poucas linhas).
//
// Uso:
//   diff_patch_engine diff  <arquivo_a> <arquivo_b> > patch.json
//   diff_patch_engine apply <arquivo_original> <patch.json> > arquivo_novo
//
// O patch (formato "structural-token-diff-v2") embute o SHA-256 do
// arquivo A -- `apply` recusa (exit 30) se o arquivo original que
// recebeu já não é mais byte-a-byte o mesmo que gerou o patch, ANTES
// de tentar aplicar qualquer operação.
//
// Exit codes (ver Observações.md item 16):
//   0  sucesso
//   10 arquivo não encontrado
//   20 patch inválido/malformado (JSON, campo ausente, op desconhecida)
//   30 hash do arquivo de origem não confere -- arquivo mudou desde o diff
//   40 operação não corresponde ao conteúdo atual do arquivo
//
// Compilar:
//   g++ -std=c++17 -O2 -o diff_patch_engine diff_patch_engine.cpp
//
// Sem dependências externas (só STL) -- fácil de rodar em container Cloud Run.

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

// ---------------------------------------------------------------------------
// 0. SHA-256 (implementação própria, sem dependências externas -- mesma
//    restrição do resto do arquivo, ver cabeçalho acima)
//
// Usado para embutir, no patch gerado por `diff`, o hash do conteúdo
// ORIGINAL (arquivo A) -- e, em `apply`, conferir que o arquivo que está
// sendo modificado ainda é byte-a-byte o mesmo que gerou o patch, ANTES
// de gastar tempo validando/aplicando as operações token a token. Sem
// isso, dois patches gerados a partir do mesmo arquivo em momentos
// diferentes (ex: dois agentes editando o mesmo arquivo em paralelo)
// poderiam se aplicar um por cima do outro silenciosamente, cada um
// achando que o arquivo ainda está no estado esperado -- exatamente o
// tipo de "adivinhação" que a regra de ouro do projeto (seção 21 do
// Observações.md) proíbe. Implementação padrão FIPS 180-4, testada
// contra os vetores de teste oficiais (SHA256("") e SHA256("abc")).
// ---------------------------------------------------------------------------

namespace sha256_impl {

static inline uint32_t rotr(uint32_t x, uint32_t n) {
    return (x >> n) | (x << (32 - n));
}

static const uint32_t K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

} // namespace sha256_impl

// Calcula o SHA-256 de `data` e devolve os 64 caracteres hexadecimais
// (minúsculo), formato padrão pra comparação/serialização em JSON.
static std::string sha256Hex(const std::string& data) {
    using namespace sha256_impl;

    uint32_t h[8] = {
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    };

    // Pré-processamento: mensagem original + bit "1" (0x80) + zeros até
    // sobrar exatamente 8 bytes no último bloco de 64 + o comprimento
    // original em bits, big-endian, nesses 8 bytes finais.
    std::string msg = data;
    uint64_t bitLen = static_cast<uint64_t>(data.size()) * 8ULL;
    msg += static_cast<char>(0x80);
    while (msg.size() % 64 != 56) msg += static_cast<char>(0x00);
    for (int i = 7; i >= 0; i--) {
        msg += static_cast<char>((bitLen >> (i * 8)) & 0xff);
    }

    for (size_t chunk = 0; chunk < msg.size(); chunk += 64) {
        uint32_t w[64];
        for (int i = 0; i < 16; i++) {
            const unsigned char* p =
                reinterpret_cast<const unsigned char*>(msg.data() + chunk + i * 4);
            w[i] = (static_cast<uint32_t>(p[0]) << 24) |
                   (static_cast<uint32_t>(p[1]) << 16) |
                   (static_cast<uint32_t>(p[2]) << 8) |
                   (static_cast<uint32_t>(p[3]));
        }
        for (int i = 16; i < 64; i++) {
            uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
            uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16] + s0 + w[i - 7] + s1;
        }

        uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
        uint32_t e = h[4], f = h[5], g = h[6], hh = h[7];

        for (int i = 0; i < 64; i++) {
            uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            uint32_t ch = (e & f) ^ ((~e) & g);
            uint32_t temp1 = hh + S1 + ch + K[i] + w[i];
            uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
            uint32_t temp2 = S0 + maj;

            hh = g; g = f; f = e; e = d + temp1;
            d = c; c = b; b = a; a = temp1 + temp2;
        }

        h[0] += a; h[1] += b; h[2] += c; h[3] += d;
        h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }

    static const char* hexDigits = "0123456789abcdef";
    std::string out;
    out.reserve(64);
    for (int i = 0; i < 8; i++) {
        for (int shift = 28; shift >= 0; shift -= 4) {
            out += hexDigits[(h[i] >> shift) & 0xf];
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// 1. Tokenizador
//
// Quebra o texto em tokens "significativos": identificadores/palavras,
// números, operadores/símbolos e blocos de espaço em branco (whitespace
// vira token próprio para preservar indentação exata na hora de aplicar).
// ---------------------------------------------------------------------------

struct Token {
    std::string text;
    bool operator==(const Token& other) const { return text == other.text; }
};

static std::vector<Token> tokenize(const std::string& src) {
    std::vector<Token> tokens;
    size_t i = 0, n = src.size();

    auto isIdentChar = [](char c) {
        return std::isalnum(static_cast<unsigned char>(c)) || c == '_';
    };

    while (i < n) {
        char c = src[i];

        if (c == ' ' || c == '\t') {
            size_t start = i;
            while (i < n && (src[i] == ' ' || src[i] == '\t')) i++;
            tokens.push_back({src.substr(start, i - start)});
            continue;
        }
        if (c == '\n' || c == '\r') {
            size_t start = i;
            while (i < n && (src[i] == '\n' || src[i] == '\r')) i++;
            tokens.push_back({src.substr(start, i - start)});
            continue;
        }
        if (isIdentChar(c)) {
            size_t start = i;
            while (i < n && isIdentChar(src[i])) i++;
            tokens.push_back({src.substr(start, i - start)});
            continue;
        }
        if (c == '"' || c == '\'' || c == '`') {
            // string literal: captura até o fechamento (com escape simples)
            char quote = c;
            size_t start = i;
            i++;
            while (i < n && src[i] != quote) {
                if (src[i] == '\\' && i + 1 < n) i++;
                i++;
            }
            if (i < n) i++;  // consome a aspa final
            tokens.push_back({src.substr(start, i - start)});
            continue;
        }
        // símbolo isolado (operadores, pontuação, chaves, etc.)
        tokens.push_back({std::string(1, c)});
        i++;
    }
    return tokens;
}

// ---------------------------------------------------------------------------
// 2. Algoritmo de Myers (diff de menor edição) sobre a lista de tokens
//
// Produz uma sequência de operações: EQUAL, DELETE, INSERT.
// ---------------------------------------------------------------------------

enum class OpType { EQUAL, DELETE, INSERT };

struct EditOp {
    OpType type;
    std::vector<Token> tokens;  // tokens envolvidos na operação
};

// Implementação O(ND) clássica de Myers, com backtrack para reconstruir o path.
static std::vector<EditOp> myersDiff(const std::vector<Token>& a,
                                      const std::vector<Token>& b) {
    int N = static_cast<int>(a.size());
    int M = static_cast<int>(b.size());
    int MAX = N + M;
    if (MAX == 0) return {};

    std::vector<std::vector<int>> trace;
    std::vector<int> V(2 * MAX + 1, 0);
    int offset = MAX;

    bool found = false;
    int foundD = -1;

    for (int d = 0; d <= MAX && !found; d++) {
        trace.push_back(V);
        for (int k = -d; k <= d; k += 2) {
            int x;
            if (k == -d || (k != d && V[offset + k - 1] < V[offset + k + 1])) {
                x = V[offset + k + 1];
            } else {
                x = V[offset + k - 1] + 1;
            }
            int y = x - k;
            while (x < N && y < M && a[x] == b[y]) { x++; y++; }
            V[offset + k] = x;
            if (x >= N && y >= M) { found = true; foundD = d; break; }
        }
    }

    // Backtrack para reconstruir a sequência de operações.
    std::vector<EditOp> ops;
    int x = N, y = M;
    for (int d = foundD; d > 0; d--) {
        const std::vector<int>& Vd = trace[d];
        int k = x - y;
        int prevK;
        if (k == -d || (k != d && Vd[offset + k - 1] < Vd[offset + k + 1])) {
            prevK = k + 1;
        } else {
            prevK = k - 1;
        }
        int prevX = Vd[offset + prevK];
        int prevY = prevX - prevK;

        // diagonais (EQUAL) antes do passo de edição.
        // NÃO invertemos aqui: todo o vetor `ops` é invertido UMA ÚNICA VEZ
        // no final, então esses tokens já precisam ficar em ordem reversa
        // (x decrescente) para sair corretos depois do reverse global.
        while (x > prevX && y > prevY) {
            ops.push_back({OpType::EQUAL, {a[x - 1]}});
            x--; y--;
        }

        if (x == prevX) {
            // inserção (token veio de b)
            ops.push_back({OpType::INSERT, {b[y - 1]}});
            y--;
        } else {
            // deleção (token veio de a)
            ops.push_back({OpType::DELETE, {a[x - 1]}});
            x--;
        }
    }
    // diagonal restante do início (mesma lógica: sem reverse local)
    while (x > 0 && y > 0) {
        ops.push_back({OpType::EQUAL, {a[x - 1]}});
        x--; y--;
    }

    std::reverse(ops.begin(), ops.end());

    // Compacta operações consecutivas do mesmo tipo em um único bloco.
    std::vector<EditOp> compact;
    for (auto& op : ops) {
        if (!compact.empty() && compact.back().type == op.type) {
            compact.back().tokens.insert(compact.back().tokens.end(),
                                          op.tokens.begin(), op.tokens.end());
        } else {
            compact.push_back(op);
        }
    }
    return compact;
}

// ---------------------------------------------------------------------------
// 3. Serialização do patch em JSON (writer/parser mínimos, sem lib externa)
// ---------------------------------------------------------------------------

static std::string jsonEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:   out += c;
        }
    }
    return out;
}

static std::string opTypeName(OpType t) {
    switch (t) {
        case OpType::EQUAL:  return "equal";
        case OpType::DELETE: return "delete";
        case OpType::INSERT: return "insert";
    }
    return "?";
}

// `sourceHash` = SHA-256 do arquivo A (conteúdo original, ANTES da
// transformação) -- ver seção 0 (sha256Hex) pro motivo. Campo
// obrigatório desde o formato v2 (antes só existia "format"/"ops");
// `apply` rejeita qualquer patch sem ele (ver parsePatch), mesma regra
// que já vale pra "op"/"text" ausentes -- nunca aceitar um patch que
// não permita confirmar que o arquivo de destino ainda é o mesmo que
// gerou o patch.
static void writePatch(const std::vector<EditOp>& ops,
                        const std::string& sourceHash,
                        std::ostream& out) {
    out << "{\n  \"format\": \"structural-token-diff-v2\",\n"
        << "  \"sourceHash\": \"" << sourceHash << "\",\n"
        << "  \"ops\": [\n";
    for (size_t i = 0; i < ops.size(); i++) {
        std::string joined;
        for (auto& t : ops[i].tokens) joined += t.text;
        out << "    {\"op\": \"" << opTypeName(ops[i].type)
            << "\", \"text\": \"" << jsonEscape(joined) << "\"}";
        if (i + 1 < ops.size()) out << ",";
        out << "\n";
    }
    out << "  ]\n}\n";
}

// Parser JSON minimalista, suficiente para o formato gerado acima.
// Não é um parser JSON genérico -- espera exatamente a estrutura escrita
// por writePatch (tolerante a espaços/quebras de linha extras).
struct SimplePatchOp { std::string op; std::string text; };

static std::string unescape(const std::string& s) {
    std::string out;
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '\\' && i + 1 < s.size()) {
            char n = s[i + 1];
            if (n == 'n') { out += '\n'; i++; }
            else if (n == 'r') { out += '\r'; i++; }
            else if (n == 't') { out += '\t'; i++; }
            else if (n == '"') { out += '"'; i++; }
            else if (n == '\\') { out += '\\'; i++; }
            else out += s[i];
        } else {
            out += s[i];
        }
    }
    return out;
}

// Reporta um patch malformado e encerra com o código de saída dedicado
// (ver Observações.md item 16 -- exit codes estruturados). Nunca deve
// tentar "adivinhar" a estrutura de um patch corrompido: a regra de
// ouro do projeto (Observações.md item 21) é rejeitar, não adivinhar.
[[noreturn]] static void rejectMalformedPatch(const std::string& reason) {
    std::cerr << "PATCH INVÁLIDO: " << reason << "\n";
    std::exit(20);
}

// Avança a partir de `i` (posição logo após a aspa de abertura) até a
// aspa de fechamento de uma string JSON, tratando escapes (`\"`, `\\`,
// etc) corretamente -- um `\` sempre "consome" o caractere seguinte,
// não importa qual seja, então nunca interpretamos uma aspa escapada
// como fim de string. Retorna std::string::npos se a string nunca for
// fechada (patch truncado/corrompido).
static size_t skipJsonStringBody(const std::string& s, size_t i) {
    size_t n = s.size();
    while (i < n) {
        if (s[i] == '\\' && i + 1 < n) {
            i += 2;
            continue;
        }
        if (s[i] == '"') return i;
        i++;
    }
    return std::string::npos;
}

// Encontra a primeira ocorrência de `target` em `s` a partir de `from`,
// IGNORANDO qualquer ocorrência dentro de uma string JSON entre aspas.
//
// Isso é essencial: o campo "text" de uma operação quase sempre contém
// `{`, `}`, `[` ou `]` como parte do próprio código-fonte sendo
// diffado (ex: "resultado = [];" ou "return a + b;\n}\n"). Um scan
// ingênuo (find puro) para achar os limites do array/objeto JSON para
// no primeiro desses caracteres DENTRO da string, corrompendo a
// extração -- e, pior, se isso faz o "}" de fechamento de um objeto
// nunca ser encontrado, `objEnd` vira std::string::npos e o código
// original fazia `i = objEnd + 1`, que sofre overflow de size_t e
// volta para 0, entrando em loop infinito (bug real, reproduzido:
// `apply` trava e consome memória sem limite com qualquer código-fonte
// que contenha chaves/colchetes em uma operação "equal"/"delete").
static size_t findUnquoted(const std::string& s, char target, size_t from) {
    size_t n = s.size();
    size_t i = from;
    while (i < n) {
        char c = s[i];
        if (c == '"') {
            size_t close = skipJsonStringBody(s, i + 1);
            if (close == std::string::npos) return std::string::npos;
            i = close + 1;
            continue;
        }
        if (c == target) return i;
        i++;
    }
    return std::string::npos;
}

// Patch completo já parseado: hash do arquivo de origem (obrigatório,
// ver writePatch) + a lista de operações.
struct ParsedPatch {
    std::string sourceHash;
    std::vector<SimplePatchOp> ops;
};

static ParsedPatch parsePatch(const std::string& content) {
    std::vector<SimplePatchOp> ops;
    size_t pos = content.find("\"ops\"");
    if (pos == std::string::npos) {
        rejectMalformedPatch("campo \"ops\" não encontrado.");
    }

    // "sourceHash" só é procurado ANTES de "ops" -- o writer sempre
    // emite os campos nessa ordem (format, sourceHash, ops), e
    // restringir a busca a essa faixa evita qualquer risco de casar
    // acidentalmente com a substring `"sourceHash"` caso ela apareça
    // dentro do TEXTO diffado de alguma operação (ex: código-fonte
    // que contém esse literal) -- mesma cautela do resto deste parser
    // minimalista, que já assume que os nomes de campo do protocolo
    // não colidem com o conteúdo diffado.
    std::string beforeOps = content.substr(0, pos);
    size_t hashPos = beforeOps.find("\"sourceHash\"");
    if (hashPos == std::string::npos) {
        rejectMalformedPatch(
            "campo \"sourceHash\" ausente -- todo patch precisa do hash do "
            "arquivo de origem (formato structural-token-diff-v2).");
    }
    size_t hashColon = beforeOps.find(':', hashPos);
    size_t hashQ1 = (hashColon == std::string::npos)
        ? std::string::npos
        : beforeOps.find('"', hashColon);
    if (hashQ1 == std::string::npos) {
        rejectMalformedPatch("valor do campo \"sourceHash\" ausente.");
    }
    size_t hashQ2 = skipJsonStringBody(beforeOps, hashQ1 + 1);
    if (hashQ2 == std::string::npos) {
        rejectMalformedPatch("string não fechada no campo \"sourceHash\".");
    }
    std::string sourceHash = unescape(beforeOps.substr(hashQ1 + 1, hashQ2 - hashQ1 - 1));

    size_t arrStart = findUnquoted(content, '[', pos);
    if (arrStart == std::string::npos) {
        rejectMalformedPatch("\"ops\" sem '[' de abertura.");
    }
    size_t arrEnd = findUnquoted(content, ']', arrStart + 1);
    if (arrEnd == std::string::npos) {
        rejectMalformedPatch("\"ops\" sem ']' de fechamento correspondente.");
    }
    std::string arr = content.substr(arrStart + 1, arrEnd - arrStart - 1);

    size_t i = 0, n = arr.size();
    while (i < n) {
        size_t objStart = findUnquoted(arr, '{', i);
        if (objStart == std::string::npos) break;
        size_t objEnd = findUnquoted(arr, '}', objStart + 1);
        if (objEnd == std::string::npos) {
            rejectMalformedPatch("objeto de operação sem '}' de fechamento correspondente.");
        }
        std::string obj = arr.substr(objStart + 1, objEnd - objStart - 1);

        auto extractField = [&](const std::string& field) -> std::string {
            size_t fpos = obj.find("\"" + field + "\"");
            if (fpos == std::string::npos) {
                rejectMalformedPatch("campo \"" + field + "\" ausente em uma operação.");
            }
            size_t colon = obj.find(':', fpos);
            size_t q1 = (colon == std::string::npos)
                ? std::string::npos
                : obj.find('"', colon);
            if (q1 == std::string::npos) {
                rejectMalformedPatch("valor do campo \"" + field + "\" ausente.");
            }
            size_t q2 = skipJsonStringBody(obj, q1 + 1);
            if (q2 == std::string::npos) {
                rejectMalformedPatch("string não fechada no campo \"" + field + "\".");
            }
            return unescape(obj.substr(q1 + 1, q2 - q1 - 1));
        };

        SimplePatchOp p;
        p.op = extractField("op");
        p.text = extractField("text");

        if (p.op != "equal" && p.op != "delete" && p.op != "insert") {
            // Antes, um "op" desconhecido caía implicitamente no
            // comportamento de "delete" em applyPatch (silenciosamente
            // descartado do resultado) -- rejeitamos explicitamente em
            // vez de adivinhar o que fazer com uma operação corrompida.
            rejectMalformedPatch("operação desconhecida \"" + p.op + "\".");
        }

        ops.push_back(p);

        i = objEnd + 1;
    }
    return ParsedPatch{sourceHash, ops};
}

// ---------------------------------------------------------------------------
// 4. Aplicação do patch: reconstrói o arquivo de destino a partir do
//    arquivo original + lista de operações (equal/delete/insert).
// ---------------------------------------------------------------------------

static std::string applyPatch(const std::string& original,
                               const std::vector<SimplePatchOp>& ops) {
    // Para "equal" e "delete" avançamos sobre o original; para "insert"
    // simplesmente emitimos o texto novo. Como o patch foi gerado a partir
    // de tokens do próprio arquivo original, "equal"/"delete" devem casar
    // sequencialmente com o conteúdo restante -- isso é o que dá a precisão
    // estrutural (ao contrário de um patch por número de linha, que quebra
    // se o arquivo mudou de tamanho antes do ponto do patch).
    //
    // Regra de ouro do projeto (Observações.md item 21): se o arquivo
    // atual não corresponde ao estado para o qual o patch foi gerado,
    // REJEITAR -- nunca tentar adivinhar onde a alteração "provavelmente"
    // deveria entrar. A versão anterior tinha um modo "tolerante" que
    // procurava a próxima ocorrência do texto esperado (original.find)
    // quando o cursor não batia; isso é exatamente o comportamento que o
    // item 12 do Observações.md pede para remover -- pode aplicar um
    // patch no lugar errado silenciosamente (ex: token repetido mais
    // adiante no arquivo) sem qualquer sinal de erro.
    std::string result;
    size_t cursor = 0;

    for (const auto& op : ops) {
        if (op.op == "insert") {
            result += op.text;
            continue;
        }
        // equal ou delete: precisam corresponder ao próximo trecho do original
        size_t len = op.text.size();
        if (cursor + len > original.size() ||
            original.compare(cursor, len, op.text) != 0) {
            std::cerr << "PATCH REJEITADO: trecho esperado não encontrado na posição "
                      << cursor << " da operação \"" << op.op << "\".\n"
                      << "O arquivo atual diverge do estado para o qual o patch "
                      << "foi gerado -- nada foi escrito.\n";
            std::exit(40); // 40 = operação não corresponde ao arquivo (Observações.md #16)
        }
        if (op.op == "equal") {
            result += op.text;
        }
        // delete: não copia para o resultado
        cursor += len;
    }
    // qualquer sobra do original após o último op é preservada (segurança)
    if (cursor < original.size()) {
        result += original.substr(cursor);
    }
    return result;
}

// ---------------------------------------------------------------------------
// 5. main / CLI
// ---------------------------------------------------------------------------

static std::string readFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) {
        std::cerr << "Não foi possível abrir: " << path << "\n";
        std::exit(10); // 10 = arquivo não encontrado (Observações.md #16)
    }
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "Uso:\n"
                  << "  diff_patch_engine diff  <arquivo_a> <arquivo_b> > patch.json\n"
                  << "  diff_patch_engine apply <arquivo_original> <patch.json> > saida\n";
        return 1;
    }

    std::string cmd = argv[1];

    if (cmd == "diff") {
        if (argc != 4) { std::cerr << "diff precisa de dois arquivos.\n"; return 1; }
        std::string a = readFile(argv[2]);
        std::string b = readFile(argv[3]);
        auto tokensA = tokenize(a);
        auto tokensB = tokenize(b);
        auto ops = myersDiff(tokensA, tokensB);
        writePatch(ops, sha256Hex(a), std::cout);
        return 0;
    }

    if (cmd == "apply") {
        if (argc != 4) { std::cerr << "apply precisa do original e do patch.\n"; return 1; }
        std::string original = readFile(argv[2]);
        std::string patchJson = readFile(argv[3]);
        ParsedPatch patch = parsePatch(patchJson);

        // Confere o hash ANTES de gastar tempo validando/aplicando as
        // operações token a token -- se o arquivo já não é mais o mesmo
        // que gerou o patch (outra escrita aconteceu no meio tempo),
        // rejeita imediatamente com um motivo claro (30), em vez de só
        // descobrir a divergência mais tarde via um mismatch de operação
        // "equal"/"delete" (40, motivo menos específico pra quem chama).
        std::string actualHash = sha256Hex(original);
        if (actualHash != patch.sourceHash) {
            std::cerr << "HASH DIVERGENTE: o arquivo original não é mais o "
                      << "mesmo que gerou este patch (esperado sourceHash="
                      << patch.sourceHash << ", atual=" << actualHash << ").\n"
                      << "O arquivo mudou desde que o patch foi criado -- "
                      << "nada foi escrito.\n";
            std::exit(30); // 30 = hash incompatível (Observações.md #16)
        }

        std::string result = applyPatch(original, patch.ops);
        std::cout << result;
        return 0;
    }

    std::cerr << "Comando desconhecido: " << cmd << "\n";
    return 1;
}
