import { Component, ChangeDetectionStrategy, effect, input, viewChild, ElementRef } from '@angular/core';
import { ChartConfig } from '../../services/dashboard.service';

const MATERIAL_CHART_PALETTE = {
  backgrounds: [
    'rgba(63, 81, 181, 0.6)',  // Indigo 500
    'rgba(244, 67, 54, 0.6)',  // Red 500
    'rgba(76, 175, 80, 0.6)',  // Green 500
    'rgba(255, 193, 7, 0.6)',  // Amber 500
    'rgba(156, 39, 176, 0.6)', // Purple 500
    'rgba(3, 169, 244, 0.6)',  // Light Blue 500
    'rgba(255, 87, 34, 0.6)',  // Deep Orange 500
    'rgba(0, 150, 136, 0.6)',  // Teal 500
  ],
  borders: [
    'rgb(63, 81, 181)',
    'rgb(244, 67, 54)',
    'rgb(76, 175, 80)',
    'rgb(255, 193, 7)',
    'rgb(156, 39, 176)',
    'rgb(3, 169, 244)',
    'rgb(255, 87, 34)',
    'rgb(0, 150, 136)',
  ],
};

@Component({
  selector: 'app-chart',
  template: `<canvas #chartCanvas></canvas>`,
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block relative w-full h-full'
  }
})
export class ChartComponent {
  config = input.required<ChartConfig>();
  chartCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('chartCanvas');

  constructor() {
    effect((onCleanup) => {
      const chartConfig = this.config();
      const canvas = this.chartCanvas();
      
      if (canvas && chartConfig && chartConfig.data.length > 0) {
        const labels = chartConfig.data.map(row => row[chartConfig.labelColumn]);
        const data = chartConfig.data.map(row => row[chartConfig.dataColumn]);

        const datasetConfig: any = {
          label: chartConfig.title,
          data: data,
          backgroundColor: MATERIAL_CHART_PALETTE.backgrounds,
          borderColor: MATERIAL_CHART_PALETTE.borders,
          borderWidth: 1.5,
          hoverBorderWidth: 2.5,
          hoverBorderColor: MATERIAL_CHART_PALETTE.borders,
        };

        if (chartConfig.chartType === 'line') {
          datasetConfig.tension = 0.4;
          datasetConfig.pointRadius = 5;
          datasetConfig.pointHoverRadius = 7;
          datasetConfig.pointBackgroundColor = MATERIAL_CHART_PALETTE.borders;
          datasetConfig.pointBorderColor = '#fff';
          datasetConfig.pointHoverBackgroundColor = MATERIAL_CHART_PALETTE.borders;
          datasetConfig.pointHoverBorderColor = '#fff';
        }

        const chart = new (window as any).Chart(canvas.nativeElement, {
          type: chartConfig.chartType,
          data: {
            labels: labels,
            datasets: [datasetConfig]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: chartConfig.chartType !== 'pie',
                position: 'top',
                labels: {
                    color: 'var(--md-sys-color-on-surface-variant)',
                    font: {
                        family: "'Roboto', sans-serif",
                        size: 14,
                        weight: '500'
                    }
                }
              },
              title: {
                display: false,
              },
              tooltip: {
                backgroundColor: 'var(--md-sys-color-surface-bright)',
                titleColor: 'var(--md-sys-color-on-surface)',
                bodyColor: 'var(--md-sys-color-on-surface-variant)',
                borderColor: 'var(--md-sys-color-outline-variant)',
                borderWidth: 1,
                padding: 10,
                cornerRadius: 8,
                boxPadding: 4,
              }
            },
            scales: {
              y: {
                display: chartConfig.chartType !== 'pie',
                ticks: {
                  color: 'var(--md-sys-color-on-surface-variant)',
                  font: {
                    family: "'Roboto', sans-serif",
                    size: 12,
                  }
                },
                grid: {
                  color: 'var(--md-sys-color-outline-variant)',
                  borderDash: [4, 4],
                  display: chartConfig.chartType !== 'pie'
                }
              },
              x: {
                display: chartConfig.chartType !== 'pie',
                ticks: {
                  color: 'var(--md-sys-color-on-surface-variant)',
                  font: {
                    family: "'Roboto', sans-serif",
                    size: 12,
                  }
                },
                grid: {
                  color: 'var(--md-sys-color-outline-variant)',
                  borderDash: [4, 4],
                  display: chartConfig.chartType !== 'pie'
                }
              }
            }
          }
        });

        onCleanup(() => {
          chart.destroy();
        });
      }
    });
  }
}