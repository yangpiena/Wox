import { logger } from "./logger"
import path from "path"
import { PluginAPI } from "./pluginAPI"
import { Plugin, PluginInitContext, Query, Result } from "@wox-launcher/wox-plugin"
import { WebSocket } from "ws"

const pluginMap = new Map<string, unknown>()
const actionCacheByPlugin = new Map<PluginJsonRpcRequest["PluginId"], Map<Result["Id"], Result["Action"]>>()

export const PluginJsonRpcTypeRequest: string = "WOX_JSONRPC_REQUEST"
export const PluginJsonRpcTypeResponse: string = "WOX_JSONRPC_RESPONSE"

export interface PluginJsonRpcRequest {
  Id: string
  PluginId: string
  PluginName: string
  Type: string
  Method: string
  Params: {
    [key: string]: string
  }
}

export interface PluginJsonRpcResponse {
  Id: string
  Method: string
  Type: string
  Error?: string
  Result?: unknown
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export async function handleRequestMessage(request: PluginJsonRpcRequest, ws: WebSocket): unknown {
  logger.info(`[${request.PluginName}] invoke method: ${request.Method}, parameters: ${JSON.stringify(request.Params)}`)

  switch (request.Method) {
    case "loadPlugin":
      return await loadPlugin(request)
    case "init":
      return initPlugin(request, ws)
    case "query":
      return query(request)
    case "action":
      return action(request)
    default:
      logger.info(`unknown method handler: ${request.Method}`)
      throw new Error(`unknown method handler: ${request.Method}`)
  }
}

async function loadPlugin(request: PluginJsonRpcRequest) {
  const pluginDirectory = request.Params.PluginDirectory
  const entry = request.Params.Entry
  const modulePath = path.join(pluginDirectory, entry)

  logger.info(`start to load plugin: ${modulePath}`)

  const module = await import(modulePath)
  if (module["plugin"] === undefined) {
    logger.error(`plugin doesn't export plugin object`)
    return
  }

  pluginMap.set(request.PluginId, module["plugin"])
}

function getMethod<M extends keyof Plugin>(request: PluginJsonRpcRequest, methodName: M): Plugin[M] {
  const plugin = pluginMap.get(request.PluginId)
  if (plugin === undefined) {
    logger.error(`plugin not found: ${request.PluginName}, forget to load plugin?`)
    throw new Error(`plugin not found: ${request.PluginName}, forget to load plugin?`)
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const method = plugin[methodName]
  if (method === undefined) {
    logger.info(`plugin method not found: ${request.PluginName}`)
    throw new Error(`plugin method not found: ${request.PluginName}`)
  }

  return method
}

async function initPlugin(request: PluginJsonRpcRequest, ws: WebSocket) {
  const init = getMethod(request, "init")
  await init({ API: new PluginAPI(ws, request.PluginId, request.PluginName) } as PluginInitContext)
}

async function query(request: PluginJsonRpcRequest) {
  const query = getMethod(request, "query")

  //clean action cache for current plugin
  actionCacheByPlugin.set(request.PluginId, new Map<Result["Id"], Result["Action"]>())
  const actionCache = actionCacheByPlugin.get(request.PluginId)!

  const results = await query({
    RawQuery: request.Params.RawQuery,
    TriggerKeyword: request.Params.TriggerKeyword,
    Command: request.Params.Command,
    Search: request.Params.Search
  } as Query)

  // save result action for later use
  results.forEach(result => {
    actionCache.set(result.Id, result.Action)
  })
  return results
}

async function action(request: PluginJsonRpcRequest) {
  const pluginActionCache = actionCacheByPlugin.get(request.PluginId)
  if (pluginActionCache === undefined || pluginActionCache === null) {
    logger.error(`plugin action cache not found: ${request.PluginName}`)
    return
  }

  const pluginAction = pluginActionCache.get(request.Params.ActionId)
  if (pluginAction === undefined || pluginAction === null) {
    logger.error(`plugin action not found: ${request.PluginName}`)
    return
  }

  return pluginAction()
}
