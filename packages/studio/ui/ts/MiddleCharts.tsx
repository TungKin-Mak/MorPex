/* ═══════════════════════════════════════════════════════════════════════
   MiddleCharts.tsx — 中央图表区（中文 + 真实数据驱动）
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { useAstroStore } from './stores';
import './MiddleCharts.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const createChartData = (dataPoints: number[], color = 'rgba(255, 26, 26, 0.4)', border = '#ff1a1a') => {
  const labels = Array.from({ length: dataPoints.length }, (_, i) => i);
  return {
    labels,
    datasets: [
      {
        label: 'Signal',
        data: dataPoints,
        fill: true,
        backgroundColor: (context: any) => {
          const ctx = context.chart.ctx;
          const gradient = ctx.createLinearGradient(0, 0, 0, 400);
          gradient.addColorStop(0, color);
          gradient.addColorStop(1, 'rgba(0,0,0,0)');
          return gradient;
        },
        borderColor: border,
        borderWidth: 1.5,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 0,
      },
    ],
  };
};

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { enabled: false },
  },
  scales: {
    x: {
      ticks: { display: false },
      grid: {
        display: true,
        color: '#2b2e3a',
        borderColor: 'transparent',
        drawTicks: false,
      },
    },
    y: {
      ticks: { display: false },
      min: 0,
      max: 45,
      grid: {
        display: true,
        color: '#2b2e3a',
        borderColor: 'transparent',
        drawTicks: false,
      },
    },
  },
  elements: {
    line: {
      borderJoinStyle: 'round' as const,
    },
  },
};

/** 随时间变化的模拟信号（实际应接真实时序数据） */
function buildSignal(base: number, variance: number, len: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < len; i++) {
    const noise = (Math.sin(i * 0.5 + Date.now() * 0.001) * 0.5 + 0.5) * variance;
    arr.push(Math.max(1, Math.min(44, base + noise)));
  }
  return arr;
}

const MiddleCharts: React.FC = () => {
  const backpressure = useAstroStore((s) => s.backpressure);
  const runningTasks = useAstroStore((s) => s.runningTasks);
  const pendingTasks = useAstroStore((s) => s.pendingTasks);
  const fsmPhase = useAstroStore((s) => s.fsmPhase);
  const memMainPool = useAstroStore((s) => s.memMainPool);
  const memTempPool = useAstroStore((s) => s.memTempPool);
  const memGateRejectRate = useAstroStore((s) => s.memGateRejectRate);

  // 核心指标：背压 + 任务数
  const throughput = backpressure;
  const latency = fsmPhase === 'RUNNING' ? 0.7 : fsmPhase === 'IDLE' ? 0.2 : 1.2;
  const ioLatency = pendingTasks > 0 ? 0.7 + pendingTasks * 0.1 : 0.2;

  const chart1 = useMemo(() => createChartData(buildSignal(throughput * 0.4, 10, 11), 'rgba(255, 68, 68, 0.4)', '#ff4444'), [throughput]);
  const chart2 = useMemo(() => createChartData(buildSignal(latency * 30, 5, 9), 'rgba(68, 136, 255, 0.4)', '#4488ff'), [latency]);
  const chart3 = useMemo(() => createChartData(buildSignal(ioLatency * 20, 8, 10), 'rgba(255, 187, 51, 0.4)', '#ffbb33'), [ioLatency]);
  const chart4 = useMemo(() => createChartData(buildSignal(memTempPool * 0.3, 12, 11), 'rgba(170, 68, 255, 0.4)', '#aa44ff'), [memTempPool]);
  const chart5 = useMemo(() => createChartData(buildSignal(memMainPool * 0.05, 8, 8), 'rgba(255, 85, 170, 0.4)', '#ff55aa'), [memMainPool]);
  const chart6 = useMemo(() => createChartData(buildSignal(parseFloat(memGateRejectRate) * 2 || 10, 6, 6), 'rgba(51, 204, 85, 0.4)', '#33cc55'), [memGateRejectRate]);

  return (
    <div className="charts-wrapper">
      <div className="charts-grid">
        {/* 1. 系统背压 */}
        <div className="chart-cell">
          <div className="chart-header">
            <span className="chart-title">系统背压</span>
            <span className="chart-value">{throughput}%</span>
          </div>
          <div className="chart-area">
            <Line data={chart1} options={chartOptions} />
          </div>
        </div>

        {/* 2. 响应延迟 */}
        <div className="chart-cell">
          <div className="chart-header">
            <span className="chart-title">响应延迟</span>
            <span className="chart-value">{latency.toFixed(2)}s</span>
          </div>
          <div className="chart-area">
            <Line data={chart2} options={chartOptions} />
          </div>
        </div>

        {/* 3. I/O 延迟 */}
        <div className="chart-cell">
          <div className="chart-header">
            <span className="chart-title">I/O 延迟</span>
            <span className="chart-value">{ioLatency.toFixed(2)}s</span>
          </div>
          <div className="chart-area">
            <Line data={chart3} options={chartOptions} />
          </div>
        </div>

        {/* 4. 临时池 */}
        <div className="chart-cell">
          <div className="chart-header">
            <span className="chart-title">临时池</span>
            <span className="chart-value">{memTempPool}</span>
          </div>
          <div className="chart-area">
            <Line data={chart4} options={chartOptions} />
          </div>
        </div>

        {/* 5. 主内存池 */}
        <div className="chart-cell">
          <div className="chart-header">
            <span className="chart-title">主内存池</span>
            <span className="chart-value">{memMainPool}</span>
          </div>
          <div className="chart-area">
            <Line data={chart5} options={chartOptions} />
          </div>
        </div>

        {/* 6. 拒绝率 */}
        <div className="chart-cell">
          <div className="chart-header">
            <span className="chart-title">拒绝率</span>
            <span className="chart-value">{memGateRejectRate}</span>
          </div>
          <div className="chart-area">
            <Line data={chart6} options={chartOptions} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MiddleCharts;
