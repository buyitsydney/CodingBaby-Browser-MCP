#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { WebSocketServer } from "ws"
import WebSocket from "ws"
import fs from "fs-extra"
import * as path from "path"
import * as os from "os"

// --- Added Signal Handling ---
// Graceful shutdown handler
async function gracefulShutdown(signal) {
	// console.log(`Received ${signal}. Shutting down chrome-server...`); // Removed log
	try {
		// Ensure chromeClient is initialized before calling dispose
		if (chromeClient) {
			await chromeClient.dispose()
			// console.log("Chrome client disposed."); // Removed log
		}
	} catch (error) {
		console.error("Error during dispose:", error) // Keep error log (stderr)
	} finally {
		// console.log("Exiting chrome-server process."); // Removed log
		process.exit(0) // Exit gracefully
	}
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"))
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
// --- End of Signal Handling ---

// 定义WebSocket端口
const WEBSOCKET_PORT = 9876

// 添加在导入部分下方，定义固定的HTML临时文件路径
const tempHtmlPath = path.join(os.tmpdir(), "chrome_server_temp.html")

// 添加固定的图片保存目录
const screenshotSaveDir = path.join(os.tmpdir(), "chrome_extension_screenshots")

// 添加默认的viewport配置
const DEFAULT_VIEWPORT = {
	width: 1280,
	height: 800,
}

// 创建MCP服务器
const server = new McpServer({
	name: "chrome-server",
	version: "1.0.0",
})

// WebSocket客户端管理
class ChromeExtensionClient {
	constructor() {
		this.wss = null
		this.clientSocket = null
		this.isReady = false
		this.pendingRequests = new Map()
		this.requestIdCounter = 0
		this.targetTabId = null
		this.currentUrl = undefined
		this.viewport = { ...DEFAULT_VIEWPORT } // 添加viewport配置
	}

	async initialize() {
		// console.log("ChromeExtensionClient: Initializing WebSocket server...")
		await this.startWebSocketServer()
		return new Promise((resolve) => {
			// 尝试等待连接建立
			const checkConnection = () => {
				if (this.isReady) {
					resolve(true)
				} else {
					setTimeout(checkConnection, 500)
				}
			}
			checkConnection()
		})
	}

	async startWebSocketServer() {
		// 如果服务器存在且正在监听，无需重新启动
		if (this.wss && this.clientSocket && this.isReady) {
			// console.log("ChromeExtensionClient: WebSocket server already running and client connected.")
			return
		}

		// 如果服务器实例存在但可能已关闭或处于错误状态，先关闭它
		if (this.wss) {
			// console.log("ChromeExtensionClient: Existing WebSocket server found, ensuring it's closed before restart...")
			await new Promise((resolve) => {
				// 先关闭客户端连接
				if (this.clientSocket && this.clientSocket.readyState !== WebSocket.CLOSED) {
					this.clientSocket.close()
					this.clientSocket = null
				}
				this.wss?.close((err) => {
					if (err) {
						// console.error("ChromeExtensionClient: Error closing existing server before restart:", err)
					}
					// console.log("ChromeExtensionClient: Existing server closed.")
					this.wss = null
					this.isReady = false
					this.targetTabId = null // 重置目标标签ID
					resolve()
				})
			})
			// 添加小延迟确保端口释放
			await new Promise((resolve) => setTimeout(resolve, 100))
		}

		// console.log("ChromeExtensionClient: Starting new WebSocket server...")
		// 重置状态
		this.isReady = false
		this.clientSocket = null
		this.pendingRequests.clear()

		return new Promise((resolve, reject) => {
			try {
				this.wss = new WebSocketServer({ port: WEBSOCKET_PORT })
				// console.log(`ChromeExtensionClient: WebSocket server listening on port ${WEBSOCKET_PORT}`)

				this.wss.on("connection", (ws) => {
					// console.log("ChromeExtensionClient: Chrome extension client connected.")
					if (this.clientSocket && this.clientSocket.readyState === WebSocket.OPEN) {
						// console.warn("ChromeExtensionClient: New client connected, closing previous one.")
						this.clientSocket.close()
					}
					this.clientSocket = ws
					this.isReady = true

					// 连接建立后立即调用onConnected
					this.onConnected()

					ws.on("message", (message) => {
						try {
							const parsedMessage = JSON.parse(message.toString())
							this.handleMessageFromClient(parsedMessage)
						} catch (e) {
							// console.error(
							//   "ChromeExtensionClient: Error parsing message from client:",
							//   e,
							//   "Raw:",
							//   message.toString()
							// )
						}
					})

					ws.on("close", () => {
						// console.log("ChromeExtensionClient: Chrome extension client disconnected.")
						if (this.clientSocket === ws) {
							this.clientSocket = null
							this.isReady = false
							const disconnectError = new Error("Chrome extension client disconnected.")
							this.pendingRequests.forEach((req) => req.reject(disconnectError))
							this.pendingRequests.clear()
							this.targetTabId = null

							// --- Modified shutdown logic ---
							// console.log("ChromeExtensionClient: Client disconnected. Scheduling server process shutdown."); // Removed log
							// Attempt cleanup but don't wait for it
							this.dispose().catch((err) => console.error("Error during dispose on client disconnect:", err)) // Keep error log (stderr)
							// Force exit after a short delay
							setTimeout(() => {
								// console.log("Exiting chrome-server process due to client disconnect."); // Removed log
								process.exit(0)
							}, 500) // Exit after 500ms
							// --- End of modified logic ---
						}
					})

					ws.on("error", (error) => {
						// console.error("ChromeExtensionClient: Client WebSocket error:", error)
						if (this.clientSocket === ws) {
							this.clientSocket = null
							this.isReady = false
							const connectError = new Error(`Client WebSocket error: ${error.message}`)
							this.pendingRequests.forEach((req) => req.reject(connectError))
							this.pendingRequests.clear()
							this.targetTabId = null
						}
					})

					resolve()
				})

				this.wss.on("error", (error) => {
					// console.error("ChromeExtensionClient: WebSocket server error:", error)
					this.isReady = false
					this.wss = null
					this.clientSocket = null
					const serverError = new Error(`WebSocket server error: ${error.message}`)
					this.pendingRequests.forEach((req) => req.reject(serverError))
					this.pendingRequests.clear()
					this.targetTabId = null
					reject(error)
				})

				this.wss.on("close", () => {
					// console.log("ChromeExtensionClient: WebSocket server closed.")
					this.wss = null
					this.clientSocket = null
					this.isReady = false
					this.targetTabId = null
				})
			} catch (error) {
				// console.error("ChromeExtensionClient: Failed to create WebSocket server:", error)
				reject(error)
			}
		})
	}

	handleMessageFromClient(message) {
		const { requestId, status, command } = message

		// 处理没有requestId但有command的特殊情况（例如viewport配置的ack）
		if (!requestId && command === "setViewportConfig" && status === "ack") {
			// 查找最近的setViewportConfig请求
			for (const [reqId, req] of this.pendingRequests.entries()) {
				if (req.command === "setViewportConfig") {
					// 清除超时
					clearTimeout(req.timeoutId)
					this.pendingRequests.delete(reqId)

					// 解析promise
					req.resolve({
						status: "success",
						message: "Viewport configuration applied",
						viewport: this.viewport,
					})
					return
				}
			}
			return
		}

		// 常规处理有requestId的响应
		if (!requestId) {
			return
		}

		const pendingRequest = this.pendingRequests.get(requestId)
		if (!pendingRequest) {
			return
		}

		// 清除超时
		clearTimeout(pendingRequest.timeoutId)
		this.pendingRequests.delete(requestId)

		if (status === "error") {
			pendingRequest.reject(new Error(message.message || `Command '${pendingRequest.command}' failed.`))
		} else if (status === "ack" || status === "success") {
			// 在启动/导航完成后检查tabId
			if (
				(pendingRequest.command === "launch" || pendingRequest.command === "navigateToUrl") &&
				message.command === "tabUpdated" &&
				message.tabId
			) {
				this.targetTabId = message.tabId
			}

			// 更新当前URL
			if (message.currentUrl) {
				this.currentUrl = message.currentUrl
			} else if (message.url) {
				this.currentUrl = message.url
			}

			pendingRequest.resolve({
				status: "success",
				message: message.message,
				screenshot: message.screenshot,
				logs: message.logs,
				currentUrl: message.currentUrl || message.url,
				currentMousePosition: message.currentMousePosition,
				viewportSize: message.viewportSize,
				analysisResult: message.analysisResult,
				tabId: message.tabId,
				htmlContent: message.htmlContent,
			})
		} else {
			pendingRequest.reject(new Error(`Received unhandled status '${status}' for command '${pendingRequest.command}'.`))
		}
	}

	sendMessageToClient(message, command) {
		const requestId = `req-${this.requestIdCounter++}`
		// 为需要它的命令包含targetTabId
		const includeTargetTab = [
			"click",
			"type",
			"pressKey",
			"pressKeyCombination",
			"scroll",
			"getFullHtml",
			"get_viewport_size",
			"takeAreaScreenshot",
		].includes(command)

		const messageToSend = {
			...message,
			requestId,
			command,
			source: "mcpServer",
			...(includeTargetTab && this.targetTabId !== null && { targetTabId: this.targetTabId }),
		}

		if (!this.clientSocket || this.clientSocket.readyState !== WebSocket.OPEN) {
			// console.error("ChromeExtensionClient: Cannot send message, client not connected or ready.")
			throw new Error("Chrome extension client is not connected.")
		}

		try {
			const messageString = JSON.stringify(messageToSend)
			// console.log(`ChromeExtensionClient: Sending message to client:`, messageToSend)
			this.clientSocket.send(messageString)
			return requestId
		} catch (error) {
			// console.error(`ChromeExtensionClient: Error sending message to client: ${error}`)
			throw error
		}
	}

	waitForResponse(requestId, command, timeoutMs = 30000) {
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				if (this.pendingRequests.has(requestId)) {
					// console.error(
					//   `ChromeExtensionClient: Timeout waiting for response for request ${requestId} (command: ${command})`
					// )
					this.pendingRequests
						.get(requestId)
						?.reject(new Error(`Timeout waiting for response for command ${command} (ID: ${requestId})`))
					this.pendingRequests.delete(requestId)
				}
			}, timeoutMs)

			this.pendingRequests.set(requestId, { resolve, reject, command, timeoutId })
			// console.log(`ChromeExtensionClient: Stored pending request ${requestId} for command ${command}`)
		})
	}

	isLaunched() {
		return !!this.wss && !!this.clientSocket && this.isReady
	}

	getCurrentUrl() {
		return this.currentUrl
	}

	async launch(url = "about:blank") {
		const command = "launch"

		try {
			// 确保服务器运行
			await this.startWebSocketServer()

			const requestId = this.sendMessageToClient({ url }, command)
			const responseData = await this.waitForResponse(requestId, command)

			// 更新内部URL状态
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			} else if (responseData?.url) {
				this.currentUrl = responseData.url
			}

			// 保存tabId如果返回的话
			if (responseData?.tabId) {
				this.targetTabId = responseData.tabId
			}

			return {
				status: "success",
				message: `Browser launched. Current URL: ${this.currentUrl}`,
				screenshot: responseData?.screenshot,
				currentUrl: this.currentUrl,
			}
		} catch (error) {
			return {
				status: "error",
				message: `Launch error: ${error.message}`,
			}
		}
	}

	async navigate(url) {
		const command = "navigateToUrl"

		try {
			const requestId = this.sendMessageToClient({ url }, command)
			// 对导航使用更长的超时时间
			const responseData = await this.waitForResponse(requestId, command, 60000)

			// 更新内部URL状态
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			} else if (responseData?.url) {
				this.currentUrl = responseData.url
			}

			// 保存tabId如果返回的话
			if (responseData?.tabId) {
				this.targetTabId = responseData.tabId
			}

			return {
				status: "success",
				message: `Navigated to ${url}. Current URL: ${this.currentUrl}`,
				screenshot: responseData?.screenshot,
				currentUrl: this.currentUrl,
			}
		} catch (error) {
			return {
				status: "error",
				message: `Navigation error: ${error.message}`,
			}
		}
	}

	async click(coordinate) {
		const command = "click"
		// console.log(`ChromeExtensionClient: ${command} called (coordinate: ${coordinate})`)

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			const requestId = this.sendMessageToClient({ coordinate }, command)
			const responseData = await this.waitForResponse(requestId, command, 15000)
			// console.log(`ChromeExtensionClient: ${command} response received for ${requestId}:`, responseData)

			// 更新内部URL状态
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			}

			return {
				status: "success",
				message: `Clicked at ${coordinate}`,
				screenshot: responseData?.screenshot,
				currentUrl: this.currentUrl,
				...(responseData.navigationOccurred !== undefined && { navigationOccurred: responseData.navigationOccurred }),
				currentMousePosition: coordinate,
			}
		} catch (error) {
			// console.error(`ChromeExtensionClient: Error during ${command}: ${error.message}`)
			return {
				status: "error",
				message: `Click error: ${error.message}`,
				screenshot: error.screenshot,
			}
		}
	}

	async type(text) {
		const command = "type"
		// console.log(`ChromeExtensionClient: ${command} called (text length: ${text?.length})`)

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			const requestId = this.sendMessageToClient({ text }, command)
			const responseData = await this.waitForResponse(requestId, command, 7000 + text.length * 10)
			// console.log(`ChromeExtensionClient: ${command} response received for ${requestId}:`, responseData)

			// 更新内部URL状态
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			}

			return {
				status: "success",
				message: `Typed text (length: ${text?.length})`,
				screenshot: responseData?.screenshot,
				currentUrl: this.currentUrl,
			}
		} catch (error) {
			// console.error(`ChromeExtensionClient: Error during ${command}: ${error.message}`)
			return {
				status: "error",
				message: `Type error: ${error.message}`,
				screenshot: error.screenshot,
			}
		}
	}

	async pressKey(key) {
		const command = "pressKey"
		// console.log(`ChromeExtensionClient: ${command} called (key: ${key})`)

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			const requestId = this.sendMessageToClient({ key }, command)
			const responseData = await this.waitForResponse(requestId, command, 10000)
			// console.log(`ChromeExtensionClient: ${command} response received for ${requestId}:`, responseData)

			// 更新内部URL状态
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			}

			return {
				status: "success",
				message: `Pressed key: ${key}`,
				screenshot: responseData?.screenshot,
				currentUrl: this.currentUrl,
				...(responseData.navigationOccurred !== undefined && { navigationOccurred: responseData.navigationOccurred }),
			}
		} catch (error) {
			// console.error(`ChromeExtensionClient: Error during ${command}: ${error.message}`)
			return {
				status: "error",
				message: `Press key error: ${error.message}`,
				screenshot: error.screenshot,
			}
		}
	}

	async scroll(direction, selector) {
		const command = "scroll"
		// console.log(`ChromeExtensionClient: ${command} called (direction: ${direction}, selector: ${selector})`)

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			// 包含选择器（如果存在）
			const payload = { direction }
			if (selector) {
				payload.selector = selector
			}

			const requestId = this.sendMessageToClient(payload, command)
			const responseData = await this.waitForResponse(requestId, command, 15000)
			// console.log(`ChromeExtensionClient: ${command}/${direction} response received for ${requestId}:`, responseData)

			// 更新内部URL状态
			if (responseData?.currentUrl) {
				this.currentUrl = responseData.currentUrl
			}

			return {
				status: "success",
				message: `Scrolled ${direction}${selector ? " on " + selector : ""}`,
				screenshot: responseData?.screenshot,
				currentUrl: this.currentUrl,
			}
		} catch (error) {
			// console.error(`ChromeExtensionClient: Error during ${command}/${direction}: ${error.message}`)
			return {
				status: "error",
				message: `Scroll ${direction} error: ${error.message}`,
				screenshot: error.screenshot,
			}
		}
	}

	async takeScreenshot() {
		const command = "takeScreenshot"
		// console.log(`ChromeExtensionClient: ${command} called`)

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			const requestId = this.sendMessageToClient({}, command)
			const responseData = await this.waitForResponse(requestId, command, 15000)
			// console.log(`ChromeExtensionClient: ${command} response received for ${requestId}`)

			return {
				status: "success",
				message: "Screenshot taken",
				screenshot: responseData?.screenshot,
			}
		} catch (error) {
			// console.error(`ChromeExtensionClient: Error during ${command}: ${error.message}`)
			return {
				status: "error",
				message: `Screenshot error: ${error.message}`,
			}
		}
	}

	async saveFullHtml(filename) {
		const command = "getFullHtml"
		// console.log(`ChromeExtensionClient: ${command} called.`)

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			const requestId = this.sendMessageToClient({}, command)
			const responseData = await this.waitForResponse(requestId, command, 20000)
			// console.log(`ChromeExtensionClient: ${command} response received for ${requestId}`)

			if (responseData?.htmlContent) {
				const htmlContent = responseData.htmlContent
				// console.log(`ChromeExtensionClient: Received HTML content (length: ${htmlContent.length})`)

				// 创建临时目录保存HTML
				const tempDir = path.join(os.tmpdir(), "chrome_extension_mcp")
				await fs.ensureDir(tempDir)

				// 使用固定的临时文件路径，同时也支持自定义文件名
				const actualFilename = filename || "page.html"
				const fullHtmlPath = filename ? path.join(tempDir, actualFilename) : tempHtmlPath

				await fs.writeFile(fullHtmlPath, htmlContent, "utf8")
				// console.log(`ChromeExtensionClient: Full HTML saved to: ${fullHtmlPath}`)

				return {
					status: "success",
					message: `HTML saved to ${fullHtmlPath}`,
					path: fullHtmlPath,
					size: htmlContent.length,
				}
			} else {
				// console.error("ChromeExtensionClient: HTML content not found in response")
				return {
					status: "error",
					message: "Failed to get HTML content from extension",
				}
			}
		} catch (error) {
			// console.error(`ChromeExtensionClient: Error during ${command}: ${error.message}`)
			return {
				status: "error",
				message: `Save HTML error: ${error.message}`,
			}
		}
	}

	async close() {
		const command = "close"
		// console.log(`ChromeExtensionClient: ${command} called.`)

		if (!this.isLaunched() && !this.wss) {
			return {
				status: "success",
				message: "Browser session already inactive.",
			}
		}

		// 在关闭前保存HTML
		if (this.isLaunched()) {
			try {
				await this.saveFullHtml("last_page.html")
			} catch (error) {
				// console.error("ChromeExtensionClient: Failed to save HTML before closing:", error)
			}
		}

		let requestId = null
		let closeMessage = "Browser close requested."

		if (this.isLaunched()) {
			try {
				requestId = this.sendMessageToClient({}, command)
				await this.waitForResponse(requestId, command, 5000)
				closeMessage = "Browser close command acknowledged by extension."
			} catch (error) {
				// console.warn(`ChromeExtensionClient: Error during close command: ${error.message}`)
				closeMessage = `Error during close command: ${error.message}`
			}
		} else {
			closeMessage = "Client not connected, proceeding directly to dispose."
		}

		// 无论确认是否收到，都释放资源
		await this.dispose()

		return {
			status: "success",
			message: `${closeMessage} WebSocket server closed.`,
		}
	}

	async dispose() {
		if (!this.wss && !this.clientSocket) {
			return // 已经释放，无需操作
		}

		// console.log("ChromeExtensionClient: Disposing resources...")
		const disposeError = new Error("Client disposed.")
		this.pendingRequests.forEach((req) => {
			clearTimeout(req.timeoutId)
			req.reject(disposeError)
		})
		this.pendingRequests.clear()

		await new Promise((resolve) => {
			if (this.clientSocket && this.clientSocket.readyState === WebSocket.OPEN) {
				this.clientSocket.close()
			}
			this.clientSocket = null

			if (this.wss) {
				this.wss.close((err) => {
					if (err) {
						// console.error("ChromeExtensionClient: Error closing WebSocket server during dispose:", err)
					}
					// console.log("ChromeExtensionClient: WebSocket server successfully closed.")
					this.wss = null
					this.isReady = false
					this.targetTabId = null
					resolve()
				})
			} else {
				// console.log("ChromeExtensionClient: No WebSocket server instance to close.")
				this.isReady = false
				this.targetTabId = null
				resolve()
			}
		})

		this.isReady = false
	}

	// 添加方法：连接成功后发送viewport配置
	onConnected() {
		// 删除console.log，避免干扰stdio通信
		this.isConnected = true

		// 连接成功后立即发送viewport配置，但等待客户端完全准备好
		// 只有在客户端启动后才设置，避免在连接时就发送命令
		if (this.clientSocket && this.clientSocket.readyState === WebSocket.OPEN) {
			// 等待较长时间确保客户端已完全初始化
			setTimeout(() => {
				if (this.isLaunched()) {
					this.setViewport(this.viewport.width, this.viewport.height).catch(() => {})
				}
			}, 2000) // 使用更长的延迟
		}
	}

	// 添加方法：设置viewport尺寸
	async setViewport(width, height) {
		// 使用正确的命令名称，与ChromeExtensionBackend.ts一致
		const command = "setViewportConfig"

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			// 更新内部viewport配置
			this.viewport = { width, height }

			// 使用与ChromeExtensionBackend.ts完全一致的参数格式
			const requestId = this.sendMessageToClient(
				{
					viewport: {
						width: this.viewport.width,
						height: this.viewport.height,
					},
				},
				command,
			)

			const responseData = await this.waitForResponse(requestId, command, 5000)

			return {
				status: "success",
				message: `Viewport set to ${width}x${height}`,
				viewport: this.viewport,
			}
		} catch (error) {
			return {
				status: "error",
				message: `Set viewport error: ${error.message}`,
			}
		}
	}

	async takeAreaScreenshot(topLeft, bottomRight) {
		const command = "takeAreaScreenshot"

		if (!this.isLaunched()) {
			return {
				status: "error",
				message: "Client not connected.",
			}
		}

		try {
			// 确保截图保存目录存在
			await fs.ensureDir(screenshotSaveDir)

			// 发送区域截图命令
			const requestId = this.sendMessageToClient({ topLeft, bottomRight }, command)
			const responseData = await this.waitForResponse(requestId, command, 15000)

			if (responseData?.screenshot) {
				// 生成时间戳文件名避免冲突
				const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
				const filename = `screenshot-${timestamp}.jpg`
				const screenshotPath = path.join(screenshotSaveDir, filename)

				// 保存base64图片到文件
				if (responseData.screenshot.startsWith("data:image")) {
					const base64Data = responseData.screenshot.split(",")[1]
					await fs.writeFile(screenshotPath, Buffer.from(base64Data, "base64"))

					return {
						status: "success",
						message: "Area screenshot taken and saved",
						screenshot: responseData.screenshot,
						savedPath: screenshotPath,
					}
				}
			}

			return {
				status: "error",
				message: "Failed to get screenshot from extension",
			}
		} catch (error) {
			return {
				status: "error",
				message: `Area screenshot error: ${error.message}`,
			}
		}
	}

	// 获取所有保存的截图文件
	async getSavedScreenshots() {
		try {
			// 确保截图保存目录存在
			await fs.ensureDir(screenshotSaveDir)

			// 获取目录中的所有文件
			const files = await fs.readdir(screenshotSaveDir)
			const screenshots = []

			// 仅收集图片文件
			for (const file of files) {
				if (file.endsWith(".jpg") || file.endsWith(".jpeg") || file.endsWith(".png")) {
					const filePath = path.join(screenshotSaveDir, file)
					const stats = await fs.stat(filePath)

					screenshots.push({
						filename: file,
						path: filePath,
						size: stats.size,
						created: stats.birthtime,
					})
				}
			}

			// 按创建时间排序，最新的在前
			screenshots.sort((a, b) => b.created - a.created)

			return {
				status: "success",
				message: `Found ${screenshots.length} saved screenshots`,
				screenshots,
			}
		} catch (error) {
			return {
				status: "error",
				message: `Error getting saved screenshots: ${error.message}`,
			}
		}
	}

	/**
	 * 等待指定的秒数
	 * @param {number} seconds - 等待的秒数
	 * @returns {Promise<Object>} 等待结果
	 */
	async wait(seconds) {
		console.log(`[BG] 等待 ${seconds} 秒`)

		try {
			if (!this.isLaunched()) {
				return {
					status: "error",
					message: "Client not connected.",
				}
			}

			// 验证输入
			const waitTime = Number(seconds)
			if (isNaN(waitTime) || waitTime <= 0) {
				return {
					status: "error",
					message: `Invalid wait time: ${seconds}. Must be a positive number.`,
				}
			}

			// 将秒转换为毫秒
			const waitTimeMs = waitTime * 1000

			// 简单的等待实现
			await new Promise((resolve) => setTimeout(resolve, waitTimeMs))

			// 等待后捕获当前屏幕状态
			const screenshotDataUrl = await this.takeScreenshot()
			const currentUrl = this.currentUrl

			return {
				status: "success",
				message: `Waited for ${waitTime} seconds`,
				screenshot: screenshotDataUrl?.screenshot,
				currentUrl: currentUrl,
			}
		} catch (error) {
			return {
				status: "error",
				message: `Wait error: ${error.message}`,
			}
		}
	}
}

