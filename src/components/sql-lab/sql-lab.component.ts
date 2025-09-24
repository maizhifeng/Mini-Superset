import { Component, ChangeDetectionStrategy, signal, effect, viewChild, ElementRef, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatabaseService } from '../../services/database.service';
import { DatabaseExplorerComponent } from '../database-explorer/database-explorer.component';
import { DashboardService } from '../../services/dashboard.service';
import { NotificationService } from '../../services/notification.service';
import { AiService } from '../../services/ai.service';

// Suggestion type
interface Suggestion {
  text: string;
  type: 'keyword' | 'table' | 'column';
  display_text?: string; // e.g., "column (table)"
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT', 'JOIN', 'LEFT JOIN',
  'RIGHT JOIN', 'INNER JOIN', 'ON', 'AS', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE FROM', 'CREATE TABLE', 'DROP TABLE', 'ALTER TABLE', 'ADD', 'DISTINCT',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
  'IS NULL', 'IS NOT NULL', 'HAVING', 'ASC', 'DESC', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END'
];

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
  selector: 'app-sql-lab',
  templateUrl: './sql-lab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FormsModule, DatabaseExplorerComponent],
})
export class SqlLabComponent {
  databaseService = inject(DatabaseService);
  dashboardService = inject(DashboardService);
  notificationService = inject(NotificationService);
  aiService = inject(AiService);
  
  // SQL 编辑器状态
  query = signal<string>('-- 从左侧选择一张表开始探索吧！\n-- 或者创建一个新表：\nCREATE TABLE IF NOT EXISTS my_table (id INT, name TEXT);');
  queryResults = signal<any[] | null>(null);
  queryResultHeaders = signal<string[]>([]);
  queryError = signal<string | null>(null);
  isQueryRunning = signal(false);

  // 编辑器模式
  editorMode = signal<'sql' | 'n2l'>('sql');
  naturalLanguageQuery = signal<string>('');

  // 结果/图表视图状态
  activeTab = signal<'results' | 'chart'>('results');
  
  // Chart signals
  chartCanvas = viewChild<ElementRef<HTMLCanvasElement>>('chartCanvas');
  chartType = signal<'bar' | 'pie' | 'line'>('bar');
  labelColumn = signal<string | null>(null);
  dataColumn = signal<string | null>(null);
  isChartConfigValid = signal<boolean>(false);

  // Autocomplete state
  suggestions = signal<Suggestion[]>([]);
  isSuggestionsOpen = signal(false);
  activeSuggestionIndex = signal(0);
  
  // Reference to the textarea element
  queryTextarea = viewChild<ElementRef<HTMLTextAreaElement>>('queryTextarea');

