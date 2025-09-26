import { Component, ChangeDetectionStrategy, effect, input, viewChild, ElementRef, inject } from '@angular/core';
import { DisplayableChart, DashboardService } from '../../services/dashboard.service';

const MATERIAL_CHART_PALETTE = {
  backgrounds: [
    'rgba(79, 70, 229, 0.6)',   // Indigo 600
    'rgba(16, 185, 129, 0.6)',  // Emerald 500
    'rgba(217, 70, 239, 0.6)',  // Fuchsia 500
    'rgba(249, 115, 22, 0.6)',  // Orange 500
    'rgba(14, 165, 233, 0.6)',  // Sky 500
    'rgba(139, 92, 246, 0.6)',  // Violet 500
    'rgba(236, 72, 153, 0.6)',  // Pink 500
    'rgba(20, 184, 166, 0.6)',  // Teal 500
  ],
  borders: [
    'rgb(79, 70, 229)',
    'rgb(16, 185, 129)',
    'rgb(217, 70, 239)',
    'rgb(249, 115, 22)',
    'rgb(14, 165, 233)',
    'rgb(139, 92, 246)',
    'rgb(236, 72, 153)',
    'rgb(20, 184, 166)',
  ],
};

@Component({
  selector: 'app-chart',
  template: `<div #chartCanvas class="w-full h-full"></div>`,
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block relative w-full h-full'
  }
})
export class ChartComponent {
  config = input.required<DisplayableChart>();
  chartCanvas = viewChild.required<ElementRef<HTMLDivElement>>('chartCanvas');
  dashboardService = inject(DashboardService);

  constructor() {
    effect((onCleanup) => {
      const chartConfig = this.config();
      const chartDiv = this.chartCanvas();
      
      if (chartDiv && chartConfig && chartConfig.data.length > 0) {
        const labels = chartConfig.data.map(row => String(row[chartConfig.labelColumn]));
        const data = chartConfig.data.map(row => Number(row[chartConfig.dataColumn]));
        const chartType = chartConfig.chartType;
        const dataCol = chartConfig.dataColumn;
        
        const ec = (window as any).echarts;
        const chart = ec.init(chartDiv.nativeElement, null, { renderer: 'svg' });

        let option: any;

        if (chartType === 'pie') {
          option = {
            backgroundColor: 'transparent',
            tooltip: {
              trigger: 'item',
              backgroundColor: 'var(--theme-bg-sidebar)',
              borderColor: 'var(--theme-sidebar-hover)',
              borderWidth: 1,
              textStyle: {
                color: 'var(--theme-text-on-dark)',
              },
            },
            legend: {
              type: 'scroll',
              orient: 'horizontal',
              bottom: 0,
              textStyle: {
                color: 'var(--theme-text-secondary)',
              },
            },
            series: [{
              cursor: 'pointer', // 使切片可点击
              name: dataCol,
              type: 'pie',
              radius: ['45%', '65%'],
              avoidLabelOverlap: true,
              itemStyle: {
                borderRadius: 5,
                borderColor: 'var(--theme-bg-card)',
                borderWidth: 1
              },
              label: {
                show: false,
              },
              labelLine: {
                show: false
              },
              data: labels.map((name, i) => ({ value: data[i], name })),
            }],
          };
        } else { // bar or line
          option = {
            backgroundColor: 'transparent',
            tooltip: {
              trigger: 'axis',
              backgroundColor: 'var(--theme-bg-sidebar)',
              borderColor: 'var(--theme-sidebar-hover)',
              borderWidth: 1,
              textStyle: {
                color: 'var(--theme-text-on-dark)',
              },
              axisPointer: {
                type: 'shadow'
              }
            },
            grid: {
              left: '3%',
              right: '4%',
              bottom: '3%',
              top: '10%',
              containLabel: true,
            },
            xAxis: {
              type: 'category',
              data: labels,
              axisLine: {
                lineStyle: {
                  color: 'var(--theme-border)',
                },
              },
              axisLabel: {
                color: 'var(--theme-text-secondary)',
              },
            },
            yAxis: {
              type: 'value',
              axisLine: {
                show: true,
                lineStyle: {
                  color: 'var(--theme-border)',
                },
              },
              axisLabel: {
                color: 'var(--theme-text-secondary)',
              },
              splitLine: {
                lineStyle: {
                  color: 'var(--theme-border)',
                  type: 'dashed'
                }
              }
            },
            series: [{
              cursor: 'pointer', // 使柱状条/数据点可点击
              name: dataCol,
              type: chartType,
              data: data,
              smooth: chartType === 'line',
              itemStyle: {
                borderRadius: chartType === 'bar' ? [3, 3, 0, 0] : undefined
              },
            }],
          };
        }
        
        option.color = MATERIAL_CHART_PALETTE.borders;
        chart.setOption(option);

        // 为下钻添加点击监听器
        const clickHandler = (params: any) => {
          // params.name 包含我们用于过滤的类别标签
          if (params.name) { 
            this.dashboardService.drillDown(chartConfig, params.name);
          }
        };

        chart.on('click', clickHandler);
        
        const resizeObserver = new ResizeObserver(() => {
          setTimeout(() => {
            if (!chart.isDisposed()) {
              chart.resize();
            }
          });
        });
        resizeObserver.observe(chartDiv.nativeElement);

        onCleanup(() => {
          chart.off('click', clickHandler); // 清理事件监听器
          resizeObserver.disconnect();
          chart.dispose();
        });
      }
    });
  }
}