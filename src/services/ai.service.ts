import { Injectable, signal, inject } from '@angular/core';
import { GoogleGenAI } from '@google/genai';
import { DatabaseService } from './database.service';

export interface SqlSuggestion {
  query: string;
  description: string;
  isComplete: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class AiService {
  private databaseService = inject(DatabaseService);
  private ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
  
  isLoading = signal(false);
  error = signal<string | null>(null);
  suggestions = signal<SqlSuggestion[]>([]);

  async generateSqlFromNaturalLanguage(naturalLanguagePrompt: string): Promise<string | null> {
    this.isLoading.set(true);
    this.error.set(null);
    
    try {
        const selectedColumns = this.databaseService.selectedColumns();
        if (selectedColumns.length === 0) {
            throw new Error("请至少选择一列以生成 SQL。");
        }
        
        // FIX: Replaced `reduce` with a `for...of` loop to fix a type inference error on `columns.join`.
        // This approach is more robust and readable for grouping columns by table.
        const groupedColumns: Record<string, string[]> = {};
        for (const col of selectedColumns) {
            if (!groupedColumns[col.tableName]) {
                groupedColumns[col.tableName] = [];
            }
            groupedColumns[col.tableName].push(`"${col.columnName}" (type: ${col.sqlType})`);
        }

        const formattedColumns = Object.entries(groupedColumns)
            .map(([tableName, columns]) => `- 表 "${tableName}": ${columns.join(', ')}`)
            .join('\n');

        const prompt = `你是一位专业的 SQL 数据分析师。你的任务是根据用户的请求和提供的数据库模式，编写一个单一、有效的 PostgreSQL 查询。

**规则:**
1.  只输出原始 SQL 查询。
2.  不要包含任何解释、markdown、代码块定界符（\`\`\`sql）或任何非 SQL 文本。
3.  确保查询语法对 PostgreSQL 有效。
4.  使用提供的表名和列名。

**数据库模式:**
${formattedColumns}

**用户请求:**
${naturalLanguagePrompt}
`;

        const response = await this.ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
        });

        const sqlQuery = response.text.trim();
        // A simple check to remove markdown if the model accidentally adds it.
        return sqlQuery.replace(/```sql|```/g, '').trim();

    } catch (err: any) {
        console.error("AI SQL generation error:", err);
        const errorMessage = `生成 SQL 时出错: ${err.message || '未知错误'}`;
        this.error.set(errorMessage);
        this.databaseService.error.set(errorMessage);
        return null;
    } finally {
        this.isLoading.set(false);
    }
  }

  async streamSqlSuggestions(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    this.suggestions.set([]);
    const selectedColumns = this.databaseService.selectedColumns();

    if (selectedColumns.length === 0) {
      this.isLoading.set(false);
      this.error.set("请至少选择一列。");
      return;
    }
    
    // 按表对列进行分组
    // FIX: Replaced `reduce` with a `for...of` loop to fix a type inference error on `columns.join`.
    // This approach is more robust and readable for grouping columns by table.
    const groupedColumns: Record<string, string[]> = {};
    for (const col of selectedColumns) {
        if (!groupedColumns[col.tableName]) {
            groupedColumns[col.tableName] = [];
        }
        groupedColumns[col.tableName].push(`"${col.columnName}" (type: ${col.sqlType})`);
    }

    const formattedColumns = Object.entries(groupedColumns)
        .map(([tableName, columns]) => `- 表 "${tableName}": ${columns.join(', ')}`)
        .join('\n');

    const prompt = `你是一位专业的 SQL 数据分析师。你的用户从数据库表中选择了一组列，并希望得到一些探索这些数据的想法。

数据库与 PostgreSQL 兼容。

以下是用户选择的列：
${formattedColumns}

根据这些列，请生成 3 到 5 个不同且富有洞察力的探索性 SQL 查询。这些查询应该适合业务用户，帮助他们发现数据中的趋势、聚合、关系或异常值。如果选择了多个表中的列，请优先考虑生成使用 JOIN 的查询。

重要提示：你必须以特定格式流式传输你的回复。对于每个建议，请严格遵循以下结构，不要添加任何额外的格式，例如 markdown。
1.  首先，输出描述，以 \`DESCRIPTION:\` 开头，并在其自己的行上结束。
2.  然后，输出 SQL 查询，以 \`QUERY:\` 开头。查询可以在多行上。
3.  在每个查询的末尾，输出一个分隔符 \`===END_SUGGESTION===\`，它必须在自己的行上。

例如:
DESCRIPTION: 计算每个区域的总销售额和平均利润。
QUERY: SELECT
  "region",
  SUM("sales") AS "total_sales",
  AVG("profit") AS "average_profit"
FROM "sales_data"
GROUP BY "region"
ORDER BY "total_sales" DESC;
===END_SUGGESTION===
`;
    
    let buffer = '';
    let state: 'IDLE' | 'PARSING_DESCRIPTION' | 'PARSING_QUERY' = 'IDLE';
    let currentDescription = '';
    let currentQuery = '';

    try {
        const stream = await this.ai.models.generateContentStream({
            model: "gemini-2.5-flash",
            contents: prompt,
        });

        for await (const chunk of stream) {
            buffer += chunk.text;

            let continueProcessing = true;
            while (continueProcessing) {
                continueProcessing = false;

                switch (state) {
                    case 'IDLE': {
                        const descMarker = 'DESCRIPTION:';
                        const descIndex = buffer.indexOf(descMarker);
                        if (descIndex !== -1) {
                            buffer = buffer.substring(descIndex + descMarker.length);
                            
                            // 开始一个新的建议
                            currentDescription = '';
                            currentQuery = '';
                            this.suggestions.update(s => [...s, { description: '', query: '', isComplete: false }]);
                            
                            state = 'PARSING_DESCRIPTION';
                            continueProcessing = true;
                        }
                        break;
                    }
                    case 'PARSING_DESCRIPTION': {
                        const queryMarker = '\nQUERY:';
                        const queryIndex = buffer.indexOf(queryMarker);
                        if (queryIndex !== -1) {
                            const descPart = buffer.substring(0, queryIndex);
                            currentDescription += descPart;
                            
                            // 更新此建议的最终描述
                            this.suggestions.update(current => {
                                const last = current[current.length - 1];
                                if (last) last.description = currentDescription;
                                return [...current];
                            });
                            
                            buffer = buffer.substring(queryIndex + queryMarker.length);
                            state = 'PARSING_QUERY';
                            continueProcessing = true;
                        }
                        break;
                    }
                    case 'PARSING_QUERY': {
                        const endMarker = '===END_SUGGESTION===';
                        const endIndex = buffer.indexOf(endMarker);
                        if (endIndex !== -1) {
                            const queryPart = buffer.substring(0, endIndex);
                            currentQuery += queryPart;
                            
                            this.suggestions.update(current => {
                                const last = current[current.length - 1];
                                if (last) {
                                    last.query = currentQuery;
                                    last.isComplete = true;
                                }
                                return [...current];
                            });
                            
                            buffer = buffer.substring(endIndex + endMarker.length);
                            state = 'IDLE';
                            continueProcessing = true;
                        }
                        break;
                    }
                }
            }

            // 循环之后，缓冲区中是流式部分。更新 UI。
            const last = this.suggestions().length > 0 ? this.suggestions()[this.suggestions().length - 1] : null;
            if (last && !last.isComplete) {
                if (state === 'PARSING_DESCRIPTION') {
                    // 显示的描述是最终部分 + 流式缓冲区
                    last.description = (currentDescription + buffer);
                } else if (state === 'PARSING_QUERY') {
                    // 显示的查询是最终部分 + 流式缓冲区
                    last.query = (currentQuery + buffer);
                }
                // 我们需要触发变更检测
                this.suggestions.update(s => [...s]);
            }
        }
    } catch (err: any) {
        console.error("AI suggestion error:", err);
        const errorMessage = `生成 AI 建议时出错: ${err.message || '未知错误'}`;
        this.error.set(errorMessage);
    } finally {
        this.isLoading.set(false);
        // 清理任何由于流中断而未完成的建议
        this.suggestions.update(current => {
            if (current.length === 0) return current;

            const last = current[current.length - 1];
            if (last && !last.isComplete) {
                if (state === 'PARSING_DESCRIPTION') {
                    last.description = (currentDescription + buffer).trim();
                } else if (state === 'PARSING_QUERY') {
                    last.query = (currentQuery + buffer).trim();
                }
                
                // 只有当我们确实得到了一些查询文本时，才将其标记为完成。
                if (last.query) {
                    last.isComplete = true;
                } else {
                    // 如果它不完整且没有查询，那么它可能是无效的。将其移除。
                    return current.slice(0, -1);
                }
            }
            // 过滤掉任何可能存在的空建议
            return current.filter(s => (s.description && s.description.trim()) || (s.query && s.query.trim()));
        });
    }
  }

  async generateInsightsFromData(results: any[], headers: string[], userPrompt?: string): Promise<string | null> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      if (results.length === 0 || headers.length === 0) {
        throw new Error("无法从空数据中生成洞察。");
      }

      // Take a sample of the data to avoid sending too much information
      const sampleData = results.slice(0, 50);
      const dataAsJsonString = JSON.stringify(sampleData, null, 2);

      let prompt = `你是一位专业的 SQL 数据分析师。你的任务是分析以 JSON 格式提供的数据样本，并以简洁、易于理解的自然语言总结出关键洞察。

**规则:**
1.  关注数据中的趋势、模式、异常值或有趣的关系。
2.  你的回答应该是 2-3 个项目符号点 (例如, 使用 * 或 -)。
3.  保持每个项目符号点简洁明了。
4.  直接输出洞察，不要包含任何前言或解释。
5.  使用中文进行回答。

**数据样本 (JSON 格式):**
\`\`\`json
${dataAsJsonString}
\`\`\`
`;

      if (userPrompt && userPrompt.trim()) {
        prompt += `
**用户附加问题:**
${userPrompt}

**基于数据和用户问题，请提供您的关键洞察:**
`;
      } else {
        prompt += `
**关键洞察:**
`;
      }

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });

      return response.text.trim();

    } catch (err: any) {
      console.error("AI insight generation error:", err);
      const errorMessage = `生成 AI 洞察时出错: ${err.message || '未知错误'}`;
      this.error.set(errorMessage);
      // Also bubble up to the main error display
      this.databaseService.error.set(errorMessage);
      return null;
    } finally {
      this.isLoading.set(false);
    }
  }

  async generateTableFromImage(imageBase64: string, mimeType: string): Promise<string | null> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const imagePart = {
        inlineData: {
          data: imageBase64,
          mimeType: mimeType,
        },
      };

      const textPart = {
        text: `分析此图片。图片中包含一个表格。
**任务:** 将此表格转换为 CSV 格式。

**规则:**
1.  **第一行必须是标题行。** 尽力从图片中推断出有意义的列名。如果无法推断，请使用 "column_1", "column_2" 等。
2.  确保 CSV 格式正确，使用逗号作为分隔符。
3.  如果单元格中包含逗号，请用双引号将其括起来。
4.  只输出原始的 CSV 文本。不要包含任何解释、markdown、代码块定界符 (\`\`\`csv) 或任何非 CSV 文本。`
      };

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, textPart] },
      });

      const csvText = response.text.trim();
      const cleanedCsv = csvText.replace(/```csv|```/g, '').trim();

      if (!cleanedCsv || cleanedCsv.split('\n').length < 1) {
          throw new Error("AI未能返回有效的 CSV 数据。");
      }

      return cleanedCsv;

    } catch (err: any) {
      console.error("AI image to table error:", err);
      const errorMessage = `从图片生成表格时出错: ${err.message || '未知错误'}`;
      this.error.set(errorMessage);
      this.databaseService.error.set(errorMessage);
      return null;
    } finally {
      this.isLoading.set(false);
    }
  }
}
