import { Injectable, signal, computed } from '@angular/core';
// FIX: Corrected type to `Results` which is the correct exported member from '@electric-sql/pglite'.
import type { PGlite, Results } from '@electric-sql/pglite';

// 表格列的接口
export interface TableColumn {
  originalName: string;
  sanitizedName: string;
  sqlType: string;
}

export type TableCategory = 'pglite' | 'uploaded' | 'external';

export interface Table {
  name: string;
  schema: TableColumn[];
  category: TableCategory;
}

export interface SelectedColumn {
  tableName: string;
  columnName: string;
  sqlType: string;
}

// 示例数据
const SAMPLE_SALES_DATA = `日期,地区,产品,销售额,利润
2024-01-15,North,Widgets,1500,250.50
2024-01-20,South,Gadgets,1250,180.75
2024-02-10,North,Widgets,1800,300.00
2024-02-18,West,Sprockets,900,150.20
2024-03-05,South,Gadgets,2100,350.00
2024-03-12,East,Widgets,1300,210.80
2024-04-22,West,Sprockets,1150,195.50
2024-04-30,North,Gadgets,1600,280.25`;

const SAMPLE_EMPLOYEES_DATA = `员工ID,名,姓,部门,入职日期
101,Alice,Smith,Sales,2022-08-01
102,Bob,Johnson,Engineering,2021-11-15
103,Charlie,Brown,Marketing,2023-01-20
104,Diana,Miller,Engineering,2022-05-10
105,Eve,Davis,Sales,2023-03-12`;

const SAMPLE_PRODUCTS_DATA = `产品ID,产品名称,类别,价格
P001,Widgets,Electronics,25.99
P002,Gadgets,Electronics,49.50
P003,Sprockets,Mechanical,15.75
P004,Doohickeys,Miscellaneous,5.25`;


@Injectable({
  providedIn: 'root',
})
export class DatabaseService {
  db = signal<PGlite | null>(null);
  dbStatus = signal<'initializing' | 'ready' | 'error'>('initializing');
  tables = signal<Table[]>([]);
  isLoading = signal(false);
  error = signal<string | null>(null);

  selectedColumns = signal<SelectedColumn[]>([]);
  hasSelectedColumns = computed(() => this.selectedColumns().length > 0);
  suggestedQuery = signal<string | null>(null);

  tableMetadata = signal<Map<string, { category: TableCategory }>>(new Map());
  tablesByCategory = computed(() => {
      const grouped: { [key in TableCategory]: Table[] } = {
          pglite: [],
          uploaded: [],
          external: []
      };
      for (const table of this.tables()) {
          if (grouped[table.category]) {
              grouped[table.category].push(table);
          }
      }
      return grouped;
  });

  constructor() {
    this.initializeDb();
  }

  async initializeDb(): Promise<void> {
    try {
      this.dbStatus.set('initializing');
      const { PGlite } = await import('@electric-sql/pglite');
      const dbInstance = new PGlite();
      await dbInstance.waitReady;
      this.db.set(dbInstance);
      this.dbStatus.set('ready');
      await this.loadSampleData();
    } catch (e: any) {
      console.error("Failed to initialize PGlite:", e);
      this.dbStatus.set('error');
      this.error.set('无法初始化数据库。请刷新页面重试。');
    }
  }
  
  private async loadSampleData(): Promise<void> {
    await this.processAndLoadData(SAMPLE_SALES_DATA, 'sales_data.csv', 'pglite');
    await this.processAndLoadData(SAMPLE_EMPLOYEES_DATA, 'employees.csv', 'pglite');
    await this.processAndLoadData(SAMPLE_PRODUCTS_DATA, 'products.csv', 'pglite');
  }

