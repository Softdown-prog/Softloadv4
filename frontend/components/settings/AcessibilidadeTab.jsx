import React, { useState } from 'react';
import { Check, Type, ZoomIn } from 'lucide-react';
import {
    FONT_SCALE_OPTIONS,
    FONT_FAMILY_OPTIONS,
    getFontScale,
    getFontFamily,
    setFontScale,
    setFontFamily,
} from '../../utils/accessibilityPrefs';

// Aplicação é instantânea (sem botão "Salvar") -- convenção padrão pra
// controles de acessibilidade: o usuário precisa ver o efeito assim que
// escolhe, não depois de confirmar um formulário.
export default function AcessibilidadeTab() {
    const [fontScale, setFontScaleState] = useState(getFontScale);
    const [fontFamily, setFontFamilyState] = useState(getFontFamily);

    const escolherEscala = (value) => {
        setFontScale(value);
        setFontScaleState(value);
    };

    const escolherFamilia = (value) => {
        setFontFamily(value);
        setFontFamilyState(value);
    };

    return (
        <div className="sl-card mb-0">
            <h2 className="fw-bold mb-1 small text-uppercase d-flex align-items-center gap-2" style={{ letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                <ZoomIn size={16} />
                Tamanho da Fonte
            </h2>
            <p className="small mb-3" style={{ color: 'var(--sl-text-500)' }}>
                Ajusta o tamanho de todo o painel — a mudança é aplicada imediatamente, nesta sessão e nas próximas (salvo neste navegador).
            </p>
            <div className="d-flex flex-wrap gap-2 mb-4" role="radiogroup" aria-label="Tamanho da fonte">
                {FONT_SCALE_OPTIONS.map((opt) => {
                    const ativo = fontScale === opt.value;
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={ativo}
                            onClick={() => escolherEscala(opt.value)}
                            className={`btn btn-sm fw-bold d-flex align-items-center gap-2 ${ativo ? 'btn-sl-primary' : 'btn-sl-outline'}`}
                        >
                            {ativo && <Check size={14} />}
                            {opt.label}
                        </button>
                    );
                })}
            </div>

            <hr style={{ borderColor: 'var(--bs-border-color)' }} />

            <h2 className="fw-bold mb-1 mt-3 small text-uppercase d-flex align-items-center gap-2" style={{ letterSpacing: '0.1em', color: 'var(--sl-text-400)' }}>
                <Type size={16} />
                Tipografia
            </h2>
            <p className="small mb-3" style={{ color: 'var(--sl-text-500)' }}>
                A fonte de alta legibilidade (Atkinson Hyperlegible) foi desenhada para diferenciar melhor letras parecidas e reduzir a fadiga de leitura.
            </p>
            <div className="d-flex flex-column gap-2 mb-3" role="radiogroup" aria-label="Fonte">
                {FONT_FAMILY_OPTIONS.map((opt) => {
                    const ativo = fontFamily === opt.value;
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={ativo}
                            onClick={() => escolherFamilia(opt.value)}
                            className="d-flex align-items-center justify-content-between p-3 rounded border text-start"
                            style={{
                                background: ativo ? 'rgba(14,165,233,.1)' : 'transparent',
                                borderColor: ativo ? 'var(--sl-primary)' : 'var(--bs-border-color)',
                                fontFamily: opt.value === 'legivel' ? "'Atkinson Hyperlegible', inherit" : 'inherit',
                            }}
                        >
                            <span>
                                <span className="d-block fw-bold small">{opt.label}</span>
                                <span className="d-block" style={{ fontSize: '13px', color: 'var(--sl-text-400)' }}>
                                    Softload gera templates de alta performance para o seu blog.
                                </span>
                            </span>
                            {ativo && <Check size={16} className="flex-shrink-0 ms-3" style={{ color: 'var(--sl-primary)' }} />}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
