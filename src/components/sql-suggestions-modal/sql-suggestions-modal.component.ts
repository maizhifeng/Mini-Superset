import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DatabaseService } from '../../services/database.service';
import { AiService, SqlSuggestion } from '../../services/ai.service';

/**
 * 一个简单的 SQL 格式化程序，以提高可读性。
 * @param sql 原始 SQL 字符串。
 * @returns 格式化后的 SQL 字符串。
 */
function formatSql(sql: string): string {
  // 应另起一行的关键字。
  const keywordsForNewline = [
    'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT', 
    'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'ON'
  ];
  
  // 1. 将所有空白字符规范化为单个空格。
  let formatted = sql.replace(/\s+/g, ' ').trim();

  // 2. 为 SELECT 子句中的列添加换行和缩进。
  formatted = formatted.replace(/\b(SELECT)\b\s/gi, 'SELECT\n  ');
  
  // 3. 将每个主要关键字放在一个新行上。
  for (const keyword of keywordsForNewline) {
    const regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
    formatted = formatted.replace(regex, `\n${keyword}`);
  }

  return formatted;
}


@Component({
  selector: 'app-sql-suggestions-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sql-suggestions-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SqlSuggestionsModalComponent {
  private databaseService = inject(DatabaseService);
  aiService = inject(AiService);

  isOpen = signal(false);

  public open(): void {
    this.isOpen.set(true);
    // 异步执行，UI 会通过信号自动更新
    this.aiService.streamSqlSuggestions();
  }

  close(): void {
    this.isOpen.set(false);
    this.aiService.suggestions.set([]); // 关闭时清除建议
    this.aiService.error.set(null); // 关闭时清除 AI 特定错误
  }

  selectQuery(suggestion: SqlSuggestion): void {
    const formattedQuery = formatSql(suggestion.query);
    this.databaseService.suggestedQuery.set(formattedQuery);
    this.databaseService.clearSelectedColumns();
    this.close();
  }
}
