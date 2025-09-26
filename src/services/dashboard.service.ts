import { Injectable, signal, inject, effect } from '@angular/core';
import { DatabaseService } from './database.service';

export interface ChartConfig {
  id: string;
  title: string;
  query: string;
  chartType: 'bar' | 'pie' | 'line';
  labelColumn: string;
  dataColumn: string;
}

// A displayable chart includes the data, which is fetched dynamically
export interface DisplayableChart extends ChartConfig {
  data: any[];
  headers: string[];
}

export interface KpiCardConfig {
  id: string;
  title: string;
  icon: string;
  primaryQuery: string;
  secondaryTitle: string;
  secondaryQuery: string;
  drillDownTableName: string;
  format?: 'currency' | 'number';
}

export interface KpiCardData extends KpiCardConfig {
  primaryValue: string | number;
  secondaryData: { label: string; value: string | number }[];
  isLoading: boolean;
  error: string | null;
}

const DEFAULT_KPI_CONFIGS: KpiCardConfig[] = [
  {
    id: 'total_sales',
    title: '总销售额',
    icon: '💰',
    primaryQuery: 'SELECT SUM("销售额") as value FROM "sales_data"',
    secondaryTitle: '按地区划分',
    secondaryQuery: 'SELECT "地区" as label, SUM("销售额") as value FROM "sales_data" GROUP BY "地区" ORDER BY value DESC LIMIT 3',
    drillDownTableName: 'sales_data',
    format: 'currency'
  },
  {
    id: 'total_orders',
    title: '总订单',
    icon: '🛒',
    primaryQuery: 'SELECT COUNT(*) as value FROM "sales_data"',
    secondaryTitle: '按产品划分',
    secondaryQuery: 'SELECT "产品" as label, COUNT(*) as value FROM "sales_data" GROUP BY "产品" ORDER BY value DESC LIMIT 3',
    drillDownTableName: 'sales_data',
  },
  {
    id: 'distinct_products',
    title: '售出产品种类',
    icon: '📦',
    primaryQuery: 'SELECT COUNT(DISTINCT "产品") as value FROM "sales_data"',
    secondaryTitle: '按地区划分',
    secondaryQuery: 'SELECT "地区" as label, COUNT(DISTINCT "产品") as value FROM "sales_data" GROUP BY "地区" ORDER BY value DESC LIMIT 3',
    drillDownTableName: 'products',
  },
  {
    id: 'total_employees',
    title: '总员工',
    icon: '👥',
    primaryQuery: 'SELECT COUNT(*) as value FROM "employees"',
    secondaryTitle: '按部门划分',
    secondaryQuery: 'SELECT "部门" as label, COUNT(*) as value FROM "employees" GROUP BY "部门" ORDER BY value DESC LIMIT 3',
    drillDownTableName: 'employees',
  },
];

@Injectable({
  providedIn: 'root',
})
export class DashboardService {
  databaseService = inject(DatabaseService);

  // Pinned chart configurations (without data)
  pinnedCharts = signal<ChartConfig[]>([]);
  // Displayable charts (with data, dynamically updated)
  displayableCharts = signal<DisplayableChart[]>([]);
  
  kpiCards = signal<KpiCardData[]>([]);

  // Signals for global filtering
  availableRegions = signal<string[]>([]);
  activeRegionFilter = signal<string | null>(null);

  constructor() {
    this.initializeKpis();
    effect(() => {
      // This effect runs whenever the database is ready or the filter changes
      if (this.databaseService.dbStatus() === 'ready') {
        if (this.availableRegions().length === 0) {
          this.loadAvailableRegions();
        }
        this.loadKpiData();
        this.updateDisplayableCharts();
      }
    });
  }

  private initializeKpis(): void {
    const initialKpis = DEFAULT_KPI_CONFIGS.map(config => ({
      ...config,
      primaryValue: 0,
      secondaryData: [],
      isLoading: true,
      error: null,
    }));
    this.kpiCards.set(initialKpis);
  }

  setRegionFilter(region: string | null): void {
    this.activeRegionFilter.set(region);
  }

  private async loadAvailableRegions(): Promise<void> {
    try {
      const result = await this.databaseService.runQuery('SELECT DISTINCT "地区" as region FROM "sales_data" WHERE "地区" IS NOT NULL ORDER BY region');
      this.availableRegions.set(result.rows?.map(r => r.region) ?? []);
    } catch(e) {
      console.error("Failed to load available regions for filter:", e);
    }
  }

  private injectWhereClause(query: string, where: string): string {
    if (!where) return query;

    // A simple injection logic that assumes WHERE comes before GROUP BY, ORDER BY, or LIMIT.
    const upperQuery = query.toUpperCase();
    const groupByIndex = upperQuery.indexOf('GROUP BY');
    const orderByIndex = upperQuery.indexOf('ORDER BY');
    const limitIndex = upperQuery.indexOf('LIMIT');

    let insertionPoint = -1;
    const indices = [groupByIndex, orderByIndex, limitIndex].filter(i => i > -1);
    if (indices.length > 0) {
      insertionPoint = Math.min(...indices);
    }

    if (insertionPoint > -1) {
      return `${query.substring(0, insertionPoint).trim()} ${where} ${query.substring(insertionPoint)}`;
    }
    
    // No GROUP BY, ORDER BY, or LIMIT, so append at the end.
    // Note: this doesn't handle existing WHERE clauses. Assumes queries are simple.
    return `${query.trim()} ${where}`;
  }

