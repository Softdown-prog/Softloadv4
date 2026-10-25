import React, { useEffect, useRef } from 'react';
import type { Chart as ChartInstance } from 'chart.js';

// Gráfico de rosca de Distribuição de Planos — mesmo mecanismo do EJS antigo
// (Chart.js via CDN), agora empacotado pelo Vite. `data` é [{ label, value, color, border }].
// import() dinâmico de propósito: chart.js/auto pesa ~200KB no bundle e só
// é usado nesta única tela do admin (/eu) — carregar estático inflaria o
// main.js pago por TODO visitante (landing, login, dashboard do cliente).
export interface DonutChartItem {
    label: string;
    value: number;
    color: string;
    border: string;
}

export interface DonutChartProps {
    data: readonly DonutChartItem[];
}

export default function DonutChart({ data }: DonutChartProps): React.JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const chartRef = useRef<ChartInstance<'doughnut', number[], string> | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;
        let cancelado = false;

        import('chart.js/auto').then(({ Chart }) => {
            if (cancelado || !canvasRef.current) return;

            if (!chartRef.current) {
                chartRef.current = new Chart<'doughnut', number[], string>(canvasRef.current, {
                    type: 'doughnut',
                    data: {
                        labels: data.map(d => d.label),
                        datasets: [{
                            data: data.map(d => d.value),
                            backgroundColor: data.map(d => d.color),
                            borderColor: data.map(d => d.border),
                            borderWidth: 1,
                        }],
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'bottom',
                                labels: { color: '#94a3b8', font: { size: 11, weight: 700 }, padding: 16 },
                            },
                        },
                        cutout: '65%',
                    },
                });
            } else {
                chartRef.current.data.datasets[0].data = data.map(d => d.value);
                chartRef.current.update();
            }
        });

        return () => { cancelado = true; };
    }, [data]);

    useEffect(() => () => {
        if (chartRef.current) {
            chartRef.current.destroy();
            chartRef.current = null;
        }
    }, []);

    return <canvas ref={canvasRef} />;
}