  private async refreshTables(): Promise<void> {
    const db = this.db();
    if (!db) return;

    try {
        const tablesResult = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
        `) as Results<{ table_name: string }>;

        const allTables: Table[] = [];
        const existingTableNames = new Set<string>();

        if (tablesResult.rows) {
            for (const tableRow of tablesResult.rows) {
                const tableName = tableRow.table_name;
                existingTableNames.add(tableName);
                const columnsResult = await db.query(`
                    SELECT column_name, data_type 
                    FROM information_schema.columns 
                    WHERE table_name = $1 AND table_schema = 'public';
                `, [tableName]) as Results<{ column_name: string, data_type: string }>;

                const schema: TableColumn[] = columnsResult.rows ? columnsResult.rows.map(col => ({
                    originalName: col.column_name,
                    sanitizedName: col.column_name,
                    sqlType: col.data_type.toUpperCase()
                })) : [];
                
                let category = this.tableMetadata().get(tableName)?.category;
                if (!category) {
                    category = 'uploaded'; // Default for tables created via SQL
                    this.tableMetadata.update(meta => meta.set(tableName, { category: 'uploaded' }));
                }

                allTables.push({ name: tableName, schema, category });
            }
        }
        
        this.tables.set(allTables);

        // Prune metadata for deleted tables
        this.tableMetadata.update(currentMeta => {
            const newMeta = new Map<string, { category: TableCategory }>();
            for (const [tableName, meta] of currentMeta.entries()) {
                if (existingTableNames.has(tableName)) {
                    newMeta.set(tableName, meta);
                }
            }
            return newMeta;
        });
    } catch (e: any) {
        console.error("Failed to refresh tables:", e);
        this.error.set(`刷新表结构时出错: ${e.message}`);
    }
  }
  
  async processAndLoadData(csvText: string, sourceName: string, category: TableCategory): Promise<void> {
    const db = this.db();
    if (!db) {
      this.error.set('数据库尚未准备好。');
      return;
    }

    this.isLoading.set(true);
    this.error.set(null);

    try {
      const lines = csvText.split('\n').filter(line => line.trim() !== '');
      if (lines.length < 2) throw new Error("CSV 数据必须至少包含一个标题行和一行数据。");

      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const rows = lines.slice(1).map(line => line.split(',').map(v => v.trim().replace(/"/g, '')));
      
      if (rows.length === 0) {
        this.isLoading.set(false);
        return;
      }
      
      const tableName = sourceName.replace(/\.csv$/i, '').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_').toLowerCase();
      this.tableMetadata.update(meta => meta.set(tableName, { category }));
      
      const sampleRow = rows[0];
      const newSchema: TableColumn[] = [];
      const usedColumnNames = new Set<string>();

      const columnDefs = headers.map((header, i) => {
          const originalHeader = header;
          let sanitizedHeader = header.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_').toLowerCase();
          
          if (sanitizedHeader === '' || /^_+$/.test(sanitizedHeader)) {
              sanitizedHeader = `column_${i + 1}`;
          }
          
          let finalColName = sanitizedHeader;
          let counter = 1;
          while (usedColumnNames.has(finalColName)) {
              finalColName = `${sanitizedHeader}_${counter++}`;
          }
          usedColumnNames.add(finalColName);

          const value = sampleRow[i];
          let type = 'TEXT';
          if (value && !isNaN(Number(value)) && value.trim() !== '') {
              type = value.includes('.') ? 'REAL' : 'INTEGER';
          }

          newSchema.push({
              originalName: originalHeader,
              sanitizedName: finalColName,
              sqlType: type,
          });

          return `"${finalColName}" ${type}`;
      }).join(', ');
      
      await db.query(`DROP TABLE IF EXISTS "${tableName}";`);
      await db.query(`CREATE TABLE "${tableName}" (${columnDefs});`);

      const colNames = newSchema.map(c => `"${c.sanitizedName}"`).join(', ');
      const placeholders = headers.map((_, i) => `$${i + 1}`).join(', ');
      const insertQuery = `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders});`;

      await db.query('BEGIN;');
      for (const row of rows) {
        const typedRow = newSchema.map((columnSchema, i) => {
          const value = row[i];

          if (value === undefined || value === null || value.trim() === '') {
            return null;
          }
          
          if (columnSchema.sqlType !== 'TEXT') {
            const num = Number(value);
            return isNaN(num) ? null : num;
          }
          
          return value;
        });

        await db.query(insertQuery, typedRow);
      }
      await db.query('COMMIT;');

      await this.refreshTables();
      this.error.set(null);
    } catch (error: any) {
      if (db.query) await db.query('ROLLBACK;').catch(() => {});
      this.error.set(`加载 '${sourceName}' 时出错: ${error.message}`);
    } finally {
      this.isLoading.set(false);
    }
  }
  
  toggleSelectedColumn(tableName: string, column: TableColumn): void {
    this.selectedColumns.update(currentSelection => {
      const newSelection = [...currentSelection];
      const index = newSelection.findIndex(c => c.tableName === tableName && c.columnName === column.originalName);

      if (index > -1) {
        // Remove if already selected
        newSelection.splice(index, 1);
      } else {
        // Add if not selected
        newSelection.push({ tableName, columnName: column.originalName, sqlType: column.sqlType });
      }
      return newSelection;
    });
  }
  
  toggleSelectTable(tableName: string): void {
    const table = this.tables().find(t => t.name === tableName);
    if (!table) return;

    const tableColumns = table.schema.map(col => ({
      tableName: table.name,
      columnName: col.originalName,
      sqlType: col.sqlType
    }));

    const selectionState = this.getTableSelectionState(tableName);

    this.selectedColumns.update(currentSelection => {
      // 从当前选择中移除此表的所有列，以便重新计算
      const otherTablesSelection = currentSelection.filter(selCol => selCol.tableName !== tableName);
      
      // 如果并非所有列都被选中，则选中所有列。否则，取消选中所有列（通过仅返回其他表已选中的列）。
      if (selectionState !== 'all') {
        return [...otherTablesSelection, ...tableColumns];
      } else {
        return otherTablesSelection;
      }
    });
  }

  getTableSelectionState(tableName: string): 'all' | 'some' | 'none' {
    const table = this.tables().find(t => t.name === tableName);
    if (!table || table.schema.length === 0) return 'none';

    const totalColumns = table.schema.length;
    const selectedCount = this.selectedColumns().filter(c => c.tableName === tableName).length;

    if (selectedCount === 0) {
      return 'none';
    } else if (selectedCount === totalColumns) {
      return 'all';
    } else {
      return 'some';
    }
  }

  isSelected(tableName: string, columnName: string): boolean {
    return this.selectedColumns().some(c => c.tableName === tableName && c.columnName === columnName);
  }

  clearSelectedColumns(): void {
    this.selectedColumns.set([]);
  }

  // FIX: Corrected return type to `Results` which is the correct type.
  async runQuery(query: string): Promise<Results<any>> {
    const db = this.db();
    if (!db) {
      throw new Error('数据库尚未初始化。');
    }

    // 使用事务来确保 DDL 在刷新 schema 之前已提交。
    const result = await db.transaction(async (tx) => {
      return await tx.query(query);
    });

    // 在 schema 修改查询后，刷新表列表
    const cleanedQuery = query
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .trim();
    const isSchemaModifyingQuery = /^\s*(CREATE|DROP|ALTER|TRUNCATE)\s/i.test(cleanedQuery);
    if (isSchemaModifyingQuery) {
        await this.refreshTables();
    }

    return result;
  }
}