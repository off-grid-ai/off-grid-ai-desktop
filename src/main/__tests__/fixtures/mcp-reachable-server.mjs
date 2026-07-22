import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({ name: 'reachable-connector-test', version: '1.0.0' })

server.registerTool(
  'read_status',
  { description: 'Returns the synthetic connector status.' },
  async () => ({ content: [{ type: 'text', text: 'reachable' }] })
)

await server.connect(new StdioServerTransport())
