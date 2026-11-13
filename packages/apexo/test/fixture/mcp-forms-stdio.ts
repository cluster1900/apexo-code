import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { formServer } from "./mcp-forms"

await formServer({ stateless: process.env.MCP_FORMS_STATELESS === "true" }).connect(new StdioServerTransport())
