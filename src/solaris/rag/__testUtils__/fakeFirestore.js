"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.criarFakeFirestore = criarFakeFirestore;
function _distanciaCosseno(a, b) {
    const dot = a.reduce((soma, v, i) => soma + v * (b[i] ?? 0), 0);
    const normA = Math.sqrt(a.reduce((soma, v) => soma + v * v, 0));
    const normB = Math.sqrt(b.reduce((soma, v) => soma + v * v, 0));
    if (normA === 0 || normB === 0)
        return 1;
    return 1 - dot / (normA * normB);
}
function criarFakeFirestore() {
    const colecoes = new Map();
    function _mapaDaColecao(nome) {
        let mapa = colecoes.get(nome);
        if (!mapa) {
            mapa = new Map();
            colecoes.set(nome, mapa);
        }
        return mapa;
    }
    function collection(nome) {
        const mapa = _mapaDaColecao(nome);
        function doc(id) {
            return {
                id,
                _colecao: nome,
                get: async () => ({
                    exists: mapa.has(id),
                    id,
                    data: () => mapa.get(id),
                }),
            };
        }
        return {
            doc,
            get: async () => {
                const docs = [...mapa.entries()].map(([id, dados]) => ({ id, ref: doc(id), data: () => dados }));
                return { docs, size: docs.length };
            },
            where(campo, operador, valor) {
                if (operador !== '==') {
                    throw new Error('fakeFirestore: operador "' + operador + '" não suportado');
                }
                return {
                    get: async () => {
                        const docs = [...mapa.entries()]
                            .filter(([, dados]) => dados[campo] === valor)
                            .map(([id, dados]) => ({ id, ref: doc(id), data: () => dados }));
                        return { docs, size: docs.length };
                    },
                };
            },
            findNearest({ vectorField, queryVector, limit }) {
                return {
                    get: async () => {
                        const q = queryVector.toArray();
                        const candidatos = [...mapa.entries()].map(([id, dados]) => {
                            const vetor = dados[vectorField];
                            const v = vetor?.toArray?.() || [];
                            const distancia = _distanciaCosseno(q, v);
                            return { id, dados: { ...dados, _distancia: distancia }, distancia };
                        });
                        candidatos.sort((a, b) => a.distancia - b.distancia);
                        const docs = candidatos.slice(0, limit).map((c) => ({
                            id: c.id,
                            data: () => c.dados,
                        }));
                        return { docs };
                    },
                };
            },
        };
    }
    function batch() {
        const operacoes = [];
        return {
            delete(ref) {
                operacoes.push(() => _mapaDaColecao(ref._colecao).delete(ref.id));
            },
            set(ref, dados) {
                operacoes.push(() => _mapaDaColecao(ref._colecao).set(ref.id, dados));
            },
            commit: async () => {
                for (const op of operacoes)
                    op();
            },
        };
    }
    return {
        collection,
        batch,
        _dump: (nome) => new Map(_mapaDaColecao(nome)),
    };
}
