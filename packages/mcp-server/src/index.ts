#!/usr/bin/env node
// koimsurai 後台 MCP server（stdio）。
// Claude Code / Desktop 會把這支當子程序啟動，透過 stdin/stdout 講 MCP；
// 本 server 再以 admin JWT 打後端 127.0.0.1:3002 的 REST API。
//
// ⚠️ stdio transport：stdout 是協定通道，任何日誌一律走 stderr（console.error），
//    絕不能 console.log，否則會污染 MCP 訊息。
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { ApiClient } from './api.js';
import { resolveCredentials } from './credentials.js';
import { makeTools } from './tools.js';

const api = new ApiClient({
  baseUrl: process.env.KOIMSURAI_API_URL ?? 'http://127.0.0.1:3002',
  ...resolveCredentials(),
});

const tools = makeTools(api);
const byName = new Map(tools.map((t) => [t.name, t]));

const server = new Server({ name: 'koimsurai-admin', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = byName.get(req.params.name);
  if (!tool) {
    return { content: [{ type: 'text', text: `未知工具：${req.params.name}` }], isError: true };
  }
  try {
    const result = await tool.handler((req.params.arguments ?? {}) as Record<string, unknown>);
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `錯誤：${msg}` }], isError: true };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[koimsurai-mcp] 已就緒（stdio）');
}

main().catch((err: unknown) => {
  console.error('[koimsurai-mcp] 啟動失敗：', err);
  process.exit(1);
});