  constructor() {
    // 这个 effect 使用 onCleanup 来安全地管理图表的生命周期，防止崩溃。
    effect((onCleanup) => {
      const canvas = this.chartCanvas();
      const results = this.queryResults();
      const isConfigValid = this.isChartConfigValid();
      const activeTab = this.activeTab();

      // 当所有条件都满足时，渲染图表。
      if (activeTab === 'chart' && canvas && results && results.length > 0 && isConfigValid) {
        const chartType = this.chartType();
        const labelCol = this.labelColumn()!;
        const dataCol = this.dataColumn()!;
        
        const labels = results.map(row => row[labelCol]);
        const data = results.map(row => row[dataCol]);
        
        const datasetConfig: any = {
          label: `${dataCol} by ${labelCol}`,
          data: data,
          backgroundColor: MATERIAL_CHART_PALETTE.backgrounds,
          borderColor: MATERIAL_CHART_PALETTE.borders,
          borderWidth: 1.5,
          hoverBorderWidth: 2.5,
          hoverBorderColor: MATERIAL_CHART_PALETTE.borders,
        };
        
        if (chartType === 'line') {
          datasetConfig.tension = 0.4;
          datasetConfig.pointRadius = 5;
          datasetConfig.pointHoverRadius = 7;
          datasetConfig.pointBackgroundColor = MATERIAL_CHART_PALETTE.borders;
          datasetConfig.pointBorderColor = '#fff';
          datasetConfig.pointHoverBackgroundColor = MATERIAL_CHART_PALETTE.borders;
          datasetConfig.pointHoverBorderColor = '#fff';
        }
        
        const chart = new (window as any).Chart(canvas.nativeElement, {
          type: chartType,
          data: {
            labels: labels,
            datasets: [datasetConfig]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
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
                display: chartType !== 'pie',
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
                  display: chartType !== 'pie'
                }
              },
              x: {
                display: chartType !== 'pie',
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
                  display: chartType !== 'pie'
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

    effect(() => {
      this.isChartConfigValid.set(!!(this.labelColumn() && this.dataColumn()));
    });

    // New effect for AI suggestions
    effect(() => {
      const suggested = this.databaseService.suggestedQuery();
      if (suggested) {
        this.query.set(suggested);
        // Automatically run the query for the user
        this.runQuery();
        this.databaseService.suggestedQuery.set(null); // Reset after use
      }
    });
  }

  pinChart(): void {
    const results = this.queryResults();
    const headers = this.queryResultHeaders();
    const chartType = this.chartType();
    const labelCol = this.labelColumn();
    const dataCol = this.dataColumn();
    const query = this.query();

    if (!results || !labelCol || !dataCol || headers.length === 0) {
      return;
    }

    const chartTitle = `${dataCol} 按 ${labelCol} 分布`;

    this.dashboardService.addChart({
      query: query,
      chartType: chartType,
      labelColumn: labelCol,
      dataColumn: dataCol,
      data: results,
      headers: headers,
      title: chartTitle,
    });
    this.notificationService.show('📈 图表已固定到仪表板！');
  }

  async generateSql(): Promise<void> {
    if (!this.naturalLanguageQuery().trim()) {
        this.notificationService.show('请输入您的查询描述。');
        return;
    }
    const generatedSql = await this.aiService.generateSqlFromNaturalLanguage(this.naturalLanguageQuery());
    
    if (generatedSql) {
        this.query.set(generatedSql);
        this.editorMode.set('sql');
        this.notificationService.show('🚀 SQL 查询已生成！');
        this.naturalLanguageQuery.set(''); // Clear the input
    } else {
        this.notificationService.show('❌ 生成 SQL 查询失败。');
    }
  }
  
  async runQuery(): Promise<void> {
    if (this.databaseService.dbStatus() !== 'ready') {
      this.queryError.set('数据库尚未准备好。');
      this.queryResults.set(null);
      return;
    }
    this.isQueryRunning.set(true);
    this.queryError.set(null);
    try {
      const results = await this.databaseService.runQuery(this.query());
      
      this.queryResults.set(results.rows ?? []);

      if (results.fields && results.fields.length > 0) {
        const headers = results.fields.map(f => f.name);
        this.queryResultHeaders.set(headers);
        
        if (results.rows && results.rows.length > 0) {
          // 自动为图表选择列
          if (!this.labelColumn() || !headers.includes(this.labelColumn()!)) {
              this.labelColumn.set(headers[0]);
          }
          if (!this.dataColumn() || !headers.includes(this.dataColumn()!)) {
              const numericColumn = headers.find(h => typeof results.rows![0][h] === 'number');
              this.dataColumn.set(numericColumn || (headers.length > 1 ? headers[1] : null));
          }
        }
      } else {
         this.queryResultHeaders.set([]);
      }

      this.queryError.set(null);
    } catch (error: any) {
      this.queryError.set(error.message);
      this.queryResults.set(null);
      this.queryResultHeaders.set([]);
    } finally {
      this.isQueryRunning.set(false);
    }
  }

  onQueryKeydown(event: KeyboardEvent): boolean | void {
    if (!this.isSuggestionsOpen() || this.suggestions().length === 0) return;
  
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeSuggestionIndex.update(i => (i + 1) % this.suggestions().length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeSuggestionIndex.update(i => (i - 1 + this.suggestions().length) % this.suggestions().length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      const activeSuggestion = this.suggestions()[this.activeSuggestionIndex()];
      if (activeSuggestion) {
        this.applySuggestion(activeSuggestion);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.closeSuggestions();
    }
  }
  
  onQueryInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    const cursorPosition = textarea.selectionStart;
    const queryText = this.query();
    
    const textBeforeCursor = queryText.substring(0, cursorPosition);
    const matches = textBeforeCursor.match(/[\w"]+$/);
    const currentWord = matches ? matches[0] : '';
  
    this.generateSuggestions(queryText, cursorPosition, currentWord);
  }
  
  private getTablesFromQuery(query: string): Set<string> {
    const upperQuery = query.toUpperCase();
    const tableNames = new Set<string>();

    const fromMatch = upperQuery.match(/\bFROM\s+("?[\w_]+"?)/);
    if (fromMatch) {
      tableNames.add(fromMatch[1].replace(/"/g, ''));
    }
  
    const joinMatches = [...upperQuery.matchAll(/\bJOIN\s+("?[\w_]+"?)/g)];
    joinMatches.forEach(match => {
      tableNames.add(match[1].replace(/"/g, ''));
    });
    
    return tableNames;
  }
  
  generateSuggestions(fullQuery: string, cursorPosition: number, currentWord: string): void {
    const textBeforeCursor = fullQuery.substring(0, cursorPosition - currentWord.length);
    const upperTextBeforeCursor = textBeforeCursor.toUpperCase().trim();
    const newSuggestions: Suggestion[] = [];
    const tables = this.databaseService.tables();
  
    const lastKeywordMatch = upperTextBeforeCursor.match(/\b(SELECT|FROM|JOIN|WHERE|GROUP BY|ORDER BY|ON)$/);
    const lastKeyword = lastKeywordMatch ? lastKeywordMatch[1] : null;
  
    if (lastKeyword === 'FROM' || lastKeyword === 'JOIN') {
      newSuggestions.push(...tables.map(t => ({ text: t.name, type: 'table' as const })));
    } else if (lastKeyword === 'SELECT' || lastKeyword === 'WHERE' || lastKeyword === 'GROUP BY' || lastKeyword === 'ORDER BY' || lastKeyword === 'ON' || textBeforeCursor.endsWith(',')) {
      const fromAndJoinTables = this.getTablesFromQuery(fullQuery);
      fromAndJoinTables.forEach(tableName => {
        const tableSchema = tables.find(t => t.name.toLowerCase() === tableName.toLowerCase());
        if (tableSchema) {
          tableSchema.schema.forEach(col => {
            newSuggestions.push({ text: `"${col.sanitizedName}"`, type: 'column', display_text: `${col.sanitizedName} (${tableSchema.name})` });
          });
        }
      });
      newSuggestions.push(...SQL_KEYWORDS.map(k => ({ text: k, type: 'keyword' as const })));
    } else {
      newSuggestions.push(...SQL_KEYWORDS.map(k => ({ text: k, type: 'keyword' as const })));
      newSuggestions.push(...tables.map(t => ({ text: t.name, type: 'table' as const })));
      const fromAndJoinTables = this.getTablesFromQuery(fullQuery);
      fromAndJoinTables.forEach(tableName => {
        const tableSchema = tables.find(t => t.name.toLowerCase() === tableName.toLowerCase());
        if (tableSchema) {
          tableSchema.schema.forEach(col => {
            newSuggestions.push({ text: `"${col.sanitizedName}"`, type: 'column', display_text: `${col.sanitizedName} (${tableSchema.name})` });
          });
        }
      });
    }
  
    const lowerCurrentWord = currentWord.toLowerCase().replace(/"/g, '');
    if (lowerCurrentWord === '') {
        this.closeSuggestions();
        return;
    }

    const filteredSuggestions = newSuggestions
      .filter(s => s.text.toLowerCase().replace(/"/g, '').startsWith(lowerCurrentWord))
      .filter((value, index, self) => self.findIndex(s => s.text === value.text) === index)
      .slice(0, 10);
  
    if (filteredSuggestions.length > 0) {
      this.suggestions.set(filteredSuggestions);
      this.isSuggestionsOpen.set(true);
      this.activeSuggestionIndex.set(0);
    } else {
      this.closeSuggestions();
    }
  }
  
  applySuggestion(suggestion: Suggestion): void {
    const textarea = this.queryTextarea()?.nativeElement;
    if (!textarea) return;
  
    const cursorPosition = textarea.selectionStart;
    const queryText = this.query();
    
    const textBeforeCursor = queryText.substring(0, cursorPosition);
    const matches = textBeforeCursor.match(/[\w"]+$/);
    const currentWord = matches ? matches[0] : '';
    
    const textBeforeWord = textBeforeCursor.substring(0, textBeforeCursor.length - currentWord.length);
    const textAfterCursor = queryText.substring(cursorPosition);
  
    const textToInsert = suggestion.text;
    const newQuery = `${textBeforeWord}${textToInsert} ${textAfterCursor}`;
    this.query.set(newQuery);
  
    setTimeout(() => {
      const newCursorPosition = textBeforeWord.length + textToInsert.length + 1;
      textarea.focus();
      textarea.setSelectionRange(newCursorPosition, newCursorPosition);
    }, 0);
  
    this.closeSuggestions();
  }
  
  closeSuggestions(): void {
    this.isSuggestionsOpen.set(false);
  }
}