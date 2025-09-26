import { Component, ChangeDetectionStrategy, inject, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DatabaseService, TableColumn } from '../../services/database.service';
import { FileUploadModalComponent } from '../file-upload-modal/file-upload-modal.component';
import { SqlSuggestionsModalComponent } from '../sql-suggestions-modal/sql-suggestions-modal.component';

@Component({
  selector: 'app-database-explorer',
  standalone: true,
  imports: [CommonModule, FileUploadModalComponent, SqlSuggestionsModalComponent],
  templateUrl: './database-explorer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DatabaseExplorerComponent {
  databaseService = inject(DatabaseService);

  uploadModal = viewChild.required(FileUploadModalComponent);
  suggestionsModal = viewChild.required(SqlSuggestionsModalComponent);

  toggleColumn(tableName: string, column: TableColumn): void {
    this.databaseService.toggleSelectedColumn(tableName, column);
  }

  toggleTable(tableName: string): void {
    this.databaseService.toggleSelectTable(tableName);
  }

  getTableSelectionState(tableName: string): 'all' | 'some' | 'none' {
    return this.databaseService.getTableSelectionState(tableName);
  }

  isSelected(tableName: string, columnName: string): boolean {
    return this.databaseService.isSelected(tableName, columnName);
  }
}
