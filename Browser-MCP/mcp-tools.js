import { z } from "zod"
import { formatResponse } from "./utils.js"

/**
 * 注册所有MCP工具
 * @param {Object} server - MCP服务器实例
 * @param {Object} chromeClient - Chrome浏览器客户端实例
 */
export function registerMcpTools(server, chromeClient) {
	// 注册工具：MCP Browser Navigate
	server.tool(
		"navigate",
		"Navigate to a URL",
		{
			url: z.string().describe("The URL to navigate to"),
		},
		async (params) => {
			try {
				// 确保客户端已初始化
				if (!chromeClient.isLaunched()) {
					// 初始化WebSocket服务器
					await chromeClient.initialize()
					// 使用tabNew创建新标签页
					const result = await chromeClient.tabNew(params.url)
					return formatResponse(result)
				} else {
					// 已经初始化，正常导航
					const result = await chromeClient.navigate(params.url)
					return formatResponse(result)
				}
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error navigating: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)

	// 注册工具：MCP Browser Click
	server.tool(
		"click",
		"Perform click on a web page",
		{
			coordinate: z.string().describe("Coordinates to click (x,y)"),
		},
		async (params) => {
			try {
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

				const result = await chromeClient.click(params.coordinate)
				return formatResponse(result)
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error clicking: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)

	// 注册工具：MCP Browser Type
	server.tool(
		"type",
		"Type text into focused element",
		{
			text: z.string().describe("Text to type"),
		},
		async (params) => {
			try {
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

				const result = await chromeClient.type(params.text)
				return formatResponse(result)
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error typing: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)

	// 注册工具：MCP Browser Press Key
	server.tool(
		"press_key",
		"Press a key or key combination on the keyboard",
		{
			key: z
				.string()
				.describe(
					"Name of the key to press, such as 'ArrowLeft', 'Enter' or a key combination like 'Control+C', 'Command+V'",
				),
		},
		async (params) => {
			try {
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

				let result
				// 检查是否为组合键（包含+号）
				if (params.key.includes("+")) {
					result = await chromeClient.pressKeyCombination(params.key)
				} else {
					result = await chromeClient.pressKey(params.key)
				}

				return formatResponse(result)
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error pressing key: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)

	// 注册工具：MCP Browser Close
	server.tool(
		"close",
		"Close the browser",
		{
			purpose: z.string().describe("give any string, workaround for no-parameter tools."),
		},
		async (params) => {
			try {
				if (!chromeClient.isLaunched()) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									status: "success",
									message: "Browser not running.",
								}),
							},
						],
					}
				}

				const result = await chromeClient.close()
				return formatResponse(result)
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error closing browser: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)

	// 注册工具：MCP Browser Scroll
	server.tool(
		"scroll",
		"Scroll the page in a specified direction",
		{
			direction: z.string().describe("Direction to scroll: up, down, left, or right"),
			selector: z.string().optional().describe("CSS selector for the element to scroll (optional)"),
		},
		async (params) => {
			try {
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

				const result = await chromeClient.scroll(params.direction, params.selector)
				return formatResponse(result)
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error scrolling: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)
	/*
	// 注册工具：MCP Browser Save HTML
	server.tool(
		"save_html",
		"Save the current page HTML to a file",
		{
			filename: z.string().optional().describe("Optional filename to save the HTML to"),
		},
		async (params) => {
			try {
				if (!chromeClient.isLaunched()) {
					await chromeClient.initialize()
				}

				const result = await chromeClient.saveFullHtml(params.filename)

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: result.status,
								message: result.message,
								path: result.path,
								size: result.size,
							}),
						},
					],
				}
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error saving HTML: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)
*/
	// 注册工具：MCP Browser Set Viewport
	server.tool(
		"set_viewport",
		"Set the viewport configuration of the browser",
		{
			width: z.number().describe("Width of the browser viewport"),
			height: z.number().describe("Height of the browser viewport"),
		},
		async (params) => {
			try {
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

				const result = await chromeClient.setViewport(params.width, params.height)

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: result.status,
								message: result.message,
								viewport: result.viewport,
							}),
						},
					],
				}
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error setting viewport: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)

	// 注册工具：MCP Browser Area Screenshot
	server.tool(
		"area_screenshot",
		"Take a screenshot of a specific area of the current page",
		{
			topLeft: z.string().describe("Top-left coordinate (x,y) of the area to capture"),
			bottomRight: z.string().describe("Bottom-right coordinate (x,y) of the area to capture"),
		},
		async (params) => {
			try {
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

				const result = await chromeClient.takeAreaScreenshot(params.topLeft, params.bottomRight)

				// 创建响应
				const content = [
					{
						type: "text",
						text: JSON.stringify({
							status: result.status,
							message: result.message,
							savedPath: result.savedPath,
						}),
					},
				]

				// 如果有截图，添加为图像类型
				if (result.screenshot && typeof result.screenshot === "string" && result.screenshot.startsWith("data:image")) {
					const base64Data = result.screenshot.split(",")[1]
					const mimeType = result.screenshot.split(",")[0].split(":")[1].split(";")[0]

					content.push({
						type: "image",
						data: base64Data,
						mimeType: mimeType || "image/jpeg",
					})
				}

				return { content }
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error taking area screenshot: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)

	// 注册工具：MCP Browser Wait
	server.tool(
		"wait",
		"Wait for a specified number of seconds, with a screenshot of the current page state after waiting",
		{
			seconds: z.number().describe("Number of seconds to wait"),
		},
		async (params) => {
			try {
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

				const result = await chromeClient.wait(params.seconds)
				return formatResponse(result)
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error waiting: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)

	// 注册工具：MCP Browser Tab List
	server.tool(
		"tab_list",
		"List browser tabs",
		{
			purpose: z.string().describe("give any string, workaround for no-parameter tools."),
		},
		async (params) => {
			try {
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

				const result = await chromeClient.tabList()
				return formatResponse(result)
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error listing tabs: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)

	// 注册工具：MCP Browser Tab New
	server.tool(
		"tab_new",
		"Open a new tab",
		{
			url: z
				.string()
				.optional()
				.describe("The URL to navigate to in the new tab. If not provided, the new tab will be blank."),
		},
		async (params) => {
			try {
				if (!chromeClient.isLaunched()) {
					// 仅初始化WebSocket服务器
					await chromeClient.initialize()
				}

				// 直接调用tabNew，不再使用launch
				const result = await chromeClient.tabNew(params.url)
				return formatResponse(result)
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error creating new tab: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)

	// 注册工具：MCP Browser Tab Select
	server.tool(
		"tab_select",
		"Select a tab by index",
		{
			index: z.number().describe("The index of the tab to select"),
		},
		async (params) => {
			try {
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

				const result = await chromeClient.tabSelect(params.index)
				return formatResponse(result)
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error selecting tab: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)

	// 注册工具：MCP Browser Tab Close
	server.tool(
		"tab_close",
		"Close a tab",
		{
			index: z.number().optional().describe("The index of the tab to close. Closes current tab if not provided."),
		},
		async (params) => {
			try {
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

				const result = await chromeClient.tabClose(params.index)
				return formatResponse(result)
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "error",
								message: `Error closing tab: ${error.message}`,
							}),
						},
					],
				}
			}
		},
	)
}