  private async loadKpiData(): Promise<void> {
    const filter = this.activeRegionFilter();
    // Only apply region filter to queries involving sales_data
    const getWhereClause = (query: string) => {
      return filter && query.includes('"sales_data"')
        ? `WHERE "地区" = '${filter.replace(/'/g, "''")}'`
        : '';
    }

    for (const kpi of this.kpiCards()) {
      // Don't re-fetch for non-sales related KPIs if filter is active
      if (filter && !kpi.primaryQuery.includes('"sales_data"')) {
        continue;
      }

      try {
        // Fetch primary value with filter
        const primaryWhere = getWhereClause(kpi.primaryQuery);
        const modifiedPrimaryQuery = this.injectWhereClause(kpi.primaryQuery, primaryWhere);
        const primaryResult = await this.databaseService.runQuery(modifiedPrimaryQuery);
        const primaryValue = primaryResult.rows?.[0]?.value ?? 0;

        // Fetch secondary data with filter
        const secondaryWhere = getWhereClause(kpi.secondaryQuery);
        const modifiedSecondaryQuery = this.injectWhereClause(kpi.secondaryQuery, secondaryWhere);
        const secondaryResult = await this.databaseService.runQuery(modifiedSecondaryQuery);
        const secondaryData = secondaryResult.rows?.map(row => ({
          label: row.label,
          value: row.value
        })) ?? [];

        this.kpiCards.update(cards => {
          const cardToUpdate = cards.find(c => c.id === kpi.id);
          if (cardToUpdate) {
            cardToUpdate.primaryValue = primaryValue;
            cardToUpdate.secondaryData = secondaryData;
            cardToUpdate.isLoading = false;
            cardToUpdate.error = null;
          }
          return [...cards];
        });

      } catch (e: any) {
        console.error(`Failed to load KPI data for ${kpi.title}:`, e);
        this.kpiCards.update(cards => {
          const cardToUpdate = cards.find(c => c.id === kpi.id);
          if (cardToUpdate) {
            cardToUpdate.isLoading = false;
            cardToUpdate.error = '加载数据失败';
          }
          return [...cards];
        });
      }
    }
  }

  private async updateDisplayableCharts(): Promise<void> {
    const charts = this.pinnedCharts();
    const filter = this.activeRegionFilter();
    const whereClause = filter ? `WHERE "地区" = '${filter.replace(/'/g, "''")}'` : '';
    
    const newChartsData: DisplayableChart[] = [];
    for (const chartConfig of charts) {
      try {
        const modifiedQuery = this.injectWhereClause(chartConfig.query, whereClause);
        const result = await this.databaseService.runQuery(modifiedQuery);
        newChartsData.push({
          ...chartConfig,
          data: result.rows ?? [],
          headers: result.fields?.map(f => f.name) ?? [],
        });
      } catch (e) {
        console.error(`Failed to update chart data for ${chartConfig.title}`, e);
        // Add chart with empty data on error to avoid breaking UI
        newChartsData.push({ ...chartConfig, data: [], headers: [] });
      }
    }
    this.displayableCharts.set(newChartsData);
  }

  addChart(chart: Omit<DisplayableChart, 'id'>): void {
    // Persist only the configuration, not the data
    const { data, headers, ...config } = chart;
    const newChart: ChartConfig = {
      ...config,
      id: `chart_${Date.now()}_${Math.random()}`
    };
    this.pinnedCharts.update(charts => [...charts, newChart]);
  }

  removeChart(chartId: string): void {
    this.pinnedCharts.update(charts => charts.filter(c => c.id !== chartId));
  }

  drillDown(chart: DisplayableChart, drillDownValue: string | number): void {
    const fromMatch = chart.query.match(/\bFROM\s+("?[\w_]+"?)/i);
    if (!fromMatch || !fromMatch[1]) {
      console.error("无法从查询中解析表名以进行下钻:", chart.query);
      return;
    }
    const tableName = fromMatch[1];
    
    const sampleValue = chart.data[0]?.[chart.labelColumn];
    const isNumeric = typeof sampleValue === 'number';
    
    const whereValue = isNumeric 
      ? drillDownValue 
      : `'${String(drillDownValue).replace(/'/g, "''")}'`;

    const newQuery = `SELECT *\nFROM ${tableName}\nWHERE "${chart.labelColumn}" = ${whereValue};`;
    
    this.databaseService.drillDownQuery.set(newQuery);
  }

  drillDownFromKpi(tableName: string): void {
    // 确保表名被正确引用，以防存在特殊字符
    const safeTableName = `"${tableName.replace(/"/g, '""')}"`;
    const newQuery = `SELECT *\nFROM ${safeTableName}\nLIMIT 100;`;
    this.databaseService.drillDownQuery.set(newQuery);
  }
}