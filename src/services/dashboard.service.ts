import { Injectable, signal } from '@angular/core';

export interface ChartConfig {
  id: string;
  title: string;
  query: string;
  chartType: 'bar' | 'pie' | 'line';
  labelColumn: string;
  dataColumn: string;
  data: any[];
  headers: string[];
}

@Injectable({
  providedIn: 'root',
})
export class DashboardService {
  pinnedCharts = signal<ChartConfig[]>([]);

  addChart(chart: Omit<ChartConfig, 'id'>): void {
    const newChart: ChartConfig = {
      ...chart,
      id: `chart_${Date.now()}_${Math.random()}`
    };
    this.pinnedCharts.update(charts => [...charts, newChart]);
  }

  removeChart(chartId: string): void {
    this.pinnedCharts.update(charts => charts.filter(c => c.id !== chartId));
  }
}