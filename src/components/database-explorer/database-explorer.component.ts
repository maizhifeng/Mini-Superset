import { Component, ChangeDetectionStrategy, signal, inject, viewChild } from '@angular/core';
import { DatabaseService, TableColumn } from '../../services/database.service';
import { FileUploadModalComponent } from '../file-upload-modal/file-upload-modal.component';
import { SqlSuggestionsModalComponent } from '../sql-suggestions-modal/sql-suggestions-modal.component';
import { AiService } from '../../services/ai.service';

@Component({
  selector: 'app-database-explorer',
  standalone: true,
  imports: [FileUploadModalComponent, SqlSuggestionsModalComponent],
  templateUrl: './database-explorer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DatabaseExplorerComponent {
  databaseService = inject(DatabaseService);
  aiService = inject(AiService);
  uploadModal = viewChild.required<FileUploadModalComponent>('modalInstance');
  suggestionsModal = viewChild.required<SqlSuggestionsModalComponent>('suggestionsModalInstance');
  
  expandedTables = signal<Set<string>>(new Set());
  
  previewTable(tableName: string, event: MouseEvent): void {
    event.preventDefault(); // 防止点击标签时切换复选框
    this.databaseService.suggestedQuery.set(`SELECT * FROM "${tableName}" LIMIT 100;`);
  }

  toggleTable(tableName: string): void {
    this.expandedTables.update(tables => {
      const newSet = new Set(tables);
      if (newSet.has(tableName)) {
        newSet.delete(tableName);
      } else {
        newSet.add(tableName);
      }
      return newSet;
    });
  }

  handleColumnSelection(tableName: string, column: TableColumn): void {
    this.databaseService.toggleSelectedColumn(tableName, column);
  }

  handleTableSelection(tableName: string): void {
    this.databaseService.toggleSelectTable(tableName);
  }

  getTableSelectionState(tableName: string): 'all' | 'some' | 'none' {
    return this.databaseService.getTableSelectionState(tableName);
  }
  
  getAiSuggestions(): void {
    this.suggestionsModal().open();
  }
}