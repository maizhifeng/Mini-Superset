import { Component, ChangeDetectionStrategy, signal, effect, viewChild, ElementRef, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  selector: 'app-sql-lab',
  templateUrl: './sql-lab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FormsModule, DatabaseExplorerComponent, CommonModule],
  host: {
    '(paste)': 'onPaste($event)',
  },
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

  summaryRow = computed(() => {
    const results = this.queryResults();
    const headers = this.queryResultHeaders();

    if (!results || results.length < 2 || headers.length === 0) {
      return null;
    }

    const summary: Record<string, string | number> = {};

    for (const header of headers) {
      const columnValues = results.map(row => row[header]);
      
      const firstNonNullValue = columnValues.find(v => v !== null && v !== undefined);

      if (typeof firstNonNullValue === 'number') {
        // Numerical data: sum
        const sum = columnValues.reduce((acc, val) => {
          const num = Number(val);
          return acc + (isNaN(num) ? 0 : num);
        }, 0);
        summary[header] = sum;
      } else {
        // Categorical/other data: unique count
        const uniqueValues = new Set(columnValues.filter(v => v !== null && v !== undefined)).size;
        summary[header] = `${uniqueValues} unique`;
      }
    }

    return summary;
  });

  // 编辑器模式
  editorMode = signal<'sql' | 'n2l' | 'ai-insight' | 'image-to-table'>('sql');
  naturalLanguageQuery = signal<string>('');

  // 结果/图表视图状态
  activeTab = signal<'results' | 'chart'>('results');
  
  // Chart signals
  chartCanvas = viewChild<ElementRef<HTMLDivElement>>('chartCanvas');
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

  // AI Insight state
  aiInsight = signal<string | null>(null);
  isAnalyzing = signal(false);
  aiInsightPrompt = signal<string>('');
  formattedAiInsight = computed(() => {
    const text = this.aiInsight();
    if (!text) return '';
    
    // Convert markdown-like lists and bolding to HTML
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/^\s*[\-\*]\s(.*)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n/g, '<br>');
  });

  // Image to Table state
  uploadedImage = signal<string | null>(null);
  imageFile = signal<File | null>(null);

  constructor() {
    effect((onCleanup) => {
      const chartDiv = this.chartCanvas();
      const results = this.queryResults();
      const isConfigValid = this.isChartConfigValid();
      const activeTab = this.activeTab();

      if (activeTab === 'chart' && chartDiv && results && results.length > 0 && isConfigValid) {
        const chartType = this.chartType();
        const labelCol = this.labelColumn()!;
        const dataCol = this.dataColumn()!;

        const labels = results.map(row => String(row[labelCol]));
        const data = results.map(row => Number(row[dataCol]));

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
              orient: 'vertical',
              left: 'left',
              textStyle: {
                color: 'var(--theme-text-secondary)',
              },
            },
            series: [{
              name: dataCol,
              type: 'pie',
              radius: ['40%', '70%'],
              avoidLabelOverlap: false,
              itemStyle: {
                borderRadius: 10,
                borderColor: 'var(--theme-bg-card)',
                borderWidth: 2
              },
              label: {
                show: false,
                position: 'center'
              },
              emphasis: {
                label: {
                    show: true,
                    fontSize: 20,
                    fontWeight: 'bold'
                }
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
              name: dataCol,
              type: chartType,
              data: data,
              smooth: chartType === 'line',
              itemStyle: {
                borderRadius: chartType === 'bar' ? [5, 5, 0, 0] : undefined
              },
            }],
          };
        }
        
        option.color = MATERIAL_CHART_PALETTE.borders;
        chart.setOption(option);
        
        const resizeObserver = new ResizeObserver(() => {
          setTimeout(() => {
            if (!chart.isDisposed()) {
              chart.resize();
            }
          });
        });
        resizeObserver.observe(chartDiv.nativeElement);

        onCleanup(() => {
          resizeObserver.disconnect();
          chart.dispose();
        });
      }
    });

    effect(() => {
      this.isChartConfigValid.set(!!(this.labelColumn() && this.dataColumn()));
    });

    // Effect for AI suggestions
    effect(() => {
      const suggested = this.databaseService.suggestedQuery();
      if (suggested) {
        this.query.set(suggested);
        // Automatically run the query for the user
        this.runQuery();
        this.databaseService.suggestedQuery.set(null); // Reset after use
      }
    });
    
    // New effect for dashboard drill-down
    effect(() => {
      const drillDown = this.databaseService.drillDownQuery();
      if (drillDown) {
        this.query.set(drillDown);
        this.runQuery();
        this.databaseService.drillDownQuery.set(null); // Reset after use
        this.notificationService.show('🔍 已下钻数据！新查询已运行。');
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
    this.aiInsight.set(null); // Reset AI insight on new query run

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

  async getAiInsight(): Promise<void> {
    const results = this.queryResults();
    const headers = this.queryResultHeaders();

    if (!results || results.length === 0 || !headers || headers.length === 0) {
      this.notificationService.show('❌ 没有可供分析的数据。');
      return;
    }
    
    this.aiInsight.set(null); // Clear previous insight before fetching new one
    
    const insight = await this.aiService.generateInsightsFromData(results, headers, this.aiInsightPrompt());
    
    if (insight) {
      this.aiInsight.set(insight);
    } else {
      // The service will show a more specific error, but we can show a generic one here.
      this.notificationService.show('❌ 生成 AI 洞察失败。');
    }
  }

  async runAndAnalyze(): Promise<void> {
    if (this.databaseService.dbStatus() !== 'ready') {
      this.notificationService.show('数据库尚未准备好。');
      return;
    }
    
    this.isAnalyzing.set(true);
    this.aiInsight.set(null); // Clear previous results immediately for better UX
    
    // First, run the query.
    await this.runQuery();
    
    // If the query was successful and returned results, analyze them.
    if (!this.queryError() && this.queryResults() && this.queryResults()!.length > 0) {
      await this.getAiInsight();
    } else if (!this.queryError()) {
      // Query ran but returned no results, so can't analyze.
      this.notificationService.show('查询未返回任何数据可供分析。');
    }
    // If there was a query error, runQuery already handled it.
    
    this.isAnalyzing.set(false);
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

  copyResultsToClipboard(): void {
    const headers = this.queryResultHeaders();
    const results = this.queryResults();

    if (!results || results.length === 0 || headers.length === 0) {
      this.notificationService.show('📋 没有可复制的结果。');
      return;
    }

    const headerString = headers.join('\t');
    const rowsString = results.map(row => 
      headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) {
          return '';
        }
        // 基本的 TSV 清理：从值中移除换行符和制表符。
        return String(value).replace(/[\n\t]/g, ' ');
      }).join('\t')
    ).join('\n');

    const clipboardText = `${headerString}\n${rowsString}`;

    navigator.clipboard.writeText(clipboardText)
      .then(() => {
        this.notificationService.show('📋 所有结果已复制到剪贴板！');
      })
      .catch(err => {
        console.error('无法复制结果：', err);
        this.notificationService.show('❌ 复制失败。请检查浏览器权限。');
      });
  }

  onImageUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.handleImageFile(input.files[0]);
    }
  }
  
  onPaste(event: ClipboardEvent): void {
    if (this.editorMode() !== 'image-to-table') {
      return;
    }
  
    const items = event.clipboardData?.items;
    if (!items) {
      return;
    }
  
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          this.handleImageFile(file);
          this.notificationService.show('📋 图片已粘贴！');
          return; // Handle the first image found and exit.
        }
      }
    }
  }

  private handleImageFile(file: File): void {
    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      this.notificationService.show('❌ 文件过大。请上传小于 10MB 的图片。');
      return;
    }
    this.imageFile.set(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      this.uploadedImage.set(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }
  
  async processImage(): Promise<void> {
    const file = this.imageFile();
    const imageBase64DataUrl = this.uploadedImage();
    if (!file || !imageBase64DataUrl) {
      this.notificationService.show('❌ 请先上传图片。');
      return;
    }
  
    const imageBase64 = imageBase64DataUrl.split(',')[1];
    
    const csvData = await this.aiService.generateTableFromImage(imageBase64, file.type);
    
    if (csvData) {
      this.notificationService.show('✅ 成功识别表格数据！正在创建新表...');
      // Sanitize filename to create a valid table name
      const tableName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, '_');
      await this.databaseService.processAndLoadData(csvData, `${tableName}.csv`, 'uploaded');

      if (!this.databaseService.error()) {
        const finalTableName = this.databaseService.tables().find(t => t.name.startsWith(tableName.toLowerCase()))?.name;
        this.notificationService.show(`🚀 表 "${finalTableName}" 已创建！`);
        this.editorMode.set('sql');
        this.uploadedImage.set(null);
        this.imageFile.set(null);
        if (finalTableName) {
          this.query.set(`SELECT * FROM "${finalTableName}" LIMIT 100;`);
          this.runQuery();
        }
      } else {
          this.notificationService.show('❌ 创建表时出错。');
      }
    } else {
      this.notificationService.show('❌ 无法从图片中提取表格数据。');
    }
  }
}
