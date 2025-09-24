import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { DatabaseExplorerComponent } from '../database-explorer/database-explorer.component';
import { DashboardService } from '../../services/dashboard.service';
import { ChartComponent } from '../chart/chart.component';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [DatabaseExplorerComponent, ChartComponent],
})
export class DashboardComponent {
  dashboardService = inject(DashboardService);
}