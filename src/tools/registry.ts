import type { ToolMeta } from './types'

const tools: Map<string, ToolMeta> = new Map()

export function registerTool(tool: ToolMeta): void {
  tools.set(tool.id, tool)
}

export function getAllTools(): ToolMeta[] {
  return Array.from(tools.values())
}

export function getToolById(id: string): ToolMeta | undefined {
  return tools.get(id)
}