// 创建Chrome扩展客户端实例
const chromeClient = new ChromeExtensionClient()

// 正确格式化响应内容，将截图转换为MCP图像格式
function formatResponse(result) {
	if (!result) return { content: [{ type: "text", text: JSON.stringify({ status: "error", message: "No result" }) }] }

	// 处理内容
	const content = []

	// 添加基本信息作为文本
	const basicInfo = {
		status: result.status,
		message: result.message,
		currentUrl: result.currentUrl,
	}

	content.push({
		type: "text",
		text: JSON.stringify(basicInfo),
	})

	// 如果有截图，添加为图像类型
	if (result.screenshot && typeof result.screenshot === "string" && result.screenshot.startsWith("data:image")) {
		// 提取base64数据部分
		const base64Data = result.screenshot.split(",")[1]
		const mimeType = result.screenshot.split(",")[0].split(":")[1].split(";")[0]

		content.push({
			type: "image",
			data: base64Data,
			mimeType: mimeType || "image/jpeg",
		})
	}

	return { content }
}

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
				await chromeClient.initialize()
				await chromeClient.launch()
			}

			const result = await chromeClient.navigate(params.url)
			return formatResponse(result)
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
				await chromeClient.initialize()
				await chromeClient.launch()
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
				await chromeClient.initialize()
				await chromeClient.launch()
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
	"Press a key on the keyboard",
	{
		key: z.string().describe("Name of the key to press, such as 'ArrowLeft' or 'Enter'"),
	},
	async (params) => {
		try {
			if (!chromeClient.isLaunched()) {
				await chromeClient.initialize()
				await chromeClient.launch()
			}

			const result = await chromeClient.pressKey(params.key)
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

// 注册工具：MCP Browser Snapshot
server.tool(
	"snapshot",
	"Capture snapshot of the current page",
	{
		purpose: z.string().describe("give any string, workaround for no-parameter tools."),
	},
	async (params) => {
		try {
			if (!chromeClient.isLaunched()) {
				await chromeClient.initialize()
				await chromeClient.launch()
			}

			const result = await chromeClient.takeScreenshot()
			return formatResponse(result)
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							status: "error",
							message: `Error taking snapshot: ${error.message}`,
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
				await chromeClient.initialize()
				await chromeClient.launch()
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

// 注册工具：MCP Browser Take Screenshot
server.tool(
	"take_screenshot",
	"Take a screenshot of the current page",
	{
		raw: z.boolean().optional().describe("Whether to return without compression"),
	},
	async (params) => {
		try {
			if (!chromeClient.isLaunched()) {
				await chromeClient.initialize()
				await chromeClient.launch()
			}

			const result = await chromeClient.takeScreenshot()
			return formatResponse(result)
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							status: "error",
							message: `Error taking screenshot: ${error.message}`,
						}),
					},
				],
			}
		}
	},
)

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
				await chromeClient.launch()
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
				await chromeClient.initialize()
				await chromeClient.launch()
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
	"mcp_browser_area_screenshot",
	"Take a screenshot of a specific area of the current page",
	{
		topLeft: z.string().describe("Top-left coordinate (x,y) of the area to capture"),
		bottomRight: z.string().describe("Bottom-right coordinate (x,y) of the area to capture"),
	},
	async (params) => {
		try {
			if (!chromeClient.isLaunched()) {
				await chromeClient.initialize()
				await chromeClient.launch()
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

// 注册工具：MCP Browser Get Saved Screenshots
server.tool(
	"mcp_browser_get_saved_screenshots",
	"Get a list of all saved screenshots",
	{
		purpose: z.string().describe("give any string, workaround for no-parameter tools."),
	},
	async (params) => {
		try {
			const result = await chromeClient.getSavedScreenshots()

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							status: result.status,
							message: result.message,
							screenshots: result.screenshots,
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
							message: `Error getting saved screenshots: ${error.message}`,
						}),
					},
				],
			}
		}
	},
)

// 注册工具：MCP Browser Wait
server.tool(
	"mcp_browser_wait",
	"Wait for a specified number of seconds",
	{
		seconds: z.number().describe("Number of seconds to wait"),
	},
	async (params) => {
		try {
			if (!chromeClient.isLaunched()) {
				await chromeClient.initialize()
				await chromeClient.launch()
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

// 连接到标准输入/输出传输并启动服务器
await server.connect(new StdioServerTransport())
