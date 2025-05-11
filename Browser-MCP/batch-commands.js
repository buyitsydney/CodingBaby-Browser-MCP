import { z } from "zod"
import { formatResponse } from "./utils.js"

/**
 * 批处理命令 (batch) 使用示例:
 *
 * 示例1: 搜索操作 - 点击搜索框、输入文本、按回车
 * ```
 * batch({
 *   "operations": [
 *     {"name": "click", "parameters": {"coordinate": "500,200"}},
 *     {"name": "type", "parameters": {"text": "搜索关键词"}},
 *     {"name": "press_key", "parameters": {"key": "Enter"}}
 *   ],
 *   "interval_ms": 300
 * })
 * ```
 *
 * 示例2: 表单填写 - 点击输入框、输入文本、点击下一个字段
 * ```
 * batch({
 *   "operations": [
 *     {"name": "click", "parameters": {"coordinate": "300,200"}},
 *     {"name": "type", "parameters": {"text": "用户名"}},
 *     {"name": "click", "parameters": {"coordinate": "300,250"}},
 *     {"name": "type", "parameters": {"text": "密码"}},
 *     {"name": "click", "parameters": {"coordinate": "400,300"}}
 *   ],
 *   "interval_ms": 300
 * })
 * ```
 *
 * 示例3: 页面导航与等待 - 点击链接并等待
 * ```
 * batch({
 *   "operations": [
 *     {"name": "click", "parameters": {"coordinate": "500,300"}},
 *     {"name": "wait", "parameters": {"seconds": 1}},
 *     {"name": "scroll", "parameters": {"direction": "down"}}
 *   ],
 *   "interval_ms": 500
 * })
 * ```
 */

/**
 * 注册批处理工具
 * @param {Object} server - MCP服务器实例
 * @param {Object} chromeClient - Chrome客户端实例
 */
export function registerBatchTools(server, chromeClient) {
	// 注册批处理工具
	server.tool(
		"batch",
		"Execute a batch of browser operations in sequence. This powerful tool allows combining multiple actions (click, type, press_key, etc.) into a single command, reducing round-trip time. Ideal for form filling, search operations, and simple navigation sequences.",
		{
			operations: z
				.array(
					z.object({
						name: z
							.string()
							.describe(
								"Name of the operation to execute. Supported operations: 'click', 'type', 'press_key', 'press_key_combo', 'scroll', 'wait'",
							),
						parameters: z
							.object({})
							.passthrough()
							.describe(
								"Parameters for the operation. Common parameters by operation type:\n- click: {coordinate: 'x,y'}\n- type: {text: 'text to type'}\n- press_key: {key: 'Enter/ArrowLeft/etc'}\n- press_key_combo: {combination: 'Control+C/Command+V/etc'}\n- scroll: {direction: 'up/down/left/right', selector: 'optional CSS selector'}\n- wait: {seconds: number}",
							),
					}),
				)
				.describe(
					"Array of operations to execute in sequence. Example: [{name: 'click', parameters: {coordinate: '500,300'}}, {name: 'type', parameters: {text: 'search term'}}, {name: 'press_key', parameters: {key: 'Enter'}}]",
				),
			interval_ms: z
				.number()
				.optional()
				.describe(
					"Interval between operations in milliseconds. Default: 100ms. Use higher values (300-500ms) for complex operations.",
				),
		},
		async (params) => {
			try {
				// 验证客户端状态
				if (!chromeClient.isLaunched()) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									status: "error",
									message: "浏览器未初始化。请先使用navigate或tab_new命令打开一个页面。",
								}),
							},
						],
					}
				}

				// 直接使用chromeClient.batch方法将批处理命令透传给插件
				const results = await chromeClient.batch(params.operations, params.interval_ms || 100)

				return formatResponse(results)
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error executing batch operations: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)
}
