import { Component, ChangeDetectionStrategy, signal, inject, effect } from '@angular/core';
import { SqlLabComponent } from './components/sql-lab/sql-lab.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DatabaseService } from './services/database.service';
import { NotificationHostComponent } from './components/notification/notification.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [SqlLabComponent, DashboardComponent, NotificationHostComponent],
})
export class AppComponent {
  databaseService = inject(DatabaseService);

  activeView = signal<'sql-lab' | 'dashboard'>('sql-lab');
  isSidebarOpen = signal(true);

  constructor() {
    // Effect to handle navigation when a drill-down is requested from the dashboard.
    effect(() => {
      if (this.databaseService.drillDownQuery()) {
        this.setView('sql-lab');
      }
    });
  }

  setView(view: 'sql-lab' | 'dashboard'): void {
    this.activeView.set(view);
  }

  toggleSidebar(): void {
    this.isSidebarOpen.update(open => !open);
  }
}