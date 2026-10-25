/**
 * Firestore em memória para os testes do RAG do Solaris.
 * Nunca conecta a um banco remoto; implementa apenas a API exigida pelos testes.
 */
export interface FakeVector { toArray(): number[] }
export interface FakeRecord { [field: string]: unknown }
export interface FakeRef {
    id: string;
    _colecao: string;
    get(): Promise<{ exists: boolean; id: string; data(): FakeRecord | undefined }>;
}
export interface FakeSnapshotDocument {
    id: string;
    ref: FakeRef;
    data(): FakeRecord;
}
export interface FakeFirestore {
    collection(nome: string): {
        doc(id: string): FakeRef;
        get(): Promise<{ docs: FakeSnapshotDocument[]; size: number }>;
        where(campo: string, operador: string, valor: unknown): {
            get(): Promise<{ docs: FakeSnapshotDocument[]; size: number }>;
        };
        findNearest(options: { vectorField: string; queryVector: FakeVector; limit: number }): {
            get(): Promise<{ docs: Array<{ id: string; data(): FakeRecord }> }>;
        };
    };
    batch(): {
        delete(ref: FakeRef): void;
        set(ref: FakeRef, dados: FakeRecord): void;
        commit(): Promise<void>;
    };
    _dump(nome: string): Map<string, FakeRecord>;
}

function _distanciaCosseno(a: number[], b: number[]): number {
    const dot = a.reduce((soma, v, i) => soma + v * (b[i] ?? 0), 0);
    const normA = Math.sqrt(a.reduce((soma, v) => soma + v * v, 0));
    const normB = Math.sqrt(b.reduce((soma, v) => soma + v * v, 0));
    if (normA === 0 || normB === 0) return 1;
    return 1 - dot / (normA * normB);
}

export function criarFakeFirestore(): FakeFirestore {
    const colecoes = new Map<string, Map<string, FakeRecord>>();

    function _mapaDaColecao(nome: string): Map<string, FakeRecord> {
        let mapa = colecoes.get(nome);
        if (!mapa) {
            mapa = new Map<string, FakeRecord>();
            colecoes.set(nome, mapa);
        }
        return mapa;
    }

    function collection(nome: string): ReturnType<FakeFirestore['collection']> {
        const mapa = _mapaDaColecao(nome);

        function doc(id: string): FakeRef {
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
            where(campo: string, operador: string, valor: unknown) {
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
            findNearest({ vectorField, queryVector, limit }: { vectorField: string; queryVector: FakeVector; limit: number }) {
                return {
                    get: async () => {
                        const q = queryVector.toArray();
                        const candidatos = [...mapa.entries()].map(([id, dados]) => {
                            const vetor = dados[vectorField] as (Partial<FakeVector> | undefined);
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

    function batch(): ReturnType<FakeFirestore['batch']> {
        const operacoes: Array<() => unknown> = [];
        return {
            delete(ref: FakeRef) {
                operacoes.push(() => _mapaDaColecao(ref._colecao).delete(ref.id));
            },
            set(ref: FakeRef, dados: FakeRecord) {
                operacoes.push(() => _mapaDaColecao(ref._colecao).set(ref.id, dados));
            },
            commit: async () => {
                for (const op of operacoes) op();
            },
        };
    }

    return {
        collection,
        batch,
        _dump: (nome: string) => new Map(_mapaDaColecao(nome)),
    };
}
