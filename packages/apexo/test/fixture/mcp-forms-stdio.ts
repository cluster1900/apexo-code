import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { formServer } from "./mcp-forms"

await formServer().connect(new StdioServerTransport())
