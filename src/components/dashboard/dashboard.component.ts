import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardService, KpiCardData } from '../../services/dashboard.service';
import { ChartComponent } from '../chart/chart.component';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, ChartComponent],
})
export class DashboardComponent {
  dashboardService = inject(DashboardService);
  hoveredCardId = signal<string | null>(null);

  setHoveredCard(id: string | null): void {
    this.hoveredCardId.set(id);
  }

  drillDown(card: KpiCardData): void {
    if (card.error) return; // Don't drill down if there was an error loading data
    this.dashboardService.drillDownFromKpi(card.drillDownTableName);
  }

  onFilterChange(event: Event): void {
    const selectElement = event.target as HTMLSelectElement;
    const value = selectElement.value;
    this.dashboardService.setRegionFilter(value || null);
  }
}